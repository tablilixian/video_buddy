/**
 * CV-325 → CV-331：用户上传 skill 的**契约与校验**（只开放知识型；**不参与槽位绑定**）。
 *
 * ## 这一版改了什么（P3 拍板的直接推论）
 *
 * 原版（CV-325）的语义是「**槽位绑定**」：`slot` 必填，`validateUpload(fm, owners)`
 * 判断该槽位是否被内置占用，占用则 `bound:false`（入库但不生效，内置优先）。
 *
 * 该语义在实践中**两个分支都落不到正常态**：
 *
 * 1. 注入正确 `owners` 时：`UPLOAD_SLOTS` 的 6 个槽位与 `toolchain.md` 的能力槽位
 *    绑定表**逐字重叠，且 6 个全部已被内置占用** ⇒ 任何合法上传必然 `bound:false`
 *    —— 上传功能做完后用户 100% 用不上（**槽位死锁**）。
 * 2. 不注入 `owners` 时（默认 `{}`）：视为「未占用」⇒ `bound:true` ⇒ **fail-open**，
 *    用户 skill 静默顶掉内置（**一次绑定表读取失败 = 让出内置槽位**）。
 *
 * CV-331 按拍板 P3 改为：**用户 skill 不参与槽位绑定**。`slot` 从「绑定输入」
 * 降级为「**展示标签**」——
 *
 * - **可选**：不写照样入库；
 * - 给了就必须是**已知槽位**（拦住 `vedio-prompt` 这类拼写错误），但**只产建议、
 *   不影响 `ok`**；
 * - `bound` 字段与「`owners` 影响判定」**一并删除** ⇒ 死锁与 fail-open 同时消失
 *   （不再存在「默认参数导致行为翻转」这条路径）。
 *
 * 用户 skill 的生效路径因此改为 **catalog（上游 provider 自动发现）+ 激活集装载**
 * （CV-323 的 `skills.json` → order 154 注入），与内置 skill 在装载上**完全同权**。
 *
 * ## 与 `toolchain.md` 的关系（同源，但不参与判定）
 *
 * `UPLOAD_SLOTS` 仍与绑定表同源，用途只剩两个：① 校验用户写的 slot 拼写；
 * ② 在提示里点名「这个槽位已有内置实现 XX」——让用户知道为什么**不绑定**。
 * 加载路由仍由 `toolchain.md` 那张表决定，本模块不产生第二份事实源。
 *
 * ## 两条不可协商的规则（CV-325 起，未变）
 *
 * 1. **只接受知识型**（D1 拍板）。`role` 缺失或不是 `knowledge` 一律拒绝。
 *    决策型 skill（编排 / 导演型）由平台掌控，开放上传会重新引入决策打架。
 * 2. **内置优先**（改由「不绑定」实现，而不是「绑定但 bound:false」）。用户 skill
 *    与内置同名时内置赢（用户级 rank 400 输给 bundled 600）：平台仍知道装的是谁，
 *    装机行为不受用户干扰。
 */

/**
 * 与 `toolchain.md` 能力槽位绑定表**同源**的 6 个槽位。
 *
 * 仅用于「校验拼写 + 提示该槽位已归属谁」，**不再决定绑定**（CV-331）。
 */
export const UPLOAD_SLOTS = [
  'video-prompt', 'image-t2i', 'image-edit',
  'audio-music', 'audio-voice', 'camera-language',
] as const

export type UploadSlot = (typeof UPLOAD_SLOTS)[number]

/**
 * 非绑定类槽位：与 `skill-catalog.ts` 的 `PLATFORM_SLOTS` 尾部一致。
 *
 * 必须收进合法集：`general` 是**最主流的写法** —— 22 个内置 `platform.yaml` 里
 * 17 个用 `slot: "general"`。用户照抄任意内置 skill 的写法时最可能写的就是它，
 * 若只认绑定表 6 值，用户会被自己的「照抄」拒之门外。
 */
