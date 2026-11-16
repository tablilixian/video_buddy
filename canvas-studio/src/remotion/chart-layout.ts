/**
 * 图表内布局（百分比，铺满 box / 画布）：左轴 9%、右轴 8%、顶 7%、**底 12% 是类目标签带**。
 *
 * 2026-11-06 修（真机事故）：类目标签原本 `top: '100%'` = **容器底部**，而这里已经用
 * `bottom: 12` 在容器内预留了标签带 ⇒ 标签整体落在预留区下方，被 box 层的
 * `overflow: hidden` 裁掉。真机里 agent 三次裁切取证 + `inspect_image` 像素确认
 * 「确实没渲染出来」，最后放弃修复、把年份塞进头部卡绕过。
 */

import { estimateTextWidthPx } from './aggregate-layout.js'
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

/**
 * 标题带高度（百分比）。仅 `chart.title` 在场时启用 —— 老 manifest 无 title，
 * 绘图区几何逐像素不变（`chartPlotFor(false) === CHART_PLOT`）。
 * 四季片 D-06：图上必须有标题，此前组件层没有 title 字段，模型只能把标题塞头部卡绕过。
 */
export const CHART_TITLE_BAND_PERCENT = 8

/** 有效绘图区：无标题时与 `CHART_PLOT` 全等；有标题时顶边下移一个标题带。 */
export function chartPlotFor(hasTitle: boolean): { left: number; right: number; top: number; bottom: number } {
  return hasTitle ? { ...CHART_PLOT, top: CHART_PLOT.top + CHART_TITLE_BAND_PERCENT } : CHART_PLOT
}

/** 类目标签的 `top`（绘图区底边）；标题在场时随顶边同步下移，仍留在预留带内。 */
export function chartCategoryLabelTopPercent(hasTitle: boolean): number {
  const plot = chartPlotFor(hasTitle)
  return plot.top + (100 - plot.top - plot.bottom)
}

/**
 * 单槽宽（**绘图容器内**百分比；100 = 绘图区自身宽度）。
 *
 * 铁律：柱、柱顶数值、类目标签、折线点的 x **全部**由这一个数派生 —— 只能有一把尺子。
 *
 * 曾经这里是 `plotW / n`（83/20 = 4.15），却用在绘图容器**内部**：容器的 100% 早已不是
 * 盒子的 100%，于是柱与折线落在两个不同的 x 尺度上。真机 S3/S9 表现：折线右端探到绘图区
 * 最右，柱子只排到五分之四处（`2025-12` 之后的柱子几乎全挤在左半屏）；同时每根柱的数值
 * 标签因槽宽少算约 17% 而折行，`42055人` 变成「42055 / 人」，第二个字溢出轴外。
 *
 * 不变量（`tests/chart-axis-scale.test.mjs` 锁定）：`slot × pointCount === 100`，且
 * 柱中心与折线点 x **逐点相等**。
 */
export function chartSlotPercent(pointCount: number): number {
  return 100 / Math.max(1, pointCount)
}

/** 第 i 个数据点的 x 中心（容器内百分比）：柱中心与折线点共用，尺度不可能再分叉。 */
export function chartPointXPercent(index: number, pointCount: number): number {
  return (index + 0.5) * chartSlotPercent(pointCount)
}

/**
 * 类目 / 数值标签盒（容器内百分比）：宽度按「相邻两个**实际显示**标签的间距」给，不是单槽宽。
 *
 * 抽稀后（20 点只画 10 个标签）若仍按单槽给盒子，5 字符的 `25/04` 照样被
 * `text-overflow: ellipsis` 剪成 `25…` —— 抽稀就白做了。`step = 点数 / 显示数`。
 * 允许左右探出绘图区（`left` 可为负）：外侧是 `plot.left/right` 的轴标签带，不是裁切边界。
 */
export function chartLabelBox(index: number, pointCount: number, step: number): { left: number; width: number } {
  const width = chartSlotPercent(pointCount) * Math.max(1, step)
  return { left: chartPointXPercent(index, pointCount) - width / 2, width }
}

/**
 * 类目标签字号（px）：盒子塞不下就等比缩，**缩到 `minRatio × fontPx` 为止**（再小低于可读
 * 下限，宁可交回省略号）。真机 S7：10 个游戏名里有 14 字符的长名挤 134px 槽，21px 必然剪
 * 成 `KittyCru…` —— 而这一屏的结论恰恰是「哪几款游戏吃掉了六成」。
 */
export function chartLabelFontPx(text: string, fontPx: number, boxWidthPx: number, minRatio = 0.7): number {
  if (boxWidthPx <= 0 || fontPx <= 0) return fontPx
  const estimated = estimateTextWidthPx(text, fontPx)
  if (estimated <= boxWidthPx) return fontPx
  return Math.max(fontPx * minRatio, (fontPx * boxWidthPx) / estimated)
}

