/**
 * Drama 视频适配器测试（异步任务版，后端 0.5.0）：参数映射、端点选择、能力自述、
 * 202 提交信封、poll 状态机、cancel、瞬时错误容忍。
 *
 * 直连 Host 侧编译产物 lib/providers/*.js；用假 dramaPostWithFallback /
 * dramaJobRequest 闭包捕获请求，不打桩 fetch、不碰真实后端。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRAMA_ENDPOINTS } from '../lib/config.js'
import { registerProvider, clearProviders, resolveProvider } from '../lib/providers/registry.js'
import { createDramaProvider, jobStatusOf, jobResultOf } from '../lib/providers/drama.js'
import { capabilityOf } from '../lib/providers/capability.js'
import { runVideo } from '../lib/providers/executor.js'

const JOB_ENVELOPE = (jobId) => ({
  job_id: jobId,
  status: 'pending',
  status_url: `/api/v1/jobs/${jobId}`,
  cancel_url: `/api/v1/jobs/${jobId}/cancel`,
  result_url: `/api/v1/jobs/${jobId}/result`,
})

/** 构造一个捕获请求体的假 Drama 提交 POST（返回 202 任务信封；kind 必须是 videoSubmit）。 */
function makePoster(envelope = JOB_ENVELOPE('job-1')) {
  const calls = []
  const post = async (endpoint, body, kind) => {
    calls.push({ endpoint, body, kind })
    return envelope
  }
  return { post, calls }
}

/**
 * 构造一个假的异步任务端点请求闭包（状态 / 结果 / 取消）。
 * status 序列：按 GET /api/v1/jobs/{id} 的调用次序依次弹出（弹完重复最后一项）；
 * result：GET .../result 的响应体；网络异常用 failWith 注入。
 */
function makeJobRequest({
  statusSequence = ['completed'],
  result = { prompt_id: 'job-1', filename: 'out.mp4', full_url: 'https://media.example/out.mp4', duration: 8.5 },
  resultStatus = 200,
  resultJson = null,
  failWith = null,
  statusHttp = 200,
  statusJson = null,
} = {}) {
  const calls = []
  let statusIndex = 0
  const request = async (method, path) => {
    calls.push({ method, path })
    if (failWith !== null) throw failWith
    if (path.endsWith('/result')) {
      return { status: resultStatus, json: resultJson ?? result }
    }
    if (path.endsWith('/cancel')) {
      return { status: 200, json: { job_id: 'job-1', cancelled: true, status: 'in_progress' } }
    }
    const status = statusSequence[Math.min(statusIndex, statusSequence.length - 1)]
    statusIndex += 1
    return { status: statusHttp, json: statusJson ?? { job_id: 'job-1', status, execution_error: null } }
  }
  return { request, calls }
}

const baseReq = (over) => ({
  prompt: 'p',
  duration: 5,
  aspectRatio: '16:9',
  references: [],
  ...over,
})

test.afterEach(() => { clearProviders() })

test('Drama adapter：自述支持全部三种能力且 maxReferences=9（后端 0.3.0 image1~image9）', () => {
  const p = createDramaProvider()
  assert.deepEqual([...p.capabilities], ['text-to-video', 'first-last-frame', 'multi-reference'])
  assert.equal(p.id, 'drama')
  assert.equal(p.maxReferences, 9)
})

test('text-to-video：走 FL2VA、含 megapixels=0.4、无 image 字段；submit 返回 job_id 且不 settled', async () => {
  const { post, calls } = makePoster()
  const submitted = []
  const handle = await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video', prompt: '一只白猫追蝴蝶', duration: 7 }),
    { dramaPostWithFallback: post, onSubmitted: (info) => submitted.push(info.jobId) },
  )
  assert.equal(handle.token, 'job-1', 'token = 202 返回的 job_id')
  assert.equal(handle.settled, undefined, '异步供应商 submit 不再 settled（0.5.0 硬切）')
  assert.deepEqual(submitted, ['job-1'], 'onSubmitted 必须拿到 job_id（台账落地凭据）')
  assert.equal(calls.length, 1)
  const { endpoint, body, kind } = calls[0]
  assert.equal(kind, 'videoSubmit', '提交走 60s 短超时档')
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoFl2va)
  assert.equal(body.prompt, '一只白猫追蝴蝶')
  assert.equal(body.aspect, '16:9')
  assert.equal(body.megapixels, 0.9)
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

