/**
 * P10 `/health` 前置探针 契约测试。
 *
 * 1. 后端宕机：生成/上传请求立刻失败并给出中文提示，且不会真的发出生成请求。
 * 2. 探针缓存 30s：缓存窗口内重复请求只探测一次（快速失败，零开销）。
 * 3. 恢复后（清缓存 + health 恢复 ok）：链路正常走通。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { resetDramaProbeCache } from '../lib/generate.js'

/** 工具执行上下文（会话 cwd 绑定项目目录）。 */
const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(5000) })

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

/**
 * 可编程 fetch 打桩：health 行为可切换；其余 URL 记录调用次数并返回成功产物
 * （若被调用即说明探针没拦住，测试据此断言）。
 */
function stubFetch({ healthy }) {
  const calls = { health: 0, generate: 0 }
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/api/v1/health')) {
      calls.health += 1
      if (!healthy) throw new Error('connect ECONNREFUSED')
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    calls.generate += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({ full_url: 'https://media.example/out.png' }),
      arrayBuffer: async () => new Uint8Array([1]),
      text: async () => '',
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('health 探针：宕机时生成请求立刻失败且不发出生成调用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    resetDramaProbeCache()
    const registry = stubToolRegistry(dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    assert.ok(imgGen)

    const { calls, restore } = stubFetch({ healthy: false })
    try {
      const startedAt = Date.now()
      await assert.rejects(
        imgGen.execute({ prompt: '测试' }, EXEC(dir)),
        /不可达.*请检查服务/u,
        '宕机时应给出中文可操作错误',
      )
      assert.equal(calls.generate, 0, '不应发出任何生成请求')
      assert.ok(Date.now() - startedAt < 10_000, '应快速失败而不是吃满长超时')
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('health 探针：失败不缓存，重复请求每次重新探测（避免瞬时抖动被误判长期不可达）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    resetDramaProbeCache()
    const registry = stubToolRegistry(dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')

    const { calls, restore } = stubFetch({ healthy: false })
    try {
      await assert.rejects(imgGen.execute({ prompt: '第一次' }, EXEC(dir)), /不可达/)
      await assert.rejects(imgGen.execute({ prompt: '第二次' }, EXEC(dir)), /不可达/)
      assert.equal(calls.health, 2, '失败不缓存：第二次也应重新探测')
      assert.equal(calls.generate, 0)
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('health 探针：恢复后（重置缓存）链路正常走通', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    resetDramaProbeCache()
    const registry = stubToolRegistry(dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')

    // 先制造负缓存。
    const down = stubFetch({ healthy: false })
    try {
      await assert.rejects(imgGen.execute({ prompt: '宕机期' }, EXEC(dir)), /不可达/)
    } finally {
      down.restore()
    }

    // 服务恢复：清缓存后应放行并真正调用生成端点。
    resetDramaProbeCache()
    const up = stubFetch({ healthy: true })
    try {
      const result = await imgGen.execute({ prompt: '恢复期' }, EXEC(dir))
      assert.match(result.url, /\/canvas-studio\/assets\//)
      assert.ok(up.calls.generate >= 1, '恢复后应真正发出生成请求')
      assert.ok(up.calls.health >= 1)
    } finally {
      up.restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
