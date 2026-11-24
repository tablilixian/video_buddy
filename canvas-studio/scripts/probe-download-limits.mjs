#!/usr/bin/env node
/**
 * 探针：generation content 端点的下载限制与速度实测（只读，不建任务、不扣积分）。
 *
 * 用法：
 *   node scripts/probe-download-limits.mjs
 *   node scripts/probe-download-limits.mjs --rounds 3 --ids id1,id2 --timeout 120
 *   node scripts/probe-download-limits.mjs --range         # 附加 Range 请求测试
 *   node scripts/probe-download-limits.mjs --curl          # 附加 curl 对照下载
 *
 * token 从桌面端渲染层 Local Storage 的 leveldb 里按 UTF-16LE 提取，只取 exp 最晚的
 * 有效 JWT；仅存内存、只进 Authorization 头，不落盘、不回显。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const LEVELDB = join(
  homedir(), 'Library', 'Application Support', 'VideoBuddy', 'Partitions',
  'dsh-desktop-renderer', 'Local Storage', 'leveldb',
)
const BASE = process.env.DRAMA_BUSINESS_BASE ?? 'http://117.50.108.73'
const DEFAULT_IDS = [
  '0fd345dc-18a6-4745-a884-2a1f4da85e99', // 分镜1：声明 2,474,836，本地截断
  '5868a2e5-204b-4ae2-bc78-c1a09dbc11d7', // 分镜2：声明 2,082,428，本地截断
  '29a84c4a-fcf6-4aaf-bdcf-818bb09e97f5', // 分镜3：1,353,743，本地完整
  '50cd97a6-fdd1-4bc3-b70b-516b430f339c', // 重出分镜1：声明 2,629,528，本地截断
]

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const ROUNDS = Number(arg('--rounds', '2'))
const TIMEOUT_S = Number(arg('--timeout', '120'))
const IDS = arg('--ids', DEFAULT_IDS.join(',')).split(',').filter(Boolean)
const DO_RANGE = argv.includes('--range')
const DO_CURL = argv.includes('--curl')

function extractToken() {
  let best = null
  let bestExp = 0
  let files = 0
  for (const name of readdirSync(LEVELDB)) {
    let text
    try { text = readFileSync(join(LEVELDB, name)).toString('utf16le') } catch { continue }
    files += 1
    for (const m of text.matchAll(/"access_token":"(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/g)) {
      const tok = m[1]
      try {
        const payload = tok.split('.')[1]
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        if (claims.exp > bestExp) { bestExp = claims.exp; best = tok }
      } catch { /* 坏帧跳过 */ }
    }
  }
  if (best === null || bestExp * 1000 <= Date.now()) {
    throw new Error(`未找到有效 token（扫描 ${files} 个 leveldb 文件）`)
  }
  return { token: best, expiresAt: bestExp }
}

const { token, expiresAt } = extractToken()
console.log(`token 有效至 ${new Date(expiresAt * 1000).toLocaleTimeString('zh-CN')} · 端点 ${BASE}`)
console.log(`轮次 ${ROUNDS} · 单轮超时 ${TIMEOUT_S}s\n`)

const hdr = { Authorization: `Bearer ${token}`, Accept: '*/*' }
const short = (id) => id.slice(0, 8)

