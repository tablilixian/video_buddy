#!/usr/bin/env node
/**
 * image2fix（Boogu 文字修复）端点探针（CV-202，探针先行惯例同 CV-192）。
 *
 * 覆盖四个问题
 * ------------
 *   1. 端点可用性：txt2image 出一张带文字的海报 → image2fix 修文字 → 200 + boogu_edit_*.png？
 *   2. 产物名直用对照：Krea2 产物名（krea2_*.png）直接作 image2fix 的 image 入参是否 500（CV-155 两类 filename 纪律复证）
 *   3. boogu 产物名可消费性：boogu_edit_*.png 直接作 image2vl 的 image 入参是否 500；换句柄后能否被消费
 *   4. 修复效果：image2vl 读修复后图的标题文字，验证确实改对了
 *
 * 修复 prompt 纪律（后端同事交代，本探针即按此发）：只写「文字」那部分描述。
 *
 * 用法
 * ----
 *   node scripts/probe-image2fix.mjs
 *   node scripts/probe-image2fix.mjs --out docs/api-probe/image2fix-<日期>
 *
 * 注：本机 Bash 沙箱会拦截 117.50.108.73:8082，须在沙箱外运行；全程串行。
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

const OUT_DIR = resolve(arg('out', `docs/api-probe/image2fix-${Date.now()}`))
const TIMEOUT_MS = Number(arg('timeout', 300_000))
const COOLDOWN = Number(arg('cooldown', 800))

// ---------------------------------------------------------------- HTTP 基元

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
    // agent:false = 每请求独立 TCP 连接。默认 keep-alive 复用会在「1MB /view 大响应后立刻 POST」时
    // 撞上服务端已关闭的连接，1ms 即 ERR socket hang up（实测踩坑，见 CV-202 探针记录）。
    const r = http.request(
      { hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, headers: h, agent: false },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          done({ status: res.statusCode ?? 0, ms: Date.now() - started, text: buf.toString('utf8'), buf })
        })
      },
    )
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

function upload(filename, buf, mime = 'image/png') {
  const boundary = `----probe${randomUUID().replace(/-/g, '')}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return req('POST', '/api/v1/generate/upload', {
    raw: Buffer.concat([head, buf, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  })
}

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
  console.log(`  ${String(rec.status || '—').padEnd(4)} ${rec.ms.toString().padStart(7)}ms  ${id.padEnd(38)} ${rec.text.replace(/\s+/g, ' ').slice(0, 110)}`)
  if (COOLDOWN > 0) await sleep(COOLDOWN)
  return rec
}

const jparse = (t) => { try { return JSON.parse(t) } catch { return null } }

// ---------------------------------------------------------------- 主流程

console.log(`→ image2fix 探针  base=${BASE}`)
const healthPre = await req('GET', '/api/v1/health')
console.log(`  健康检查(pre): ${healthPre.status} ${healthPre.text.slice(0, 70)}`)
if (healthPre.status === 0) {
  console.error(`✗ 后端不可达（${healthPre.text}）。若在沙箱内运行，请重试。`)
  process.exit(1)
}

// 生成一张带「错字」的海报（标题故意写成 SALLE，供 image2fix 修正为 SALE）。
// 生成 prompt 按图文类出图规范给出确切文本；修复 prompt 只取文字部分（后端同事纪律）。
const POSTER_PROMPT =
  '商业海报设计，纯色背景，把标题文字 "SUMMER SALLE 50% OFF" 以粗体无衬线大写居中排布在画面上方，' +
  '留白充足，扁平矢量插画风格，高细节成品级质感'

console.log('\n[1] txt2image 出带文字海报')
const gen = await runCase('txt2image.poster', 'Krea2 Turbo 海报（标题含 SALLE 错字）', () => postJson('/api/v1/generate/txt2image', { prompt: POSTER_PROMPT, width: 1024, height: 1024 }))
const genData = jparse(gen.text)
const productName = genData?.filename ?? null
const productUrl = genData?.full_url ?? null
if (!productName) {
  console.error('✗ 未取到产物文件名，中止')
  process.exit(1)
}
console.log(`  → 产物名: ${productName}`)

console.log('\n[2] 产物名直用作 image2fix 入参（CV-155 可消费性对照，预期快失败）')
const direct = await runCase('image2fix.direct-product-name', `image=${productName}（不换句柄）`, () =>
  postJson('/api/v1/generate/image2fix', {
    prompt: '把标题文字 "SUMMER SALLE" 改成 "SUMMER SALE"，保持字体风格、大小、颜色与位置不变',
    image: productName,
  }),
)

console.log('\n[3] 产物字节经 upload 换句柄 → image2fix 修复')
const view = await req('GET', `/view?filename=${encodeURIComponent(productName)}`)
console.log(`  /view 回读产物: ${view.status} ${(view.text.length / 1024).toFixed(1)}KB(textLen)`)
if (view.status !== 200) {
  console.error('✗ 产物回读失败，中止')
  process.exit(1)
}
const productBytes = view.buf ?? Buffer.from(view.text, 'binary')
const upName = `ref-${randomUUID().slice(0, 8)}.png`
const up = await runCase(`upload.${upName}`, `上传产物字节（${(productBytes.length / 1024).toFixed(1)}KB）`, () => upload(upName, productBytes))
const handle = jparse(up.text)?.name ?? null
console.log(`  → 句柄: ${handle ?? '（未取到）'}`)
if (!handle) process.exit(1)

const FIX_PROMPT = '把标题文字 "SUMMER SALLE" 改成 "SUMMER SALE"，保持字体风格、大小、颜色与位置不变'
const fix = await runCase('image2fix.fix', '修复 prompt 只含文字部分（后端同事纪律）', () =>
  postJson('/api/v1/generate/image2fix', { prompt: FIX_PROMPT, image: handle }),
)
const fixData = jparse(fix.text)
const booguName = fixData?.filename ?? null
console.log(`  → 修复产物: ${booguName ?? '（未取到）'}  duration=${fixData?.duration ?? '—'}`)

if (booguName) {
  console.log('\n[4] boogu 产物名可消费性（直用 image2vl 对照 + 换句柄验证）')
  await runCase('image2vl.direct-boogu-name', `image=${booguName}（不换句柄，CV-155 对照）`, () =>
    postJson('/api/v1/generate/image2vl', {
      system_prompt: 'You are a helpful assistant.',
      prompt: 'Read the title text in the image exactly. Output only the text.',
      image: booguName,
    }),
  )
  const vBoogu = await req('GET', `/view?filename=${encodeURIComponent(booguName)}`)
  console.log(`  /view 回读修复产物: ${vBoogu.status} ${(vBoogu.text.length / 1024).toFixed(1)}KB(textLen)`)
  if (vBoogu.status === 200) {
    const booguBytes = vBoogu.buf ?? Buffer.from(vBoogu.text, 'binary')
    const up2Name = `ref-${randomUUID().slice(0, 8)}.png`
    const up2 = await runCase(`upload.${up2Name}`, `上传修复产物字节（${(booguBytes.length / 1024).toFixed(1)}KB）`, () => upload(up2Name, booguBytes))
    const handle2 = jparse(up2.text)?.name ?? null
    if (handle2) {
      await runCase('image2vl.verify-fixed-text', 'image2vl 读修复后标题（验证 SALLE→SALE）', () =>
        postJson('/api/v1/generate/image2vl', {
          system_prompt: 'You are a helpful assistant.',
          prompt: 'Read the title text in the image exactly. Output only the text.',
          image: handle2,
        }),
      )
    }
  }
}

const healthPost = await req('GET', '/api/v1/health')
console.log(`\n  健康检查(post): ${healthPost.status} ${healthPost.text.slice(0, 70)}`)

// ---------------------------------------------------------------- 报告

const verdict = (r) => {
  if (r.status === 200) return '✅ 200'
  if (r.status === 422) return '⚠️ 422'
  if (r.status >= 500 && r.ms < 2000) return '❌ 500 快失败（入口/读取阶段）'
  if (r.status >= 500) return '❌ 500 慢失败（生成中崩）'
  if (r.status === 0) return `⏱ ${r.text.slice(0, 40)}`
  return `? ${r.status}`
}

const md = []
md.push('# image2fix（Boogu 文字修复）端点探针（CV-202）')
md.push('')
md.push(`- 后端：\`${BASE}\`（health pre ${healthPre.status} / post ${healthPost.status}）`)
md.push(`- 时间：${new Date().toLocaleString('zh-CN')} · 全程串行（后端单任务同步）`)
md.push(`- 生成 prompt（海报，标题故意含错字 SALLE）：\`${POSTER_PROMPT}\``)
md.push(`- 修复 prompt（**只含文字部分**，后端同事纪律）：\`${FIX_PROMPT}\``)
md.push('')
md.push('## 实测记录')
md.push('')
md.push('| # | 用例 | HTTP | 耗时 | 判定 | 响应摘要 |')
md.push('| --- | --- | ---: | ---: | --- | --- |')
for (const r of results) {
  md.push(`| ${r.id} | ${r.title} | ${r.status || '—'} | ${r.ms}ms | ${verdict(r)} | ${r.text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 100)} |`)
}
md.push('')
md.push('## 结论')
md.push('')
md.push(`- 端点可用性：image2fix ${fix.status === 200 ? '✅ 200' : `❌ ${fix.status}`}（响应 ${fix.text.replace(/\s+/g, ' ').slice(0, 200)}）`)
md.push(`- 产物名直用对照：Krea2 产物名作 image 入参 → ${direct.status}（${verdict(direct)}）；boogu 产物名作 image2vl 入参 → ${results.find((r) => r.id === 'image2vl.direct-boogu-name')?.status ?? '未跑'}`)
md.push(`- 修复产物前缀：\`${booguName ?? '—'}\`（预期 boogu_edit_*）`)
md.push(`- 文字修复效果：见 image2vl.verify-fixed-text 输出（人工核对 SALLE → SALE）`)
md.push('')
md.push('## 原始响应')
md.push('')
md.push('```json')
md.push(JSON.stringify(results.map(({ text, ...rest }) => ({ ...rest, text: text.slice(0, 400) })), null, 2))
md.push('```')
md.push('')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'report.md'), md.join('\n'))
writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), productName, productUrl, booguName, results }, null, 2))

console.log(`\n✓ 探针完成 → ${OUT_DIR}`)
console.log(`  ${join(OUT_DIR, 'report.md')}`)
