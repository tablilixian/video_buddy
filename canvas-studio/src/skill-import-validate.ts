/**
 * CV-333：用户 skill 导入的**校验层**（纯函数、零 IO、可单测）。
 *
 * ## 为什么单独一个模块
 *
 * 端点只做三件事：读 body → 调本模块的 `validateImport` → 落盘。**业务规则不在
 * 端点里重复第二遍** —— 否则「路由判一遍、落盘再判一遍」两份规则必然漂移，而漂移的
 * 表现是「提示说可以、实际落了个不合规的东西」这类最难查的故障。
 *
 * 与 `skill-upload-contract.ts` 的分工：那边管**frontmatter 契约**
 * （role / name / description / slot / advisory），这边管**文件结构与规模**
 * （有没有 SKILL.md、slug 怎么定、多大算超限、哪个路径该归位）。两者串行调用，
 * 契约层的结果原样并进本层的返回。
 *
 * ## 数据模型：为什么前端只传内容，不传路径
 *
 * 原生目录选择器只存在于 `dsh-plugin-desktop`（`showOpenDialog`），**没有注入给
 * canvas-studio**。所以导入只能是「renderer 读文件内容 → POST 内容给 Host」，
 * 而不是「用户给个路径 → Host 去读」。
 *
 * 这顺带把一整类安全问题**从数据模型上消掉**：Host 永远不读用户给的路径，
 * 只往 `<DSH_HOME>/skills/<校验过的 slug>/` 写。`../`、绝对路径、符号链接逃逸
 * 在「路径必须由本模块构造」的前提下无处落脚（U-11 断言此性质）。
 */
import type { SkillCategoryId, SkillIconId } from './skill-catalog.js'
import { SKILL_CATEGORY_IDS, SKILL_ICON_IDS } from './skill-catalog.js'
import {
  bodyAdvisories,
  isValidSlug,
  parseSkillFrontmatter,
  validateUpload,
  type BuiltinSlotOwners,
  type SkillUploadErrorCode,
  type UploadAdvisory,
} from './skill-upload-contract.js'

/** 前端送来的一份文件：**内容**（不是路径）。 */
export interface ImportFile {
  /**
   * 相对路径，POSIX 分隔符（`/`）。
   *
   * 目录选择器给的是 `webkitRelativePath`（含用户选中的顶层目录名）；
   * 单文件选择给的是文件名。本模块负责把公共顶层目录剥掉并归一。
   */
  readonly path: string
  /** 文本内容。**缺省 = 非文本（二进制 / 读取失败）**，按 D6 跳过并提示，不算失败。 */
  readonly text?: string
}

/** 导入规模上限（D5）。 */
export const IMPORT_LIMITS = {
  /** 单文件字节上限。 */
  fileBytes: 256 * 1024,
  /** 本次导入总字节上限。 */
  totalBytes: 2 * 1024 * 1024,
  /** 文件数（含被跳过的）上限。 */
  fileCount: 50,
  /** `references/` 之类的子目录深度上限。 */
  depth: 3,
} as const

/** 只收文本的扩展名（D6）。二进制**跳过并提示**，不算失败。 */
export const TEXT_EXTENSIONS: readonly string[] = ['.md', '.txt', '.json', '.yaml', '.yml']

/** 目录包入口文件名（上游硬性要求，**大小写敏感**）。 */
export const ENTRY_FILE = 'SKILL.md'

/** 辅助文件的默认归位目录（§5.5：根级多余 `.md` 会被上游当独立 skill 试解析）。 */
export const AUX_DIR = 'references'

/** 从 frontmatter 派生的展示字段（内置 skill 走 `platform.yaml`，用户 skill 只能从这来）。 */
export interface ImportMeta {
  readonly name: string
  readonly description: string
  /** D7：`category` 缺失或非法 → `other`（= UI 上的「未分类」）。 */
  readonly category: SkillCategoryId
  /** `icon` 缺失或非法 → `null`（UI 渲染首字母）。 */
  readonly icon: SkillIconId | null
  /** 仅作展示标签，不参与绑定（CV-331）。 */
  readonly slot: string | null
}

