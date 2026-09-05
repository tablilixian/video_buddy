/**
 * fal 多参考（阶段 5）测试：reference_image_urls 编码与上限、Image N 顺序约定、
 * ffmpeg 降采样与回退、体积逃生阀。
 *
 * 直连 Host 侧编译产物 lib/providers/*.js。降采样路径用**假 ffmpeg 替身**
 * （FFMPEG_PATH 环境变量指向 sh 脚本，与 tests/compose.test.mjs 同一手法）——
 * 本机不保证装了 ffmpeg，且 ffmpeg-static 的二进制在本仓库未下载
 * （.yarnrc.yml enableScripts: false）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFalProvider } from '../lib/providers/fal.js'
import { createDramaProvider } from '../lib/providers/drama.js'
import {
  assertFalReferenceSizes,
  toFalDataUri,
  FAL_MAX_SINGLE_REFERENCE_BYTES,
  FAL_MAX_TOTAL_REFERENCE_BYTES,
} from '../lib/providers/reference.js'
import { runVideo } from '../lib/providers/executor.js'

let workspace = ''
let ffmpegLogPath = ''

/**
 * 写一个假 ffmpeg 替身：把 argv 逐行追加到日志，把 `body` 写入最后一个参数
 * （输出路径），以 `exitCode` 退出。`body` 为空 + 非零码即模拟「转码失败」。
 */
async function writeFakeFfmpeg(name, body, exitCode = 0) {
  const scriptPath = join(workspace, `${name}.sh`)
  await writeFile(
    scriptPath,
    [
      '#!/bin/sh',
      `LOG="${ffmpegLogPath}"`,
      'for a in "$@"; do',
      '  printf "%s\\n" "$a" >> "$LOG"',
      'done',
      'OUT=""',
      'for a in "$@"; do OUT="$a"; done',
      ...(body.length > 0 ? [`printf '%s' '${body}' > "$OUT"`] : []),
      `exit ${exitCode}`,
    ].join('\n'),
  )
  await chmod(scriptPath, 0o755)
  return scriptPath
}

/** 读取假 ffmpeg 记录的 argv（按调用顺序）。 */
async function readFfmpegArgs() {
  const raw = await readFile(ffmpegLogPath, 'utf8')
  return raw.split('\n').filter((line) => line.length > 0)
}

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'cs-fal-refs-'))
  ffmpegLogPath = join(workspace, 'ffmpeg-args.log')
  await writeFile(ffmpegLogPath, '')
})

after(async () => {
  if (workspace.length > 0) await rm(workspace, { recursive: true, force: true })
})

