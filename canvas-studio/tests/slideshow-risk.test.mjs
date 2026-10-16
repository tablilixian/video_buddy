/**
 * REQ-034（Remotion 集成）· B5 纯函数单测：幻灯片风险 6 维评分。
 * 直连 Host tsc 编译产物 lib/remotion/slideshow-risk.js（零 Remotion 依赖）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreSlideshowRisk, SLIDESHOW_RISK_WARNING_THRESHOLD } from '../lib/remotion/slideshow-risk.js'

function dim(risk, name) {
  const found = risk.dims.find((d) => d.name === name)
  assert.ok(found, `缺少维度：${name}`)
  return found
}

test('纯幻灯片（全文本卡 / 无视频 / 无转场）→ 高分 + warning', () => {
  const manifest = {
    id: 'c',
    meta: { title: 'x', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 't0', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 100 },
      { id: 't1', type: 'textCard', variant: 'bullets', text: ['B'], startFrame: 100, durationInFrames: 100 },
      { id: 't2', type: 'textCard', variant: 'dataCard', text: 'C', startFrame: 200, durationInFrames: 100 },
    ],
  }
  const risk = scoreSlideshowRisk(manifest)
  assert.ok(risk.score >= SLIDESHOW_RISK_WARNING_THRESHOLD, `score=${risk.score}`)
  assert.ok(risk.warning.includes('幻灯片'))
  assert.equal(dim(risk, '静态占比').hit, true)
  assert.equal(dim(risk, '运动密度').hit, true)
  assert.equal(dim(risk, '转场多样性').hit, true)
  assert.equal(dim(risk, '字幕/解说覆盖').hit, false) // 有文本卡
})

test('视频为主 + 多样转场 + 旁白 → 低分、无 warning', () => {
  const manifest = {
    id: 'c',
    meta: { title: 'x', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 'v0', type: 'video', src: '/canvas-studio/assets/p/a.mp4', startFrame: 0, durationInFrames: 100 },
      { id: 'v1', type: 'video', src: '/canvas-studio/assets/p/b.mp4', startFrame: 100, durationInFrames: 100 },
      { id: 'v2', type: 'video', src: '/canvas-studio/assets/p/c.mp4', startFrame: 200, durationInFrames: 100 },
      { id: 'tr0', type: 'transition', effect: 'fade', fromTrackId: 'v0', toTrackId: 'v1', startFrame: 100, durationInFrames: 12 },
      { id: 'tr1', type: 'transition', effect: 'slide', fromTrackId: 'v1', toTrackId: 'v2', startFrame: 200, durationInFrames: 12 },
    ],
    audio: { voiceOverUrl: '/canvas-studio/assets/p/voice.mp3' },
  }
  const risk = scoreSlideshowRisk(manifest)
  assert.ok(risk.score < SLIDESHOW_RISK_WARNING_THRESHOLD, `score=${risk.score}`)
  assert.equal(risk.warning, undefined)
  assert.equal(dim(risk, '静态占比').hit, false)
  assert.equal(dim(risk, '运动密度').hit, false)
  assert.equal(dim(risk, '转场多样性').hit, false)
  assert.equal(dim(risk, '镜头数').hit, false)
  assert.equal(dim(risk, '字幕/解说覆盖').hit, false)
})

test('运动密度：视频时长占比 < 20% → 命中', () => {
  const manifest = {
    id: 'c',
    meta: { title: 'x', width: 1280, height: 720, fps: 30, durationInFrames: 1000 },
    tracks: [
      { id: 'v0', type: 'video', src: '/canvas-studio/assets/p/a.mp4', startFrame: 0, durationInFrames: 150 },
      { id: 'i0', type: 'image', src: '/canvas-studio/assets/p/a.png', startFrame: 150, durationInFrames: 850 },
    ],
    audio: { voiceOverUrl: '/canvas-studio/assets/p/voice.mp3' },
  }
  const risk = scoreSlideshowRisk(manifest)
  assert.equal(dim(risk, '运动密度').hit, true) // 15% < 20%
})

test('节奏单调：等长内容轨命中，长短分明不命中', () => {
  const base = (durations) => ({
    id: 'c',
    meta: { title: 'x', width: 1280, height: 720, fps: 30, durationInFrames: 600 },
    tracks: durations.map((d, i) => ({
      id: `v${i}`, type: 'video', src: `/canvas-studio/assets/p/${i}.mp4`, startFrame: 0, durationInFrames: d,
    })),
    audio: { voiceOverUrl: '/canvas-studio/assets/p/voice.mp3' },
  })
  assert.equal(dim(scoreSlideshowRisk(base([200, 200, 200])), '节奏单调').hit, true)
  assert.equal(dim(scoreSlideshowRisk(base([100, 200, 300])), '节奏单调').hit, false)
})

test('镜头数：≥60s 阈值抬到 5', () => {
  const manifest = (durationInFrames, videoCount) => ({
    id: 'c',
    meta: { title: 'x', width: 1280, height: 720, fps: 30, durationInFrames },
    tracks: Array.from({ length: videoCount }, (_, i) => ({
      id: `v${i}`, type: 'video', src: `/canvas-studio/assets/p/${i}.mp4`, startFrame: 0, durationInFrames: 60,
    })),
    audio: { voiceOverUrl: '/canvas-studio/assets/p/voice.mp3' },
  })
  // 1800 帧 = 60s；4 个镜头 < 5 → 命中
  assert.equal(dim(scoreSlideshowRisk(manifest(1800, 4)), '镜头数').hit, true)
  // 300 帧 = 10s；3 个镜头 ≥ 3 → 不命中
  assert.equal(dim(scoreSlideshowRisk(manifest(300, 3)), '镜头数').hit, false)
})
