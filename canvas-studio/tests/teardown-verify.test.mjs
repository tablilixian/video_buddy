/**
 * B3 拆解回核测试 —— 纯函数（信号→峰→匹配）双向变异 + 真 ffmpeg E2E。
 *
 * E2E 用 lavfi 合成「红 2s + 蓝 2s」的测试视频：切换点机器可判（色距 ≫ 阈值），
 * 对表 matched / 错位表 unmatched 双向变异 —— 守卫必须能反向变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  frameMeanColors,
  colorDistances,
  findSwitchPoints,
  matchBoundaries,
  verifyTeardown,
} from '../lib/teardown-verify.js'

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 受管 shell 可能拦测试临时目录清理 —— 断言已完，清理尽力而为 */
  }
}

// ───────────────── 纯函数：frameMeanColors / colorDistances ─────────────────

test('B3：frameMeanColors 逐帧求平均色，尾部残字节忽略', () => {
  // 1×1×3 的「帧」：红、绿、蓝各一帧 + 半个残帧
  const raw = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 99])
  const colors = frameMeanColors(raw, 3)
  assert.equal(colors.length, 3)
  assert.deepEqual(colors[0], { r: 255, g: 0, b: 0 })
  assert.deepEqual(colors[2], { r: 0, g: 0, b: 255 })
  // 2×1 的帧（6 字节）也能算：两像素平均
  const two = frameMeanColors(new Uint8Array([10, 20, 30, 30, 40, 50]), 6)
  assert.deepEqual(two[0], { r: 20, g: 30, b: 40 })
})

test('B3：colorDistances 相邻帧欧氏色距（红→蓝 = 360√2 近似满距）', () => {
  const d = colorDistances([
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 0, b: 255 },
  ])
  assert.equal(d.length, 1)
  assert.ok(Math.abs(d[0] - Math.sqrt(255 ** 2 * 2)) < 0.01, `红蓝距应 ≈ ${Math.sqrt(255 ** 2 * 2)}`)
})

// ───────────────── 纯函数：findSwitchPoints 双向变异 ─────────────────

/** 合成信号：base 期平稳低距 + 峰值帧 + 平稳低距。 */
function syntheticDistances(peakIndex, length = 20, base = 2, peak = 300) {
  return Array.from({ length }, (_, i) => (i === peakIndex ? peak : base))
}

test('B3：findSwitchPoints 平稳信号无峰（反向变异：无切换不误报）', () => {
  const flat = Array.from({ length: 20 }, () => 2)
  assert.deepEqual(findSwitchPoints(flat, 2), [])
})

test('B3：findSwitchPoints 单尖峰 → 恰好一个切换点，时刻 = (i+1)/fps', () => {
  const switches = findSwitchPoints(syntheticDistances(5), 2)
  assert.equal(switches.length, 1)
  assert.equal(switches[0].timeSec, 3) // (5+1)/2
  assert.equal(switches[0].magnitude, 300)
})

test('B3：findSwitchPoints 低于绝对下限的尖峰不报（压缩噪点豁免）', () => {
  const switches = findSwitchPoints(syntheticDistances(5, 20, 2, 25), 2, { minMagnitude: 30 })
  assert.deepEqual(switches, [])
})

test('B3：findSwitchPoints 连续高距帧合并为一处（切镜渐变不拆多峰）', () => {
  // i=5,6 → 时刻 3.0/3.5s，跨 0.5s ≤ 合并窗口 0.75s → 一峰（取最大者位置）
  const signal = Array.from({ length: 20 }, (_, i) => (i === 5 || i === 6 ? 200 : 2))
  const switches = findSwitchPoints(signal, 2)
  assert.equal(switches.length, 1)
  assert.equal(switches[0].timeSec, 3)
})

// ───────────────── 纯函数：matchBoundaries 双向变异 ─────────────────

test('B3：matchBoundaries 对齐表全 matched 且无 extra', () => {
  const switches = [
    { timeSec: 2.0, magnitude: 300 },
    { timeSec: 5.0, magnitude: 320 },
  ]
  const { boundaries, extraSwitches } = matchBoundaries(
    [
      { label: 'A', startSec: 0, endSec: 2 },
      { label: 'B', startSec: 2, endSec: 5 },
      { label: 'C', startSec: 5, endSec: 8 },
    ],
    switches,
  )
  assert.equal(boundaries.length, 2) // 首段开场不核
  assert.ok(boundaries.every((b) => b.status === 'matched'))
  assert.equal(boundaries[0].measuredSec, 2.0)
  assert.equal(boundaries[1].measuredSec, 5.0)
  assert.deepEqual(extraSwitches, [])
})

