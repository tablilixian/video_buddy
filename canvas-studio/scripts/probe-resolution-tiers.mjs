#!/usr/bin/env node
/**
 * 分辨率档位探针（P0）—— 零代码改动，纯实测。
 *
 * 要回答三个问题（见 docs/plans/resolution-tier-dev.md §5）：
 *   P0-a  图片端点 txt2image 的 width/height 是否受「32 的倍数」或上下限约束？
 *   P0-c  图片端点返回的**真实产物像素**是否等于请求值？
 *   P0-d  Drama 视频端点 image2videofl2va 接受 megapixels 0.4/1.0/2.0 吗？
 *         真实产物像素各是多少？（这是 P1' 的 gate：不受 1.0/2.0 则 drama.ts 不改）
 *
 * 为什么必须串行：后端是**单任务同步**的，并发测出来的耗时与失败都不代表基线
 * （见 probe-api-contract.mjs 顶部注释）。本脚本全程串行，用例间可 --cooldown。
 *
 * 用法：
 *   node scripts/probe-resolution-tiers.mjs                  # 全部（图 6 + 视频 3，约 10-20 分钟）
 *   node scripts/probe-resolution-tiers.mjs --only image     # 只跑图片组
 *   node scripts/probe-resolution-tiers.mjs --only video     # 只跑视频组
 *   node scripts/probe-resolution-tiers.mjs --cooldown 5000
 *   DRAMA_API_BASE=http://x:port node scripts/probe-resolution-tiers.mjs
 *
 * 产物：docs/api-probe/resolution-tier-<时间戳>/ 下的 report.md + raw.json
 *   （报告里的真实像素由 ffprobe 量出，不采信后端响应里的任何声明值）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const FFPPOBE = process.env.FFPROBE ?? '/opt/homebrew/bin/ffprobe'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? fallback : v
}
const ONLY = arg('only', 'all') // all | image | video
const COOLDOWN = Number(arg('cooldown', 3000))
const TIMEOUT_MS = Number(arg('timeout', 900_000))
/**
 * 视频组要打的 megapixels 列表（逗号分隔）。默认就是 H3 表三行；
 * 首轮 P0-d 里 1 / 2 双双 "fetch failed"（无 HTTP 状态 = 连接级失败），
 * 需要单独重跑并带上 `err.cause` 才能分清「后端拒绝」与「网络抖动」。
 */
const MP_LIST = arg('mp', '0.4,1,2').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
const OUT_DIR = resolve(arg('out', `docs/api-probe/resolution-tier-${Date.now()}`))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

/** 下载产物并量真实像素——**唯一可信来源**（不采信响应里的任何声明值）。 */
async function realSizeOf(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) return { error: `下载产物失败 HTTP ${res.status}` }
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = url.match(/\.([A-Za-z0-9]+)(?:\?|$)/)?.[1] ?? 'mp4'
  const file = join(tmpdir(), `probe-${Math.random().toString(36).slice(2, 10)}.${ext}`)
  writeFileSync(file, buf)
  try {
    const out = execFileSync(FFPPOBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,nb_frames,duration',
      '-of', 'json',
      file,
    ], { encoding: 'utf8', timeout: 60_000 })
    const s = JSON.parse(out).streams?.[0] ?? {}
    return { width: s.width, height: s.height, bytes: buf.length, file }
  } catch (e) {
    return { error: `ffprobe 失败: ${e.message}` }
  } finally {
    try { execFileSync('rm', ['-f', file]) } catch { /* ignore */ }
  }
}

async function postJson(endpoint, body, timeoutMs = TIMEOUT_MS) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  const ms = Date.now() - t0
  let data
  try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 500) } }
  return { status: res.status, ms, data }
}

/** 从 Drama 响应里取产物 URL（与 generate.ts callDrama 的归一一致）。 */
function urlOf(data) {
  return data?.full_url ?? data?.data?.[0]?.url ?? undefined
}

/**
 * `fetch failed` 本身零信息（undici 把 socket 层错误裹在这一句里）。必须把
 * `err.cause` 的 code / message 一并取出来，否则「后端拒绝」与「网络抖动」
 * 在报告里长得完全一样——这正是首轮 P0-d 卡住的地方。
 */
function describeError(e) {
  const cause = e?.cause
  const code = cause?.code ?? cause?.errno
  const msg = cause?.message ?? cause?.toString?.()
  return [e?.message, code !== undefined ? `[${code}]` : undefined, msg]
    .filter((x) => x !== undefined && x !== '')
    .join(' ')
}

const results = []

async function runImage(width, height, note) {
  const label = `txt2image ${width}x${height}`
  log(`\n[P0-a/c] ${label}  ${note ?? ''}`)
  let rec = { kind: 'image', request: { width, height }, note }
  try {
    const r = await postJson('/api/v1/generate/txt2image', {
      prompt: 'a plain gray wall, soft even lighting, no text',
      width,
      height,
    })
    rec.status = r.status
    rec.ms = r.ms
    const url = urlOf(r.data)
    if (url === undefined) {
      rec.error = '响应无产物 URL'
      rec.response = JSON.stringify(r.data).slice(0, 400)
    } else {
      rec.url = url
      const size = await realSizeOf(url)
      rec.real = size
      rec.exactMatch = size.width === width && size.height === height
      log(`  → HTTP ${r.status} ${r.ms}ms  真实产物 ${size.width}x${size.height}  `
        + `(请求 ${width}x${height}) ${rec.exactMatch ? '✅ 一致' : '⚠️ 不一致'}`
        + (size.error !== undefined ? ` ${size.error}` : ''))
    }
  } catch (e) {
    rec.error = describeError(e)
    log(`  → 异常 ${rec.error}`)
  }
  results.push(rec)
}

