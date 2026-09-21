/**
 * P10 `/health` 前置探针 契约测试。
 *
 * 1. 后端宕机：生成/上传请求立刻失败并给出中文提示，且不会真的发出生成请求。
 * 2. 探针缓存 30s：缓存窗口内重复请求只探测一次（快速失败，零开销）。
 * 3. 恢复后（清缓存 + health 恢复 ok）：链路正常走通。
 * 4. CV-219：health **返 4xx/5xx 不等于不可达** —— 服务活着、只是健康接口坏了，
 *    请求必须照常发出（旧判据 `ok = response.ok` 会把可观测性故障升级成服务不可用）。
 * 5. CV-219「忙/闲」双态：`queue_task_count > 0` 时结果里必须带上排队提示。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { queueDepthOf, resetDramaProbeCache } from '../lib/generate.js'

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
 *
 * - `healthy: false` ⇒ 拿不到任何响应（连接失败）
 * - `healthStatus: 500` ⇒ 拿到了响应但状态码是 5xx（CV-219：服务活着）
 * - `queueTaskCount` ⇒ 响应体里带 `queue_task_count`（不传则该字段缺失）
 */
function stubFetch({ healthy = true, healthStatus = 200, queueTaskCount } = {}) {
  const calls = { health: 0, generate: 0 }
  let original = null
  const handler = async (url) => {
    const target = String(url)
    if (target.includes('/api/v1/health')) {
      calls.health += 1
      if (!healthy) throw new Error('connect ECONNREFUSED')
      const body = { status: 'ok' }
      if (queueTaskCount !== undefined) body.queue_task_count = queueTaskCount
      return {
        ok: healthStatus < 400,
        status: healthStatus,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
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
  return {
    calls,
    /** 显式安装：**不在构造时安装** —— 数组字面量 `[stubFetch(), stubFetch()]` 会
     *  一次性造出两个桩，构造即安装会让先造的那个永远装不上、还原时还会把后造的
     *  那个当成 original。 */
    install: () => { original = globalThis.fetch; globalThis.fetch = handler },
    restore: () => { if (original !== null) { globalThis.fetch = original; original = null } },
  }
}

test('health 探针：宕机时生成请求立刻失败且不发出生成调用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    resetDramaProbeCache()
    const registry = stubToolRegistry(dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    assert.ok(imgGen)

    const { calls, restore, install } = stubFetch({ healthy: false })
    install()
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

    const { calls, restore, install } = stubFetch({ healthy: false })
    install()
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
    down.install()
    try {
      await assert.rejects(imgGen.execute({ prompt: '宕机期' }, EXEC(dir)), /不可达/)
    } finally {
      down.restore()
    }

    // 服务恢复：清缓存后应放行并真正调用生成端点。
    resetDramaProbeCache()
    const up = stubFetch({ healthy: true })
    up.install()
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

// ------------------------------------------------------------------ CV-219

/** 跑一次 image_generate，返回结果与打桩调用计数（fetch 已还原）。 */
async function runImageGenerate(dir, stub, prompt = '测试') {
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
}

/** 建临时项目目录跑一次 image_generate，跑完自动清理。 */
async function withImageGenerate(stub, prompt = '测试') {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    resetDramaProbeCache()
    return await runImageGenerate(dir, stub, prompt)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('CV-219：health 返 500 只说明健康接口坏了，不得拦下生成请求', async () => {
  // 2026-09-20 实测的真实形状：/api/v1/health 稳定 500，而 /view 返 422（服务活着）。
  // 旧判据 `ok = response.ok` 会把这种「可观测性接口故障」升级成「服务不可用」。
  const { result, calls } = await withImageGenerate(stubFetch({ healthStatus: 500 }))
  assert.match(result.url, /\/canvas-studio\/assets\//, '5xx 时应照常生成')
  assert.ok(calls.generate >= 1, 'health 5xx 不能变成「不可达」而拦下请求')
})

test('CV-219：health 4xx/5xx 同样缓存 30s（不为一个坏掉的健康接口反复付费）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-health-'))
  try {
    resetDramaProbeCache()
    const stub = stubFetch({ healthStatus: 500 })
    const first = await runImageGenerate(dir, stub, '第一次')
    assert.ok(first.calls.health >= 1)
    const probesAfterFirst = first.calls.health
    // 第二次仍在缓存窗口内：探针不应再发一次 health（fetch 已被还原，需重建打桩）。
    const second = await runImageGenerate(dir, stub, '第二次')
    assert.ok(second.result.url, '缓存窗口内应照常生成')
    assert.equal(second.calls.health, probesAfterFirst, '窗口内不应重新探测 health')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-219 忙态：queue_task_count > 0 时结果必须带上排队位次', async () => {
  // **1 也要报警**：实测 queue_task_count **含正在执行的那个**（独跑 = 1），所以
  // 「有活在跑」的门槛是 `> 0` 而不是 `> 1` —— 写成 `> 1` 会让最常见的忙态静默。
  for (const count of [1, 2]) {
    const { result, calls } = await withImageGenerate(stubFetch({ queueTaskCount: count }))
    assert.ok(calls.generate >= 1)
    const warnings = (result.warnings ?? []).join('；')
    assert.match(warnings, new RegExp(`${count} 个任务`, 'u'), `应报出队列深度 ${count}，实际 warnings=${JSON.stringify(result.warnings)}`)
    assert.match(warnings, /排在其后/u, '应说明本请求会排队（后端同步单任务）')
  }
})

test('CV-219 闲态：0 或缺字段都不算忙，不加任何提示', async () => {
  for (const stub of [stubFetch({ queueTaskCount: 0 }), stubFetch({})]) {
    const { result } = await withImageGenerate(stub)
    assert.ok(result.url)
    assert.equal(result.warnings, undefined, `空闲/未知不该报警，实际 ${JSON.stringify(result.warnings)}`)
  }
})

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
