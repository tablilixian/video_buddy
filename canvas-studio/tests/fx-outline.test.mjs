/**
 * CV-393（REQ-036 复刻复盘批）：`fx:'outline'` 镂空描边字契约单测。
 *
 * 覆盖：validateManifest 白名单（outline 放行 / 未知值拒收并点名）/ fxStyles 折算
 * （填充透明 + 奶油白粗描边 + 阴影；缺省空对象）。
 * 直连 Host tsc 编译产物。定向跑：corepack yarn build && node --test tests/fx-outline.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fxStyles } from '../lib/remotion/timing.js'
import { validateManifest } from '../lib/remotion/manifest.js'

function base(fx) {
  return {
    id: 'comp-outline',
    meta: { title: '镂空字', width: 1280, height: 720, fps: 30, durationInFrames: 90, lint: 'off' },
    tracks: [
      {
        id: 't-title', type: 'textCard', variant: 'title', text: 'NOIR SWIRL',
        startFrame: 0, durationInFrames: 90, fx,
      },
    ],
  }
}

test('outline：合法放行且零告警', () => {
  const v = validateManifest(base('outline'))
  assert.equal(v.ok, true, JSON.stringify(v.errors))
  assert.deepEqual(v.warnings, [], JSON.stringify(v.warnings))
})

test('fx 未知值拒收，白名单文案点名 outline', () => {
  const v = validateManifest(base('hollow'))
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('.fx 非法') && e.includes('outline')), JSON.stringify(v.errors))
})

test('fxStyles：outline = 透明填充 + 奶油白粗描边 + 阴影', () => {
  const s = fxStyles('outline')
  assert.equal(s.textFill, 'transparent')
  assert.match(s.textStroke, /^6px rgba\(240,243,247/)
  assert.ok(s.textShadow !== undefined)
  // 老枚举行为不回归
  const stroke = fxStyles('stroke')
  assert.match(stroke.textStroke, /^1\.5px/)
  assert.equal(stroke.textFill, undefined)
  assert.deepEqual(fxStyles(undefined), {})
})
