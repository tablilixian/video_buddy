/**
 * RQ-038 · R11-C1（分镜渲染架构 Phase 1）· **分镜切片器**（纯函数）。
 *
 * ## 解决什么
 *
 * 用户拍板（2026-11-15）：按分镜组织内容、分镜级渲染（改一处只重渲一处）。
 * 本模块把一份整片 manifest 按**屏边界**切成若干段的**渲染活跃集**：
 * 每段 = 该段帧窗内可见的轨子集，**帧号保持绝对**（不重排时间）——渲染时用
 * frameRange 只渲段内帧，拼接后与整片逐帧一致。
 *
 * ## 设计要点（与需求文档 §C1 的实现偏差，如实记录）
 *
 * - 文档原稿写「sharedTracks 裁剪 + tailOverlap 裁剪版」；实现改为**活跃集过滤 +
 *   绝对帧号 + frameRange 渲染**：段 = `startFrame < end && start+dur > segStart`
 *   的轨子集，渲染器只渲请求帧窗——跨段轨（bg/carry）天然在每段重复出现，
 *   转场尾帧（下一屏轨在 [b−T, b) 的入场）天然落在前段活跃集。语义与 D2
 *   （转场窗归前段）完全一致，实现少两类裁剪重建。
 * - 边界来源四级回退（D4 / R11 · O-2）：**manifest 段表** → spec sections 派生 →
 *   transition 轨末端 → 单段回退。
 *   `meta.segments` 是唯一知道「转场预卷后真实段窗」的数据（190/390 而非 200/400），
 *   有它就优先用；spec 派生是旧 manifest 的回退。**transition 末端是启发式**：
 *   手写 manifest 的中途叠化会被当成边界——已知限制，文档如实登记。
 *
 * 纪律：纯函数、无 IO、无时钟；非法边界**回退单段**而不是抛错（分镜渲染是优化，
 * 任何不确定性都落回「与今天逐字段一致」的整片路径——fail-safe）。
 */
import type { CompositionManifest } from './remotion/manifest.js'
import { planStages } from './remotion/stage-plan.js'

/** 相邻边界的最小段长（帧）：低于此值的段是切片噪声，丢弃该边界。 */
export const MIN_SHOT_FRAMES = 30

export type ShotBoundarySource = 'segments' | 'spec' | 'transition' | 'fallback-single'

export interface ShotSegment {
  /** 段序号（按时间升序，0 起）。 */
  index: number
  /** 段首帧（含，绝对帧号）。 */
  startFrame: number
  /** 段末帧（不含，绝对帧号）。 */
  endFrame: number
  /** 本段帧窗内可见的轨（绝对帧号原样保留；跨段轨会在多个段重复出现）。 */
  tracks: CompositionManifest['tracks']
}

export interface ShotSliceResult {
  segments: ShotSegment[]
  boundarySource: ShotBoundarySource
}

/**
 * 从 spec JSON（`build/spec.json`，模型 write 落盘的 ContentSpec）派生屏边界（帧）。
 * - `autoStages: true` → `planStages` 的屏起点（与 planFromSpec 同一函数，必然一致）；
 * - 否则复刻 planRecipe 的权重切分（前 n−1 段 round、末段吃余数）取累积起点。
 * 派生不出（缺 durationSec / sections 非法 / 边界越界）→ null。
 */
export function boundariesFromSpec(spec: unknown, totalFrames: number, fps: number): number[] | null {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return null
  const meta = (spec as { meta?: unknown }).meta
  const sections = (spec as { sections?: unknown }).sections
  if (meta === null || typeof meta !== 'object' || !Array.isArray(sections) || sections.length === 0) return null
  const m = meta as { durationSec?: unknown; fps?: unknown; autoStages?: unknown }
  const durationSec = typeof m.durationSec === 'number' && m.durationSec > 0 ? m.durationSec : null
  const specFps = typeof m.fps === 'number' && m.fps >= 1 ? m.fps : fps
  if (durationSec === null) return null
  const total = Math.round(durationSec * specFps)
  if (total !== totalFrames) return null // spec 与被渲 manifest 时长不一致 → 视为过期，不用

  if (m.autoStages === true) {
    const plan = planStages({ totalSeconds: durationSec, fps: specFps })
    return plan.stages.slice(1).map((stage) => stage.startFrame)
  }
  // 非 autoStages：复刻 planRecipe 的权重切分（前 n−1 段 round、末段吃余数）
  const weights = sections.map((sec) => {
    const s = (sec ?? {}) as { durationSec?: unknown; weight?: unknown }
    if (typeof s.durationSec === 'number' && s.durationSec > 0) return s.durationSec
    if (typeof s.weight === 'number' && s.weight > 0) return s.weight
    return 1
  })
  const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0) || 1
  const cuts: number[] = []
  let cursor = 0
  for (let i = 0; i < weights.length - 1; i++) {
    cursor += Math.max(1, Math.round((Math.max(0, weights[i] as number) / totalWeight) * totalFrames))
    cuts.push(cursor)
  }
  return cuts
}

/**
 * R11 · O-2：把 `meta.segments` 折成切点；**不自洽就整表不用**。
 *
 * 自洽判据（任一不满足返回 `[]`，让调用方回退旧路径）：
 * ① 段数 ≥ 2；② 每段 `frames > 0`；③ 首段从 0 起、相邻段首尾相接；
 * ④ Σ frames == `meta.durationInFrames`。过期 manifest（改过时长但没重建段表）
 * 会在这里被挡住——这是「宁可不切，也不能切错」的那道闸。
 */
