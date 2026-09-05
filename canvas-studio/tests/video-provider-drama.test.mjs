/**
 * Drama 视频适配器测试（阶段 2）：参数映射、端点选择、能力自述、同步 settled。
 *
 * 直连 Host 侧编译产物 lib/providers/*.js；用假 dramaPostWithFallback 捕获请求体，
 * 不打桩 fetch。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRAMA_ENDPOINTS } from '../lib/config.js'
import { registerProvider, clearProviders, resolveProvider } from '../lib/providers/registry.js'
import { createDramaProvider } from '../lib/providers/drama.js'
import { capabilityOf } from '../lib/providers/capability.js'
import { runVideo } from '../lib/providers/executor.js'

/** 构造一个捕获请求体的假 Drama POST（带自愈闭包形态）。 */
function makePoster() {
  const calls = []
  const post = async (endpoint, body, kind) => {
    calls.push({ endpoint, body, kind })
    return { url: 'https://media.example/out.mp4', filename: 'out.mp4' }
  }
  return { post, calls }
}

const baseReq = (over) => ({
  prompt: 'p',
  duration: 5,
  aspectRatio: '16:9',
  references: [],
  ...over,
})

test.afterEach(() => { clearProviders() })

test('Drama adapter：自述支持全部三种能力且 maxReferences=6', () => {
  const p = createDramaProvider()
  assert.deepEqual([...p.capabilities], ['text-to-video', 'first-last-frame', 'multi-reference'])
  assert.equal(p.id, 'drama')
  assert.equal(p.maxReferences, 6)
})

test('text-to-video：走 FL2VA、含 megapixels=0.4、无 image 字段', async () => {
  const { post, calls } = makePoster()
  const handle = await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video', prompt: '一只白猫追蝴蝶', duration: 7 }),
    { dramaPostWithFallback: post },
  )
  assert.ok(handle.settled, '同步供应商 submit 即 settled')
  assert.equal(calls.length, 1)
  const { endpoint, body } = calls[0]
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoFl2va)
  assert.equal(body.prompt, '一只白猫追蝴蝶')
  assert.equal(body.aspect, '16:9')
  assert.equal(body.megapixels, 0.4)
  assert.equal(body.duration, 7)
  assert.equal(body.image1, undefined)
  assert.equal(body.image2, undefined)
})

test('first-last-frame（单参考）：FL2VA 仅带 image1', async () => {
  const { post, calls } = makePoster()
  await createDramaProvider().submit(
    baseReq({ capability: 'first-last-frame', aspectRatio: '9:16', references: [{ localPath: 'bg.png', index: 0 }] }),
    { dramaPostWithFallback: post },
  )
  const { endpoint, body } = calls[0]
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoFl2va)
  assert.equal(body.aspect, '9:16')
  assert.equal(body.image1, 'bg.png')
  assert.equal(body.image2, undefined)
})

test('first-last-frame（双参考）：FL2VA 带 image1+image2', async () => {
  const { post, calls } = makePoster()
  await createDramaProvider().submit(
    baseReq({
      capability: 'first-last-frame',
      references: [{ localPath: 'a.png', index: 0 }, { localPath: 'b.png', index: 1 }],
    }),
    { dramaPostWithFallback: post },
  )
  const { endpoint, body } = calls[0]
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoFl2va)
  assert.equal(body.image1, 'a.png')
  assert.equal(body.image2, 'b.png')
})

test('multi-reference（3 张）：走 REF2VA，image1..image3', async () => {
  const { post, calls } = makePoster()
  await createDramaProvider().submit(
    baseReq({
      capability: 'multi-reference',
      references: ['a', 'b', 'c'].map((localPath, index) => ({ localPath, index })),
    }),
    { dramaPostWithFallback: post },
  )
  const { endpoint, body } = calls[0]
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoRef2va)
  assert.equal(body.image1, 'a')
  assert.equal(body.image2, 'b')
  assert.equal(body.image3, 'c')
  assert.equal(body.image4, undefined)
})

test('multi-reference（8 张）：收敛到 6 张（image1..image6），保留首尾+中间采样', async () => {
  const { post, calls } = makePoster()
  const refs = Array.from({ length: 8 }, (_, i) => ({ localPath: `f${i}`, index: i }))
  await createDramaProvider().submit(
    baseReq({ capability: 'multi-reference', references: refs }),
    { dramaPostWithFallback: post },
  )
  const { body } = calls[0]
  assert.equal(body.image1, 'f0') // 首帧必保留
  assert.equal(body.image2, 'f1')
  assert.equal(body.image6, 'f7') // 尾帧必保留
  assert.equal(body.image7, undefined)
})

test('画幅归一：9:16 保留；1:1 在 Drama 侧降级为 16:9', async () => {
  const { post: postA, calls: callsA } = makePoster()
  await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video', aspectRatio: '9:16' }),
    { dramaPostWithFallback: postA },
  )
  assert.equal(callsA[0].body.aspect, '9:16')

  const { post: postB, calls: callsB } = makePoster()
  await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video', aspectRatio: '1:1' }),
    { dramaPostWithFallback: postB },
  )
  assert.equal(callsB[0].body.aspect, '16:9')
})

test('执行器：Drama 同步供应商 submit 即返回，不进入轮询（post 仅调用一次）', async () => {
  const { post, calls } = makePoster()
  const outcome = await runVideo(
    createDramaProvider(),
    baseReq({ capability: 'text-to-video' }),
    { dramaPostWithFallback: post },
  )
  assert.equal(calls.length, 1, '同步供应商不应产生 poll 调用')
  assert.equal(outcome.url, 'https://media.example/out.mp4')
  assert.equal(outcome.filename, 'out.mp4')
})

test('未注入 dramaPostWithFallback 时 submit 抛明确错误', async () => {
  await assert.rejects(
    () => createDramaProvider().submit(baseReq({ capability: 'text-to-video' }), {}),
    /需要 dramaPostWithFallback/,
  )
})

test('注册后 resolveProvider 能按能力取到 Drama', () => {
  registerProvider(createDramaProvider())
  assert.equal(resolveProvider('text-to-video', undefined).id, 'drama')
  assert.equal(resolveProvider('first-last-frame', undefined).id, 'drama')
  assert.equal(resolveProvider('multi-reference', undefined).id, 'drama')
})

test('能力解析与 Drama 路由对齐（video_generate / video_composite）', () => {
  registerProvider(createDramaProvider())
  assert.equal(capabilityOf('video_generate', {}), 'text-to-video')
  assert.equal(capabilityOf('video_generate', { filename: 'x' }), 'first-last-frame')
  assert.equal(capabilityOf('video_composite', { filenames: ['a', 'b'] }), 'first-last-frame')
  assert.equal(capabilityOf('video_composite', { filenames: ['a', 'b', 'c'] }), 'multi-reference')
})
