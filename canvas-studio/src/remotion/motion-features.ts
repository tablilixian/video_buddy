/**
 * #11 运动口径 SSOT（2026-11-05，CV-438 批次）。
 *
 * 背景：同一份 manifest 曾被四处各算各的 —— `trackIsAnimated` 是布尔、
 * `collectAnimationWindows` 是三字段清单、ML-10 是帧区间并集、slideshow-risk
 * 是 6 维评分。结果是渲染报告说「35 轨在动」、静态提示却说「画面全程静态」、
 * 体检恒报 ML-02 硬切。**加能力不改配套**（CV-428 加 `reveal.out` 时没同步
 * 任何一处判据）是这类漂移的根因。
 *
 * 本模块是「这条轨有哪些动效、动在哪些帧」的**唯一读数入口**；四处一律从这里
 * 派生，不再各自读字段。`MOTION_FIELD_KINDS` 是漂移检查靶：新增动效字段若没进
 * 这张表，`tests/remotion-motion-features.test.mjs` 会红。
 *
 * 输出语义分三路，互不混淆：
 * - `animated` —— 布尔，给 Q3 覆盖计数（`trackIsAnimated`）。
 * - `windowKinds` —— 显式动效种类，给 QC 窗口表（不含「素材自带运动」，
 *   否则视频/字幕轨会把窗口表撑满，正是会话 15 的 35 轨噪声）。
 * - `intervals` —— 绝对帧运动区间（带 kind），给 ML-10 并集算屏幕时间。
 */
import type { CompositionTrack } from './manifest.js'
import { exitWindow } from './timing.js'
import { REVEAL_DEFAULT_DURATION_FRAMES } from './reveal.js'

/** 所有已知动效字段种类（漂移检查白名单，新增字段必须同步登记）。 */
export const MOTION_FIELD_KINDS = [
  'animate', 'exit', 'orbit', 'reveal', 'revealOut',
  'kenburns', 'anim', 'draw', 'intrinsic',
] as const
export type MotionFieldKind = typeof MOTION_FIELD_KINDS[number]

/** 绝对帧运动区间。 */
export interface MotionInterval {
  start: number
  end: number
  kind: string
}

export interface TrackMotionFeatures {
  /** 这条轨算不算「动画轨」（Q3 覆盖计数口径）。 */
  animated: boolean
  /** 显式动效种类，供 QC 窗口表；不含 intrinsic。 */
  windowKinds: string[]
  /** 全部运动区间（绝对帧），供 ML-10 并集。 */
  intervals: MotionInterval[]
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 素材自带运动：整轨都在动，但不进 QC 窗口表。 */
const INTRINSIC_TYPES = new Set(['video', 'caption', 'chart', 'audioViz'])

export function trackMotionFeatures(track: CompositionTrack): TrackMotionFeatures {
  const duration = Math.max(1, Math.floor(track.durationInFrames))
  const base = track.startFrame
  const wholeEnd = base + duration
  const intervals: MotionInterval[] = []
  const windowKinds: string[] = []

  const addWindow = (kind: string, start: number, end: number): void => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    windowKinds.push(kind)
    intervals.push({ start, end, kind })
  }
  const addWhole = (kind: string): void => { intervals.push({ start: base, end: wholeEnd, kind }) }

  // ① animate（单段或数组；与 collectSegments 同口径）
  const rawAnimate = (track as { animate?: unknown }).animate
  const animateList = Array.isArray(rawAnimate) ? rawAnimate : rawAnimate === undefined ? [] : [rawAnimate]
  for (const seg of animateList) {
    if (!isRecord(seg)) continue
    const start = base + (numeric(seg.startFrame) ?? 0)
    const dur = numeric(seg.durationInFrames) ?? duration
    addWindow('animate', start, start + Math.max(0, dur))
  }

  // ② exit（退场窗口）
  const exit = exitWindow(track)
  if (exit !== null) {
    const start = base + exit.start
    addWindow('exit', start, start + Math.max(0, exit.duration))
  }

  // ③ orbit（整轨旋转）
  if ((track as { orbit?: unknown }).orbit !== undefined) addWindow('orbit', base, wholeEnd)

  // ④ reveal 进场 + reveal.out 退场（CV-428 新增能力，旧判据两处都漏）
  // CompositionTrack 的 reveal 是具名 TrackReveal（无索引签名），先经 unknown 再收窄。
  const reveal = (track as unknown as { reveal?: Record<string, unknown> }).reveal
  if (isRecord(reveal)) {
    const start = base + (numeric(reveal.startFrame) ?? 0)
    const dur = numeric(reveal.durationInFrames) ?? REVEAL_DEFAULT_DURATION_FRAMES
    addWindow('reveal', start, start + Math.max(0, dur))
    const out = reveal.out
    if (isRecord(out)) {
      const outStart = base + (numeric(out.startFrame) ?? Math.max(0, duration - (numeric(out.durationInFrames) ?? REVEAL_DEFAULT_DURATION_FRAMES)))
      const outDur = numeric(out.durationInFrames) ?? REVEAL_DEFAULT_DURATION_FRAMES
      addWindow('revealOut', outStart, outStart + Math.max(0, outDur))
    }
  }

  // ⑤ 轨型专属动效
  if (track.type === 'image' && (track as { fit?: unknown }).fit === 'kenburns') addWindow('kenburns', base, wholeEnd)
  if (track.type === 'textCard' && (track as { anim?: unknown }).anim !== undefined) addWindow('anim', base, wholeEnd)
  if (track.type === 'shape' && (track as { draw?: unknown }).draw !== undefined) addWindow('draw', base, wholeEnd)

  // ⑥ 素材自带运动（整轨），kind 带轨型便于 ML-10 只取 video
  if (INTRINSIC_TYPES.has(track.type)) addWhole(`intrinsic:${track.type}`)

  const animated = track.type !== 'transition'
    && (windowKinds.length > 0 || intervals.length > 0)
  return { animated, windowKinds, intervals }
}

/** ML-10 分子口径：与旧实现一致（video 全时长 + animate / exit / reveal / revealOut），另补 kenburns。 */
export const ML10_INTERVAL_KINDS = new Set([
  'animate', 'exit', 'reveal', 'revealOut', 'kenburns', 'anim', 'draw', 'intrinsic:video',
])

export function motionIntervalsFor(track: CompositionTrack): MotionInterval[] {
  return trackMotionFeatures(track).intervals.filter((iv) => ML10_INTERVAL_KINDS.has(iv.kind))
}
