/**
 * 真 3D（`rotateX / rotateY / z / perspective`）的契约守卫。
 *
 * 三条边界，每条都对应一次真实事故或实测结论：
 *  1. **不声明 3D ⇒ 串逐字节不变**。非 2D 矩阵会让 web-renderer 把整棵子树拽进
 *     WebGL 预合成（能力基准 #12：14ms/帧 → 77ms/帧）。所以「写了 perspective 但没写
 *     任何 3D 维度」也必须退回 2D 串，否则一个多余的镜头参数会把全片拖慢 5 倍。
 *  2. **透视必须写进元素自身的 transform 串**。#12 的 B/C 两格实证：父层 CSS
 *     `perspective` 属性被渲染器整个丢掉（卡片退化成纯水平压扁，`preserve-3d` 也救不回来），
 *     只有元素自己串里的 `perspective()` / `matrix3d()` 才真出透视。
 *  3. **透视距离不得过小**。60px 小卡配 `perspective(420px)` 时整块静默消失
 *     （预合成矩形算不出 ⇒ 该层被跳过，不报错不留痕）⇒ 校验设 200px 下限。
 *
 * 直连 Host tsc 编译产物 lib/**（纯函数，零 Remotion 依赖）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAnimatedStyle } from '../lib/remotion/animated-style.js'
import { animateStateAt, interpolateState } from '../lib/remotion/timing.js'
import { validateVisualStateFields } from '../lib/remotion/manifest-track-validate.js'
import { collectUnknownFieldWarnings } from '../lib/remotion/manifest.js'

const base = { id: 's', type: 'shape', shape: 'rect', color: '#fff', startFrame: 0, durationInFrames: 60 }

/** CV-334 时期的恒等串（冻结值）：任何改动都必须先红这一条。 */
const LEGACY_LAYER_IDENTITY = 'translate(0%, 0%) scale(1) rotate(0deg)'
const LEGACY_SHAPE_IDENTITY = 'scale(1) rotate(0deg)'

test('缺省：不声明 3D 时两条串与 CV-334 逐字节相同', () => {
  const anim = resolveAnimatedStyle({ ...base }, 0)
  assert.equal(anim.layerTransform, LEGACY_LAYER_IDENTITY)
  assert.equal(anim.shapeTransform, LEGACY_SHAPE_IDENTITY)
  assert.equal(anim.rotateX, 0)
  assert.equal(anim.rotateY, 0)
  assert.equal(anim.z, 0)
})

test('缺省：只用 2D 维度时串里不出现 perspective / translateZ（不进 WebGL 路径）', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { x: 30, y: 40, scale: 1.5, rotation: 12 } }, 0)
  assert.equal(anim.layerTransform, 'translate(-20%, -10%) scale(1.5) rotate(12deg)')
  assert.equal(anim.layerTransform.includes('perspective'), false)
  assert.equal(anim.shapeTransform.includes('perspective'), false)
})

test('只给了 perspective 但没有任何 3D 维度：串仍不变（多余的镜头参数不得拖慢渲染）', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { perspective: 800, x: 50 } }, 0)
  assert.equal(anim.layerTransform, LEGACY_LAYER_IDENTITY)
})

test('rotateY：perspective 在最左、rotateY 在最右', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { rotateY: -32 } }, 0)
  assert.equal(anim.rotateY, -32)
  assert.equal(
    anim.layerTransform,
    'perspective(1200px) translate(0%, 0%) scale(1) rotate(0deg) rotateY(-32deg)',
  )
  assert.equal(anim.shapeTransform, 'perspective(1200px) scale(1) rotate(0deg) rotateY(-32deg)')
})

test('rotateX + rotateY 同时在场：先 X 后 Y，顺序固定', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { rotateX: 28, rotateY: 15 } }, 0)
  assert.equal(
    anim.layerTransform,
    'perspective(1200px) translate(0%, 0%) scale(1) rotate(0deg) rotateX(28deg) rotateY(15deg)',
  )
})

test('z：translateZ 排在 perspective 之后、位移之前', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { z: 120 } }, 0)
  assert.equal(
    anim.layerTransform,
    'perspective(1200px) translateZ(120px) translate(0%, 0%) scale(1) rotate(0deg)',
  )
})

test('自定义 perspective 生效；只写 z 也吃自定义值', () => {
  const anim = resolveAnimatedStyle({ ...base, transform: { perspective: 2000, z: 60 } }, 0)
  assert.equal(anim.layerTransform.startsWith('perspective(2000px) translateZ(60px) '), true)
})

test('animate 插值：rotateY 从 0 到 90，中点 45', () => {
  // 显式 linear：缺省是 easeInOut，末帧不会落在 88.5 这个纯线性值上。
  const track = {
    ...base,
    durationInFrames: 60,
    animate: { from: { rotateY: 0 }, to: { rotateY: 90 }, easing: 'linear' },
  }
  assert.equal(animateStateAt(track, 0).rotateY, 0)
  assert.equal(animateStateAt(track, 30).rotateY, 45)
  assert.equal(animateStateAt(track, 59).rotateY, 88.5)
  const mid = resolveAnimatedStyle(track, 30)
  assert.equal(mid.rotateY, 45)
  assert.equal(mid.layerTransform.includes('rotateY(45deg)'), true)
})

test('z 也走插值：translateZ 跟着帧走', () => {
  const track = { ...base, durationInFrames: 40, animate: { from: { z: 0 }, to: { z: 200 } } }
  assert.equal(resolveAnimatedStyle(track, 20).layerTransform.includes('translateZ(100px)'), true)
})

test('单边声明：from 只有 rotateY 时另一端取中性值 0（不是 NaN）', () => {
  const state = interpolateState({ rotateY: 30 }, {}, 0.5)
  assert.equal(state.rotateY, 15)
})

test('exit.to 的 3D 维度同样生效（退场也能翻出去）', () => {
  const track = {
    ...base,
    exit: { to: { rotateY: 90 }, durationInFrames: 10 },
  }
  const anim = resolveAnimatedStyle(track, 55)
  assert.equal(anim.exiting, true)
  assert.equal(anim.layerTransform.includes('rotateY('), true)
})

test('校验：perspective 低于 200 报错（实测会让整块静默消失）', () => {
  const errors = []
  validateVisualStateFields({ perspective: 120 }, 'tracks[0].transform', errors, 'transform')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].includes('perspective'), true)

  const ok = []
  validateVisualStateFields({ perspective: 200 }, 'tracks[0].transform', ok, 'transform')
  assert.deepEqual(ok, [])
})

test('校验：perspective 只能写在 transform 上，写进 from/to 要报错', () => {
  const errors = []
  validateVisualStateFields({ perspective: 1200 }, 'tracks[0].animate.to', errors)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].includes('静态镜头参数'), true)
})

test('校验：rotateX / rotateY / z 必须是有限数', () => {
  const errors = []
  validateVisualStateFields({ rotateX: Number.NaN, rotateY: Infinity, z: 'x' }, 'tracks[0].transform', errors)
  assert.equal(errors.length, 3)
})

test('契约：transform 的四个新字段不再是「契约外字段」', () => {
  const warnings = collectUnknownFieldWarnings({
    id: 'm', meta: { width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
    tracks: [{
      ...base,
      transform: { rotateX: 10, rotateY: 20, z: 30, perspective: 1200 },
      animate: { from: { rotateY: 0 }, to: { rotateY: 45 } },
    }],
  })
  const hits = warnings.filter((w) => /rotateX|rotateY|perspective|契约外字段 "z"/.test(w))
  assert.deepEqual(hits, [])
})