/** 归一化后的落盘文件（路径已剥公共顶层目录；根级多余 `.md` 已归位）。 */
export interface NormalizedImportFile {
  /** 相对 `<slug>/` 的 POSIX 路径。 */
  readonly path: string
  readonly text: string
}

export type ImportVerdict =
  | {
    readonly ok: true
    /** slug（= 落盘目录名）；调用方不得再自行派生。 */
    readonly slug: string
    /** 落盘内容（**唯一事实源**：调用方照抄，不要再算一遍路径）。 */
    readonly files: readonly NormalizedImportFile[]
    /** 从 frontmatter 派生的展示字段。 */
    readonly meta: ImportMeta
    readonly advisories: readonly UploadAdvisory[]
    readonly note: string
  }
  | {
    readonly ok: false
    readonly code: SkillUploadErrorCode
    readonly reason: string
    /** 结构层已发现但不足以拒绝的提示（拒绝时也一并回传，方便 UI 显示「还差哪一步」）。 */
    readonly advisories: readonly UploadAdvisory[]
  }

/** 调用方要提供的外部事实（全部可选；缺省不产生假判定）。 */
export interface ImportContext {
  readonly owners?: BuiltinSlotOwners
  /** 已占用的注册名（内置 catalog ∪ 已有用户条目）。 */
  readonly takenNames?: readonly string[]
  /** 用户显式指定的落点 slug（向导里可改）；缺省从目录名 / name 派生。 */
  readonly requestedSlug?: string
}

/** UTF-8 字节数（`TextEncoder` 在 Node 与渲染器里都在，不必引 `node:buffer`）。 */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 路径是否指向隐藏文件/目录（任一段以 `.` 开头）。 */
function isHiddenPath(path: string): boolean {
  return path.split('/').some(segment => segment.startsWith('.') && segment !== '' && segment !== '.')
}

/** 扩展名（小写，含点）；无扩展名返回空串。 */
function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/**
 * 归一化相对路径：统一分隔符、去掉 `./`、**折叠 `..` 与绝对路径**。
 *
 * `..` 不是「拒绝」而是「丢弃该段」：本模块的输出路径永远只用于构造
 * `<DSH_HOME>/skills/<slug>/<path>`，折叠后不可能逃出去。真正的拒绝点
 * 在调用方的 realpath 前缀校验（双保险）。
 */
