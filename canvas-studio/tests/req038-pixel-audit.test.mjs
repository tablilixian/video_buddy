/**
 * REQ-038 批次 10 守卫（下）：RQ-13 像素闸纯函数 + RQ-14 alpha 自检 + RQ-15 落点审计
 * + RQ-19 报告字段。度量层零 IO 可单测；CLI（ffmpeg/真机成片）在验收手册里由用户跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { auditLumaJumps, percentile, psnrOfFramePair, psnrSeries, auditInkOffset } from '../scripts/pixel-audit/lib/metrics.mjs'
import { decodePng, alphaProfile, assertAlphaProfile } from '../scripts/pixel-audit/lib/png.mjs'
import { buildRenderCommitFrame, parseRenderCommitFrame } from '../lib/render-protocol.js'
import { deriveRecipeDensity } from '../lib/remotion/render-report.js'

const here = dirname(fileURLToPath(import.meta.url))

/** 合成灰度帧：全帧常量亮度。 */
const flat = (value, n = 100) => new Uint8Array(n).fill(value)

test('RQ-13 ②：亮度跳变 p99 判红口径（p99>4 红 —— 修复前 4.51 的场景）', () => {
  // 60 帧常量 40，第 30 帧起掉到 12.7（E4 的全屏暗罩形态）→ 一次 27.3 跳变。
  const frames = Array.from({ length: 60 }, (_, i) => flat(i < 30 ? 40 : 12.7))
  const audit = auditLumaJumps(frames)
  assert.equal(audit.pass, false, '27.3 的单次跳变应把 p99 拉红')
  // p99 精确值：60 帧只有 1 个跳变 27.3 → p99 = 27.3。
  assert.ok(audit.p99 > 4)
  assert.ok(audit.spikes.some((spike) => spike.frame === 30), '跳变记在发生帧间（30→31 之间，jumps 下标 29 → frame 30）')
  // 渐变（每帧差 0.1）应过。
  const smooth = Array.from({ length: 200 }, (_, i) => flat(40 + Math.min(0.1 * i, 12)))
  assert.equal(auditLumaJumps(smooth).pass, true, '平滑渐变不许误报')
})

test('RQ-13 ③：PSNR 纯函数（同帧 Infinity / 噪声帧低分）', () => {
  const a = flat(50, 256)
  assert.equal(psnrOfFramePair(a, a), Infinity)
  const b = new Uint8Array(256).fill(52)
  const psnr = psnrOfFramePair(a, b)
  assert.ok(psnr > 30 && psnr < 50, `Δ2 常量的 PSNR 应在中高段：${psnr.toFixed(1)}`)
  const series = psnrSeries([a, a], [a, b])
  assert.equal(series.frames, 2)
  // Δ2 常量 → MSE=4 → PSNR ≈ 42.1dB，两帧都进 ≥40 桶。
  assert.equal(series.buckets['>=40dB'], 2)
})

test('RQ-13：percentile 线性插值口径', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(percentile([], 0.99), 0)
  assert.equal(percentile([5], 0.99), 5)
})

test('RQ-15：落点审计 —— box 中心 vs 墨迹中心（70px 偏移必红）', () => {
  // 100×100 画布，box 中心 (50,50)。墨迹块画在 x∈[75,85]（中心 80）→ 偏差 30px。
  const frame = flat(0, 100 * 100)
  for (let y = 45; y <= 55; y += 1) for (let x = 75; x <= 85; x += 1) frame[y * 100 + x] = 200
  const audit = auditInkOffset(frame, 100, 100, { x: 50, y: 50 }, { tolerancePx: 24 })
  assert.equal(audit.pass, false, '30px 偏差超 24px 容差')
  assert.ok(audit.offsetPx > 28 && audit.offsetPx < 32)
  // 墨迹居中 → 过。
  const centered = flat(0, 100 * 100)
  for (let y = 45; y <= 55; y += 1) for (let x = 45; x <= 55; x += 1) centered[y * 100 + x] = 200
  assert.equal(auditInkOffset(centered, 100, 100, { x: 50, y: 50 }).pass, true)
  // 无墨迹 → pass（空画面不是落点错误）。
  assert.equal(auditInkOffset(flat(0, 100 * 100), 100, 100, { x: 50, y: 50 }).pass, true)
})

