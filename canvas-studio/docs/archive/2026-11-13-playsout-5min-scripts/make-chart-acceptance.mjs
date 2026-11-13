// 从 5 分钟片的 manifest 抽出 10 条 chart 轨，重排成一条「图表验收带」。
// 用途：真机 render_composition 内联渲染（体积 < 30KB），逐图核对柱/折线/轴标签排版。
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/manifest.json'
const OUT = '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/chart-acceptance.json'

const PER = 150 // 每条图 5s：入场动画 + countUp 都能跑完
const src = JSON.parse(readFileSync(SRC, 'utf8'))
const charts = src.tracks.filter((t) => t.type === 'chart')
if (charts.length === 0) throw new Error('源 manifest 里没有 chart 轨')

const tracks = charts.map((c, i) => ({ ...c, startFrame: i * PER, durationInFrames: PER }))
const manifest = {
  id: 'comp-chart-acceptance',
  meta: {
    ...src.meta,
    title: '图表排版验收 · 10 图（柱 / 折线 / 双轴 / 仪表盘 / 环图）',
    durationInFrames: tracks.length * PER,
  },
  tracks,
  // 音效锚点全在原场景轨上，抽轨后悬空 → 整段去掉（验收只看画面）
}

const json = JSON.stringify(manifest, null, 2)
writeFileSync(OUT, json + '\n')
console.log('写出', OUT, json.length, 'bytes /', (json.length / 1024).toFixed(1), 'KB')
tracks.forEach((t, i) => {
  const mid = t.startFrame + Math.floor(PER / 2)
  console.log(`  [${i + 1}] ${t.id.padEnd(20)} ${String(t.variant).padEnd(6)} frames ${t.startFrame}-${t.startFrame + PER - 1}  中段帧 ${mid}`)
})
