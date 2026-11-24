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
import { ageDaysOf, breakdownOf, estimatePrice, loadPriceTable } from './price-table.js'
import type { AccountCreditsView, AccountLedgerView, AccountQuoteView, CreditQuoteParams, GenerationSpendView } from './contracts/account.js'

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
/**
 * 实扣查询的最小强制刷新间隔（毫秒）。
 *
 * 生成结束后账是**陆续**落库的，客户端又会在画布上同时点开若干节点；没有这道闸，
 * 每个节点都会戳一次流水接口。1.5s 足够挡掉同一批节点的连环查询，又不至于让
 * 「刚生成完的那一笔」等太久。
 */
const SPEND_FETCH_MIN_INTERVAL_MS = 1_500
/**
 * generation id 形状闸（UUID）。
 *
 * 它挡的是**旧链路**的 `dramaFilename`（ComfyUI 产物名 / fal 请求基址）被误当
 * 索引键传进来：那些值在流水里永远匹配不到，多查一次就是白发一个请求。
 */
const GENERATION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * 待对账集合上限。
 *
 * 轻任务（理解 / 识别）也会登记，但它们不落画布节点、永远不会有人来要数字 ——
 * 不设上限就是一条只进不出的内存增长。超出丢最早的那个（它已经过了「客户端会来
 * 问」的时间窗）。
 */
const SPEND_PENDING_MAX = 500

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

// ── 实扣解析（generationId → 真实消耗）──────────────────────────────────────
//
// 「这个节点到底花了多少」**只有**一个真相源：`GET /v1/credits/ledger` 里那条
// `entry_type='commit'` 的负数。生成快照（`GET /v1/generations/{id}`）只有
// `billing_status`（held/committed/released），**没有金额字段** —— 这一点是 2026-11-24
// 实测确认的，也是参考工程 reelsbuddy 至今显示不出本笔实扣的原因。
//
// 所以这里不做「生成时把金额抄一份到节点上」：抄一份就等于维护第二本账，而任务
// 失败会 `release` 全额退回，抄下来的数字不会跟着归零 —— 漂移方向正好是多算用户的钱。
// 派生读永远不会与账本不一致，代价是更早的账（超出内存里那 200 条）查不到，UI 显示「—」。
/** 已生成、但账还没对上号的 generation id（生成结束时登记）。 */
const spendPending = new Set<string>()
/** 上一次为「查实扣」而强制刷流水的时刻（epoch ms）；0 = 从未。 */
let lastSpendFetchAt = 0

/**
 * 登记「这笔账迟些要对」（生成成功后调用，`generate.ts` 的两条结算路径）。
 *
 * 只登记 id、标流水陈旧，**不发请求**：此刻服务端的 `commit` 多半还没落库，立刻问
 * 一定是空手而归。真正的查询发生在客户端来要数字的时候（那时已经过了几百毫秒）。
 */
export function markGenerationSpendPending(generationId: string): void {
  if (!GENERATION_ID_SHAPE.test(generationId)) return
  spendPending.add(generationId)
  ledgerStale = true
  if (spendPending.size > SPEND_PENDING_MAX) {
    const oldest = spendPending.values().next()
    if (!oldest.done) spendPending.delete(oldest.value)
  }
}

/** 从已加载的流水里挑出这些 generation 的 commit 金额（绝对值）。 */
function commitCreditsIndex(wanted: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of ledgerEntries) {
    const generation = entry.generation_id
    if (generation === undefined || !wanted.has(generation)) continue
    // 只认 commit：`hold` 是冻结（还没扣）、`release` 是退回（不计消耗）、
    // `grant` 是充值（正数，与生成无关）。
    if (entry.entry_type !== 'commit') continue
    const credits = Math.abs(entry.amount)
    // 同一 generation 出现多条 commit 时取**绝对值最大**的那条，不是求和：
    // 求和会把「重试产生的重复条目」翻倍计费，而取最大在最常见的单条结算下
    // 完全等价 —— 宁可少算也不要多算。
    const prior = out.get(generation)
    if (prior === undefined || credits > prior) out.set(generation, credits)
  }
  return out
}

