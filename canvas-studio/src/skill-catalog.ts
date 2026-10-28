/**
 * 技能广场客户端元数据（CV-065 Phase B）。
 *
 * ## 单一事实源 = `skills/<name>/platform.yaml`（CV-324）
 *
 * 展示元数据（name/title/summary/category/icon/hue/featured/demo/h3/stage/hidden
 * + role/slot）每个 skill 一份，落在它自己的目录里。新增一个 skill 的扩展税因此
 * 从 4 处降到 1 处：建目录写 SKILL.md + platform.yaml 即可，catalog 自动出现
 * （旧机制漏补表不会红，只是 skill 在广场里静默消失 —— 这正是要消灭的故障）。
 *
 * 之所以不放 SKILL.md frontmatter：上游 skill 严禁改编
 * （skill-expansion-spec.md 第 1 条）—— 不能往 H3 原版 SKILL.md 里塞
 * category / icon / 中文标题。
 *
 * ## `meta.yaml` 与 `platform.yaml` 的职责边界（两者互不相干）
 *
 * | | `meta.yaml` | `platform.yaml` |
 * |---|---|---|
 * | 是什么 | **上游 MiniMax-H3 署名**：author / source / version | **平台展示元数据**：卡片、分轴、槽位 |
 * | 谁写 | 上游导入时带入，**一个字节都不许动** | 平台自己维护 |
 * | 存在性 | **可选**，只在上游来源的 skill 上存在（本仓自研 skill 没有） | **必需**，每个 skill 都要有 |
 * | 为什么不能混 | 它是署名的唯一载体，且「第三方许可全文入库」仍是未关闭待办（见 STATUS.md）；往里塞平台字段等于污染上游署名 | `tests/skills-single-source.test.mjs` 的 8 条 `UPSTREAM_META` 断言守着前者，`tests/skill-platform-meta.test.mjs` 守着后者不越界 |
 *
 * **「用户上传的 skill 只有 `platform.yaml`、没有 `meta.yaml`」是合法态** ——
 * 用户上传的 skill 本就没有上游来源，自然没有上游署名；反过来，
 * `platform.yaml` 缺失才是真问题（测试直接红）。
 *
 * ## 为什么本文件里还留着一份内嵌快照 `BUNDLED_CATALOG`
 *
 * 因为广场 UI 跑在**渲染器**里，而渲染器没有文件系统：Electron 窗口是
 * `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`
 * （dsh-plugin-desktop/src/window-options.ts），`src/client/index.ts` 与
 * `StudioFrame.tsx` 又是按**值** import 本模块的（`VISIBLE_CATALOG` /
 * `recommendedSkills`），所以展示元数据必须随 bundle 一起进浏览器。
 *
 * 因此这里有两条读法，且**不允许它们分叉**：
 * - 有 fs 的上下文（Host 进程、单测、`scripts/preview-lobby.mjs`）→ 直接读
 *   `skills/<name>/platform.yaml`，单一事实源真的在运行时生效；
 * - 渲染器（无 `process`）→ 用内嵌快照。
 *
 * 防分叉靠门禁而不是靠自觉：`tests/skill-platform-meta.test.mjs` 断言快照与
 * `platform.yaml` 逐字段深相等，忘了同步快照直接红。
 *
 * 两条实现上的硬约束（都踩过，记在这里免得再犯）：
 * - **本文件不得静态 import 任何 `node:*`**。tsdown 以 `platform: 'browser'`
 *   打包渲染器，静态 import 会被 externalize 成 bundle 里的
 *   `require("node:fs")`，`scripts/verify-client-loader.mjs` 的 factory 执行层
 *   守卫当场抛错（实测复现）。fs 因此走 `globalThis.process.getBuiltinModule`
 *   运行时取；路径用 `new URL('../skills/', import.meta.url)`，也不用 `node:url`。
 * - **不引入 YAML 解析依赖**。`platform.yaml` 是扁平标量表，本文件内置一个
 *   ~20 行的最小解析器（同 `src/skills/minimax-skills.ts` 的 `parseFrontmatter`
 *   先例：不为了读 frontmatter 装一个 yaml 包）。测试复用同一个解析器，
 *   避免「同一规则写第二份」漂移。
 *
 * 放 src/ 根目录而非 src/client/ —— Host tsconfig 排除了 src/client/**，
 * 单测要直连编译产物 lib/skill-catalog.js。
 */

