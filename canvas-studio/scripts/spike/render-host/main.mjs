/**
 * REQ-034 · O-04 S0 spike 驱动（Electron main，**探针，不属于产品构建**）。
 *
 * 回答四问（判定闸，见 docs/plans/REQ-034-优化总纲-20261019.md §2 O-04）：
 *   Q1 Host 侧 `import('electron')` / `createRequire(...)('electron')` 能解析吗
 *   Q2 隐藏窗口 + `backgroundThrottling:false` 下 rAF 真的在跑吗
 *   Q3 隐藏窗口里 WebCodecs 编码 + `<video>` 解码正常吗
 *   Q4 隐藏窗口与可见窗口渲出的帧**逐像素一致**吗 ← 决定「双执行者」还是「全 RenderHost」
 *
 * 跑法（在 canvas-studio 目录）：
 *   npx tsdown -c scripts/spike/render-host/tsdown.config.ts
 *   cd .. && env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
 *     dsh-plugin-desktop/node_modules/electron/cli.js \
 *     canvas-studio/scripts/spike/render-host/main.mjs
 *
 * 报告落到 /tmp/cs-render-host-spike/report.json，并打一份人读摘要。
 * 退出码：Q2/Q3 失败或 Q4 判定「不一致」⇒ 1（可直接挂进验收脚本）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const STUDIO_ROOT = join(here, '..', '..', '..')
const DIST = '/tmp/cs-render-host-spike'
const TEST_VIDEO = join(DIST, 'test.mp4')
const REPORT_PATH = join(DIST, 'report.json')

const HALF_W = 480
const HALF_H = 270
const FRAMES = 30
const Q2_WINDOW_MS = 10_000

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// ────────────────────────── Q1：electron 解析 ──────────────────────────
async function probeElectronResolution() {
  const out = { requireElectron: '', importElectron: '', createRequireVersion: '', errors: [] }
  try {
    const require = createRequire(import.meta.url)
    const electron = require('electron')
    out.requireElectron = typeof electron === 'string' ? `path:${electron}` : `version:${electron?.app?.getVersion?.() ?? 'n/a'}`
  } catch (cause) {
    out.errors.push(`createRequire('electron'): ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  try {
    const mod = await import('electron')
    out.importElectron = `version:${mod.app?.getVersion?.() ?? 'n/a'}`
  } catch (cause) {
    out.errors.push(`import('electron'): ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  return out
}

// ────────────────────────── 静态服务器 ──────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
}

function startServer() {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const send = (file, status = 200) => readFile(file)
      .then((body) => {
        res.writeHead(status, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(body)
      })
      .catch(() => { res.writeHead(404); res.end('not found') })

    if (path === '/spike/page.html') return send(join(here, 'page.html'))
    if (path === '/spike/entry.js') return send(join(DIST, 'entry.js'))
    if (path === '/assets/test.mp4') return send(TEST_VIDEO)
    if (path.startsWith('/canvas-studio/remotion/fonts/')) {
      const name = path.slice('/canvas-studio/remotion/fonts/'.length)
      if (!/^[\w.-]+$/.test(name)) { res.writeHead(400); res.end('bad name'); return }
      return send(join(STUDIO_ROOT, 'assets', 'fonts', name))
    }
    res.writeHead(404)
    res.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ────────────────────────── 测试素材 ──────────────────────────
async function ensureTestVideo() {
  if (existsSync(TEST_VIDEO)) return
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `testsrc2=size=${HALF_W}x${HALF_H}:rate=30:duration=2`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', TEST_VIDEO,
    ], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))))
  })
}

// ────────────────────────── 窗口 ──────────────────────────
function makeWindow({ visible, throttled, port }) {
  const win = new BrowserWindow({
    show: visible,
    width: HALF_W + 40,
    height: HALF_H + 90,
    webPreferences: {
      // 关键变量：隐藏窗口关节流；可见窗口保持默认（true）= 用户的真实环境
      backgroundThrottling: throttled,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  const url = `http://127.0.0.1:${port}/spike/page.html?frames=${FRAMES}&width=${HALF_W}&height=${HALF_H}`
    + `&video=${encodeURIComponent('/assets/test.mp4')}`
  win.loadURL(url)
  return win
}

async function waitFor(win, expression, timeoutMs, label) {
  const startedAt = Date.now()
  for (;;) {
    const value = await win.webContents.executeJavaScript(expression, true).catch(() => undefined)
    if (value !== undefined && value !== null && value !== false) return value
    if (Date.now() - startedAt > timeoutMs) throw new Error(`等待超时：${label}（${timeoutMs}ms）`)
    await sleep(250)
  }
}

const readSpike = (win) => waitFor(win, 'window.__spike ? window.__spike : undefined', 60_000, 'spike boot')

// ────────────────────────── 主流程 ──────────────────────────
async function main() {
  await mkdir(DIST, { recursive: true })
  await ensureTestVideo()

  const q1 = await probeElectronResolution()
  const { server, port } = await startServer()
  const report = {
    startedAt: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    q1,
    q2: null,
    q3: null,
    q4: null,
    verdict: {},
  }

  // 可见窗口（用户真实环境：节流开）+ 隐藏窗口（RenderHost 候选：节流关）
  const visible = makeWindow({ visible: true, throttled: true, port })
  const hidden = makeWindow({ visible: false, throttled: false, port })
  await Promise.all([waitFor(visible, 'window.__spike !== undefined', 60_000, 'visible boot'),
    waitFor(hidden, 'window.__spike !== undefined', 60_000, 'hidden boot')])

  // ── Q2：同样 10 秒，最小化的可见窗口 vs 隐藏但关节流的窗口，各涨了多少帧 ──
  const ticks = async (win) => win.webContents.executeJavaScript('window.__spike.rafTicks', true)
  const visibleBefore = await ticks(visible)
  const hiddenBefore = await ticks(hidden)
  visible.minimize()
  await sleep(Q2_WINDOW_MS)
  const visibleAfter = await ticks(visible)
  const hiddenAfter = await ticks(hidden)
  visible.restore()
  await sleep(500)
  const visibleDelta = visibleAfter - visibleBefore
  const hiddenDelta = hiddenAfter - hiddenBefore
  report.q2 = {
    windowMs: Q2_WINDOW_MS,
    visibleMinimizedTicks: visibleDelta,
    visibleMinimizedTicksPerSecond: Math.round((visibleDelta * 1000) / Q2_WINDOW_MS),
    hiddenTicks: hiddenDelta,
    hiddenTicksPerSecond: Math.round((hiddenDelta * 1000) / Q2_WINDOW_MS),
    pass: hiddenDelta >= (Q2_WINDOW_MS / 1000) * 20,
  }

  // ── Q3 / Q4：同一份 manifest 渲三次（可见 A1 → 可见 A2 → 隐藏 B） ──
  const run = async (win, label) => {
    const startedAt = Date.now()
    const digest = await win.webContents.executeJavaScript('window.__spikeRun()', true)
    return { label, wallMs: Date.now() - startedAt, ...digest }
  }
  const a1 = await run(visible, 'visible#1')
  const a2 = await run(visible, 'visible#2')
  const b = await run(hidden, 'hidden')

  const capabilities = await readSpike(hidden)
  report.q3 = {
    visible: { ok: a1.ok, error: a1.error, msPerFrame: a1.msPerFrame, mp4Bytes: a1.mp4Bytes, samples: a1.samples?.length ?? 0, warnings: a1.warnings },
    hidden: { ok: b.ok, error: b.error, msPerFrame: b.msPerFrame, mp4Bytes: b.mp4Bytes, samples: b.samples?.length ?? 0, warnings: b.warnings },
    webCodecs: capabilities.webCodecs,
    pass: a1.ok === true && b.ok === true && b.mp4Bytes > 0 && (b.samples?.length ?? 0) > 0,
  }

  const digestKey = (digest) => (digest.samples ?? []).map((sample) => `${sample.frame}:${sample.sha256}`).join('|')
  const controlSame = digestKey(a1) === digestKey(a2)
  const paritySame = digestKey(a2) === digestKey(b)
  const diffFrames = controlSame && paritySame
    ? []
    : (a2.samples ?? [])
      .filter((sample) => !(b.samples ?? []).some((other) => other.frame === sample.frame && other.sha256 === sample.sha256))
      .map((sample) => sample.frame)
  report.q4 = {
    control: { a1: digestKey(a1), a2: digestKey(a2), same: controlSame },
    parity: { a2: digestKey(a2), hidden: digestKey(b), same: paritySame },
    mp4Same: a2.mp4Sha256 === b.mp4Sha256,
    diffFrames,
    pass: controlSame && paritySame,
    conclusive: controlSame,
  }

  report.verdict = {
    Q1: q1.errors.length === 0 ? 'PASS（主进程内 createRequire / import 都能解析 electron）' : `FAIL（${q1.errors.join(' / ')}）`,
    Q2: report.q2.pass ? `PASS（隐藏窗口 ${report.q2.hiddenTicksPerSecond} ticks/s）` : `FAIL（隐藏窗口 ${report.q2.hiddenTicksPerSecond} ticks/s）`,
    Q3: report.q3.pass ? 'PASS（隐藏窗口渲出成片与抽帧）' : `FAIL（${b.error || a1.error || '无产物'}）`,
    Q4: report.q4.pass
      ? 'PASS（同窗口两次 + 隐藏窗口逐帧 PNG 哈希一致 ⇒ 预览可走用户页、成片走 RenderHost）'
      : (report.q4.conclusive
        ? 'FAIL（可见与隐藏窗口渲出的帧不一致 ⇒ 必须全走 RenderHost，放弃「预览走用户页」）'
        : 'INCONCLUSIVE（同一可见窗口两次渲染就不一致 ⇒ 渲染器本身不确定性，Q4 需换确定性素材重测）'),
  }

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ verdict: report.verdict, q2: report.q2, q4: { control: report.q4.control.same, parity: report.q4.parity.same, mp4Same: report.q4.mp4Same } }, null, 2))
  console.log(`\n完整报告：${REPORT_PATH}`)

  visible.destroy()
  hidden.destroy()
  server.close()
  return report.verdict.Q2.startsWith('PASS') && report.verdict.Q3.startsWith('PASS') && report.verdict.Q4.startsWith('PASS') ? 0 : 1
}

app.whenReady().then(() => {
  main()
    .then((code) => { app.exit(code) })
    .catch((cause) => {
      console.error('spike 失败：', cause instanceof Error ? cause.stack : String(cause))
      app.exit(2)
    })
})
