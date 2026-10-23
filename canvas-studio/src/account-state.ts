/**
 * 管理面账号状态编排（方案 P2，CV-356）：client 推送会话后，Host 幂等完成
 * 业务用户同步（auth/sync，带全量设备信息）+ text 模型目录拉取，并回调网关
 * reconcile 与凭据发布。失败不阻塞现有登录闭环。
 *
 * 与 auth-session.ts 同风格（模块级单例 + install 注入依赖），依赖经
 * `installAccountState` 注入以便单测。错误策略对齐 api(10).md §6：
 * - `401` 静默（client 会刷 token 重推，推送即重试）；
 * - `403` 记日志 + 置禁用态（停止后续业务请求，直到 reset / 重新启用）；
 * - `429` 按 `Retry-After` 推迟（无头则默认退避）；`503` 固定退避、不高频重试；
 * - `500` 记日志不重试。
 * bootstrap 失败不回滚登录态；目录有 TTL（5min），TTL 内的重推只发布凭据不重拉。
 */
import { DramaClient, ApiError, type CatalogModel, type CreditBalance } from './drama-management.js'
import { getAuthSession } from './auth-session.js'
import type { AccountCreditsView } from './contracts/account.js'

/** 目录缓存 TTL（毫秒）。 */
const CATALOG_TTL_MS = 5 * 60_000
/** 429 无 Retry-After / 503 的默认退避（毫秒）。 */
const DEFAULT_BACKOFF_MS = 30_000
/**
 * 余额缓存 TTL（毫秒）。比目录短得多：余额是用户会盯着看的数字，30s 足够挡住
 * 连点与页面切回时的一串重复请求，又不会让「刚扣完费」看起来没有反应。
 */
const CREDITS_TTL_MS = 30_000

export interface AccountStateDeps {
  /** 启用闸：`businessApiBase` 非空 && `supabaseUrl` 非空（live 读取，设置变更即时生效）。 */
  enabled(): boolean
  /** 每次调用现取基址（设置热切换后新请求即用新值）。 */
  businessApiBase(): string
  /** 设备三元组（device-registry 提供；auth/sync 每次发全量防覆盖置空）。 */
  device: {
    deviceId(): string
    platform(): string
    appVersion(): string
  }
  log: { info(message: string): void; warn(message: string): void }
  /**
   * 目录变化回调（P4 网关 reconcile 挂这里）：传 `[]` 表示目录为空。
   * 启动期从缓存恢复也走它（由装配方直接调 reconcile，不经本模块）。
   */
  onCatalogChanged(models: CatalogModel[], apiBaseUrl: string): void | Promise<void>
  /** 会话 token 钩子（P4 凭据发布挂这里）：每次会话推送都会调（token 会刷新）。 */
  onSessionToken(token: string): void | Promise<void>
}

let deps: AccountStateDeps | null = null
let bootstrapInFlight: Promise<void> | null = null
/** 上一次成功 bootstrap 的 token：同一 token 不重复打 sync（幂等去重）。 */
let bootstrappedToken: string | null = null
/** 上一次成功拉目录的时刻（epoch ms）；0 = 从未拉到。 */
let catalogFetchedAt = 0
/** 退避窗口截止时刻（epoch ms）；0 = 无退避。 */
let retryNotBefore = 0
/** 403 禁用态：账号被禁用后停止一切业务请求，直到 reset。 */
let disabled = false

// ── 余额（CV-358）─────────────────────────────────────────────────────────────
//
// token **不在这里存一份**：直接从 auth-session.ts 的会话缓存取。抄一份会在
// 「退避窗口内 / 幂等命中」这两个提前 return 的分支里漏更新，然后拿旧 token 打
// 接口换回 401 —— 表现为余额莫名空白，日志还静默。
/** 最近一次成功读到的余额；null = 从未读到（**不是 0**）。 */
let credits: CreditBalance | null = null
/** `credits` 的时刻（epoch ms）；0 = 从未读到。 */
let creditsFetchedAt = 0
/** 被生成结束标记为陈旧：下一次读取绕 TTL（时间戳保持真实，不拿它当标志位）。 */
let creditsStale = false
/** 最近一次失败（UI 有旧值时标灰 + 保留数字）。 */
let creditsError: { code: string; message: string } | null = null
/** 403：余额也属于业务请求，账号受限后不再发。 */
let creditsDisabled = false
/** 在飞请求（连点 / 路由与 UI 同时刷时复用，不重复打）。 */
let creditsInFlight: Promise<void> | null = null

