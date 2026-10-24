/**
 * 渲染取证台 · 驱动
 *
 * 一句话：把会话里"没定论的问题"变成**可重放的对照实验**，跑完直接给归因。
 *
 * 跑法（必须在有 GUI 的终端；agent 沙箱只能跑 --check）：
 *   cd canvas-studio
 *   NODE_OPTIONS= node scripts/render-forensics/run.mjs --check     # 不起窗口，只验打包/矩阵/manifest
 *   NODE_OPTIONS= node scripts/render-forensics/run.mjs             # 全矩阵
 *   NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q1,Q8
 *   RF_MANIFEST=/path/to/manifest.json ...                          # 换一份真实 manifest
 *
 * 产物：scripts/render-forensics/out/<ts>/{report.json,REPORT.md,manifest/*.json}
 *
 * ⚠️ 为什么必须 NODE_OPTIONS=：沙箱注入的 shim 会把 mkdir 已存在目录判成越权，
 *    bundle() 会直接撞（REQ-034 spike 血泪）。
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMatrix, DEFAULT_REAL_MANIFEST, PROJECT_ASSET_PREFIX, REAL_ASSETS, WINDOW_MODES } from './scenarios.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const CS = resolve(REPO, 'canvas-studio')
const ENTRY = join(HERE, 'entry.tsx')
const APP = join(HERE, 'electron')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = join(HERE, 'out', STAMP)
// bundle 走固定路径复用（一次 10s，没必要每次重打）
const BUNDLE = join(HERE, 'out', '.bundle')
const MANIFEST_DIR = join(OUT, 'manifest')

const argv = process.argv.slice(2)
const ONLY = (argv.find((a) => a.startsWith('--only=')) ?? '').replace('--only=', '').split(',').filter(Boolean)
const CHECK = argv.includes('--check')
const WINDOWS = (argv.find((a) => a.startsWith('--windows=')) ?? '').replace('--windows=', '').split(',').filter(Boolean)

const log = (m) => console.log(`\x1b[36m[rf]\x1b[0m ${m}`)
const ok = (m) => console.log(`\x1b[32m  ✓\x1b[0m ${m}`)
const bad = (m) => console.log(`\x1b[31m  ✗\x1b[0m ${m}`)
const warn = (m) => console.log(`\x1b[33m  ! ${m}\x1b[0m`)

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}
const mime = (p) => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

/* ─────────────────────────── 真实 manifest / 素材 ─────────────────────────── */

function loadRealManifest() {
  const p = DEFAULT_REAL_MANIFEST
  if (!existsSync(p)) {
    warn(`真实 manifest 不存在，跳过 Q4/Q6/Q8：${p}`)
    return null
  }
  const m = JSON.parse(readFileSync(p, 'utf8'))
  ok(`真实 manifest：${m.tracks.length} 轨 / ${m.meta.durationInFrames} 帧（${p}）`)
  return m
}

/** 素材目录：真实 manifest 的 src 都落在这个前缀下。 */
const ASSET_ROOT = (() => {
  const p = dirname(DEFAULT_REAL_MANIFEST)
  return resolve(p, '..', 'assets')
})()

function resolveAsset(rel) {
  const direct = join(ASSET_ROOT, rel)
  if (existsSync(direct)) return direct
  // 会话里 watch-hero.png 被客户端重启删掉了，但源图还在 —— 用源图顶上，
  // 这也顺带证明「素材可重建」而产品没有自动做。
  if (rel === REAL_ASSETS.image) {
    const fb = join(ASSET_ROOT, REAL_ASSETS.imageFallback)
    if (existsSync(fb)) return fb
  }
  return null
}

/* ─────────────────────────── 打包 ─────────────────────────── */

