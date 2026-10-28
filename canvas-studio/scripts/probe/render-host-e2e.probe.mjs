// RenderHost 端到端探针（2026-10-23，真机 11 连败修复的验收工具）。
//
// 三阶段都在**真实隐藏窗口 + 真实 render-host bundle**里跑；阶段 3 连宿主侧
// 工单模块（runRenderJob / claimRenderJobFor）也是真的，假宿主只顶 HTTP 协议：
//   阶段 1：隐藏窗口页面能否真正跑起来并自报 idle —— 10-20 起每次渲染失败的
//           「RenderHost 已创建 → 5min idle 销毁 → CS-RENDER-TIMEOUT」签名，
//           首先要排除「窗口页面根本没跑」这个假设；顺带实测冷启耗时，
//           对照 runRenderJob 的 3s hostWarmupMs 预算是否够。
//   阶段 2：窗口能否取到一张 draft 工单并真实渲出 mp4 —— 滞留改派的「接收端」。
//   阶段 3：**滞留改派全链路** —— runRenderJob 建一张 client 单（模拟画布页取单
//           链路死亡，永不 claim），隐藏窗口轮询 → 真实 claimRenderJobFor 在宽限
//           期满后接管 → 窗口渲染 → 成片字节回到探针。断言：工单绝不以
//           CS-RENDER-TIMEOUT 收场（修复前它 100% 超时）。
//
// 运行（Electron main 里跑，不是 node）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/render-host-e2e.probe.mjs
//
// 退出码：任一阶段失败 ⇒ 1。报告落 /tmp/cs-render-host-e2e/report.json。

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app } from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const outDir = '/tmp/cs-render-host-e2e'
mkdirSync(outDir, { recursive: true })
const stepLog = join(outDir, 'steps.log')
const step = (tag, extra) => {
  const line = `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`
  try { appendFileSync(stepLog, line + '\n') } catch { /* 日志失败不影响判定 */ }
  console.log(line)
}

// ── 被测的真实模块（lib 产物，与桌面应用加载的同一份） ──
const loadLib = (rel) => import(pathToFileURL(join(packageRoot, 'lib', rel)).href)
const { ensureRenderHost } = await loadLib('render-host/window.js')
const { renderHostHtml } = await loadLib('render-host/page.js')
const { recordRenderHostReport, resetRenderHostReport, renderHostReady } = await loadLib('render-host/status.js')
const { cancelRenderJob, claimRenderJobFor, runRenderJob, RENDER_HOST_TAKEOVER_GRACE_MS } = await loadLib('remotion/render-job.js')
const { resetRenderQueueForTests } = await loadLib('remotion/render-queue.js')
const renderHostBundle = readFileSync(join(packageRoot, 'lib', 'render-host.js'))

/** 最小可渲染 manifest：60 帧 draft，单条 shape 轨（无素材 ⇒ 探测/物化零依赖）。 */
const manifest = {
  meta: { title: 'render-host-e2e', width: 640, height: 360, fps: 30, durationInFrames: 60, backgroundColor: '#061018' },
  tracks: [
    { id: 's1', type: 'shape', shape: 'rect', color: '#1d4ed8', startFrame: 0, durationInFrames: 60, box: { x: 10, y: 10, w: 40, h: 40 } },
  ],
}
const fakeJob = {
  jobId: 'rj-e2e-probe-0001',
  projectId: 'proj-e2e-probe',
  manifest,
  fps: 30,
  quality: 'draft',
  realDurations: {},
  sampleFrames: [0, 30, 59],
}

