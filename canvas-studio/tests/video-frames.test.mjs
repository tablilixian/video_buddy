/**
 * C3 尾帧链契约测试。
 *
 * 1. planLastFrameSeek —— 末帧 seek 时间点（纯函数，ε 内缩防尾部黑帧）。
 * 2. extractLastFrame 端到端（假 ffmpeg 替身 + 上传注入）：抽帧落盘 → 回传
 *    filename → 落画布 frame 参考节点（血缘指向源视频）。
 * 3. 源视频文件缺失时早报错（不落半成品节点）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import { planLastFrameSeek, extractLastFrame } from '../lib/video-frames.js'

// 假 ffmpeg：无 -y 视为探针（打印时长/分辨率后退出 1），有 -y 视为产出（写文件）。
const FAKE_FFMPEG = [
  '#!/bin/sh',
  'HAS_Y=0',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -y) HAS_Y=1 ;;',
  '  esac',
  'done',
  'if [ "$HAS_Y" = "1" ]; then',
  '  OUT=""',
  '  for arg in "$@"; do OUT="$arg"; done',
  "  printf 'FAKEFRAME' > \"$OUT\"",
  '  exit 0',
  'fi',
  "echo \"Input #0, mov,mp4 from 'a.mp4':\" >&2",
  'echo "  Duration: 00:00:05.00, start: 0.000000, bitrate: 1024 kb/s" >&2',
  'echo "    Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps" >&2',
  'exit 1',
].join('\n')

function videoNode(id, url, title = '分镜 1 · 视频') {
  return {
    id,
    kind: 'video',
    url,
    ...(title !== undefined ? { title } : {}),
    x: 0,
    y: 0,
    width: 480,
    height: 270,
    createdAt: 1,
    toolName: 'video_generate',
    runId: id,
    origin: 'agent',
    sourceIds: [],
    duration: 5,
  }
}

// ---------------------------------------------------------------------------
// 1. planLastFrameSeek
// ---------------------------------------------------------------------------
test('planLastFrameSeek：时长内缩 0.05s，短片/非法时长退化为 0', () => {
  assert.equal(planLastFrameSeek(5), 4.95)
  assert.equal(planLastFrameSeek(8.5), 8.45)
  assert.equal(planLastFrameSeek(0.02), 0, '极短片不应出现负 seek')
  assert.equal(planLastFrameSeek(0), 0)
  assert.equal(planLastFrameSeek(Number.NaN), 0, '时长探测失败退化为首帧')
})

// ---------------------------------------------------------------------------
// 2. extractLastFrame 端到端
// ---------------------------------------------------------------------------
test('extractLastFrame：抽末帧落盘 + 回传 filename + 落 frame 参考节点', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-frame-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('尾帧链测试')
    const assetsDir = registry.assetsDir(project.id)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEVIDEO')
    const clip = videoNode('v1', `/canvas-studio/assets/${project.id}/a.mp4`)
    await registry.writeCanvas(project.id, [clip])

    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)

    let uploadedBytes = 0
    const result = await extractLastFrame(registry, project.id, clip.url, {
      ffmpegPath: fakeFfmpeg,
      upload: async (bytes) => {
        uploadedBytes = bytes.length
        return 'last-frame.png'
      },
    })

    assert.equal(result.filename, 'last-frame.png', 'filename 应来自上传实现')
    assert.ok(uploadedBytes > 0, '帧图字节应已上传')
    assert.equal(result.duration, 5, '时长来自 ffmpeg 探测')
    assert.equal(result.width, 1280)
    assert.equal(result.height, 720)
    assert.match(result.url, new RegExp(`^/canvas-studio/assets/${project.id}/[0-9a-f-]+\\.png$`))

    // 帧图文件确实落在项目 assets 目录
    const file = result.url.split('/').at(-1)
    const bytes = await readFile(join(assetsDir, file))
    assert.equal(bytes.toString(), 'FAKEFRAME')

    // 画布节点：frame 参考 + 血缘指向源视频
    const nodes = (await registry.readCanvas(project.id)).nodes
    const node = nodes.find((entry) => entry.id === result.nodeId)
    assert.ok(node, '应落一个末帧节点')
    assert.equal(node.kind, 'image')
    assert.equal(node.isReference, true)
    assert.equal(node.referenceRole, 'frame', '末帧应可作为首帧参考')
    assert.deepEqual(node.sourceIds, ['v1'], '血缘应指向源视频节点')
    assert.equal(node.toolName, 'extract_last_frame')
    assert.match(node.title, /末帧/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 3. 源视频缺失
// ---------------------------------------------------------------------------
test('extractLastFrame：源视频文件不存在时早报错且不落节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-frame-missing-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('尾帧链测试')
    const before = (await registry.readCanvas(project.id)).nodes.length
    await assert.rejects(
      extractLastFrame(registry, project.id, `/canvas-studio/assets/${project.id}/nope.mp4`, {
        upload: async () => 'x.png',
      }),
      /视频文件不存在/,
    )
    const after = (await registry.readCanvas(project.id)).nodes.length
    assert.equal(after, before, '失败时不应落节点')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
