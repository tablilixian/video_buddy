/**
 * CV-186 血缘聚光（canvas-lineage.ts）契约测试。
 *
 * 这条规则决定「**拖动**一个节点时，画布上哪些卡片降档」——它既是视觉，也是
 * 每次拖动都会跑的判定，所以口径必须钉在纯函数上，不能散在组件里靠肉眼回归。
 *
 * 与 DD-03 原版的三点差异，正是本文件要守住的：
 *  1. **距离分档**（1 跳亮 / 2 跳中间 / 3 跳以上与无关压暗），不再是「其余全压暗」；
 *  2. **两道安全阀**（簇外没有直接血缘就不启动、中间档覆盖过广就整体退档）；
 *  3. **托盘与成员同档**（取最亮档），不允许「亮托盘里套着灰成员」。
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

/** A ← B ← C ← E ← F，G 与谁都没关系。 */
const CHAIN = [
  node('A'),
  node('B', ['A']),
  node('C', ['B']),
  node('E', ['C']),
  node('F', ['E']),
  node('G'),
]

test('血缘聚光：1 跳亮、2 跳中间档、3 跳以上与无关压暗', () => {
  const spot = canvasSpotlight(CHAIN, ['B'])
  assert.equal(spot.active, true)
  // B 自己 + 上游 A + 下游 C；E 是 2 跳（中间档）；F 是 3 跳、G 无关 —— 都压暗。
  assert.deepEqual([...spot.lit].sort(), ['A', 'B', 'C'])
  assert.deepEqual([...spot.near], ['E'])
  assert.deepEqual([...spot.dim].sort(), ['F', 'G'])
})

test('CV-186 安全阀①：簇外没有直接血缘就不启动（孤立节点）', () => {
  const spot = canvasSpotlight(CHAIN, ['G'])
  assert.equal(spot.active, false)
  assert.deepEqual([...spot.lit], [])
  assert.equal(spot.dim.size, 0, '不启动时一个节点也不压暗')
})

test('CV-186 安全阀①：血缘只在簇内（拖托盘成员）时不启动', () => {
  // 托盘 T 里 M2 引用 M1；拖 M1 时簇 = {T, M1, M2}，唯一的 1 跳邻居 M2 在簇内
  // ⇒ 压暗揭示不了任何簇外关系，按规则一格都不压。
  const nodes = [
    node('T', [], { kind: 'group' }),
    node('M1', [], { parentId: 'T' }),
    node('M2', ['M1'], { parentId: 'T' }),
    node('U'),
  ]
  const spot = canvasSpotlight(nodes, ['M1'])
  assert.equal(spot.active, false)
})

test('CV-186 安全阀②：中间档铺满整屏时整体退到亮档', () => {
  // 星形：枢纽 H + 20 张叶子。拖任意一张叶子 → 其余 19 张叶子互为 2 跳，
  // 占全画布的 82% > 70% ⇒ 中间档整体退到亮档（等价于「只压无关」）。
  const leaves = Array.from({ length: 20 }, (_, index) => node(`L${index}`, ['H']))
  const nodes = [node('H'), ...leaves, node('X'), node('Y')]
  const spot = canvasSpotlight(nodes, ['L0'])
  assert.equal(spot.active, true)
  assert.equal(spot.near.size, 0, '中间档被安全阀②退掉')
  assert.equal(spot.lit.has('L1'), true, '其余叶子回到亮档')
  assert.deepEqual([...spot.dim].sort(), ['X', 'Y'])
})

test('CV-186 安全阀②的反面：中间档占比不高时保留（不是无条件退档）', () => {
  // 4 张叶子 + 20 张无关：2 跳那一层只占 12% ⇒ 中间档保留。
  const leaves = Array.from({ length: 4 }, (_, index) => node(`L${index}`, ['H']))
  const noise = Array.from({ length: 20 }, (_, index) => node(`N${index}`))
  const nodes = [node('H'), ...leaves, ...noise]
  const spot = canvasSpotlight(nodes, ['L0'])
  assert.deepEqual([...spot.near].sort(), ['L1', 'L2', 'L3'])
  assert.equal(spot.lit.has('H'), true)
})

