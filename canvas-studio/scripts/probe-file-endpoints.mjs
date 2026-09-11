#!/usr/bin/env node
/**
 * 带文件参数的端点复验（严格串行）。
 *
 * 为什么单独写一个
 * ----------------
 * `probe-api-contract.mjs` 的上传探测用的是 **1×1 像素、190 字节的 TINY_PNG**，
 * 而生产会话上传的是真实照片。若 500 的根因是「图太小导致后端解码/预处理崩」，
 * 那份报告就会把「探测方法偏差」误判成「后端全挂」。
 * 本脚本把**文件来源**当作自变量，逐个端点对比。
 *
 * 文件来源（自变量）
 * ------------------
 *   real    新上传的**真实尺寸**图片（默认 assets/desktop-preview.png）
 *   tiny    新上传的 1×1 PNG（复现 probe-api-contract 的条件）
 *   legacy  生产会话期上传、当时被成功消费过的旧句柄（如 ref-8e6fce70.png）
 *   ghost   不存在的文件名（入口即拒的对照）
 *   nofile  不带文件参数（纯文本对照；注意后端起跨请求脏状态，该对照不完全可信）
 *
 * 覆盖：openapi 里**所有**含图片/视频/音频文件字段（imageN / videoN / audioN / images）的端点。
 *
 * 用法
 * ----
 *   node scripts/probe-file-endpoints.mjs                      # 全部端点 × real
 *   node scripts/probe-file-endpoints.mjs --only image2image   # 定点复测
 *   node scripts/probe-file-endpoints.mjs --matrix image2image,image2vl   # 跑全来源矩阵
 *   node scripts/probe-file-endpoints.mjs --out docs/api-probe/file-recheck-<日期>
 *
 * 注：本机 Bash 沙箱会拦截 117.50.108.73:8082，须在沙箱外运行；全程串行。
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

const OUT_DIR = resolve(arg('out', `docs/api-probe/file-recheck-${Date.now()}`))
const TIMEOUT_MS = Number(arg('timeout', 300_000))
const COOLDOWN = Number(arg('cooldown', 600))
const IMAGE_PATH = resolve(arg('image', '../assets/desktop-preview.png'))
const ONLY = arg('only', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const MATRIX = new Set((arg('matrix', 'image2image,image2vl,image2character') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
/** 生产会话期上传、且当时被成功消费过的旧句柄 —— 用来区分「新上传坏了」与「消费链路坏了」。 */
const LEGACY = ['ref-8e6fce70.png']

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
    const r = http.request(
      { hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, headers: h },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => done({ status: res.statusCode ?? 0, ms: Date.now() - started, text: Buffer.concat(chunks).toString('utf8') }))
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

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

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

/** 读 PNG/JPEG 真实像素尺寸，用来证明「上传的确实是正常尺寸的图」。 */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: 'png' }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), fmt: 'jpeg' }
      }
      i += 2 + len
    }
  }
  return null
}

// ---------------------------------------------------------------- 端点清单

/** openapi 里所有含文件字段的端点。body 只给「必填 + 该文件字段」，其余走默认值。 */
const ENDPOINTS = [
  { key: 'image2image', path: '/api/v1/generate/image2image', field: 'image1', body: { prompt: 'make it autumn' }, fast: true },
  { key: 'image2vl', path: '/api/v1/generate/image2vl', field: 'image', body: { system_prompt: 'You are a helpful assistant.', prompt: 'Describe this image in one short sentence.' }, fast: true },
  { key: 'image2character', path: '/api/v1/generate/image2character', field: 'image', body: {} },
  { key: 'image2styletransfer', path: '/api/v1/generate/image2styletransfer', field: 'image1', body: {} },
  { key: 'image2ipastyletransfer', path: '/api/v1/generate/image2ipastyletransfer', field: 'image1', body: { prompt: 'anime style portrait' } },
  { key: 'image2storyboard', path: '/api/v1/generate/image2storyboard', field: 'image', body: { prompt: 'a cat walking in the rain, four panels' } },
  { key: 'image2inpaint', path: '/api/v1/generate/image2inpaint', field: 'image', body: { prompt: 'remove the object in the center' } },
  { key: 'image2360hdri', path: '/api/v1/generate/image2360hdri', field: 'image', body: {} },
  { key: 'image2splitegrid', path: '/api/v1/generate/image2splitegrid', field: 'image', body: {} },
  { key: 'image2videomsr', path: '/api/v1/generate/image2videomsr', field: 'image1', body: { prompt: 'a gentle camera push in', background: 'white' } },
  { key: 'image2videomkr', path: '/api/v1/generate/image2videomkr', field: 'images', array: true, body: { prompt: 'a gentle camera push in' } },
  { key: 'image2videomkrgrid', path: '/api/v1/generate/image2videomkrgrid', field: 'image', body: { prompt: 'a gentle camera push in' } },
  { key: 'image2videofl2va', path: '/api/v1/generate/image2videofl2va', field: 'image1', body: { prompt: 'a cat running in the grass, slow pan', duration: 5 } },
  { key: 'image2videoref2va', path: '/api/v1/generate/image2videoref2va', field: 'image1', body: { prompt: 'a cat running in the grass, slow pan', duration: 5 } },
]

// ---------------------------------------------------------------- 主流程

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
  console.log(`  ${String(rec.status || '—').padEnd(4)} ${rec.ms.toString().padStart(7)}ms  ${id.padEnd(34)} ${rec.text.replace(/\s+/g, ' ').slice(0, 100)}`)
  if (COOLDOWN > 0) await sleep(COOLDOWN)
  return rec
}

