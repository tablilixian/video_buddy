/**
 * 生成面任务引擎（迁移方案 B3-1；api(12).md §6.8-§6.10，2026-11-22）。
 *
 * generate.ts 六条工具链与视频 business provider 的**公共底座**，只做三件事：
 *
 * 1. **创建**：refs（asset_id）→ `inputs[]`（role/ordinal 白名单校验）→ 幂等 POST
 *    （`Idempotency-Key` 必填；intent 持久化由调用方注入，必须先于 POST 落盘）。
 * 2. **跟随**：`/poll` version 游标长轮询——`wait≤25s`、只认 `version` 推游标、
 *    瞬时错误（网络/429/5xx）指数退避 500ms→12s 封顶 + `Retry-After` 优先 + 抖动、
 *    4xx 业务错误即停；**终态只认 `terminal`**；用户打断尽力 `POST /cancel` 后抛
 *    取消码（CS-GEN-207）——新 API 可以撤回在途任务，不再留孤儿扣费。
 * 3. **下载**：受保护 content 端点流式限长读取（CR-010 语义，实现在 media-download.ts）。
 *
 * 本模块**不做**业务语义（工具上下文错误文案、台账落盘、产物落卡）——那些在
 * generate.ts 调用侧。协议层错误以 ApiError 原样上抛（结构化 code/status/retryAfter），
 * 调用侧翻译成 CS 码。
 */
import { randomUUID } from 'node:crypto'
import type { DramaClient } from './drama-management.js'
import { ApiError } from './drama-management.js'
import type { GenerationOperation, GenerationSnapshot, AssetRole } from './contracts/generation.js'
import {
  buildInputRefs,
  validateInputRefs,
} from './contracts/generation.js'
import { makeCanvasError } from './error-system.js'
import './errors/catalog.js'
import { IMAGE_DOWNLOAD_MAX_BYTES, IMAGE_DOWNLOAD_TIMEOUT_MS, MEDIA_DOWNLOAD_MAX_BYTES, MEDIA_DOWNLOAD_TIMEOUT_MS, readBodyLimited } from './media-download.js'
/** 引擎依赖（由 generate.ts 装配注入，避免模块环）。 */
export interface GenerationEngineDeps {
  readonly client: DramaClient
  /** 当前会话 access token（调用方现取；引擎不缓存）。 */
  readonly token: () => string
}

/** 创建请求的素材引用（asset 已上传 ready；ordinal 由引擎按 role 顺序分配）。 */
export interface GenerationRef {
  readonly assetId: string
  readonly role: AssetRole
}

/** 创建入参（generate.ts 六条链路 + 视频 provider 共用）。 */
export interface CreateGenerationRequest {
  readonly model: string
  readonly operation: GenerationOperation
  readonly input: Record<string, unknown>
  readonly refs: ReadonlyArray<GenerationRef>
  /** 幂等键：调用方生成并**先于 POST**持久化（intent）；网络重试必须复用。 */
  readonly idempotencyKey: string
  readonly clientRunId?: string
}

/** 创建请求体（幂等 intent 的指纹与重放载体）。 */
export interface CreateGenerationBody {
  readonly model: string
  readonly operation: string
  readonly input: Record<string, unknown>
  readonly inputs: readonly { asset_id: string; role: string; ordinal: number }[]
}

export interface CreateGenerationOptions {
  readonly signal?: AbortSignal
  /**
   * intent 持久化钩子：**在 POST 之前**调用（网络重试复用同 key 的凭据）。
   * 不注入则不持久化（仅测试/无台账场景）。
   */
  readonly persistIntent?: (intent: GenerationIntent) => Promise<void> | void
}

/** 幂等意图（台账持久化形状；字段与参考项目 client.js 同构）。 */
export interface GenerationIntent {
  readonly key: string
  readonly clientRunId?: string
  /** 完整请求体 JSON——参数或素材变化即换新 key 的判据。 */
  readonly fingerprint: string
  readonly body: CreateGenerationBody
  readonly createdAt: string
  readonly generationId?: string
  readonly version?: number
}

/**
 * 组装创建请求体：按 role 分配 ordinal（同 role 从 1 连续）并做白名单校验。
 * 校验不过抛 CS-GEN-206（调用侧有上下文补充文案）——服务端也会 400，但本地
 * 先拦能给出「哪一路素材配错了」的准确信息。
 */
