/**
 * CV-449（P0-C）：渲染总超时到期时的**判活**（纯函数）。
 *
 * 事故（2026-11-06 真机）：45s 片 draft 预算 = `1350×240×0.7+60s = 287s`；内容加了
 * 32 条 exit + 12 条 reveal 后实测 ≈215ms/帧、需要 ≈378s ⇒ **连续 6 次渲到 76–85%
 * 被准点砍掉**。而进度一直在涨 —— 它没卡死，只是比静态单价贵。
 *
 * 本文件锁四件事：
 *  1. 进度在推进 ⇒ 续期（按剩余工作比例，不是原样续）；
 *  2. 进度停住 / 一帧没出 ⇒ **不续期**（那是卡死，交给停滞判据，口径不重复）；
 *  3. 已渲完 / 超过绝对上限 ⇒ 不续期（防无限续期）；
 *  4. 续期量随进度单调递减（越接近完成，续得越少）。
 *
 * 定向跑：node --test tests/render-timeout-extend.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RENDER_TIMEOUT_EXTEND_HEADROOM,
  RENDER_TIMEOUT_EXTEND_MIN_MS,
  timeoutExtensionMs,
} from '../lib/remotion/render-budget.js'
import { CLIENT_PROGRESS_STALL_MS } from '../lib/remotion/render-job.js'

const STALL = CLIENT_PROGRESS_STALL_MS // 90s

/** 造一个「预算刚到期、进度仍在推进」的输入。 */
function atDeadline(over = {}) {
  const now = 1_000_000
  return {
    maxProgress: 0.79,
    dispatchedAt: now - 287_000,
    lastProgressAt: now - 2_000, // 2 秒前还在推进
    progressStallMs: STALL,
    now,
    ...over,
  }
}

test('进度仍在推进 ⇒ 续期，且按剩余工作比例给（≈ elapsed×(1-p)/p×1.4）', () => {
  const input = atDeadline()
  const extend = timeoutExtensionMs(input)
  assert.notEqual(extend, null, '79% 且刚推进过，必须续期')
  const elapsed = input.now - input.dispatchedAt
  const expected = Math.round((elapsed * ((1 - 0.79) / 0.79)) * RENDER_TIMEOUT_EXTEND_HEADROOM)
  assert.equal(extend, expected)
  // 真机这一单：287s ×(0.21/0.79)×1.4 ≈ 107s ⇒ 够跑到 378s，不再 79% 被砍
  assert.ok(extend >= 90_000 && extend <= 140_000, `续期应在 90–140s，实得 ${extend}`)
})

test('一帧都没出（maxProgress=0）⇒ 不续期（那不是「在渲只是慢」）', () => {
  assert.equal(timeoutExtensionMs(atDeadline({ maxProgress: 0 })), null)
})

test('进度停更超过 progressStallMs ⇒ 不续期（真卡死交给停滞判据）', () => {
  const now = 1_000_000
  assert.equal(
    timeoutExtensionMs(atDeadline({ now, lastProgressAt: now - STALL, progressStallMs: STALL })),
    null,
    '停更恰好等于阈值即判死',
  )
  assert.equal(
    timeoutExtensionMs(atDeadline({ now, lastProgressAt: now - STALL - 1, progressStallMs: STALL })),
    null,
  )
  // 差 1ms 到阈值仍算活
  assert.notEqual(
    timeoutExtensionMs(atDeadline({ now, lastProgressAt: now - STALL + 1, progressStallMs: STALL })),
    null,
  )
})

test('已渲完（maxProgress>=1）⇒ 不续期（该走 commit，不是续命）', () => {
  assert.equal(timeoutExtensionMs(atDeadline({ maxProgress: 1 })), null)
  assert.equal(timeoutExtensionMs(atDeadline({ maxProgress: 1.2 })), null)
})

test('接近绝对上限（20min）⇒ 不再兜底续期，病态不让它无限跑', () => {
  const now = 1_000_000
  // 已跑 19min，剩 60s 到硬上限 ⇒ 最多续到硬上限，且不小于下限就不返回
  const nearly = timeoutExtensionMs(atDeadline({
    now,
    dispatchedAt: now - 19 * 60_000,
    maxProgress: 0.5,
    lastProgressAt: now - 1000,
  }))
  assert.notEqual(nearly, null)
  assert.ok(nearly <= 60_000, `续期不能超过剩余硬上限 60s，实得 ${nearly}`)
  // 已跑 19min55s：剩余 5s < 下限 ⇒ 直接不续（继续也只是浪费 5s）
  assert.equal(timeoutExtensionMs(atDeadline({
    now,
    dispatchedAt: now - (19 * 60_000 + 55_000),
    maxProgress: 0.5,
    lastProgressAt: now - 1000,
  })), null)
})

test('续期量随进度单调递减（越接近完成续得越少）', () => {
  const now = 1_000_000
  // 上界取 0.9：0.95 时理论续期已低于下限（15s），走 null 分支，另有专测覆盖。
  const progresses = [0.2, 0.4, 0.6, 0.8, 0.9]
  const extend = progresses.map((p) => timeoutExtensionMs({
    maxProgress: p,
    dispatchedAt: now - 200_000,
    lastProgressAt: now - 1000,
    progressStallMs: STALL,
    now,
  }))
  for (let i = 1; i < extend.length; i += 1) {
    assert.notEqual(extend[i], null)
    assert.ok(extend[i] < extend[i - 1], `进度 ${progresses[i]} 的续期必须小于 ${progresses[i - 1]}`)
  }
})

test('续期量不低于下限（避免「刚续期就到期」空转）', () => {
  const now = 1_000_000
  // 进度 0.99、只跑了 10s ⇒ 理论续期极小 ⇒ 返回 null 而不是给个几百毫秒
  const tiny = timeoutExtensionMs({
    maxProgress: 0.99,
    dispatchedAt: now - 10_000,
    lastProgressAt: now - 100,
    progressStallMs: STALL,
    now,
  })
  assert.equal(tiny, null)
  // 只要给了非 null，就必须 ≥ 下限
  const normal = timeoutExtensionMs(atDeadline())
  assert.ok(normal !== null && normal >= RENDER_TIMEOUT_EXTEND_MIN_MS)
})

test('非法输入一律 null（不产生 NaN 死循环）', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
    assert.equal(timeoutExtensionMs(atDeadline({ maxProgress: bad })), null, `maxProgress=${bad}`)
  }
  assert.equal(timeoutExtensionMs(atDeadline({ now: Number.NaN })), null)
  assert.equal(timeoutExtensionMs(atDeadline({ dispatchedAt: Number.NaN })), null)
  assert.equal(timeoutExtensionMs(atDeadline({ lastProgressAt: Number.NaN })), null)
  // now 早于 dispatchedAt（时钟回拨）⇒ 不续期，而不是给负值
  assert.equal(timeoutExtensionMs(atDeadline({ now: 1_000, dispatchedAt: 2_000 })), null)
})
