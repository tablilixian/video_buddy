/**
 * CV-445 S1 自适应切点检测测试 —— 纯函数双向变异 + 真 ffmpeg E2E。
 *
 * 用例直接对着 rea-video 能力对照表 §8 锁定的真值形态设计：
 *   - 全幅换色 → 恰好一个切点（红→蓝合成片，命中口径）；
 *   - 「静态版式上文字弹出」只变局部 → 不算切（旧实现误报形态，反向变异）；
 *   - 黑场淡入淡出 → fade 边界；
 *   - 相邻过近边界 → 最短镜长合并；
 *   - verifyTeardown adaptive（新缺省）与 legacy（回退）双路 E2E。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rgbHsvHistogram,
  histogramBhattacharyya,
  FrameTrackBuilder,
  buildFrameTrack,
  localMedian,
  percentile,
  detectShotBoundaries,
} from '../lib/shot-detect.js'
import { verifyTeardown } from '../lib/teardown-verify.js'

const W = 96
const H = 54
const FRAME_BYTES = W * H * 3

/** 造一帧 rgb24：全色填充 + 可选矩形补丁。 */
function makeFrame(fill, patch) {
  const buf = new Uint8Array(FRAME_BYTES)
  for (let i = 0; i < W * H; i += 1) {
    buf[i * 3] = fill[0]
    buf[i * 3 + 1] = fill[1]
    buf[i * 3 + 2] = fill[2]
  }
  if (patch !== undefined) {
    const [x0, y0, w, h, color] = patch
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const i = y * W + x
        buf[i * 3] = color[0]
        buf[i * 3 + 1] = color[1]
        buf[i * 3 + 2] = color[2]
      }
    }
  }
  return buf
}

function concatFrames(frames) {
  const out = new Uint8Array(FRAME_BYTES * frames.length)
  frames.forEach((f, i) => out.set(f, i * FRAME_BYTES))
  return out
}

const FPS = 6

// ───────────────── 纯函数：直方图 ─────────────────

test('S1：rgbHsvHistogram 纯色帧集中单一桶且 L1 归一', () => {
  const hist = rgbHsvHistogram(makeFrame([255, 0, 0]), 0, W * H)
  const sum = [...hist].reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, `L1 归一后总和应为 1，实得 ${sum}`)
  // 红 (255,0,0)：h=0°→桶0，s=1→桶3，v=1→桶3
  const redBin = (0 * 4 + 3) * 4 + 3
  assert.ok(hist[redBin] === 1, `纯红应全部质量在桶 ${redBin}，实得 ${hist[redBin]}`)
})

test('S1：histogramBhattacharyya 同分布 0 / 不相交 1', () => {
  const a = new Float64Array(256)
  const b = new Float64Array(256)
  a[0] = 1
  b[255] = 1
  assert.equal(histogramBhattacharyya(a, a), 0)
  assert.ok(Math.abs(histogramBhattacharyya(a, b) - 1) < 1e-9)
})

// ───────────────── 纯函数：FrameTrackBuilder ─────────────────

test('S1：FrameTrackBuilder 红→蓝合成帧 —— 切换帧 changed≈1，首帧特征为 0', () => {
  const frames = []
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([255, 0, 0]))
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([0, 0, 255]))
  const track = buildFrameTrack(concatFrames(frames), FRAME_BYTES, FPS)
  assert.equal(track.luma.length, 60)
  assert.equal(track.histDist[0], 0)
  assert.equal(track.pixDiff[0], 0)
  assert.equal(track.changed[0], 0)
  assert.ok((track.changed[30] ?? 0) > 0.99, `切换帧 changed 应 ≈1，实得 ${track.changed[30]}`)
  assert.ok((track.histDist[30] ?? 0) > 0.9, `红→蓝直方图距离应 ≈1，实得 ${track.histDist[30]}`)
  assert.ok((track.pixDiff[31] ?? 0) === 0, '切换后静止帧差应归零')
})

