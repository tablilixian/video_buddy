/**
 * S2a（2026-10-28 · CV-040 收口）：无音轨段补等长静音轨 + 全分支统一 48k 立体声。
 *
 * 判据直接搬 S0 探针（scripts/probe/audio-baseline.probe.mjs）那 3 条 —— 修复后应
 * **全绿**，故可进 tests/（探针那 3 条在修复前是红的，进 tests/ 会撞 run-smoke 门禁）。
 * 另加：④ 全无声片段成片仍有音轨、⑤ 编码参数 diff 只多 -ar/-ac、⑥ 探测失败不伪造时长。
 *
 * 音频时长判定走 scripts/probe/lib/audio-probe.mjs（wav 逐秒 RMS，**禁 -f null - 判时长**）。
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAudioCodecArgs, buildTranscodeArgs, composeStudioVideo } from '../lib/compose.js'
import { resolveFfmpegPath } from '../lib/ffmpeg-run.js'
import { ProjectRegistry } from '../lib/projects.js'
import { audioRmsBySecond, parseFfmpegDuration, parseFfmpegStreams, runFfmpegCapture } from '../scripts/probe/lib/audio-probe.mjs'
import { ensureAudioFixtures } from '../scripts/fixtures/make-audio-fixtures.mjs'

const AUDIO_TOLERANCE_SEC = 0.15
const SILENT_RMS_THRESHOLD = 0.02
const SOUND_RMS_THRESHOLD = 0.05

// ---------------------------------------------------------------------------
// 1. buildAudioCodecArgs 纯函数
// ---------------------------------------------------------------------------
test('buildAudioCodecArgs：有音轨 = aac + 48k 立体声，参数 diff 恰好多 -ar/-ac 两项', () => {
  assert.deepEqual(
    buildAudioCodecArgs({ hasAudio: true }),
    ['-c:a', 'aac', '-ar', '48000', '-ac', '2'],
    '交付口径统一为 48kHz 立体声（实验 C 对策），无其他参数',
  )
})

test('buildAudioCodecArgs：无音轨 = anullsrc 静音轨 + aac + 按真实时长 -t + -shortest 兜底', () => {
  const padded = buildAudioCodecArgs({ hasAudio: false, clipDurationSec: 2 })
  assert.ok(padded.includes('anullsrc=r=48000:cl=stereo'), '补静音输入')
  assert.ok(padded.includes('-c:a') && padded.includes('aac'), '补的静音轨同样编码 aac')
  assert.ok(padded.includes('-ar') && padded.includes('48000') && padded.includes('-ac') && padded.includes('2'), '统一 48k 立体声')
  const tIndex = padded.indexOf('-t')
  assert.ok(tIndex >= 0 && padded[tIndex + 1] === '2.000', '按段真实时长裁静音，实得 ' + JSON.stringify(padded))
  assert.ok(padded.includes('-shortest'), '-shortest 兜底')
  assert.ok(!padded.includes('-an'), '不得再丢流')
  // 时长未探到（0）→ 不伪造时长，只留 -shortest。
  const unknown = buildAudioCodecArgs({ hasAudio: false, clipDurationSec: 0 })
  assert.ok(!unknown.includes('-t'), '探测失败不得伪造时长')
  assert.ok(unknown.includes('-shortest'))
})

test('buildTranscodeArgs：无音轨时 anullsrc 输入声明在 -vf 输出选项之前（ffmpeg 选项归属约束）', () => {
  const args = buildTranscodeArgs('/in.mp4', '/out.mp4', 320, 240, 25, false, undefined, 1.5)
  // 数组 indexOf 是元素精确匹配；anullsrc 是完整参数串（含 r=/cl=），用 findIndex+includes。
  const anullIdx = args.findIndex((a) => typeof a === 'string' && a.includes('anullsrc'))
  assert.ok(anullIdx >= 0 && anullIdx < args.indexOf('-vf'), `第二输入应在输出选项前，实得 ${JSON.stringify(args)}`)
  assert.ok(args.includes('-t') && args.includes('1.500'))
})

// ---------------------------------------------------------------------------
// 2. 假 ffmpeg 端到端：探测失败不伪造时长、降级有 warning
// ---------------------------------------------------------------------------
const FAKE_FFMPEG_NO_DURATION = [
  '#!/bin/sh',
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
  'echo "    Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps" >&2',
  'exit 1',
].join('\n')

test('composeStudioVideo：探测失败（无 Duration 行）→ 不伪造补静音时长、降级有 warning', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-pad-nodec-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG_NO_DURATION)
    await chmod(fakeFfmpeg, 0o755)
    const logPath = join(dir, 'ffmpeg.log')
    process.env.FAKE_FFMPEG_LOG = logPath

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('无时长降级')
    const assetsDir = registry.assetsDir(project.id)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    await registry.writeCanvas(project.id, [{
      id: 'a', kind: 'video', url: `/canvas-studio/assets/${project.id}/a.mp4`,
      x: 0, y: 0, width: 320, height: 240, createdAt: 1000, origin: 'agent', sourceIds: [],
    }])

    const result = await composeStudioVideo(registry, project.id, ['a'], undefined, { ffmpegPath: fakeFfmpeg })
    assert.ok(
      (result.warnings ?? []).some((w) => w.includes('时长未探到')),
      `探测失败应有降级 warning，实得 ${JSON.stringify(result.warnings)}`,
    )
    const log = await readFile(logPath, 'utf8')
    const transcode = log.split('\n').find((line) => line.includes('clip-0.mp4'))
    assert.ok(transcode !== undefined, '应有转码调用')
    assert.ok(transcode.includes('anullsrc'), '无 Duration 时该段仍补静音轨（-shortest 兜底）')
    assert.ok(!/-t \d/u.test(transcode), `不得伪造时长（无 -t），实得 ${transcode}`)
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(dir, { recursive: true, force: true })
  }
})

const FAKE_FFMPEG_SILENT = [
  '#!/bin/sh',
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
  'exit 1',
].join('\n')

test('composeStudioVideo：补静音时长用探测真值，不用节点声明值（H3 帧量化漂移场景）', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-pad-real-'))
  try {
    const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
    await writeFile(fakeFfmpeg, FAKE_FFMPEG_SILENT)
    await chmod(fakeFfmpeg, 0o755)
    const logPath = join(dir, 'ffmpeg.log')
    process.env.FAKE_FFMPEG_LOG = logPath

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('真值补静音')
    const assetsDir = registry.assetsDir(project.id)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEA')
    // 声明 5s，假 ffmpeg 探测真值 3s（帧量化/请求不符的常态）。
    await registry.writeCanvas(project.id, [{
      id: 'a', kind: 'video', url: `/canvas-studio/assets/${project.id}/a.mp4`, declaredDuration: 5,
      x: 0, y: 0, width: 320, height: 240, createdAt: 1000, origin: 'agent', sourceIds: [],
    }])

    await composeStudioVideo(registry, project.id, ['a'], undefined, { ffmpegPath: fakeFfmpeg })
    const log = await readFile(logPath, 'utf8')
    const transcode = log.split('\n').find((line) => line.includes('clip-0.mp4'))
    assert.ok(transcode !== undefined, '应有转码调用')
    assert.ok(transcode.includes('-t 3.000'), `应按探测真值 3s 补静音，实得 ${transcode}`)
    assert.ok(!transcode.includes('-t 5.000'), `不得用声明值补静音，实得 ${transcode}`)
    assert.ok(transcode.includes('anullsrc'), '该段应补静音轨')
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 3. 真实 ffmpeg 端到端（S0 探针判据搬入，此时应全绿）
// ---------------------------------------------------------------------------
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..')
function findRealFfmpeg() {
  try {
    return resolveFfmpegPath()
  } catch {
    const bundled = join(repoRoot, 'dsh-plugin-desktop', 'build', 'ffmpeg', `${process.platform}-${process.arch}`, 'ffmpeg')
    return existsSync(bundled) ? bundled : null
  }
}

async function composeFixtureClips(ffmpegPath, clipNames, dir) {
  const fixturePaths = await ensureAudioFixtures({ ffmpegPath })
  const registry = new ProjectRegistry(dir)
  const project = await registry.create('补静音验收')
  const assetsDir = registry.assetsDir(project.id)
  await mkdir(assetsDir, { recursive: true })
  for (const name of clipNames) await copyFile(fixturePaths[name], join(assetsDir, name))
  const nodes = clipNames.map((name, index) => ({
    id: `clip-${index}`, kind: 'video', url: `/canvas-studio/assets/${project.id}/${name}`,
    x: index * 300, y: 0, width: 320, height: 240, createdAt: 1000 + index, origin: 'agent', sourceIds: [],
  }))
  await registry.writeCanvas(project.id, nodes)
  const result = await composeStudioVideo(registry, project.id, nodes.map((n) => n.id), undefined, { ffmpegPath })
  return { result, finalPath: join(assetsDir, result.url.split('/').at(-1)) }
}

test('S0 判据①②：3 段含 1 段无声 → 音轨时长==视频时长(±0.15s) 且无声段区间静音、相邻有声', async () => {
  const ffmpegPath = findRealFfmpeg()
  if (ffmpegPath === null) return
  const dir = await mkdtemp(join(tmpdir(), 'cs-pad-real-'))
  try {
    const { result, finalPath } = await composeFixtureClips(
      ffmpegPath,
      ['t-audio2s.mp4', 't-silent2s.mp4', 't-audio2s.mp4'],
      dir,
    )
    assert.ok(
      (result.warnings ?? []).some((w) => w.includes('第 2 段无原生音轨，已补 2.0s 静音')),
      `应逐段回显补静音，实得 ${JSON.stringify(result.warnings)}`,
    )
    const rms = await audioRmsBySecond(finalPath, { ffmpegPath, binSec: 0.5 })
    const probe = await runFfmpegCapture(ffmpegPath, ['-i', finalPath])
    const streams = parseFfmpegStreams(probe.stderr)
    assert.equal(streams.hasAudio, true, '成片应带音轨（含补的静音段）')
    // 视频时长：`-an -c copy` 导出后读 Duration（容器 Duration 会取 max，补静音后可能冒充）。
    const videoOnly = join(dir, 'video-only.mp4')
    await runFfmpegCapture(ffmpegPath, ['-i', finalPath, '-an', '-c:v', 'copy', '-y', videoOnly])
    const videoProbe = await runFfmpegCapture(ffmpegPath, ['-i', videoOnly])
    const videoSec = parseFfmpegDuration(videoProbe.stderr)
    const gap = Math.abs(rms.durationSec - videoSec)
    assert.ok(gap <= AUDIO_TOLERANCE_SEC, `音轨 ${rms.durationSec.toFixed(3)}s 应与视频 ${videoSec.toFixed(3)}s 对齐（±0.15s），差 ${gap.toFixed(3)}s`)
    // ② 无声段 [2s,4s)（0.5s bin 下标 4..7）静音；相邻区间有声。
    assert.ok(rms.bins.length >= 12, `应有 ≥12 个 0.5s bin，实得 ${rms.bins.length}`)
    const middle = rms.bins.slice(4, 8)
    assert.ok(middle.every((v) => v < SILENT_RMS_THRESHOLD), `无声段区间应静音，实得 ${JSON.stringify(rms.bins.map((v) => Number(v.toFixed(4))))}`)
    assert.ok(rms.bins.slice(0, 4).some((v) => v > SOUND_RMS_THRESHOLD), '头部应有声（第 1 段）')
    assert.ok(rms.bins.slice(8).some((v) => v > SOUND_RMS_THRESHOLD), '尾部应有声（第 3 段）')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('S0 判据③：16k 单声道 × 48k 立体声混拼 → 统一 48k 立体声后音轨==视频时长(±0.15s)', async () => {
  const ffmpegPath = findRealFfmpeg()
  if (ffmpegPath === null) return
  const dir = await mkdtemp(join(tmpdir(), 'cs-pad-rate-'))
  try {
    const { finalPath } = await composeFixtureClips(
      ffmpegPath,
      ['t-audio2s-16kmono.mp4', 't-audio2s-48kstereo.mp4'],
      dir,
    )
    const probe = await runFfmpegCapture(ffmpegPath, ['-i', finalPath])
    const streams = parseFfmpegStreams(probe.stderr)
    assert.equal(streams.hasAudio, true)
    // 交付口径落进产物：48kHz 立体声（实验 C 的根因是参数不一致）。
    const audioLine = probe.stderr.split('\n').find((line) => /Audio:/.test(line)) ?? ''
    assert.ok(audioLine.includes('48000 Hz'), `音轨应统一 48kHz，实得 ${audioLine}`)
    assert.ok(/stereo|2 channels/u.test(audioLine), `音轨应统一立体声，实得 ${audioLine}`)
    const rms = await audioRmsBySecond(finalPath, { ffmpegPath, binSec: 0.5 })
    const videoOnly = join(dir, 'video-only.mp4')
    await runFfmpegCapture(ffmpegPath, ['-i', finalPath, '-an', '-c:v', 'copy', '-y', videoOnly])
    const videoProbe = await runFfmpegCapture(ffmpegPath, ['-i', videoOnly])
    const videoSec = parseFfmpegDuration(videoProbe.stderr)
    const gap = Math.abs(rms.durationSec - videoSec)
    assert.ok(gap <= AUDIO_TOLERANCE_SEC, `混采样率拼接后音轨 ${rms.durationSec.toFixed(3)}s 应与视频 ${videoSec.toFixed(3)}s 对齐，差 ${gap.toFixed(3)}s`)
    assert.ok(rms.bins.every((v) => v > SOUND_RMS_THRESHOLD), '两段都应出声（无解码中止）')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('判据④：全无声 3 段 → 成片仍有音轨（静音轨），构成报「无声」不冒充原生声', async () => {
  const ffmpegPath = findRealFfmpeg()
  if (ffmpegPath === null) return
  const dir = await mkdtemp(join(tmpdir(), 'cs-pad-all-'))
  try {
    const { result, finalPath } = await composeFixtureClips(
      ffmpegPath,
      ['t-silent2s.mp4', 't-silent2s.mp4', 't-silent2s.mp4'],
      dir,
    )
    const probe = await runFfmpegCapture(ffmpegPath, ['-i', finalPath])
    assert.equal(parseFfmpegStreams(probe.stderr).hasAudio, true, '补静音后成片必须带音轨（concat 流结构一致）')
    assert.equal(result.audioComposition, 'none', '补的静音轨不是原生声，构成仍报 none')
    assert.ok(
      (result.warnings ?? []).some((w) => w.includes('成片将为静片')),
      `无任何声源应保留「静片」警告，实得 ${JSON.stringify(result.warnings)}`,
    )
    assert.ok((result.warnings ?? []).filter((w) => w.includes('无原生音轨，已补')).length === 3, '三段都应回显补静音')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