test('multi-reference（8 张）：未超上限 9，全部原样发出且不告警（CV-191 前的 6 张截断已解除）', async () => {
  const { post, calls } = makePoster()
  const refs = Array.from({ length: 8 }, (_, i) => ({ localPath: `f${i}`, index: i }))
  const handle = await createDramaProvider().submit(
    baseReq({ capability: 'multi-reference', references: refs }),
    { dramaPostWithFallback: post },
  )
  const { body, endpoint } = calls[0]
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoRef2va)
  for (let i = 0; i < 8; i++) assert.equal(body[`image${i + 1}`], `f${i}`)
  assert.equal(body.image8, 'f7') // 第 8 张过去会被静默丢弃
  assert.equal(body.image9, undefined)
  assert.equal(handle.warnings, undefined)
})

test('multi-reference（12 张）：收敛到 9 张（image1..image9），保留首尾+中间采样 + 回 warning', async () => {
  const { post, calls } = makePoster()
  const refs = Array.from({ length: 12 }, (_, i) => ({ localPath: `f${i}`, index: i }))
  const handle = await createDramaProvider().submit(
    baseReq({ capability: 'multi-reference', references: refs }),
    { dramaPostWithFallback: post },
  )
  const { body } = calls[0]
  assert.equal(body.image1, 'f0') // 首帧必保留
  assert.equal(body.image9, 'f11') // 尾帧必保留
  assert.equal(body.image10, undefined)
  for (let i = 1; i <= 9; i++) assert.equal(typeof body[`image${i}`], 'string')
  assert.ok(
    handle.warnings?.some((w) => w.includes('超过 Drama 上限 9 张')),
    `应回截断告警，实得 ${JSON.stringify(handle.warnings)}`,
  )
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

test('提交响应缺 job_id：抛结构异常（0.5.0 硬切，不再兼容同步 full_url 形态）', async () => {
  const { post } = makePoster({ full_url: 'https://media.example/out.mp4', filename: 'out.mp4' })
  await assert.rejects(
    () => createDramaProvider().submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post }),
    (err) => err.code === 'CS-NET-010',
  )
})

test('未注入 dramaPostWithFallback 时 submit 抛明确错误', async () => {
  await assert.rejects(
    () => createDramaProvider().submit(baseReq({ capability: 'text-to-video' }), {}),
    (err) => err.code === 'CS-PROV-003',
  )
})

test('未注入 dramaJobRequest 时 poll 抛明确错误', async () => {
  const { post } = makePoster()
  const handle = await createDramaProvider().submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  await assert.rejects(
    () => createDramaProvider().poll(handle, {}),
    (err) => err.code === 'CS-PROV-003',
  )
})

test('poll 状态机：in_progress → 生成中；completed → 取 result 返回 url+filename', async () => {
  const { post } = makePoster()
  const updates = []
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), {
    dramaPostWithFallback: post,
    onJobUpdate: (u) => updates.push(u.status),
  })
  const { request, calls } = makeJobRequest({ statusSequence: ['in_progress', 'completed'] })
  const first = await provider.poll(handle, { dramaJobRequest: request, onJobUpdate: (u) => updates.push(u.status) })
  assert.equal(first.done, false)
  assert.equal(first.stage, '生成中')
  const second = await provider.poll(handle, { dramaJobRequest: request, onJobUpdate: (u) => updates.push(u.status) })
  assert.equal(second.done, true)
  assert.equal(second.url, 'https://media.example/out.mp4')
  assert.equal(second.filename, 'out.mp4')
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/api/v1/jobs/job-1', '/api/v1/jobs/job-1', '/api/v1/jobs/job-1/result'],
    '前两拍查状态，completed 后取 result',
  )
  assert.deepEqual(updates, ['in_progress', 'completed'], '状态变化增量回调（台账回写凭据）')
})

test('poll 状态机：pending → 排队中', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request } = makeJobRequest({ statusSequence: ['pending'] })
  const polled = await provider.poll(handle, { dramaJobRequest: request })
  assert.equal(polled.done, false)
  assert.equal(polled.stage, '排队中')
})

