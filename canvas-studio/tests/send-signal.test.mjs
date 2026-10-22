/**
 * `src/send-signal.ts` 的**行为**断言。
 *
 * 为什么必须是行为断言：2026-10-22 真机 `session/prompt ... aborted (gateway/cancelled)`
 * 的根因是「把旧 composer 的信号原样带进新会话」。这类错误在源码里长得完全正确
 *（`args` 原样透传），只有跑一遍「切换后旧信号被中止」的时序才看得见。
 *
 * 关键不变量：
 *   1. 源信号**已中止** → 返回的信号也中止（真正的取消必须保留语义）；
 *   2. 源信号**未中止** → 返回的信号不被源之后的中止影响（旧 shell 拆掉不等于取消）；
 *   3. 源为 undefined（无信号调用）→ 返回活信号，且绝不自作主张中止；
 *   4. 永远返回**新实例**，不把调用方的信号交出去。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { detachCallerSignal } from '../lib/send-signal.js'

test('源已中止 → 返回的信号立即中止（真取消不丢）', () => {
  const source = new AbortController()
  source.abort(new Error('user cancelled'))
  const signal = detachCallerSignal(source.signal)
  assert.equal(signal.aborted, true)
  assert.equal(signal.reason instanceof Error ? signal.reason.message : '', 'user cancelled', '取消原因透传')
})

test('源未中止 → 之后旧 composer 被拆（abort）不影响返回的信号', () => {
  const source = new AbortController()
  const signal = detachCallerSignal(source.signal)
  assert.equal(signal.aborted, false)
  // 这一行就是真机现场：认领时 archiveSession/delete 旧 workspace → shell.dispose()。
  source.abort()
  assert.equal(source.signal.aborted, true)
  assert.equal(signal.aborted, false, '旧 composer 被我们自己拆掉，不是用户取消')
})

test('源为 undefined → 活信号，且后续无副作用', async () => {
  const signal = detachCallerSignal(undefined)
  assert.equal(signal.aborted, false)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(signal.aborted, false)
})

test('永远返回新实例，不把调用方信号交出去', () => {
  const source = new AbortController()
  const signal = detachCallerSignal(source.signal)
  assert.notEqual(signal, source.signal)
  // 两次调用互不影响（不同消息各自持有自己的信号）。
  const second = detachCallerSignal(source.signal)
  assert.notEqual(second, signal)
  source.abort()
  assert.equal(second.aborted, false)
})
