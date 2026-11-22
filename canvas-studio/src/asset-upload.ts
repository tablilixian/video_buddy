/**
 * 素材三段式上传引擎（迁移方案 B2；api(12).md §6.6，2026-11-22）。
 *
 * 旧通道（multipart `POST /api/v1/generate/upload` → filename 句柄）随后台改版
 * 退役；新通道是**三段式**：
 *
 *   ① `POST /v1/assets/presign`（业务 API，Bearer）→ `{asset, upload_url, headers}`
 *   ② `PUT <upload_url>`（对象存储直传，**只带 presign.headers，不带任何鉴权头**）
 *   ③ `POST /v1/assets/complete`（业务 API，Bearer，SHA-256 校验）→ `status:'ready'` 的 asset
 *
 * 返回值语义从「服务器文件名」改为 **asset_id**：所有以 filename 为句柄的下游
 * （promote/heal/inputs 组装）在 B3 里按 asset_id 重连。句柄仍是字符串，调用方
 * 出口形状不变。
 *
 * 三条硬纪律（全部有断言测试钉住）：
 * 1. **PUT 不携带任何鉴权头**——presign 的 URL 自带签名，多余的 Authorization
 *    可能破坏对象存储签名校验（api(12).md §6.6.2 明文「不应带 Host 的 session
 *    cookie 或 renderer token」）。
 * 2. **upload_url 出站前过安全校验**——DramaClient.presignAsset 内置
 *    `assertSafeAssetUploadUrl`（https/回环、无 userinfo），本引擎只消费已校验的
 *    URL（CS-ASSET-005 是最后一道防线，防未来有人绕过 client 直调）。
 * 3. **只有 `status === 'ready'` 的 asset 才可作 inputs[] 引用**——complete 的
 *    非 ready 一律 CS-ASSET-003；409 conflict 是确定性坏消息（CS-ASSET-004）。
 */
import { createHash } from 'node:crypto'
import { DramaClient, ApiError, assertSafeAssetUploadUrl } from './drama-management.js'
import { classifyFile, extensionOf } from './media-extension.js'
import { makeCanvasError, throwError } from './error-system.js'
import './errors/catalog.js'
import { longRequestDispatcher } from './long-request.js'

/** PUT 直传的硬超时（毫秒）——与旧上传通道同一档（大视频需数十秒，5-10 分钟宽裕）。 */
export const ASSET_PUT_TIMEOUT_MS = 10 * 60_000

/**
 * 扩展名 → MIME 映射（api(12).md §6.6.1 支持清单为骨架，存量白名单扩展全部
 * 覆盖）。`.webm` 按视频口径（classifyFile 把 webm 归视频）。
 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
}

/** 上传引擎接受的素材类别（text 不进生成素材通道）。 */
export type AssetUploadKind = 'image' | 'video' | 'audio'

/**
 * 按扩展名判定素材类别；未知 / 文本类返回 null（调用方给出用户可见拒绝）。
 * 纯函数，与 `classifyFile` 同源（同一规则只准一份实现）。入参容忍带点/不带点。
 */
export function assetKindFromExtension(ext: string): AssetUploadKind | null {
  const normalized = ext.toLowerCase().replace(/^\./, '')
  if (normalized === '') return null
  const kind = classifyFile(`x.${normalized}`)
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
}