async function buildBundle() {
  const { bundle } = await import('@remotion/bundler')
  const stale = !existsSync(BUNDLE) || (existsSync(BUNDLE) && statSync(ENTRY).mtimeMs > statSync(BUNDLE).mtimeMs)
  if (!stale) {
    ok('bundle 复用（入口未变）')
    return BUNDLE
  }
  if (argv.includes('--rebuild')) rmSync(BUNDLE, { recursive: true, force: true })
  mkdirSync(BUNDLE, { recursive: true })
  log('打包 bundle（webpack，一次约 10s）…')
  const t = Date.now()
  await bundle({
    entryPoint: ENTRY,
    outDir: BUNDLE,
    // 产品源码用 NodeNext 的 `../x.js` 写法，webpack 需要 extensionAlias 才能落到 .ts/.tsx
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...(config.resolve ?? {}),
        extensionAlias: { ...((config.resolve && config.resolve.extensionAlias) || {}), '.js': ['.ts', '.tsx', '.js'] },
      },
    }),
  })
  ok(`bundle 完成 ${Math.round((Date.now() - t) / 1000)}s`)
  return BUNDLE
}

/* ─────────────────────────── 静态服务 ─────────────────────────── */

function startServer(groups) {
  return new Promise((ready) => {
    const reports = []
    let onFinish = null
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')

      if (req.method === 'POST' && u.pathname === '/report') {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          let obj = null
          try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { obj = null }
          if (obj !== null) {
            reports.push(obj)
            if (obj.kind === 'begin') log(`   ▸ ${obj.id}  ${obj.title}…`)
            if (obj.kind === 'run') {
              if (obj.ok) ok(`${obj.id} ok ${obj.renderMs}ms (${obj.msPerFrame}ms/帧, raf=${obj.rafHz}Hz)${obj.savedAs ? ` → ${obj.savedAs}` : ''}`)
              else bad(`${obj.id} 失败 @${obj.stage}${obj.error ? ' · ' + obj.error : ''}`)
            }
            if (obj.kind === 'env') log(`   环境 cores=${obj.cores} webcodecs=${obj.hasWebCodecs} video=${JSON.stringify(obj.codecs && obj.codecs.video)}`)
            if (obj.kind === 'fatal') bad(`fatal ${obj.error}`)
            if (obj.kind === 'finished') onFinish?.()
          }
          res.writeHead(204)
          res.end()
        })
        return
      }

      if (req.method === 'POST' && u.pathname === '/save') {
        const id = (u.searchParams.get('id') ?? 'out').replace(/[^\w.-]/g, '_')
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const dir = join(OUT, 'mp4')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `${id}.mp4`)
          writeFileSync(file, Buffer.concat(chunks))
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end(file)
        })
        return
      }

      if (u.pathname === '/plan') {
        const g = u.searchParams.get('group')
        const group = groups.find((x) => x.id === g)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ runs: group ? group.runs.map((r) => ({ ...r, manifest: undefined, manifestUrl: `/manifest/${r.id}.json` })) : [] }))
        return
      }

      if (u.pathname.startsWith('/manifest/')) {
        const f = join(MANIFEST_DIR, u.pathname.slice('/manifest/'.length))
        if (!existsSync(f)) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'content-type': 'application/json' })
        createReadStream(f).pipe(res)
        return
      }

      if (u.pathname.startsWith(PROJECT_ASSET_PREFIX)) {
        const rel = decodeURIComponent(u.pathname.slice(PROJECT_ASSET_PREFIX.length))
        const f = resolveAsset(rel)
        if (f === null) { res.writeHead(404); res.end('missing'); return }
        streamFile(req, res, f)
        return
      }

      const rel = decodeURIComponent(u.pathname.split('?')[0])
      const f = join(BUNDLE, rel === '/' ? 'index.html' : rel)
      if (!f.startsWith(BUNDLE) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return }
      streamFile(req, res, f)
    })

    server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port, reports, setOnFinish: (fn) => { onFinish = fn } }))
  })
}

/** 支持 Range：video 轨没有 206 会直接解码失败（这本身就是一条常见"素材挂死"假象）。 */
function streamFile(req, res, file) {
  const size = statSync(file).size
  const range = req.headers.range
  const type = mime(file)
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] !== '' ? Number(m[1]) : 0
    const end = m && m[2] !== '' ? Number(m[2]) : size - 1
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
  createReadStream(file).pipe(res)
}

/* ─────────────────────────── 跑一个组 ─────────────────────────── */

function electronBin() {
  const req = createRequire(join(REPO, 'dsh-plugin-desktop', 'package.json'))
  return req('electron')
}