async function downloadOnce(id) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_S * 1000)
  const t0 = performance.now()
  let res
  try {
    res = await fetch(`${BASE}/v1/generations/${id}/content/0`, {
      headers: hdr, signal: ac.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    return { error: `connect: ${e.message}` }
  }
  const meta = {
    status: res.status,
    contentLength: res.headers.get('content-length'),
    transferEncoding: res.headers.get('transfer-encoding'),
    acceptRanges: res.headers.get('accept-ranges'),
    contentType: res.headers.get('content-type'),
  }
  if (!res.ok) {
    clearTimeout(timer)
    const body = (await res.text()).slice(0, 160)
    return { ...meta, error: `HTTP ${res.status} ${body}` }
  }
  const reader = res.body.getReader()
  let bytes = 0
  const marks = []
  let lastMark = t0
  let head = Buffer.alloc(0)
  const all = []
  let chunkCount = 0
  let aborted = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const buf = Buffer.from(value)
      bytes += buf.length
      chunkCount += 1
      if (head.length < 64) head = Buffer.concat([head, buf.subarray(0, 64 - head.length)])
      all.push(buf)
      const now = performance.now()
      if (now - lastMark >= 5000) {
        marks.push(`${((now - t0) / 1000).toFixed(0)}s:${(bytes / 1048576).toFixed(2)}MB`)
        lastMark = now
      }
    }
  } catch (e) {
    aborted = true
    meta.streamError = e.name === 'AbortError' ? `abort@${TIMEOUT_S}s` : e.message
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
    clearTimeout(timer)
  }
  const elapsed = (performance.now() - t0) / 1000
  return {
    ...meta, bytes, elapsed: Number(elapsed.toFixed(2)),
    speedKBs: Number((bytes / 1024 / elapsed).toFixed(1)),
    chunks: chunkCount,
    ftyp: head.subarray(4, 8).toString('latin1') === 'ftyp',
    moov: Buffer.concat(all).includes('moov'),
    marks, aborted,
  }
}

function curlOnce(id) {
  const url = `${BASE}/v1/generations/${id}/content/0`
  const tmp = `/tmp/cs-probe-${short(id)}.bin`
  const t0 = performance.now()
  const r = spawnSync('curl', [
    '-sS', '-m', String(TIMEOUT_S), '-o', tmp,
    '-H', `Authorization: Bearer ${token}`,
    '-w', '%{http_code} %{size_download} %{time_total} %{speed_download}',
    url,
  ], { encoding: 'utf8' })
  const elapsed = (performance.now() - t0) / 1000
  let bytes = 0
  let moov = false
  try {
    const buf = readFileSync(tmp)
    bytes = buf.length
    moov = buf.includes('moov')
  } catch { /* ignore */ }
  return { out: r.stdout.trim(), elapsed: Number(elapsed.toFixed(2)), bytes, moov, err: r.stderr.trim().slice(0, 100) }
}

async function rangeOnce(id) {
  const url = `${BASE}/v1/generations/${id}/content/0`
  const t0 = performance.now()
  const res = await fetch(url, { headers: { ...hdr, Range: 'bytes=0-1023' } })
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    contentRange: res.headers.get('content-range'),
    contentLength: res.headers.get('content-length'),
    acceptRanges: res.headers.get('accept-ranges'),
    bytes: buf.length,
    elapsed: Number(((performance.now() - t0) / 1000).toFixed(2)),
  }
}

for (const id of IDS) {
  console.log(`===== ${short(id)} =====`)
  for (let round = 1; round <= ROUNDS; round += 1) {
    const r = await downloadOnce(id)
    if (r.error) { console.log(`  #${round} ERROR ${r.error}`); continue }
    console.log(`  #${round} HTTP${r.status} ${r.bytes}B ${r.elapsed}s ${r.speedKBs}KB/s chunks=${r.chunks} ` +
      `ftyp=${r.ftyp} moovTail=${r.moov} CL=${r.contentLength ?? '-'} TE=${r.transferEncoding ?? '-'} AR=${r.acceptRanges ?? '-'}` +
      `${r.streamError ? ` STREAM=${r.streamError}` : ''}`)
    if (r.marks.length) console.log(`        进度 ${r.marks.join('  ')}`)
  }
  if (DO_RANGE) {
    const r = await rangeOnce(id)
    console.log(`  RANGE HTTP${r.status} bytes=${r.bytes} CL=${r.contentLength ?? '-'} CR=${r.contentRange ?? '-'} AR=${r.acceptRanges ?? '-'} ${r.elapsed}s`)
  }
  if (DO_CURL) {
    const r = curlOnce(id)
    console.log(`  curl  ${r.out} (file=${r.bytes}B moov=${r.moov}) ${r.elapsed}s ${r.err}`)
  }
}
console.log('\n完成。token 未写入任何文件。')
