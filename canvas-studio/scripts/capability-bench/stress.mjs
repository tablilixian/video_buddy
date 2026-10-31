/**
 * 能力基准 · S1/S2 规模与稳定性驱动（B 组，2026-10-31）。
 *
 * 复用 bench 基建（bundle → server → Electron → renderMediaOnWeb → ffprobe），
 * 产物落 `<产物根>/_stress/`（§9.2：S1/S2 不占能力文件夹）。产品代码零改动。
 *
 *   S1 规模采样点（§8 拍板 1：三点，不跑 1800s）：
 *     P1 1920×1080@60 ×300 帧（10s）
 *     P2 1920×1080@30 ×1800 帧（60s）
 *     P3 1280×720@30  ×5400 帧（180s —— 3 分钟长任务，量 arraybuffer 内存与吞吐）
 *     每点记录：canRender、渲染耗时、ms/帧、码率、峰值主进程 RSS、渲染堆、H1–H5（H4 不跑）。
 *
 *   S2 连渲稳定性（R6：≥30s 任务；窗口口径见 D19）：
 *     合成 1920×1080@30 ×900 帧（30s）；窗口 = visible / hidden / hidden-throttled
 *     （BENCH_ALLOW_THROTTLE=1 ⇒ 保留 Chromium 默认节流，即"RenderHost 不做防节流"的对照）；
 *     每档连渲 5 次：成功率、耗时均值/标准差/CV（门槛 <20%）、ffprobe 全绿、逐次字节。
 *
 * 用法：NODE_OPTIONS= node scripts/capability-bench/stress.mjs [--s1] [--s2] [--out=<dir>]
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contactSheet, runChecks } from './lib/checks.mjs'
import { launchRenderer, parseEvents } from './lib/electron.mjs'
import { startBenchServer } from './lib/server.mjs'
import { POOL_SOURCES } from './specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANVAS_ROOT = resolve(HERE, '..', '..')
const BUNDLE_DIR = join(HERE, '.bundle')
const FONT_DIR = join(CANVAS_ROOT, 'assets', 'fonts')
const DEFAULT_OUT = '/Users/wl/Desktop/job/VideoOut/remotion-capability-20261029/_stress'

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)
const log = (...a) => console.log('[stress]', ...a)

const REPO = resolve(CANVAS_ROOT, '..')
function electronBin() {
  const requireFromDesktop = createRequire(join(REPO, 'dsh-plugin-desktop', 'package.json'))
  return requireFromDesktop('electron')
}

async function buildBundle() {
  const { bundle } = await import('@remotion/bundler')
  log('打包 bundle（webpack，与 run.mjs 同一份）…')
  const started = Date.now()
  await bundle({
    entryPoint: join(HERE, 'compositions', 'entry.tsx'),
    outDir: BUNDLE_DIR,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...(config.resolve ?? {}),
        extensionAlias: { ...((config.resolve && config.resolve.extensionAlias) || {}), '.js': ['.ts', '.tsx', '.js'] },
      },
    }),
  })
  log(`bundle 完成（${Math.round((Date.now() - started) / 1000)}s）`)
}

async function renderOnce({ outDir, outName, width, height, fps, durationInFrames, window, extraEnv = {}, timeoutMs = 900000 }) {
  const { server, url } = await startBenchServer({
    bundleDir: BUNDLE_DIR,
    outDir,
    pool: Object.fromEntries(Object.entries(POOL_SOURCES).filter(([k]) => k === 'image')),
    fontDir: FONT_DIR,
    config: {
      id: 'S1',
      outName,
      width,
      height,
      fps,
      durationInFrames,
      stills: [],
      window,
      allowHtmlInCanvas: false,
    },
  })
  const target = join(outDir, outName)
  const startedAt = Date.now()
  try {
    const { code, lines } = await launchRenderer({
      binary: electronBin(),
      url,
      window: window.startsWith('hidden') ? 'hidden' : 'visible',
      extraEnv: { BENCH_RSS: '1', ...extraEnv },
      timeoutMs,
    })
    const events = parseEvents(lines)
    const done = events.find((e) => e.step === 'render:done')
    const error = events.find((e) => e.step === 'error')
    const canRender = events.find((e) => e.step === 'canRender')?.value ?? null
    const rssPeakMB = Math.max(0, ...events.filter((e) => e.step === 'main-rss').map((e) => e.rssMB ?? 0))
    if (error) return { ok: false, reason: `页面报错：${error.message}`, canRender, rssPeakMB }
    if (code !== 0 || !done) return { ok: false, reason: `渲染未完成（exit=${code}）`, canRender, rssPeakMB }
    // C11 铁律：只信 mtime
    if (!existsSync(target) || statSync(target).mtimeMs < startedAt - 1000) {
      return { ok: false, reason: '产物是历史文件或未产出', canRender, rssPeakMB }
    }
    return { ok: true, done, canRender, rssPeakMB, target, events }
  } finally {
    server.close()
  }
}

function summarizeChecks(checks) {
  return Object.fromEntries(Object.entries(checks.checks).map(([k, c]) => [k, c.pass === true ? 'pass' : c.pass === false ? 'fail' : 'skip']))
}

/* ---------------------------------- S1 ---------------------------------- */

const S1_POINTS = [
  { id: 's1-1080p60-10s', width: 1920, height: 1080, fps: 60, durationInFrames: 300 },
  { id: 's1-1080p30-60s', width: 1920, height: 1080, fps: 30, durationInFrames: 1800 },
  { id: 's1-720p30-180s', width: 1280, height: 720, fps: 30, durationInFrames: 5400 },
]