async function runGroup({ group, port, reports, setOnFinish, windowMode }) {
  const bin = electronBin()
  const url = `http://127.0.0.1:${port}/index.html?group=${group.id}&window=${windowMode}`
  const env = { ...process.env, RF_URL: url, RF_WINDOW: windowMode }
  delete env.ELECTRON_RUN_AS_NODE

  const budget = group.runs.reduce((s, r) => s + (r.timeoutMs ?? 240_000), 0) + 60_000
  log(`启动 Electron（${windowMode}）· 预算 ${Math.round(budget / 1000)}s`)

  const child = spawn(bin, [APP], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => {
    for (const line of String(d).split('\n')) {
      if (/\[rf-electron\]|render-process-gone|did-fail-load/.test(line)) process.stdout.write(`     ${line.trim()}\n`)
    }
  })
  child.stderr.on('data', (d) => {
    const s = String(d)
    if (!/CVDisplayLink|GPU stall|IMKClient|TIS|Secure coding|DevTools/.test(s)) process.stdout.write(`     ! ${s.slice(0, 240)}\n`)
  })

  let finished = false
  setOnFinish(() => { finished = true })
  const deadline = Date.now() + budget
  while (!finished && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
  child.kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 400))
  if (!finished) warn(`${group.id} 超时（${Math.round(budget / 1000)}s）—— 结果按已完成的部分统计`)
  return reports
}

/* ─────────────────────────── 归因 ─────────────────────────── */

const find = (reports, id) => reports.find((r) => r.kind === 'run' && r.id === id)
const ms = (r) => (r && r.ok ? r.renderMs : null)
const ratio = (a, b) => (a && b ? Math.round((b / a) * 100) / 100 : null)

