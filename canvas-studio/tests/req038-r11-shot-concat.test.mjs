/**
 * REQ-038 R11-C4 · **段拼接器**（ffmpeg concat，真 ffmpeg E2E）单测。
 *
 * 三条纪律必须同时成立：
 * ① **零损失拼接** —— 同参数两段 copy 拼接，时长 = Σ 段时长，帧率/分辨率不变；
 * ② **失败抛错不静默** —— 空清单/单段/ffmpeg 失败都抛错（拼接是交付必要环节）；
 * ③ **中文/空格路径可用** —— concat 清单单引号转义（真机项目名就是中文）。
 *
 * 真 ffmpeg E2E（随包 CV-201；lavfi 生成测试段，image_matting 先例）。
 * 定向跑：node --test tests/req038-r11-shot-concat.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { concatShots } from '../lib/shot-concat.js'
import { probeMediaInfo, resolveFfmpegPath, runFfmpeg } from '../lib/ffmpeg-run.js'

function workDir() {
  return mkdtempSync(join(tmpdir(), 'r11-concat-'))
}

/** 用 lavfi 生成一段指定时长/颜色的测试 mp4（30fps，H.264，无音轨——与分段渲染口径一致）。 */
async function makeSegment(dir, name, seconds, color) {
  const out = join(dir, name)
  const result = await runFfmpeg(
    resolveFfmpegPath(),
    [
      '-f', 'lavfi',
      '-i', `color=c=${color}:s=320x240:d=${String(seconds)}:r=30`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-y',
      out,
    ],
    60_000,
  )
  if (result.code !== 0) throw new Error(`测试段生成失败：${result.stderr.slice(-300)}`)
  return out
}

test('两段拼接：时长 = Σ 段时长，分辨率/帧率不变（真 ffmpeg E2E）', async () => {
  const dir = workDir()
  const seg1 = await makeSegment(dir, 'seg1.mp4', 1, 'navy')
  const seg2 = await makeSegment(dir, 'seg2.mp4', 1.5, 'black')
  const out = join(dir, 'merged.mp4')
  const result = await concatShots({ segmentFiles: [seg1, seg2], outputPath: out })
  assert.equal(result, out)
  assert.equal(existsSync(out), true)
  const info = await probeMediaInfo(out)
  assert.ok(Math.abs(info.duration - 2.5) < 0.2, `拼接时长应 ≈2.5s，实得 ${String(info.duration)}`)
})

test('三段拼接（含中文名路径）：序正确，时长 = Σ', async () => {
  const dir = workDir()
  const sub = join(dir, '中文 目录')  // 真机项目名就是中文 + 空格
  mkdirSync(sub, { recursive: true })
  const seg1 = await makeSegment(sub, '一.mp4', 0.8, 'navy')
  const seg2 = await makeSegment(sub, '二.mp4', 0.8, 'black')
  const seg3 = await makeSegment(sub, '三.mp4', 0.8, 'navy')
  const out = join(sub, 'final-拼.mp4')
  await concatShots({ segmentFiles: [seg1, seg2, seg3], outputPath: out })
  const info = await probeMediaInfo(out)
  assert.ok(Math.abs(info.duration - 2.4) < 0.2, `三段拼接时长应 ≈2.4s，实得 ${String(info.duration)}`)
})

test('空清单与单段：抛错不静默（交付必要环节不做 fail-soft）', async () => {
  const dir = workDir()
  await assert.rejects(concatShots({ segmentFiles: [], outputPath: join(dir, 'x.mp4') }), /segmentFiles 为空/)
  const seg = await makeSegment(dir, 'only.mp4', 0.5, 'black')
  await assert.rejects(concatShots({ segmentFiles: [seg], outputPath: join(dir, 'x.mp4') }), /单段不需要拼接/)
})

test('ffmpeg 失败抛错（坏输入文件）', async () => {
  const dir = workDir()
  const bad = join(dir, 'not-a-video.mp4')
  const seg = await makeSegment(dir, 'ok.mp4', 0.5, 'black')
  await assert.rejects(
    concatShots({ segmentFiles: [bad, seg], outputPath: join(dir, 'x.mp4') }),
    /拼接失败/,
  )
})
