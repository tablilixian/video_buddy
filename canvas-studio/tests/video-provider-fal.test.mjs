/**
 * fal 视频适配器测试（阶段 4）：鉴权头、队列三段式、参数钳制与映射、
 * 参考图 data URI、超时 / 取消、warnings 通道。
 *
 * 直连 Host 侧编译产物 lib/providers/*.js；打桩覆盖 globalThis.fetch（与
 * tests/generate.test.mjs 同一方式）。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createFalProvider } from '../lib/providers/fal.js'
import { toFalDataUri } from '../lib/providers/reference.js'
import { runVideo } from '../lib/providers/executor.js'

/**
 * 打桩 fetch：按序消费 handler（对象 = 一次性响应；函数 = 持久分流，不消费），
 * 并记录每次调用的 method/url/headers/body。
 */
function stubFetch(handlers) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    }
    calls.push(call)
    const handler = handlers[0]
    if (handler === undefined) throw new Error(`stub fetch 序号越界: ${calls.length} ${call.method} ${call.url}`)
    const res = typeof handler === 'function' ? await handler(call, calls.length) : handlers.shift()
    return {
      ok: (res.status ?? 200) >= 200 && (res.status ?? 200) < 300,
      status: res.status ?? 200,
      text: async () => res.text ?? JSON.stringify(res.json ?? {}),
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const KEY_CTX = { falApiKey: async () => 'sk-test' }

const baseReq = (over) => ({
  prompt: '一只白猫追蝴蝶',
  duration: 5,
  aspectRatio: '16:9',
  references: [],
  ...over,
})

/** t2v 全流程桩：submit → status(IN_QUEUE→IN_PROGRESS→COMPLETED) → result。 */
function t2vHandlers() {
  return [
    { json: { request_id: 'req-1', response_url: 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-1' } },
    { json: { status: 'IN_QUEUE' } },
    { json: { status: 'IN_PROGRESS' } },
    { json: { status: 'COMPLETED' } },
    { json: { video: { url: 'https://media.example/h3.mp4' } } },
  ]
}

afterEach(() => {
  // stubFetch 的 restore 在各用例内部完成；此处兜底，避免桩泄漏到并行测试文件。
})

test('fal adapter：自述支持全部三种能力（阶段 5 补齐 multi-reference），maxReferences=9', () => {
  const p = createFalProvider()
  assert.equal(p.id, 'fal')
  assert.deepEqual([...p.capabilities].sort(), ['first-last-frame', 'multi-reference', 'text-to-video'])
  assert.equal(p.maxReferences, 9)
})

test('未配置 key（未注入 / 空串）时 submit 报明确中文错误', async () => {
  await assert.rejects(
    () => createFalProvider().submit(baseReq({ capability: 'text-to-video' }), {}),
    /未配置 fal API Key，请在设置/,
  )
  await assert.rejects(
    () => createFalProvider().submit(baseReq({ capability: 'text-to-video' }), { falApiKey: async () => '' }),
    /未配置 fal API Key，请在设置/,
  )
})

test('t2v 三段式被正确驱动：鉴权头、提交体、轮询至 COMPLETED 后取 video.url', async () => {
  const { calls, restore } = stubFetch(t2vHandlers())
  try {
    const outcome = await runVideo(
      createFalProvider(),
      baseReq({ capability: 'text-to-video' }),
      { ...KEY_CTX, pollIntervalMs: 1 },
    )
    assert.equal(outcome.url, 'https://media.example/h3.mp4')
    assert.equal(calls.length, 5, 'submit + 3 次 status + result')
    // 提交：URL / 鉴权头 / 请求体形态（§11.2 已实测校准）
    const submit = calls[0]
    assert.equal(submit.method, 'POST')
    assert.equal(submit.url, 'https://queue.fal.run/minimax/h3/text-to-video')
    assert.equal(submit.headers.Authorization, 'Key sk-test')
    assert.equal(submit.body.webhookUrl, null)
    assert.equal(submit.body.input.prompt, '一只白猫追蝴蝶')
    assert.equal(submit.body.input.duration, 5)
    assert.equal(submit.body.input.aspect_ratio, '16:9')
    // 轮询走 /status，结果走请求基址
    assert.ok(calls[1].url.endsWith('/status'))
    assert.equal(calls[4].url, 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-1')
    assert.ok(calls.slice(1).every((c) => c.headers.Authorization === 'Key sk-test'), '后续请求均带鉴权')
  } finally {
    restore()
  }
})

test('duration 越界钳制到 [5,15] 并回 warning（3→5，20→15；区间内原样）', async () => {
  for (const [raw, clamped, expectWarning] of [[3, 5, true], [20, 15, true], [8, 8, false]]) {
    const { calls, restore } = stubFetch(t2vHandlers())
    try {
      const outcome = await runVideo(
        createFalProvider(),
        baseReq({ capability: 'text-to-video', duration: raw }),
        { ...KEY_CTX, pollIntervalMs: 1 },
      )
      assert.equal(calls[0].body.input.duration, clamped)
      if (expectWarning) {
        assert.ok(outcome.warnings?.some((w) => w.includes(`已钳制为 ${clamped} 秒`)), `应有钳制 warning: ${raw}`)
      } else {
        assert.equal(outcome.warnings, undefined, `${raw} 在区间内不应有 warning`)
      }
    } finally {
      restore()
    }
  }
})

test('resolution 映射：768p/2k 直通；720p/1080p 升档并回「费用更高」warning；未指定不传', async () => {
  const cases = [
    ['768p', '768P', false],
    ['2k', '2K', false],
    ['720p', '768P', true],
    ['1080p', '2K', true],
  ]
  for (const [raw, mapped, expectWarning] of cases) {
    const { calls, restore } = stubFetch(t2vHandlers())
    try {
      const outcome = await runVideo(
        createFalProvider(),
        baseReq({ capability: 'text-to-video', resolution: raw }),
        { ...KEY_CTX, pollIntervalMs: 1 },
      )
      assert.equal(calls[0].body.input.resolution, mapped)
      if (expectWarning) {
        assert.ok(outcome.warnings?.some((w) => w.includes('费用更高')), `升档应有成本 warning: ${raw}`)
      } else {
        assert.equal(outcome.warnings, undefined)
      }
    } finally {
      restore()
    }
  }
  const { calls, restore } = stubFetch(t2vHandlers())
  try {
    await runVideo(createFalProvider(), baseReq({ capability: 'text-to-video', resolution: undefined }), { ...KEY_CTX, pollIntervalMs: 1 })
    assert.equal(calls[0].body.input.resolution, undefined, '未指定 resolution 时不传，走 fal 默认 2K')
  } finally {
    restore()
  }
})

test('t2v 画幅：1:1 原生直通（与 Drama 的降级行为不同）', async () => {
  const { calls, restore } = stubFetch(t2vHandlers())
  try {
    await runVideo(createFalProvider(), baseReq({ capability: 'text-to-video', aspectRatio: '1:1' }), { ...KEY_CTX, pollIntervalMs: 1 })
    assert.equal(calls[0].body.input.aspect_ratio, '1:1')
  } finally {
    restore()
  }
})

test('fl2v：参考图经 readReferenceBytes 读字节并内联为 base64 data URI（image_url / end_image_url）', async () => {
  const { calls, restore } = stubFetch([
    { json: { request_id: 'req-2', response_url: 'https://queue.fal.run/minimax/h3/image-to-video/requests/req-2' } },
    { json: { status: 'COMPLETED' } },
    { json: { video: { url: 'https://media.example/fl2v.mp4' } } },
  ])
  try {
    const outcome = await runVideo(
      createFalProvider(),
      baseReq({
        capability: 'first-last-frame',
        aspectRatio: '16:9',
        references: [{ localPath: 'a.png', index: 0 }, { localPath: 'b.jpg', index: 1 }],
      }),
      {
        ...KEY_CTX,
        pollIntervalMs: 1,
        readReferenceBytes: async (ref) => ref.localPath === 'a.png'
          ? { bytes: new Uint8Array([1, 2, 3]), ext: 'png' }
          : { bytes: new Uint8Array([4, 5]), ext: 'jpg' },
      },
    )
    assert.equal(outcome.url, 'https://media.example/fl2v.mp4')
    const input = calls[0].body.input
    // i2v 无 aspect_ratio（画幅跟随首帧图）——校准后的关键差异
    assert.equal(input.aspect_ratio, undefined)
    assert.equal(input.image_url, 'data:image/png;base64,AQID')
    assert.equal(input.end_image_url, 'data:image/jpeg;base64,BAU=')
    assert.equal(input.prompt, '一只白猫追蝴蝶')
  } finally {
    restore()
  }
})

test('未注入 readReferenceBytes 时 fl2v submit 抛明确错误', async () => {
  await assert.rejects(
    () => createFalProvider().submit(
      baseReq({ capability: 'first-last-frame', references: [{ localPath: 'a.png', index: 0 }] }),
      KEY_CTX,
    ),
    /需要 readReferenceBytes/,
  )
})

test('超时触发 cancel：runVideo 抛中文超时错误且远端任务被取消（PUT .../cancel）', async () => {
  // 轮询次数与时序相关，用函数桩按 URL 分流：/status 永远 IN_QUEUE，/cancel 返回成功。
  const { calls, restore } = stubFetch([
    { json: { request_id: 'req-3', response_url: 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-3' } },
    (call) => (call.url.endsWith('/cancel') ? { json: {} } : { json: { status: 'IN_QUEUE' } }),
  ])
  try {
    await assert.rejects(
      () => runVideo(createFalProvider(), baseReq({ capability: 'text-to-video' }), {
        ...KEY_CTX,
        pollIntervalMs: 5,
        timeoutMs: 30,
      }),
      /生成超时/,
    )
    const cancel = calls.at(-1)
    assert.equal(cancel.method, 'PUT')
    assert.equal(cancel.url, 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-3/cancel')
  } finally {
    restore()
  }
})

test('abort 取消：sleep 被打断后 cancel 远端任务并抛取消错误', async () => {
  const controller = new AbortController()
  const { calls, restore } = stubFetch([
    { json: { request_id: 'req-4', response_url: 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-4' } },
    (call) => (call.url.endsWith('/cancel') ? { json: {} } : { json: { status: 'IN_QUEUE' } }),
  ])
  try {
    const run = runVideo(createFalProvider(), baseReq({ capability: 'text-to-video' }), {
      falApiKey: async () => 'sk-test',
      pollIntervalMs: 60_000, // 长睡眠，靠 abort 打断
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)
    // executor 的 abortError 透传 signal.reason（AbortError DOMException，与改造前
    // Drama 路径的 abort 行为一致）；本用例验证的是「cancel 被驱动」，错误形态兼容两者。
    await assert.rejects(() => run, /生成已取消|This operation was aborted/)
    const cancel = calls.at(-1)
    assert.equal(cancel.method, 'PUT')
    assert.ok(cancel.url.endsWith('/cancel'))
  } finally {
    restore()
  }
})

test('状态查询非 2xx 时报可读错误（含状态码与响应片段）', async () => {
  const { restore } = stubFetch([
    { json: { request_id: 'req-5', response_url: 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-5' } },
    { status: 401, text: '{"error":"invalid api key"}' },
  ])
  try {
    await assert.rejects(
      () => runVideo(createFalProvider(), baseReq({ capability: 'text-to-video' }), { ...KEY_CTX, pollIntervalMs: 1 }),
      (err) => err.message.includes('401') && err.message.includes('invalid api key'),
    )
  } finally {
    restore()
  }
})

test('toFalDataUri：无可用 ffmpeg（或解码失败）时回退原始字节，mime 按扩展名映射', async () => {
  // 这里的字节不是合法图片，ffmpeg 必然解码失败 → 回退原字节（与本机没装 ffmpeg 同路径）。
  assert.equal(await toFalDataUri({ bytes: new Uint8Array([1]), ext: 'png' }), 'data:image/png;base64,AQ==')
  assert.equal(await toFalDataUri({ bytes: new Uint8Array([1]), ext: 'jpg' }), 'data:image/jpeg;base64,AQ==')
  assert.equal(await toFalDataUri({ bytes: new Uint8Array([1]), ext: 'webp' }), 'data:image/webp;base64,AQ==')
  assert.equal(await toFalDataUri({ bytes: new Uint8Array([1]), ext: 'bmp' }), 'data:image/png;base64,AQ==')
})