function verdicts(reports, matrix) {
  const out = []

  const q1 = [1, 2, 3, 4].map((n) => find(reports, `q1-run${n}`))
  if (q1.every(Boolean)) {
    const base = ms(q1[0])
    const later = q1.slice(1).map(ms).filter((x) => x !== null)
    const best = later.length > 0 ? Math.min(...later) : null
    out.push({
      id: 'Q1',
      question: '是否每次都要付冷启动？',
      data: `第1次 ${base}ms · 后续 ${later.join('/')}ms`,
      verdict: best !== null && base !== null && best < base * 0.5
        ? `有预热收益（后续最快是首次的 ${Math.round((best / base) * 100)}%）→ 「每单都冷启动」不成立，是**没复用**`
        : '无明显预热收益 → 固定开销不是"首次才有"，需要在 Q3 里看截距',
    })
  }

  const q2 = [1, 4, 11, 28, 57].map((n) => find(reports, `q2-t${n}`)).filter((r) => r && r.ok)
  if (q2.length >= 3) {
    const pts = q2.map((r) => [Number(r.id.replace('q2-t', '')), r.msPerFrame])
    const slope = linSlope(pts)
    const first = q2.find((r) => r.id === 'q2-t1')
    const last = q2.at(-1)
    const times = first && last ? Math.round((last.msPerFrame / first.msPerFrame) * 10) / 10 : null
    out.push({
      id: 'Q2',
      question: '轨道数是主因吗？',
      data: q2.map((r) => `${r.id.replace('q2-t', '')}轨=${r.msPerFrame}ms/帧`).join(' · '),
      verdict: slope !== null
        ? `每加 1 轨 +${slope.toFixed(2)}ms/帧，57 轨是 1 轨的 ${times}×（绝对值仍只有 ${last?.msPerFrame}ms/帧）→ 轨道数**确有线性成本，但量级差两个数量级**，解释不了会话里的 5559ms/帧`
        : '样本不足',
    })
  }

  const q3 = [10, 60, 270, 600].map((f) => find(reports, `q3-f${f}`)).filter((r) => r && r.ok)
  if (q3.length >= 2) {
    const pts = q3.map((r) => [r.frames, r.renderMs])
    const slope = linSlope(pts)
    const intercept = linIntercept(pts)
    out.push({
      id: 'Q3',
      question: '固定开销多大？每帧单价多少？',
      data: q3.map((r) => `${r.frames}帧=${r.renderMs}ms`).join(' · '),
      verdict: slope !== null
        ? `拟合：固定开销 ≈ ${Math.round(intercept)}ms，每帧 ≈ ${slope.toFixed(1)}ms → 按此推算 1800 帧 ≈ ${Math.round(intercept + slope * 1800)}ms`
        : '样本不足',
    })
  }

  const q4ids = ['q4-base', 'q4-image', 'q4-audio', 'q4-video']
  const q4 = q4ids.map((id) => find(reports, id)).filter(Boolean)
  if (q4.length >= 3) {
    const failed = q4.filter((r) => !r.ok).map((r) => r.id)
    out.push({
      id: 'Q4',
      question: '素材轨是否让渲染挂死？',
      data: q4.map((r) => `${r.id.replace('q4-', '')}=${r.ok ? r.renderMs + 'ms' : '失败'}`).join(' · '),
      verdict: failed.length === 0
        ? 'image / audio / video 全部跑通 → **「素材预取死锁」不成立**，会话里的挂死应归因到产品侧（工单/窗口/鉴权）'
        : `失败项 ${failed.join(',')} → 素材通道确有瓶颈，需按失败项细分（HTTP/Range/解码）`,
    })
  }

  const before = find(reports, 'q6-before')
  const abort = find(reports, 'q6-abort')
  const after = find(reports, 'q6-after')
  if (before && after) {
    const r = ratio(ms(before), ms(after))
    out.push({
      id: 'Q6',
      question: '中断后渲染器是否劣化？',
      data: `中断前 ${ms(before)}ms · 中断 ${abort ? (abort.aborted ? '已触发' : '未触发') : '缺失'} · 中断后 ${ms(after)}ms`,
      verdict: r !== null && r > 2
        ? `中断后慢了 ${r}× → **状态残留确凿**，reset 机制是必修项`
        : '中断前后无显著差异 → 会话里的"越试越慢"更可能是窗口节流（看 Q9）',
    })
  }

  const q7 = ['q7-draft', 'q7-draft-sw', 'q7-draft-resp', 'q7-standard'].map((id) => find(reports, id)).filter((r) => r && r.ok)
  if (q7.length >= 2) {
    out.push({
      id: 'Q7',
      question: 'draft 档参数是元凶吗？',
      data: q7.map((r) => `${r.id.replace('q7-', '')}=${r.msPerFrame}ms/帧`).join(' · '),
      verdict: pickPresetVerdict(q7),
    })
  }

  const full = find(reports, 'q8-full')
  if (full) {
    out.push({
      id: 'Q8',
      question: '同一份全片在独立工程里能过吗？',
      data: full.ok ? `${full.frames} 帧 · ${Math.round(full.renderMs / 1000)}s · ${full.msPerFrame}ms/帧 · ${Math.round(full.bytes / 1024)}KB` : `失败：${full.stage} ${full.error ?? ''}`,
      verdict: full.ok
        ? `能过（${Math.round(full.renderMs / 1000)}s）→ **不是 Remotion 能力问题**，是产品调用/窗口/工单链路问题`
        : '独立工程也过不去 → Remotion/编码器能力边界，需要降规格或改造渲染方式',
    })
  }

  const raw60 = find(reports, 'q10-raw-60')
  const prod60 = find(reports, 'q10-product-60')
  const prodFull = find(reports, 'q10-product-full')
  if (raw60 || prod60 || prodFull) {
    const delta = raw60 && prod60 && raw60.ok && prod60.ok ? prod60.renderMs - raw60.renderMs : null
    out.push({
      id: 'Q10',
      question: '产品包装层自己吃掉多少时间？',
      data: [
        raw60 ? `裸调 ${raw60.renderMs}ms` : null,
        prod60 ? `产品 ${prod60.renderMs}ms` : null,
        prodFull ? `全片(产品) ${prodFull.ok ? Math.round(prodFull.renderMs / 1000) + 's' : '失败'}` : null,
      ].filter(Boolean).join(' · '),
      verdict: delta === null
        ? '缺对照'
        : delta > 5000
          ? `产品包装层多花 ${Math.round(delta / 1000)}s（同 60 帧）→ **字体注入/时长探测是固定开销的主嫌疑**`
          : `产品包装层只多 ${delta}ms → 不是它；剩下的差距只能在工单/窗口/画布页侧`,
    })
  }

  const q11 = reports.filter((r) => r.kind === 'run' && r.id.startsWith('q11-'))
  if (q11.length > 0) {
    const pass = q11.filter((r) => r.ok)
    const fail = q11.filter((r) => !r.ok)
    const slowest = pass.slice().sort((a, b) => b.renderMs - a.renderMs)[0]
    out.push({
      id: 'Q11',
      question: '会话里那些"超时刺客"文件，现在各要多久？',
      data: `${pass.length}/${q11.length} 跑通；最慢 ${slowest ? slowest.id.replace('q11-', '') + ' ' + Math.round(slowest.renderMs / 1000) + 's' : '—'}${fail.length > 0 ? '；失败：' + fail.map((r) => r.id.replace('q11-', '') + '@' + r.stage).join(',') : ''}`,
      verdict: pass.length === q11.length
        ? `**同一批文件全部渲通**，最慢一份 ${Math.round(slowest.renderMs / 1000)}s —— 会话里它们全都 ≥90s 超时。文件没变、机器没变 ⇒ 超时不在渲染`
        : '有失败项，逐条看 data 里的 stage（validate 是文件本身不合法，render 才是渲染问题）',
    })
  }

  const q9 = reports.filter((r) => r.kind === 'run' && r.id === 'q9-probe')
  if (q9.length >= 2) {
    const base = q9.find((r) => r.windowMode === 'hidden')
    const thr = q9.find((r) => r.windowMode === 'hidden-throttled')
    const occ = q9.find((r) => r.windowMode === 'occluded')
    const worse = q9.filter((r) => base && r.ok && base.ok && r.renderMs > base.renderMs * 1.5)
    out.push({
      id: 'Q9',
      question: '窗口可见性/背景节流影响多大？',
      data: q9.map((r) => `${r.windowMode}: raf=${r.rafHz}Hz ${r.ok ? r.renderMs + 'ms' : '失败'}`).join(' · '),
      verdict: base === undefined
        ? '缺少 hidden 基准（用 --only=Q9 --windows=hidden,hidden-throttled,visible,occluded 跑）'
        : worse.length === 0
          ? `四档 raf 与耗时接近 → **「可见性节流」不是本次卡点**（产品已关节流，配置正确）`
          : `${worse.map((r) => r.windowMode).join(',')} 明显更慢 → 节流确实存在；${thr && thr.rafHz < base.rafHz * 0.5 ? 'hidden-throttled 的 raf 掉半说明开关必须保留' : ''}${occ && occ.rafHz < base.rafHz * 0.5 ? ' occluded 掉帧说明还需 --disable-backgrounding-occluded-windows' : ''}`,
    })
  }

  return out
}

