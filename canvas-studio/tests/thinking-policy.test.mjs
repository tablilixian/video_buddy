/**
 * 批 2-v2 + CV-457：动态思考强度策略（`src/thinking-policy.ts`，策略文档
 * `docs/plans/2026-11-08-动态思考强度-分层策略与实施.md` §4 v1 表）。
 *
 * 策略 v1 三条规则（证据：四场会话分相表）：
 *  1. `write_storyboard` 成功 ⇒ 压 low（spec 装配段，缺省档 50~100k 字符/步必爆）；
 *  2. 同名工具连续 2 次失败 ⇒ 升缺省（失败归因是判断类，低档躺平），5 个工具结果后有界降回；
 *  3. 用户基线 = 会话首条 header：`reasoningEffort: 'none'`（显式关思考）⇒ 策略完全不介入。
 *
 * **CV-457 写入机制（Session 21 实证修正）**：只 `session.append('model/selection')` 不生效——
 * 运行中 agent 的内存档位（`selectionFor().current` 的 picked）在 install 时一次性捕获。修复 =
 * 注入 applier 走 `agents.selectForNextRequest` 双写；applier 拒绝时回退 append（v1 行为）。
 * **开关默认 false**（用户拍板固定 low）——关闭时策略零介入。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  noteThinkingHeader,
  noteThinkingToolResult,
  noteStoryboardLandedForPolicy,
  resetThinkingPolicyForTests,
  setThinkingPolicyEnabled,
  setThinkingPolicySelectionApplier,
  THINKING_FAILURE_STREAK,
  THINKING_ESCALATION_WINDOW,
} from '../lib/thinking-policy.js'
import { noteIntentCard } from '../lib/spec-gate.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'
import { CanvasStudioConfig } from '../lib/host-config.js'

/** 等待 fire-and-forget 的 emit 链（applier 异步 + catch 回退）落定。 */
const flushEmit = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  resetThinkingPolicyForTests()
  setThinkingPolicyEnabled(true)
  setThinkingPolicySelectionApplier(undefined)
})

/**
 * 构造假会话（真实 Session 的最小形状：header.id + append）。
 * 事件收集器直接挂在 session 上返回——策略函数收的就是这个 session 本体。
 */
function fakeSession(id) {
  const events = []
  return {
    header: { id },
    append(type, data) { events.push({ type, data }) },
    events,
  }
}

/** 让策略拿到 provider/model（emit 前置：缺了静默跳过，见「缺 provider」条）。 */
function observeHeader(s, config = {}) {
  noteThinkingHeader(s, { provider: 'gateway-a', model: 'model-x', ...config })
}

/** 假 applier：记录 (sessionId, selection)，可注入拒绝行为。 */
function fakeApplier(reject = false) {
  const calls = []
  setThinkingPolicySelectionApplier(async (sessionId, selection) => {
    calls.push({ sessionId, selection })
    if (reject) throw new Error('agents 服务不可用')
  })
  return calls
}

const selectionEvents = (events) => events.filter((e) => e.type === 'model/selection')

test('config schema 默认 false：缺省装载下策略必不启动（默认值防线，变异靶）', () => {
  // schemery 包装：字段默认值读 dict.<field>.meta.default（volatile 包装非标准 zod，无 .parse）。
  assert.equal(CanvasStudioConfig.dict.thinkingPolicy.meta.default, false, 'schema 缺省必须显式为 false——改默认值此条必红')
})

test('开关默认关：策略零介入、applier 不被调（CV-457 用户拍板固定 low）', async () => {
  setThinkingPolicyEnabled(false)
  const calls = fakeApplier()
  const s = fakeSession('s-off')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s)
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_a', false)
  await flushEmit()
  assert.deepEqual(selectionEvents(s.events), [], '关闭时不得 append 任何事件')
  assert.deepEqual(calls, [], '关闭时不得调用 applier')
})

test('基线 none：首条 header 显式关思考 ⇒ 策略完全不介入', () => {
  const s = fakeSession('s-none')
  observeHeader(s, { reasoningEffort: 'none' })
  noteStoryboardLandedForPolicy(s)
  noteThinkingToolResult(s, 'render_composition', false)
  noteThinkingToolResult(s, 'render_composition', false)
  assert.deepEqual(selectionEvents(s.events), [], '用户显式关思考时不得发任何 model/selection')
})

test('基线只看首条 header：之后 header 换档不改基线', () => {
  const s = fakeSession('s-baseline')
  observeHeader(s, { reasoningEffort: 'none' })
  observeHeader(s, {}) // 后续 header 缺省 ≠ 用户改主意，基线仍 minimal
  noteStoryboardLandedForPolicy(s)
  assert.deepEqual(selectionEvents(s.events), [])
})

test('write_storyboard 成功 ⇒ 压 low；重复落地不重发（append 回退通道）', () => {
  const s = fakeSession('s-storyboard')
  observeHeader(s) // 缺省档
  noteStoryboardLandedForPolicy(s)
  noteStoryboardLandedForPolicy(s)
  assert.deepEqual(selectionEvents(s.events), [
    { type: 'model/selection', data: { provider: 'gateway-a', model: 'model-x', reasoningEffort: 'low' } },
  ])
})

test('header 已在 low：storyboard 成功不再发事件', () => {
  const s = fakeSession('s-already-low')
  observeHeader(s, { reasoningEffort: 'low' })
  noteStoryboardLandedForPolicy(s)
  assert.deepEqual(selectionEvents(s.events), [])
})