// ── 假宿主：render-host 页面用到的 6 条协议 + 阶段 3 的真实工单模块 ──
let fakeJobDispatchable = false
let phase3Armed = false
let phase3JobId = null
const heartbeats = []
let firstIdleAt = -1
/** 页面发来的第一条自报携带的 Origin（真宿主 mutationAllowed 要求它非空）。 */
let statusOrigin = null
const commitWaiters = []
let committedBytes = null
let cancelledReason = null
let takeoverLog = []

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
    if (req.method === 'POST' && url.pathname === '/canvas-studio/render-host/status') {
      try {
        const report = JSON.parse(body.toString('utf8') || '{}')
        // 真实性缺口（2026-10-28）：真宿主的 `/render-host/status` 走 `mutationAllowed`，
        // 而它**要求请求带 `Origin`**；本探针的假宿主不做同源校验，于是「页面根本没发
        // Origin ⇒ 真机 403 ⇒ 静默白屏」这类故障在这里永远是绿的。至少把这条头记下来并断言。
        if (statusOrigin === null && req.headers.origin !== undefined) statusOrigin = req.headers.origin
        heartbeats.push({ at: Date.now(), state: report.state, detail: report.detail })
        recordRenderHostReport(report) // 喂给真实状态模块（renderHostReady 判活用）
        if (report.state === 'idle' && firstIdleAt < 0) {
          firstIdleAt = Date.now()
          fakeJobDispatchable = true // 窗口就绪 ⇒ 阶段 2 开始派单
        }
      } catch { /* 脏心跳不致命 */ }
      json(200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/remotion/pending') {
      // owner=host：阶段 2 发假单；阶段 3 起走**真实 claimRenderJobFor**（含滞留改派）。
      if (phase3Armed) {
        const claimed = claimRenderJobFor(null, 'render-host', {
          onTakeover: (jobId) => {
            takeoverLog.push({ jobId, at: Date.now() })
            phase3JobId = jobId
            step('phase3:takeover', { jobId })
          },
        })
        json(200, { job: claimed })
        return
      }
      json(200, { job: fakeJobDispatchable && committedBytes === null && cancelledReason === null ? fakeJob : null })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/progress') {
      json(200, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/sample') {
      json(200, { ok: true, url: null })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/commit') {
      committedBytes = body
      json(200, { ok: true, url: '/canvas-studio/assets/x/out.mp4' })
      // 阶段 3：成片字节到手 ⇒ 主动结算真实工单（探针不做落盘，cancel 即收场）。
      // 没有这一步，真实 runRenderJob 会一直挂着直到超时 —— 探针第一版就栽在这。
      if (phase3Armed && phase3JobId !== null) {
        cancelRenderJob(phase3JobId, { reason: 'probe done: bytes received' })
      }
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

  const ensureAt = Date.now()
  const handle = ensureRenderHost({
    url: `http://127.0.0.1:${port}/canvas-studio/render-host`,
    log: (message) => step('window', { message }),
  })
  if (handle === undefined) throw new Error('ensureRenderHost 返回 undefined（取不到 electron）')

  // ── 阶段 1：窗口自报就绪 ──
  await waitFor('first idle heartbeat', 30_000, () => firstIdleAt > 0)
  const bootMs = firstIdleAt - ensureAt
  // 真宿主的同源闸靠这三样：host 端口 / Origin / sec-fetch-site。探针至少钉住 Origin ——
  // 少了它，真机 403 而这里全绿（2026-10-28 的教训）。
  const originOk = typeof statusOrigin === 'string' && statusOrigin.startsWith(`http://127.0.0.1:${port}`)
  if (!originOk) throw new Error(`页面自报未携带同源 Origin（实际 ${String(statusOrigin)}）—— 真宿主的 mutationAllowed 会 403`)
  step('phase1:ok', { bootMs, heartbeats: heartbeats.length, origin: statusOrigin })
  console.log(`\n阶段 1 ✅ 隐藏窗口页面真实启动并自报 idle：冷启 ${bootMs}ms（runRenderJob 的 hostWarmupMs 预算 = 3000ms）`)

  // ── 阶段 2：派单 → 渲染 → 回写成片（假单，纯验证接收端）──
  const renderStartedAt = Date.now()
  await new Promise((resolve) => {
    commitWaiters.push(resolve)
    setTimeout(() => { if (committedBytes === null && cancelledReason === null) resolve() }, 240_000)
  })
  if (cancelledReason !== null) throw new Error(`窗口撤单：${cancelledReason}`)
  if (committedBytes === null) throw new Error('240s 内未收到成片字节')
  const renderMs = Date.now() - renderStartedAt
  const bytes = committedBytes
  const mp4 = bytes.length > 32 && bytes.subarray(4, 8).toString('latin1') === 'ftyp'
  if (!mp4) throw new Error(`回写字节不是 mp4（len=${bytes.length} head=${bytes.subarray(0, 12).toString('hex')}）`)
  if (bytes.length < 5_000) throw new Error(`成片字节过小（${bytes.length}），疑似黑片`)
  step('phase2:ok', { renderMs, bytes: bytes.length })
  console.log(`阶段 2 ✅ 隐藏窗口取单并渲染出片：${renderMs}ms，${bytes.length} 字节 mp4`)

  // ── 阶段 3：滞留改派全链路（真实工单模块 + 真实窗口）──
  resetRenderQueueForTests()
  resetRenderHostReport()
  // 重建后的第一拍心跳会把窗口重新报成 idle（1s 内）。
  await waitFor('re-idle heartbeat', 10_000, () => renderHostReady())
  committedBytes = null
  cancelledReason = null
  phase3Armed = true
  const pending = runRenderJob({
    projectId: 'proj-e2e-probe',
    manifest,
    quality: 'draft',
    // 修复前这张单的命运：没有任何执行者认领 → 干等到 CS-RENDER-TIMEOUT。
    timeoutMs: 120_000,
    executor: 'client', // 模拟「3s warmup 错过 ⇒ 钉给 client」的桌面实况
  })
  const guarded = pending.then((value) => value, (error) => error)
  step('phase3:armed', { graceMs: RENDER_HOST_TAKEOVER_GRACE_MS })
  const outcome = await guarded
  // 预期收场 = CS-GEN-207（探针收到字节后主动撤单结算）。
  // 修复失效的签名 = CS-RENDER-TIMEOUT（改派没发生或窗口没接活）。
  if (outcome?.code === 'CS-RENDER-TIMEOUT') {
    throw new Error('修复失效：滞留单改派后仍然以超时收场')
  }
  if (outcome?.code !== 'CS-GEN-207') {
    throw new Error(`阶段 3 工单异常结算：${outcome?.code ?? ''} ${outcome?.message ?? String(outcome)}`)
  }
  if (takeoverLog.length === 0) throw new Error('阶段 3：宽限期满后没有发生改派（claimRenderJobFor 未接管）')
  if (committedBytes === null || committedBytes.length < 5_000) throw new Error('阶段 3：改派后窗口没有回写有效成片')
  step('phase3:ok', { bytes: committedBytes.length, takeovers: takeoverLog.length })
  console.log(`阶段 3 ✅ 滞留改派全链路：client 单无人认领 → 宽限期 ${RENDER_HOST_TAKEOVER_GRACE_MS}ms 后窗口接管 → 渲染出片 ${committedBytes.length} 字节（未出现 CS-RENDER-TIMEOUT）`)

  const report = {
    ok: true,
    phase1: { bootMs, heartbeats: heartbeats.length, warmupBudgetMs: 3000, coldBootOverBudget: bootMs > 3000 },
    phase2: { renderMs, bytes: bytes.length },
    phase3: { bytes: committedBytes.length, takeovers: takeoverLog.length, graceMs: RENDER_HOST_TAKEOVER_GRACE_MS },
    at: new Date().toISOString(),
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log('report →', join(outDir, 'report.json'))
  app.exit(0)
}

app.whenReady().then(main).catch((error) => {
  step('fatal', { message: String(error?.message ?? error) })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ok: false, error: String(error?.message ?? error), heartbeats, at: new Date().toISOString() }, null, 2))
  console.error(error)
  app.exit(1)
})
