/**
 * DD-03 血缘聚光（canvas-lineage.ts）契约测试。
 *
 * 这条规则决定「选中一个节点时，画布上哪些卡片被压暗」——它既是视觉，
 * 也是**每次点选都会跑**的判定，所以口径必须钉在纯函数上，不能散在
 * 组件里靠肉眼回归。四个用例各自对应一条边界：
 *
 * 1. 一跳血缘（上游 + 下游），不是多跳 —— 多跳会扩散成全亮，聚光失效；
 * 2. 孤立节点**不启用**压暗 —— 压暗是揭示关系的手段，没关系可揭示时它只
 *    会把整屏压灰（这是最容易被骂的一种「优化」）；
 * 3. 血缘里指向不存在节点的 id 不参与 —— 否则会点亮画布上根本没有的 id；
 * 4. 隐藏节点不参与血缘计算 —— 调用方只喂可见节点，隐藏节点不该「隔着画布」
 *    维持别人的血缘。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canvasSpotlight } from '../lib/canvas-lineage.js'

function node(id, sourceIds = [], extra = {}) {
  return {
    id,
    kind: 'video',
    x: 0,
    y: 0,
    width: 260,
    height: 180,
    createdAt: 0,
    origin: 'agent',
    sourceIds,
    ...extra,
  }
}

/** A → B → C，D 独立。 */
const CHAIN = [
  node('A'),
  node('B', ['A']),
  node('C', ['B']),
  node('D'),
]

test('血缘聚光：选中项 + 一跳上下游点亮，其余压暗', () => {
  const spot = canvasSpotlight(CHAIN, ['B'])
  assert.equal(spot.active, true)
  // B 自己 + 上游 A + 下游 C；A 的祖先没有，C 的后代（无）也没有。
  assert.deepEqual([...spot.lit].sort(), ['A', 'B', 'C'])
  assert.equal(spot.lit.has('D'), false)
})

test('血缘聚光：孤立节点不触发压暗（压暗是揭示关系的手段）', () => {
  const spot = canvasSpotlight(CHAIN, ['D'])
  assert.equal(spot.active, false)
  assert.deepEqual([...spot.lit], ['D'])
})

test('血缘聚光：不做多跳——A 的血缘只有下游 B，不连带 C', () => {
  const spot = canvasSpotlight(CHAIN, ['A'])
  assert.deepEqual([...spot.lit].sort(), ['A', 'B'])
  assert.equal(spot.active, true)
})

test('血缘聚光：多选时取并集，且互相引用的两端都算', () => {
  const spot = canvasSpotlight(CHAIN, ['A', 'C'])
  // A → B（下游）、C ← B（上游）⇒ B 被两侧同时点亮；D 始终无关。
  assert.deepEqual([...spot.lit].sort(), ['A', 'B', 'C'])
  assert.equal(spot.active, true)
})

test('血缘聚光：指向不存在节点的 sourceId 不点亮（看不见的 id 不进集合）', () => {
  const nodes = [node('A'), node('B', ['A', 'ghost'])]
  const spot = canvasSpotlight(nodes, ['B'])
  assert.deepEqual([...spot.lit].sort(), ['A', 'B'])
})

test('血缘聚光：不在画布上的选中 id 被忽略（节点刚被删）', () => {
  const spot = canvasSpotlight(CHAIN, ['gone'])
  assert.equal(spot.active, false)
  assert.deepEqual([...spot.lit], [])
})

test('血缘聚光：空选中集不启用', () => {
  const spot = canvasSpotlight(CHAIN, [])
  assert.equal(spot.active, false)
  assert.equal(spot.lit.size, 0)
})

test('血缘聚光：纯函数不改写入参（nodes / selectedIds 原样）', () => {
  const nodes = [node('A'), node('B', ['A'])]
  const selected = ['B']
  canvasSpotlight(nodes, selected)
  assert.equal(nodes.length, 2)
  assert.deepEqual(selected, ['B'])
  assert.deepEqual(nodes[1].sourceIds, ['A'])
})