export const GENERAL_SLOTS = ['orchestration', 'general'] as const

/** `slot` 的合法取值全集（= 绑定表 6 值 ∪ 通用 2 值）。 */
export const KNOWN_SLOTS = [...UPLOAD_SLOTS, ...GENERAL_SLOTS] as const

/** 第一阶段唯一接受的 role（D1 拍板）。 */
export const UPLOADABLE_ROLE = 'knowledge'

/**
 * 内置槽位占用表：`槽位 → 内置 skill 名`。
 *
 * 复用 `toolchain.md` §能力槽位绑定表的同一份事实，由调用方注入，
 * 本模块不自己维护第二份（双份必然漂移 —— 那正是 CV-324 要消灭的东西）。
 *
 * ⚠️ CV-331 后它**只影响提示文案**，不再影响 `ok` / 不再产生 fail-open。
 */
export type BuiltinSlotOwners = Readonly<Partial<Record<UploadSlot, string>>>

/** 上传契约层可能产出的错误码（与 `errors/catalog.ts` 的 `CS-SKILL-*` 一一对应）。 */
export type SkillUploadErrorCode =
  | 'CS-SKILL-001' | 'CS-SKILL-002' | 'CS-SKILL-003' | 'CS-SKILL-004'
  | 'CS-SKILL-005' | 'CS-SKILL-006' | 'CS-SKILL-007'

/**
 * 一条**建议**（advisory）：不影响「能不能导入」，只影响「导入后会发生什么」。
 *
 * 与 `ok:false` 的分野是本仓一贯的「拒绝 vs 警告」：能让用户改的（拼写、
 * 缺字段）才拒绝；只能告知的（内置同名、模型看不见）一律警告 + 说清后果。
 */
export type UploadAdvisory =
  /** 与内置或已有用户条目同名 ⇒ 内置/先来的赢，本条不会生效。 */
  | { kind: 'name-collision'; with: string }
  /** 声明的槽位已有内置实现 ⇒ 仅提示归属，不影响加载（CV-331 后不再「绑定」）。 */
  | { kind: 'slot-occupied'; slot: string; owner: string }
  /** 声明的是通用槽位（general / orchestration）⇒ 不代表任何能力绑定。 */
  | { kind: 'slot-general'; slot: string }
  /** `disable-model-invocation: true` ⇒ 模型永远看不到，等于装了不生效。 */
  | { kind: 'model-hidden' }
  /** 正文出现「自设审批门」表述 ⇒ 不生效（总纲安全协议第 5 条已预写死）。 */
  | { kind: 'approval-gate-in-body' }
  /** 物理目录名与 frontmatter `name` 不一致 ⇒ 不报错，但会让人困惑。 */
  | { kind: 'dir-name-mismatch'; dir: string }
  /** 根级多余 `.md`（会被上游当独立 skill 试解析）⇒ 已自动归位 `references/`。 */
  | { kind: 'root-md-relocated'; files: readonly string[] }
  /** 二进制文件未上传（D6）⇒ 跳过并提示，不算失败。 */
  | { kind: 'binary-skipped'; files: readonly string[] }

export type UploadVerdict =
  | {
    ok: true
    /** 面向用户的一句话说明（入库成功也要说清「生效 / 暂不生效」及原因）。 */
    note: string
    /** 0 条 = 完全干净。 */
    advisories: UploadAdvisory[]
  }
  | {
    ok: false
    /** 用户可见的拒绝原因（要说清「怎么改」）。 */
    reason: string
    /** 与原因对应的错误码（登记在 `errors/catalog.ts`）。 */
    code: SkillUploadErrorCode
    /** 拒绝前已发现的建议（UI 一并显示，让用户看到「还差哪一步」）。 */
    advisories: UploadAdvisory[]
  }