/** 广场侧栏分类（顺序即展示顺序）。 */
export const SKILL_CATEGORY_IDS = ['spec', 'prompting', 'marketing', 'style', 'audio', 'other'] as const

export type SkillCategoryId = (typeof SKILL_CATEGORY_IDS)[number]

/** 分类中文名。 */
export const SKILL_CATEGORY_LABELS: Record<SkillCategoryId, string> = {
  spec: '创作规范',
  prompting: '提示词技术',
  marketing: '营销广告',
  style: '视频风格',
  audio: '字幕配乐',
  other: '未分类',
}

/** 卡片图标 id（由 client 侧 SkillIcon 组件映射为 inline SVG）。 */
export const SKILL_ICON_IDS = ['compass', 'quill', 'megaphone', 'film', 'music', 'puzzle'] as const

export type SkillIconId = (typeof SKILL_ICON_IDS)[number]

export interface SkillCatalogEntry {
  /** skill 注册名（与 skills/<name>/ 目录名逐字一致）。 */
  name: string
  /** 卡片中文标题。 */
  title: string
  /** 卡片一句话说明（≤ 60 字，UI 按 2 行截断）。 */
  summary: string
  category: SkillCategoryId
  icon: SkillIconId
  /** 缩略图与强调色色相（0-360）；UI 用 hsl() 现算，明暗主题自适应。 */
  hue: number
  /** 是否进 lobby「推荐技能」横滚。 */
  featured: boolean
  /**
   * CV-070：动态预览 GIF 文件名（assets/style-demos/<demo>，webServer 路由
   * /canvas-studio/style-demos/<demo> 托管）。hover 懒加载；缺省回退静态渐变。
   */
  demo?: string
  /** CV-076：是否基于 H3 技术路线（卡片左上角 H3 badge，真实信息）。 */
  h3?: boolean
  /**
   * CV-093：是否在技能广场 / lobby 推荐横滚 / 分类角标中隐藏。
   * 隐藏的条目仍能被项目激活、在「我的 Skill」中管理、通过 name 使用。
   */
  hidden?: boolean
  /**
   * CV-118：生命周期阶段。此前 hidden 一个布尔混了两种语义，这里拆开。
   * 2026-09-09 语义修订：可见性与生命周期**彻底正交**——preview 技能可以
   * 上广场（带「试跑」角标，如 oriental-mythic），也可 hidden（仅对话可用）。
   *  - 'ga'      已上线（缺省值，不写即视为 ga）
   *  - 'preview' 试跑期：功能可用但未转正；广场可见时 UI 标「试跑」角标
   *
   * 于是组合各归其位：
   *  - 都不写                → 普通广场技能
   *  - 只 hidden（无 stage）  → 技术类永久隐藏（总纲 / 提示词技术），属分类维度
   *  - 只 preview            → 试跑期且广场可见（角标标注非正式状态）
   *  - hidden + preview      → 试跑期且广场不可见（仅澄清/点名可用）
   *  - ga 不得 hidden（已上线还隐藏是矛盾态，测试守卫）
   */
  stage?: 'ga' | 'preview'
}

/** `platform.yaml` 的 `role` 取值（CV-324 引入，CV-325 放开上传时消费）。 */
export const PLATFORM_ROLES = ['knowledge', 'decision'] as const

export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/**
 * `platform.yaml` 的 `slot` 取值：6 个能力槽位 + 编排 + 通用。
 *
 * 前 6 个与 `skills/canvas-studio-creation/references/toolchain.md` 的
 * 「能力槽位绑定表」一一对应（知识型 skill 专属，一个槽位至多一个实现）；
 * `orchestration` 是总纲；`general` 容纳决策型与无明显归属者。
 */