async function runS1(outDir) {
  const results = []
  for (const point of S1_POINTS) {
    log(`S1 ${point.id}: ${point.width}×${point.height}@${point.fps} ×${point.durationInFrames} 帧 …`)
    const outName = `${point.id}.mp4`
    const r = await renderOnce({ outDir, outName, ...point, window: 'visible' })
    if (!r.ok) {
      log(`S1 ${point.id} ❌ ${r.reason}`)
      results.push({ ...point, ok: false, reason: r.reason, canRender: r.canRender, rssPeakMB: r.rssPeakMB })
      continue
    }
    const checks = runChecks({
      file: r.target,
      file2: null,
      expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
      spec: { fps: point.fps, durationInFrames: point.durationInFrames, width: point.width, height: point.height },
      workDir: join(outDir, `${point.id}-frames`),
    })
    contactSheet(r.target, point.durationInFrames, join(outDir, `${point.id}-frames`, 'contact.png'))
    results.push({
      ...point,
      ok: true,
      canRender: r.canRender,
      renderMs: r.done.ms,
      msPerFrame: r.done.msPerFrame,
      heapMB: r.done.heapMB ?? null,
      rssPeakMB: r.rssPeakMB,
      bytes: statSync(r.target).size,
      checks: summarizeChecks(checks),
      hardFail: checks.hardFail,
      bitRate: checks.info.bitRate ?? null,
      durationSec: checks.info.durationSec ?? null,
    })
    log(`S1 ${point.id} ✅ ${r.done.msPerFrame} ms/帧，RSS 峰值 ${r.rssPeakMB}MB，硬检查未过：${checks.hardFail.join('、') || '无'}`)
  }
  return results
}

/* ---------------------------------- S2 ---------------------------------- */

const S2_WINDOWS = [
  { name: 'visible', env: {} },
  { name: 'hidden', env: {} },
  { name: 'hidden-throttled', env: { BENCH_ALLOW_THROTTLE: '1' } },
]
const S2_RUNS = 5

async function runS2(outDir) {
  const spec = { width: 1920, height: 1080, fps: 30, durationInFrames: 900 } // 30s 任务
  const results = []
  for (const w of S2_WINDOWS) {
    const runs = []
    for (let r = 1; r <= S2_RUNS; r += 1) {
      const outName = `s2-${w.name}-run${r}.mp4`
      log(`S2 ${w.name} 第 ${r}/${S2_RUNS} 次 …`)
      const r0 = await renderOnce({
        outDir,
        outName,
        ...spec,
        window: w.name,
        extraEnv: w.env,
        timeoutMs: 240_000,
      })
      if (!r0.ok) {
        runs.push({ run: r, ok: false, reason: r0.reason })
        log(`S2 ${w.name} run${r} ❌ ${r0.reason}`)
        continue
      }
      const checks = runChecks({
        file: r0.target,
        file2: null,
        expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
        spec,
        workDir: join(outDir, `s2-${w.name}-frames`),
      })
      runs.push({
        run: r,
        ok: true,
        renderMs: r0.done.ms,
        msPerFrame: r0.done.msPerFrame,
        bytes: statSync(r0.target).size,
        heapMB: r0.done.heapMB ?? null,
        checks: summarizeChecks(checks),
      })
      log(`S2 ${w.name} run${r} ✅ ${r0.done.ms} ms`)
    }
    const okRuns = runs.filter((x) => x.ok)
    const msList = okRuns.map((x) => x.renderMs)
    const mean = msList.reduce((s, v) => s + v, 0) / Math.max(1, msList.length)
    const stdev = msList.length > 1
      ? Math.sqrt(msList.reduce((s, v) => s + (v - mean) ** 2, 0) / (msList.length - 1))
      : 0
    const cv = mean > 0 ? stdev / mean : 0
    results.push({
      window: w.name,
      runs,
      successCount: okRuns.length,
      meanMs: Number(mean.toFixed(0)),
      stdevMs: Number(stdev.toFixed(0)),
      cvPercent: Number((cv * 100).toFixed(1)),
      varianceGate: cv < 0.2 && okRuns.length === S2_RUNS ? 'pass' : 'fail',
    })
    log(`S2 ${w.name}: ${okRuns.length}/${S2_RUNS} 成功，均值 ${mean.toFixed(0)}ms，CV ${(cv * 100).toFixed(1)}%`)
  }
  return results
}

/* ---------------------------------- 主流程 ---------------------------------- */

async function main() {
  const outDir = arg('out', DEFAULT_OUT)
  mkdirSync(outDir, { recursive: true })
  await buildBundle()
  if (hasFlag('s1') || !hasFlag('s2')) {
    const s1 = await runS1(outDir)
    writeFileSync(join(outDir, 's1.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), points: s1 }, null, 2)}\n`)
    log(`S1 结果 → ${join(outDir, 's1.json')}`)
  }
  if (hasFlag('s2') || !hasFlag('s1')) {
    const s2 = await runS2(outDir)
    writeFileSync(join(outDir, 's2.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), windows: s2 }, null, 2)}\n`)
    log(`S2 结果 → ${join(outDir, 's2.json')}`)
  }
}

main().catch((error) => {
  console.error('[stress] ❌', error && error.message ? error.message : error)
  process.exitCode = 1
})
