/**
 * 订阅与积分编排（方案 P2，`订阅与积分接入方案-20261102.md`）。
 *
 * 与 `account-state.ts` 同构：模块级单例 + `installBillingState(deps)` 注入，
 * token 直接从 `auth-session.ts` 取（**不在本模块存一份** —— 抄一份会在提前 return
 * 的分支里漏更新，然后拿旧 token 打接口换回 401，表现为订阅页莫名空白）。
 *
 * 四条纪律（与余额读取刻意不同，别照抄）：
 *
 * 1. **读取不抛**：`GET` 路径永远 200，失败进 `snapshot.error` 且**保留上一次成功
 *    的数据**。上游文档明说 `GET /business/v1/billing` 就是这么设计的。
 * 2. **写入要抛**：checkout / portal 是用户显式动作，失败必须让 UI 能按 code 分派
 *    （409 的 pending / expired、429 的倒计时、503 重试），吞掉就变成「点了没反应」。
 * 3. **TTL 15s + 在飞去重**：订阅页会在 focus / pending 轮询里反复问，没有 TTL 会
 *    把本机回环打满；`force` 只给「用户点刷新」「支付返回」「pending 轮询」用。
 * 4. **403 停手**：账号被禁用后不再发任何计费请求，直到重新登录（reset）。
 */
import { ApiError, DramaClient, isValidIdempotencyKey } from './drama-management.js'
import { getAuthSession } from './auth-session.js'
import type {
  BillingCheckoutRequest,
  BillingCheckoutSession,
  BillingError,
  BillingOverviewResponse,
  BillingPortalSession,
  BillingSnapshot,
} from './contracts/billing.js'

/**
 * 快照 TTL（毫秒）。比余额的 30s 短：商品可售状态与待支付订单会因后台操作变化，
 * 15s 足够挡住 focus 风暴，又不至于让「刚支付成功」迟迟不显示。
 */
const BILLING_TTL_MS = 15_000

export interface BillingStateDeps {
  /** 启用闸：`businessApiBase` && `supabaseUrl` 均非空（live 读取，设置热切换即时生效）。 */
  enabled(): boolean
  businessApiBase(): string
  device: {
    deviceId(): string
    platform(): string
    appVersion(): string
  }
  log: { info(message: string): void; warn(message: string): void }
}

let deps: BillingStateDeps | null = null

/** 最近一次成功的快照（业务字段原样保留；`error` 由下面的失败态单独拼）。 */
let snapshot: BillingOverviewResponse | null = null
/** `snapshot` 的时刻（epoch ms）；0 = 从未成功读到。 */
let fetchedAt = 0
/** 最近一次读取失败（有快照时 UI 保留旧值 + 顶部细条）。 */
let readError: BillingError | null = null
/** 403：账号受限后连计费读取也停手。 */
let disabled = false
/** 在飞读取（连点 / 路由与 UI 同时刷复用同一个请求）。 */
let readInFlight: Promise<void> | null = null

export function installBillingState(next: BillingStateDeps): void {
  deps = next
}

/** 构造协议客户端（基址与设备三元组每次现取，设置热切换后新请求即用新值）。 */
function clientOf(d: BillingStateDeps): DramaClient {
  return new DramaClient({
    baseUrl: d.businessApiBase(),
    // 必须包箭头函数：DeviceRegistry 用 #私有成员，裸方法引用会丢 this。
    deviceId: () => d.device.deviceId(),
    platform: () => d.device.platform(),
    appVersion: () => d.device.appVersion(),
  })
}

/** 当前 token（无会话返回空串；调用方据此判断「该不该发请求」）。 */
function tokenOf(): string {
  return getAuthSession()?.accessToken ?? ''
}

/** 是否有条件发计费请求（唯一判据，路由与编排共用，避免两处结论不同）。 */
export function billingReady(): boolean {
  return deps !== null && deps.enabled() && tokenOf() !== '' && !disabled
}

function toBillingError(cause: unknown): BillingError {
  if (cause instanceof ApiError) {
    return {
      code: cause.code,
      message: cause.message,
      status: cause.status,
      retryAfterSeconds: cause.retryAfterSeconds,
    }
  }
  return {
    code: 'transport_error',
    message: cause instanceof Error ? cause.message : String(cause),
    status: 0,
    retryAfterSeconds: null,
  }
}

/**
 * 读一次计费快照。**不抛**：失败只更新 `readError`。
 *
 * `force=false` 时 TTL 内直接返回（零请求）；`force=true` 绕 TTL（用户点刷新 /
 * 支付返回 / pending 轮询）。
 */
