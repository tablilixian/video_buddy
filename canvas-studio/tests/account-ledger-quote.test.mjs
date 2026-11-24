/**
 * 积分流水 + 预估报价两条新路由的 HTTP 面契约（2026-11-24）。
 *
 * 锁的是**「钱这件事的读数不能假装知道」**：
 *   1. 流水：未登录 / 未启用照样 200（用 `signedIn` / `enabled` 表达），失败保留旧
 *      条目并带 `error` —— 账务页要能显示「这是旧账 + 为什么没更新」；
 *   2. 报价：**永不 5xx**。`credits: null` 才是「不知道」，0 是真实的价；报价失败
 *      绝不能拦下提交（生成链的 quote 硬闸本来就是 fail-open）；
 *   3. 报价参数由 Host 现推（请求体里出现 model/input 一律不看），缓存按**计价指纹**
 *      命中 —— 改 prompt 不该重新报价，改时长必须重报。
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

const LEDGER_PATH = '/canvas-studio/account/ledger'
const QUOTE_PATH = '/canvas-studio/account/quote'

let harness = null
/** 每次 fetch 的 {url, body}（断言查询串与请求体用）。 */
let fetchCalls = []
/** 'ok' | 'ledger-fail' | 'quote-fail' */
let fetchMode = 'ok'

const ledgerPage = {
  entries: [
    {
      id: 42310,
      entry_type: 'commit',
      amount: -21.1354,
      lot_id: 'lot-1',
      hold_id: 'hold-1',
      generation_id: 'gen-1',
      lot_balance_after: 798.9729,
      metadata: { committed_amount: 21.1354 },
      created_at: '2026-11-24T11:18:46.716+08:00',
    },
    {
      id: 42309,
      entry_type: 'hold',
      amount: -21.1354,
      lot_id: 'lot-1',
      hold_id: 'hold-1',
      generation_id: 'gen-1',
      lot_balance_after: 820.1083,
      metadata: { model_code: 'image.krea2', operation: 'txt2image', frozen_amount: 21.1354 },
      created_at: '2026-11-24T11:18:20.000+08:00',
    },
  ],
  next_cursor: '42309',
}

