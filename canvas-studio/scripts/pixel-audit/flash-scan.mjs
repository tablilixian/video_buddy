#!/usr/bin/env node
/**
 * RQ-13 · 亮度跳变扫描（CLI）：`node scripts/pixel-audit/flash-scan.mjs <video.mp4> [--width W] [--height H] [--json out]`。
 * 输出 p99 与逐帧 spike 明细；`--fail-on` 改判红阈（缺省 4 = 需求正本口径）。
 */
import { writeFileSync } from 'node:fs'
import { grayFrames } from './lib/frames.mjs'
import { auditLumaJumps } from './lib/metrics.mjs'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
if (file === undefined) {
  console.error('用法：node scripts/pixel-audit/flash-scan.mjs <video.mp4> [--width 320] [--height 180] [--json out.json] [--fail-on 4]')
  process.exit(2)
}
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? Number(args[index + 1]) : fallback
}
const width = opt('width', 320)
const height = opt('height', 180)
const threshold = opt('fail-on', 4)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null

const frames = []
for await (const frame of grayFrames(file, width, height)) frames.push(frame)
const audit = auditLumaJumps(frames, { threshold })
const verdict = audit.pass ? '✅' : '❌'
console.log(`${verdict} 亮度跳变 p99 = ${audit.p99.toFixed(3)}（阈 ${audit.threshold}；帧 ${frames.length}）`)
for (const spike of audit.spikes.slice(0, 20)) {
  console.log(`  frame ${spike.frame}: Δ${spike.delta.toFixed(2)}`)
}
if (jsonOut !== null) writeFileSync(jsonOut, JSON.stringify({ ok: audit.pass, lumaJumpP99: audit.p99, spikes: audit.spikes }, null, 2))
process.exit(audit.pass ? 0 : 1)
