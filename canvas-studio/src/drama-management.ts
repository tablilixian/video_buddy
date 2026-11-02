/**
 * DramaServer 管理面协议客户端（业务 API：auth/sync · models · credits/balance）。
 *
 * 平移自 reelsbuddy-desktop `src/host/business/drama-client.ts`（方案 P1，CV-355）：
 * token 只在 Host 进程流动、只进请求头；错误按服务端 `error.code` 结构化分派，
 * 不解析文案。`fetchImpl` 注入保可测。
 *
 * 接口约束见方案 `docs/plans/DramaServer-管理面接口接入方案.md` §0.3
 * （Bearer 头、429 Retry-After、403 禁用、401 等 client 重推、sync 幂等 + 全量设备信息）。
 */
import type {
  BillingCheckoutRequest,
  BillingCheckoutSession,
  BillingOverviewResponse,
  BillingPortalSession,
  CheckoutConflictReason,
} from './contracts/billing.js'

/** 服务端错误信封（api(10).md §6）。 */
export interface ApiErrorBody {
  error: { code: string; message: string }
}

/** 业务用户（auth/sync 返回）。 */
export interface ServerUser {
  id: string
  display_name?: string
  avatar_url?: string
  status: string
  locale: string
  created_at: string
  updated_at: string
}

/** 已登记设备（重复登记覆盖字段）。 */
export interface ServerDevice {
  device_id: string
  name: string
  platform: string
  app_version: string
}

/** 登录后的唯一 bootstrap 调用：一次拿到业务用户，同时完成设备登记更新。 */
export interface SyncResponse {
  user: ServerUser
  device: ServerDevice | null
}

/** 目录里的模型端点。 */
export interface ModelEndpoint {
  id: string
  provider_code: string
  provider_name: string
  endpoint_type: string
  region?: string
  status: string
  available: boolean
}

/** 模型目录条目（`/v1/models?modality=text`；判断 `available` 而非只看数组）。 */
export interface CatalogModel {
  id: string
  code: string
  display_name: string
  modality: string
  capabilities: Record<string, unknown>
  entitled: boolean
  available: boolean
  endpoints: ModelEndpoint[] | null
}

/** `/v1/models` 响应：`models` 空时是 `[]` 不是 `null`。 */
export interface ModelListResponse {
  models: CatalogModel[] | null
  entitlement: { plan_code?: string; features: Record<string, unknown>; models?: string[] | null }
}

/** 积分余额（金额固定 4 位小数 JSON number，展示不截断为整数）。 */
export interface CreditBalance {
  currency: string
  available_balance: number
  frozen_balance: number
  lots: { id: string; source: string; granted: number; remaining: number; status: string }[] | null
}

/** 保留服务端稳定错误码，调用方按 code 分派而不是解析文案。 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(code: string, message: string, status: number, retryAfterSeconds: number | null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface DramaClientOptions {
  /** 业务 API 基址（设置项 businessApiBase；与生成后端 dramaApiBase 同机不同端口）。 */
  baseUrl: string
  deviceId: () => string
  platform: () => string
  appVersion: () => string
  fetchImpl?: typeof fetch
}

export class DramaClient {
  readonly #baseUrl: string
  readonly #options: DramaClientOptions
  readonly #fetch: typeof fetch

  constructor(options: DramaClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#options = options
    this.#fetch = options.fetchImpl ?? fetch
  }

  get baseUrl(): string {
    return this.#baseUrl
  }