/** `validateUpload` 的上下文（全部可选；缺省即「什么都没有」，不产生假判定）。 */
export interface UploadContext {
  /** 内置槽位占用表。⚠️ 只影响 `slot-occupied` 提示，不影响 `ok`（CV-331）。 */
  readonly owners?: BuiltinSlotOwners
  /** 已占用的注册名（内置 catalog ∪ 已有用户条目），用于 `name-collision`。 */
  readonly takenNames?: readonly string[]
  /** 物理目录名（导入时已知），用于 `dir-name-mismatch`；扁平 `.md` 传文件名去后缀。 */
  readonly dirName?: string
}

/**
 * 上游对**驼峰遗留键**直接抛错（`skill-filesystem/src/index.ts:993-995`
 * `rejectLegacyInvocationKey` → `throw new Error(...)`），被上层吞掉后**整条丢弃**。
 * 照抄旧文档/旧示例最容易踩这个 —— 必须在导入前拦下并教正确写法。
 */
const LEGACY_INVOCATION_KEYS: readonly string[] = [
  'disableModelInvocation', 'modelInvocable', 'userInvocable',
]

/** 用户 skill 的 slug（目录名）规则：2~64 字符，小写字母/数字/连字符。 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/u

/** 保留名（`.system` 被上游 `skipSystem` 跳过；`.trash` 是应用内回收站）。 */
export const RESERVED_SLUGS: readonly string[] = ['.system', '.trash']

/** slug 是否合法（唯一判据，Host 路由与导入校验共用）。 */
export function isValidSlug(slug: string): boolean {
  if (slug === '' || RESERVED_SLUGS.includes(slug)) return false
  return SLUG_PATTERN.test(slug)
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 *
 * 只支持本仓用到的扁平 `key: value` 形态（**不引 YAML 依赖**——为一个 3 行解析器
 * 加依赖不划算）。数组、行内对象、多行值一律解析不出来，因此不可能误吞结构化字段。
 *
 * ⚠️ 上游用的是**完整 YAML**，这里是**子集**。判据差异只允许出现在「展示字段」
 * （`category` / `icon` / `role` / `slot`）：`name` / `description` 是否合法必须
 * 以上游为唯一事实源（做法是导入后回读上游 catalog 确认条目真的出现）。
 *
 * @returns 键 → 去首尾空白的原始值；无 frontmatter 或缺 `---` 围栏时返回空表。
 */
export function parseSkillFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)
  if (!match) return {}
  const body = match[1]
  if (body === undefined) return {}
  const out: Record<string, string> = {}
  for (const line of body.split(/\r?\n/u)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line)
    const key = kv?.[1]
    const value = kv?.[2]
    if (key !== undefined && value !== undefined) out[key] = value.trim()
  }
  return out
}

/** 「自设审批门」表述（与 CV-322 对内门禁同口径：只警告、不拒绝）。 */
const APPROVAL_GATE_PATTERN = /审批门|审批闸|审批关卡|approval\s*gate/iu

/**
 * 生成 `bound` 时代的过渡提示：槽位归属说明。
 *
 * @param slot - 用户声明的槽位（已在合法集内）。
 * @param owners - 内置占用表（可能为空表 = 拿不到事实）。
 */
function slotAdvisories(slot: string, owners: BuiltinSlotOwners): UploadAdvisory[] {
  if ((GENERAL_SLOTS as readonly string[]).includes(slot)) {
    return [{ kind: 'slot-general', slot }]
  }
  const owner = owners[slot as UploadSlot]
  // 拿不到占用表时不猜：宁可少一条提示，也不假报「这个槽位没人占」。
  return owner === undefined ? [] : [{ kind: 'slot-occupied', slot, owner }]
}

