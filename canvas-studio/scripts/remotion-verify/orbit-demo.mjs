/**
 * Route A · 纯几何程序化「太阳系公转」演示（CV-336 修复后重做，2026-10-17）。
 *
 * 本文件是 `./motion-helpers.mjs` 的**一个具体消费者**（太阳系主题），用来证明通用助手可用。
 * 通用运动范式与可读性原则见 skill 分册 `references/motion-patterns.md` —— 本文件只演示，
 * 不绑定其他主题。
 *
 * 首版为什么「看不出动画」（取证结论，勿重犯）：
 *   1. `variant:'title'` 是 84px 大字 + 全屏 rgba(0,0,0,.35) 压暗层，直接盖住轨道中心；
 *   2. 没有轨道线/拖尾 ⇒ 行星只是「慢慢漂的点」，眼睛读不出「在绕」；
 *   3. x/y 百分比被当成像素用 ⇒ x 按画布宽、y 按画布高各自换算，1280×720 下成扁椭圆；
 *   4. 内圈 12s 才转一圈 ⇒ 太慢，静态截图之间几乎看不出位移。
 *
 * 本版对策（全是通用技巧，非太阳系专属）：
 *   - 圆周在**像素空间**算，再换成 x/y 百分比 ⇒ 真圆；
 *   - 每颗行星带 4 个按帧滞后生成的拖尾残影 ⇒ 运动方向/速度可读；
 *   - 每条轨道铺一圈点状环 + 背景星点 ⇒ 路径与静止参照都在；
 *   - 字幕改为底部 `subtitle`（小字），不再压暗画面中心。
 *
 * 零外部素材、零视频模型调用。
 */

import { rgba, rnd, orbitSegs, pulseSegs, lagPhaseOffset } from './motion-helpers.mjs'

const W = 1280
const H = 720
const TOTAL = 360
const CX = 50
const CY = 50

const PLANETS = [
  { radiusPx: 150, period: 180, phase: 0.0, size: 3.4, color: '#5AA9FF', rgb: [90, 169, 255] },
  { radiusPx: 245, period: 260, phase: 2.1, size: 3.0, color: '#3DDC97', rgb: [61, 220, 151] },
  { radiusPx: 320, period: 360, phase: 4.3, size: 2.6, color: '#F59E0B', rgb: [245, 158, 11] },
]

const TRAIL = [
  { lagFrames: 3, opacity: 0.32, scale: 0.92 },
  { lagFrames: 6, opacity: 0.2, scale: 0.78 },
  { lagFrames: 9, opacity: 0.12, scale: 0.64 },
  { lagFrames: 12, opacity: 0.06, scale: 0.52 },
]

function stars() {
  const out = []
  for (let i = 0; i < 60; i += 1) {
    out.push({
      id: `star-${i}`,
      type: 'shape',
      shape: 'circle',
      color: rgba([220, 232, 255], 0.18 + rnd(i * 3 + 2) * 0.38),
      box: { x: 3 + rnd(i * 3) * 94, y: 3 + rnd(i * 3 + 1) * 94, w: 0.14 + rnd(i * 3 + 2) * 0.2, h: 0.14 },
      startFrame: 0,
      durationInFrames: TOTAL,
      fadeFrames: 0,
    })
  }
  return out
}

function orbitRings() {
  const out = []
  for (const [pi, planet] of PLANETS.entries()) {
    const dots = 30
    for (let j = 0; j < dots; j += 1) {
      const a = (2 * Math.PI * j) / dots
      const x = CX + (planet.radiusPx * Math.cos(a)) / (W / 100)
      const y = CY + (planet.radiusPx * Math.sin(a)) / (H / 100)
      out.push({
        id: `ring-${pi}-${j}`,
        type: 'shape',
        shape: 'circle',
        color: rgba([150, 190, 235], 0.3),
        box: { x, y, w: 0.45, h: 0.45 },
        startFrame: 0,
        durationInFrames: TOTAL,
        fadeFrames: 0,
      })
    }
  }
  return out
}

function planetTracks() {
  const out = []
  for (const [pi, planet] of PLANETS.entries()) {
    for (const [ti, trail] of TRAIL.entries()) {
      const phase = planet.phase + lagPhaseOffset(planet.period, trail.lagFrames)
      out.push({
        id: `planet-${pi}-trail-${ti}`,
        type: 'shape',
        shape: 'circle',
        color: rgba(planet.rgb, trail.opacity),
        box: { x: CX, y: CY, w: planet.size, h: planet.size },
        startFrame: 0,
        durationInFrames: TOTAL,
        fadeFrames: 0,
        transform: { scale: trail.scale },
        animate: orbitSegs({ cx: CX, cy: CY, radiusPx: planet.radiusPx, periodFrames: planet.period, totalFrames: TOTAL, phase, W, H }),
      })
    }
    out.push({
      id: `planet-${pi}`,
      type: 'shape',
      shape: 'circle',
      color: planet.color,
      box: { x: CX, y: CY, w: planet.size, h: planet.size },
      startFrame: 0,
      durationInFrames: TOTAL,
      fadeFrames: 0,
      animate: orbitSegs({ cx: CX, cy: CY, radiusPx: planet.radiusPx, periodFrames: planet.period, totalFrames: TOTAL, phase: planet.phase, W, H }),
    })
  }
  return out
}

function captions() {
  return [
    { id: 'cap-1', type: 'textCard', variant: 'subtitle', text: '三颗行星 · 绕中心公转', startFrame: 0, durationInFrames: 140, fadeFrames: 8 },
    { id: 'cap-2', type: 'textCard', variant: 'subtitle', text: '多段关键帧插值 · 帧级精确', startFrame: 130, durationInFrames: 120, fadeFrames: 8 },
    { id: 'cap-3', type: 'textCard', variant: 'subtitle', text: '纯几何程序化 · 0 次视频模型调用', startFrame: 240, durationInFrames: 120, fadeFrames: 8 },
  ]
}

export function manifestOrbit() {
  return {
    id: 'orbit-demo',
    meta: {
      title: '几何程序化运动 · 演示',
      width: W,
      height: H,
      fps: 30,
      durationInFrames: TOTAL,
      backgroundColor: '#070b16',
    },
    global: { fontFamily: 'Noto Sans SC', theme: 'dark' },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#070b16', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0 },
      ...stars(),
      ...orbitRings(),
      // 中心体光晕：三层同心渐隐（fake 柔光；Shape 没有 blur/radial-gradient）
      { id: 'sun-halo-2', type: 'shape', shape: 'circle', color: rgba([246, 196, 69], 0.03), box: { x: CX, y: CY, w: 15.5, h: 15.5 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0, animate: pulseSegs(TOTAL, 6, 1, 1.14) },
      { id: 'sun-halo-1', type: 'shape', shape: 'circle', color: rgba([246, 196, 69], 0.055), box: { x: CX, y: CY, w: 12.5, h: 12.5 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0, animate: pulseSegs(TOTAL, 6, 1, 1.14) },
      { id: 'sun-glow', type: 'shape', shape: 'circle', color: rgba([246, 196, 69], 0.1), box: { x: CX, y: CY, w: 10, h: 10 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0, animate: pulseSegs(TOTAL, 6, 1, 1.12) },
      // 中心体本体：多段 scale 呼吸
      { id: 'sun', type: 'shape', shape: 'circle', color: '#FFC94A', box: { x: CX, y: CY, w: 7.5, h: 7.5 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0, animate: pulseSegs(TOTAL, 6, 1, 1.1) },
      ...planetTracks(),
      ...captions(),
    ],
  }
}
