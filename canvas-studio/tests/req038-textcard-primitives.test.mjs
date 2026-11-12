/**
 * REQ-038 批次 1 守卫：RQ-03 `textCard.color` + RQ-07 `textCard.plate` + RQ-05 `fx:'grayscale'`。
 *
 * 验收口径（需求正本 §3）：
 * - RQ-03：主文本色与 `accentColor` 分工；老 manifest（不写 color）逐像素不变 ⇒
 *   缺省值必须等于各变体旧硬编码色。
 * - RQ-07：`plate:'none'` 去掉 title 硬编码暗底；缺省 `'auto'` = 旧行为；
 *   非 title 变体写 plate 只 warning 不生效。
 * - RQ-05：`fx:'grayscale'` 走既有 `filter` 通路（与 blur/drop-shadow 同栈）；
 *   老枚举不受影响。
 * 逐像素断言只能在浏览器/取证台做（组件层是 React），这里守「契约有值 → 校验放行
 * → 缺省回退到旧硬编码色」这条链。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fxStyles } from '../lib/remotion/timing.js'
import { validateManifest, KNOWN_TRACK_KEYS } from '../lib/remotion/manifest.js'

function withTrack(track) {
  return {
    id: 'req038-b1-test',
    meta: { title: 'REQ-038 批1', width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#07070f', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 },
      track,
    ],
  }
}

const textCard = (extra = {}) => ({
  id: 'tc',
  type: 'textCard',
  variant: 'title',
  text: '标题',
  box: { x: 50, y: 50, w: 60, h: 20 },
  startFrame: 0,
  durationInFrames: 60,
  fadeFrames: 0,
  ...extra,
})

test('RQ-05：fxStyles("grayscale") 给出灰度 filter，走既有通路', () => {
  const style = fxStyles('grayscale')
  assert.equal(style.filter, 'grayscale(1)')
  // 与 blur 同栈：filter 通路已实证（web-renderer 4.0.535），不许另开 CSS 属性。
  assert.equal(typeof style.filter, 'string')
})

test('RQ-05：老 fx 缺省不受影响（零契约回归）', () => {
  assert.deepEqual(fxStyles(undefined), {})
  assert.equal(fxStyles('blur').filter, 'blur(3px)')
  assert.equal(fxStyles('metal').textFill, 'transparent')
  assert.equal(fxStyles('grayscale').textFill, undefined, '灰度不许顺手改文字填充')
})

test('RQ-05 ★校验：fx:"grayscale" 放行，未知 fx 仍拒收', () => {
  const ok = withTrack({ ...textCard(), fx: 'grayscale' })
  assert.deepEqual(validateManifest(ok).errors, [])
  const bad = validateManifest(withTrack({ ...textCard(), fx: 'sepia' })).errors
  assert.ok(bad.some((e) => e.includes('fx 非法')), '白名单不能被放宽成任意字符串')
})

test('RQ-03：validateManifest 放行 color，契约外告警不含 color/plate', () => {
  const m = validateManifest(withTrack(textCard({ color: '#6E6E86', plate: 'none' })))
  assert.deepEqual(m.errors, [])
  assert.ok(!m.warnings.some((w) => w.includes('"color"')), 'color 已登记 KNOWN_TRACK_KEYS')
  assert.ok(!m.warnings.some((w) => w.includes('"plate"')), 'plate 已登记 KNOWN_TRACK_KEYS')
})

test('RQ-03：KNOWN_TRACK_KEYS.textCard 同时登记 color 与 plate（P-02 漂移守卫口径）', () => {
  const keys = KNOWN_TRACK_KEYS.textCard
  assert.ok(keys.has('color'), 'color 必须登记 —— 实现真实读取')
  assert.ok(keys.has('plate'), 'plate 必须登记 —— 实现真实读取')
  assert.ok(keys.has('accentColor'), 'accentColor 必须保留（与 color 并存，分工不替换）')
})

test('RQ-03：color 非法值拒收（必须是字符串）', () => {
  const bad = validateManifest(withTrack(textCard({ color: 42 })))
  assert.ok(bad.errors.some((e) => e.includes('.color 必须是非空字符串')))
})

test('RQ-07：plate 白名单 auto/none，非法值拒收', () => {
  assert.deepEqual(validateManifest(withTrack(textCard({ plate: 'auto' }))).errors, [])
  const bad = validateManifest(withTrack(textCard({ plate: 'solid' })))
  assert.ok(bad.errors.some((e) => e.includes('plate 非法')), '白名单不能被放宽')
})

test('RQ-07：非 title 变体写 plate 只 warning 不生效', () => {
  const m = validateManifest(withTrack(textCard({ variant: 'subtitle', text: '字幕', plate: 'none' })))
  assert.deepEqual(m.errors, [])
  assert.ok(m.warnings.some((w) => w.includes('只在 variant:\'title\' 下生效')))
})

test('RQ-03/RQ-07：老 manifest（无 color / plate / 新 fx）校验行为不变', () => {
  const m = validateManifest(withTrack(textCard()))
  assert.deepEqual(m.errors, [])
  assert.ok(!m.warnings.some((w) => w.includes('color') || w.includes('plate')))
})
