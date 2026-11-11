/**
 * A4（2026-11-11）· 渲染**自检行**（`formatRenderVerdict`）。
 *
 * ## 为什么这一行要有单测
 *
 * 它不是「再打印一遍 report」，而是**替模型下结论**：判据全绿时明确说「不要逐张看图」。
 * 真机会话实测 4 次渲染 / 8 次 `read_image`，机器早有答案却没人读 —— 所以这里的
 * 断言守的是**语义档位**，不是措辞：
 *
 * - ✅ 只给机器真测过的项（`textFit` 有值 / 有声源 / 响度在区间）；
 * - ❌ 只有一种情况：文字溢出（唯一「必须返工」的判据）；
 * - ⚪ 是诚实出口（未实测 / 无声 / 响度越界），**不许**冒充 ✅，也**不许**升级成 ❌；
 * - 句子读起来必须能直接指导下一步（全绿 ⇒ 别翻图；有红 ⇒ 改完再渲）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRenderVerdict } from '../lib/render-report-text.js'

/** 一份完整但中性的 report（各用例只覆盖自己关心的字段）。 */
const BASE = {
  quality: 'standard',
  frames: 540,
  totalMs: 20000,
  prepareMs: 1000,
  renderMs: 19000,
  msPerFrame: 35.2,
  encodeDoneAtMs: 19500,
  bytes: 3_000_000,
  bitrateKbps: 1200,
  width: 1920,
  height: 1080,
  sampledFrames: 4,
}

const fit = (id, overflow) => ({
  id,
  variant: 'title',
  fontPx: 48,
  baseFontPx: 48,
  maxLines: 2,
  lines: ['示例'],
  overflow,
  atMinFont: false,
  maxWidthPx: 800,
})

const audible = (count, muted = 0) => ({ mutedVideoTracks: muted, audibleSources: count })

test('A4 ★全绿：结论必须是「只看第 1 张，不要逐张看图」', () => {
  const line = formatRenderVerdict({
    ...BASE,
    textFit: [fit('title', false), fit('subtitle', false)],
    audio: audible(4),
    loudnessLufs: -16.1,
  })
  assert.match(line, /✅ 规格 1920×1080/)
  assert.match(line, /✅ 文字 2 段无溢出/)
  assert.match(line, /✅ 音频 4 个出声源/)
  assert.match(line, /✅ 响度 -16\.1 LUFS/)
  assert.match(line, /判据全绿/)
  assert.match(line, /不要逐张 read_image/)
})

test('A4 ★文字溢出：红 + 点名轨 id，且不许出现「全绿」', () => {
  const line = formatRenderVerdict({
    ...BASE,
    textFit: [fit('title', false), fit('subtitle', true)],
    audio: audible(3),
    loudnessLufs: -16,
  })
  assert.match(line, /❌ 文字 1\/2 段溢出/)
  assert.match(line, /subtitle/)
  assert.ok(!line.includes('判据全绿'), '有红项还说全绿 = 撒谎')
  assert.match(line, /再渲一次/)
})

test('A4 ★溢出超过 4 条时折成「等」（不许把 64 条 id 全塞进一行）', () => {
  const many = Array.from({ length: 7 }, (_, index) => fit(`t${String(index)}`, true))
  const line = formatRenderVerdict({ ...BASE, textFit: many, audio: audible(1) })
  assert.match(line, /❌ 文字 7\/7 段溢出/)
  assert.match(line, /等/)
  assert.ok(!line.includes('t6'), '第 5 条起不该逐条点名')
})

test('A4 ★未实测：绝不冒充「查过且没问题」', () => {
  const line = formatRenderVerdict({ ...BASE, audio: audible(2) })
  assert.match(line, /⚪ 文字未实测/)
  assert.ok(!line.includes('无溢出'), '没测过不能说无溢出')
  assert.ok(!line.includes('判据全绿'))
  assert.match(line, /至少看 1 张抽帧/)
})

test('A4 ★无声是 ⚪ 不是 ❌（纯字幕片合法），但也不算全绿', () => {
  const line = formatRenderVerdict({
    ...BASE,
    textFit: [fit('a', false)],
    audio: audible(0, 2),
  })
  assert.match(line, /⚪ 无声/)
  assert.ok(!line.includes('❌'), '无声不是错误，不该逼人返工')
  assert.ok(!line.includes('判据全绿'), '还有 ⚪ 项就不能说全绿')
  assert.match(line, /没有红项/)
})

test('A4：响度越界只 ⚠️（观感对齐的参考，不是正确性）', () => {
  const line = formatRenderVerdict({
    ...BASE,
    textFit: [fit('a', false)],
    audio: audible(2),
    loudnessLufs: -8.4,
  })
  assert.match(line, /⚠️ 响度 -8\.4 LUFS/)
  assert.ok(!line.includes('❌'))
  assert.match(line, /没有红项/)
})

test('A4：客户端什么都没上报 ⇒ 空串（不产生「一堆 ⚪」的假结论）', () => {
  assert.equal(formatRenderVerdict({ ...BASE, width: 0, height: 0 }), '')
})