export const PLATFORM_SLOTS = [
  'video-prompt',
  'image-t2i',
  'image-edit',
  'audio-music',
  'audio-voice',
  'camera-language',
  'orchestration',
  'general',
] as const

export type PlatformSlot = (typeof PLATFORM_SLOTS)[number]

/** `platform.yaml` 解析后的标量取值域（扁平表，无嵌套/数组）。 */
type PlatformValue = string | number | boolean

/** 单个 `platform.yaml` 的解析结果。 */
export type PlatformRecord = Readonly<Record<string, PlatformValue>>

/**
 * 解析结果（成功带值，失败带原因）。
 *
 * 本模块不抛错：`src/**` 禁裸抛，而渲染器还要按值 import 本模块，
 * 不能为了加载期校验把 error-system 拖进浏览器 bundle。
 */
export type PlatformResult<T> = { ok: true; value: T } | { ok: false; reason: string }

const PLATFORM_KEY_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/

function platformScalar(raw: string): PlatformValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+$/.test(raw)) return Number(raw)
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(.)/g, (_match, escaped: string) => escaped)
  }
  return raw
}

/**
 * 解析一个 `platform.yaml`（扁平标量表）。
 *
 * 契约故意窄：`key: value` 一行一个字段，值是字符串 / 整数 / 布尔。
 * 遇到嵌套块、数组、多行标量或重复键一律**判为失败**而不是猜 —— 猜错的静默解析
 * 会把「展示字段写歪」变成「广场上少一张卡」，正是本文件要消灭的故障模式。
 *
 * 返回结果对象而**不抛错**：`src/**` 禁裸抛（`tests/error-system-guards.test.mjs`），
 * 而本模块被渲染器按值 import，不能为了一个加载期校验把 error-system 拖进浏览器
 * bundle。失败由调用方决定怎么办（这里是 warn + 退回快照，测试里是直接变红）。
 *
 * @param text - 文件内容。
 * @param source - 失败原因里显示的来源标识（如 `skills/h3-prompt-writing/platform.yaml`）。
 */
export function parsePlatformYaml(text: string, source = 'platform.yaml'): PlatformResult<PlatformRecord> {
  const record: Record<string, PlatformValue> = {}
  const lines = text.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = PLATFORM_KEY_LINE.exec(trimmed)
    const key = match?.[1]
    if (match === null || key === undefined) {
      return {
        ok: false,
        reason:
          `${source}:${String(index + 1)} 不是合法的 \`key: value\` 字段行` +
          `（platform.yaml 只支持扁平标量，不支持嵌套/数组/多行块）：${line}`,
      }
    }
    if (key in record) return { ok: false, reason: `${source}:${String(index + 1)} 字段重复：${key}` }
    record[key] = platformScalar((match[2] ?? '').trim())
  }
  return { ok: true, value: record }
}

/**
 * 一条 `platform.yaml` → 一条广场条目。
 *
 * 取值域（category/icon/stage 在不在声明集合内、role/slot 合不合法）由
 * `tests/skill-platform-meta.test.mjs` 断言；这里只挡「字段缺失或类型不对」，
 * 因为那类错会让广场静默变形。
 *
 * `role` / `slot` **不进** `SkillCatalogEntry`：它们是分册绑定与上传治理的
 * 契约字段，广场 UI 用不到（CV-323/325 才消费），故不污染现有类型与消费方。
 */
