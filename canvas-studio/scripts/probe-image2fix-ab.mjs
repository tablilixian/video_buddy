#!/usr/bin/env node
/**
 * CV-218 / D6：image2fix 修复 prompt 形态的**真机 A/B 对照**。
 *
 * 目的
 * ----
 * 验证「原 prompt 直通（文字规格段）」是否真的优于「字符清单」。用**同一张真实原图**
 * （北京书市「武侠」竖幡，`dada55f4`，原始渲染错字）与**同一个上传句柄**，串行跑两次：
 *
 *   A = 旧模板：只给字符清单（历史节点 `645c7b0d` 实际发出过的 prompt）
 *   B = 新逻辑：`buildTextFixPrompt(原 prompt)` 抽出的文字规格段 + 逐字约束段
 *
 * A 的产出（`武仔`→`武传` 仍错 + 凭空多出两处「武侠」）是既有的反证；本探针重跑一次
 * 以对齐同一时间窗口，再与 B 对照。
 *
 * 用法
 * ----
 *   node scripts/probe-image2fix-ab.mjs --out docs/api-probe/image2fix-20260920-ab
 *
 * 注：全程串行（后端同步单任务，CV-215）；每用例前后 health 夹心。
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildTextFixPrompt, extractTextSpec, shouldAutoFixText } from '../lib/text-detection.js'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const CANVAS = resolve(
  process.env.CANVAS_PATH ??
    `${process.env.HOME}/Desktop/job/VideoOut/newOut/projects/北京书市/canvas.json`,
)
const OUT_DIR = resolve(arg('out', `docs/api-probe/image2fix-ab-${Date.now()}`))
const TIMEOUT_MS = Number(arg('timeout', 420_000))
const COOLDOWN = Number(arg('cooldown', 1200))
/**
 * 复用上一轮的上传句柄，跳过 17s 上传 —— 复跑同一条对照只看两次生成时用这个。
 * 产物文件名加 `--tag` 后缀，避免覆盖上一轮（同目录可直接横向比较多轮）。
 */
const REUSE_HANDLE = arg('handle', '')
const TAG = arg('tag', '')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return fallback
  return v
}

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
    // agent:false —— keep-alive 复用在「大响应后立刻 POST」会 1ms socket hang up（CV-202 踩坑）
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
const jparse = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

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
  console.log(`  ${String(rec.status || '—').padEnd(4)} ${rec.ms.toString().padStart(7)}ms  ${id.padEnd(24)} ${rec.text.replace(/\s+/g, ' ').slice(0, 110)}`)
  if (COOLDOWN > 0) await sleep(COOLDOWN)
  return rec
}

// ---------------------------------------------------------------- 取真实素材

console.log(`→ CV-218 A/B 探针  base=${BASE}`)
const canvas = JSON.parse(readFileSync(CANVAS, 'utf8'))
const originalNode = canvas.nodes.find((n) => n.id.startsWith('dada55f4'))
const legacyFixNode = canvas.nodes.find((n) => n.id.startsWith('645c7b0d'))
if (!originalNode || !legacyFixNode) {
  console.error('✗ 画布里找不到 dada55f4 / 645c7b0d，无法对照')
  process.exit(1)
}
const originalPrompt = JSON.parse(originalNode.generationPrompt).prompt
const legacyPrompt = JSON.parse(legacyFixNode.generationPrompt).prompt
const originalPng = readFileSync(resolve(CANVAS, '..', 'assets', `${originalNode.id}.png`))

const spec = extractTextSpec(originalPrompt)
const decision = shouldAutoFixText(originalPrompt)
const newPrompt = buildTextFixPrompt(originalPrompt)

console.log(`  原图：${(originalPng.length / 1024).toFixed(1)}KB  ${originalNode.id}`)
console.log(`  原 prompt 抽出：specLines=${spec.specLines.length} constraintLines=${spec.constraintLines.length} needsFix=${decision.needsFix}`)
console.log(`\n  A（旧模板）prompt:\n${legacyPrompt.split('\n').map((l) => '    ' + l).join('\n')}`)
console.log(`\n  B（新逻辑）prompt:\n${newPrompt.split('\n').map((l) => '    ' + l).join('\n')}\n`)

const healthPre = await req('GET', '/api/v1/health')
console.log(`  健康检查(pre): ${healthPre.status} ${healthPre.text.slice(0, 70)}`)
if (healthPre.status === 0) {
  console.error(`✗ 后端不可达（${healthPre.text}）`)
  process.exit(1)
}

// ---------------------------------------------------------------- 上传原图

const upName = `ref-${randomUUID().slice(0, 8)}.png`
let handle = REUSE_HANDLE
if (handle !== '') {
  console.log(`  → 复用句柄（跳过上传）: ${handle}`)
} else {
  const up = await runCase('upload.original', `上传真实原图字节（${(originalPng.length / 1024).toFixed(1)}KB）`, () =>
    upload(upName, originalPng),
  )
  handle = jparse(up.text)?.name ?? null
  console.log(`  → 句柄: ${handle ?? '（未取到）'}`)
}
if (!handle) process.exit(1)

