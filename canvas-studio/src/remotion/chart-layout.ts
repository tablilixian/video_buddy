/**
 * 图表内布局（百分比，铺满 box / 画布）：左轴 9%、右轴 8%、顶 7%、**底 12% 是类目标签带**。
 *
 * 2026-11-06 修（真机事故）：类目标签原本 `top: '100%'` = **容器底部**，而这里已经用
 * `bottom: 12` 在容器内预留了标签带 ⇒ 标签整体落在预留区下方，被 box 层的
 * `overflow: hidden` 裁掉。真机里 agent 三次裁切取证 + `inspect_image` 像素确认
 * 「确实没渲染出来」，最后放弃修复、把年份塞进头部卡绕过。
 */
export const CHART_PLOT = { left: 9, right: 8, top: 7, bottom: 12 } as const

/** 绘图区高度（百分比）。 */
export const CHART_PLOT_HEIGHT_PERCENT = 100 - CHART_PLOT.top - CHART_PLOT.bottom

/**
 * 类目标签的 `top`（百分比）：**绘图区底边**，不是容器底部。
 *
 * 不变量（`tests/chart-label-band.test.mjs` 锁定）：
 * `0 < 值 < 100`，且「容器底部 − 该值」正好等于 `CHART_PLOT.bottom` 的可视带宽 ——
 * 等于 100 就是把标签放出容器、必然被裁。
 */
export const CHART_CATEGORY_LABEL_TOP_PERCENT = CHART_PLOT.top + CHART_PLOT_HEIGHT_PERCENT
