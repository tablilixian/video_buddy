import { createHash } from 'node:crypto'

/**
 * 业务 API 生成任务共享桩（迁移 B3-2，2026-11-22；换代 2026-11-23）。
 *
 * 流程类测试统一从这里拿 `/v1/generations` 四段分支（create 202 → poll →
 * download 票据 → 签名 Blob/CDN 字节），
 * 与 asset-upload-stub（三段式上传）配套使用。可按用例注入：
 * - `shouldFailCreate(body, nth)`：第 n 次创建是否失败（自愈/重试用例）；
 * - `failStatus / failText`：失败形态（默认 500 笼统）；
 * - `pollJson(nth)`：第 n 次轮询的快照（默认第一次 pending、第二次起 succeeded）；
 * - `contentBytes`：签名地址回的字节（默认合法最小 PNG）；
 * - `downloadNotReady`：票据端点回 409 result_not_ready；
 * - `output`：终态快照 outputs[0] 的覆写（如音频 mime）。
 */

/** 终态 succeeded 快照（图像产物；音乐/语音用例覆写 output）。 */
export function GEN_SNAP_DONE(output) {
  const item = output ?? { ordinal: 0, type: 'image', mime_type: 'image/png' }
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    operation: 'txt2image',
    status: 'succeeded',
    version: 2,
    progress: 100,
    billing_status: 'committed',
    terminal: true,
    result_status: 'ready',
    // 老用例只覆写 content_url / mime 也要能跑新链路：补稳定 download_url。
    outputs: [{ download_url: '/v1/generations/x/download/0', ...item }],
    error: null,
  }
}

/**
 * 取票 + 签名地址分支（供各测试的自定义 fetch 桩复用）。命中返回合成 Response，
 * 未命中返回 null。票据 size_bytes/checksum 按 contentBytes 现算，和真接口同口径。
 */
export function generationDownloadBranch(text, opts = {}, state = {}) {
  const bytes = opts.contentBytes ?? minimalPng(opts.pngWidth ?? 8, opts.pngHeight ?? 8)
  if (text.includes('/download/')) {
    if (typeof state.download === 'number') state.download += 1
    if (opts.downloadNotReady === true) {
      return {
        ok: false, status: 409,
        json: async () => ({ error: { code: 'result_not_ready', message: 'still archiving' } }),
        text: async () => 'result_not_ready',
      }
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        url: 'https://blob.example.test/signed/0',
        headers: {},
        expires_at: '2026-11-23T08:10:00Z',
        size_bytes: bytes.length,
        checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    }
  }
  if (text.startsWith('https://blob.example.test/signed/')) {
    if (typeof state.content === 'number') state.content += 1
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes), text: async () => '' }
  }
  return null
}

/** 结构合法的最小 PNG（sig + IHDR + IDAT + IEND；CRC 全零——本仓校验不走 CRC）。
 *  width/height 写进 IHDR，供 pngSizeOf 实测分辨率类用例使用。 */
export function minimalPng(width = 8, height = 8, extra = []) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  }
  const idat = extra.length > 0 ? Buffer.from(extra) : Buffer.from([1, 2, 3, 4])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/** 结构合法的最小 MP4（ftyp + moov）：B3-3 起视频下载也做 moov 校验，
 * 视频类用例的 content 桩必须回真 MP4，否则会被 CS-NET-012 正确拦下。 */
export function minimalMp4() {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    0x6d, 0x6f, 0x6f, 0x76, 0x00, 0x00, 0x00, 0x01, 0x6d, 0x70, 0x34, 0x32,
  ])
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
  const state = { creates: 0, createBodies: [], polls: 0, download: 0, content: 0, canceled: 0 }
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
    const generated = generationDownloadBranch(text, opts, state)
    if (generated !== null) return generated
    if (text.includes('/content/')) {
      // 旧端点保留可观测性：新链路若误回退到这里，测试可通过 state.content 抓到。
      state.content += 1
      const bytes = opts.contentBytes ?? minimalPng(opts.pngWidth ?? 8, opts.pngHeight ?? 8)
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes), text: async () => '' }
    }
    return null
  }
  return { branch, state }
}
