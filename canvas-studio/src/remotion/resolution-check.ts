/**
 * REQ-034 · O-12：**素材分辨率与交付分辨率的联动**（纯函数，零 IO）。
 *
 * ## 症状（真机验收评审 P1-4）
 * `video_composite` 三次都没传 `resolution` ⇒ 素材是 864×480，而成片是 1280×720 ——
 * 渲染器把每个片段放大 1.48× 贴进画布，**细节在出片那一刻就已经丢了**。全程没有任何
 * 一方告诉模型这件事，于是它每次都「成功」出一版糊片。
 *
 * ## 口径（唯一一处判定）
 * `scale = max(成片宽 / 素材宽, 成片高 / 素材高)`，`scale > 1` 即真上采样。
 *
 * **落地修订（2026-10-20）**：总纲原文写「低于成片 **1.2×** 以上给 warning」，实测
 * 这会让正常档位恒报——`736p` 素材是 1280×736、成片 1280×720，比值 = 1.0 < 1.2，
 * 一条永远为真的提示就是噪声（与 ML-10 同类代价：agent 学会无视整个体检）。故阈值
 * 收到 **1.05**（5% 容差，吸收编码器把奇数像素补成偶数这类 1–2px 差异），并在 hint
 * 里给出「要更锐利就出 ≥1.2× 素材」的建议，而不是把它当失败条件。
 *
 * 只判 `video` 轨：`image` 轨不在 `checkManifestAssets` 的探测范围内（成本/收益不划算），
 * 且生成图原生分辨率通常远高于成片。
 */
import { RENDER_QUALITY_SCALE, type CompositionManifest, type RenderQuality } from './manifest.js'

/** 判定为上采样的倍数阈值（> 该值才报）。 */
export const UPSAMPLE_TOLERANCE = 1.05

export interface RealSize {
  width: number
  height: number
}

/**
 * 逐条 `video` 轨核对素材真实像素 vs 成片目标像素。
 *
 * @param manifest - 已物化、已按真值校正的 manifest（`meta.width/height` 是交付分辨率）。
 * @param realSizes - `checkManifestAssets().realSizes`（`src` → 真实像素）。
 * @param quality - 本次实际渲染质量档；`draft` 会按半分辨率判（否则正常草稿会被误报）。
 * @returns 人话 warning 列表（同一素材只报一次，列首个引用它的轨 id）。
 */
export function checkManifestResolution(
  manifest: CompositionManifest,
  realSizes: Readonly<Record<string, RealSize>>,
  quality?: RenderQuality,
): string[] {
  const scale = quality === undefined ? 1 : RENDER_QUALITY_SCALE[quality] ?? 1
  const targetWidth = manifest.meta.width * scale
  const targetHeight = manifest.meta.height * scale
  if (
    typeof targetWidth !== 'number' || !Number.isFinite(targetWidth) || targetWidth <= 0 ||
    typeof targetHeight !== 'number' || !Number.isFinite(targetHeight) || targetHeight <= 0
  ) {
    return []
  }
  const warnings: string[] = []
  const reported = new Set<string>()
  for (const track of manifest.tracks) {
    if (track.type !== 'video') continue
    const size = realSizes[track.src]
    if (size === undefined) continue
    if (reported.has(track.src)) continue
    const upsample = Math.max(targetWidth / size.width, targetHeight / size.height)
    if (!Number.isFinite(upsample) || upsample <= UPSAMPLE_TOLERANCE) continue
    reported.add(track.src)
    const targetLabel = `${Math.round(targetWidth)}×${Math.round(targetHeight)}${scale === 1 ? '' : `（${quality} 档半分辨率）`}`
    warnings.push(
      `[分辨率] 轨「${track.id}」素材只有 ${size.width}×${size.height}，成片 ${targetLabel} `
        + `—— 上采样约 ${upsample.toFixed(2)}×，细节在出片时已丢失。`
        + `交付前建议用更高档重出该镜（video_composite 传 resolution:"736p" ⇒ 1280×736），`
        + `或把成片分辨率降到与素材匹配。`,
    )
  }
  return warnings
}
