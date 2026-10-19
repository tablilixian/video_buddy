/**
 * 三期 W1-2：`startAfter`（顺序衔接）的**唯一解析点**（纯函数，零 Remotion 依赖）。
 *
 * ## 为什么需要它
 * 每条轨都填绝对 `startFrame` 时，改一句字幕时长，后面所有帧号都要重算 —— 模型必然
 * 算错 1–3 处，而且错得「看起来像渲染 bug」。`startAfter` 把「我接在谁后面」写进契约，
 * 语义从「算术」变成「关系」。
 *
 * ## 三条纪律
 * 1. **只能引用数组中更靠前的轨** ⇒ 天然无环，不需要拓扑排序；自引用 / 前向引用直接报错。
 * 2. **与 `startFrame` 互斥**（同时给 → error）—— 两个来源会让人算不清以哪个为准。
 * 3. 解析在**宿主**完成，渲染器永远看不到 `startAfter`（`Root.tsx` 仍只认数字 `startFrame`）。
 *
 * 返回的是**新数组**（不就地改入参）；无 `startAfter` 时逐轨返回原对象引用，零拷贝。
 */

import type { CompositionManifest, StartAfter } from './manifest.js'

export interface ResolvedStartFrame {
  id: string
  /** 解析后的绝对起始帧。 */
  startFrame: number
  /** 来源：显式帧 or 顺序衔接。 */
  via: 'startFrame' | 'startAfter'
  /** `via='startAfter'` 时的参考轨 id。 */
  refTrackId?: string
  /** `via='startAfter'` 时的空档帧。 */
  gapFrames?: number
}

export interface NormalizeTimingResult {
  manifest: CompositionManifest
  /** 逐轨解析结果（顺序与入参一致）。 */
  resolved: ResolvedStartFrame[]
  errors: string[]
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从原始轨道上读 `startAfter`（容错：非对象返回 `null`）。 */
function readStartAfter(value: unknown): StartAfter | null {
  if (!isRecord(value)) return null
  const trackId = value.trackId
  if (typeof trackId !== 'string' || trackId.length === 0) return null
  const gap = value.gapFrames
  return {
    trackId,
    ...(typeof gap === 'number' && Number.isFinite(gap) ? { gapFrames: gap } : {}),
  }
}

/**
 * 把整份 manifest 的 `startAfter` 解析成数值 `startFrame`（纯函数）。
 *
 * 错误不会抛异常 —— 调用方拿到 `errors` 后决定拒收（`render_composition` 会一并回给模型）。
 * 校验层仍会跑一遍（`validateManifest`），两处分工：这里判「能不能算出来」，
 * 那里判「字段取值合不合法」。
 */
export function normalizeManifestTiming(manifest: CompositionManifest): NormalizeTimingResult {
  const errors: string[] = []
  const warnings: string[] = []
  const resolved: ResolvedStartFrame[] = []
  // id → 已解析的区间（只收**已经排到**的轨，靠后的轨引用不到前面的结果 = 前向引用）。
  const placed = new Map<string, { startFrame: number; durationInFrames: number }>()

  const tracks = manifest.tracks.map((track, index) => {
    const at = `tracks[${index}]`
    const id = typeof track.id === 'string' && track.id.length > 0 ? track.id : `${at}`
    const duration = (track as { durationInFrames?: unknown }).durationInFrames
    const rawStart = (track as { startFrame?: unknown }).startFrame
    const startAfter = readStartAfter((track as { startAfter?: unknown }).startAfter)

    if (startAfter !== null) {
      if (rawStart !== undefined) {
        errors.push(`${at}(${id}) 不能同时给 startFrame 与 startAfter（二选一）`)
      }
      if (startAfter.trackId === id) {
        errors.push(`${at}(${id}) 的 startAfter 指向自己 —— 会形成自环`)
      }
      const gap = startAfter.gapFrames ?? 0
      if (!Number.isFinite(gap) || gap < 0 || !Number.isInteger(gap)) {
        errors.push(`${at}(${id}).startAfter.gapFrames 必须是 >= 0 的整数`)
      }
      const ref = placed.get(startAfter.trackId)
      if (ref === undefined) {
        if (startAfter.trackId !== id) {
          errors.push(
            `${at}(${id}).startAfter 引用了「${startAfter.trackId}」，但它不在本轨之前（只能接在数组中更靠前的轨后面）`,
          )
        }
      }
      const startFrame = ref === undefined ? 0 : ref.startFrame + ref.durationInFrames + (Number.isFinite(gap) ? gap : 0)
      if (ref !== undefined && (!Number.isFinite(ref.durationInFrames) || ref.durationInFrames <= 0)) {
        errors.push(`${at}(${id}) 的参考轨「${startAfter.trackId}」durationInFrames 非法，无法解析起始帧`)
      }
      if (ref !== undefined) {
        resolved.push({
          id,
          startFrame,
          via: 'startAfter',
          refTrackId: startAfter.trackId,
          gapFrames: Number.isFinite(gap) ? gap : 0,
        })
        warnings.push(
          `${at}(${id}) startAfter → 实际起始帧 ${startFrame}（= ${startAfter.trackId} 起点 ${ref.startFrame} + 时长 ${ref.durationInFrames} + 空档 ${gap}）`,
        )
      }
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        placed.set(id, { startFrame, durationInFrames: duration })
      }
      // 写回数字帧：渲染器只认 startFrame。
      //
      // ⚠️ **必须把 `startAfter` 删掉**：归一后的 manifest 还要再过一遍 `validateManifest`，
      // 而那条校验是「startFrame 与 startAfter 互斥」（防模型两处都写）。留着它 ⇒ 每条
      // 用了顺序衔接的轨都会被判成「同时给了两者」而被拒收，等于 startAfter 全不可用。
      // 诊断信息由 `resolved` + `warnings` 承载（`formatResolvedStarts`），不靠原字段。
      const normalized: Record<string, unknown> = { ...track, startFrame }
      delete normalized.startAfter
      // 双跳是必要的：`Record<string, unknown>` 与 `CompositionTrack` 不重叠，
      // 单跳 cast 会被 TS 判成误用（这里确实是「结构已知、键已按需删过」的收口）。
      return normalized as unknown as typeof track
    }

    if (typeof rawStart !== 'number' || !Number.isFinite(rawStart) || rawStart < 0) {
      // 校验层会报更明确的错；这里给一个可继续算的占位（0），避免下游 NaN 连锁。
      errors.push(`${at}(${id}).startFrame 缺失或非法（要么给 >= 0 的整数帧，要么给 startAfter）`)
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        placed.set(id, { startFrame: 0, durationInFrames: duration })
      }
      resolved.push({ id, startFrame: 0, via: 'startFrame' })
      return { ...track, startFrame: 0 } as typeof track
    }

    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      placed.set(id, { startFrame: rawStart, durationInFrames: duration })
    }
    resolved.push({ id, startFrame: rawStart, via: 'startFrame' })
    return track
  })

  return { manifest: { ...manifest, tracks }, resolved, errors, warnings }
}

/** 解析表转成人话（工具结果里的「实际解析帧号」一行）。 */
export function formatResolvedStarts(resolved: readonly ResolvedStartFrame[]): string {
  const chained = resolved.filter((entry) => entry.via === 'startAfter')
  if (chained.length === 0) return ''
  return chained
    .map((entry) => `${entry.id}=${entry.startFrame}${entry.refTrackId !== undefined ? `(接 ${entry.refTrackId}+${entry.gapFrames ?? 0})` : ''}`)
    .join('，')
}
