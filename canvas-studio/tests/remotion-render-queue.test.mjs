/**
 * REQ-034 · 二期 1b：渲染工单**队列**单测（D-04：并发 1 / 上限 4 / 严格 FIFO）。
 *
 * 守三件事：
 *   1. 并发 1 —— 第二单必须排队，不能同时"派发"两单；
 *   2. 上限 4 —— 第 5 张等待单立刻拒收（`CS-USER-ERR`），不排到超时；
 *   3. 严格 FIFO + 结算让位 —— 前一单结算后，队首那单才拿到槽位。
 *
 * 进度上报（1b 的进度通道）也在这里守：只有 `rendering` 态才可写、写入前 clamp。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/render-queue.js`。
 * 定向跑：node --test tests/remotion-render-queue.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activeRenderCount,
  RENDER_CONCURRENCY,
  RENDER_QUEUE_LIMIT,
  listRenderJobs,
  releaseRenderSlot,
  renderQueueDepth,
  reportRenderProgress,
  reserveRenderSlot,
  resetRenderQueueForTests,
} from '../lib/remotion/render-queue.js'
import '../lib/errors/catalog.js'

function slot(jobId, extra = {}) {
  return { jobId, projectId: 'p1', durationInFrames: 300, fps: 30, ...extra }
}

/** 每个用例跑在干净队列上（模块级单例，必须手清）。 */
function withFreshQueue(run) {
  resetRenderQueueForTests()
  try {
    run()
  } finally {
    resetRenderQueueForTests()
  }
}

test('并发 = 1：第一单当拍派发，第二单进等待队列', () => {
  withFreshQueue(() => {
    assert.equal(RENDER_CONCURRENCY, 1, '并发常量变了就必须同步改这条断言')
    const first = reserveRenderSlot(slot('j1'))
    assert.equal(first.dispatched, true, '首单当拍拿到槽位')
    assert.equal(activeRenderCount(), 1)

    const second = reserveRenderSlot(slot('j2'))
    assert.equal(second.dispatched, false, '并发已满 ⇒ 只能排队')
    assert.equal(renderQueueDepth(), 1, '等待队列深度 1')
    assert.equal(activeRenderCount(), 1, '不得同时渲染两单')

    const states = listRenderJobs('p1').map((entry) => `${entry.jobId}:${entry.state}`)
    assert.deepEqual(states, ['j1:rendering', 'j2:queued'], `实际 ${states.join(',')}`)

    releaseRenderSlot('j1', 'succeeded')
    releaseRenderSlot('j2', 'cancelled')
  })
})

test('严格 FIFO：前一单结算后按入队顺序派发', async () => {
  resetRenderQueueForTests()
  try {
    const first = reserveRenderSlot(slot('a'))
    const second = reserveRenderSlot(slot('b'))
    const third = reserveRenderSlot(slot('c'))
    assert.equal(first.dispatched, true)
    assert.equal(second.dispatched, false)
    assert.equal(renderQueueDepth(), 2)

    releaseRenderSlot('a', 'succeeded')
    await second.when
    assert.equal(activeRenderCount(), 1, '让位后仍是单并发')
    assert.equal(renderQueueDepth(), 1, 'b 上位、c 仍在等')
    const order = listRenderJobs('p1').map((entry) => `${entry.jobId}:${entry.state}`)
    assert.deepEqual(order, ['a:succeeded', 'b:rendering', 'c:queued'], `实际 ${order.join(',')}`)
    assert.equal(third.dispatched, false, 'third 不该被提前派发')

    releaseRenderSlot('b', 'succeeded')
    await third.when
    assert.equal(renderQueueDepth(), 0)
    releaseRenderSlot('c', 'succeeded')
  } finally {
    resetRenderQueueForTests()
  }
})

test('队列上限 4：第 5 张等待单立刻拒收 CS-USER-ERR（不排到超时）', () => {
  withFreshQueue(() => {
    assert.equal(RENDER_QUEUE_LIMIT, 4, '上限常量变了就必须同步改这条断言')
    reserveRenderSlot(slot('run')) // 占用唯一并发位
    for (let i = 0; i < RENDER_QUEUE_LIMIT; i += 1) reserveRenderSlot(slot(`wait-${i}`))
    assert.equal(renderQueueDepth(), RENDER_QUEUE_LIMIT)

    assert.throws(
      () => reserveRenderSlot(slot('overflow')),
      (err) => err.code === 'CS-USER-ERR' && /渲染队列已满/.test(err.message),
      '超出上限必须当场拒收',
    )
    assert.equal(renderQueueDepth(), RENDER_QUEUE_LIMIT, '拒收不得改变队列')

    releaseRenderSlot('run', 'succeeded')
    resetRenderQueueForTests()
  })
})

