/**
 * 带上限与超时的流式响应读取（CR-010 的唯一实现，2026-11-22 自 generate.ts 抽出）。
 *
 * 为什么独立成模块：旧 `downloadBytes`（generate.ts 私有）服务于「裸 URL 下载」，
 * 迁移 B3 后受保护内容端点（generation-client）也要走同一套限长/超时/打断语义
 * ——两处各抄一份迟早漂移，这里只留一份 reader 循环。
 *
 * 硬上限（迁移 B3 沿用 CR-010 数值）：媒体（视频）512MB / 20 分钟；图片 32MB / 4 分钟。
 * 桩环境（测试）可能不提供 `response.body`，此时回退 `arrayBuffer()` 并仍做大小校验。
 */
import { throwError } from './error-system.js'
import './errors/catalog.js'

export const MEDIA_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 20 * 60_000
export const IMAGE_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 4 * 60_000

export interface LimitedReadOptions {
  readonly maxBytes: number
  readonly timeoutMs: number
  readonly label: string
  readonly signal?: AbortSignal
}

/**
 * 按 maxBytes 流式读取 Response 体积；超限抛 CS-NET-008，HTTP 非 2xx 抛 CS-NET-007。
 * `timeoutMs` 用 AbortSignal.timeout 与调用方 signal 组合——注意组合后的 signal
 * 也要传给 fetch 本身（传输层打断），本函数只负责读侧。
 */
export async function fetchBodyLimited(
  url: string,
  init: RequestInit | undefined,
  opts: LimitedReadOptions,
): Promise<Buffer> {
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const composed = opts.signal !== undefined ? AbortSignal.any([opts.signal, timeout]) : timeout
  const response = await fetch(url, { ...init, signal: composed })
  if (!response.ok) throwError('CS-NET-007', { label: opts.label, status: response.status })
  return readBodyLimited(response, opts)
}

/**
 * 已拿到 Response 后的流式限长读取。content 端点的 Response 由调用方发起
 * （带鉴权、可能已带超时 signal），这里只管「读得多快、读到多大」。
 */
export async function readBodyLimited(response: Response, opts: LimitedReadOptions): Promise<Buffer> {
  const body = (response as { body?: ReadableStream<Uint8Array> | null }).body
  if (body === undefined || body === null) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > opts.maxBytes) {
      throwError('CS-NET-008', { label: opts.label, maxBytes: opts.maxBytes })
    }
    return bytes
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > opts.maxBytes) {
        throwError('CS-NET-008', { label: opts.label, maxBytes: opts.maxBytes })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