function pickPresetVerdict(q7) {
  const d = q7.find((r) => r.id === 'q7-draft')
  const sw = q7.find((r) => r.id === 'q7-draft-sw')
  const resp = q7.find((r) => r.id === 'q7-draft-resp')
  if (!d) return '缺少 draft 基准'
  if (sw && sw.msPerFrame < d.msPerFrame * 0.6) return `去掉 prefer-hardware 后 ${d.msPerFrame}→${sw.msPerFrame}ms/帧 → **硬件加速请求是元凶**`
  if (resp && resp.msPerFrame < d.msPerFrame * 0.6) return `放开主线程让出后 ${d.msPerFrame}→${resp.msPerFrame}ms/帧 → **pageResponsiveness:disabled 是元凶**`
  return `三档差异 <40%（${d.msPerFrame}ms/帧）→ 质量档参数不是主因`
}

function linSlope(pts) {
  if (pts.length < 2) return null
  const n = pts.length
  const sx = pts.reduce((s, p) => s + p[0], 0)
  const sy = pts.reduce((s, p) => s + p[1], 0)
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0)
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0)
  const den = n * sxx - sx * sx
  return den === 0 ? null : (n * sxy - sx * sy) / den
}

function linIntercept(pts) {
  const k = linSlope(pts)
  if (k === null) return null
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  return my - k * mx
}

