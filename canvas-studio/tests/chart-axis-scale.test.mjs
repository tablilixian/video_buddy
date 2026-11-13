/**
 * 图表 x 轴尺度不变量（真机事故回归 · 2026-11-13 S3/S9）。
 *
 * 事故：柱 / 柱顶数值 / 类目标签用的是 `plotW / n`（盒子百分比），而它们全都住在
 * **已经 inset 过的绘图容器**里 —— 容器的 `100%` 不是盒子的 `100%`。于是柱与折线落在
 * 两个不同的 x 尺度上（折线右端探到绘图区最右，柱子只排到五分之四处），并且每根柱的
 * 数值标签槽宽少算 17%，`42055人` 折行成「42055 / 人」，第二个字落到轴外。
 *
 * 这一条不能靠「源码里有这行字」守，所以把尺子提成纯函数，锁三条几何关系：
 *   1. 槽宽 × 点数 === 100（容器内百分比，自洽）；
 *   2. 柱中心 === 折线点 x（同一把尺子，不可能分叉）；
 *   3. 抽稀后的标签盒按**实际间距**给宽 —— 相邻盒不重叠，且远宽于单槽。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chartLabelBox,
  chartLabelFontPx,
  chartPointXPercent,
  chartSlotPercent,
  pickLabelIndices,
} from '../lib/remotion/chart-layout.js'

test('槽宽 × 点数 === 100（容器内百分比必须自洽）', () => {
  for (const n of [1, 2, 10, 20, 32]) {
    assert.ok(Math.abs(chartSlotPercent(n) * n - 100) < 1e-9, `n=${n}`)
  }
  assert.equal(chartSlotPercent(0), 100, '0 点退化为满宽（不得除零）')
})

test('柱中心与折线点逐点相等，且落在首/末槽中心', () => {
  const n = 20
  const slot = chartSlotPercent(n)
  for (let i = 0; i < n; i += 1) {
    // 折线点（Chart.tsx 的 polyline/circle）直接用这个函数；柱中心也用它 ⇒ 恒等。
    assert.ok(Math.abs(chartPointXPercent(i, n) - (i + 0.5) * slot) < 1e-9)
    const box = chartLabelBox(i, n, 1)
    assert.ok(Math.abs(box.left + box.width / 2 - chartPointXPercent(i, n)) < 1e-9, '标签盒必须居中在点上')
  }
  assert.equal(chartPointXPercent(0, n), slot / 2)
  assert.equal(chartPointXPercent(n - 1, n), 100 - slot / 2, '末柱必须摸到绘图区右沿（旧 bug 停在 ~79）')
})

test('抽稀后的标签盒按实际间距给宽：互不重叠，且宽于单槽', () => {
  const n = 20
  const picked = pickLabelIndices(n, undefined, 10)
  assert.equal(picked.length, 10)
  const step = n / picked.length
  const boxes = picked.map((i) => chartLabelBox(i, n, step))
  for (let k = 1; k < boxes.length; k += 1) {
    assert.ok(
      boxes[k].left >= boxes[k - 1].left + boxes[k - 1].width - 1e-9,
      `第 ${k} 个标签盒与上一个重叠：${JSON.stringify([boxes[k - 1], boxes[k]])}`,
    )
  }
  assert.ok(boxes[1].width > chartSlotPercent(n) * 1.5, '抽稀 10/20 后盒子应约为两槽宽（否则 25/04 被剪成 25…）')
})

test('全量显示（maxLabels=20）时盒子仍是单槽宽，不互相侵占', () => {
  const n = 20
  const boxes = Array.from({ length: n }, (_, i) => chartLabelBox(i, n, 1))
  for (let k = 1; k < boxes.length; k += 1) {
    assert.equal(boxes[k].left, boxes[k - 1].left + boxes[k - 1].width)
  }
})

test('类目标签字号：放得下就不缩，放不下缩但不越下限', () => {
  const font = 21
  const long = 'KittyCrushSaga'
  const narrowPx = 134
  assert.equal(chartLabelFontPx('25/04', font, 400), font, '宽裕时必须原字号')
  const shrunk = chartLabelFontPx(long, font, narrowPx)
  assert.ok(shrunk < font, '塞不下必须缩')
  assert.ok(shrunk >= font * 0.7 - 1e-9, '不得低于可读下限')
  assert.ok(chartLabelFontPx(long, font, 0) === font, '盒宽非法时不得算出 0 字号')
})