  /** 登录 bootstrap：业务用户同步 + 设备登记（幂等；每次发全量设备信息防覆盖置空）。 */
  async sync(token: string): Promise<SyncResponse> {
    const body = await this.#request<SyncResponse>(token, '/v1/auth/sync', {
      method: 'POST',
      body: {
        device: {
          device_id: this.#options.deviceId(),
          name: 'VideoBuddy Desktop',
          platform: this.#options.platform(),
          app_version: this.#options.appVersion(),
        },
      },
    })
    if (!body || typeof body.user?.id !== 'string') {
      throw new ApiError(
        'invalid_response',
        '登录 bootstrap 响应缺少 user 字段，客户端与服务端版本可能不一致。',
        502,
        null,
      )
    }
    return body
  }

  /** text 模型目录（网关只吃 text；`models` 为 null 按空数组处理）。 */
  async listTextModels(token: string): Promise<CatalogModel[]> {
    const response = await this.#request<ModelListResponse>(token, '/v1/models?modality=text')
    return response.models ?? []
  }

  /** 积分余额（仅展示语义，不做生成前预检）。 */
  async creditBalance(token: string): Promise<CreditBalance> {
    return this.#request<CreditBalance>(token, '/v1/credits/balance')
  }

  /**
   * 计费总览（`GET /v1/billing/overview`）：订阅 + 钱包 + 商品目录 + 待支付。
   *
   * **不要在 Host 侧假设字段一定存在**：实测 `pending_checkout` 是 omitempty，
   * 且 `credits` 在读不到钱包时会是 `null`。这里只做「形状没坏到不能用」的校验，
   * 具体降级交给 `billing-state.ts`。
   */
  async billingOverview(token: string): Promise<BillingOverviewResponse> {
    const body = await this.#request<BillingOverviewResponse>(token, '/v1/billing/overview')
    if (body === null || typeof body !== 'object') {
      throw new ApiError('invalid_response', '计费总览响应不是对象。', 502, null)
    }
    // 目录字段按数组兜底：服务端给 null 时不能让 Host 侧 `for...of` 直接 TypeError。
    return {
      ...body,
      plans: Array.isArray(body.plans) ? body.plans : [],
      credit_packs: Array.isArray(body.credit_packs) ? body.credit_packs : [],
    }
  }

  /**
   * 创建 Checkout（`POST /v1/billing/checkout-sessions`，上游 201）。
   *
   * `Idempotency-Key` 由调用方提供并**按购买意图复用**（方案 §5.3）：网络重试换
   * 键会让积分包重复下单，服务端的唯一键是 `(user_id, provider, idempotency_key)`。
   */
  async createBillingCheckout(
    token: string,
    request: BillingCheckoutRequest,
    idempotencyKey: string,
  ): Promise<BillingCheckoutSession> {
    const body = await this.#request<BillingCheckoutSession>(token, '/v1/billing/checkout-sessions', {
      method: 'POST',
      // 请求体只允许 kind + product_code：多带金额字段会被服务端 400 拒收。
      body: { kind: request.kind, product_code: request.product_code },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    const url = assertTrustedUrl(body?.checkout_url, ['checkout.stripe.com'], 'checkout_url')
    if (typeof body?.order_id !== 'string' || typeof body?.order_no !== 'string') {
      throw new ApiError('invalid_response', 'Checkout 响应缺少 order_id / order_no。', 502, null)
    }
    // 只把校验过的 URL 交出去：渲染层拿到的任何 URL 都会被 window.open 交给系统浏览器。
    return { ...body, checkout_url: url }
  }

  /**
   * 打开 Stripe Customer Portal（`POST /v1/billing/portal-sessions`，上游 201）。
   *
   * 无订阅 / manual 订阅 / 无 Stripe Customer 映射时上游返回 `409 portal_unavailable`
   * —— 那是**正常业务分支**，不是故障，由调用方分派文案。
   */
  async createBillingPortalSession(token: string): Promise<BillingPortalSession> {
    const body = await this.#request<BillingPortalSession>(token, '/v1/billing/portal-sessions', {
      method: 'POST',
    })
    return { portal_url: assertTrustedUrl(body?.portal_url, ['billing.stripe.com'], 'portal_url') }
  }

  async #request<T>(
    token: string,
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...options.headers,
    }
    let body: string | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    const response = await this.#fetch(this.#baseUrl + path, {
      method: options.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
    })
    if (!response.ok) throw await parseApiError(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

/** 错误信封解析：code 优先，`Retry-After` 头单独取，非 JSON 体回退 HTTP 状态文案。 */
export async function parseApiError(response: Response): Promise<ApiError> {
  const declared = Number(response.headers.get('Retry-After'))
  const retryAfter = Number.isFinite(declared) && declared > 0 ? declared : null
  let code = `http_${response.status}`
  let message = `请求失败（HTTP ${response.status}）`
  try {
    const body = (await response.json()) as ApiErrorBody
    if (body?.error?.code) code = body.error.code
    if (body?.error?.message) message = body.error.message
  } catch {
    // 非 JSON 响应体（网关错误页等）保留 HTTP 状态兜底文案。
  }
  return new ApiError(code, message, response.status, retryAfter)
}

/** 本地没有可用会话时 Host 自己抛的错误，形状与 ApiError 一致。 */
export function unauthenticated(message: string): ApiError {
  return new ApiError('unauthenticated', message, 401, null)
}

// ── 计费相关的协议层纯函数（方案 P1/§0.3）───────────────────────────────────
//
// 三个函数刻意放在协议层而不是 UI 层：它们都是「把服务端的松散事实翻译成有限
// 集合」，翻译规则一旦散落到组件里，两处结论迟早不一致（本项目已多次踩过）。
// 全部无副作用，可单测。

/**
 * 校验 Host 将要交给渲染层的 URL。
 *
 * 为什么要这一道：`checkout_url` / `portal_url` 最终会走 `window.open` →
 * `shell.openExternal`，把服务端返回的任意字符串交出去等于让远端决定本机打开什么。
 * **只比对 hostname 全等**（`endsWith` 会被 `checkout.stripe.com.evil.com` 绕过）。
 */
export function assertTrustedUrl(value: unknown, hosts: string[], field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError('invalid_response', `响应缺少 ${field}。`, 502, null)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ApiError('invalid_response', `${field} 不是合法 URL。`, 502, null)
  }
  if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname)) {
    throw new ApiError('invalid_response', `${field} 指向不可信地址（${parsed.hostname}）。`, 502, null)
  }
  return value
}

