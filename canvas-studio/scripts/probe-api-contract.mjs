#!/usr/bin/env node
/**
 * Drama Backend 契约探测（严格串行）。
 *
 * 为什么必须串行
 * --------------
 * 后端是**单任务同步**的：一个任务在跑，后面的只能排队（极端情况下入口直接拒）。
 * 因此：
 *   - 并发探测出来的耗时毫无意义（那是排队时间，不是接口耗时）；
 *   - 一个用例把后端打崩，后面所有用例的结果都会「看起来像后端坏了」；
 *   - 本脚本全程 `for await` 串行执行，且每个用例之间可加冷却（--cooldown）。
 *
 * 探测什么
 * --------
 *   1. **契约真相**：直接读 `GET /openapi.json`，把每个端点的 required / 可选字段
 *      与默认值拉出来——这比黑盒试错快，也是唯一可信的「参数是否必填」来源。
 *   2. **必填性实测**：先发「只含必填字段」的最小请求（验证可选字段真的可选），
 *      再逐个删掉一个必填字段，验证后端是按 422 拒绝还是静默用默认值放行。
 *   3. **文件句柄可消费性**：同一端点分别传「上传过的真实文件名」与「不存在的
 *      幽灵文件名」，看后端是 200、422 还是笼统 500。这是 canvas-studio 最高频的坑
 *      （会话分析已显示：带文件名参数成功率 17%，不带 100%）。
 *   4. **类型/枚举错误**：把 int 传成字符串、把枚举传成非法值，记录后端真实响应
 *      （FastAPI 约定是 422 + detail 数组，但这个后端历史上大量返回笼统 500）。
 *   5. **排队行为**（--probe-queue）：并发 2 个快速请求，看后者是排队（耗时叠加、
 *      最终 200）还是被入口拒（立刻 500）——直接验证「单任务」到底是排队还是拒单。
 *
 * 用法
 * ----
 *   node scripts/probe-api-contract.mjs                 # 快速套件（约 1–2 分钟）
 *   node scripts/probe-api-contract.mjs --suite full     # 追加慢端点（视频/音频，十几分钟）
 *   node scripts/probe-api-contract.mjs --probe-queue    # 只跑排队行为探测
 *   node scripts/probe-api-contract.mjs --cooldown 3000  # 用例间隔 3s，后端疲惫时用
 *   DRAMA_API_BASE=http://x:port node scripts/probe-api-contract.mjs
 *
 * 产物（--out 目录，默认 docs/api-probe/contract-<时间戳>）
 *   contract.md  契约与实测结论（可直接抄进 docs/api.md）
 *   raw.json     每个用例的原始响应（状态码/耗时/响应体）
 *
 * 注：本机 Bash 沙箱会拦截到 117.50.108.73:8082 的连接（表现为超时/零字节），
 * 需在沙箱外运行。另外**选后端空闲时段跑**——负载期的耗时与失败都不代表基线。
 *
 * 退出码：0 = 探测完成（不判定接口优劣）；1 = 后端不可达。
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return fallback
  return v
}
const flag = (name) => process.argv.includes(`--${name}`)

const OUT_DIR = resolve(arg('out', `docs/api-probe/contract-${Date.now()}`))
const SUITE = arg('suite', 'quick') // quick | full
const COOLDOWN = Number(arg('cooldown', 0))
const ONLY_QUEUE = flag('probe-queue')
const TIMEOUT_MS = Number(arg('timeout', 900_000))
/**
 * 同一用例重复次数。这个后端的 500 有相当比例是**偶发**的，单次结果不足以定性
 * （历史教训：一次 500 就判定「端点下线」多次误伤）。默认 1；要下结论时建议 3。
 */
const REPEAT = Math.max(1, Number(arg('repeat', 1)))
/** 只跑指定端点（逗号分隔的 key），用于定点复测，如 --only image2image,image2vl。 */
const ONLY = arg('only', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null

// ---------------------------------------------------------------- HTTP 基元

/** 走 node:http 而非 fetch：undici 的 headersTimeout 默认 300s，会先于业务超时触发。 */
function req(method, path, { json, raw, headers = {}, timeout = TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    const started = Date.now()
    const url = new URL(BASE + path)
    let payload = raw
    const h = { ...headers }
    if (json !== undefined) {
      payload = Buffer.from(JSON.stringify(json), 'utf8')
      h['content-type'] = 'application/json'
      h['content-length'] = String(payload.length)
    }
    const r = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, headers: h }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode ?? 0, ms: Date.now() - started, text: Buffer.concat(chunks).toString('utf8') }))
    })
    r.setTimeout(timeout, () => {
      r.destroy()
      done({ status: 0, ms: Date.now() - started, text: `TIMEOUT after ${timeout}ms` })
    })
    r.on('error', (e) => done({ status: 0, ms: Date.now() - started, text: `ERR ${e.message}` }))
    if (payload !== undefined) r.write(payload)
    r.end()
  })
}

