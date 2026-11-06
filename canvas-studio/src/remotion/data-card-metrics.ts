/**
 * 数据卡（`dataCard`）的尺寸求解（纯函数，可单测）。
 *
 * 背景（2026-11-06 真机）：组件里写死 `width: 940`，而带 `box` 时外层容器宽是
 * `box.w%`，且层上有 `overflow: hidden` ⇒ 窄盒子把卡片从**两侧裁掉**（数据卡压住
 * 折线、右半边数字被削），宽盒子则仍是 940 居中、压住旁边的图表。契约说 box 决定
 * 位置与尺寸，但模型改 box 对这张卡**不生效**，只能靠组件修。
 *
 * 口径：设计外宽 = 内容宽 940 + 左右内距 60×2 = **1060**。
 *  - 1080p（1920）且不带 box：容器 1920 ≥ 1060 ⇒ 缩放 1、外宽 1060，
 *    与历史输出**逐像素一致**（历史卡片本来就是这个外宽）。
 *  - 容器比设计外宽窄：整体等比缩小，而不是溢出被裁。
 *  - 容器比设计外宽宽（例如 box.w=80）：**不拉伸**，仍是 1060 居中。
 *  - 低分辨率梯级（480p 画布 864）：容器 864 < 1060 ⇒ 缩到 864，不再两侧溢出。
 */

/** 设计内容宽（px）。 */
export const DATA_CARD_CONTENT_WIDTH = 940
/** 设计左右内距（px）。 */
export const DATA_CARD_PADDING_X = 60
/** 设计外宽（px）= 内容宽 + 左右内距。 */
export const DATA_CARD_OUTER_WIDTH = DATA_CARD_CONTENT_WIDTH + DATA_CARD_PADDING_X * 2

export interface DataCardMetrics {
  /** 卡片外宽上限（px）：容器宽与设计外宽的较小值。 */
  outerWidth: number
  /** 字号 / 内距 / 圆角的统一缩放系数（≤ 1，1 = 原尺寸）。 */
  scale: number
}

/**
 * 求数据卡在给定容器下的外宽与缩放系数。
 *
 * @param box - 轨道上的 `box`（画布百分比，`w` 是宽度百分比）；缺省表示铺满层。
 * @param canvasWidth - 当前 composition 的画布宽（px，`useVideoConfig().width`）。
 */
export function dataCardMetrics(
  box: { w: number } | undefined,
  canvasWidth: number,
): DataCardMetrics {
  let containerWidth = Number.isFinite(canvasWidth) && canvasWidth > 0
    ? canvasWidth
    : DATA_CARD_OUTER_WIDTH
  if (box !== undefined && Number.isFinite(box.w) && box.w > 0) {
    containerWidth = (box.w / 100) * containerWidth
  }
  const outerWidth = Math.min(containerWidth, DATA_CARD_OUTER_WIDTH)
  return { outerWidth, scale: outerWidth / DATA_CARD_OUTER_WIDTH }
}
