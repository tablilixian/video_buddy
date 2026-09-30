/**
 * REQ-003 Step 3 / D 组：提示词**形态**判定与 H3-IR 分段 —— 由**内容**算，不由用户手选。
 *
 * 为什么是纯函数：形态决定就地面板长什么样（D1 表），判定错了用户看到的就是
 * 「明明很短却要展开」或「明明很长还硬撑全文」。把阈值和判据收在这里，Host 单测
 * 直连（`tests/prompt-shape.test.mjs`），UI 只消费结果。
 *
 * 阈值（方案 §8.7：建议值集中在这里便于一次调参，真机按「改一个词要不要滚屏」定）：
 * ≤ 8 行 且 ≤ 240 字 = short；命中 IR 段名行或含 `<Picture N>` = ir；否则 long。
 */

/** 短/长分界：行数上限。 */
export const PROMPT_SHORT_MAX_LINES = 8
/** 短/长分界：字符数上限。 */
export const PROMPT_SHORT_MAX_CHARS = 240
/** 长文本就地档的预览行数（其余收进读数与展开档）。 */
export const PROMPT_PREVIEW_LINES = 3

/** H3-IR 段名行：整行只有 `段名:`（如 `integrated_multimodal_description:`）。 */
export const IR_SEGMENT_LINE_RE = /^[a-z_]+:\s*$/
/** 同一条正则的**多行版**：对整段文本判定「是否存在段名行」（segmentize 逐行用上面的）。 */
export const IR_SHAPE_RE = /^[a-z_]+:\s*$/m

export type PromptShape = 'short' | 'long' | 'ir'

export function promptLineCount(text: string): number {
  return text.length === 0 ? 1 : text.split('\n').length
}

/** D1：形态判定。ir 优先于 long（结构化文本往往同时超阈值，但折叠比读数更有用）。 */
export function promptShapeOf(text: string): PromptShape {
  if (IR_SHAPE_RE.test(text) || /<Picture\s+\d+>/i.test(text)) return 'ir'
  if (promptLineCount(text) > PROMPT_SHORT_MAX_LINES || text.length > PROMPT_SHORT_MAX_CHARS) return 'long'
  return 'short'
}

/**
 * IR 分段（**无损**）：行号区间模型，段体编辑按行号splice回原文本，
 * 未触碰的段落逐字节保持原样（提示词是重放参数，字节漂移就是语义漂移）。
 *
 * `name === null` 是第一段名行之前的正文（可能不存在，start = -1）。
 * `bodyStart/bodyEnd` 是**可编辑**段体的行号区间 [bodyStart, bodyEnd)——
 * 不含段名行，也不含段尾与下一段之间的空行分隔（分隔属于结构，编辑不许吃掉）。
 */
export interface IrSegment {
  /** 段名（不含冒号）；首段无段名时为 null。 */
  name: string | null
  /** 段名行行号；无段名时为 -1。 */
  headLine: number
  bodyStart: number
  bodyEnd: number
}

export function irSegmentize(text: string): readonly IrSegment[] {
  const lines = text.split('\n')
  const segments: IrSegment[] = []
  // 第一段：段名行之前的正文（没有段名行时覆盖全文）。
  let current: IrSegment = { name: null, headLine: -1, bodyStart: 0, bodyEnd: 0 }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (IR_SEGMENT_LINE_RE.test(line.trim())) {
      // 收尾上一段：去掉段尾的空行分隔（它们属于结构，不属于段体）。
      let bodyEnd = index
      while (bodyEnd > current.bodyStart && (lines[bodyEnd - 1] as string).trim() === '') bodyEnd -= 1
      current.bodyEnd = bodyEnd
      segments.push(current)
      current = { name: line.trim().replace(/:$/, ''), headLine: index, bodyStart: index + 1, bodyEnd: index + 1 }
    }
  }
  let bodyEnd = lines.length
  while (bodyEnd > current.bodyStart && (lines[bodyEnd - 1] as string).trim() === '') bodyEnd -= 1
  current.bodyEnd = bodyEnd
  segments.push(current)
  return segments
}

/** 段体的可编辑文本（bodyStart..bodyEnd，原样 join）。 */
export function irSegmentBody(text: string, segment: IrSegment): string {
  const lines = text.split('\n')
  return lines.slice(segment.bodyStart, segment.bodyEnd).join('\n')
}

/** 用新段体替换该段：只动 [bodyStart, bodyEnd) 这几行，其余逐字节原样。 */
export function irReplaceSegment(text: string, segment: IrSegment, body: string): string {
  const lines = text.split('\n')
  const next = body.length === 0 ? [] : body.split('\n')
  return [...lines.slice(0, segment.bodyStart), ...next, ...lines.slice(segment.bodyEnd)].join('\n')
}
