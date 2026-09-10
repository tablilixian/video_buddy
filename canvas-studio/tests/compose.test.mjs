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
import { chmod, mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectClips,
  urlToAssetPath,
  buildConcatList,
  buildTranscodeArgs,
  buildAmixArgs,
  buildBgmFade,
  fadeAnchorOf,
  bgmShortfallMessage,
  auditTimeline,
  BGM_SHORTFALL_TOLERANCE_SEC,
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

test('buildAmixArgs：有 concat 音轨走 amix（normalize=0 + 配平音量），无音轨直接映射 BGM 音轨', () => {
  const withAudio = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', true)
  // CV-141：线性求和（默认 normalize=1 会把每一路各乘 0.5 / −6dB），BGM 只作铺底。
  assert.ok(withAudio.some((a) => a.includes('amix=inputs=2:duration=first:normalize=0')))
  assert.ok(withAudio.some((a) => a.includes('volume=0.35')), '混音分支 BGM 音量取 0.35')
  const noAudio = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', false)
  assert.ok(!noAudio.some((a) => a.includes('amix')))
  assert.ok(noAudio.some((a) => a.includes('volume=0.8')), 'BGM 单轨分支无归一化，音量仍取 0.8')
  assert.deepEqual(noAudio.filter((a) => a === '-map'), ['-map', '-map'])
})

// ---------------------------------------------------------------------------
// 2b. C5：统一调色 pass + BGM 淡入淡出
// ---------------------------------------------------------------------------
test('buildTranscodeArgs：colorGrade 非空时 vf 末尾追加 eq（治色调漂移）', () => {
  const graded = buildTranscodeArgs('/in.mp4', '/out.mp4', 1280, 720, 25, true, 'eq=contrast=1.03:saturation=1.02')
  const vf = graded.find((a) => a.startsWith('scale='))
  assert.ok(vf !== undefined && vf.includes('fps=25,eq=contrast=1.03:saturation=1.02'), 'grade 应接在 fps 之后')
  // 不传 grade 时 vf 不应含 eq（默认由调用方解析为中性预设，纯函数只负责拼接）。
  const plain = buildTranscodeArgs('/in.mp4', '/out.mp4', 1280, 720, 25, true)
  const plainVf = plain.find((a) => a.startsWith('scale='))
  assert.ok(plainVf !== undefined && plainVf.endsWith('fps=25'), '无 grade 时 vf 以 fps 结尾')
})

test('buildBgmFade：完整时长淡入淡出，过短只淡入，未知时长无淡化', () => {
  const full = buildBgmFade(10)
  assert.ok(full.includes('afade=t=in:st=0:d=1'), '应含淡入')
  assert.ok(full.includes('afade=t=out:st=9.000:d=1'), '应含淡出（末 1s）')
  const short = buildBgmFade(0.5)
  assert.ok(short.includes('afade=t=in'), '过短仍淡入')
  assert.ok(!short.includes('t=out'), '过短不淡出')
  assert.equal(buildBgmFade(0), '', '未知时长不应加淡化')
  assert.equal(buildBgmFade(NaN), '', 'NaN 时长不应加淡化')
})

test('buildAmixArgs：传入 bgmDuration 时 BGM 链含 afade 淡入淡出', () => {
  const withAudio = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', true, 10)
  const chain = withAudio.find((a) => a.startsWith('[1:a]'))
  assert.ok(chain !== undefined && chain.includes('volume=0.35'), '混音分支应钳制 BGM 音量')
  assert.ok(chain !== undefined && chain.includes('afade=t=in:st=0:d=1'), 'BGM 链应含淡入')
  assert.ok(chain !== undefined && chain.includes('afade=t=out:st=9.000:d=1'), 'BGM 链应含淡出')
  assert.ok(withAudio.some((a) => a.includes('amix=inputs=2:duration=first:normalize=0')), '仍走 amix')
  // 无 concat 音轨分支也应带 fade，且只映射 BGM 音轨（无 amix）。
  const noAudio = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', false, 10)
  const noAudioChain = noAudio.find((a) => a.startsWith('[1:a]'))
  assert.ok(noAudioChain !== undefined && noAudioChain.includes('afade=t=in'), '无音轨分支也应淡入')
  assert.ok(!noAudio.some((a) => a.includes('amix')), '无音轨分支不 amix')
})

// ---------------------------------------------------------------------------
// 2c. CV-138 时长守卫 / 淡出锚点 / 输出时长锚定；CV-142 时间轴校验
// ---------------------------------------------------------------------------
test('fadeAnchorOf：取 BGM 与成片真值中的较小者（未知值忽略）', () => {
  assert.equal(fadeAnchorOf(20, 6), 6, 'BGM 长于成片 → 锚成片（否则淡出落在片外）')
  assert.equal(fadeAnchorOf(6, 20), 6, 'BGM 短于成片 → 锚 BGM')
  assert.equal(fadeAnchorOf(10, 0), 10, '成片未知 → 锚 BGM')
  assert.equal(fadeAnchorOf(0, 10), 10, 'BGM 未知 → 锚成片')
  assert.equal(fadeAnchorOf(0, 0), 0, '都未知 → 不加淡化')
  assert.equal(fadeAnchorOf(NaN, NaN), 0)
})

test('bgmShortfallMessage：短于成片即报错，容差内与不可判定不报', () => {
  // 实测场景：成片 15.500s、BGM 15.024s → 差 0.476s > 容差 → 报错。
  const message = bgmShortfallMessage(15.024, 15.5)
  assert.ok(message !== null && message.includes('短 0.476 秒'), `应报出精确差额，实得 ${message}`)
  assert.ok(message.includes('成片 15.500s') && message.includes('BGM 15.024s'), '应给出两个时长')
  assert.ok(message.includes('建议 16s'), '应给出建议值（向上取整到秒）')
  // 边界：容差以内不报（探测本身有毫秒抖动）。
  assert.equal(bgmShortfallMessage(15.48, 15.5), null, '差额 0.02s 在容差内')
  assert.equal(bgmShortfallMessage(15.5 - BGM_SHORTFALL_TOLERANCE_SEC, 15.5), null, '恰在容差边界不报')
  // 不可判定（任一时长未知）不报——避免把「探测失败」当成「BGM 太短」。
  assert.equal(bgmShortfallMessage(0, 15.5), null)
  assert.equal(bgmShortfallMessage(15, 0), null)
  // 等长 / 更长不报。
  assert.equal(bgmShortfallMessage(15.5, 15.5), null)
  assert.equal(bgmShortfallMessage(20, 15.5), null)
})

test('buildAmixArgs：成片真值可用时用 -t 锚定输出，不可用时回退 -shortest', () => {
  // CV-138：-shortest 在 BGM 单轨分支会按 BGM 长度裁掉画面（6s 画面 + 2s BGM → 2.000s）。
  // 守卫保证「BGM < 成片」不会走到这里，所以用 BGM 20s / 成片 6s 验证输出锚定。
  const anchored = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', false, 20, 6)
  const tIndex = anchored.indexOf('-t')
  assert.ok(tIndex >= 0 && anchored[tIndex + 1] === '6.000', `应用 -t 锚定成片真值，实得 ${JSON.stringify(anchored)}`)
  assert.ok(!anchored.includes('-shortest'), '不应再出现 -shortest')
  // 淡化锚点取小者 = 成片 6s（不是 BGM 的 20s）——否则淡出区间整个落在片外。
  const chain = anchored.find((a) => a.startsWith('[1:a]'))
  assert.ok(chain !== undefined && chain.includes('afade=t=out:st=5.000:d=1'), `淡出应锚 6s 成片，实得 ${chain}`)
  // 真值不可得 → 回退 -shortest（调用方会留 warning）。
  const fallback = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', false, 20, 0)
  assert.ok(fallback.includes('-shortest'))
  // 纯函数层面仍要正确处理「BGM 短于成片」：锚 BGM（守卫会先拦，但函数本身不能错）。
  const shortBgm = buildAmixArgs('/c.mp4', '/bgm.mp3', '/out.mp4', false, 2, 6)
  const shortChain = shortBgm.find((a) => a.startsWith('[1:a]'))
  assert.ok(shortChain !== undefined && shortChain.includes('afade=t=out:st=1.000:d=1'), `BGM 短时锚 BGM，实得 ${shortChain}`)
})

test('auditTimeline：三组对照各自独立触发（请求↔真值 / 分镜↔请求 / 真值↔目标）', () => {
  // 全对齐 → 无提示。
  assert.deepEqual(auditTimeline({ storyboardDeclared: 15, clipDeclared: 15, filmDuration: 15 }), [])
  // 帧量化漂移（本功能的实测主线：3×5s 请求 → 15.500s 真值）。
  const drift = auditTimeline({ storyboardDeclared: 15, clipDeclared: 15, filmDuration: 15.5 })
  assert.equal(drift.length, 1)
  assert.ok(drift[0].includes('成片真值 15.500s') && drift[0].includes('BGM 请按'), `实得 ${drift[0]}`)
  // agent 没照分镜表传 duration：分镜声明 15，实际生成请求 18。
  const mismatch = auditTimeline({ storyboardDeclared: 15, clipDeclared: 18, filmDuration: 18 })
  assert.equal(mismatch.length, 1)
  assert.ok(mismatch[0].includes('分镜表声明时长合计 15s') && mismatch[0].includes('实际生成用了 18s'))
  // 偏离项目目标总时长。
  const target = auditTimeline({ storyboardDeclared: 0, clipDeclared: 0, filmDuration: 15.5, targetDuration: 30 })
  assert.equal(target.length, 1)
  assert.ok(target[0].includes('目标总时长 30s'))
  // 三组同时命中 → 三条提示，顺序为「最近的危害优先」。
  const all = auditTimeline({ storyboardDeclared: 15, clipDeclared: 18, filmDuration: 18.5, targetDuration: 30 })
  assert.equal(all.length, 3)
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
  '# - 设了 FAKE_FFMPEG_LOG 时把每次调用的完整 argv 追加进去，供测试断言真实参数',
  '#   （「多镜转码带 -an」「混音 normalize=0」这类结论不能只靠纯函数断言）。',
  'if [ -n "$FAKE_FFMPEG_LOG" ]; then printf \'%s\\n\' "$*" >> "$FAKE_FFMPEG_LOG"; fi',
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

/**
 * CV-138 守卫测试专用替身：探针时长**按被探对象分档**——文件名含 `bgm` 的报 1s、
 * 其余报 3s，于是「成片 3s + BGM 1s」自然触发「BGM 比成片短」的守卫（同一份替身
 * 做不到，因为守卫要比的正是两个不同文件的时长）。
 */
const FAKE_FFMPEG_SHORT_BGM = [
  '#!/bin/sh',
  'if [ -n "$FAKE_FFMPEG_LOG" ]; then printf \'%s\\n\' "$*" >> "$FAKE_FFMPEG_LOG"; fi',
  'HAS_Y=0',
  'LAST=""',
  'for arg in "$@"; do',
  '  LAST="$arg"',
  '  case "$arg" in',
  '    -y) HAS_Y=1 ;;',
  '  esac',
  'done',
  'if [ "$HAS_Y" = "1" ]; then',
  "  printf 'FAKEMP4' > \"$LAST\"",
  '  exit 0',
  'fi',
  "echo \"Input #0, mov,mp4 from 'input.mp4':\" >&2",
  'case "$LAST" in',
  '  *bgm*) D="00:00:01.00" ;;',
  '  *) D="00:00:03.00" ;;',
  'esac',
  'echo "  Duration: $D, start: 0.000000, bitrate: 1024 kb/s" >&2',
  'echo "    Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps" >&2',
  'echo "    Stream #0:1: Audio: aac" >&2',
  'exit 1',
].join('\n')

/** 读假 ffmpeg 记录的真实 argv 序列（每行一次调用）。 */
async function readFfmpegLog(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim().length > 0)
  } catch {
    return []
  }
}

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

test('composeStudioVideo：带 BGM 走 amix 混音并落盘成片（C5 淡入淡出路径不崩）', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-bgm-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('合成BGM测试')
    const assetsDir = registry.assetsDir(project.id)

    const clipA = videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`)
    const clipB = videoNode('b', `/canvas-studio/assets/${project.id}/b.mp4`)
    const bgm = videoNode('bgm', `/canvas-studio/assets/${project.id}/bgm.mp4`)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    await writeFile(join(assetsDir, 'b.mp4'), 'FAKEB')
    await writeFile(join(assetsDir, 'bgm.mp4'), 'FAKEBGM')
    await registry.writeCanvas(project.id, [clipA, clipB, bgm])

    const result = await composeStudioVideo(
      registry,
      project.id,
      ['a', 'b'],
      'bgm',
      { ffmpegPath: fakeFfmpeg },
    )
    assert.match(result.url, new RegExp(`^/canvas-studio/assets/${project.id}/export-[0-9a-f-]+\\.mp4$`))
    const file = result.url.split('/').at(-1)
    assert.ok((await readFile(join(assetsDir, file))).length > 0, '含 BGM 的成片应落盘')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-141/CV-143：单镜整出保留原生音轨，混音走 normalize=0 且输出锚定成片真值', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-single-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)
    const logPath = join(dir, 'ffmpeg.log')
    process.env.FAKE_FFMPEG_LOG = logPath

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('单镜合成')
    const assetsDir = registry.assetsDir(project.id)
    // CV-142：片段带请求时长（5s），用于与成片真值（假 ffmpeg 报 3s）对照。
    const clipA = { ...videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`), declaredDuration: 5 }
    const bgm = videoNode('bgm', `/canvas-studio/assets/${project.id}/bgm.mp4`)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    await writeFile(join(assetsDir, 'bgm.mp4'), 'FAKEBGM')
    await registry.writeCanvas(project.id, [clipA, bgm])

    const result = await composeStudioVideo(registry, project.id, ['a'], 'bgm', { ffmpegPath: fakeFfmpeg })

    assert.equal(result.audioComposition, 'native+bgm', '单镜 + BGM = 环境声与 BGM 叠混')
    assert.equal(result.duration, 3)
    const log = await readFfmpegLog(logPath)
    const transcodes = log.filter((line) => line.includes('clip-0.mp4'))
    assert.ok(transcodes.length > 0, `应有转码调用，实得日志 ${JSON.stringify(log)}`)
    assert.ok(
      transcodes.every((line) => !/(^|\s)-an(\s|$)/u.test(line)),
      `单镜转码**不应**带 -an（要保留原生环境声），实得 ${JSON.stringify(transcodes)}`,
    )
    const mix = log.find((line) => line.includes('export-'))
    assert.ok(mix !== undefined && mix.includes('normalize=0'), `混音应线性求和，实得 ${mix}`)
    assert.ok(mix !== undefined && mix.includes('amix=inputs=2'), `应走 amix 分支，实得 ${mix}`)
    assert.ok(mix !== undefined && mix.includes('-t 3.000'), `输出时长应锚定成片真值，实得 ${mix}`)
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-141：多镜拼接的每段转码都带 -an（各镜环境声全部丢弃）', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-multi-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)
    const logPath = join(dir, 'ffmpeg.log')
    process.env.FAKE_FFMPEG_LOG = logPath

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('多镜合成')
    const assetsDir = registry.assetsDir(project.id)
    const clipA = videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`)
    const clipB = videoNode('b', `/canvas-studio/assets/${project.id}/b.mp4`)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    await writeFile(join(assetsDir, 'b.mp4'), 'FAKEB')
    await registry.writeCanvas(project.id, [clipA, clipB])

    await composeStudioVideo(registry, project.id, ['a', 'b'], undefined, { ffmpegPath: fakeFfmpeg })

    const log = await readFfmpegLog(logPath)
    const transcodes = log.filter((line) => line.includes('clip-0.mp4') || line.includes('clip-1.mp4'))
    assert.equal(transcodes.length, 2, `应有两段转码，实得 ${JSON.stringify(log)}`)
    for (const line of transcodes) {
      assert.ok(/(^|\s)-an(\s|$)/u.test(line), `多镜每段都该丢弃音轨，实得 ${line}`)
    }
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-138：BGM 短于成片直接报错，且不留半成品成片', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-compose-short-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG_SHORT_BGM)
    await chmod(fakeFfmpeg, 0o755)

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('BGM 过短')
    const assetsDir = registry.assetsDir(project.id)
    const clipA = videoNode('a', `/canvas-studio/assets/${project.id}/a.mp4`)
    const clipB = videoNode('b', `/canvas-studio/assets/${project.id}/b.mp4`)
    const bgm = videoNode('bgm', `/canvas-studio/assets/${project.id}/bgm.mp4`)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    await writeFile(join(assetsDir, 'b.mp4'), 'FAKEB')
    await writeFile(join(assetsDir, 'bgm.mp4'), 'FAKEBGM')
    await registry.writeCanvas(project.id, [clipA, clipB, bgm])

    // 假 ffmpeg 对 BGM 报 1s、对成片报 3s → 差 2.000s，远超 0.05s 容差。
    await assert.rejects(
      () => composeStudioVideo(registry, project.id, ['a', 'b'], 'bgm', { ffmpegPath: fakeFfmpeg }),
      /BGM 比成片短 2\.000 秒/,
    )
    const files = await readdir(assetsDir)
    assert.ok(
      !files.some((name) => name.startsWith('export-')),
      `不应落半成品成片，实得 ${JSON.stringify(files)}`,
    )
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
    // CV-141 / CV-143：两镜拼接 → 原生音轨按策略丢弃、又没给 BGM → 成片无声，必须告警。
    assert.equal(result.audioComposition, 'none', '多镜无 BGM 应为无声成片')
    assert.ok(
      (result.warnings ?? []).some((warning) => warning.includes('成片将无声')),
      `应告警「成片将无声」，实得 ${JSON.stringify(result.warnings)}`,
    )

    // 回探成片：应为视频流 + 时长约 2s。
    const probe = await new Promise((resolve) => {
      const child = spawn(realFfmpeg, ['-i', join(assetsDir, file)], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr?.on('data', (c) => { stderr += String(c) })
      child.on('close', () => resolve(stderr))
    })
    assert.ok(parseFfmpegStreams(probe).width !== undefined, '成片应包含视频流')
    assert.equal(parseFfmpegStreams(probe).hasAudio, false, '多镜成片不应带原生环境声（已按策略 -an）')
    assert.ok(Math.abs(parseFfmpegDuration(probe) - 2) < 0.5, `成片时长应≈2s，实得 ${parseFfmpegDuration(probe)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
