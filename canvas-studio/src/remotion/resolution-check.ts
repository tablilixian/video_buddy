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
 * 这会让正常档位恒报——`720p` 素材是 1376×768、成片 1280×720，比值 ≈ 1.0 < 1.2，
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

/** OPT-13（2026-10-26）：720p 交付基线（落位预对账用；质量档感知的核对仍在渲染链）。 */
export const DELIVERY_BASELINE = { width: 1280, height: 720 } as const

/**
 * OPT-13：**素材落位时**的分辨率预对账（纯函数）。
 *
 * 渲染链的 `checkManifestResolution` 是质量档感知的权威核对，但它发现的太晚 ——
 * session 实证：同一「上采样 1.5×」提示在 **5 次渲染里重复出现**，无人执行
 * 「重出」建议。把决策点前移到生成落位：素材刚出来就知道「按 720p 交付会糊」，
 * 趁 prompt 与参考图还热着马上重出，而不是渲完一版才面对。
 *
 * 判据：**面积比**开根号估上采样倍数 —— 与方向无关，9:16 竖屏素材同样适用
 * （480×854 的竖片对 720p 基线同样约 1.5×，按高/宽单边判都会漏）。
 */
export function placementResolutionWarning(
  width: number,
  height: number,
  baseline: RealSize = DELIVERY_BASELINE,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const upsample = Math.sqrt((baseline.width * baseline.height) / (width * height))
  if (!Number.isFinite(upsample) || upsample <= UPSAMPLE_TOLERANCE) return null
  return `[分辨率][落位] 素材 ${Math.round(width)}×${Math.round(height)} 低于 ${baseline.width}×${baseline.height} 交付基线`
    + ` —— 若按 720p/1080p 成片交付会上采样约 ${upsample.toFixed(2)}×，细节在生成时就已定型。`
    + ` 决策点：现在重出更高档素材（趁提示词与参考图还热），或明确接受软化为交付口径。`
}

/**
 * OPT-14：**素材落位时**的时长 vs 分镜窗口预对账（纯函数，双向）。
 *
 * 窗口来自分镜卡的 `declaredDuration`（seed 落卡时从 shot.duration 写入）。
 * 容差缺省 0.6s：吸收 H3 按帧率量化的尾数（CV-140：请求 5s → 实测 5.167s）。
 * 短了会留空洞 / 拉伸；长了会被裁或逼出临场溶解 —— 两种都该在落位时决策。
 */
export function placementDurationWarning(durationSec: number, windowSec: number, toleranceSec = 0.6): string | null {
  if (!Number.isFinite(durationSec) || !Number.isFinite(windowSec) || durationSec <= 0 || windowSec <= 0) return null
  const delta = durationSec - windowSec
  if (Math.abs(delta) <= toleranceSec) return null
  if (delta < 0) {
    return `[时长][落位] 素材 ${durationSec.toFixed(2)}s 覆盖不了分镜窗口 ${windowSec.toFixed(2)}s（差 ${Math.abs(delta).toFixed(2)}s）`
      + ` —— 渲染会留空洞或拉伸。决策点：重出更长素材 / 缩窗 / 与相邻镜溶解补齐。`
  }
  return `[时长][落位] 素材 ${durationSec.toFixed(2)}s 比分镜窗口 ${windowSec.toFixed(2)}s 长 ${delta.toFixed(2)}s`
    + ` —— 多出部分会被裁掉，或需要预留转场帧消化。决策点：按窗口裁切 / 预留溶解 / 缩短重出。`
}

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
        + `交付前建议用更高档重出该镜（video_composite 传 resolution:"720p" ⇒ 1376×768），`
        + `或把成片分辨率降到与素材匹配。`,
    )
  }
  return warnings
}
