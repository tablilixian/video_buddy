/**
 * A2（2026-10-31）：chart 轨的**时间线数据源** —— `source: 'timeline'` 时从 manifest
 * 的 video 轨真值推导图表数据（bench #04 的原始设计：数据取真实镜头时长，不是假数）。
 *
 * 推导口径：
 * - 镜头 = video 轨，按 `startFrame` 升序（时间线顺序）；durationInFrames 已被宿主
 *   按 ffprobe 真值校正 ⇒ 图表反映的是校正后的真时长；
 * - `values` = 每镜时长（秒，两位小数）；`dual` 的 `lineValues` = 累计时长（秒）；
 * - `labels` = `镜1..镜n`（video 轨 id 是画布节点 id，太长不适合当类目轴）；
 * - 单位固定秒。无 video 轨 ⇒ null（校验层会先拒收，这里是组件侧兜底）。
 *
 * 纯函数、可单测；Root.tsx 在渲染时调用并作为 prop 传给 Chart（组件本身不接触 manifest）。
 */
import type { ChartTrack, CompositionManifest, VideoClipTrack } from './manifest.js'

export interface ChartTimelineData {
  labels: string[]
  values: number[]
  lineValues: number[]
  unit: string
  lineUnit: string
}

export function chartDataFromTimeline(manifest: CompositionManifest, _track: ChartTrack): ChartTimelineData | null {
  const fps = manifest.meta.fps > 0 ? manifest.meta.fps : 30
  const shots = manifest.tracks
    .filter((t): t is VideoClipTrack => t.type === 'video')
    .sort((a, b) => a.startFrame - b.startFrame)
  if (shots.length === 0) return null
  const values = shots.map((s) => Number((s.durationInFrames / fps).toFixed(2)))
  const labels = shots.map((_, i) => `镜${i + 1}`)
  const lineValues: number[] = []
  for (const v of values) lineValues.push(Number(((lineValues[lineValues.length - 1] ?? 0) + v).toFixed(2)))
  return { labels, values, lineValues, unit: 's', lineUnit: 's' }
}