/** 扩展名 → Content-Type；未知扩展回 `application/octet-stream`（由 presign 拒收兜底）。 */
export function mimeTypeForExtension(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** 上传选项。`filename` 只作 presign 元数据（安全名由调用方生成，服务端不落地文件名）。 */
export interface AssetUploadOptions {
  readonly filename: string
  readonly kind: AssetUploadKind
  readonly signal?: AbortSignal
}

/** 上传一段字节，返回可直接引用的 `asset_id`（仅 ready 状态）。 */
export async function uploadAssetBytes(
  client: DramaClient,
  token: string,
  bytes: Uint8Array,
  opts: AssetUploadOptions,
): Promise<string> {
  // ① presign：业务 API 侧创建 asset 记录 + 预签名 PUT URL（201）。
  const presign = await withRateLimitRetry('presign', opts.signal, () =>
    client.presignAsset(token, {
      type: opts.kind,
      filename: opts.filename,
      content_type: mimeTypeForExtension(extensionOf(opts.filename)),
      size_bytes: bytes.byteLength,
    }),
  ).catch((cause: unknown) => {
    throw assetStageError('CS-ASSET-001', cause)
  })
  // upload_url 出站安全护栏（消费侧最后一道；DramaClient 协议层只解析不裁剪）。
  try {
    assertSafeAssetUploadUrl(presign.upload_url)
  } catch (cause) {
    throw makeCanvasError('CS-ASSET-005', {
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }

  // ② PUT 直传：只带 presign.headers（签名 URL 自带鉴权，任何多余头都可能破坏签名）。
  const put = await putWithTimeout(presign.upload_url, presign.headers, bytes, opts.signal)
  if (!put.ok) {
    throwError('CS-ASSET-002', { status: put.status, detail: `HTTP ${put.status}` })
  }

  // ③ complete：SHA-256（原始字节、小写 hex）+ 字节数交给服务端校验，ready 才算成功。
  const checksum = createHash('sha256').update(bytes).digest('hex')
  try {
    const asset = await withRateLimitRetry('complete', opts.signal, () =>
      client.completeAsset(token, {
        asset_id: presign.asset.id,
        checksum_sha256: checksum,
        size_bytes: bytes.byteLength,
      }),
    )
    return asset.id
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'conflict') {
      throwError('CS-ASSET-004', { detail: cause.message })
    }
    throw assetStageError('CS-ASSET-003', cause)
  }
}

/**
 * 把协议层异常翻译成素材通道错误码。ApiError（结构化）带 code/status 进 detail；
 * 其余按字符串。401/unauthenticated → `CS-AUTH-001` 是**语义保留**透传——那是
 * 登录自愈链的入口码（客户端静默刷新重推 → 仍失败弹登录窗），不能落成通用
 * 素材码让用户看到「重试也没用」。upload_url 护栏（CS-ASSET-005）在消费侧
 * 单独抛，不进本函数。
 */
function assetStageError(code: 'CS-ASSET-001' | 'CS-ASSET-003', cause: unknown): Error {
  if (cause instanceof ApiError && (cause.code === 'unauthenticated' || cause.status === 401)) {
    return makeCanvasError('CS-AUTH-001', { detail: `业务 API 拒绝凭据（HTTP ${cause.status}）` })
  }
  if (cause instanceof ApiError) {
    return makeCanvasError(code, {
      status: cause.status,
      detail: `${cause.code}（HTTP ${cause.status}）：${cause.message}`,
    })
  }
  return makeCanvasError(code, {
    status: 0,
    detail: cause instanceof Error ? cause.message : String(cause),
  })
}

/**
 * 429 限流的有界重试（presign+complete 共享 30 次/分钟用户限流，§6.12）：
 * 遵守 `Retry-After`（封顶 10s）+ 0-250ms 抖动，**只重试一次**——再触发就让
 * CS-ASSET-001/003 带着限流信息出去，由上层退避。
 */
async function withRateLimitRetry<T>(
  stage: 'presign' | 'complete',
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.code !== 'rate_limited' || cause.status !== 429) throw cause
    if (signal?.aborted === true) throw cause
    const waitMs = Math.min((cause.retryAfterSeconds ?? 1) * 1000, 10_000) + Math.random() * 250
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs)
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    return await run()
  }
  // stage 参数当前只用于日志可读性；保留形参让两个调用点语义显式。
  void stage
}

/**
 * 带超时 + 长请求 dispatcher 的 PUT。与 `dramaPost` 同口径：用户打断归一成
 * 取消码（CS-GEN-207），本地超时如实报档（CS-ASSET-002），网络错误不重试
 * （对象存储 PUT 幂等性未知，重试由上层整体重传决策）。
 */
async function putWithTimeout(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(ASSET_PUT_TIMEOUT_MS)
  const composed = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout
  const requestInit = {
    method: 'PUT',
    // ⚠️ 只带 presign.headers——**绝不**合并 dramaAuthHeaders / 任何 Bearer。
    headers,
    body: bytes,
    signal: composed,
  } as RequestInit & { dispatcher?: unknown }
  const dispatcher = longRequestDispatcher()
  if (dispatcher !== undefined) requestInit.dispatcher = dispatcher
  try {
    return await fetch(url, requestInit)
  } catch (cause) {
    if (signal?.aborted === true) {
      throw makeCanvasError('CS-GEN-207', { detail: cause instanceof Error ? cause.message : String(cause) })
    }
    if (timeout.aborted) {
      throwError('CS-ASSET-002', { status: 0, detail: `直传超时（${Math.round(ASSET_PUT_TIMEOUT_MS / 1000)}s）` })
    }
    throwError('CS-ASSET-002', {
      status: 0,
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