test('B3：matchBoundaries 错位表（窗口外）→ unmatched + 原切换记 extra（守卫反向变红）', () => {
  const switches = [{ timeSec: 2.0, magnitude: 300 }]
  const { boundaries, extraSwitches } = matchBoundaries(
    [
      { label: 'A', startSec: 0, endSec: 3.5 },
      { label: 'B', startSec: 3.5, endSec: 6 },
    ],
    switches,
    { toleranceSec: 1.0 },
  )
  assert.equal(boundaries[0].status, 'unmatched')
  assert.equal(extraSwitches.length, 1)
  assert.equal(extraSwitches[0].timeSec, 2.0)
})

test('B3：matchBoundaries 一处切换只认领一次（两边界挤同一切换，近者得）', () => {
  const switches = [{ timeSec: 2.0, magnitude: 300 }]
  const { boundaries } = matchBoundaries(
    [
      { label: 'A', startSec: 0, endSec: 2 },
      { label: 'B', startSec: 2, endSec: 4 },
      { label: 'C', startSec: 2.4, endSec: 6 },
    ],
    switches,
  )
  assert.equal(boundaries[0].status, 'matched') // 2.0 恰好
  assert.equal(boundaries[1].status, 'unmatched') // 切换已被认领
})

// ───────────────── 真 ffmpeg E2E ─────────────────

function resolveSystemFfmpeg() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

test('B3 E2E：红2s+蓝2s 合成视频 —— 对表 matched、错位表 unmatched（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'teardown-verify-'))
  try {
    const videoPath = join(dir, 'two-color.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=2',
      '-f', 'lavfi', '-i', 'color=c=blue:size=128x96:rate=10:duration=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })

    // 对表：边界 2.0s ↔ 实测切换 2.0s（2fps 抽帧精度 ±0.5s）
    const good = await verifyTeardown({
      videoPath,
      segments: [
        { label: '红段', startSec: 0, endSec: 2 },
        { label: '蓝段', startSec: 2, endSec: 4 },
      ],
      ffmpegPath: ffmpeg,
    })
    assert.equal(good.ok, true, `对表应全 matched：${JSON.stringify(good.boundaries)}`)
    assert.equal(good.boundaries[0].status, 'matched')
    assert.ok(Math.abs(good.boundaries[0].measuredSec - 2.0) <= 0.5 + 1e-9,
      `实测切换应 ≈2.0s，实得 ${good.boundaries[0].measuredSec}`)
    assert.deepEqual(good.extraSwitches, [])

    // 错位表：边界声明 3.5s（真实切换 2.0s，窗口外）→ unmatched + extra（反向变异）
    const bad = await verifyTeardown({
      videoPath,
      segments: [
        { label: '红段', startSec: 0, endSec: 3.5 },
        { label: '蓝段', startSec: 3.5, endSec: 4 },
      ],
      ffmpegPath: ffmpeg,
    })
    assert.equal(bad.ok, false, '错位表必须判红（守卫反向变红）')
    assert.equal(bad.boundaries[0].status, 'unmatched')
    assert.equal(bad.extraSwitches.length, 1)
  } finally {
    cleanupDir(dir)
  }
})

test('B3：verifyTeardown 入参守卫（<2 段 / 起止非法 抛错）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'teardown-verify-'))
  try {
    const videoPath = join(dir, 'dummy.mp4')
    writeFileSync(videoPath, Buffer.alloc(16))
    await assert.rejects(
      verifyTeardown({ videoPath, segments: [{ label: 'A', startSec: 0, endSec: 4 }] }),
      /至少要 2 段/,
    )
    await assert.rejects(
      verifyTeardown({
        videoPath,
        segments: [
          { label: 'A', startSec: 2, endSec: 1 },
          { label: 'B', startSec: 2, endSec: 4 },
        ],
      }),
      /起止非法/,
    )
  } finally {
    cleanupDir(dir)
  }
})
