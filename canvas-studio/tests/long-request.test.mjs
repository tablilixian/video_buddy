/**
 * CV-135 长请求传输层的冒烟测试。
 *
 * 背景：Node 内置 fetch（undici）的 dispatcher 默认 `headersTimeout = bodyTimeout = 300s`
 * 且**先于** AbortSignal 触发，导致 Drama 生成长请求（image 360s / video 600s）两档
 * 实际不可达（CV-133 P0）。修法是**按请求**注入一个超时更长的 dispatcher
 * （`src/long-request.ts`），而不是引入 undici 依赖或替换全仓 fetch。
 *
 * 本文件不碰真实后端，只做三件事：
 * 1. 不变量：`DRAMA_TIMEOUT_MS` 每一档都必须严格小于传输层上限（否则该档永远不可达）；
 * 2. 契约：dispatcher 可取到、是真正的 dispatcher、按超时值记忆化、不等于全局实例；
 * 3. **行为实证**：本机 loopback 起一个 2s 才发响应头的服务器 —— 传收紧到 500ms 的
 *    dispatcher 时请求必须被掐断（UND_ERR_HEADERS_TIMEOUT），不传的对照必须成功。
 *    这才是「这条通路真的能控制上限」的证据，而不是只断言对象长得对。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { LONG_REQUEST_TIMEOUT_MS, longRequestDispatcher } from '../lib/long-request.js'
import { DRAMA_TIMEOUT_MS } from '../lib/generate.js'

/** undici 全局 dispatcher 的 well-known symbol（仅用于断言「没动全局」）。 */
const GLOBAL_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')

test('CV-135 不变量：Drama 每一档超时都严格小于长请求传输层上限', () => {
  const entries = Object.entries(DRAMA_TIMEOUT_MS)
  assert.ok(entries.length > 0, 'DRAMA_TIMEOUT_MS 不应为空')
  for (const [kind, ms] of entries) {
    assert.ok(
      ms < LONG_REQUEST_TIMEOUT_MS,
      `${kind}=${ms}ms 必须严格小于传输层上限 ${LONG_REQUEST_TIMEOUT_MS}ms，否则该档永远不可达`,
    )
  }
})

test('CV-135 longRequestDispatcher：可取到真正的 dispatcher，按超时值记忆化，且不动全局', () => {
  const standard = longRequestDispatcher()
  assert.notEqual(
    standard,
    undefined,
    '应能取到 dispatcher（Node 内置 undici 的全局 dispatcher 挂在 well-known symbol 上）；' +
      '取不到说明该 Runtime 的 undici 内部实现已变，长请求会退回 300s 上限',
  )
  assert.equal(typeof standard.dispatch, 'function', '必须是真正的 undici dispatcher（带 dispatch 方法）')
  assert.equal(longRequestDispatcher(), standard, '同一超时值应复用同一实例（连接池才能复用）')

  const custom = longRequestDispatcher(1234)
  assert.notEqual(custom, standard, '不同超时值不应复用实例')

  const globalDispatcher = globalThis[GLOBAL_DISPATCHER_SYMBOL]
  assert.notEqual(standard, globalDispatcher, '不得等于全局 dispatcher —— 我们是按请求注入，绝不能改全局')
})

test('CV-135 行为实证：请求级 dispatcher 真的决定超时上限（收紧被掐断 / 缺省成功）', async (t) => {
  /** 2s 后才发响应头 —— 足以让「收紧到 500ms」的请求先被传输层掐断。 */
  const DELAY_MS = 2000
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('slow')
    }, DELAY_MS)
  })

  const listening = await new Promise((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(0, '127.0.0.1', () => resolve(true))
  })
  if (!listening) {
    t.skip('本机 loopback 不可用，跳过行为实证')
    return
  }
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/slow`

  try {
    // ① 收紧到 500ms：必须在传输层上限附近被掐断，而不是等满 2s。
    const tight = longRequestDispatcher(500)
    const started = Date.now()
    await assert.rejects(
      fetch(url, { dispatcher: tight, signal: AbortSignal.timeout(30_000) }),
      (error) => {
        assert.equal(
          error.cause?.code,
          'UND_ERR_HEADERS_TIMEOUT',
          `应被传输层掐断（UND_ERR_HEADERS_TIMEOUT），实际：${error.message} / ${error.cause?.code ?? error.cause?.message}`,
        )
        return true
      },
      '收紧超时后，慢响应应当失败',
    )
    const elapsed = Date.now() - started
    assert.ok(elapsed < DELAY_MS, `应在 ${DELAY_MS}ms 之前失败，实际 ${elapsed}ms`)

    // ② 对照组：同一端点、不传 dispatcher —— 应正常成功。
    //    两次只差 dispatcher 一个字段，据此可断定 ① 的掐断来自我们构造的实例。
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    assert.equal(response.status, 200, '对照组（缺省 dispatcher）应正常成功')
    assert.equal(await response.text(), 'slow')
  } finally {
    server.close()
  }
})
