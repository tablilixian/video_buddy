#!/usr/bin/env node
/**
 * 用「文生图产出的有意义素材」复验带文件端点（严格串行）。
 *
 * 为什么需要它
 * ------------
 * 之前的探测用 1×1 像素的图当参考图 → 后端一律 500，被误判成「带文件端点全挂」。
 * 用真实尺寸的照片复验后结论被推翻。本脚本进一步贴住生产形态：
 *   txt2image 生成有意义的素材（角色三视图 / 电影感单帧）
 *     → 从 full_url 下载到本地
 *     → 上传回后端拿 ref-<uuid> 句柄（生产同款流程）
 *     → 用该句柄调用带文件端点
 *
 * 用法
 * ----
 *   node scripts/probe-generated-refs.mjs
 *   node scripts/probe-generated-refs.mjs --only image2character,image2videofl2va
 *   node scripts/probe-generated-refs.mjs --out docs/api-probe/generated-refs-<日期>
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

const OUT_DIR = resolve(arg('out', `docs/api-probe/generated-refs-${Date.now()}`))
const TIMEOUT_MS = Number(arg('timeout', 300_000))
const COOLDOWN = Number(arg('cooldown', 600))
const ONLY = arg('only', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null

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

function download(url, dest) {
  return new Promise((done, fail) => {
    http.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); fail(new Error(`HTTP ${res.statusCode}`)); return }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => { const b = Buffer.concat(chunks); writeFileSync(dest, b); done(b) })
    }).on('error', fail)
  })
}

function upload(filename, buf, mime = 'image/png') {
  const boundary = `----probe${randomUUID().replace(/-/g, '')}`
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return req('POST', '/api/v1/generate/upload', {
    raw: Buffer.concat([head, buf, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  })
}

function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: 'png' }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), fmt: 'jpeg' }
      i += 2 + len
    }
  }
  return null
}

// ---------------------------------------------------------------- 测试素材（文生图生成）

const SEEDS = [
  {
    key: 'sheet',
    label: '角色三视图（正/侧/背）',
    prompt:
      'character turnaround reference sheet: three full-body views of the same young man in a dark blue trench coat standing in neutral pose - front view, side view and back view side by side, identical outfit and hairstyle across views, clean light gray studio background, game character design sheet, sharp detail',
    width: 1024,
    height: 768,
  },
  {
    key: 'frame',
    label: '电影感单帧（图生视频首帧）',
    prompt:
      'cinematic medium shot of a young man in a dark blue trench coat walking through a neon-lit rainy city street at night, wet asphalt with colorful reflections, shallow depth of field, moody film still, 35mm',
    width: 1024,
    height: 768,
  },
]

// ---------------------------------------------------------------- 待验端点

const ENDPOINTS = [
  { key: 'image2vl', path: '/api/v1/generate/image2vl', field: 'image', body: { system_prompt: 'You are a helpful assistant.', prompt: 'Describe this image in two short sentences.' } },
  { key: 'image2image', path: '/api/v1/generate/image2image', field: 'image1', body: { prompt: 'turn it into a watercolor painting' } },
  { key: 'image2character', path: '/api/v1/generate/image2character', field: 'image', body: {} },
  { key: 'image2videofl2va', path: '/api/v1/generate/image2videofl2va', field: 'image1', ref: 'frame', body: { prompt: 'the man walks forward, camera slowly pushes in', duration: 5 } },
  { key: 'image2videoref2va', path: '/api/v1/generate/image2videoref2va', field: 'image1', ref: 'frame', body: { prompt: 'the man walks forward, camera slowly pushes in', duration: 5 } },
  {
    key: 'image2videomkr',
    path: '/api/v1/generate/image2videomkr',
    field: 'images',
    ref: 'frame',
    objectArray: true, // ImageFrameItem{image, frame_index}
    body: { prompt: 'the man walks forward, camera slowly pushes in' },
  },
]

// ---------------------------------------------------------------- 主流程

const results = []
async function runCase(id, title, fn) {
  const started = Date.now()
  let out
  try { out = await fn() } catch (e) { out = { status: 0, ms: Date.now() - started, text: `THROW ${e.message}` } }
  const rec = { id, title, ...out, at: new Date().toISOString() }
  results.push(rec)
  console.log(`  ${String(rec.status || '—').padEnd(4)} ${rec.ms.toString().padStart(7)}ms  ${id.padEnd(30)} ${rec.text.replace(/\s+/g, ' ').slice(0, 110)}`)
  if (COOLDOWN > 0) await sleep(COOLDOWN)
  return rec
}

console.log(`→ 生成素材复验  base=${BASE}`)
const health = await req('GET', '/api/v1/health')
console.log(`  健康检查: ${health.status} ${health.text.slice(0, 60)}`)
if (health.status === 0) { console.error(`✗ 后端不可达（${health.text}）`); process.exit(1) }

mkdirSync(join(OUT_DIR, 'assets'), { recursive: true })

console.log('\n[1] 文生图生成有意义的测试素材（串行）')
const refs = {}
for (const seed of SEEDS) {
  const gen = await runCase(`txt2image.${seed.key}`, seed.label, () => postJson('/api/v1/generate/txt2image', { prompt: seed.prompt, width: seed.width, height: seed.height }))
  let parsed = null
  try { parsed = JSON.parse(gen.text) } catch { /* ignore */ }
  if (gen.status !== 200 || !parsed?.full_url) { console.log(`  ✗ ${seed.key} 生成失败，跳过`); continue }

  const dest = join(OUT_DIR, 'assets', `${seed.key}-${parsed.filename}`)
  let buf = null
  try {
    buf = await download(parsed.full_url, dest)
  } catch (e) {
    console.log(`  ✗ 下载失败: ${e.message}`)
    continue
  }
  const sz = imageSize(buf)
  console.log(`  → 产物 ${parsed.filename}  ${(buf.length / 1024).toFixed(0)}KB  ${sz ? `${sz.w}×${sz.h}` : '尺寸未知'}  → ${dest}`)

  const localName = `ref-${seed.key}-${randomUUID().slice(0, 8)}.png`
  const up = await runCase(`upload.${seed.key}`, `上传 ${localName}`, () => upload(localName, buf))
  let handle = null
  try { handle = JSON.parse(up.text).name ?? null } catch { /* ignore */ }
  console.log(`  → 句柄: ${handle ?? '（未取到）'}`)
  refs[seed.key] = { handle, filename: parsed.filename, local: dest, size: sz, bytes: buf.length }
}

