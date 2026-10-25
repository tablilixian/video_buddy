/**
 * 项目级布局坐标表（`layout.json`）的纯函数守卫。
 *
 * 为什么值得单独测：这张表是 agent 的「量一次、用全片」工作台，一旦归一化把非法矩形
 * 悄悄放进来，模型会照着错坐标铺满整片；反过来把合法矩形误丢，它会以为没存上、反复重写。
 * 所以两条边界都要钉：**能落地的一定合法，丢弃一定有记录**。
 *
 * 运行：node --test tests/layout-table.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutTableToManifestSnippet, normalizeLayoutTable } from '../lib/layout-table.js'

test('L·①：合法矩形原样保留（x/y 中心语义，2 位小数）', () => {
  const { table, dropped } = normalizeLayoutTable({
    dialArea: { rect: { x: 64, y: 50, w: 30, h: 55 }, note: '手表表盘' },
  })
  assert.deepEqual(dropped, [])
  assert.deepEqual(table.dialArea?.rect, { x: 64, y: 50, w: 30, h: 55 })
  assert.equal(table.dialArea?.note, '手表表盘')
})

test('L·②：矩形越出画布 ⇒ 拒收（中心语义下要验四条边）', () => {
  const { table, dropped } = normalizeLayoutTable({
    // 中心 x=5、宽 30 ⇒ 左边缘在 -10，画布外
    offCanvas: { rect: { x: 5, y: 50, w: 30, h: 30 } },
  })
  assert.equal(table.offCanvas, undefined)
  assert.equal(dropped.length, 1)
  assert.match(dropped[0], /offCanvas/u)
})

test('L·③：w/h 必须 > 0，缺字段也拒收', () => {
  const { table } = normalizeLayoutTable({
    zeroW: { rect: { x: 50, y: 50, w: 0, h: 20 } },
    missingH: { rect: { x: 50, y: 50, w: 20 } },
  })
  assert.equal(Object.keys(table).length, 0)
})

test('L·④：名字必须字母开头 —— 中文/数字开头的键一律拒收并报原因', () => {
  const { table, dropped } = normalizeLayoutTable({
    表盘: { rect: { x: 50, y: 50, w: 20, h: 20 } },
    '1st': { rect: { x: 50, y: 50, w: 20, h: 20 } },
    dialArea: { rect: { x: 50, y: 50, w: 20, h: 20 } },
  })
  assert.deepEqual(Object.keys(table), ['dialArea'], '只有合法名字留下')
  assert.equal(dropped.length, 2, '每条丢弃都要留痕，不许静默')
})

test('L·⑤：混合输入 —— 合法的全留、非法的全报（一张坏条目不该毁掉整张表）', () => {
  const { table, dropped } = normalizeLayoutTable({
    leftRail: { rect: { x: 15, y: 50, w: 25, h: 80 } },
    subtitleBand: { rect: { x: 50, y: 92, w: 80, h: 12 } },
    bad: { rect: { x: 99, y: 99, w: 40, h: 40 } },
  })
  assert.deepEqual(Object.keys(table).sort(), ['leftRail', 'subtitleBand'])
  assert.equal(dropped.length, 1)
})

test('L·⑥：片段输出可直接粘 —— 带 box 四值 + 名字，且明说中心语义', () => {
  const { table } = normalizeLayoutTable({
    dialArea: { rect: { x: 64, y: 50, w: 30, h: 55 }, note: '表盘' },
  })
  const snippet = layoutTableToManifestSnippet(table)
  assert.match(snippet, /dialArea/u)
  assert.match(snippet, /"x": 64/u)
  assert.match(snippet, /"w": 30/u)
  assert.match(snippet, /表盘/u, '备注要带上，否则下次不知道这块是什么')
})

test('L·⑦：空表给可行动提示，不是空字符串', () => {
  const { table } = normalizeLayoutTable({})
  assert.match(layoutTableToManifestSnippet(table), /空表|inspect_image/u)
})
