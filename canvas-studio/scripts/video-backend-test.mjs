#!/usr/bin/env node
/**
 * Drama Backend 视频端点复现测试 —— 针对 session.jsonl 12 中第一个
 * `video_composite`(irMode=Ref2VA) 返回 HTTP 500 的问题，做最小真机复现。
 *
 * 真实链路（与 src/providers/drama.ts 对齐）：
 *   health          GET  /api/v1/health
 *   upload          POST /api/v1/generate/upload        (multipart field=file → {name})
 *   ref2va(多参考)  POST /api/v1/generate/image2videoref2va
 *                        body { prompt, aspect, megapixels, duration, image1..imageN }
 *   fl2va(单/首尾)  POST /api/v1/generate/image2videofl2va
 *                        body { prompt, aspect, megapixels, duration, image1[, image2] }
 *
 * 480p → megapixels=0.4（见 src/config.ts MEGAPIXELS_BY_RESOLUTION）。无鉴权。
 *
 * 注意：本机 Bash 沙箱会拦截 117.50.108.73:8082，须在沙箱外运行，且要避开
 * WorkBuddy 注入的 HTTP(S)_PROXY 直连（运行命令已处理）。
 *
 * 用法：
 *   node scripts/video-backend-test.mjs                 # health + upload + ref2va + fl2va
 *   node scripts/video-backend-test.mjs --skip-video     # 只验 health + upload（快）
 *   DRAMA_API_BASE=http://x.x.x.x:port node scripts/video-backend-test.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const SKIP_VIDEO = process.argv.includes('--skip-video')
const REQ_TIMEOUT_MS = 540_000 // 9 分钟，单条视频请求上限
const OUT_DIR = join(process.cwd(), 'docs', 'api-probe', `video-backend-test-${Date.now()}`)

const log = (...a) => console.log(...a)
const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1 }

// ---------- 最小 PNG 编码器（造 3 张纯色测试图，免外部素材）----------
function makePng(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const row = Buffer.alloc(1 + size * 4)
  for (let x = 0; x < size; x++) { row[1 + x * 4] = r; row[1 + x * 4 + 1] = g; row[1 + x * 4 + 2] = b; row[1 + x * 4 + 3] = 255 }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  const idat = deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
    const t = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0)
    return Buffer.concat([len, t, data, crc])
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
// 内联 CRC32（避免引包）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff }

// ---------- HTTP 封装 ----------
function req(method, path, { json, form, timeout = REQ_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    const started = Date.now()
    const url = new URL(BASE + path)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    const init = { method, headers: {}, signal: ctrl.signal }
    if (json !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(json) }
    else if (form !== undefined) { init.body = form }
    fetch(url, init).then(async (res) => {
      const text = await res.text()
      clearTimeout(timer)
      done({ ok: res.ok, status: res.status, ms: Date.now() - started, text })
    }).catch((e) => {
      clearTimeout(timer)
      done({ ok: false, status: 0, ms: Date.now() - started, text: `ERR ${e.name}: ${e.message}` })
    })
  })
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const records = []

  // 0. health
  log(`\n[0] health  GET ${BASE}/api/v1/health`)
  const h = await req('GET', '/api/v1/health', { timeout: 15_000 })
  log(`    → ${h.status}  ${h.ms}ms  ${h.text.slice(0, 80)}`)
  records.push({ step: 'health', ...h })
  if (h.status === 0) { fail('后端不可达（沙箱拦截？需在沙箱外运行 / 检查网络）'); return finish(records) }
  if (!h.ok) { fail(`health 非 2xx: ${h.status}`); return finish(records) }

  // 1. 造图 + 上传
  log('\n[1] 造 3 张测试图并上传（拿后端 name）')
  const colors = [[220, 60, 60], [60, 180, 90], [70, 110, 220]]
  const names = []
  for (let i = 0; i < 3; i++) {
    const png = makePng(256, colors[i])
    const file = `ref-test-${randomUUID().slice(0, 8)}.png`
    const local = join(OUT_DIR, file)
    writeFileSync(local, png)
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), file)
    const up = await req('POST', '/api/v1/generate/upload', { form, timeout: 60_000 })
    let name = null
    try { name = JSON.parse(up.text).name } catch { /* ignore */ }
    log(`    ${i + 1}. upload ${file} → ${up.status} ${up.ms}ms  name=${name ?? '(无)'}`)
    records.push({ step: `upload#${i + 1}`, ...up, name })
    if (up.ok && name) names.push(name); else fail(`第 ${i + 1} 张上传失败`)
  }
  if (names.length < 3) return finish(records)

  if (SKIP_VIDEO) { log('\n(--skip-video) 跳过视频请求'); return finish(records) }

  // 2. ref2va（多参考，正是失败的那条路径）
  const prompt = 'a young woman in a green apron smiles and greets the camera at a book stall, warm autumn daylight, handheld documentary shot'
  const ref2vaBody = { prompt, aspect: '16:9', megapixels: 0.4, duration: 9, image1: names[0], image2: names[1], image3: names[2] }
  log(`\n[2] ref2va(多参考)  POST ${BASE}/api/v1/generate/image2videoref2va`)
  log(`    image1=${names[0]} image2=${names[1]} image3=${names[2]}  megapixels=0.4 duration=9`)
  const r2 = await req('POST', '/api/v1/generate/image2videoref2va', { json: ref2vaBody })
  log(`    → ${r2.status}  ${r2.ms}ms`)
  log(`    ${r2.text.slice(0, 300).replace(/\s+/g, ' ')}`)
  records.push({ step: 'ref2va', ...r2 })

  // 3. fl2va（单参考，drama.ts 称更稳，做对照）
  const fl2vaBody = { prompt, aspect: '16:9', megapixels: 0.4, duration: 9, image1: names[0] }
  log(`\n[3] fl2va(单参考·对照)  POST ${BASE}/api/v1/generate/image2videofl2va`)
  const r3 = await req('POST', '/api/v1/generate/image2videofl2va', { json: fl2vaBody })
  log(`    → ${r3.status}  ${r3.ms}ms`)
  log(`    ${r3.text.slice(0, 300).replace(/\s+/g, ' ')}`)
  records.push({ step: 'fl2va', ...r3 })

  // 判定
  log('\n=== 判定 ===')
  const verdict = (r) => {
    if (r.status === 200) return '✅ 200 正常返回'
    if (r.status === 422) return '⚠️ 422 入参被拒'
    if (r.status >= 500 && r.ms < 3000) return '❌ 500 快失败（入口/读取阶段崩溃）'
    if (r.status >= 500) return '❌ 500 慢失败（生成中崩溃，与 session 首次 500s 一致）'
    return `? ${r.status}`
  }
  log(`  ref2va: ${verdict(r2)}`)
  log(`  fl2va : ${verdict(r3)}`)
  if (r2.status === 200 && r3.status === 200) log('  → 两条路径都能正常返回，说明后端当时 500 可能是瞬时/负载问题，或与原 prompt 格式/特定参考图有关。')
  else if (r2.status >= 500 && r3.status === 200) log('  → 仅多参考 ref2va 失败、单参考 fl2va 成功 ⇒ 失败根因在「多参考」这条路径/参数，而非后端整体宕机。')
  else if (r2.status >= 500 && r3.status >= 500) log('  → 两条都 500 ⇒ 后端整体处于异常态（与 session 首次 500 一致的“后端问题”假设）。')

  finish(records)
}

function finish(records) {
  writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), records }, null, 2))
  log(`\n✓ 原始记录 → ${OUT_DIR}/raw.json`)
  if (process.exitCode) log('（存在失败项，详见上方）')
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
