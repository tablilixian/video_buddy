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
 *   node scripts/probe-resolution-tiers.mjs --only video --bootstrap-image --mp 0.4,1
 *       ↑ 视频组的**正确姿势**：先用 txt2image 产一张首帧，再把它当 `image1` 打进视频请求
 *   node scripts/probe-resolution-tiers.mjs --image ref-abc.png   # 直接用已有后端句柄当首帧
 *   node scripts/probe-resolution-tiers.mjs --cooldown 5000
 *   node scripts/probe-resolution-tiers.mjs --no-stop-on-fail     # 失败后继续（默认失败即停）
 *   DRAMA_API_BASE=http://x:port node scripts/probe-resolution-tiers.mjs
 *
 * 产物：docs/api-probe/resolution-tier-<时间戳>/ 下的 report.md + raw.json
 *   （报告里的真实像素由 ffprobe 量出，不采信后端响应里的任何声明值）
 *
 * ⚠️ 运行方式（2026-09-15 连踩两次）：**必须用受管的后台任务跑，不要 `nohup &`**。
 *   单个视频用例 130 s 起，而回合结束时**不在任务表里的子进程会被连同进程组杀掉**
 *   → 长任务在飞行中被中断。两次 P0-d 都是这样丢的：日志只剩用例标题，raw.json
 *   一个字节都没写。故本脚本**每跑完一个用例就增量落盘**（writeOut），被中断也留得下
 *   已得数据；失败也记耗时 —— 「秒拒」与「挂死」只能靠这个数分开。
 *
 * ⚠️ 首帧图（2026-09-15 第三轮才发现）：**不带 `image1` 的请求体只等价于生产的「纯文生视频」
 *   分支**（`providers/drama.ts:101-105`）。而档位真正要生效的是**主链路 keyframe→i2v**
 *   （`drama.ts:91-100`，`image1 = 首帧文件名`）。两个分支在后端可能是两条代码路径 ⇒
 *   无图分支的结论**不可外推到带图分支**。故视频组默认要求带首帧（`--image` 或
 *   `--bootstrap-image`），不带就在日志里显式警告。
 *
 * ⚠️ 后端是**单任务同步**：130 s 的长任务期间新请求会排队/超时。故**每个用例前后各插一次
 *   `health`**，且失败即刻停（`--no-stop-on-fail` 才继续）—— 否则一次拖垮会连累后续用例，
 *   更糟的是会把「后端被拖住」误读成「请求体被拒」。首轮 `megapixels=1/2` 双双 `fetch failed`
 *   就是这么被误读的：0.4 刚跑完 130.8 s，后端还在忙。
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
/** 无值开关（`--bootstrap-image` 这类）用这个，别用 arg()（它要求后面跟值）。 */
const has = (name) => process.argv.includes(`--${name}`)

const ONLY = arg('only', 'all') // all | image | video
/**
 * 首帧图 —— 后端已知的文件名（`ref-*` 句柄或 `img_*` 产物名，见 healReferenceFilename）。
 * 空 = 纯文生视频分支（等价 drama.ts:101-105），那**不是**档位要生效的主链路。
 */
let IMAGE = arg('image', '')
/** 不带 --image 时，先跑一次 txt2image 拿首帧 —— 一条命令就是带图分支的正确姿势。 */
const BOOTSTRAP = has('bootstrap-image')
/** 失败即停：防止一次拖垮连累后续用例，也防止「被拖垮」被误读成「请求体被拒」。 */
const STOP_ON_FAIL = !has('no-stop-on-fail')
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

/**
 * 后端活性探针 —— **每个用例前后各插一次**。
 * 这是唯一能把「请求体被拒」与「后端被拖住」分开的手段：用例失败时，先看**它前面那次**
 * health 是不是 200。后端是单任务同步的，长任务期间的失败与请求体无关。
 */
async function healthCheck(label) {
  const t0 = Date.now()
  const rec = { kind: 'health', label, at: new Date().toISOString() }
  try {
    const h = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(15_000) })
    rec.status = h.status
  } catch (e) {
    rec.error = describeError(e)
  }
  rec.ms = Date.now() - t0
  log(`  [health] ${label} → ${rec.status !== undefined ? `HTTP ${rec.status}` : rec.error}  ${rec.ms}ms`)
  results.push(rec)
  writeOut()
  return rec.status === 200
}

/**
 * 从 `/view?filename=xxx.png` 里取后端文件名 —— 它就是能直接当 `image1` 打的句柄。
 */
function filenameOf(url) {
  const m = /[?&]filename=([^&]+)/.exec(url ?? '')
  return m === null ? undefined : decodeURIComponent(m[1])
}

/** 用 txt2image 现产一张首帧（480p，最快），返回后端文件名。 */
async function bootstrapFirstFrame() {
  log('\n[bootstrap] 先用 txt2image 产一张首帧（480p）…')
  const r = await postJson('/api/v1/generate/txt2image', {
    prompt: 'a plain gray wall, soft even lighting, no text',
    width: 864,
    height: 480,
  })
  const url = urlOf(r.data)
  const file = url === undefined ? undefined : filenameOf(url)
  if (file === undefined) {
    console.error(`✗ 拿不到首帧文件名，响应：${JSON.stringify(r.data).slice(0, 300)}`)
    process.exit(1)
  }
  log(`  [bootstrap] 首帧 = ${file}`)
  return file
}

const results = []

/**
 * 增量落盘：每个用例结束就写一次。中途被杀也留得下已得数据 ——
 * 两次 P0-d 全丢就是因为只在 main 末尾落盘一次。
 */
