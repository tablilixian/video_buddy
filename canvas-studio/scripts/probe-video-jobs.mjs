#!/usr/bin/env node
/**
 * 异步视频任务探针（后端 0.5.0：image2videofl2va / image2videoref2va 改异步）。
 *
 * 回答五个问题（成本升序）：
 *   1. **提交是否立即 202**？响应体是否 `{job_id, status, status_url, cancel_url, result_url}`，
 *      提交墙钟是否秒级（决定客户端 submit 超时档）。
 *   2. **未完成任务取 result 是否 202**？不存在的 job_id 是否 404？
 *   3. **状态机的真实流转**？pending → in_progress → completed 各停多久（决定轮询间隔）。
 *   4. **result 结构**是否与旧同步响应一致（{prompt_id, filename, full_url, duration}）、
 *      full_url 能否直接下载。
 *   5. **取消链路**：cancel 是否 `{cancelled: true}`，取消后状态变 cancelled 还是 404。
 *
 * 用法
 * ----
 *   node scripts/probe-video-jobs.mjs                # 全流程（两次 0.4MP/5s 生成，约 3-8 分钟）
 *   node scripts/probe-video-jobs.mjs --only submit  # 只跑提交/404/202 快探针（秒级）
 *   DRAMA_API_BASE=http://x:port node scripts/probe-video-jobs.mjs
 */

const BASE = process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082'
const HEALTH = '/api/v1/health'
const FL2VA = '/api/v1/generate/image2videofl2va'
const jobUrl = (id) => `/api/v1/jobs/${id}`
const POLL_MS = 5000
const SUBMIT_TIMEOUT_MS = 60_000

function argOf(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}
const only = argOf('--only', null)

async function request(path, init = {}, timeoutMs = 30_000) {
  const started = Date.now()
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 保留原文 */ }
    return { status: response.status, ms: Date.now() - started, json, body: text.slice(0, 500) }
  } catch (cause) {
    return { status: 'NETWORK_FAIL', ms: Date.now() - started, json: null, body: String(cause?.message ?? cause) }
  }
}

const submit = (body) => request(FL2VA, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}, SUBMIT_TIMEOUT_MS)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询一个 job 直到终态，打印每次状态变化的时间戳。 */
async function pollUntilDone(jobId, maxMs = 600_000) {
  const started = Date.now()
  let last = ''
  const transitions = []
  while (Date.now() - started < maxMs) {
    const snapshot = await request(jobUrl(jobId))
    const status = snapshot.json?.status ?? `HTTP_${snapshot.status}`
    if (status !== last) {
      const offset = ((Date.now() - started) / 1000).toFixed(1)
      transitions.push({ offset: Number(offset), status, http: snapshot.status })
      console.log(`  [+${offset}s] GET status=${status} (HTTP ${snapshot.status})${snapshot.json?.execution_error ? ` error=${JSON.stringify(snapshot.json.execution_error).slice(0, 200)}` : ''}`)
      last = status
    }
    if (['completed', 'failed', 'cancelled'].includes(status)) return { transitions, lastSeen: snapshot }
    if (snapshot.status === 404) return { transitions, lastSeen: snapshot }
    await sleep(POLL_MS)
  }
  return { transitions, lastSeen: { status: 'POLL_TIMEOUT' } }
}

async function main() {
  console.log(`[base] ${BASE}`)
  const health = await request(HEALTH)
  console.log(`[health] status=${health.status} body=${health.body}`)
  if (health.status === 'NETWORK_FAIL') {
    console.log('\n后端不可达 —— 探针终止。')
    return 2
  }

  // —— 探针 1：提交（纯文生视频，最便宜的异步任务）
  console.log('\n===== 探针 1：提交是否立即 202 =====')
  const submitted = await submit({
    prompt: 'A red paper airplane flying slowly over a calm blue ocean at sunset, gentle camera push-in',
    aspect: '16:9',
    megapixels: 0.4,
    duration: 5,
  })
  console.log(`  status=${submitted.status} ms=${submitted.ms} body=${submitted.body}`)
  const jobId = submitted.json?.job_id
  if (submitted.status !== 202 || typeof jobId !== 'string') {
    console.log('  判读：非 202 / 无 job_id —— 后端可能尚未切异步，终止。')
    return 2
  }
  console.log(`  判读：提交 ${submitted.ms}ms 返回 202 + job_id=${jobId}，字段=${Object.keys(submitted.json).join(',')}`)

  // —— 探针 2：未完成任务取 result + 不存在的 job_id
  console.log('\n===== 探针 2：result 未完成=202 / 未知 job=404 =====')
  const early = await request(`${jobUrl(jobId)}/result`)
  console.log(`  [result@0s] status=${early.status} body=${early.body.slice(0, 200)}`)
  const missing = await request(jobUrl('00000000-0000-0000-0000-000000000000'))
  console.log(`  [missing job] status=${missing.status} body=${missing.body.slice(0, 200)}`)

  if (only === 'submit') {
    console.log('\n（--only submit：到此为止，任务留在后端队列中会自行完成/过期）')
    return 0
  }

  // —— 探针 3+4：状态机流转 + result 结构与可下载性
  console.log('\n===== 探针 3：状态机流转（5s 间隔）=====')
  const { transitions, lastSeen } = await pollUntilDone(jobId)
  console.log(`  流转摘要：${transitions.map((t) => `${t.status}@+${t.offset}s`).join(' → ')}`)
  if (lastSeen.json?.status !== 'completed') {
    console.log(`  判读：任务未完成（${JSON.stringify(lastSeen.json ?? lastSeen.body)}），终止后续探针。`)
    return 2
  }
  console.log('\n===== 探针 4：result 结构与下载 =====')
  const result = await request(`${jobUrl(jobId)}/result`)
  console.log(`  status=${result.status} ms=${result.ms} body=${result.body}`)
  const fullUrl = result.json?.full_url
  if (typeof fullUrl === 'string') {
    const download = await fetch(fullUrl, { signal: AbortSignal.timeout(120_000) })
    const bytes = new Uint8Array(await download.arrayBuffer())
    console.log(`  [download] status=${download.status} bytes=${bytes.byteLength} type=${download.headers.get('content-type')}`)
  }

  // —— 探针 5：取消链路
  console.log('\n===== 探针 5：提交后立即取消 =====')
  const second = await submit({
    prompt: 'A blue balloon drifting upward through clouds, static camera',
    aspect: '16:9',
    megapixels: 0.4,
    duration: 5,
  })
  const secondId = second.json?.job_id
  console.log(`  [submit#2] status=${second.status} ms=${second.ms} job_id=${secondId}`)
  if (typeof secondId === 'string') {
    const cancelled = await request(`${jobUrl(secondId)}/cancel`, { method: 'POST' })
    console.log(`  [cancel] status=${cancelled.status} body=${cancelled.body}`)
    const after = await pollUntilDone(secondId, 120_000)
    console.log(`  [after cancel] 流转：${after.transitions.map((t) => `${t.status}@+${t.offset}s`).join(' → ') || '（无变化）'}`)
    console.log('  判读：cancelled=true + 后续 cancelled/404 = 取消链路完整')
  }
  return 0
}

process.exitCode = await main()
