/**
 * C3 媒体探针测试（REQ-036，CV-397）—— 解析纯函数（固定 ffmpeg stderr 样本）+ 真 ffmpeg E2E。
 *
 * 样本取自真机 `ffmpeg -i` 原样输出（mp4 容器）：解析器只准吃真实形态，
 * 不为想象中的格式买单。E2E 用 lavfi 合成样本断言数值范围。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseContainer,
  parseFpsFromVideoLine,
  parseMediaMeta,
  probeMedia,
} from '../lib/media-probe.js'

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 受管 shell 可能拦测试临时目录清理 —— 断言已完，清理尽力而为 */
  }
}

function resolveSystemFfmpeg() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** 真机样本：mp4（h264 视频 + aac 音轨），ffmpeg 7.1 原样 stderr 摘录。 */
const MP4_STDERR = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/probe-sample.mp4':",
  '  Metadata:',
  '    major_brand     : isom',
  "    encoder         : Lavf61.7.100",
  '  Duration: 00:00:02.00, start: 0.000000, bitrate: 372 kb/s',
  '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 288 kb/s, 30 fps, 30 tbr, 15360 tbn (default)',
  '    Metadata:',
  "      handler_name    : VideoHandler",
  '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6D703461), 44100 Hz, mono, fltp, 69 kb/s (default)',
].join('\n')

// ───────────────── 纯函数：parseContainer ─────────────────

test('C3：parseContainer 优先取与扩展名一致的 tag（mp4 文件报 mp4 而非链头 mov）', () => {
  assert.equal(parseContainer(MP4_STDERR, 'probe-sample.mp4'), 'mp4')
  assert.equal(parseContainer(MP4_STDERR, '/任意/路径/clip.mov'), 'mov')
})

test('C3：parseContainer 无扩展名匹配取链头；无 Input 行返回 undefined', () => {
  assert.equal(parseContainer(MP4_STDERR), 'mov')
  assert.equal(parseContainer(MP4_STDERR, 'no-ext'), 'mov')
  assert.equal(parseContainer('N/A'), undefined)
})

// ───────────────── 纯函数：parseFpsFromVideoLine ─────────────────

test('C3：parseFpsFromVideoLine 十进制 / 分数 / 缺失三形态', () => {
  assert.equal(parseFpsFromVideoLine('Video: h264, 320x240, 30 fps, 30 tbr'), 30)
  assert.equal(parseFpsFromVideoLine('Video: h264, 1080x1920, 29.97 fps, 29.97 tbr'), 29.97)
  assert.equal(parseFpsFromVideoLine('Video: h264, 1920x1080, 30000/1001 fps'), 29.97)
  assert.equal(parseFpsFromVideoLine('Video: h264, 640x480'), undefined)
  assert.equal(parseFpsFromVideoLine('Audio: aac, 44100 Hz'), undefined)
})

// ───────────────── 纯函数：parseMediaMeta ─────────────────

test('C3：parseMediaMeta 完整 mp4 样本（视频+音轨）逐字段解析', () => {
  const meta = parseMediaMeta(MP4_STDERR, 'probe-sample.mp4')
  assert.equal(meta.width, 320)
  assert.equal(meta.height, 240)
  assert.equal(meta.fps, 30)
  assert.equal(meta.hasAudio, true)
  assert.equal(meta.videoStreams, 1)
  assert.equal(meta.audioStreams, 1)
  assert.equal(meta.container, 'mp4')
})

test('C3：parseMediaMeta 纯音频样本（m4a + 封面 attached_pic）如实计数', () => {
  const m4a = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/voice.mp4':",
    '  Duration: 00:00:08.42, start: 0.000000, bitrate: 128 kb/s',
    "  Stream #0:0: Video: mjpeg (Progressive), yuvj420p(pc), 640x640, attached_pic",
    '  Stream #0:1: Audio: aac (LC), 44100 Hz, mono, fltp',
  ].join('\n')
  const meta = parseMediaMeta(m4a, 'voice.mp4')
  assert.equal(meta.hasAudio, true)
  assert.equal(meta.videoStreams, 1) // 封面图也是视频流，如实报
  assert.equal(meta.audioStreams, 1)
  assert.equal(meta.container, 'mp4')
})

test('C3：parseMediaMeta 无流样本（空 stderr）零崩溃', () => {
  const meta = parseMediaMeta('', 'x.mp4')
  assert.equal(meta.hasAudio, false)
  assert.equal(meta.videoStreams, 0)
  assert.equal(meta.audioStreams, 0)
  assert.equal(meta.width, undefined)
  assert.equal(meta.container, undefined)
})

// ───────────────── probeMedia E2E（真 ffmpeg）─────────────────

test('C3 E2E：lavfi 音视频样本 —— 数值范围断言（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'media-probe-'))
  try {
    const videoPath = join(dir, 'sample.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', videoPath,
    ], { timeout: 60_000 })

    const result = await probeMedia({ path: videoPath, ffmpegPath: ffmpeg })
    assert.ok(Math.abs(result.durationSec - 2) < 0.2, `时长应 ≈2s，实得 ${result.durationSec}`)
    assert.equal(result.width, 320)
    assert.equal(result.height, 240)
    assert.equal(result.fps, 30)
    assert.equal(result.hasAudio, true)
    assert.equal(result.audioStreams, 1)
    assert.equal(result.videoStreams, 1)
    assert.equal(result.container, 'mp4')
    assert.ok(result.audioLoudnessLufs !== null && result.audioLoudnessLufs <= 0 && result.audioLoudnessLufs > -60,
      `440Hz 正弦响度应在 (-60, 0] LUFS，实得 ${result.audioLoudnessLufs}`)
    assert.equal(result.loudnessNote, undefined)
  } finally {
    cleanupDir(dir)
  }
})

test('C3 E2E：无声样本 —— hasAudio=false、LUFS=null 带原因（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'media-probe-'))
  try {
    const videoPath = join(dir, 'silent.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })

    const result = await probeMedia({ path: videoPath, ffmpegPath: ffmpeg })
    assert.equal(result.hasAudio, false)
    assert.equal(result.audioStreams, 0)
    assert.equal(result.audioLoudnessLufs, null)
    assert.equal(result.loudnessNote, '无音轨')
  } finally {
    cleanupDir(dir)
  }
})

test('C3：probeMedia 文件不存在 / 非普通文件显式报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-probe-'))
  try {
    await assert.rejects(probeMedia({ path: join(dir, 'missing.mp4') }), /不可读/)
    await assert.rejects(probeMedia({ path: dir }), /不是普通文件/)
  } finally {
    cleanupDir(dir)
  }
})