/**
 * 校验一份待上传 skill 的 frontmatter，产出**唯一判据**。
 *
 * 真接上传端点时，端点只应调用本函数并把 verdict 原样回给用户；
 * 规则不在端点里再写第二遍，也不靠模型自觉。
 *
 * 判定顺序（先硬后软，第一个不合规即返回）：
 * ① 驼峰遗留键 → ② `role` 缺失/非知识型 → ③ `name` 缺失 → ④ `description` 缺失
 * → ⑤ `name` 取值不合法 → ⑥ `slot` 给了但不认识 → ⑦ 全部通过，收集 advisories。
 *
 * @param frontmatter - `parseSkillFrontmatter` 的结果。
 * @param context - 可选上下文（占用表 / 已占名 / 目录名）；缺省不影响 `ok`。
 */
export function validateUpload(
  frontmatter: Readonly<Record<string, string>>,
  context: UploadContext = {},
): UploadVerdict {
  // ① 驼峰遗留键：上游见即抛错丢整条，必须先拦（否则用户会看到「导入成功但广场没东西」）。
  for (const legacy of LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(frontmatter, legacy)) {
      const canonical = legacy === 'modelInvocable'
        ? 'disable-model-invocation'
        : legacy === 'userInvocable' ? 'user-invocable' : 'disable-model-invocation'
      return {
        ok: false,
        advisories: [],
        code: 'CS-SKILL-005',
        reason: `frontmatter 里的 \`${legacy}\` 是**已废弃的驼峰写法**，上游会直接丢弃整条 skill。`
          + `请改用中划线写法 \`${canonical}: false\`。`,
      }
    }
  }

  // ② role：第一阶段只开放知识型（D1 拍板，不可协商）。
  const role = frontmatter.role
  if (role === undefined || role.trim() === '') {
    return {
      ok: false,
      advisories: [],
      code: 'CS-SKILL-003',
      reason: `缺少 \`role\` 声明。第一阶段只开放知识型 skill，frontmatter 必须写 \`role: ${UPLOADABLE_ROLE}\`。`,
    }
  }
  if (role !== UPLOADABLE_ROLE) {
    return {
      ok: false,
      advisories: [],
      code: 'CS-SKILL-003',
      reason: `\`role: ${role}\` 不被接受。第一阶段只开放知识型（\`role: ${UPLOADABLE_ROLE}\`）——`
        + '编排与导演型（决策型）skill 由平台掌控，开放上传会让多个决策型同时激活而互相打架。',
    }
  }

  // ③ name：上游注册名与去重键，缺则整条忽略（`skill-filesystem/src/index.ts:810`）。
  const name = frontmatter.name
  if (name === undefined || name.trim() === '') {
    return {
      ok: false,
      advisories: [],
      code: 'CS-SKILL-002',
      reason: '缺少 `name` 声明。它是 skill 的注册名与去重键，上游缺它会把整条 skill 忽略掉。',
    }
  }
  // ④ description：进 catalog 的唯一路由依据，上游超长截断 500。
  // ⚠️ 必须排在「name 取值」（⑤）**之前**：判定顺序是「缺字段（002）先于取值非法（004）」
  // —— 先让用户补齐没填的，再让他改填错的，一次只面对一类问题。
  const description = frontmatter.description
  if (description === undefined || description.trim() === '') {
    return {
      ok: false,
      advisories: [],
      code: 'CS-SKILL-002',
      reason: '缺少 `description` 声明。它是模型在 catalog 里选中该 skill 的**唯一依据**（且上游按 500 字符截断）。',
    }
  }

  // ⑤ name 取值：格式不合法同样整条丢弃（上游不报错也不提示）。
  if (!SLUG_PATTERN.test(name.trim())) {
    return {
      ok: false,
      advisories: [],
      code: 'CS-SKILL-004',
      reason: `\`name: ${name}\` 不合法。注册名必须是小写 kebab-case（2~64 字符，小写字母/数字/连字符，`
        + '如 `night-noir-lighting`）—— 上游对非法命名**整条丢弃**，不会报错也不会提示。',
    }
  }

  // ⑥ slot：可选（CV-331）。给了就必须认识 —— 拦住拼写错误，但不影响能否导入。
  const slot = frontmatter.slot?.trim()
  if (slot !== undefined && slot !== '' && !(KNOWN_SLOTS as readonly string[]).includes(slot)) {
    return {
      ok: false,
      advisories: [],
      code: 'CS-SKILL-004',
      reason: `\`slot: ${slot}\` 不是已知槽位。合法值：${KNOWN_SLOTS.join(' / ')}。`
        + '若不确定，直接**不写 `slot`** 即可 —— 它只影响展示标签，不影响 skill 生效。',
    }
  }

  // ⑥ 通过：收集 advisory（每一条都能独立解释，不做「一条汇总」的含糊提示）。
  const advisories: UploadAdvisory[] = []
  if (slot !== undefined && slot !== '') advisories.push(...slotAdvisories(slot, context.owners ?? {}))

  const taken = context.takenNames ?? []
  const winner = taken.find(entry => entry.toLowerCase() === name.trim().toLowerCase())
  if (winner !== undefined) advisories.push({ kind: 'name-collision', with: winner })

  if (frontmatter['disable-model-invocation'] === 'true') advisories.push({ kind: 'model-hidden' })

  const dir = context.dirName
  if (dir !== undefined && dir !== '' && dir !== name.trim()) {
    advisories.push({ kind: 'dir-name-mismatch', dir })
  }

  return {
    ok: true,
    note: advisories.length === 0
      ? `已导入 \`${name.trim()}\`。它已进入模型可用列表，在广场里点「装载」后本项目的任务会按它写。`
      : `已导入 \`${name.trim()}\`，但有 ${String(advisories.length)} 条需要你知道的提示（见下方清单）。`,
    advisories,
  }
}

