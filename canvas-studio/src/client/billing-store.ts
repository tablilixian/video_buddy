/**
 * 订阅与积分面板的 client 侧状态（方案 P3）。
 *
 * 与 `credits-store.ts` 同构（模块级单例 + `subscribe`），但多一件事：**它持有一个
 * 状态机**。订阅页不是一个「请求-渲染」的静态页面，它有四个会互相影响的时序：
 *
 * 1. 打开页面 → 读快照（TTL 由 Host 判，这里只决定「要不要 force」）；
 * 2. 下单 → 打开系统浏览器 → **开始等支付结果**（pending 轮询）；
 * 3. 支付完成 → pending 消失 / 订阅出现 → 停轮询 → 通知余额层刷新；
 * 4. 打开 Portal 管理订阅 → 同样要等 Stripe 那边改完（状态 key 变了就停）。
 *
 * 全部塞进组件的 `useState` 会让「页面被关掉后轮询还在跑」这类问题无法根治，所以
 * 状态与定时器都在模块里，组件只读。
 *
 * 分工纪律（与余额同一条）：**该不该发请求、发什么请求**由 Host 判；这里只负责
 * 「什么时候问」与「失败怎么说人话」。
 */
import {
  createStudioBillingCheckout,
  createStudioBillingPortalSession,
  fetchStudioBilling,
  StudioApiError,
} from './api.js'
import { classifyCheckoutConflict } from '../drama-management.js'
import type {
  BillingProductKind,
  BillingSnapshot,
  CheckoutConflictReason,
} from '../contracts/billing.js'

/** 写动作失败（下单 / 开 Portal）——UI 用它渲染横幅，不直接看 Error。 */
export interface BillingActionError {
  /** 服务端 code（`conflict` / `portal_unavailable` / `rate_limited` …）。 */
  code: string
  /** 已本地化的用户文案（**永远中文**，不透传英文 message）。 */
  message: string
  /** 仅 429 有：按服务端要求倒计时，而不是自己猜退避。 */
  retryAfterSeconds: number | null
  /** 409 的细分原因（其余 code 为 null）。 */
  conflictReason: CheckoutConflictReason | null
}

export interface BillingState {
  /** Host 快照；null = 还没问过（首帧，不能当成「没有订阅」）。 */
  view: BillingSnapshot | null
  /** 请求在飞：只用于禁用刷新按钮与 `aria-busy`，不阻塞渲染。 */
  loading: boolean
  /** client 侧连不上 Host（与 `view.error` 的服务端失败分开）。 */
  failure: string | null
  /** 正在下单的商品 `kind:code`；null = 无在飞。用于**只禁用当前卡片**。 */
  buying: string | null
  /** Portal 在飞。 */
  portal: boolean
  /** 最近一次写动作失败；用户下一次操作前一直显示。 */
  actionError: BillingActionError | null
  /** 短暂状态提示（「支付结果已确认」/「确认较慢，请手动刷新」）；null = 无。 */
  notice: string | null
  /** 429 倒计时截止（epoch ms）；0 = 无倒计时。 */
  retryNotBefore: number
}

/** 支付等待轮询：间隔 5s、总时长 2min（方案 §6.4）。 */
const PENDING_POLL_MS = 5_000
const PENDING_POLL_MAX_MS = 120_000

const INITIAL: BillingState = {
  view: null,
  loading: false,
  failure: null,
  buying: null,
  portal: false,
  actionError: null,
  notice: null,
  retryNotBefore: 0,
}

let state: BillingState = { ...INITIAL }
const listeners = new Set<() => void>()

export function getBillingState(): BillingState {
  return state
}

