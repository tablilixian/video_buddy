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
import { CHART_CATEGORY_LABEL_TOP_PERCENT, CHART_PLOT } from '../lib/remotion/chart-layout.js'

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