function installFetchStub() {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const href = String(url)
    fetchCalls.push({ url: href, body: init?.body === undefined ? null : String(init.body) })
    if (href.includes('/v1/credits/ledger')) {
      if (fetchMode === 'ledger-fail') {
        return new Response(JSON.stringify({ error: { code: 'internal', message: '炸了' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(ledgerPage), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (href.includes('/v1/generations/quote')) {
      if (fetchMode === 'quote-fail') {
        return new Response(JSON.stringify({ error: { code: 'rate_limited', message: '慢点' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ estimated_credits: 21.1354, currency: 'CNY' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  }
  return () => { globalThis.fetch = original }
}

function resetAll() {
  clearAuthSession()
  notifyAuthCleared()
  fetchCalls = []
  fetchMode = 'ok'
}

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-account-ledger-'))
  const routes = []
  const ctx = {
    webServer: { port: 0, register: (route) => { routes.push(route); return () => {} } },
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
  const port = server.address().port
  ctx.webServer.port = port
  const dispose = registerStudioRoutes(ctx, registry, {})
  return { server, port, dispose, root }
}

function call(method, { path = LEDGER_PATH, body = null, headers = {} } = {}) {
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

function installDeps() {
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
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

test('ledger：未登录照样 200（signedIn=false，零请求，entries 是空数组不是 null）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    const res = await call('GET')
    assert.equal(res.status, 200)
    assert.equal(res.body.signedIn, false)
    assert.deepEqual(res.body.entries, [], '没有账要显示成空列表，null 会让 UI 以为还没读过')
    assert.equal(res.body.error, null)
    assert.equal(fetchCalls.length, 0)
  } finally {
    restore()
    resetAll()
  }
})

test('ledger：登录后取一页（limit 本地夹到 50），TTL 内不再请求', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const first = await call('GET')
    assert.equal(first.status, 200)
    assert.equal(first.body.entries.length, 2)
    assert.equal(first.body.hasMore, true, 'next_cursor 非空 ⇒ 还有更早的账')
    assert.ok(fetchCalls[0].url.includes('limit=50'), `必须带分页上限，实际 ${fetchCalls[0].url}`)
    assert.equal(fetchCalls[0].url.includes('cursor'), false, '首页不带游标')

    await call('GET')
    assert.equal(fetchCalls.length, 1, '60s TTL 内第二次读取不再打接口')
  } finally {
    restore()
    resetAll()
  }
})

test('ledger：?more=1 按游标追加下一页（显式动作绕 TTL）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await call('GET')
    const more = await call('GET', { path: `${LEDGER_PATH}?more=1` })
    assert.equal(more.status, 200)
    assert.ok(fetchCalls[1].url.includes('cursor=42309'), `翻页必须带上一页的 next_cursor，实际 ${fetchCalls[1].url}`)
    assert.equal(more.body.entries.length, 4, '追加而不是替换（2 + 2）')
  } finally {
    restore()
    resetAll()
  }
})

test('ledger：服务端 500 保留旧条目并把错误放进视图（不 500）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await call('GET')
    fetchMode = 'ledger-fail'
    const res = await call('GET', { path: `${LEDGER_PATH}?refresh=1` })
    assert.equal(res.status, 200, '读失败不是 HTTP 失败：账务页要继续显示旧账')
    assert.equal(res.body.entries.length, 2, '旧条目必须保留')
    assert.equal(res.body.error.code, 'internal')
  } finally {
    restore()
    resetAll()
  }
})

test('ledger：方法守卫（POST 405 / 跨站 403）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    assert.equal((await call('POST', { path: LEDGER_PATH, body: {} })).status, 405)
    const crossSite = await call('GET', { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
  } finally {
    restore()
    resetAll()
  }
})

test('quote：GET 405 / 缺 kind 400 / 跨站 403（参数不对不猜价）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
  try {
    assert.equal((await call('GET', { path: QUOTE_PATH })).status, 405)
    assert.equal((await call('POST', { path: QUOTE_PATH, body: {} })).status, 400, '缺 kind 是调用方搞错接口')
    const crossSite = await call('POST', {
      path: QUOTE_PATH,
      body: { kind: 'image' },
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(crossSite.status, 403)
    assert.equal(fetchCalls.length, 0, '守卫拦下的请求一个都不该打到业务接口')
  } finally {
    restore()
    resetAll()
  }
})

test('quote：图片按 Host 现推的参数报价（client 传的 model/input 一律不看）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
  try {
    const res = await call('POST', {
      path: QUOTE_PATH,
      body: { kind: 'image', prompt: '一只猫', resolution: '720p', model: 'evil.model', input: { width: 1, height: 1 } },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.credits, 21.1354)
    assert.equal(res.body.model, 'image.krea2')
    assert.equal(res.body.operation, 'txt2image')
    const sent = JSON.parse(fetchCalls[0].body)
    assert.deepEqual(Object.keys(sent).sort(), ['input', 'model', 'operation'], 'quote 只收 model/operation/input')
    assert.equal(sent.model, 'image.krea2', '模型由 Host 现推，不信 client 传的')
    assert.deepEqual([sent.input.width, sent.input.height], [1376, 768])
  } finally {
    restore()
    resetAll()
  }
})

test('quote：同指纹命中 Host 缓存，改 prompt 不重报、改时长必须重报', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
  try {
    const base = { kind: 'video', duration: 15, resolution: '1080p' }
    await call('POST', { path: QUOTE_PATH, body: { ...base, prompt: '镜头一' } })
    assert.equal(fetchCalls.length, 1)
    await call('POST', { path: QUOTE_PATH, body: { ...base, prompt: '镜头二（完全不同的一段话）' } })
    assert.equal(fetchCalls.length, 1, 'prompt 不影响价格，不该重报')
    await call('POST', { path: QUOTE_PATH, body: { ...base, duration: 5 } })
    assert.equal(fetchCalls.length, 2, '时长变了必须重报')
  } finally {
    restore()
    resetAll()
  }
})

test('quote：服务端 429 也回 200 + credits=null + error（不阻断提交）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
  try {
    fetchMode = 'quote-fail'
    const res = await call('POST', { path: QUOTE_PATH, body: { kind: 'audio', audioFn: 'music', duration: 30 } })
    assert.equal(res.status, 200, '报价失败不是 HTTP 失败（生成链 fail-open 依赖这条）')
    assert.equal(res.body.credits, null, 'null = 不知道，绝不能写成 0（0 是真实的价）')
    assert.equal(res.body.error.code, 'rate_limited')
  } finally {
    restore()
    resetAll()
  }
})

test('quote：未登录回 200 + unauthenticated（零请求，UI 显示「暂不可用」）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    const res = await call('POST', { path: QUOTE_PATH, body: { kind: 'image' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.credits, null)
    assert.equal(res.body.error.code, 'unauthenticated')
    assert.equal(fetchCalls.length, 0)
  } finally {
    restore()
    resetAll()
  }
})