function toCatalogEntry(record: PlatformRecord, source: string): PlatformResult<SkillCatalogEntry> {
  const problems: string[] = []
  const str = (key: string): string => {
    const value = record[key]
    if (typeof value !== 'string') {
      problems.push(`${key} 缺失或不是字符串（读到 ${String(value)}）`)
      return ''
    }
    return value
  }
  const int = (key: string): number => {
    const value = record[key]
    if (typeof value !== 'number') {
      problems.push(`${key} 缺失或不是整数（读到 ${String(value)}）`)
      return 0
    }
    return value
  }
  const bool = (key: string): boolean => {
    const value = record[key]
    if (typeof value !== 'boolean') {
      problems.push(`${key} 缺失或不是布尔（读到 ${String(value)}）`)
      return false
    }
    return value
  }

  const name = str('name')
  const title = str('title')
  const summary = str('summary')
  const category = str('category') as SkillCategoryId
  const icon = str('icon') as SkillIconId
  const hue = int('hue')
  const featured = bool('featured')
  if (problems.length > 0) return { ok: false, reason: `${source}: ${problems.join('；')}` }

  const entry: SkillCatalogEntry = { name, title, summary, category, icon, hue, featured }
  // `exactOptionalPropertyTypes` 下可选字段只能「不写」，不能写 undefined ——
  // 少写一个键与 platform.yaml 里不写这个键等价。
  if (typeof record.demo === 'string') entry.demo = record.demo
  if (typeof record.h3 === 'boolean') entry.h3 = record.h3
  if (record.stage === 'ga' || record.stage === 'preview') entry.stage = record.stage
  if (typeof record.hidden === 'boolean') entry.hidden = record.hidden
  return { ok: true, value: entry }
}

/** Node 内建 fs 的最小子集（运行时取用，不静态 import —— 见文件头）。 */
interface NodeFsSubset {
  existsSync(path: string | URL): boolean
  readdirSync(path: string | URL, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>
  readFileSync(path: string | URL, encoding: 'utf8'): string
}

/**
 * 取 Node 内建 fs；渲染器里返回 null。
 *
 * 走 `globalThis.process.getBuiltinModule`（Node ≥22.3）而不是
 * `import { readFileSync } from 'node:fs'`：后者会被 tsdown 以
 * `platform: 'browser'` externalize 成 bundle 里的 `require("node:fs")`，
 * 渲染器没有它，`verify:loader` 的 factory 执行层守卫当场抛错。
 * 必须是 `globalThis.process` —— 渲染器里裸 `process` 是 ReferenceError。
 */
function nodeFs(): NodeFsSubset | null {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: 'fs') => unknown } }).process
  const fs = proc?.getBuiltinModule?.('fs')
  return fs == null ? null : (fs as NodeFsSubset)
}

/** 广场展示顺序 = 快照登记顺序；未登记的名字不丢，追加到末尾按字母序。 */
function orderEntries(entries: readonly SkillCatalogEntry[]): readonly SkillCatalogEntry[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const ordered: SkillCatalogEntry[] = []
  for (const name of CATALOG_ORDER) {
    const entry = byName.get(name)
    if (entry === undefined) continue
    ordered.push(entry)
    byName.delete(name)
  }
  // 磁盘上多出来的 skill（新增、用户上传）一律保留 —— 顺序可以后调，消失不行。
  for (const name of [...byName.keys()].sort()) {
    const entry = byName.get(name)
    if (entry !== undefined) ordered.push(entry)
  }
  return ordered
}

/**
 * 运行时读 `skills/<name>/platform.yaml`；无文件系统 / 目录缺失 / 读不全时
 * 返回 null，由调用方退回 {@link BUNDLED_CATALOG}。
 *
 * 任何一份文件解析失败都**整表退回**而不是跳过那一份：跳过会让这个 skill 在
 * 广场上静默消失，正是本 CV 要消灭的故障；退回快照至少给出一份完整（可能过期）
 * 的数据，并留下 warn 与 `CATALOG_SOURCE` 供人和测试发现。
 */
