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
 * | toolName | 参数结构 | 可重放 |
 * |---|---|---|
 * | `image_generate` (45) | `{prompt, aspectRatio, resolution?, style, filename?/filenames?, ...}` | ✅ |
 * | `video_generate` (4) / `video_composite` (6) | `{prompt, aspectRatio, duration, filenames, ...}` | ✅ |
 * | `music_generation` (5) | `{caption_prompt, lyrics_prompt, duration, bpm, language, ...}` | ❌ 后端没有对应分支 |
 * | `character_sheet` (2) | `{image, step}` | ❌ 且 toolName 与分支名 `character_generate` 对不上 |
 * | `extract_last_frame` (1) | `{videoUrl, seek}` | ❌ 后端没有对应分支 |
 *
 * 从前「能不能重试」的判据是「有没有 toolName + 有没有 generationPrompt」——
 * 那 8 个打不通的节点因此照样显示可点的按钮，点下去落进图片分支（`params.prompt`
 * 是 undefined、又没有参考图 ⇒ 打 `txt2image`），**要么报错、要么静默出一张无
 * 提示词的图覆盖掉原节点**。判据收紧到「有没有可重放的生成参数」是本模块的职责。
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

/**
 * `generateAsset` 真有分支的工具 —— 只有这些能原样重放。
 * 与 `src/generate.ts` 的 `if (tool === …)` 分发一一对应；新增分支必须同步这里，
 * 否则新工具的「重试」按钮会先一步出现在画布上（有按钮、打不通）。
 */
const REPLAYABLE_TOOLS: readonly string[] = [
  'image_generate',
  'character_generate',
  'video_generate',
  'video_composite',
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
