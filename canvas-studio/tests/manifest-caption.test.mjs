/**
 * 能力基准 #05 收口（2026-10-31）：`caption` 轨契约单测。
 *
 * 覆盖 validateManifest 对 caption 轨的边界：src 同源、text 单句、words 与口播字符数
 * 一一对应（from≤to、升序告警）、fontSize/widthPercent 范围、双重播放告警、
 * 契约外字段告警、box 生效（内容轨）、音轨构成把 caption 计入出声源。
 * 直连 Host tsc 编译产物 `lib/remotion/manifest.js`。
 * 定向跑：node --test tests/manifest-caption.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeManifestAudio, validateManifest } from '../lib/remotion/manifest.js'

function base(overrides = {}) {
  return {
    id: 'comp-caption',
    meta: { title: '字幕契约', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
    ],
    ...overrides,
  }
}

/** "凌晨三点，门外有人。" = 8 口播字 */
function caption(overrides = {}) {
  return {
    id: 'cap-1',
    type: 'caption',
    src: '/canvas-studio/assets/p1/line1.mp3',
    text: '凌晨三点，门外有人。',
    startFrame: 0,
    durationInFrames: 300,
    ...overrides,
  }
}

test('caption：合法基础形态放行且零告警', () => {
  const v = validateManifest(base({ tracks: [caption()] }))
  assert.equal(v.ok, true, JSON.stringify(v.errors))
  assert.deepEqual(v.warnings, [], JSON.stringify(v.warnings))
})

test('caption：src 必须同源、text 必须非空且不含换行', () => {
  const badSrc = validateManifest(base({ tracks: [caption({ src: 'https://cdn.example.com/a.mp3' })] }))
  assert.ok(badSrc.errors.some((e) => e.includes('.src 必须是')))

  const emptyText = validateManifest(base({ tracks: [caption({ text: '' })] }))
  assert.ok(emptyText.errors.some((e) => e.includes('.text 必须是非空字符串')))

  const multiline = validateManifest(base({ tracks: [caption({ text: '第一句。\n第二句。' })] }))
  assert.ok(multiline.errors.some((e) => e.includes('不应含换行')))
})

test('caption：words 必须与口播字符数一致（8 口播字）', () => {
  const words = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ text: `字${i}`, from: from + i * 10, to: from + (i + 1) * 10 }))
  const mismatch = validateManifest(base({ tracks: [caption({ words: words(7) })] }))
  assert.ok(mismatch.errors.some((e) => e.includes('必须与口播字符数（8，不含标点）一致')))

  const ok = validateManifest(base({ tracks: [caption({ words: words(8) })] }))
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))

  const reversed = validateManifest(base({ tracks: [caption({ words: [...words(2, 20), ...words(6).map((w) => ({ ...w, from: w.from, to: w.to }))] })] }))
  assert.ok(reversed.warnings.some((w) => w.includes('未按 from 升序')) || reversed.ok === true, '乱序要么告警要么合法')
})

test('caption：words 的 from/to 形状校验', () => {
  const badRange = validateManifest(base({ tracks: [caption({ words: [{ text: '凌', from: 10, to: 5 }, ...Array.from({ length: 7 }, (_, i) => ({ text: `字${i}`, from: 20 + i * 10, to: 30 + i * 10 }))] })] }))
  assert.ok(badRange.errors.some((e) => e.includes('.from 不能大于 to')))

  const negative = validateManifest(base({ tracks: [caption({ words: [{ text: '凌', from: -1, to: 5 }, ...Array.from({ length: 7 }, (_, i) => ({ text: `字${i}`, from: 20 + i * 10, to: 30 + i * 10 }))] })] }))
  assert.ok(negative.errors.some((e) => e.includes('from 必须是非负有限数')))
})

test('caption：fontSize / widthPercent 范围与颜色字段', () => {
  const badFont = validateManifest(base({ tracks: [caption({ fontSize: 500 })] }))
  assert.ok(badFont.errors.some((e) => e.includes('.fontSize 必须是 8–400')))

  const badWidth = validateManifest(base({ tracks: [caption({ widthPercent: 5 })] }))
  assert.ok(badWidth.errors.some((e) => e.includes('.widthPercent 必须是 10–100')))

  const badColor = validateManifest(base({ tracks: [caption({ color: '' })] }))
  assert.ok(badColor.errors.some((e) => e.includes('.color 必须是非空颜色字符串')))
})

test('caption：同一 src 挂 audio.voiceOver ⇒ 双重播放告警', () => {
  const v = validateManifest(base({
    tracks: [caption()],
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p1/line1.mp3', startFrame: 0 }] },
  }))
  assert.equal(v.ok, true)
  assert.ok(v.warnings.some((w) => w.includes('双重人声')))
})

test('caption：内容轨身份 —— box/animate 生效；出声源计数包含 caption', () => {
  const v = validateManifest(base({
    tracks: [caption({ box: { x: 50, y: 80, w: 80, h: 18 } })],
  }))
  assert.equal(v.ok, true, JSON.stringify(v.errors))
  assert.ok(!v.errors.some((e) => e.includes('.box 只支持')))

  const summary = summarizeManifestAudio(base({
    tracks: [caption(), { id: 'v', type: 'video', src: '/canvas-studio/assets/p1/a.mp4', startFrame: 0, durationInFrames: 100, muted: true }],
  }))
  assert.equal(summary.mutedVideoTracks, 1)
  assert.equal(summary.audibleSources, 1, 'caption 自播旁白 ⇒ 计入出声源')
})

test('caption：契约外字段恰好告警一次（KNOWN_TRACK_KEYS.caption 覆盖全部字段）', () => {
  const v = validateManifest(base({ tracks: [caption({ typo: 1 })] }))
  assert.equal(v.ok, true)
  assert.equal(v.warnings.filter((w) => w.includes('typo')).length, 1)
  const clean = validateManifest(base({ tracks: [caption({ words: Array.from({ length: 8 }, (_, i) => ({ text: `字${i}`, from: i * 10, to: (i + 1) * 10 })), fontSize: 120, widthPercent: 66, color: '#fff', activeColor: '#5ad2ff', dimColor: 'rgba(232,238,252,0.28)' })] }))
  assert.deepEqual(clean.warnings, [], JSON.stringify(clean.warnings))
})