test('applier 通道：emit 走 selectForNextRequest 双写，策略不自己 append（CV-457 主修复）', async () => {
  const calls = fakeApplier()
  const s = fakeSession('s-applier')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s)
  await flushEmit()
  assert.deepEqual(calls, [
    { sessionId: 's-applier', selection: { provider: 'gateway-a', model: 'model-x', reasoningEffort: 'low' } },
  ], '必须经 applier（= agents.selectForNextRequest 双写）落档位')
  assert.deepEqual(selectionEvents(s.events), [], 'applier 在场时策略不得自己 append（上游内部 append，防双事件）')
})

test('applier 拒绝 ⇒ 回退 session.append（旧运行时不白跑）', async () => {
  fakeApplier(true)
  const s = fakeSession('s-fallback')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s)
  await flushEmit()
  assert.deepEqual(selectionEvents(s.events), [
    { type: 'model/selection', data: { provider: 'gateway-a', model: 'model-x', reasoningEffort: 'low' } },
  ], 'applier 抛错必须回退 append 通道')
})

test('pendingEmit 去重：emit 后 header None 不重置档位记忆（Session 21 双发循环回归锁）', async () => {
  const calls = fakeApplier()
  const s = fakeSession('s-pending')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s)
  await flushEmit()
  assert.equal(calls.length, 1)
  // emit low → 下一条 header 无 effort（旧值缺省快照）：不得抹掉 lastEffort
  observeHeader(s, {})
  noteStoryboardLandedForPolicy(s)
  await flushEmit()
  assert.equal(calls.length, 1, 'pendingEmit 未确认前重复 storyboard 不重发')
  // header 确认 low → pendingEmit 清；此后 header 无 effort = 真缺省 → 允许重新发
  observeHeader(s, { reasoningEffort: 'low' })
  observeHeader(s, {})
  noteStoryboardLandedForPolicy(s)
  await flushEmit()
  assert.equal(calls.length, 2, '确认后档位记忆解除，缺省下重新压 low')
})

test(`同名连续 ${THINKING_FAILURE_STREAK} 次失败 ⇒ 升缺省（不带 reasoningEffort 字段）；换名打断连击`, () => {
  const s = fakeSession('s-escalate')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s) // 先进 low
  // 换名失败不打断也不误升：A 失败 → B 失败 → A 失败 → B 失败，连击两次被清
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_b', false)
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_b', false)
  assert.deepEqual(selectionEvents(s.events).length, 1, '连击被换名打断，不升级')
  // 同名连续 2 次 ⇒ 升缺省
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_a', false)
  const escalated = selectionEvents(s.events)[1]
  assert.ok(escalated, '连击达标必须升级')
  assert.deepEqual(escalated.data, { provider: 'gateway-a', model: 'model-x' }, '升缺省 = 回删档位，不带 reasoningEffort')
  // 已在缺省（无更重档）：继续失败不再发
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_a', false)
  assert.equal(selectionEvents(s.events).length, 2)
})

test(`升级窗口：第 ${THINKING_ESCALATION_WINDOW} 个成功结果才降回 low，期间不重发`, () => {
  const s = fakeSession('s-window')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s) // low（事件 1）
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_a', false) // 升缺省（事件 2）
  for (let i = 1; i < THINKING_ESCALATION_WINDOW; i += 1) {
    noteThinkingToolResult(s, 'tool_a', true)
  }
  assert.equal(selectionEvents(s.events).length, 2, '窗口内不发')
  noteThinkingToolResult(s, 'tool_a', true)
  const back = selectionEvents(s.events)[2]
  assert.ok(back, '满窗必须降回')
  assert.equal(back.data.reasoningEffort, 'low')
  // 降回后成功不再计数、不再发
  noteThinkingToolResult(s, 'tool_a', true)
  assert.equal(selectionEvents(s.events).length, 3)
})

test('provider/model 缺失：emit 静默跳过（不发半截事件）', () => {
  const s = fakeSession('s-no-provider')
  noteThinkingHeader(s, { reasoningEffort: undefined }) // 无 provider/model
  noteStoryboardLandedForPolicy(s)
  noteThinkingToolResult(s, 'tool_a', false)
  noteThinkingToolResult(s, 'tool_a', false)
  assert.deepEqual(selectionEvents(s.events), [])
})

test('接线：wrap 成功路径记账 + write_storyboard 落地触发；失败路径连击升级（删接线即红）', async () => {
  const s = fakeSession('s-wire')
  observeHeader(s) // 生产前置：request/header 事件先观测
  const exec = { agent: { session: s } }
  noteIntentCard(s.header.id) // spec-gate 前置：write_storyboard 要求先 confirm_intent_card

  const storyboard = wrapStudioToolDefinition({
    name: 'write_storyboard',
    execute: async () => ({ ok: true }),
  })
  await storyboard.execute({}, exec)
  assert.deepEqual(selectionEvents(s.events), [
    { type: 'model/selection', data: { provider: 'gateway-a', model: 'model-x', reasoningEffort: 'low' } },
  ], 'write_storyboard 成功必须经包装层触发压 low')

  const failing = wrapStudioToolDefinition({
    name: 'render_composition',
    execute: async () => {
      throw new Error('boom')
    },
  })
  await assert.rejects(() => failing.execute({}, exec))
  await assert.rejects(() => failing.execute({}, exec))
  const escalated = selectionEvents(s.events)[1]
  assert.ok(escalated, '包装层失败路径必须记账并触发升级')
  assert.deepEqual(escalated.data, { provider: 'gateway-a', model: 'model-x' })
})
