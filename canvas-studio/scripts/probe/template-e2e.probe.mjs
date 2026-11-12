// 1（CV-463）· 模板通道端到端探针 —— 照 `sfx-e2e.probe.mjs` 的假宿主骨架。
//
// 目的：证明「模板库产出的 manifest」**真能在渲染器里渲出来**，且三件新东西真的上了屏：
//   ① 构件轨（`fx-*`）—— 用「同模板去掉 furniture 再渲一遍」的**像素差分**证明
//      （不做颜色抠图：h264 4:2:0 会把 1.5px 的括线糊掉，绝对颜色不可靠；
//        两份成片只有构件不同 ⇒ 差分像素就是构件本身，且天然抗压缩）；
//   ② 音效（`audio.sfx[]`，全走 anchor）—— 成片有 aac 音轨且非静音；
//   ③ 文字体检（0B 的 `report.textFit`）—— 真机回报里逐条 `overflow=false`。
//
// 三个模板各渲一支样片（示例值取自 `slots.json` 的 `example`，不硬编码文案），
// 再对 science 渲一支 `furniture: []` 的对照片。成片与报告落 /tmp/cs-template-e2e/。
//
// 运行（Electron main 里跑，不是 node）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/template-e2e.probe.mjs
//
// 退出码：任一断言失败 ⇒ 1。铁律（无人值守推进协议 §2）：绝不 kill Electron；
// 所有等待用内部预算，跑完自退。

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app } from 'electron'
import { runFfmpegCapture, parseWav } from './lib/audio-probe.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const outDir = '/tmp/cs-template-e2e'
mkdirSync(outDir, { recursive: true })
const stepLog = join(outDir, 'steps.log')
const step = (tag, extra) => {
  const line = `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`
  try { appendFileSync(stepLog, line + '\n') } catch { /* 日志失败不影响判定 */ }
  console.log(line)
}

const loadLib = (rel) => import(pathToFileURL(join(packageRoot, 'lib', rel)).href)
const { ensureRenderHost } = await loadLib('render-host/window.js')
const { renderHostHtml } = await loadLib('render-host/page.js')
const { loadTemplateBundle, listTemplateSummaries } = await loadLib('remotion/template-registry.js')
const { compileTemplate } = await loadLib('remotion/template-compile.js')
// 真实宿主在 `/render-host/status` 的处理里会记一笔（`routes.ts`），窗口层据此判「可否接管」。
// 不记的话建窗 8s 后会打一条**假**告警「从未收到任何自报，本单回退画布页」—— 探针日志
// 一旦出现假告警，后面所有断言的可信度都要打折，所以这里照真实宿主补上。
const { recordRenderHostReport } = await loadLib('render-host/status.js')

