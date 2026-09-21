// Drama API Playground —— 一键自动测试脚本（无头）
//
// 通过本地同源代理（vite dev server，默认 http://localhost:5188）逐一调用 Drama Backend
// 全部端点，并把「生成图 → fetch-to-upload 拿句柄 → 作为下游参考输入」整条链路跑通，
// 最后产出 report.html + 控制台摘要。
//
// 会生成两张互不覆盖的基图：
//   · 角色基图（SAMPLES.txt2image）        → image2image / image2character / 视频
//   · 文字修复基图（TEXT_SCENES[0]，中文远近景）→ image2fix
//
// 判定口径：PASS = HTTP 2xx **且** 端点声明的响应结构断言通过（verdict.ts）。
// 旧的「只要 200 就 PASS」会把「后端 200 但响应体缺 full_url」判成全绿 —— 已修。
// 若某条只校验了状态码，报告「断言」列会写「仅 HTTP」而不是「通过」。
//
// 用法：
//   node scripts/smoke.mjs                        # 全量（含视频，慢）
//   node scripts/smoke.mjs --skip-video           # 跳过两个视频端点，快速回归
//   node scripts/smoke.mjs --with-negative        # 追加负向用例（坏请求必须被挡下）
//   node scripts/smoke.mjs --base <url> --proxy <url> --out report.html
//
// 想完全离线跑（不需要 vite / 真实后端）：先起夹具再指向它
//   node scripts/mock-backend.mjs &
//   node scripts/smoke.mjs --base http://127.0.0.1:5189 --proxy http://127.0.0.1:5189 --skip-video --with-negative
//
// 退出码：全部通过=0；任一失败或后端不可达=1；被中断=130。
// 随时停止：Ctrl+C / SIGTERM —— 会先把已完成部分写出 report.html 再退出。
// 需要 Node >= 22.18（见下方版本守卫）。
//
// 实现要点：
//  - 长任务（视频生成，后端要跑几分钟才回响应头）用 node:http 发起，**不用 fetch**——
//    undici 有 5 分钟 headersTimeout，会在视频还没返回时直接抛 UND_ERR_HEADERS_TIMEOUT。
//  - 每个用例独立 try/catch，单点超时/异常只记 FAIL，不中断整轮。
//  - Node 内置 fetch / http 都**不**读取 HTTP_PROXY，直连 localhost 代理不受本机代理干扰。

import { writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'

// schema 单一事实来源：直接导入 src/endpoints.ts（Node >= 22.18 原生剥离类型，无需构建）。
// 低于该版本会 import 失败，所以这里先做版本守卫，再动态导入。
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18)) {
  console.error(`✗ 需要 Node >= 22.18（原生 TS 类型剥离）才能复用 src/endpoints.ts，当前 ${process.versions.node}`)
  process.exit(2)
}
const { SAMPLES, TEXT_SCENES } = await import('../src/endpoints.ts')
// 判定层与网页共用：PASS = HTTP 2xx **且** 端点声明的结构断言全过。
const { evaluate, hasAssertion } = await import('../src/verdict.ts')
// 负向用例：期望**被挡下**，且 422 的 loc 必须指对字段。
const { NEGATIVE_CASES, judgeNegative, negativePath } = await import('../src/negative.ts')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const BASE = arg('--base', 'http://117.50.108.73:8082')
const PROXY = arg('--proxy', 'http://localhost:5188')
const OUT = arg('--out', 'report.html')
const SKIP_VIDEO = !!arg('--skip-video', false)
/** 跑完正向链路后再跑一遍负向用例（坏请求必须被挡下）。 */
const WITH_NEGATIVE = !!arg('--with-negative', false)
// 单请求 socket 无活动上限（生成类要等几分钟）
const REQ_TIMEOUT = Number(arg('--timeout-ms', '1800000'))

function proxy(path, extra = {}) {
  const p = new URLSearchParams({ target: BASE, path })
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return `${PROXY}/api/proxy?${p}`
}
function fuUrl(mediaUrl) {
  const p = new URLSearchParams({ target: BASE, url: mediaUrl })
  return `${PROXY}/api/fetch-to-upload?${p}`
}

