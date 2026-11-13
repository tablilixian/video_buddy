// 画面占空比 / 内容包围盒对比：手写版 17 张静帧 vs 真机终版按等距抽帧
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const SRC = '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/stills'
const MP4 = '/Users/wl/Desktop/job/VideoOut/new3/projects/Users wl Desktop job/assets/all-time-5min-final.mp4'
const W = 160, H = 90, N = W * H

function stats(buf) {
  let ink = 0, minX = W, maxX = -1, minY = H, maxY = -1, sum = 0
  for (let i = 0; i < N; i++) {
    const v = buf[i]
    sum += v
    if (v > 26) { // 背景 #070b14/#0A0E1A 的 luma ≈ 10-14，>26 视为内容
      ink++
      const x = i % W, y = (i / W) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const bboxArea = maxX < 0 ? 0 : ((maxX - minX + 1) / W) * ((maxY - minY + 1) / H)
  return {
    ink: ink / N,
    bboxArea,
    bboxW: maxX < 0 ? 0 : (maxX - minX + 1) / W,
    bboxH: maxX < 0 ? 0 : (maxY - minY + 1) / H,
    luma: sum / N,
  }
}

function grayFromFile(file, extra = []) {
  const args = ['-v', 'error']
  if (file.endsWith('.mp4')) args.push('-ss', extra[0], '-i', file, '-frames:v', '1')
  else args.push('-i', file)
  args.push('-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-')
  return execFileSync('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 })
}

const hand = []
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.png')).sort()) {
  const buf = grayFromFile(`${SRC}/${f}`)
  hand.push({ f, ...stats(buf.subarray(0, N)) })
}

const machine = []
const dur = 304.4
for (let k = 0; k < 17; k++) {
  const t = ((k + 0.5) / 17) * dur
  const buf = grayFromFile(MP4, [t.toFixed(2)])
  machine.push({ f: `${t.toFixed(1)}s`, ...stats(buf.subarray(0, N)) })
}

const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length
const pct = (x) => (x * 100).toFixed(1) + '%'
const fmt = (a) => `ink ${pct(avg(a, 'ink'))} | bbox ${pct(avg(a, 'bboxArea'))} (${pct(avg(a, 'bboxW'))} x ${pct(avg(a, 'bboxH'))}) | luma ${avg(a, 'luma').toFixed(1)}`

console.log('=== 手写版（17 帧）===')
for (const r of hand) console.log(r.f.padEnd(12), pct(r.ink).padStart(6), 'bbox', pct(r.bboxArea).padStart(6), `(${pct(r.bboxW)}x${pct(r.bboxH)})`)
console.log('AVG'.padEnd(12), fmt(hand))

console.log('\n=== 真机终版（等距 17 帧）===')
for (const r of machine) console.log(r.f.padEnd(12), pct(r.ink).padStart(6), 'bbox', pct(r.bboxArea).padStart(6), `(${pct(r.bboxW)}x${pct(r.bboxH)})`)
console.log('AVG'.padEnd(12), fmt(machine))

const zero = machine.filter((r) => r.ink < 0.005).length
console.log('\n真机近空白帧（ink<0.5%）:', zero, '/', machine.length)
