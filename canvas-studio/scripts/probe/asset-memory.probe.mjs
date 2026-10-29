#!/usr/bin/env node
// CV-382 · CR-004 资产交付内存探针（before / after 对比证据；产物只作本地证据，
// canvas-studio/build/ 已在根 .gitignore）。
//
// 量法（计划 §3 口径）：同一 60MB 假资产 + 同一组 10 次 Range 请求，采样进程
// `process.memoryUsage().rss` 峰值增量。第 10 次请求客户端中途 abort，顺带验
// 「断连不泄漏 fd」（§8 止损：10 次请求后 fd 增量 ≤ 2，macOS/Linux 走 /dev/fd 计数）。
//   before = 整读形态（readFile 整文件进内存再 Buffer 切片）—— 预期 ≥ 60MB
//   after  = 流式形态（stat 探测 + createReadStream）—— 判定增量 < 20MB
//
// 运行：node --expose-gc scripts/probe/asset-memory.probe.mjs [--phase=before|after]
//   phase 缺省自动：产物里尚无 before → 记 before；已有 → 记 after。
//   --expose-gc 可选：有则在建文件后、采样前强制 GC，把模块加载/建文件的噪声清出基线。
//   对测姿势（同一构建、同一客户端，方法学最干净）：
//     before 相 = CANVAS_STUDIO_ASSET_LEGACY_BUFFER=1 node --expose-gc … --phase=before
//                 （LEGACY_BUFFER 开关即 T1 保留的旧整读形态，行为与改造前代码等价）
//     after 相  = node --expose-gc scripts/probe/asset-memory.probe.mjs --phase=after
// 输出：build/probe/asset-memory.json。双相齐备时打印对比并做阈值判定（非 0 退出 = 超阈）。
//
// 本文件是 `yarn test:smoke` 之外唯一允许直接 `node` 执行的探针（计划 §9 坑 3 例外条款）。
import { createServer, request as httpRequest, Agent } from 'node:http'
import { readdirSync } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerStudioRoutes } from '../../lib/routes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(HERE, '..', '..', 'build', 'probe', 'asset-memory.json')
const FILE_MB = 60
const MB = 1024 * 1024
const FD_DELTA_LIMIT = 2
const AFTER_DELTA_LIMIT_MB = 20

// 10 次 Range 请求：奇数次 = 50MB 大段「首块即断」（fd 泄漏探测器 ×5 —— 小段在
// loopback 上可能来不及断就 end，实测弱探测 0 次触发；且只断 1 次泄漏 1 fd 恰 ≤2 会
// 假绿）；偶数次 = 小段完整收尾（206 语义证据）。
const ABORT_EXPECTED = 5
const RANGE_REQUESTS = [
  { range: 'bytes=0-52428799', abort: true },
  { range: 'bytes=0-1048575' },
  { range: 'bytes=1048576-2097151', abort: true },
  { range: 'bytes=-1048576' },
  { range: 'bytes=31457280-32505855', abort: true },
  { range: 'bytes=0-65535' },
  { range: 'bytes=52428800-53477375', abort: true },
  { range: 'bytes=1048575-1153433' },
  { range: 'bytes=60000000-60061439', abort: true },
  { range: 'bytes=62914559-62914559' },
]

const rssBytes = () => process.memoryUsage().rss
const countFds = () => {
  try { return readdirSync('/dev/fd').length } catch { return null }
}
const roundMB = (bytes) => Math.round((bytes / MB) * 100) / 100

// 客户端必须瘦：探针进程既是服务端又是客户端，若用 fetch/undici + arrayBuffer()，
// 每个请求会留下 ~6-8MB 的 GC 滞后垃圾（体缓冲 + undici 对象），把「服务端内存」
// 的读数淹掉（实测 after 相被推到 40.8MB 假超阈）。裸 http.request + 数据即弃 +
// 无 keep-alive，装置噪声压到最小；agent 共享一个实例，请求后 socket 即关。
function rangeRequest(port, range, requestAgent, { abortAfterFirstChunk = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value, error) => {
      if (settled) return
      settled = true
      if (error != null) reject(error)
      else resolve(value)
    }
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/canvas-studio/assets/p1/big.mp4',
      method: 'GET',
      headers: { range },
      agent: requestAgent,
    }, (res) => {
      let bytes = 0
      res.on('data', (chunk) => {
        bytes += chunk.length // 即读即弃，不留引用
        if (abortAfterFirstChunk) {
          // 首块一到就掐：保证掐在流中段（服务端 res 'close' 必须触发 destroy）。
          req.destroy()
          finish({ aborted: true, bytes })
        }
      })
      res.on('end', () => finish({ status: res.statusCode, bytes, headers: res.headers }))
      res.on('error', (cause) => {
        if (abortAfterFirstChunk) finish({ aborted: true, bytes })
        else finish(undefined, cause)
      })
    })
    req.on('error', (cause) => {
      if (abortAfterFirstChunk) finish({ aborted: true })
      else finish(undefined, cause)
    })
    req.end()
  })
}

