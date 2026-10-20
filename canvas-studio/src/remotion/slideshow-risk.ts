/**
 * REQ-034（Remotion 集成）· B5 纯函数层：OpenMontage 6 维「幻灯片伪装视频」风险评分
 * （devdoc §9.2）。零 Remotion 依赖，可 `node --test` 直接断言。
 *
 * 产物 score ≥ 60 → 给用户可见 warning（并入 `ComposeToolResult.warnings`），**不阻断**渲染。
 */

import { hasVoiceOverAudio, type CompositionManifest, type CompositionTrack } from './manifest.js'

/** 评分维度；`weight` 之和为 100。 */
export interface SlideshowRiskDimension {
  name: string
  weight: number
  hit: boolean
  note: string
}

/**
 * 风险形态（2026-10-16 补判）：
 * - `card-based` —— **全片无 video 轨**、由图文卡片 / 形状 / 静态图构成。这是知识型短片
 *   的**合法形态**（REQ-034 G2：30s 成片 0 次视频模型调用），文案必须与「假视频」区分；
 * - `slideshow` —— 有 video 轨但运动 / 镜头数不足，仍按「幻灯片伪装视频」口径告警。
 */
export type SlideshowRiskKind = 'slideshow' | 'card-based'

export interface SlideshowRisk {
  /** 0–100，越高越像「假视频」。 */
  score: number
  /** 判定形态；文案据此分流。 */
  kind: SlideshowRiskKind
  /** score ≥ 60 时给出的用户可见告警文案。 */
  warning?: string
  dims: SlideshowRiskDimension[]
}

export const SLIDESHOW_RISK_WARNING_THRESHOLD = 60

const STATIC_RATIO_THRESHOLD = 0.7
const MOTION_RATIO_THRESHOLD = 0.2
const RHYTHM_STDDEV_SEC = 0.5

function durationOf(track: CompositionTrack): number {
  return track.durationInFrames
}

function totalDuration(manifest: CompositionManifest): number {
  const declared = manifest.meta?.durationInFrames
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) return declared
  return manifest.tracks.reduce((max, track) => Math.max(max, track.startFrame + track.durationInFrames), 0)
}

