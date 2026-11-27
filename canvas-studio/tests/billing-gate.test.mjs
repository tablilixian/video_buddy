/**
 * 计费拦截（G1 余额闸 + B4 quote 硬闸）——行为守卫（2026-11-27 审查 P0-1/P1-6）。
 *
 * 钉四件事：
 * 1. **纯判定**：`billableBalanceVerdict` / `quoteOverBalanceVerdict` 的 fail-open 边界
 *    （null 余额、NaN、刚好够、预估失败）逐条锁死；
 * 2. **契约名单**：`BILLING_TOOL_NAMES` 与「实际会走带报价生成链的工具」集合相等——
 *    新增消耗型工具不登记即红（反向变异靶：从集合删一个名字必须红）；
 * 3. **接线行为**（不看源码文本）：`wrapStudioToolDefinition` 对消耗型工具在
 *    `execute` **之前**抛 CS-BILL-001 —— 断言 execute spy **零调用**（拒收先于副作用）；
 *    非消耗型工具（upload_image 一类）余额为 0 照常放行；
 * 4. **B4 共用实现**：`assertQuoteWithinBalance` 抛 CS-BILL-002（图像与 video 车道
 *    共用的那一个）。
 *
 * 反向变异验证（改完必须恢复）：
 * - 注释掉 `tool-error-boundary.ts` wrap 里的 `assertBillableBalance()` 行 → 用例 3 全红；
 * - 从 `BILLING_TOOL_NAMES` 删掉 `video_generate` → 契约名单用例红。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BILLING_TOOL_NAMES,
  assertBillableBalance,
  assertQuoteWithinBalance,
  billableBalanceVerdict,
  isBillingTool,
  quoteOverBalanceVerdict,
} from '../lib/billing-gate.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'
import {
  installAccountState, notifyAuthCleared, refreshCredits,
} from '../lib/account-state.js'
import { setAuthSession, clearAuthSession, setDramaAuthRequired } from '../lib/auth-session.js'

// ── 夹具 ─────────────────────────────────────────────────────────────────────

const balanceOf = (available, frozen = 0, currency = 'CNY') => ({
  available_balance: available, frozen_balance: frozen, currency, lots: null,
})

function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(url, init, calls)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

function installCreditsDeps() {
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
  })
}

function signIn(token = 'tok-billing') {
  setAuthSession({ accessToken: token, expiresAt: null, userId: 'u-1', email: null })
}

function resetAll() {
  clearAuthSession()
  notifyAuthCleared()
  setDramaAuthRequired(false)
}

/** 把余额灌进 account-state 缓存（真打 stub 过 refreshCredits，与生产同路径）。 */
async function seedBalance(available) {
  installCreditsDeps()
  signIn()
  const stub = stubFetch(async () => new Response(JSON.stringify(balanceOf(available)), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  try {
    await refreshCredits(true)
    assert.equal(stub.calls.length, 1, '余额必须真的从接口读一次')
  } finally {
    stub.restore()
  }
}

/** 最小工具定义（wrapStudioToolDefinition 只吃 name/parameters/execute 三件）。 */
function fakeTool(name, execute) {
  return {
    name,
    description: 'billing-gate 测试工具',
    parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    output: { schema: { type: 'object' }, render: () => [] },
    execute,
  }
}

/** 执行一条 wrap 过的工具，返回 `{ ok, code, executed }`。 */
async function callWrapped(name) {
  let executed = 0
  const wrapped = wrapStudioToolDefinition(fakeTool(name, async () => {
    executed += 1
    return { ok: true }
  }))
  try {
    await wrapped.execute({ prompt: 'hi' }, {})
    return { ok: true, code: null, executed }
  } catch (cause) {
    return { ok: false, code: cause?.code ?? null, executed, cause }
  }
}

// ── 1. 纯判定 ────────────────────────────────────────────────────────────────

test('billableBalanceVerdict：只拦「确定读到余额 ≤ 0」，其余 fail-open', () => {
  assert.equal(billableBalanceVerdict(null), null, '从未读到 / 未登录 ⇒ 放行')
  assert.equal(billableBalanceVerdict(balanceOf(1)), null, '余额 > 0 ⇒ 放行')
  assert.equal(billableBalanceVerdict(balanceOf(0.0001)), null, '一厘钱也是钱，放行')
  assert.equal(billableBalanceVerdict(balanceOf(NaN)), null, '服务端字段异常不归用户承担')
  assert.equal(billableBalanceVerdict(balanceOf(Infinity)), null, '同上')

  const zero = billableBalanceVerdict(balanceOf(0, 5))
  assert.deepEqual(zero, { balance: '0', frozen: '5', currency: 'CNY' }, '余额归零必须拦')
  const negative = billableBalanceVerdict(balanceOf(-3.5))
  assert.equal(negative.balance, '-3', '欠费同样拦（formatCredits 截整显示）')
})

test('quoteOverBalanceVerdict：预估 > 余额才拦；刚好够 / 报价失败一律放行', () => {
  assert.equal(quoteOverBalanceVerdict(null, balanceOf(10)), null, '报价 fail-open：最终以创建响应为准')
  assert.equal(quoteOverBalanceVerdict(5, null), null, '余额读不到 ⇒ 放行')
  assert.equal(quoteOverBalanceVerdict(5, balanceOf(10)), null, '预估 < 余额 ⇒ 放行')
  assert.equal(quoteOverBalanceVerdict(10, balanceOf(10)), null, '刚好够必须放行（严格大于才拦）')
  assert.equal(quoteOverBalanceVerdict(5, balanceOf(NaN)), null, '余额异常 ⇒ 放行')

  const over = quoteOverBalanceVerdict(21.1354, balanceOf(10))
  assert.deepEqual(over, { estimated: '21.1354', available: '10' }, '预估超余额必须拦，四位小数展示')
})

// ── 2. 契约名单 ──────────────────────────────────────────────────────────────

test('BILLING_TOOL_NAMES 契约名单：新增消耗型工具必须登记，删名字即红', () => {
  const expected = [
    'image_generate', 'image_generate_withtxt',
    'character_generate', 'character_sheet',
    'video_generate', 'video_composite', 'video_rerender',
    'music_generation', 'tts_voiceover', 'tts_narration',
    'image2vl', 'video2vl', 'asr2txt',
  ]
  assert.deepEqual([...BILLING_TOOL_NAMES].sort(), [...expected].sort(),
    '消耗型工具名单变了？先想清楚这工具花不花积分，再同时改这里与 billing-gate.ts')
  assert.equal(isBillingTool('upload_image'), false, '上传参考图不花积分，不能被余额拦')
  assert.equal(isBillingTool('look_card'), false, 'look_card 只登记不生成')
  assert.equal(isBillingTool('render_composition'), false, '本地渲染不走业务生成链')
  assert.equal(isBillingTool('image2vl'), true, 'VL 价目表有真价（4 分 flat），是消耗型')
})

// ── 3. 接线行为：wrap execute 前置拦 G1 ──────────────────────────────────────

test('wrap 接线：余额为 0 ⇒ 消耗型工具抛 CS-BILL-001 且 execute 零调用', async () => {
  resetAll()
  try {
    setDramaAuthRequired(true)
    await seedBalance(0)
    const result = await callWrapped('video_generate')
    assert.equal(result.ok, false, '余额见底必须拦')
    assert.equal(result.code, 'CS-BILL-001')
    assert.equal(result.executed, 0, '拒收先于 execute —— 一次生成都不该发起（反向变异靶）')
  } finally {
    resetAll()
  }
})

test('wrap 接线：余额为 0 ⇒ 非消耗型工具照常放行（上传不该被余额拦）', async () => {
  resetAll()
  try {
    setDramaAuthRequired(true)
    await seedBalance(0)
    const result = await callWrapped('upload_image')
    assert.equal(result.ok, true, '「上传参考图本身不花积分」——余额 0 也要能传')
    assert.equal(result.executed, 1)
  } finally {
    resetAll()
  }
})

test('wrap 接线：余额 > 0 ⇒ 消耗型工具正常进 execute', async () => {
  resetAll()
  try {
    setDramaAuthRequired(true)
    await seedBalance(7.5)
    const result = await callWrapped('image_generate')
    assert.equal(result.ok, true)
    assert.equal(result.executed, 1)
  } finally {
    resetAll()
  }
})

test('wrap 接线：本地模式（鉴权开关关闭）不设闸', async () => {
  resetAll()
  try {
    setDramaAuthRequired(false)
    // 即使余额缓存里是 0 —— 本地模式没有钱包，门禁无从判起。
    await seedBalance(0)
    const result = await callWrapped('video_generate')
    assert.equal(result.ok, true, '本地模式放行')
    assert.equal(result.executed, 1)
  } finally {
    resetAll()
  }
})

// ── 4. B4 共用实现 ───────────────────────────────────────────────────────────

test('assertQuoteWithinBalance：预估超余额抛 CS-BILL-002，其余放行', async () => {
  resetAll()
  try {
    setDramaAuthRequired(true)
    await seedBalance(10)
    assert.doesNotThrow(() => assertQuoteWithinBalance(10), '刚好够放行')
    assert.doesNotThrow(() => assertQuoteWithinBalance(null), '报价 fail-open')
    try {
      assertQuoteWithinBalance(30)
      assert.fail('预估 30 > 余额 10 必须抛')
    } catch (cause) {
      assert.equal(cause?.code, 'CS-BILL-002', `抛的是 CanvasStudioError（.code），实际：${String(cause)}`)
    }
  } finally {
    resetAll()
  }
})
