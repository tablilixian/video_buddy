/**
 * 视频供应商抽象层骨架的冒烟测试（阶段 1）：注册表路由、能力解析、执行器。
 *
 * 直连 Host 侧编译产物 lib/providers/*.js。本阶段不接入任何调用方，
 * 因此不需要打桩 fetch——供应商全部用内存假实现。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerProvider,
  unregisterProvider,
  clearProviders,
  getProvider,
  listProviders,
  resolveProvider,
} from '../lib/providers/registry.js'
import { capabilityOf } from '../lib/providers/capability.js'
import { runVideo, DEFAULT_VIDEO_TIMEOUT_MS } from '../lib/providers/executor.js'

const ALL = ['text-to-video', 'first-last-frame', 'multi-reference']

/** 构造一个内存假供应商。behaviour 决定 submit/poll 的行为。 */
function fakeProvider(overrides = {}) {
  const calls = []
  const provider = {
    id: 'drama',
    label: 'Drama Backend',
    capabilities: new Set(ALL),
    maxReferences: 6,
    calls,
    /** 覆盖点：返回 handle。 */
    onSubmit: () => ({ token: 'tok-1', settled: { url: 'https://media.example/a.mp4' } }),
    onPoll: () => ({ done: true, url: 'https://media.example/a.mp4' }),
    async submit(req) {
      calls.push({ kind: 'submit', req })
      return provider.onSubmit()
    },
    async poll(handle) {
      calls.push({ kind: 'poll', handle })
      return provider.onPoll()
    },
    async cancel(handle) {
      calls.push({ kind: 'cancel', handle })
    },
    ...overrides,
  }
  return provider
}

const REQ = {
  capability: 'text-to-video',
  prompt: '一只白猫追蝴蝶',
  duration: 5,
  aspectRatio: '16:9',
  references: [],
}

test.afterEach(() => { clearProviders() })

// ── 注册表 ──────────────────────────────────────────────

test('注册表：注册后可按 id 取回，listProviders 保持注册顺序', () => {
  const a = fakeProvider({ id: 'drama' })
  const b = fakeProvider({ id: 'fal', capabilities: new Set(['text-to-video']) })
  registerProvider(a)
  registerProvider(b)

  assert.equal(getProvider('fal'), b)
  assert.deepEqual(listProviders().map((p) => p.id), ['drama', 'fal'])
})

test('注册表：unregisterProvider 移除指定供应商，不影响其他', () => {
  registerProvider(fakeProvider({ id: 'drama' }))
  registerProvider(fakeProvider({ id: 'fal' }))
  unregisterProvider('drama')

  assert.equal(getProvider('drama'), undefined)
  assert.equal(getProvider('fal')?.id, 'fal')
})

test('注册表：resolveProvider 显式指定时命中该供应商', () => {
  const fal = fakeProvider({ id: 'fal' })
  registerProvider(fakeProvider({ id: 'drama' }))
  registerProvider(fal)

  assert.equal(resolveProvider('text-to-video', 'fal'), fal)
})

test('注册表：显式指定但能力不支持时抛错，且错误列出「哪家支持什么」', () => {
  registerProvider(fakeProvider({ id: 'fal', capabilities: new Set(['text-to-video']) }))

  assert.throws(
    () => resolveProvider('multi-reference', 'fal'),
    (e) => {
      assert.match(e.message, /不支持 multi-reference/)
      assert.match(e.message, /已注册/)
      assert.match(e.message, /fal/)
      return true
    },
  )
})

test('注册表：显式指定未注册的 id 时抛错', () => {
  registerProvider(fakeProvider({ id: 'drama' }))
  assert.throws(
    () => resolveProvider('text-to-video', 'fal'),
    /未注册的视频供应商: fal/,
  )
})

test('注册表：未指定时按注册顺序选出第一个支持该能力的供应商', () => {
  const drama = fakeProvider({ id: 'drama', capabilities: new Set(['multi-reference']) })
  const fal = fakeProvider({ id: 'fal', capabilities: new Set(['text-to-video']) })
  registerProvider(fal)
  registerProvider(drama)

  // fal 不支持 multi-reference，应跳过并命中 drama。
  assert.equal(resolveProvider('multi-reference', undefined), drama)
})

test('注册表：没有任何供应商支持时抛错并说明现状', () => {
  registerProvider(fakeProvider({ id: 'fal', capabilities: new Set(['text-to-video']) }))

  assert.throws(
    () => resolveProvider('multi-reference', undefined),
    /没有可用的视频供应商支持 multi-reference/,
  )
})

