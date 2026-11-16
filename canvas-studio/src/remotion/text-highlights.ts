/**
 * R11（2026-11-16）· **分段着色**（`textCard.highlights`）的切分逻辑。
 *
 * ## 为什么单独一个文件
 *
 * 切分规则是「契约的语义」，不是渲染细节：校验（`manifest.ts` 判断哪项被跳过）、
 * 折行体检、渲染三处必须得到**同一份结果**。放在组件里就注定被复制成两份，
 * 然后两份各自漂移 —— 仓内已有先例（`chart-layout` 的「只能有一把尺子」）。
 *
 * ## 口径
 *
 * - 命中 = `indexOf` **第一处**，不做正则、不做大小写折叠（模型写什么就是什么）；
 * - 找不到的项**跳过**（校验期已 warn，这里不重复报）；
 * - 与已占用区间重叠的项**跳过**（先声明的优先）；
 * - 没有高亮 / 全部无效 ⇒ 返回单段且**不带 color**，让调用方走老渲染路径。
 */

export interface TextHighlightSpec {
  readonly text: string
  readonly color: string
}

/** 一段可渲染文本（`color` 缺省 = 沿用主文本色）。 */
export interface TextSegment {
  readonly text: string
  readonly color?: string
}

/**
 * 把 `text` 按高亮切成有序段。
 *
 * 示例：`splitByHighlights('继续，还是回来', [{text:'继续',color:'#F5A623'},{text:'回来',color:'#2EE6A8'}])`
 * ⇒ `[{text:'继续',color:'#F5A623'},{text:'，还是'},{text:'回来',color:'#2EE6A8'}]`
 */
export function splitByHighlights(
  text: string,
  highlights: readonly TextHighlightSpec[] | undefined,
): TextSegment[] {
  if (highlights === undefined || highlights.length === 0) return [{ text }]
  const taken: Array<{ start: number; end: number; color: string }> = []
  for (const entry of highlights) {
    if (typeof entry?.text !== 'string' || entry.text === '' || typeof entry.color !== 'string' || entry.color === '') continue
    const start = text.indexOf(entry.text)
    if (start < 0) continue
    const end = start + entry.text.length
    if (taken.some((range) => start < range.end && end > range.start)) continue
    taken.push({ start, end, color: entry.color })
  }
  if (taken.length === 0) return [{ text }]
  taken.sort((a, b) => a.start - b.start)

  const out: TextSegment[] = []
  let cursor = 0
  for (const range of taken) {
    if (range.start > cursor) out.push({ text: text.slice(cursor, range.start) })
    out.push({ text: text.slice(range.start, range.end), color: range.color })
    cursor = range.end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) })
  return out
}
