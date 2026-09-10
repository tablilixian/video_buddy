/**
 * H3 时长守时实测（CV-131 前置验证）—— 回答一个问题：
 * **请求 duration=N 时，模型真实产出多少秒？**
 *
 * 背景：音视频统一时间轴方案（docs/av-timeline-plan.md）的路线 A（声明值驱动）
 * 完全押注「模型守时」这个从未验证过的假设。音频侧已实测（txt2audio 30/60/300 →
 * 真实 30.024/60.024/300.024s，误差 ±0.03s），**视频侧至今零数据**。
 * 本脚本补齐这个数字：偏差小 → 路线 A 可信；漂移明显 → 必须靠路线 B 兜底。
 *
 * 口径与生产一致（src/providers/drama.ts submit）：
 *   POST {base}/api/v1/generate/image2videofl2va
 *   body: { prompt, aspect:'16:9', megapixels:0.4, duration }
 * 探针只比「请求值 vs 产出真实时长」，不掺入 generate.ts 的自愈/重试逻辑。
 *
 * 用法：
 *   node scripts/h3-duration-probe.mjs                      # 默认 5,8,10 各一次
 *   node scripts/h3-duration-probe.mjs --durations 5,10,15
 *   node scripts/h3-duration-probe.mjs --durations 5 --repeat 2
 *   DRAMA_API_BASE=http://x:port node scripts/h3-duration-probe.mjs
 *   node scripts/h3-duration-probe.mjs --out /tmp/probe.json
 *
 * 注 1：本机 Bash 沙箱会拦截到 117.50.108.73:8082 的连接（表现为 HTTP 超时/零字节），
 * 需在沙箱外运行（实测沙箱外 59ms 返回 200）。
 *
 * 注 2（长时长必看）：`fetch` 不能用 —— Node 内置 fetch 走 undici，dispatcher 的
 * `headersTimeout` 默认 **300s**，与 AbortSignal 无关且先触发；`duration≥10` 的推理
 * 需 5 分钟以上，会被隐形掐断。故本脚本的生成请求改走 `node:http`（见 postJson），
 * `TIMEOUT_MS`（当前 900s）这才真正生效。
 *
 * 注 3：**选后端空闲时段跑** —— 2026-09-10 实测时后台正在测试，10s/12s 全部
 * 301s 失败（响应头迟迟不到 → 被上面那个 300s 上限掐断）。负载期的耗时不代表基线。
 *
 * 退出码：0 = 全部探针完成（不判定优劣）；1 = 环境不可用/参数错。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const OUT_DIR = process.env.PROBE_DIR ?? '/tmp/h3-duration-probe'
const TIMEOUT_MS = 900_000 // 单次生成上限 15 分钟（经 node:http 才真正生效，见 postJson）
/** 固定 prompt：三次只变 duration，避免内容差异混淆时长结论。 */
const PROMPT = '一只橘猫在阳光下的草地上奔跑，镜头缓慢平移，写实风格，电影感'
/**
 * 可选：带首帧图跑 `fl2va + image1`（= 生产上逐镜生成的真实路径）。
 * `--image <path>` 用现成图片；`--with-image` 先 txt2image 生成一张再用。
 * 不带则跑纯文生视频（同样落 fl2va，只是没有 image1）。
 */
const IMAGE_PATH = arg('image', null)
const WITH_IMAGE = IMAGE_PATH !== null || process.argv.includes('--with-image')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) fail(`--${name} 需要一个值`)
  return v
}

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

/** ffprobe 真实时长（秒，保留 3 位）。 */
function probeDuration(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  ).trim()
  const n = Number(out)
  if (!Number.isFinite(n)) throw new Error(`ffprobe 输出无法解析：${JSON.stringify(out)}`)
  return n
}

/** 抽流信息（编码/帧数/帧率），用于判断"短了"是丢帧还是定长截断。 */
function probeStream(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,width,height,r_frame_rate,nb_frames', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  try {
    return JSON.parse(out).streams?.[0] ?? {}
  } catch {
    return {}
  }
}

async function health() {
  const res = await fetch(`${BASE}/api/v1/health`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`health HTTP ${res.status}`)
  const json = await res.json()
  if (json.status !== 'ok') throw new Error(`health 异常：${JSON.stringify(json)}`)
}

