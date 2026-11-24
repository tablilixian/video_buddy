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
import { DramaClient, ApiError, type CatalogModel, type CreditBalance, type CreditLedgerEntry } from './drama-management.js'
import { getAuthSession } from './auth-session.js'
import { quoteFingerprint, quoteRequestFor } from './credit-quote.js'
import type { AccountCreditsView, AccountLedgerView, AccountQuoteView, CreditQuoteParams } from './contracts/account.js'

/** 目录缓存 TTL（毫秒）。 */
const CATALOG_TTL_MS = 5 * 60_000
/** 429 无 Retry-After / 503 的默认退避（毫秒）。 */
const DEFAULT_BACKOFF_MS = 30_000
/**
 * 余额缓存 TTL（毫秒）。比目录短得多：余额是用户会盯着看的数字，30s 足够挡住
 * 连点与页面切回时的一串重复请求，又不会让「刚扣完费」看起来没有反应。
 */
const CREDITS_TTL_MS = 30_000
/**
 * 流水缓存 TTL（毫秒）。比余额长一倍：流水变化慢（只有生成/充值时才有新条目），
 * 但单页 200 条体积比余额大一个量级，不值得按余额的节奏反复拉。
 */
const LEDGER_TTL_MS = 60_000
/** 单页条数：服务端上限 200（实测），默认取一半——首屏够看且不吃满带宽。 */
const LEDGER_PAGE_SIZE = 50
/** 内存里最多留多少条（分页追加的上限；超出丢最旧的，UI 只展示最近这些）。 */
const LEDGER_MAX_ENTRIES = 200
/** 报价缓存 TTL：价目表由后端控制，5 分钟内复用同一组参数的报价是安全的。 */
const QUOTE_TTL_MS = 5 * 60_000
/** 报价缓存上限（防「用户一直拖时长」把 Map 拖成内存泄漏）。 */
const QUOTE_CACHE_MAX = 100

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
  // 流水与余额是同一件事的两个面：余额变了流水必然也变了。一起标陈旧，否则
  // 用户点开流水看到的是「余额已扣、流水里没有这笔」。
  ledgerStale = true
}

// ── 流水（积分账务页 / 实扣回填的数据源）─────────────────────────────────────
//
// 与余额同一套纪律（TTL / 在飞去重 / 403 停手 / 失败留旧值），刻意**不新写一份**
// 状态机：两处各判一次「该不该发请求」，迟早漂移。
/** 已加载的条目（最新在前；逐页追加，超过上限丢最旧的）。 */
let ledgerEntries: CreditLedgerEntry[] = []
/** 下一页游标；`null` = 到底（或从未读过）。 */
let ledgerCursor: string | null = null
/** `ledgerEntries` 的时刻（epoch ms）；0 = 从未读到。 */
let ledgerFetchedAt = 0
/** 被生成结束标记为陈旧：下一次读取绕 TTL。 */
let ledgerStale = false
let ledgerError: { code: string; message: string } | null = null
/** 403：账号受限后不再发业务请求（与余额同闸）。 */
let ledgerDisabled = false
let ledgerInFlight: Promise<void> | null = null

/** 读流水（`force=false` 时 TTL 内复用；`more=true` 时按游标追加下一页）。 */
export function refreshLedger(force: boolean, more = false): Promise<void> {
  const d = deps
  const token = getAuthSession()?.accessToken ?? ''
  if (d === null || token === '' || !d.enabled() || disabled || ledgerDisabled) return Promise.resolve()
  if (ledgerInFlight !== null) return ledgerInFlight
  if (more && ledgerCursor === null) return Promise.resolve()
  if (!more && !force && !ledgerStale && ledgerFetchedAt !== 0 && Date.now() - ledgerFetchedAt < LEDGER_TTL_MS) {
    return Promise.resolve()
  }
  ledgerInFlight = fetchLedger(d, token, more).finally(() => { ledgerInFlight = null })
  return ledgerInFlight
}

async function fetchLedger(d: AccountStateDeps, token: string, more: boolean): Promise<void> {
  try {
    const page = await clientOf(d).creditLedger(token, {
      limit: LEDGER_PAGE_SIZE,
      ...(more && ledgerCursor !== null ? { cursor: ledgerCursor } : {}),
    })
    // 只认数组形状：服务端加字段可以放过，但「entries 不是数组」说明契约变了，
    // 这时候保留旧条目比清空更有用（下一行 error 会说明为什么没更新）。
    if (!Array.isArray(page.entries)) {
      throw new ApiError('invalid_response', '流水响应缺少 entries 数组。', 502, null)
    }
    const merged = more ? [...ledgerEntries, ...page.entries] : [...page.entries]
    ledgerEntries = merged.length > LEDGER_MAX_ENTRIES ? merged.slice(0, LEDGER_MAX_ENTRIES) : merged
    // 追加后游标可能指向已丢弃的条目，但那是服务端游标、与本地上限无关；
    // 继续翻页仍是对的（用户要的是「更早的账」，不是「本地缓存那一页之后」）。
    ledgerCursor = page.next_cursor
    ledgerFetchedAt = Date.now()
    ledgerStale = false
    ledgerError = null
  } catch (cause) {
    if (cause instanceof ApiError) {
      ledgerError = { code: cause.code, message: cause.message }
      if (cause.status === 403) {
        ledgerDisabled = true
        d.log.warn(`[canvas-studio] 流水读取被拒（${cause.code}）：账号受限，停止业务请求`)
        return
      }
      d.log.warn(`[canvas-studio] 流水读取失败（${cause.code}）：${cause.message}`)
      return
    }
    ledgerError = { code: 'network_error', message: cause instanceof Error ? cause.message : String(cause) }
    d.log.warn(`[canvas-studio] 流水读取异常：${ledgerError.message}`)
  }
}