function readCatalogFromDisk(): readonly SkillCatalogEntry[] | null {
  const fs = nodeFs()
  if (fs === null) return null
  const skillsDir = new URL('../skills/', import.meta.url)
  if (!fs.existsSync(skillsDir)) {
    console.warn('[canvas-studio] skills/ 目录不存在 —— 技能广场退回内嵌快照（打包产物不完整？）')
    return null
  }
  const entries: SkillCatalogEntry[] = []
  for (const dir of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const file = new URL(`${dir.name}/platform.yaml`, skillsDir)
    // 缺 platform.yaml 由 tests/skill-platform-meta.test.mjs 兜底报警；这里跳过，
    // 是为了让「一个没写元数据的新 skill」不至于炸掉整个广场（它本来就没有卡）。
    if (!fs.existsSync(file)) continue
    const source = `skills/${dir.name}/platform.yaml`
    const parsed = parsePlatformYaml(fs.readFileSync(file, 'utf8'), source)
    if (!parsed.ok) {
      console.warn(`[canvas-studio] ${parsed.reason} —— 技能广场退回内嵌快照`)
      return null
    }
    const entry = toCatalogEntry(parsed.value, source)
    if (!entry.ok) {
      console.warn(`[canvas-studio] ${entry.reason} —— 技能广场退回内嵌快照`)
      return null
    }
    entries.push(entry.value)
  }
  if (entries.length === 0) {
    console.warn('[canvas-studio] skills/ 下没有任何 platform.yaml —— 技能广场退回内嵌快照')
    return null
  }
  return orderEntries(entries)
}

/**
 * 渲染器用的内嵌快照（`platform.yaml` 的派生副本，非手维护的事实源）。
 *
 * 存在理由见文件头：渲染器无文件系统，而广场 UI 按值 import 本模块。
 * `tests/skill-platform-meta.test.mjs` 断言它与 `skills/<name>/platform.yaml`
 * 逐字段深相等 —— 改 platform.yaml 忘了同步这里，直接红。
 */