/** 用 node:http 发起请求（无 undici headersTimeout 限制）。 */
function httpCall(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const lib = u.protocol === 'https:' ? https : http
    const t0 = Date.now()
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        timeout: REQ_TIMEOUT,
      },
      (resp) => {
        const chunks = []
        resp.on('data', (c) => chunks.push(c))
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data = null
          try { data = JSON.parse(text) } catch { /* keep text */ }
          const status = resp.statusCode || 0
          resolve({ status, ok: status >= 200 && status < 300, ms: Date.now() - t0, text, data })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error(`socket 无活动超时 (${REQ_TIMEOUT}ms)`)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function call(path, { method = 'POST', json, form } = {}) {
  // multipart 上传仍走 fetch（快，用 FormData/Blob 最省事）
  if (form) {
    const t0 = Date.now()
    const res = await fetch(proxy(path), { method: 'POST', body: form })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* keep text */ }
    return { status: res.status, ok: res.ok, ms: Date.now() - t0, text, data }
  }
  const headers = {}
  let body = null
  if (json) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(json)
  }
  return httpCall(proxy(path), { method, headers, body })
}

const results = []
/** 是否被手动中断（Ctrl+C）：用于在报告里标注，并保证部分结果照样落盘。 */
let interrupted = false

/**
 * 记一行结果。判定 = 调用方自判 (`r.ok`) **且** HTTP 2xx **且** 结构断言全过。
 *
 * 三层都要，缺一层就会漏报：
 *  · 只信 `r.ok` → 后端 200 但响应体缺产物 URL 会被判 PASS（旧行为，已修）；
 *  · 只信断言 → 丢掉调用方自己的前置判断（如 fetch-to-upload 的「必须拿到 name」）。
 */
function record(id, title, r, group, note) {
  const skipped = !!r.skipped
  const v = evaluate(id, r.status ?? 0, r.data ?? null, r.text)
  const ok = !skipped && !!r.ok && v.pass
  const failures = skipped ? [] : v.failures
  const base = note ?? (r.ok ? 'OK' : String(r.text || 'fail').slice(0, 220))
  const row = {
    id,
    title,
    group: group || '—',
    ok,
    skipped,
    status: r.status ?? 0,
    ms: r.ms ?? 0,
    // 有断言失败时优先展示断言原因（比 HTTP 状态更能说明「哪里不对」）
    note: failures.length > 0 ? failures.join('；') : base,
    failures,
    asserted: hasAssertion(id),
    detail: skipped ? null : r.data ?? r.text ?? null,
  }
  results.push(row)
  const tag = row.skipped ? 'SKIP' : row.ok ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${id.padEnd(18)} HTTP ${String(row.status || '-').padStart(3)}  ${String(row.ms).padStart(6)}ms  ${row.note.slice(0, 70)}`)
  return row
}

/** 单用例隔离执行：异常只记 FAIL。返回**原始结果**（含 .data），供链路串联使用。 */
async function step(id, title, group, fn) {
  process.stdout.write(`▶ ${id} … `)
  try {
    const r = await fn()
    record(id, title, r, group)
    return r
  } catch (e) {
    const r = { ok: false, status: 0, ms: 0, text: String(e?.message || e), data: null }
    record(id, title, r, group, '异常: ' + String(e?.message || e).slice(0, 200))
    return r
  }
}

/**
 * 跑一条负向用例：故意发坏请求，期望被后端挡下。
 *
 * 与 `record()` 的判定**相反**：这里 2xx 才是失败。所以不能复用 record，
 * 只能复用报告行结构，判定走 judgeNegative。
 */
async function negativeStep(c) {
  process.stdout.write(`▶ ${c.id} … `)
  let r
  try {
    r = c.multipart
      ? await call(negativePath(c), { form: new FormData() })
      : await call(negativePath(c), { method: c.method ?? 'POST', json: c.body ?? {} })
  } catch (e) {
    r = { ok: false, status: 0, ms: 0, text: String(e?.message || e), data: null }
  }
  const outcome = judgeNegative(c, r.status ?? 0, r.data ?? null)
  const row = {
    id: c.id,
    title: c.title,
    group: '负向',
    ok: outcome.pass,
    skipped: false,
    status: r.status ?? 0,
    ms: r.ms ?? 0,
    note: outcome.pass ? outcome.note : outcome.failures.join('；'),
    failures: outcome.pass ? [] : outcome.failures,
    asserted: true,
    detail: r.data ?? r.text ?? null,
  }
  results.push(row)
  const tag = row.ok ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${c.id.padEnd(28)} HTTP ${String(row.status || '-').padStart(3)}  ${String(row.ms).padStart(6)}ms  ${row.note.slice(0, 60)}`)
  return row
}

