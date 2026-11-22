/**
 * 生成面业务 API 契约层（`src/contracts/generation.ts` + `src/drama-management.ts`
 * 生成面方法）—— 迁移方案 B1（`docs/plans/DramaServer-生成面迁移方案-20261122.md`）。
 *
 * 锁四件 api(12).md 明文规定、违规必被服务端打回的事：
 *   1. 未知字段拒收 ⇒ input 组装必须过白名单裁剪；
 *   2. 终态只认 terminal（finalizing / cancel_requested 不是终态）；
 *   3. 轮询游标只认 version，wait 钳 0..25；
 *   4. presign 的 upload_url 必须过 https/回环 + 无 userinfo 校验才能交出去。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GENERATION_OPERATIONS,
  TERMINAL_GENERATION_STATUSES,
  buildGenerationInput,
  buildGenerationListQuery,
  buildInputRefs,
  formatPollWait,
  isGenerationId,
  isGenerationStatus,
  isTerminalGenerationStatus,
  normalizeChecksumHex,
  parseAssetCompleteResponse,
  parseAssetPresignResponse,
  parseGenerationOutputs,
  parseGenerationQuote,
  parseGenerationSnapshot,
  validateGenerationInput,
  validateInputRefs,
} from '../lib/contracts/generation.js'
import {
  ApiError,
  DramaClient,
  assertSafeAssetUploadUrl,
  modelSupportsOperation,
} from '../lib/drama-management.js'

// ── input 白名单 ─────────────────────────────────────────────────────────────

test('buildGenerationInput：白名单外的字段被剔除，undefined 值不落 JSON', () => {
  const input = buildGenerationInput('txt2image', {
    prompt: 'a cat',
    width: 1024,
    height: 768,
    // 以下全部非法：视频字段 / 音乐字段 / 未知字段。
    aspect: '16:9',
    bpm: 120,
    generate_audio: true,
    system_prompt: undefined,
  })
  assert.deepEqual(input, { prompt: 'a cat', width: 1024, height: 768 })
})

test('buildGenerationInput：视频操作只留 prompt/aspect/megapixels/duration', () => {
  const input = buildGenerationInput('image2videofl2va', {
    prompt: 'p', aspect: '1:1', megapixels: 0.4, duration: 5,
    width: 1024, height: 1024, system_prompt: 'x', lyrics: 'y',
  })
  assert.deepEqual(input, { prompt: 'p', aspect: '1:1', megapixels: 0.4, duration: 5 })
})

test('buildGenerationInput：asr2txt 白名单为空（不传 input）', () => {
  assert.deepEqual(buildGenerationInput('asr2txt', { prompt: 'x', anything: 1 }), {})
})

// ── input 数值范围 ───────────────────────────────────────────────────────────

test('validateGenerationInput：图片宽高 1..8192，越界报问题', () => {
  const ok = validateGenerationInput('txt2image', { prompt: 'p', width: 1024, height: 768 })
  assert.deepEqual(ok, [])
  const bad = validateGenerationInput('txt2image', { prompt: 'p', width: 8193, height: 0 })
  assert.equal(bad.length, 2)
})

test('validateGenerationInput：aspect 枚举（1:1 已官方支持）+ megapixels/duration 范围', () => {
  assert.deepEqual(validateGenerationInput('image2videofl2va', { aspect: '1:1', megapixels: 0.01, duration: 60 }), [])
  const bad = validateGenerationInput('image2videofl2va', { aspect: '4:5', megapixels: 17, duration: 61 })
  assert.equal(bad.length, 3)
})

test('validateGenerationInput：prompt 字节上限按 operation 分档（8000 / 20000）', () => {
  const long = '中'.repeat(8001) // UTF-8 每字 3 字节，字符数没超但字节超
  assert.equal(validateGenerationInput('txt2image', { prompt: long }).length, 1)
  // txt2speech 上限 20000 字节：7999 个汉字 ≈ 24k 字节超；txt2image 反而更早超。
  const long2 = '中'.repeat(7000) // 21000 字节
  assert.equal(validateGenerationInput('txt2speech', { prompt: long2 }).length, 1)
  assert.equal(validateGenerationInput('txt2audio', { prompt: '中'.repeat(6000) }).length, 0) // 18k 字节 < 20k
})

test('validateGenerationInput：system_prompt 按字符 2000、key_scale 等按字节 80', () => {
  assert.equal(validateGenerationInput('image2vl', { system_prompt: 'x'.repeat(2001) }).length, 1)
  assert.equal(validateGenerationInput('image2vl', { system_prompt: 'x'.repeat(2000) }).length, 0)
  assert.equal(validateGenerationInput('txt2audio', { key_scale: 'B'.repeat(81) }).length, 1)
})

test('validateGenerationInput：txt2audio 的 duration 1..600 / bpm 1..400', () => {
  assert.deepEqual(validateGenerationInput('txt2audio', { duration: 600, bpm: 400 }), [])
  assert.equal(validateGenerationInput('txt2audio', { duration: 601, bpm: 401 }).length, 2)
})

// ── inputs[] 角色与 ordinal ──────────────────────────────────────────────────

test('buildInputRefs：按 role 分别从 1 连续编号；重复 asset 返回 null', () => {
  const refs = buildInputRefs([
    { assetId: 'a', role: 'image' },
    { assetId: 'b', role: 'video' },
    { assetId: 'c', role: 'image' },
    { assetId: 'd', role: 'audio' },
  ])
  assert.deepEqual(refs, [
    { asset_id: 'a', role: 'image', ordinal: 1 },
    { asset_id: 'b', role: 'video', ordinal: 1 },
    { asset_id: 'c', role: 'image', ordinal: 2 },
    { asset_id: 'd', role: 'audio', ordinal: 1 },
  ])
  assert.equal(buildInputRefs([{ assetId: 'a', role: 'image' }, { assetId: 'a', role: 'image' }]), null)
})

test('validateInputRefs：fl2va 最多 2 张图（ordinal 1=首帧 2=尾帧）', () => {
  const two = buildInputRefs([{ assetId: 'a', role: 'image' }, { assetId: 'b', role: 'image' }])
  assert.deepEqual(validateInputRefs('image2videofl2va', two), [])
  const three = buildInputRefs([
    { assetId: 'a', role: 'image' }, { assetId: 'b', role: 'image' }, { assetId: 'c', role: 'image' },
  ])
  // 3 张超上限：角色数量（0..2）与总数（0..2）各报一条。
  assert.equal(validateInputRefs('image2videofl2va', three).length, 2)
})

test('validateInputRefs：ref2va 图≤9/视≤3/音≤3、总数≤15；超限与角色不符都拦', () => {
  const ok = buildInputRefs([
    ...Array.from({ length: 9 }, (_, i) => ({ assetId: `i${i}`, role: 'image' })),
    ...Array.from({ length: 3 }, (_, i) => ({ assetId: `v${i}`, role: 'video' })),
    ...Array.from({ length: 3 }, (_, i) => ({ assetId: `a${i}`, role: 'audio' })),
  ])
  assert.deepEqual(validateInputRefs('image2videoref2va', ok), [])
  const oneMore = buildInputRefs([
    ...Array.from({ length: 10 }, (_, i) => ({ assetId: `i${i}`, role: 'image' })),
    ...Array.from({ length: 3 }, (_, i) => ({ assetId: `v${i}`, role: 'video' })),
    ...Array.from({ length: 3 }, (_, i) => ({ assetId: `a${i}`, role: 'audio' })),
  ])
  // 图 10 > 9 与总数 16 > 15 各报一条。
  assert.equal(validateInputRefs('image2videoref2va', oneMore).length, 2)
})

test('validateInputRefs：纯文生不接受任何素材；asr2txt 只收一个 audio 或 video', () => {
  const one = buildInputRefs([{ assetId: 'a', role: 'image' }])
  assert.equal(validateInputRefs('txt2image', one).length, 2) // 角色不符 + 总数不符
  const img = buildInputRefs([{ assetId: 'a', role: 'image' }])
  // asr2txt 总数恰好 1 合规，但 image 不在其角色规格里 → 只有「角色不符」一条。
  assert.equal(validateInputRefs('asr2txt', img).length, 1)
  const both = buildInputRefs([{ assetId: 'a', role: 'audio' }, { assetId: 'b', role: 'video' }])
  assert.equal(validateInputRefs('asr2txt', both).length, 1) // 总数 2 > 1
  const ok = buildInputRefs([{ assetId: 'a', role: 'video' }])
  assert.deepEqual(validateInputRefs('asr2txt', ok), [])
})

test('validateInputRefs：ordinal 必须从 1 连续（跳号报缺）', () => {
  assert.equal(validateInputRefs('image2image', [
    { asset_id: 'a', role: 'image', ordinal: 2 },
  ]).length, 1)
  assert.deepEqual(validateInputRefs('image2image', [
    { asset_id: 'a', role: 'image', ordinal: 1 },
  ]), [])
})

// ── 状态机 ───────────────────────────────────────────────────────────────────

test('状态机：finalizing / cancel_requested 不是终态（§6.9.3）', () => {
  assert.equal(isTerminalGenerationStatus('finalizing'), false)
  assert.equal(isTerminalGenerationStatus('cancel_requested'), false)
  assert.equal(isTerminalGenerationStatus('credit_held'), false)
  for (const status of TERMINAL_GENERATION_STATUSES) {
    assert.equal(isTerminalGenerationStatus(status), true)
  }
  assert.equal(isGenerationStatus('queued'), true)
  assert.equal(isGenerationStatus('SUCCEEDED'), false)
  assert.equal(isGenerationStatus(null), false)
})

// ── 快照解析 ─────────────────────────────────────────────────────────────────

const CREATE_202_SAMPLE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  model_id: '55555555-5555-4555-8555-000000000004',
  operation: 'txt2image',
  status: 'credit_held',
  version: 1,
  progress: 0,
  billing_status: 'held',
  terminal: false,
  poll_after_ms: 0,
  outputs: [],
  error: null,
  created_at: '2026-11-15T12:00:00Z',
  updated_at: '2026-11-15T12:00:00Z',
}

test('parseGenerationSnapshot：文档 §6.8 的 202 样例原样通过', () => {
  const snapshot = parseGenerationSnapshot(CREATE_202_SAMPLE)
  assert.notEqual(snapshot, null)
  assert.equal(snapshot.status, 'credit_held')
  assert.equal(snapshot.terminal, false)
  assert.equal(snapshot.version, 1)
  assert.deepEqual(snapshot.outputs, [])
  assert.equal(snapshot.error, null)
})

test('parseGenerationSnapshot：关键字段缺失/类型坏一律 null（不猜）', () => {
  for (const key of ['id', 'operation', 'status', 'version', 'terminal', 'outputs']) {
    const broken = { ...CREATE_202_SAMPLE }
    delete broken[key]
    assert.equal(parseGenerationSnapshot(broken), null, `缺 ${key} 应为 null`)
  }
  assert.equal(parseGenerationSnapshot({ ...CREATE_202_SAMPLE, status: 'RUNNING' }), null)
  assert.equal(parseGenerationSnapshot({ ...CREATE_202_SAMPLE, version: -1 }), null)
  assert.equal(parseGenerationSnapshot({ ...CREATE_202_SAMPLE, terminal: 'no' }), null)
  assert.equal(parseGenerationSnapshot({ ...CREATE_202_SAMPLE, outputs: '[]' }), null)
  assert.equal(parseGenerationSnapshot(null), null)
})

test('parseGenerationSnapshot：progress 越界钳 0..100；billing_status 未知落 none', () => {
  const s = parseGenerationSnapshot({ ...CREATE_202_SAMPLE, progress: 140, billing_status: 'weird' })
  assert.equal(s.progress, 100)
  assert.equal(s.billing_status, 'none')
})

test('parseGenerationSnapshot：error 对象解析；outputs 含二进制/文本/ASR 三形态', () => {
  const snapshot = parseGenerationSnapshot({
    ...CREATE_202_SAMPLE,
    status: 'succeeded',
    terminal: true,
    error: { code: 'provider_error', message: 'x' },
    outputs: [
      { ordinal: 0, type: 'image', mime_type: 'image/png', content_url: '/v1/generations/x/content/0', width: 1024, height: 768 },
      { ordinal: 0, type: 'text', mime_type: 'text/plain', text: '画面中的人物站在窗边。' },
      { ordinal: 0, type: 'json', mime_type: 'application/json', txt: 't', txt_word: 'w', txt_segment: 's' },
    ],
  })
  assert.equal(snapshot.error.code, 'provider_error')
  assert.equal(snapshot.outputs.length, 3)
  assert.equal(snapshot.outputs[0].content_url, '/v1/generations/x/content/0')
  assert.equal(snapshot.outputs[1].text, '画面中的人物站在窗边。')
  assert.equal(snapshot.outputs[2].txt_segment, 's')
})

test('parseGenerationOutputs：任一项形状坏整体 null（不静默丢输出）', () => {
  assert.equal(parseGenerationOutputs([{ ordinal: 0, type: 'image', mime_type: 'image/png' }]).length, 1)
  assert.equal(parseGenerationOutputs([{ ordinal: 0, type: 'pdf', mime_type: 'application/pdf' }]), null)
  assert.equal(parseGenerationOutputs([{ ordinal: -1, type: 'image', mime_type: 'image/png' }]), null)
  assert.equal(parseGenerationOutputs('[]'), null)
})

// ── 报价 / 轮询参数 / 列表 ───────────────────────────────────────────────────

test('parseGenerationQuote：数字才收，负数/字符串/缺失一律 null', () => {
  assert.equal(parseGenerationQuote({ estimated_credits: 18.432 }).estimated_credits, 18.432)
  assert.equal(parseGenerationQuote({ estimated_credits: -1 }), null)
  assert.equal(parseGenerationQuote({ estimated_credits: '18' }), null)
  assert.equal(parseGenerationQuote({}), null)
  assert.equal(parseGenerationQuote(null), null)
})

test('formatPollWait：钳 0..25，输出 25s 形态', () => {
  assert.equal(formatPollWait(25), '25s')
  assert.equal(formatPollWait(30), '25s')
  assert.equal(formatPollWait(0), '0s')
  assert.equal(formatPollWait(-5), '0s')
  assert.equal(formatPollWait(7.6), '8s')
  assert.equal(formatPollWait(Number.NaN), '0s')
})

test('isGenerationId：只认 UUID 形态（路径拼接防注入）', () => {
  assert.equal(isGenerationId('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'), true)
  assert.equal(isGenerationId('../../etc/passwd'), false)
  assert.equal(isGenerationId('abc'), false)
  assert.equal(isGenerationId(''), false)
})

test('buildGenerationListQuery：limit 1..200、status/cursor 合法才进串', () => {
  assert.equal(buildGenerationListQuery({ limit: 30 }), '?limit=30')
  assert.equal(buildGenerationListQuery({ limit: 500 }), '')
  assert.equal(buildGenerationListQuery({ status: 'failed' }), '?status=failed')
  assert.equal(buildGenerationListQuery({ status: 'WEIRD' }), '')
  assert.equal(buildGenerationListQuery({ cursor: 'eyJ' }), '?cursor=eyJ')
  assert.equal(buildGenerationListQuery({}), '')
})

// ── 上传三段式契约 ───────────────────────────────────────────────────────────

test('normalizeChecksumHex：大小写都收、归一小写；长度/字符不符 null', () => {
  assert.equal(normalizeChecksumHex('AB'.padEnd(64, '0')), 'ab'.padEnd(64, '0'))
  assert.equal(normalizeChecksumHex('zz'.padEnd(64, '0')), null)
  assert.equal(normalizeChecksumHex('ab'), null)
})

const PRESIGN_SAMPLE = {
  asset: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',
    type: 'image',
    status: 'uploading',
    mime_type: 'image/png',
    expires_at: '2026-11-17T12:00:00Z',
    created_at: '2026-11-15T12:00:00Z',
    updated_at: '2026-11-15T12:00:00Z',
  },
  upload_url: 'https://blob.example.com/signed-put',
  headers: { 'content-type': 'image/png' },
  expires_at: '2026-11-15T12:10:00Z',
}

test('parseAssetPresignResponse：文档 §6.6.1 样例通过；缺 asset/upload_url 为 null', () => {
  const parsed = parseAssetPresignResponse(PRESIGN_SAMPLE)
  assert.equal(parsed.asset.id, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002')
  assert.deepEqual(parsed.headers, { 'content-type': 'image/png' })
  assert.equal(parseAssetPresignResponse({ ...PRESIGN_SAMPLE, upload_url: '' }), null)
  assert.equal(parseAssetPresignResponse({ ...PRESIGN_SAMPLE, asset: { id: '' } }), null)
  assert.equal(parseAssetPresignResponse('x'), null)
})

test('parseAssetCompleteResponse：只有 status=ready 且 id 为 UUID 才通过（§6.6.3）', () => {
  const ready = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', type: 'image', status: 'ready' }
  assert.equal(parseAssetCompleteResponse(ready).id, ready.id)
  assert.equal(parseAssetCompleteResponse({ ...ready, status: 'uploading' }), null)
  assert.equal(parseAssetCompleteResponse({ id: 'x', type: 'image', status: 'ready' }), null)
})

test('assertSafeAssetUploadUrl：https/回环 http 放行；公网 http、userinfo、垃圾串 502', () => {
  assert.equal(assertSafeAssetUploadUrl('https://blob.example.com/put'), 'https://blob.example.com/put')
  assert.equal(assertSafeAssetUploadUrl('http://127.0.0.1:9000/put'), 'http://127.0.0.1:9000/put')
  assert.throws(() => assertSafeAssetUploadUrl('http://blob.example.com/put'), (e) => {
    assert.ok(e instanceof ApiError)
    return e.code === 'invalid_response' && e.status === 502
  })
  assert.throws(() => assertSafeAssetUploadUrl('https://user:pass@blob.example.com/put'), /用户名/)
  assert.throws(() => assertSafeAssetUploadUrl('not a url'), /不是合法 URL/)
})

// ── DramaClient 生成面方法（假 fetch 桩）────────────────────────────────────

function fakeClient(handler) {
  return new DramaClient({
    baseUrl: 'http://biz.test',
    deviceId: () => 'dev',
    platform: () => 'darwin',
    appVersion: () => '0.0.0',
    fetchImpl: async (url, init) => handler(url, init),
  })
}

test('DramaClient.createGeneration：携带 Idempotency-Key / X-Client-Run-ID，202 快照返回', async () => {
  let seen
  const client = fakeClient(async (url, init) => {
    seen = { url: String(url), headers: init.headers, body: JSON.parse(init.body) }
    return new Response(JSON.stringify(CREATE_202_SAMPLE), { status: 202, headers: { 'content-type': 'application/json' } })
  })
  const snapshot = await client.createGeneration(
    'tok',
    { model: 'image.qwen-image-2.1', operation: 'txt2image', input: { prompt: 'p', width: 1024, height: 768 } },
    'idem-key-1',
    'desktop-run-1',
  )
  assert.equal(snapshot.id, CREATE_202_SAMPLE.id)
  assert.equal(seen.url, 'http://biz.test/v1/generations')
  assert.equal(seen.headers['Idempotency-Key'], 'idem-key-1')
  assert.equal(seen.headers['X-Client-Run-ID'], 'desktop-run-1')
  assert.equal(seen.body.operation, 'txt2image')
})

test('DramaClient.createGeneration：非法幂等键本地 400 拦下（不打请求）', async () => {
  let called = false
  const client = fakeClient(async () => { called = true; return new Response('{}', { status: 400 }) })
  await assert.rejects(
    () => client.createGeneration('tok', { model: 'm', operation: 'txt2image', input: {} }, 'bad key\n'),
    (e) => e.code === 'invalid_argument',
  )
  assert.equal(called, false)
})

test('DramaClient.createGeneration：202 但形状坏 → invalid_response 502', async () => {
  const client = fakeClient(async () => new Response(JSON.stringify({ id: 'x' }), { status: 202 }))
  await assert.rejects(() => client.createGeneration('tok', { model: 'm', operation: 'txt2image', input: {} }, 'k'),
    (e) => e.code === 'invalid_response' && e.status === 502)
})

test('DramaClient.pollGeneration：URL 带 after_version + wait 钳制；游标原样透传', async () => {
  let seen
  const client = fakeClient(async (url) => {
    seen = String(url)
    return new Response(JSON.stringify({ ...CREATE_202_SAMPLE, version: 8 }), { status: 200 })
  })
  const snapshot = await client.pollGeneration('tok', CREATE_202_SAMPLE.id, 7, 30)
  assert.equal(snapshot.version, 8)
  assert.equal(seen, `http://biz.test/v1/generations/${CREATE_202_SAMPLE.id}/poll?after_version=7&wait=25s`)
})

test('DramaClient.pollGeneration：非法 generation id 本地 400', async () => {
  const client = fakeClient(async () => new Response('{}', { status: 200 }))
  await assert.rejects(() => client.pollGeneration('tok', '../etc', 0, 0), (e) => e.status === 400)
})

test('DramaClient.listGenerations：坏帧跳过、next_cursor 透传', async () => {
  const client = fakeClient(async () => new Response(JSON.stringify({
    generations: [CREATE_202_SAMPLE, { id: 'broken' }],
    next_cursor: 'eyJ',
  }), { status: 200 }))
  const page = await client.listGenerations('tok', { limit: 30 })
  assert.equal(page.generations.length, 1)
  assert.equal(page.next_cursor, 'eyJ')
})

test('DramaClient.presignAsset：不安全 upload_url 在 Host 侧被 502 拦下', async () => {
  const client = fakeClient(async () => new Response(JSON.stringify({
    ...PRESIGN_SAMPLE,
    upload_url: 'http://blob.example.com/put',
  }), { status: 201 }))
  await assert.rejects(() => client.presignAsset('tok', { type: 'image', filename: 'a.png', content_type: 'image/png', size_bytes: 1 }),
    (e) => e.code === 'invalid_response' && e.status === 502)
})

test('DramaClient.completeAsset：status≠ready → invalid_response', async () => {
  const client = fakeClient(async () => new Response(JSON.stringify({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', type: 'image', status: 'uploading',
  }), { status: 200 }))
  await assert.rejects(
    () => client.completeAsset('tok', { asset_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', checksum_sha256: '0'.repeat(64), size_bytes: 1 }),
    (e) => e.code === 'invalid_response',
  )
})

test('DramaClient.quoteGeneration：200 样例返回 estimated_credits；非 JSON 形状 502', async () => {
  const ok = fakeClient(async () => new Response(JSON.stringify({ estimated_credits: 18.432 }), { status: 200 }))
  assert.equal((await ok.quoteGeneration('tok', { model: 'm', operation: 'txt2image', input: {} })).estimated_credits, 18.432)
  const bad = fakeClient(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }))
  await assert.rejects(() => bad.quoteGeneration('tok', { model: 'm', operation: 'txt2image', input: {} }),
    (e) => e.code === 'invalid_response')
})

// ── 目录消费 ─────────────────────────────────────────────────────────────────

test('modelSupportsOperation：operations 显式包含 + available/entitled 都要过', () => {
  const model = (over = {}) => ({
    capabilities: { operations: ['txt2image', 'image2image'], inputs: ['text'], outputs: ['image'] },
    available: true,
    entitled: true,
    ...over,
  })
  assert.equal(modelSupportsOperation(model(), 'txt2image'), true)
  assert.equal(modelSupportsOperation(model(), 'txt2audio'), false)
  assert.equal(modelSupportsOperation(model({ available: false }), 'txt2image'), false)
  assert.equal(modelSupportsOperation(model({ entitled: false }), 'txt2image'), false)
  // 目录未声明 operations：生成面要求显式声明，未声明不许提交。
  assert.equal(modelSupportsOperation({ capabilities: {} }, 'txt2image'), false)
  assert.equal(modelSupportsOperation({ capabilities: { operations: [] } }, 'txt2image'), false)
})

test('操作全集与文档 §6.4 矩阵一致（10 个，每个都有 input 白名单）', () => {
  assert.equal(GENERATION_OPERATIONS.length, 10)
  for (const op of GENERATION_OPERATIONS) {
    assert.equal(typeof buildGenerationInput(op, {}), 'object')
  }
})
