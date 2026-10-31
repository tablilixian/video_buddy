// 首帧前死区**真机**探针（2026-10-30）。
//
// 与单测（`tests/render-host-deadzone.test.mjs`）的分工：
//   单测证明「宿主在看门狗口径上怎么判死」；本探针证明「真实 Remotion 渲染时，
//   那段判死窗口里到底有没有心跳」—— 后者只能真跑，假时钟证明不了。
//
// 做法：拿**会话里真实失败的那份 manifest**（63 轨 / 5415 帧 / 26 段视频 / 23 个素材），
// 在**真实隐藏窗口 + 真实 render-host bundle + 真 WebCodecs** 里渲一遍，全程记录：
//   - claim（页面报 `rendering`）→ 第一条进度上报 的时延 = **首帧前耗时**
//   - 这段时间里页面心跳（POST /render-host/status）的**最大空档**
//   - 首帧后心跳空档、总耗时、ms/帧
// 判据：首帧前最大空档 > `RENDER_HOST_STALE_MS`(30s) ⇒ 宿主必然按「失联」杀掉一个
// 还在干活的渲染器（这就是那 21 次 CS-RENDER-002 的机制）；≤ 30s ⇒ 死区没被真机复现，
// 得换条件（质量档 / 素材数 / 机器负载）。
//
// 运行（Electron main 里跑，不是 node）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/render-host-stall.probe.mjs \
//     --manifest="/Users/wl/Desktop/job/VideoOut/new222/projects/参考我提交的内容，制作一段mv/build/manifest-v35-poster.json" \
//     [--quality=draft|standard|high] [--frames=5415] [--runs=2]
//
// 退出码：0 = 探针跑通（结论绿/红都如实打印）；1 = 探针自身失败（渲染没出片 / 素材缺失等）。
// 报告落 /tmp/cs-render-host-stall/report.json。

import { createServer } from 'node:http'
import { appendFileSync, createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app } from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const outDir = '/tmp/cs-render-host-stall'
mkdirSync(outDir, { recursive: true })
const stepLog = join(outDir, 'steps.log')
const step = (tag, extra) => {
  const line = `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`
  try { appendFileSync(stepLog, line + '\n') } catch { /* 日志失败不影响判定 */ }
  console.log(line)
}

const args = new Map(
  process.argv.slice(1)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...rest] = a.replace(/^--/u, '').split('=')
      return [k, rest.join('=')]
    }),
)
const manifestPath = args.get('manifest')
if (manifestPath === undefined) {
  console.error('缺少 --manifest=<manifest.json>')
  app.exit(2)
}
const quality = args.get('quality') ?? 'draft'
const runCount = Math.max(1, Number(args.get('runs') ?? '1'))
/** 素材目录：manifest 在 `<project>/build/` 下，素材在 `<project>/assets/`。 */
const assetsDir = args.get('assets') ?? join(dirname(dirname(manifestPath)), 'assets')

const loadLib = (rel) => import(pathToFileURL(join(packageRoot, 'lib', rel)).href)
const { ensureRenderHost, disposeRenderHost } = await loadLib('render-host/window.js')
const { renderHostHtml } = await loadLib('render-host/page.js')
const { recordRenderHostReport, resetRenderHostReport } = await loadLib('render-host/status.js')
const { RENDER_HOST_STALE_MS } = await loadLib('render-host/status.js')
// 生产侧的「回收策略」原语：一单渲完就打标，下一次派单前回收并重建。
// 探针把这条策略**照原样**接进来（不是自己 dispose），验的才是真代码。
const {
  markRenderHostServedJob,
  recycleRenderHostIfServed,
  setRenderHostLauncher,
  setRenderHostResetter,
  warmRenderHost,
} = await loadLib('render-host/dispatch.js')
const renderHostBundle = readFileSync(join(packageRoot, 'lib', 'render-host.js'))
const grainFile = join(packageRoot, 'assets', 'remotion', 'grain.png')

