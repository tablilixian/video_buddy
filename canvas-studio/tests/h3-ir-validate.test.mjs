/**
 * h3-ir-validate H3-Context-IR 格式校验器 契约测试。
 *
 * 硬闸门：tests/fixtures/official_ir.json 里 4 组官方 IR 输出必须 100% 通过
 * （对应 MiniMax-H3-Context-IR-Skill validate.py --self-test 的 4/4）。
 * 另附变异测试：结构性违规必须被拦下（ERROR），数值越界只允许 WARN。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateH3Ir } from '../lib/h3-ir-validate.js'

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

test('官方 4 组 IR 输出必须 100% 通过（validate.py --self-test 等价闸门）', () => {
  const results = OFFICIAL_IR.map((pair) => {
    const counts = materialCounts(pair)
    const report = validateH3Ir(pair.ir_output, {
      mode: pair.mode,
      duration: pair.duration,
      pictures: counts.image_url,
      videos: counts.video_url,
      audios: counts.audio_url,
    })
    return { id: pair.id, report }
  })
  for (const { id, report } of results) {
    assert.deepEqual(
      report.errors,
      [],
      `${id} 应无 ERROR，实际: ${report.errors.map((f) => `${f.rule} ${f.message}`).join('; ')}`,
    )
  }
  // 与 python 自检输出对齐：A2 恰好带 1 条 L3 情绪词 WARN，其余 0 warn
  const a2 = results.find((r) => r.id === 'A2-i2va-ramen-8s')
  assert.equal(a2.report.warnings.length, 1)
  assert.equal(a2.report.warnings[0].rule, 'L3')
  for (const { id, report } of results) {
    if (id !== 'A2-i2va-ramen-8s') assert.equal(report.warnings.length, 0, `${id} 不应有 WARN`)
  }
})

// ---------------- 变异测试：结构性违规必须 ERROR ----------------

const A1 = OFFICIAL_IR.find((p) => p.id === 'A1-t2va-space-10s')
const A3 = OFFICIAL_IR.find((p) => p.id === 'A3-ref2va-lamb-5s')

test('S6：markdown 围栏与非法首行必须 ERROR', () => {
  const fenced = '```\n' + A1.ir_output + '\n```'
  assert.equal(validateH3Ir(fenced, { mode: 'T2VA', duration: 10 }).ok, false)
  const prologue = '好的，这是您要的提示词：\n' + A1.ir_output
  const rep = validateH3Ir(prologue, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'S6'))
})

test('T1/T2/T3：时间戳规则（Shot 1 无时间戳、缺失、严格递增）', () => {
  // Shot 1 带时间戳 → T1
  const withTs1 = A1.ir_output.replace('[Shot 1]', '[Shot 1] At 00:00.000,')
  const r1 = validateH3Ir(withTs1, { mode: 'T2VA', duration: 10 })
  assert.equal(r1.ok, false)
  assert.ok(r1.errors.some((f) => f.rule === 'T1'))
  // 删除 Shot 2 的时间戳 → T2（取 A1 的第一个后续镜头）
  const noTs = A1.ir_output.replace(/At \d{2}:\d{2}\.\d{3},/, '')
  const r2 = validateH3Ir(noTs, { mode: 'T2VA', duration: 10 })
  assert.equal(r2.ok, false)
  assert.ok(r2.errors.some((f) => f.rule === 'T2' || f.rule === 'T6'))
})

test('T4：时间戳不小于目标时长必须 ERROR', () => {
  const rep = validateH3Ir(A1.ir_output, { mode: 'T2VA', duration: 3 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'T4'))
})

test('C1：表外运镜词必须 ERROR', () => {
  const bad = A1.ir_output.replace(/pushing in/i, 'dolly in')
  const rep = validateH3Ir(bad, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'C1' && f.message.includes('dolly')))
})

test('D5：<d> 标签不配对与缺语言标签必须 ERROR', () => {
  const unpaired = 'integrated_multimodal_description: [Shot 1] A man speaks, <d>[English] Hello. Then she replies, <d>[English] Hi.</d>\noverall_soundscape: Room tone.\nnon_diegetic_music: N/A'
  const rep = validateH3Ir(unpaired, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'D5' && f.message.includes('不配对')))
  const noLang = 'integrated_multimodal_description: [Shot 1] A man says <d>Hello.</d>\noverall_soundscape: Room tone.\nnon_diegetic_music: N/A'
  const rep2 = validateH3Ir(noLang, { mode: 'T2VA', duration: 10 })
  assert.equal(rep2.ok, false)
  assert.ok(rep2.errors.some((f) => f.rule === 'D5' && f.message.includes('[Language]')))
})

test('M1：三段式里出现 <Subject N> 必须 ERROR（模板混用）', () => {
  const mixed = A1.ir_output.replace('she', '<Subject 1> she')
  const rep = validateH3Ir(mixed, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'M1'))
})

test('K5：T2VA 不应带对齐行', () => {
  const withAlign = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n' + A1.ir_output
  const rep = validateH3Ir(withAlign, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'K5'))
})

test('K1：I2VA 对齐行句式逐字校验', () => {
  const A2 = OFFICIAL_IR.find((p) => p.id === 'A2-i2va-ramen-8s')
  const broken = A2.ir_output.replace(
    /^(For the target video[^\n]*)/m,
    'For the target video, at 0.00 seconds, <Picture 1> is referenced.',
  )
  const rep = validateH3Ir(broken, {
    mode: 'I2VA', duration: 8, pictures: materialCounts(A2).image_url,
  })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'K1/K2/K3'))
})

test('R16-R18：Ref2VA retention 档位与覆盖校验', () => {
  // 非法档位 → R17
  const badMarker = A3.ir_output.replace(/fully_preserved/, 'kept_intact')
  const counts = materialCounts(A3)
  const rep = validateH3Ir(badMarker, {
    mode: 'Ref2VA', duration: 5,
    videos: counts.video_url, audios: counts.audio_url,
  })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'R17' || f.rule === 'R18'))
  // 删掉 retention_analysis 整段内容 → R16 未覆盖
  const emptied = A3.ir_output.replace(
    /retention_analysis:\n[\s\S]*?\n\ndetailed_description/,
    'retention_analysis:\n(none)\n\ndetailed_description',
  )
  const rep2 = validateH3Ir(emptied, {
    mode: 'Ref2VA', duration: 5,
    videos: counts.video_url, audios: counts.audio_url,
  })
  assert.equal(rep2.ok, false)
  assert.ok(rep2.errors.some((f) => f.rule === 'R16' || f.rule === 'R19'))
})

test('S1/S2：段缺失与顺序错误必须 ERROR', () => {
  const noMusic = A1.ir_output.replace(/non_diegetic_music:[\s\S]*$/, '')
  const rep = validateH3Ir(noMusic, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'S1'))
})

test('L1/L2：句数词数越界只 WARN 不 FAIL', () => {
  const tiny = 'integrated_multimodal_description: [Shot 1] A cat sleeps.\noverall_soundscape: Quiet room tone.\nnon_diegetic_music: N/A'
  const rep = validateH3Ir(tiny, { mode: 'T2VA', duration: 10 })
  assert.equal(rep.ok, true)
  assert.ok(rep.warnings.some((f) => f.rule === 'L1'))
})

test('R7：素材标签编号不连续 / 超上限必须 ERROR', () => {
  const A2 = OFFICIAL_IR.find((p) => p.id === 'A2-i2va-ramen-8s')
  const badNum = A2.ir_output.replace('<Picture 1>', '<Picture 2>')
  const rep = validateH3Ir(badNum, {
    mode: 'I2VA', duration: 8, pictures: materialCounts(A2).image_url,
  })
  assert.equal(rep.ok, false)
  assert.ok(rep.errors.some((f) => f.rule === 'R7'))
})

test('未知 mode 抛错', () => {
  assert.throws(() => validateH3Ir('x', { mode: 'XXVA', duration: 5 }))
})