export const BUNDLED_CATALOG: readonly SkillCatalogEntry[] = [
  // ---- MV / 音乐（S4 · 2026-10-28）----
  {
    name: 'mv-production',
    title: 'MV 制作',
    summary: '一首歌 + 一组素材 → 音乐短视频：歌词分句、时间轴、逐句画面、卡点切换、字幕跟唱。',
    category: 'other',
    icon: 'film',
    hue: 280,
    featured: false,
    hidden: true,
  },
  // ---- 创作规范 ----
  {
    name: 'canvas-studio-creation',
    title: '画布创作总纲',
    summary: '需求澄清 → 拍摄定稿 → 关键帧条件门 → 成片的标准串联流程，所有创作的默认规范。',
    category: 'spec',
    icon: 'compass',
    hue: 262,
    featured: true,
    hidden: true,
  },
  // CV-327（REQ-034 B4）：代码驱动合成路径 —— render_composition 的决策型下游分支 skill。
  // stage 'preview' = 试跑期（新路径，待桌面验收转正）。
  {
    name: 'code-driven-explainer',
    title: '代码驱动科普成片',
    summary: '用代码时间轴把素材、字幕卡与转场组装成解说短片，句级字幕精确对齐。',
    category: 'spec',
    icon: 'film',
    hue: 210,
    featured: false,
    stage: 'preview',
  },
  // ---- 提示词技术 ----
  {
    name: 'h3-prompt-writing',
    title: 'H3 视频提示词',
    summary: 'MiniMax H3 结构化写法：T2VA / I2VA / FL2VA / L2VA / Ref2VA 五种生成模式。',
    category: 'prompting',
    icon: 'quill',
    hue: 205,
    featured: true,
    h3: true,
    hidden: true,
  },
  // CV-192：txt2image 后端已切 Krea2 Turbo（krea2_workflow，CV-191 落文档、本批落 skill），
  // 新增文生图规范并把运行时路由从旧 z-image 规范改指本条。
  // CV-318：旧 z-image-prompt-writing 已删除（后端早已切走、内容被本条取代且 summary 逐字重复），
  // 故本条为该槽位唯一实现。
  {
    name: 'krea2-turbo-writing',
    title: 'Krea2 生图提示词',
    summary: '文生图九段式结构、无负向提示词的正向改写规则、打光与文字渲染词表。',
    category: 'prompting',
    icon: 'quill',
    hue: 240,
    featured: true,
    hidden: true,
  },
  // CV-189：image2image 后端切换 Krea2 Edit 工作流并扩到 4 个参考槽位，新增本规范。
  // CV-318：旧 qwen-image-edit-writing 已删除（后端早已切走、内容被本条取代且 summary 逐字重复），
  // 故本条为该槽位唯一实现。
  {
    name: 'krea2-edit-writing',
    title: 'Krea2 图生图提示词',
    summary: '指令式四段式（操作+目标+规格+保留子句）、多参考图分工（最多 4 张）、分步链式改写。',
    category: 'prompting',
    icon: 'quill',
    hue: 250,
    featured: true,
    hidden: true,
  },
  {
    name: 'music-prompt-writing',
    title: '音乐生成提示词',
    summary: '音乐音频写法：Caption / Lyrics 规则、标签字典、时长边界（Yue2 工作流，元数据参数已退役）。',
    category: 'prompting',
    icon: 'music',
    hue: 322,
    featured: false,
    hidden: true,
  },
  // CV-271：tts_voiceover 占位升真（Drama txt2speech / VoxCPM2）—— 配音写法规范随批落地。
  {
    name: 'voiceover-writing',
    title: '配音生成提示词',
    summary: '声音设计七维写法（语言/性别/年龄/语气/情感/语速/方言）、时长控制、音色克隆与成片接入边界。',
    category: 'prompting',
    icon: 'music',
    hue: 285,
    featured: false,
    hidden: true,
  },
  // ---- 营销广告 ----
  {
    name: 'brand-promo-video-generator',
    title: '品牌宣传片',
    summary: '给 logo、产品图或官网链接，确认时长后自动产出品牌宣传成片。',
    category: 'marketing',
    icon: 'megaphone',
    hue: 12,
    featured: true,
    demo: 'brand-promo-video-generator.gif',
    h3: true,
  },
  {
    name: 'minimalist-product-ad-generator',
    title: '极简产品广告',
    summary: '从产品图提炼卖点，极简高质感分镜，适合电商主图视频与新品发布。',
    category: 'marketing',
    icon: 'megaphone',
    hue: 30,
    featured: false,
    demo: 'minimalist-product-ad-generator.gif',
    h3: true,
  },
  // ---- 视频风格 ----
  // 2026-10-13：圣经题材剧本导演 —— 用户给一个圣经故事名/人物名，拆解成九节拍摄定稿
  // （出处 → 考据 → 主题 → 人物 → 节拍 → 旁白 → 分镜 → 约束）。只做剧本层，止步落地门；
  // Look/出图/出片/质检交回总纲。stage 'preview' = 试跑期。
  {
    name: 'bible-story-director',
    title: '圣经故事剧本',
    summary: '给一个圣经故事名或人物名，拆解成九节拍摄定稿：出处、考据、节拍、旁白、分镜。',
    category: 'style',
    icon: 'film',
    hue: 200,
    featured: false,
    stage: 'preview',
  },
  {
    name: '3d-animation-short-generator',
    title: '3D 动画短片',
    summary: '风格化 3D 短片：故事创意 → 角色/场景卡 → 标准化分镜的完整链路。',
    category: 'style',
    icon: 'film',
    hue: 275,
    featured: false,
    demo: '3d-animation-short-generator.gif',
    h3: true,
  },
  {
    name: 'co-op-game-intro-generator',
    title: '双人游戏开场',
    summary: '双人合作游戏菜单与开场动画：锁定双人身份线索，先出确认图再扩成片。',
    category: 'style',
    icon: 'film',
    hue: 148,
    featured: false,
    demo: 'co-op-game-intro-generator.gif',
    h3: true,
  },
  {
    name: 'handdrawn-live-video-generator',
    title: '手绘发光动画',
    summary: '手绘发光动画与实拍空间融合，蜡笔粉笔质感的超现实短视频。',
    category: 'style',
    icon: 'film',
    hue: 44,
    featured: false,
    demo: 'handdrawn-live-video-generator.gif',
    h3: true,
  },
  {
    name: 'oriental-mythic-visual-director',
    title: '东方异境视觉导演',
    summary: '东方母题与传统纹样转译为自然秩序，电影级绘画写实的神话视觉。',
    category: 'style',
    icon: 'film',
    hue: 28,
    featured: false,
    // CV-101 初期「试跑期不上广场」的两个理由（无上游 demo GIF、风格追问未接入）
    // 已分别被 CV-116 降级占位与 CV-109 预设表扩容消解——2026-09-09 用户拍板放开。
    // CV-118：stage 'preview' = 试跑期（生命周期维度，与可见性独立）；卡片/弹窗
    // 带「试跑」角标，功能就绪后删本字段即转正。
    stage: 'preview',
  },
  {
    name: 'paper-collage-explainer-generator',
    title: '纸拼贴科普',
    summary: '半调网点纸拼贴动画，讲知识点、观点与抽象话题的解说短片。',
    category: 'style',
    icon: 'film',
    hue: 20,
    featured: false,
    demo: 'paper-collage-explainer-generator.gif',
    h3: true,
  },
  {
    name: 'papercraft-stop-motion-explainer',
    title: '纸艺定格科普',
    summary: '手工纸艺定格动画，用 tactile 质感讲解科学、教育与通识内容。',
    category: 'style',
    icon: 'film',
    hue: 330,
    featured: false,
    demo: 'papercraft-stop-motion-explainer.gif',
    h3: true,
  },
  {
    name: 'direct-street-interview-video',
    title: '街拍互动实拍',
    summary: '自然街拍/边走边聊机制：第一人称手持跟随、短对白与街道视差的纪录片能量。',
    category: 'style',
    icon: 'film',
    hue: 96,
    featured: false,
    demo: 'direct-street-interview-video.gif',
    h3: true,
  },
  {
    name: 'stage-startle-to-truce-encounter',
    title: '惊变求和遭遇',
    summary: '平静观察→不可能贴近→可读惊吓→克制求和的短遭遇战机制，非致命张力收尾。',
    category: 'style',
    icon: 'film',
    hue: 8,
    featured: false,
    demo: 'stage-startle-to-truce-encounter.gif',
    h3: true,
  },
  // ---- 字幕配乐 ----
  {
    name: 'music-video-subtitle-generator',
    title: 'MV 歌词字幕',
    summary: 'AI MV 与情绪短片的歌词字体排版：音乐 + 歌词 + 方向 → 卡点字幕成片。',
    category: 'audio',
    icon: 'music',
    hue: 300,
    featured: false,
    demo: 'music-video-subtitle-generator.gif',
    h3: true,
  },
  // ---- 运镜技术 ----
  {
    name: 'cinematic-moves',
    title: '电影级运镜',
    summary: '50套场景化运镜prompt + 万能公式组合 + 反向prompt，用于分镜规划时选择运镜方案。',
    category: 'prompting',
    icon: 'film',
    hue: 180,
    featured: true,
  },
  // ---- 动作场景 ----
  {
    name: 'action-scene-director',
    title: '动作场景导演',
    summary: '动作打戏四条铁律（时序拆段/因果链/环境反馈/资产锁定）+ 视觉资产三类模式，专为武打/战斗/追逐场景设计。',
    category: 'style',
    icon: 'film',
    hue: 350,
    featured: true,
  },
  // ---- 未分类（内部工具）----
  {
    name: 'effect-test-runner',
    title: '效果测试执行器',
    summary: '放手跑模式下按固定用例自动跑创作全流程，采集参数与产物并出一致性测试报告。',
    category: 'other',
    icon: 'puzzle',
    hue: 150,
    featured: false,
  },
]

