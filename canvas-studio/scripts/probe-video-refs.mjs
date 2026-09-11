#!/usr/bin/env node
/**
 * 视频类带文件端点补验 + image2videomsr 参数语义诊断（严格串行）。
 *
 * 补 `probe-generated-refs.mjs` 的缺口：第二张生成图上传时 socket hang up，
 * 三个视频端点被跳过。本脚本复用已下载到本地的产物（不重新生成）重跑。
 *
 * 用法
 * ----
 *   node scripts/probe-video-refs.mjs
 *   node scripts/probe-video-refs.mjs --image <本地图片路径>
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return fallback
  return v
}

const OUT_DIR = resolve(arg('out', `docs/api-probe/video-refs-${Date.now()}`))
const TIMEOUT_MS = Number(arg('timeout', 400_000))
const COOLDOWN = Number(arg('cooldown', 600))
const IMAGE_PATH = resolve(arg('image', 'docs/api-probe/generated-refs-20260910/assets/frame-z-image_00840_.png'))

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
    r.setTimeout(timeout, () => { r.destroy(); done({ status: 0, ms: Date.now() - started, text: `TIMEOUT after ${timeout}ms` }) })
    r.on('error', (e) => done({ status: 0, ms: Date.now() - started, text: `ERR ${e.message}` }))
    if (payload !== undefined) r.write(payload)
    r.end()
  })
}

const postJson = (path, body) => req('POST', path, { json: body })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** multipart 上传：大文件偶发 socket hang up，故带重试。 */
function uploadOnce(filename, buf, mime = 'image/png') {
  const boundary = `----probe${randomUUID().replace(/-/g, '')}`
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return req('POST', '/api/v1/generate/upload', {
    raw: Buffer.concat([head, buf, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, connection: 'close' },
    timeout: 60_000,
  })
}

const results = []
async function runCase(id, title, fn) {
  const started = Date.now()
  let out
  try { out = await fn() } catch (e) { out = { status: 0, ms: Date.now() - started, text: `THROW ${e.message}` } }
  const rec = { id, title, ...out, at: new Date().toISOString() }
  results.push(rec)
  console.log(`  ${String(rec.status || '—').padEnd(4)} ${rec.ms.toString().padStart(7)}ms  ${id.padEnd(32)} ${rec.text.replace(/\s+/g, ' ').slice(0, 100)}`)
  if (COOLDOWN > 0) await sleep(COOLDOWN)
  return rec
}

console.log(`→ 视频端点补验  base=${BASE}`)
const health = await req('GET', '/api/v1/health')
console.log(`  健康检查: ${health.status} ${health.text.slice(0, 60)}`)
if (health.status === 0) { console.error(`✗ 后端不可达（${health.text}）`); process.exit(1) }

if (!existsSync(IMAGE_PATH)) { console.error(`✗ 找不到图片 ${IMAGE_PATH}`); process.exit(1) }
const buf = readFileSync(IMAGE_PATH)
console.log(`  测试素材: ${IMAGE_PATH}  ${(buf.length / 1024).toFixed(0)}KB`)

mkdirSync(OUT_DIR, { recursive: true })

console.log('\n[1] 上传（带重试，规避大文件 socket hang up）')
let handle = null
for (let i = 1; i <= 3; i += 1) {
  const name = `ref-vid-${randomUUID().slice(0, 8)}.png`
  const up = await runCase(`upload.try${i}`, `上传 ${name}`, () => uploadOnce(name, buf))
  try { handle = JSON.parse(up.text).name ?? null } catch { handle = null }
  if (handle) { console.log(`  → 句柄: ${handle}`); break }
  console.log(`  → 第 ${i} 次失败，重试…`)
  await sleep(1500)
}
if (!handle) { console.error('✗ 上传三次均失败，终止'); process.exit(1) }

console.log('\n[2] 视频类带文件端点（串行）')
const table = []

const videoCases = [
  { key: 'image2videofl2va', path: '/api/v1/generate/image2videofl2va', body: () => ({ prompt: 'the man walks forward through the rainy neon street, camera slowly pushes in', duration: 5, image1: handle }) },
  { key: 'image2videoref2va', path: '/api/v1/generate/image2videoref2va', body: () => ({ prompt: 'the man walks forward through the rainy neon street, camera slowly pushes in', duration: 5, image1: handle }) },
  { key: 'image2videomkr', path: '/api/v1/generate/image2videomkr', body: () => ({ prompt: 'the man walks forward through the rainy neon street, camera slowly pushes in', images: [{ image: handle, frame_index: 0 }] }) },
]
for (const c of videoCases) {
  console.log(`\n  ── ${c.key}`)
  const rec = await runCase(`${c.key}.real`, '带真实生成素材', () => postJson(c.path, c.body()))
  table.push({ endpoint: c.key, variant: 'real', status: rec.status, ms: rec.ms, text: rec.text.slice(0, 400) })
}

console.log('\n[3] image2videomsr 参数语义诊断（required = prompt, background）')
const msrVariants = [
  { label: 'A background="white" 无图', body: { prompt: 'a cat walking', background: 'white' } },
  { label: 'B background=句柄（当文件）', body: { prompt: 'a cat walking', background: handle, image1: handle } },
  { label: 'C background=描述串 + image1', body: { prompt: 'a cat walking', background: 'a clean white studio wall', image1: handle } },
  { label: 'D background="white" + image1+image2', body: { prompt: 'a cat walking', background: 'white', image1: handle, image2: handle } },
  { label: 'E 只 prompt（删 background）', body: { prompt: 'a cat walking' } },
]
for (const v of msrVariants) {
  const rec = await runCase(`image2videomsr.${v.label.split(' ')[0]}`, v.label, () => postJson('/api/v1/generate/image2videomsr', v.body))
  table.push({ endpoint: 'image2videomsr', variant: v.label, status: rec.status, ms: rec.ms, text: rec.text.slice(0, 300) })
}

const verdict = (r) => {
  if (r.status === 200) return '✅ 成功'
  if (r.status === 422) return '⚠️ 入参被拒(422)'
  if (r.status >= 500 && r.ms < 2000) return '❌ 500 快失败(入口/读取阶段)'
  if (r.status >= 500) return '❌ 500 慢失败(生成中崩)'
  return `? ${r.status} ${r.text.slice(0, 40)}`
}

const md = []
md.push('# 视频类带文件端点补验 + image2videomsr 参数诊断')
md.push('')
md.push(`- 后端：\`${BASE}\`（健康检查 ${health.status}） · 时间：${new Date().toLocaleString('zh-CN')} · 全程串行`)
md.push(`- 测试素材：\`${IMAGE_PATH}\`（${(buf.length / 1024).toFixed(0)}KB） · 上传句柄：\`${handle}\``)
md.push('')
md.push('| 端点 | 变体 | HTTP | 耗时 | 判定 | 响应摘要 |')
md.push('| --- | --- | ---: | ---: | --- | --- |')
for (const r of table) md.push(`| \`${r.endpoint}\` | ${r.variant} | ${r.status || '—'} | ${r.ms}ms | ${verdict(r)} | ${r.text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 110)} |`)
md.push('')
md.push('## 原始响应')
md.push('')
md.push('```json')
md.push(JSON.stringify(table, null, 2))
md.push('```')
md.push('')

writeFileSync(join(OUT_DIR, 'recheck.md'), md.join('\n'))
writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), handle, table }, null, 2))

console.log(`\n✓ 完成 → ${OUT_DIR}`)
