/**
 * REQ-038 R7-B1 · **屏数原语**（`planStages()` + spec 接入）单测。
 *
 * 四条纪律必须同时成立：
 * ① **节奏是算出来的** —— 45s → 7 屏、304s → 触 40 屏上限并标 clamped（验收口径）；
 * ② **旧路逐字段不变** —— 不带 autoStages 的 spec，planFromSpec 输出与旧行为
 *    逐字段相等（等权切分 + 无 stagePlan 字段），这是回归纪律；
 * ③ **吸附有边界** —— ±0.6s 内向 TTS 句起点靠，超出不迁就（宁可等分）；
 * ④ **反向变异必红** —— 节奏常数 6.5 若被改掉（如 20），本文件多条断言转红。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-stage-plan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_STAGES,
  MAX_STAGE_SEC,
  MIN_STAGE_SEC,
  MIN_STAGES,
  TARGET_STAGE_SEC,
  planStages,
} from '../lib/remotion/stage-plan.js'
import { planFromSpec, validateContentSpec } from '../lib/remotion/content-spec.js'
import { scaffoldFromSpec } from '../lib/host-tools-spec.js'

const FPS = 30

/** 通用不变量：Σ = 总帧、单调递增、首屏从 0 开始、每屏 ≥ 1 帧。 */
function assertSumInvariant(plan, totalSeconds, fps = FPS) {
  const totalFrames = Math.round(totalSeconds * fps)
  let cursor = 0
  for (const stage of plan.stages) {
    assert.equal(stage.startFrame, cursor, `屏 ${String(stage.index)} 的 startFrame 必须严丝合缝`)
    assert.ok(stage.durationInFrames >= 1, `屏 ${String(stage.index)} 不能是零宽`)
    cursor += stage.durationInFrames
  }
  assert.equal(cursor, totalFrames, 'Σ durationInFrames 必须 == 总帧（差一帧都会被打回）')
}

// —— A. planStages 纯函数 ——

test('45s → 7 屏，屏长全在 4–10s，离散 ≤1.6×，meta 干净', () => {
  const plan = planStages({ totalSeconds: 45, fps: FPS })
  assert.equal(plan.stages.length, 7)
  const lengths = plan.stages.map((stage) => stage.durationInFrames)
  for (const frames of lengths) {
    const seconds = frames / FPS
    assert.ok(seconds >= MIN_STAGE_SEC && seconds <= MAX_STAGE_SEC, `屏长 ${String(seconds)}s 必须在 4–10s`)
  }
  const dispersion = Math.max(...lengths) / Math.min(...lengths)
  assert.ok(dispersion <= 1.6, `离散 ${String(dispersion)}× 必须 ≤1.6×（真机 45s 是 3.7×，就是要修它）`)
  assert.equal(plan.meta.target, 7)
  assert.equal(plan.meta.clamped, false)
  assert.deepEqual(plan.meta.absorbedBy, {})
  assertSumInvariant(plan, 45)
})

test('304s → 触到 40 屏上限并标记 clamped', () => {
  const plan = planStages({ totalSeconds: 304, fps: FPS })
  assert.equal(plan.stages.length, MAX_STAGES)
  assert.equal(plan.meta.target, 47, 'round(304/6.5)=47，被夹到 40')
  assert.equal(plan.meta.clamped, true)
  for (const stage of plan.stages) {
    const seconds = stage.durationInFrames / FPS
    assert.ok(seconds >= MIN_STAGE_SEC && seconds <= MAX_STAGE_SEC, `屏长 ${String(seconds)}s 必须在 4–10s`)
  }
  assertSumInvariant(plan, 304)
})

test('边界吸附：±0.6s 内的 TTS 句起点把屏边界拉过去', () => {
  // 等分刀位 193/386/579/771/964/1157，全部给一个 ≤18 帧内的句起点
  const boundaries = [195, 400, 570, 775, 960, 1160]
  const plan = planStages({ totalSeconds: 45, fps: FPS, boundaries })
  assert.deepEqual(plan.stages.map((stage) => stage.startFrame), [0, 195, 400, 570, 775, 960, 1160])
  assertSumInvariant(plan, 45)
})

test('超出 ±0.6s 不迁就：3s 外的句起点拉不动屏边界', () => {
  const plan = planStages({ totalSeconds: 45, fps: FPS, boundaries: [215] })
  // 215 距等分刀位 193 有 22 帧 > 18 帧容差 → 不吸附，保持等分
  assert.equal(plan.stages[1].startFrame, 193)
})

test('目标屏长越出可行带：45s + targetStageSec 20 → 拆成 5 屏 × 9s', () => {
  const plan = planStages({ totalSeconds: 45, fps: FPS, targetStageSec: 20 })
  assert.equal(plan.stages.length, 5)
  assert.equal(plan.meta.target, 2, 'round(45/20)=2，但 2 屏装不下 45s（每屏 22.5s 超上限）')
  assert.equal(plan.meta.clamped, true)
  for (const stage of plan.stages) assert.equal(stage.durationInFrames, 270)
})

