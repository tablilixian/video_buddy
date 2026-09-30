/**
 * 节点生成参数（`generationPrompt`）的解析、提示词字段映射与可重放判定的
 * **唯一实现**。纯函数、无运行时依赖 —— Host tsc 会把它打进 `lib/node-params.js`，
 * 于是 `node --test` 能直接单测（同上位模块 `canvas-view.ts` 的约定）。
 *
 * ## 为什么必须收口
 *
 * 真画布实测（7 个项目 / 139 节点）里 `generationPrompt` 有**四种不同长相**，
 * 而「重放」链路只有一条：
 *
 * | toolName | 参数结构 | 重放落点 |
 * |---|---|---|
 * | `image_generate` (45) | `{prompt, aspectRatio, resolution?, style, filename?/filenames?, ...}` | `generateAsset` 图片分支 |
 * | `video_generate` (4) / `video_composite` (6) | `{prompt, aspectRatio, duration, filenames, ...}` | `generateAsset` 视频分支 |
 * | `music_generation` (5) | `{caption_prompt, lyrics_prompt, duration, bpm, language, ...}` | `generateMusic`（CV-195） |
 * | `character_sheet` (2) | `{image, step:'four-view'}` | `generateCharacterSheet`（CV-195） |
 * | `extract_last_frame` (1) | `{videoUrl, seek}` | `extractLastFrame`（CV-195） |
 *
 * 从前「能不能重试」的判据是「有没有 toolName + 有没有 generationPrompt」——
 * 那 8 个打不通的节点因此照样显示可点的按钮，点下去落进图片分支（`params.prompt`
 * 是 undefined、又没有参考图 ⇒ 打 `txt2image`），**要么报错、要么静默出一张无
 * 提示词的图覆盖掉原节点**。判据收紧到「有没有可重放的生成参数」是本模块的职责。
 *
 * CV-195：三类「非图片/视频」产物（音频 / 四视图 / 抽帧）此前因 `generateAsset`
 * 没有对应分支而被排除。现在重放适配已补齐（`generateAsset` 顶部按 toolName
 * 委派给各自的生产函数，`retryOf` 原地下传），于是它们**重新**进入本表 ——
 * 反之若哪天撤掉某条适配，必须同步从本表删除，否则按钮又会先一步出现。
 */

import type { StudioCanvasNode } from './contracts/canvas.js'

/** 生成参数（`generationPrompt` 解析后的宽松形态）。 */
export type GenerationParams = Record<string, unknown>

/**
 * 解析一份 `generationPrompt`。非法（缺省 / 非 JSON / 不是对象）返回 `null`。
 *
 * 返回 `null` 的调用方一律**不得写回** —— 用半份参数覆盖原值比不编辑更坏。
 */
export function parseGenerationParams(raw: string | undefined): GenerationParams | null {
  if (raw === undefined || raw.length === 0) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    return value as GenerationParams
  } catch {
    return null
  }
}

/** 解析节点上保存的生成参数（节点级重试的回放锚点）。 */
export function generationParamsOf(node: StudioCanvasNode): GenerationParams | null {
  return parseGenerationParams(node.generationPrompt)
}

/** CV-242：详情面板「生成时用的参考图」匹配结果——node 为 null 表示句柄已断链（画布上无节点持有）。 */
export interface ReferenceSummary {
  name: string
  node: StudioCanvasNode | null
}

/**
 * 把参数里的参考句柄（filename / filenames 去重后）逐个反查画布节点。
 *
 * 命中返回节点（渲染缩略图）；不命中返回 `null`（渲染「参考已断链」占位卡）。
 * 此前未命中的句柄被静默 filter 丢弃——面板参考数量与 prompt 的 `<Picture N>`
 * 对不上（CV-242 实测：分镜 6 的 prompt 提到 3 张图只显示 2 张）。占位不猜：
 * 断链句柄与磁盘资产的对应关系只有 manifest（Host 侧）知道，展示层不越权推断。
 */
export function resolveReferenceSummaries(
  names: readonly string[],
  nodes: readonly StudioCanvasNode[],
): ReferenceSummary[] {
  return names.map((name) => ({
    name,
    node: nodes.find(candidate => candidate.filename === name) ?? null,
  }))
}

/**
 * `generateAsset` 真有分支的工具 —— 只有这些能原样重放。
 * 与 `src/generate.ts` 的 `if (tool === …)` 分发一一对应；新增分支必须同步这里，
 * 否则新工具的「重试」按钮会先一步出现在画布上（有按钮、打不通）。
 *
 * CV-195：后三项走 `generateAsset` 顶部的委派分支（各自的生产函数），
 * 不在下面那条 if/else 链里，但同样是「真能重放」的 —— 判据是**能不能打通**，
 * 不是**在哪条分支里**。
 */
const REPLAYABLE_TOOLS: readonly string[] = [
  'image_generate',
  'image_fix',
  'character_generate',
  'video_generate',
  'video_composite',
  'music_generation',
  'character_sheet',
  'extract_last_frame',
]

