/**
 * 能力基准 #05 收口（2026-10-31）：词级时间戳推导纯函数单测。
 *
 * 合成包络直接构造（不需要真 mp3）：语音块 + 字间谷 + 逗号长停顿，
 * 校验切分边界、兜底路径（谷不够/谷太多/全静音）与确定性。
 * 直连 Host tsc 编译产物 `lib/remotion/word-timing.js`。
 * 定向跑：node --test tests/word-timing.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countSpokenChars, wordTimingFromEnvelope } from '../lib/remotion/word-timing.js'

const FPS = 30

/** 合成一句包络：lead 静音 + n 个字块（energy，len 桶）+ 字间谷（gap 桶，valleyEnergy）+ tail 静音。 */
function phraseEnvelope({ chars, energy = 0.8, len = 30, gap = 6, valleyEnergy = 0.05, lead = 10, tail = 10 }) {
  const env = Array.from({ length: lead }, () => 0.01)
  for (let i = 0; i < chars; i += 1) {
    for (let k = 0; k < len; k += 1) env.push(energy)
    if (i < chars - 1) for (let k = 0; k < gap; k += 1) env.push(valleyEnergy)
  }
  for (let k = 0; k < tail; k += 1) env.push(0.01)
  return env
}

test('countSpokenChars：标点与空格不计（bench #05 的台词 = 14 口播字）', () => {
  assert.equal(countSpokenChars('凌晨三点，门外的脚步声忽然停了。'), 14)
  assert.equal(countSpokenChars('hello world!'), 10, '空格与标点都不算口播字符')
})

test('谷值清晰：切分边界落在字间谷上，窗口单调覆盖语音区', () => {
  const env = phraseEnvelope({ chars: 4, len: 30, gap: 6 })
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 4 })
  assert.equal(w.length, 4)
  for (let i = 1; i < 4; i += 1) {
    assert.ok(w[i].start >= w[i - 1].end - 0.01, `窗口 ${i} 起点不回退`)
  }
  // 起点应落在 lead 静音之后（语音区门槛 12%）
  assert.ok(w[0].start >= 8 * 0.3 - 0.01, '起点在语音区内（lead=10 桶）')
  // 每个字窗宽 ≈ 30+6=36 桶 = 1.2s = 36 帧（均匀字块下谷在中点）
  assert.ok(Math.abs(w[1].start - w[0].end) < 0.02, '相邻窗口无缝衔接')
  assert.ok(w[3].end > w[3].start, '末窗非空')
})

test('逗号长停顿：切分边界落在停顿区尾部（下一字起音点，等深取后）', () => {
  // 4 字短语 + 20 桶停顿 + 4 字短语（bench "凌晨三点，门外…" 的形态）
  const pauseLead = 4 * 30 + 3 * 6 + 10 // 第一短语末桶之后的停顿起点（桶序）
  const env = [...phraseEnvelope({ chars: 4, tail: 0 }), ...Array.from({ length: 20 }, () => 0.02), ...phraseEnvelope({ chars: 4, lead: 0 })]
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 8 })
  assert.equal(w.length, 8)
  // 边界应落在停顿区（±2 桶容差）—— 而不是停顿开头（否则下一字会在静音期提前高亮）
  const boundaryFrame = w[3].end
  const pauseStartFrame = pauseLead * 0.01 * FPS
  const pauseEndFrame = (pauseLead + 20) * 0.01 * FPS
  assert.ok(
    boundaryFrame >= pauseStartFrame - 0.6 && boundaryFrame <= pauseEndFrame + 0.6,
    `边界 ${boundaryFrame} 应落在停顿区 [${pauseStartFrame}, ${pauseEndFrame}] 内`,
  )
  assert.ok(Math.abs(w[4].start - boundaryFrame) < 0.01, '窗口连续（end == 下一字 start）')
})

test('谷不够（连续朗读无谷）⇒ 均匀内插兜底，窗口数仍精确', () => {
  const env = [0.01, ...Array.from({ length: 120 }, () => 0.8), 0.01]
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 6 })
  assert.equal(w.length, 6)
  const span = w[5].end - w[0].start
  const widths = w.map((x) => x.end - x.start)
  for (const width of widths) {
    assert.ok(Math.abs(width - span / 6) < 1.5, `均匀兜底下各窗宽接近 span/6（${width} vs ${span / 6}）`)
  }
})

test('谷多余 ⇒ 按谷深贪心挑，切点数精确 = 口播数 − 1', () => {
  // 每字块中间再挖一个浅谷（深度 0.3 < 0.35 阈值 ⇒ 是候选），字间深谷 0.05
  const env = [0.01]
  for (let i = 0; i < 4; i += 1) {
    for (let k = 0; k < 15; k += 1) env.push(0.8)
    for (let k = 0; k < 6; k += 1) env.push(0.3) // 字内浅谷
    for (let k = 0; k < 15; k += 1) env.push(0.8)
    if (i < 3) for (let k = 0; k < 6; k += 1) env.push(0.05) // 字间深谷
  }
  env.push(0.01)
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 4 })
  assert.equal(w.length, 4)
  // 深谷（字间）应优先于浅谷（字内）：第 1/2 字边界应在第一个深谷附近（≈ 桶 36 → 10.8 帧）
  const firstDeep = 36 * 0.01 * FPS
  assert.ok(Math.abs(w[0].end - firstDeep) < 2.5, `边界咬住深谷（${w[0].end} vs ${firstDeep}）`)
})

test('全静音包络 ⇒ 全程均匀兜底；口播数 0 ⇒ 空数组', () => {
  const zero = wordTimingFromEnvelope({ envelope: Array.from({ length: 90 }, () => 0), fps: FPS, spokenChars: 5 })
  assert.equal(zero.length, 5)
  assert.equal(wordTimingFromEnvelope({ envelope: [0.5, 0.4], fps: FPS, spokenChars: 0 }).length, 0)
})

test('确定性：同输入两次调用逐帧全等', () => {
  const env = phraseEnvelope({ chars: 5 })
  const a = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 5 })
  const b = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 5 })
  assert.deepEqual(a, b)
})