function writeOut() {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify(results, null, 2))
  writeFileSync(join(OUT_DIR, 'report.md'), renderReport())
}

async function runImage(width, height, note) {
  const label = `txt2image ${width}x${height}`
  log(`\n[P0-a/c] ${label}  ${note ?? ''}`)
  const t0 = Date.now()
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
    log(`  → 异常（${Date.now() - t0}ms）${rec.error}`)
  }
  // 失败也必须有耗时：`< 5s` = 后端秒拒（服务健康）；接近 --timeout = 挂死。
  if (rec.ms === undefined) rec.ms = Date.now() - t0
  results.push(rec)
  writeOut()
}

async function runVideo(megapixels, note) {
  const label = `image2videofl2va megapixels=${megapixels}`
  log(`\n[P0-d] ${label}  ${note ?? ''}`)
  const t0 = Date.now()
  let rec = { kind: 'video', request: { megapixels, aspect: '16:9', duration: 5, image1: IMAGE === '' ? null : IMAGE }, note }
  try {
    const r = await postJson('/api/v1/generate/image2videofl2va', {
      prompt: 'a slow push-in on a gray wall, static camera, no text',
      aspect: '16:9',
      megapixels,
      duration: 5,
      // image1 = 首帧（后端文件名）。缺了它这个请求就退化成 drama.ts:101-105 的纯文生视频
      // 分支 —— 那不是档位要生效的主链路，结论不能外推。
      ...(IMAGE !== '' ? { image1: IMAGE } : {}),
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
    log(`  → 异常（${Date.now() - t0}ms）${rec.error}`)
  }
  // 失败也必须有耗时 —— P0-d 的 gate 判定靠它：秒拒 vs 挂死，两条路处置完全相反。
  if (rec.ms === undefined) rec.ms = Date.now() - t0
  results.push(rec)
  writeOut()
  return rec.real?.width !== undefined   // 真拿到并量到产物才算成功
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
    if (IMAGE === '' && BOOTSTRAP) IMAGE = await bootstrapFirstFrame()
    if (IMAGE === '') {
      console.warn('⚠️ 未提供首帧（--image / --bootstrap-image）：本次只测「纯文生视频」分支'
        + '（drama.ts:101-105），结论**不可外推**到主链路 keyframe→i2v。')
    } else {
      log(`\n[video] 首帧 image1 = ${IMAGE}（等价生产「带首帧」分支）`)
    }
    await healthCheck('视频组开始前')
    for (const [i, mp] of MP_LIST.entries()) {
      if (i > 0) await sleep(COOLDOWN)
      // 用例前的 health：失败时靠它区分「请求体被拒」与「后端被前面的用例拖住」。
      const before = await healthCheck(`megapixels=${mp} 之前`)
      if (!before) {
        log('  ✗ 用例前 health 不是 200 —— 后端已被拖住，本轮失败不能归因于请求体。停。')
        break
      }
      const ok = await runVideo(mp, NOTES[mp] ?? '自定义')
      await healthCheck(`megapixels=${mp} 之后`)
      if (!ok && STOP_ON_FAIL) {
        log('  ✗ 失败即停（加 --no-stop-on-fail 可继续）。失败性质看上面两行 health。')
        break
      }
    }
  }

  // —— 落盘（最后一个用例结束时已增量写过，这里再写一次以确保完整）
  writeOut()
  log(`\n产物：${OUT_DIR}/report.md`)
}

function renderReport() {
  const L = []
  L.push('# 分辨率档位探针报告（P0）', '')
  L.push(`- 基址：\`${BASE}\``, `- 时间：${new Date().toISOString()}`, '')
  L.push(`- 首帧 \`image1\`：${IMAGE === ''
    ? '**（无）** ⇒ 本轮只等价于生产「纯文生视频」分支（`drama.ts:101-105`），**结论不可外推**到主链路 keyframe→i2v'
    : `\`${IMAGE}\` ⇒ 等价生产「带首帧」分支（\`drama.ts:91-100\`）`}`, '')
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
    L.push('')
    L.push('**失败性质的判读（必须三者合看，只看错误文本必误判）**：')
    L.push('1. **用例前的 health** 不是 200 ⇒ 后端已被前面的用例拖住，本轮失败**与请求体无关**，作废；')
    L.push('2. **用例后的 health** 从 200 变非 200 ⇒ 该请求体把后端拖垮（挂死），**绝不能**进生产路径；')
    L.push('3. **耗时** `< 5 s` 且前后 health 都是 200 ⇒ 后端**拒绝该请求体**（服务仍健康）⇒ 可安全放进生产路径。')
    L.push('')
    L.push('> 2026-09-15 教训：首轮把 `megapixels=1/2` 的 `fetch failed` 读成了「后端拒收」，'
      + '但当时 0.4 刚跑完 130.8 s 长任务，且全程没有一次 health 采样 —— 单任务同步的后端'
      + '在长任务期间本就该超时。**没有 health 夹心的失败一律不作数。**')
  }

  const hs = results.filter((r) => r.kind === 'health')
  if (hs.length > 0) {
    L.push('', '## 后端活性时间线（每个用例前后各一次）', '')
    L.push('| 时点 | health | 耗时 |')
    L.push('|:--|:--|:--|')
    for (const r of hs) {
      L.push(`| ${r.label} | ${r.status !== undefined ? `HTTP ${r.status}` : r.error} | ${r.ms}ms |`)
    }
    L.push('')
  }
  return L.join('\n')
}

await main()
