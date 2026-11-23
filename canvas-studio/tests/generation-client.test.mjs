/**
 * 生成面任务引擎契约（迁移方案 B3-1；`src/generation-client.ts`）。
 *
 * 锁 api(12).md §6.8-§6.10 的引擎层纪律：
 *   1. 创建：inputs[] 按 role 从 1 连续编号、白名单校验本地先拦；Idempotency-Key
 *      必发；**intent 持久化先于 POST**（网络重试复用同 key 的凭据）。
 *   2. 跟随：终态只认 terminal；瞬时错误（网络/429/5xx）退避重试、4xx 即停；
 *      打断尽力 cancel 远端再抛 CS-GEN-207；墙钟超时 cancel 后抛 CS-GEN-209。
 *   3. 下载：content 端点非 2xx（410 过期等）→ CS-NET-007。
 *   4. 报价 fail-open：失败返回 null 不阻断提交。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  buildCreateGenerationBody,
  createGenerationTask,
  downloadGenerationContent,
  downloadGenerationOutput,
  followGeneration,
  isGenerationOutputBytesIntact,
  newIdempotencyKey,
  quoteGenerationCost,
  throwIfResultUnavailable,
} from '../lib/generation-client.js'
import { ApiError } from '../lib/drama-management.js'
import { CanvasStudioError } from '../lib/error-system.js'
import { minimalMp4, minimalPng } from './helpers/generation-stub.mjs'

const SNAP = (over = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  operation: 'txt2image',
  status: 'queued',
  version: 1,
  progress: 0,
  billing_status: 'held',
  terminal: false,
  outputs: [],
  error: null,
  ...over,
})

/** 引擎依赖桩：记录全部调用；各方法行为由用例覆写。 */
function fakeDeps(handlers = {}) {
  const calls = { create: [], poll: [], cancel: [], content: [], download: [] }
  const client = {
    async createGeneration(token, body, key, runId) {
      calls.create.push({ token, body, key, runId })
      return handlers.create?.(calls.create.length) ?? SNAP()
    },
    async quoteGeneration(token, req) {
      calls.quote = calls.quote ?? []
      calls.quote.push(req)
      return handlers.quote?.() ?? { estimated_credits: 1 }
    },
    async pollGeneration(token, id, afterVersion, wait) {
      calls.poll.push({ id, afterVersion, wait })
      return handlers.poll?.(calls.poll.length, afterVersion)
    },
    async cancelGeneration(token, id) {
      calls.cancel.push(id)
      return handlers.cancel?.() ?? SNAP({ status: 'canceled', terminal: true })
    },
    async openGenerationContent(token, id, ordinal) {
      calls.content.push({ id, ordinal })
      return handlers.content?.({ id, ordinal })
    },
    async openGenerationDownload(token, id, ordinal) {
      calls.download.push({ id, ordinal })
      return handlers.download?.(calls.download.length, { id, ordinal })
    },
  }
  return { deps: { client, token: () => 'jwt-1' }, calls }
}

// ── 请求体组装 ───────────────────────────────────────────────────────────────

test('buildCreateGenerationBody：按 role 分配 ordinal（同 role 从 1 连续）', () => {
  const body = buildCreateGenerationBody({
    model: 'video.minimax_h3',
    operation: 'image2videoref2va',
    input: { prompt: 'p', aspect: '16:9', megapixels: 0.4, duration: 5 },
    refs: [
      { assetId: 'a1', role: 'image' },
      { assetId: 'v1', role: 'video' },
      { assetId: 'a2', role: 'image' },
      { assetId: 's1', role: 'audio' },
    ],
  })
  assert.deepEqual(body.inputs, [
    { asset_id: 'a1', role: 'image', ordinal: 1 },
    { asset_id: 'v1', role: 'video', ordinal: 1 },
    { asset_id: 'a2', role: 'image', ordinal: 2 },
    { asset_id: 's1', role: 'audio', ordinal: 1 },
  ])
})

