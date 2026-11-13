/**
 * REQ-038 R7（RQ-28）· **版面层判据** ML-16 / ML-17 单测。
 *
 * 这两条查的不是动画，是「一屏里有几个东西」和「有没有跨屏不变的底板」——
 * 真机 45s 片 51% 的秒数只有 1 个元素、常驻层 0 块；手写 60s 版是 5.88 个/秒、9 块。
 * 判据必须双向验：真机那种形态要红，手写那种形态不许红（否则等于给好片加噪声）。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/motion-lint.js`。
 * 定向跑：node --test tests/remotion-layout-lint.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lintMotion } from '../lib/remotion/motion-lint.js'

const FPS = 30

function manifest(tracks, seconds) {
  return {
    id: 'comp-layout',
    meta: { title: '版面判据', width: 1280, height: 720, fps: FPS, durationInFrames: Math.round(seconds * FPS) },
    tracks,
  }
}

function codes(issues) {
  return issues.map((issue) => issue.code)
}

/** 一片 n 屏、每屏 1 个文字单元 —— 真机 45s 版的形态（互斥替换，无第二层）。 */
function soloScreens(count, screenSeconds, extra = []) {
  const tracks = []
  for (let i = 0; i < count; i += 1) {
    tracks.push({
      id: `s${String(i)}`,
      type: 'textCard',
      variant: 'title',
      text: `第 ${String(i + 1)} 屏`,
      startFrame: Math.round(i * screenSeconds * FPS),
      durationInFrames: Math.round(screenSeconds * FPS),
      fadeFrames: 6,
      box: { x: 50, y: 50, w: 90, h: 60 },
    })
  }
  return manifest([...tracks, ...extra], count * screenSeconds)
}

/** 跨屏常驻底板（80% × 40%，无入场动画）。 */
function carryTrack(seconds) {
  return {
    id: 'carry-panel',
    type: 'shape',
    shape: 'rect',
    color: '#1b2333',
    box: { x: 50, y: 56, w: 80, h: 40 },
    startFrame: 0,
    durationInFrames: Math.round(seconds * FPS),
    fadeFrames: 0,
  }
}

test('ML-16：每屏只有一个元素的长片要报（真机 45s 形态）', () => {
  const issues = lintMotion(soloScreens(6, 5))
  assert.ok(codes(issues).includes('ML-16'), '单元素长片必须命中 ML-16')
  const issue = issues.find((item) => item.code === 'ML-16')
  assert.match(issue.message, /100%/, '六屏各一个元素 ⇒ 采样占比应为 100%')
})

test('ML-16：屏内并置两个单元就不报', () => {
  const tracks = []
  for (let i = 0; i < 6; i += 1) {
    const start = Math.round(i * 5 * FPS)
    const duration = Math.round(5 * FPS)
    tracks.push({
      id: `a${String(i)}`,
      type: 'textCard',
      variant: 'title',
      text: '左',
      startFrame: start,
      durationInFrames: duration,
      box: { x: 28, y: 50, w: 40, h: 50 },
    })
    tracks.push({
      id: `b${String(i)}`,
      type: 'chart',
      chart: 'bar',
      startFrame: start,
      durationInFrames: duration,
      box: { x: 70, y: 50, w: 46, h: 54 },
      data: [{ label: 'Q1', value: 12 }],
    })
  }
  assert.ok(!codes(lintMotion(manifest(tracks, 30))).includes('ML-16'))
})

test('ML-17：全片没有常驻层要报（真机 45s 形态）', () => {
  const issues = lintMotion(soloScreens(6, 5))
  assert.ok(codes(issues).includes('ML-17'), '零常驻层必须命中 ML-17')
})

test('ML-17：一条跨屏底板就够，不报', () => {
  const issues = lintMotion(soloScreens(6, 5, [carryTrack(30)]))
  assert.ok(!codes(issues).includes('ML-17'), '有 80%×40% 跨屏底板不该报')
})

test('ML-17：全屏底色不算常驻层（每支片都有，判不出编排意图）', () => {
  const bg = {
    id: 'bg',
    type: 'shape',
    shape: 'gradient',
    color: '#0b1020',
    box: { x: 50, y: 50, w: 100, h: 100 },
    startFrame: 0,
    durationInFrames: Math.round(30 * FPS),
    fadeFrames: 0,
  }
  const fullRect = { ...carryTrack(30), id: 'full', box: { x: 50, y: 50, w: 100, h: 100 } }
  const issues = lintMotion(soloScreens(6, 5, [bg, fullRect]))
  assert.ok(codes(issues).includes('ML-17'), '100%×100% 的底板不是「版面」')
})

test('ML-17：带短入场的长轨仍算常驻层（常驻不等于零入场）', () => {
  // 300s 底板带 6 帧淡入 = 0.7% —— 观感就是常驻，不该判红。
  const faded = { ...carryTrack(30), fadeFrames: 6 }
  const issues = lintMotion(soloScreens(6, 5, [faded]))
  assert.ok(!codes(issues).includes('ML-17'))
})

test('ML-17：入场占该轨 10% 以上不算常驻层（那是一屏一张大卡）', () => {
  const animated = { ...carryTrack(30), fadeFrames: 30 * FPS * 0.2 }
  const issues = lintMotion(soloScreens(6, 5, [animated]))
  assert.ok(codes(issues).includes('ML-17'))
})

test('短片不判版面：8 秒三屏谈不上单调', () => {
  const issues = lintMotion(soloScreens(2, 4))
  assert.ok(!codes(issues).includes('ML-16'))
  assert.ok(!codes(issues).includes('ML-17'))
})

test('告警上限不吞版面判据（MAX_ISSUES=12 先到先得）', () => {
  // 20 条各自硬切收尾的轨 ⇒ 足够刷满 ML-02；版面两条仍必须在输出里。
  const noisy = []
  for (let i = 0; i < 20; i += 1) {
    noisy.push({
      id: `n${String(i)}`,
      type: 'textCard',
      variant: 'title',
      text: `轨 ${String(i)}`,
      startFrame: i * 45,
      durationInFrames: 40,
      fadeFrames: 0,
    })
  }
  const issues = lintMotion(manifest(noisy, 30))
  const list = codes(issues)
  assert.ok(list.includes('ML-16'), '版面判据被其他告警挤出了上限')
  assert.ok(list.length <= 13, '上限机制应仍然生效（12 条 + ML-00 汇总）')
})

test('阈值边界：25% 的单元素占比在线上，30% 越线', () => {
  // 10 屏 × 3s = 30s；其中 3 屏单元素（9s / 30s = 30%），其余并置两元素。
  const tracks = []
  for (let i = 0; i < 10; i += 1) {
    const start = Math.round(i * 3 * FPS)
    const duration = Math.round(3 * FPS)
    tracks.push({
      id: `a${String(i)}`,
      type: 'textCard',
      variant: 'title',
      text: '主',
      startFrame: start,
      durationInFrames: duration,
      box: { x: 30, y: 50, w: 40, h: 50 },
    })
    if (i >= 3) {
      tracks.push({
        id: `b${String(i)}`,
        type: 'shape',
        shape: 'rect',
        color: '#223',
        startFrame: start,
        durationInFrames: duration,
        box: { x: 74, y: 50, w: 30, h: 40 },
      })
    }
  }
  const issues = lintMotion(manifest(tracks, 30))
  assert.ok(codes(issues).includes('ML-16'), '30% 越线应报')
})
