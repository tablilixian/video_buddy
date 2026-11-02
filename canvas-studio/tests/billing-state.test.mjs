/**
 * 计费编排单测（`src/billing-state.ts`，方案 20261102 P2）。
 *
 * 覆盖的是**状态机纪律**，不是请求格式：
 *   - 读取永不抛，失败进 `error` 且**保留上一次成功的快照**（上游 GET 就是这么约定的）；
 *   - TTL 15s 内零请求，`force` 绕 TTL；
 *   - 在飞去重（并发两次只发一个请求）；
 *   - 403 置禁用并停手；401 **不**禁用（等 client 重推 token）；
 *   - pending_checkout 是 omitempty：没有时 view 里**不能出现这个 key**（要区分 null）；
 *   - 写动作的本地校验先于网络（未登录 / 非法幂等键 / 非法 kind 一律零请求）；
 *   - 登出（resetBilling）清空全部状态，含禁用位。
 *
 * 网络层 stub 全局 fetch（`DramaClient` 默认取它），模块级单例用 resetBilling 复位。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  installBillingState, refreshBilling, billingView, resetBilling,
  createBillingCheckout, createBillingPortalSession,
} from '../lib/billing-state.js'
import { setAuthSession, clearAuthSession } from '../lib/auth-session.js'
import { ApiError } from '../lib/drama-management.js'

const overview = {
  subscription: null,
  credits: { currency: 'credit', available_balance: 223.6111, frozen_balance: 0 },
  plans: [
    { code: 'starter_monthly', name: 'Starter', billing_period: 'month', price_cents: 1000, currency: 'USD', period_credits: 1000, entitlements: { concurrent_generations: 2 }, purchasable: true },
    { code: 'creator_monthly', name: 'Plus', billing_period: 'month', price_cents: 5000, currency: 'USD', period_credits: 5500, entitlements: { concurrent_generations: 5 }, purchasable: true },
  ],
  credit_packs: [
    { code: 'pack_starter', name: 'Starter Pack', price_cents: 1000, currency: 'USD', credit_amount: 1000, purchasable: true },
  ],
}

/** 简单 stub：按 mode 返回不同响应，记录每次调用。 */
let calls = []
let mode = 'ok'

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body })
    if (mode === '403') return json(403, { error: { code: 'permission_denied', message: '账号被禁用' } })
    if (mode === '401') return json(401, { error: { code: 'unauthenticated', message: 'token 过期' } })
    if (mode === '503') return json(503, { error: { code: 'unavailable', message: '支付服务不可用' } })
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

function install(enabled = true) {
  installBillingState({
    enabled: () => enabled,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
  })
}

function reset() {
  clearAuthSession()
  resetBilling()
  calls = []
  mode = 'ok'
}

test('读取：未登录零请求，view 仍是完整形状（不是 null）', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    await refreshBilling(true)
    const view = billingView()
    assert.equal(view.signedIn, false)
    assert.equal(view.enabled, true)
    assert.equal(view.credits, null, '未登录时余额是 null，不是 0')
    assert.equal(view.fetchedAt, null)
    assert.deepEqual(view.plans, [], '没读到过时目录是空数组（UI 用 error 表达「读不到」）')
    assert.equal(calls.length, 0, '没有会话就不该打上游')
  } finally {
    restore()
    reset()
  }
})

test('读取：成功快照 + TTL 内零请求 + force 绕 TTL', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await refreshBilling(false)
    assert.equal(calls.length, 1)
    const view = billingView()
    assert.equal(view.credits.available_balance, 223.6111)
    assert.equal(view.plans.length, 2)
    assert.ok(typeof view.fetchedAt === 'string')
    assert.equal(view.error, null)
    // omitempty：没有待支付时这个 key 必须**不存在**。
    assert.equal('pending_checkout' in view, false, 'pending_checkout 是 omitempty，不能强行挂 null')

    await refreshBilling(false)
    assert.equal(calls.length, 1, 'TTL 内第二次读不吃网络')
    await refreshBilling(true)
    assert.equal(calls.length, 2, 'force 绕 TTL')
  } finally {
    restore()
    reset()
  }
})

test('读取：在飞去重（并发两次只有一个请求）', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await Promise.all([refreshBilling(true), refreshBilling(true)])
    assert.equal(calls.length, 1)
  } finally {
    restore()
    reset()
  }
})

