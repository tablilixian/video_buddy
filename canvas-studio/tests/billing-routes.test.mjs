/**
 * 计费路由的 HTTP 面契约（方案 20261102 P2）。
 *
 * 锁六组行为：
 *   1. 权威闸：跨源读取 403，写动作额外要求同源 origin（`mutationAllowed`）；
 *   2. 方法闸：快照只读（PUT → 405），写动作只 POST（GET /checkout → 405）；
 *   3. 快照降级：未登录 / 未启用照样 200，用字段表达状态（不能 4xx/5xx —— 客户端要
 *      区分「读不到」与「没有订阅」）；
 *   4. `?refresh=1` 绕 TTL；
 *   5. 写动作**保留上游 status/code**（409 不能被压成 500，否则 UI 分不出「已有待支付
 *      订单」和「服务挂了」）；
 *   6. 幂等键缺失/非法 → 400 `invalid_argument`，且零上游请求。
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
import { installBillingState, resetBilling } from '../lib/billing-state.js'
import { setAuthSession, clearAuthSession } from '../lib/auth-session.js'

const BASE = '/canvas-studio/billing'
const overview = {
  subscription: null,
  credits: { currency: 'credit', available_balance: 223.6111, frozen_balance: 0 },
  plans: [{ code: 'starter_monthly', name: 'Starter', billing_period: 'month', price_cents: 1000, currency: 'USD', period_credits: 1000, entitlements: {}, purchasable: true }],
  credit_packs: [],
}

let harness = null
let fetchCalls = []
let upstream = 'ok'
let enabled = true

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    if (upstream === 'portal_unavailable') {
      return json(409, { error: { code: 'portal_unavailable', message: 'subscription management is unavailable' } })
    }
    if (upstream === 'checkout_pending') {
      return json(409, { error: { code: 'conflict', message: 'subscription checkout already pending' } })
    }
    if (upstream === 'rate_limited') {
      return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': '7' },
      })
    }
    if (String(url).endsWith('/v1/billing/overview')) return json(200, overview)
    if (String(url).endsWith('/v1/billing/checkout-sessions')) {
      return json(201, {
        order_id: 'o-1', order_no: 'RB1', checkout_session_id: 'cs_test_1',
        checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: '2026-11-02T02:08:31Z',
      })
    }
    if (String(url).endsWith('/v1/billing/portal-sessions')) {
      return json(201, { portal_url: 'https://billing.stripe.com/p/session/test_1' })
    }
    return json(404, { error: { code: 'not_found', message: 'no route' } })
  }
  return () => { globalThis.fetch = original }
}

function resetAll() {
  clearAuthSession()
  resetBilling()
  fetchCalls = []
  upstream = 'ok'
  enabled = true
}

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-billing-'))
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
    // 计费是 **prefix** 路由：按最长前缀命中（与宿主 webServer 同语义）。
    const route = routes
      .filter((candidate) => candidate.kind === 'prefix' && path.startsWith(candidate.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
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

/**
 * 发请求。默认带「同源」标记（host + origin + sec-fetch-site），
 * 跨源/缺 origin 由用例显式覆盖。
 */
function call(method, { path = BASE, headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body)
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
        ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
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
    if (payload !== null) req.write(payload)
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

function installDeps() {
  installBillingState({
    enabled: () => enabled,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
  })
}

test('GET 快照：未登录照样 200，零上游请求，pending_checkout 键不存在', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    const res = await call('GET')
    assert.equal(res.status, 200)
    assert.equal(res.body.signedIn, false)
    assert.equal(res.body.enabled, true)
    assert.equal(res.body.credits, null)
    assert.equal('pending_checkout' in res.body, false, 'omitempty 字段不能强行出现')
    assert.equal(fetchCalls.length, 0)
  } finally {
    restore(); resetAll()
  }
})

test('GET 快照：登录后取数；TTL 内缓存；?refresh=1 绕 TTL', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const first = await call('GET')
    assert.equal(first.status, 200)
    assert.equal(first.body.credits.available_balance, 223.6111)
    assert.equal(first.body.plans[0].name, 'Starter', '名字来自服务端 name 字段，不是 code')
    assert.equal(fetchCalls.length, 1)
    await call('GET')
    assert.equal(fetchCalls.length, 1, 'TTL 内第二次不吃网络')
    await call('GET', { path: `${BASE}?refresh=1` })
    assert.equal(fetchCalls.length, 2, 'refresh=1 绕 TTL')
  } finally {
    restore(); resetAll()
  }
})