/** 广场展示顺序（只管顺序，不管内容 —— 内容在 platform.yaml）。 */
const CATALOG_ORDER: readonly string[] = BUNDLED_CATALOG.map((entry) => entry.name)

const diskCatalog = readCatalogFromDisk()

/**
 * 展示元数据清单（featured 排前，其余按分类顺序）。
 *
 * 有文件系统时来自 `skills/<name>/platform.yaml`（单一事实源），否则退回内嵌快照。
 */
export const SKILL_CATALOG: readonly SkillCatalogEntry[] = diskCatalog ?? BUNDLED_CATALOG

/**
 * 这次的 `SKILL_CATALOG` 走的是哪条路径：`platform-yaml` = 读盘成功，
 * `bundled` = 退回内嵌快照。
 *
 * 存在的理由：快照与 platform.yaml 的对账测试在「读盘失败」时会假绿
 * （两边都是快照，比对必然通过）。有了这个标志，测试可以先断言路径本身。
 */
export const CATALOG_SOURCE: 'platform-yaml' | 'bundled' = diskCatalog === null ? 'bundled' : 'platform-yaml'

/** 对广场 / lobby 推荐可见的子集：hidden 技能仍可在项目中使用，但不做展示。 */
export const VISIBLE_CATALOG: readonly SkillCatalogEntry[] = SKILL_CATALOG.filter(entry => entry.hidden !== true)

