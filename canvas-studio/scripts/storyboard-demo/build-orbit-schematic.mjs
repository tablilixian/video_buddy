/**
 * 第二屏「轨道示意」目标形态 · 手拼 manifest（**只用于验证，不是产品实现**）
 *
 * 用法：node scripts/storyboard-demo/build-orbit-schematic.mjs [输出路径]
 *
 * 为什么手拼：卡库里没有「示意图 + 注解」这张卡，spec 只能选卡、不能画图。
 * 这里用**已有的四个原语**（shape:path 椭圆 / shape:circle 天体 / shape:line 距离线 /
 * callout 引线标注）拼出目标画面，先证明「效果值得做」，再决定是否注册成 SCH1 卡。
 * 产出必须过 `validateManifest` —— 过不了就说明现有原语表达不了，方案要改。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(HERE, 'build', 'manifest.json'))

const FPS = 30
const FRAMES = 120
const W = 1920
const H = 1080

/** 椭圆在 0–100 双轴百分比空间里画（非等比：x 1% = 19.2px，y 1% = 10.8px）。 */
const CX = 47
const CY = 50
const RX = 26
const RY = 16
const EARTH_X = 37
const NEAR_X = CX - RX
const FAR_X = CX + RX

const ellipse = `M ${NEAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${FAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${NEAR_X} ${CY}`

/** box：0–100 百分比，x/y 是**中心**。圆形要按两轴换算才不被拉扁。 */
const circleBox = (cx, cy, diameterPx) => ({
  x: cx,
  y: cy,
  w: (diameterPx / W) * 100,
  h: (diameterPx / H) * 100,
})

const base = (id, startFrame) => ({ id, startFrame, durationInFrames: FRAMES - startFrame, fadeFrames: 0 })

const tracks = [
  { ...base('sch-bg', 0), type: 'shape', shape: 'rect', color: '#0A1018', box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('sch-grid', 0), type: 'shape', shape: 'dotGrid', color: '#1b2432', dotSpacing: 26, dotRadius: 1.6, box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('sch-vignette', 0), type: 'shape', shape: 'vignette', color: '#02040a', strength: 0.55, box: { x: 50, y: 50, w: 100, h: 100 } },

  { ...base('sch-title', 0), type: 'textCard', variant: 'title', text: '轨道不是正圆', color: '#ffffff', plate: 'none', box: { x: 32, y: 15, w: 44, h: 9 } },
  { ...base('sch-sub', 4), type: 'textCard', variant: 'subtitle', text: '地球偏在一侧，月亮就有近有远', color: '#8fa3c4', box: { x: 32, y: 23.5, w: 46, h: 4 } },

  {
    ...base('sch-orbit', 0),
    type: 'shape',
    shape: 'path',
    d: ellipse,
    strokeWidth: 0.22,
    color: '#4a7fb5',
  },

  { ...base('sch-earth', 8), type: 'shape', shape: 'circle', color: '#3f8fd0', box: circleBox(EARTH_X, CY, 66) },
  { ...base('sch-moon-near', 14), type: 'shape', shape: 'circle', color: '#f2f7ff', box: circleBox(NEAR_X, CY, 40) },
  { ...base('sch-moon-far', 18), type: 'shape', shape: 'circle', color: '#c6d2e4', box: circleBox(FAR_X, CY, 34) },

  { ...base('sch-span-near', 22), type: 'shape', shape: 'line', color: '#3ddc97', box: { x: (NEAR_X + EARTH_X) / 2, y: CY, w: EARTH_X - NEAR_X, h: 0.12 } },
  { ...base('sch-span-far', 22), type: 'shape', shape: 'line', color: '#f0b429', box: { x: (EARTH_X + FAR_X) / 2, y: CY, w: FAR_X - EARTH_X, h: 0.12 } },

  { ...base('sch-near', 26), type: 'callout', anchor: { x: NEAR_X, y: CY }, text: '近地点 · 36.3 万公里', line: 'elbow', color: '#3ddc97', box: { x: 24, y: 70, w: 27, h: 3.4 } },
  { ...base('sch-far', 26), type: 'callout', anchor: { x: FAR_X, y: CY }, text: '远地点 · 40.6 万公里', line: 'elbow', color: '#f0b429', box: { x: 70, y: 70, w: 27, h: 3.4 } },

  { ...base('sch-earth-label', 12), type: 'textCard', variant: 'subtitle', text: '地球', color: '#9fb8d6', box: { x: 37, y: 57, w: 8, h: 3 } },

  { ...base('sch-gap', 32), type: 'textCard', variant: 'subtitle', text: '差 4 万公里 ≈ 绕地球赤道一圈', color: '#c8d2e2', box: { x: 50, y: 79, w: 46, h: 4 } },
  { ...base('sch-note', 36), type: 'textCard', variant: 'subtitle', text: '示意图 · 未按比例', color: '#5b6577', box: { x: 50, y: 87, w: 22, h: 3 } },
]

const manifest = {
  id: 'comp-orbit-schematic',
  meta: {
    title: '轨道示意（目标形态验证）',
    width: W,
    height: H,
    fps: FPS,
    durationInFrames: FRAMES,
    backgroundColor: '#0A1018',
    segments: [{ id: 'orbit', startFrame: 0, frames: FRAMES }],
  },
  tracks,
}

const { validateManifest } = await import('../../lib/remotion/manifest.js')
const check = validateManifest(manifest)
if (!check.ok) {
  console.error('manifest 校验失败：\n' + check.errors.map((e) => '· ' + e).join('\n'))
  process.exit(1)
}
const warnings = check.warnings ?? []
writeFileSync(out, JSON.stringify(manifest, null, 2))
console.log(`写入 ${out}（${tracks.length} 轨，校验通过${warnings.length ? `，${warnings.length} 条告警` : ''}）`)
for (const w of warnings) console.log('  告警：', w)
