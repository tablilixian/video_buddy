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
import { installAccountState, notifyAuthSession, notifyAuthCleared, backoffMsOf } from '../lib/account-state.js'
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