test('注册表：空注册表时的错误文案不同于「无人支持」，便于定位装配遗漏', () => {
  assert.throws(
    () => resolveProvider('text-to-video', undefined),
    /当前没有任何已注册的视频供应商/,
  )
})

// ── 能力解析 ────────────────────────────────────────────

test('能力解析：video_generate 无参考图 → text-to-video', () => {
  assert.equal(capabilityOf('video_generate', {}), 'text-to-video')
})

test('能力解析：video_generate 带首帧图 → first-last-frame', () => {
  assert.equal(capabilityOf('video_generate', { filename: 'ref.png' }), 'first-last-frame')
})

test('能力解析：video_composite 恰好两张 → first-last-frame（首尾帧插值）', () => {
  assert.equal(
    capabilityOf('video_composite', { filenames: ['a.png', 'b.png'] }),
    'first-last-frame',
  )
})

test('能力解析：video_composite 三张及以上 → multi-reference', () => {
  assert.equal(
    capabilityOf('video_composite', { filenames: ['a.png', 'b.png', 'c.png'] }),
    'multi-reference',
  )
})

test('能力解析：非视频工具抛错（防止误用扩散到图片链路）', () => {
  assert.throws(() => capabilityOf('image_generate', {}), /不是视频生成工具/)
})

// ── 执行器：同步供应商 ───────────────────────────────────

test('执行器：同步供应商在 submit 即 settled，不进入轮询', async () => {
  const p = fakeProvider()
  const outcome = await runVideo(p, REQ, {})

  assert.deepEqual(outcome, { url: 'https://media.example/a.mp4' })
  assert.deepEqual(p.calls.map((c) => c.kind), ['submit'], '不应产生 poll 调用')
})

test('执行器：同步供应商的 filename 透传到结果（下游链式引用依赖它）', async () => {
  const p = fakeProvider({
    onSubmit: () => ({ token: 't', settled: { url: 'https://m/a.mp4', filename: 'a.mp4' } }),
  })
  const outcome = await runVideo(p, REQ, {})
  assert.deepEqual(outcome, { url: 'https://m/a.mp4', filename: 'a.mp4' })
})

// ── 执行器：异步供应商 ───────────────────────────────────

test('执行器：异步供应商轮询到 done 才返回，并上报进度', async () => {
  let pollCount = 0
  const p = fakeProvider({
    onSubmit: () => ({ token: 'req-1' }),
    onPoll: () => {
      pollCount += 1
      if (pollCount < 3) return { done: false, progress: pollCount / 3, stage: '排队中' }
      return { done: true, url: 'https://m/b.mp4' }
    },
  })
  const progress = []
  const outcome = await runVideo(p, REQ, {
    pollIntervalMs: 1,
    onProgress: (v, stage) => progress.push({ v, stage }),
  })

  assert.deepEqual(outcome, { url: 'https://m/b.mp4' })
  assert.equal(pollCount, 3)
  assert.equal(progress.length, 3, '两次进度上报 + 完成时的一次 1')
  assert.equal(progress.at(-1).v, 1)
  assert.equal(progress[0].stage, '排队中')
})

test('执行器：超时后尝试取消远端任务并抛出可读错误', async () => {
  const p = fakeProvider({
    onSubmit: () => ({ token: 'req-1' }),
    onPoll: () => ({ done: false, progress: 0.1 }),
  })

  await assert.rejects(
    () => runVideo(p, REQ, { timeoutMs: 5, pollIntervalMs: 1 }),
    /生成超时（超过 \d+ 秒），已尝试取消任务/,
  )
  assert.ok(p.calls.some((c) => c.kind === 'cancel'), '超时必须尝试取消远端任务')
})

test('执行器：被 AbortSignal 取消时先取消远端任务再抛出', async () => {
  const controller = new AbortController()
  const p = fakeProvider({
    onSubmit: () => ({ token: 'req-1' }),
    onPoll: () => {
      controller.abort(new Error('用户取消'))
      return { done: false, progress: 0.1 }
    },
  })

  await assert.rejects(
    () => runVideo(p, REQ, { signal: controller.signal, pollIntervalMs: 1 }),
    /用户取消/,
  )
  assert.ok(p.calls.some((c) => c.kind === 'cancel'))
})

test('执行器：默认超时常量与 generate.ts 的 DRAMA_TIMEOUT_MS.video 对齐', () => {
  assert.equal(DEFAULT_VIDEO_TIMEOUT_MS, 600_000)
})
