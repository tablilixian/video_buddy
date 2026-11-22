/**
 * 素材三段式上传引擎契约（迁移方案 B2；`src/asset-upload.ts` + generate.ts 装配）。
 *
 * 锁 api(12).md §6.6 的四件硬事：
 *   1. PUT 直传**只带 presign.headers**——多一个 Authorization 都可能破坏对象存储签名；
 *   2. presign 请求体字段（type/filename/content_type/size_bytes）与安全文件名约定；
 *   3. complete 请求体（asset_id/checksum_sha256 小写 64hex/size_bytes），只有
 *      `status:'ready'` 才返回 asset_id；
 *   4. 401 → CS-AUTH-001（登录自愈链入口码）、409 → CS-ASSET-004、
 *      不安全 upload_url → CS-ASSET-005、429 → Retry-After 有界重试一次。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DramaClient } from '../lib/drama-management.js'
import { assetKindFromExtension, mimeTypeForExtension, uploadAssetBytes } from '../lib/asset-upload.js'
import { uploadBytesToDrama } from '../lib/generate.js'
import { CanvasStudioError } from '../lib/error-system.js'

const ASSET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'

/**
 * 引擎接线桩：presign/complete 经 DramaClient.fetchImpl、PUT 走 globalThis.fetch
 * ——三段路由到**同一个** handler，一次覆盖全流程；返回 restore 函数复原全局 fetch。
 */
