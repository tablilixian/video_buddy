/**
 * REQ-034 · S10 验证器主程序（CSR / route B 端到端）。
 *
 * 做什么：用 `@remotion/bundler` 打包 `entry.tsx` → 起本地静态服务（托管 bundle +
 * `assets/` 测试素材 + `/__save` 回写）→ 拉起 Electron 加载渲染页 → 页面在渲染进程里
 * 跑 `renderMediaOnWeb` → 产物落到 `out/` → 用系统 ffprobe 判定流构成 → 自动打开成片/剧照。
 *
 * 跑法（**须在有 GUI 的终端**，agent 会话无 GUI）：
 *   NODE_OPTIONS= node scripts/remotion-verify/make-assets.mjs      # 只需一次
 *   NODE_OPTIONS= node scripts/remotion-verify/verify.mjs
 *   只验打包（无 GUI、沙箱内可跑）：S10_BUNDLE_ONLY=1 NODE_OPTIONS= node scripts/remotion-verify/verify.mjs
 *   sandbox/GPU 报错兜底：CSR_NO_SANDBOX=1 ...
 *   超时：S10_TIMEOUT_MS（默认 900000）
 *
 * ⚠️ 只覆盖「组件 + renderMediaOnWeb 调用形态」，**不覆盖 B3 的渲染工单桥**。
 */

import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log, ok, warn, probe, resolveBinary } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const ENTRY = join(HERE, 'entry.tsx')
const ELECTRON_APP = join(HERE, 'electron')
const BUNDLE_DIR = join(HERE, 'out', 'bundle')
const OUT_DIR = join(HERE, 'out')
const ASSETS_DIR = join(HERE, 'assets')

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}
const mime = (p) => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

/** 打包入口：webpack 需要 `extensionAlias` 才能把产品源码的 `../x.js` 解析到 `.ts/.tsx`。 */
async function buildBundle() {
  const { bundle } = await import('@remotion/bundler')
  log('打包 bundle（webpack，一次性）…')
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    outDir: BUNDLE_DIR,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...(config.resolve ?? {}),
        extensionAlias: {
          ...((config.resolve && config.resolve.extensionAlias) || {}),
          '.js': ['.ts', '.tsx', '.js'],
        },
      },
    }),
  })
  return serveUrl
}

/** 静态服务：托管 bundle 与 `assets/`，支持 Range(206)；`/__save` 接收渲染进程回写的字节。 */
function startServer() {
  return new Promise((resolveReady) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')

      if (req.method === 'POST' && url.pathname === '/__save') {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          const name = (url.searchParams.get('name') || 'out.bin').replace(/[/\\]/g, '_')
          writeFileSync(join(OUT_DIR, name), Buffer.concat(chunks))
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('ok')
        })
        return
      }

      let filePath
      if (url.pathname.startsWith('/assets/')) {
        filePath = join(ASSETS_DIR, decodeURIComponent(url.pathname.slice('/assets/'.length)))
      } else {
        filePath = join(BUNDLE_DIR, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)))
      }

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404)
        res.end('not found')
        return
      }

      const size = statSync(filePath).size
      const range = req.headers.range
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        const start = match && match[1] ? Number.parseInt(match[1], 10) : 0
        const end = match && match[2] ? Number.parseInt(match[2], 10) : size - 1
        res.writeHead(206, {
          'content-type': mime(filePath),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        })
        createReadStream(filePath, { start, end }).pipe(res)
        return
      }
      res.writeHead(200, { 'content-type': mime(filePath), 'content-length': size, 'accept-ranges': 'bytes' })
      createReadStream(filePath).pipe(res)
    })
    server.listen(0, '127.0.0.1', () => resolveReady({ server, port: server.address().port }))
  })
}

/** 复用仓库里已有的 Electron（不额外下载）。 */
function electronBinary() {
  const requireFromDesktop = createRequire(join(REPO, 'dsh-plugin-desktop', 'package.json'))
  return requireFromDesktop('electron')
}

function runElectron(url, timeoutMs) {
  const binary = electronBinary()
  return new Promise((resolveDone) => {
    const child = spawn(binary, [ELECTRON_APP], {
      env: { ...process.env, S10_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let timer = null
    const finish = (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.kill('SIGKILL')
      resolveDone(code)
    }
    const inspect = (buffer) => {
      const text = buffer.toString()
      process.stdout.write(text)
      if (text.includes('"step":"finished"')) setTimeout(() => finish(0), 1500)
      if (text.includes('"step":"error"')) setTimeout(() => finish(1), 500)
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', (buffer) => process.stderr.write(buffer.toString()))
    child.on('exit', (code) => finish(code ?? 0))
    child.on('error', (error) => {
      warn(`Electron 启动失败：${error.message}`)
      finish(1)
    })
    timer = setTimeout(() => {
      warn(`渲染超时（${timeoutMs}ms），强制结束`)
      finish(1)
    }, timeoutMs)
  })
}

/** 列出产物 + ffprobe 流构成 + 自动打开。 */
function reportOutputs() {
  if (!existsSync(OUT_DIR)) return
  const files = readdirSync(OUT_DIR).filter((name) => /\.(mp4|png)$/.test(name)).sort()
  const ffprobe = resolveBinary('FFPROBE_PATH', 'ffprobe') ?? 'ffprobe'
  for (const name of files) {
    const file = join(OUT_DIR, name)
    const info = probe(file, ffprobe)
    log(`${name}  bytes=${statSync(file).size}  streams=[${info.streams.join(', ')}]  duration=${info.durationSec ?? '?'}s`)
  }
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  for (const name of files) spawnSync(opener, [join(OUT_DIR, name)], { stdio: 'ignore' })
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  if (!process.env.S10_BUNDLE_ONLY && !existsSync(join(ASSETS_DIR, 'clip.mp4'))) {
    throw new Error('缺少测试素材：先跑 NODE_OPTIONS= node scripts/remotion-verify/make-assets.mjs')
  }

  await buildBundle()

  if (process.env.S10_BUNDLE_ONLY === '1') {
    ok('bundle 打包通过（S10_BUNDLE_ONLY=1，未起 Electron）')
    return
  }

  const { server, port } = await startServer()
  const url = `http://127.0.0.1:${port}/`
  log('静态服务：', url)
  const timeoutMs = Number(process.env.S10_TIMEOUT_MS || 900000)
  const code = await runElectron(url, timeoutMs)
  server.close()
  reportOutputs()
  if (code !== 0) {
    warn('渲染未正常完成（见上方 [page] / [verify] 日志）')
    process.exitCode = 1
  } else {
    ok('端到端渲染完成')
  }
}

main().catch((error) => {
  warn(error && error.message ? error.message : String(error))
  process.exitCode = 1
})
