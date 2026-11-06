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

/** 设计上下内距（px，与 `TextCard` 的 dataCard 分支一致）。 */
export const DATA_CARD_PADDING_Y = 52
/** 标题行高（字号 40 × 1.25，px）。 */
export const DATA_CARD_TITLE_LINE_HEIGHT = 50
/** 标题与数据之间的分隔块（2px 线 + 26/10 上下边距，px）。 */
export const DATA_CARD_DIVIDER_BLOCK = 38
/** 每条数据行高（上下内距 18×2 + 正文 42 + 边框 1，px）。 */
export const DATA_CARD_ROW_HEIGHT = 79

/**
 * 数据卡的**设计高度**（px）：按行数估算，用于判断「盒子是否装得下」。
 *
 * 为什么需要：`dataCardMetrics` 原本只解**宽**，窄盒子会横向裁、矮盒子会**纵向**裁
 * （2026-11-06 真机：标题「太阳直射点往返范围」被上边缘削掉、「基线」那行被下边缘
 * 削掉，agent 只能反复调大 `box.h` 重渲）。
 */
export function dataCardDesignHeight(input: { titleLines: number; dataRows: number }): number {
  const titleLines = Number.isFinite(input.titleLines) ? Math.max(1, Math.round(input.titleLines)) : 1
  const rows = Number.isFinite(input.dataRows) ? Math.max(0, Math.round(input.dataRows)) : 0
  return (
    DATA_CARD_PADDING_Y * 2
    + DATA_CARD_TITLE_LINE_HEIGHT * titleLines
    + DATA_CARD_DIVIDER_BLOCK
    + DATA_CARD_ROW_HEIGHT * rows
  )
}

export interface DataCardMetrics {
  /** 卡片外宽（px）：等比缩放后的实际外宽。 */
  outerWidth: number
  /** 字号 / 内距 / 圆角的统一缩放系数（≤ 1，1 = 原尺寸）。 */
  scale: number
}

/**
 * 求数据卡在给定容器下的外宽与缩放系数（宽、高两维取**较小**的那个缩放）。
 *
 * @param box - 轨道上的 `box`（画布百分比；`w` 宽度、`h` 高度）；缺省表示铺满层。
 * @param canvasWidth - 当前 composition 的画布宽（px，`useVideoConfig().width`）。
 * @param options.canvasHeight - 画布高（px）；缺省 0 = 不做高度约束。
 * @param options.designHeight - 内容的设计高度（见 `dataCardDesignHeight`）；缺省 0 = 不约束。
 */
export function dataCardMetrics(
  box: { w: number; h?: number } | undefined,
  canvasWidth: number,
  options: { canvasHeight?: number; designHeight?: number } = {},
): DataCardMetrics {
  const canvasW = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : DATA_CARD_OUTER_WIDTH
  let containerWidth = canvasW
  if (box !== undefined && Number.isFinite(box.w) && box.w > 0) {
    containerWidth = (box.w / 100) * canvasW
  }
  const widthScale = Math.min(containerWidth, DATA_CARD_OUTER_WIDTH) / DATA_CARD_OUTER_WIDTH
  // 高度约束只在「盒子比内容矮」时生效：盒子够高就按宽度走，绝不放大（放大 = 与历史
  // 输出不一致，且字会糊）。
  const canvasH = options.canvasHeight ?? 0
  const designH = options.designHeight ?? 0
  let heightScale = 1
  if (box !== undefined && canvasH > 0 && designH > 0
    && typeof box.h === 'number' && Number.isFinite(box.h) && box.h > 0) {
    const containerHeight = (box.h / 100) * canvasH
    heightScale = Math.min(1, containerHeight / designH)
  }
  // 下界 0.05：极端小盒子仍能渲出东西（不是 0 尺寸），也不会因除零产生 NaN。
  const scale = Math.max(0.05, Math.min(widthScale, heightScale, 1))
  return { outerWidth: Math.round(DATA_CARD_OUTER_WIDTH * scale), scale }
}
