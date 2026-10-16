/**
 * CV-332/333：用户 skill 的**唯一落盘实现**。
 *
 * ## 单一实现纪律
 *
 * 本模块是**唯一**写 `<DSH_HOME>/skills` 的地方。路由只做「读 body → 调
 * `validateImport` → 调本模块」，不自己拼路径、不自己判 slug —— 否则「路由拼一个
 * 路径、落盘再拼一个」两份必然漂移，而漂移的表现是文件写到了想不到的地方。
 *
 * ## 两个数据源回答两个不同的问题（不是「第二份事实源」）
 *
 * | 问题 | 权威来源 |
 * |---|---|
 * | 「我上传过哪些」 | **本目录枚举**（我们自己的落盘位置，我们写了什么就是什么） |
 * | 「哪些真的生效了」 | `ctx.skills.snapshot({ cwd })`（上游 provider 的注册结果） |
 *
 * 分工的理由：上游 `snapshot()` 返回的是**合并后的赢家**（按 rank：project 100 >
 * runtime > user 400 > bundled 600）。所以一个被同名内置顶掉的用户 skill **根本
 * 不会出现在 snapshot 里** —— 只看它就会「用户上传过的东西从广场消失」，而这正是
 * 最需要展示给用户看的冲突态。目录枚举补上「存在性」，snapshot 补上「胜负」。
 *
 * ## 三条落盘纪律
 *
 * 1. **Host 永不读用户给的路径**：写入路径一律由 `slug` 构造（`slug` 已过
 *    `isValidSlug`，不含 `/`、不含 `..`）。`../` 逃逸在数据模型上无处落脚。
 * 2. **原子写**：写 `<root>/.incoming-<ts>/` → `rename` 到 `<root>/<slug>/`
 *    （同分区 rename 是原子的）。失败时清理临时目录，绝不留半份 skill。
 * 3. **删除进回收站**（D3）：`rename` 到 `<root>/.trash/<slug>-<ts>/`，
 *    **不做物理删除**。`.trash/<slug>/SKILL.md` 相对根是 3 段，
 *    上游 `isPotentialSkillPath`（`segments.length > 2 → false`）不会发现它 ——
 *    回收站里的 skill 不会偷偷继续生效。
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SkillCategoryId, SkillIconId } from './skill-catalog.js'
import { SKILL_CATEGORY_IDS, SKILL_ICON_IDS } from './skill-catalog.js'
import type { SkillListItem, SkillEffectiveStatus, SkillCatalogState } from './contracts/skill.js'
import type { NormalizedImportFile } from './skill-import-validate.js'
import { ENTRY_FILE } from './skill-import-validate.js'
import { isValidSlug, parseSkillFrontmatter } from './skill-upload-contract.js'

/** 用户 skill 落点：`<DSH_HOME>/skills`（= `~/.videobuddy/skills`）。 */
export function userSkillsRoot(): string {
  return dshHomePath('skills')
}

/** 应用内回收站目录名（D3）。 */
export const TRASH_DIR = '.trash'

/** 临时落盘目录前缀（只有 rename 成功才算数）。 */
const INCOMING_PREFIX = '.incoming-'

/** `ctx.skills` 的最小读面（窄接口：可注入假实现单测，不依赖上游类型）。 */
export interface SkillCatalogReader {
  snapshot(options: { cwd?: string }): Promise<{
    readonly skills: readonly {
      readonly name: string
      readonly description: string
      readonly source: string
      readonly invocation?: { readonly modelInvocable?: boolean } | undefined
    }[]
    readonly complete: boolean
  }>
}

/** 项目清单的最小读面（`countProjectsLoadingSkill` 用）。 */
export interface ProjectRosterReader {
  list(): Promise<readonly { readonly id: string }[]>
  readActiveSkills(projectId: string): Promise<string[]>
}

/** `listUserSkills` 的入参。 */
export interface ListUserSkillsOptions {
  /** 会话 cwd（= `registry.dirOf(projectId)`）；缺省则不判项目级冲突。 */
  readonly cwd?: string | undefined
  /** 本项目已装载的 skill 名单（判 `active` 用）；缺省空表。 */
  readonly loaded?: readonly string[]
  /** 内置条目数（随 payload 返回，UI 显示「官方 N · 我的 M」）。 */
  readonly builtinCount?: number
}

