// 布局表达力压测探针（2026-10-26，临时文件，仿 render-host-e2e.probe.mjs）。
//
// 目的：回答「用项目现有契约（box / animate / textCard / shape）能表现多复杂的版式」——
// 用一份新闻直播版式 manifest（12s：左下播音员 + 右上新闻窗 + 右下 GDP 柱状图
// → 新闻全屏 → 回窗口 + 播音员回归 → 播音员全屏）真实渲出 mp4。
//
// 运行（canvas-studio 目录，Electron main 里跑）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/layout-demo.probe.mjs
//
// 输入：/tmp/cs-layout-demo/manifest.json + /tmp/cs-layout-demo/assets/*.mp4
// 输出：/tmp/cs-layout-demo/out.mp4（成片）；/tmp/cs-layout-demo/steps.log（过程）。

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app } from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const workDir = '/tmp/cs-layout-demo'
mkdirSync(workDir, { recursive: true })
const stepLog = join(workDir, 'steps.log')
const step = (tag, extra) => {
  const line = `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`
  try { appendFileSync(stepLog, line + '\n') } catch { /* 忽略 */ }
  console.log(line)
}

const loadLib = (rel) => import(pathToFileURL(join(packageRoot, 'lib', rel)).href)
const { ensureRenderHost } = await loadLib('render-host/window.js')
const { renderHostHtml } = await loadLib('render-host/page.js')
const { recordRenderHostReport, resetRenderHostReport, renderHostReady } = await loadLib('render-host/status.js')
const renderHostBundle = readFileSync(join(packageRoot, 'lib', 'render-host.js'))

const manifest = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8'))
const assets = {
  '/canvas-studio/assets/news-a.mp4': readFileSync(join(workDir, 'assets', 'news-a.mp4')),
  '/canvas-studio/assets/news-b.mp4': readFileSync(join(workDir, 'assets', 'news-b.mp4')),
  '/canvas-studio/assets/news-c.mp4': readFileSync(join(workDir, 'assets', 'news-c.mp4')),
  '/canvas-studio/assets/anchor-a.mp4': readFileSync(join(workDir, 'assets', 'anchor-a.mp4')),
  '/canvas-studio/assets/anchor-b.mp4': readFileSync(join(workDir, 'assets', 'anchor-b.mp4')),
  '/canvas-studio/assets/anchor-c.mp4': readFileSync(join(workDir, 'assets', 'anchor-c.mp4')),
}

const job = {
  jobId: 'rj-layout-demo-0001',
  projectId: 'proj-layout-demo',
  manifest,
  fps: manifest.meta.fps,
  quality: 'final',
  realDurations: {},
  sampleFrames: [0, 90, 180, 270, manifest.meta.durationInFrames - 1],
}

let jobDispatchable = false
let firstIdleAt = -1
let committedBytes = null
let cancelledReason = null
const commitWaiters = []

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const chunks = []
  req.on('data', (c) => { chunks.push(c) })
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const json = (code, value) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/render-host') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderHostHtml())
      return
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/render-host.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderHostBundle)
      return
    }
    if (req.method === 'GET' && assets[url.pathname] !== undefined) {
      const file = assets[url.pathname]
      const range = req.headers.range
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        const start = m && m[1] ? Number.parseInt(m[1], 10) : 0
        const end = m && m[2] ? Number.parseInt(m[2], 10) : file.length - 1
        res.writeHead(206, {
          'content-type': 'video/mp4',
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${file.length}`,
          'accept-ranges': 'bytes',
        })
        res.end(file.subarray(start, end + 1))
        return
      }
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': file.length, 'accept-ranges': 'bytes' })
      res.end(file)
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/render-host/status') {
      try {
        const report = JSON.parse(body.toString('utf8') || '{}')
        recordRenderHostReport(report)
        if (report.state === 'idle' && firstIdleAt < 0) {
          firstIdleAt = Date.now()
          jobDispatchable = true
        }
      } catch { /* 忽略脏心跳 */ }
      json(200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/remotion/pending') {
      json(200, { job: jobDispatchable && committedBytes === null && cancelledReason === null ? job : null })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/progress') { json(200, { ok: true }); return }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/sample') { json(200, { ok: true, url: null }); return }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/commit') {
      committedBytes = body
      json(200, { ok: true, url: '/canvas-studio/assets/x/out.mp4' })
      for (const w of commitWaiters.splice(0)) w()
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/cancel') {
      try { cancelledReason = JSON.parse(body.toString('utf8') || '{}').reason ?? 'unknown' } catch { cancelledReason = 'parse-error' }
      json(200, { ok: true })
      for (const w of commitWaiters.splice(0)) w()
      return
    }
    json(404, { error: 'probe: unknown route' })
  })
})

const listen = (port) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => { resolve(server.address().port) })
})

const waitFor = async (label, ms, fn) => {
  const deadline = Date.now() + ms
  for (;;) {
    const value = fn()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label} (${Math.round(ms / 1000)}s)`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function main() {
  const port = await listen(0)
  step('server:up', { port })

  const startedAt = Date.now()
  ensureRenderHost({
    url: `http://127.0.0.1:${port}/canvas-studio/render-host`,
    log: (message) => step('window', { message }),
  })
  await waitFor('first idle heartbeat', 30_000, () => firstIdleAt > 0)
  step('window:ready', { bootMs: firstIdleAt - startedAt })

  await new Promise((resolve) => {
    commitWaiters.push(resolve)
    setTimeout(() => { if (committedBytes === null && cancelledReason === null) resolve() }, 600_000)
  })
  if (cancelledReason !== null) throw new Error(`窗口撤单：${cancelledReason}`)
  if (committedBytes === null) throw new Error('600s 内未收到成片字节')

  const bytes = committedBytes
  const isMp4 = bytes.length > 32 && bytes.subarray(4, 8).toString('latin1') === 'ftyp'
  if (!isMp4) throw new Error(`回写字节不是 mp4（len=${bytes.length}）`)
  const outPath = join(workDir, 'out.mp4')
  writeFileSync(outPath, bytes)
  step('done', { bytes: bytes.length, outPath, wallMs: Date.now() - startedAt })
  console.log(`\n✅ 成片：${outPath}（${bytes.length} 字节，全程 ${Math.round((Date.now() - startedAt) / 1000)}s）`)
  resetRenderHostReport()
  app.exit(0)
}

app.whenReady().then(main).catch((error) => {
  step('fatal', { message: String(error?.message ?? error) })
  console.error(error)
  app.exit(1)
})
