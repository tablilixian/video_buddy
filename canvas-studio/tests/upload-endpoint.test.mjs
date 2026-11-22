/**
 * 素材上传通道契约（迁移方案 B2 重写；api(12).md §6.6）。
 *
 * 背景：旧通道 multipart `POST /api/v1/generate/upload`（ComfyUI `{name}` 句柄）
 * 随生成后端 8082 退役；新通道 = 三段式 `POST /v1/assets/presign` → `PUT upload_url`
 * → `POST /v1/assets/complete`（返回 **asset_id**）。本文件把这条通路的四件事锁死：
 *
 * 1. 路由：presign / complete 打 businessApiBase（默认 `http://117.50.108.73`）的
 *    `/v1/assets/*`；PUT 打 presign 返回的 upload_url（https）。
 * 2. 请求形态：presign filename 走唯一安全名（只含 [A-Za-z0-9._-]）；PUT 只带
 *    presign.headers（不带任何鉴权头——多余头可能破坏对象存储签名）。
 * 3. 响应解析：只有 complete `status:'ready'` 才返回 asset_id；返回值语义从
 *    filename 变为 asset_id（UUID 形态）。
 * 4. 失败有明确中文错误码：401 → CS-AUTH-001；presign/complete 非 2xx →
 *    CS-ASSET-001/003；PUT 非 2xx → CS-ASSET-002。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadBytesToDrama } from '../lib/generate.js'
import { CanvasStudioError } from '../lib/error-system.js'

const BASE = 'http://117.50.108.73'

/** 三段式桩：记录全部请求；presignId 可控，PUT/complete 行为按用例覆盖。 */
function stubThreeStage(opts = {}) {
  const calls = []
  let lastAsset = null
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    const method = init.method ?? 'GET'
    calls.push({ url: target, method, headers: init.headers ?? {}, body: init.body })
    if (target.startsWith(`${BASE}/v1/assets/presign`)) {
      if (opts.presignStatus !== undefined) {
        return { ok: opts.presignStatus < 400, status: opts.presignStatus, json: async () => (opts.presignBody ?? {}) }
      }
      lastAsset = `bbbbbbbb-bbbb-4bbb-8bbb-${String(calls.length).padStart(12, '0')}`
      return {
        ok: true,
        status: 201,
        json: async () => ({
          asset: { id: lastAsset, type: 'image', status: 'uploading' },
          upload_url: 'https://blob.test/put/ref',
          headers: { 'content-type': 'image/png' },
        }),
      }
    }
    if (target === 'https://blob.test/put/ref') {
      const status = opts.putStatus ?? 200
      return { ok: status < 400, status, json: async () => ({}) }
    }
    if (target.startsWith(`${BASE}/v1/assets/complete`)) {
      if (opts.completeStatus !== undefined) {
        return { ok: opts.completeStatus < 400, status: opts.completeStatus, json: async () => (opts.completeBody ?? {}) }
      }
      return { ok: true, status: 200, json: async () => ({ id: lastAsset, type: 'image', status: 'ready' }) }
    }
    return realFetch(url, init)
  }
  return calls
}

test('三段式路由：presign/complete 打业务 API，PUT 打 upload_url，返回 asset_id', async () => {
  const calls = stubThreeStage()
  const assetId = await uploadBytesToDrama(new Uint8Array([1, 2, 3]), 'png')
  assert.match(assetId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    `返回值应为 asset_id（UUID），实际 ${assetId}`)
  const presign = calls.find((c) => c.url.startsWith(`${BASE}/v1/assets/presign`))
  const put = calls.find((c) => c.method === 'PUT')
  const complete = calls.find((c) => c.url.startsWith(`${BASE}/v1/assets/complete`))
  assert.ok(presign && put && complete, '三段各发一次请求')
  assert.equal(presign.method, 'POST')
  assert.equal(complete.method, 'POST')
  assert.equal(put.url, 'https://blob.test/put/ref')
})

test('presign 请求形态：type/content_type/size_bytes 完备 + 唯一安全名', async () => {
  const calls = stubThreeStage()
  await uploadBytesToDrama(new Uint8Array([1, 2, 3]), 'png')
  const presign = calls.find((c) => c.url.includes('/v1/assets/presign'))
  const body = JSON.parse(presign.body)
  assert.equal(body.type, 'image')
  assert.equal(body.content_type, 'image/png')
  assert.equal(body.size_bytes, 3)
  // 唯一安全名：ref-<8 位 uuid>.<ext>——只含 [A-Za-z0-9._-]，且每次不同。
  assert.match(body.filename, /^ref-[0-9a-f]{8}\.png$/u, `presign 文件名不合安全名约定: ${body.filename}`)
})

test('PUT 只带 presign.headers（authorization 必须缺席）', async () => {
  const calls = stubThreeStage()
  await uploadBytesToDrama(new Uint8Array([1]), 'png')
  const put = calls.find((c) => c.method === 'PUT')
  assert.equal(put.headers['content-type'], 'image/png')
  assert.equal(put.headers.authorization, undefined, 'PUT 直传不得携带任何鉴权头（会破坏签名）')
})

test('complete 请求体：asset_id + 64 位小写 hex checksum + size_bytes', async () => {
  const calls = stubThreeStage()
  const assetId = await uploadBytesToDrama(new Uint8Array([1]), 'png')
  const complete = calls.find((c) => c.url.includes('/v1/assets/complete'))
  const body = JSON.parse(complete.body)
  assert.equal(body.asset_id, assetId)
  assert.match(body.checksum_sha256, /^[0-9a-f]{64}$/u)
  assert.equal(body.size_bytes, 1)
})

test('上传失败有明确中文错误码：presign 500 / PUT 403 / complete 非 ready / 401', async () => {
  stubThreeStage({ presignStatus: 500 })
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'png'),
    (err) => err instanceof CanvasStudioError && err.code === 'CS-ASSET-001',
    'presign 非 2xx → CS-ASSET-001',
  )

  stubThreeStage({ putStatus: 403 })
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'png'),
    (err) => err instanceof CanvasStudioError && err.code === 'CS-ASSET-002',
    'PUT 非 2xx → CS-ASSET-002',
  )

  stubThreeStage({ completeStatus: 200, completeBody: { id: 'x', type: 'image', status: 'uploading' } })
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'png'),
    (err) => err instanceof CanvasStudioError && err.code === 'CS-ASSET-003',
    'complete 非 ready → CS-ASSET-003（不得返回未 ready 的 asset）',
  )

  stubThreeStage({ presignStatus: 401, presignBody: { error: { code: 'unauthenticated', message: 'authentication required' } } })
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'png'),
    (err) => err instanceof CanvasStudioError && err.code === 'CS-AUTH-001',
    '401 → CS-AUTH-001（登录自愈链入口码）',
  )
})

test('不支持的扩展名直接拒绝（不发出任何请求）', async () => {
  const calls = stubThreeStage()
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'xyz'),
    (err) => err instanceof CanvasStudioError && err.code === 'CS-USER-ERR',
  )
  assert.equal(calls.length, 0, '扩展名白名单拒绝时零网络请求')
})