const RENDER_HOST_BUNDLE = readFileSync(join(packageRoot, 'lib', 'render-host.js'))
const FONT_DIR = join(packageRoot, 'assets', 'fonts')
const FONT_TYPES = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.length > 0) return process.env.FFMPEG_PATH
  return join(packageRoot, '..', 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

// ── 1. 编译：三个模板 + 一支去构件的对照 ──
const catalog = listTemplateSummaries()
if (catalog.problems.length > 0) throw new Error(`模板目录有问题：${JSON.stringify(catalog.problems)}`)
const TEMPLATE_IDS = ['science/three-cards', 'product/feature-walkthrough', 'report/data-summary', 'tech/kinetic-promo']
const missing = TEMPLATE_IDS.filter((id) => !catalog.items.some((item) => item.meta.id === id))
if (missing.length > 0) throw new Error(`模板缺失：${missing.join(', ')}（现有 ${catalog.items.map((i) => i.meta.id).join(', ')}）`)

/** 示例值一律取 `slots.json` 的 `example`（换示例时探针不失准，不硬编码文案）。 */
function exampleValues(slots) {
  const values = {}
  const lack = []
  for (const slot of slots) {
    if (slot.example !== undefined) values[slot.id] = slot.example
    else if (slot.required === true) lack.push(slot.id)
  }
  if (lack.length > 0) throw new Error(`必填槽缺 example：${lack.join(', ')}`)
  return values
}

const cases = []
for (const id of TEMPLATE_IDS) {
  const { bundle } = loadTemplateBundle(id)
  const values = exampleValues(bundle.slots)
  const out = compileTemplate(bundle, values)
  if (!out.ok || out.manifest === null) throw new Error(`${id} 编译失败：${out.errors.join(' | ')}`)
  if (out.warnings.length > 0) throw new Error(`${id} 编译告警：${out.warnings.join(' | ')}`)
  cases.push({
    label: id.replace('/', '__'),
    templateId: id,
    stripFurniture: false,
    manifest: out.manifest,
    fps: bundle.meta.fps,
    durationInFrames: bundle.meta.durationInFrames,
    stats: out.stats,
    textTrackCount: countTextTracks(out.manifest),
  })
}

// 对照：同 values、同骨架，只把 furniture 摘掉 —— 差分出的像素就是构件。
{
  const { bundle } = loadTemplateBundle('science/three-cards')
  const out = compileTemplate({ ...bundle, furniture: [] }, exampleValues(bundle.slots))
  if (!out.ok || out.manifest === null) throw new Error(`对照片编译失败：${out.errors.join(' | ')}`)
  cases.push({
    label: 'science__nofx',
    templateId: 'science/three-cards',
    stripFurniture: true,
    manifest: out.manifest,
    fps: bundle.meta.fps,
    durationInFrames: bundle.meta.durationInFrames,
    stats: out.stats,
    textTrackCount: countTextTracks(out.manifest),
  })
}

function countTextTracks(manifest) {
  const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : []
  return tracks.filter((t) => t !== null && typeof t === 'object' && t.type === 'textCard').length
}

// ── 2. 假宿主（与 sfx-e2e 同构；多托管一份字体，文字轨才是真字形而不是回退字体）──
let currentJob = null
let committed = null // { bytes, warnings, metrics }
let cancelledReason = null
const heartbeats = []
let statusOrigin = null
let firstIdleAt = -1
const commitWaiters = []
const wake = () => { for (const w of commitWaiters.splice(0)) w() }

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
      res.end(RENDER_HOST_BUNDLE)
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/canvas-studio/remotion/fonts/')) {
      const file = url.pathname.slice('/canvas-studio/remotion/fonts/'.length)
      const type = FONT_TYPES[extname(file)]
      try {
        if (type === undefined || file.includes('/') || file.includes('..')) throw new Error('bad name')
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(readFileSync(join(FONT_DIR, file)))
      } catch {
        json(404, { error: `probe: font not found: ${file}` })
      }
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/canvas-studio/remotion/sfx/')) {
      const file = url.pathname.slice('/canvas-studio/remotion/sfx/'.length)
      try {
        if (!/^[a-z0-9-]+\.wav$/.test(file)) throw new Error('bad name')
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(readFileSync(join(packageRoot, 'assets', 'sfx', file)))
      } catch {
        json(404, { error: `probe: sfx not found: ${file}` })
      }
      return
    }
    // CV-464：真素材音效（`assets/audio/sfx/*.mp3`）。模板 audio.json 已全部改用这批，
    // 探针 server 不 serve 它的话，渲染进程同源 fetch 会 404 ⇒ 成片静音而探针仍判绿。
    if (req.method === 'GET' && url.pathname.startsWith('/canvas-studio/remotion/fx/')) {
      const file = url.pathname.slice('/canvas-studio/remotion/fx/'.length)
      try {
        if (!/^[a-z0-9-]+\.mp3$/.test(file)) throw new Error('bad name')
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(readFileSync(join(packageRoot, 'assets', 'audio', 'sfx', file)))
      } catch {
        json(404, { error: `probe: fx not found: ${file}` })
      }
      return
    }
    // S2：模板自带静态占位资产（剪影 SVG）—— 与真实宿主 routes.ts 的
    // ROUTE_REMOTION_TEMPLATES 同口径（4 段路径 + 逐段白名单），探针 server 也要
    // serve 它，渲染进程才能同源 fetch 到占位图。
    if (req.method === 'GET' && url.pathname.startsWith('/canvas-studio/remotion/templates/')) {
      const rel = url.pathname.slice('/canvas-studio/remotion/templates/'.length).replace(/^\/+/, '')
      const segments = rel.split('/')
      const okShape = segments.length === 4
        && segments.slice(0, 3).every((segment) => /^[a-z0-9-]+$/.test(segment))
        && segments[2] === 'frames'
        && /^[a-z0-9-]+\.(svg|png)$/.test(segments[3] ?? '')
      const types = { '.svg': 'image/svg+xml', '.png': 'image/png' }
      try {
        if (!okShape) throw new Error('bad name')
        res.writeHead(200, {
          'content-type': types[extname(segments[3])] ?? 'application/octet-stream',
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(readFileSync(join(packageRoot, 'assets', 'templates', ...segments)))
      } catch {
        json(404, { error: `probe: template asset not found: ${rel}` })
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/render-host/status') {
      try {
        const report = JSON.parse(body.toString('utf8') || '{}')
        recordRenderHostReport(report)
        if (statusOrigin === null && req.headers.origin !== undefined) statusOrigin = req.headers.origin
        heartbeats.push({ at: Date.now(), state: report.state })
        if (report.state === 'idle' && firstIdleAt < 0) firstIdleAt = Date.now()
      } catch { /* 脏心跳不致命 */ }
      json(200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/remotion/pending') {
      json(200, { job: committed === null && cancelledReason === null ? currentJob : null })
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/progress') { json(200, { ok: true }); return }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/sample') { json(200, { ok: true, url: null }); return }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/commit') {
      // `metrics` / `warnings` 都是 URL 编码 JSON（`client/api.ts` 的 commitStudioRenderJob）。
      const parse = (key) => {
        const raw = url.searchParams.get(key)
        if (raw === null) return undefined
        try { return JSON.parse(raw) } catch { return undefined }
      }
      committed = { bytes: body, warnings: parse('warnings') ?? [], metrics: parse('metrics') ?? {} }
      json(200, { ok: true, url: '/canvas-studio/assets/x/out.mp4' })
      wake()
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/remotion/cancel') {
      try { cancelledReason = JSON.parse(body.toString('utf8') || '{}').reason ?? 'unknown' } catch { cancelledReason = 'parse-error' }
      json(200, { ok: true })
      wake()
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

// ── 3. 渲染一单 ──
async function renderCase(kase, ffmpeg) {
  const jobId = `rj-tpl-${kase.label.replace(/[^a-z0-9]+/gi, '-')}`
  currentJob = {
    jobId,
    projectId: 'proj-tpl-probe',
    manifest: kase.manifest,
    fps: kase.fps,
    quality: 'standard', // 必须 full-res：draft 是半分辨率，细括线会被抹掉
    realDurations: {},
    sampleFrames: [0, Math.floor(kase.durationInFrames / 2), kase.durationInFrames - 1],
  }
  committed = null
  cancelledReason = null
  const startedAt = Date.now()
  await new Promise((resolve) => {
    commitWaiters.push(resolve)
    setTimeout(resolve, 900_000)
  })
  if (cancelledReason !== null) throw new Error(`[${kase.label}] 窗口撤单：${cancelledReason}`)
  if (committed === null) throw new Error(`[${kase.label}] 900s 内未收到成片字节`)
  const mp4 = join(outDir, `${kase.label}.mp4`)
  writeFileSync(mp4, committed.bytes)
  const renderMs = Date.now() - startedAt
  currentJob = null
  step('render:ok', { label: kase.label, renderMs, bytes: committed.bytes.length })
  console.log(`  渲染 ✅ ${kase.label} ${renderMs}ms ${(committed.bytes.length / 1024).toFixed(0)}KB`)
  return { mp4, renderMs, bytes: committed.bytes.length, metrics: committed.metrics, warnings: committed.warnings }
}

// ── 4. 成片取证工具 ──
async function probeStreams(ffmpeg, file) {
  const res = await runFfmpegCapture(ffmpeg, ['-i', file])
  const text = res.stderr
  const videoLine = text.split('\n').find((l) => /Video:/.test(l)) ?? ''
  const audioLine = text.split('\n').find((l) => /Audio:/.test(l)) ?? ''
  const size = /(\d{2,5})x(\d{2,5})/.exec(videoLine)
  const dur = /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/.exec(text)
  const seconds = dur === null ? -1 : Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
  return {
    videoLine: videoLine.trim(),
    audioLine: audioLine.trim(),
    width: size === null ? 0 : Number(size[1]),
    height: size === null ? 0 : Number(size[2]),
    seconds,
  }
}

/** 精确解出第 n 帧（从 0 解码到 n，不用 `-ss` 近似 seek：两份成片的帧必须严格对齐才可比像素）。 */
async function extractFrame(ffmpeg, file, frame, outName) {
  const out = join(outDir, outName)
  const res = await runFfmpegCapture(ffmpeg, [
    '-i', file, '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', out,
  ])
  if (res.code !== 0) throw new Error(`抽帧失败（${outName}）：${res.stderr.trim().split('\n').slice(-3).join(' | ')}`)
  return readFileSync(out)
}

/** 区域内「任一通道差 > threshold」的像素数（region 缺省 = 全画面）。 */
function countDiffPixels(a, b, w, h, threshold, region) {
  const x0 = region?.x0 ?? 0
  const y0 = region?.y0 ?? 0
  const x1 = region?.x1 ?? w
  const y1 = region?.y1 ?? h
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * w + x) * 3
      if (Math.abs(a[i] - b[i]) > threshold
        || Math.abs(a[i + 1] - b[i + 1]) > threshold
        || Math.abs(a[i + 2] - b[i + 2]) > threshold) count += 1
    }
  }
  return count
}

async function decodePeaks(ffmpeg, file, fps, outName) {
  const out = join(outDir, outName)
  const res = await runFfmpegCapture(ffmpeg, ['-i', file, '-vn', '-c:a', 'pcm_s16le', '-y', out])
  if (res.code !== 0) throw new Error(`音轨解码失败：${res.stderr.trim().split('\n').slice(-3).join(' | ')}`)
  const wav = parseWav(readFileSync(out))
  if (wav === null) throw new Error('音轨解析失败（RIFF/data 块缺失）')
  const spf = Math.round(wav.sampleRate / fps)
  const frames = Math.floor(wav.samples.length / wav.channels / spf)
  const peaks = new Float64Array(frames)
  let max = 0
  for (let f = 0; f < frames; f += 1) {
    let peak = 0
    for (let i = f * spf * wav.channels; i < (f + 1) * spf * wav.channels; i += 1) {
      const v = Math.abs(wav.samples[i]) / 32768
      if (v > peak) peak = v
    }
    peaks[f] = peak
    if (peak > max) max = peak
  }
  return { max, frames, peaks, sampleRate: wav.sampleRate, channels: wav.channels, seconds: wav.samples.length / wav.channels / wav.sampleRate }
}

// ── 5. 主流程 ──
const results = []
// 必须 await：断言体多半是 async（要起 ffmpeg），不同步 await 的话 throw 会变成
// 无人处理的 rejection，探针会「假绿」。
const assertStep = async (no, name, fn) => {
  const detail = await fn()
  results.push({ no, name, ok: true, detail })
  console.log(`断言 ${no} ✅ ${name}`, typeof detail === 'object' ? JSON.stringify(detail) : String(detail ?? ''))
}
const report = { startedAt: new Date().toISOString(), renders: [], assertions: results }

async function main() {
  const ffmpeg = resolveFfmpeg()
  const port = await listen(0)
  step('server:up', { port, cases: cases.map((c) => c.label) })

  // 编译期事实先落盘（渲染前的静态证据：轨道数 / 构件数 / 音效数）
  const compileFacts = cases.map((c) => ({
    label: c.label,
    templateId: c.templateId,
    stripFurniture: c.stripFurniture,
    trackCount: c.stats.trackCount,
    furnitureTracks: c.stats.furnitureTracks,
    sfxCount: c.stats.sfxCount,
    textTracks: c.textTrackCount,
    durationInFrames: c.durationInFrames,
    fps: c.fps,
  }))
  report.compile = compileFacts
  for (const fact of compileFacts) console.log(`  编译 ${fact.label}：轨 ${fact.trackCount}（构件 ${fact.furnitureTracks}）· sfx ${fact.sfxCount} · 文字 ${fact.textTracks}`)

  const ensureAt = Date.now()
  const handle = ensureRenderHost({
    url: `http://127.0.0.1:${port}/canvas-studio/render-host`,
    log: (message) => step('window', { message }),
  })
  if (handle === undefined) throw new Error('ensureRenderHost 返回 undefined（取不到 electron）')
  await waitFor('first idle heartbeat', 30_000, () => firstIdleAt > 0)
  if (typeof statusOrigin !== 'string' || !statusOrigin.startsWith(`http://127.0.0.1:${port}`)) {
    throw new Error(`页面自报未携带同源 Origin（实际 ${String(statusOrigin)}）`)
  }
  step('phase1:ok', { bootMs: firstIdleAt - ensureAt })
  console.log(`阶段 1 ✅ 隐藏窗口就绪（冷启 ${firstIdleAt - ensureAt}ms）`)

  // 顺序渲染（渲染 host 单任务串行，不能并发派单）
  for (const kase of cases) {
    const rendered = await renderCase(kase, ffmpeg)
    report.renders.push({ label: kase.label, ...rendered, metrics: undefined })
    kase.out = rendered
  }

  // 断言 1：三支样片都能渲出来，且分辨率/流型正确
  await assertStep(1, '四模板成片可解析（h264 / 1080p / 帧数与模板一致）', async () => {
    const rows = []
    for (const kase of cases) {
      const info = await probeStreams(ffmpeg, kase.out.mp4)
      if (!/h264/.test(info.videoLine)) throw new Error(`${kase.label} 非 h264：${info.videoLine}`)
      if (info.width !== 1920 || info.height !== 1080) throw new Error(`${kase.label} 分辨率 ${info.width}x${info.height} ≠ 1920x1080`)
      const expectSec = kase.durationInFrames / kase.fps
      if (Math.abs(info.seconds - expectSec) > 0.25) throw new Error(`${kase.label} 时长 ${info.seconds}s 偏离 ${expectSec}s 超过 0.25s`)
      rows.push({ label: kase.label, size: `${info.width}x${info.height}`, seconds: info.seconds, expectSec })
    }
    return rows
  })

  // 断言 2：音效真的混进成片（四支样片都有非静音 aac 音轨）
  await assertStep(2, '音效混流（aac / 48kHz / 立体声 / 非静音）', async () => {
    const rows = []
    for (const kase of cases) {
      const info = await probeStreams(ffmpeg, kase.out.mp4)
      if (!/aac/.test(info.audioLine)) throw new Error(`${kase.label} 无 aac 音轨：${info.audioLine || '（无音轨）'}`)
      if (!/48000 Hz/.test(info.audioLine)) throw new Error(`${kase.label} 采样率非 48000：${info.audioLine}`)
      const peaks = await decodePeaks(ffmpeg, kase.out.mp4, kase.fps, `pcm-${kase.label}.wav`)
      if (peaks.max < 0.05) throw new Error(`${kase.label} 音轨近乎静音（峰 ${peaks.max.toFixed(4)}）`)
      const audible = [...peaks.peaks].filter((p) => p > 0.02).length
      if (audible < kase.stats.sfxCount) {
        throw new Error(`${kase.label} 有声帧 ${audible} 少于音效条数 ${kase.stats.sfxCount}`)
      }
      rows.push({ label: kase.label, maxPeak: Number(peaks.max.toFixed(3)), audibleFrames: audible, sfx: kase.stats.sfxCount, audioSec: Number(peaks.seconds.toFixed(3)) })
    }
    return rows
  })

  // 断言 3：真机回报里逐条文字轨无溢出（0B 的 report.textFit 端到端 —— 0B 当时缺的就是这一环）
  await assertStep(3, 'report.textFit 端到端（逐条 overflow=false）', () => {
    const rows = []
    for (const kase of cases) {
      const textFit = kase.out.metrics?.textFit
      if (!Array.isArray(textFit)) throw new Error(`${kase.label} 回报里没有 textFit 数组（metrics keys: ${Object.keys(kase.out.metrics ?? {}).join(',')}）`)
      const overflowed = textFit.filter((e) => e.overflow === true)
      if (overflowed.length > 0) {
        throw new Error(`${kase.label} 有 ${overflowed.length} 条溢出：${overflowed.map((e) => `${e.id}(${e.lines.join('/')})`).join(' | ')}`)
      }
      if (textFit.length !== kase.textTrackCount) {
        throw new Error(`${kase.label} 体检条数 ${textFit.length} ≠ 文字轨数 ${kase.textTrackCount}`)
      }
      rows.push({ label: kase.label, entries: textFit.length, overflows: 0 })
    }
    return rows
  })

  // 断言 4：构件真的上了屏 —— 与「同模板去 furniture」的成片做像素差分
  const science = cases.find((c) => c.label === 'science__three-cards')
  const nofx = cases.find((c) => c.label === 'science__nofx')
  const frame = science.durationInFrames - 2 // 末帧前的稳定帧：括线常驻、游标已走到底部右侧
  const frameA = await extractFrame(ffmpeg, science.out.mp4, frame, 'frame-science.rgb')
  const frameB = await extractFrame(ffmpeg, nofx.out.mp4, frame, 'frame-science-nofx.rgb')
  if (frameA.length !== frameB.length) throw new Error(`两份成片帧字节数不同：${frameA.length} vs ${frameB.length}`)
  {
    const W = 1920
    const H = 1080
    // ⚠️ 判据用**差分像素数**，不用区域均值 —— 括线只有 1.5px 粗（`thickness 0.08%`），
    // 落在 110px 方框里只占 ~70 个像素，均值的量级被面积稀释到 0.2，和压缩噪声同档；
    // 而「有多少像素变化超过 12 级」是二值的，实测 tl/tr 71/72、bl 107、中心 7（噪声）。
    const corner = 110 // 括线中心在 2.4% 内缩处（≈46px），臂长 1.2%（≈23px）⇒ 110px 方框足够覆盖
    const cornerBoxes = [
      { name: 'tl', x0: 0, y0: 0, x1: corner, y1: corner },
      { name: 'tr', x0: W - corner, y0: 0, x1: W, y1: corner },
      { name: 'bl', x0: 0, y0: H - corner, x1: corner, y1: H },
      { name: 'br', x0: W - corner, y0: H - corner, x1: W, y1: H },
    ]
    const cornerPixels = {}
    for (const box of cornerBoxes) {
      cornerPixels[box.name] = countDiffPixels(frameA, frameB, W, H, 12, box)
    }
    const bottomPixels = countDiffPixels(frameA, frameB, W, H, 12, { x0: 0, y0: Math.floor(H * 0.93), x1: W, y1: H })
    const centerPixels = countDiffPixels(frameA, frameB, W, H, 12, {
      x0: Math.floor(W * 0.4), y0: Math.floor(H * 0.4), x1: Math.floor(W * 0.6), y1: Math.floor(H * 0.6),
    })
    const totalPixels = countDiffPixels(frameA, frameB, W, H, 12)
    const detail = { frame, cornerPixels, bottomPixels, centerPixels, totalPixels }
    report.furniture = detail
    console.log(`  构件差分：${JSON.stringify(detail)}`)
    for (const [name, count] of Object.entries(cornerPixels)) {
      // 四角括线每角 ~70 个像素（横臂 23×1.5 + 竖臂 1.5×13，含压缩糊化）；30 是「在但被压得很淡」的下界
      if (count < 30) throw new Error(`四角括线未上屏：${name} 角差分像素 ${count}（构件缺失或位置算错）`)
    }
    // 底部进度条：40 根刻度 + 游标，实测 1948 个像素
    if (bottomPixels < 200) throw new Error(`底部进度条未上屏：底部带差分像素 ${bottomPixels}`)
    // 对照：两份成片只差构件，画面中心（纯文字）只该有编码噪声（实测 7）
    if (centerPixels > 40) throw new Error(`画面中心出现非构件差异 ${centerPixels} 像素（两份成片本应只有构件不同）`)
    if (totalPixels < 800) throw new Error(`构件像素太少（${totalPixels}）：括线与进度条不可能只占这么点`)
    await assertStep(4, '构件上屏（四角括线 + 底部进度条，像素差分实证）', () => detail)
  }

  // 断言 5：确定性 —— 同一份 manifest 再渲一次必须逐像素相同（禁 Date.now / Math.random）
  const again = await renderCase({ ...science, label: 'science__again' }, ffmpeg)
  {
    const frameC = await extractFrame(ffmpeg, again.mp4, frame, 'frame-science-again.rgb')
    let worst = 0
    let differing = 0
    for (let i = 0; i < frameA.length; i += 1) {
      const d = Math.abs(frameA[i] - frameC[i])
      if (d > worst) worst = d
      if (d > 0) differing += 1
    }
    const detail = { frame, worstChannelDelta: worst, differingBytes: differing, totalBytes: frameA.length }
    report.determinism = detail
    console.log(`  确定性：${JSON.stringify(detail)}`)
    // 允许编码器非确定性导致的极小噪声（<2 个色阶、占比 <0.5%），但绝不接受结构差异
    if (worst > 2) throw new Error(`重渲帧出现 ${worst} 级色差（应逐像素一致）`)
    if (differing / frameA.length > 0.005) throw new Error(`重渲帧有 ${(differing / frameA.length * 100).toFixed(2)}% 字节不同`)
    await assertStep(5, '确定性（同 manifest 重渲逐像素一致）', () => detail)
  }

  // 断言 6：模板 docs 与实现不脱钩 —— 每个模板都有 README / slots / meta，frames 目录存在
  await assertStep(6, '模板目录自洽（meta/slots/furniture/audio/manifest/README/frames）', () => {
    const rows = []
    for (const id of TEMPLATE_IDS) {
      const dir = join(packageRoot, 'assets', 'templates', ...id.split('/'))
      const files = readdirSync(dir)
      for (const need of ['meta.json', 'slots.json', 'furniture.json', 'audio.json', 'manifest.template.json', 'README.md', 'frames']) {
        if (!files.includes(need)) throw new Error(`${id} 缺 ${need}`)
      }
      rows.push({ id, files: files.length })
    }
    return rows
  })

  report.ok = true
}

app.whenReady().then(main)
  .then(() => {
    report.finishedAt = new Date().toISOString()
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`\n全部 ${results.length} 条断言通过 ✅ 报告 → ${join(outDir, 'report.json')}`)
    step('done', { ok: true })
    app.exit(0)
  })
  .catch((error) => {
    report.finishedAt = new Date().toISOString()
    report.ok = false
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    try { writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2)) } catch { /* 报告写不进去也不影响退出码 */ }
    console.error(`\n❌ ${report.error}`)
    step('failed', { error: String(error) })
    app.exit(1)
  })