/**
 * 能否原地重放（重试）。
 *
 * 两个条件缺一不可：① toolName 在 `generateAsset` 的真实分支里；② 参数可解析。
 * 只看「有没有 generationPrompt」会把音频 / 四视图 / 抽帧那 8 个节点放进来。
 */
export function isReplayable(node: StudioCanvasNode): boolean {
  if (node.toolName === undefined) return false
  if (!REPLAYABLE_TOOLS.includes(node.toolName)) return false
  return generationParamsOf(node) !== null
}

/** 生成参数里一段可编辑的自由文本。 */
export interface PromptField {
  /** 在 `generationPrompt` 里的键名。 */
  key: string
  /** 界面标签。 */
  label: string
}

const PROMPT_ONLY: readonly PromptField[] = [{ key: 'prompt', label: '提示词' }]

/**
 * toolName → 可编辑的自由文本字段。
 *
 * ⚠️ 这张表按**真画布实测**抄，不按工具命名习惯猜：
 * - 图片 / 视频三个工具共用 `prompt` 一个键；
 * - `music_generation` 的自由文本是 `caption_prompt`（音乐描述）与 `lyrics_prompt`
 *   （歌词）**两个**键，没有 `prompt` —— 只给一个「提示词」输入框会让用户改了个寂寞；
 * - `character_sheet`（四视图）与 `extract_last_frame`（抽帧）的参数里**没有自由
 *   文本**（前者只有 `image`/`step`，后者只有 `videoUrl`/`seek`）。显式声明成空表，
 *   而不是让它掉进下面的 `prompt` 兜底 —— 那会给用户一个「能改但改了没用」的框。
 */
const PROMPT_FIELDS_BY_TOOL: Readonly<Record<string, readonly PromptField[]>> = {
  image_generate: PROMPT_ONLY,
  image_fix: PROMPT_ONLY,
  character_generate: PROMPT_ONLY,
  video_generate: PROMPT_ONLY,
  video_composite: PROMPT_ONLY,
  music_generation: [
    { key: 'caption_prompt', label: '音乐描述' },
    { key: 'lyrics_prompt', label: '歌词' },
  ],
  character_sheet: [],
  extract_last_frame: [],
}

/**
 * 某个节点上**可编辑的提示词字段**（空数组 = 该节点没有提示词可改，编辑器不出现）。
 *
 * 未登记的工具走宽容兜底：参数里真有一个字符串 `prompt` 才给编辑框（历史工具，
 * 如已下线的 `style_transfer`）。反过来，参数里没有 `prompt` 就什么都不给 ——
 * **不假设人人都有 `prompt`** 是这张表存在的全部理由。
 */
export function promptFieldsOf(node: StudioCanvasNode): readonly PromptField[] {
  if (node.toolName !== undefined) {
    const declared = PROMPT_FIELDS_BY_TOOL[node.toolName]
    if (declared !== undefined) return declared
  }
  const params = generationParamsOf(node)
  if (params !== null && typeof params.prompt === 'string') return PROMPT_ONLY
  return []
}

/** 读某个提示词字段的当前值（缺省 / 非字符串一律空串）。 */
export function promptValueOf(node: StudioCanvasNode, key: string): string {
  const params = generationParamsOf(node)
  const value = params === null ? undefined : params[key]
  return typeof value === 'string' ? value : ''
}

/**
 * 把某个提示词字段写回 `generationPrompt`，返回**新的 JSON 串**。
 *
 * 返回 `null` = 原参数不可解析（旧数据 / 手改），调用方必须放弃这次写入。
 * 其余键原样保留（`filename` / `sourceUrls` / `shotNodeIds` … 都是重放要用的）。
 */
export function withPromptField(raw: string | undefined, key: string, value: string): string | null {
  const params = parseGenerationParams(raw)
  if (params === null) return null
  return JSON.stringify({ ...params, [key]: value })
}

/* ===================== REQ-003：图片参考位（槽位表 + 读写） =====================
 *
 * 详情抽屉里那块「生成时用的参考图」此前是**只读**的（REQ-003 的核心缺口）。
 * 要让它可增删换重排，先得有一份「哪个工具用什么键、几张、顺序有没有语义」的
 * 唯一事实源 —— 就是下面的 `REFERENCE_SLOTS`。
 *
 * 为什么不能写一套通用 UI 蒙上去：参考位在不同工具里形态不同，而且是**后端契约**
 * 的一部分（见 `host-tools.ts` 各工具的 `filename` / `filenames` 描述）：
 *
 * | 工具 | 键 | 语义 |
 * |---|---|---|
 * | `image_generate` | `filename`（单）或 `filenames`（多，≤4） | 二选一；顺序无语义 |
 * | `video_composite` | `filenames`（≤9） | **顺序即位次**：1=首帧 / 2=首尾帧 / ≥3=多参考 |
 * | `video_generate` | `filename`（单，可选） | 就是 `<Picture 1>`（首帧） |
 * | `image_fix` / `character_generate` / `character_sheet` | `filename`（单，必填） | 只换不空 |
 *
 * 写回契约与 `withPromptField` **完全一致**（不可解析返回 `null`、其余键原样保留），
 * 因为两者动的是同一个 `generationPrompt` 串。
 */

