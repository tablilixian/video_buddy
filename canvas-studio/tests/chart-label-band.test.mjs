/**
 * CV-450：图表类目标签的定位不变量（真机事故回归）。
 *
 * 事故：`Chart.tsx` 里类目标签是 `position:absolute; top:'100%'` —— 那是**容器底部**，
 * 而布局已经用 `plot.bottom: 12` 在容器内预留了标签带 ⇒ 标签整体落在预留区下方，
 * 被 box 层的 `overflow: hidden` 裁掉。真机里 agent 三次裁切取证 + `inspect_image`
 * 像素确认「确实没渲染出来」，最后放弃修复、把年份塞进头部卡绕过。
 *
 * 这一条不能靠「源码里有这行字」守，所以把定位值提成导出常量，锁它的**几何关系**：
 * 标签必须落在绘图区底边，且下方留有预留带 ⇒ 一定在容器内。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartCategoryLabelTopPercent, chartPlotFor, CHART_CATEGORY_LABEL_TOP_PERCENT, CHART_PLOT, pickLabelIndices } from '../lib/remotion/chart-layout.js'

test('类目标签定位在容器内（不等于 100%，否则必然被 overflow 裁掉）', () => {
  assert.ok(CHART_CATEGORY_LABEL_TOP_PERCENT < 100, 'top=100% 就是旧 bug：标签在容器外')
  assert.ok(CHART_CATEGORY_LABEL_TOP_PERCENT > 0)
})

test('标签带宽度 === plot.bottom 预留量（布局与定位同源，不会各算各的）', () => {
  const band = 100 - CHART_CATEGORY_LABEL_TOP_PERCENT
  assert.equal(band, CHART_PLOT.bottom, '标签下方剩余空间必须正好是预留的 bottom')
})

test('标签顶边与绘图区底边重合（贴在图表下沿，不是悬空或被盖住）', () => {
  const plotBottomEdge = CHART_PLOT.top + (100 - CHART_PLOT.top - CHART_PLOT.bottom)
  assert.equal(CHART_CATEGORY_LABEL_TOP_PERCENT, plotBottomEdge)
})

test('绘图区高度为正（top+bottom 不超过 100）', () => {
  const plotH = 100 - CHART_PLOT.top - CHART_PLOT.bottom
  assert.ok(plotH > 0, `plotH=${plotH} 必须为正`)
})

// ── Q-A4 标题带（四季片 D-06）：老 manifest 无 title ⇒ 几何逐像素不变 ─────────

test('chartPlotFor(false) 与 CHART_PLOT 全等（无标题路径逐像素不变）', () => {
  assert.deepEqual(chartPlotFor(false), CHART_PLOT)
  assert.equal(chartCategoryLabelTopPercent(false), CHART_CATEGORY_LABEL_TOP_PERCENT)
})

test('标题带：有标题时顶边下移、标签顶边同步下移且仍在容器内', () => {
  const plot = chartPlotFor(true)
  assert.equal(plot.top, CHART_PLOT.top + 8, '顶带 = CHART_TITLE_BAND_PERCENT')
  assert.equal(plot.left, CHART_PLOT.left)
  assert.equal(plot.bottom, CHART_PLOT.bottom)
  const labelTop = chartCategoryLabelTopPercent(true)
  assert.equal(labelTop, plot.top + (100 - plot.top - plot.bottom), '标签仍贴绘图区底边')
  assert.ok(labelTop < 100, '仍在容器内（不会进 overflow 裁切区）')
})

// ── Q-A3 标签抽稀（四季片 D-09）：只抽标签不改数据点，首末点强制保留 ───────────

test('pickLabelIndices：都不给 ⇒ 全量（老 manifest 行为不变）', () => {
  assert.deepEqual(pickLabelIndices(4), [0, 1, 2, 3])
  assert.deepEqual(pickLabelIndices(0), [])
  assert.deepEqual(pickLabelIndices(1), [0])
})

test('pickLabelIndices：labelEvery 步进 + 末点强制保留', () => {
  assert.deepEqual(pickLabelIndices(16, 2), [0, 2, 4, 6, 8, 10, 12, 14, 15], '15 不在步进上但必须保留')
  assert.deepEqual(pickLabelIndices(7, 3), [0, 3, 6], '末点恰在步进上不重复')
  assert.deepEqual(pickLabelIndices(5, 10), [0, 4], '步进大于点数 ⇒ 首末两点')
})

test('pickLabelIndices：maxLabels 等距均匀且天然含首末', () => {
  assert.deepEqual(pickLabelIndices(5, undefined, 3), [0, 2, 4])
  assert.deepEqual(pickLabelIndices(30, undefined, 10)[0], 0, '首点保留')
  assert.equal(pickLabelIndices(30, undefined, 10)[9], 29, '末点保留')
  assert.equal(pickLabelIndices(30, undefined, 10).length, 10)
  assert.deepEqual(pickLabelIndices(5, undefined, 1), [0, 4], '上限 1 等价 2（首末都保留）')
  assert.deepEqual(pickLabelIndices(3, undefined, 10), [0, 1, 2], '上限大于点数 ⇒ 全量')
})

test('pickLabelIndices：labelEvery 显式给定时优先于 maxLabels', () => {
  assert.deepEqual(pickLabelIndices(7, 3, 2), [0, 3, 6], 'every 优先，maxLabels 忽略')
})