export function buildCreateGenerationBody(request: CreateGenerationRequest): CreateGenerationBody {
  const refs = buildInputRefs(request.refs.map((ref) => ({ assetId: ref.assetId, role: ref.role })))
  if (refs === null) {
    throw new ApiError('invalid_argument', '同一素材被重复引用（asset_id 冲突）', 400, null)
  }
  const issues = validateInputRefs(request.operation, refs)
  if (issues.length > 0) {
    throw new ApiError('invalid_argument', `inputs 不满足 ${request.operation} 规格：${issues.join('；')}`, 400, null)
  }
  return {
    model: request.model,
    operation: request.operation,
    input: request.input,
    inputs: refs,
  }
}

/**
 * 创建生成任务（POST /v1/generations，上游 202）。
 *
 * 幂等纪律（api(12).md §6.8）：`persistIntent` 在 POST **前**落盘；网络失败由
 * 调用方复用原 key + 原 body 重试（本函数不自动重试 POST——创建失败的原因几乎
 * 不会自愈，且重试决策需要工具上下文）；**409 conflict 不自动换 key**，原样上抛。
 */
export async function createGenerationTask(
  deps: GenerationEngineDeps,
  request: CreateGenerationRequest,
  opts: CreateGenerationOptions = {},
): Promise<GenerationSnapshot> {
  const body = buildCreateGenerationBody(request)
  const intent: GenerationIntent = {
    key: request.idempotencyKey,
    ...(request.clientRunId !== undefined ? { clientRunId: request.clientRunId } : {}),
    fingerprint: JSON.stringify(body),
    body,
    createdAt: new Date().toISOString(),
  }
  if (opts.persistIntent !== undefined) {
    await opts.persistIntent(intent)
  }
  return deps.client.createGeneration(deps.token(), body, request.idempotencyKey, request.clientRunId)
}

/** 报价（预估积分）；形状/网络失败返回 null——报价不阻断提交（fail-open，§6.7）。 */
export async function quoteGenerationCost(
  deps: GenerationEngineDeps,
  request: Pick<CreateGenerationRequest, 'model' | 'operation' | 'input'>,
): Promise<number | null> {
  try {
    const quote = await deps.client.quoteGeneration(deps.token(), {
      model: request.model,
      operation: request.operation,
      input: request.input,
    })
    return quote.estimated_credits
  } catch {
    return null
  }
}

/** 跟随选项。 */
export interface FollowGenerationOptions {
  readonly signal?: AbortSignal
  /** 每次拿到新版本快照时回调（台账增量回写 / 进度展示）。 */
  readonly onSnapshot?: (snapshot: GenerationSnapshot) => void | Promise<void>
  /** 整体墙钟上限（毫秒）；超时先尽力 cancel 再抛 CS-PROV-014。 */
  readonly timeoutMs?: number
  /** 打断时是否撤销远端任务（默认 true：避免孤儿扣费）。 */
  readonly cancelOnAbort?: boolean
  /** 退避初值（毫秒），默认 500——测试注入 1ms 免等待。 */
  readonly backoffStartMs?: number
  /** 退避封顶（毫秒），默认 12000。 */
  readonly backoffCapMs?: number
}

const POLL_WAIT_SECONDS = 25

/** 用户打断 → 尽力取消远端 → 取消码（CV-239：CS-GEN-207，客户端移除占位而非标红）。 */
function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  const detail = reason instanceof Error ? reason.message : reason === undefined ? 'signal aborted' : String(reason)
  return makeCanvasError('CS-GEN-207', { detail })
}

function isRetriableStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500
}

/**
 * 跟随到终态（`terminal === true`）。返回**终态快照**。
 *
 * 轮询游标只认 `version`；等待超时响应仍是 200（不当错误）；4xx 业务错误立即
 * 上抛（重试没有意义）；`cancel_requested` / `finalizing` 继续轮询。
 */
