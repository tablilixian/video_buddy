/**
 * CV-467 左栏六态徽标守卫（project-status / project-sections 置顶口径）。
 *
 * 这些是**每次列表渲染都在跑**的派生逻辑，口径钉在纯函数上，不靠肉眼回归。
 * 每组用例对应一条真实会出错的边界：
 *
 * 1. **六态推导全表** —— waiting / running / failed / just-done / done / idle
 *    的触发条件与优先级（waiting 压过 running；running 只对 activity 命中的项目）。
 * 2. **瞬态回落边界** —— just-done → done 按 5 分钟窗口现推，不落盘；卡在边界上
 *    的差一毫秒都会让徽标抖成两态。
 * 3. **假 running 判旧** —— 进程被杀时 lastRun 停在 running，超窗必须退 idle。
 * 4. **脏值防御** —— 读路径不信任上游（normalizeLastRun 的口径在 Host 侧收口，
 *    这里锁「读侧再坏也不崩」的兜底）。
 * 5. **计时格式** —— 59s/60s、3599s/3600s 的进位边界；负差值钳 0。
 * 6. **置顶口径** —— project-sections 只把 waiting 提到桶顶，其余严格保序
 *    （updatedAt 倒序）， REQ-005 / CV-264③ 的已验收行为不许被徽标顺手改掉。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke（跑 lib/ 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  absoluteTimeOf,
  badgeTimeOf,
  countActiveStatuses,
  formatClock,
  isWaitingProject,
  JUST_DONE_WINDOW_MS,
  PROJECT_STATUS_ORDER,
  projectStatusOf,
  RUNNING_STALE_MS,
  statusDetailOf,
} from '../lib/project-status.js'
import { normalizeLastRun } from '../lib/contracts/project.js'
import { resolveVisibleSections } from '../lib/project-sections.js'

/** 固定的「现在」，所有断言都相对它 —— 绝不取 Date.now()（跨整点会让断言抖动）。 */
const NOW = new Date('2026-11-16T10:00:00')
const NOW_MS = NOW.getTime()

/** 最小可用项目记录（只填被测字段，其余走契约的必填项）。 */
function project(extra = {}) {
  return {
    id: 'p-1',
    name: '测试项目',
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    dir: '/tmp/p-1',
    ...extra,
  }
}

const status = (p, activity) => projectStatusOf(p, NOW, activity).state

/* ---------------- 六态推导 ---------------- */

test('waiting：pendingQuestion 在场且未回答即等待，判据唯一实现 isWaitingProject', () => {
  const p = project({ workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: '画幅选哪个？', options: ['16:9', '9:16'] } } })
  assert.equal(status(p), 'waiting')
  assert.equal(isWaitingProject(p), true)
  // 已回答（answer 在场，Host 工具还没轮询取走）：答案已在流向 agent → 不算等待。
  const answered = project({ workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: 'q', options: ['a', 'b'], answer: '16:9' } } })
  assert.equal(isWaitingProject(answered), false)
})

test('waiting 的 since ≈ updatedAt（问题落盘刷新 updatedAt，等待时长由此起算）', () => {
  const p = project({ updatedAt: '2026-11-16T09:30:00.000Z', workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: 'q', options: ['a', 'b'] } } })
  assert.equal(projectStatusOf(p, NOW).since, Date.parse('2026-11-16T09:30:00.000Z'))
})

test('waiting 压过 running 与 lastRun：等你决策是用户此刻唯一要响应的事实', () => {
  const p = project({
    workflow: { mode: 'auto', state: 'executing', pendingQuestion: { id: 'q1', question: 'q', options: ['a', 'b'] } },
    lastRun: { status: 'running', startedAt: NOW_MS - 60_000 },
  })
  assert.equal(status(p, { projectId: 'p-1', running: true, since: NOW_MS - 30_000 }), 'waiting')
})

test('running：只对 activity 命中的项目生效（用户拍板：running 只显示当前打开的项目）', () => {
  const p = project()
  assert.equal(status(p, { projectId: 'p-1', running: true, since: NOW_MS - 30_000 }), 'running')
  // 同一活动快照给别的项目 → 本项目推不出 running，退 idle。
  assert.equal(status(p, { projectId: 'p-2', running: true, since: NOW_MS - 30_000 }), 'idle')
  assert.equal(status(p, { projectId: 'p-1', running: false, since: NOW_MS - 30_000 }), 'idle')
})

test('running：lastRun.status=running 未超窗也判 running（另一实例 / 判旧兜底的桥）', () => {
  const p = project({ lastRun: { status: 'running', startedAt: NOW_MS - 10 * 60_000 } })
  assert.equal(status(p), 'running')
  const at = projectStatusOf(p, NOW)
  assert.equal(at.since, NOW_MS - 10 * 60_000)
})

