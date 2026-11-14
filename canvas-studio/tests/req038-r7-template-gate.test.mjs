/**
 * REQ-038 R7-B3（RQ-29 + D2）· **模板闸拆字段**单测。
 *
 * 三条纪律必须同时成立：
 * ① **屏级判定** —— `stageSeconds` 必判（屏级适用窗），45s 片 + ink-open(9s) 通过、
 *    three-cards（固有 18s 的整片叙事模板）仍拒；
 * ② **旧调用逐字不变** —— 只传 `durationSeconds` 的既有调用，判定与文案与拆分前一模一样；
 * ③ **totalSeconds 只提示** —— 估屏数进 `stageHint`，永不参与拒收；
 *    反向变异：STAGE_WINDOW_RATIO 若被改掉，本文件的窗值断言必红。
 *
 * 注意：任务原文写「three-cards(36s)」，真实 meta 固有 18s（durationInFrames 540 / fps 30）——
 * 按真实模板判，36s 记为笔误（§11.3）。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-template-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTemplateBundle } from '../lib/remotion/template-registry.js'
import {
  DURATION_WINDOW_RATIO,
  STAGE_WINDOW_RATIO,
  gateTemplate,
  stageWindowOf,
} from '../lib/remotion/template-gate.js'

const inkOpen = loadTemplateBundle('press/ink-open')
const threeCards = loadTemplateBundle('science/three-cards')
const featureWalk = loadTemplateBundle('product/feature-walkthrough')

// —— ① 屏级判定 ——

test('45s 片 + ink-open(9s 屏)：stageSeconds 判定通过，hint 报 ≈7 屏', () => {
  const gate = gateTemplate(inkOpen.bundle.meta, inkOpen.bundle.slots, { stageSeconds: 9, totalSeconds: 45, assetCount: 1 })
  assert.equal(gate.pass, true, `应通过，实际：${JSON.stringify(gate.failures)}`)
  assert.equal(gate.stageHint !== undefined, true)
  assert.match(gate.stageHint, /≈ 7 屏/)
  assert.match(gate.stageHint, /固有 9s/)
})

test('45s 片 + three-cards（18s 整片叙事模板）：屏级仍拒', () => {
  for (const stage of [6.5, 9]) {
    const gate = gateTemplate(threeCards.bundle.meta, threeCards.bundle.slots, { stageSeconds: stage, totalSeconds: 45 })
    assert.equal(gate.pass, false, `stageSeconds=${String(stage)} 应拒（18s 模板塞不进 6–9s 屏）`)
    assert.ok(gate.failures.some((failure) => failure.criterion === 'duration'), '必含 duration 判据')
    assert.match(gate.failures[0].message, /屏级适用区间/)
  }
})

test('屏级窗：显式 durationRange 优先；无 range 的按固有 ±40%', () => {
  assert.deepEqual(stageWindowOf(inkOpen.bundle.meta), [8, 10])
  // feature-walkthrough 固有 24s：24×0.6=14.4 / 24×1.4=33.6
  assert.deepEqual(stageWindowOf(featureWalk.bundle.meta), [14.4, 33.6])
})

test('反向变异：STAGE_WINDOW_RATIO 被改掉这里必红（D4 改值只改一处常量并回填标定表）', () => {
  assert.equal(STAGE_WINDOW_RATIO, 0.4, 'D4 标定初值 ±40%；复核条件见标定表 §11.6')
  assert.equal(DURATION_WINDOW_RATIO, 0.35, '旧整片路径的 ±35% 冻结不动（既有调用逐字不变）')
  assert.deepEqual(stageWindowOf(threeCards.bundle.meta), [10.8, 25.2], '18s × 0.6 / × 1.4；比率一改这条就红')
})

// —— ② 旧调用逐字不变 ——

test('只传 durationSeconds：判定与文案与拆分前逐字一致', () => {
  const gate = gateTemplate(inkOpen.bundle.meta, inkOpen.bundle.slots, { durationSeconds: 45, assetCount: 1 })
  assert.equal(gate.pass, false)
  assert.deepEqual(gate.failures.map((failure) => failure.criterion), ['duration'])
  assert.equal(
    gate.failures[0].message,
    '目标时长 45s 不在发布会 · 纸墨开场（press/ink-open）的适用区间 8–10s 内 —— 按 8–10s 出片，或走自由编排按你的时长生成',
  )
  const inside = gateTemplate(inkOpen.bundle.meta, inkOpen.bundle.slots, { durationSeconds: 9, assetCount: 1 })
  assert.equal(inside.pass, true)
  assert.equal(inside.stageHint, undefined, '没给 totalSeconds 就没有 hint（输出逐字段不增）')
})

test('stageSeconds 与 durationSeconds 同给：屏级优先（新口径赢，旧字段忽略）', () => {
  const gate = gateTemplate(inkOpen.bundle.meta, inkOpen.bundle.slots, { durationSeconds: 45, stageSeconds: 9, assetCount: 1 })
  assert.equal(gate.pass, true, 'stageSeconds 9 在窗内 ⇒ 过；durationSeconds 45 不再参与判定')
})

// —— ③ totalSeconds 只提示 ——

test('只传 totalSeconds：不拒收，只出估屏数提示', () => {
  const gate = gateTemplate(inkOpen.bundle.meta, inkOpen.bundle.slots, { totalSeconds: 45, assetCount: 1 })
  assert.equal(gate.pass, true, 'totalSeconds 永不拒收')
  assert.match(gate.stageHint, /≈ 7 屏/)
})

test('totalSeconds 超长：hint 封顶 40 屏但结论不变', () => {
  const gate = gateTemplate(threeCards.bundle.meta, threeCards.bundle.slots, { totalSeconds: 3600 })
  assert.match(gate.stageHint, /≈ 40 屏/)
  assert.equal(gate.failures.some((failure) => failure.criterion === 'duration'), false)
})

test('什么都不传：无 duration 判定、无 hint（输出逐字段不增）', () => {
  const gate = gateTemplate(inkOpen.bundle.meta, inkOpen.bundle.slots, { assetCount: 1 })
  assert.equal(gate.pass, true)
  assert.equal('stageHint' in gate, false)
})