/** 图片参考位规格。`keys` 是写参考用的键；两个键时表示**二选一**。 */
export interface ReferenceSlot {
  readonly keys: readonly string[]
  /** 必填：不允许清空（必填单槽"只换不空"，避免重试时才报参数错）。 */
  readonly required: boolean
  readonly max: number
  /** 位次有语义（`video_composite` 的顺序就是提示词里 `<Picture N>` 的编号）。 */
  readonly ordered: boolean
}

/** 槽位表 = 唯一事实源（REQ-003 方案 §4.1）。不在表里的工具**不出**参考编辑区。 */
export const REFERENCE_SLOTS: Readonly<Record<string, ReferenceSlot>> = {
  image_generate: { keys: ['filename', 'filenames'], required: false, max: 4, ordered: false },
  video_composite: { keys: ['filenames'], required: true, max: 9, ordered: true },
  video_generate: { keys: ['filename'], required: false, max: 1, ordered: false },
  image_fix: { keys: ['filename'], required: true, max: 1, ordered: false },
  character_generate: { keys: ['filename'], required: true, max: 1, ordered: false },
  character_sheet: { keys: ['filename'], required: true, max: 1, ordered: false },
}

/**
 * 历史遗留参考键：`styleFilename` 的生产者是早期的媒体工具集，随 CV-147「工具集
 * 收敛 26→22」退役。老节点的参数里可能仍有它 —— 读路径**保持宽容**（否则那些
 * 节点的参考图会凭空消失），写路径**一律删掉**（否则刚被删掉的那张会在下一次
 * 渲染时"复活"）。
 */
const LEGACY_REFERENCE_KEYS: readonly string[] = ['styleFilename']

/**
 * 位次读数（中文），位次无语义的槽返回 `null`。
 *
 * 放在这里而不是 UI 里：它是**槽位表的下游规则**（`ordered` + 张数 → 模式名），
 * 与 `REFERENCE_SLOTS` 必须一起演进；放 UI 就只能靠渲染台间接验。
 */
export function referenceModeLabel(ordered: boolean, count: number): string | null {
  if (!ordered) return null
  if (count <= 1) return `${count} 张 · 首帧 I2VA`
  if (count === 2) return '2 张 · 首尾帧 FL2VA'
  return `${count} 张 · 多参考 Ref2VA`
}

/** 该节点的图片参考位规格；不可编辑返回 `null`（UI 据此决定出不出这块）。 */
export function referenceSlotOf(node: Pick<StudioCanvasNode, 'toolName'>): ReferenceSlot | null {
  if (node.toolName === undefined) return null
  return REFERENCE_SLOTS[node.toolName] ?? null
}

/**
 * 按**参数顺序**抽出现有参考句柄（`filename` → 历史键 → `filenames[]`），去重保序。
 *
 * 这是详情抽屉「生成时用的参考图」的数据来源（此前内联写在 `NodeDetailDrawer`
 * 里，收口到这里以便单测直连、并与写路径共用同一份规则）。
 */
export function referenceNamesOf(raw: string | undefined): readonly string[] {
  const params = parseGenerationParams(raw)
  if (params === null) return []
  const names: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0) return
    if (!names.includes(value)) names.push(value)
  }
  push(params.filename)
  for (const key of LEGACY_REFERENCE_KEYS) push(params[key])
  if (Array.isArray(params.filenames)) params.filenames.forEach(push)
  return names
}

/**
 * 归一化写回参考位，返回**新的 JSON 串**；拒绝写入时返回 `null`。
 *
 * 归一化规则（方案 §4.1）：
 * - **0 张**：必填槽拒绝（`null`）；可选槽删掉全部参考键（含历史键）；
 * - **1 张**：写单值键（`filename`；槽只有 `filenames` 时写 `filenames: [x]`），删掉另一个键；
 * - **≥2 张**：只写 `filenames`（保序），删掉 `filename`；
 * - **超上限** / **参数不可解析**：`null` —— 调用方必须放弃写入并给出理由，
 *   绝不静默截断（静默采样是 Host 侧行为，UI 不替用户做决定）。
 */
export function withReferenceNames(
  raw: string | undefined,
  slot: ReferenceSlot,
  names: readonly string[],
): string | null {
  const params = parseGenerationParams(raw)
  if (params === null) return null
  const unique = names.filter((name, index) => name.length > 0 && names.indexOf(name) === index)
  if (unique.length > slot.max) return null
  if (unique.length === 0 && slot.required) return null
  const next: GenerationParams = { ...params }
  for (const key of slot.keys) delete next[key]
  for (const key of LEGACY_REFERENCE_KEYS) delete next[key]
  if (unique.length === 1) {
    const single = slot.keys.includes('filename') ? 'filename' : 'filenames'
    next[single] = single === 'filenames' ? [...unique] : unique[0]
  } else if (unique.length > 1) {
    next.filenames = [...unique]
  }
  return JSON.stringify(next)
}
