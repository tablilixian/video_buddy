/**
 * 第二屏「地月距离」动态版 · v2
 *
 * v1 的两个问题：
 *  1) 停顿跳到远地点 —— 根因是 `animateStateAt`（timing.ts:717）在「本帧无活动段」时取的是
 *     **整条 animate 数组最后一段**的终点，不是「最近一段」。中间空档因此被填成终点。
 *     ⇒ 修法：停顿必须写成显式 hold 段（from == to），不能靠空档。
 *  2) 大括号横跨整个椭圆宽，被读成「近地点到远地点的总距离」而不是「差值」。
 *     ⇒ 修法：把两段距离拿出来，在下方按**真实比例**画两条同向长度条；
 *        括号只跨「黄比绿多出来的那一截」，语义才等于差值。
 *
 * 节拍（30fps / 390 帧 = 13s）：
 *   0–40     标题 + 椭圆淡入
 *   36–126   月亮 远 → 近（顺时针下半弧）
 *   127–159  停住 + 绿线 + 「近地点 36.3 万公里」
 *   160–244  月亮 近 → 远（顺时针上半弧）
 *   245–277  停住 + 黄线 + 「远地点 40.6 万公里」
 *   280–310  下方长度对比条升起（两条都从左侧 0 起算，按 36.3 : 40.6 真实比例）
 *   312–340  差值段高亮 + 括号只跨差值 + 「+4.3 万公里」
 *   340–390  说明行「≈ 绕地球赤道一圈」
 */
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(HERE, 'build', 'manifest.json'))

const FPS = 30
const FRAMES = 390
const W = 1920
const H = 1080

// ── 上半区：轨道几何 ──
const CX = 50
const CY = 39
const RX = 30
const RY = 16
const EARTH_X = 38
const NEAR_X = CX - RX // 21
const FAR_X = CX + RX // 79
const XY = W / H

// ── 下半区：长度对比条（真实比例，同向、同起点）──
const BAR_LEFT = 19
const BAR_W = 56 // 40.6 万公里 = 56
const NEAR_V = 36.3
const FAR_V = 40.6
const gLen = (BAR_W * NEAR_V) / FAR_V // 绿条视觉长 ≈ 50.1
const GREEN_END = BAR_LEFT + gLen // ≈ 69.1
const YELLOW_END = BAR_LEFT + BAR_W // 75

const ellipse = `M ${NEAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${FAR_X} ${CY} A ${RX} ${RY} 0 1 0 ${NEAR_X} ${CY}`
const circleBox = (cx, cy, d) => ({ x: cx, y: cy, w: (d / W) * 100, h: (d / H) * 100 })
const rectBox = (xl, xr, y, h) => ({ x: (xl + xr) / 2, y, w: xr - xl, h })
const base = (id, s, extra = {}) => ({ id, startFrame: s, durationInFrames: FRAMES - s, fadeFrames: 0, ...extra })

const onEllipse = (theta) => ({ x: CX + RX * Math.cos(theta), y: CY + RY * Math.sin(theta) })
const NEAR_PT = onEllipse(Math.PI)
const FAR_PT = onEllipse(0)

/** 逐帧关键帧，位移精确等于参数化椭圆；末尾补一段钉住收尾点。 */
function sweep(thetaFrom, thetaTo, steps, relStart) {
  const pts = []
  for (let i = 0; i <= steps; i++) pts.push(onEllipse(thetaFrom + (thetaTo - thetaFrom) * (i / steps)))
  const segs = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[Math.min(i + 1, pts.length - 1)]
    segs.push({ from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, startFrame: relStart + i, durationInFrames: 1, easing: 'linear' })
  }
  return segs
}
/** 停顿：显式 hold 段（from == to），**不能**靠空档 —— 空档会填成数组末段终点。 */
const hold = (pt, relStart, frames) => ({
  from: { x: pt.x, y: pt.y },
  to: { x: pt.x, y: pt.y },
  startFrame: relStart,
  durationInFrames: frames,
  easing: 'linear',
})