function segmentTableCuts(manifest: CompositionManifest): number[] {
  const segments = manifest.meta?.segments
  if (!Array.isArray(segments) || segments.length < 2) return []
  const total = Math.max(1, Math.floor(manifest.meta?.durationInFrames ?? 0))
  const cuts: number[] = []
  let cursor = 0
  for (const segment of segments) {
    const start = typeof segment?.startFrame === 'number' ? Math.round(segment.startFrame) : Number.NaN
    const frames = typeof segment?.frames === 'number' ? Math.round(segment.frames) : Number.NaN
    if (!Number.isInteger(start) || !Number.isInteger(frames) || frames <= 0) return []
    if (start !== cursor) return []
    cursor = start + frames
    if (start > 0) cuts.push(start)
  }
  return cursor === total ? cuts : []
}

/**
 * 边界来源四级回退：**manifest 段表** → spec 派生 → transition 轨末端 → 单段回退。
 * transition 末端是启发式：手写 manifest 的中途叠化会被当成边界——已知限制（§模块头）。
 */
export function resolveShotBoundaries(
  manifest: CompositionManifest,
  specBoundaries: number[] | null | undefined,
): { cuts: number[]; source: ShotBoundarySource } {
  const totalFrames = Math.max(1, Math.floor(manifest.meta?.durationInFrames ?? 0))
  const candidates: Array<{ cuts: number[]; source: ShotBoundarySource }> = []
  // R11 · O-2：段表优先 —— 它是唯一知道「转场预卷后真实段窗」的数据。
  const declaredCuts = segmentTableCuts(manifest)
  if (declaredCuts.length > 0) candidates.push({ cuts: declaredCuts, source: 'segments' })
  if (Array.isArray(specBoundaries) && specBoundaries.length > 0) {
    candidates.push({ cuts: specBoundaries.filter((v) => Number.isFinite(v)).map((v) => Math.round(v)), source: 'spec' })
  }
  const transitionEnds = (Array.isArray(manifest.tracks) ? manifest.tracks : [])
    .filter((t) => (t as { type?: unknown }).type === 'transition')
    .map((t) => Math.round((t as { startFrame?: number }).startFrame ?? 0) + Math.round((t as { durationInFrames?: number }).durationInFrames ?? 0))
    .filter((end) => end > 0 && end < totalFrames)
    .sort((a, b) => a - b)
  if (transitionEnds.length > 0) candidates.push({ cuts: [...new Set(transitionEnds)], source: 'transition' })

  for (const { cuts, source } of candidates) {
    const valid = sanitizeCuts(cuts, totalFrames)
    if (valid.length > 0) return { cuts: valid, source }
  }
  return { cuts: [], source: 'fallback-single' }
}

/** 边界消毒：范围内、严格升序、段长 ≥ MIN_SHOT_FRAMES；不满足的边界丢弃。 */
function sanitizeCuts(cuts: readonly number[], totalFrames: number): number[] {
  const out: number[] = []
  let prev = 0
  for (const cut of cuts) {
    if (cut <= prev || cut > totalFrames - MIN_SHOT_FRAMES) continue
    if (cut - prev < MIN_SHOT_FRAMES) continue
    out.push(cut)
    prev = cut
  }
  if (totalFrames - prev < MIN_SHOT_FRAMES) out.pop()
  return out
}

/** 轨在段窗 [start, end) 内是否可见（半开区间，与 frameRange 渲染口径一致）。 */
function trackVisibleIn(track: CompositionManifest['tracks'][number], start: number, end: number): boolean {
  const s = (track as { startFrame?: unknown }).startFrame
  const d = (track as { durationInFrames?: unknown }).durationInFrames
  const startFrame = typeof s === 'number' && Number.isFinite(s) ? s : 0
  const duration = typeof d === 'number' && Number.isFinite(d) ? d : 0
  return startFrame < end && startFrame + duration > start
}

/**
 * 按边界切渲染活跃集。**帧号保持绝对**——每段是原 manifest 的轨子集，
 * 渲染时用 frameRange [start, end) 只渲段内帧；跨段轨（bg/carry）在多个段
 * 重复出现，拼接后与整片逐帧一致。
 *
 * cuts 为空（或消毒后为空）⇒ 单段整片（与不切片等价）。
 */
export function sliceByShots(manifest: CompositionManifest, cuts: readonly number[]): ShotSliceResult {
  const totalFrames = Math.max(1, Math.floor(manifest.meta?.durationInFrames ?? 0))
  const valid = sanitizeCuts(cuts, totalFrames)
  const starts = [0, ...valid]
  const ends = [...valid, totalFrames]
  const allTracks = Array.isArray(manifest.tracks) ? manifest.tracks : []
  const segments: ShotSegment[] = starts.map((start, i) => ({
    index: i,
    startFrame: start,
    endFrame: ends[i] as number,
    tracks: allTracks.filter((track) => trackVisibleIn(track, start, ends[i] as number)),
  }))
  const source: ShotBoundarySource = valid.length === 0 ? 'fallback-single' : 'transition'
  return { segments, boundarySource: source }
}
