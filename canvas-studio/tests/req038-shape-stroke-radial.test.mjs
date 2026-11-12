/**
 * REQ-038 批次 2 守卫：RQ-04 `shape` radius/stroke/dash + RQ-06 `gradient` radial。
 *
 * 验收口径（需求正本 §3）：
 * - RQ-04：药丸底板 / 描边框 / 命中环可原生表达（不再依赖预生成 PNG）；
 *   老 manifest（不写新字段）逐像素不变 ⇒ 缺省必须走老 div 路径。
 * - RQ-06：径向光晕（`radial-gradient(60% 50% at 50% 52%, …)` 一类）可原生表达；
 *   radial 不能走 CSS（web-renderer 4.0.535 忽略，#16 实证）⇒ 必须走 SVG。
 * React 渲染层（SVG 串构造）在组件里，node 侧守契约 + 校验 + 缺省回退链。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateManifest, KNOWN_TRACK_KEYS } from '../lib/remotion/manifest.js'
import { colorWithAlphaZero } from '../lib/remotion/timing.js'

const here = dirname(fileURLToPath(import.meta.url))

function withTrack(track) {
  return {
    id: 'req038-b2-test',
    meta: { title: 'REQ-038 批2', width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#07070f', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 },
      track,
    ],
  }
}

const shape = (extra = {}) => ({
  id: 'sh',
  type: 'shape',
  shape: 'rect',
  color: '#98a3ff',
  box: { x: 50, y: 50, w: 30, h: 20 },
  startFrame: 0,
  durationInFrames: 60,
  ...extra,
})

test('RQ-04：KNOWN_TRACK_KEYS.shape 登记 radius/stroke/strokeWidthPx/dash（P-02 口径）', () => {
  const keys = KNOWN_TRACK_KEYS.shape
  for (const key of ['radius', 'stroke', 'strokeWidthPx', 'dash']) {
    assert.ok(keys.has(key), `${key} 必须登记 —— 实现真实读取`)
  }
})

test('RQ-06：KNOWN_TRACK_KEYS.shape 登记 gradientType/gradientCenter/gradientRadius/gradientTo', () => {
  const keys = KNOWN_TRACK_KEYS.shape
  for (const key of ['gradientType', 'gradientCenter', 'gradientRadius', 'gradientTo']) {
    assert.ok(keys.has(key), `${key} 必须登记 —— 实现真实读取`)
  }
})

test('RQ-04：rect + radius/stroke/dash 校验放行（药丸 / 描边框 / 命中环可表达）', () => {
  const pill = validateManifest(withTrack(shape({ radius: 26 })))
  assert.deepEqual(pill.errors, [])
  const frame = validateManifest(withTrack(shape({ radius: 12, stroke: '#98a3ff', strokeWidthPx: 2, color: 'transparent' })))
  assert.deepEqual(frame.errors, [])
  const ring = validateManifest(withTrack(shape({ shape: 'circle', color: 'transparent', stroke: '#98a3ff', strokeWidthPx: 2, dash: [10, 8] })))
  assert.deepEqual(ring.errors, [])
})

test('RQ-04：非法值拒收（radius 负数 / strokeWidthPx 越界 / dash 形状）', () => {
  const r = validateManifest(withTrack(shape({ radius: -4 })))
  assert.ok(r.errors.some((e) => e.includes('.radius 必须是 >= 0')))
  const w = validateManifest(withTrack(shape({ stroke: '#fff', strokeWidthPx: 0 })))
  assert.ok(w.errors.some((e) => e.includes('.strokeWidthPx 必须是 (0, 200]')))
  const d = validateManifest(withTrack(shape({ stroke: '#fff', dash: [10] })))
  assert.ok(d.errors.some((e) => e.includes('.dash 必须是 [dash, gap]')))
})

test('RQ-04：dash / strokeWidthPx 缺 stroke 只 warning 不阻断', () => {
  const m = validateManifest(withTrack(shape({ dash: [10, 8], strokeWidthPx: 4 })))
  assert.deepEqual(m.errors, [])
  assert.ok(m.warnings.some((w) => w.includes('dash 但没写 stroke')))
  assert.ok(m.warnings.some((w) => w.includes('strokeWidthPx 但没写 stroke')))
})

test('RQ-04：radius/stroke/dash 写在 gradient/line 上只 warning（冗余告知）', () => {
  const m = validateManifest(withTrack(shape({ shape: 'gradient', radius: 10, gradientType: 'radial' })))
  assert.deepEqual(m.errors, [])
  assert.ok(m.warnings.some((w) => w.includes("radius/stroke/dash 只在 shape:'rect'/'circle' 上生效")))
  // gradientType 在 gradient 轨上是合法生效的，不应有冗余警告 —— 反向验证：
  assert.ok(!m.warnings.some((w) => w.includes('gradientType/gradientCenter')))
  const line = validateManifest(withTrack(shape({ shape: 'line', radius: 10, gradientType: 'radial' })))
  assert.deepEqual(line.errors, [])
  assert.ok(line.warnings.some((w) => w.includes("radius/stroke/dash 只在 shape:'rect'/'circle' 上生效")))
  assert.ok(line.warnings.some((w) => w.includes('gradientType/gradientCenter/gradientRadius/gradientTo 只在 shape:\'gradient\' 上生效')))
})

test('RQ-06：gradient + radial 校验放行；非法 gradientType 拒收', () => {
  const ok = validateManifest(withTrack(shape({ shape: 'gradient', gradientType: 'radial', gradientCenter: { x: 50, y: 52 }, gradientRadius: { x: 60, y: 50 } })))
  assert.deepEqual(ok.errors, [])
  const bad = validateManifest(withTrack(shape({ shape: 'gradient', gradientType: 'conic' })))
  assert.ok(bad.errors.some((e) => e.includes('gradientType 非法')))
  const axis = validateManifest(withTrack(shape({ shape: 'gradient', gradientType: 'radial', gradientRadius: { x: 0 } })))
  assert.ok(axis.errors.some((e) => e.includes('gradientRadius.x 必须是 (0, 200]')))
})

test('RQ-06：老 gradient（无 gradientType）行为不变 —— 校验零告警', () => {
  const m = validateManifest(withTrack(shape({ shape: 'gradient' })))
  assert.deepEqual(m.errors, [])
  assert.ok(!m.warnings.some((w) => w.includes('gradientType')))
})

test('RQ-06：colorWithAlphaZero —— hex 同 RGB 全透明，非 hex 退 transparent', () => {
  assert.equal(colorWithAlphaZero('#3D3EFD'), 'rgba(61, 62, 253, 0)')
  assert.equal(colorWithAlphaZero('#fff'), 'rgba(255, 255, 255, 0)')
  assert.equal(colorWithAlphaZero('rgba(61,62,253,0.2)'), 'transparent')
})

test('批 2 ★渲染接线守卫：Shape.tsx 新路径真实消费新字段（缺省回退仍在）', () => {
  const src = readFileSync(join(here, '../src/remotion/components/Shape.tsx'), 'utf8')
  // 新字段必须被渲染层读取（否则「登记了但没实现」—— 漂移守卫查不出这类）。
  assert.ok(src.includes('track.radius'), 'radius 必须被 Shape.tsx 消费')
  assert.ok(src.includes('track.stroke'), 'stroke 必须被 Shape.tsx 消费')
  assert.ok(src.includes('strokeDasharray'), 'dash 必须落到 stroke-dasharray')
  assert.ok(src.includes('radialGradient'), 'radial 必须走 SVG radialGradient（CSS 被忽略）')
  assert.ok(src.includes('colorWithAlphaZero'), 'radial 边缘色缺省走同色全透明')
  // 老 div 路径必须保留（缺省回退 = 老 manifest 逐像素不变）。
  assert.ok(src.includes("borderRadius: '50%'"), '老 circle div 路径必须保留')
  assert.ok(src.includes('linear-gradient(135deg'), '老 gradient div 路径必须保留')
})
