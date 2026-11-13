// 动效密度：逐帧差分 → 静止段（画面完全不变）占比
import { execFileSync } from 'node:child_process'

const FPS = 5, W = 96, H = 54, N = W * H
const V = process.argv[2]

const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', V, '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], {
  maxBuffer: 512 * 1024 * 1024,
})
const frames = Math.floor(buf.length / N)
let prev = null
const diffs = []
for (let k = 0; k < frames; k++) {
  const cur = buf.subarray(k * N, (k + 1) * N)
  if (prev) {
    let s = 0
    for (let i = 0; i < N; i++) s += Math.abs(cur[i] - prev[i])
    diffs.push(s / N)
  }
  prev = cur
}
diffs.sort((a, b) => a - b)
const q = (p) => diffs[Math.floor(p * (diffs.length - 1))]
console.log('采样帧', frames, '差分中位', q(0.5).toFixed(2), 'P90', q(0.9).toFixed(2), 'P99', q(0.99).toFixed(2), 'max', diffs[diffs.length - 1].toFixed(1))
// 按原始顺序重算静止段
prev = null
const seq = []
for (let k = 0; k < frames; k++) {
  const cur = buf.subarray(k * N, (k + 1) * N)
  if (prev) {
    let s = 0
    for (let i = 0; i < N; i++) s += Math.abs(cur[i] - prev[i])
    seq.push(s / N)
  }
  prev = cur
}
const TH = 0.35 // 阈值：1/255 平均差异以下视为静止
let still = 0
const runs = []
let cur = 0
for (const d of seq) {
  if (d < TH) { cur++; still++ } else { if (cur) runs.push(cur); cur = 0 }
}
if (cur) runs.push(cur)
runs.sort((a, b) => b - a)
console.log(`静止帧占比 ${(100 * still / seq.length).toFixed(1)}%  最长静止 ${(runs[0] / FPS).toFixed(1)}s  静止段≥3s 共 ${runs.filter((r) => r >= 3 * FPS).length} 段`)
console.log('静止时长 top8:', runs.slice(0, 8).map((r) => (r / FPS).toFixed(1) + 's').join(', '))