test('buildCreateGenerationBody：重复 asset / 规格违反本地拦（不发出注定 400 的请求）', () => {
  assert.throws(
    () => buildCreateGenerationBody({
      model: 'm', operation: 'image2image', input: {}, refs: [{ assetId: 'x', role: 'image' }, { assetId: 'x', role: 'image' }],
    }),
    (e) => e instanceof ApiError && e.code === 'invalid_argument' && /重复引用/.test(e.message),
  )
  assert.throws(
    () => buildCreateGenerationBody({
      model: 'm', operation: 'image2videofl2va', input: {}, refs: [
        { assetId: 'a', role: 'image' }, { assetId: 'b', role: 'image' }, { assetId: 'c', role: 'image' },
      ],
    }),
    (e) => e instanceof ApiError && e.code === 'invalid_argument' && /image2videofl2va/.test(e.message),
  )
})

// ── 创建 ─────────────────────────────────────────────────────────────────────

test('createGenerationTask：Idempotency-Key + clientRunId 必发；intent 先于 POST 落盘', async () => {
  const order = []
  const { deps, calls } = fakeDeps({ create: () => SNAP({ status: 'credit_held', version: 1 }) })
  const snapshot = await createGenerationTask(deps, {
    model: 'image.krea2',
    operation: 'txt2image',
    input: { prompt: 'p', width: 1024, height: 768 },
    refs: [],
    idempotencyKey: 'idem-1',
    clientRunId: 'desktop-run-1',
  }, {
    persistIntent: (intent) => { order.push('intent') },
  })
  assert.equal(snapshot.status, 'credit_held')
  assert.equal(calls.create[0].key, 'idem-1')
  assert.equal(calls.create[0].runId, 'desktop-run-1')
  assert.equal(calls.create[0].token, 'jwt-1')
  // intent 落盘发生在 POST 之前（persistIntent 先于 create 调用入列）。
  assert.deepEqual(order, ['intent'])
  // 假 client 收到的是请求体对象（真 DramaClient 在 #request 里才 JSON.stringify）。
  assert.equal(calls.create[0].body.operation, 'txt2image')
})

test('createGenerationTask：无 persistIntent 时不落盘照常创建', async () => {
  const { deps, calls } = fakeDeps()
  const snapshot = await createGenerationTask(deps, {
    model: 'm', operation: 'txt2image', input: { prompt: 'p' }, refs: [], idempotencyKey: 'k',
  })
  assert.notEqual(snapshot, null)
  assert.equal(calls.create.length, 1)
})

// ── 报价 fail-open ───────────────────────────────────────────────────────────

test('quoteGenerationCost：成功返回数值；任何失败返回 null（不阻断提交）', async () => {
  const ok = fakeDeps({ quote: () => ({ estimated_credits: 18.432 }) })
  assert.equal(await quoteGenerationCost(ok.deps, { model: 'm', operation: 'txt2image', input: {} }), 18.432)
  const broken = fakeDeps({ quote: () => { throw new ApiError('unavailable', 'x', 503, null) } })
  assert.equal(await quoteGenerationCost(broken.deps, { model: 'm', operation: 'txt2image', input: {} }), null)
})

// ── 跟随 ─────────────────────────────────────────────────────────────────────

test('followGeneration：版本推进 + onSnapshot 逐帧回调，terminal 即返回', async () => {
  const { deps, calls } = fakeDeps({
    poll: (nth) => nth === 1
      ? SNAP({ version: 2, status: 'running', progress: 40 })
      : SNAP({ version: 3, status: 'succeeded', progress: 100, terminal: true, outputs: [] }),
  })
  const seen = []
  const final = await followGeneration(deps, SNAP(), {
    onSnapshot: (s) => { seen.push(`${s.version}:${s.status}`) },
  })
  assert.equal(final.status, 'succeeded')
  assert.equal(final.version, 3)
  assert.deepEqual(seen, ['2:running', '3:succeeded'])
  // 游标只认 version：第二轮 after_version=2。
  assert.equal(calls.poll[0].afterVersion, 1)
  assert.equal(calls.poll[1].afterVersion, 2)
  assert.equal(calls.poll[0].wait, 25)
})

