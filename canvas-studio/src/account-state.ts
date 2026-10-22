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
import { DramaClient, ApiError, type CatalogModel } from './drama-management.js'

/** 目录缓存 TTL（毫秒）。 */
const CATALOG_TTL_MS = 5 * 60_000
/** 429 无 Retry-After / 503 的默认退避（毫秒）。 */
const DEFAULT_BACKOFF_MS = 30_000

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
}

/** bootstrap 主体：sync（用户 + 设备登记）→ models（目录）→ 回调。 */
async function runBootstrap(d: AccountStateDeps, token: string): Promise<void> {
  const client = new DramaClient({
    baseUrl: d.businessApiBase(),
    deviceId: d.device.deviceId,
    platform: d.device.platform,
    appVersion: d.device.appVersion,
  })
  try {
    await client.sync(token)
    const models = await client.listTextModels(token)
    bootstrappedToken = token
    catalogFetchedAt = Date.now()
    retryNotBefore = 0
    await d.onSessionToken(token)
    await d.onCatalogChanged(models, d.businessApiBase())
    d.log.info(`[canvas-studio] 管理面 bootstrap 完成：业务用户已同步，text 模型 ${models.length} 个`)
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.status === 401) {
        // token 过期：静默 —— client 会 TOKEN_REFRESHED 重推，推送即重试。
        return
      }
      if (cause.status === 403) {
        disabled = true
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