// —— 最小 harness：假 ctx 捕获 handler + 真 http server（照 library-route.test.mjs 分发口径）——
const root = await mkdtemp(join(tmpdir(), 'cs-asset-mem-'))
let server
try {
  const assetsDir = join(root, 'assets')
  await mkdir(assetsDir, { recursive: true })
  // 1MB 分块写 60 次：探针进程自身永远不持有 60MB Buffer，基线才干净。
  const fh = await open(join(assetsDir, 'big.mp4'), 'w')
  const chunk = Buffer.alloc(MB, 0x7a)
  for (let i = 0; i < FILE_MB; i += 1) await fh.write(chunk)
  await fh.close()

  const registry = {
    list: async () => [{ id: 'p1', name: 'P1', dir: root, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 4, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
    sweepOnceForCurrentRoot: async () => 0,
  }
  const routes = []
  const ctx = {
    webServer: {
      port: 0,
      register: (route) => { routes.push(route); return () => {} },
    },
    logger: { warn() {}, info() {}, error() {} },
  }
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    let route = null
    for (const entry of routes) {
      if (entry.kind !== 'prefix') continue
      if (pathname !== entry.path && !pathname.startsWith(`${entry.path}/`)) continue
      if (route == null || entry.path.length > route.path.length) route = entry
    }
    if (route == null) {
      res.statusCode = 404
      res.end()
      return
    }
    Promise.resolve(route.handler(req, res)).catch(() => {
      if (!res.writableEnded) { res.statusCode = 500; res.end() }
    })
  })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  ctx.webServer.port = server.address().port
  const dispose = registerStudioRoutes(ctx, registry, {})

  // —— 采样 ——
  globalThis.gc?.()
  readdirSync('/dev/fd') // 预热一次，避免首次 readdir 的临时句柄污染计数
  const requestAgent = new Agent({ keepAlive: false, maxSockets: 1 })
  const baselineRss = rssBytes()
  const fdBefore = countFds()
  const samples = []
  const statuses = []
  let peak = baselineRss
  let aborted = 0
  for (let i = 0; i < RANGE_REQUESTS.length; i += 1) {
    const spec = RANGE_REQUESTS[i]
    const outcome = await rangeRequest(ctx.webServer.port, spec.range, requestAgent, {
      abortAfterFirstChunk: spec.abort === true,
    })
    if (outcome.aborted === true) aborted += 1
    else statuses.push({ range: spec.range, status: outcome.status, bytes: outcome.bytes })
    const rss = rssBytes()
    samples.push(rss)
    if (rss > peak) peak = rss
  }
  requestAgent.destroy()
  server.closeAllConnections?.()
  await new Promise((resolve) => { setTimeout(resolve, 100) })
  const fdAfter = countFds()

  const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
  let doc = {}
  try { doc = JSON.parse(await readFile(OUT_PATH, 'utf8')) } catch { /* 首跑无产物 */ }
  const phase = phaseArg ? phaseArg.split('=')[1] : (doc.before ? 'after' : 'before')

  const result = {
    phase,
    fileSizeMB: FILE_MB,
    rangeRequests: RANGE_REQUESTS.length,
    abortedRequests: aborted,
    legacyBufferEnv: process.env.CANVAS_STUDIO_ASSET_LEGACY_BUFFER === '1',
    rangeStatuses: statuses,
    baselineRssBytes: baselineRss,
    peakRssBytes: peak,
    peakRssDeltaBytes: peak - baselineRss,
    peakRssDeltaMB: roundMB(peak - baselineRss),
    fdBefore,
    fdAfter,
    fdDelta: fdBefore != null && fdAfter != null ? fdAfter - fdBefore : null,
    rssSamplesMB: samples.map(roundMB),
    exposeGc: typeof globalThis.gc === 'function',
    measuredAt: new Date().toISOString(),
  }
  doc[phase] = result
  doc.meta = { node: process.version, platform: process.platform, updatedAt: result.measuredAt }
  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  dispose()

  // —— 判定 ——
  console.log(`[asset-memory.probe] phase=${phase} file=${FILE_MB}MB ranges=${RANGE_REQUESTS.length}（含 abort ${aborted} 次）`
    + ` rssDelta=${result.peakRssDeltaMB}MB fdDelta=${result.fdDelta ?? 'n/a'} exposeGc=${result.exposeGc}`)
  let failed = false
  if (result.abortedRequests !== ABORT_EXPECTED) {
    console.error(`[asset-memory.probe] ❌ 中途断连只触发 ${result.abortedRequests}/${ABORT_EXPECTED} 次 —— fd 泄漏断言失去探测对象，检查装置`)
    failed = true
  }
  if (result.fdDelta != null && result.fdDelta > FD_DELTA_LIMIT) {
    console.error(`[asset-memory.probe] ❌ fd 增量 ${result.fdDelta} > ${FD_DELTA_LIMIT}（断连泄漏读流）`)
    failed = true
  }
  if (doc.before && doc.after) {
    const before = doc.before.peakRssDeltaMB
    const after = doc.after.peakRssDeltaMB
    console.log(`[asset-memory.probe] 对比：before=${before}MB → after=${after}MB（阈值 after < ${AFTER_DELTA_LIMIT_MB}MB）`)
    if (after >= AFTER_DELTA_LIMIT_MB) {
      console.error(`[asset-memory.probe] ❌ after 峰值增量 ${after}MB ≥ ${AFTER_DELTA_LIMIT_MB}MB`)
      failed = true
    } else {
      console.log('[asset-memory.probe] ✅ 阈值内')
    }
  }
  process.exitCode = failed ? 1 : 0
} finally {
  server?.closeAllConnections?.()
  if (server != null) await new Promise((resolve) => { server.close(resolve) })
  await rm(root, { recursive: true, force: true })
}