test('目标屏数越出可行带：20s + minStageSec 8 → 并成 2 屏 × 10s', () => {
  const plan = planStages({ totalSeconds: 20, fps: FPS, minStageSec: 8 })
  assert.equal(plan.stages.length, 2)
  assert.equal(plan.meta.target, 3, 'round(20/6.5)=3，但 3 屏每屏 6.67s 跌破 8s 下限')
  assert.equal(plan.meta.clamped, true)
  for (const stage of plan.stages) assert.equal(stage.durationInFrames, 300)
  assert.deepEqual(plan.meta.absorbedBy, {}, '拉回可行带是重算不是合并，不记 absorbedBy')
})

test('吸附造成短屏 → 合并掉并记 absorbedBy', () => {
  // 45s + targetStageSec 3 → 可行带拉到 11 屏（每屏 ~4.09s）；
  // 句起点 135/230 把前两刀吸到 135/230，第二屏只剩 95 帧（3.17s）→ 合并进左邻。
  const plan = planStages({ totalSeconds: 45, fps: FPS, targetStageSec: 3, boundaries: [135, 230] })
  assert.equal(plan.meta.target, 15)
  assert.equal(plan.meta.clamped, true)
  assert.equal(plan.stages.length, 10)
  assert.equal(plan.stages[0].durationInFrames, 230, '短屏并入左邻后首屏 230 帧')
  assert.deepEqual(plan.meta.absorbedBy, { 0: [1] })
  assertSumInvariant(plan, 45)
})

test('非法入参全部抛错，不静默降级', () => {
  assert.throws(() => planStages({ totalSeconds: 0, fps: FPS }), /totalSeconds/)
  assert.throws(() => planStages({ totalSeconds: 45, fps: 0 }), /fps/)
  assert.throws(() => planStages({ totalSeconds: 45, fps: FPS, boundaries: [200, 100] }), /严格升序/)
  assert.throws(() => planStages({ totalSeconds: 45, fps: FPS, boundaries: [100.5] }), /帧号/)
  assert.throws(() => planStages({ totalSeconds: 5, fps: FPS }), /装不下 2 屏/, '5s 装不下 2×4s')
  assert.throws(() => planStages({ totalSeconds: 600, fps: FPS }), /值域上限/, '600s 超 40 屏 × 10s')
  assert.throws(() => planStages({ totalSeconds: 45, fps: FPS, minStageSec: 12, maxStageSec: 10 }), /不能大于/)
})

test('Σ/单调不变量在多个时长上成立', () => {
  for (const seconds of [12, 45, 90, 304]) {
    const plan = planStages({ totalSeconds: seconds, fps: FPS })
    assertSumInvariant(plan, seconds)
    assert.ok(plan.stages.length >= MIN_STAGES && plan.stages.length <= MAX_STAGES)
  }
})

test('反向变异：节奏常数 6.5 若被改掉（如 20），这里必红', () => {
  assert.equal(TARGET_STAGE_SEC, 6.5, 'D4：改值只改一处常量，改完必须回填标定表')
  const plan = planStages({ totalSeconds: 45, fps: FPS })
  assert.equal(plan.meta.target, 7, '45/6.5=6.92 → 7；若常数被改成 20，这里会变成 2')
  assert.equal(plan.stages.length, 7)
  const long = planStages({ totalSeconds: 304, fps: FPS })
  assert.equal(long.meta.target, 47, '304/6.5=46.77 → 47；若常数被改成 20，这里会变成 15 且 clamped=false')
  assert.equal(long.meta.clamped, true)
})

// —— B. spec 接入（autoStages）——

function spec(sections, extraMeta = {}, extra = {}) {
  return { meta: { title: 'B1 屏数', durationSec: 45, fps: FPS, ...extraMeta }, sections, ...extra }
}

const sevenSections = [
  { id: 's1', copy: '标题', card: 'A2' },
  { id: 's2', copy: '第一组数据', card: 'A2' },
  { id: 's3', copy: '第二组数据', card: 'A2' },
  { id: 's4', copy: '第三组数据', card: 'A2' },
  { id: 's5', copy: '第四组数据', card: 'A2' },
  { id: 's6', copy: '第五组数据', card: 'A2' },
  { id: 's7', copy: '收尾', card: 'A2' },
]

test('autoStages：7 段 spec 的帧窗来自 planStages（不再来自权重）', () => {
  const body = spec(sevenSections, { autoStages: true })
  const check = validateContentSpec(body)
  assert.deepEqual(check.errors, [], `校验应通过，实际：${JSON.stringify(check.errors)}`)
  const result = planFromSpec(body, 1350)
  const expected = planStages({ totalSeconds: 45, fps: FPS })
  assert.deepEqual(
    result.timeline.map((slot) => ({ startFrame: slot.startFrame, durationInFrames: slot.durationInFrames })),
    expected.stages.map((stage) => ({ startFrame: stage.startFrame, durationInFrames: stage.durationInFrames })),
  )
  assert.ok(result.stagePlan !== undefined, 'autoStages 产物必须带 stagePlan（回执要原文带出节奏决定）')
  assert.equal(result.stagePlan.meta.target, 7)
})