/**
 * 长耗时 POST（绕开 Node 内置 fetch / undici 的**隐形 300s 上限**）。
 *
 * ⚠️ 为什么不能用 `fetch` + `AbortSignal.timeout(N)` 来测长视频：
 * Node 的全局 `fetch` 由 undici 提供，其 dispatcher 的 **`headersTimeout` 默认 300s**
 * （`bodyTimeout` 同为 300s），而这个上限**与 AbortSignal 无关、且先于它触发** ——
 * 即使传 `AbortSignal.timeout(900_000)`，只要响应头晚于 300s 到达，请求照样在 ~301s
 * 被掐断，错误码 `UND_ERR_HEADERS_TIMEOUT`。
 *
 * 本探针实测已踩中：`duration=10/12` 三次全部 `fetch failed ｜ cause=UND_ERR_HEADERS_TIMEOUT`、
 * 耗时精确 301.0/301.1/301.2s —— 而脚本里的 `TIMEOUT_MS` 是 900s（根本没触发）。
 * 本地复现（起一个只接不回响应的服务器）：`AbortSignal.timeout(2000)` 抛的是
 * 「The operation was aborted due to timeout」且**无** UND_ERR 错误码 →
 * 证实 300s 那一刀来自 undici，不是我们自己的信号。
 *
 * H3 的 10s 视频推理需 5 分钟以上，必然踩中该上限 → 用 `node:http` 自行掌控超时。
 */
function postJson(path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path)
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port === '' ? 80 : Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': payload.byteLength },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    // node:http 默认无超时；这里用 socket 静默超时兜底（等响应头期间无数据流动即触发）。
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`超过本探针 ${Math.round(timeoutMs / 1000)}s 上限（node:http 硬超时）`))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

