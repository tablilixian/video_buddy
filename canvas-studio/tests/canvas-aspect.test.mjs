/**
 * canvas-aspect 画布显示尺寸换算 契约测试（CV-068）。
 *
 * 真实分辨率 → 画布框的唯一事实来源（generate / compose / 上传探测 /
 * 媒体加载校正统一复用）。直接断言三态规则：横屏长边 480、竖屏长边 480、
 * 1:1 用 420 紧凑框；极端宽/窄比例夹取 60 短边地板。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewSizeOf, formatMediaDuration } from '../lib/canvas-aspect.js'

test('previewSizeOf：16:9 横屏 → 长边 480、短边等比 270', () => {
  assert.deepEqual(previewSizeOf({ width: 1280, height: 720 }), { width: 480, height: 270 })
})

test('previewSizeOf：9:16 竖屏 → 短边等比、长边 480', () => {
  assert.deepEqual(previewSizeOf({ width: 720, height: 1280 }), { width: 270, height: 480 })
})

test('previewSizeOf：1:1 正方形 → 420×420 紧凑框', () => {
  assert.deepEqual(previewSizeOf({ width: 1024, height: 1024 }), { width: 420, height: 420 })
})

test('previewSizeOf：成片竖屏 480×864 → 267×480（CV-067 主场景：不再 260×180 横屏占位）', () => {
  const size = previewSizeOf({ width: 480, height: 864 })
  assert.deepEqual(size, { width: 267, height: 480 })
  // 框比例 ≈ 真实比例，cover 不再裁切
  assert.ok(Math.abs(size.width / size.height - 480 / 864) < 0.02)
})

test('previewSizeOf：极端宽 32:9 → 短边仍 ≥ 60 地板', () => {
  assert.deepEqual(previewSizeOf({ width: 3840, height: 1080 }), { width: 480, height: 135 })
})

test('previewSizeOf：超窄竖屏 → 短边被夹到 60 地板', () => {
  assert.deepEqual(previewSizeOf({ width: 100, height: 2000 }), { width: 60, height: 480 })
})

test('previewSizeOf：超宽横屏 → 短边被夹到 60 地板', () => {
  assert.deepEqual(previewSizeOf({ width: 2000, height: 100 }), { width: 480, height: 60 })
})

test('CR-027：非正/非法分辨率回退正方形占位（不产生 Infinity）', () => {
  assert.deepEqual(previewSizeOf({ width: 0, height: 0 }), { width: 420, height: 420 })
  assert.deepEqual(previewSizeOf({ width: 480, height: 0 }), { width: 420, height: 420 })
  assert.deepEqual(previewSizeOf({ width: 0, height: 480 }), { width: 420, height: 420 })
  assert.deepEqual(previewSizeOf({ width: Number.NaN, height: 480 }), { width: 420, height: 420 })
  assert.deepEqual(previewSizeOf({ width: -100, height: 480 }), { width: 420, height: 420 })
})

test('formatMediaDuration：m:ss 角标格式（CV-083），非法值返回 null', () => {
  assert.equal(formatMediaDuration(16), '0:16')
  assert.equal(formatMediaDuration(56.4), '0:56')
  assert.equal(formatMediaDuration(75), '1:15')
  assert.equal(formatMediaDuration(605), '10:05')
  assert.equal(formatMediaDuration(0), '0:00')
  assert.equal(formatMediaDuration(undefined), null)
  assert.equal(formatMediaDuration(Number.NaN), null)
  assert.equal(formatMediaDuration(-3), null)
})
