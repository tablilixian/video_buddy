/**
 * 批 2-v2：动态思考强度策略（`src/thinking-policy.ts`，策略文档
 * `docs/plans/2026-11-08-动态思考强度-分层策略与实施.md` §4 v1 表）。
 *
 * 策略 v1 三条规则（证据：四场会话分相表）：
 *  1. `write_storyboard` 成功 ⇒ 压 low（spec 装配段，缺省档 50~100k 字符/步必爆）；
 *  2. 同名工具连续 2 次失败 ⇒ 升缺省（失败归因是判断类，低档躺平），5 个工具结果后有界降回；
 *  3. 用户基线 = 会话首条 header：`reasoningEffort: 'none'`（显式关思考）⇒ 策略完全不介入。
 *
 * 写入机制：emit = `session.append('model/selection', {provider, model, reasoningEffort?})`
 * ——缺省档**不带** reasoningEffort 字段（删档位 = 回缺省，不是发 'default'）。
 * 另外档位未变不重发（header 快照已在目标档时 emit 是 no-op）。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  noteThinkingHeader,
  noteThinkingToolResult,
  noteStoryboardLandedForPolicy,
  resetThinkingPolicyForTests,
  THINKING_FAILURE_STREAK,
  THINKING_ESCALATION_WINDOW,
} from '../lib/thinking-policy.js'
import { noteIntentCard } from '../lib/spec-gate.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'

beforeEach(() => resetThinkingPolicyForTests())

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

/** 让策略拿到 provider/model（emit 前置：缺了静默跳过，见第 6 条）。 */
function observeHeader(s, config = {}) {
  noteThinkingHeader(s, { provider: 'gateway-a', model: 'model-x', ...config })
}

const selectionEvents = (events) => events.filter((e) => e.type === 'model/selection')

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

test('write_storyboard 成功 ⇒ 压 low；重复落地不重发', () => {
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

test(`同名连续 ${THINKING_FAILURE_STREAK} 次失败 ⇒ 升缺省（不带 reasoningEffort 字段）；换名打断连击`, () => {
  const s = fakeSession('s-escalate')
  observeHeader(s)
  noteStoryboardLandedForPolicy(s) // 先进 low
  // 换名失败不打断也不误升：A 失败 → B 失败 → A 失败，连击两次被清
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
