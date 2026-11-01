/**
 * CV-392（REQ-036 R-2）：`image` 轨 `sourceRect` 精灵图子区域裁切契约单测。
 *
 * 覆盖两件事：
 *   1. `validateSpriteRect`（经 validateManifest）：四字段必填有限 / x·y ∈ 0–100 /
 *      w·h > 0 / x+w·y+h ≤ 100 越界硬失败；不写 = 整图，老 manifest 零新增报错。
 *   2. `spriteRegionStyle` 几何纯函数：cover / contain 的 scale 与居中负偏移的
 *      精确数值、区域偏移映射、退化兜底（natural=0 → 纯百分比拉伸填满）。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/sprite.js` 与 `lib/remotion/manifest.js`。
 * 定向跑：corepack yarn build && node --test tests/sprite-rect.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spriteRegionStyle, validateSpriteRect } from '../lib/remotion/sprite.js'
import { validateManifest } from '../lib/remotion/manifest.js'

function base(overrides = {}) {
  return {
    id: 'comp-sprite',
    meta: { title: '精灵图契约', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
    ],
    ...overrides,
  }
}

function image(overrides = {}) {
  return {
    id: 'img-1',
    type: 'image',
    src: '/canvas-studio/assets/p1/sheet.png',
    startFrame: 0,
    durationInFrames: 300,
    ...overrides,
  }
}

/* ------------------------- validateSpriteRect ------------------------- */

test('sourceRect：不写 = 整图，老 manifest 零新增报错', () => {
  const v = validateManifest(base({ tracks: [image()] }))
  assert.equal(v.ok, true, JSON.stringify(v.errors))
  assert.deepEqual(v.warnings, [], JSON.stringify(v.warnings))
})

test('sourceRect：合法形态放行（整数 / 浮点 / 贴满 100）', () => {
  for (const rect of [
    { x: 0, y: 0, w: 50, h: 50 },
    { x: 50, y: 50, w: 50, h: 50 },
    { x: 12.5, y: 25, w: 37.5, h: 75 },
    { x: 0, y: 0, w: 100, h: 100 },
  ]) {
    const v = validateManifest(base({ tracks: [image({ sourceRect: rect })] }))
    assert.equal(v.ok, true, `${JSON.stringify(rect)} → ${JSON.stringify(v.errors)}`)
  }
})

test('sourceRect：非对象 / 缺字段 / 非数值一律硬失败', () => {
  for (const rect of [null, '0,0,50,50', {}, { x: 0, y: 0, w: 50 }, { x: 0, y: 0, w: 50, h: Number.NaN }]) {
    const v = validateManifest(base({ tracks: [image({ sourceRect: rect })] }))
    assert.equal(v.ok, false, `应当拒收：${JSON.stringify(rect)}`)
    assert.ok(v.errors.some((e) => e.includes('.sourceRect')), JSON.stringify(v.errors))
  }
})

test('sourceRect：负值 / 超 100 / 零尺寸 / 越界（x+w > 100）硬失败', () => {
  for (const rect of [
    { x: -1, y: 0, w: 50, h: 50 },
    { x: 0, y: 101, w: 50, h: 50 },
    { x: 0, y: 0, w: 0, h: 50 },
    { x: 0, y: 0, w: 50, h: -3 },
    { x: 60, y: 0, w: 50, h: 50 },
    { x: 0, y: 60, w: 50, h: 50 },
  ]) {
    const v = validateManifest(base({ tracks: [image({ sourceRect: rect })] }))
    assert.equal(v.ok, false, `应当拒收：${JSON.stringify(rect)}`)
    assert.ok(v.errors.some((e) => e.includes('.sourceRect')), JSON.stringify(v.errors))
  }
})