test('假 running 判旧：超 RUNNING_STALE_MS 退 idle（进程被杀后徽标不得永远「执行中」）', () => {
  const p = project({ lastRun: { status: 'running', startedAt: NOW_MS - RUNNING_STALE_MS - 1 } })
  assert.equal(status(p), 'idle')
  // 边界内一毫秒都算 running。
  const fresh = project({ lastRun: { status: 'running', startedAt: NOW_MS - RUNNING_STALE_MS + 1 } })
  assert.equal(status(fresh), 'running')
})

test('failed：lastRun.status=failed → failed，since = endedAt', () => {
  const endedAt = NOW_MS - 30 * 60_000
  const p = project({ lastRun: { status: 'failed', startedAt: endedAt - 60_000, endedAt, reason: '网络超时' } })
  const at = projectStatusOf(p, NOW)
  assert.equal(at.state, 'failed')
  assert.equal(at.since, endedAt)
})

test('just-done：done 且 endedAt 在窗口内；差一毫秒跨窗口必须回落 done', () => {
  const inside = project({ lastRun: { status: 'done', startedAt: NOW_MS - JUST_DONE_WINDOW_MS - 60_000, endedAt: NOW_MS - JUST_DONE_WINDOW_MS + 1 } })
  assert.equal(status(inside), 'just-done')
  const outside = project({ lastRun: { status: 'done', startedAt: NOW_MS - JUST_DONE_WINDOW_MS - 60_000, endedAt: NOW_MS - JUST_DONE_WINDOW_MS } })
  assert.equal(status(outside), 'done')
})

test('stopped：被停止的回合落 idle，since 指向结束时刻（徽标相对时间由此而来）', () => {
  const endedAt = NOW_MS - 10 * 60_000
  const p = project({ lastRun: { status: 'stopped', startedAt: endedAt - 60_000, endedAt } })
  const at = projectStatusOf(p, NOW)
  assert.equal(at.state, 'idle')
  assert.equal(at.since, endedAt)
})

test('无 lastRun 的老记录退 idle，since 退 updatedAt（非法时间戳 → since=null 不渲染时间）', () => {
  const p = project({ updatedAt: '不是时间' })
  const at = projectStatusOf(p, NOW)
  assert.equal(at.state, 'idle')
  assert.equal(at.since, null)
})

/* ---------------- 徽标时间 ---------------- */

test('badgeTimeOf：running/waiting 出 mm:ss 计时，终态出相对时间', () => {
  const running = { state: 'running', since: NOW_MS - 65_000 }
  assert.equal(badgeTimeOf(running, NOW), '01:05')
  // 用本地日历构造 since（NOW 是无 Z 的本地时刻，直接 parse Z 串会撞时区差）。
  const done = { state: 'done', since: new Date(2026, 10, 16, 9, 0).getTime() }
  assert.equal(badgeTimeOf(done, NOW), '1 小时前')
})

test('formatClock：秒/分/时进位边界 + 负差值钳 0', () => {
  assert.equal(formatClock(59_000), '00:59')
  assert.equal(formatClock(60_000), '01:00')
  assert.equal(formatClock(3_599_000), '59:59')
  assert.equal(formatClock(3_600_000), '1:00:00')
  assert.equal(formatClock(-5_000), '00:00')
})

test('absoluteTimeOf：同年省年份，跨年补年份；非法时间戳 null', () => {
  // 用本地日历构造再转 ISO，断言按本地时区回读（跨时区稳定）。
  const withTz = absoluteTimeOf(new Date(2026, 10, 16, 9, 5).toISOString(), new Date(2026, 10, 16, 10, 0))
  assert.match(withTz, /^11\/16 09:05$/)
  const crossYear = absoluteTimeOf(new Date(2025, 11, 20, 8, 3).toISOString(), new Date(2026, 10, 16, 10, 0))
  assert.match(crossYear, /^2025\/12\/20 08:03$/)
  assert.equal(absoluteTimeOf('垃圾', NOW), null)
})

/* ---------------- 弹框状态专属块 ---------------- */

test('statusDetailOf：waiting 给问题原文，failed 给失败原因，done 给成片就绪行', () => {
  const waiting = project({ workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: '画幅选哪个？', options: ['16:9'] } } })
  assert.deepEqual(statusDetailOf(projectStatusOf(waiting, NOW), waiting, NOW), { kind: 'question', text: '画幅选哪个？' })
  const failed = project({ lastRun: { status: 'failed', endedAt: NOW_MS, reason: '网络超时' } })
  assert.deepEqual(statusDetailOf(projectStatusOf(failed, NOW), failed, NOW), { kind: 'reason', text: '网络超时' })
  const done = project({ lastRun: { status: 'done', endedAt: NOW_MS - 60_000 } })
  const doneDetail = statusDetailOf(projectStatusOf(done, NOW), done, NOW)
  assert.equal(doneDetail.kind, 'ready')
  assert.match(doneDetail.text, /^成片已就绪 · 1 分钟前$/)
  // running / idle 无专属块（running 的进度条由组件渲染）。
  assert.equal(statusDetailOf({ state: 'running', since: NOW_MS }, project(), NOW), null)
  assert.equal(statusDetailOf({ state: 'idle', since: null }, project(), NOW), null)
})

