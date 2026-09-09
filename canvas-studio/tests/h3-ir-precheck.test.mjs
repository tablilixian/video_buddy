/**
 * CV-119：H3-Context-IR 工具层预检（assertH3IrPrompt / looksLikeH3Ir）契约测试。
 *
 * 闸门语义：
 *  1. 官方 4 组 IR（tests/fixtures/official_ir.json）经预检必须全部放行；
 *  2. 纯文本 prompt（含单标记误报场景）必须原样透传，绝不误拦；
 *  3. 半成品 IR（漏段 / 模板混用 / 模式用错）必须抛错且报错信息带规则名。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assertH3IrPrompt, looksLikeH3Ir } from '../lib/h3-ir-validate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OFFICIAL_IR = JSON.parse(readFileSync(join(HERE, 'fixtures', 'official_ir.json'), 'utf8'))

/** 与 validate.py --self-test 相同的素材计数方式。 */
function materialCounts(pair) {
  const counts = { image_url: 0, video_url: 0, audio_url: 0 }
  for (const c of pair.request.content) {
    if (c.type in counts) counts[c.type] += 1
  }
  return counts
}

/** 预检不抛 = 放行。 */
function assertPasses(text, opts) {
  assert.doesNotThrow(() => assertH3IrPrompt(text, opts))
}

/** 预检必须抛，且信息包含指定规则名。 */
function assertThrowsWith(text, opts, rule) {
  assert.throws(
    () => assertH3IrPrompt(text, opts),
    (err) => {
      assert.equal(typeof err.message, 'string')
      return err.message.includes(rule)
    },
    `预检应报出 ${rule}`,
  )
}

const A1 = OFFICIAL_IR.find((p) => p.id === 'A1-t2va-space-10s')
const A2 = OFFICIAL_IR.find((p) => p.id === 'A2-i2va-ramen-8s')
const A3 = OFFICIAL_IR.find((p) => p.id === 'A3-ref2va-lamb-5s')

// ---------------- 1. 官方 IR 全放行 ----------------

test('CV-119：官方 IR 经预检全部放行（与校验器闸门同源）', () => {
  for (const pair of OFFICIAL_IR) {
    const counts = materialCounts(pair)
    assertPasses(pair.ir_output, {
      mode: pair.mode,
      duration: pair.duration,
      pictures: counts.image_url,
      videos: counts.video_url,
      audios: counts.audio_url,
    })
  }
})

// ---------------- 2. 纯文本透传（防误伤） ----------------

test('纯文本 prompt 原样透传，不触发预检', () => {
  const plain = '一只橘猫在午后阳光下伸懒腰，镜头缓缓推近它的眼睛，温暖的钢琴配乐。'
  assert.equal(looksLikeH3Ir(plain), false)
  assertPasses(plain, { mode: 'T2VA', duration: 5 })
})

test('单个可疑标记不构成 IR（防误报）——一行 summary: 开头不算', () => {
  const borderline = 'a cinematic shot of the city at dusk\nsummary: golden hour, slow pan'
  assert.equal(looksLikeH3Ir(borderline), false)
  assertPasses(borderline, { mode: 'T2VA', duration: 5 })
})

// ---------------- 3. 半成品 IR 必须拦下 ----------------

test('漏段（删掉 non_diegetic_music）→ 抛错含 [S1]', () => {
  const lines = A1.ir_output.split('\n')
  const start = lines.findIndex((l) => l.startsWith('non_diegetic_music:'))
  assert.ok(start > 0, 'fixture 里应存在 non_diegetic_music 段')
  const ndEnd = lines.findIndex((l, i) => i > start && /^[a-z_]+:/.test(l))
  const cut = lines.filter((_, i) => i < start || (ndEnd >= 0 && i >= ndEnd)).join('\n')
  assert.notEqual(cut, A1.ir_output)
  assertThrowsWith(cut, { mode: 'T2VA', duration: 10 }, '[S1]')
})

test('三段式里混入 <Subject N> 标签 → 抛错含 [M1]', () => {
  const mixed = A1.ir_output.replace('[Shot 1]', '<Subject 1> [Shot 1]')
  assertThrowsWith(mixed, { mode: 'T2VA', duration: 10 }, '[M1]')
})

test('模式用错（I2VA 简报按 T2VA 预检）→ 抛错含 [K5]', () => {
  assertThrowsWith(A2.ir_output, { mode: 'T2VA', duration: 8, pictures: 1 }, '[K5]')
})

test('时间戳超出有效时长 → 抛错含 [T4]', () => {
  // A1 是 10s 简报（Shot 2 时间戳 4.5s）：把有效时长钳到 4s，T4 必触发
  assertThrowsWith(A1.ir_output, { mode: 'T2VA', duration: 4 }, '[T4]')
})

test('报错信息可指导修复（含规则名与修正指引）', () => {
  const mixed = A1.ir_output.replace('[Shot 1]', '<Subject 1> [Shot 1]')
  assert.throws(
    () => assertH3IrPrompt(mixed, { mode: 'T2VA', duration: 10 }),
    (err) => err.message.includes('h3-prompt-writing') && err.message.includes('ERROR'),
  )
})
