/**
 * 动态思考强度策略（批 2-v2，策略文档 `docs/plans/2026-11-08-动态思考强度-分层策略与实施.md` §4 v1 表）。
 *
 * **写入机制（CV-457 修正，Session 21 实证）**：只 `session.append('model/selection')` **不够**——
 * 运行中 agent 的内存档位（`selectionFor(agent).current` 的 `picked`）在首次 install 时一次性捕获，
 * 之后请求永远回退 loggedHeader（无 effort = 缺省档）。上游自己的中途切档走
 * `agents.selectForNextRequest(agent, selection)`（agent.ts:339）**双写**：append 事件 + 设内存档位。
 * 本策略经注入的 applier 走 `selectForNextRequest` 同款双写；applier 拒绝（旧运行时无 agents 服务）
 * 时回退 append（v1 行为，事件只进持久投影，新 agent install / 重启重开会话才消费）。
 *
 * **为什么不写 `agent-default-model.reasoningEffort`**：会话一旦发出首条请求，
 * selection 回退链优先读「上一条已记录 header」的 effort——中途改默认配置对运行中的
 * 会话**永不生效**（fab7582b 实测：用户中途调整，5 个 header 全是缺省快照）。
 *
 * **开关**：`thinkingPolicy` 配置项（默认 **false**，2026-11-09 用户拍板「先固定 low、默认关闭」
 * ——固定档由设置页思考强度承担，对照会话实证 low 全程粘住 header）。开启后策略 v1：
 * - `write_storyboard` 成功 ⇒ **low**（spec 装配段；缺省档 50~100k 字符/步必爆——会话 19 实证）
 * - 同名工具**连续 2 次失败**（含探针拒收）⇒ **缺省**（失败恢复需要判断深度），有界 5 个
 *   工具结果后自动回 low（防振荡）
 * - 用户基线 = 会话首条 header 的档位：`none`（显式关思考）⇒ 策略完全不介入
 * - 只管理 reasoningEffort，provider/model 沿用会话当前值不变
 */

export type ThinkingEffortLevel = 'low' | 'default'

export interface ThinkingHeaderConfig {
  readonly provider?: unknown
  readonly model?: unknown
  readonly reasoningEffort?: unknown
}

/** 会话句柄的最小形状（真实 Session / 测试 mock 都满足）。 */
export interface ThinkingSession {
  header?: { id?: unknown; cwd?: unknown }
  append?: (type: string, data: unknown) => unknown
}

/** 一次档位选择（与上游 AgentModelSelection 同形）。 */
export interface ThinkingSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * 档位落地通道（注入）：生产实现 = `agents.resolveAgent(sessionId)` +
 * `agents.selectForNextRequest(agent, selection)`（双写）；测试注入桩。
 */
export type ThinkingSelectionApplier = (sessionId: string, selection: ThinkingSelection) => Promise<void> | void

/** 连续失败升级的窗口（工具结果数；一轮返工循环的量级）。 */
export const THINKING_ESCALATION_WINDOW = 5

/** 同名工具连续失败多少次触发升级。 */
export const THINKING_FAILURE_STREAK = 2

interface PolicyState {
  /** 会话首条 header 的档位：'none' = 用户显式关思考 ⇒ 策略不介入。 */
  baseline: 'active' | 'minimal'
  seenHeader: boolean
  provider: string
  model: string
  /** 最近一次 header 观测到的档位：undefined = 缺省。 */
  lastEffort?: string
  /** 已 emit 但尚未被 header 确认（header 无 effort 时不清 lastEffort，防重发循环——Session 21 实证）。 */
  pendingEmit: boolean
  lastFailName?: string
  failStreak: number
  /** 升级后已消耗的工具结果数（有界窗口计数）。 */
  escalatedResults: number
}

const states = new Map<string, PolicyState>()

/** 策略总开关（默认 **false**：策略零介入，固定档由用户设置承担）。 */
let policyEnabled = false
/** 档位落地通道（缺省 undefined = 走 session.append 回退）。 */
let selectionApplier: ThinkingSelectionApplier | undefined

/** 开关策略（默认关；由 config 装载时设置，重启生效）。 */
export function setThinkingPolicyEnabled(enabled: boolean): void {
  policyEnabled = enabled
}

/** 注入档位落地通道（生产 = selectForNextRequest 双写；undefined = 回退 append）。 */
export function setThinkingPolicySelectionApplier(applier: ThinkingSelectionApplier | undefined): void {
  selectionApplier = applier
}

function stateOf(session: ThinkingSession | undefined): PolicyState | null {
  const id = session?.header?.id
  if (typeof id !== 'string' || id === '') return null
  const found = states.get(id)
  if (found !== undefined) return found
  const fresh: PolicyState = { baseline: 'active', seenHeader: false, provider: '', model: '', pendingEmit: false, failStreak: 0, escalatedResults: 0 }
  states.set(id, fresh)
  return fresh
}