test('权威 / 方法闸：跨源读取 403、快照写方法 405、写动作 GET 405、未知动作 404', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    const cross = await call('GET', { headers: { origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' } })
    assert.equal(cross.status, 403)

    assert.equal((await call('PUT')).status, 405, '快照只读')
    assert.equal((await call('GET', { path: `${BASE}/checkout` })).status, 405, 'checkout 只 POST')
    assert.equal((await call('GET', { path: `${BASE}/portal-sessions` })).status, 405)
    assert.equal((await call('GET', { path: `${BASE}/nope` })).status, 404)
  } finally {
    restore(); resetAll()
  }
})

test('写动作：跨源 POST 403（mutationAllowed），零上游请求', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const res = await call('POST', {
      path: `${BASE}/checkout`,
      body: { kind: 'plan', product_code: 'starter_monthly' },
      headers: { origin: 'http://evil.test', 'sec-fetch-site': 'cross-site', 'idempotency-key': 'k-1' },
    })
    assert.equal(res.status, 403)
    assert.equal(fetchCalls.length, 0, '被本地拦下的请求不能打到上游')
  } finally {
    restore(); resetAll()
  }
})

test('checkout：缺幂等键 400 invalid_argument；带上则 201 且只发 kind+product_code', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })

    const missing = await call('POST', { path: `${BASE}/checkout`, body: { kind: 'plan', product_code: 'starter_monthly' } })
    assert.equal(missing.status, 400)
    assert.equal(missing.body.code, 'invalid_argument')
    assert.equal(fetchCalls.length, 0, '缺键不该发上游')

    const ok = await call('POST', {
      path: `${BASE}/checkout`,
      body: { kind: 'plan', product_code: 'starter_monthly' },
      headers: { 'idempotency-key': 'key-1' },
    })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_1')
    const upstreamCall = fetchCalls.at(-1)
    assert.equal(upstreamCall.init.headers['Idempotency-Key'], 'key-1')
    assert.deepEqual(JSON.parse(upstreamCall.init.body), { kind: 'plan', product_code: 'starter_monthly' })
  } finally {
    restore(); resetAll()
  }
})

test('checkout：上游 409 原样透传 status + code（不压成 500）', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    upstream = 'checkout_pending'
    const res = await call('POST', {
      path: `${BASE}/checkout`,
      body: { kind: 'plan', product_code: 'starter_monthly' },
      headers: { 'idempotency-key': 'key-2' },
    })
    assert.equal(res.status, 409, '409 必须透传：UI 要靠它分派「已有待支付订单」')
    assert.equal(res.body.code, 'conflict')
    assert.match(res.body.error, /already pending/, '原始 message 保留给排查，UI 按 code 分派')
  } finally {
    restore(); resetAll()
  }
})

test('checkout：429 带 Retry-After（秒）一起回来', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    upstream = 'rate_limited'
    const res = await call('POST', {
      path: `${BASE}/checkout`,
      body: { kind: 'plan', product_code: 'starter_monthly' },
      headers: { 'idempotency-key': 'key-3' },
    })
    assert.equal(res.status, 429)
    assert.equal(res.body.code, 'rate_limited')
    assert.equal(res.body.retryAfterSeconds, 7, '倒计时秒数必须带给客户端（按钮要按它禁用）')
  } finally {
    restore(); resetAll()
  }
})

test('portal：成功 201；无订阅时 409 portal_unavailable 透传', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const ok = await call('POST', { path: `${BASE}/portal-sessions` })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.portal_url, 'https://billing.stripe.com/p/session/test_1')

    upstream = 'portal_unavailable'
    const denied = await call('POST', { path: `${BASE}/portal-sessions` })
    assert.equal(denied.status, 409)
    assert.equal(denied.body.code, 'portal_unavailable')
  } finally {
    restore(); resetAll()
  }
})

test('未启用（businessApiBase 为空）：快照 200 + enabled=false，写动作 503', async () => {
  resetAll()
  const restore = stubFetch()
  try {
    enabled = false
    installDeps()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const snapshot = await call('GET')
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.body.enabled, false)
    assert.equal(fetchCalls.length, 0, '未启用就不该打上游')

    const write = await call('POST', {
      path: `${BASE}/checkout`,
      body: { kind: 'plan', product_code: 'starter_monthly' },
      headers: { 'idempotency-key': 'key-4' },
    })
    assert.equal(write.status, 503)
    assert.equal(write.body.code, 'unavailable')
  } finally {
    restore(); resetAll()
  }
})