/** 按注册名取展示元数据；未收录（新增 skill 忘了写 platform.yaml）返回 null，不抛错。 */
export function getSkillEntry(name: string): SkillCatalogEntry | null {
  const target = SKILL_CATALOG.find(entry => entry.name === name)
  return target ?? null
}

/** 某分类下的广场可见技能。 */
export function skillsByCategory(category: SkillCategoryId): SkillCatalogEntry[] {
  return VISIBLE_CATALOG.filter(entry => entry.category === category)
}

/** 每个分类下的广场可见技能数（侧栏角标用，含 0 的分类）。 */
export function skillCountByCategory(): Record<SkillCategoryId, number> {
  const counts = {} as Record<SkillCategoryId, number>
  for (const id of SKILL_CATEGORY_IDS) counts[id] = 0
  for (const entry of VISIBLE_CATALOG) counts[entry.category] += 1
  return counts
}

/**
 * lobby 横滚的推荐技能：在广场可见条目中 featured 优先，不足则用其余条目补齐。
 * @param limit - 返回条数上限（默认 8）。
 */
export function recommendedSkills(limit = 8): SkillCatalogEntry[] {
  const featured = VISIBLE_CATALOG.filter(entry => entry.featured)
  const rest = VISIBLE_CATALOG.filter(entry => !entry.featured)
  return [...featured, ...rest].slice(0, Math.max(0, limit))
}

/**
 * CV-331：内置**知识型槽位占用表**（`槽位 → 内置 skill 名`）。
 *
 * 用途只剩一个：用户上传时若声明了某个能力槽位，告诉他「这个槽位已有内置实现 X」
 * —— 让用户理解为什么用户 skill **不参与槽位绑定**（P3 拍板）。
 *
 * 为什么从 `platform.yaml` 现读而不是硬编码一张表：绑定表的唯一事实源是
 * `skills/<name>/platform.yaml` 的 `slot` 字段（`toolchain.md` 是它的**人类可读
 * 呈现**）。硬编码等于在本模块再造第二份 —— 新增 / 换内置 skill 时两处必然漂移，
 * 而那正是 CV-324 消灭掉的故障模式。
 *
 * 无文件系统（渲染器）或读盘失败时返回空表：**空表不等于「没有占用」**，
 * 只是拿不到事实 ⇒ 调用方据此**少产一条提示**，绝不据此改变判定
 * （这正是 CV-325 那版 fail-open 的反面）。
 */
export function builtinSlotOwners(): Record<string, string> {
  const fs = nodeFs()
  if (fs === null) return {}
  const skillsDir = new URL('../skills/', import.meta.url)
  if (!fs.existsSync(skillsDir)) return {}
  const owners: Record<string, string> = {}
  for (const dir of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const file = new URL(`${dir.name}/platform.yaml`, skillsDir)
    if (!fs.existsSync(file)) continue
    const parsed = parsePlatformYaml(fs.readFileSync(file, 'utf8'), `skills/${dir.name}/platform.yaml`)
    if (!parsed.ok) continue
    const slot = parsed.value.slot
    const role = parsed.value.role
    const name = parsed.value.name
    // 只收知识型：决策型 skill 不占能力槽位（`orchestration` 归总纲，不是「占用」）。
    if (typeof slot !== 'string' || role !== 'knowledge' || typeof name !== 'string') continue
    if (!(slot in owners)) owners[slot] = name
  }
  return owners
}
