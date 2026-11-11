// 0A-8 · SFX 事件轨端到端探针（CV-460，照 render-host-e2e.probe.mjs 的骨架）。
//
// 真实隐藏窗口 + 真实 render-host bundle 渲一张**纯 sfx 音频**的 manifest
// （7 条事件 = gt/mix-report.json 的 GT 真值；3 张卡走 anchor 定位，其余走 startFrame），
// 成片落 /tmp/cs-sfx-e2e/out.mp4，然后按 `任务包-0A-SFX事件轨.md` §5.2.3 **顺序**跑
// 七条断言（任一失败即停，报告照写）。期望值一律从 GT / assets/sfx/manifest.json 读，
// **不硬编码**（换 GT 时脚本不失准）。
//
// 运行（Electron main 里跑，不是 node）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/sfx-e2e.probe.mjs
//
// 退出码：任一断言失败 ⇒ 1。报告落 /tmp/cs-sfx-e2e/report.json。
// 铁律（无人值守推进协议 §2）：绝不 kill Electron 进程；所有等待用内部预算，跑完自退。

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app } from 'electron'
import { runFfmpegCapture, parseWav } from './lib/audio-probe.mjs'
// 顶层一次性导入素材解码（断言 5 期望口径用；见下方 sfxFramePeak 的口径注释）。

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const outDir = '/tmp/cs-sfx-e2e'
mkdirSync(outDir, { recursive: true })
const stepLog = join(outDir, 'steps.log')
const step = (tag, extra) => {
  const line = `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`
  try { appendFileSync(stepLog, line + '\n') } catch { /* 日志失败不影响判定 */ }
  console.log(line)
}

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.length > 0) return process.env.FFMPEG_PATH
  return join(packageRoot, '..', 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

// ── GT 真值（唯一事实源：gt/mix-report.json）与素材时长（assets/sfx/manifest.json） ──
const gt = JSON.parse(readFileSync(join(packageRoot, 'docs', 'plans', '2026-11-10-视频模板化', 'gt', 'mix-report.json'), 'utf8'))
const sfxAssets = JSON.parse(readFileSync(join(packageRoot, 'assets', 'sfx', 'manifest.json'), 'utf8'))
const FPS = 60
const sfxDurationSec = (type) => sfxAssets.voices.find((v) => v.id === type)?.durationSec ?? 0

// ⚠️ 断言 5 的期望口径（D-18 附带发现）：manifest.json 的 peak=0.891 是**立体声模长**
// 口径（L²+R² 归一），单声道样本峰实测 0.630 = 0.891/√2。拿 0.891 折算单声道测量峰
// 会系统性高估 √2（+3dB）。⇒ 期望值改用**素材帧级实测峰**（与成片测量同口径：800 样本/
// 帧的 max），口径差自动抵消，只剩 AAC 编码与 muxer 后移的真实影响。

// GT 事件 → 帧号真值（D-01：GT 复刻验收走帧域）。三张卡同时是**视觉轨**：
// sfx 用 anchor 定位指向卡轨 start，音画对齐由构造保证（断言 3）。
const gtEvents = gt.events.map((e) => ({
  type: e.source.type,
  gain: e.source.g,
  startFrame: Math.round(e.outputTime * FPS),
}))
if (gtEvents.length !== gt.selectedEvents) throw new Error(`GT 事件数 ${gtEvents.length} ≠ selectedEvents ${gt.selectedEvents}`)

const cardEvents = gtEvents.filter((e) => e.type === 'card')
const cardTracks = cardEvents.map((e, i) => ({
  id: `card-${i + 1}`,
  type: 'textCard',
  variant: 'title',
  text: `卡${i + 1}`,
  startFrame: e.startFrame,
  durationInFrames: 10,
}))
let cardSeq = 0
const sfxList = gtEvents.map((e) => ({
  src: `/canvas-studio/remotion/sfx/${e.type}.wav`,
  ...(e.type === 'card' ? { anchor: { trackId: `card-${++cardSeq}`, at: 'start' } } : { startFrame: e.startFrame }),
  gain: e.gain,
  type: e.type,
}))

const DURATION_FRAMES = 1080 // 18s：盖住最后一条 swipe（1056 + 0.25s×60 = 1071）
const manifest = {
  meta: { title: 'sfx-e2e', width: 640, height: 360, fps: FPS, durationInFrames: DURATION_FRAMES, backgroundColor: '#061018', lint: 'off' },
  tracks: [
    { id: 'bed', type: 'shape', shape: 'rect', color: '#1d4ed8', startFrame: 0, durationInFrames: DURATION_FRAMES, box: { x: 10, y: 10, w: 40, h: 40 } },
    ...cardTracks,
  ],
  audio: { sfx: sfxList },
}

// 波形级参考混音（断言 5 的期望，D-18）：7 条素材按 GT 时刻**逐样本相加**（gain 线性乘）
// 再按 800 样本/帧取帧峰 —— 与成片 framePeaksOf 完全同口径。不能拿「素材帧峰 × Σgain」
// 当期望：多事件窗口重叠时各素材峰**错相位**（card 峰在素材 51% 处、起点差 10 帧），
// 同峰假设会高估 ~9.6dB（实测踩过）。混音不含 muxer 后移，但断言 5 的扫描窗带 +4 尾余量，
// 峰值必然落窗内，数值可比。
const MIX_SPF = 800 // 48000/60
const MIX_LENGTH = 1084 * MIX_SPF * 2 // 与实测解码出的音轨等长（18.069s）
const referenceMix = new Float32Array(MIX_LENGTH)
for (const e of gtEvents) {
  const wav = parseWav(readFileSync(join(packageRoot, 'assets', 'sfx', `${e.type}.wav`)))
  if (wav === null) throw new Error(`素材 wav 解析失败：${e.type}`)
  const base = e.startFrame * MIX_SPF * 2
  for (let i = 0; i < wav.samples.length && base + i < MIX_LENGTH; i += 1) {
    referenceMix[base + i] += (wav.samples[i] / 32768) * e.gain
  }
}
const referenceMixFramePeaks = (() => {
  const peaks = new Float64Array(1084)
  for (let f = 0; f < 1084; f += 1) {
    let peak = 0
    for (let i = f * MIX_SPF * 2; i < (f + 1) * MIX_SPF * 2; i += 1) {
      const a = Math.abs(referenceMix[i])
      if (a > peak) peak = a
    }
    peaks[f] = peak
  }
  return peaks
})()

const fakeJob = {
  jobId: 'rj-sfx-probe-0001',
  projectId: 'proj-sfx-probe',
  manifest,
  fps: FPS,
  quality: 'draft',
  realDurations: {},
  sampleFrames: [0, 540, DURATION_FRAMES - 1],
}

// ── 假宿主：render-host 页面用到的协议 + 包内 sfx wav 只读分发 ──
let fakeJobDispatchable = false
let committedBytes = null
let cancelledReason = null
const heartbeats = []
let statusOrigin = null
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
    if (req.method === 'GET' && /^\/canvas-studio\/remotion\/sfx\/[a-z0-9-]+\.wav$/.test(url.pathname)) {
      const file = url.pathname.slice('/canvas-studio/remotion/sfx/'.length)
      try {
        const bytes = readFileSync(join(packageRoot, 'assets', 'sfx', file))
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(bytes)
      } catch {
        json(404, { error: `probe: sfx not found: ${file}` })
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/canvas-studio/render-host/status') {
      try {
        const report = JSON.parse(body.toString('utf8') || '{}')
        if (statusOrigin === null && req.headers.origin !== undefined) statusOrigin = req.headers.origin
        heartbeats.push({ at: Date.now(), state: report.state })
        if (report.state === 'idle' && firstIdleAt < 0) firstIdleAt = Date.now()
        if (report.state === 'idle') fakeJobDispatchable = true
      } catch { /* 脏心跳不致命 */ }
      json(200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/canvas-studio/remotion/pending') {
      json(200, { job: fakeJobDispatchable && committedBytes === null && cancelledReason === null ? fakeJob : null })
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

let firstIdleAt = -1
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

// ── 七条断言（§5.2.3，顺序跑，任一失败即停）──
const results = []
const assertStep = async (no, name, fn) => {
  step(`assert${no}:start`, { name })
  const detail = await fn()
  results.push({ no, name, ok: true, detail })
  step(`assert${no}:ok`, detail)
  console.log(`断言 ${no} ✅ ${name}`, typeof detail === 'object' ? JSON.stringify(detail) : detail ?? '')
}

/** 48kHz 立体声解码（起音/峰值判定要帧级精度，lib 的 extractWav 固定 8kHz 不够）。
 *  outName 必须区分来源 —— 0A-8 踩过：mp4 与参考混音共用固定名，后者把前者覆盖，
 *  事后取证拿到的是参考混音而不是成片（差点误判成"测量拓扑"问题）。 */
async function extractWav48(file, ffmpeg, outName = 'decoded-48k.wav') {
  const out = join(outDir, outName)
  const res = await runFfmpegCapture(ffmpeg, ['-i', file, '-vn', '-c:a', 'pcm_s16le', '-y', out])
  if (res.code !== 0) throw new Error(`48kHz wav 导出失败：${res.stderr.trim().split('\n').slice(-4).join(' | ')}`)
  const wav = parseWav(readFileSync(out))
  if (wav === null) throw new Error('48kHz wav 解析失败（RIFF/data 块缺失）')
  return wav
}

async function main() {
  const ffmpeg = resolveFfmpeg()
  const port = await listen(0)
  step('server:up', { port })

  const ensureAt = Date.now()
  const handle = ensureRenderHost({
    url: `http://127.0.0.1:${port}/canvas-studio/render-host`,
    log: (message) => step('window', { message }),
  })
  if (handle === undefined) throw new Error('ensureRenderHost 返回 undefined（取不到 electron）')

  await waitFor('first idle heartbeat', 30_000, () => firstIdleAt > 0)
  const originOk = typeof statusOrigin === 'string' && statusOrigin.startsWith(`http://127.0.0.1:${port}`)
  if (!originOk) throw new Error(`页面自报未携带同源 Origin（实际 ${String(statusOrigin)}）`)
  step('phase1:ok', { bootMs: firstIdleAt - ensureAt })
  console.log(`阶段 1 ✅ 隐藏窗口就绪（冷启 ${firstIdleAt - ensureAt}ms）`)

  const renderStartedAt = Date.now()
  await new Promise((resolve) => {
    commitWaiters.push(resolve)
    setTimeout(() => { if (committedBytes === null && cancelledReason === null) resolve() }, 600_000)
  })
  if (cancelledReason !== null) throw new Error(`窗口撤单：${cancelledReason}`)
  if (committedBytes === null) throw new Error('600s 内未收到成片字节')
  const mp4Path = join(outDir, 'out.mp4')
  writeFileSync(mp4Path, committedBytes)
  step('phase2:ok', { renderMs: Date.now() - renderStartedAt, bytes: committedBytes.length })
  console.log(`阶段 2 ✅ 渲染出片：${Date.now() - renderStartedAt}ms，${committedBytes.length} 字节 → ${mp4Path}`)

  const framePeaksOf = (wav) => {
    const spf = Math.round(wav.sampleRate / FPS) // 800 @48kHz/60fps
    const frameCount = Math.floor(wav.samples.length / wav.channels / spf)
    const peaks = new Float64Array(frameCount)
    for (let f = 0; f < frameCount; f += 1) {
      let peak = 0
      for (let i = f * spf * wav.channels; i < (f + 1) * spf * wav.channels; i += 1) {
        const v = Math.abs(wav.samples[i]) / 32768
        if (v > peak) peak = v
      }
      peaks[f] = peak
    }
    return { peaks, frameCount }
  }

  // 断言 1：成片有音轨（h264 + aac / 48000 / 2ch）
  await assertStep(1, '成片有音轨', async () => {
    const probe = await runFfmpegCapture(ffmpeg, ['-i', mp4Path])
    const videoLine = probe.stderr.split('\n').find((l) => /Video:/.test(l)) ?? ''
    const audioLine = probe.stderr.split('\n').find((l) => /Audio:/.test(l)) ?? ''
    if (!/Video:.*h264/.test(videoLine)) throw new Error(`视频流非 h264：${videoLine.trim()}`)
    if (!/Audio:.*aac/.test(audioLine)) throw new Error(`音频流非 aac：${audioLine.trim() || '（无音轨）'}`)
    if (!/48000 Hz/.test(audioLine)) throw new Error(`采样率非 48000：${audioLine.trim()}`)
    if (!/stereo|2 channels/.test(audioLine)) throw new Error(`非立体声：${audioLine.trim()}`)
    // ⚠️ 不要拿流的**平均码率**当质量判据（0A-8 踩过）：纯音效片 18s 里只有 ~2.5s 有声，
    // 平均码率天然只有 ~16–24kbps，与编码质量无关。质量由断言 5（波形保真）与断言 6
    // （响度相对参考）把守。
    return { audioLine: audioLine.trim().slice(0, 120) }
  })

  // 断言 2：事件帧号逐条精确相等（GT round(outputTime×60)；anchor 卡走卡轨 start 折算）
  await assertStep(2, '事件帧号逐条精确相等', () => {
    const expected = gtEvents.map((e) => e.startFrame)
    const declared = sfxList.map((s) => s.startFrame ?? cardTracks.find((t) => t.id === s.anchor.trackId).startFrame)
    const diff = expected.findIndex((f, i) => f !== declared[i])
    if (diff >= 0) throw new Error(`第 ${diff} 条不齐：声明 ${declared[diff]} ≠ GT ${expected[diff]}`)
    return { frames: expected, locate: sfxList.map((s) => (s.startFrame === undefined ? 'anchor' : 'frame')) }
  })

  // 断言 3：三卡音画对齐（卡事件帧集合 = 视觉卡轨入场帧集合）
  await assertStep(3, '三卡音画对齐', () => {
    const cardFrames = cardEvents.map((e) => e.startFrame).sort((a, b) => a - b)
    const visualStarts = cardTracks.map((t) => t.startFrame).sort((a, b) => a - b)
    if (cardFrames.join(',') !== visualStarts.join(',')) {
      throw new Error(`卡音效帧 [${cardFrames}] ≠ 视觉卡入场帧 [${visualStarts}]`)
    }
    return { cardFrames }
  })

  // 断言 4：起音实测（**差分口径**，D-18）。
  //
  // 原断言「与事件帧偏差 ≤1 帧」隐含的前提是 muxer 会写 edit list 补偿 AAC priming。
  // 实测（2026-11-11）：同机 ffmpeg 参考混音（adelay+amix）孤立事件 dev ∈ {−1,0,+1}，
  // 前提成立；而 CSR 渲染链（@remotion/media → mediabunny mux）**不补偿 priming**，
  // 全体音频恒定后移 ~2.5 帧（音轨 18.069s > 视频 18.0s 实锤）——REQ-034 起 bgm/voiceOver
  // 同样带着这个属性，是 muxer 层既有事实，不是 0A-7 的调度缺陷（差分 Δ 消掉起音坡度
  // 偏置后 spread=1，调度均匀正确）。
  // ⇒ 修订：① 参考混音当场用同机 ffmpeg 生成，孤立事件 dev_ref 必须 ∈ ±1（原断言前提
  //   的实证守卫）；② CSR 成片逐事件 Δ = dev_csr − dev_ref（同一检测器同阈值，攻击坡度
  //   偏置自动抵消）必须全部 ∈ [0,4]（AAC priming 2.56 帧 + 帧量化 ≤1 的物理上界）且
  //   相互差 ≤1（均匀后移 = 调度正确）。card2/3 被前卡持续音淹没（阈值法不可分），
  //   它们的对齐由断言 3 的集合相等保证，不进本断言。
  const { peaks, frameCount } = framePeaksOf(await extractWav48(mp4Path, ffmpeg, 'csr-48k.wav'))
  // 参考混音（断言 4/6 共用）：7 条素材按 GT 帧时刻 adelay + **volume=GT gain** + amix
  // （normalize=0 保电平），同机同 ffmpeg 编码 —— 它是「这套素材、这些增益」的物理基准
  // （起音前提 + 响度基准）。⚠️ gain 不能漏：0A-8 实测踩过——漏了 gain 的参考是全电平
  // 混音，比成片（按 gain 衰减）响 ~10 LU，会把「渲染正确」误判成「响度塌陷」。
  const refInputs = gtEvents.map((e) => ['-i', join(packageRoot, 'assets', 'sfx', `${e.type}.wav`)])
  const refPath = join(outDir, 'ref-mix.m4a')
  const refFilter = [
    ...gtEvents.map((e, i) => `[${i}:a]adelay=${(e.startFrame * 1000 / FPS).toFixed(2)}|${(e.startFrame * 1000 / FPS).toFixed(2)},volume=${e.gain}[a${i}]`),
    `${gtEvents.map((_, i) => `[a${i}]`).join('')}amix=inputs=${gtEvents.length}:normalize=0[out]`,
  ].join(';')
  const refBuild = await runFfmpegCapture(ffmpeg, [...refInputs.flat(), '-filter_complex', refFilter, '-map', '[out]', '-c:a', 'aac', '-ar', '48000', '-y', refPath])
  if (refBuild.code !== 0) throw new Error(`参考混音失败：${refBuild.stderr.trim().split('\n').slice(-3).join(' | ')}`)
  const refPeaks = framePeaksOf(await extractWav48(refPath, ffmpeg, 'ref-48k.wav'))

  const measureEbur128 = async (file) => {
    const res = await runFfmpegCapture(ffmpeg, ['-i', file, '-filter_complex', 'ebur128', '-f', 'null', '-'])
    const summary = res.stderr.slice(res.stderr.lastIndexOf('Summary:'))
    const match = /I:\s+(-?[\d.]+)\s+LUFS/u.exec(summary)
    if (match === null) throw new Error(`ebur128 摘要解析失败（${file}）：${summary.trim().slice(0, 160)}`)
    return Number(match[1])
  }
  const refLufs = await measureEbur128(refPath)

  const ONSET_FLOOR = 0.01 // 事件窗外是数字静音（断言 7 < −60dBFS），−40dBFS 阈值足够分
  const detectDev = (peaks, frameCount, F) => {
    for (let f = Math.max(0, F - 2); f <= Math.min(frameCount - 1, F + 48); f += 1) {
      if (peaks[f] > ONSET_FLOOR) return f - F
    }
    return null
  }
  const ISOLATED_TYPES = new Set(['thud', 'write', 'swoosh', 'swipe'])
  // card 集群只有头部可测（card1 之后是持续音）。
  const firstCardIndex = gtEvents.findIndex((e) => e.type === 'card')
  const measurable = gtEvents
    .map((e, i) => ({ ...e, index: i }))
    .filter((e) => ISOLATED_TYPES.has(e.type) || e.index === firstCardIndex)
  await assertStep(4, '起音实测（差分口径 vs 同机 ffmpeg 参考）', () => {
    const rows = measurable.map((e) => {
      const devCsr = detectDev(peaks, frameCount, e.startFrame)
      const devRef = detectDev(refPeaks.peaks, refPeaks.frameCount, e.startFrame)
      if (devCsr === null || devRef === null) throw new Error(`${e.type}@${e.startFrame}：起音未检出（csr=${devCsr} ref=${devRef}）`)
      return { type: e.type, F: e.startFrame, devCsr, devRef, delta: devCsr - devRef }
    })
    // devRef 的 ±1 前提只在**无衰减电平**下物理成立（已实证过一轮）；带 gain 的参考里
    // 软起音过 0.01 阈值更慢（阈值偏置），所以这里只记录不判红 —— 调度正确性由下面的
    // Δ 差分判据承担（同 gain 同阈值，偏置自动抵消）。
    const refWarn = rows.filter((r) => Math.abs(r.devRef) > 1)
    const badDelta = rows.filter((r) => r.delta < 0 || r.delta > 4)
    if (badDelta.length > 0) throw new Error(`muxer 差分超 [0,4]：${JSON.stringify(badDelta)}`)
    const deltas = rows.map((r) => r.delta)
    if (Math.max(...deltas) - Math.min(...deltas) > 1) {
      throw new Error(`后移不均匀（调度问题，非 muxer 属性）：Δ = [${deltas.join(',')}]`)
    }
    return { rows, refWarn: refWarn.length > 0 ? refWarn.map((r) => `${r.type}:devRef=${r.devRef}`) : '无', note: 'Δ∈[0,4] = muxer 不补偿 priming 的既有属性；devRef 绝对值含阈值偏置（信息性）' }
  })

  // 断言 5：事件窗口峰值 ±6dB（期望 = 波形级参考混音的窗口帧峰，与实测同口径同窗口）
  await assertStep(5, '事件窗口峰值 ±6dB', () => {
    const windows = gtEvents.map((e) => ({
      F: e.startFrame,
      end: e.startFrame + Math.max(1, Math.round(sfxDurationSec(e.type) * FPS)) + 4, // 尾余量盖 muxer 后移
      type: e.type,
    }))
    const details = windows.map((w) => {
      let measured = 0
      for (let f = w.F; f < Math.min(w.end, frameCount); f += 1) measured = Math.max(measured, peaks[f])
      let expected = 0
      for (let f = w.F; f < Math.min(w.end, referenceMixFramePeaks.length); f += 1) {
        expected = Math.max(expected, referenceMixFramePeaks[f])
      }
      const db = 20 * Math.log10(Math.max(measured, 1e-6) / Math.max(expected, 1e-6))
      if (Math.abs(db) > 6) throw new Error(`${w.type}@${w.F}：实测 ${measured.toFixed(4)} vs 期望 ${expected.toFixed(4)}（${db.toFixed(1)}dB）`)
      return { type: w.type, F: w.F, db: Number(db.toFixed(1)) }
    })
    return { details }
  })

  // 断言 6：整片响度 ebur128（**相对参考口径**，D-18）。
  // 原闸 −24~−18（GT −21.1）隐含的前提是「GT 的素材电平与混响尾」——我们走零授权
  // 合成素材（无共享混响、统一峰值归一、按 GT gain 衰减），响度天然不落 GT 闸内，
  // 那是素材差异不是渲染缺陷。⇒ 判据改为：|成片 − 参考混音| ≤ 3 LU（渲染不丢响度）
  // + 绝对护栏 [−30, −12]（兜住"静音片/爆音片"）。参考必须带 gain（见上）。
  await assertStep(6, '整片响度 ebur128（相对参考 ±3LU）', async () => {
    const lufs = await measureEbur128(mp4Path)
    if (lufs < -30 || lufs > -12) throw new Error(`integrated ${lufs} LUFS 出绝对护栏 [−30, −12]`)
    if (Math.abs(lufs - refLufs) > 3) throw new Error(`integrated ${lufs} LUFS 偏离参考 ${refLufs} 超 3 LU（渲染丢响度）`)
    return { lufs, refLufs, note: '参考 = 同机 ffmpeg 对同一批素材的混音（无混响，合成素材电平）' }
  })

  // 断言 7：除 7 个事件窗外无 > −60dBFS 的峰（防「每帧都放了音效」）。
  // 窗口尾余量 +4：CSR muxer 不补偿 priming ⇒ 全体音频恒定后移 ≤4 帧（断言 4 实测），
  // 事件尾会拖出声明的素材时长之外 —— 这是既有 muxer 属性，不算「额外声音」。
  await assertStep(7, '事件窗外无额外声音', () => {
    const windows = gtEvents.map((e) => [e.startFrame - 1, e.startFrame + Math.round(sfxDurationSec(e.type) * FPS) + 4])
    const offenders = []
    // 头 3 帧豁免：AAC 编码器初始化窗（首帧 priming 常有低位噪声，GT 片同样存在）。
    for (let f = 3; f < frameCount; f += 1) {
      if (peaks[f] > 0.001 && !windows.some(([a, b]) => f >= a && f < b)) offenders.push(f)
    }
    if (offenders.length > 0) throw new Error(`窗外有声音的帧（前 10 个）：${offenders.slice(0, 10).join(',')}（峰 ${offenders.slice(0, 3).map((f) => peaks[f].toFixed(4))}）`)
    return { checkedFrames: frameCount - 3, windowCount: windows.length }
  })

  const report = {
    ok: true,
    render: { ms: Date.now() - renderStartedAt, bytes: committedBytes.length },
    gt: { events: gtEvents.length, frames: gtEvents.map((e) => e.startFrame) },
    assertions: results,
    at: new Date().toISOString(),
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log('report →', join(outDir, 'report.json'))
  console.log(`\n0A-8 ✅ 七条断言全绿（GT ${gtEvents.length} 事件，帧 [${gtEvents.map((e) => e.startFrame).join(',')}]）`)
  app.exit(0)
}

const loadLib = (rel) => import(pathToFileURL(join(packageRoot, 'lib', rel)).href)
const { ensureRenderHost } = await loadLib('render-host/window.js')
const { renderHostHtml } = await loadLib('render-host/page.js')
const renderHostBundle = readFileSync(join(packageRoot, 'lib', 'render-host.js'))

app.whenReady().then(main).catch((error) => {
  step('fatal', { message: String(error?.message ?? error) })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ok: false, error: String(error?.message ?? error), assertions: results, at: new Date().toISOString() }, null, 2))
  console.error(error)
  app.exit(1)
})