const MOON_START = 36
const moonAnimate = [
  { from: { scale: 0.3 }, to: { scale: 1 }, startFrame: 0, durationInFrames: 8, easing: 'backOut' },
  ...sweep(0, Math.PI, 84, 6), // rel 6..90   远 → 近
  hold(NEAR_PT, 91, 33), // rel 91..123  停住（显式）
  ...sweep(Math.PI, 2 * Math.PI, 84, 124), // rel 124..208 近 → 远
  hold(FAR_PT, 209, 145), // rel 209..356 停住到片尾
]

/** 横向大括号（向下开口 ⏟），跨度 xl→xr；圆角按 XY 补偿。 */
function braceDown(xl, xr, y, depth, rx) {
  const xm = (xl + xr) / 2
  const tick = 0.6 * XY
  return [
    `M ${xl} ${y - tick}`,
    `L ${xl} ${y}`,
    `Q ${xl} ${y} ${xl + rx} ${y}`,
    `L ${xm - rx} ${y}`,
    `Q ${xm} ${y} ${xm} ${y + depth}`,
    `Q ${xm} ${y} ${xm + rx} ${y}`,
    `L ${xr - rx} ${y}`,
    `Q ${xr} ${y} ${xr} ${y}`,
    `L ${xr} ${y - tick}`,
  ].join(' ')
}

// 括号只跨「差值段」：绿条终点 → 黄条终点
const GAP_XL = GREEN_END
const GAP_XR = YELLOW_END
const DIFF_BRACE = braceDown(GAP_XL, GAP_XR, 82.5, 4.2, 1.5)

