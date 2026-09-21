import type { EndpointDef } from './endpoints'

export interface CallResult {
  status: number
  ok: boolean
  ms: number
  text: string
  json: unknown | null
  mediaUrl: string | null
  mediaType: 'image' | 'video' | 'audio' | null
  handle: string | null
}

function absolutize(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

function inferMedia(json: Record<string, unknown> | null, base: string): {
  mediaUrl: string | null
  mediaType: 'image' | 'video' | 'audio' | null
} {
  if (json === null) return { mediaUrl: null, mediaType: null }
  // Drama 生成类端点返回 full_url（部分也可能用 url），优先取 full_url。
  const url = typeof json.full_url === 'string' ? json.full_url : typeof json.url === 'string' ? json.url : null
  if (url === null) return { mediaUrl: null, mediaType: null }
  const abs = absolutize(url, base)
  // 注意：Drama 的生成类响应都带 duration，但那是**生成耗时(秒)**，不是媒体时长。
  // 因此必须先按扩展名判定，扩展名不可辨时才退回 duration 猜测，否则图片会被误判成视频。
  let mediaType: 'image' | 'video' | 'audio' | null
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(url)) mediaType = 'image'
  else if (/\.(mp4|webm|mov|mkv)$/i.test(url)) mediaType = 'video'
  else if (/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(url)) mediaType = 'audio'
  else if (typeof json.duration === 'number') mediaType = 'video'
  else mediaType = 'image'
  return { mediaUrl: abs, mediaType }
}

/** 解析一次代理响应 → CallResult（各入口共用，保证判定口径一致）。 */
async function finishCall(res: Response, baseUrl: string, start: number): Promise<CallResult> {
  const ms = Math.round(performance.now() - start)
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = null
  }
  const { mediaUrl, mediaType } = inferMedia(json, baseUrl)
  const handle = json !== null && typeof json.name === 'string' ? (json.name as string) : null
  return { status: res.status, ok: res.ok, ms, text, json, mediaUrl, mediaType, handle }
}

function proxyUrl(baseUrl: string, path: string): string {
  const target = encodeURIComponent(baseUrl)
  return `${import.meta.env.BASE_URL}api/proxy?target=${target}&path=${encodeURIComponent(path)}`
}

/** 经同源代理调用 Drama 端点。signal 用于「随时停止测试」——中断在途请求。 */
export async function proxyCall(
  baseUrl: string,
  endpoint: EndpointDef,
  values: Record<string, string>,
  file: File | null,
  signal?: AbortSignal,
): Promise<CallResult> {
  const url = proxyUrl(baseUrl, endpoint.path)
  const start = performance.now()
  let res: Response
  if (endpoint.method === 'GET') {
    res = await fetch(url, { method: 'GET', signal })
  } else if (endpoint.consumes === 'multipart') {
    const fd = new FormData()
    if (file) fd.append('file', file)
    res = await fetch(url, { method: 'POST', body: fd, signal })
  } else {
    const body = endpoint.buildBody ? endpoint.buildBody(values) : values
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }
  return finishCall(res, baseUrl, start)
}

/**
 * 发**原始请求体**（绕过 `buildBody`）。
 *
 * 负向用例专用：它要发的就是「用户不该发的那种请求」（缺必填、非法枚举、类型错），
 * 走 `buildBody` 会被规整成合法体，测不到东西。
 */
export async function proxyCallRaw(
  baseUrl: string,
  path: string,
  body: Record<string, unknown> | null,
  multipart = false,
  signal?: AbortSignal,
): Promise<CallResult> {
  const url = proxyUrl(baseUrl, path)
  const start = performance.now()
  let res: Response
  if (multipart) {
    // 故意不带 file 的 multipart：验证后端对「必填文件缺失」的反应
    res = await fetch(url, { method: 'POST', body: new FormData(), signal })
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    })
  }
  return finishCall(res, baseUrl, start)
}