const postJson = (path, body) => req('POST', path, { json: body })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 1×1 红色 PNG（190B 量级），用于上传探测，避免依赖本地素材。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

/** multipart/form-data 上传（字段必须叫 file，boundary 不能手写 Content-Type 之外的东西）。 */
function upload(filename, buf, mime = 'image/png') {
  const boundary = `----probe${randomUUID().replace(/-/g, '')}`
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return req('POST', '/api/v1/generate/upload', {
    raw: Buffer.concat([head, buf, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  })
}

// ---------------------------------------------------------------- OpenAPI 契约

async function fetchContract() {
  const res = await req('GET', '/openapi.json')
  let spec = null
  try {
    spec = JSON.parse(res.text)
  } catch {
    return { res, endpoints: [] }
  }
  const endpoints = []
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!['get', 'post'].includes(method)) continue
      const body = op?.requestBody?.content?.['application/json']?.schema
      const schemaName = body?.$ref ? String(body.$ref).split('/').pop() : null
      const schema = schemaName ? spec.components?.schemas?.[schemaName] : body
      if (!schema) continue
      endpoints.push({
        path,
        method: method.toUpperCase(),
        schemaName,
        required: schema.required ?? [],
        properties: Object.fromEntries(
          Object.entries(schema.properties ?? {}).map(([k, v]) => [k, { type: v.type ?? (v.anyOf ? 'anyOf' : '?'), default: v.default, enum: v.enum, title: v.title }]),
        ),
      })
    }
  }
  return { res, endpoints, spec }
}

// ---------------------------------------------------------------- 用例

const results = []
async function runCase(id, title, fn) {
  const started = Date.now()
  let out
  try {
    out = await fn()
  } catch (e) {
    out = { status: 0, ms: Date.now() - started, text: `THROW ${e.message}` }
  }
  const rec = { id, title, ...out, at: new Date().toISOString() }
  results.push(rec)
  const brief = rec.text.replace(/\s+/g, ' ').slice(0, 120)
  console.log(`  ${String(rec.status).padEnd(4)} ${rec.ms.toString().padStart(7)}ms  ${id.padEnd(30)} ${brief}`)
  if (COOLDOWN > 0) await sleep(COOLDOWN)
  return rec
}

/** 依据 openapi 的 required 生成「删除某必填字段」的用例。 */
function missingCases(endpointPath, baseBody, required) {
  return required
    .filter((f) => f in baseBody)
    .map((field) => {
      const body = { ...baseBody }
      delete body[field]
      return { field, body }
    })
}

// ---------------------------------------------------------------- 主流程

/** openapi 解析出的端点契约（必填/可选/默认值），报告用。 */
let endpoints = []

console.log(`→ Drama Backend 契约探测  base=${BASE}  suite=${SUITE}`)

const health = await req('GET', '/api/v1/health')
console.log(`  健康检查: ${health.status} ${health.text.slice(0, 80)}`)
if (health.status === 0) {
  console.error(`✗ 后端不可达（${health.text}）。若在沙箱内运行，请在沙箱外重试。`)
  process.exit(1)
}