function keyOf(session: ThinkingSession | undefined): string {
  const id = session?.header?.id
  return typeof id === 'string' && id !== '' ? id : '_current'
}

/** 会话首条 header 定基线：`none`（显式关思考）⇒ 本会话策略不介入。 */
export function noteThinkingHeader(session: ThinkingSession | undefined, config: ThinkingHeaderConfig | undefined): void {
  if (!policyEnabled) return
  const state = stateOf(session)
  if (state === null) return
  const effort = typeof config?.reasoningEffort === 'string' ? config.reasoningEffort : undefined
  if (!state.seenHeader) {
    state.seenHeader = true
    state.baseline = effort === 'none' ? 'minimal' : 'active'
  }
  if (effort === undefined) {
    // header 无 effort：已 emit 未确认（pendingEmit）时**不清 lastEffort**——否则 emit→header None→
    // 重置→每次 storyboard 都重发（Session 21 实证的双发循环）。仅当无未决 emit 才视为真缺省。
    if (!state.pendingEmit) delete state.lastEffort
  } else {
    state.lastEffort = effort
    state.pendingEmit = false
  }
  if (typeof config?.provider === 'string' && config.provider !== '') state.provider = config.provider
  if (typeof config?.model === 'string' && config.model !== '') state.model = config.model
  // exactOptionalPropertyTypes：lastEffort 的 undefined 用 delete 表达，不做属性赋值。
}

function emit(session: ThinkingSession, sessionId: string, state: PolicyState, effort: 'low' | undefined): void {
  // 档位未变就不发事件（header 快照已在目标档）。
  if ((state.lastEffort ?? undefined) === (effort ?? undefined)) return
  if (typeof state.provider !== 'string' || state.provider === '' || typeof state.model !== 'string' || state.model === '') return
  const selection: ThinkingSelection = {
    provider: state.provider,
    model: state.model,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  }
  if (effort === undefined) delete state.lastEffort
  else state.lastEffort = effort
  state.pendingEmit = true
  const applier = selectionApplier
  if (applier !== undefined) {
    // 生产通道：selectForNextRequest 双写（append 由上游内部做，这里不再自己 append 防双事件）。
    void Promise.resolve()
      .then(() => applier(sessionId, selection))
      .catch(() => session.append?.('model/selection', selection)) // applier 失败（agent 已关/服务缺）回退 append
  } else {
    // 旧运行时回退（CV-456 v1）：只进持久投影，新 agent install / 重启重开才消费。
    session.append?.('model/selection', selection)
  }
}

/** 工具结果记账（成功/失败都进）：驱动失败升级与有界降回。 */
export function noteThinkingToolResult(session: ThinkingSession | undefined, toolName: string, ok: boolean): void {
  if (!policyEnabled) return
  const state = stateOf(session)
  if (session === undefined || state === null || state.baseline === 'minimal') return
  if (state.provider === '' || state.model === '') return

  if (!ok) {
    state.failStreak = state.lastFailName === toolName ? state.failStreak + 1 : 1
    state.lastFailName = toolName
    // 升级条件：同名连续 2 次失败 + 当前在低档（缺省无更重档可升）。
    if (state.failStreak >= THINKING_FAILURE_STREAK && (state.lastEffort ?? undefined) === 'low') {
      emit(session, keyOf(session), state, undefined)
      state.escalatedResults = 0
    }
    return
  }

  // 成功：失败连击清零；升级窗口计数 +1，满窗降回 low。
  state.failStreak = 0
  delete state.lastFailName
  if ((state.lastEffort ?? undefined) === undefined && state.escalatedResults < THINKING_ESCALATION_WINDOW) {
    state.escalatedResults += 1
    if (state.escalatedResults >= THINKING_ESCALATION_WINDOW) {
      emit(session, keyOf(session), state, 'low')
      state.escalatedResults = 0
    }
  }
}

/** write_storyboard 成功 ⇒ 进入 spec 装配段 ⇒ 压到 low（缺省必爆的实证）。 */
export function noteStoryboardLandedForPolicy(session: ThinkingSession | undefined): void {
  if (!policyEnabled) return
  const state = stateOf(session)
  if (session === undefined || state === null || state.baseline === 'minimal') return
  emit(session, keyOf(session), state, 'low')
}

/** 测试辅助：清空全部状态（生产不调用）。 */
export function resetThinkingPolicyForTests(): void {
  states.clear()
}

/** 测试辅助：读当前会话键。 */
export function thinkingPolicyKeyOf(session: ThinkingSession | undefined): string {
  return keyOf(session)
}
