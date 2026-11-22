/**
 * 生成请求可达性与快失败契约（迁移 B3-2 重写）。
 *
 * 历史（P10/CV-219）：旧后端 8082 用 `/api/v1/health` 前置探针做「忙/闲」双态与
 * 快失败——**已随后端退役**（新业务 API 没有 health 端点；异步并发模型下「后面
 * 排着几个」不再是有效语义）。保留的契约：
 * 1. 业务 API 不可达（拿不到任何响应）→ 生成请求**快速失败**且不发后续调用
 *    （content 下载 / 轮询都不该发生），错误为 CS-NET-001（网络层）。
 * 2. `queueDepthOf` 纯函数保留（legacy video 轮询路径仍在消费），形状守卫不变。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { queueDepthOf } from '../lib/generate.js'
import { assetUploadBranch } from './helpers/asset-upload-stub.mjs'
import { minimalPng } from './helpers/generation-stub.mjs'

/** 工具执行上下文（会话 cwd 绑定项目目录）。 */
const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(15000) })

function stubToolRegistry(dir) {
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => dir,
    readCanvas: async () => ({ version: 3, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
  }
}

const SNAP = (over = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  operation: 'txt2image',
  status: 'succeeded',
  version: 3,
  progress: 100,
  billing_status: 'committed',
  terminal: true,
  outputs: [{ ordinal: 0, type: 'image', mime_type: 'image/png', content_url: '/v1/generations/x/content/0' }],
  error: null,
  ...over,
})

/**
 * 可编程 fetch 桩：/v1/generations 创建/轮询 + content 下载全链路；unreachable=true
 * 时对业务 API 抛连接错误（拿不到任何响应）。
 */
function stubBusiness({ unreachable = false } = {}) {
  const calls = { create: 0, poll: 0, content: 0 }
  let original = null
  const handler = async (url, init = {}) => {
    const target = String(url)
    const method = init.method ?? 'GET'
    if (target.includes('/v1/assets/')) return assetUploadBranch(target, init) ?? { ok: true, status: 200, json: async () => ({}) }
    if (target.includes('/v1/generations') && method === 'POST') {
      calls.create += 1
      if (unreachable) throw new Error('connect ECONNREFUSED')
      return { ok: true, status: 202, json: async () => SNAP({ status: 'credit_held', version: 1, terminal: false }) }
    }
    if (target.includes('/poll')) {
      calls.poll += 1
      return { ok: true, status: 200, json: async () => SNAP() }
    }
    if (target.includes('/content/')) {
      calls.content += 1
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(minimalPng()), text: async () => '' }
    }
    throw new Error(`unexpected fetch: ${target}`)
  }
  return {
    calls,
    install: () => { original = globalThis.fetch; globalThis.fetch = handler },
    restore: () => { if (original !== null) { globalThis.fetch = original; original = null } },
  }
}

async function withImageGenerate(stub, prompt = '测试') {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    const registry = stubToolRegistry(dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    stub.install()
    try {
      const result = await imgGen.execute({ prompt }, EXEC(dir))
      return { result, calls: stub.calls }
    } finally {
      stub.restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('业务 API 不可达：生成请求快速失败（CS-NET-001），且不发轮询/下载', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    const registry = stubToolRegistry(dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    assert.ok(imgGen)
    const stub = stubBusiness({ unreachable: true })
    stub.install()
    try {
      const startedAt = Date.now()
      await assert.rejects(
        imgGen.execute({ prompt: '测试' }, EXEC(dir)),
        (err) => err.code === 'CS-NET-001',
        '拿不到任何响应应报网络层错误（CS-NET-001），不是笼统失败',
      )
      // B4 quote 硬闸先行：quote（fail-open）+ 创建各一次；引擎不自动重试 POST。
      assert.equal(stub.calls.create, 2, 'quote 预检 + 创建各一次（无重试）')
      assert.equal(stub.calls.poll, 0, '创建失败不得进入轮询')
      assert.equal(stub.calls.content, 0, '创建失败不得下载产物')
      assert.ok(Date.now() - startedAt < 10_000, '应快速失败而不是吃满长超时')
    } finally {
      stub.restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('全链路走通：创建 202 → 轮询到 succeeded → content 下载 → 节点落盘', async () => {
  const { result, calls } = await withImageGenerate(stubBusiness())
  assert.match(result.url, /\/canvas-studio\/assets\//)
  assert.equal(calls.create, 2) // quote 预检 + 创建
  assert.ok(calls.poll >= 1)
  assert.equal(calls.content, 1, '产物字节恰好从 content 端点取一次')
})

// ------------------------------------------------------------------ 保留的纯函数守卫

test('CV-219 queueDepthOf：只认非负有限数，其余一律 null（不降级成 0）', () => {
  assert.equal(queueDepthOf({ queue_task_count: 0 }), 0)
  assert.equal(queueDepthOf({ queue_task_count: 2 }), 2)
  assert.equal(queueDepthOf({ queue_task_count: 2.7 }), 2, '取整，不把小数值当忙/闲误判源')
  assert.equal(queueDepthOf({}), null, '缺字段 = 未知，不能当 0')
  assert.equal(queueDepthOf({ queue_task_count: '2' }), null, '字符串不算数（后端改类型时会静默变忙）')
  assert.equal(queueDepthOf({ queue_task_count: -1 }), null)
  assert.equal(queueDepthOf({ queue_task_count: Number.NaN }), null)
  assert.equal(queueDepthOf({ queue_task_count: Number.POSITIVE_INFINITY }), null)
  assert.equal(queueDepthOf(null), null)
  assert.equal(queueDepthOf('ok'), null)
  assert.equal(queueDepthOf(undefined), null)
})
