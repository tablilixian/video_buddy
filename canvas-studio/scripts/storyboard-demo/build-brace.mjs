/**
 * 验证：用通用「大括号」标注代替两条 callout（只用于技术可行性判断）
 * 关键：path 轨在 preserveAspectRatio="none" 的 0–100 双轴空间，
 *      x 1% = 19.2px、y 1% = 10.8px ⇒ 斜线视觉角度被压扁 1.78 倍。
 */
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(HERE, 'build', 'manifest.json'))

const FPS = 30, FRAMES = 120, W = 1920, H = 1080
const CX = 47, CY = 50, RX = 26, RY = 16, EARTH_X = 37
const NEAR_X = CX - RX, FAR_X = CX + RX
// 双轴视觉补偿系数：同样「视觉长度」下 dy 是 dx 的 19.2/10.8 倍
const XY = W / H / 1  // 19.2/10.8 ≈ 1.7778

const ellipse = `M ${NEAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${FAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${NEAR_X} ${CY}`
const circleBox = (cx, cy, d) => ({ x: cx, y: cy, w: (d / W) * 100, h: (d / H) * 100 })
const base = (id, s) => ({ id, startFrame: s, durationInFrames: FRAMES - s, fadeFrames: 0 })

/** 横向下括号 ⏟：xl→xr，臂顶 yt，臂线 yb，尖点 yd。圆角用 Q，rx/ry 分开给。 */
function braceDown(xl, xr, yt, yb, yd, rx, tick) {
  const xm = (xl + xr) / 2
  const ry = (yb - yt) * 0.9
  return [
    `M ${xl} ${yt}`,
    `Q ${xl} ${yb} ${xl + rx} ${yb}`,
    `L ${xm - rx} ${yb}`,
    `Q ${xm} ${yb} ${xm} ${yd}`,
    `Q ${xm} ${yb} ${xm + rx} ${yb}`,
    `L ${xr - rx} ${yb}`,
    `Q ${xr} ${yb} ${xr} ${yt}`,
    // 两端刻度小竖线（视觉上与臂线垂直）
    `M ${xl} ${yt - tick * XY} L ${xl} ${yt}`,
    `M ${xr} ${yt - tick * XY} L ${xr} ${yt}`,
  ].join(' ')
}

// 括号替代两条 callout：位置落在椭圆底部下方，两端对齐近/远月亮
const BXL = NEAR_X, BXR = FAR_X, BYT = 66.5, BYB = 69.2, BYD = 72.4
const brace = braceDown(BXL, BXR, BYT, BYB, BYD, 2.2, 0.9)

const tracks = [
  { ...base('b-bg', 0), type: 'shape', shape: 'rect', color: '#0A1018', box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('b-grid', 0), type: 'shape', shape: 'dotGrid', color: '#1b2432', dotSpacing: 26, dotRadius: 1.6, box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('b-vig', 0), type: 'shape', shape: 'vignette', color: '#02040a', strength: 0.55, box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('b-title', 0), type: 'textCard', variant: 'title', text: '轨道不是正圆', color: '#ffffff', plate: 'none', box: { x: 32, y: 15, w: 44, h: 9 } },
  { ...base('b-sub', 4), type: 'textCard', variant: 'subtitle', text: '地球偏在一侧，月亮就有近有远', color: '#8fa3c4', box: { x: 32, y: 23.5, w: 46, h: 4 } },

  { ...base('b-orbit', 0), type: 'shape', shape: 'path', d: ellipse, strokeWidth: 0.22, color: '#4a7fb5' },
  { ...base('b-earth', 8), type: 'shape', shape: 'circle', color: '#3f8fd0', box: circleBox(EARTH_X, CY, 66) },
  { ...base('b-moon-near', 14), type: 'shape', shape: 'circle', color: '#f2f7ff', box: circleBox(NEAR_X, CY, 40) },
  { ...base('b-moon-far', 18), type: 'shape', shape: 'circle', color: '#c6d2e4', box: circleBox(FAR_X, CY, 34) },
  { ...base('b-span-near', 22), type: 'shape', shape: 'line', color: '#3ddc97', box: { x: (NEAR_X + EARTH_X) / 2, y: CY, w: EARTH_X - NEAR_X, h: 0.12 } },
  { ...base('b-span-far', 22), type: 'shape', shape: 'line', color: '#f0b429', box: { x: (EARTH_X + FAR_X) / 2, y: CY, w: FAR_X - EARTH_X, h: 0.12 } },
  { ...base('b-earth-label', 12), type: 'textCard', variant: 'subtitle', text: '地球', color: '#9fb8d6', box: { x: 37, y: 57, w: 8, h: 3 } },

  // 括号：一条轨替代两条 callout + 一条差值句
  { ...base('b-brace', 26), type: 'shape', shape: 'path', d: brace, strokeWidth: 0.18, color: '#7d8ea8' },

  { ...base('b-near-num', 28), type: 'textCard', variant: 'subtitle', text: '近地点 36.3', color: '#3ddc97', box: { x: NEAR_X + 5.5, y: 62.5, w: 14, h: 3 } },
  { ...base('b-far-num', 28), type: 'textCard', variant: 'subtitle', text: '远地点 40.6', color: '#f0b429', box: { x: FAR_X - 5.5, y: 62.5, w: 14, h: 3 } },
  { ...base('b-unit', 30), type: 'textCard', variant: 'subtitle', text: '相差 4 万公里', color: '#c8d2e2', box: { x: 47, y: 76.4, w: 22, h: 3.2 } },
  { ...base('b-note', 36), type: 'textCard', variant: 'subtitle', text: '示意图 · 未按比例', color: '#5b6577', box: { x: 50, y: 85, w: 22, h: 3 } },
]

const manifest = {
  id: 'comp-brace-test',
  meta: { title: '括号标注验证', width: W, height: H, fps: FPS, durationInFrames: FRAMES, backgroundColor: '#0A1018', segments: [{ id: 'brace', startFrame: 0, frames: FRAMES }] },
  tracks,
}
const { validateManifest } = await import('../../lib/remotion/manifest.js')
const check = validateManifest(manifest)
if (!check.ok) { console.error('校验失败:\n' + check.errors.map((e) => '· ' + e).join('\n')); process.exit(1) }
writeFileSync(out, JSON.stringify(manifest, null, 2))
console.log(`写入 ${out}（${tracks.length} 轨，校验通过）`)
