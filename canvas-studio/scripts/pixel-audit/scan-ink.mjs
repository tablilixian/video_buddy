#!/usr/bin/env node
/**
 * RQ-15 · 墨迹落点审计（CLI）：
 * `node scripts/pixel-audit/scan-ink.mjs <video.mp4> --frame 120 --box 50,50,60,20 [--tol 24]`
 * 抽指定帧，算墨迹中心 vs box 中心的偏差（box = 画布百分比中心语义，与 BaseTrack.box 同口径）。
 * 超 `--tol`（px，缺省 24）非零退出 —— 偏移 70px 的历史缺陷（playsout 文字右移）会被拦下。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveFfmpeg } from './lib/frames.mjs'
import { auditInkOffset } from './lib/metrics.mjs'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
const opt = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
if (file === undefined || opt('frame') === undefined || opt('box') === undefined) {
  console.error('用法：node scripts/pixel-audit/scan-ink.mjs <video.mp4> --frame N --box x,y,w,h [--width 320] [--height 180] [--tol 24]')
  process.exit(2)
}
const width = Number(opt('width') ?? 320)
const height = Number(opt('height') ?? 180)
const tolerance = Number(opt('tol') ?? 24)
const frameNo = Number(opt('frame'))
const [bx, by, bw, bh] = String(opt('box')).split(',').map((v) => Number(v))

const dir = mkdtempSync(join(tmpdir(), 'ink-'))
const rawPath = join(dir, 'frame.gray')
try {
  execFileSync(resolveFfmpeg(), [
    '-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frameNo}),scale=${width}:${height}:flags=bilinear,format=gray`,
    '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-y', rawPath,
  ])
  const gray = new Uint8Array(readFileSync(rawPath))
  const audit = auditInkOffset(gray, width, height, { x: bx, y: by }, { tolerancePx: tolerance })
  if (audit.offsetPx === null) {
    console.log('画面无墨迹（阈值内全暗）—— 无落点可言')
    process.exit(0)
  }
  const verdict = audit.pass ? '✅' : '❌'
  console.log(`${verdict} 墨迹中心 (${audit.inkCenter.x.toFixed(1)}, ${audit.inkCenter.y.toFixed(1)}) vs box 中心 (${audit.boxCenter.x.toFixed(1)}, ${audit.boxCenter.y.toFixed(1)}) → 偏差 ${audit.offsetPx.toFixed(1)}px（容差 ${tolerance}px）`)
  const jsonOut = opt('json')
  if (jsonOut !== undefined) writeFileSync(jsonOut, JSON.stringify(audit, null, 2))
  process.exit(audit.pass ? 0 : 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