test('poll：onJobUpdate 只在状态变化时回调（避免台账每 30s 重复写盘）', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const updates = []
  const ctx = { dramaJobRequest: makeJobRequest({ statusSequence: ['in_progress'] }).request, onJobUpdate: (u) => updates.push(u.status) }
  await provider.poll(handle, ctx)
  await provider.poll(handle, ctx)
  await provider.poll(handle, ctx)
  assert.deepEqual(updates, ['in_progress'], '同一状态重复轮询不重复回调')
})

test('poll：failed 抛 CS-PROV-015 并带 execution_error 详情', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request } = makeJobRequest({
    statusSequence: ['failed'],
    statusJson: { job_id: 'job-1', status: 'failed', execution_error: 'ComfyUI out of memory' },
  })
  await assert.rejects(
    () => provider.poll(handle, { dramaJobRequest: request }),
    (err) => err.code === 'CS-PROV-015' && err.message.includes('out of memory'),
  )
})

test('poll：cancelled 抛 CS-PROV-015（任务被取消 = 失败）', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request } = makeJobRequest({ statusSequence: ['cancelled'] })
  await assert.rejects(
    () => provider.poll(handle, { dramaJobRequest: request }),
    (err) => err.code === 'CS-PROV-015',
  )
})

test('poll：404（任务消失，后端重启清队列）抛 CS-PROV-016，不当瞬时错误容忍', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request } = makeJobRequest({ statusHttp: 404, statusJson: { detail: 'Job not found' } })
  await assert.rejects(
    () => provider.poll(handle, { dramaJobRequest: request }),
    (err) => err.code === 'CS-PROV-016',
  )
})

test('poll：瞬时错误容忍——网络异常 / 5xx / 状态 0 一律「本轮未完成」', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const network = makeJobRequest({ failWith: new Error('ECONNRESET') })
  const netPolled = await provider.poll(handle, { dramaJobRequest: network.request })
  assert.equal(netPolled.done, false, '网络异常当一轮未完成')

  const serverError = makeJobRequest({ statusHttp: 502, statusJson: { detail: 'Bad Gateway' } })
  const badPolled = await provider.poll(handle, { dramaJobRequest: serverError.request })
  assert.equal(badPolled.done, false, '5xx 当一轮未完成')

  const dead = makeJobRequest({ statusHttp: 0, statusJson: {} })
  const deadPolled = await provider.poll(handle, { dramaJobRequest: dead.request })
  assert.equal(deadPolled.done, false, '网络失败（status=0）当一轮未完成')
})

test('poll：completed 但 result 未就绪（202）当一轮未完成，下一轮重取', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request } = makeJobRequest({ statusSequence: ['completed'], resultStatus: 202, resultJson: { detail: 'Job is not completed' } })
  const polled = await provider.poll(handle, { dramaJobRequest: request })
  assert.equal(polled.done, false)
})

test('poll：result 409/404（状态完成但产物不可取）抛 CS-PROV-015', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request } = makeJobRequest({ statusSequence: ['completed'], resultStatus: 409, resultJson: { detail: 'no video output' } })
  await assert.rejects(
    () => provider.poll(handle, { dramaJobRequest: request }),
    (err) => err.code === 'CS-PROV-015',
  )
})

test('cancel：POST /api/v1/jobs/{id}/cancel（executor 超时/打断时调用）', async () => {
  const { post } = makePoster()
  const provider = createDramaProvider()
  const handle = await provider.submit(baseReq({ capability: 'text-to-video' }), { dramaPostWithFallback: post })
  const { request, calls } = makeJobRequest({})
  await provider.cancel(handle, { dramaJobRequest: request })
  assert.deepEqual(calls, [{ method: 'POST', path: '/api/v1/jobs/job-1/cancel' }])
})