export function refreshBilling(force: boolean): Promise<void> {
  const d = deps
  const token = tokenOf()
  if (d === null || token === '' || !d.enabled() || disabled) return Promise.resolve()
  if (readInFlight !== null) return readInFlight
  if (!force && snapshot !== null && Date.now() - fetchedAt < BILLING_TTL_MS) return Promise.resolve()

  readInFlight = (async () => {
    try {
      const next = await clientOf(d).billingOverview(token)
      snapshot = next
      fetchedAt = Date.now()
      readError = null
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null
      readError = toBillingError(cause)
      if (apiError !== null && apiError.status === 403) {
        // 与 account-state 同语义：账号受限后连计费读取也停，避免每 15s 撞一次 403。
        disabled = true
        d.log.warn(`[canvas-studio] 计费读取被拒（${apiError.code}）：账号受限，停止计费请求`)
        return
      }
      // 401 不置禁用：client 会刷 token 重推会话，下一次刷新自然是新 token。
      d.log.warn(`[canvas-studio] 计费读取失败（${apiError?.code ?? 'transport_error'}）：${apiError?.message ?? readError.message}`)
    } finally {
      readInFlight = null
    }
  })()
  return readInFlight
}

/**
 * 读当前快照（纯读、无副作用；路由与 UI 的唯一数据来源）。
 *
 * 没读到过（首次且失败）时商品目录是**空数组**而不是 null：UI 用
 * `error !== null && plans.length === 0` 表达「读不到」，不需要第三种状态。
 */
export function billingView(): BillingSnapshot {
  const d = deps
  const view: BillingSnapshot = {
    enabled: d !== null && d.enabled(),
    signedIn: getAuthSession() !== null,
    disabled,
    subscription: snapshot?.subscription ?? null,
    credits: snapshot?.credits ?? null,
    plans: snapshot?.plans ?? [],
    credit_packs: snapshot?.credit_packs ?? [],
    fetchedAt: fetchedAt === 0 ? null : new Date(fetchedAt).toISOString(),
    error: readError,
  }
  // pending_checkout 是 omitempty：有才挂 key，避免 client 侧要区分 undefined/null。
  if (snapshot?.pending_checkout != null) view.pending_checkout = snapshot.pending_checkout
  return view
}

/** 登出 / 换账号：清空内存态（含禁用位与失败态），避免下个账号看到上个账号的订阅。 */
export function resetBilling(): void {
  snapshot = null
  fetchedAt = 0
  readError = null
  disabled = false
  readInFlight = null
}

/**
 * 创建 Checkout。**失败抛 `ApiError`**（路由按 status/code 分派）。
 *
 * 三道本地校验先于网络：未启用 / 未登录 / 幂等键非法。前两者上游也会拒，但本地拦下
 * 能给出准确文案，且省掉一次必然失败的往返。
 */
export async function createBillingCheckout(
  request: BillingCheckoutRequest,
  idempotencyKey: string,
): Promise<BillingCheckoutSession> {
  const d = deps
  if (d === null || !d.enabled()) {
    throw new ApiError('unavailable', '计费服务未配置（businessApiBase 为空）。', 503, null)
  }
  const token = tokenOf()
  if (token === '') throw new ApiError('unauthenticated', '未登录，无法创建订单。', 401, null)
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new ApiError('invalid_argument', 'Idempotency-Key 非法（1–200 字节可打印 ASCII）。', 400, null)
  }
  if (request.kind !== 'plan' && request.kind !== 'credit_pack') {
    throw new ApiError('invalid_argument', 'kind 只能是 plan 或 credit_pack。', 400, null)
  }
  if (typeof request.product_code !== 'string' || request.product_code.length === 0) {
    throw new ApiError('invalid_argument', 'product_code 不能为空。', 400, null)
  }
  const session = await clientOf(d).createBillingCheckout(token, request, idempotencyKey)
  // 下单成功后本地快照必然过期（pending_checkout 变了），下次读强制走网络。
  fetchedAt = 0
  return session
}

/** 创建 Stripe Customer Portal Session。**失败抛 `ApiError`**（`409 portal_unavailable` 是正常分支）。 */
export async function createBillingPortalSession(): Promise<BillingPortalSession> {
  const d = deps
  if (d === null || !d.enabled()) {
    throw new ApiError('unavailable', '计费服务未配置（businessApiBase 为空）。', 503, null)
  }
  const token = tokenOf()
  if (token === '') throw new ApiError('unauthenticated', '未登录，无法管理订阅。', 401, null)
  return clientOf(d).createBillingPortalSession(token)
}