/** 服务端代 fetch 远程媒体字节 → upload，返回句柄 name（绕开前端 CORS）。 */
export async function fetchToUpload(baseUrl: string, mediaUrl: string, signal?: AbortSignal): Promise<{ name: string }> {
  const target = encodeURIComponent(baseUrl)
  const url = `${import.meta.env.BASE_URL}api/fetch-to-upload?target=${target}&url=${encodeURIComponent(mediaUrl)}`
  const res = await fetch(url, { method: 'POST', signal })
  const json = (await res.json()) as { name?: string }
  if (!json.name) throw new Error('转存失败：未返回 name')
  return { name: json.name }
}

/** 经同源代理取回远程媒体字节（绕开前端 CORS），供批量测试自动多部件上传用。 */
export async function fetchMediaBytes(baseUrl: string, mediaUrl: string, signal?: AbortSignal): Promise<Blob> {
  const target = encodeURIComponent(baseUrl)
  const url = `${import.meta.env.BASE_URL}api/fetch-media?target=${target}&url=${encodeURIComponent(mediaUrl)}`
  const res = await fetch(url, { method: 'GET', signal })
  if (!res.ok) throw new Error(`取回媒体失败 HTTP ${res.status}`)
  return res.blob()
}

/** 判断异常是否为「用户主动中断」（AbortController.abort）。 */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : /aborted|abort/i.test(String((e as Error)?.message ?? e))
}

// ===== 重试 =====
//
// 为什么需要：实测上传 ~1MB 文件会偶发 `socket hang up`（后端接受了连接但中途断掉），
// 重传一次就成功。而「上传失败」在下游看起来是句柄拿不到，整条链路连带失败 ——
// 花 400ms 重试远比让用户重跑整轮划算。
//
// 什么**不**重试：
//   · 用户主动中止（aborted）—— 重试会违背「随时停止」；
//   · HTTP 4xx —— 请求本身错了，重试一百次还是 4xx，只会拖慢。

export interface RetryOutcome<T> {
  value: T
  /** 实际尝试次数（1 = 首次即成功）。 */
  attempts: number
  /** 之前失败的原因（用于在报告里说明「重试过」）。 */
  failures: string[]
}

export interface RetryOpts<T> {
  /** 最大重试次数（默认 2 → 最多 3 次尝试）。 */
  times?: number
  /** 退避基数（毫秒），第 n 次重试等 baseMs * 2^(n-1)。 */
  baseMs?: number
  signal?: AbortSignal
  /** 返回值层面的「不值得信」判定（如 HTTP 5xx）。返回 true 则重试。 */
  retryOnValue?: (v: T) => boolean
  /** 每次重试前回调，用于把「正在重试第 N 次」显示给用户。 */
  onRetry?: (attempt: number, reason: string) => void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/**
 * 带退避的重试。
 *
 * 语义：fn 抛异常 或 `retryOnValue(value)` 为真 → 重试；耗尽后
 *  · 若最后一次是**异常** → 抛出该异常（沿用调用点的 catch）；
 *  · 若最后一次是**坏值** → 返回该值（调用点自己按 HTTP 状态处理）。
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOpts<T> = {}): Promise<RetryOutcome<T>> {
  const times = opts.times ?? 2
  const baseMs = opts.baseMs ?? 400
  const failures: string[] = []
  let lastError: unknown = null

  for (let attempt = 1; attempt <= times + 1; attempt++) {
    if (attempt > 1) {
      // 让上一步的 UI 先渲染，也避免「重试」把「停止」卡住
      await sleep(baseMs * 2 ** (attempt - 2), opts.signal)
    }
    try {
      const value = await fn(attempt)
      if (opts.retryOnValue?.(value) && attempt <= times) {
        const reason = `第 ${attempt} 次返回不可信结果`
        failures.push(reason)
        opts.onRetry?.(attempt, reason)
        continue
      }
      return { value, attempts: attempt, failures }
    } catch (e) {
      // 用户中止 / 4xx 类错误：不重试，直接抛出
      if (isAbortError(e)) throw e
      lastError = e
      const reason = `第 ${attempt} 次失败：${String((e as Error)?.message ?? e).slice(0, 120)}`
      failures.push(reason)
      if (attempt > times) break
      opts.onRetry?.(attempt, reason)
    }
  }
  throw lastError ?? new Error('重试耗尽')
}

/** HTTP 5xx 才值得重试（4xx 是请求本身的问题）。 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500
}
