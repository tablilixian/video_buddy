/**
 * 风格 × 用户提示词 **冲突检测**（CV-288 验收反馈批）。
 *
 * ## 为什么需要它
 *
 * 2026-10-09 桌面验收实测：用户选了「暗黑奇幻」「铅笔素描」，反馈「效果不明显」。
 * 复盘根因**不是注入失败**（`stylePrefix` 照旧写入、`composeImagePrompt` 照旧拼接），
 * 而是**用户提示词在同维度上与风格前缀正面冲突**，且长度是前缀的 7 倍：
 *
 * | | 前缀占比 | 合成字数 |
 * |---|---|---|
 * | V1 实测（23 字提示词） | 72.0% | 82 |
 * | 验收现场（444 字提示词） | **12.6%** | **509**（越过 Krea2 ~500 字软限制） |
 *
 * 典型冲突（实测案例，提示词为高山茶园/木屋咖啡馆场景概念图）：
 * - 「铅笔素描」的「黑白灰阶」对上用户「中低饱和胶片调、青绿+暖棕」——相反；
 * - 「铅笔素描」的「中近景取景」对上用户「24mm 广角 + 深景深」——相反（D7 冲突防线）；
 * - 「暗黑奇幻」的「幽暗低照度」对上用户「自然光为主」——相反。
 *
 * 模型不会报错、不会提示，只会**静默按用户更长的描述出图**，用户于是以为风格没生效。
 * 本模块把这次静默失败**前置成显式提示**：不改任何注入语义、不改生成结果，
 * 只在写提示词的当下告诉用户「这两处打架了，二选一」。
 *
 * ## 设计边界（与 D0 = C-乙 一致）
 *
 * - **纯检测，不改提示词**：不删用户文字、不重排、不加权。改写是用户的事。
 * - **纯启发式，无 LLM**：词表匹配，快、确定、可单测（符合仓库「执行器不经过 LLM」原则）。
 * - **只提示「有冲突」，不替用户裁决**：产品无权决定用户的画面对不对。
 * - 判据**双向**：风格说黑白、用户也写了黑白 ⇒ 不冲突（同一个方向）；
 *   风格要彩色、用户写了「黑白灰阶」⇒ 冲突（反方向）。
 * - **词表拼错的兜底靠单测而不是靠类型**：本模块刻意用朴素的 `string` 索引
 *   （`Record<string, string>` / `Record<string, readonly string[]>`），
 *   换取实现直白。类型体操换来的编译期保证抵不上它带来的可读性损失——
 *   「极性写错维度」这类错误由 `style-conflicts.test.mjs` 逐条比对抓。
 *
 * 依赖方向：单向依赖 `visual-styles.ts`（取 `styleIdOfPrefix` 反查），无循环依赖。
 */

import { styleIdOfPrefix } from './visual-styles.js'

/** 冲突维度。展示顺序 = 提示里的行序（色彩最显眼，置首）。 */
export type ConflictDimension = '色彩' | '光线' | '景深' | '媒介' | '画幅'

/** 维度展示序（= 检测序 = UI 行序）。 */
export const CONFLICT_DIMENSIONS: readonly ConflictDimension[] = ['色彩', '光线', '景深', '媒介', '画幅']

/** 单条冲突。`evidence` 是从用户提示词里原样摘出的片段，UI 直接展示（让用户能定位）。 */
export interface StyleConflict {
  readonly dimension: ConflictDimension
  /** 一句话说明冲突在哪两侧。 */
  readonly message: string
  /** 用户提示词里的原文片段（截断后），供 UI 定位；无命中片段时为空串。 */
  readonly evidence: string
}

// ---- 词表：每个维度两个方向的特征词（喂给 findEvidence 匹配）--------------------------

const COLOR_MONO = ['黑白', '灰阶', '单色', '去色', '素描', '铅笔', '线稿', '炭笔', '钢笔淡彩', '水墨', '墨色', '宣纸']
const COLOR_CHROMA = ['彩色', '饱和', '多彩', '浓彩', '色彩', '色调', '霓虹', '渐变', '暖橙', '冷青', '青绿', '暖棕', '青灰', '赭石', '翠绿', '朱红', '黛青', '品红', '高饱和', '低饱和', '胶片调']

const LIGHT_LOW = ['幽暗', '低照度', '暗调', '深黑阴影', '阴影占据', '暗部', '夜色', '夜晚', '昏暗', '压抑', '肃杀', '微光', '逆光剪影']
const LIGHT_BRIGHT = ['明亮', '高调', '通透明亮', '日光', '阳光', '柔漫射', '柔光', '高明度', '浅色底', '纯净浅色', '柔对比', '柔和补光']

/** 景深/取景。**焦段类词在此列**——D7 的冲突防线正主。 */
const DEPTH_CLOSE = ['中近景', '近景', '特写', '浅景深', '虚化', '微距']
const DEPTH_WIDE = ['广角', '全景', '远景', '深景深', '大全景', '航拍']

const MEDIUM_PHOTO = ['照片', '摄影', '写实', '实拍', '纪实']
const MEDIUM_PAINT = ['插画', '绘画', '手绘', '油画', '水彩', '版画', '漫画', '动漫', '赛璐璐']