test('followGeneration：succeeded+archiving 继续轮询到 ready（2026-11-23 换代）', async () => {
  const { deps, calls } = fakeDeps({
    poll: (nth) => nth === 1
      ? SNAP({ version: 2, status: 'succeeded', result_status: 'archiving', terminal: true, progress: 100 })
      : SNAP({ version: 3, status: 'succeeded', result_status: 'ready', terminal: true, progress: 100 }),
  })
  const final = await followGeneration(deps, SNAP(), { backoffStartMs: 1 })
  assert.equal(final.result_status, 'ready')
  assert.equal(calls.poll.length, 2, 'archiving 不得因 terminal 提前返回')
  assert.equal(calls.poll[1].afterVersion, 2)
})

test('followGeneration：result_status=failed/expired 立即停（不自动重生成）', async () => {
  for (const resultStatus of ['failed', 'expired']) {
    const { deps, calls } = fakeDeps({
      poll: () => SNAP({ version: 2, status: 'succeeded', result_status: resultStatus, terminal: true }),
    })
    const final = await followGeneration(deps, SNAP(), { backoffStartMs: 1 })
    assert.equal(final.result_status, resultStatus)
    assert.equal(calls.poll.length, 1)
  }
})

test('followGeneration：5xx 瞬时错误退避重试后自愈（backoffStart=1ms 免等待）', async () => {
  let n = 0
  const { deps, calls } = fakeDeps({
    poll: () => {
      n += 1
      if (n === 1) throw new ApiError('unavailable', 'boom', 503, null)
      return SNAP({ version: 2, status: 'succeeded', terminal: true })
    },
  })
  const final = await followGeneration(deps, SNAP(), { backoffStartMs: 1, backoffCapMs: 4 })
  assert.equal(final.status, 'succeeded')
  assert.equal(calls.poll.length, 2)
})

test('followGeneration：4xx 业务错误立即上抛（不重试）', async () => {
  const { deps, calls } = fakeDeps({
    poll: () => { throw new ApiError('not_found', 'no such generation', 404, null) },
  })
  await assert.rejects(
    () => followGeneration(deps, SNAP(), { backoffStartMs: 1 }),
    (e) => e instanceof ApiError && e.status === 404,
  )
  assert.equal(calls.poll.length, 1, '404 不得重试')
})

test('followGeneration：用户打断 → 尽力 cancel 远端 → CS-GEN-207', async () => {
  const controller = new AbortController()
  const { deps, calls } = fakeDeps({
    poll: () => SNAP({ version: 2, status: 'running' }),
  })
  const pending = followGeneration(deps, SNAP(), { signal: controller.signal, backoffStartMs: 1 })
  // 在第一次 poll 返回、下一轮循环顶检查前打断。
  setTimeout(() => controller.abort(), 5)
  await assert.rejects(() => pending, (e) => e instanceof CanvasStudioError && e.code === 'CS-GEN-207')
  assert.deepEqual(calls.cancel, ['aaaaaaaa-aaaa-4aaa-8aaa-000000000001'], '打断必须尽力撤销远端任务')
})

test('followGeneration：墙钟超时 → cancel 远端 → CS-GEN-209（operation 感知文案）', async () => {
  const { deps, calls } = fakeDeps({ poll: () => SNAP({ version: 2, status: 'running' }) })
  await assert.rejects(
    () => followGeneration(deps, SNAP(), { timeoutMs: 20, backoffStartMs: 1, label: '音乐生成' }),
    (e) => e instanceof CanvasStudioError && e.code === 'CS-GEN-209' && e.message.includes('音乐生成'),
  )
  assert.equal(calls.cancel.length, 1, '超时也必须尽力撤销远端任务')
})

// ── 下载 ─────────────────────────────────────────────────────────────────────

test('downloadGenerationContent：字节透传；410 gone → CS-NET-007', async () => {
  const ok = fakeDeps({
    content: () => new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { 'content-type': 'image/png' } }),
  })
  const bytes = await downloadGenerationContent(ok.deps, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 0)
  assert.deepEqual([...bytes], [9, 9, 9])

  const gone = fakeDeps({
    content: () => new Response(JSON.stringify({ error: { code: 'gone', message: 'result_expired' } }), { status: 410 }),
  })
  await assert.rejects(
    () => downloadGenerationContent(gone.deps, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 0),
    (e) => e instanceof CanvasStudioError && e.code === 'CS-NET-007',
  )
})