/**
 * 幂等键合法性（上游：1–200 字节、只允许可打印 ASCII 33–126）。
 *
 * Host 侧先校验一次的意义：非法键会被上游以 `400 invalid_argument` 打回，用户
 * 看到的是「商品信息已更新」这种误导文案；本地拦下能给出准确原因。
 */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value)
}

/**
 * 把 checkout 的 409 归一化成有限原因集合。
 *
 * **实测约束**：上游所有 409 的 `code` 都是 `conflict`，真实原因只在 `message`
 * 里（如 `idempotency key conflict`）。所以这里只能按 message 关键词分类 ——
 * 但分类结果稳定、可测，UI 与幂等键策略都只认这个枚举，不再各自 `includes()`。
 *
 * `expired` 是**终态三连**的合并（`checkout expired` / `checkout failed` /
 * `checkout already complete`）：三者处置相同（换新键 + 刷新 overview），
 * 差异只在文案，由 UI 按 `error.message` 原样展示给开发者排查。
 */
export function classifyCheckoutConflict(message: string): CheckoutConflictReason {
  const text = message.toLowerCase()
  if (text.includes('idempotency key conflict')) return 'idem_mismatch'
  if (text.includes('already pending')) return 'pending'
  if (text.includes('checkout expired') || text.includes('checkout failed') || text.includes('already complete')) {
    return 'expired'
  }
  if (text.includes('already active') || text.includes('subscription active') || text.includes('already subscribed')) {
    return 'subscribed'
  }
  if (
    text.includes('not purchasable') || text.includes('not configured') || text.includes('invalid price')
    || text.includes('invalid currency') || text.includes('product inactive')
  ) {
    return 'not_purchasable'
  }
  return 'unknown'
}