/**
 * 风格侧的**分维极性声明**（CV-288 补录）。
 *
 * 为什么不在 `visual-styles.ts` 里直接写：那里存的是**注入文本**（喂给模型的句子），
 * 本表是**给检测器读的声明**（喂给代码的标记）。两者用途不同、演进节奏不同——
 * 注入文本要按 D8 反复打磨措辞，分维声明按风格定义改一次即可。
 * 但**同一风格必须在两处同步**：改这里的极性却不改注入文本（或反之），
 * 会让提示词与实际注入对不上号。`style-conflicts.test.mjs` 有守卫盯这一点。
 *
 * 语义 = 该风格在本维度的取向：
 * - `color: 'mono'` = 偏单色 / 去色；`'chroma'` = 偏彩色；`'mixed'` / 缺省 = 不表态。
 * - 同理 `light: 'low' | 'bright'`、`depth: 'close' | 'wide'`、`medium: 'photo' | 'paint'`。
 */
export interface StylePolarity {
  readonly color?: 'mono' | 'chroma' | 'mixed'
  readonly light?: 'low' | 'bright' | 'mixed'
  readonly depth?: 'close' | 'wide' | 'mixed'
  readonly medium?: 'photo' | 'paint' | 'mixed'
  /** 该风格是否暗示画幅（按 D8 第 6 条应恒为 false；保留字段作守卫锚点）。 */
  readonly aspect?: boolean
}

/** 风格 id → 分维极性。缺项 = 该维不表态。**键必须存在于 `VISUAL_STYLES`**（有守卫）。 */
const POLARITY: Readonly<Record<string, StylePolarity>> = {
  cinematic: { color: 'chroma', light: 'low', depth: 'close', medium: 'photo' },
  'anime-cel': { color: 'chroma', light: 'bright', depth: 'mixed', medium: 'paint' },
  realistic: { color: 'chroma', light: 'bright', depth: 'close', medium: 'photo' },
  'ink-wash': { color: 'mono', light: 'bright', depth: 'mixed', medium: 'paint' },
  'cyber-neon': { color: 'chroma', light: 'low', depth: 'mixed', medium: 'photo' },
  'film-grain': { color: 'chroma', light: 'mixed', depth: 'mixed', medium: 'photo' },
  'dark-fantasy': { color: 'chroma', light: 'low', depth: 'mixed', medium: 'photo' },
  'ancient-costume': { color: 'chroma', light: 'bright', depth: 'close', medium: 'photo' },
  'retro-era': { color: 'chroma', light: 'low', depth: 'close', medium: 'photo' },
  'urban-daily': { color: 'chroma', light: 'bright', depth: 'close', medium: 'photo' },
  'oil-painting': { color: 'chroma', light: 'mixed', depth: 'mixed', medium: 'paint' },
  'pencil-sketch': { color: 'mono', light: 'bright', depth: 'close', medium: 'paint' },
}

/** 每个维度的「风格侧词表」与「该维两个极性互相反对」。 */
interface DimensionRule {
  readonly dim: ConflictDimension
  /** 风格侧的极性字段名（与 `StylePolarity` 的键同名）。 */
  readonly field: 'color' | 'light' | 'depth' | 'medium'
  /** 极性 → 该维的相反极性。风格取 `a` 时，用户写 `opp[a]` 的词就是冲突。 */
  readonly opposite: Readonly<Record<string, string>>
  /** 极性 → 该极性的代表词。 */
  readonly lex: Readonly<Record<string, readonly string[]>>
}

/** 检测维度规则表（顺序 = UI 展示序，色彩最显眼置首）。 */
const DIMENSION_RULES: readonly DimensionRule[] = [
  {
    dim: '色彩',
    field: 'color',
    opposite: { mono: 'chroma', chroma: 'mono' },
    lex: { mono: COLOR_MONO, chroma: COLOR_CHROMA },
  },
  {
    dim: '光线',
    field: 'light',
    opposite: { low: 'bright', bright: 'low' },
    lex: { low: LIGHT_LOW, bright: LIGHT_BRIGHT },
  },
  {
    dim: '景深',
    field: 'depth',
    opposite: { close: 'wide', wide: 'close' },
    lex: { close: DEPTH_CLOSE, wide: DEPTH_WIDE },
  },
  {
    dim: '媒介',
    field: 'medium',
    opposite: { photo: 'paint', paint: 'photo' },
    lex: { photo: MEDIUM_PHOTO, paint: MEDIUM_PAINT },
  },
]

/** 极性的兜底中文名（风格注入文本没含词表里的词时用）。 */
const POLARITY_LABELS: Readonly<Record<string, string>> = {
  mono: '单色', chroma: '彩色', low: '低照度', bright: '明亮',
  close: '近景', wide: '广角', photo: '照片', paint: '绘画',
}

/** 各维度在提示文案里的称呼。 */
const DIMENSION_LABELS: Readonly<Record<ConflictDimension, string>> = {
  色彩: '色彩取向', 光线: '光线明暗', 景深: '景深与取景', 媒介: '媒介类型', 画幅: '画幅',
}

