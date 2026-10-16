/**
 * REQ-034（Remotion 集成）· B5 纯函数层：OpenMontage 6 维「幻灯片伪装视频」风险评分
 * （devdoc §9.2）。零 Remotion 依赖，可 `node --test` 直接断言。
 *
 * 产物 score ≥ 60 → 给用户可见 warning（并入 `ComposeToolResult.warnings`），**不阻断**渲染。
 */

import type { CompositionManifest, CompositionTrack } from './manifest.js'

/** 评分维度；`weight` 之和为 100。 */
export interface SlideshowRiskDimension {
  name: string
  weight: number
  hit: boolean
  note: string
}

export interface SlideshowRisk {
  /** 0–100，越高越像「假视频」。 */
  score: number
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

/**
 * 6 维防「幻灯片伪装视频」（§9.2）：
 * 1) 静态占比：图片/文本卡总时长 ÷ 成片时长 > 70% → 高风险；
 * 2) 运动密度：无 video 轨或 video 总时长占比 < 20% → 风险；
 * 3) 转场多样性：无转场或全是 fade → 风险；
 * 4) 镜头数：video 轨数 < 阈值（≥60s 要 5 个，否则 3 个）→ 风险；
 * 5) 字幕/解说覆盖：无 voiceOver 且无 textCard → 风险；
 * 6) 节奏单调：内容轨时长标准差 < 0.5s（全是等长卡）→ 风险。
 */
export function scoreSlideshowRisk(manifest: CompositionManifest): SlideshowRisk {
  const duration = totalDuration(manifest)
  const durationSec = duration / (manifest.meta?.fps || 30)

  const imageTracks = manifest.tracks.filter((t) => t.type === 'image')
  const videoTracks = manifest.tracks.filter((t) => t.type === 'video')
  const textTracks = manifest.tracks.filter((t) => t.type === 'textCard')
  const transitionTracks = manifest.tracks.filter((t) => t.type === 'transition')

  const staticFrames = [...imageTracks, ...textTracks].reduce((sum, t) => sum + durationOf(t), 0)
  const staticRatio = duration > 0 ? staticFrames / duration : 0
  const videoFrames = videoTracks.reduce((sum, t) => sum + durationOf(t), 0)
  const videoRatio = duration > 0 ? videoFrames / duration : 0

  const fadeOnly = transitionTracks.length === 0 || transitionTracks.every((t) => t.effect === 'fade')
  const requiredShots = durationSec >= 60 ? 5 : 3
  const hasVoiceOver = typeof manifest.audio?.voiceOverUrl === 'string' && manifest.audio.voiceOverUrl.length > 0
  const contentTracks = manifest.tracks.filter((t) => t.type !== 'transition')
  const rhythmFrames = contentTracks.map(durationOf)
  const rhythmStddevSec = rhythmFrames.length >= 2 ? populationStddev(rhythmFrames) / (manifest.meta?.fps || 30) : Number.NaN

  const dims: SlideshowRiskDimension[] = [
    {
      name: '静态占比',
      weight: 30,
      hit: staticRatio > STATIC_RATIO_THRESHOLD,
      note: `图片+文本卡占 ${(staticRatio * 100).toFixed(0)}%（阈值 ${STATIC_RATIO_THRESHOLD * 100}%）`,
    },
    {
      name: '运动密度',
      weight: 25,
      hit: videoTracks.length < 1 || videoRatio < MOTION_RATIO_THRESHOLD,
      note: `video 轨 ${videoTracks.length} 条、时长占 ${(videoRatio * 100).toFixed(0)}%（阈值 ${MOTION_RATIO_THRESHOLD * 100}%）`,
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

  const score = Math.min(100, dims.reduce((sum, dim) => sum + (dim.hit ? dim.weight : 0), 0))
  if (score >= SLIDESHOW_RISK_WARNING_THRESHOLD) {
    const hits = dims.filter((d) => d.hit).map((d) => d.name).join('、')
    return { score, warning: `成片偏向幻灯片（${hits}），建议增加实拍/生成视频片段`, dims }
  }
  return { score, dims }
}
