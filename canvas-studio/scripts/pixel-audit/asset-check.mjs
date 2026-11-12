#!/usr/bin/env node
/**
 * RQ-14 · 预生成资产 alpha 剖面自检（CLI）：
 * `node scripts/pixel-audit/asset-check.mjs <asset.png> [--top-band 0] [--bottom-band 0] [--peak-window 0,1] [--peak-min 200]`
 * 出图流水线在写盘后立即调用；断言不满足非零退出（把渲染期才发现的事故堵在资产阶段）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, alphaProfile, assertAlphaProfile } from './lib/png.mjs'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
if (file === undefined) {
  console.error('用法：node scripts/pixel-audit/asset-check.mjs <asset.png> [--top-band 0] [--bottom-band 0] [--peak-window 0,1] [--peak-min 200] [--json out]')
  process.exit(2)
}
const opt = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const topBand = Number(opt('top-band') ?? 0)
const bottomBand = Number(opt('bottom-band') ?? 0)
const [peakFrom, peakTo] = String(opt('peak-window') ?? '0,1').split(',').map((v) => Number(v))
const peakMin = Number(opt('peak-min') ?? 200)

const png = decodePng(readFileSync(file))
const profile = alphaProfile(png)
const audit = assertAlphaProfile(profile, {
  topBand,
  bottomBand,
  peakFrom: Number.isFinite(peakFrom) ? peakFrom : 0,
  peakTo: Number.isFinite(peakTo) ? peakTo : 1,
  peakMinAlpha: peakMin,
})
const verdict = audit.ok ? '✅' : '❌'
console.log(`${verdict} ${file}: ${png.width}×${png.height}（ch=${png.channels}）峰值 ${audit.peak.toFixed(1)} @ 行 ${audit.peakRow}/${audit.height}`)
for (const reason of audit.reasons) console.log(`  - ${reason}`)
const jsonOut = opt('json')
if (jsonOut !== undefined) writeFileSync(jsonOut, JSON.stringify(audit, null, 2))
process.exit(audit.ok ? 0 : 1)
