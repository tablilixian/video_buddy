/**
 * canvas-geometry 纯函数冒烟测试：CV-038 起草线/正式边共用同一条贝塞尔。
 * 直连 Host tsc 编译产物 lib/canvas-geometry.js。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEdgePath, edgeControlBounds, sourceAnchor, targetAnchor } from '../lib/canvas-geometry.js'

/** 构造一个最小合法盒子。 */
function box(extra = {}) {
  return { x: 0, y: 0, width: 480, height: 270, ...extra }
}

test('sourceAnchor：来源节点右缘中点', () => {
  assert.deepEqual(sourceAnchor(box({ x: 100, y: 50, width: 480, height: 270 })), { x: 580, y: 185 })
})

test('targetAnchor：目标节点左缘中点', () => {
  assert.deepEqual(targetAnchor(box({ x: 900, y: 50, width: 480, height: 270 })), { x: 900, y: 185 })
})

test('buildEdgePath：输出三次贝塞尔而非直线（CV-038 回归）', () => {
  const d = buildEdgePath({ x: 580, y: 185 }, { x: 900, y: 185 })
  assert.match(d, /^M 580 185 C /)
  // 控制点按水平距离的一半外扩：两端水平外推，纵向保持不变。
  assert.equal(d, 'M 580 185 C 740 185, 740 185, 900 185')
})

test('buildEdgePath：纵向错位时控制点仍只做水平外扩', () => {
  const d = buildEdgePath({ x: 0, y: 0 }, { x: 200, y: 300 })
  assert.equal(d, 'M 0 0 C 100 0, 100 300, 200 300')
})

test('buildEdgePath：目标在来源左侧时控制点取绝对值（不外扩成负向自交）', () => {
  // 反向连线：|to.x - from.x| 保证控制点偏移为正，曲线形态与正向对称。
  const d = buildEdgePath({ x: 500, y: 0 }, { x: 100, y: 0 })
  assert.equal(d, 'M 500 0 C 700 0, -100 0, 100 0')
})

test('CV-038：起草线落点与正式边锚点重合，落定前后不跳变', () => {
  // 起草线拖拽时起点 = sourceAnchor(来源)，落点 = 光标世界坐标；
  // 松手落定后落点 = targetAnchor(目标)。锁定两者用的是同一条路径函数。
  const source = box({ x: 100, y: 50 })
  const target = box({ x: 900, y: 50 })
  const from = sourceAnchor(source)
  const to = targetAnchor(target)
  const draft = buildEdgePath(from, { x: to.x, y: to.y })
  assert.equal(draft, buildEdgePath(from, to))
  // 关键：起点不再是「指针按下的位置」，而是节点的右缘中点。
  assert.equal(draft.startsWith(`M ${from.x} ${from.y} `), true)
})

// --- A-2 步骤二：edgeControlBounds（边视口裁剪的外包盒） ---

test('A-2 edgeControlBounds：正向边 = 端点包围盒（控制点落在两端之间）', () => {
  const from = sourceAnchor(box({ x: 100, y: 50 }))
  const to = targetAnchor(box({ x: 900, y: 50 }))
  // from=(580,185) to=(900,185)：跨度 320，控制点在中点，盒就是端点 bbox。
  assert.deepEqual(edgeControlBounds(from, to), { x: 580, y: 185, width: 320, height: 0 })
})

test('A-2 edgeControlBounds：反向边放宽半个跨度的越界控制点', () => {
  // from=(500,0) to=(100,0)：控制点在 700 与 -100（buildEdgePath 已有同款断言），
  // 盒必须罩住它们：x ∈ [-100, 700]，宽 800 = 端点跨度 400 的 2 倍。
  assert.deepEqual(edgeControlBounds({ x: 500, y: 0 }, { x: 100, y: 0 }),
    { x: -100, y: 0, width: 800, height: 0 })
})

test('A-2 edgeControlBounds：纵向错位只影响 y 区间（控制点不纵向外扩）', () => {
  assert.deepEqual(edgeControlBounds({ x: 0, y: 0 }, { x: 200, y: 300 }),
    { x: 0, y: 0, width: 200, height: 300 })
})

test('A-2 edgeControlBounds：与 buildEdgePath 同源 —— d 里的控制点恒在盒内', () => {
  // 共享数学的守护断言：无论 from/to 怎么摆，路径字符串里的四个坐标点
  // （起点 / 两个控制点 / 落点）都必须落在 edgeControlBounds 的盒内。
  const pairs = [
    [{ x: 580, y: 185 }, { x: 900, y: 185 }],
    [{ x: 500, y: 0 }, { x: 100, y: 0 }],
    [{ x: 0, y: 0 }, { x: 200, y: 300 }],
    [{ x: 900, y: 400 }, { x: 10, y: -50 }],
    [{ x: 42, y: 42 }, { x: 42, y: 42 }],
  ]
  for (const [from, to] of pairs) {
    const bounds = edgeControlBounds(from, to)
    const points = buildEdgePath(from, to).match(/-?[\d.]+/g) ?? []
    for (let i = 0; i < points.length; i += 2) {
      const x = Number(points[i])
      const y = Number(points[i + 1])
      assert.ok(x >= bounds.x - 1e-9 && x <= bounds.x + bounds.width + 1e-9,
        `点 ${x},${y} 的 x 越界（盒 ${JSON.stringify(bounds)}，from=${JSON.stringify(from)}）`)
      assert.ok(y >= bounds.y - 1e-9 && y <= bounds.y + bounds.height + 1e-9,
        `点 ${x},${y} 的 y 越界（盒 ${JSON.stringify(bounds)}）`)
    }
  }
})
