/**
 * 管理面账号编排单测（src/account-state.ts，方案 P2/CV-356）。
 *
 * 覆盖：bootstrap 幂等（同 token + TTL 内不重打）、401 静默、429 按 Retry-After
 * 推迟（窗口内零请求但凭据发布照做）、403 置禁用、未启用闸零请求、reset 语义。
 * 网络层 stub 全局 fetch（DramaClient 默认取全局 fetch），模块级单例状态用
 * notifyAuthCleared 在用例间复位。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installAccountState, notifyAuthSession, notifyAuthCleared, backoffMsOf,
  refreshCredits, creditsView, markCreditsStale,
} from '../lib/account-state.js'
import { setAuthSession, clearAuthSession } from '../lib/auth-session.js'
import { ApiError } from '../lib/drama-management.js'
import { DeviceRegistry } from '../lib/device-registry.js'

/** 等待条件成立（轮询，最多 500ms）——bootstrap 是 fire-and-forget，无 promise 可等。 */
async function waitFor(predicate, what) {
  const deadline = Date.now() + 500
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(predicate(), `等待超时：${what}`)
}

/** stub 全局 fetch，返回调用记录；restore 交还调用方。 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(url, init, calls)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const syncOk = { user: { id: 'u-1', status: 'active' }, device: null }
const modelsOk = {
  models: [{ id: '1', code: 'deepseek-flash', display_name: 'DeepSeek Flash', modality: 'text', capabilities: {}, entitled: true, available: true, endpoints: null }],
  entitlement: { features: {} },
}

test('backoffMsOf：429 听 Retry-After、503 固定兜底、其余不退避', () => {
  assert.equal(backoffMsOf(new ApiError('rate', 'x', 429, 30)), 30_000)
  assert.equal(backoffMsOf(new ApiError('rate', 'x', 429, null)), 30_000)
  assert.equal(backoffMsOf(new ApiError('busy', 'x', 503, null)), 30_000)
  assert.equal(backoffMsOf(new ApiError('oops', 'x', 500, null)), 0)
})

test('bootstrap：成功一次完成 sync+models+回调；同 token TTL 内幂等零请求', async () => {
  notifyAuthCleared()
  const events = { tokens: [], catalogs: [] }
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: (token) => { events.tokens.push(token) },
    onCatalogChanged: (models, base) => { events.catalogs.push({ count: models.length, base }) },
  })
  const stub = stubFetch(async (url) => new Response(JSON.stringify(
    String(url).includes('/v1/models') ? modelsOk : syncOk,
  ), { status: 200, headers: { 'content-type': 'application/json' } }))
  try {
    notifyAuthSession('tok-1')
    await waitFor(() => stub.calls.length >= 2, 'sync + models')
    await waitFor(() => events.catalogs.length === 1, 'catalog 回调')
    assert.equal(events.catalogs[0].count, 1)
    assert.equal(events.catalogs[0].base, 'http://business.test')
    assert.ok(events.tokens.includes('tok-1'))
    // device 全量字段随 sync 发出。
    const syncCall = stub.calls.find((c) => String(c.url).includes('/v1/auth/sync'))
    assert.deepEqual(JSON.parse(syncCall.init.body).device.device_id, 'dev-1')

    // 同 token 再推（TTL 内）：只发布凭据，零新请求。
    const before = stub.calls.length
    notifyAuthSession('tok-1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(stub.calls.length, before)
    assert.ok(events.tokens.filter((t) => t === 'tok-1').length >= 2)
  } finally {
    stub.restore()
    notifyAuthCleared()
  }
})

test('bootstrap：device 传真 DeviceRegistry 实例也不丢 this（#私有成员回归守卫）', async () => {
  notifyAuthCleared()
  const events = { catalogs: 0, deviceIds: [] }
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    // 真 registry：deviceId() 读 #私有成员 —— 裸方法引用会让这条测试当场爆
    // 「Cannot read private member #deviceId」（2026-10-22 桌面实测的根因）。
    device: new DeviceRegistry(join(tmpdir(), 'cs-acct-state-test'), '9.9.9'),
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: (models) => { events.catalogs = models.length; events.deviceIds.push('done') },
  })
  const stub = stubFetch(async (url, init) => {
    if (String(url).includes('/v1/auth/sync')) {
      events.deviceIds.push(JSON.parse(init.body).device.device_id)
    }
    return new Response(JSON.stringify(
      String(url).includes('/v1/models') ? modelsOk : syncOk,
    ), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  try {
    notifyAuthSession('tok-registry')
    await waitFor(() => events.catalogs > 0, 'bootstrap 完成')
    const expected = new DeviceRegistry(join(tmpdir(), 'cs-acct-state-test'), '9.9.9').deviceId() // 同目录 → 同一 id
    assert.equal(events.deviceIds[0], expected)
  } finally {
    stub.restore()
    notifyAuthCleared()
    rmSync(join(tmpdir(), 'cs-acct-state-test'), { recursive: true, force: true })
  }
})

test('401：静默不重试、不置退避、不改目录', async () => {
  notifyAuthCleared()
  const catalogs = []
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: (models) => { catalogs.push(models.length) },
  })
  const stub = stubFetch(async () => new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'expired' } }), { status: 401 }))
  try {
    notifyAuthSession('expired-token')
    await waitFor(() => stub.calls.length >= 1, 'sync 请求发生')
    await new Promise((resolve) => setTimeout(resolve, 30))
    // sync 401 → 直接放弃：不会有 models 请求，也不会有目录回调。
    assert.equal(stub.calls.filter((c) => String(c.url).includes('/v1/models')).length, 0)
    assert.equal(catalogs.length, 0)
  } finally {
    stub.restore()
    notifyAuthCleared()
  }
})

test('429：Retry-After 窗口内零请求，凭据发布照做；窗口外恢复', async () => {
  notifyAuthCleared()
  const tokens = []
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: (token) => { tokens.push(token) },
    onCatalogChanged: () => {},
  })
  let rateLimited = true
  const stub = stubFetch(async (url) => {
    if (String(url).includes('/v1/models')) {
      return rateLimited
        ? new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), { status: 429, headers: { 'Retry-After': '1' } })
        : new Response(JSON.stringify(modelsOk), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify(syncOk), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  try {
    notifyAuthSession('tok-rl')
    await waitFor(() => stub.calls.some((c) => String(c.url).includes('/v1/models')), 'models 首次请求')
    // 退避窗口内再推：零新请求，凭据发布照做。
    const before = stub.calls.length
    notifyAuthSession('tok-rl-2')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(stub.calls.length, before)
    assert.ok(tokens.includes('tok-rl-2'))
  } finally {
    stub.restore()
    notifyAuthCleared()
  }
})

test('403：置禁用态，后续推送零请求；reset 解除', async () => {
  notifyAuthCleared()
  let requests = 0
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
  })
  const stub = stubFetch(async () => {
    requests += 1
    return new Response(JSON.stringify({ error: { code: 'account_disabled', message: '禁用' } }), { status: 403 })
  })
  try {
    notifyAuthSession('tok-banned')
    await waitFor(() => requests >= 1, '首次请求')
    await new Promise((resolve) => setTimeout(resolve, 30))
    notifyAuthSession('tok-banned-2')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(requests, 1) // 禁用后零请求
  } finally {
    stub.restore()
    notifyAuthCleared() // reset 解除禁用
  }
})

test('未启用闸（businessApiBase/supabaseUrl 空）：零请求', async () => {
  notifyAuthCleared()
  let requests = 0
  installAccountState({
    enabled: () => false,
    businessApiBase: () => '',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
  })
  const stub = stubFetch(async () => {
    requests += 1
    return new Response(JSON.stringify(syncOk), { status: 200 })
  })
  try {
    notifyAuthSession('tok-off')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(requests, 0)
  } finally {
    stub.restore()
    notifyAuthCleared()
  }
})

// ── CV-358：余额（credits）───────────────────────────────────────────────────
//
// 这一组锁的是「什么时候发请求」与「失败时数字怎么处置」——两件事都会直接变成
// 用户可见的错误（余额莫名空白 / 读失败显示成 0）。token 一律经 auth-session 的
// 会话缓存取，所以每个用例都要显式登录，不能靠 `notifyAuthSession` 的入参。

const balanceOk = { currency: 'CNY', available_balance: 12.3456, frozen_balance: 0.5, lots: null }

/** 装一套可用的 deps；`warns` 收日志便于断言。 */
function installCreditsDeps(overrides = {}) {
  const warns = []
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn: (message) => { warns.push(message) } },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
    ...overrides,
  })
  return warns
}

