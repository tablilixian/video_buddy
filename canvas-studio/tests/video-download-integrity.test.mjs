/**
 * 视频产物下载完整性（2026-11-23 真机探针）：content 端点 ~55KB/s + 31s 硬断流
 * ⇒ 单次响应上限 ~1.7MB，大 mp4 必然缺尾部 moov。本文件断言行为而非源码形状：
 * 坏字节重试 ×2 后抛 CS-NET-012，坏产物不落画布，job 不记 settled。
 *
 * 直连 Host 侧编译产物 lib/generate.js；fetch 打桩，产物写临时目录。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAsset } from '../lib/generate.js'
import { readDramaJobs } from '../lib/video-jobs.js'
import { generationDownloadBranch, minimalMp4 } from './helpers/generation-stub.mjs'

process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED = '0'

const GEN_PENDING = {
  id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
  operation: 'image2videofl2va', status: 'queued', version: 1, progress: 0,
  billing_status: 'held', terminal: false, outputs: [], error: null,
}
const GEN_DONE = {
  ...GEN_PENDING, status: 'succeeded', version: 2, progress: 100,
  billing_status: 'committed', terminal: true, result_status: 'ready',
  outputs: [{ ordinal: 0, type: 'video', mime_type: 'video/mp4', content_url: '/v1/generations/x/content/0', download_url: '/v1/generations/x/download/0' }],
}

/** ftyp + moov 齐全：mp4LooksIntact 应放行。 */
const MP4_INTACT = minimalMp4()
/** 只有 ftyp，缺尾部 moov：真机截断产物的最小复现。 */
const MP4_TRUNCATED = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
  0x00, 0x00, 0x00, 0x00, 0x6d, 0x64, 0x61, 0x74, 0x00, 0x01, 0x02, 0x03,
])

function stubRegistry(dir) {
  const writes = []
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
    projectDir: () => dir,
    assetsDir: () => dir,
    readCanvas: async () => ({ version: 3, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async (_projectId, node) => { writes.push(node) },
    getWrites: () => writes,
  }
}

/** 把 content 端点固定回某套字节；其余业务 API 分支走最小可用桩。 */
function stubFetch(contentBytes) {
  const state = { content: 0, settledWrites: 0 }
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    if (init.method === 'POST' && /\/v1\/generations(\?|$)/u.test(text)) {
      return { ok: true, status: 202, json: async () => GEN_PENDING }
    }
    if (text.includes('/poll')) {
      return { ok: true, status: 200, json: async () => GEN_DONE }
    }
    // helper 命中签名地址时会递增 state.content（与旧 content 分支同口径），不再手动重复 +1。
    const handled = generationDownloadBranch(text, { contentBytes }, state)
    if (handled !== null) return handled
    if (text.includes('/content/')) {
      state.content += 1
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(contentBytes), text: async () => '' }
    }
    if (init.method === 'POST') return { ok: true, json: async () => ({ full_url: 'https://media.example/out.mp4' }) }
    return { ok: false, status: 404 }
  }
  return state
}

async function waitFor(condition, timeoutMs = 5000) {
  const started = Date.now()
  for (;;) {
    if (await condition()) return
    if (Date.now() - started > timeoutMs) throw new Error('waitFor 超时')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('视频产物缺 moov：下载三次后抛 CS-NET-012，坏字节不落盘，job 不记 settled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-mp4-intact-'))
  try {
    const registry = stubRegistry(dir)
    const state = stubFetch(MP4_TRUNCATED)
    await assert.rejects(
      generateAsset(registry, 'video_generate', 'p1', { prompt: 'x', duration: 5 }),
      (err) => err?.code === 'CS-NET-012',
    )
    assert.equal(state.content, 3, '结构校验失败应重试 ×2（共三次下载）')
    assert.equal(registry.getWrites().length, 0, '坏 mp4 不得落到画布')
    // 台账收尾是异步队列：轮询等 markJobAbandoned 写完错误详情再断言。
    await waitFor(async () => {
      const jobs = await readDramaJobs(registry, 'p1')
      return (jobs[0]?.executionError ?? '') !== ''
    })
    const jobs = await readDramaJobs(registry, 'p1')
    assert.notEqual(jobs[0].status, 'settled', '产物下载失败不得记结算')
    assert.match(jobs[0].executionError, /产物落盘失败|中止/u)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

test('视频产物 moov 齐全：一次下载成功、落画布并记 settled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-mp4-ok-'))
  try {
    const registry = stubRegistry(dir)
    const state = stubFetch(MP4_INTACT)
    const result = await generateAsset(registry, 'video_generate', 'p1', { prompt: 'x', duration: 5 })
    assert.equal(state.content, 1, '结构完整时不应重试')
    assert.equal(registry.getWrites().length, 1, '完整产物应落画布')
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/'))
    await waitFor(async () => (await readDramaJobs(registry, 'p1'))[0]?.status === 'settled')
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
