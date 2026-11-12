/**
 * RQ-13/RQ-19 · 像素审计**报告装配**：三类检查 + 判红口径收敛到一个 JSON。
 *
 * 交付报告字段（RQ-13 验收）：`lumaJumpP99` / `inkOffsets` / `psnr` 三项；
 * `p99 > 4` 判红（修复前实测 4.51 会被拦下）。RQ-19 的采集字段
 *（`paramDimensions` / `paramEffective` / 素材来源分布）也挂在这里 —— 由批次 9 的
 * P 卡判据运行时填充。
 */
import { auditLumaJumps, auditInkOffset, psnrSeries } from './metrics.mjs'

export interface PixelAuditReport {
  ok: boolean
  /** RQ-13 ①：亮度跳变 p99（≤4 过；>4 判红）。 */
  lumaJumpP99: number
  lumaJumpSpikes: { frame: number; delta: number }[]
  /** RQ-13 ③：帧对 PSNR 分桶与中位数（同规格复现 ≥40dB；不雷同 <25dB）。 */
  psnr: { frames: number; buckets: Record<string, number>; median: number; min: number } | null
  /** RQ-15：落点审计（box 中心 vs 墨迹中心，超容差 warning）。 */
  inkOffsets: { trackId: string; offsetPx: number | null; pass: boolean; tolerancePx: number }[]
  /** RQ-19：P 卡判据采集（批次 9 运行时填充；缺省空）。 */
  paramDimensions?: Record<string, number>
  paramEffective?: Record<string, { psnr: number; effective: boolean }>
  /** RQ-21/RQ-19：素材来源分布（user / library / generated 条数）。 */
  assetSourceDistribution?: { user: number; library: number; generated: number }
  /** 判红原因（ok=false 时的全部理由）。 */
  failures: string[]
}

/** 组装报告（纯函数；阈值见 metrics.mjs 各注释）。 */
export function buildPixelAuditReport(input: {
  grayFrames?: Uint8Array[]
  framesA?: Uint8Array[]
  framesB?: Uint8Array[]
  inkChecks?: { grayFrame: Uint8Array; width: number; height: number; box: { x: number; y: number }; tolerancePx?: number }[]
  paramDimensions?: Record<string, number>
  paramEffective?: Record<string, { psnr: number; effective: boolean }>
  assetSourceDistribution?: { user: number; library: number; generated: number }
}): PixelAuditReport {
  const failures: string[] = []
  const luma = input.grayFrames !== undefined
    ? auditLumaJumps(input.grayFrames)
    : null
  if (luma !== null && !luma.pass) failures.push(`亮度跳变 p99 ${luma.p99.toFixed(2)} > ${luma.threshold}`)
  const psnr = input.framesA !== undefined && input.framesB !== undefined
    ? psnrSeries(input.framesA, input.framesB)
    : null
  const inkOffsets = (input.inkChecks ?? []).map((check) => {
    const audit = auditInkOffset(check.grayFrame, check.width, check.height, check.box, check.tolerancePx === undefined ? {} : { tolerancePx: check.tolerancePx })
    return { trackId: check.trackId ?? '', offsetPx: audit.offsetPx, pass: audit.pass, tolerancePx: audit.tolerancePx }
  })
  for (const check of inkOffsets) {
    if (!check.pass) failures.push(`落点偏差 ${check.trackId}: ${check.offsetPx?.toFixed(1)}px > 容差 ${check.tolerancePx}px`)
  }
  return {
    ok: failures.length === 0,
    lumaJumpP99: luma === null ? 0 : luma.p99,
    lumaJumpSpikes: luma === null ? [] : luma.spikes,
    psnr: psnr === null ? null : { frames: psnr.frames, buckets: psnr.buckets, median: psnr.median, min: psnr.min },
    inkOffsets,
    ...(input.paramDimensions !== undefined ? { paramDimensions: input.paramDimensions } : {}),
    ...(input.paramEffective !== undefined ? { paramEffective: input.paramEffective } : {}),
    ...(input.assetSourceDistribution !== undefined ? { assetSourceDistribution: input.assetSourceDistribution } : {}),
    failures,
  }
}