export async function followGeneration(
  deps: GenerationEngineDeps,
  snapshot: GenerationSnapshot,
  opts: FollowGenerationOptions = {},
): Promise<GenerationSnapshot> {
  const cancelOnAbort = opts.cancelOnAbort !== false
  const deadline = Date.now() + (opts.timeoutMs ?? 2_400_000)
  const backoffStart = opts.backoffStartMs ?? 500
  const backoffCap = opts.backoffCapMs ?? 12_000
  let retryDelay = backoffStart
  let current = snapshot

  const cancelRemote = async (): Promise<void> => {
    if (!cancelOnAbort || current.terminal) return
    try {
      await deps.client.cancelGeneration(deps.token(), current.id)
    } catch {
      // 尽力取消：失败不掩盖原始错误（与 executor 的 cancel 语义一致）。
    }
  }

  // signal 的读取走函数：TS 会对「循环顶已判非中止」的表达式做跨 await 收窄，
  // 而 signal 可能在长轮询挂起的 25s 里才被 abort——收窄在这里是错的。
  const aborted = (): boolean => opts.signal?.aborted === true

  for (;;) {
    if (opts.signal?.aborted === true) {
      await cancelRemote()
      throw abortError(opts.signal)
    }
    if (Date.now() > deadline) {
      await cancelRemote()
      const seconds = Math.max(1, Math.round((opts.timeoutMs ?? 2_400_000) / 1000))
      // 与 executor 的超时码对齐（视频走 CS-PROV-014；图片调用侧可换 GEN 码）。
      throw makeCanvasError('CS-PROV-014', { seconds, label: 'generation' })
    }

    let next: GenerationSnapshot
    try {
      next = await deps.client.pollGeneration(
        deps.token(),
        current.id,
        current.version,
        POLL_WAIT_SECONDS,
      )
    } catch (cause) {
      if (aborted()) {
        await cancelRemote()
        throw abortError(opts.signal)
      }
      const status = cause instanceof ApiError ? cause.status : 0
      if (!isRetriableStatus(status) || retryDelay > backoffCap) {
        // 4xx 业务错误 / 退避到顶：原样上抛（ApiError 保留 code/status/retryAfter）。
        throw cause
      }
      const waitMs = cause instanceof ApiError && cause.retryAfterSeconds !== null
        ? cause.retryAfterSeconds * 1000
        : retryDelay
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitMs + Math.random() * 250)
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
      retryDelay = Math.min(retryDelay * 2, backoffCap)
      continue
    }

    const previousVersion = current.version
    current = next
    retryDelay = backoffStart
    if (opts.onSnapshot !== undefined) {
      await opts.onSnapshot(current)
    }
    // 终态只认服务端的 `terminal` 标志（§6.9.3：finalizing/cancel_requested 都不是终态）。
    if (current.terminal === true) {
      return current
    }
    // 步进节奏（防饿死事件循环）：版本推进了也要让出一拍 macrotask；版本没推进
    //（服务端立即返回等待超时快照）按 `poll_after_ms` 或 500ms 步进，不再空转打点。
    if (current.version === previousVersion) {
      await pace(current.poll_after_ms ?? 500, opts.signal)
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}

/** 可被 signal 打断的步进等待（打断后由循环顶统一走 cancel + 抛取消码）。 */
function pace(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/** content 下载选项（默认沿用 CR-010 的媒体/图片档）。 */
export interface DownloadContentOptions {
  readonly signal?: AbortSignal
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

/**
 * 从受保护 content 端点取输出字节（Bearer 由 DramaClient 注入）。
 * 410 gone（结果过期）等状态码由 DramaClient 的错误通道上抛（ApiError），
 * 调用侧翻译成 CS 码。
 */
export async function downloadGenerationContent(
  deps: GenerationEngineDeps,
  generationId: string,
  ordinal: number,
  opts: DownloadContentOptions = {},
): Promise<Buffer> {
  const response = await deps.client.openGenerationContent(deps.token(), generationId, ordinal)
  if (!response.ok) {
    // 与 fetchBodyLimited 的非 2xx 分支同码；label 给调用侧定位用。
    const { throwError } = await import('./error-system.js')
    throwError('CS-NET-007', { label: `生成结果 ${generationId}#${ordinal}`, status: response.status })
  }
  return readBodyLimited(response, {
    maxBytes: opts.maxBytes ?? MEDIA_DOWNLOAD_MAX_BYTES,
    timeoutMs: opts.timeoutMs ?? MEDIA_DOWNLOAD_TIMEOUT_MS,
    label: `生成结果 ${generationId}#${ordinal}`,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  })
}

/** 图片档下载参数（generate.ts 图像链路用）。 */
export const IMAGE_CONTENT_LIMITS = {
  maxBytes: IMAGE_DOWNLOAD_MAX_BYTES,
  timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
} as const

/** 新建幂等键（crypto UUID；§6.8 的 1-200 可打印 ASCII 约束天然满足）。 */
export function newIdempotencyKey(): string {
  return randomUUID()
}
