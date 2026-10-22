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

  async #request<T>(
    token: string,
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
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
