/**
 * spot-check 的确定性帧集合（CV-447 P1-C）。
 *
 * 真机事故：19 轮 spotFrames 由 agent 自选，从 8 帧一路收窄到单点；整片抽帧集合本来
 * 能逮住「222 帧双地球」（场景 2 在 214 帧入场）和「0 帧空画面」，但自选循环从不渲这两处。
 *
 * 口径：**结构帧（0 / 末帧 / 各轨起止 ±2）∪ agent 自选**，总数仍受 8 帧上限约束
 * （与 `normalizeSpotFrames` / 抽帧同口径）。优先级 = 结构帧先占位，agent 自选随后补充：
 * 0 帧空画面与末帧收尾是每次都必须看的，不能被自选的 8 个中段帧挤掉。
 */
import type { CompositionManifest } from './manifest.js'

/** 结构帧偏移：场景边界前后各看一帧，覆盖入场首帧与出画末帧。 */
const STRUCTURAL_OFFSETS = [-2, 0, 2] as const

export const MAX_SPOT_FRAMES = 8

/**
 * 合并 agent 自选帧与结构帧，返回 ≤8 个升序帧号。
 *
 * @param manifest 目标 manifest（只读；用 `meta.durationInFrames` 与各轨起止）
 * @param requested agent 显式请求的帧（按调用方顺序，非法值由后续 normalize 兜底）
 */
export function withStructuralSpotFrames(manifest: CompositionManifest, requested: readonly number[]): number[] {
  const total = Math.max(1, Math.round(manifest.meta.durationInFrames))
  const clamp = (value: number): number => Math.min(total - 1, Math.max(0, Math.round(value)))
  const picks = new Set<number>([0, total - 1])
  for (const frame of requested) {
    if (picks.size >= MAX_SPOT_FRAMES) break
    if (typeof frame === 'number' && Number.isFinite(frame)) picks.add(clamp(frame))
  }
  for (const track of manifest.tracks) {
    if (picks.size >= MAX_SPOT_FRAMES) break
    const end = track.startFrame + track.durationInFrames - 1
    for (const offset of STRUCTURAL_OFFSETS) {
      if (picks.size >= MAX_SPOT_FRAMES) break
      picks.add(clamp(track.startFrame + offset))
      picks.add(clamp(end + offset))
    }
  }
  return [...picks].slice(0, MAX_SPOT_FRAMES).sort((a, b) => a - b)
}
