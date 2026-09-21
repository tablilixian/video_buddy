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

/** 经同源代理调用 Drama 端点。signal 用于「随时停止测试」——中断在途请求。 */
export async function proxyCall(
  baseUrl: string,
  endpoint: EndpointDef,
  values: Record<string, string>,
  file: File | null,
  signal?: AbortSignal,
): Promise<CallResult> {
  const target = encodeURIComponent(baseUrl)
  const url = `${import.meta.env.BASE_URL}api/proxy?target=${target}&path=${encodeURIComponent(endpoint.path)}`
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