export function normalizeRelativePath(raw: string): string {
  const unified = raw.replaceAll('\\', '/')
  const segments: string[] = []
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/** 剥离所有文件共有的顶层目录（目录选择器会给 `night-noir/SKILL.md` 这种形态）。 */
function stripCommonTop(files: readonly ImportFile[]): { top: string | null; files: ImportFile[] } {
  const paths = files.map(file => normalizeRelativePath(file.path))
  const firsts = new Set(paths.map(path => path.split('/')[0] ?? ''))
  const shared = firsts.size === 1 ? [...firsts][0] ?? '' : ''
  // 只有「共有且不是唯一一层」时才剥：`SKILL.md` 单文件没有可剥的顶层。
  const hasNested = paths.some(path => path.split('/').length > 1)
  if (shared === '' || !hasNested) return { top: null, files: [...files] }
  return {
    top: shared,
    files: files.map((file, index) => {
      const path = paths[index] ?? ''
      const stripped = path.split('/').slice(1).join('/')
      return file.text === undefined ? { path: stripped } : { path: stripped, text: file.text }
    }),
  }
}

/** 分类 / 图标取值校验（D7：非法即回落，不拒绝 —— 展示字段不值得挡用户的路）。 */
function categoryOf(raw: string | undefined): SkillCategoryId {
  return raw !== undefined && (SKILL_CATEGORY_IDS as readonly string[]).includes(raw)
    ? (raw as SkillCategoryId)
    : 'other'
}

function iconOf(raw: string | undefined): SkillIconId | null {
  return raw !== undefined && (SKILL_ICON_IDS as readonly string[]).includes(raw)
    ? (raw as SkillIconId)
    : null
}

/**
 * 校验并归一化一次导入。
 *
 * 判定顺序：规模上限 → 结构（找到入口）→ slug → frontmatter 契约 → 归位与建议。
 * 每一步的失败都带**具体原因 + 怎么改**（用户看不到本仓文档，提示必须自足）。
 */
export function validateImport(files: readonly ImportFile[], context: ImportContext = {}): ImportVerdict {
  const empty: readonly UploadAdvisory[] = []
  if (files.length === 0) {
    return { ok: false, code: 'CS-SKILL-001', reason: '没有选到任何文件。请选择一个包含 SKILL.md 的文件夹，或直接选一个 .md 文件。', advisories: empty }
  }

  // ── 规模上限（D5）：先判，避免为一份超大目录白跑后续所有校验 ──
  if (files.length > IMPORT_LIMITS.fileCount) {
    return {
      ok: false,
      code: 'CS-SKILL-006',
      reason: `文件数 ${String(files.length)} 超过上限 ${String(IMPORT_LIMITS.fileCount)}。`
        + '用户 skill 是知识型规范，通常只有 SKILL.md 加几个 references/ 文件 —— 请精简后再导入。',
      advisories: empty,
    }
  }

  const stripped = stripCommonTop(files)
  let totalBytes = 0
  for (const file of stripped.files) {
    if (file.text === undefined) continue
    const size = utf8Bytes(file.text)
    if (size > IMPORT_LIMITS.fileBytes) {
      return {
        ok: false,
        code: 'CS-SKILL-006',
        reason: `文件 \`${normalizeRelativePath(file.path)}\` 为 ${String(Math.round(size / 1024))}KB，`
          + `超过单文件上限 ${String(IMPORT_LIMITS.fileBytes / 1024)}KB。`,
        advisories: empty,
      }
    }
    totalBytes += size
  }
  if (totalBytes > IMPORT_LIMITS.totalBytes) {
    return {
      ok: false,
      code: 'CS-SKILL-006',
      reason: `本次导入合计 ${String(Math.round(totalBytes / 1024))}KB，`
        + `超过总量上限 ${String(IMPORT_LIMITS.totalBytes / 1024)}KB。`,
      advisories: empty,
    }
  }

  // ── 结构：找出入口文件 ──
  const textFiles = stripped.files.filter((file): file is ImportFile & { text: string } => file.text !== undefined)
  const skippedBinary = stripped.files
    .filter(file => file.text === undefined)
    .map(file => normalizeRelativePath(file.path))
    .filter(path => path !== '')

  const rootMd = textFiles
    .map(file => ({ file, path: normalizeRelativePath(file.path) }))
    .filter(item => item.path.split('/').length === 1 && extensionOf(item.path) === '.md')

  const entry = rootMd.find(item => item.path === ENTRY_FILE)
  // 扁平 `.md`（上游同样发现）：统一落成目录包 `<slug>/SKILL.md` —— 内容等价，
  // 但删除 / 改名 / 带 references 时行为一致，不必维护两套分支。
  let flatSource: string | null = null
  if (entry === undefined) {
    if (rootMd.length === 1 && rootMd[0] !== undefined) {
      flatSource = rootMd[0].path
    } else if (rootMd.length === 0) {
      return {
        ok: false,
        code: 'CS-SKILL-001',
        reason: '目录里没有找到入口文件。用户 skill 要么是一个含 `SKILL.md` 的文件夹，要么是单独一个 `.md` 文件。'
          + '（目录包形态的入口必须叫**大写的 `SKILL.md`**；单独一个 `.md` 时文件名随意。）',
        advisories: empty,
      }
    } else {
      return {
        ok: false,
        code: 'CS-SKILL-001',
        reason: `目录根级有多个 .md（${rootMd.map(item => item.path).join('、')}），无法确定哪个是入口。`
          + '请把正文放进 `SKILL.md`，把其余 .md 放进 `references/` 子目录。',
        advisories: empty,
      }
    }
  }

  const entryFile = entry !== undefined
    ? entry.file
    : (textFiles.find(file => normalizeRelativePath(file.path) === flatSource) ?? null)
  if (entryFile === null) {
    return { ok: false, code: 'CS-SKILL-001', reason: '读取 SKILL.md 内容失败，请重试。', advisories: empty }
  }

  // ── depth 上限：剥掉入口文件本身后，剩余路径段数 ──
  for (const file of textFiles) {
    const path = normalizeRelativePath(file.path)
    if (path === flatSource) continue
    const depth = path.split('/').length - 1
    if (depth > IMPORT_LIMITS.depth) {
      return {
        ok: false,
        code: 'CS-SKILL-006',
        reason: `文件 \`${path}\` 的目录层级超过上限 ${String(IMPORT_LIMITS.depth)} 层。`
          + '辅助文件放在 `references/` 下即可，不需要更深的嵌套。',
        advisories: empty,
      }
    }
  }

  // ── frontmatter 契约（复用 CV-331 的唯一判据） ──
  const frontmatter = parseSkillFrontmatter(entryFile.text)
  const slugCandidate = (context.requestedSlug ?? stripped.top ?? frontmatter.name ?? '').trim()
  const contract = validateUpload(frontmatter, {
    ...(context.owners === undefined ? {} : { owners: context.owners }),
    ...(context.takenNames === undefined ? {} : { takenNames: context.takenNames }),
    ...(slugCandidate === '' ? {} : { dirName: slugCandidate }),
  })
  if (!contract.ok) {
    return { ok: false, code: contract.code, reason: contract.reason, advisories: contract.advisories }
  }

  // ── slug：目录名 > 用户指定 > frontmatter name（三者已在上面合成） ──
  const slug = slugCandidate
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      code: 'CS-SKILL-004',
      reason: `落点目录名 \`${slug}\` 不合法：必须是 2~64 字符的小写 kebab-case`
        + '（小写字母/数字/连字符，如 `night-noir-lighting`），且不能是 `.system` / `.trash`。',
      advisories: contract.advisories,
    }
  }

  const advisories: UploadAdvisory[] = [...contract.advisories]

  // ── §5.5 归位：根级除 SKILL.md 外的 .md / .txt 一律搬进 references/ ──
  // 上游把「根级任意 .md」当候选 skill（`isPotentialSkillPath`：segments.length===1
  // 且以 .md 结尾）⇒ 留在根级会被当独立 skill 试解析（无 frontmatter → warn 忽略，
  // 污染日志且行为不可预期）。这里**自动归位并标出**（不拒绝、不静默）。
  const relocated: string[] = []
  const normalized: NormalizedImportFile[] = []
  for (const file of textFiles) {
    const path = normalizeRelativePath(file.path)
    if (path === '') continue
    if (path === ENTRY_FILE || path === flatSource) {
      normalized.push({ path: ENTRY_FILE, text: file.text })
      continue
    }
    const isRootLevel = path.split('/').length === 1
    if (isRootLevel) {
      normalized.push({ path: `${AUX_DIR}/${path}`, text: file.text })
      relocated.push(path)
      continue
    }
    normalized.push({ path, text: file.text })
  }
  if (relocated.length > 0) advisories.push({ kind: 'root-md-relocated', files: relocated })
  if (skippedBinary.length > 0) advisories.push({ kind: 'binary-skipped', files: skippedBinary })
  advisories.push(...bodyAdvisories(entryFile.text))

  const name = (frontmatter.name ?? slug).trim()
  return {
    ok: true,
    slug,
    files: normalized,
    meta: {
      name,
      description: (frontmatter.description ?? '').trim(),
      category: categoryOf(frontmatter.category),
      icon: iconOf(frontmatter.icon),
      slot: frontmatter.slot !== undefined && frontmatter.slot.trim() !== '' ? frontmatter.slot.trim() : null,
    },
    advisories,
    note: advisories.length === 0
      ? `已导入 \`${name}\`（${String(normalized.length)} 个文件）。`
      : `已导入 \`${name}\`（${String(normalized.length)} 个文件），有 ${String(advisories.length)} 条提示。`,
  }
}

/** 隐藏文件清单（UI 的「已跳过」折叠区用；与 `validateImport` 同一判据）。 */
export function hiddenPathsOf(files: readonly ImportFile[]): string[] {
  return files
    .map(file => normalizeRelativePath(file.path))
    .filter(path => path !== '' && isHiddenPath(path))
}
