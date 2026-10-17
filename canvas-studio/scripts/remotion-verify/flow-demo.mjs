/**
 * Route A · 第二组演示：**齿轮旋转 + 信号流动**（主题无关，证明 motion-helpers 不止会公转）。
 *
 * 用到的范式（与太阳系 demo 完全不同）：
 *   - rotateSegs   —— 三个齿轮不同转速原地旋转（含反向 turn）
 *   - travelSegs   —— 信号粒子从中心 hub 流向各节点，错峰出场（序列揭示）
 *   - pulseSegs    —— hub 呼吸
 *
 * 这证明：agent 拿到「中心节点 + 绕转/旋转 + 流动」任意主题，都能用同一套通用助手表达，
 * 不需要为某个具体场景手写坐标。零外部素材。
 */

import { rgba, rotateSegs, pulseSegs, travelSegs } from './motion-helpers.mjs'

const W = 1280
const H = 720
const TOTAL = 300
const CX = 50
const CY = 50

const GEARS = [
  { x: 28, y: 30, size: 11, turns: 2, color: '#9fb4d8' },
  { x: 72, y: 34, size: 8, turns: -1.5, color: '#3DDC97' },
  { x: 52, y: 70, size: 13, turns: 1, color: '#F59E0B' },
]

const NODES = [
  { x: 22, y: 60, color: '#5AA9FF' },
  { x: 78, y: 64, color: '#E879F9' },
  { x: 50, y: 18, color: '#34D399' },
]

function hub() {
  return [
    { id: 'hub-glow', type: 'shape', shape: 'circle', color: rgba([120, 170, 255], 0.08), box: { x: CX, y: CY, w: 18, h: 18 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0, animate: pulseSegs(TOTAL, 5, 1, 1.12) },
    { id: 'hub', type: 'shape', shape: 'circle', color: '#6E8FD6', box: { x: CX, y: CY, w: 9, h: 9 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0, animate: pulseSegs(TOTAL, 5, 1, 1.08) },
  ]
}

function gears() {
  return GEARS.map((g, i) => ({
    id: `gear-${i}`,
    type: 'shape',
    shape: 'rect',
    color: g.color,
    box: { x: g.x, y: g.y, w: g.size, h: g.size },
    startFrame: 0,
    durationInFrames: TOTAL,
    fadeFrames: 0,
    animate: rotateSegs(TOTAL, g.turns),
  }))
}

function particles() {
  const out = []
  for (const [ni, node] of NODES.entries()) {
    const start = 20 + ni * 25
    out.push({
      id: `flow-${ni}`,
      type: 'shape',
      shape: 'circle',
      color: node.color,
      box: { x: CX, y: CY, w: 2.4, h: 2.4 },
      startFrame: 0,
      durationInFrames: TOTAL,
      fadeFrames: 0,
      animate: travelSegs({ from: { x: CX, y: CY }, to: { x: node.x, y: node.y }, startFrame: start, durationInFrames: 50, easing: 'easeInOut' }),
    })
    // 节点到位后常亮
    out.push({
      id: `node-${ni}`,
      type: 'shape',
      shape: 'circle',
      color: node.color,
      box: { x: node.x, y: node.y, w: 3.2, h: 3.2 },
      startFrame: start + 50,
      durationInFrames: TOTAL - (start + 50),
      fadeFrames: 0,
    })
  }
  return out
}

function captions() {
  return [
    { id: 'cap-1', type: 'textCard', variant: 'subtitle', text: '旋转 + 流动 · 通用运动范式', startFrame: 0, durationInFrames: 130, fadeFrames: 8 },
    { id: 'cap-2', type: 'textCard', variant: 'subtitle', text: 'rotateSegs / travelSegs / pulseSegs', startFrame: 120, durationInFrames: 110, fadeFrames: 8 },
    { id: 'cap-3', type: 'textCard', variant: 'subtitle', text: '同一套助手 · 不限主题', startFrame: 220, durationInFrames: 80, fadeFrames: 8 },
  ]
}

export function manifestFlow() {
  return {
    id: 'flow-demo',
    meta: { title: '通用运动范式 · 旋转与流动', width: W, height: H, fps: 30, durationInFrames: TOTAL, backgroundColor: '#0a0f1c' },
    global: { fontFamily: 'Noto Sans SC', theme: 'dark' },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#0a0f1c', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: TOTAL, fadeFrames: 0 },
      ...hub(),
      ...gears(),
      ...particles(),
      ...captions(),
    ],
  }
}