console.log(`→ 带文件端点复验  base=${BASE}`)
const health = await req('GET', '/api/v1/health')
console.log(`  健康检查: ${health.status} ${health.text.slice(0, 70)}`)
if (health.status === 0) {
  console.error(`✗ 后端不可达（${health.text}）。若在沙箱内运行，请重试。`)
  process.exit(1)
}

// 真实图片（正常尺寸，生产同款）
let realBuf = null
if (existsSync(IMAGE_PATH)) {
  realBuf = readFileSync(IMAGE_PATH)
  const sz = imageSize(realBuf)
  console.log(`  真实图片: ${IMAGE_PATH}  ${(realBuf.length / 1024).toFixed(0)}KB  ${sz ? `${sz.w}×${sz.h}` : '尺寸未知'}`)
} else {
  console.error(`✗ 找不到真实图片 ${IMAGE_PATH}`)
  process.exit(1)
}

console.log('\n[1] 上传（三种来源各一次，串行）')
const handles = {}
for (const [label, name, buf] of [
  ['real', `ref-real-${randomUUID().slice(0, 8)}.png`, realBuf],
  ['tiny', `ref-tiny-${randomUUID().slice(0, 8)}.png`, TINY_PNG],
]) {
  const rec = await runCase(`upload.${label}`, `上传 ${name}（${(buf.length / 1024).toFixed(1)}KB）`, () => upload(name, buf))
  try {
    handles[label] = JSON.parse(rec.text).name ?? null
  } catch {
    handles[label] = null
  }
  console.log(`  → 句柄: ${handles[label] ?? '（未取到）'}`)
}
handles.legacy = LEGACY[0]
console.log(`  → legacy 句柄（会话期成功消费过）: ${handles.legacy}`)

// 文件来源矩阵
const SOURCES = ['real', 'tiny', 'legacy', 'ghost', 'nofile']

console.log('\n[2] 端点实测（严格串行）')
const table = []
for (const ep of ENDPOINTS) {
  if (ONLY !== null && !ONLY.includes(ep.key)) continue
  const useMatrix = MATRIX.has(ep.key)
  const sources = useMatrix ? SOURCES : ['real']
  console.log(`\n  ── ${ep.key}  ${useMatrix ? '来源矩阵' : '仅 real'}`)
  for (const src of sources) {
    let body = { ...ep.body }
    if (src === 'nofile') {
      // 不带文件
    } else if (src === 'ghost') {
      body[ep.field] = ep.array ? [`ghost-${randomUUID().slice(0, 8)}.png`] : `ghost-${randomUUID().slice(0, 8)}.png`
    } else {
      const h = handles[src]
      if (!h) continue
      body[ep.field] = ep.array ? [h] : h
    }
    const rec = await runCase(`${ep.key}.${src}`, `${ep.field}=${src}`, () => postJson(ep.path, body))
    table.push({ endpoint: ep.key, source: src, status: rec.status, ms: rec.ms, text: rec.text.slice(0, 300) })
  }
}

// ---------------------------------------------------------------- 报告

const verdict = (r) => {
  if (r.status === 200) return '✅ 成功'
  if (r.status === 422) return '⚠️ 入参被拒(422)'
  if (r.status >= 500 && r.ms < 2000) return '❌ 500 快失败(入口/读取阶段)'
  if (r.status >= 500) return '❌ 500 慢失败(生成中崩)'
  if (r.status === 0) return `⏱ ${r.text.slice(0, 40)}`
  return `? ${r.status}`
}

const md = []
md.push('# 带文件参数端点复验（文件来源作自变量）')
md.push('')
md.push(`- 后端：\`${BASE}\`（健康检查 ${health.status}）`)
md.push(`- 时间：${new Date().toLocaleString('zh-CN')} · 全程串行（后端单任务同步）`)
md.push(`- 真实图片：\`${IMAGE_PATH}\`（${(realBuf.length / 1024).toFixed(0)}KB，${(() => { const s = imageSize(realBuf); return s ? `${s.w}×${s.h}` : '?' })()}）`)
md.push('')
md.push('## 一、上传句柄')
md.push('')
md.push('| 来源 | 文件名 | 上传结果 |')
md.push('| --- | --- | --- |')
for (const [k, v] of Object.entries(handles)) {
  const u = results.find((r) => r.id === `upload.${k}`)
  md.push(`| ${k} | \`${v ?? '—'}\` | ${u ? `${u.status} / ${u.ms}ms` : '（旧句柄，未重新上传）'} |`)
}
md.push('')
md.push('## 二、实测矩阵')
md.push('')
md.push('| 端点 | 文件来源 | HTTP | 耗时 | 判定 | 响应摘要 |')
md.push('| --- | --- | ---: | ---: | --- | --- |')
for (const r of table) {
  md.push(`| \`${r.endpoint}\` | ${r.source} | ${r.status || '—'} | ${r.ms}ms | ${verdict(r)} | ${r.text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 90)} |`)
}
md.push('')
md.push('## 三、原始响应')
md.push('')
md.push('```json')
md.push(JSON.stringify(table, null, 2))
md.push('```')
md.push('')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'recheck.md'), md.join('\n'))
writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), handles, table }, null, 2))

console.log(`\n✓ 复验完成 → ${OUT_DIR}`)
console.log(`  ${join(OUT_DIR, 'recheck.md')}`)