/** 负向用例包：跑完整个 NEGATIVE_CASES 表。 */
async function runNegative() {
  console.log('\n--- 负向用例（期望被后端挡下，并精确定位到做错的字段）---')
  for (const c of NEGATIVE_CASES) await negativeStep(c)
}

// 736p 档（与 src/endpoints.ts 的 OUTPUT_SIZE 对齐）
const W = 1280
const H = 736

async function run() {
  console.log('\n=== Drama API Playground 自动测试 ===')
  console.log(`后端: ${BASE}\n代理: ${PROXY}${SKIP_VIDEO ? '  (已跳过视频)' : ''}\n`)

  // 0. 健康检查
  const health = await step('health', '健康检查', '系统', () => call('/api/v1/health', { method: 'GET' }))
  if (!health.ok) {
    record('__block', '后端不可达，后续用例跳过', { ok: false, status: health.status, ms: health.ms, text: health.text }, '系统')
    return
  }

  // 1. 文生图（角色基图，链路起点）
  const img = await step('txt2image', '文生图（角色基图）', '文生图', () =>
    call('/api/v1/generate/txt2image', { json: { prompt: SAMPLES.txt2image, width: W, height: H } }))
  const fullUrl = img.data?.full_url || img.data?.url || null

  // 2. 生成图 → 句柄（串联关键一步）
  let handle = null
  if (fullUrl) {
    process.stdout.write('▶ fetch-to-upload … ')
    try {
      const t0 = Date.now()
      const fu = await fetch(fuUrl(fullUrl), { method: 'POST' })
      const fud = await fu.json().catch(() => ({}))
      handle = fud.name || null
      record('fetch-to-upload', '生成图 → 句柄', { ok: fu.ok && !!handle, status: fu.status, ms: Date.now() - t0, text: JSON.stringify(fud), data: fud }, '工具',
        handle ? `句柄 ${handle}` : '未返回 name')
    } catch (e) {
      record('fetch-to-upload', '生成图 → 句柄', { ok: false, status: 0, ms: 0, text: String(e?.message || e), data: null }, '工具')
    }
  } else {
    record('fetch-to-upload', '生成图 → 句柄', { skipped: true, status: 0, ms: 0, text: '无 full_url 可转存' }, '工具')
  }

  // 2b. 文字修复基图：中文远近景广告牌（近景清晰 / 远景虚化）——独立于角色基图
  let fixHandle = null
  const fixImg = await step('txt2image#fix', '文生图（文字场景基图）', '文生图', () =>
    call('/api/v1/generate/txt2image', { json: { prompt: TEXT_SCENES[0].value, width: W, height: H } }))
  const fixUrl = fixImg.data?.full_url || fixImg.data?.url || null
  if (fixUrl) {
    process.stdout.write('▶ fetch-to-upload(文字场景) … ')
    try {
      const t0 = Date.now()
      const fu = await fetch(fuUrl(fixUrl), { method: 'POST' })
      const fud = await fu.json().catch(() => ({}))
      fixHandle = fud.name || null
      record('fetch-to-upload#fix', '文字场景基图 → 句柄', { ok: fu.ok && !!fixHandle, status: fu.status, ms: Date.now() - t0, text: JSON.stringify(fud), data: fud }, '工具',
        fixHandle ? `句柄 ${fixHandle}` : '未返回 name')
    } catch (e) {
      record('fetch-to-upload#fix', '文字场景基图 → 句柄', { ok: false, status: 0, ms: 0, text: String(e?.message || e), data: null }, '工具')
    }
  } else {
    record('fetch-to-upload#fix', '文字场景基图 → 句柄', { skipped: true, status: 0, ms: 0, text: '无 full_url 可转存' }, '工具')
  }

  // 3. 卡通文生图
  await step('txt2imageanime', '卡通文生图', '文生图', () =>
    call('/api/v1/generate/txt2imageanime', { json: { prompt: SAMPLES.txt2imageanime, width: W, height: H } }))

  // 4~6. 角色基图 → 图生图 / 角色四视图
  if (handle) {
    const h = handle
    await step('image2image', '图生图（用句柄）', '图生图', () =>
      call('/api/v1/generate/image2image', { json: { prompt: SAMPLES.image2image, width: W, height: H, image1: h } }))
    await step('image2character', '角色四视图', '图生图', () =>
      call('/api/v1/generate/image2character', { json: { image: h } }))
  } else {
    for (const [id, t] of [['image2image', '图生图（用句柄）'], ['image2character', '角色四视图']]) {
      record(id, t, { skipped: true, status: 0, ms: 0, text: '缺少句柄，跳过（角色基图失败）' }, '图生图')
    }
  }

  // 7. 图内文字修复（中文用例）——优先用「文字场景基图」，缺失时回退角色基图
  const fh = fixHandle ?? handle
  if (fh) {
    await step('image2fix', '图内文字修复（中文）', '图生图', () =>
      call('/api/v1/generate/image2fix', { json: { prompt: SAMPLES.image2fix, image: fh } }))
  } else {
    record('image2fix', '图内文字修复（中文）', { skipped: true, status: 0, ms: 0, text: '缺少句柄，跳过（文字场景基图失败）' }, '图生图')
  }

  // 8. 图片理解 VL（任意图皆可）
  const vh = handle ?? fixHandle
  if (vh) {
    await step('image2vl', '图片理解 VL', '工具', () =>
      call('/api/v1/generate/image2vl', { json: { filename: vh, prompt: SAMPLES.image2vlPrompt, system_prompt: SAMPLES.image2vlSystem } }))
  } else {
    record('image2vl', '图片理解 VL', { skipped: true, status: 0, ms: 0, text: '无可用句柄，跳过' }, '工具')
  }

  // 9. 提示词增强
  await step('promptEnhance', '提示词增强', '工具', () =>
    call('/api/v1/generate/image2promptenhance', { json: { prompt: SAMPLES.promptEnhance } }))

  // 10. 视频（慢）—— 用角色基图；megapixels 取 736p 档（0.9），与 src/endpoints.ts 对齐
  if (SKIP_VIDEO) {
    for (const [id, t] of [['videoFl2va', '首帧视频'], ['videoRef2va', '多参考图视频']]) {
      record(id, t, { skipped: true, status: 0, ms: 0, text: '--skip-video 已跳过' }, '图生视频')
    }
  } else if (handle) {
    const h = handle
    await step('videoFl2va', '首帧视频', '图生视频', () =>
      call('/api/v1/generate/image2videofl2va', { json: { prompt: SAMPLES.videoFl2va, aspect: '16:9', megapixels: 0.9, duration: 5, image1: h } }))
    await step('videoRef2va', '多参考图视频', '图生视频', () =>
      call('/api/v1/generate/image2videoref2va', { json: { prompt: SAMPLES.videoRef2va, aspect: '16:9', megapixels: 0.9, duration: 5, image1: h } }))
  } else {
    for (const [id, t] of [['videoFl2va', '首帧视频'], ['videoRef2va', '多参考图视频']]) {
      record(id, t, { skipped: true, status: 0, ms: 0, text: '缺少句柄，跳过' }, '图生视频')
    }
  }

  // 11. 文生音频
  await step('txt2audio', '文生音频', '工具', () =>
    call('/api/v1/generate/txt2audio', { json: { caption_prompt: SAMPLES.txt2audio, lyrics_prompt: '', duration: 5 } }))

  // 12. 上传文件（拿句柄）—— 取生成图字节走 multipart，验证上传链路
  if (fullUrl) {
    process.stdout.write('▶ upload … ')
    try {
      const bytes = await fetch(fullUrl).then((r) => r.arrayBuffer())
      const fd = new FormData()
      fd.append('file', new Blob([bytes], { type: 'image/png' }), 'smoke.png')
      const up = await call('/api/v1/generate/upload', { form: fd })
      record('upload', '上传文件（拿句柄）', up, '工具', up.data?.name ? `name=${up.data.name}` : undefined)
    } catch (e) {
      record('upload', '上传文件（拿句柄）', { ok: false, status: 0, ms: 0, text: String(e?.message || e), data: null }, '工具')
    }
  } else {
    record('upload', '上传文件（拿句柄）', { skipped: true, status: 0, ms: 0, text: '无图可上传，跳过' }, '工具')
  }

  // 13. 负向用例：正向全绿只说明「好请求能跑通」，坏请求是否被挡住是另一回事
  if (WITH_NEGATIVE) await runNegative()
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function renderHtml(wasInterrupted = false) {
  const total = results.length
  const passed = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => !r.ok && !r.skipped).length
  const now = new Date().toLocaleString('zh-CN')
  const rows = results.map((r) => {
    const detail = r.detail === null ? '' :
      `<details style="margin-top:6px"><summary style="cursor:pointer;color:#9aa0a8;font-size:11px">响应体</summary><pre style="white-space:pre-wrap;word-break:break-all;background:#15161a;border:1px solid #35373c;border-radius:6px;padding:8px;font-size:11px;max-height:240px;overflow:auto">${esc(typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail, null, 2))}</pre></details>`
    const cls = r.skipped ? 'skip' : r.ok ? 'ok' : 'fail'
    const tag = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'
    // 断言列：区分「结构已验证」与「只看了 HTTP」——后者不该被当成验证过。
    const assertCell = r.skipped
      ? '—'
      : r.failures.length > 0
        ? `<span style="color:#ff6b6b">失败 ${r.failures.length}</span>`
        : r.asserted
          ? '<span style="color:#57c79a">通过</span>'
          : '<span style="color:#9aa0a8">仅 HTTP</span>'
    return `<tr class="${cls}">
      <td>${esc(r.group)}</td>
      <td><code>${esc(r.id)}</code></td>
      <td>${esc(r.title)}</td>
      <td class="st">${r.status || '—'}</td>
      <td class="st">${r.ms}ms</td>
      <td class="st">${tag}</td>
      <td class="st">${assertCell}</td>
      <td>${esc(r.note)}</td>
      <td>${detail}</td>
    </tr>`
  }).join('')
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drama API Playground · 测试报告</title>
<style>
  :root{--bg:#1b1b1d;--panel:#232427;--border:#35373c;--text:#e3e4e6;--dim:#9aa0a8;--ok:#57c79a;--fail:#ff6b6b;--accent:#4ea1ff}
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;padding:24px;font-size:13px}
  h1{font-size:18px;margin:0 0 4px}
  .meta{color:var(--dim);font-size:12px;margin-bottom:16px}
  .summary{display:flex;gap:12px;margin-bottom:18px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 20px;min-width:110px}
  .card .n{font-size:24px;font-weight:700}
  .card .l{color:var(--dim);font-size:12px;margin-top:2px}
  .card.total .n{color:var(--accent)} .card.pass .n{color:var(--ok)} .card.fail .n{color:var(--fail)} .card.skip .n{color:var(--warn,#f0b54a)}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--border);vertical-align:top}
  th{background:#2a2c30;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  tr.fail{background:rgba(255,107,107,.06)}
  tr.skip{background:rgba(240,181,74,.06)}
  code{font-family:ui-monospace,monospace;font-size:12px;color:var(--accent)}
  .st{font-family:ui-monospace,monospace;white-space:nowrap}
  tbody tr td:nth-child(6){font-weight:700}
  tr.ok td:nth-child(6){color:var(--ok)} tr.fail td:nth-child(6){color:var(--fail)} tr.skip td:nth-child(6){color:#f0b54a}
  .banner{margin:0 0 16px;padding:10px 14px;border-radius:8px;background:rgba(240,181,74,.12);border:1px solid rgba(240,181,74,.4);color:#f0b54a}
</style></head><body>
<h1>Drama API Playground · 接口测试报告</h1>
<div class="meta">生成时间：${now} · 后端 ${esc(BASE)} · 代理 ${esc(PROXY)}${SKIP_VIDEO ? ' · 已跳过视频' : ''}<br>
判定口径：PASS = HTTP 2xx <b>且</b> 响应结构断言通过（断言声明见 <code>src/endpoints.ts</code> 的 <code>EndpointDef.expect</code>）。
「断言」列为「仅 HTTP」表示该条只校验了状态码，不代表响应结构已验证。</div>
${wasInterrupted ? '<div class="banner">⏹ 本次运行被手动中断（Ctrl+C / SIGTERM），下表只包含已跑完的用例。</div>' : ''}
<div class="summary">
  <div class="card total"><div class="n">${total}</div><div class="l">总用例</div></div>
  <div class="card pass"><div class="n">${passed}</div><div class="l">通过</div></div>
  <div class="card fail"><div class="n">${failed}</div><div class="l">失败</div></div>
  <div class="card skip"><div class="n">${skipped}</div><div class="l">跳过</div></div>
</div>
<table>
  <thead><tr><th>分组</th><th>接口</th><th>说明</th><th>HTTP</th><th>耗时</th><th>结果</th><th>断言</th><th>摘要</th><th>响应</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`
}

/** 收尾：统计 → 落盘报告 → 退出。被中断时也走这里，保证已完成部分不丢。 */
function finish(code) {
  const passed = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => !r.ok && !r.skipped).length
  // 断言失败单列：它是「HTTP 成功但结果不可用」这一类静默故障，值得单独可见。
  const assertFails = results.filter((r) => r.failures && r.failures.length > 0)
  const weakRows = results.filter((r) => !r.skipped && !r.asserted && r.ok)
  writeFileSync(OUT, renderHtml(interrupted), 'utf8')
  console.log('\n=== 汇总 ===')
  if (interrupted) console.log(`⏹ 已手动中断 —— 报告只含已跑完的 ${results.length} 个用例`)
  console.log(`用例 ${results.length}  通过 ${passed}  失败 ${failed}  跳过 ${skipped}`)
  if (assertFails.length > 0) {
    console.log(`⚠️ 其中 ${assertFails.length} 条是「HTTP 成功但响应结构不符预期」：`)
    for (const r of assertFails) console.log(`   · ${r.id} (HTTP ${r.status}) — ${r.note}`)
  }
  if (weakRows.length > 0) {
    console.log(`ℹ️ ${weakRows.length} 条只校验了 HTTP 状态（未声明结构断言）：${weakRows.map((r) => r.id).join(', ')}`)
  }
  console.log(`报告已生成: ${OUT}`)
  process.exit(code)
}

// 「随时停止」：Ctrl+C / SIGTERM 时先把已完成部分写出报告再退出（再按一次强制退出）
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) process.exit(130)
    interrupted = true
    console.log(`\n⏹ 收到 ${sig}，正在写出已完成部分的报告…（再按一次 Ctrl+C 强制退出）`)
    finish(130)
  })
}

await run()
finish(results.some((r) => !r.ok && !r.skipped) ? 1 : 0)