/** 装配依赖（幂等覆盖：设置热切换不需要重装，enabled() 是 live 读取）。 */
export function installAccountState(next: AccountStateDeps): void {
  deps = next
}

/** 429/503 的退避窗口：有 Retry-After 听服务端的，否则默认兜底。 */
export function backoffMsOf(error: ApiError): number {
  if (error.status === 429) return (error.retryAfterSeconds ?? 0) * 1000 || DEFAULT_BACKOFF_MS
  if (error.status === 503) return DEFAULT_BACKOFF_MS
  return 0
}

/** 构造协议客户端（基址与设备信息每次现取，设置热切换后新请求即用新值）。 */
function clientOf(d: AccountStateDeps): DramaClient {
  return new DramaClient({
    baseUrl: d.businessApiBase(),
    // 必须包一层箭头函数：DeviceRegistry 用 #私有成员，裸方法引用（`d.device.deviceId`）
    // 调用时 this 丢失 → `Cannot read private member #deviceId`（2026-10-22 实测）。
    deviceId: () => d.device.deviceId(),
    platform: () => d.device.platform(),
    appVersion: () => d.device.appVersion(),
  })
}

/**
 * 读一次余额（CV-358）。`force=false` 时 TTL 内复用缓存；`force=true` 绕 TTL。
 *
 * 三条纪律：
 * 1. **不抛错**：余额是装饰性信息，读不到不该让路由 500、更不该冒到 UI 错误卡；
 * 2. **不写退避窗口**：与 bootstrap 刻意不同 —— 余额是主动刷新语义，429/503 由用户
 *    下一次点击 / 下一次生成结束自然重试；写进窗口会变成「点了刷新毫无反应」；
 * 3. **在飞去重**：连点、路由与 UI 同时刷，只发一个请求。
 */
export function refreshCredits(force: boolean): Promise<void> {
  const d = deps
  const token = getAuthSession()?.accessToken ?? ''
  if (d === null || token === '' || !d.enabled() || disabled || creditsDisabled) return Promise.resolve()
  if (creditsInFlight !== null) return creditsInFlight
  if (!force && !creditsStale && credits !== null && Date.now() - creditsFetchedAt < CREDITS_TTL_MS) {
    return Promise.resolve()
  }
  creditsInFlight = fetchCredits(d, token).finally(() => { creditsInFlight = null })
  return creditsInFlight
}

async function fetchCredits(d: AccountStateDeps, token: string): Promise<void> {
  try {
    credits = await clientOf(d).creditBalance(token)
    creditsFetchedAt = Date.now()
    creditsStale = false
    creditsError = null
  } catch (cause) {
    if (cause instanceof ApiError) {
      creditsError = { code: cause.code, message: cause.message }
      if (cause.status === 403) {
        creditsDisabled = true
        d.log.warn(`[canvas-studio] 余额读取被拒（${cause.code}）：账号受限，停止业务请求`)
        return
      }
      // 401 与 bootstrap 同语义：留给 client 刷新后重推会话，下次刷新自然是新 token。
      d.log.warn(`[canvas-studio] 余额读取失败（${cause.code}）：${cause.message}`)
      return
    }
    creditsError = { code: 'network_error', message: cause instanceof Error ? cause.message : String(cause) }
    d.log.warn(`[canvas-studio] 余额读取异常：${creditsError.message}`)
  }
}

/**
 * 标记余额陈旧（生成结束调用）：下一次读取一定走网络。
 *
 * 只置标志、**不清 `creditsFetchedAt`** —— 那个时间戳要如实告诉用户「数字是什么
 * 时候的」，清掉会让「有数字但取数时间未知」自相矛盾。
 */
export function markCreditsStale(): void {
  creditsStale = true
}