/** 找出用户提示词里命中的第一个词（附前后文，供 UI 定位）。 */
function findEvidence(prompt: string, words: readonly string[]): string {
  for (const word of words) {
    const at = prompt.indexOf(word)
    if (at < 0) continue
    const from = Math.max(0, at - 6)
    const to = Math.min(prompt.length, at + word.length + 8)
    return `${from > 0 ? '…' : ''}${prompt.slice(from, to).replace(/\s+/g, ' ')}${to < prompt.length ? '…' : ''}`
  }
  return ''
}

/**
 * 检测单个维度的一处冲突。
 *
 * @param polarity 该风格的分维极性声明。
 * @param userPrompt 用户提示词。
 * @param stylePrefix 风格注入文本（用于取「风格侧引文」，让提示里的引号就是真注入的那句）。
 */
function detectOne(rule: DimensionRule, polarity: StylePolarity, userPrompt: string, stylePrefix: string): StyleConflict | null {
  const mine = polarity[rule.field]
  // 该风格在此维不表态（mixed 或缺项）⇒ 谈不上冲突。
  if (mine === undefined || mine === 'mixed') return null
  const theirs = rule.opposite[mine]
  if (theirs === undefined) return null
  const words = rule.lex[theirs] ?? []
  const evidence = findEvidence(userPrompt, words)
  if (evidence === '') return null
  const userWord = words.find(w => userPrompt.includes(w)) ?? ''
  // 风格侧代表词优先取自注入文本本身，取不到再退到极性中文名。
  const styleWord = rule.lex[mine]?.find(w => stylePrefix.includes(w)) ?? POLARITY_LABELS[mine] ?? mine
  return {
    dimension: rule.dim,
    message: `你的提示词写了「${userWord}」，与该风格的${DIMENSION_LABELS[rule.dim]}（${styleWord}）相反，二选一`,
    evidence,
  }
}

/**
 * 检测 `风格前缀 × 用户提示词` 的维度冲突。
 *
 * @param stylePrefix 已写入节点的风格注入文本（空串 = 无风格 ⇒ 直接返回 `[]`）。
 * @param prompt 用户在输入框里写的提示词（空串 ⇒ 返回 `[]`，没东西可冲突）。
 * @returns 冲突列表，按维度展示序排列；无冲突返回 `[]`。
 */
export function detectStyleConflicts(stylePrefix: string, prompt: string): StyleConflict[] {
  if (stylePrefix.trim() === '' || prompt.trim() === '') return []
  const polarity = polarityOfPrefix(stylePrefix)
  // 认不出的前缀（老节点的旧文本）不猜极性——否则会对着一条陌生风格编造冲突。
  if (polarity === undefined) return []

  const found: StyleConflict[] = []
  // 画幅：风格若暗示画幅（按 D8 第 6 条应恒 false）才提示「风格不该碰画幅」。
  if (polarity.aspect === true) {
    found.push({ dimension: '画幅', message: '风格描述不应包含画幅信息', evidence: '' })
  }
  for (const rule of DIMENSION_RULES) {
    const conflict = detectOne(rule, polarity, prompt, stylePrefix)
    if (conflict !== null) found.push(conflict)
  }
  return found
}

/**
 * 读取某条风格的极性声明；未知前缀返回 undefined。
 *
 * 走 `visual-styles` 的 `styleIdOfPrefix` 反查口径（不另建第二张前缀映射——
 * 那正是 D9 明令禁止的漂移形状）。老节点可能持有认不出的旧前缀，此时返回
 * undefined：**不猜**。对着一条陌生风格编造冲突，比不提示更糟。
 */
export function polarityOfPrefix(prefix: string): StylePolarity | undefined {
  const id = styleIdOfPrefix(prefix)
  return id === undefined ? undefined : POLARITY[id]
}

/** 风格清单里**已登记极性声明**的 id（守卫用：必须与 `VISUAL_STYLES` 逐条对齐）。 */
export function polarisedStyleIds(): readonly string[] {
  return Object.keys(POLARITY)
}

/**
 * 提示词字数超限判定（CV-288 验收反馈批 · A 项预览的副产物）。
 *
 * Krea2 约 500 字为**软限制**（CV-288 拍板 D8-6/7：不做客户端拦截——限制随模型升级会
 * 解除，客户端硬拦会变成误伤）。这里只**告知**，并在合成后超限时提示。
 */
export const SOFT_PROMPT_LIMIT = 500

/** 合成后字数（去空白，与 Krea2 的计字口径一致：空白不计）。 */
export function promptCharCount(text: string): number {
  return text.replace(/\s/g, '').length
}

/** 风格前缀在合成提示词里的占比（0–1）。用于 UI 提示「风格权重被稀释」。 */
export function stylePrefixRatio(stylePrefix: string, prompt: string): number {
  const p = promptCharCount(stylePrefix)
  const total = p + promptCharCount(prompt)
  return total === 0 ? 0 : p / total
}

/** 稀释阈值：前缀占比低于此值即提示「你的提示词过长，风格可能被稀释」。 */
export const RATIO_WARN = 0.3
