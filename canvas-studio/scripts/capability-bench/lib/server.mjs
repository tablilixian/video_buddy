/**
 * 能力基准 · 静态服务（bundle + 素材池 + 字体 + 配置 + 回写）。
 *
 * 为什么不用 remotion 自带 serveUrl：我们要在**同一个源**下同时托管
 * ①打包后的 bundle ②从 VideoOut 池里引用的素材（跨目录，不复制）③中文字体
 * ④`/__config`（告诉页面这次渲哪条 composition）⑤`/__save`（把 blob 写回磁盘）。
 * 跨源会让 `<Video src>` 与 `@font-face` 静默失败，所以必须同源。
 */

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, join, normalize, resolve } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}
const mime = (file) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'

/** 防目录穿越：只允许落在给定根目录内。 */
function underRoot(root, relative) {
  const target = resolve(root, normalize(relative).replace(/^(\.\.(\/|\\|$))+/, ''))
  return target.startsWith(resolve(root)) ? target : null
}

/**
 * @param {{ bundleDir: string, outDir: string, pool: Record<string, string>, fontDir: string, config: unknown }} options
 */
export function startBenchServer(options) {
  const { bundleDir, outDir, pool, fontDir, config } = options
  mkdirSync(outDir, { recursive: true })

  return new Promise((resolveReady) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const send = (status, headers, body) => {
        res.writeHead(status, headers)
        if (body === undefined) res.end()
        else res.end(body)
      }

      // 1) 渲染进程回写产物
      if (req.method === 'POST' && url.pathname === '/__save') {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          const name = basename(url.searchParams.get('name') || 'out.bin')
          const target = join(outDir, name)
          writeFileSync(target, Buffer.concat(chunks))
          send(200, { 'content-type': 'text/plain' }, 'ok')
        })
        return
      }

      // 2) 这次渲哪条 composition
      if (url.pathname === '/__config') {
        send(200, { 'content-type': 'application/json' }, JSON.stringify(config))
        return
      }

      // 3) 素材池：/pool/<逻辑名>，逻辑名到绝对路径的映射由 driver 传入（跨目录引用，不复制）
      if (url.pathname.startsWith('/pool/')) {
        const key = decodeURIComponent(url.pathname.slice('/pool/'.length))
        const file = pool[key]
        if (!file || !existsSync(file)) {
          send(404, { 'content-type': 'text/plain' }, `pool miss: ${key}`)
          return
        }
        return streamFile(req, res, file)
      }

      // 4) 字体
      if (url.pathname.startsWith('/fonts/')) {
        const file = underRoot(fontDir, decodeURIComponent(url.pathname.slice('/fonts/'.length)))
        if (!file || !existsSync(file)) {
          send(404, { 'content-type': 'text/plain' }, 'font miss')
          return
        }
        return streamFile(req, res, file)
      }

      // 5) bundle 静态资源
      const file = underRoot(bundleDir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)))
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        send(404, { 'content-type': 'text/plain' }, 'not found')
        return
      }
      return streamFile(req, res, file)
    })

    server.listen(0, '127.0.0.1', () => {
      resolveReady({
        server,
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}/`,
      })
    })
  })
}

/** 支持 Range(206)：`<Video>` 的 seek 依赖它，返回 200 会导致抽帧异常。 */
function streamFile(req, res, file) {
  const size = statSync(file).size
  const range = req.headers.range
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    const start = match && match[1] ? Number.parseInt(match[1], 10) : 0
    const end = match && match[2] ? Number.parseInt(match[2], 10) : size - 1
    res.writeHead(206, {
      'content-type': mime(file),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
    })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': mime(file), 'content-length': size, 'accept-ranges': 'bytes' })
  createReadStream(file).pipe(res)
}