/** 目录里的一条用户 skill（未与 catalog 对照前）。 */
interface UserSkillOnDisk {
  readonly slug: string
  readonly file: string
  readonly flat: boolean
}

/** 时间戳（回收站目录名后缀）：`20261016T143012`。 */
function stamp(): string {
  const now = new Date()
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 目标路径必须落在根目录之内（双保险；slug 已保证不含分隔符）。 */
function assertInside(root: string, target: string): string {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  // ⚠️ 必须比 `root + sep`：只比前缀会把 `<root>-evil` 这种同前缀兄弟目录放进来。
  if (!resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error(`[canvas-studio] 拒绝越出 skills 根的路径：${resolvedTarget}`)
  }
  return resolvedTarget
}

/** 枚举用户 skill 落点（目录包 `<slug>/SKILL.md` 与扁平 `<slug>.md` 都收）。 */
async function listOnDisk(root: string): Promise<UserSkillOnDisk[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: UserSkillOnDisk[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const file = join(root, entry.name, ENTRY_FILE)
      try {
        await stat(file)
      } catch {
        continue // 没有 SKILL.md 的目录不是 skill（可能正是写了一半的临时目录）
      }
      found.push({ slug: entry.name, file, flat: false })
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      found.push({ slug: entry.name.slice(0, -3), file: join(root, entry.name), flat: true })
    }
  }
  return found
}

/** 展示字段校验（D7：非法即回落，不拒绝 —— 展示字段不值得挡用户的路）。 */
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

/** 摘要截断（卡片按 2 行显示；与内置条目的 summary 口径一致）。 */
function summarize(description: string): string {
  const text = description.replaceAll(/\s+/gu, ' ').trim()
  return text.length <= 120 ? text : `${text.slice(0, 119)}…`
}

/**
 * 列出用户 skill 并判定每一条的**生效状态**。
 *
 * @param reader - `ctx.skills`（窄接口）。
 * @param options - cwd / 已装载名单 / 内置名字。
 */
export async function listUserSkills(
  reader: SkillCatalogReader,
  options: ListUserSkillsOptions = {},
): Promise<{ items: SkillListItem[]; complete: boolean; builtinCount: number; skillsRoot: string }> {
  const root = userSkillsRoot()
  const onDisk = await listOnDisk(root)
  const loaded = new Set(options.loaded ?? [])

  let catalog: Awaited<ReturnType<SkillCatalogReader['snapshot']>> = { skills: [], complete: true }
  try {
    catalog = await reader.snapshot(options.cwd === undefined ? {} : { cwd: options.cwd })
  } catch {
    // 发现失败不等于「没有」：complete=false 让 UI 显示「扫描中」而不是「导入失败」。
    catalog = { skills: [], complete: false }
  }
  const byName = new Map(catalog.skills.map(entry => [entry.name.toLowerCase(), entry]))

  const items: SkillListItem[] = []
  for (const disk of onDisk) {
    let frontmatter: Record<string, string> = {}
    try {
      frontmatter = parseSkillFrontmatter(await readFile(disk.file, 'utf8'))
    } catch {
      // 读不到正文（权限 / 正好被删）：仍列出来（用户需要知道它存在），字段用 slug 兜底。
    }
    const name = (frontmatter.name ?? disk.slug).trim()
    const entry = byName.get(name.toLowerCase())

    // 三态判定（唯一实现）：先看「catalog 里的赢家是谁」，再看「有没有装载」。
    // 高于 user-dsh 的层（project 100 / project-agents 200 / custom 300 / runtime）
    // 同名时会把这条顶掉，此时 snapshot 里赢家的 source 就不是 user-dsh。
    let status: SkillEffectiveStatus
    let catalogState: SkillCatalogState
    let conflictWith: string | null = null
    if (entry === undefined) {
      // 「还没扫完」与「真的没进目录」必须分开：前者不是失败，标红就是一次假警报。
      catalogState = catalog.complete ? 'missing' : 'unknown'
      status = loaded.has(name) ? 'active' : 'idle'
    } else if (entry.source !== 'user-dsh') {
      catalogState = 'conflict'
      status = 'conflict'
      conflictWith = entry.name
    } else {
      catalogState = 'found'
      status = loaded.has(name) ? 'active' : 'idle'
    }

    items.push({
      name,
      title: frontmatter.title?.trim() ?? name,
      summary: summarize(frontmatter.description ?? ''),
      category: categoryOf(frontmatter.category),
      icon: iconOf(frontmatter.icon),
      origin: 'user',
      slug: disk.slug,
      status,
      catalogState,
      conflictWith,
      modelInvocable: entry?.invocation?.modelInvocable !== false,
    })
  }

  items.sort((a, b) => a.name.localeCompare(b.name))
  return {
    items,
    complete: catalog.complete,
    builtinCount: options.builtinCount ?? 0,
    skillsRoot: root,
  }
}