// ---------------------------------------------------------------- A / B 对照

/** 下载产物字节并落盘，返回本地文件名。 */
async function fetchProduct(name, saveAs) {
  const v = await req('GET', `/view?filename=${encodeURIComponent(name)}`)
  if (v.status !== 200) return null
  const bytes = v.buf ?? Buffer.from(v.text, 'binary')
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, saveAs), bytes)
  return bytes.length
}

const A = await runCase('A.legacy-charlist', '旧模板：只给字符清单', () =>
  postJson('/api/v1/generate/image2fix', { prompt: legacyPrompt, image: handle }),
)
const aName = jparse(A.text)?.filename ?? null
const aBytes = aName ? await fetchProduct(aName, `A-legacy-charlist${TAG}.png`) : null
console.log(`  → A 产物: ${aName ?? '（未取到）'}  落盘 ${aBytes ? `${(aBytes / 1024).toFixed(1)}KB` : '—'}`)

const B = await runCase('B.newtextspec', '新逻辑：文字规格段 + 逐字约束段', () =>
  postJson('/api/v1/generate/image2fix', { prompt: newPrompt, image: handle }),
)
const bName = jparse(B.text)?.filename ?? null
const bBytes = bName ? await fetchProduct(bName, `B-newtextspec${TAG}.png`) : null
console.log(`  → B 产物: ${bName ?? '（未取到）'}  落盘 ${bBytes ? `${(bBytes / 1024).toFixed(1)}KB` : '—'}`)

const healthPost = await req('GET', '/api/v1/health')
console.log(`\n  健康检查(post): ${healthPost.status} ${healthPost.text.slice(0, 70)}`)

// ---------------------------------------------------------------- 报告

const verdict = (r) => (r.status === 200 ? '✅ 200' : r.status === 0 ? `⏱ ${r.text.slice(0, 40)}` : `❌ ${r.status}`)

const md = []
md.push('# CV-218 / D6：image2fix 修复 prompt 形态的**真机 A/B 对照**')
md.push('')
md.push(`- 后端：\`${BASE}\`（health pre ${healthPre.status} / post ${healthPost.status}）`)
md.push(`- 时间：${new Date().toLocaleString('zh-CN')} · 全程串行（后端同步单任务）`)
md.push(`- 原图：北京书市「武侠」竖幡 \`${originalNode.id}\`（${(originalPng.length / 1024).toFixed(1)}KB，原始渲染含错字）`)
md.push(`- 上传句柄：\`${handle}\`（A / B 共用同一句柄，排除素材差异）`)
md.push('')
md.push('## 两次发出的修复 prompt')
md.push('')
md.push('**A（旧模板，字符清单）**')
md.push('')
md.push('```')
md.push(legacyPrompt)
md.push('```')
md.push('')
md.push('**B（新逻辑，原 prompt 直通）**')
md.push('')
md.push('```')
md.push(newPrompt)
md.push('```')
md.push('')
md.push('## 实测记录')
md.push('')
md.push('| # | 用例 | HTTP | 耗时 | 判定 | 产物 |')
md.push('| --- | --- | ---: | ---: | --- | --- |')
for (const r of results) {
  const product = r.id.startsWith('A.') ? aName : r.id.startsWith('B.') ? bName : '—'
  md.push(`| ${r.id} | ${r.title} | ${r.status || '—'} | ${r.ms}ms | ${verdict(r)} | \`${product ?? '—'}\` |`)
}
md.push('')
md.push('## 结论')
md.push('')
md.push('- **人工看图判定**（对照图 A / B 已落盘同目录）：')
md.push('  - A 旧模板：竖幡文字是否仍错？是否凭空多出文字？曝光是否漂移？')
md.push('  - B 新逻辑：竖幡文字是否改对？是否保持不新增文字？')
md.push(`- A 耗时 ${A.ms}ms / B 耗时 ${B.ms}ms`)
md.push('')
md.push('## 原始响应')
md.push('')
md.push('```json')
md.push(JSON.stringify(results.map(({ buf, text, ...rest }) => ({ ...rest, text: text.slice(0, 400) })), null, 2))
md.push('```')
md.push('')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, `report${TAG}.md`), md.join('\n'))
writeFileSync(
  join(OUT_DIR, `raw${TAG}.json`),
  JSON.stringify(
    {
      base: BASE,
      at: new Date().toISOString(),
      originalNode: originalNode.id,
      originalPrompt,
      legacyPrompt,
      newPrompt,
      handle,
      aName,
      bName,
      results: results.map(({ buf, ...rest }) => rest),
    },
    null,
    2,
  ),
)

console.log(`\n✓ 探针完成 → ${OUT_DIR}`)
