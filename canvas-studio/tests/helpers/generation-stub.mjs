/**
 * 业务 API 生成任务共享桩（迁移 B3-2，2026-11-22）。
 *
 * 流程类测试统一从这里拿 `/v1/generations` 三段分支（create 202 → poll → content），
 * 与 asset-upload-stub（三段式上传）配套使用。可按用例注入：
 * - `shouldFailCreate(body, nth)`：第 n 次创建是否失败（自愈/重试用例）；
 * - `failStatus / failText`：失败形态（默认 500 笼统）；
 * - `pollJson(nth)`：第 n 次轮询的快照（默认第一次 pending、第二次起 succeeded）；
 * - `contentBytes`：content 端点回的字节（默认 [1,2,3]）；
 * - `output`：终态快照 outputs[0] 的覆写（如音频 mime）。
 */

/** 终态 succeeded 快照（图像产物；音乐/语音用例覆写 output）。 */
export function GEN_SNAP_DONE(output) {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    operation: 'txt2image',
    status: 'succeeded',
    version: 2,
    progress: 100,
    billing_status: 'committed',
    terminal: true,
    outputs: [output ?? { ordinal: 0, type: 'image', mime_type: 'image/png', content_url: '/v1/generations/x/content/0' }],
    error: null,
  }
}

const PENDING = {
  id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  operation: 'txt2image',
  status: 'queued',
  version: 1,
  progress: 0,
  billing_status: 'held',
  terminal: false,
  outputs: [],
  error: null,
}

export function generationStub(opts = {}) {
  const state = { creates: 0, createBodies: [], polls: 0, content: 0, canceled: 0 }
  const branch = (text, init = {}) => {
    const method = init.method ?? 'GET'
    // 创建（quote/cancel 也是 POST /v1/generations 前缀，显式排除）。
    if (method === 'POST' && /\/v1\/generations(\?|$)/.test(text)) {
      state.creates += 1
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      state.createBodies.push(body)
      if (opts.shouldFailCreate?.(body, state.creates) === true) {
        const status = opts.failStatus ?? 500
        const textBody = opts.failText ?? 'Internal Server Error'
        return { ok: false, status, json: async () => ({ detail: textBody }), text: async () => textBody }
      }
      return { ok: true, status: 202, json: async () => (opts.create202?.(state.creates) ?? PENDING) }
    }
    if (method === 'POST' && text.includes('/v1/generations/') && text.endsWith('/cancel')) {
      state.canceled += 1
      return { ok: true, status: 202, json: async () => GEN_SNAP_DONE(opts.output) }
    }
    if (method === 'POST' && text.includes('/v1/generations/quote')) {
      return { ok: true, status: 200, json: async () => ({ estimated_credits: 1 }) }
    }
    if (text.includes('/poll')) {
      state.polls += 1
      return { ok: true, status: 200, json: async () => (opts.pollJson?.(state.polls) ?? GEN_SNAP_DONE(opts.output)) }
    }
    if (text.includes('/content/')) {
      state.content += 1
      const bytes = opts.contentBytes ?? [1, 2, 3]
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes), text: async () => '' }
    }
    return null
  }
  return { branch, state }
}