/** 目录里该 slug 是否已存在（含扁平 `.md` 形态）。 */
async function existsOnDisk(root: string, slug: string): Promise<boolean> {
  for (const candidate of [join(root, slug), join(root, `${slug}.md`)]) {
    try {
      await stat(candidate)
      return true
    } catch {
      // 继续看下一个形态
    }
  }
  return false
}

/**
 * 落盘一份用户 skill。
 *
 * 步骤：建临时目录 → 写全部文件 → `rename` 到目标（原子）；目标已存在且
 * `overwrite` 时，先把旧目录整体移入回收站。
 *
 * @param slug - 已校验的落点目录名。
 * @param files - `validateImport` 归一化后的路径与内容（**唯一事实源**）。
 * @param options - `overwrite`：目标存在时是否覆盖。
 * @throws 目标已存在且未授权覆盖时抛 `CS-SKILL-007` 语义的 Error（由路由转码）。
 */
export async function writeUserSkill(
  slug: string,
  files: readonly NormalizedImportFile[],
  options: { overwrite?: boolean } = {},
): Promise<{ trashedTo: string | null }> {
  if (!isValidSlug(slug)) throw new Error(`[canvas-studio] 非法 slug：${slug}`)
  const root = userSkillsRoot()
  await mkdir(root, { recursive: true, mode: 0o700 })

  const existing = await existsOnDisk(root, slug)
  if (existing && options.overwrite !== true) {
    const conflict = new Error(`[canvas-studio] 目标已存在：${slug}`)
    conflict.name = 'SkillExistsError'
    throw conflict
  }

  let trashedTo: string | null = null
  if (existing) {
    const trash = await trashUserSkill(slug)
    trashedTo = trash.trashedTo
  }

  const incoming = assertInside(root, join(root, `${INCOMING_PREFIX}${stamp()}-${String(Date.now() % 100000)}`))
  await mkdir(incoming, { recursive: true, mode: 0o700 })
  try {
    for (const file of files) {
      const target = assertInside(root, join(incoming, file.path))
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, file.text, { mode: 0o600 })
    }
    await rename(incoming, assertInside(root, join(root, slug)))
  } catch (cause) {
    // 失败不留半份：临时目录整体清掉（它必定在根内，且 slug 未被占用）。
    await rm(incoming, { recursive: true, force: true }).catch(() => {})
    throw cause
  }
  return { trashedTo }
}

/**
 * 把一个用户 skill 移入回收站（D3：**不做物理删除**）。
 *
 * @param slug - 落点目录名（或扁平 `.md` 的文件名去后缀）。
 * @returns 回收站目录的绝对路径（UI 要显示给用户，供手工恢复）。
 */
export async function trashUserSkill(slug: string): Promise<{ trashedTo: string }> {
  if (!isValidSlug(slug)) throw new Error(`[canvas-studio] 非法 slug：${slug}`)
  const root = userSkillsRoot()
  const trashRoot = assertInside(root, join(root, TRASH_DIR))

  // 原始形态可能是目录包或扁平 `.md`，逐个试（只动真实存在的那个）。
  const candidates = [join(root, slug), join(root, `${slug}.md`)]
  let source: string | null = null
  for (const candidate of candidates) {
    try {
      await stat(candidate)
      source = candidate
      break
    } catch {
      // 试下一个
    }
  }
  if (source === null) throw new Error(`[canvas-studio] 目标不存在：${slug}`)

  await mkdir(trashRoot, { recursive: true, mode: 0o700 })
  const target = assertInside(root, join(trashRoot, `${slug}-${stamp()}`))
  await rename(assertInside(root, source), target)
  return { trashedTo: target }
}

/** 清空回收站（用户显式动作；这一步才是真删除）。 */
export async function emptySkillTrash(): Promise<{ removed: number }> {
  const trashRoot = join(userSkillsRoot(), TRASH_DIR)
  let entries: Dirent[]
  try {
    entries = await readdir(trashRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: 0 }
    throw error
  }
  let removed = 0
  for (const entry of entries) {
    await rm(assertInside(trashRoot, join(trashRoot, entry.name)), { recursive: true, force: true })
    removed += 1
  }
  return { removed }
}

