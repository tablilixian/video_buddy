/**
 * OPT-8（2026-10-26）：z-order 风险体检单测（反向变异靶）。
 *
 * 背景：真机实证（session 12:31）——无 box 的全屏视频轨排在 title 卡之后，
 * 重叠时间段内卡片被画面整体盖住「消失」，agent 只能改轨序绕过。渲染端底色
 * 已改为只跟媒体元素，但视频画面本身不透明，所以校验层补一条 warning 级体检，
 * 让模型在收稿前就看到提醒。
 *
 * 每条豁免/触发规则一个独立 test —— 删掉 manifest.ts 的 lintZOrder 调用或任一
 * 分支，对应 test 必须变红（铁律：守卫必须能反向变红）。
 *
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/remotion-zorder-lint.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/remotion/manifest.js'

function baseManifest() {
  return {
    id: 'comp-1',
    meta: { title: '新闻版式', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 'card-title', type: 'textCard', variant: 'title', text: '晚间新闻', startFrame: 0, durationInFrames: 300 },
      { id: 'node-vid', type: 'video', src: '/canvas-studio/assets/p1/clip.mp4', startFrame: 0, durationInFrames: 300 },
    ],
    audio: {},
  }
}

/** z-order 告警（编排体检 [编排体检 ] 前缀的建议不计）。 */
function zOrderWarnings(result) {
  return result.warnings.filter((warning) => warning.includes('z-order 风险'))
}

test('触发：全屏 video 排在重叠期 textCard 之后 → 报 z-order 风险', () => {
  const m = baseManifest()
  const result = validateManifest(m)
  assert.equal(result.ok, true, result.errors.join('；'))
  const warns = zOrderWarnings(result)
  assert.equal(warns.length, 1, `应恰有一条 z-order 告警：${JSON.stringify(result.warnings)}`)
  assert.ok(warns[0].includes('node-vid') && warns[0].includes('card-title'), `告警要点名两条轨：${warns[0]}`)
  assert.ok(warns[0].includes('数组更后') || warns[0].includes('box'), `告警要带修正指引：${warns[0]}`)
})

test('豁免：video 排在 textCard 之前（z 序更低）→ 不报', () => {
  const m = baseManifest()
  m.tracks.reverse()
  const result = validateManifest(m)
  assert.deepEqual(zOrderWarnings(result), [], result.warnings.join('；'))
})

test('豁免：时间不重叠（先后出场）→ 不报', () => {
  const m = baseManifest()
  m.tracks[1].startFrame = 300
  const result = validateManifest(m)
  assert.deepEqual(zOrderWarnings(result), [], result.warnings.join('；'))
})

test('豁免：video 带 box（局部区域）→ 不报', () => {
  const m = baseManifest()
  m.tracks[1].box = { x: 71, y: 50, w: 58, h: 100 }
  const result = validateManifest(m)
  assert.deepEqual(zOrderWarnings(result), [], result.warnings.join('；'))
})

test('豁免：下方 shape 显式铺满画布（全屏背景层）→ 不报', () => {
  const m = baseManifest()
  m.tracks[0] = {
    id: 'bg-rect', type: 'shape', shape: 'rect', color: '#161f38',
    startFrame: 0, durationInFrames: 300, box: { x: 50, y: 50, w: 100, h: 100 },
  }
  const result = validateManifest(m)
  assert.deepEqual(zOrderWarnings(result), [], result.warnings.join('；'))
})

test('触发：下方 shape 非全屏（内容层）→ 报', () => {
  const m = baseManifest()
  m.tracks[0] = {
    id: 'bar-1', type: 'shape', shape: 'rect', color: '#22d3ee',
    startFrame: 0, durationInFrames: 300, box: { x: 66, y: 70, w: 30, h: 20 },
  }
  const result = validateManifest(m)
  assert.equal(zOrderWarnings(result).length, 1, result.warnings.join('；'))
})

test('image 轨同样适用（全屏 image 盖住 textCard）', () => {
  const m = baseManifest()
  m.tracks[1] = { id: 'node-img', type: 'image', src: '/canvas-studio/assets/p1/still.png', startFrame: 0, durationInFrames: 300 }
  const result = validateManifest(m)
  assert.equal(zOrderWarnings(result).length, 1, result.warnings.join('；'))
})
