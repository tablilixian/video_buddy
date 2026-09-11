/**
 * P8.4 参考视频抽帧提风格 契约测试。
 *
 * 1. planFrameTimes：短片步进 / 长片全片均匀采样 / 未知时长兜底（纯函数）。
 * 2. parseFfmpegDuration：从 ffmpeg stderr 解析时长。
 * 3. resolveFfmpegPath：显式路径优先；全部落空报可操作错误。
 * 4. extractVideoStyle 端到端：假 ffmpeg（sh 替身）+ mock Drama fetch ——
 *    视频落盘、抽帧、帧上传拿 filename、image2vl 风格归纳文本组装。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planFrameTimes, parseFfmpegDuration, resolveFfmpegPath, extractVideoStyle } from '../lib/video-style.js'
import { ProjectRegistry } from '../lib/projects.js'

// ---------------------------------------------------------------------------
// 1. planFrameTimes（抽帧计划）
// ---------------------------------------------------------------------------
test('planFrameTimes：短片每 2s 一帧', () => {
  assert.deepEqual(planFrameTimes(5.04), [0, 2, 4])
  assert.deepEqual(planFrameTimes(16), [0, 2, 4, 6, 8, 10, 12, 14])
})

test('planFrameTimes：长片改为全片均匀采样（仍封顶 8 帧）', () => {
  assert.deepEqual(planFrameTimes(30), [0, 3.75, 7.5, 11.25, 15, 18.75, 22.5, 26.25])
})

test('planFrameTimes：未知/非法/极短时长只取第 0 帧', () => {
  assert.deepEqual(planFrameTimes(0), [0])
  assert.deepEqual(planFrameTimes(-3), [0])
  assert.deepEqual(planFrameTimes(Number.NaN), [0])
  assert.deepEqual(planFrameTimes(1), [0])
})

// ---------------------------------------------------------------------------
// 2. parseFfmpegDuration
// ---------------------------------------------------------------------------
test('parseFfmpegDuration：解析 Duration 行（含毫秒），失败返回 0', () => {
  const stderr = [
    "Input #0, mov,mp4 from 'input.mp4':",
    '  Duration: 00:01:05.25, start: 0.000000, bitrate: 1024 kb/s',
    '    Stream #0:0: Video: h264',
  ].join('\n')
  assert.ok(Math.abs(parseFfmpegDuration(stderr) - 65.25) < 1e-9)
  assert.equal(parseFfmpegDuration('没有任何时长信息'), 0)
})

// ---------------------------------------------------------------------------
// 3. resolveFfmpegPath
// ---------------------------------------------------------------------------
test('resolveFfmpegPath：显式路径优先', { skip: process.platform === 'win32' && '依赖 POSIX 可执行位' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ffmpeg-'))
  try {
    const script = join(dir, 'ff.sh')
    await writeFile(script, '#!/bin/sh\nexit 0\n')
    await chmod(script, 0o755)
    assert.equal(resolveFfmpegPath(script), script)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveFfmpegPath：env/静态包/PATH 全部落空时报可操作错误', { skip: process.platform === 'win32' && '依赖 POSIX PATH 行为' }, async () => {
  const originalPath = process.env.PATH
  const originalEnv = process.env.FFMPEG_PATH
  delete process.env.FFMPEG_PATH
  process.env.PATH = ''
  try {
    await assert.rejects(
      () => Promise.resolve().then(() => resolveFfmpegPath('/nonexistent/ffmpeg')),
      /未找到可用的 ffmpeg/,
    )
  } finally {
    process.env.PATH = originalPath
    if (originalEnv !== undefined) process.env.FFMPEG_PATH = originalEnv
  }
})

// ---------------------------------------------------------------------------
// 4. extractVideoStyle 端到端（假 ffmpeg + mock Drama）
// ---------------------------------------------------------------------------
const FAKE_FFMPEG = [
  '#!/bin/sh',
  '# 测试替身 ffmpeg：',
  '# - 带 -ss 视为抽帧调用：向最后一个参数（输出路径）写最小 PNG；',
  '# - 否则视为探测调用（ffmpeg -i）：stderr 打印 Duration 并以 1 退出（与真实行为一致）。',
  'IS_EXTRACT=0',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -ss) IS_EXTRACT=1 ;;',
  '  esac',
  'done',
  'if [ "$IS_EXTRACT" = "1" ]; then',
  '  OUT=""',
  '  for arg in "$@"; do OUT="$arg"; done',
  "  printf '\\x89PNG\\r\\n\\x1a\\nFAKEFRAME' > \"$OUT\"",
  '  exit 0',
  'fi',
  "echo \"Input #0, mov,mp4 from 'input.mp4':\" >&2",
  'echo "  Duration: 00:00:05.04, start: 0.000000, bitrate: 1024 kb/s" >&2',
  'exit 1',
].join('\n')

function stubDramaFetch() {
  const calls = []
  let uploadCount = 0
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    // P10 health 探针前置：放行探测。
    if (target.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    if (target.includes('/generate/upload')) {
      uploadCount += 1
      calls.push({ url: target, kind: 'upload' })
      return {
        ok: true,
        status: 200,
        json: async () => ({ filename: `drama-${uploadCount}.png` }),
        text: async () => '',
      }
    }
    if (target.includes('/generate/image2vl')) {
      let body = {}
      try { body = JSON.parse(String(init.body)) } catch { /* keep {} */ }
      calls.push({ url: target, kind: 'vlm', image: body.image })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            `色彩：暖黄（${body.image}）`,
            '光线：柔和',
            '材质：湿润青砖',
            '镜头语汇：中长焦浅景深',
            '节奏：平稳',
            '补充说明：这段不是字段，应被忽略',
          ].join('\n'),
        }),
        text: async () => '',
      }
    }
    throw new Error(`unexpected fetch: ${target}`)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('extractVideoStyle：落盘 → 抽帧 → 上传拿 filename → 风格归纳', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-video-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('视频参考测试')

    const { restore } = stubDramaFetch()
    let result
    try {
      result = await extractVideoStyle(
        registry,
        project.id,
        '参考片.mov',
        Buffer.from('fake-video-bytes'),
        { ffmpegPath: fakeFfmpeg },
      )
    } finally {
      restore()
    }

    // 时长来自假 ffmpeg 的 stderr。
    assert.ok(Math.abs(result.duration - 5.04) < 1e-9)
    // 5.04s → [0, 2, 4] 三帧；帧文件真实落盘且拿到 Drama filename。
    assert.equal(result.frames.length, 3)
    assert.deepEqual(result.frames.map((frame) => frame.time), [0, 2, 4])
    for (const frame of result.frames) {
      assert.ok(frame.url.startsWith(`/canvas-studio/assets/${project.id}/`), '帧 URL 应为同源相对路径')
      assert.match(frame.filename, /^drama-\d+\.png$/)
      const file = frame.url.split('/').at(-1)
      const bytes = await readFile(join(registry.assetsDir(project.id), file))
      assert.ok(bytes.length > 0, '帧 PNG 应已写入 assets')
    }
    // 风格归纳正文：头部 + 逐帧观察 + 末尾 5 项 tokens 段；≤4 帧时全部送 VLM。
    assert.match(result.summary, /【参考视频风格归纳】参考片\.mov · 3 帧 · 时长 5\.0s/)
    assert.equal(result.summary.split('帧 @').length - 1, 3)
    assert.match(result.summary, /色彩：暖黄（drama-1\.png）/)
    assert.match(result.summary, /【5 项风格 tokens】/)
    // 归并后的 tokens：固定 5 行、按字段顺序、跨帧去重、非字段行被丢弃。
    assert.deepEqual(
      result.tokens.split('\n').map((line) => line.split('：')[0]),
      ['色彩', '光线', '材质', '镜头语汇', '节奏'],
    )
    assert.match(result.tokens, /^色彩：暖黄（drama-1\.png）；暖黄（drama-2\.png）；暖黄（drama-3\.png）$/m)
    assert.equal(result.tokens.split('光线：').length - 1, 1, '帧间相同子句应去重，不得重复')
    assert.ok(!result.tokens.includes('补充说明'), '非字段行不得进入 tokens')
    // 视频本体留档，扩展名取自原始上传名（.mov）。
    assert.match(result.videoUrl, /\.mov$/)
    await readFile(join(registry.assetsDir(project.id), result.videoUrl.split('/').at(-1)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
