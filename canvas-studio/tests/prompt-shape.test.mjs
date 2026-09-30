/**
 * REQ-003 Step 3 / D 组：提示词形态判定与 H3-IR 分段（纯函数直连，参照 canvas-view.test.mjs）。
 *
 * D1 的分档是**由内容算**的机器判据，阈值边界必须钉死；D3 的分段编辑按行号
 * splice 回原文 —— 未触碰的段落必须**逐字节**原样（提示词是重放参数，字节漂移
 * 就是语义漂移）。
 *
 * 运行：corepack yarn test:smoke（先 corepack yarn build —— 从 ../lib 导入）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IR_SEGMENT_LINE_RE,
  PROMPT_PREVIEW_LINES,
  PROMPT_SHORT_MAX_CHARS,
  PROMPT_SHORT_MAX_LINES,
  irReplaceSegment,
  irSegmentBody,
  irSegmentize,
  promptLineCount,
  promptShapeOf,
} from '../lib/prompt-shape.js'

test('D1 阈值边界：8 行且 240 字以内是 short，任一越线就是 long', () => {
  assert.equal(PROMPT_SHORT_MAX_LINES, 8)
  assert.equal(PROMPT_SHORT_MAX_CHARS, 240)
  assert.equal(PROMPT_PREVIEW_LINES, 3)
  const sevenLines = Array.from({ length: 7 }, (_, i) => `第 ${i} 行`).join('\n')
  assert.equal(promptLineCount(sevenLines), 7)
  assert.equal(promptShapeOf(sevenLines), 'short')
  // 恰好 8 行（边界值）仍是 short。
  const eightLines = `${sevenLines}\n第 8 行`
  assert.equal(promptShapeOf(eightLines), 'short')
  // 行数越线。
  const nineLines = `${eightLines}\n第 9 行`
  assert.equal(promptShapeOf(nineLines), 'long')
  // 字符数越线（8 行以内但超 240 字）。
  const longSingleLine = '字'.repeat(PROMPT_SHORT_MAX_CHARS + 1)
  assert.equal(promptShapeOf(longSingleLine), 'long')
  // 恰好 240 字仍是 short。
  assert.equal(promptShapeOf('字'.repeat(PROMPT_SHORT_MAX_CHARS)), 'short')
  assert.equal(promptShapeOf('短句'), 'short')
  assert.equal(promptShapeOf(''), 'short')
})

test('D1 判据优先级：命中 IR 段名行或 Picture N 就是 ir（即使超过长文本阈值）', () => {
  assert.equal(promptShapeOf('integrated_multimodal_description:\n镜头自低角度缓推'), 'ir')
  assert.equal(promptShapeOf('<Picture 1> 作为首帧'), 'ir')
  // 小写段名行允许尾随空格；大写/含点的不算段名行。
  assert.match('subject_definitions:', IR_SEGMENT_LINE_RE)
  assert.match('subject_definitions:  ', IR_SEGMENT_LINE_RE)
  assert.doesNotMatch('Subject_Definitions:', IR_SEGMENT_LINE_RE)
  // 段名行在中间也判 ir（不是只看开头）。
  assert.equal(promptShapeOf('开头正文\nalignment:\n0.0s-2.0s'), 'ir')
})

test('D3 无损分段：段名 / 正文段 / 段尾空行分隔的行号区间', () => {
  const text = 'para one\n\nsubject_definitions:\nline a\nline b\n\ndetailed_description:\nline c\n'
  const segments = irSegmentize(text)
  assert.deepEqual(segments.map(segment => segment.name), [null, 'subject_definitions', 'detailed_description'])
  const [preamble, subject, detailed] = segments
  // 正文段：段名行之前，只有第 0 行（第 1 行是空行分隔，不属于段体）。
  assert.deepEqual([preamble.headLine, preamble.bodyStart, preamble.bodyEnd], [-1, 0, 1])
  // 段名行在 2；段体 3..5（第 5 行的空行是分隔，不在段体里）。
  assert.deepEqual([subject.headLine, subject.bodyStart, subject.bodyEnd], [2, 3, 5])
  assert.deepEqual([detailed.headLine, detailed.bodyStart, detailed.bodyEnd], [6, 7, 8])
  // 段体读取：不含段名行与分隔空行。
  assert.equal(irSegmentBody(text, subject), 'line a\nline b')
  assert.equal(irSegmentBody(text, detailed), 'line c')
})

test('D3 无损改段：只动目标段的行，其余文本逐字节保持', () => {
  const text = 'para one\n\nsubject_definitions:\nline a\nline b\n\ndetailed_description:\nline c\n'
  const [, subject] = irSegmentize(text)
  const next = irReplaceSegment(text, subject, 'line a（改过）')
  // 目标段变了。
  assert.match(next, /line a（改过）/)
  // 其余部分逐字节原样：段名、分隔空行、前后段、末尾换行全都在。
  assert.ok(next.startsWith('para one\n\nsubject_definitions:\n'))
  assert.ok(next.endsWith('\n\ndetailed_description:\nline c\n'))
  // 改完再分段，段数不变、行号仍然对得上（可继续编辑下一段）。
  const reSegmented = irSegmentize(next)
  assert.equal(reSegmented.length, 3)
  assert.equal(irSegmentBody(next, reSegmented[1]), 'line a（改过）')
  // 段体清空也安全：分隔空行保留，段结构不塌。
  const emptied = irReplaceSegment(text, subject, '')
  assert.match(emptied, /subject_definitions:\n\ndetailed_description:/)
})

test('D3 退化形态：无段名 / 无段落 / 全空行也能分段且不丢内容', () => {
  // 无段名行 → 单个匿名段覆盖全部非空内容。
  const plain = irSegmentize('第一行\n第二行')
  assert.equal(plain.length, 1)
  assert.equal(plain[0].name, null)
  assert.equal(irSegmentBody('第一行\n第二行', plain[0]), '第一行\n第二行')
  // 全空行 → 段体为空。
  const blanks = irSegmentize('\n\n')
  assert.equal(blanks[0].bodyEnd, 0)
  // 空字符串安全。
  assert.equal(irSegmentize('').length, 1)
})