test('CV-186 托盘与成员同档：不出现「亮托盘里套着灰成员」', () => {
  // S 是 M1 的来源（簇外 1 跳 ⇒ 亮）；M2 与谁都没血缘（本会落进压暗档），
  // 托盘 T 自己也没有血缘 —— 三者必须同档，取最亮的那个。
  const nodes = [
    node('S'),
    node('T', [], { kind: 'group' }),
    node('M1', ['S'], { parentId: 'T' }),
    node('M2', [], { parentId: 'T' }),
    node('U'),
  ]
  const spot = canvasSpotlight(nodes, ['S'])
  assert.equal(spot.active, true)
  assert.deepEqual([...spot.lit].sort(), ['M1', 'M2', 'S', 'T'], '成员与托盘一起留在亮档')
  assert.deepEqual([...spot.dim], ['U'])
})

test('CV-186 拖托盘：从整簇出发算距离，成员对外的血缘依然点亮', () => {
  // 托盘自己对外没有血缘，若只从托盘本体出发走 BFS，整簇会退化成孤岛、
  // 安全阀① 把它的外界关系全挡掉。规则是「从整簇出发」。
  const nodes = [
    node('S'),
    node('T', [], { kind: 'group' }),
    node('M1', ['S'], { parentId: 'T' }),
    node('M2', [], { parentId: 'T' }),
    node('U'),
  ]
  const spot = canvasSpotlight(nodes, ['T'])
  assert.equal(spot.active, true)
  assert.deepEqual([...spot.lit].sort(), ['M1', 'M2', 'S', 'T'])
  assert.deepEqual([...spot.dim], ['U'])
})

test('CV-186 托盘与成员同档：整个簇都该压暗时不许被抬亮', () => {
  // 反向用例：簇里**没有任何一张**与本次拖动沾亲（T/M1/M2 与 X/A 无关），
  // 三张必须一起落到压暗档。少了这一条，「取最亮档」会被写成「无条件抬成亮档」
  // 而前面的用例照样全绿（反向验证实测逮到过这个写法）。
  const nodes = [
    node('A'),
    node('X', ['A']),
    node('T', [], { kind: 'group' }),
    node('M1', [], { parentId: 'T' }),
    node('M2', [], { parentId: 'T' }),
    node('U'),
  ]
  const spot = canvasSpotlight(nodes, ['X'])
  assert.equal(spot.active, true)
  assert.deepEqual([...spot.lit].sort(), ['A', 'X'])
  assert.deepEqual([...spot.dim].sort(), ['M1', 'M2', 'T', 'U'])
})

test('血缘聚光：多选时取到最近一个被拖节点的跳数', () => {
  const spot = canvasSpotlight(CHAIN, ['A', 'C'])
  // 到 {A, C} 的距离：B = 1（两侧都连）、E = 1（C 的下游）、F = 2 ⇒ 中间档。
  assert.deepEqual([...spot.lit].sort(), ['A', 'B', 'C', 'E'])
  assert.deepEqual([...spot.near], ['F'])
  assert.deepEqual([...spot.dim], ['G'])
})

test('血缘聚光：指向不存在节点的 sourceId 不点亮（看不见的 id 不进集合）', () => {
  const nodes = [node('A'), node('B', ['A', 'ghost']), node('U')]
  const spot = canvasSpotlight(nodes, ['B'])
  assert.deepEqual([...spot.lit].sort(), ['A', 'B'])
  assert.deepEqual([...spot.dim], ['U'])
})

test('血缘聚光：幽灵 parentId（父节点已删）不当成托盘成员', () => {
  const nodes = [node('A'), node('B', ['A'], { parentId: 'gone' }), node('U')]
  const spot = canvasSpotlight(nodes, ['A'])
  assert.deepEqual([...spot.lit].sort(), ['A', 'B'])
  assert.deepEqual([...spot.dim], ['U'])
})

test('血缘聚光：不在画布上的被拖 id 被忽略（节点刚被删）', () => {
  const spot = canvasSpotlight(CHAIN, ['gone'])
  assert.equal(spot.active, false)
  assert.equal(spot.lit.size, 0)
  assert.equal(spot.near.size, 0)
  assert.equal(spot.dim.size, 0)
})

test('血缘聚光：空被拖集合不启用', () => {
  const spot = canvasSpotlight(CHAIN, [])
  assert.equal(spot.active, false)
  assert.equal(spot.dim.size, 0)
})

test('血缘聚光：纯函数不改写入参（nodes / draggingIds 原样）', () => {
  const nodes = [node('A'), node('B', ['A'])]
  const dragging = ['B']
  canvasSpotlight(nodes, dragging)
  assert.equal(nodes.length, 2)
  assert.deepEqual(dragging, ['B'])
  assert.deepEqual(nodes[1].sourceIds, ['A'])
})
