/**
 * 字号体系的**设计基准**与缩放口径（纯数据 + 纯函数：无 IO、无 React）。
 *
 * ## 为什么需要它
 *
 * `title` / `bullets` / `timecode` 的基准号（84 / 48 / 36 px）是按 **1080 高画布**
 * 设计的绝对值，而画布高由 `manifest.meta.height` 决定 —— 历史上同时存在 720 / 1080 /
 * 1920 三种。不缩放时同一份文案在 720 高画布上会比设计意图大约 1.5 倍（字更大、能塞的
 * 字更少、`autoShrink` 更容易触发），在 1920 高竖版上又偏小。这是「字号与画布脱钩」，
 * 不是作者的排版选择。
 *
 * ## 为什么取「画布高」而不是面积 / 短边
 *
 * 字号是**纵向**度量：84px 在 1080 高的画面里占 7.8%，换到 1920 高的竖版应当是 149px
 *（同为 7.8%），这才叫「看起来一样大」。按短边或面积缩放会让 1080×1920 的标题掉到
 * 47–84px（占宽 4–8%、占高 2–4%），在竖屏短片里明显偏小；按面积缩放还会让同画幅不同
 * 分辨率之间出现非等比关系。
 *
 * ## 为什么 1920×1080 必须恰好是 1.0
 *
 * 那是设计基准画布。系数为 1 意味着**既有 1080p 产线逐像素不变**，既有测试的
 * 1920×1080 断言也不需要改口径 —— 这是「不制造无谓回归」的锚。
 */

/** 设计基准画布宽（px）—— 与 `model` 的 16:9 缺省一致。 */
export const DESIGN_CANVAS_WIDTH = 1920

/** 设计基准画布高（px）—— `title` / `bullets` / `timecode` 基准号的参照高度。 */
export const DESIGN_CANVAS_HEIGHT = 1080

/**
 * 缩放系数的合法区间。
 *
 * 下界 0.35 ≈ 378 高（再低字已不可读，交给 `autoShrink` 的下限兜）；
 * 上界 3.0 = 3240 高（4K 竖版 2160 仍在区间内，留一档余量防脏数据把字号放大成整屏）。
 */
export const TEXT_SCALE_MIN = 0.35
export const TEXT_SCALE_MAX = 3

/**
 * 画布高 → 字号缩放系数（1920×1080 ⇒ 1.0）。
 *
 * 非法 / 非正数按设计基准处理（系数 1），与 `text-fit-plan` 里
 * `positive(canvasHeight, 1080)` 的兜底口径一致。
 */
export function canvasTextScale(canvasHeight: number): number {
  const height = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : DESIGN_CANVAS_HEIGHT
  const raw = height / DESIGN_CANVAS_HEIGHT
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, raw))
}

/**
 * 把设计基准 px 换算成当前画布上的 px（取整，最小 1）。
 *
 * 组件与体检都只经 `planTextFit` 取字号 ⇒ 这里不做「四舍五入策略」的分叉，
 * 统一 `Math.round` 才可能与 `TextCard` 贴出的 `fontSize` 逐像素对齐。
 */
export function scaleDesignPx(designPx: number, canvasHeight: number): number {
  return Math.max(1, Math.round(designPx * canvasTextScale(canvasHeight)))
}