if (ONLY_QUEUE) {
  console.log('\n[排队行为] 并发 2 个快速请求（image2promptenhance）')
  const body = { prompt: 'a red apple' }
  const started = Date.now()
  const pair = await Promise.all([postJson('/api/v1/generate/image2promptenhance', body), postJson('/api/v1/generate/image2promptenhance', body)])
  const wall = Date.now() - started
  results.push({ id: 'queue.a', title: '并发 A', ...pair[0] })
  results.push({ id: 'queue.b', title: '并发 B', ...pair[1] })
  console.log(`  A: ${pair[0].status} ${pair[1] === undefined ? '' : pair[0].ms}ms`)
  console.log(`  B: ${pair[1].status} ${pair[1].ms}ms   墙钟总耗时 ${wall}ms`)
  const maxMs = Math.max(pair[0].ms, pair[1].ms)
  const minMs = Math.min(pair[0].ms, pair[1].ms)
  /**
   * 判据：排队时后者从发起就等着，它的耗时≈整个墙钟（maxMs/wall→1），
   * 且比前者多出一个执行时长（maxMs-minMs≈minMs）；真并发时两者≈wall 且彼此接近。
   */
  const verdict = pair.some((p) => p.status >= 500)
    ? '入口拒单（并发时后者直接失败，后端不排队）'
    : maxMs / wall > 0.85 && maxMs - minMs > minMs * 0.5
      ? '串行排队（后者耗时≈等待+自身执行，即 max≈墙钟 且 max-min≈min）→ 并发请求只会变慢，不要并发'
      : minMs / maxMs > 0.7
        ? '真并发（两者耗时接近且≈墙钟，后端能同时处理）'
        : '不确定（样本噪声大，可 --cooldown 后重跑）'
  console.log(`  判定：${verdict}`)
  results.push({ id: 'queue.verdict', title: '排队行为判定', status: 0, ms: wall, text: verdict })
} else {
  // —— 1. 契约真相
  console.log('\n[1] OpenAPI 契约')
  const { res: specRes, endpoints: specEndpoints } = await fetchContract()
  endpoints = specEndpoints
  results.push({ id: 'openapi', title: 'GET /openapi.json', ...specRes })
  console.log(`  openapi: ${specRes.status}，解析出 ${endpoints.length} 个带请求体的端点`)

  // —— 2. 上传一个真实文件，拿到真实句柄
  console.log('\n[2] 上传真实文件（拿真实句柄）')
  const upName = `ref-${randomUUID().slice(0, 8)}.png`
  const up = await runCase('upload.real', `上传 ${upName}`, async () => upload(upName, TINY_PNG))
  let realName = null
  try {
    realName = JSON.parse(up.text).name ?? null
  } catch {
    /* 保持 null */
  }
  console.log(`  真实句柄: ${realName ?? '（未取到）'}`)

  // —— 3. 必填性 + 类型/枚举 + 文件句柄实测
  console.log('\n[3] 端点实测（串行）')
  const targets = [
    { key: 'image2promptenhance', path: '/api/v1/generate/image2promptenhance', body: { prompt: 'a red apple' } },
    { key: 'txt2image', path: '/api/v1/generate/txt2image', body: { prompt: 'a red apple on a wooden table' } },
    { key: 'image2image', path: '/api/v1/generate/image2image', body: { prompt: 'make it autumn', image1: realName ?? 'ghost.png' } },
    { key: 'image2vl', path: '/api/v1/generate/image2vl', body: { system_prompt: 'You are helpful.', prompt: 'what is in this image', image: realName ?? 'ghost.png' } },
  ]
  if (SUITE === 'full') {
    targets.push({ key: 'image2character', path: '/api/v1/generate/image2character', body: { image: realName ?? 'ghost.png' } })
    // 带 image1 = 生产上「首帧图生视频」的真实路径；nofile 对照会自动生成（纯文生视频）
    targets.push({ key: 'image2videofl2va', path: '/api/v1/generate/image2videofl2va', body: { prompt: 'a cat running in the grass, slow pan', duration: 5, image1: realName ?? 'ghost.png' } })
  }

  for (const t of targets) {
    if (ONLY !== null && !ONLY.includes(t.key)) continue
    const ep = endpoints.find((e) => e.path === t.path)
    const required = ep?.required ?? []
    console.log(`\n  ── ${t.key}${required.length > 0 ? `  required=[${required.join(', ')}]` : '  required=[]'}`)

    // 3.1 最小请求（只含必填字段）：验证「可选字段确实可选」。--repeat 用于区分偶发与稳定失败
    for (let i = 1; i <= REPEAT; i += 1) {
      await runCase(`${t.key}.baseline${REPEAT > 1 ? `#${i}` : ''}`, '最小请求（仅必填）', async () => postJson(t.path, t.body))
    }

    // 3.2 逐个删必填字段 → 后端是 422 还是静默放行
    for (const { field, body } of missingCases(t.path, t.body, required)) {
      await runCase(`${t.key}.missing.${field}`, `缺必填 ${field}`, async () => postJson(t.path, body))
    }

    // 3.3 类型错误（把数字字段传成字符串 / 把字符串字段传成数字）
    const numericField = Object.entries(ep?.properties ?? {}).find(([, v]) => v.type === 'integer' || v.type === 'number')?.[0]
    if (numericField !== undefined) {
      await runCase(`${t.key}.wrongtype.${numericField}`, `${numericField} 传字符串`, async () => postJson(t.path, { ...t.body, [numericField]: 'not-a-number' }))
    }
    const stringField = Object.entries(ep?.properties ?? {}).find(([, v]) => v.type === 'string' && v.enum === undefined)?.[0]
    if (stringField !== undefined) {
      await runCase(`${t.key}.wrongtype.${stringField}`, `${stringField} 传数字`, async () => postJson(t.path, { ...t.body, [stringField]: 12345 }))
    }

    // 3.4 幽灵文件名：后端对「名字在、文件不在」的真实态度
    const fileField = Object.keys(t.body).find((k) => /^(image\d*|video\d*|audio\d*)$/.test(k))
    if (fileField !== undefined) {
      for (let i = 1; i <= REPEAT; i += 1) {
        await runCase(`${t.key}.ghost.${fileField}${REPEAT > 1 ? `#${i}` : ''}`, `${fileField} 用幽灵文件名`, async () =>
          postJson(t.path, { ...t.body, [fileField]: `ghost-${randomUUID().slice(0, 8)}.png` }),
        )
      }
      // 对照：同一个端点不带文件参数（纯文本路径），用来判定「是端点挂了」还是「带文件才挂」
      const bare = { ...t.body }
      delete bare[fileField]
      await runCase(`${t.key}.nofile`, `不带 ${fileField}（纯文本对照）`, async () => postJson(t.path, bare))
    }
  }
}

// ---------------------------------------------------------------- 报告

const md = []
md.push('# Drama Backend 契约探测报告（串行实测）')
md.push('')
md.push(`- 后端：\`${BASE}\`（健康检查 ${health.status}）`)
md.push(`- 时间：${new Date().toLocaleString('zh-CN')} · 套件：${SUITE} · 用例 ${results.length} 个 · 全程串行`)
md.push('')
md.push('> 后端单任务同步：并发不会加速，只会排队（或被入口拒）。本报告所有耗时均为**独占后端**时测得。')
md.push('')

if (endpoints.length > 0) {
  md.push('## 一、OpenAPI 契约（必填 / 可选 / 默认值）')
  md.push('')
  md.push('| 端点 | 必填字段 | 可选字段（默认值） |')
  md.push('| --- | --- | --- |')
  for (const e of endpoints) {
    const optional = Object.entries(e.properties)
      .filter(([k]) => !e.required.includes(k))
      .map(([k, v]) => `${k}${v.default !== undefined ? `(=${JSON.stringify(v.default)})` : ''}`)
      .join(', ')
    md.push(`| \`${e.method} ${e.path}\` | ${e.required.length > 0 ? e.required.map((f) => `**${f}**`).join(', ') : '（无）'} | ${optional || '（无）'} |`)
  }
  md.push('')
  md.push('> 来源：`GET /openapi.json`（后端自述，唯一权威）。「实测」一节再验证这些声明是否与真实行为一致——历史上出现过「文档写必填、实际有默认值」和「文档写可选、实际不传就 500」两种偏差。')
  md.push('')
}

md.push('## 二、实测结果')
md.push('')
md.push('| # | 用例 | HTTP | 耗时 | 响应摘要 |')
md.push('| ---: | --- | ---: | ---: | --- |')
results.forEach((r, i) => {
  md.push(`| ${i} | ${r.id} | ${r.status || '—'} | ${r.ms}ms | ${r.text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 110)} |`)
})
md.push('')

md.push('## 三、怎么读这张表')
md.push('')
md.push('- `.baseline` 成功 → 该端点的可选字段确实可选（可以不传）。')
md.push('- `.missing.<字段>` 返回 **422** 且 detail 指向该字段 → 真必填；返回 **200** → 文档写了必填、后端有默认值，实际不传也行；返回 **500** → 后端没做参数校验，缺失会一路崩到内部（这类最危险，客户端必须自己兜底）。')
md.push('- `.ghost.<字段>` 返回 500 → 「文件名在、文件不在」被后端当成内部错误，客户端**无法**从状态码区分「文件名拼错」与「后端故障」，只能靠上游保证句柄有效（canvas-studio 的 `ref-<uuid>.<ext>` 自造唯一名就是为此）。')
md.push('- `.wrongtype` 返回 422 → 后端有类型校验，可放心把错误直接回显给用户；返回 500/200 → 类型错误被吞，需在工具层预校验。')
md.push('')
md.push(`> 原始响应当见同目录 \`raw.json\`。`)
md.push('')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'contract.md'), md.join('\n'))
writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ base: BASE, suite: SUITE, at: new Date().toISOString(), results }, null, 2))

console.log(`\n✓ 探测完成 → ${OUT_DIR}`)
console.log(`  ${join(OUT_DIR, 'contract.md')}`)
console.log(`  ${join(OUT_DIR, 'raw.json')}`)