/** 读当前流水视图（纯读，无副作用）。 */
export function ledgerView(): AccountLedgerView {
  const d = deps
  return {
    enabled: d !== null && d.enabled(),
    signedIn: getAuthSession() !== null,
    disabled: ledgerDisabled,
    entries: ledgerEntries,
    hasMore: ledgerCursor !== null,
    fetchedAt: ledgerFetchedAt === 0 ? null : new Date(ledgerFetchedAt).toISOString(),
    error: ledgerError,
  }
}

// ── 报价（预估积分的唯一出口）────────────────────────────────────────────────
//
// 报价是**纯计算**（不建任务、不冻结），所以不需要登录态以外的状态机；但它会被
// 「拖时长滑块」「连续改档位」高频触发，所以要有缓存与在飞去重。缓存键是计价
// 指纹（不含 prompt，见 `credit-quote.ts`）——同一指纹 5 分钟内直接返回。
interface QuoteCacheEntry {
  readonly credits: number
  readonly model: string
  readonly operation: string
  readonly at: number
}
const quoteCache = new Map<string, QuoteCacheEntry>()
const quoteInFlight = new Map<string, Promise<AccountQuoteView>>()

/**
 * 报一次价。**永不抛错**：报价失败不该让路由 500，也不该阻断提交（生成链的
 * quote 硬闸本来就是 fail-open，见 `generate.ts` 的 CS-BILL-002 注释）。
 */
export function quoteCredits(params: CreditQuoteParams): Promise<AccountQuoteView> {
  const d = deps
  const token = getAuthSession()?.accessToken ?? ''
  const empty = (code: string, message: string): AccountQuoteView => ({
    model: null, operation: null, credits: null, fetchedAt: null, error: { code, message },
  })
  if (d === null || !d.enabled()) return Promise.resolve(empty('account_disabled', '管理面未启用，无法报价。'))
  if (token === '') return Promise.resolve(empty('unauthenticated', '登录后才能报价。'))
  if (disabled || creditsDisabled) return Promise.resolve(empty('account_disabled', '账号受限，已停止业务请求。'))

  const request = quoteRequestFor(params)
  const key = quoteFingerprint(params)
  const hit = quoteCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < QUOTE_TTL_MS) {
    return Promise.resolve({
      model: hit.model,
      operation: hit.operation,
      credits: hit.credits,
      fetchedAt: new Date(hit.at).toISOString(),
      error: null,
    })
  }
  // 在飞去重：三个 chip 与「重出按钮」可能同一瞬间问同一个指纹。
  const pending = quoteInFlight.get(key)
  if (pending !== undefined) return pending

  const job = (async (): Promise<AccountQuoteView> => {
    try {
      const quote = await clientOf(d).quoteGeneration(token, {
        model: request.model,
        operation: request.operation,
        input: request.input,
      })
      const at = Date.now()
      if (quoteCache.size >= QUOTE_CACHE_MAX) {
        // 简单淘汰：删最早插入的一条（够用，不值得为 100 条写 LRU）。
        const oldest = quoteCache.keys().next()
        if (!oldest.done) quoteCache.delete(oldest.value)
      }
      quoteCache.set(key, { credits: quote.estimated_credits, model: request.model, operation: request.operation, at })
      return {
        model: request.model,
        operation: request.operation,
        credits: quote.estimated_credits,
        fetchedAt: new Date(at).toISOString(),
        error: null,
      }
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : 'network_error'
      const message = cause instanceof Error ? cause.message : String(cause)
      d.log.warn(`[canvas-studio] 报价失败（${code}）：${message}`)
      return {
        model: request.model,
        operation: request.operation,
        credits: null,
        fetchedAt: null,
        error: { code, message },
      }
    } finally {
      quoteInFlight.delete(key)
    }
  })()
  quoteInFlight.set(key, job)
  return job
}


/**
 * 套餐并发上限（entitlement.features.concurrent_generations，B4）。
 * null = 未知（未登录 / 目录缺字段）——队列宽度不钳制（硬限制在服务端 409）。
 */
let planConcurrency: number | null = null

function capturePlanConcurrency(entitlement: Record<string, unknown> | null): void {
  const features = entitlement?.features
  if (features === null || features === undefined || typeof features !== 'object') {
    planConcurrency = null
    return
  }
  const raw = (features as Record<string, unknown>)['concurrent_generations']
  planConcurrency = typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : null
}

/** 套餐并发上限视图（队列宽度取 min 用）。 */
export function planConcurrencyView(): number | null {
  return planConcurrency
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
  // 流水同理：上一个账号的账不能留给下一个人看。报价缓存也清 —— 价格本身与
  // 账号无关，但「登出后还能秒回报价」会让人误以为报价不需要登录。
  ledgerEntries = []
  ledgerCursor = null
  ledgerFetchedAt = 0
  ledgerStale = false
  ledgerError = null
  ledgerDisabled = false
  quoteCache.clear()
}

/** bootstrap 主体：sync（用户 + 设备登记）→ models（目录）→ 回调。 */
async function runBootstrap(d: AccountStateDeps, token: string): Promise<void> {
  const client = clientOf(d)
  try {
    await client.sync(token)
    const catalog = await client.listTextCatalog(token)
    const models = catalog.models
    capturePlanConcurrency(catalog.entitlement)
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