export function subscribeBilling(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(patch: Partial<BillingState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

// ── 读 ──────────────────────────────────────────────────────────────────────

let readInFlight: Promise<void> | null = null

/**
 * 读一次快照。`force=false` 交给 Host 的 15s TTL（切回窗口时的抖动由
 * `refresh-signal` 的 1s 去重挡掉，这里不再叠一层）。
 */
export function refreshBilling(force = false): Promise<void> {
  if (readInFlight !== null) return readInFlight
  emit({ loading: true })
  readInFlight = (async () => {
    try {
      const view = await fetchStudioBilling(force)
      // Host 读失败仍是 200：错误在体内 `error`，此时**保留旧数字**是对的，
      // 所以 view 直接覆盖（旧值已经在 Host 侧的快照里）。
      emit({ view, loading: false, failure: null })
      if (view.error === null) onSnapshotSettled(view)
    } catch (cause) {
      // 连不上 Host：保留旧视图，只记 client 侧失败（数字宁可旧，不要跳成空）。
      emit({ loading: false, failure: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      readInFlight = null
    }
  })()
  return readInFlight
}

/**
 * 快照到位后的收敛动作：**轮询的唯一停止条件在这里**。
 *
 * 为什么不在「打开 Stripe 2 分钟后」无条件停：Webhook 慢一点就白等。真正的完成
 * 信号有两个 —— pending 消失、或订阅出现（支付成功后两者都会发生）。两个都没等到
 * 才靠 2min 上限兜底。
 */
function onSnapshotSettled(view: BillingSnapshot): void {
  const waitingFor = pollContext
  if (waitingFor === null) return
  if (view.pending_checkout == null) {
    finishPolling('支付结果已确认')
    return
  }
  if (waitingFor.kind === 'portal' && subscriptionKeyOf(view) !== waitingFor.key) {
    finishPolling('订阅状态已更新')
  }
}

// ── pending 轮询（支付 / Portal 返回后等结果）─────────────────────────────────

type PollContext =
  | { kind: 'checkout' }
  | { kind: 'portal'; key: string }

let pollContext: PollContext | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollDeadline = 0

/** 订阅状态 key：这四个字段任一变化都说明 Stripe 那边改完了。 */
function subscriptionKeyOf(view: BillingSnapshot | null): string {
  const sub = view?.subscription ?? null
  if (sub === null) return 'none'
  return [sub.plan_code, sub.status, String(sub.cancel_at_period_end ?? false), sub.current_period_end ?? ''].join('|')
}

function startPolling(context: PollContext): void {
  pollContext = context
  pollDeadline = Date.now() + PENDING_POLL_MAX_MS
  schedulePollTick(true)
}

function schedulePollTick(immediate: boolean): void {
  if (pollTimer !== null) clearTimeout(pollTimer)
  pollTimer = setTimeout(() => {
    pollTimer = null
    if (pollContext === null) return
    if (Date.now() > pollDeadline) {
      finishPolling('支付结果确认较慢，请稍后手动刷新')
      return
    }
    // 轮询必须 force：TTL 内读缓存等于自己骗自己。
    void refreshBilling(true).then(() => {
      if (pollContext !== null) schedulePollTick(false)
    })
  }, immediate ? 0 : PENDING_POLL_MS)
}

function finishPolling(message: string | null): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  const wasPolling = pollContext !== null
  pollContext = null
  pollDeadline = 0
  if (!wasPolling) return
  // 支付/管理回来的最后一件事：让余额层也刷新（到账、扣费都可能在这次变化里）。
  refreshCreditsBridge()
  emit({ notice: message })
}

/** 面板关闭时停轮询（组件卸载调用；不停的话关掉页面还在打接口）。 */
export function stopBillingPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  pollContext = null
  pollDeadline = 0
}

/**
 * 余额层刷新钩子。用动态 import 避免 client 侧循环依赖
 * （`credits-store` → `api`，`billing-store` → `api`，两边都不强依赖对方）。
 */
let creditsBridge: (() => Promise<void> | void) | null = null

/** 装配余额刷新桥（StudioFrame 挂载时注入一次）。 */
export function installBillingCreditsBridge(refresh: () => Promise<void> | void): void {
  creditsBridge = refresh
}

function refreshCreditsBridge(): void {
  try {
    void creditsBridge?.()
  } catch {
    // 余额刷新失败不影响计费结果展示。
  }
}

// ── 写：下单 ────────────────────────────────────────────────────────────────

/**
 * 幂等键表：`kind:code` → key。
 *
 * **按购买意图复用**（比参考实现每次点击都生成新键更严）：网络超时后用户再点一次
 * 必须是同一 key，否则积分包会重复下单。只有服务端明确说「终态」（过期 / 失败 /
 * 已支付完成）或「同键不同商品」时才换新键。
 */
const idempotencyKeys = new Map<string, string>()
/** key 的本地保活时间：服务端 Checkout TTL 是 30min，这里 10min 就够了。 */
const KEY_TTL_MS = 10 * 60_000
const keyCreatedAt = new Map<string, number>()

function keyOf(kind: BillingProductKind, code: string): string {
  const slot = `${kind}:${code}`
  const existing = idempotencyKeys.get(slot)
  const created = keyCreatedAt.get(slot) ?? 0
  if (existing !== undefined && Date.now() - created < KEY_TTL_MS) return existing
  const next = crypto.randomUUID()
  idempotencyKeys.set(slot, next)
  keyCreatedAt.set(slot, Date.now())
  return next
}

function dropKey(kind: BillingProductKind, code: string): void {
  const slot = `${kind}:${code}`
  idempotencyKeys.delete(slot)
  keyCreatedAt.delete(slot)
}

/**
 * 本次会话是否还留着这个商品的幂等键。
 *
 * 用途只有一个：待支付横幅要不要给「继续支付」。**有键才能续上同一笔订单**
 * （服务端同键返回同一 `checkout_url`）；没有键去点只会在服务端撞
 * `409 already pending`，那是死路，不如不给这个按钮。
 */
export function hasIdempotencyKey(kind: BillingProductKind, code: string): boolean {
  const slot = `${kind}:${code}`
  const created = keyCreatedAt.get(slot) ?? 0
  return idempotencyKeys.has(slot) && Date.now() - created < KEY_TTL_MS
}

/**
 * 商品行是否可点。三条互斥规则（方案 §5.2）：
 * - 有 429 倒计时时全部禁用；
 * - **套餐请求在飞时禁用所有套餐**（同一账号只能有一个订阅，允许并发点两个套餐
 *   只会制造两个 409）；
 * - 积分包只禁用「正在下单的那一张」，多买互不影响。
 */
export function canBuy(kind: BillingProductKind, code: string): boolean {
  if (Date.now() < state.retryNotBefore) return false
  if (state.buying === null) return true
  if (state.buying === `${kind}:${code}`) return false
  const buyingKind: BillingProductKind = state.buying.startsWith('plan:') ? 'plan' : 'credit_pack'
  return !(buyingKind === 'plan' && kind === 'plan')
}

/**
 * 下单并打开系统浏览器。
 *
 * 返回 `true` = 已打开；`false` = 失败（错误已写进 `actionError`）。调用方不需要
 * 再判 code —— 文案与后续动作（刷新 / 换键 / 停轮询）都在这里做完。
 */
export async function startCheckout(kind: BillingProductKind, code: string): Promise<boolean> {
  if (state.buying !== null) return false
  if (Date.now() < state.retryNotBefore) return false
  emit({ buying: `${kind}:${code}`, actionError: null, notice: null })
  try {
    const session = await createStudioBillingCheckout({ kind, product_code: code }, keyOf(kind, code))
    emit({ buying: null })
    openExternal(session.checkout_url)
    // 下单成功 ⇒ pending_checkout 变了：立刻刷新一次拿横幅，然后开始等结果。
    void refreshBilling(true)
    startPolling({ kind: 'checkout' })
    return true
  } catch (cause) {
    emit({ buying: null, actionError: actionErrorOf(cause, kind, code) })
    return false
  }
}

/**
 * 开 Portal。`409 portal_unavailable` 是**正常业务分支**（没有 Stripe Customer 映射 /
 * manual 订阅），文案直接说「不支持在线管理」，不给重试按钮。
 */
export async function openPortal(): Promise<boolean> {
  if (state.portal) return false
  emit({ portal: true, actionError: null, notice: null })
  try {
    const session = await createStudioBillingPortalSession()
    emit({ portal: false })
    openExternal(session.portal_url)
    // Portal 改完订阅要等 Stripe 回调，记下当前状态 key，变了就停。
    startPolling({ kind: 'portal', key: subscriptionKeyOf(state.view) })
    return true
  } catch (cause) {
    emit({ portal: false, actionError: actionErrorOf(cause, null, null) })
    return false
  }
}

/** 清掉横幅（用户点「知道了」/ 重开页面）。 */
export function clearBillingActionError(): void {
  if (state.actionError === null) return
  emit({ actionError: null })
}

/** 登出 / 换账号 / 关面板：清视图与定时器，**不清幂等键**（同一次购买意图仍可续）。 */
export function resetBillingStore(): void {
  stopBillingPolling()
  emit({ ...INITIAL })
}

// ── 错误 → 人话（唯一实现点）───────────────────────────────────────────────

/**
 * 把写动作的失败翻译成 `BillingActionError`。
 *
 * 三条纪律：
 * 1. **按 code 分派**，不解析英文 message（`classifyCheckoutConflict` 是唯一例外，
 *    因为上游 409 的 code 恒为 `conflict`，实测只能看 message）。
 * 2. 文案里**不出现英文 code**，也不直接透传服务端 message。
 * 3. 429 带 `Retry-After` 时写进 `retryNotBefore`，按钮按它倒计时。
 */
function actionErrorOf(
  cause: unknown,
  kind: BillingProductKind | null,
  code: string | null,
): BillingActionError {
  const fallback: BillingActionError = {
    code: 'unknown',
    message: '操作失败，请稍后重试。',
    retryAfterSeconds: null,
    conflictReason: null,
  }
  if (!(cause instanceof StudioApiError)) {
    return { ...fallback, code: 'transport_error', message: '无法连接支付服务，请检查网络后重试。' }
  }
  const status = cause.status
  const serverCode = cause.code ?? `http_${status}`
  const retry = cause.retryAfterSeconds ?? null
  if (status === 429) {
    const seconds = retry ?? 30
    emit({ retryNotBefore: Date.now() + seconds * 1000 })
  }
  if (serverCode === 'portal_unavailable') {
    return { ...fallback, code: serverCode, message: '当前订阅不支持在线管理，请联系客服。' }
  }
  if (serverCode === 'conflict' || status === 409) {
    const reason = classifyCheckoutConflict(cause.message)
    // 终态（过期/失败/已支付）与同键不同商品：换新键，用户再点就是新订单。
    if (kind !== null && code !== null && (reason === 'expired' || reason === 'idem_mismatch')) {
      dropKey(kind, code)
    }
    // 待支付 / 已有订阅：键**不能换**（换了也只会在服务端撞同一道 pending 检查）。
    if (reason === 'pending') void refreshBilling(true)
    if (reason === 'not_purchasable') void refreshBilling(true)
    return {
      code: serverCode,
      message: conflictMessage(reason),
      retryAfterSeconds: retry,
      conflictReason: reason,
    }
  }
  if (status === 401 || serverCode === 'unauthenticated') {
    return { ...fallback, code: 'unauthenticated', message: '登录状态已失效，请重新登录后重试。' }
  }
  if (serverCode === 'permission_denied') {
    return { ...fallback, code: serverCode, message: '账号当前不可用，请联系客服。' }
  }
  if (serverCode === 'forbidden' || status === 403) {
    return { ...fallback, code: 'forbidden', message: '请求被本地拦截，请重启应用后重试。' }
  }
  if (serverCode === 'invalid_argument' || status === 400) {
    return { ...fallback, code: serverCode, message: '商品信息已更新，请刷新后重试。' }
  }
  if (serverCode === 'not_found' || status === 404) {
    return { ...fallback, code: serverCode, message: '该商品已下架，请刷新后重试。' }
  }
  if (serverCode === 'rate_limited' || status === 429) {
    return {
      code: 'rate_limited',
      message: `请求过于频繁，请 ${retry ?? 30} 秒后再试。`,
      retryAfterSeconds: retry,
      conflictReason: null,
    }
  }
  if (serverCode === 'unavailable' || status === 503) {
    return { ...fallback, code: 'unavailable', message: '支付服务暂时不可用，请稍后重试。' }
  }
  if (serverCode === 'invalid_response' || status === 502) {
    return { ...fallback, code: 'invalid_response', message: '支付返回异常，请稍后重试。' }
  }
  return { ...fallback, code: serverCode }
}

function conflictMessage(reason: CheckoutConflictReason): string {
  switch (reason) {
    case 'pending': return '你已有一笔待支付的订单，请先完成支付。'
    case 'expired': return '上一笔订单已失效，请重新购买。'
    case 'idem_mismatch': return '订单信息已变化，请重试。'
    case 'subscribed': return '当前账号已有生效中的订阅，请先在「管理订阅」里调整。'
    case 'not_purchasable': return '该商品暂不可购买。'
    default: return '下单失败，请稍后重试。'
  }
}

/**
 * 交系统浏览器打开。
 *
 * 必须走 `window.open`：渲染层的 `setWindowOpenHandler` 会把它交给
 * `shell.openExternal`（`electron-shell-generation.ts` 的既有白名单），应用内**不嵌**
 * Stripe 页面。`noopener` 防止新窗口拿到 `window.opener`。
 */
function openExternal(url: string): void {
  // URL 已在 Host 侧校验过 host 白名单（checkout.stripe.com / billing.stripe.com）。
  window.open(url, '_blank', 'noopener,noreferrer')
}