async function runVideo(megapixels, note) {
  const label = `image2videofl2va megapixels=${megapixels}`
  log(`\n[P0-d] ${label}  ${note ?? ''}`)
  let rec = { kind: 'video', request: { megapixels, aspect: '16:9', duration: 5 }, note }
  try {
    const r = await postJson('/api/v1/generate/image2videofl2va', {
      prompt: 'a slow push-in on a gray wall, static camera, no text',
      aspect: '16:9',
      megapixels,
      duration: 5,
    })
    rec.status = r.status
    rec.ms = r.ms
    const url = urlOf(r.data)
    if (url === undefined) {
      rec.error = '响应无产物 URL'
      rec.response = JSON.stringify(r.data).slice(0, 400)
      log(`  → HTTP ${r.status} ${r.ms}ms  无产物：${rec.response}`)
    } else {
      rec.url = url
      const size = await realSizeOf(url)
      rec.real = size
      log(`  → HTTP ${r.status} ${r.ms}ms  真实产物 ${size.width}x${size.height}`)
    }
  } catch (e) {
    rec.error = describeError(e)
    log(`  → 异常 ${rec.error}`)
  }
  results.push(rec)
}

async function main() {
  // 0. 健康检查
  try {
    const h = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(15_000) })
    log(`[health] ${BASE} → HTTP ${h.status}`)
    if (!h.ok) process.exitCode = 1
  } catch (e) {
    console.error(`后端不可达：${e.message}`)
    process.exit(1)
  }

  if (ONLY === 'all' || ONLY === 'image') {
    // 现状基准 + 三档横屏 + 新 9:16 默认 + 一个**非 32 倍数**（验证 32 是建议还是硬约束）
    await runImage(1280, 720, '现状基准（当前默认）')
    await sleep(COOLDOWN)
    await runImage(864, 480, '480p 横屏')
    await sleep(COOLDOWN)
    await runImage(1376, 768, '768p 横屏（新默认）')
    await sleep(COOLDOWN)
    await runImage(1920, 1088, '2k 横屏')
    await sleep(COOLDOWN)
    await runImage(768, 1376, '768p 竖屏（反宽高）')
    await sleep(COOLDOWN)
    await runImage(1400, 780, '**非 32 倍数** —— 探后端是否强制对齐')
    await sleep(COOLDOWN)
  }

  if (ONLY === 'all' || ONLY === 'video') {
    const NOTES = {
      0.4: 'H3 表第一行（现状基准：drama.ts 硬编码值）',
      1: 'H3 表第二行（候选默认）',
      2: 'H3 表第三行',
    }
    for (const [i, mp] of MP_LIST.entries()) {
      if (i > 0) await sleep(COOLDOWN)
      await runVideo(mp, NOTES[mp] ?? '自定义')
    }
  }

  // —— 落盘
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify(results, null, 2))
  writeFileSync(join(OUT_DIR, 'report.md'), renderReport())
  log(`\n产物：${OUT_DIR}/report.md`)
}

function renderReport() {
  const L = []
  L.push('# 分辨率档位探针报告（P0）', '')
  L.push(`- 基址：\`${BASE}\``, `- 时间：${new Date().toISOString()}`, '')
  L.push('> 真实像素一律由 **ffprobe** 量出，不采信响应里的任何声明值。', '')

  const imgs = results.filter((r) => r.kind === 'image')
  if (imgs.length > 0) {
    L.push('## P0-a / P0-c 图片端点（`txt2image`）', '')
    L.push('| 请求 | HTTP | 耗时 | 真实产物 | 一致 | 32 倍数 |')
    L.push('|:--|:--|:--|:--|:--|:--|')
    for (const r of imgs) {
      const { width: w, height: h } = r.request
      const p32 = w % 32 === 0 && h % 32 === 0 ? '✅' : '❌'
      const real = r.real?.width !== undefined ? `${r.real.width} × ${r.real.height}` : (r.error ?? '—')
      L.push(`| ${w} × ${h} | ${r.status ?? '—'} | ${r.ms ?? '—'}ms | ${real} `
        + `| ${r.exactMatch === true ? '✅' : r.exactMatch === false ? '❌' : '—'} | ${p32} |`)
    }
    L.push('')
  }

  const vids = results.filter((r) => r.kind === 'video')
  if (vids.length > 0) {
    L.push('## P0-d Drama 视频端点（`image2videofl2va`）', '')
    L.push('| megapixels | HTTP | 耗时 | 真实产物 | 32 倍数 |')
    L.push('|:--|:--|:--|:--|:--|')
    for (const r of vids) {
      const { width: w, height: h } = r.real ?? {}
      const p32 = w !== undefined ? (w % 32 === 0 && h % 32 === 0 ? '✅' : '❌') : '—'
      const real = w !== undefined ? `${w} × ${h}` : (r.error ?? '—')
      L.push(`| ${r.request.megapixels} | ${r.status ?? '—'} | ${r.ms ?? '—'}ms | ${real} | ${p32} |`)
    }
    L.push('')
    L.push('**gate 结论**：若 1.0 / 2.0 返回 200 且产物像素随之变化 ⇒ 按档发送 megapixels（P1\' 照做）；'
      + '若只认 0.4 ⇒ `drama.ts` 不改，只改 warning 文案。', '')
  }
  return L.join('\n')
}

await main()