test('autoStages：未注册卡的占位轨也按屏窗重排（不是等权节拍）', () => {
  const sections = sevenSections.map((section, index) => (
    index === 2 ? { ...section, card: 'Z9-未注册' } : section
  ))
  const body = spec(sections, { autoStages: true, stageBoundarySec: [6.5, 13.3, 19, 25.8, 32, 38.6] })
  const check = validateContentSpec(body)
  assert.deepEqual(check.errors, [])
  const result = planFromSpec(body, 1350)
  const placeholder = result.tracks.find((track) => track.id === 'seg-s3')
  assert.ok(placeholder !== undefined, '未注册卡走占位回落')
  // 等权节拍会把 s3 放在 386；屏窗吸附后 s3 从 399 起（13.3s×30）—— 占位轨必须跟屏窗
  assert.equal(placeholder.startFrame, 399)
})

test('autoStages：段数与算出的屏数不一致即拒收', () => {
  const check = validateContentSpec(spec(sevenSections.slice(0, 6), { autoStages: true }))
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => /算出 7 屏/.test(error)), `要报「算出 7 屏」，实际：${JSON.stringify(check.errors)}`)
})

test('autoStages：sections 带 durationSec/weight 即拒收（节奏归工具）', () => {
  const sections = [{ ...sevenSections[0], durationSec: 10 }, ...sevenSections.slice(1)]
  const check = validateContentSpec(spec(sections, { autoStages: true }))
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => /durationSec\/weight/.test(error)))
})

test('autoStages：缺 meta.durationSec 即拒收（屏数无解）', () => {
  const body = spec(sevenSections, { autoStages: true })
  delete body.meta.durationSec
  const check = validateContentSpec(body)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => /必须给 meta\.durationSec/.test(error)))
})

test('autoStages 非 boolean 即拒收', () => {
  const check = validateContentSpec(spec(sevenSections, { autoStages: 'yes' }))
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => /autoStages 必须是布尔值/.test(error)))
})

test('stageBoundarySec 没开 autoStages → 警告不生效，不静默', () => {
  const check = validateContentSpec(spec(sevenSections, { stageBoundarySec: [6.5, 12.9] }))
  assert.equal(check.ok, true, '只是警告，不阻断')
  assert.ok(check.warnings.some((warning) => /不生效/.test(warning)))
})

test('autoStages + stageBoundarySec：吸附进 planFromSpec 的屏窗', () => {
  const body = spec(sevenSections, { autoStages: true, stageBoundarySec: [6.5, 13.3, 19, 25.8, 32, 38.6] })
  const check = validateContentSpec(body)
  assert.deepEqual(check.errors, [])
  const result = planFromSpec(body, 1350)
  // 6.5s × 30 = 195 帧，距等分刀位 193 仅 2 帧 → 吸附
  assert.equal(result.timeline[1].startFrame, 195)
})

test('回归守卫：无 autoStages 的 spec 输出与旧公式逐字段相等（等权切分，无 stagePlan）', () => {
  const body = spec([
    { id: 's1', copy: '开场', card: 'A2' },
    { id: 's2', copy: '中段', card: 'A2' },
    { id: 's3', copy: '收尾', card: 'A2' },
  ], { durationSec: 30 })
  const check = validateContentSpec(body)
  assert.deepEqual(check.errors, [])
  const result = planFromSpec(body, 900)
  // 旧公式：等权切分（前 n-1 段 round(weight/totalWeight × total)，末段吃余数）
  assert.deepEqual(result.timeline.map((slot) => ({ id: slot.id, startFrame: slot.startFrame, durationInFrames: slot.durationInFrames })), [
    { id: 's1', startFrame: 0, durationInFrames: 300 },
    { id: 's2', startFrame: 300, durationInFrames: 300 },
    { id: 's3', startFrame: 600, durationInFrames: 300 },
  ])
  assert.equal('stagePlan' in result, false, '非 autoStages 不得带 stagePlan 字段（逐字段相等纪律）')
})

test('autoStages：非法 stageBoundarySec（乱序/越界）即拒收', () => {
  const unordered = validateContentSpec(spec(sevenSections, { autoStages: true, stageBoundarySec: [20, 10] }))
  assert.equal(unordered.ok, false)
  assert.ok(unordered.errors.some((error) => /严格升序/.test(error)))
  const outOfRange = validateContentSpec(spec(sevenSections, { autoStages: true, stageBoundarySec: [50] }))
  assert.equal(outOfRange.ok, false)
  assert.ok(outOfRange.errors.some((error) => /\[0, 45\]/.test(error)))
})

// —— C. 工具面回执 ——

test('scaffold_manifest：autoStages spec 的回执带节奏说明（工具替模型做的决定要看得见）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r7-stage-'))
  const file = join(dir, 'spec.json')
  writeFileSync(file, JSON.stringify(spec(sevenSections, { autoStages: true }), null, 2), 'utf8')
  const result = scaffoldFromSpec({ specPath: file })
  assert.match(result.text, /节奏：planStages 算出 7 屏/)
  assert.match(result.text, /目标 7/)
})
