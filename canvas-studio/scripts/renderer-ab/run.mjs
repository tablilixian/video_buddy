/**
 * 渲染器 A/B 对照 · 驱动
 *
 * 一句话：**同一份 React 组件，同一个 bundle，SSR 与 CSR 各渲一遍，逐格比像素**。
 *
 *   SSR（它的路线）：@remotion/renderer + 本机 Chrome（headless shell 路线）
 *   CSR（我们的路线）：@remotion/web-renderer + Electron 渲染进程（renderMediaOnWeb）
 *
 * 判读：每格一个 CSS 特性。
 *   PSNR 高（>35dB）⇒ 两边渲染结果一致 ⇒ **该能力 CSR 也有**
 *   PSNR 低（<25dB）⇒ 两边不一致 ⇒ **CSR 读不到该特性 = 真实能力差**
 *
 * 跑法：
 *   cd canvas-studio
 *   NODE_OPTIONS= node scripts/renderer-ab/run.mjs
 */
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchRenderer, parseEvents } from '../capability-bench/lib/electron.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const ENTRY = join(HERE, 'entry.tsx')
const BUNDLE = join(HERE, '.bundle')
const OUT = join(HERE, 'out')
const ASSET_DIR = join(HERE, 'asset')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const log = (...a) => console.log('[ab]', ...a)

function electronBinary() {
  const requireFromDesktop = createRequire(join(REPO, 'dsh-plugin-desktop', 'package.json'))
  return requireFromDesktop('electron')
}

/* ─────────────────────────── ① 素材：8×8 棋盘 ─────────────────────────── */

function makeChecker() {
  mkdirSync(ASSET_DIR, { recursive: true })
  const target = join(ASSET_DIR, 'checker.png')
  if (existsSync(target)) return
  // 8×8 黑白棋盘放大到 64×64 —— 一眼能看出"图到底加载了没有"
  spawnSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=white:s=64x64',
    '-vf', 'drawgrid=w=8:h=8:t=2:c=black',
    '-frames:v', '1', target,
  ], { stdio: 'inherit' })
  log('素材就绪：', target)
}

/* ─────────────────────────── ② 打包（两条路线共用） ─────────────────────────── */

async function buildBundle() {
  const { bundle } = await import('@remotion/bundler')
  const started = Date.now()
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    outDir: BUNDLE,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...(config.resolve ?? {}),
        extensionAlias: { ...((config.resolve && config.resolve.extensionAlias) || {}), '.js': ['.ts', '.tsx', '.js'] },
      },
    }),
  })
  log(`bundle 完成（${Math.round((Date.now() - started) / 1000)}s）→`, serveUrl)
  // 素材必须进 bundle 目录：SSR 走 bundle() 自带的 server，CSR 走我们自己的 server，
  // 两条路线都得能从 `<页面目录>/asset/checker.png` 拿到同一个文件（相对路径 ./asset/…）。
  mkdirSync(join(BUNDLE, 'asset'), { recursive: true })
  writeFileSync(join(BUNDLE, 'asset', 'checker.png'), readFileSync(join(ASSET_DIR, 'checker.png')))
  return serveUrl
}

/* ─────────────────────────── ③ CSR：静态服务 + Electron ─────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4',
}

function startServer() {
  return new Promise((ready) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'POST' && url.pathname === '/save') {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const name = url.searchParams.get('name') || 'out.mp4'
          const file = join(OUT, name)
          writeFileSync(file, Buffer.concat(chunks))
          log('CSR 落盘：', file, Buffer.concat(chunks).byteLength, 'bytes')
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('ok')
        })
        return
      }
      if (url.pathname.startsWith('/asset/')) {
        const file = join(BUNDLE, url.pathname.slice(1))
        if (!existsSync(file)) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        createReadStream(file).pipe(res)
        return
      }
      const rel = decodeURIComponent(url.pathname.split('?')[0])
      const file = join(BUNDLE, rel === '/' ? 'index.html' : rel)
      if (!file.startsWith(BUNDLE) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      createReadStream(file).pipe(res)
    })
    server.listen(0, '127.0.0.1', () => {
      ready({ server, port: server.address().port })
    })
  })
}

async function renderCsr({ html = false, name = 'csr.mp4', flags = [] } = {}) {
  const { server, port } = await startServer()
  const url = `http://127.0.0.1:${port}/index.html?csr=1&name=${encodeURIComponent(name)}${html ? '&html=1' : ''}`
  const { code, lines } = await launchRenderer({
    binary: electronBinary(),
    url,
    window: 'visible',
    flags,
    timeoutMs: 300_000,
  })
  const events = parseEvents(lines)
  for (const e of events) log('page:', JSON.stringify(e))
  const saved = events.find((e) => e.step === 'csr-saved')
  server.close()
  if (code !== 0 || !saved) throw new Error('CSR 渲染未完成：' + name)
  return join(OUT, name)
}

/* ─────────────────────────── ④ SSR：@remotion/renderer + 本机 Chrome ─────────────────────────── */

