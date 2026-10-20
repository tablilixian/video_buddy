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
 * ## O-08：`gapFrames` 允许负值 = 与引用轨**重叠**
 *
 * 原实现强制 `gap >= 0`，于是 `startAfter` 只能产出「相邻」或「留空」，**产不出重叠**；
 * 而 `transition` 要求两轨重叠才不是硬切 ⇒ 只要片子用转场，`startAfter` 就永远用不上
 * （真机会话 9 次渲染 **0 次使用**，全部手算 65/210/355/500 帧号）。
 *
 * 现语义：`gapFrames: -10` = 与引用轨重叠 10 帧（正好是 10 帧叠化窗口），解析式
 * `startFrame = 引用轨.startFrame + 引用轨.durationInFrames + gap` **不动**（负号自己
 * 就是减法）。约束只剩两条：必须是整数；解析结果不能为负（重叠量不得超过引用轨自身
 * 起点能容纳的范围）。
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
  /** `via='startAfter'` 时的空档帧（**负数 = 与引用轨重叠的帧数**）。 */
  gapFrames?: number
}

export interface NormalizeTimingResult {
  manifest: CompositionManifest
  /** 逐轨解析结果（顺序与入参一致）。 */
  resolved: ResolvedStartFrame[]
  errors: string[]
  warnings: string[]
}

/**
 * 重叠窗口的最小可见帧数（O-08）。
 *
 * 与 `motion-lint.ts` 的 **ML-06「转场窗口太短」同值** —— 两处必须同步，否则会出现
 * 「体检说转场太短、归一化一句不说」或反过来。`motion-lint` 直接 import 本常量。
 */
export const MIN_VISIBLE_OVERLAP_FRAMES = 6

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
      if (!Number.isFinite(gap) || !Number.isInteger(gap)) {
        // O-08：负值合法（= 与引用轨重叠），只留「必须是整数」一条形状约束。
        errors.push(`${at}(${id}).startAfter.gapFrames 必须是整数（负数 = 与引用轨重叠的帧数）`)
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
      // O-08：负 gap 是减法，叠过头就会把本轨推到 0 帧之前（渲染器会裁掉前半段，
      // 表现为「轨道莫名少一截」）。这是唯一需要额外判的边界。
      if (ref !== undefined && Number.isFinite(startFrame) && startFrame < 0) {
        errors.push(
          `${at}(${id}).startAfter 解析出的起始帧为 ${startFrame}：重叠 ${Math.abs(gap)} 帧超过引用轨起点能容纳的范围，请减小重叠量`,
        )
      }
      if (ref !== undefined && gap < 0 && -gap < MIN_VISIBLE_OVERLAP_FRAMES) {
        warnings.push(
          `${at}(${id}) 与「${startAfter.trackId}」只重叠 ${-gap} 帧（< ${MIN_VISIBLE_OVERLAP_FRAMES} 帧）—— 转场窗口不足，肉眼几乎看不见`,
        )
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
          `${at}(${id}) startAfter → 实际起始帧 ${startFrame}（= ${startAfter.trackId} 起点 ${ref.startFrame} + 时长 ${ref.durationInFrames} ${gap < 0 ? `- 重叠 ${-gap}` : `+ 空档 ${gap}`}）`,
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
    .map((entry) => {
      if (entry.refTrackId === undefined) return `${entry.id}=${entry.startFrame}`
      const gap = entry.gapFrames ?? 0
      // 负数 gap 读成「重叠 N 帧」，比 `+-10` 这种算术噪音好懂得多。
      const relation = gap < 0 ? `重叠 ${-gap}` : `+${gap}`
      return `${entry.id}=${entry.startFrame}(接 ${entry.refTrackId} ${relation})`
    })
    .join('，')
}
