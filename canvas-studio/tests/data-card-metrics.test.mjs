/**
 * 数据卡尺寸求解（2026-11-06 真机回归）。
 *
 * 事故：`TextCard` 里 `width: 940` 写死，带 `box` 时容器宽是 `box.w%`，层上还有
 * `overflow:hidden` ⇒ 窄盒子把卡片两侧裁掉（"数据卡压住折线中段""右半边数字被削"），
 * 宽盒子仍是 940 居中压住旁边的图表。模型改 box 对这张卡不生效，只能靠组件修。
 *
 * 本文件锁三件事：
 *  1. 1080p 无 box ⇒ 外宽 1060、缩放 1（老 manifest 逐像素不变）；
 *  2. 容器变窄 ⇒ 等比缩小，且**永远不超出容器**（旧行为是溢出被裁）；
 *  3. 容器变宽 ⇒ 不拉伸（上限仍是设计外宽）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DATA_CARD_CONTENT_WIDTH,
  DATA_CARD_OUTER_WIDTH,
  DATA_CARD_PADDING_X,
  dataCardMetrics,
} from '../lib/remotion/data-card-metrics.js'

const FULL_HD = 1920
const P480 = 864 // 480p 梯级：864×480

test('设计外宽 = 内容宽 + 左右内距（历史输出就是 1060）', () => {
  assert.equal(DATA_CARD_CONTENT_WIDTH, 940)
  assert.equal(DATA_CARD_PADDING_X, 60)
  assert.equal(DATA_CARD_OUTER_WIDTH, 1060)
})

test('1080p 无 box：外宽 1060、缩放 1（老 manifest 逐像素不变）', () => {
  const m = dataCardMetrics(undefined, FULL_HD)
  assert.equal(m.outerWidth, DATA_CARD_OUTER_WIDTH)
  assert.equal(m.scale, 1)
})

test('宽盒子不拉伸：box.w=80 仍是设计尺寸', () => {
  const m = dataCardMetrics({ w: 80 }, FULL_HD) // 1536px 容器
  assert.equal(m.outerWidth, DATA_CARD_OUTER_WIDTH)
  assert.equal(m.scale, 1)
})

test('窄盒子等比缩小，且不超出容器（旧实现溢出被裁）', () => {
  const m = dataCardMetrics({ w: 30 }, FULL_HD) // 576px 容器
  assert.equal(Math.round(m.outerWidth), 576)
  assert.ok(m.outerWidth <= 576, '外宽绝不能超过容器')
  assert.ok(m.scale < 1, '窄容器必须缩小，而不是溢出被裁')
  assert.equal(m.scale.toFixed(4), (576 / 1060).toFixed(4))
})

test('480p 画布（864）：铺满卡也要收进来，不再两侧溢出', () => {
  const m = dataCardMetrics(undefined, P480)
  assert.equal(m.outerWidth, P480)
  assert.ok(m.scale < 1)
})

test('缩放随盒子宽度单调递减（改 box 从此有效）', () => {
  // 容器超过设计外宽（>1060/1920≈55.2%）时一律 scale=1（不拉伸）
  for (const w of [80, 60]) {
    assert.equal(dataCardMetrics({ w }, FULL_HD).scale, 1, `box.w=${w} 超过设计外宽，不应缩放`)
  }
  // 低于设计外宽后严格递减
  const widths = [50, 40, 30, 20, 10]
  const scales = widths.map((w) => dataCardMetrics({ w }, FULL_HD).scale)
  for (let i = 1; i < scales.length; i += 1) {
    assert.ok(scales[i] < scales[i - 1], `box.w=${widths[i]} 的缩放必须小于 box.w=${widths[i - 1]}`)
  }
  assert.ok(scales.every((s) => s > 0 && s <= 1), '缩放系数必须落在 (0,1]')
})

test('非法输入回落到设计尺寸（不产生 0 宽 / NaN 卡片）', () => {
  for (const canvasWidth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const m = dataCardMetrics(undefined, canvasWidth)
    assert.equal(m.outerWidth, DATA_CARD_OUTER_WIDTH, `canvasWidth=${canvasWidth} 应回落`)
    assert.equal(m.scale, 1)
  }
  for (const w of [0, -20, Number.NaN]) {
    const m = dataCardMetrics({ w }, FULL_HD)
    assert.equal(m.outerWidth, DATA_CARD_OUTER_WIDTH, `box.w=${w} 应回落`)
  }
})
