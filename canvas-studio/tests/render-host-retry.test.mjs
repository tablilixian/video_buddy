/**
 * REQ-035 B2-2（D10）：渲染窗口失败后重置的钩子与节流。
 *
 * 守的是什么：2026-10-24 事故里"越试越死" —— 一次超时后窗口带着半残状态继续接单，
 * 后续每单都在同一个坏状态上失败，只有重启客户端才恢复。
 * 这里只测**调度语义**（什么时候该重置、节流是否生效）；真删窗口由 routes 注入的
 * 钩子做（`disposeRenderHost`），不在本文件的范围内。
 *
 * 直连 Host tsc 编译产物 `lib/render-host/dispatch.js`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RENDER_HOST_RESET_MIN_INTERVAL_MS,
  resetRenderHostAfterFailure,
  resetRenderHostDispatch,
  setRenderHostResetter,
} from '../lib/render-host/dispatch.js'

test('B2-2：没有钩子时是空操作（纯 CLI 宿主不该因此报错）', () => {
  resetRenderHostDispatch()
  assert.equal(resetRenderHostAfterFailure('boom', 1_000), false)
})

test('B2-2：有钩子时首次失败即重置，30s 内不重复抖动', () => {
  resetRenderHostDispatch()
  const calls = []
  setRenderHostResetter((reason) => calls.push(reason))

  assert.equal(resetRenderHostAfterFailure('timeout', 1_000), true)
  assert.deepEqual(calls, ['timeout'])

  // 12s 后第二次失败：被节流，不该再抖窗口
  assert.equal(resetRenderHostAfterFailure('stalled', 13_000), false)
  assert.equal(calls.length, 1, '节流期内不得重复重置')

  // 31s 后：允许再来一次
  assert.equal(resetRenderHostAfterFailure('timer', 1_000 + RENDER_HOST_RESET_MIN_INTERVAL_MS + 1), true)
  assert.equal(calls.length, 2)
})

test('B2-2：钩子抛错不影响调用方（失败返回 false，不冒泡）', () => {
  resetRenderHostDispatch()
  setRenderHostResetter(() => {
    throw new Error('dispose 挂了')
  })
  assert.equal(resetRenderHostAfterFailure('boom', 1_000), false)
})

test('B2-2：resetRenderHostDispatch 清掉钩子与节流时间戳', () => {
  resetRenderHostDispatch()
  setRenderHostResetter(() => {})
  assert.equal(resetRenderHostAfterFailure('a', 1_000_000), true)
  resetRenderHostDispatch()
  assert.equal(resetRenderHostAfterFailure('b', 1_000_001), false, '清空后应回到「无钩子」')
  // 再装钩子：节流时间戳也被清过，所以立刻就能重置
  setRenderHostResetter(() => {})
  assert.equal(resetRenderHostAfterFailure('c', 1_000_002), true)
})
