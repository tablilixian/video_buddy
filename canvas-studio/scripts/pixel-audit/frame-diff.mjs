#!/usr/bin/env node
/**
 * RQ-13 · 逐帧 PSNR 比对（CLI）：`node scripts/pixel-audit/frame-diff.mjs <A.mp4> <B.mp4> [--json out]`。
 * 输出分桶（≥40 / 30–40 / 20–30 / <20）与中位数、最小值 —— 同规格复现（≥40dB 达标）
 * 与不雷同判据（中位数 <25dB）共用本工具，判读方向由调用场景决定。
 */
import { writeFileSync } from 'node:fs'
import { grayFrames } from './lib/frames.mjs'
import { psnrSeries } from './lib/metrics.mjs'

const args = process.argv.slice(2)
const [a, b] = args.filter((arg) => !arg.startsWith('--'))
if (a === undefined || b === undefined) {
  console.error('用法：node scripts/pixel-audit/frame-diff.mjs <A.mp4> <B.mp4> [--json out.json]')
  process.exit(2)
}
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null

async function collect(file) {
  const frames = []
  for await (const frame of grayFrames(file, 320, 180)) frames.push(frame)
  return frames
}
const [fa, fb] = [await collect(a), await collect(b)]
const result = psnrSeries(fa, fb)
const pass40 = result.buckets['>=40dB'] / Math.max(1, result.frames)
console.log(`比对帧数 = ${result.frames}`)
console.log(`分桶 = ${JSON.stringify(result.buckets)}（≥40dB 占 ${(pass40 * 100).toFixed(1)}%）`)
console.log(`中位数 = ${result.median.toFixed(2)}dB，最小 = ${result.min.toFixed(2)}dB`)
console.log(`同规格复现口径（≥40dB 全量）：${pass40 >= 0.95 && result.min >= 40 ? '✅' : '❌'}`)
console.log(`不雷同口径（中位数 <25dB 且最小 <20dB）：${result.median < 25 && result.min < 20 ? '✅（不雷同成立）' : '—'}`)
if (jsonOut !== null) writeFileSync(jsonOut, JSON.stringify(result, null, 2))