// ── 换代后的下载：票据 → Blob/CDN ────────────────────────────────────────────

const READY_SNAP = SNAP({
  status: 'succeeded', result_status: 'ready', terminal: true, progress: 100,
  outputs: [{ ordinal: 0, type: 'image', mime_type: 'image/png', download_url: '/v1/generations/x/download/0' }],
})
const READY_OUTPUT = READY_SNAP.outputs[0]
const TICKET = {
  url: 'https://blob.example.com/signed', headers: {}, expires_at: '2026-11-23T08:10:00Z', size_bytes: 3,
}

test('downloadGenerationOutput：票据直连字节透传；绝不调用 content 端点', async () => {
  const { deps, calls } = fakeDeps({
    download: () => ({
      response: new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
      ticket: TICKET,
    }),
  })
  const result = await downloadGenerationOutput(deps, READY_SNAP, READY_OUTPUT)
  assert.deepEqual([...result.bytes], [9, 9, 9])
  assert.equal(result.ticket.size_bytes, 3)
  assert.equal(calls.download.length, 1)
  assert.equal(calls.content.length, 0)
})

test('downloadGenerationOutput：409 result_not_ready → 回轮询到 ready 再取票', async () => {
  const { deps, calls } = fakeDeps({
    poll: () => ({
      ...READY_SNAP,
      version: 3,
      outputs: [{ ...READY_OUTPUT }],
    }),
    download: (nth) => {
      if (nth === 1) throw new ApiError('result_not_ready', 'still archiving', 409, null)
      return { response: new Response(new Uint8Array([1, 2, 3]), { status: 200 }), ticket: TICKET }
    },
  })
  const result = await downloadGenerationOutput(deps, READY_SNAP, READY_OUTPUT, { backoffStartMs: 1 })
  assert.deepEqual([...result.bytes], [1, 2, 3])
  assert.equal(calls.download.length, 2)
  assert.equal(calls.poll.length, 1, '409 后必须回轮询，不能立即重踩')
  assert.equal(calls.content.length, 0)
})

test('isGenerationOutputBytesIntact：size/checksum + PNG/MP4 结构失败一律判坏', () => {
  const png = minimalPng()
  const good = { ...TICKET, size_bytes: png.length, checksum_sha256: createHash('sha256').update(png).digest('hex') }
  assert.equal(isGenerationOutputBytesIntact(png, good, 'image/png'), true)
  assert.equal(isGenerationOutputBytesIntact(png.subarray(0, -1), good, 'image/png'), false)
  assert.equal(isGenerationOutputBytesIntact(png, { ...good, checksum_sha256: 'a'.repeat(64) }, 'image/png'), false)
  assert.equal(isGenerationOutputBytesIntact(png, null, 'image/png'), true)
  assert.equal(isGenerationOutputBytesIntact(minimalMp4(), null, 'video/mp4'), true)
  assert.equal(isGenerationOutputBytesIntact(Buffer.from('broken'), null, 'video/mp4'), false)
})

test('throwIfResultUnavailable：failed/expired 独立码，未 ready 落契约异常码', () => {
  for (const [status, code] of [['failed', 'CS-GEN-210'], ['expired', 'CS-GEN-211']]) {
    assert.throws(
      () => throwIfResultUnavailable({ ...READY_SNAP, result_status: status }, '图像生成'),
      (e) => e instanceof CanvasStudioError && e.code === code,
    )
  }
  assert.throws(
    () => throwIfResultUnavailable({ ...READY_SNAP, result_status: '' }, '图像生成'),
    (e) => e instanceof CanvasStudioError && e.code === 'CS-NET-010',
  )
  assert.doesNotThrow(() => throwIfResultUnavailable(READY_SNAP, '图像生成'))
})

// ── 幂等键 ───────────────────────────────────────────────────────────────────

test('newIdempotencyKey：UUID 形态（可打印 ASCII，满足 §6.8 约束）', () => {
  const key = newIdempotencyKey()
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
})
