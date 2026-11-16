/**
 * P0-3（REQ-038 R11 二轮，2026-11-16）：**DAT3 卡内轨不相交闸**。
 *
 * ## 抓的是什么缺陷
 *
 * DAT3 的 `summary`（数据浮卡）旧 box `{x:22,y:30,w:34,h:26}` 与 `chart`（柱图）
 * `{x:50,y:56,w:76,h:52}` 相交 39.7% —— 真机二轮抽帧里「数据卡压在柱顶」。
 * spec 层的格位相交校验（>5% 拒收）**管不到卡内**，所以这个缺陷永远不会被别的闸发现。
 *
 * 顺带钉住：`summary` 的标题只吃 `label` 第一段 —— 旧实现与 `-title` 轨同写整段
 * `ctx.label`，`label` 是 `波动率 | 高→卖 | 低→买` 这种长串时同屏打两遍。
 *
 * 反向变异：把 box 改回旧值（或任何与 chart 相交的值）⇒ 第 1 条必红。
 * 直连编译产物 `lib/`。定向跑：node --test tests/req038-r11-dat3-overlap.test.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCard } from '../lib/remotion/recipe-cards-all.js'

/** 与 scripts/gen-card-catalog.mjs 的 mockCtx 同口径。 */
function mockCtx(copy, label) {
  return {
    segmentId: 'p',
    label,
    copy,
    startFrame: 0,
    durationInFrames: 120,
    index: 0,
    sectionCount: 1,
    assetSrc: () => undefined,
    accentColor: '#4f9cf9',
    unitIndex: 0,
    unitCount: 1,
    dataSource: 'observed',
  }
}

/** box 是「中心点 + 宽高百分比」：返回 [x1, x2, y1, y2]。 */
function extentOf(box) {
  return [box.x - box.w / 2, box.x + box.w / 2, box.y - box.h / 2, box.y + box.h / 2]
}

/** 相交面积占 a 自身面积的百分比（与 spec 层格位校验同口径）。 */
function overlapPercent(a, b) {
  const [ax1, ax2, ay1, ay2] = extentOf(a)
  const [bx1, bx2, by1, by2] = extentOf(b)
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1))
  if (ix <= 0 || iy <= 0) return 0
  return (ix * iy / ((ax2 - ax1) * (ay2 - ay1))) * 100
}

function dat3Tracks() {
  const card = getCard('DAT3')
  assert.ok(card, 'DAT3 必须在注册表里')
  return card.generate(mockCtx('买入:99; 卖出:101; 持有:37', '波动率 | 高→卖 | 低→买'))
}

test('DAT3：summary 与 chart 的卡内相交面积 = 0（浮卡不压柱图）', () => {
  const chart = dat3Tracks().find((track) => String(track.id).endsWith('-chart'))
  const summary = dat3Tracks().find((track) => String(track.id).endsWith('-summary'))
  assert.ok(chart && summary, 'DAT3 必须产出 chart 与 summary 两条轨')
  const overlap = overlapPercent(summary.box, chart.box)
  assert.equal(overlap, 0, `DAT3 summary 与 chart 相交 ${overlap.toFixed(1)}%（旧缺陷 39.7%）——数据浮卡会压在柱图上`)
  // 顺带钉住空档：summary 必须落在 title（y≤15）与 chart（y≥30）之间，别压到第三条轨
  const [, , sy1, sy2] = extentOf(summary.box)
  assert.ok(sy2 <= 30, `summary 下缘 ${sy2}% 侵入 chart 区（chart 从 y=30% 起）`)
})

test('DAT3：summary 标题只吃 label 第一段（旧实现整段打两遍）', () => {
  const summary = dat3Tracks().find((track) => String(track.id).endsWith('-summary'))
  assert.equal(summary.text, '波动率', `summary.text 应为 label 第一段，实际：${summary.text}`)
})

test('反向变异：把 summary box 改回旧值 ⇒ 闸必须报出 39.7% 相交（证明不是恒绿）', () => {
  const chart = dat3Tracks().find((track) => String(track.id).endsWith('-chart'))
  const oldBox = { x: 22, y: 30, w: 34, h: 26 }
  const overlap = overlapPercent(oldBox, chart.box)
  assert.ok(overlap > 5, `旧 box 与 chart 的实测相交应是 39.7%（实际 ${overlap.toFixed(1)}%）——chart 的 box 变了就更新本断言`)
})
