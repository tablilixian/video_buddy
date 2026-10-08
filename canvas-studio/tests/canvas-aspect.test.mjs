/**
 * canvas-aspect 画布显示尺寸换算 契约测试（CV-068 → CV-284 自然像素）。
 *
 * 真实分辨率 → 画布框的唯一事实来源（generate / compose / 上传探测 /
 * 媒体加载校正统一复用）。CV-284 起规则是**自然像素**：100% 视图 1 CSS px =
 * 1 像素；仅保留 MIN_SHORT_SIDE=60 短边地板（等比放大不改比例）与非法输入
 * 回退 DEFAULT_MEDIA_BOX。旧「长边 480 / 1:1 用 420」规则已随本批退役。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewSizeOf, formatMediaDuration, MIN_SHORT_SIDE, DEFAULT_MEDIA_BOX } from '../lib/canvas-aspect.js'

test('previewSizeOf：16:9 横屏 → 自然像素（100% 视图 1:1）', () => {
  assert.deepEqual(previewSizeOf({ width: 1280, height: 720 }), { width: 1280, height: 720 })
})

test('previewSizeOf：9:16 竖屏 → 自然像素', () => {
  assert.deepEqual(previewSizeOf({ width: 720, height: 1280 }), { width: 720, height: 1280 })
})

test('previewSizeOf：1:1 正方形 → 自然像素（旧 420 紧凑框已退役）', () => {
  assert.deepEqual(previewSizeOf({ width: 1024, height: 1024 }), { width: 1024, height: 1024 })
})

test('previewSizeOf：成片竖屏 480×864 → 原样落框（CV-067 主场景：比例天然吻合）', () => {
  const size = previewSizeOf({ width: 480, height: 864 })
  assert.deepEqual(size, { width: 480, height: 864 })
  // 框比例 = 真实比例，cover 不再裁切
  assert.equal(size.width / size.height, 480 / 864)
})

test('previewSizeOf：1080p 产物按真实像素摆（1920×1080 就是 1920×1080）', () => {
  assert.deepEqual(previewSizeOf({ width: 1920, height: 1080 }), { width: 1920, height: 1080 })
})

test('previewSizeOf：短边 ≥ 60 的比例一律不动（32:9 超宽也原样）', () => {
  assert.deepEqual(previewSizeOf({ width: 3840, height: 1080 }), { width: 3840, height: 1080 })
})

test('previewSizeOf：短边 < 60 触发地板 —— **等比**放大到短边 = 60，比例不许变', () => {
  // 2000×50：短边 50 < 60 → ×1.2 → 2400×60（旧规则会把长边压到 480 还改比例）
  assert.deepEqual(previewSizeOf({ width: 2000, height: 50 }), { width: 2400, height: 60 })
  // 100×2000 的短边是 100 ≥ 60 ⇒ 不触发，原样
  assert.deepEqual(previewSizeOf({ width: 100, height: 2000 }), { width: 100, height: 2000 })
  // 50×2000 竖向地板：×1.2 → 60×2400
  assert.deepEqual(previewSizeOf({ width: 50, height: 2000 }), { width: 60, height: 2400 })
  const floored = previewSizeOf({ width: 3, height: 400 })
  assert.equal(Math.min(floored.width, floored.height), MIN_SHORT_SIDE, '地板值必须来自常量')
  assert.ok(Math.abs(floored.width / floored.height - 3 / 400) / (3 / 400) < 0.01, '地板放大不改比例')
})

test('CR-027：非正/非法分辨率回退占位媒体区（不产生 Infinity）', () => {
  assert.deepEqual(previewSizeOf({ width: 0, height: 0 }), { ...DEFAULT_MEDIA_BOX })
  assert.deepEqual(previewSizeOf({ width: 480, height: 0 }), { ...DEFAULT_MEDIA_BOX })
  assert.deepEqual(previewSizeOf({ width: 0, height: 480 }), { ...DEFAULT_MEDIA_BOX })
  assert.deepEqual(previewSizeOf({ width: Number.NaN, height: 480 }), { ...DEFAULT_MEDIA_BOX })
  assert.deepEqual(previewSizeOf({ width: -100, height: 480 }), { ...DEFAULT_MEDIA_BOX })
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
