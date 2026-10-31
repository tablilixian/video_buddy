/**
 * CV-384：视口裁剪纯函数（src/canvas-cull.ts）契约。
 *
 * 这组函数是连线视口裁剪（CanvasEdges，A-2 步骤二）与节点侧 B 案兜底
 * （React 条件挂载，content-visibility 真机实证失效时启用）共用的口径 ——
 * 边界值钉在纯函数上，不靠真机肉眼回归。margin 按**屏幕像素**给、除以
 * scale 换算成世界像素：0.1x 时 48px 屏幕余量膨胀到 480 世界 px，这一条
 * 是低倍率下不漏裁的关键。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 * （直连 lib 编译产物，改 canvas-cull.ts 后须先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeIntersectsViewport, rectIntersects, viewportWorldRect } from '../lib/canvas-cull.js'

test('G2-①：viewportWorldRect —— 1x 基准（与 A-2 步骤二原内联公式逐值一致）', () => {
  const rect = viewportWorldRect(
    { x: 100, y: 50, scale: 1 },
    { width: 800, height: 600 },
    48,
  )
  assert.deepEqual(rect, { x: -148, y: -98, width: 896, height: 696 })
})

test('G2-②：margin 按屏幕像素给、随 scale 反算 —— 0.1x 膨胀、5x 收缩', () => {
  const zoomedOut = viewportWorldRect({ x: 0, y: 0, scale: 0.1 }, { width: 800, height: 600 }, 48)
  assert.equal(zoomedOut.width, 800 / 0.1 + 480 * 2, '48px 屏幕余量在 0.1x = 480 世界 px')
  assert.equal(zoomedOut.x, -480)
  const zoomedIn = viewportWorldRect({ x: 0, y: 0, scale: 5 }, { width: 800, height: 600 }, 48)
  assert.equal(zoomedOut.width > zoomedIn.width, true, '放大时同一屏幕余量覆盖的世界区更小')
  assert.equal(zoomedIn.width, 800 / 5 + 48 / 5 * 2)
})

test('G2-③：rectIntersects —— 相交 / 相离 / 边缘贴合（贴边不算相交）', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(rectIntersects(a, { x: 50, y: 50, width: 100, height: 100 }), true, '重叠')
  assert.equal(rectIntersects(a, { x: 200, y: 200, width: 10, height: 10 }), false, '相离')
  assert.equal(rectIntersects(a, { x: 100, y: 0, width: 50, height: 50 }), false, '右缘贴合不算')
  assert.equal(rectIntersects(a, { x: -50, y: 100, width: 50, height: 50 }), false, '底缘贴合不算')
  assert.equal(rectIntersects(a, { x: 99, y: 99, width: 50, height: 50 }), true, '1px 侵入算相交')
})

test('G2-④：nodeIntersectsViewport —— 节点框口径（B 案兜底直接取用）', () => {
  const viewport = viewportWorldRect({ x: 0, y: 0, scale: 1 }, { width: 800, height: 600 }, 0)
  assert.equal(nodeIntersectsViewport({ x: 100, y: 100, width: 200, height: 150 }, viewport), true)
  assert.equal(nodeIntersectsViewport({ x: 5000, y: 5000, width: 200, height: 150 }, viewport), false, '远端节点不在视口')
  // margin 生效：视口外 47px 的节点仍在裁剪框内（笔画/箭头可伸进来）
  const withMargin = viewportWorldRect({ x: 0, y: 0, scale: 1 }, { width: 800, height: 600 }, 48)
  assert.equal(nodeIntersectsViewport({ x: -40, y: 300, width: 20, height: 20 }, withMargin), true, '视口外 margin 内不裁')
  assert.equal(nodeIntersectsViewport({ x: -100, y: 300, width: 20, height: 20 }, withMargin), false, 'margin 外才裁')
})

test('G2-⑤：空视口 / 极端 scale 不产生 NaN（fail-safe）', () => {
  const rect = viewportWorldRect({ x: 0, y: 0, scale: 0.1 }, { width: 0, height: 0 }, 48)
  for (const value of [rect.x, rect.y, rect.width, rect.height]) {
    assert.equal(Number.isFinite(value), true, '零尺寸视口仍要给出有限矩形')
  }
})