/**
 * 扫描 skill 正文，产出「说了也不生效」一类的 advisory（CV-331 起由调用方在
 * 拿到文件正文后调用；`validateUpload` 只吃 frontmatter，不看正文）。
 */
export function bodyAdvisories(body: string): UploadAdvisory[] {
  return APPROVAL_GATE_PATTERN.test(body) ? [{ kind: 'approval-gate-in-body' }] : []
}

/** advisory → 一句用户可读的话（UI 与测试共用同一份文案，避免两处措辞漂移）。 */
export function advisoryText(advisory: UploadAdvisory): string {
  switch (advisory.kind) {
    case 'name-collision':
      return `已存在同名 skill \`${advisory.with}\`。同名时**内置/先来的优先**，你的这条不会生效；`
        + '改 `frontmatter.name` 后重传即可（物理目录名建议同步改，但它不是生效判据）。'
    case 'slot-occupied':
      return `槽位 \`${advisory.slot}\` 已有内置实现 \`${advisory.owner}\`。用户 skill **不参与槽位绑定**，`
        + '这条只作展示标签 —— 不影响你的 skill 被模型看到与装载。'
    case 'slot-general':
      return `\`slot: ${advisory.slot}\` 是通用槽位，不代表任何能力绑定（内置 skill 里最常见的就是它）。`
    case 'model-hidden':
      return '`disable-model-invocation: true` ⇒ **模型永远看不到它**，等于装了不生效。'
        + '除非你只想手动 `skill(name=…)` 调用，否则删掉这一行。'
    case 'approval-gate-in-body':
      return '正文里出现了「审批门」类表述。用户 skill **不得声明流程与审批语义**（总纲安全协议第 5 条已预写死），'
        + '这类措辞不会生效 —— 不影响导入。'
    case 'dir-name-mismatch':
      return `物理目录名 \`${advisory.dir}\` 与 frontmatter \`name\` 不一致。不报错，但会让人困惑。`
    case 'root-md-relocated':
      return `目录根级有额外的 .md（${advisory.files.join('、')}）：上游会把根级任意 .md 当独立 skill 试解析，`
        + '已自动移入 `references/`（不影响正常读取）。'
    case 'binary-skipped':
      return `已跳过非文本文件（${advisory.files.join('、')}）：用户 skill 只接受文本格式（md / txt / json / yaml / yml）。`
  }
}
