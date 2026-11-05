/**
 * 里程碑时钟单测（骨架优先出片 · P1-1）。
 *
 * 为什么必须测：这行字是**验收时的唯一仪表**。它算错不会报错，只会让我们在
 * 「还剩 6 分钟」和「已超 12 分钟」之间看错状态 —— 而正确性完全依赖几个时间戳
 * 的减法与钳位，是纯函数最该被钉住的地方。
 *
 * 纪律：全部用**固定 now**，不调用 `Date.now()`。真实时间参与的断言会在慢机上
 * 偶发红，那种红没有信息量。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatClock, milestoneState, M0_SKELETON_MS, M1_DEADLINE_MS } from '../lib/milestone-clock.js'
import { M1_DEADLINE_MINUTES } from '../lib/render-anchor.js'

const T0 = 1_760_000_000_000
const MIN = 60_000

test('没有 landedAt：不渲染，也不造红字', () => {
  const state = milestoneState({ now: T0 + 99 * MIN })
  assert.equal(state.visible, false)
  assert.equal(state.phase, 'pending')
  assert.equal(state.headline, '')
})

test('非法时间戳一律当「没有」：0 / 负数 / NaN / Infinity', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const state = milestoneState({ now: T0 + MIN, landedAt: bad })
    assert.equal(state.visible, false, `landedAt=${String(bad)} 必须按未落地处理`)
    assert.equal(state.phase, 'pending')
  }
})

test('T+0：富余档，剩满 20 分钟', () => {
  const state = milestoneState({ now: T0, landedAt: T0 })
  assert.equal(state.phase, 'running')
  assert.equal(state.remainingMs, M1_DEADLINE_MS)
  assert.equal(state.overdueMs, 0)
  assert.equal(state.headline, 'M1 剩 20:00')
  assert.equal(state.detail, 'T+0:00')
})

test('M0 线（8min）只切档位，不判失败', () => {
  const before = milestoneState({ now: T0 + 8 * MIN - 1, landedAt: T0 })
  const at = milestoneState({ now: T0 + 8 * MIN, landedAt: T0 })
  assert.equal(M0_SKELETON_MS, 8 * MIN)
  assert.equal(before.phase, 'running')
  assert.equal(at.phase, 'tight')
  assert.equal(at.overdueMs, 0)
})

test('硬线前一秒仍是紧档，剩 0:01', () => {
  const state = milestoneState({ now: T0 + 20 * MIN - 1000, landedAt: T0 })
  assert.equal(state.phase, 'tight')
  assert.equal(state.remainingMs, 1000)
  assert.equal(state.headline, 'M1 剩 0:01')
})

test('正好踩线：判超线，但不说「已超 0:00」', () => {
  const state = milestoneState({ now: T0 + 20 * MIN, landedAt: T0 })
  assert.equal(state.phase, 'overdue')
  assert.equal(state.overdueMs, 0)
  assert.equal(state.headline, '已超 M1 硬线')
})

test('超线 12:06：headline 给超线时长，detail 给总时长', () => {
  const state = milestoneState({ now: T0 + 32 * MIN + 6000, landedAt: T0 })
  assert.equal(state.phase, 'overdue')
  assert.equal(state.overdueMs, 12 * MIN + 6000)
  assert.equal(state.headline, '已超 M1 硬线 12:06')
  assert.equal(state.detail, 'T+32:06')
})

test('已出片：停在 done，用时按首片时刻算', () => {
  const state = milestoneState({ now: T0 + 48 * MIN + 10_000, landedAt: T0, firstDraftAt: T0 + 14 * MIN + 2000 })
  assert.equal(state.phase, 'done')
  assert.equal(state.hasDraft, true)
  assert.equal(state.firstDraftMs, 14 * MIN + 2000)
  assert.equal(state.headline, 'M1 已达成 · 用时 14:02')
  assert.equal(state.detail, 'T+48:10')
})

test('首片晚于硬线也判 done：出片优先于超线（否则红了永远红，颜色失去意义）', () => {
  const state = milestoneState({ now: T0 + 90 * MIN, landedAt: T0, firstDraftAt: T0 + 26 * MIN })
  assert.equal(state.phase, 'done')
  assert.equal(state.headline, 'M1 已达成 · 用时 26:00')
  assert.equal(state.overdueMs, 90 * MIN - 20 * MIN)
})

test('firstDraftAt 非法值不算出片', () => {
  for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const state = milestoneState({ now: T0 + 25 * MIN, landedAt: T0, firstDraftAt: bad })
    assert.equal(state.phase, 'overdue', `firstDraftAt=${String(bad)} 不能当作出片`)
    assert.equal(state.hasDraft, false)
  }
})

test('时钟回拨（now < landedAt）钳到 T+0，不出现负时长', () => {
  const state = milestoneState({ now: T0 - 5 * MIN, landedAt: T0 })
  assert.equal(state.elapsedMs, 0)
  assert.equal(state.phase, 'running')
  assert.equal(state.detail, 'T+0:00')
})

test('now 非法时退回 landedAt（宁可显示 T+0 也不要 NaN）', () => {
  const state = milestoneState({ now: Number.NaN, landedAt: T0 })
  assert.equal(state.elapsedMs, 0)
  assert.equal(state.detail, 'T+0:00')
})

test('formatClock：分:秒，跨一小时才升位，非法输入钳 0', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(999), '0:00')
  assert.equal(formatClock(1000), '0:01')
  assert.equal(formatClock(59_999), '0:59')
  assert.equal(formatClock(60_000), '1:00')
  assert.equal(formatClock(726_000), '12:06')
  assert.equal(formatClock(20 * MIN), '20:00')
  assert.equal(formatClock(3_660_000), '1:01:00')
  assert.equal(formatClock(-5), '0:00')
  assert.equal(formatClock(Number.NaN), '0:00')
})

test('数值唯一源：工具返回的分钟口径与客户端毫秒口径同源', () => {
  assert.equal(M1_DEADLINE_MS, 1_200_000)
  assert.equal(M1_DEADLINE_MINUTES, 20)
  assert.equal(M1_DEADLINE_MINUTES * 60_000, M1_DEADLINE_MS)
})