test('排队中被取消：只从等待队列摘掉，不递减并发计数', () => {
  withFreshQueue(() => {
    reserveRenderSlot(slot('run'))
    const queued = reserveRenderSlot(slot('wait'))
    assert.equal(renderQueueDepth(), 1)

    releaseRenderSlot('wait', 'cancelled', '用户取消')
    assert.equal(renderQueueDepth(), 0, '等待单被摘掉')
    assert.equal(activeRenderCount(), 1, '没渲染过的单不许动并发计数')

    const entry = listRenderJobs('p1').find((item) => item.jobId === 'wait')
    assert.equal(entry.state, 'cancelled')
    assert.equal(entry.error, '用户取消')

    releaseRenderSlot('run', 'succeeded')
  })
})

test('进度上报：只有 rendering 态可写，clamp 到 0–1 且单调不回退（CV-373）', () => {
  withFreshQueue(() => {
    reserveRenderSlot(slot('run'))
    const queued = reserveRenderSlot(slot('wait'))

    assert.equal(reportRenderProgress('run', 0.42), true)
    assert.equal(listRenderJobs('p1').find((i) => i.jobId === 'run').progress, 0.42)
    // CV-373：报活心跳是 progress=0 —— 不能把真实进度打回去。
    assert.equal(reportRenderProgress('run', 0), true)
    assert.equal(listRenderJobs('p1').find((i) => i.jobId === 'run').progress, 0.42, '0 心跳不回退进度')
    assert.equal(reportRenderProgress('run', 8), true)
    assert.equal(listRenderJobs('p1').find((i) => i.jobId === 'run').progress, 1, '超上界夹到 1')
    assert.equal(reportRenderProgress('run', -3), true)
    assert.equal(listRenderJobs('p1').find((i) => i.jobId === 'run').progress, 1, '负值不回退（单调）')

    assert.equal(reportRenderProgress('wait', 0.5), false, '排队中的单不接收进度')
    assert.equal(reportRenderProgress('nope', 0.5), false, '未知单不接收进度')
    assert.equal(reportRenderProgress('run', Number.NaN), false, 'NaN 不写入')
    assert.equal(queued.dispatched, false)

    releaseRenderSlot('run', 'succeeded')
    assert.equal(listRenderJobs('p1').find((i) => i.jobId === 'run').progress, 1, '成功结算强制 100%')
    resetRenderQueueForTests()
  })
})

test('排队期间 abort：信号一响就摘单（不让工具调用干等）', async () => {
  resetRenderQueueForTests()
  try {
    reserveRenderSlot(slot('run'))
    const controller = new AbortController()
    const queued = reserveRenderSlot(slot('wait'), controller.signal)
    assert.equal(queued.dispatched, false)

    controller.abort()
    const entry = listRenderJobs('p1').find((item) => item.jobId === 'wait')
    assert.equal(entry.state, 'cancelled', 'abort 后必须立刻是取消态')
    assert.equal(renderQueueDepth(), 0, 'abort 的排队单要离开等待队列')

    releaseRenderSlot('run', 'succeeded')
  } finally {
    resetRenderQueueForTests()
  }
})

test('历史裁剪：已结算工单最多保留 16 条（含状态与错误简述）', () => {
  withFreshQueue(() => {
    for (let i = 0; i < 20; i += 1) {
      reserveRenderSlot(slot(`h-${i}`))
      releaseRenderSlot(`h-${i}`, i % 2 === 0 ? 'succeeded' : 'failed', i % 2 === 0 ? undefined : 'boom')
    }
    const jobs = listRenderJobs('p1')
    assert.equal(jobs.length, 16, `实际保留 ${jobs.length} 条`)
    assert.equal(jobs.at(-1).jobId, 'h-19', '保留的是最近的')
    const failed = jobs.find((item) => item.state === 'failed')
    assert.equal(failed.error, 'boom')
  })
})