function populationStddev(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** 轨道的半开帧区间 `[startFrame, startFrame + durationInFrames)`。 */
function rangeOf(track: CompositionTrack): { start: number; end: number } {
  return { start: track.startFrame, end: track.startFrame + durationOf(track) }
}

/**
 * 一组帧区间的**并集**覆盖帧数（裁切到 `[0, limit]`）。
 *
 * ⚠️ 必须用并集而非求和：多轨叠放（字幕卡压在图片上、或相邻两轨交叠做转场）时求和会把
 * 同一帧算两次 —— 实测「纯图文卡片片」的静态占比能算到 **119%**，占比大于 100% 本身就
 * 说明口径错了（2026-10-16 取证）。
 */
function coveredFrames(ranges: readonly { start: number; end: number }[], limit: number): number {
  const clipped = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(limit, range.end) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
  let covered = 0
  let cursor = 0
  for (const range of clipped) {
    if (range.start >= cursor) {
      covered += range.end - range.start
      cursor = range.end
    } else if (range.end > cursor) {
      // 与已覆盖区间重叠：只补重叠之后的尾部。
      covered += range.end - cursor
      cursor = range.end
    }
  }
  return covered
}

/**
 * 6 维防「幻灯片伪装视频」（§9.2）：
 * 1) 静态占比：图片/文本卡**覆盖时长**（区间并集）÷ 成片时长 > 70% → 高风险；
 * 2) 运动密度：无 video 轨或 video 覆盖占比 < 20% → 风险；
 * 3) 转场多样性：无转场或全是 fade → 风险；
 * 4) 镜头数：video 轨数 < 阈值（≥60s 要 5 个，否则 3 个）→ 风险；
 * 5) 字幕/解说覆盖：无 voiceOver 且无 textCard → 风险；
 * 6) 节奏单调：**内容轨**时长标准差 < 0.5s（全是等长卡）→ 风险。
 *    内容轨 = video / image / textCard 且**不覆盖全片** —— 排除 `shape`（背景色块 / 分隔线
 *    属装饰，不是镜头）与全长背景板；否则一个全程铺底的 shape 就能把标准差拉到 8s 以上，
 *    该维**恒不命中**（2026-10-16 实测）。
 */
export function scoreSlideshowRisk(manifest: CompositionManifest): SlideshowRisk {
  const duration = totalDuration(manifest)
  const fps = manifest.meta?.fps || 30
  const durationSec = duration / fps

  const imageTracks = manifest.tracks.filter((t) => t.type === 'image')
  const videoTracks = manifest.tracks.filter((t) => t.type === 'video')
  const textTracks = manifest.tracks.filter((t) => t.type === 'textCard')
  const transitionTracks = manifest.tracks.filter((t) => t.type === 'transition')

  const staticFrames = coveredFrames(
    [...imageTracks, ...textTracks].map(rangeOf),
    duration,
  )
  const staticRatio = duration > 0 ? staticFrames / duration : 0
  const videoFrames = coveredFrames(videoTracks.map(rangeOf), duration)
  const videoRatio = duration > 0 ? videoFrames / duration : 0

  const fadeOnly = transitionTracks.length === 0 || transitionTracks.every((t) => t.effect === 'fade')
  const requiredShots = durationSec >= 60 ? 5 : 3
  // O-10：单轨与多轨旁白同一判定（`hasVoiceOverAudio` 是唯一实现）。
  const hasVoiceOver = hasVoiceOverAudio(manifest.audio)
  const rhythmTracks = manifest.tracks.filter(
    (t) => (t.type === 'video' || t.type === 'image' || t.type === 'textCard') && durationOf(t) < duration,
  )
  const rhythmFrames = rhythmTracks.map(durationOf)
  const rhythmStddevSec = rhythmFrames.length >= 2 ? populationStddev(rhythmFrames) / fps : Number.NaN

  const dims: SlideshowRiskDimension[] = [
    {
      name: '静态占比',
      weight: 30,
      hit: staticRatio > STATIC_RATIO_THRESHOLD,
      note: `图片+文本卡覆盖 ${(staticRatio * 100).toFixed(0)}%（阈值 ${STATIC_RATIO_THRESHOLD * 100}%）`,
    },
    {
      name: '运动密度',
      weight: 25,
      hit: videoTracks.length < 1 || videoRatio < MOTION_RATIO_THRESHOLD,
      note: `video 轨 ${videoTracks.length} 条、覆盖 ${(videoRatio * 100).toFixed(0)}%（阈值 ${MOTION_RATIO_THRESHOLD * 100}%）`,
    },
    {
      name: '转场多样性',
      weight: 10,
      hit: fadeOnly,
      note: transitionTracks.length === 0 ? '无转场' : `转场效果：${[...new Set(transitionTracks.map((t) => t.effect))].join('/')}`,
    },
    {
      name: '镜头数',
      weight: 15,
      hit: videoTracks.length < requiredShots,
      note: `video 轨 ${videoTracks.length} 条（${durationSec >= 60 ? '≥60s' : '<60s'} 阈值 ${requiredShots}）`,
    },
    {
      name: '字幕/解说覆盖',
      weight: 10,
      hit: !hasVoiceOver && textTracks.length === 0,
      note: hasVoiceOver ? '有旁白' : textTracks.length > 0 ? `有 ${textTracks.length} 张文本卡` : '既无旁白也无文本卡',
    },
    {
      name: '节奏单调',
      weight: 10,
      hit: Number.isFinite(rhythmStddevSec) && rhythmStddevSec < RHYTHM_STDDEV_SEC,
      note: Number.isFinite(rhythmStddevSec)
        ? `内容轨时长标准差 ${rhythmStddevSec.toFixed(2)}s（阈值 ${RHYTHM_STDDEV_SEC}s）`
        : '内容轨不足 2 条，不判',
    },
  ]

  // 形态判定：全片无 video 轨 + 有文本卡 = 刻意的图文卡片型（而不是「伪装成视频的幻灯片」）。
  const kind: SlideshowRiskKind = videoTracks.length === 0 && textTracks.length > 0 ? 'card-based' : 'slideshow'

  const score = Math.min(100, dims.reduce((sum, dim) => sum + (dim.hit ? dim.weight : 0), 0))
  if (score < SLIDESHOW_RISK_WARNING_THRESHOLD) return { score, kind, dims }

  const hits = dims.filter((d) => d.hit).map((d) => d.name).join('、')
  // 文案必须给**方向正确**的建议：图文卡片型的解药是「让卡动起来」，不是「去生成视频片段」
  // —— 后者与本产品「零视频模型调用出片」的路线相反，而「实拍」在本产品根本没有入口
  // （2026-10-16 取证）。
  const warning = kind === 'card-based'
    ? `成片为图文卡片型（全片无视频片段；命中：${hits}）。这条路线是合法的，但画面全程静态：`
      + '可加卡内动画 / KenBurns 缓推 / 差异化转场削弱静态感；确需视频片段时再补 video 轨。'
    : `成片偏向幻灯片（${hits}）：静态画面占比过高、运动与镜头数不足。`
      + '建议增加视频片段 / KenBurns 缓推 / 卡内动画，并让转场多样化。'
  return { score, kind, warning, dims }
}
