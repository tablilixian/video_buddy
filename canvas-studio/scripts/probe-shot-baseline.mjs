/**
 * CV-445 S1 验收基准探针（一次性）：B 站 20s 真值片跑新 shot-detect。
 * 真值（docs/plans/2026-11-05-rea-video能力对照表.md §8 锁定）：10 切点
 * 2.07/3.40/9.30/10.40/13.30/14.03/16.90/17.60/18.27/19.13。
 * 门槛：命中 ≥9/10、FP ≤2（容差 ±0.35s = 半个 6fps 帧距再放宽）。
 * 用法：node scripts/probe-shot-baseline.mjs <videoPath>
 */
import { detectCutPointsForVideo } from '../lib/shot-detect.js'

const videoPath = process.argv[2]
if (!videoPath) {
  console.error('用法：node scripts/probe-shot-baseline.mjs <videoPath>')
  process.exit(1)
}

const TRUTH = [2.07, 3.4, 9.3, 10.4, 13.3, 14.03, 16.9, 17.6, 18.27, 19.13]
const TOLERANCE = 0.35

const result = await detectCutPointsForVideo({ videoPath })
const detected = result.switches.map((s) => s.timeSec)

const matchedTruth = new Set()
const hits = []
const misses = []
for (const t of TRUTH) {
  const hit = detected.find((d) => Math.abs(d - t) <= TOLERANCE && !matchedTruth.has(d))
  if (hit !== undefined) {
    matchedTruth.add(hit)
    hits.push({ truth: t, detected: hit, delta: Math.round((hit - t) * 100) / 100 })
  } else {
    misses.push(t)
  }
}
const falsePositives = detected.filter((d) => !matchedTruth.has(d))

console.log(`检出 ${detected.length} 个切点（帧数 ${result.frameCount}，fps ${result.fps}）：`)
console.log(detected.map((d) => d.toFixed(2)).join(', '))
console.log(`\n命中 ${hits.length}/${TRUTH.length}（容差 ±${TOLERANCE}s）：`)
for (const h of hits) console.log(`  ✓ 真值 ${h.truth.toFixed(2)} → 检出 ${h.detected.toFixed(2)}（Δ${h.delta >= 0 ? '+' : ''}${h.delta}）`)
if (misses.length > 0) console.log(`漏检：${misses.map((m) => m.toFixed(2)).join(', ')}`)
console.log(`\n误报 ${falsePositives.length} 个：${falsePositives.map((d) => d.toFixed(2)).join(', ') || '无'}`)
console.log(`\n门槛判定：命中 ≥9 → ${hits.length >= 9 ? 'PASS' : 'FAIL'}；FP ≤2 → ${falsePositives.length <= 2 ? 'PASS' : 'FAIL'}`)
console.log(`正反例：8.167/14.6 连续变形不误判 → ${falsePositives.some((d) => Math.abs(d - 8.167) <= 0.35 || Math.abs(d - 14.6) <= 0.35) ? 'FAIL（误判）' : 'PASS'}`)
if (misses.includes(10.4)) {
  console.log('10.40 爆炸亮帧：漏检 —— 与 rea-video 同判（S0 实测其 FN 即 10.40），不劣于基线，不单独算 FAIL')
}