/** txt2image 生成一张首帧图并落盘，返回本地路径（口径同 generate.ts 写实文生图）。 */
async function genFrame() {
  const res = await fetch(`${BASE}/api/v1/generate/txt2image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: PROMPT, width: 1280, height: 720 }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) throw new Error(`txt2image HTTP ${res.status}：${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const url = data.full_url ?? data.data?.[0]?.url
  if (!url) throw new Error(`txt2image 未返回 URL：${JSON.stringify(data).slice(0, 200)}`)
  const bin = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  const file = join(OUT_DIR, 'frame.png')
  writeFileSync(file, Buffer.from(await bin.arrayBuffer()))
  console.log(`  首帧已生成 → ${file}`)
  return file
}

/** 上传图片拿服务器 filename（口径同 generate.ts uploadBytesToDrama）。 */
async function uploadImage(file) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(file)]), `frame-${Date.now()}.png`)
  const res = await fetch(`${BASE}/api/v1/generate/uploadimage`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`uploadimage HTTP ${res.status}：${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const filename = data.filename ?? data.name ?? data.data?.filename ?? data.data?.url
  if (!filename) throw new Error(`上传成功但未返回 filename：${JSON.stringify(data).slice(0, 200)}`)
  console.log(`  首帧已上传 → ${filename}`)
  return String(filename)
}

/** 一次生成 + 下载 + 量测。frame 非空则带 image1（首帧模式）。 */
async function runOnce(duration, index, frame) {
  const started = Date.now()
  const body = { prompt: PROMPT, aspect: '16:9', megapixels: 0.4, duration }
  if (frame !== null) body.image1 = frame
  const record = { duration, index, mode: frame !== null ? 'fl2va+image1' : 'fl2va(t2v)', body, ok: false }

  let reply
  try {
    // 走 node:http 而非 fetch —— fetch/undici 会在 300s 处隐形掐断（见 postJson 注释）。
    reply = await postJson('/api/v1/generate/image2videofl2va', body, TIMEOUT_MS)
  } catch (e) {
    // 保留 cause 展开：node:http 的 socket 错误同样把细节藏在 cause 里。
    const cause = e instanceof Error && e.cause !== undefined
      ? ` ｜ cause=${e.cause?.code ?? e.cause?.message ?? String(e.cause)}`
      : ''
    record.error = `请求异常：${e instanceof Error ? e.message : String(e)}${cause}`
    record.wallMs = Date.now() - started
    return record
  }
  record.httpStatus = reply.status
  const text = reply.text
  if (reply.status < 200 || reply.status >= 300) {
    record.error = `HTTP ${reply.status}：${text.slice(0, 300)}`
    record.wallMs = Date.now() - started
    return record
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    record.error = `响应非 JSON：${text.slice(0, 200)}`
    record.wallMs = Date.now() - started
    return record
  }
  // 记录响应里出现的所有字段名（含后端是否回显 duration——音频侧该字段语义是
  // 生成耗时而非音频时长，视频侧需同样存疑对待）。
  record.responseKeys = Object.keys(data)
  record.response = data
  const url = data.full_url ?? data.data?.[0]?.url
  if (!url) {
    record.error = `未找到产物 URL：${JSON.stringify(data).slice(0, 300)}`
    record.wallMs = Date.now() - started
    return record
  }
  record.url = url
  record.filename = data.filename ?? data.data?.[0]?.filename
  record.genMs = Date.now() - started

  // 下载
  try {
    const bin = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!bin.ok) throw new Error(`下载 HTTP ${bin.status}`)
    const buf = Buffer.from(await bin.arrayBuffer())
    const file = join(OUT_DIR, `${record.mode === 'fl2va(t2v)' ? 't2v' : 'i2v'}-req${duration}-run${index}.mp4`)
    writeFileSync(file, buf)
    record.file = file
    record.bytes = statSync(file).size
  } catch (e) {
    record.error = `下载失败：${e instanceof Error ? e.message : String(e)}`
    record.wallMs = Date.now() - started
    return record
  }

  // 量测
  try {
    record.actual = probeDuration(record.file)
    record.stream = probeStream(record.file)
    record.delta = Number((record.actual - duration).toFixed(3))
    record.deltaPct = Number(((record.delta / duration) * 100).toFixed(2))
    record.ok = true
  } catch (e) {
    record.error = `量测失败：${e instanceof Error ? e.message : String(e)}`
  }
  record.wallMs = Date.now() - started
  return record
}

function fmt(n, d = 3) {
  return Number.isFinite(n) ? n.toFixed(d) : '—'
}

async function main() {
  const durations = arg('durations', '5,8,10')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  const repeat = Math.max(1, Number(arg('repeat', '1')) || 1)
  const outPath = arg('out', join(OUT_DIR, WITH_IMAGE ? 'probe-i2v.json' : 'probe-t2v.json'))
  if (durations.length === 0) fail('--durations 解析为空（例：--durations 5,8,10）')

  mkdirSync(OUT_DIR, { recursive: true })

  console.log(`[h3-duration-probe] base=${BASE}`)
  console.log(`  计划：duration=[${durations.join(', ')}] × repeat=${repeat} → ${durations.length * repeat} 次生成`)
  console.log(`  产物目录：${OUT_DIR}`)
  try {
    await health()
    console.log('  health ok')
  } catch (e) {
    return fail(`后端不可达或异常：${e instanceof Error ? e.message : String(e)}`)
  }

  // 带图模式：准备一次首帧，全部探针复用（只变 duration）。
  let frame = null
  if (WITH_IMAGE) {
    try {
      const local = IMAGE_PATH ?? (await genFrame())
      frame = await uploadImage(local)
    } catch (e) {
      return fail(`首帧准备失败：${e instanceof Error ? e.message : String(e)}`)
    }
    console.log(`  模式：fl2va + image1（首帧模式）`)
  } else {
    console.log('  模式：fl2va（纯文生视频，无 image1）')
  }

  const records = []
  for (let r = 1; r <= repeat; r++) {
    for (const d of durations) {
      process.stdout.write(`  → 请求 duration=${d} (第 ${r}/${repeat} 轮) ... `)
      const rec = await runOnce(d, r, frame)
      records.push(rec)
      if (rec.ok) {
        console.log(
          `真实 ${fmt(rec.actual)}s  偏差 ${rec.delta > 0 ? '+' : ''}${fmt(rec.delta)}s` +
          ` (${rec.deltaPct > 0 ? '+' : ''}${rec.deltaPct}%)  生成 ${(rec.wallMs / 1000).toFixed(1)}s` +
          `  ${rec.stream?.codec_name ?? '?'} ${rec.stream?.width}x${rec.stream?.height}` +
          ` ${rec.stream?.nb_frames ?? '?'}帧`,
        )
      } else {
        console.log(`失败：${rec.error}`)
      }
    }
  }

  const ok = records.filter((r) => r.ok)
  const report = {
    base: BASE,
    prompt: PROMPT,
    mode: frame !== null ? 'fl2va + image1（首帧模式）' : 'fl2va（纯文生视频）',
    ranAt: new Date().toISOString(),
    endpoint: '/api/v1/generate/image2videofl2va',
    records,
    summary: {
      total: records.length,
      succeeded: ok.length,
      failed: records.length - ok.length,
      maxAbsDelta: ok.length > 0 ? Math.max(...ok.map((r) => Math.abs(r.delta))) : null,
      byDuration: durations.map((d) => {
        const rows = ok.filter((r) => r.duration === d)
        return {
          duration: d,
          actual: rows.map((r) => r.actual),
          delta: rows.map((r) => r.delta),
          meanAbsDelta:
            rows.length > 0
              ? Number((rows.reduce((a, r) => a + Math.abs(r.delta), 0) / rows.length).toFixed(3))
              : null,
        }
      }),
    },
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2))

  console.log('\n=== 汇总：请求 vs 真实 ===')
  console.log('请求(s)  真实(s)   偏差(s)  偏差(%)  编码/尺寸       生成耗时(s)')
  for (const r of ok) {
    console.log(
      `${String(r.duration).padStart(5)}  ${fmt(r.actual).padStart(8)}  ${(r.delta > 0 ? '+' : '') + fmt(r.delta)}`.padEnd(24) +
      `${((r.deltaPct > 0 ? '+' : '') + r.deltaPct).padStart(7)}%  ` +
      `${(r.stream?.codec_name ?? '?') + ' ' + (r.stream?.width ?? '?') + 'x' + (r.stream?.height ?? '?')}`.padEnd(16) +
      `${(r.wallMs / 1000).toFixed(1)}`,
    )
  }
  const s = report.summary
  console.log(`\n成功 ${s.succeeded}/${s.total}，最大绝对偏差 ${fmt(s.maxAbsDelta)}s`)
  console.log(`报告：${outPath}`)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