/**
 * 统计有多少个项目装载过某个 skill（删除前如实告知，**不自动改** `skills.json`）。
 *
 * 那份清单是**项目自己的事实**：删除全局 skill 不等于用户想让某个项目忘掉它
 * （他可能马上会重新导入同名的）。自动清理等于替用户做决定，且不可撤销。
 */
export async function countProjectsLoadingSkill(
  roster: ProjectRosterReader,
  name: string,
): Promise<number> {
  let projects: readonly { readonly id: string }[]
  try {
    projects = await roster.list()
  } catch {
    return 0
  }
  let count = 0
  for (const project of projects) {
    try {
      const skills = await roster.readActiveSkills(project.id)
      if (skills.includes(name)) count += 1
    } catch {
      // 单个项目读不到不影响统计其他项目
    }
  }
  return count
}

/** 回收站里的条目数（UI 的「回收站」入口角标；失败按 0）。 */
export async function trashEntryCount(): Promise<number> {
  try {
    const entries = await readdir(join(userSkillsRoot(), TRASH_DIR), { withFileTypes: true })
    return entries.length
  } catch {
    return 0
  }
}

/** 一条用户 skill 的展示摘要（供**激活集注入**用：让模型知道用户勾的这条是干什么的）。 */
export interface UserSkillDigest {
  readonly title: string
  readonly summary: string
}

/**
 * 枚举本机用户 skill 的**展示摘要**（注册名 → 标题 / 摘要）。
 *
 * ## 为什么需要它（CV-332 的一个真实缺口）
 *
 * 激活集注入（`active-skills-prompt.ts`，order 154）此前只用 `getSkillEntry()` 取标签，
 * 而那个函数查的是**编译期内置 catalog** —— 用户的 skill 不在其中。于是用户把
 * 自己导入的 skill 装载进项目后，模型读到的清单是：
 *
 * ```
 * - `my-noir-rules` —— （catalog 无此条目，可能是项目里残留的旧记录）
 * ```
 *
 * 即**模型被告知用户自己的技能是残留垃圾**，而注入这条链路的目的恰恰是让
 * 「用户选了什么」成为模型可见的事实。本函数补上第二档事实源：内置查 catalog、
 * 用户查这个目录，两者都查不到才归为残留。
 *
 * @returns 注册名 → 摘要；目录不存在或全部读失败时返回空表（调用方回落残留文案）。
 */
export async function userSkillDigests(): Promise<Map<string, UserSkillDigest>> {
  const out = new Map<string, UserSkillDigest>()
  let onDisk: UserSkillOnDisk[]
  try {
    onDisk = await listOnDisk(userSkillsRoot())
  } catch {
    return out
  }
  for (const disk of onDisk) {
    try {
      const frontmatter = parseSkillFrontmatter(await readFile(disk.file, 'utf8'))
      const name = (frontmatter.name ?? disk.slug).trim()
      if (name === '') continue
      out.set(name, {
        title: frontmatter.title?.trim() ?? name,
        summary: summarize(frontmatter.description ?? ''),
      })
    } catch {
      // 读不到正文的那条不进表（激活集清单宁可少一行，也不要塞一条空摘要）
    }
  }
  return out
}

/** 相对 `<slug>/` 的落盘路径清单（导入完成页展示用）。 */
export function relativePathsOf(files: readonly NormalizedImportFile[]): string[] {
  return files.map(file => file.path)
}

/**
 * 读某个 slug 的**注册名**（frontmatter `name`，读不到回落 slug）。
 *
 * 删除前统计「有多少个项目装载过它」需要注册名 —— `skills.json` 里存的是注册名，
 * 而目录名与注册名**可以不同**（上游不对齐它们，我们也只警告不拒绝）。
 */
export async function skillNameOfSlug(slug: string): Promise<string | null> {
  if (!isValidSlug(slug)) return null
  const root = userSkillsRoot()
  for (const file of [join(root, slug, ENTRY_FILE), join(root, `${slug}.md`)]) {
    try {
      const frontmatter = parseSkillFrontmatter(await readFile(file, 'utf8'))
      return (frontmatter.name ?? slug).trim()
    } catch {
      // 试下一个形态
    }
  }
  return null
}
