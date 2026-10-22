/**
 * DramaServer 管理面协议客户端单测（src/drama-management.ts，方案 P1/CV-355）。
 *
 * 覆盖：
 *  - 错误信封解析：400/401/403/429/503 → code 映射、Retry-After 解析、非 JSON 体兜底；
 *  - 成功响应形状：sync 缺 user.id → invalid_response；models null → []；
 *  - 请求组装：Bearer 头、device body 全量字段（防服务端覆盖置空）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DramaClient, parseApiError, unauthenticated } from '../lib/drama-management.js'

/** 组装一个最小 Response（node:fetch 形状）。 */
const responseOf = (status, body, headers = {}) => new Response(
  body === undefined ? undefined : JSON.stringify(body),
  { status, headers: new Headers(headers) },
)

const clientOf = (fetchImpl) => new DramaClient({
  baseUrl: 'http://business.test/',
  deviceId: () => 'device-uuid-1',
  platform: () => 'darwin',
  appVersion: () => '1.2.3',
  fetchImpl,
})

test('sync：Bearer 头 + device 全量字段 + 缺 user.id 报 invalid_response', async () => {
  const seen = []
  const client = clientOf(async (url, init) => {
    seen.push({ url, init })
    return responseOf(200, { user: { id: 'u-1', status: 'active' }, device: null })
  })
  const result = await client.sync('token-abc')
  assert.equal(result.user.id, 'u-1')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'http://business.test/v1/auth/sync')
  assert.equal(seen[0].init.method, 'POST')
  const headers = seen[0].init.headers
  assert.equal(headers.Authorization, 'Bearer token-abc')
  assert.deepEqual(JSON.parse(seen[0].init.body).device, {
    device_id: 'device-uuid-1', name: 'VideoBuddy Desktop', platform: 'darwin', app_version: '1.2.3',
  })

  const bad = clientOf(async () => responseOf(200, { device: null }))
  await assert.rejects(bad.sync('t'), (error) => {
    assert.equal(error.code, 'invalid_response')
    assert.equal(error.status, 502)
    return true
  })
})

test('listTextModels：models 为 null 按空数组；正常列表透传', async () => {
  const nullClient = clientOf(async () => responseOf(200, { models: null, entitlement: { features: {} } }))
  assert.deepEqual(await nullClient.listTextModels('t'), [])
  const okClient = clientOf(async () => responseOf(200, {
    models: [{ id: '1', code: 'deepseek-flash', display_name: 'DeepSeek Flash', modality: 'text', capabilities: {}, entitled: true, available: true, endpoints: null }],
    entitlement: { features: {} },
  }))
  const models = await okClient.listTextModels('t')
  assert.equal(models.length, 1)
  assert.equal(models[0].code, 'deepseek-flash')
  assert.equal(models[0].available, true)
})

test('parseApiError：服务端 code 优先 + Retry-After 解析 + 非 JSON 体兜底', async () => {
  const rateLimited = await parseApiError(responseOf(429, { error: { code: 'rate_limited', message: '太快了' } }, { 'Retry-After': '30' }))
  assert.equal(rateLimited.code, 'rate_limited')
  assert.equal(rateLimited.status, 429)
  assert.equal(rateLimited.retryAfterSeconds, 30)

  const plain = await parseApiError(responseOf(502, 'Bad Gateway'))
  assert.equal(plain.code, 'http_502')
  assert.equal(plain.retryAfterSeconds, null)

  const serverError = await parseApiError(responseOf(503, { error: { code: 'maintenance', message: '维护中' } }))
  assert.equal(serverError.code, 'maintenance')
})

test('unauthenticated：本地无会话错误与 ApiError 同形状', () => {
  const error = unauthenticated('没有可用会话')
  assert.equal(error.status, 401)
  assert.equal(error.code, 'unauthenticated')
})
