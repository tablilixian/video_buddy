import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import https from 'node:https'

/**
 * 同源代理：前端只请求 `${BASE_URL}api/proxy?target=<base>&path=<endpoint>`，由本中间件
 * 转发到真实的 Drama Backend。原因：Drama Backend 响应头没有 CORS，浏览器直连会被拦；
 * 经 Vite dev server 同源转发即可绕过。
 *
 * 关键：中间件必须在 configureServer 体内**同步注册**（不要返回 post-hook 函数），
 * 这样它位于 Vite 内部 SPA fallback 之前，才能抢在 index.html 兜底之前拦截 /api/*。
 * 沙箱可能注入非 `/` 的 base（如 /couple-flying-chess/），请求到达本中间件时尚未被 base
 * 中间件改写，因此 handler 内手动剥离 base 前缀再分发。
 */
function dramaProxyPlugin(): Plugin {
  const install = (server: any) => {
    const base: string = server.config?.base ?? '/'
    // 归一化：剥离 base 前缀，返回以 / 开头的路径（含 query）
    const normalize = (raw: string): string => {
      const q = raw.indexOf('?')
      const pathOnly = q >= 0 ? raw.slice(0, q) : raw
      const query = q >= 0 ? raw.slice(q) : ''
      const stripped = pathOnly.startsWith(base) ? pathOnly.slice(base.length) : pathOnly
      return '/' + stripped + query
    }

    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const norm = normalize(req.url ?? '')
      if (norm.startsWith('/api/proxy')) {
        handleProxy(req, res, norm)
      } else if (norm.startsWith('/api/fetch-to-upload')) {
        handleFetchToUpload(req, res, norm)
      } else {
        next()
      }
    })
  }

  return {
    name: 'drama-proxy',
    configureServer(server) {
      install(server)
    },
    configurePreviewServer(server) {
      install(server)
    },
  }
}

function handleProxy(req: IncomingMessage, res: ServerResponse, pathWithQuery: string) {
  const here = new URL(pathWithQuery, 'http://localhost')
  const target = here.searchParams.get('target')
  const path = here.searchParams.get('path') ?? ''
  if (!target) {
    res.statusCode = 400
    res.end('missing target')
    return
  }
  let base: URL
  try {
    base = new URL(target)
  } catch {
    res.statusCode = 400
    res.end('bad target')
    return
  }
  const upstream = new URL(path, base)
  const lib = upstream.protocol === 'https:' ? https : http

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    const lk = k.toLowerCase()
    if (lk === 'host' || lk === 'connection' || lk === 'transfer-encoding') continue
    headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  headers['host'] = upstream.host

  const options = {
    method: req.method,
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    path: upstream.pathname + upstream.search,
    headers,
    // 视频生成后端要跑几分钟才回响应头；给足 30 分钟，避免代理侧提前断开。
    timeout: 1_800_000,
  }

  const upstreamReq = lib.request(options, (upstreamRes) => {
    res.statusCode = upstreamRes.statusCode ?? 502
    for (const [k, v] of Object.entries(upstreamRes.headers)) {
      if (v === undefined) continue
      try {
        res.setHeader(k, v as string | string[])
      } catch {
        /* 忽略不可设响应头 */
      }
    }
    upstreamRes.pipe(res)
  })
  upstreamReq.on('error', (err) => {
    if (!res.headersSent) res.statusCode = 502
    res.end(`proxy error: ${String(err)}`)
  })
  req.pipe(upstreamReq)
}

function handleFetchToUpload(req: IncomingMessage, res: ServerResponse, pathWithQuery: string) {
  const here = new URL(pathWithQuery, 'http://localhost')
  const target = here.searchParams.get('target')
  const mediaUrl = here.searchParams.get('url')
  if (!target || !mediaUrl) {
    res.statusCode = 400
    res.end('missing target/url')
    return
  }
  const uploadUrl = new URL('/api/v1/generate/upload', target)

  // 文件名优先取 ?filename= 查询参数，否则取路径末段；并据扩展名推断 content-type。
  const u = new URL(mediaUrl)
  const fname = u.searchParams.get('filename') || u.pathname.split('/').pop() || 'asset.bin'
  const ext = (fname.split('.').pop() || '').toLowerCase()
  const mime: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
  }
  const contentType = mime[ext] || 'application/octet-stream'

  // 用 Node 22 内置 fetch + FormData + Blob：避免手写 multipart 被后端 ECONNRESET。
  fetch(mediaUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`media fetch ${r.status}`)
      return r.arrayBuffer()
    })
    .then(async (buf) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: contentType }), fname)
      const up = await fetch(uploadUrl, { method: 'POST', body: fd })
      const text = await up.text()
      res.setHeader('content-type', 'application/json')
      res.statusCode = up.status
      res.end(text)
    })
    .catch((err) => {
      console.error('[f2u] error', String(err), '->', uploadUrl.href)
      res.statusCode = 502
      res.end(String(err))
    })
}

export default defineConfig({
  base: '/',
  plugins: [dramaProxyPlugin()],
  server: {
    port: 5188,
    host: true,
  },
  preview: {
    port: 4188,
    host: true,
  },
})
