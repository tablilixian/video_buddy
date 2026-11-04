/**
 * 2026-11-04（科普 0.1 验收 P10b）：字幕卡的**排版预算**（纯函数，零 Remotion 依赖）。
 *
 * ## 事故（成片像素实证）
 *
 * 科普 0.1 成片里，带 `box` 的 `textCard` + `variant:'subtitle'` 轨**文字被裁**：
 * - `"0° Equator"`（box 16%×7%）只显示 `"Equator"`；
 * - `"+23.5°N · Solstice"`（box 26%×8%）只显示 `"Solstice"`；
 * - 两行的 `"Direct · 90°" / "Concentrated → warms fast"`（box 38%×15%）
 *   只剩最后一行，且首行被削成一条横线。
 *
 * ## 根因
 *
 * 旧实现把字幕卡的**字号与行数预算**一律按**画布**算
 * （`maxWidthPx = canvasWidth * 0.86 - 64`、`baseFontPx = 44`、`maxLines = 3`），
 * 而带 `box` 的卡片实际容器是**盒子**（常常只有画布的 1/6 宽、1/10 高）⇒
 * 算出来的字号偏大、行数偏多 ⇒ 文字溢出，被外层 `overflow: hidden` 一刀裁掉。
 *
 * 换句话说：**排版预算与真实容器不是同一个尺寸**。
 *
 * ## 修法
 *
 * 带 `box` 时按**盒子的宽高**同时定「可用宽 / 可用高 / 基准字号 / 行数上限」，
 * 排不下就**缩字号**（`fitTextPolicy` 的老规矩：不静默截断，截断要看得见）。
 * 不带 `box` 的铺满卡走老参数 ⇒ 老 manifest 逐像素不变。
 */

/** 字幕行高（与 `fitTextPolicy` 的缺省 lineHeight 同值 —— 两处必须一致）。 */
export const SUBTITLE_LINE_HEIGHT = 1.35

/** 字幕基准字号（px）—— 铺满卡的缺省值；带 box 时还要再受高度约束往下压。 */
export const SUBTITLE_BASE_FONT_PX = 44

/** 字幕行数上限（硬上限；带 box 时还要再受高度约束往下压）。 */
export const SUBTITLE_MAX_LINES = 3

/** 字号下限（px）—— 再小的盒子也不至于缩成不可读。 */
export const SUBTITLE_MIN_FONT_PX = 16

export interface SubtitleFitBudget {
  /** 文字可用宽度（px）。 */
  maxWidthPx: number
  /** 基准字号（px）。 */
  baseFontPx: number
  /** 行数上限。 */
  maxLines: number
  /** 文字盒左右内边距（px）。 */
  padX: number
  /** 文字盒上下内边距（px）。 */
  padY: number
  /** 外层留白（px）—— 带 box 时为 0（盒子本身已是卡片区域）。 */
  layerPad: number
}

/**
 * 算一张字幕卡的排版预算。
 *
 * @param box 字幕卡的区域声明（画布百分比）；**缺省 = 铺满卡**（老路径）。
 */
export function subtitleFitBudget(input: {
  box?: { w: number; h: number } | undefined
  canvasWidth: number
  canvasHeight: number
}): SubtitleFitBudget {
  const { box, canvasWidth, canvasHeight } = input
  if (box === undefined) {
    // 铺满卡：老路径逐字不变（72px 贴底留白 + 画布宽 + 44px + 3 行）。
    return {
      maxWidthPx: Math.max(200, canvasWidth * 0.86 - 64),
      baseFontPx: SUBTITLE_BASE_FONT_PX,
      maxLines: SUBTITLE_MAX_LINES,
      padX: 32,
      padY: 18,
      layerPad: 72,
    }
  }
  const padX = 16
  const padY = 8
  const boxWidthPx = (box.w / 100) * canvasWidth
  const boxHeightPx = (box.h / 100) * canvasHeight
  const availWidthPx = Math.max(80, boxWidthPx - padX * 2)
  const availHeightPx = Math.max(24, boxHeightPx - padY * 2)
  // 基准字号先受**高度**管（放不下就缩），再受 44px 上限管。
  const baseFontPx = Math.max(
    SUBTITLE_MIN_FONT_PX,
    Math.min(SUBTITLE_BASE_FONT_PX, Math.floor(availHeightPx / SUBTITLE_LINE_HEIGHT)),
  )
  const maxLines = Math.max(
    1,
    Math.min(SUBTITLE_MAX_LINES, Math.floor(availHeightPx / (baseFontPx * SUBTITLE_LINE_HEIGHT))),
  )
  return { maxWidthPx: availWidthPx, baseFontPx, maxLines, padX, padY, layerPad: 0 }
}
