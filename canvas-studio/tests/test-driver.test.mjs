/**
 * test-driver 回合空闲判据的边界单测（node:test 直连 lib 产物，mock timers 定格时间线）。
 *
 * 两条纪律：
 * - 正向（BUG-014 主诉）：回合在 deadline 前 1s 自然完成 → 不抛 CS-EFFECT-003、
 *   正常返回 —— deadline 让位空闲判定（grace 至多 2 次轮询凑满「连续 2 次空闲」）。
 * - 反向：回合到 deadline 仍在 running（grace 窗口也不结束）→ 仍抛 CS-EFFECT-003；
 *   从未见 running 且超过启动上限 → CS-EFFECT-002 —— 既有判定逐字节不变。
 *
 * 时间用 node:test 的 mock timers（Date + setTimeout 一起 mock）：tick(3000) 一次
 * = 推进 3s 且放行一次轮询睡眠，1s 精度内构造任意「回合完成时刻」，无需真等 50 分钟。
 * 所有分支都先「驱动到 settle」再断言 —— mock 掉 setTimeout 后若 promise 挂着不
 * settle，事件环会直接收场（ERR_TEST_FAILURE: Promise resolution is still pending）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createTestDriver, EFFECT_TEST_START_TIMEOUT_MS } from '../lib/test-driver.js'

const CASE_TIMEOUT = 50 * 60_000

/** 会话面 mock：summary 按当前（mocked）时刻从时间线函数现算。 */
function sessionsWith(timeline) {
  return {
    list: {
      getSnapshot: () => ({ byId: { s1: timeline(Date.now()) } }),
    },
  }
}

/**
 * 驱动 waitAgentTurn 到 settle：每 tick(3000) 放行一次轮询睡眠，setImmediate 让
 * 微任务（promise 续体）跑完再打下一 tick。
 */
async function driveUntilSettled(mock, state, maxTicks) {
  for (let i = 0; i < maxTicks && !state.settled; i += 1) {
    mock.timers.tick(3000)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('BUG-014 边界：回合在 deadline 前 1s 自然完成 → 不抛 CS-EFFECT-003，正常返回', async (t) => {
  const t0 = 1_700_000_000_000
  const completeAt = t0 + CASE_TIMEOUT - 1000 // deadline 前 1s 自然完成
  const timeline = (now) => ({ running: now < completeAt })
  const driver = createTestDriver(sessionsWith(timeline))
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: t0 })
  const state = { settled: false }
  const promise = driver.waitAgentTurn('s1', CASE_TIMEOUT)
  promise.then(() => { state.settled = true }, () => { state.settled = true })
  await driveUntilSettled(t.mock, state, 1010) // 回合内 ~1000 次轮询 + grace 2 次
  assert.equal(state.settled, true, 'deadline 前 1s 自然完成的回合必须在 grace 窗口内正常返回（R001 实证假超时）')
  await assert.doesNotReject(() => promise)
})

test('BUG-014 反向：回合到 deadline 仍在 running（grace 窗口内也不结束）→ 仍抛 CS-EFFECT-003', async (t) => {
  const t0 = 1_700_000_000_000
  const timeline = () => ({ running: true })
  const driver = createTestDriver(sessionsWith(timeline))
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: t0 })
  const state = { settled: false }
  const promise = driver.waitAgentTurn('s1', CASE_TIMEOUT)
  promise.then(() => { state.settled = true }, () => { state.settled = true })
  await driveUntilSettled(t.mock, state, 1010) // 回合内 ~1000 次轮询 + grace 2 次后判死
  await assert.rejects(
    () => promise,
    (err) => err.code === 'CS-EFFECT-003',
    '真未在预算内结束的回合必须照旧报超时',
  )
})

test('既有行为：从未见过 running 且超过启动上限 → CS-EFFECT-002（判据不变）', async (t) => {
  const t0 = 1_700_000_000_000
  const timeline = () => ({ running: false })
  const driver = createTestDriver(sessionsWith(timeline))
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: t0 })
  const state = { settled: false }
  const promise = driver.waitAgentTurn('s1', CASE_TIMEOUT)
  promise.then(() => { state.settled = true }, () => { state.settled = true })
  await driveUntilSettled(t.mock, state, Math.ceil(EFFECT_TEST_START_TIMEOUT_MS / 3000) + 5)
  await assert.rejects(
    () => promise,
    (err) => err.code === 'CS-EFFECT-002',
    '回合从未启动应报 CS-EFFECT-002（启动超时），不是 CS-EFFECT-003',
  )
})

test('既有行为：快速完成的回合（远早于 deadline）→ 连续 2 次空闲即返回', async (t) => {
  const t0 = 1_700_000_000_000
  const timeline = (now) => ({ running: now < t0 + 10_000 }) // 10s 后完成
  const driver = createTestDriver(sessionsWith(timeline))
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: t0 })
  const state = { settled: false }
  const promise = driver.waitAgentTurn('s1', CASE_TIMEOUT)
  promise.then(() => { state.settled = true }, () => { state.settled = true })
  await driveUntilSettled(t.mock, state, 20)
  assert.equal(state.settled, true, '正常完成路径（非 deadline 边缘）不得被 grace 逻辑改变')
  await assert.doesNotReject(() => promise)
})