test('S1：FrameTrackBuilder 分片喂入与整段喂入等价（流式增量）', () => {
  const frames = []
  for (let i = 0; i < 12; i += 1) frames.push(makeFrame([10, 200, 30]))
  for (let i = 0; i < 12; i += 1) frames.push(makeFrame([200, 10, 90]))
  const raw = concatFrames(frames)
  const whole = buildFrameTrack(raw, FRAME_BYTES, FPS)
  const builder = new FrameTrackBuilder(FRAME_BYTES, FPS)
  // 乱刀碎喂：1 字节、半帧、整帧混着来
  builder.push(raw.subarray(0, 1))
  builder.push(raw.subarray(1, 1 + FRAME_BYTES * 7 + 13))
  builder.push(raw.subarray(1 + FRAME_BYTES * 7 + 13))
  const streamed = builder.finish()
  assert.deepEqual(streamed.changed, whole.changed)
  assert.deepEqual(streamed.histDist.map((v) => Math.round(v * 1e9)), whole.histDist.map((v) => Math.round(v * 1e9)))
})

// ───────────────── 纯函数：统计工具 ─────────────────

test('S1：localMedian 窗口不含自身（单尖峰不抬高自己的基线）', () => {
  const med = localMedian([5, 5, 100, 5, 5], 2)
  assert.equal(med[2], 5, '尖峰自身的局部中位数不应含 100')
})

test('S1：percentile 线性插值（p50 中位 / p0 最小）', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5)
  assert.equal(percentile([1, 2, 3, 4], 0), 1)
  assert.equal(percentile([7], 50), 7)
})

// ───────────────── 纯函数：detectShotBoundaries ─────────────────

test('S1：红→蓝全幅换色 → 恰好一个 cut，时刻 = index/fps', () => {
  const frames = []
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([255, 0, 0]))
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([0, 0, 255]))
  const track = buildFrameTrack(concatFrames(frames), FRAME_BYTES, FPS)
  const boundaries = detectShotBoundaries(track)
  assert.equal(boundaries.length, 1)
  assert.equal(boundaries[0].kind, 'cut')
  assert.ok(Math.abs(boundaries[0].timeSec - 5.0) < 1e-9, `应切在 5.0s，实得 ${boundaries[0].timeSec}`)
})

test('S1：静态版式上文字弹出（只变 ~8% 像素）不算切 —— 旧实现误报形态的反向变异', () => {
  const frames = []
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([255, 0, 0]))
  // 第 30 帧起：同一片红底上弹出一块 24×18 白色「标题」（占 8.3% 像素）并常驻
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([255, 0, 0], [36, 18, 24, 18, [255, 255, 255]]))
  const track = buildFrameTrack(concatFrames(frames), FRAME_BYTES, FPS)
  assert.ok((track.changed[30] ?? 1) < 0.25, `变化面积应 <0.25（8.3%），实得 ${track.changed[30]}`)
  assert.deepEqual(detectShotBoundaries(track), [], '局部弹出不得判切（守卫反向变红点）')
})

test('S1：黑场淡入淡出 → 渐变入黑时极值段结束处 fade 边界（合成渐变信号）', () => {
  // 渐变暗场：亮度平滑跌到 5 再回升，逐帧差分小（不触发 cut 三条件）→ 只该有 fade 边界
  const n = 40
  const luma = Array(n).fill(180)
  const fadeFrames = [18, 19, 20, 21, 22, 23, 24, 25, 26]
  const fadeLuma = [180, 120, 60, 5, 5, 5, 60, 120, 180]
  fadeFrames.forEach((idx, i) => { luma[idx] = fadeLuma[i] ?? 180 })
  const track = { fps: FPS, histDist: Array(n).fill(0), pixDiff: Array(n).fill(0), changed: Array(n).fill(0), luma }
  // 渐变段给小幅直方图距离（v 桶滑动）但不过切点阈值
  for (const idx of fadeFrames) track.histDist[idx] = 0.12
  const boundaries = detectShotBoundaries(track)
  assert.deepEqual(boundaries, [{ index: 24, timeSec: 4, kind: 'fade', score: 0.5 }],
    `渐变入黑只应产出 4.0s 的 fade 边界，实得 ${JSON.stringify(boundaries)}`)
})

