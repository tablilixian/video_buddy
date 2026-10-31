/**
 * CV-384 P0-2：手势帧合并器（src/canvas-gesture-raf.ts）行为契约。
 *
 * 为什么要有这层：pointermove / wheel 的事件频率可以高于显示帧率（mac 触控板
 * 120Hz+），合并器把「一帧内到达的多个事件」折叠成恰好一次应用。这里是它的
 * 机器契约 —— CanvasSurface 的接线（flush 时机 / 失联恢复）由
 * canvas-node-compositing-guard（G1 源码闸）钉住，两边合起来才是完整闭环。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 * （直连 lib 编译产物，改 canvas-gesture-raf.ts 后须先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFrameCoalescer, mergeLatestPoint } from '../lib/canvas-gesture-raf.js'

/** 假帧调度：手动 tick，返回句柄（同时验证「取消」真的摘掉了回调）。 */
function fakeScheduler() {
  const queue = []
  return {
    schedule(cb) {
      queue.push(cb)
      return () => {
        const index = queue.indexOf(cb)
        if (index >= 0) queue.splice(index, 1)
      }
    },
    tick() {
      const callbacks = queue.splice(0)
      for (const callback of callbacks) callback()
    },
    get pendingCount() { return queue.length },
  }
}

function setup(merge = mergeLatestPoint) {
  const applied = []
  const clock = fakeScheduler()
  const coalescer = createFrameCoalescer({
    merge,
    apply: frame => { applied.push(frame) },
    schedule: clock.schedule,
  })
  return { applied, clock, coalescer }
}

test('G3-①：一帧内多次 push，帧回调恰好应用一次、坐标 = 最新', () => {
  const { applied, clock, coalescer } = setup()
  coalescer.push({ x: 1, y: 1 })
  coalescer.push({ x: 2, y: 2 })
  coalescer.push({ x: 3, y: 3 })
  assert.equal(coalescer.hasPending(), true)
  assert.equal(clock.pendingCount, 1, '多次 push 只排一次帧回调')
  clock.tick()
  assert.deepEqual(applied, [{ x: 3, y: 3 }], '折叠语义 = 取最新坐标，中间点不应用')
  assert.equal(coalescer.hasPending(), false)
  clock.tick()
  assert.equal(applied.length, 1, '回调只跑一次')
})

test('G3-②：跨帧持续 push → 每帧一次（合并不是节流，帧率不掉）', () => {
  const { applied, clock, coalescer } = setup()
  for (let frame = 0; frame < 3; frame += 1) {
    coalescer.push({ x: frame, y: frame })
    clock.tick()
    coalescer.push({ x: frame + 0.5, y: frame + 0.5 })
    clock.tick()
  }
  assert.equal(applied.length, 6, '每帧一次，6 个帧槽 6 次应用')
})

test('G3-③：flush 立刻应用待处理帧并取消已排回调（松手最后一帧必须入账）', () => {
  const { applied, clock, coalescer } = setup()
  coalescer.push({ x: 10, y: 20 })
  assert.equal(coalescer.flush(), true)
  assert.deepEqual(applied, [{ x: 10, y: 20 }])
  assert.equal(clock.pendingCount, 0, '已排的帧回调被取消 —— flush 后 tick 不得再应用')
  clock.tick()
  assert.equal(applied.length, 1)
  assert.equal(coalescer.flush(), false, '无待处理帧时 flush 返回 false 且不调用 apply')
  assert.equal(applied.length, 1)
})

test('G3-④：reset 丢弃待处理帧并摘掉回调（手势终结后不得再应用）', () => {
  const { applied, clock, coalescer } = setup()
  coalescer.push({ x: 5, y: 5 })
  coalescer.reset()
  assert.equal(coalescer.hasPending(), false)
  assert.equal(clock.pendingCount, 0, 'reset 必须取消已排回调')
  clock.tick()
  assert.deepEqual(applied, [], 'reset 后 tick 不应用')
})

test('G3-⑤：滚轮折叠语义 —— 因子 log 域累加、锚点取最新（丢 delta = 缩放量错）', () => {
  const mergeWheel = (prev, next) => ({ x: next.x, y: next.y, logFactor: prev.logFactor + next.logFactor })
  const { applied, clock, coalescer } = setup(mergeWheel)
  coalescer.push({ x: 100, y: 100, logFactor: -0.05 })
  coalescer.push({ x: 102, y: 104, logFactor: -0.07 })
  clock.tick()
  assert.equal(applied.length, 1)
  const [frame] = applied
  assert.equal(frame.x, 102)
  assert.equal(frame.y, 104)
  assert.ok(Math.abs(frame.logFactor - -0.12) < 1e-9,
    '一帧内两段 delta 必须累加（-0.05 + -0.07），锚点取最新事件位置')
})

test('G3-⑥：mergeLatestPoint 直接返回最新帧（拖拽/平移的折叠口径）', () => {
  const previous = { x: 1, y: 2 }
  const next = { x: 3, y: 4 }
  assert.deepEqual(mergeLatestPoint(previous, next), next)
})