/**
 * 批量查实扣（`POST /canvas-studio/account/spend` 的实现）。
 *
 * 三态语义与报价一致：**查不到 ≠ 0**。`credits` 里没有的 id 就是「不知道」，
 * `pending` 里的才是「还在对账中」（生成刚结束、commit 还没落库）。
 */
export async function generationSpend(ids: readonly string[]): Promise<GenerationSpendView> {
  const d = deps
  /** 每次现读，不在开头快照：下面那次 `await refreshLedger` 正是在改这几个字段。 */
  const head = (): Pick<GenerationSpendView, 'enabled' | 'signedIn' | 'fetchedAt' | 'error'> => ({
    enabled: d !== null && d.enabled(),
    signedIn: getAuthSession() !== null,
    fetchedAt: ledgerFetchedAt === 0 ? null : new Date(ledgerFetchedAt).toISOString(),
    error: ledgerError,
  })
  const base = head()
  if (d === null || !base.enabled || !base.signedIn) {
    return { ...base, credits: {}, pending: [] }
  }
  const wanted = new Set(ids.filter((id) => GENERATION_ID_SHAPE.test(id)))
  if (wanted.size === 0) return { ...base, credits: {}, pending: [] }

  let index = commitCreditsIndex(wanted)
  // 值不值得打一次网络：有缺失，且（从未读过 / 流水已被标记陈旧 / 这个 id 本来就是
  // 我们登记过的待对账项）。三者任一成立才是「新的账可能刚到」。
  const missing = [...wanted].filter((id) => !index.has(id))
  const worthFetching = missing.length > 0
    && (ledgerFetchedAt === 0 || ledgerStale || missing.some((id) => spendPending.has(id)))
  if (worthFetching && Date.now() - lastSpendFetchAt >= SPEND_FETCH_MIN_INTERVAL_MS) {
    lastSpendFetchAt = Date.now()
    // 阻塞等待（一次本机 → 业务 API 的往返）：本次响应就要用这批数字，先返回旧的
    // 再异步补会让 UI 闪一下「—」。在飞去重由 refreshLedger 自己保证（并发节点合并）。
    await refreshLedger(true)
    index = commitCreditsIndex(wanted)
  }

  const credits: Record<string, number> = {}
  const pending: string[] = []
  for (const id of wanted) {
    const hit = index.get(id)
    if (hit !== undefined) {
      credits[id] = hit
      // 对上号就从待对账集合里摘掉（集合不会无限增长，也不会重复打网）。
      spendPending.delete(id)
      continue
    }
    if (spendPending.has(id)) pending.push(id)
  }
  // 重新读一次头：刚才那趟请求可能刚把流水刷成功（或刷失败），开头的快照已经
  // 过时 —— 拿旧快照会让「读失败的账」显示成「读成功但没有记录」。
  return { ...head(), credits, pending }
}

// ── 报价（预估积分的唯一出口）────────────────────────────────────────────────
//
// 报价是**纯计算**（不建任务、不冻结），所以不需要登录态以外的状态机；但它会被
// 「拖时长滑块」「连续改档位」高频触发，所以要有缓存与在飞去重。缓存键是计价
// 指纹（不含 prompt，见 `credit-quote.ts`）——同一指纹 5 分钟内直接返回。
//
// 拿不到 quote 时**不返回「不知道」**，而是用本地价目表算一个近似值并标
// `source: 'table'`（B2 离线兜底）。展示优先级恒为 quote > 表推算（标「约」）> —。
interface QuoteCacheEntry {
  /** 服务端报价结果（**只缓存 `source: 'quote'`**，理由见 `fallback` 的注释）。 */
  readonly view: AccountQuoteView
  readonly at: number
}
const quoteCache = new Map<string, QuoteCacheEntry>()
const quoteInFlight = new Map<string, Promise<AccountQuoteView>>()
/** 已告警过的 operation：价目表与服务端不符时每个只报一次，不刷日志。 */
const driftWarned = new Set<string>()