const tracks = [
  // ── 底 ──
  { ...base('bg', 0), type: 'shape', shape: 'rect', color: '#0A1018', box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('grid', 0), type: 'shape', shape: 'dotGrid', color: '#1b2432', dotSpacing: 26, dotRadius: 1.6, box: { x: 50, y: 50, w: 100, h: 100 } },
  { ...base('vignette', 0), type: 'shape', shape: 'vignette', color: '#02040a', strength: 0.5, box: { x: 50, y: 50, w: 100, h: 100 } },

  // ── 标题 ──
  { ...base('title', 2, { fadeFrames: 8 }), type: 'textCard', variant: 'title', text: '轨道不是正圆', color: '#ffffff', plate: 'none', box: { x: 30, y: 7.5, w: 44, h: 9.6 } },
  { ...base('sub', 12, { fadeFrames: 8 }), type: 'textCard', variant: 'subtitle', text: '地球偏在一侧，月亮就有近有远', color: '#8fa3c4', box: { x: 30, y: 15.5, w: 46, h: 4 } },

  // ── 轨道 / 地球 ──
  { ...base('orbit', 4, { fadeFrames: 14 }), type: 'shape', shape: 'path', d: ellipse, strokeWidth: 0.2, color: '#4a7fb5' },
  {
    ...base('earth', 22, { fadeFrames: 0 }),
    type: 'shape', shape: 'circle', color: '#3f8fd0',
    box: circleBox(EARTH_X, CY, 62),
    animate: { from: { scale: 0.4 }, to: { scale: 1 }, startFrame: 0, durationInFrames: 10, easing: 'backOut' },
  },
  { ...base('earth-label', 30, { fadeFrames: 6 }), type: 'textCard', variant: 'subtitle', text: '地球', color: '#9fb8d6', box: { x: EARTH_X, y: CY - 8.6, w: 9, h: 4.2 } },

  // ── 月亮 ──
  {
    ...base('moon', MOON_START, { fadeFrames: 0 }),
    type: 'shape', shape: 'circle', color: '#f2f7ff',
    box: circleBox(FAR_X, CY, 38),
    animate: moonAnimate,
    fx: 'glow',
  },

  // ── 近地点标注 ──
  { ...base('line-near', 129, { fadeFrames: 8 }), type: 'shape', shape: 'line', color: '#3ddc97', box: rectBox(NEAR_X + 1.0, EARTH_X - 1.7, CY, 0.16) },
  { ...base('label-near', 131, { fadeFrames: 8 }), type: 'textCard', variant: 'subtitle', text: '近地点 36.3', color: '#3ddc97', box: { x: 10.5, y: 40, w: 17, h: 4.8 } },

  // ── 远地点标注 ──
  { ...base('line-far', 247, { fadeFrames: 8 }), type: 'shape', shape: 'line', color: '#f0b429', box: rectBox(EARTH_X + 1.7, FAR_X - 1.0, CY, 0.16) },
  { ...base('label-far', 249, { fadeFrames: 8 }), type: 'textCard', variant: 'subtitle', text: '远地点 40.6', color: '#f0b429', box: { x: 89.5, y: 40, w: 17, h: 4.8 } },

  // ── 长度对比区（真实比例、同起点、同向）──
  { ...base('cmp-rule', 136, { fadeFrames: 14 }), type: 'shape', shape: 'line', color: '#243044', box: rectBox(10, 90, 58, 0.1) },
  { ...base('cmp-title', 138, { fadeFrames: 10 }), type: 'textCard', variant: 'subtitle', text: '地月距离 · 同一比例（万公里）', color: '#6b7a90', box: { x: 50, y: 61.5, w: 40, h: 4.2 } },

  {
    ...base('bar-near', 144, { fadeFrames: 0 }),
    type: 'shape', shape: 'rect', color: '#3ddc97',
    box: rectBox(BAR_LEFT, GREEN_END, 70, 2.4),
    reveal: { kind: 'wipe', direction: 'right', durationInFrames: 14 },
  },
  {
    ...base('bar-far', 260, { fadeFrames: 0 }),
    type: 'shape', shape: 'rect', color: '#f0b429',
    box: rectBox(BAR_LEFT, YELLOW_END, 76.5, 2.4),
    reveal: { kind: 'wipe', direction: 'right', durationInFrames: 14 },
  },

  // 差值段高亮：叠在黄条上，只覆盖「多出来那一截」
  { ...base('bar-diff', 312, { fadeFrames: 10 }), type: 'shape', shape: 'rect', color: '#ffffff', box: rectBox(GAP_XL, GAP_XR, 76.5, 2.4) },

  { ...base('cmp-name-near', 146, { fadeFrames: 8 }), type: 'textCard', variant: 'subtitle', text: '近地点 36.3', color: '#3ddc97', box: { x: 9.5, y: 70, w: 17, h: 4.4 } },
  { ...base('cmp-name-far', 262, { fadeFrames: 8 }), type: 'textCard', variant: 'subtitle', text: '远地点 40.6', color: '#f0b429', box: { x: 9.5, y: 76.5, w: 17, h: 4.4 } },

  // 差值括号：只跨差值段
  { ...base('diff-brace', 314, { fadeFrames: 10 }), type: 'shape', shape: 'path', d: DIFF_BRACE, strokeWidth: 0.16, color: '#ffffff' },
  {
    ...base('diff-label', 322, { fadeFrames: 0 }),
    type: 'textCard', variant: 'subtitle', text: '+4.3 万公里', color: '#ffffff',
    box: { x: (GAP_XL + GAP_XR) / 2, y: 89.5, w: 20, h: 5.4 },
    animate: [
      { from: { scale: 0.5, opacity: 0 }, to: { scale: 1.08, opacity: 1 }, startFrame: 0, durationInFrames: 8, easing: 'backOut' },
      { from: { scale: 1.08 }, to: { scale: 1 }, startFrame: 8, durationInFrames: 8, easing: 'easeOut' },
    ],
    fx: 'glow',
  },
  { ...base('diff-note', 342, { fadeFrames: 12 }), type: 'textCard', variant: 'subtitle', text: '差值 ≈ 绕地球赤道一圈', color: '#8fa3c4', box: { x: 50, y: 94.5, w: 30, h: 5 } },
]

const manifest = {
  id: 'comp-moon-orbit-anim',
  meta: {
    title: '地月距离 · 动态编排 v2',
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
writeFileSync(out, JSON.stringify(manifest, null, 2))
const warnings = check.warnings ?? []
console.log(`写入 ${out} · ${tracks.length} 轨 · 月亮关键帧 ${moonAnimate.length} 段 · 校验通过${warnings.length ? ` · ${warnings.length} 条告警` : ''}`)
for (const w of warnings) console.log('  告警：', w)