// ── 把真 manifest 的素材地址改写成假宿主的本地路由（其余字段一字不动） ──
const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
const toLocal = (src) => (typeof src === 'string' && src.length > 0 ? `/assets/${basename(src)}` : src)
const manifest = {
  ...raw,
  meta: {
    ...raw.meta,
    ...(args.get('frames') === undefined ? {} : { durationInFrames: Number(args.get('frames')) }),
  },
  tracks: raw.tracks.map((track) => (typeof track.src === 'string' ? { ...track, src: toLocal(track.src) } : track)),
  ...(raw.audio?.bgmUrl === undefined ? {} : { audio: { ...raw.audio, bgmUrl: toLocal(raw.audio.bgmUrl) } }),
}
const mediaUrls = new Set([
  ...manifest.tracks.filter((t) => typeof t.src === 'string').map((t) => t.src),
  ...(manifest.audio?.bgmUrl === undefined ? [] : [manifest.audio.bgmUrl]),
])
for (const url of mediaUrls) {
  if (!statSync(join(assetsDir, basename(url)), { throwIfNoEntry: false })?.isFile()) {
    console.error(`素材缺失：${join(assetsDir, basename(url))}`)
    app.exit(2)
  }
}

const MIME = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** 本次渲染的时间线（每次 run 重置）。 */
let timeline = null
const newTimeline = () => ({
  claimedAt: null, // 页面报 `rendering` 的第一拍
  beats: [], // 心跳时间戳（宿主侧收到）
  progress: [], // { at, value }
  committedAt: null,
  cancelled: null,
  bytes: 0,
  /** 成片前 12 字节（判 `ftyp`，不落盘也能确认是真 mp4）。 */
  head: null,
})
timeline = newTimeline()
let jobArmed = false
const doneWaiters = []
let resolveDone = null
const done = new Promise((resolve) => { resolveDone = resolve })

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
    // ── 页面与 bundle ──
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
    if (req.method === 'GET' && url.pathname === '/canvas-studio/remotion/grain') {
      const bytes = readFileSync(grainFile)
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length, 'cache-control': 'no-store' })
      res.end(bytes)
      return
    }
    // ── 素材（<video>/<audio> 会发 Range，必须支持，否则一直卡在 seek） ──
    if (req.method === 'GET' && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/canvas-studio/assets/'))) {
      const file = join(assetsDir, basename(decodeURIComponent(url.pathname)))
      const stat = statSync(file, { throwIfNoEntry: false })
      if (stat === undefined || !stat.isFile()) {
        res.writeHead(404).end('probe: asset missing')
        return
      }
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
      const range = req.headers.range
      if (typeof range === 'string') {
        const m = /bytes=(\d*)-(\d*)/u.exec(range)
        const start = m?.[1] ? Number(m[1]) : 0
        const end = m?.[2] ? Number(m[2]) : stat.size - 1
        res.writeHead(206, {
          'content-type': type,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${String(start)}-${String(end)}/${String(stat.size)}`,
          'content-length': String(end - start + 1),
          'cache-control': 'no-store',
        })
        createReadStream(file, { start, end }).pipe(res)
        return
      }
      res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
      createReadStream(file).pipe(res)
      return
    }
    // ── 状态自报：本探针的核心观测通道 ──
    if (req.method === 'POST' && url.pathname === '/canvas-studio/render-host/status') {
      try {
        const report = JSON.parse(body.toString('utf8') || '{}')
        const at = Date.now()
        timeline.beats.push({ at, state: report.state, detail: report.detail })
        if (timeline.claimedAt === null && report.state === 'rendering' && typeof report.jobId === 'string') {
          timeline.claimedAt = at
          step('page:claimed', { jobId: report.jobId })
        }
        recordRenderHostReport(report)
      } catch { /* 脏心跳不致命 */ }
      json(200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/remotion/pending') {
      if (!jobArmed) {
        json(200, { job: null })
        return
      }
      jobArmed = false
      json(200, {
        job: {
          jobId: `rj-stall-probe-${String(Date.now())}`,
          projectId: 'proj-stall-probe',
          manifest,
          fps: manifest.meta.fps,
          quality,
          realDurations: durationsFromManifest(),
          sampleFrames: [],
        },
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/progress') {
      try {
        const payload = JSON.parse(body.toString('utf8') || '{}')
        timeline.progress.push({ at: Date.now(), value: payload.progress ?? null })
      } catch { /* 忽略脏进度 */ }
      json(200, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/sample') {
      json(200, { ok: true, url: null })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/commit') {
      timeline.committedAt = Date.now()
      timeline.bytes = body.length
      timeline.head = body.subarray(0, 12).toString('latin1')
      json(200, { ok: true, url: '/canvas-studio/assets/x/out.mp4' })
      resolveDone('committed')
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/cancel') {
      try { timeline.cancelled = JSON.parse(body.toString('utf8') || '{}').reason ?? 'unknown' } catch { timeline.cancelled = 'parse-error' }
      json(200, { ok: true })
      resolveDone('cancelled')
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/canvas-studio/fonts/')) {
      // 探针不提供字体：`applyManifestFonts` 会降级成系统字体并记 warning（不影响判活观测）。
      res.writeHead(404).end('probe: no fonts')
      return
    }
    json(404, { error: `probe: unknown route ${req.method ?? ''} ${url.pathname}` })
  })
})

/** 宿主侧探测到的素材真值时长：真机走这里，页内探测被跳过（与会话里的 prepareMs=0 一致）。 */
function durationsFromManifest() {
  const out = {}
  for (const track of manifest.tracks) {
    if (typeof track.src !== 'string') continue
    if (track.type !== 'video' && track.type !== 'audio') continue
    out[track.src] = (track.durationInFrames ?? 90) / (manifest.meta.fps ?? 30)
  }
  return out
}

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

/** 一段心跳时间线 → 最大空档（含 claim 与首帧两个边界）。 */
function maxGap(beats, from, to) {
  const marks = [from, ...beats.filter((b) => b.at >= from && b.at <= to).map((b) => b.at), to].sort((a, b) => a - b)
  let gap = 0
  for (let i = 1; i < marks.length; i += 1) gap = Math.max(gap, marks[i] - marks[i - 1])
  return gap
}

async function main() {
  step('probe:start', { manifestPath, quality, frames: manifest.meta.durationInFrames, runs: runCount, assetsDir })
  const port = await listen(0)
  const ensureAt = Date.now()
  const handle = ensureRenderHost({
    url: `http://127.0.0.1:${port}/canvas-studio/render-host`,
    log: (message) => step('window', { message }),
  })
  if (handle === undefined) throw new Error('ensureRenderHost 返回 undefined（取不到 electron）')
  await waitFor('idle heartbeat', 40_000, () => timeline.beats.some((b) => b.state === 'idle'))
  step('window:idle', { bootMs: Date.now() - ensureAt })

  /** 每次跑之前「换一扇干净的窗」——对照组，用来判定挂死是不是窗口复用带来的。 */
  const freshWindow = args.get('freshWindow') === '1'
  /**
   * 生产策略：`--recycle=1` 时每单结束打标、下一单开始前走**生产代码**回收并重建窗口
   * （`recycleRenderHostIfServed` → `disposeRenderHost` → `warmRenderHost`）。
   * 与 `--freshWindow=1` 的区别：后者是探针自己 dispose，前者验的是修复后的真实链路。
   */
  const recyclePolicy = args.get('recycle') === '1'
  setRenderHostResetter((reason) => { step('window:dispose', { reason }) ; disposeRenderHost(reason) })
  setRenderHostLauncher(() => ensureRenderHost({
    url: `http://127.0.0.1:${port}/canvas-studio/render-host`,
    log: (message) => step('window', { message }),
  }) !== undefined)
  const openWindow = async (index) => {
    disposeRenderHost(`probe: fresh window before run ${String(index)}`)
    resetRenderHostReport()
    ensureRenderHost({ url: `http://127.0.0.1:${port}/canvas-studio/render-host`, log: (message) => step('window', { message }) })
    await waitFor('idle heartbeat', 40_000, () => timeline.beats.some((b) => b.state === 'idle'))
  }

  const runs = []
  for (let index = 0; index < runCount; index += 1) {
    timeline = newTimeline()
    if (freshWindow && index > 0) await openWindow(index)
    if (recyclePolicy && index > 0) {
      // 上一单结算 ⇒ 打标（生产里由 `settleAndForget` 做）。
      markRenderHostServedJob()
      const recycled = recycleRenderHostIfServed('probe: previous render job settled')
      step('window:recycle', { recycled })
      if (recycled) warmRenderHost()
      resetRenderHostReport()
      const bootAt = Date.now()
      await waitFor('idle heartbeat', 40_000, () => timeline.beats.some((b) => b.state === 'idle'))
      step('window:rebuilt', { bootMs: Date.now() - bootAt })
    }
    const slot = new Promise((resolve) => { resolveDone = resolve })
    jobArmed = true
    step('run:armed', { index })
    const runBudgetMs = Number(args.get('runBudgetMs') ?? '150000')
    const verdict = await Promise.race([
      slot,
      new Promise((resolve) => setTimeout(() => { resolve('stalled') }, runBudgetMs)),
    ])

    const claimedAt = timeline.claimedAt
    const firstProgress = timeline.progress[0]
    const lastProgress = timeline.progress[timeline.progress.length - 1]
    if (claimedAt === null) throw new Error('页面从未报 `rendering` —— 工单没被取走')
    if (firstProgress === undefined) {
      // ⭐ 这就是会话里那 21 次的签名：**取过单、一帧不出**。此前的假设是「首帧前
      // 心跳断了」，所以这里必须把心跳时间线留下来 —— 空档到底有没有超过 30s。
      const stalledMs = Date.now() - claimedAt
      const gap = maxGap(timeline.beats, claimedAt, Date.now())
      const stalledRun = {
        index,
        quality,
        frames: manifest.meta.durationInFrames,
        tracks: manifest.tracks.length,
        verdict: 'claimed-but-no-frame',
        stalledMs,
        maxHeartbeatGapBeforeFirstFrameMs: gap,
        heartbeatStopped: gap > 5_000,
        beatsAfterClaim: timeline.beats.filter((b) => b.at >= claimedAt).length,
        lastBeats: timeline.beats.slice(-4).map((b) => ({ dt: b.at - claimedAt, state: b.state, detail: b.detail ?? null })),
      }
      runs.push(stalledRun)
      step('run:stalled', stalledRun)
      console.log(
        `\n第 ${String(index + 1)} 次（${quality} / ${String(manifest.tracks.length)} 轨 / ${String(manifest.meta.durationInFrames)} 帧）：\n`
        + `  ❗ 取单后 ${(stalledMs / 1000).toFixed(1)}s 一帧未出（${String(stalledRun.beatsAfterClaim)} 拍心跳，最大空档 ${(gap / 1000).toFixed(1)}s）\n`
        + `  ${stalledRun.heartbeatStopped ? '心跳已停 ⇒ 宿主 30s 判死是「窗口真失联」' : '心跳仍在 ⇒ 宿主会按失联误杀一个健康页面'}`,
      )
      // 换一张新单前先让页面回 idle；窗口若已废，宿主的 idle 销毁会把它收走。
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      continue
    }

    const preFirstFrameMs = firstProgress.at - claimedAt
    const preGapMs = maxGap(timeline.beats, claimedAt, firstProgress.at)
    const afterGapMs = maxGap(timeline.beats, firstProgress.at, timeline.committedAt ?? lastProgress.at)
    const totalMs = (timeline.committedAt ?? lastProgress.at) - claimedAt
    const frames = manifest.meta.durationInFrames
    const run = {
      index,
      quality,
      frames,
      tracks: manifest.tracks.length,
      mediaUrls: mediaUrls.size,
      verdict,
      bytes: timeline.bytes,
      claimedToFirstProgressMs: preFirstFrameMs,
      maxHeartbeatGapBeforeFirstFrameMs: preGapMs,
      maxHeartbeatGapAfterFirstFrameMs: afterGapMs,
      totalMs,
      msPerFrame: Math.round((totalMs / frames) * 10) / 10,
      beats: timeline.beats.length,
      progressEvents: timeline.progress.length,
      deadZoneHit: preGapMs > RENDER_HOST_STALE_MS,
    }
    runs.push(run)
    step('run:done', run)
    console.log(
      `\n第 ${String(index + 1)} 次（${quality} / ${String(manifest.tracks.length)} 轨 / ${String(frames)} 帧）：\n`
      + `  首帧前耗时      ${(preFirstFrameMs / 1000).toFixed(1)}s\n`
      + `  首帧前心跳空档  ${(preGapMs / 1000).toFixed(1)}s（判死阈值 ${String(RENDER_HOST_STALE_MS / 1000)}s ⇒ ${run.deadZoneHit ? '❗ 会被判失联' : '未触线'}）\n`
      + `  首帧后心跳空档  ${(afterGapMs / 1000).toFixed(1)}s\n`
      + `  总耗时 ${(totalMs / 1000).toFixed(1)}s · ${String(run.msPerFrame)}ms/帧 · 心跳 ${String(run.beats)} 拍 · 进度 ${String(run.progressEvents)} 条 · ${String(timeline.bytes)} 字节`,
    )
    const isMp4 = typeof timeline.head === 'string' && timeline.head.slice(4, 8) === 'ftyp'
    if (!isMp4) throw new Error(`回写字节不是 mp4（head=${String(timeline.head)}）—— 渲染没真出片`)
    if (timeline.bytes < 5_000) throw new Error(`成片字节过小（${String(timeline.bytes)}），疑似黑片`)
    // 等页面回 idle（`runJob` 的 finally 会补一拍），下一单才取得到。
    await waitFor('re-idle', 15_000, () => timeline.beats.at(-1)?.state === 'idle')
    await new Promise((resolve) => setTimeout(resolve, 1_200))
  }

  const worst = runs.reduce((a, b) => (b.maxHeartbeatGapBeforeFirstFrameMs > a.maxHeartbeatGapBeforeFirstFrameMs ? b : a))
  const stalled = runs.filter((r) => r.verdict === 'claimed-but-no-frame')
  const report = {
    ok: runs.every((r) => r.verdict === 'committed'),
    threshold: { staleMs: RENDER_HOST_STALE_MS },
    runs,
    worstPreFirstFrameGapMs: worst.maxHeartbeatGapBeforeFirstFrameMs,
    deadZoneReproduced: runs.some((r) => r.deadZoneHit === true),
    claimedButNoFrame: stalled.length,
    /** 取单后一帧不出、且心跳也停了 ⇒ 30s 判死是「窗口真挂了」而不是误杀。 */
    stallWithHeartbeatStopped: stalled.filter((r) => r.heartbeatStopped === true).length,
    at: new Date().toISOString(),
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`\n报告 → ${join(outDir, 'report.json')}`)
  app.exit(0)
}

// 关键：窗口被 idle 销毁（或探针跑到一半窗口挂掉）时，Electron 默认「无窗口即退出」，
// 那样时间线全丢、报告也写不出来 —— 于是「取单后一帧不出」这条最有价值的观测就没了。
app.on('window-all-closed', () => { /* 探针自己决定何时退出 */ })

app.whenReady().then(main).catch((error) => {
  const message = String(error?.message ?? error)
  step('fatal', { message })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ok: false, error: message, at: new Date().toISOString() }, null, 2))
  console.error(error)
  app.exit(1)
})