/**
 * 类目标签抽稀（纯函数）：`labels` 最多 32 项而轴宽有限，30 点逐年全画必然重叠
 * （四季片 D-09：模型被迫隔年取样 16 点冒称「近三十年」—— 抽稀标签而不是砍数据点）。
 *
 * 规则：
 * - 都不给 ⇒ 全量（老 manifest 行为逐像素不变）；
 * - 显式 `labelEvery`（≥1 整数）优先，按步进取；`maxLabels` 只在没给 labelEvery 时生效；
 * - **首末点强制保留**：首点给时间轴起点，末点是 countUp 终值与「观众读到的最后一个数」
 *   的判据锚点（四季片 D-06：末点被裁 = 结论不成立）；
 * - `maxLabels` 均匀取（等距四舍五入，天然含首末）；上限语义下 `1` 等价 `2`
 *   （首末都保留是硬约束）。
 */
export function pickLabelIndices(pointCount: number, labelEvery?: number, maxLabels?: number): number[] {
  const n = Math.max(0, Math.floor(pointCount))
  if (n === 0) return []
  if (n === 1) return [0]
  const every = labelEvery !== undefined && Number.isFinite(labelEvery) && labelEvery >= 1 ? Math.floor(labelEvery) : undefined
  const cap = maxLabels !== undefined && Number.isFinite(maxLabels) && maxLabels >= 1 ? Math.floor(maxLabels) : undefined
  if (every !== undefined) {
    const out: number[] = []
    for (let i = 0; i < n; i += every) out.push(i)
    if (out[out.length - 1] !== n - 1) out.push(n - 1)
    return out
  }
  if (cap !== undefined) {
    const count = Math.min(n, Math.max(2, cap))
    const out: number[] = []
    for (let k = 0; k < count; k += 1) {
      const idx = Math.round((k * (n - 1)) / (count - 1))
      if (out[out.length - 1] !== idx) out.push(idx)
    }
    return out
  }
  return Array.from({ length: n }, (_, i) => i)
}

/**
 * 折线点在**画布百分比**上的位置（R11-DAT6）。
 *
 * 坐标链有三段，任何一段错位都是「引线指着空白处」：
 * ① `chartPointXPercent` 给的是**绘图区内**百分比；
 * ② 折线 svg 铺在绘图区里（`inset: plot.top/right/bottom/left`），不是整块盒；
 * ③ `callout.anchor` 要的是**画布**百分比。
 *
 * y 与 `Chart.tsx` 的 `cy = 100 - (v / axisMax) * 100` 同口径（`ratio` 就是 `v / axisMax`）——
 * 折线**没有**扣 plot 的 top/bottom 内边距，这里照抄，不另立一套更"正确"的算法，
 * 否则圆点和引线会差出几个百分点。
 *
 * @param ratio - `value / axisMax`（0–1；`axisMax` 见 `Chart.tsx` 的 `Math.max(...values,0)*1.08`）。
 */
export function chartPointOnCanvas(
  index: number,
  pointCount: number,
  ratio: number,
  chartBox: { x: number; y: number; w: number; h: number },
  hasTitle = false,
): { x: number; y: number } {
  const plot = chartPlotFor(hasTitle)
  const plotW = (chartBox.w * (100 - plot.left - plot.right)) / 100
  const plotH = (chartBox.h * (100 - plot.top - plot.bottom)) / 100
  const left = chartBox.x - chartBox.w / 2 + (chartBox.w * plot.left) / 100
  const top = chartBox.y - chartBox.h / 2 + (chartBox.h * plot.top) / 100
  return {
    x: left + (plotW * chartPointXPercent(index, pointCount)) / 100,
    // plotH 已是**画布高度百分比**（box.h × 绘图区占比），不能再 /100 ——
    // 多除一次会把点压到绘图区顶部（实测 y 从 49.8 变 35.6），圆点和引线各指一处。
    y: top + plotH * (1 - ratio),
  }
}

/** 某个值在画布上的 y（参考均值线用；与 `chartPointOnCanvas` 的 y 同一把尺子）。 */
export function chartValueY(
  ratio: number,
  chartBox: { x: number; y: number; w: number; h: number },
  hasTitle = false,
): number {
  const plot = chartPlotFor(hasTitle)
  const plotH = (chartBox.h * (100 - plot.top - plot.bottom)) / 100
  const top = chartBox.y - chartBox.h / 2 + (chartBox.h * plot.top) / 100
  return top + plotH * (1 - ratio)
}