function signIn(token = 'tok-credits') {
  setAuthSession({ accessToken: token, expiresAt: null, userId: 'u-1', email: null })
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function errorResponse(code, status) {
  return jsonResponse({ error: { code, message: `模拟错误 ${code}` } }, status)
}

/** 每个用例的统一复位：清会话 + 清编排与余额状态。 */
function resetAll() {
  clearAuthSession()
  notifyAuthCleared()
}

test('credits：未登录零请求（视图 signedIn=false，余额为 null 而不是 0）', async () => {
  resetAll()
  installCreditsDeps()
  const stub = stubFetch(async () => jsonResponse(balanceOk))
  try {
    await refreshCredits(true)
    assert.equal(stub.calls.length, 0, '没有会话就不该打管理面')
    const view = creditsView()
    assert.equal(view.signedIn, false)
    assert.equal(view.balance, null)
    assert.equal(view.fetchedAt, null)
  } finally {
    stub.restore()
    resetAll()
  }
})

test('credits：force 打一次、TTL 内复用缓存、force 再穿透', async () => {
  resetAll()
  installCreditsDeps()
  signIn()
  const stub = stubFetch(async () => jsonResponse(balanceOk))
  try {
    await refreshCredits(true)
    assert.equal(stub.calls.length, 1)
    assert.ok(String(stub.calls[0].url).endsWith('/v1/credits/balance'), '打的是余额接口')
    assert.equal(
      String(stub.calls[0].init.headers.Authorization ?? stub.calls[0].init.headers.authorization),
      'Bearer tok-credits',
      'Bearer 头来自会话缓存',
    )
    const view = creditsView()
    assert.equal(view.balance.available_balance, 12.3456, '四位小数原样保留，不截断')
    assert.equal(view.balance.frozen_balance, 0.5)
    assert.ok(view.fetchedAt !== null, 'fetchedAt 必须落下来（UI 要显示更新时间）')

    await refreshCredits(false)
    assert.equal(stub.calls.length, 1, 'TTL 内的普通读取零请求')

    await refreshCredits(true)
    assert.equal(stub.calls.length, 2, 'force 绕 TTL')
  } finally {
    stub.restore()
    resetAll()
  }
})

test('credits：并发两次只发一个请求（在飞去重）', async () => {
  resetAll()
  installCreditsDeps()
  signIn()
  const stub = stubFetch(async () => jsonResponse(balanceOk))
  try {
    await Promise.all([refreshCredits(true), refreshCredits(true)])
    assert.equal(stub.calls.length, 1)
  } finally {
    stub.restore()
    resetAll()
  }
})

test('credits：403 置禁用态且后续不再请求（与 bootstrap 同一禁用语义）', async () => {
  resetAll()
  installCreditsDeps()
  signIn()
  const stub = stubFetch(async () => errorResponse('account_disabled', 403))
  try {
    await refreshCredits(true)
    assert.equal(stub.calls.length, 1)
    const view = creditsView()
    assert.equal(view.disabled, true)
    assert.equal(view.error.code, 'account_disabled')
    await refreshCredits(true)
    assert.equal(stub.calls.length, 1, '账号受限后不再打业务接口')
  } finally {
    stub.restore()
    resetAll()
  }
})

test('credits：429/503 不写退避 —— 保留旧值、下一次仍会请求', async () => {
  resetAll()
  installCreditsDeps()
  signIn()
  let mode = 'ok'
  const stub = stubFetch(async () => (mode === 'ok' ? jsonResponse(balanceOk) : errorResponse('rate_limited', 429)))
  try {
    await refreshCredits(true)
    assert.equal(creditsView().balance.available_balance, 12.3456)

    mode = 'busy'
    await refreshCredits(true)
    assert.equal(creditsView().balance.available_balance, 12.3456, '读失败必须保留旧值（清成 0 会吓人）')
    assert.equal(creditsView().error.code, 'rate_limited')
    assert.equal(stub.calls.length, 2)

    mode = 'ok'
    await refreshCredits(true)
    assert.equal(stub.calls.length, 3, '余额是主动刷新语义：429 不写退避窗口，点了就发')
    assert.equal(creditsView().error, null, '读成功要清掉上一次的错误')
  } finally {
    stub.restore()
    resetAll()
  }
})

test('credits：markCreditsStale 让 TTL 内的普通读取重新走网络', async () => {
  resetAll()
  installCreditsDeps()
  signIn()
  const stub = stubFetch(async () => jsonResponse(balanceOk))
  try {
    await refreshCredits(true)
    await refreshCredits(false)
    assert.equal(stub.calls.length, 1, '前置：TTL 内本应零请求')
    markCreditsStale()
    await refreshCredits(false)
    assert.equal(stub.calls.length, 2, '生成结束后被标记陈旧 ⇒ 下一次读取必须走网络')
    assert.ok(creditsView().fetchedAt !== null, '陈旧标志不污染 updatedAt 的展示')
  } finally {
    stub.restore()
    resetAll()
  }
})

test('credits：会话清除即清空余额（登出后不得残留上一个账号的钱）', async () => {
  resetAll()
  installCreditsDeps()
  signIn()
  const stub = stubFetch(async () => jsonResponse(balanceOk))
  try {
    await refreshCredits(true)
    assert.equal(creditsView().balance.available_balance, 12.3456)
    resetAll()
    const view = creditsView()
    assert.equal(view.balance, null)
    assert.equal(view.signedIn, false)
    assert.equal(view.fetchedAt, null)
    assert.equal(view.error, null)
  } finally {
    stub.restore()
  }
})