test('RQ-14：alpha 剖面断言 —— 带外泄漏判红（E4 的写反场景）', () => {
  // 好 profile：底带（from bottom）贴边最亮（y=99 峰值）、上方全透明。
  const good = new Array(100).fill(0)
  for (let y = 70; y < 100; y += 1) good[y] = 230 * ((y - 70) / 29)
  const okAudit = assertAlphaProfile(good, { topBand: 70, peakFrom: 0.9, peakTo: 1 })
  assert.equal(okAudit.ok, true, JSON.stringify(okAudit.reasons))
  // 写反：peak 跑到顶部行（t=1-y/height 的旧 bug 形态）。
  const reversed = [...good].reverse()
  const badAudit = assertAlphaProfile(reversed, { topBand: 70, peakFrom: 0.9, peakTo: 1 })
  assert.equal(badAudit.ok, false, '峰值跑到带外必须判红')
  assert.ok(badAudit.reasons.some((r) => r.includes('不在期望窗口')))
})

test('RQ-14：vignette lowWindow —— 中心不透明判红（径向写反场景）', () => {
  const profile = new Array(100).fill(0)
  for (let y = 0; y < 100; y += 1) profile[y] = y < 44 ? 120 : 140
  const audit = assertAlphaProfile(profile, { lowWindow: { from: 0.34, to: 0.54, maxAlpha: 12 }, peakMinAlpha: 100 })
  assert.equal(audit.ok, false)
  assert.ok(audit.reasons.some((r) => r.includes('径向中心应透明')))
})

test('RQ-14：真实 PNG 往返（编一个最小 PNG 断言解码链可用）', () => {
  // 构造 RGBA PNG：顶部透明、底部不透明（用 buildRenderCommitFrame 不行 —— 现编 zlib。
  // 直接用 node zlib 手工组 PNG 太长；此处走「decode 拒绝非 PNG」与「灰度 PNG 全 255 剖面」两条：
  const notPng = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.throws(() => decodePng(notPng), /不是 PNG/)
  // 用 encodePng(playsout-replica/lib) 产一张真图再喂回 decode（同一仓两份实现互认）。
  return import('../scripts/playsout-replica/lib/png.mjs').then(({ createCanvas, encodePng }) => {
    // 贴边渐变：上 4 行透明，下 4 行越靠底越亮（峰值 y=7）→ 与 scrim from bottom 同形。
    const { data } = createCanvas(8, 8, (x, y) => (y < 4 ? [10, 20, 30, 0] : [10, 20, 30, Math.round(255 * ((y - 4) / 3))]))
    const png = encodePng(8, 8, data)
    const decoded = decodePng(png)
    assert.equal(decoded.width, 8)
    assert.equal(decoded.height, 8)
    const profile = alphaProfile(decoded)
    assert.equal(profile[0], 0)
    assert.equal(profile[7], 255)
    const audit = assertAlphaProfile(profile, { topBand: 4, peakFrom: 0.8, peakTo: 1 })
    assert.equal(audit.ok, true, JSON.stringify(audit.reasons))
  })
})

test('RQ-19：deriveRecipeDensity —— 轨/秒 / 每轨字节 / 文字轨 / 轨型分布 / 配方覆盖率', () => {
  const manifest = {
    meta: { fps: 30, durationInFrames: 600, generatedBy: 'spec:demo' },
    tracks: [
      { type: 'shape' }, { type: 'logoWall' }, { type: 'textCard' }, { type: 'caption' },
      { type: 'image' }, { type: 'image' },
    ],
  }
  const density = deriveRecipeDensity(manifest, 6000)
  assert.ok(Math.abs(density.tracksPerSec - 0.3) < 1e-9, '6 轨 / 20s = 0.3')
  assert.equal(density.bytesPerTrack, 1000)
  assert.equal(density.textTracks, 2)
  assert.equal(density.tracksByType.image, 2)
  assert.equal(density.tracksByType.logoWall, 1)
  assert.equal(density.recipeCoverage, 1, 'spec: 前缀 = 配方生成')
  assert.equal(deriveRecipeDensity({ ...manifest, meta: { ...manifest.meta, generatedBy: 'manual' } }).recipeCoverage, 0)
  assert.equal(deriveRecipeDensity({ meta: { fps: 30, durationInFrames: 0 }, tracks: [] }).tracksPerSec, 0)
})

test('RQ-19：RenderJobReport 类型面带 recipeDensity（结算装配已接线）', () => {
  const src = readFileSync(join(here, '../src/remotion/render-job.ts'), 'utf8')
  assert.ok(src.includes('deriveRecipeDensity(job.manifest)'), '结算 report 必须装配 recipeDensity')
})
