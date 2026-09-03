/**
 * P9.2 成片合成 契约测试。
 *
 * 1. collectClips / urlToAssetPath（纯函数）：clip 收集与 URL 反查。
 * 2. buildConcatList / buildTranscodeArgs / buildAmixArgs（纯函数）：参数构造。
 * 3. parseFfmpegStreams：从 ffmpeg stderr 解析分辨率/音轨。
 * 4. composeStudioVideo 端到端：假 ffmpeg（sh 替身）+ ProjectRegistry ——
 *    收集片段、统一转码、concat 拼接、落 assets 根目录 export-<uuid>.mp4、
 *    返回同源 URL + 时长；缺文件报「片段文件不存在」。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectClips,
  urlToAssetPath,
  buildConcatList,
  buildTranscodeArgs,
  buildAmixArgs,
  composeStudioVideo,
} from '../lib/compose.js'
import { parseFfmpegStreams, parseFfmpegDuration } from '../lib/ffmpeg-run.js'
import { ProjectRegistry } from '../lib/projects.js'

/** 构造一个合法视频画布节点。 */
function videoNode(id, url) {
  return {
    id,
    kind: 'video',
    url,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    createdAt: 1000,
    origin: 'agent',
    sourceIds: [],
  }
}

// ---------------------------------------------------------------------------
// 1. collectClips / urlToAssetPath
// ---------------------------------------------------------------------------
test('collectClips：仅收视频节点，缺失/非视频/重复跳过', () => {
  const nodes = [
    videoNode('a', '/canvas-studio/assets/p/a.mp4'),
    videoNode('b', '/canvas-studio/assets/p/b.mp4'),
    { ...videoNode('c', '/canvas-studio/assets/p/c.mp4'), kind: 'image' },
  ]
  const { clips, missingIds } = collectClips(nodes, ['a', 'b', 'c', 'zzz', 'a'])
  assert.deepEqual(clips.map((n) => n.id), ['a', 'b'])
  assert.deepEqual(missingIds, ['c', 'zzz'])
})

test('urlToAssetPath：反查末段文件名到 assets 目录', () => {
  const assetsDir = '/home/x/.dsh/canvas-studio/projects/P/assets'
  assert.equal(
    urlToAssetPath(assetsDir, '/canvas-studio/assets/P/clip-1.mp4'),
    join(assetsDir, 'clip-1.mp4'),
  )
})

// ---------------------------------------------------------------------------
// 2. 参数构造纯函数
// ---------------------------------------------------------------------------
test('buildConcatList：每行 file 引用', () => {
  assert.equal(buildConcatList(['/tmp/a.mp4', '/tmp/b.mp4']), "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n")
})

test('buildTranscodeArgs：无音轨加 -an，有音轨转 aac', () => {
  assert.ok(buildTranscodeArgs('/in.mp4', '/out.mp4', 1280, 720, 25, false).includes('-an'))
  const withAudio = buildTranscodeArgs('/in.mp4', '/out.mp4', 1280, 720, 25, true)
  assert.ok(withAudio.includes('-c:a') && withAudio.includes('aac'))
  // CR-022：等比缩放 + pad 补足（非等比拉伸修复）。vf 是单个数组元素里的完整
  // 滤镜串，子串断言用 some(includes) 而非 includes（后者是元素精确匹配）。
  const vf = withAudio.find((a) => a.startsWith('scale='))
  assert.ok(vf !== undefined && vf.includes('force_original_aspect_ratio=decrease'), 'vf 应含等比缩放')
  assert.ok(vf !== undefined && vf.includes('pad=1280:720:(ow-iw)/2:(oh-ih)/2'), 'vf 应含 pad 补足')
  assert.ok(vf !== undefined && vf.includes('fps=25'), 'vf 应含 fps')
})

test('buildAmixArgs：有 concat 音轨走 amix，无音轨直接映射 BGM 音轨', () => {
  const withAudio = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', true)
  assert.ok(withAudio.some((a) => a.includes('amix=duration=first')))
  assert.ok(withAudio.some((a) => a.includes('volume=0.8')))
  const noAudio = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', false)
  assert.ok(!noAudio.some((a) => a.includes('amix')))
  assert.deepEqual(noAudio.filter((a) => a === '-map'), ['-map', '-map'])
})

// ---------------------------------------------------------------------------
// 3. parseFfmpegStreams / parseFfmpegDuration
// ---------------------------------------------------------------------------
test('parseFfmpegStreams：解析分辨率与音轨存在', () => {
  const stderr = [
    'Input #0, mov,mp4 from \'i.mp4\':',
    '  Duration: 00:00:03.00, start: 0.000000, bitrate: 1024 kb/s',
    '    Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps',
    '    Stream #0:1: Audio: aac',
  ].join('\n')
  const streams = parseFfmpegStreams(stderr)
  assert.equal(streams.width, 1280)
  assert.equal(streams.height, 720)
  assert.equal(streams.hasAudio, true)
  const silent = parseFfmpegStreams('Stream #0:0: Video: h264, 640x360')
  assert.equal(silent.width, 640)
  assert.equal(silent.hasAudio, false)
})

test('parseFfmpegDuration：解析时长', () => {
  assert.ok(Math.abs(parseFfmpegDuration('  Duration: 00:00:03.00,') - 3) < 1e-9)
  assert.equal(parseFfmpegDuration('无时长'), 0)
})