/**
 * 报一次价。**永不抛错**：报价失败不该让路由 500，也不该阻断提交（生成链的
 * quote 硬闸本来就是 fail-open，见 `generate.ts` 的 CS-BILL-002 注释）。
 */
export function quoteCredits(params: CreditQuoteParams): Promise<AccountQuoteView> {
  const d = deps
  const token = getAuthSession()?.accessToken ?? ''
  // 请求体与价目表先算好：兜底路径必须用**同一份** request —— 模型/operation/尺寸
  // 与真发出去的那次一模一样，否则兜底算的是另一笔钱。
  const request = quoteRequestFor(params)
  const table = loadPriceTable()

  /**
   * 兜底：本地价目表推算。
   *
   * 三个刻意的选择：
   * 1. **保留 `error`** —— 它就是「为什么这是估算」的解释，UI 挂进 title；
   * 2. **不进缓存** —— 估算值一旦缓存 5 分钟，网络恢复后仍显示旧推算；重试成本
   *    很低（失败是毫秒级），宁可每次都先去拿真报价；
   * 3. `credits` 仍可能是 `null`（表里没有这个 operation / 请求缺尺寸）——
   *    那才是真正的「不知道」，UI 显示 `—`。
   */
  const fallback = (code: string, message: string): AccountQuoteView => {
    const estimate = estimatePrice(request, table)
    return {
      model: request.model,
      operation: request.operation,
      credits: estimate === null ? null : estimate.credits,
      source: estimate === null ? null : 'table',
      breakdown: estimate === null ? null : estimate.lines,
      tableAgeDays: estimate?.ageDays ?? (table === null ? null : ageDaysOf(table.sampledAt)),
      fetchedAt: estimate === null ? null : new Date().toISOString(),
      error: { code, message },
    }
  }

  if (d === null || !d.enabled()) return Promise.resolve(fallback('account_disabled', '管理面未启用，无法报价。'))
  if (token === '') return Promise.resolve(fallback('unauthenticated', '尚未登录；显示的是本地价目表估算。'))
  if (disabled || creditsDisabled) return Promise.resolve(fallback('account_disabled', '账号受限；显示的是本地价目表估算。'))

  const key = quoteFingerprint(params)
  const hit = quoteCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < QUOTE_TTL_MS) {
    return Promise.resolve({ ...hit.view, fetchedAt: new Date(hit.at).toISOString() })
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
      const lines = breakdownOf(request, quote.estimated_credits, table, at)
      if (lines === null && table !== null && !driftWarned.has(request.operation)) {
        // 表存在却复算不出同一个数 ⇒ 后端改价了。每个 operation 只报一次：这是
        // 运维信号（该重跑 probe-pricing），不是用户可见的错误。
        driftWarned.add(request.operation)
        d.log.warn(
          `[canvas-studio] 价目表与 ${request.operation} 的服务端报价不符，明细拆解已关闭`
          + '（重跑 node scripts/probe-pricing.mjs）',
        )
      }
      const view: AccountQuoteView = {
        model: request.model,
        operation: request.operation,
        credits: quote.estimated_credits,
        source: 'quote',
        breakdown: lines,
        tableAgeDays: table === null ? null : ageDaysOf(table.sampledAt, at),
        fetchedAt: new Date(at).toISOString(),
        error: null,
      }
      if (quoteCache.size >= QUOTE_CACHE_MAX) {
        // 简单淘汰：删最早插入的一条（够用，不值得为 100 条写 LRU）。
        const oldest = quoteCache.keys().next()
        if (!oldest.done) quoteCache.delete(oldest.value)
      }
      quoteCache.set(key, { view, at })
      return view
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : 'network_error'
      const message = cause instanceof Error ? cause.message : String(cause)
      d.log.warn(`[canvas-studio] 报价失败（${code}），已降级为价目表估算：${message}`)
      return fallback(code, message)
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
  spendPending.clear()
  lastSpendFetchAt = 0
  ledgerFetchedAt = 0
  ledgerStale = false
  ledgerError = null
  ledgerDisabled = false
  quoteCache.clear()
  driftWarned.clear()
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