console.log('\n[2] 用生成的素材调用带文件端点（串行）')
const usable = Object.entries(refs).filter(([, v]) => v.handle)
if (usable.length === 0) { console.error('✗ 没有拿到任何句柄，终止'); process.exit(1) }
const defaultRef = refs.sheet?.handle ?? refs[Object.keys(refs)[0]].handle

const table = []
for (const ep of ENDPOINTS) {
  if (ONLY !== null && !ONLY.includes(ep.key)) continue
  const handle = ep.ref ? refs[ep.ref]?.handle : defaultRef
  if (!handle) { console.log(`  -- 跳过 ${ep.key}（无可用句柄）`); continue }
  const body = { ...ep.body }
  body[ep.field] = ep.objectArray ? [{ image: handle, frame_index: 0 }] : handle
  console.log(`\n  ── ${ep.key}  ${ep.field}=${handle}`)
  const rec = await runCase(`${ep.key}.gen`, `${ep.field} 用生成素材`, () => postJson(ep.path, body))
  table.push({ endpoint: ep.key, field: ep.field, handle, status: rec.status, ms: rec.ms, text: rec.text.slice(0, 400) })
}

// ---------------------------------------------------------------- 报告

const verdict = (r) => {
  if (r.status === 200) return '✅ 成功'
  if (r.status === 422) return '⚠️ 入参被拒(422)'
  if (r.status >= 500 && r.ms < 2000) return '❌ 500 快失败(入口/读取阶段)'
  if (r.status >= 500) return '❌ 500 慢失败(生成中崩)'
  return `? ${r.status} ${r.text.slice(0, 40)}`
}

const md = []
md.push('# 用文生图生成素材复验带文件端点')
md.push('')
md.push(`- 后端：\`${BASE}\`（健康检查 ${health.status}） · 时间：${new Date().toLocaleString('zh-CN')} · 全程串行`)
md.push('- 流程：`txt2image` 生成 → 下载到本地 → 上传回后端拿 `ref-*` 句柄 → 用句柄调用带文件端点（生产同款）')
md.push('')
md.push('## 一、生成的测试素材')
md.push('')
md.push('| 素材 | 用途 | 产物文件名 | 尺寸 | 上传句柄 |')
md.push('| --- | --- | --- | --- | --- |')
for (const s of SEEDS) {
  const r = refs[s.key]
  md.push(`| ${s.label} | \`${s.key}\` | ${r?.filename ?? '—'} | ${r?.size ? `${r.size.w}×${r.size.h}（${(r.bytes / 1024).toFixed(0)}KB）` : '—'} | \`${r?.handle ?? '—'}\` |`)
}
md.push('')
md.push('## 二、带文件端点实测')
md.push('')
md.push('| 端点 | 文件字段 | HTTP | 耗时 | 判定 | 响应摘要 |')
md.push('| --- | --- | ---: | ---: | --- | --- |')
for (const r of table) md.push(`| \`${r.endpoint}\` | ${r.field} | ${r.status || '—'} | ${r.ms}ms | ${verdict(r)} | ${r.text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 110)} |`)
md.push('')
md.push('## 三、原始响应')
md.push('')
md.push('```json')
md.push(JSON.stringify(table, null, 2))
md.push('```')
md.push('')

writeFileSync(join(OUT_DIR, 'recheck.md'), md.join('\n'))
writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), refs, table }, null, 2))

console.log(`\n✓ 完成 → ${OUT_DIR}`)
