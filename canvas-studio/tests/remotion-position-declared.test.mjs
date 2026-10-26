/**
 * 2026-10-26 布局压测实证修复：`resolveAnimatedStyle` 的逐轴位置声明标志。
 * 旧的单标志位 `positionDeclared` 把「animate 只声明 y」当成双轴都声明，
 * `Shape.tsx` 据此丢弃 `box.x` → 多柱图表全叠画布中心。守卫：删任一断言轴即红。
 * 直连 Host tsc 编译产物 lib/remotion/animated-style.js（纯函数，零 Remotion 依赖）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAnimatedStyle } from '../lib/remotion/animated-style.js'

const base = { id: 's', type: 'shape', shape: 'rect', color: '#fff', startFrame: 0, durationInFrames: 60 }

test('box + animate 只声明 y：x 轴未声明（box.x 保留），y 轴已声明', () => {
  const anim = resolveAnimatedStyle({
    ...base,
    box: { x: 78, y: 74.5, w: 8, h: 23 },
    animate: { from: { y: 86 }, to: { y: 74.5 } },
  }, 30)
  assert.equal(anim.xDeclared, false, 'animate 无 x ⇒ x 轴未声明')
  assert.equal(anim.yDeclared, true, 'animate 有 y ⇒ y 轴已声明')
  assert.equal(anim.positionDeclared, true, '整体仍算已声明（兼容旧消费方）')
})

test('只有 box：双轴都未声明', () => {
  const anim = resolveAnimatedStyle({ ...base, box: { x: 20, y: 30, w: 10, h: 10 } }, 10)
  assert.equal(anim.xDeclared, false)
  assert.equal(anim.yDeclared, false)
  assert.equal(anim.positionDeclared, false)
})

test('transform 只给 x：x 已声明、y 未声明', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { x: 30 } }, 10)
  assert.equal(anim.xDeclared, true)
  assert.equal(anim.yDeclared, false)
})

test('orbit 视为双轴都声明；exit 单轴按字段算', () => {
  const orbit = resolveAnimatedStyle({ ...base, orbit: { center: { x: 50, y: 50 }, radius: 10 } }, 15)
  assert.equal(orbit.xDeclared, true)
  assert.equal(orbit.yDeclared, true)

  const exit = resolveAnimatedStyle({ ...base, exit: { to: { x: 10 } } }, 55)
  assert.equal(exit.xDeclared, true)
  assert.equal(exit.yDeclared, false)
})
