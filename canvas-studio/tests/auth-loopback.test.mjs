/**
 * P1 登录闭环守卫：loopback 回调服务 + 会话中转缓存。
 *
 * 真跑 HTTP（判耗时铁律：loopback listen + 本机 fetch 是毫秒级；整体应 < 2s）：
 * 1. startLoopback 幂等 —— 两次启动返回同一地址；地址形态 = `http://127.0.0.1:<port>/callback`。
 * 2. `/callback?code=…` 落地 —— 响应 200 + text/html（落地页），pending 缓存完整 URL（含 query）。
 * 3. consume 一次性 —— 第一次取走有值，第二次取空；取空后再回调再取，语义自恢复。
 * 4. 非 /callback 路径 404。
 * 5. stop 后服务关闭（active=false），且 stop 幂等。
 * 6. auth-session：set/get/clear 语义；会话对象不被外界改写引用泄漏（快照语义由
 *    调用方保证，这里钉住「clear 后 get 为 null」与「set 后 get 原值」）。
 *
 * import 的是 `lib/**`（编译产物）—— 与全仓测试约定一致：跑测试前必须先 build
 * （tsdown 只产 client bundle，lib/** 由 `tsc -p tsconfig.json` emit）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import {
  startLoopback,
  consumePendingCallback,
  loopbackActive,
  stopLoopback,
} from '../lib/auth-loopback.js'
import { setAuthSession, getAuthSession, clearAuthSession } from '../lib/auth-session.js'

/** 极简 GET（node:http，不引 undici 依赖差异）。 */
function get(url) {
  return new Promise((resolve, reject) => {
    request(url, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    }).on('error', reject).end()
  })
}

test('startLoopback: 幂等 + 地址形态', async () => {
  stopLoopback()
  const first = await startLoopback()
  const second = await startLoopback()
  assert.equal(first, second)
  assert.match(first, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.equal(loopbackActive(), true)
  stopLoopback()
})

test('callback: 200 落地页 + pending 缓存完整 URL', async () => {
  stopLoopback()
  const redirectUrl = await startLoopback()
  const res = await get(`${redirectUrl}?code=abc-123&state=x`)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'] ?? '', /text\/html/)
  assert.match(res.body, /登录完成/)
  const pending = consumePendingCallback()
  assert.ok(pending !== null)
  assert.ok(pending.includes('?code=abc-123&state=x'))
  // 消费即清：第二次为 null。
  assert.equal(consumePendingCallback(), null)
  stopLoopback()
})

test('callback: 一次性消费后可再回调（自恢复）+ 非 callback 路径 404', async () => {
  stopLoopback()
  const redirectUrl = await startLoopback()
  const base = redirectUrl.replace(/\/callback$/, '')
  const notFound = await get(`${base}/other`)
  assert.equal(notFound.status, 404)
  await get(`${redirectUrl}?code=second`)
  assert.ok(consumePendingCallback()?.includes('code=second'))
  assert.equal(consumePendingCallback(), null)
  stopLoopback()
})

test('stop: 关闭服务（active=false）且幂等；重启是新端口', async () => {
  stopLoopback()
  await startLoopback()
  stopLoopback()
  assert.equal(loopbackActive(), false)
  stopLoopback() // 幂等不抛
  const next = await startLoopback()
  assert.match(next, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  stopLoopback()
})

test('auth-session: set / get / clear 语义', () => {
  clearAuthSession()
  assert.equal(getAuthSession(), null)
  setAuthSession({ accessToken: 'tok-1', expiresAt: 1234, userId: 'u-1', email: 'a@b.c' })
  const session = getAuthSession()
  assert.equal(session?.accessToken, 'tok-1')
  assert.equal(session?.userId, 'u-1')
  assert.equal(session?.email, 'a@b.c')
  setAuthSession({ accessToken: 'tok-2', expiresAt: null, userId: 'u-1', email: null })
  assert.equal(getAuthSession()?.accessToken, 'tok-2')
  clearAuthSession()
  assert.equal(getAuthSession(), null)
})