test('执行器集成：submit → poll 即 completed → 拿产物；全程一次提交一次状态一次结果', async () => {
  const { post } = makePoster()
  const { request, calls } = makeJobRequest({ statusSequence: ['completed'] })
  const outcome = await runVideo(
    createDramaProvider(),
    baseReq({ capability: 'text-to-video' }),
    { dramaPostWithFallback: post, dramaJobRequest: request },
  )
  assert.equal(outcome.url, 'https://media.example/out.mp4')
  assert.equal(outcome.filename, 'out.mp4')
  assert.equal(calls.filter((c) => c.path.endsWith('/result')).length, 1)
  assert.equal(calls.filter((c) => c.path.endsWith('/cancel')).length, 0, '正常完成不触发取消')
})

test('执行器集成：signal 已中止时先 cancel 远端任务再抛取消错误', async () => {
  const { post } = makePoster()
  const { request, calls } = makeJobRequest({})
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => runVideo(
      createDramaProvider(),
      baseReq({ capability: 'text-to-video' }),
      { dramaPostWithFallback: post, dramaJobRequest: request, signal: controller.signal },
    ),
    (err) => err instanceof Error,
  )
  assert.ok(calls.some((c) => c.path.endsWith('/cancel')), '中止路径必须尽力取消远端任务')
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

test('CV-129 音频通道：参考音频按序落在 audio1..audio3 并走 REF2VA', async () => {
  const { post, calls } = makePoster()
  await createDramaProvider().submit(
    baseReq({
      capability: 'multi-reference',
      references: [{ localPath: 'frame.png', index: 0 }],
      audios: [{ localPath: 'a1.mp3', index: 0 }, { localPath: 'a2.wav', index: 1 }],
    }),
    { dramaPostWithFallback: post },
  )
  const { endpoint, body } = calls[0]
  assert.equal(endpoint, DRAMA_ENDPOINTS.videoRef2va, '带音频参考走 ref2va')
  assert.equal(body.image1, 'frame.png')
  assert.equal(body.audio1, 'a1.mp3', '顺序即 <Audio N> 引用序，不得重排')
  assert.equal(body.audio2, 'a2.wav')
  assert.equal(body.audio3, undefined)
})

test('CV-129 音频通道：缺省不发送 generate_audio，显式指定才进请求体', async () => {
  const none = makePoster()
  await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video' }),
    { dramaPostWithFallback: none.post },
  )
  assert.equal(none.calls[0].body.generate_audio, undefined, '缺省不得带 generate_audio')

  const on = makePoster()
  await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video', generateAudio: true }),
    { dramaPostWithFallback: on.post },
  )
  assert.equal(on.calls[0].body.generate_audio, true)

  const off = makePoster()
  await createDramaProvider().submit(
    baseReq({ capability: 'text-to-video', generateAudio: false }),
    { dramaPostWithFallback: off.post },
  )
  assert.equal(off.calls[0].body.generate_audio, false, '显式静音也要传，不能当缺省处理')
})

test('CV-129 能力解析：带参考音频一律走参考模式，压过首尾帧语义', () => {
  assert.equal(capabilityOf('video_generate', { filename: 'x', audioRefs: ['a.mp3'] }), 'multi-reference')
  assert.equal(
    capabilityOf('video_composite', { filenames: ['a', 'b'], audioRefs: ['a.mp3'] }),
    'multi-reference',
    '官方：帧模式与参考模式互斥，带音频时不再按首尾帧解析',
  )
  assert.equal(capabilityOf('video_composite', { filenames: ['a', 'b'] }), 'first-last-frame', '无音频时行为不变')
})

test('后端契约解析器：jobStatusOf / jobResultOf 形状不对返回 null（不猜）', () => {
  assert.equal(jobStatusOf({ status: 'completed' }), 'completed')
  assert.equal(jobStatusOf({ status: 'weird' }), null)
  assert.equal(jobStatusOf(null), null)
  assert.equal(jobStatusOf('completed'), null)
  assert.deepEqual(
    jobResultOf({ prompt_id: 'x', filename: 'a.mp4', full_url: 'http://x/a.mp4', duration: 1 }),
    { url: 'http://x/a.mp4', filename: 'a.mp4' },
  )
  assert.deepEqual(jobResultOf({ prompt_id: 'x', full_url: 'http://x/a.mp4' }), { url: 'http://x/a.mp4' })
  assert.equal(jobResultOf({ filename: 'a.mp4' }), null, '缺 full_url 不猜')
  assert.equal(jobResultOf({ full_url: '' }), null)
})