/* ─────────────────────────── 报告 ─────────────────────────── */

function writeReport(vs, reports, matrix) {
  const lines = []
  lines.push(`# 渲染取证报告 ${STAMP}`, '')
  lines.push('> 目的：把"Remotion 能力"与"项目用法"分开。同一台机器、同一份 manifest，只在独立工程里跑。', '')
  lines.push('## 归因结论', '')
  lines.push('| 问题 | 数据 | 判断 |', '|---|---|---|')
  for (const v of vs) lines.push(`| **${v.id}** ${v.question} | ${v.data} | ${v.verdict} |`)
  lines.push('')
  lines.push('## 原始数据', '')
  lines.push('| 场景 | 会话里的结局 | 窗口 | 帧 | 结果 | 渲染 | ms/帧 | rAF | 首帧 | 末帧 | 编码完成 | 体积 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of reports.filter((x) => x.kind === 'run')) {
    lines.push(`| ${r.id} | ${r.note ?? ''} | ${r.windowMode ?? ''} | ${r.frames ?? ''} | ${r.ok ? 'ok' : '✗ ' + (r.stage ?? '')} | ${r.renderMs ?? ''} | ${r.msPerFrame ?? ''} | ${r.rafHz ?? ''} | ${r.firstFrameAt ?? ''} | ${r.lastFrameAt ?? ''} | ${r.encodeDoneAt ?? ''} | ${r.bytes ?? ''} |`)
  }
  const env = reports.find((r) => r.kind === 'env')
  if (env) {
    lines.push('', '## 环境', '', '```json', JSON.stringify(env, null, 2), '```')
  }
  writeFileSync(join(OUT, 'REPORT.md'), lines.join('\n'))
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ stamp: STAMP, verdicts: vs, reports, matrix: matrix.groups.map((g) => ({ id: g.id, runs: g.runs.map((r) => r.id) })) }, null, 2))
}

/* ─────────────────────────── main ─────────────────────────── */

async function main() {
  mkdirSync(MANIFEST_DIR, { recursive: true })
  const real = loadRealManifest()
  const matrix = buildMatrix({ real })

  // Q9 的每一条都必须换一个 Electron 进程（窗口档是进程级设置），所以按档跑同一个组
  const groups = ONLY.length === 0 ? matrix.groups : matrix.groups.filter((g) => ONLY.includes(g.id))
  if (groups.length === 0) {
    bad(`--only=${ONLY.join(',')} 未匹配任何组（可用：${matrix.groups.map((g) => g.id).join(',')}）`)
    process.exit(2)
  }

  // 写 manifest 文件
  let count = 0
  for (const g of matrix.groups) {
    for (const r of g.runs) {
      writeFileSync(join(MANIFEST_DIR, `${r.id}.json`), JSON.stringify(r.manifest))
      count += 1
    }
  }
  ok(`矩阵：${matrix.groups.length} 组 / ${count} 个场景 → ${OUT}`)
  for (const g of matrix.groups) log(`  ${g.id} ${g.title} — ${g.question}`)

  await buildBundle()

  if (CHECK) {
    ok('--check 通过：bundle 可构建、矩阵可生成、manifest 已落盘')
    log(`可在有 GUI 的终端执行：NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=${groups.map((g) => g.id)[0]}`)
    return
  }

  const { server, port, reports, setOnFinish } = await startServer(groups)
  for (const g of groups) {
    const modes = g.id === 'Q9'
      ? (WINDOWS.length > 0 ? WINDOWS : WINDOW_MODES.map((m) => m.id))
      : ['hidden']
    for (const w of modes) await runGroup({ group: g, port, reports, setOnFinish, windowMode: w })
  }
  server.close()

  const vs = verdicts(reports, matrix)
  writeReport(vs, reports, matrix)
  log('')
  for (const v of vs) {
    log(`【${v.id}】${v.question}`)
    console.log(`    数据：${v.data}`)
    console.log(`    判断：${v.verdict}`)
  }
  ok(`报告：${join(OUT, 'REPORT.md')}`)
}

main().catch((err) => {
  bad(String(err && err.stack ? err.stack : err))
  process.exit(1)
})
