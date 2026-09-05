/**
 * 视频供应商选择与持久化测试（阶段 3）：默认供应商、参数覆盖、非法值拒绝、重试不串台。
 *
 * 直连 Host 侧编译产物 lib/*。用假 fal 供应商模拟阶段 4 的 fal（验证覆盖/持久化路径，
 * 不依赖真实 fal 适配器）。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAsset } from '../lib/generate.js'
import { parseProviderParam } from '../lib/providers/selection.js'
import { createDramaProvider } from '../lib/providers/drama.js'
import { registerProvider, clearProviders, resolveProvider } from '../lib/providers/registry.js'

// ── provider 参数校验 ─────────────────────────────────
test('parseProviderParam：合法值透传、未提供返回 undefined、非法值抛错', () => {
  assert.equal(parseProviderParam('drama'), 'drama')
  assert.equal(parseProviderParam('fal'), 'fal')
  assert.equal(parseProviderParam(undefined), undefined)
  assert.equal(parseProviderParam(null), undefined)
  assert.throws(() => parseProviderParam('bogus'), /非法的视频供应商/)
  assert.throws(() => parseProviderParam(123), /非法的视频供应商/)
})

// ── 注册表优先级 ─────────────────────────────────────
let falCalls = []
function makeFalProvider() {
  return {
    id: 'fal',
    label: 'fal',
    capabilities: new Set(['text-to-video', 'first-last-frame', 'multi-reference']),
    maxReferences: 9,
    async submit() {
      falCalls.push(1)
      return { token: 'fal-tok', settled: { url: 'https://fal.example/out.mp4', filename: 'fal.mp4' } }
    },
    async poll() { return { done: true, url: 'https://fal.example/out.mp4' } },
  }
}

test('resolveProvider：显式指定 fal 命中已注册 fal', () => {
  const fal = makeFalProvider()
  registerProvider(createDramaProvider())
  registerProvider(fal)
  assert.equal(resolveProvider('text-to-video', 'fal'), fal)
  clearProviders()
})

// ── 集成（generateAsset + 打桩 fetch）─────────────────
function stubFetch() {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    let body = null
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body) } catch { /* keep */ } }
    calls.push({ url: String(url), method: init.method ?? 'GET', body })
    if (init.method === 'POST') {
      if (String(url).includes('/upload')) return { ok: true, json: async () => ({ filename: 'ref.png' }) }
      return { ok: true, json: async () => ({ full_url: 'https://media.example/out.mp4' }) }
    }
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
  }
  return calls
}

function stubRegistry(initialNodes, assetsDir) {
  const writes = []
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir: assetsDir, createdAt: 1 }],
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 3, nodes: initialNodes }),
    writeCanvas: async (projectId, nodes) => { writes.push({ projectId, nodes: [...nodes] }) },
    appendCanvasNode: async (projectId, node) => { writes.push({ projectId, nodes: [node] }) },
    getWrites: () => writes,
  }
}

test.beforeEach(() => {
  falCalls = []
  registerProvider(createDramaProvider())
  registerProvider(makeFalProvider())
})
test.afterEach(() => { clearProviders() })

test('默认走 drama：未指定 provider 时调用 Drama 端点、fal 不被调用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sel-'))
  try {
    const calls = stubFetch()
    const registry = stubRegistry([], dir)
    const result = await generateAsset(registry, 'video_generate', 'p1', { prompt: 'x' })
    assert.equal(falCalls.length, 0, '不应调用 fal')
    assert.ok(calls.find((c) => c.url.includes('/generate/image2videofl2va')), '应调用 Drama FL2VA')
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('覆盖 fal：provider=fal 时走 fal 供应商（Drama 生成端点不被调用）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sel-'))
  try {
    const calls = stubFetch()
    const registry = stubRegistry([], dir)
    const result = await generateAsset(registry, 'video_generate', 'p1', { prompt: 'x', provider: 'fal' })
    assert.equal(falCalls.length, 1, '应调用 fal 一次')
    assert.equal(calls.find((c) => c.url.includes('/generate/')), undefined, '不应调用 Drama 生成端点')
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('非法 provider：generateAsset 抛明确错误（约束 4 兜底）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sel-'))
  try {
    stubFetch()
    const registry = stubRegistry([], dir)
    await assert.rejects(
      generateAsset(registry, 'video_generate', 'p1', { prompt: 'x', provider: 'bogus' }),
      /非法的视频供应商/,
    )
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('持久化：provider 随 generationPrompt 写入节点，重试不串台', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sel-'))
  try {
    await writeFile(join(dir, 'local.png'), Buffer.from([7, 7, 7]))
    const prior = [{
      id: 'n1',
      kind: 'video',
      url: '/canvas-studio/assets/p1/old.mp4',
      title: '旧',
      x: 40, y: 40, width: 260, height: 180, createdAt: 1000, origin: 'agent',
      sourceIds: ['s'], operationType: 'image-to-video',
      generationPrompt: '{"prompt":"旧","provider":"fal"}', error: '失败',
    }]
    const registry = stubRegistry(prior, dir)
    stubFetch()
    await generateAsset(registry, 'video_generate', 'p1', {
      prompt: '新', provider: 'fal', retryOf: 'n1',
    })
    const writes = registry.getWrites()
    const updated = writes[writes.length - 1].nodes.find((n) => n.id === 'n1')
    assert.ok(updated.generationPrompt.includes('"provider":"fal"'), '节点应持久化 provider=fal')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