/* ---------------- 契约 normalizeLastRun ---------------- */

test('normalizeLastRun：合法值原样收口；status 非法整体丢弃；字段级非法只丢该字段', () => {
  assert.deepEqual(normalizeLastRun({ status: 'done', endedAt: 123, startedAt: 456 }), { status: 'done', startedAt: 456, endedAt: 123 })
  assert.equal(normalizeLastRun({ status: 'exploded' }), undefined)
  assert.equal(normalizeLastRun(null), undefined)
  assert.equal(normalizeLastRun('done'), undefined)
  assert.deepEqual(normalizeLastRun({ status: 'failed', endedAt: -1, reason: '  网络超时  ' }), { status: 'failed', reason: '网络超时' })
  // 超长 reason 截到 200（防错误日志整段灌进 registry）。
  const long = normalizeLastRun({ status: 'failed', reason: 'x'.repeat(500) })
  assert.equal(long.reason.length, 200)
})

/* ---------------- 排序口径 ---------------- */

test('PROJECT_STATUS_ORDER：waiting > running > failed > just-done > done > idle', () => {
  assert.equal(PROJECT_STATUS_ORDER.waiting, 0)
  assert.equal(PROJECT_STATUS_ORDER.idle, 5)
  const values = Object.values(PROJECT_STATUS_ORDER)
  assert.deepEqual([...values].sort((a, b) => a - b), values)
})

test('段头置顶口径：只把 waiting 提到桶顶，其余严格保持 updatedAt 倒序（REQ-005 不动）', () => {
  const waiting = project({ id: 'w', updatedAt: '2026-11-01T10:00:00.000Z', workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: 'q', options: ['a', 'b'] } } })
  const newest = project({ id: 'a', updatedAt: '2026-11-16T09:00:00.000Z' })
  const middle = project({ id: 'b', updatedAt: '2026-11-10T10:00:00.000Z' })
  const oldest = project({ id: 'c', updatedAt: '2026-11-05T10:00:00.000Z' })
  const { ungrouped } = resolveVisibleSections([oldest, waiting, newest, middle], [])
  // waiting 最旧也置顶；其余按 updatedAt 倒序原样。
  assert.deepEqual(ungrouped.map(entry => entry.id), ['w', 'a', 'b', 'c'])
})

test('多桶各自置顶：分组段与未分组桶互不干扰', () => {
  const waitingGrouped = project({ id: 'wg', groupId: 'g1', updatedAt: '2026-11-01T10:00:00.000Z', workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: 'q', options: ['a', 'b'] } } })
  const plainGrouped = project({ id: 'pg', groupId: 'g1', updatedAt: '2026-11-02T10:00:00.000Z' })
  const ungroupedWaiting = project({ id: 'uw', updatedAt: '2026-11-01T10:00:00.000Z', workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q2', question: 'q', options: ['a', 'b'] } } })
  const { ungrouped, sections } = resolveVisibleSections([plainGrouped, waitingGrouped, ungroupedWaiting], [{ id: 'g1', name: '分组一', order: 1 }])
  assert.deepEqual(ungrouped.map(entry => entry.id), ['uw'])
  assert.deepEqual(sections[0].items.map(entry => entry.id), ['wg', 'pg'])
})

/* ---------------- 段头计数 ---------------- */

test('countActiveStatuses：与徽标同一份入参口径（activity 同步生效）', () => {
  const waiting = project({ id: 'w', workflow: { mode: 'confirm', state: 'storyboarding', pendingQuestion: { id: 'q1', question: 'q', options: ['a', 'b'] } } })
  const running = project({ id: 'r', lastRun: { status: 'running', startedAt: NOW_MS - 60_000 } })
  const staleRunning = project({ id: 'r2', lastRun: { status: 'running', startedAt: NOW_MS - RUNNING_STALE_MS - 60_000 } })
  const failed = project({ id: 'f', lastRun: { status: 'failed', endedAt: NOW_MS - 60_000 } })
  const done = project({ id: 'd', lastRun: { status: 'done', endedAt: NOW_MS - 10 * 60_000 } })
  assert.deepEqual(countActiveStatuses([waiting, running, staleRunning, failed, done], NOW), { waiting: 1, running: 1, failed: 1 })
  // activity 命中的项目即使 lastRun 已判旧也点亮 running（徽标与计数同一口径）。
  assert.deepEqual(
    countActiveStatuses([running, staleRunning, failed, done], NOW, { projectId: 'r2', running: true, since: NOW_MS - 5_000 }),
    { waiting: 0, running: 2, failed: 1 },
  )
})
