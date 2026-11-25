/**
 * REQ-041 L2：**ref → 视频 URL** 的唯一建索引点（纯函数，可行为测试）。
 *
 * 只按 `ref` 建索引，绝不从清洗后的 `id` 或数组序号反推 —— 中文 id / 过期段表
 * 会让产物 id 与卡上 `segmentRef` 对不上，静默配错屏比没有视频更糟。
 */
import type { SegmentMediaByRef, SegmentMediaItem } from './contracts/segment-media.js'

export function segmentMediaByRefOf(items: readonly SegmentMediaItem[]): SegmentMediaByRef {
  const map = new Map<string, string>()
  for (const item of items) {
    if (item.ref === undefined || item.ref === '') continue
    map.set(item.ref, `${item.url}?v=${String(item.v)}`)
  }
  return map
}