test('sourceRect：浮点尾差容差（99.9+0.1 贴边放行，99.9+0.2 越界拒收）', () => {
  const ok = validateManifest(base({ tracks: [image({ sourceRect: { x: 50.1, y: 0, w: 49.9, h: 100 } })] }))
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
  const bad = validateManifest(base({ tracks: [image({ sourceRect: { x: 50.1, y: 0, w: 50.1, h: 100 } })] }))
  assert.equal(bad.ok, false)
})

test('validateSpriteRect：直连形态（错误信息带轨道定位前缀）', () => {
  const errors = []
  validateSpriteRect({ x: 90, y: 0, w: 20, h: 20 }, 'tracks[3]', errors)
  assert.ok(errors[0].includes('tracks[3].sourceRect'))
  assert.ok(errors[0].includes('越界'))
})

/* ------------------------- spriteRegionStyle ------------------------- */

test('几何：cover —— 区域宽主等比铺满，区域居中，整图按 scale 放大 + 负偏移', () => {
  // 自然 400×200，区域 = 左半 {0,0,50,100} → RW=200,RH=200；层 800×400
  // cover scale = max(800/200, 400/200) = 4；元素 = 1600×800；
  // 区域显示宽 = 200×4 = 800（铺满宽），显示高 = 200×4 = 800（超高 400 溢出裁掉）
  // left = (800 − 200×4)/2 − 0×400×4 = 0；top = (400 − 200×4)/2 − 0 = −200
  const s = spriteRegionStyle({ x: 0, y: 0, w: 50, h: 100 }, { w: 400, h: 200 }, { mode: 'cover', layerW: 800, layerH: 400 })
  assert.deepEqual(round(s), { left: 0, top: -200, width: 1600, height: 800 })
})

test('几何：cover —— 区域偏移映射（右半格 → 整图左移一个区域宽）', () => {
  // 区域 = 右半 {50,0,50,100}：区域源左缘在 x=200px，×4 = 800
  // left = (800 − 800)/2 − 200×4 = −800；top = −200
  const s = spriteRegionStyle({ x: 50, y: 0, w: 50, h: 100 }, { w: 400, h: 200 }, { mode: 'cover', layerW: 800, layerH: 400 })
  assert.deepEqual(round(s), { left: -800, top: -200, width: 1600, height: 800 })
})

test('几何：contain —— 取 min scale，完整可见居中留边', () => {
  // 自然 400×200，区域 {0,0,50,100} → RW=200,RH=200；层 800×400
  // contain scale = min(4, 2) = 2 → 元素 800×400；区域显示 400×400 居中
  // left = (800 − 400)/2 − 0 = 200；top = (400 − 400)/2 − 0 = 0
  const s = spriteRegionStyle({ x: 0, y: 0, w: 50, h: 100 }, { w: 400, h: 200 }, { mode: 'contain', layerW: 800, layerH: 400 })
  assert.deepEqual(round(s), { left: 200, top: 0, width: 800, height: 400 })
})

test('几何：退化兜底 —— natural=0（坏图）回纯百分比拉伸填满（不依赖自然尺寸）', () => {
  // 区域 {25,50,50,50}、层 800×400：width = 2×800 = 1600，left = −0.5×800 = −400
  const s = spriteRegionStyle({ x: 25, y: 50, w: 50, h: 50 }, { w: 0, h: 0 }, { mode: 'cover', layerW: 800, layerH: 400 })
  assert.deepEqual(round(s), { left: -400, top: -400, width: 1600, height: 800 })
})

test('几何：四象限精灵图 cover 到方形层 —— 右下格对角偏移', () => {
  // 自然 200×200，区域 = 右下格 {50,50,50,50} → RW=RH=100；层 400×400
  // cover scale = 4；元素 800×800；left = (400−400)/2 − 100×4 = −400；top 同
  const s = spriteRegionStyle({ x: 50, y: 50, w: 50, h: 50 }, { w: 200, h: 200 }, { mode: 'cover', layerW: 400, layerH: 400 })
  assert.deepEqual(round(s), { left: -400, top: -400, width: 800, height: 800 })
})

function round(s) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]))
}