// ---------------------------------------------------------------------------
// 4. composeStudioVideo 端到端（假 ffmpeg）
// ---------------------------------------------------------------------------
const FAKE_FFMPEG = [
  '#!/bin/sh',
  '# 假 ffmpeg 替身：',
  '# - 无 -y：视为探针（ffmpeg -i），向 stderr 打印分辨率/音轨/时长并 exit 1；',
  '# - 有 -y：视为产出调用，向最后一个参数（输出路径）写最小文件并 exit 0。',
  'HAS_Y=0',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -y) HAS_Y=1 ;;',
  '  esac',
  'done',
  'if [ "$HAS_Y" = "1" ]; then',
  '  OUT=""',
  '  for arg in "$@"; do OUT="$arg"; done',
  "  printf 'FAKEMP4' > \"$OUT\"",
  '  exit 0',
  'fi',
  "echo \"Input #0, mov,mp4 from 'input.mp4':\" >&2",
  'echo "  Duration: 00:00:03.00, start: 0.000000, bitrate: 1024 kb/s" >&2',
  'echo "    Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps" >&2',
  'echo "    Stream #0:1: Audio: aac" >&2',
  'exit 1',
].join('\n')

test('composeStudioVideo：三片段拼接落盘 export-<uuid>.mp4，返回 URL+时长', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('合成测试')
    const assetsDir = registry.assetsDir(project.id)

    // 预置两个真实存在的假片段文件（根茎 clipIds 反查命中）。
    const clipA = videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`)
    const clipB = videoNode('b', `/canvas-studio/assets/${project.id}/b.mp4`)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    await writeFile(join(assetsDir, 'b.mp4'), 'FAKEB')
    // 让 readCanvas 能拿到这两个节点。
    await registry.writeCanvas(project.id, [clipA, clipB])

    const result = await composeStudioVideo(
      registry,
      project.id,
      ['a', 'b'],
      undefined,
      { ffmpegPath: fakeFfmpeg },
    )

    assert.match(result.url, new RegExp(`^/canvas-studio/assets/${project.id}/export-[0-9a-f-]+\\.mp4$`))
    assert.ok(Math.abs(result.duration - 3) < 1e-9, '时长应来自假 ffmpeg 的 3s')
    const file = result.url.split('/').at(-1)
    const bytes = await readFile(join(assetsDir, file))
    assert.ok(bytes.length > 0, '成片文件应已写入 assets 根目录')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('composeStudioVideo：片段文件不存在报中文错误', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('合成缺失测试')
    const clipA = videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`)
    // 不写入 a.mp4 实体文件。
    await registry.writeCanvas(project.id, [clipA])

    await assert.rejects(
      () => composeStudioVideo(registry, project.id, ['a'], undefined, { ffmpegPath: fakeFfmpeg }),
      /片段文件不存在，请重新生成后再导出/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 5. 真实 ffmpeg 冒烟（系统有 ffmpeg 时运行；否则跳过）
// ---------------------------------------------------------------------------
async function findRealFfmpeg() {
  try {
    const { resolveFfmpegPath } = await import('../lib/ffmpeg-run.js')
    return resolveFfmpegPath()
  } catch {
    return null
  }
}

test('composeStudioVideo：真实 ffmpeg 双段 testsrc 拼接为连贯 mp4', { skip: process.platform === 'win32' && '依赖 POSIX 行为' }, async () => {
  const realFfmpeg = await findRealFfmpeg()
  if (realFfmpeg === null) return // 无 ffmpeg 则跳过（与假 ffmpeg 单测互补）

  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-real-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('真实合成冒烟')
    const assetsDir = registry.assetsDir(project.id)
    await mkdir(assetsDir, { recursive: true })

    const { spawn } = await import('node:child_process')
    const runReal = (args) => new Promise((resolve, reject) => {
      const child = spawn(realFfmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'] })
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolve(code) : reject(new Error(`ffmpeg 退出 ${code}`)))
    })

    // 两段 1s testsrc + 正弦音轨，统一 1280x720@25。
    const makeClip = async (name, text) => {
      const out = join(assetsDir, name)
      await runReal([
        '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=25:duration=1,drawtext=text='${text}'`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', out,
      ])
      return out
    }
    await makeClip('a.mp4', 'A')
    await makeClip('b.mp4', 'B')

    const clipA = videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`)
    const clipB = videoNode('b', `/canvas-studio/assets/${project.id}/b.mp4`)
    await registry.writeCanvas(project.id, [clipA, clipB])

    const result = await composeStudioVideo(registry, project.id, ['a', 'b'], undefined, { ffmpegPath: realFfmpeg })
    const file = result.url.split('/').at(-1)
    const bytes = await readFile(join(assetsDir, file))
    assert.ok(bytes.length > 0, '成片应落盘')

    // 回探成片：应为视频流 + 时长约 2s。
    const probe = await new Promise((resolve) => {
      const child = spawn(realFfmpeg, ['-i', join(assetsDir, file)], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr?.on('data', (c) => { stderr += String(c) })
      child.on('close', () => resolve(stderr))
    })
    assert.ok(parseFfmpegStreams(probe).width !== undefined, '成片应包含视频流')
    assert.ok(Math.abs(parseFfmpegDuration(probe) - 2) < 0.5, `成片时长应≈2s，实得 ${parseFfmpegDuration(probe)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