/** 设置 / 还原 FFMPEG_PATH（resolveFfmpegPath 优先读该环境变量）。 */
function withFfmpeg(path, fn) {
  const original = process.env.FFMPEG_PATH
  process.env.FFMPEG_PATH = path
  return fn().finally(() => {
    if (original === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = original
  })
}

const KEY_CTX = { falApiKey: async () => 'sk-test' }

/** readReferenceBytes 替身：按 localPath 生成固定内容（越靠后越大，便于体积用例）。 */
function makeReader(sizeOf = () => 32) {
  return async (ref) => ({ bytes: new Uint8Array(sizeOf(ref)), ext: ref.localPath.endsWith('.jpg') ? 'jpg' : 'png' })
}

const refReq = (over) => ({
  prompt: '两个角色在花园里散步',
  duration: 5,
  aspectRatio: '16:9',
  references: [],
  ...over,
})

const refs = (n) => Array.from({ length: n }, (_, i) => ({ localPath: `f${i}.png`, index: i }))

/** 提交即返回 COMPLETED 的桩：只关心 submit 请求体。 */
function submitOnlyHandlers(model = 'minimax/h3/reference-to-video') {
  return [
    { json: { request_id: 'r1', response_url: `https://queue.fal.run/${model}/requests/r1` } },
    (call) => (call.url.endsWith('/status') ? { json: { status: 'COMPLETED' } } : { json: { video: { url: 'https://media.example/ref.mp4' } } }),
  ]
}

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

test('阶段 5：fal 自述补齐 multi-reference（与 Drama 同为三能力，上限 9 vs 6）', () => {
  const fal = createFalProvider()
  const drama = createDramaProvider()
  assert.deepEqual([...fal.capabilities].sort(), ['first-last-frame', 'multi-reference', 'text-to-video'])
  assert.equal(fal.maxReferences, 9)
  assert.equal(drama.maxReferences, 6)
})

test('multi-reference：走 reference-to-video，reference_image_urls 按序内联', async () => {
  const { calls, restore } = stubFetch(submitOnlyHandlers())
  try {
    const outcome = await runVideo(
      createFalProvider(),
      refReq({ capability: 'multi-reference', references: refs(3) }),
      { ...KEY_CTX, pollIntervalMs: 1, readReferenceBytes: makeReader() },
    )
    assert.equal(outcome.url, 'https://media.example/ref.mp4')
    assert.equal(calls[0].url, 'https://queue.fal.run/minimax/h3/reference-to-video')
    const input = calls[0].body.input
    assert.equal(input.reference_image_urls.length, 3)
    assert.equal(input.aspect_ratio, '16:9')
    // 顺序语义：第 N 个 URI 对应提示词里的 Image N（下文单独断言顺序说明）。
    assert.ok(input.reference_image_urls.every((uri) => uri.startsWith('data:image/')))
  } finally {
    restore()
  }
})

test('参考图上限差异：12 张时 fal 保留 9 张并回 warning；Drama 仍截到 6 张', async () => {
  const { calls: falCalls, restore: restoreA } = stubFetch(submitOnlyHandlers())
  try {
    const outcome = await runVideo(
      createFalProvider(),
      refReq({ capability: 'multi-reference', references: refs(12) }),
      { ...KEY_CTX, pollIntervalMs: 1, readReferenceBytes: makeReader() },
    )
    assert.equal(falCalls[0].body.input.reference_image_urls.length, 9)
    assert.ok(outcome.warnings?.some((w) => w.includes('超过 fal 上限 9 张')))
  } finally {
    restoreA()
  }

  // Drama 侧：8 张 → 6 张（阶段 2 已验证的行为，此处确认上限差异未回归）。
  const dramaCalls = []
  await createDramaProvider().submit(
    refReq({ capability: 'multi-reference', references: refs(8) }),
    {
      dramaPostWithFallback: async (endpoint, body) => {
        dramaCalls.push(body)
        return { url: 'https://media.example/out.mp4' }
      },
    },
  )
  assert.equal(dramaCalls[0].image6, 'f7.png')
  assert.equal(dramaCalls[0].image7, undefined)
})

test('提示词无 Image N 约定时自动前置顺序说明并回 warning；已有约定时不干预', async () => {
  for (const [prompt, expectPrefix] of [['两个角色散步', true], ['Image 1 是女主，Image 2 是狗', false]]) {
    const { calls, restore } = stubFetch(submitOnlyHandlers())
    try {
      const outcome = await runVideo(
        createFalProvider(),
        refReq({ capability: 'multi-reference', prompt, references: refs(2) }),
        { ...KEY_CTX, pollIntervalMs: 1, readReferenceBytes: makeReader() },
      )
      const sent = calls[0].body.input.prompt
      if (expectPrefix) {
        assert.match(sent, /^参考图按 Image 1 \/ Image 2 的顺序对应/)
        assert.ok(outcome.warnings?.some((w) => w.includes('Image 1 / Image 2')))
      } else {
        assert.equal(sent, prompt)
        assert.ok(!outcome.warnings?.some((w) => w.includes('自动前置顺序说明')))
      }
    } finally {
      restore()
    }
  }
})

test('降采样：ffmpeg 可用时输出 image/jpeg，参数含长边 1024 与 q:v 5', async () => {
  const fake = await writeFakeFfmpeg('ok', 'JPEGDATA')
  await writeFile(ffmpegLogPath, '')
  const uri = await withFfmpeg(fake, () => toFalDataUri({ bytes: new Uint8Array([137, 80, 78, 71]), ext: 'png' }))
  assert.equal(uri, `data:image/jpeg;base64,${Buffer.from('JPEGDATA').toString('base64')}`)
  const args = await readFfmpegArgs()
  assert.ok(args.includes('scale=1024:1024:force_original_aspect_ratio=decrease'), `实际参数: ${args.join(' ')}`)
  assert.ok(args.includes('-q:v') && args.includes('5'))
})

test('降采样失败 / ffmpeg 缺失时回退原始字节（不阻断生成）', async () => {
  const failing = await writeFakeFfmpeg('fail', '', 1)
  // ① 显式替身非零退出 → 回退
  const uri = await withFfmpeg(failing, () => toFalDataUri({ bytes: new Uint8Array([1, 2]), ext: 'png' }))
  assert.equal(uri, 'data:image/png;base64,AQI=')
  // ② 环境变量指向不存在的路径 → resolveFfmpegPath 抛错 → 同样回退
  const uri2 = await withFfmpeg('/nonexistent/ffmpeg-binary', () => toFalDataUri({ bytes: new Uint8Array([3]), ext: 'webp' }))
  assert.equal(uri2, 'data:image/webp;base64,Aw==')
})

test('逃生阀（纯函数）：单张超 2MB / 合计超 12MB 抛明确中文错误', () => {
  const one = `data:image/jpeg;base64,${'A'.repeat(FAL_MAX_SINGLE_REFERENCE_BYTES + 1)}`
  assert.throws(() => assertFalReferenceSizes([one]), /超过 fal 单张上限/)
  const many = Array.from({ length: 7 }, () => `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}`)
  assert.throws(() => assertFalReferenceSizes(many), /超过 fal 单次请求上限/)
  // 刚好在上限内不报错（合计 12MB = 6 张 × 2MB）
  assert.doesNotThrow(() => assertFalReferenceSizes(many.slice(0, 6)))
})

test('逃生阀（接入 fal adapter）：超大参考图在提交前被拦下，不发请求', async () => {
  // 指向「转码失败」的替身，确保任何环境都走原始字节回退（体积不被压缩掉）。
  const failing = await writeFakeFfmpeg('valve-fail', '', 1)
  const { calls, restore } = stubFetch(submitOnlyHandlers())
  try {
    await withFfmpeg(failing, () => assert.rejects(
      () => runVideo(
        createFalProvider(),
        refReq({ capability: 'multi-reference', references: refs(1) }),
        { ...KEY_CTX, pollIntervalMs: 1, readReferenceBytes: makeReader(() => FAL_MAX_SINGLE_REFERENCE_BYTES + 1024) },
      ),
      /超过 fal 单张上限/,
    ))
    assert.equal(calls.length, 0, '超限应在 submit 请求发出前报错')
  } finally {
    restore()
  }
})