test('读取：失败不抛、写 error、**保留旧快照**', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await refreshBilling(true)
    const before = billingView().credits.available_balance
    mode = '503'
    await refreshBilling(true) // 不抛
    const view = billingView()
    assert.equal(view.error.code, 'unavailable')
    assert.equal(view.error.status, 503)
    assert.equal(view.credits.available_balance, before, '读失败要保留旧数字（不能跳成 0/空）')
    assert.equal(view.plans.length, 2, '目录也保留')
  } finally {
    restore()
    reset()
  }
})

test('读取：403 置禁用并停手（后续请求零网络）；401 不禁用', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    mode = '401'
    await refreshBilling(true)
    assert.equal(billingView().disabled, false, '401 是「等 client 重推 token」，不该禁用')

    mode = '403'
    await refreshBilling(true)
    assert.equal(billingView().disabled, true, '403 必须置禁用')
    const after = calls.length
    await refreshBilling(true)
    assert.equal(calls.length, after, '禁用后不再发计费请求')
  } finally {
    restore()
    reset()
  }
})

test('写：未登录 / 非法幂等键 / 非法 kind 都在本地拦（零请求）', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    await assert.rejects(() => createBillingCheckout({ kind: 'plan', product_code: 'x' }, 'k'), (cause) => {
      assert.ok(cause instanceof ApiError)
      assert.equal(cause.status, 401, '未登录先拦')
      return true
    })
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await assert.rejects(() => createBillingCheckout({ kind: 'plan', product_code: 'x' }, 'has space'), (cause) => {
      assert.equal(cause.code, 'invalid_argument')
      assert.equal(cause.status, 400)
      return true
    })
    await assert.rejects(() => createBillingCheckout({ kind: 'nope', product_code: 'x' }, 'k-1'), (cause) => {
      assert.equal(cause.code, 'invalid_argument')
      return true
    })
    await assert.rejects(() => createBillingCheckout({ kind: 'plan', product_code: '' }, 'k-1'), (cause) => {
      assert.equal(cause.code, 'invalid_argument')
      return true
    })
    assert.equal(calls.length, 0, '本地校验失败不该打上游')
  } finally {
    restore()
    reset()
  }
})

test('写：checkout 成功返回已校验 URL；请求体只带 kind + product_code', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const session = await createBillingCheckout({ kind: 'credit_pack', product_code: 'pack_starter' }, 'key-1')
    assert.equal(session.checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_1')
    const call = calls.at(-1)
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['Idempotency-Key'], 'key-1', '幂等键必须走请求头')
    assert.deepEqual(JSON.parse(call.body), { kind: 'credit_pack', product_code: 'pack_starter' },
      '请求体只允许 kind + product_code（金额由服务端定）')
    // 下单成功要作废本地快照：pending_checkout 已经变了。
    assert.equal(billingView().fetchedAt, null)
  } finally {
    restore()
    reset()
  }
})

test('写：portal 成功返回 URL；409 portal_unavailable 原样抛给调用方分派', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    const session = await createBillingPortalSession()
    assert.equal(session.portal_url, 'https://billing.stripe.com/p/session/test_1')

    // 上游把 portal_unavailable 放在 error.code 里，status 409。
    globalThis.fetch = async (url) => {
      calls.push({ url: String(url) })
      return json(409, { error: { code: 'portal_unavailable', message: 'subscription management is unavailable' } })
    }
    await assert.rejects(() => createBillingPortalSession(), (cause) => {
      assert.equal(cause.code, 'portal_unavailable')
      assert.equal(cause.status, 409)
      return true
    })
  } finally {
    restore()
    reset()
  }
})

test('写：不可信 URL 被拦成 invalid_response（502），不交给渲染层', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    globalThis.fetch = async () => json(201, {
      order_id: 'o-1', order_no: 'RB1', checkout_session_id: 'cs_1',
      checkout_url: 'https://attacker.test/pay', expires_at: null,
    })
    await assert.rejects(() => createBillingCheckout({ kind: 'plan', product_code: 'p' }, 'k-1'), (cause) => {
      assert.equal(cause.code, 'invalid_response')
      assert.equal(cause.status, 502)
      return true
    })
  } finally {
    restore()
    reset()
  }
})

test('resetBilling：登出清空快照、禁用位与错误', async () => {
  reset()
  const restore = stubFetch()
  try {
    install()
    setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })
    await refreshBilling(true)
    mode = '403'
    await refreshBilling(true)
    assert.equal(billingView().disabled, true)
    resetBilling()
    const view = billingView()
    assert.equal(view.credits, null, '登出后不能留着上个账号的余额/套餐')
    assert.equal(view.disabled, false, '禁用位一起清（重新登录是新的判定）')
    assert.equal(view.error, null)
    assert.equal(view.fetchedAt, null)
  } finally {
    restore()
    reset()
  }
})
