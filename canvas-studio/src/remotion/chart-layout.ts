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
