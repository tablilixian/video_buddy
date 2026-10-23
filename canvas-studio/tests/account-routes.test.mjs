/**
 * 余额只读路由的 HTTP 面契约（CV-358，方案 P3「积分落地清单」第 2 层）。
 *
 * 锁四组行为：
 *   1. 权威 / 方法守卫：只读 ⇒ `requestAllowed`（跨站 403、写方法 405）；
 *   2. 降级体：未登录 / 未启用时**照样 200**，用 `signedIn` / `enabled` 表达状态 ——
 *      余额卡要有能力区分「没登录」与「读到 0」，500 或空体都做不到；
 *   3. TTL 与 `?refresh=1`：普通 GET 吃 Host 缓存，force 走网络；
 *   4. 服务端失败不变成 500：视图里带 `error` 并保留旧值。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerStudioRoutes } from '../lib/routes.js'
import { installAccountState, notifyAuthCleared } from '../lib/account-state.js'
import { setAuthSession, clearAuthSession } from '../lib/auth-session.js'

const PATH = '/canvas-studio/account/credits'
const balanceOk = { currency: 'CNY', available_balance: 7.5, frozen_balance: 0, lots: null }

let harness = null
let fetchCalls = []
let fetchMode = 'ok'
let enabled = true

/** stub 全局 fetch（DramaClient 默认取全局 fetch）；只关心余额接口。 */
function installFetchStub() {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    if (fetchMode === 'fail') {
      return new Response(JSON.stringify({ error: { code: 'rate_limited', message: '慢点' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(balanceOk), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return () => { globalThis.fetch = original }
}

function resetAll() {
  clearAuthSession()
  notifyAuthCleared()
  fetchCalls = []
  fetchMode = 'ok'
  enabled = true
}

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-account-credits-'))
  const routes = []
  let port = 0
  const ctx = {
    webServer: { port, register: (route) => { routes.push(route); return () => {} } },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  const registry = {
    registryRoot: root,
    projectsRoot: join(root, 'projects'),
    async list() { return [] },
    async sweepOnceForCurrentRoot() { return 0 },
  }
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.find((candidate) => candidate.kind === 'exact' && candidate.path === path)
    if (route === undefined) {
      res.statusCode = 404
      res.end('{"error":"no route"}')
      return
    }
    void route.handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  ctx.webServer.port = port
  const dispose = registerStudioRoutes(ctx, registry, {})
  return { server, port, dispose, root }
}

function call(method, { headers = {}, path = PATH } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: harness.port,
      method,
      path,
      agent: false,
      headers: {
        host: `127.0.0.1:${harness.port}`,
        origin: `http://127.0.0.1:${harness.port}`,
        'sec-fetch-site': 'same-origin',
        ...headers,
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = data === '' ? null : JSON.parse(data) } catch { parsed = { raw: data } }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

before(async () => {
  harness = await startHarness()
})

after(async () => {
  harness.dispose()
  harness.server.closeIdleConnections()
  harness.server.closeAllConnections()
  await new Promise((resolve) => harness.server.close(resolve))
  await rm(harness.root, { recursive: true, force: true })
})

function installDeps(restoreFetch) {
  installAccountState({
    enabled: () => enabled,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
  })
  return restoreFetch
}

test('credits 路由：未登录照样 200，signedIn=false 且零请求', async () => {
  resetAll()
  const restore = installDeps(installFetchStub())
  try {
    const res = await call('GET')
    assert.equal(res.status, 200, '未登录不是错误，不能 4xx/5xx')
    assert.equal(res.body.signedIn, false)
    assert.equal(res.body.enabled, true)
    assert.equal(res.body.balance, null, '余额必须是 null，不能是 0')
    assert.equal(res.body.fetchedAt, null)
    assert.equal(fetchCalls.length, 0, '没有会话就不该打业务接口')
  } finally {
    restore()
    resetAll()
  }
})

test('credits 路由：登录后取数、TTL 内吃缓存、refresh=1 走网络', async () => {
  resetAll()
  const restore = installDeps(installFetchStub())
  try {
    setAuthSession({ accessToken: 'tok-route', expiresAt: null, userId: 'u-1', email: null })
    const first = await call('GET')
    assert.equal(first.status, 200)
    assert.equal(first.body.signedIn, true)
    assert.equal(first.body.balance.available_balance, 7.5)
    assert.ok(typeof first.body.fetchedAt === 'string')
    assert.equal(first.body.error, null)
    assert.equal(fetchCalls.length, 1)

    await call('GET')
    assert.equal(fetchCalls.length, 1, 'TTL 内第二次读取不再打接口')

    await call('GET', { path: `${PATH}?refresh=1` })
    assert.equal(fetchCalls.length, 2, 'refresh=1 绕 TTL')
  } finally {
    restore()
    resetAll()
  }
})

test('credits 路由：服务端 429 保留旧值并把错误放进视图（不 500）', async () => {
  resetAll()
  const restore = installDeps(installFetchStub())
  try {
    setAuthSession({ accessToken: 'tok-route', expiresAt: null, userId: 'u-1', email: null })
    await call('GET')
    assert.equal(fetchCalls.length, 1)

    fetchMode = 'fail'
    const res = await call('GET', { path: `${PATH}?refresh=1` })
    assert.equal(res.status, 200, '读失败不是 HTTP 失败：卡片要继续显示旧数字')
    assert.equal(res.body.balance.available_balance, 7.5, '旧值必须保留')
    assert.equal(res.body.error.code, 'rate_limited')
  } finally {
    restore()
    resetAll()
  }
})

test('credits 路由：管理面未启用时 enabled=false 且零请求', async () => {
  resetAll()
  const restore = installDeps(installFetchStub())
  try {
    enabled = false
    setAuthSession({ accessToken: 'tok-route', expiresAt: null, userId: 'u-1', email: null })
    const res = await call('GET')
    assert.equal(res.status, 200)
    assert.equal(res.body.enabled, false)
    assert.equal(fetchCalls.length, 0)
  } finally {
    restore()
    resetAll()
  }
})

test('credits 路由：权威与方法守卫（POST 405 / 跨站 403）', async () => {
  resetAll()
  const restore = installDeps(installFetchStub())
  try {
    const post = await call('POST')
    assert.equal(post.status, 405)

    const crossSite = await call('GET', { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
  } finally {
    restore()
    resetAll()
  }
})