async function renderSsr(serveUrl) {
  const { selectComposition, renderMedia } = await import('@remotion/renderer')
  const composition = await selectComposition({
    serveUrl,
    id: 'probe',
    inputProps: {},
    browserExecutable: CHROME,
  })
  log(`SSR 合成：${composition.width}x${composition.height} @${composition.fps} · ${composition.durationInFrames} 帧`)
  const target = join(OUT, 'ssr.mp4')
  const started = Date.now()
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: target,
    inputProps: {},
    browserExecutable: CHROME,
  })
  log(`SSR 完成（${Math.round((Date.now() - started) / 1000)}s）→`, target)
  return target
}

/* ─────────────────────────── ⑤ 逐格 PSNR ─────────────────────────── */

const GRID = [[60, 40], [690, 40], [1320, 40], [60, 580], [690, 580], [1320, 580]]
const LABELS = [
  '1 blend-difference',
  '2 backdrop-blur',
  '3 conic-mask',
  '4 z-index',
  '5 radial-tile',
  '6 bg-url',
]

/** ffmpeg PSNR：返回 { psnr, avg }；identical 时 psnr='inf'。 */
function psnrOf(a, b, x, y, w, h) {
  const crop = `crop=${w}:${h}:${x}:${y}`
  const res = spawnSync('ffmpeg', [
    // PSNR 那行是 **info** 级别打印的 —— 用 `-v error` 会把它吞掉（第一版就栽在这）
    '-hide_banner', '-i', a, '-i', b,
    '-lavfi', `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]psnr`,
    '-f', 'null', '-',
  ], { encoding: 'utf8' })
  const text = res.stderr ?? ''
  const m = /average:([\d.]+|inf)/.exec(text)
  if (!m) return { psnr: null, average: null, raw: text.slice(-400) }
  return { psnr: m[1], average: m[1], raw: text.slice(-200) }
}

function compare(csr, ssr, csrHtml) {
  const frameA = join(OUT, 'csr-f0.png')
  const frameB = join(OUT, 'ssr-f0.png')
  const frameC = join(OUT, 'csrhtml-f0.png')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', csr, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', frameA], { stdio: 'inherit' })
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', ssr, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', frameB], { stdio: 'inherit' })
  if (csrHtml !== null) {
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', csrHtml, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', frameC], { stdio: 'inherit' })
  }

  const rows = []
  for (let i = 0; i < GRID.length; i += 1) {
    const [x, y] = GRID[i]
    // 比对区 = 格子去掉顶部 56px 标签条（避开字体抗锯齿差异）
    const r = psnrOf(frameA, frameB, x, y + 56, 600, 444)
    const value = r.psnr === 'inf' ? Infinity : Number(r.psnr)
    const row = { index: i + 1, label: LABELS[i], psnr: r.psnr, same: value > 35, different: value < 25 }
    if (csrHtml !== null) {
      const h = psnrOf(frameC, frameB, x, y + 56, 600, 444)
      const hv = h.psnr === 'inf' ? Infinity : Number(h.psnr)
      row.psnrHtml = h.psnr
      row.htmlMatches = hv > 35
    }
    rows.push(row)
  }
  return rows
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

async function main() {
  mkdirSync(OUT, { recursive: true })
  makeChecker()
  const serveUrl = await buildBundle()
  const csr = await renderCsr({ name: 'csr.mp4' })
  // 第三档：CSR 打开 allowHtmlInCanvas（Chromium drawElementImage）+ CanvasDrawElement 开关
  const csrHtml = await renderCsr({ html: true, name: 'csr-html.mp4', flags: ['CanvasDrawElement'] })
  const ssr = await renderSsr(serveUrl)
  const rows = compare(csr, ssr, csrHtml)

  console.log('\n══════ SSR vs CSR 逐格对比（同一 bundle / 同一组件）══════\n')
  console.log('格  特性                 CSR默认    CSR+htmlInCanvas   判定')
  for (const r of rows) {
    const verdict = r.different ? '❌ 默认读不到' : r.same ? '✅ 默认就有' : '⚠️  差异小'
    const htmlVerdict = r.htmlMatches === undefined ? '—' : r.htmlMatches ? '✅ 追平 SSR' : '❌ 仍不同'
    console.log(
      `${String(r.index).padStart(2)}  ${r.label.padEnd(20)} ${String(r.psnr).padStart(8)}  ${String(r.psnrHtml ?? '—').padStart(14)}   ${verdict} / ${htmlVerdict}`,
    )
  }
  const diff = rows.filter((r) => r.different)
  const fixed = rows.filter((r) => r.different && r.htmlMatches === true)
  console.log(`\n结论：`)
  console.log(`  · CSR 默认路径：${rows.length - diff.length}/${rows.length} 格与 SSR 一致；${diff.length} 格存在真实能力差 → ${diff.map((r) => r.label).join(' / ') || '无'}`)
  console.log(`  · CSR + allowHtmlInCanvas：${fixed.length}/${diff.length} 格被追平（${fixed.map((r) => r.label).join(' / ') || '无'}）`)
  writeFileSync(join(OUT, 'compare.json'), JSON.stringify({ rows, at: new Date().toISOString() }, null, 2), 'utf8')
  console.log('报告：', join(OUT, 'compare.json'))
}

main().catch((error) => {
  console.error('[ab] ❌', error?.message ?? error)
  process.exitCode = 1
})