/** 读当前视图（纯读，无副作用；路由与 UI 的唯一数据来源）。 */
export function creditsView(): AccountCreditsView {
  const d = deps
  return {
    enabled: d !== null && d.enabled(),
    signedIn: getAuthSession() !== null,
    disabled: creditsDisabled,
    balance: credits,
    fetchedAt: creditsFetchedAt === 0 ? null : new Date(creditsFetchedAt).toISOString(),
    error: creditsError,
  }
}

/**
 * 会话推送入口（routes.ts 的 auth/session 路由在 setAuthSession 后调用）。
 * 幂等：同 token 已成功过只发布凭据；进行中复用同一 Promise；退避/禁用/未启用
 * 静默跳过。任何失败都只进日志，不抛给路由（bootstrap 失败不阻塞登录闭环）。
 */
export function notifyAuthSession(token: string): void {
  const d = deps
  if (d === null || !d.enabled() || token.length === 0) return
  if (disabled) return
  if (Date.now() < retryNotBefore) {
    void d.onSessionToken(token) // 退避期内不重打接口，但凭据发布照做（token 可能已刷新）
    return
  }
  if (bootstrappedToken === token && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) {
    void d.onSessionToken(token)
    return
  }
  if (bootstrapInFlight !== null) return
  bootstrapInFlight = runBootstrap(d, token).finally(() => { bootstrapInFlight = null })
}

/** 会话清除入口（SIGNED_OUT）：重置内存态；目录缓存与网关行保留（重登录即刷新）。 */
export function notifyAuthCleared(): void {
  bootstrappedToken = null
  catalogFetchedAt = 0
  retryNotBefore = 0
  disabled = false
  // 余额必须一起清：留着就是「登出后还显示上一个账号的钱」，既是正确性问题
  // 也是隐私问题。在飞请求不主动打断（拿到结果也会因为下一个人重新登录而覆盖）。
  credits = null
  creditsFetchedAt = 0
  creditsStale = false
  creditsError = null
  creditsDisabled = false
}

/** bootstrap 主体：sync（用户 + 设备登记）→ models（目录）→ 回调。 */
async function runBootstrap(d: AccountStateDeps, token: string): Promise<void> {
  const client = clientOf(d)
  try {
    await client.sync(token)
    const models = await client.listTextModels(token)
    bootstrappedToken = token
    catalogFetchedAt = Date.now()
    retryNotBefore = 0
    await d.onSessionToken(token)
    // 登录即预取余额（CV-358）：别等用户去点卡片。失败只进日志，不影响 bootstrap
    // 的结果判定 —— 余额读不到不该让「已登录」这件事看起来失败。
    void refreshCredits(false)
    try {
      await d.onCatalogChanged(models, d.businessApiBase())
    } catch (cause) {
      // 目录与凭据已就绪，只是网关落行失败：允许下次会话推送重试（不清 bootstrappedToken）。
      catalogFetchedAt = 0
      d.log.warn(`[canvas-studio] 目录回调失败（下次推送重试）：${cause instanceof Error ? cause.message : String(cause)}`)
      return
    }
    d.log.info(`[canvas-studio] 管理面 bootstrap 完成：业务用户已同步，text 模型 ${models.length} 个`)
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.status === 401) {
        // token 过期：静默 —— client 会 TOKEN_REFRESHED 重推，推送即重试。
        return
      }
      if (cause.status === 403) {
        disabled = true
        creditsDisabled = true
        d.log.warn(`[canvas-studio] 管理面 bootstrap 被拒（${cause.code}）：账号禁用，停止业务请求`)
        return
      }
      const backoff = backoffMsOf(cause)
      if (backoff > 0) {
        retryNotBefore = Date.now() + backoff
        d.log.warn(`[canvas-studio] 管理面 bootstrap 退避 ${Math.round(backoff / 1000)}s（${cause.code}）`)
        return
      }
      d.log.warn(`[canvas-studio] 管理面 bootstrap 失败（${cause.code}）：${cause.message}`)
      return
    }
    d.log.warn(`[canvas-studio] 管理面 bootstrap 异常：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
