/**
 * CV-140 真实时长探测 + CV-142 分镜时长解析 契约测试。
 *
 * 1. probeMediaDuration：对真实媒体文件返回实测时长；对垃圾文件/不存在的路径
 *    **返回 0 而不是抛错**（生成主路径不能因为一个「顺带的探测」而失败）。
 * 2. parseShotDurationSeconds：分镜表「时长」列的容错解析。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { probeMediaDuration, resolveFfmpegPath } from '../lib/ffmpeg-run.js'
import { parseShotDurationSeconds, DECLARED_FPS } from '../lib/host-tools.js'

async function findRealFfmpeg() {
  try {
    return resolveFfmpegPath()
  } catch {
    return null
  }
}

function runReal(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'] })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(code) : reject(new Error(`ffmpeg 退出 ${code}`)))
  })
}

test('probeMediaDuration：垃圾文件与不存在的路径都返回 0，绝不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-dur-'))
  try {
    const junk = join(dir, 'junk.mp4')
    await writeFile(junk, 'NOT A VIDEO AT ALL')
    // 核心不变量：探测失败 = 返回 0（调用方据此回退请求值），而不是把异常抛给生成主路径。
    assert.equal(await probeMediaDuration(junk), 0, '非媒体文件应返回 0')
    assert.equal(await probeMediaDuration(join(dir, 'missing.mp4')), 0, '不存在的路径应返回 0')
    // 显式指向一个不存在的 ffmpeg 也应回退为 0。
    assert.equal(await probeMediaDuration(junk, join(dir, 'no-such-ffmpeg')), 0, 'ffmpeg 不可用应返回 0')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('probeMediaDuration：真实文件返回实测时长（帧量化后的真值）', { skip: process.platform === 'win32' && '依赖 POSIX 行为' }, async () => {
  const ffmpegPath = await findRealFfmpeg()
  if (ffmpegPath === null) return // 无 ffmpeg 则跳过（与上面的回退用例互补）

  const dir = await mkdtemp(join(tmpdir(), 'cs-dur-real-'))
  try {
    const clip = join(dir, 'clip.mp4')
    await runReal(ffmpegPath, [
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=1.5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', clip,
    ])
    const probed = await probeMediaDuration(clip)
    assert.ok(Math.abs(probed - 1.5) < 0.1, `应探到约 1.5s，实得 ${probed}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('parseShotDurationSeconds：容错解析分镜表「时长」列', () => {
  // 常见写法。
  assert.equal(parseShotDurationSeconds('5s'), 5)
  assert.equal(parseShotDurationSeconds('5 秒'), 5)
  assert.equal(parseShotDurationSeconds('5秒'), 5)
  assert.equal(parseShotDurationSeconds('约 5 秒'), 5)
  assert.equal(parseShotDurationSeconds('5.5s'), 5.5)
  assert.equal(parseShotDurationSeconds('8'), 8)
  // 时间码按 mm:ss / mm:ss:ff 解析，不能被当成「第一个数字 0」。
  assert.equal(parseShotDurationSeconds('00:05'), 5)
  assert.equal(parseShotDurationSeconds('01:30'), 90)
  assert.ok(Math.abs(parseShotDurationSeconds(`00:05:${DECLARED_FPS}`) - 6) < 1e-9, 'mm:ss:ff 的帧位应换算成秒')
  // 解析不出 / 零值 → 0（调用方按「未声明」处理）。
  assert.equal(parseShotDurationSeconds(''), 0)
  assert.equal(parseShotDurationSeconds('   '), 0)
  assert.equal(parseShotDurationSeconds('—'), 0)
  assert.equal(parseShotDurationSeconds('0s'), 0)
})
