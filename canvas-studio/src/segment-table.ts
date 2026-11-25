/**
 * REQ-041 第 2 批（2026-11-25）· **段表规划的唯一切法**（纯函数，无 IO）。
 *
 * ## 为什么单独一个文件
 *
 * 「manifest（+ spec）→ 段 → 产物 id/帧窗」这四步此前在三个地方各写一遍
 * （`shot-render.ts` 的分镜路径、`segment-publish.ts` 的整片旁路、`segment-media.ts`
 * 的派生清单）。三处各自 `boundariesFromSpec → resolveShotBoundaries → sliceByShots
 * → planSegmentArtifacts`，任何一处改口径，另外两处就会与它错位 —— 而**缓存按内容
 * hash 命中**（`shot-cache.ts` 的 `lookupSegmentsCache`：hash 含段窗与归一化轨），
 * 错一帧的表现不是报错，是「渲了但发布不出来」「清单说有、客户端 404」。
 *
 * 所以切法收成一处：渲染侧（`segment-render.ts`）与发布侧（`segment-publish.ts`）
 * 都调它。放独立文件是为了避免 `segment-render ↔ segment-publish` 循环依赖。
 */
import type { CompositionManifest } from './remotion/manifest.js'
import type { ShotSegment } from './shot-slice.js'
import { boundariesFromSpec, resolveShotBoundaries, sliceByShots } from './shot-slice.js'
import { planSegmentArtifacts, type SegmentArtifact } from './segment-artifacts.js'

export interface SegmentTablePlan {
  segments: ShotSegment[]
  artifacts: SegmentArtifact[]
}

/**
 * manifest（+ spec 派生边界）→ 段表 + 产物规划。
 *
 * `null` = 切不出段（无边界 / 空段表）。调用方各自决定这时是「跳过」还是「如实说明」，
 * 但**不要**在这里抛：整片路径拿到空段表是常态（probe、单段片、无 spec 的手写 manifest）。
 *
 * fps 兜底 30 与 `segment-artifacts.ts` / `segment-media.ts` 同口径：脏 fps 只影响
 * `durationSec` 的展示值，不该让整批段消失。
 */
export function planSegmentTable(input: {
  manifest: CompositionManifest
  spec: unknown
}): SegmentTablePlan | null {
  const metaFps: unknown = input.manifest.meta?.fps
  const fps = typeof metaFps === 'number' && Number.isFinite(metaFps) && metaFps > 0 ? metaFps : 30
  const totalFrames = Math.max(1, Math.floor(input.manifest.meta?.durationInFrames ?? 0))
  const specBoundaries = boundariesFromSpec(input.spec, totalFrames, fps)
  const { cuts } = resolveShotBoundaries(input.manifest, specBoundaries)
  if (cuts.length === 0) return null
  const { segments } = sliceByShots(input.manifest, cuts)
  if (segments.length === 0) return null
  return {
    segments,
    artifacts: planSegmentArtifacts({
      segments,
      declared: input.manifest.meta?.segments,
      fps,
    }),
  }
}
