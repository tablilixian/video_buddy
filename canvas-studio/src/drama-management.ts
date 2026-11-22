/**
 * DramaServer 协议客户端（业务 API：管理面 auth/sync · models · credits/balance ·
 * billing/* + 生成面 generations · quote · assets/presign|complete · content）。
 *
 * 管理面平移自 reelsbuddy-desktop `src/host/business/drama-client.ts`（方案 P1，CV-355）；
 * 生成面方法为 2026-11-22 迁移方案 B1 增补（`docs/plans/DramaServer-生成面迁移方案-20261122.md`）。
 * token 只在 Host 进程流动、只进请求头；错误按服务端 `error.code` 结构化分派，
 * 不解析文案。`fetchImpl` 注入保可测。
 *
 * 接口约束见方案 `docs/plans/DramaServer-管理面接口接入方案.md` §0.3
 * （Bearer 头、429 Retry-After、403 禁用、401 等 client 重推、sync 幂等 + 全量设备信息）
 * 与 `docs/plans/DramaServer-生成面迁移方案-20261122.md` §7（幂等键、轮询游标、上传 URL 校验）。
 */
import type {
  BillingCheckoutRequest,
  BillingCheckoutSession,
  BillingOverviewResponse,
  BillingPortalSession,
  CheckoutConflictReason,
} from './contracts/billing.js'
import type {
  AssetCompleteRequest,
  AssetPresignRequest,
  AssetPresignResponse,
  AssetSummary,
  GenerationListQuery,
  GenerationQuote,
  GenerationSnapshot,
} from './contracts/generation.js'
import {
  buildGenerationListQuery,
  formatPollWait,
  isGenerationId,
  isValidGenerationIdempotencyKey,
  modelOperations,
  parseAssetCompleteResponse,
  parseAssetPresignResponse,
  parseGenerationQuote,
  parseGenerationSnapshot,
} from './contracts/generation.js'

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

  // ── 生成面业务 API（api(12).md §6，迁移方案 B1）───────────────────────────

  /**
   * 全模态模型目录（生成面用：按 `capabilities.operations` 过滤可提交模型）。
   * 与 {@link listTextModels} 的差别只在**不过滤 modality**——网关仍只吃 text，
   * 媒体模型（image/video/audio）从这里取。
   */
  async listMediaModels(token: string): Promise<CatalogModel[]> {
    const response = await this.#request<ModelListResponse>(token, '/v1/models')
    return response.models ?? []
  }

  /**
   * 报价（`POST /v1/generations/quote`，上游 200；§3.7/§6.7）。
   * 不建任务、不冻结积分；请求体只允许 model/operation/input（Host 会剔除
   * inputs）。形状不对返回 `invalid_response`（502）——报价坏了不该让调用方
   * 拿到 undefined。
   */
  async quoteGeneration(
    token: string,
    request: { model: string; operation: string; input: Record<string, unknown> },
  ): Promise<GenerationQuote> {
    const body = await this.#request<unknown>(token, '/v1/generations/quote', {
      method: 'POST',
      body: request,
    })
    const quote = parseGenerationQuote(body)
    if (quote === null) {
      throw new ApiError('invalid_response', '报价响应缺少 estimated_credits。', 502, null)
    }
    return quote
  }

  /**
   * 创建生成任务（`POST /v1/generations`，上游 **202**；§6.8）。
   *
   * `Idempotency-Key` 必填（同 key 同 body 幂等重放，同 key 异 body 409）；
   * `clientRunId` 可选（排障关联，不作为恢复主键）。**响应丢失时调用方必须
   * 复用原 key + 原 body 重试**，409 冲突不许自动换键。
   */
  async createGeneration(
    token: string,
    request: { model: string; operation: string; input?: Record<string, unknown>; inputs?: unknown[] },
    idempotencyKey: string,
    clientRunId?: string,
  ): Promise<GenerationSnapshot> {
    if (!isValidGenerationIdempotencyKey(idempotencyKey)) {
      throw new ApiError('invalid_argument', '幂等键必须为 1-200 字节可打印 ASCII。', 400, null)
    }
    const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey }
    if (clientRunId !== undefined && clientRunId.trim() !== '') headers['X-Client-Run-ID'] = clientRunId
    const body = await this.#request<unknown>(token, '/v1/generations', {
      method: 'POST',
      body: request,
      headers,
    })
    const snapshot = parseGenerationSnapshot(body)
    if (snapshot === null) {
      throw new ApiError('invalid_response', '创建响应不是合法任务快照。', 502, null)
    }
    return snapshot
  }

  /**
   * 长轮询（`GET /v1/generations/{id}/poll`；§6.9.2）。`waitSeconds` 钳到 0..25。
   * **游标只认 `version`**：`afterVersion` 传上一帧快照的 `version`。
   */
  async pollGeneration(
    token: string,
    id: string,
    afterVersion: number,
    waitSeconds = 25,
  ): Promise<GenerationSnapshot> {
    if (!isGenerationId(id)) throw new ApiError('invalid_argument', `非法 generation id: ${id}`, 400, null)
    const version = Number.isInteger(afterVersion) && afterVersion >= 0 ? afterVersion : 0
    const body = await this.#request<unknown>(
      token,
      `/v1/generations/${id}/poll?after_version=${version}&wait=${formatPollWait(waitSeconds)}`,
    )
    const snapshot = parseGenerationSnapshot(body)
    if (snapshot === null) {
      throw new ApiError('invalid_response', '轮询响应不是合法任务快照。', 502, null)
    }
    return snapshot
  }

  /** 任务列表（`GET /v1/generations`；§6.9.4，恢复兜底用）。 */
  async listGenerations(
    token: string,
    query: GenerationListQuery = {},
  ): Promise<{ generations: GenerationSnapshot[]; next_cursor?: string }> {
    const body = await this.#request<{ generations?: unknown; next_cursor?: unknown }>(
      token,
      `/v1/generations${buildGenerationListQuery(query)}`,
    )
    const generations: GenerationSnapshot[] = []
    for (const item of Array.isArray(body?.generations) ? body!.generations : []) {
      const snapshot = parseGenerationSnapshot(item)
      // 单条形状坏不整页丢：坏帧跳过（列表是恢复兜底，不是结算凭据）。
      if (snapshot !== null) generations.push(snapshot)
    }
    return typeof body?.next_cursor === 'string' && body.next_cursor !== ''
      ? { generations, next_cursor: body.next_cursor }
      : { generations }
  }

  /**
   * 请求取消（`POST /v1/generations/{id}/cancel`，上游 202；§6.9.5）。
   * 非终态任务先进入 `cancel_requested`——**取消后必须继续轮询到 terminal**。
   */
  async cancelGeneration(token: string, id: string): Promise<GenerationSnapshot> {
    if (!isGenerationId(id)) throw new ApiError('invalid_argument', `非法 generation id: ${id}`, 400, null)
    const body = await this.#request<unknown>(token, `/v1/generations/${id}/cancel`, { method: 'POST' })
    const snapshot = parseGenerationSnapshot(body)
    if (snapshot === null) {
      throw new ApiError('invalid_response', '取消响应不是合法任务快照。', 502, null)
    }
    return snapshot
  }

  /**
   * 打开受保护内容端点（`GET /v1/generations/{id}/content/{ordinal}`；§6.10）。
   *
   * 返回**原始 Response**（二进制流式读取交给调用方，带 CR-010 限长）——不进
   * `#request` 的 JSON 通道。410 gone（结果过期）等状态码由调用方按业务分派。
   */
  async openGenerationContent(token: string, id: string, ordinal: number): Promise<Response> {
    if (!isGenerationId(id)) throw new ApiError('invalid_argument', `非法 generation id: ${id}`, 400, null)
    if (!Number.isInteger(ordinal) || ordinal < 0) {
      throw new ApiError('invalid_argument', `非法输出序号: ${ordinal}`, 400, null)
    }
    const response = await this.#fetch(`${this.#baseUrl}/v1/generations/${id}/content/${ordinal}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
    })
    return response
  }

  /**
   * 创建素材预签名（`POST /v1/assets/presign`，上游 201；§6.6.1）。
   * 返回的 `upload_url` 已过 {@link assertSafeAssetUploadUrl}——不合格 502，
   * 不把不可信 URL 交给上层。
   */
  async presignAsset(token: string, request: AssetPresignRequest): Promise<AssetPresignResponse> {
    const body = await this.#request<unknown>(token, '/v1/assets/presign', {
      method: 'POST',
      body: request,
    })
    const parsed = parseAssetPresignResponse(body)
    if (parsed === null) {
      throw new ApiError('invalid_response', 'presign 响应缺少 asset/upload_url。', 502, null)
    }
    assertSafeAssetUploadUrl(parsed.upload_url)
    return parsed
  }

  /**
   * 完成上传（`POST /v1/assets/complete`，上游 200；§6.6.3）。
   * 只有 `status === 'ready'` 才算成功；checksum 不一致上游 409 由
   * `#request` 的错误通道抛出。
   */
  async completeAsset(token: string, request: AssetCompleteRequest): Promise<AssetSummary> {
    const body = await this.#request<unknown>(token, '/v1/assets/complete', {
      method: 'POST',
      body: request,
    })
    const asset = parseAssetCompleteResponse(body)
    if (asset === null) {
      throw new ApiError('invalid_response', '素材校验未完成（响应缺失 id/status=ready）。', 502, null)
    }
    return asset
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
 * presign 返回的 `upload_url` 安全校验（api(12).md §6.6.1；与参考项目
 * routes.ts `isSafeAssetUploadURL` 同口径）：只允许 **https 或回环 http**，
 * 且 URL 不能携带用户名/密码。不合格抛 `invalid_response`（502）——这个 URL
 * 马上会被 Host 直接 PUT 字节，等于让远端决定本机向哪里发数据。
 *
 * 回环放行是给本地联调的 presign（自建 MinIO 等）用的；生产域名必然 https。
 */
export function assertSafeAssetUploadUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ApiError('invalid_response', 'upload_url 不是合法 URL。', 502, null)
  }
  const isLoopbackHttp = parsed.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
    throw new ApiError('invalid_response', `upload_url 必须是 https 或回环地址（收到 ${parsed.protocol}）。`, 502, null)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ApiError('invalid_response', 'upload_url 不允许携带用户名/密码。', 502, null)
  }
  return value
}

/**
 * 模型是否可用于指定 operation（api(12).md §6.4 模型选择规则）：
 * `capabilities.operations` 显式包含 + `available !== false` + `entitled !== false`。
 * 目录未声明 `operations` 时返回 false——生成面**要求显式声明**，未声明的模型
 * 不许提交（宁可报「无可用模型」也不盲猜）。
 */
export function modelSupportsOperation(
  model: { capabilities: Record<string, unknown>; available?: boolean; entitled?: boolean },
  operation: string,
): boolean {
  if (model.available === false || model.entitled === false) return false
  const operations = modelOperations(model.capabilities)
  return operations !== null && operations.includes(operation)
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