function engineWith(handler, calls = []) {
  const route = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    return handler(String(url), init ?? {})
  }
  const client = new DramaClient({
    baseUrl: 'http://biz.test',
    deviceId: () => 'dev',
    platform: () => 'darwin',
    appVersion: () => '0',
    fetchImpl: route,
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = route
  return {
    client,
    restore: () => { globalThis.fetch = realFetch },
  }
}

/** 三段式全绿 handler：presign 201 → PUT 200 → complete ready。 */
function happyHandler() {
  return async (url) => {
    if (url.includes('/v1/assets/presign')) {
      return new Response(JSON.stringify({
        asset: { id: ASSET_ID, type: 'image', status: 'uploading', mime_type: 'image/png' },
        upload_url: 'https://blob.test/put/ref',
        headers: { 'content-type': 'image/png' },
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    if (url === 'https://blob.test/put/ref') {
      return new Response(null, { status: 200 })
    }
    if (url.includes('/v1/assets/complete')) {
      return new Response(JSON.stringify({ id: ASSET_ID, type: 'image', status: 'ready' }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
}

test('三段式全流程：返回 asset_id，presign/complete 带 Bearer、PUT 只带签名头', async () => {
  const calls = []
  const { client, restore } = engineWith(happyHandler(), calls)
  try {
    const id = await uploadAssetBytes(client, 'jwt-1', new Uint8Array([1, 2, 3]), { filename: 'ref-abc.png', kind: 'image' })
    assert.equal(id, ASSET_ID)

    const presign = calls.find((c) => c.url.includes('/v1/assets/presign'))
    const put = calls.find((c) => c.method === 'PUT')
    const complete = calls.find((c) => c.url.includes('/v1/assets/complete'))
    assert.ok(presign && put && complete, '三段各发一次请求')

    // presign：Bearer（DramaClient 用标准 `Authorization` 头名）+ 字段完备。
    assert.equal(presign.headers.Authorization, 'Bearer jwt-1')
    assert.deepEqual(JSON.parse(presign.body), {
      type: 'image', filename: 'ref-abc.png', content_type: 'image/png', size_bytes: 3,
    })

    // PUT：**绝不带 Authorization**（大小写都不得出现）；只带 presign 给的 content-type。
    assert.equal(put.url, 'https://blob.test/put/ref')
    assert.equal(put.headers.Authorization ?? put.headers.authorization, undefined, 'PUT 直传不得携带任何鉴权头')
    assert.equal(put.headers['content-type'], 'image/png')

    // complete：Bearer + SHA-256（64 位小写 hex）。
    assert.equal(complete.headers.Authorization, 'Bearer jwt-1')
    const completeBody = JSON.parse(complete.body)
    assert.equal(completeBody.asset_id, ASSET_ID)
    assert.equal(completeBody.size_bytes, 3)
    assert.match(completeBody.checksum_sha256, /^[0-9a-f]{64}$/)
  } finally {
    restore()
  }
})

test('complete 非 ready → CS-ASSET-003；409 conflict → CS-ASSET-004', async () => {
  const notReady = engineWith(async (url) => {
    if (url.includes('/v1/assets/presign')) {
      return new Response(JSON.stringify({
        asset: { id: ASSET_ID, type: 'image', status: 'uploading' },
        upload_url: 'https://blob.test/put/ref', headers: {},
      }), { status: 201 })
    }
    if (url === 'https://blob.test/put/ref') return new Response(null, { status: 200 })
    return new Response(JSON.stringify({ id: ASSET_ID, type: 'image', status: 'uploading' }), { status: 200 })
  })
  try {
    await assert.rejects(
      () => uploadAssetBytes(notReady.client, 'jwt', new Uint8Array([1]), { filename: 'a.png', kind: 'image' }),
      (e) => e instanceof CanvasStudioError && e.code === 'CS-ASSET-003',
    )
  } finally {
    notReady.restore()
  }

  const conflict = engineWith(async (url) => {
    if (url.includes('/v1/assets/presign')) {
      return new Response(JSON.stringify({
        asset: { id: ASSET_ID, type: 'image', status: 'uploading' },
        upload_url: 'https://blob.test/put/ref', headers: {},
      }), { status: 201 })
    }
    if (url === 'https://blob.test/put/ref') return new Response(null, { status: 200 })
    return new Response(JSON.stringify({ error: { code: 'conflict', message: 'checksum mismatch' } }), { status: 409 })
  })
  try {
    await assert.rejects(
      () => uploadAssetBytes(conflict.client, 'jwt', new Uint8Array([1]), { filename: 'a.png', kind: 'image' }),
      (e) => e instanceof CanvasStudioError && e.code === 'CS-ASSET-004',
    )
  } finally {
    conflict.restore()
  }
})

test('presign 401 → CS-AUTH-001（登录自愈链入口码）；不安全 upload_url → CS-ASSET-005', async () => {
  const unauthorized = engineWith(async () => new Response(
    JSON.stringify({ error: { code: 'unauthenticated', message: 'authentication required' } }),
    { status: 401 },
  ))
  try {
    await assert.rejects(
      () => uploadAssetBytes(unauthorized.client, '', new Uint8Array([1]), { filename: 'a.png', kind: 'image' }),
      (e) => e instanceof CanvasStudioError && e.code === 'CS-AUTH-001',
    )
  } finally {
    unauthorized.restore()
  }

  const unsafe = engineWith(async () => new Response(JSON.stringify({
    asset: { id: ASSET_ID, type: 'image', status: 'uploading' },
    upload_url: 'http://blob.test/put/ref', // 公网 http：护栏拒绝
    headers: {},
  }), { status: 201 }))
  try {
    await assert.rejects(
      () => uploadAssetBytes(unsafe.client, 'jwt', new Uint8Array([1]), { filename: 'a.png', kind: 'image' }),
      (e) => e instanceof CanvasStudioError && e.code === 'CS-ASSET-005',
    )
  } finally {
    unsafe.restore()
  }
})

test('PUT 失败 → CS-ASSET-002（状态码进文案）', async () => {
  const failing = engineWith(async (url) => {
    if (url.includes('/v1/assets/presign')) {
      return new Response(JSON.stringify({
        asset: { id: ASSET_ID, type: 'image', status: 'uploading' },
        upload_url: 'https://blob.test/put/ref', headers: {},
      }), { status: 201 })
    }
    if (url === 'https://blob.test/put/ref') return new Response(null, { status: 403 })
    return new Response('{}', { status: 200 })
  })
  try {
    await assert.rejects(
      () => uploadAssetBytes(failing.client, 'jwt', new Uint8Array([1]), { filename: 'a.png', kind: 'image' }),
      (e) => e instanceof CanvasStudioError && e.code === 'CS-ASSET-002',
    )
  } finally {
    failing.restore()
  }
})

test('429 rate_limited：Retry-After 后重试一次即成功', async () => {
  let presignCalls = 0
  const rateLimited = engineWith(async (url) => {
    if (url.includes('/v1/assets/presign')) {
      presignCalls += 1
      if (presignCalls === 1) {
        return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }),
          { status: 429, headers: { 'retry-after': '0' } })
      }
      return new Response(JSON.stringify({
        asset: { id: ASSET_ID, type: 'image', status: 'uploading' },
        upload_url: 'https://blob.test/put/ref', headers: {},
      }), { status: 201 })
    }
    if (url === 'https://blob.test/put/ref') return new Response(null, { status: 200 })
    return new Response(JSON.stringify({ id: ASSET_ID, type: 'image', status: 'ready' }), { status: 200 })
  })
  try {
    const id = await uploadAssetBytes(rateLimited.client, 'jwt', new Uint8Array([1]), { filename: 'a.png', kind: 'image' })
    assert.equal(id, ASSET_ID)
    assert.equal(presignCalls, 2, '429 后应恰好重试一次')
  } finally {
    rateLimited.restore()
  }
})

test('扩展名 → 类别 / MIME：白名单齐全，未知类别拒绝', () => {
  assert.equal(assetKindFromExtension('png'), 'image')
  assert.equal(assetKindFromExtension('.mp4'), 'video')
  assert.equal(assetKindFromExtension('.mp3'), 'audio')
  assert.equal(assetKindFromExtension('.txt'), null, '文本类不进生成素材通道')
  assert.equal(assetKindFromExtension('.xyz'), null)
  assert.equal(mimeTypeForExtension('.png'), 'image/png')
  assert.equal(mimeTypeForExtension('.mov'), 'video/quicktime')
  assert.equal(mimeTypeForExtension('.mkv'), 'video/x-matroska')
  assert.equal(mimeTypeForExtension('.nope'), 'application/octet-stream')
})

// ── generate.ts 装配层（global fetch 桩，走默认 businessApiBase）─────────────

const BASE = 'http://117.50.108.73'

function stubBusiness(calls) {
  let lastAsset = null
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    const method = init.method ?? 'GET'
    calls.push({ url: target, method, headers: init.headers ?? {}, body: init.body })
    if (target.startsWith(`${BASE}/v1/assets/presign`)) {
      lastAsset = `aaaaaaaa-aaaa-4aaa-8aaa-${String(calls.length).padStart(12, '0')}`
      return { ok: true, status: 201, json: async () => ({
        asset: { id: lastAsset, type: 'image', status: 'uploading' },
        upload_url: 'https://blob.test/put/ref',
        headers: { 'content-type': 'image/png' },
      }) }
    }
    if (target === 'https://blob.test/put/ref') return { ok: true, status: 200, json: async () => ({}) }
    if (target.startsWith(`${BASE}/v1/assets/complete`)) {
      return { ok: true, status: 200, json: async () => ({ id: lastAsset, type: 'image', status: 'ready' }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  return calls
}

test('uploadBytesToDrama（装配层）：三段走业务 API，无会话 fail-open 发 presign（token 空）', async () => {
  const calls = stubBusiness([])
  const assetId = await uploadBytesToDrama(new Uint8Array([1, 2, 3]), 'png')
  assert.match(assetId, /^[0-9a-f-]{36}$/)
  const presign = calls.find((c) => c.url.includes('/v1/assets/presign'))
  assert.ok(presign, 'presign 应发往 businessApiBase')
  assert.equal(presign.headers.authorization, undefined, '无会话时不带假头')
  const presignBody = JSON.parse(presign.body)
  assert.equal(presignBody.type, 'image')
  assert.equal(presignBody.content_type, 'image/png')
  assert.equal(presignBody.size_bytes, 3)
  // 安全文件名约定：ref-<8 位 hex>.<ext>（与旧通道同一形态）。
  assert.match(presignBody.filename, /^ref-[0-9a-f]{8}\.png$/u)
  const put = calls.find((c) => c.method === 'PUT')
  assert.equal(put.headers.authorization, undefined)
})