test('S1：硬切进/出黑场判 cut 而非 fade（全幅突变 = 切，与 rea-video 语义一致）', () => {
  const frames = []
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([180, 40, 40]))
  for (let i = 0; i < 6; i += 1) frames.push(makeFrame([0, 0, 0]))
  for (let i = 0; i < 30; i += 1) frames.push(makeFrame([40, 40, 180]))
  const track = buildFrameTrack(concatFrames(frames), FRAME_BYTES, FPS)
  const boundaries = detectShotBoundaries(track)
  assert.deepEqual(boundaries.map((b) => [b.timeSec, b.kind]),
    [[5, 'cut'], [6, 'cut']], `实得 ${JSON.stringify(boundaries)}`)
})

test('S1：最短镜长合并 —— 相邻 1 帧（<0.35s）的两个尖峰只留前者', () => {
  const n = 40
  const track = { fps: FPS, histDist: Array(n).fill(0), pixDiff: Array(n).fill(0), changed: Array(n).fill(0), luma: Array(n).fill(128) }
  track.histDist[10] = 0.9
  track.pixDiff[10] = 0.5
  track.changed[10] = 0.9
  track.histDist[11] = 0.9
  track.pixDiff[11] = 0.5
  track.changed[11] = 0.9
  const boundaries = detectShotBoundaries(track)
  assert.equal(boundaries.length, 1)
  assert.equal(boundaries[0].index, 10)
})

test('S1：合成信号合成 —— score = 0.6×hist + 0.4×clip(pix×4) 的相对通道（低对比场景突变）', () => {
  // 画面整体暗且对比低：直方图距离小，但 60% 像素同步轻微位移 → relative 通道命中
  const n = 40
  const track = { fps: FPS, histDist: Array(n).fill(0), pixDiff: Array(n).fill(0), changed: Array(n).fill(0), luma: Array(n).fill(20) }
  track.changed[20] = 0.6
  track.histDist[20] = 0.2
  track.pixDiff[20] = 0.2
  const boundaries = detectShotBoundaries(track)
  assert.equal(boundaries.length, 1, 'relative 通道（changed>0.45 且 3× 局部中位）应命中')
  assert.equal(boundaries[0].kind, 'cut')
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

test('S1 E2E：verifyTeardown adaptive（新缺省）红2s+蓝2s 对表 matched（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'shot-detect-'))
  try {
    const videoPath = join(dir, 'two-color.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=2',
      '-f', 'lavfi', '-i', 'color=c=blue:size=128x96:rate=10:duration=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })
    const result = await verifyTeardown({
      videoPath,
      segments: [
        { label: '红段', startSec: 0, endSec: 2 },
        { label: '蓝段', startSec: 2, endSec: 4 },
      ],
      ffmpegPath: ffmpeg,
    })
    assert.equal(result.ok, true, `adaptive 缺省应全 matched：${JSON.stringify(result.boundaries)}`)
    assert.equal(result.sampleFps, 6)
    assert.ok(Math.abs((result.boundaries[0]?.measuredSec ?? -1) - 2.0) <= 1 / 6 + 1e-9,
      `6fps 精度下实测切换应 ≈2.0s，实得 ${result.boundaries[0]?.measuredSec}`)
    assert.deepEqual(result.extraSwitches, [])
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理尽力而为 */ }
  }
})

test('S1 E2E：verifyTeardown legacy 显式回退路径仍可用（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'shot-detect-'))
  try {
    const videoPath = join(dir, 'two-color.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=2',
      '-f', 'lavfi', '-i', 'color=c=blue:size=128x96:rate=10:duration=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })
    const result = await verifyTeardown({
      videoPath,
      segments: [
        { label: '红段', startSec: 0, endSec: 2 },
        { label: '蓝段', startSec: 2, endSec: 4 },
      ],
      detector: 'legacy',
      ffmpegPath: ffmpeg,
    })
    assert.equal(result.ok, true, `legacy 回退应全 matched：${JSON.stringify(result.boundaries)}`)
    assert.equal(result.sampleFps, 2)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理尽力而为 */ }
  }
})
