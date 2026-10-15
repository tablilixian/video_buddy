/**
 * P2 登录态接线守卫：Drama 请求的 Bearer 注入 + 鉴权闸 + 401 归一（CS-AUTH-001）。
 *
 * 覆盖（import 的是 `lib/**` 编译产物 —— 跑测试前必须先 build，见全仓约定）：
 * 1. dramaAuthHeaders：有会话 = `Bearer <token>`；无会话 = 空对象（不塞假头）。
 * 2. 鉴权闸 fail-open：开关关闭（默认 / 测试态）时无会话照常发请求。
 * 3. 鉴权闸 fail-fast：开关开启 + 无会话 → uploadBytesToDrama 抛 CS-AUTH-001，
 *    且**零网络请求**（fetch 桩零命中）。
 * 4. header 注入：开关开启 + 有会话 → upload / 任务轮询（dramaJobRequest）/ health
 *    探针的请求都带 `authorization: Bearer …`。
 * 5. 401 归一：upload 与 dramaPost（submit）遇 HTTP 401 → CanvasStudioError
 *    CS-AUTH-001（不是通用网络/非 2xx 码），供客户端自愈链按码路由。
 *
 * fetch 全打桩（不触真实后端）；结束态复位（clearAuthSession + 关开关），
 * 不污染同进程的其它测试文件。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadBytesToDrama, dramaJobRequest, generateAsset, resetDramaProbeCache } from '../lib/generate.js'
import { CanvasStudioError } from '../lib/error-system.js'
import {
  setAuthSession,
  clearAuthSession,
  dramaAuthHeaders,
  setDramaAuthRequired,
  isDramaAuthRequired,
} from '../lib/auth-session.js'
import '../lib/errors/catalog.js'

const SESSION = {
  accessToken: 'test-jwt-token',
  expiresAt: 9999999999,
  userId: 'user-1',
  email: 't@example.com',
}

/** health 探针放行桩（所有 upload / submit 前置探针都会打它）。 */
function stubHealth(calls) {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      calls.push({ url: text, method: init.method ?? 'GET', headers: init.headers ?? {} })
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    return realFetch(url, init)
  }
}

test('dramaAuthHeaders: 有会话 = Bearer，无会话 = 空', () => {
  clearAuthSession()
  assert.deepEqual(dramaAuthHeaders(), {})
  setAuthSession(SESSION)
  assert.deepEqual(dramaAuthHeaders(), { authorization: `Bearer ${SESSION.accessToken}` })
  clearAuthSession()
})

test('鉴权闸 fail-open：开关关闭时无会话照常上传（不带头）', async () => {
  setDramaAuthRequired(false)
  clearAuthSession()
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} })
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    return { ok: true, status: 200, json: async () => ({ filename: 'ref.png' }) }
  }
  try {
    const filename = await uploadBytesToDrama(new Uint8Array([1]), 'png')
    assert.equal(filename, 'ref.png')
    const upload = calls.find((c) => c.url.includes('/upload'))
    assert.ok(upload, 'upload 请求已发出')
    assert.equal(upload.headers.authorization, undefined)
  } finally {
    resetDramaProbeCache()
  }
})

test('鉴权闸 fail-fast：开关开启 + 无会话 → CS-AUTH-001 且零网络', async () => {
  setDramaAuthRequired(true)
  clearAuthSession()
  const calls = []
  stubHealth(calls)
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} })
    return { ok: true, status: 200, json: async () => ({ filename: 'ref.png' }) }
  }
  try {
    await assert.rejects(
      uploadBytesToDrama(new Uint8Array([1]), 'png'),
      (err) => err instanceof CanvasStudioError && err.code === 'CS-AUTH-001',
    )
    assert.equal(calls.length, 0, '未登录不得发出任何网络请求（含探针）')
  } finally {
    resetDramaProbeCache()
    setDramaAuthRequired(false)
    clearAuthSession()
  }
})

test('header 注入：upload / dramaJobRequest / health 都带 Bearer', async () => {
  setDramaAuthRequired(true)
  setAuthSession(SESSION)
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} })
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    return { ok: true, status: 200, json: async () => ({ filename: 'ref.png', status: 'running' }) }
  }
  try {
    await uploadBytesToDrama(new Uint8Array([1]), 'png')
    await dramaJobRequest('GET', '/api/v1/jobs/j1')
    const upload = calls.find((c) => c.url.includes('/upload'))
    const job = calls.find((c) => c.url.includes('/api/v1/jobs/j1'))
    const health = calls.find((c) => c.url.includes('/api/v1/health'))
    assert.equal(upload.headers.authorization, `Bearer ${SESSION.accessToken}`)
    assert.equal(job.headers.authorization, `Bearer ${SESSION.accessToken}`)
    assert.equal(health.headers.authorization, `Bearer ${SESSION.accessToken}`)
    // POST 轮询（cancel）的 content-type 与 Bearer 并存。
    await dramaJobRequest('POST', '/api/v1/jobs/j1/cancel')
    const cancel = calls.find((c) => c.url.includes('/cancel'))
    assert.equal(cancel.headers.authorization, `Bearer ${SESSION.accessToken}`)
    assert.equal(cancel.headers['content-type'], 'application/json')
  } finally {
    resetDramaProbeCache()
    setDramaAuthRequired(false)
    clearAuthSession()
  }
})

test('401 归一：upload 遇 HTTP 401 → CS-AUTH-001', async () => {
  setDramaAuthRequired(true)
  setAuthSession(SESSION)
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    return { ok: false, status: 401, json: async () => ({ error: 'invalid token' }) }
  }
  try {
    await assert.rejects(
      uploadBytesToDrama(new Uint8Array([1]), 'png'),
      (err) => err instanceof CanvasStudioError && err.code === 'CS-AUTH-001',
    )
  } finally {
    resetDramaProbeCache()
    setDramaAuthRequired(false)
    clearAuthSession()
  }
})

test('401 归一：submit（generateAsset → dramaPost）遇 HTTP 401 → CS-AUTH-001，且不重试', async () => {
  // dramaPost 未导出 —— 经最小 image_generate 流程走真 submit 路径：401 必须在
  // 5xx 自动重试分支**之前**归一成 CS-AUTH-001（断言 submit 只打一次 = 没重试）。
  // 401 抛出发生在任何磁盘读写之前，registry 用纯桩 + 占位路径即可（不建临时
  // 目录 —— 沙箱可能拦 temp 目录删除，别让清理失败淹没断言）。
  setDramaAuthRequired(true)
  setAuthSession(SESSION)
  let submitCalls = 0
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    submitCalls += 1
    return { ok: false, status: 401, json: async () => ({ error: 'invalid token' }) }
  }
  const registry = {
    list: async () => [{ id: 'p1', name: 'P1', dir: '/tmp/cs-auth401-unused', createdAt: 1 }],
    assetsDir: () => '/tmp/cs-auth401-unused',
    readCanvas: async () => ({ version: 3, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
  }
  try {
    await assert.rejects(
      generateAsset(registry, 'image_generate', 'p1', { prompt: 'x' }),
      (err) => err instanceof CanvasStudioError && err.code === 'CS-AUTH-001',
    )
    assert.equal(submitCalls, 1, '401 不进 5xx 自动重试分支')
  } finally {
    resetDramaProbeCache()
    setDramaAuthRequired(false)
    clearAuthSession()
  }
})
