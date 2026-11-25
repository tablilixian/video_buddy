/**
 * 括号标注 · 正确形态：括号的**跨度**必须与被标注的量同源。
 * 这里两条括号都从地球（共同原点）量起，分别到近地点 / 远地点。
 */
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(HERE, 'build', 'manifest.json'))
const FPS = 30, FRAMES = 120, W = 1920, H = 1080
const CX = 47, CY = 50, RX = 26, RY = 16, EARTH_X = 37
const NEAR_X = CX - RX, FAR_X = CX + RX
const XY = W / H

const ellipse = `M ${NEAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${FAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${NEAR_X} ${CY}`
const circleBox = (cx, cy, d) => ({ x: cx, y: cy, w: (d / W) * 100, h: (d / H) * 100 })
const base = (id, s) => ({ id, startFrame: s, durationInFrames: FRAMES - s, fadeFrames: 0 })

/** 横向括号 ⏟（向上开口），从 xl 到 xr，尖端指向 y+。rx 为圆角横向半径（百分比）。 */
function braceUp(xl, xr, y, rx, depth, tick) {
  const xm = (xl + xr) / 2
  const d = depth
  return [
    `M ${xl} ${y - tick * XY * 0.9}`,
    `L ${xl} ${y}`,
    `Q ${xl} ${y} ${xl + rx} ${y}`,
    `L ${xm - rx} ${y}`,
    `Q ${xm} ${y} ${xm} ${y + d}`,
    `Q ${xm} ${y} ${xm + rx} ${y}`,
    `L ${xr - rx} ${y}`,
    `Q ${xr} ${y} ${xr} ${y}`,
    `L ${xr} ${y - tick * XY * 0.9}`,
  ].join(' ')
}

const BR_NEAR = braceUp(NEAR_X, EARTH_X, 71.5, 2.0, 3.4, 0.8)
const BR_FAR = braceUp(EARTH_X, FAR_X, 79.5, 2.0, 3.4, 0.8)

const tracks = [
  { ...base('c-bg', 0), type: 'shape', shape: 'rect', color: '#0A1018', box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('c-grid', 0), type: 'shape', shape: 'dotGrid', color: '#1b2432', dotSpacing: 26, dotRadius: 1.6, box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('c-vig', 0), type: 'shape', shape: 'vignette', color: '#02040a', strength: 0.55, box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('c-title', 0), type: 'textCard', variant: 'title', text: '轨道不是正圆', color: '#ffffff', plate: 'none', box: { x: 30, y: 12, w: 44, h: 9 } },
  { ...base('c-sub', 4), type: 'textCard', variant: 'subtitle', text: '地球偏在一侧，月亮就有近有远', color: '#8fa3c4', box: { x: 30, y: 20.5, w: 46, h: 4 } },

  { ...base('c-orbit', 0), type: 'shape', shape: 'path', d: ellipse, strokeWidth: 0.22, color: '#4a7fb5' },
  { ...base('c-earth', 8), type: 'shape', shape: 'circle', color: '#3f8fd0', box: circleBox(EARTH_X, CY, 66) },
  { ...base('c-moon-near', 14), type: 'shape', shape: 'circle', color: '#f2f7ff', box: circleBox(NEAR_X, CY, 40) },
  { ...base('c-moon-far', 18), type: 'shape', shape: 'circle', color: '#c6d2e4', box: circleBox(FAR_X, CY, 34) },
  { ...base('c-earth-label', 12), type: 'textCard', variant: 'subtitle', text: '地球', color: '#9fb8d6', box: { x: 37, y: 57, w: 8, h: 3 } },

  // 两条括号都从地球量起 —— 跨度 = 被标注的量
  { ...base('c-brace-near', 24), type: 'shape', shape: 'path', d: BR_NEAR, strokeWidth: 0.16, color: '#3ddc97', opacity: 0.85 },
  { ...base('c-brace-far', 26), type: 'shape', shape: 'path', d: BR_FAR, strokeWidth: 0.16, color: '#f0b429', opacity: 0.85 },

  { ...base('c-near-label', 28), type: 'textCard', variant: 'subtitle', text: '最近 36.3 万公里', color: '#3ddc97', box: { x: (NEAR_X + EARTH_X) / 2, y: 76.2, w: 20, h: 3 } },
  { ...base('c-far-label', 30), type: 'textCard', variant: 'subtitle', text: '最远 40.6 万公里', color: '#f0b429', box: { x: (EARTH_X + FAR_X) / 2, y: 84.2, w: 20, h: 3 } },
  { ...base('c-gap', 34), type: 'textCard', variant: 'subtitle', text: '差 4 万公里 ≈ 绕地球赤道一圈', color: '#c8d2e2', box: { x: 50, y: 91, w: 46, h: 3.6 } },
]

const manifest = {
  id: 'comp-brace2',
  meta: { title: '括号标注 · 正确形态', width: W, height: H, fps: FPS, durationInFrames: FRAMES, backgroundColor: '#0A1018', segments: [{ id: 'brace2', startFrame: 0, frames: FRAMES }] },
  tracks,
}
const { validateManifest } = await import('../../lib/remotion/manifest.js')
const check = validateManifest(manifest)
if (!check.ok) { console.error('校验失败:\n' + check.errors.map((e) => '· ' + e).join('\n')); process.exit(1) }
writeFileSync(out, JSON.stringify(manifest, null, 2))
console.log(`写入 ${out}（${tracks.length} 轨，校验通过）`)
