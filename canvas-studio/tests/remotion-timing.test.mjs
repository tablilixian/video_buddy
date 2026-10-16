/**
 * REQ-034（Remotion 集成）· B2 时序纯函数单测：轨激活 / 淡入淡出 / 字幕时序 / 时长核对。
 * 直连 Host tsc 编译产物 lib/remotion/timing.js（零 Remotion 依赖）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveSubtitleTiming,
  fadeOpacity,
  isTrackActive,
  reconcileManifestVideoDurations,
  reconcileVideoDuration,
  trackLocalFrame,
  trackTransitionWindows,
  transitionOverride,
  VIDEO_DURATION_DRIFT_TOLERANCE_SEC,
} from '../lib/remotion/timing.js'

test('trackLocalFrame / isTrackActive：半开区间边界', () => {
  const track = { startFrame: 100, durationInFrames: 50 }
  assert.equal(trackLocalFrame(track, 100), 0)
  assert.equal(trackLocalFrame(track, 99), -1)
  assert.equal(isTrackActive(track, 99), false)
  assert.equal(isTrackActive(track, 100), true)
  assert.equal(isTrackActive(track, 149), true)
  assert.equal(isTrackActive(track, 150), false)
})

test('fadeOpacity：端点 0 / 平台 1 / 端点 clamp', () => {
  assert.equal(fadeOpacity(0, 30, 6), 0)
  assert.equal(fadeOpacity(3, 30, 6), 0.5)
  assert.equal(fadeOpacity(6, 30, 6), 1)
  assert.equal(fadeOpacity(15, 30, 6), 1)
  assert.equal(fadeOpacity(27, 30, 6), 0.5)
  assert.equal(fadeOpacity(29, 30, 6), 1 / 6)
  assert.equal(fadeOpacity(30, 30, 6), 0)
  assert.equal(fadeOpacity(-1, 30, 6), 0)
})

test('fadeOpacity：时长不足两倍淡入时自动折半', () => {
  assert.equal(fadeOpacity(0, 4, 6), 0)
  assert.equal(fadeOpacity(1, 4, 6), 0.5)
  assert.equal(fadeOpacity(2, 4, 6), 1)
  assert.equal(fadeOpacity(3, 4, 6), 0.5)
})

test('deriveSubtitleTiming：实测旁白按字数占比 + 末句吸收舍入', () => {
  const result = deriveSubtitleTiming({
    sentences: ['睡眠', '健康'],
    fps: 30,
    voiceOverDurationSec: 10,
  })
  assert.equal(result.estimated, false)
  assert.equal(result.totalFrames, 300)
  assert.equal(result.cues.length, 2)
  const [c0, c1] = result.cues
  assert.equal(c0.startFrame, 0)
  // 语音时长口径（供预览表核对句长）与屏上时长口径（含句尾呼吸间隔）必须分开：
  assert.equal(c0.speechEndFrame, 148)
  assert.equal(c0.durationInFrames, 152)
  assert.equal(c1.startFrame, 152)
  assert.equal(c1.startFrame + c1.durationInFrames, 300)
})

test('deriveSubtitleTiming：相邻字幕卡首尾相接（句间不留空白帧）', () => {
  // 成因：呼吸间隔 + 每卡自带淡入淡出叠加会让接缝处两卡不透明度同时为 0（闪一次背景）。
  const result = deriveSubtitleTiming({
    sentences: ['一', '二', '三', '四'],
    fps: 30,
    voiceOverDurationSec: 12,
  })
  const { cues, totalFrames } = result
  assert.equal(cues[0].startFrame, 0)
  for (let i = 0; i < cues.length - 1; i += 1) {
    assert.equal(
      cues[i].startFrame + cues[i].durationInFrames,
      cues[i + 1].startFrame,
      `第 ${i} 与第 ${i + 1} 句之间出现空白帧`,
    )
  }
  const last = cues[cues.length - 1]
  assert.equal(last.startFrame + last.durationInFrames, totalFrames)
})

test('deriveSubtitleTiming：字数多的句更长', () => {
  const result = deriveSubtitleTiming({
    sentences: ['ab', 'abcdef'],
    fps: 30,
    voiceOverDurationSec: 10,
  })
  const [c0, c1] = result.cues
  assert.ok(c1.durationInFrames > c0.durationInFrames)
  assert.equal(c1.startFrame + c1.durationInFrames, 300)
})

test('deriveSubtitleTiming：无旁白回退 4 字/秒估算', () => {
  const result = deriveSubtitleTiming({ sentences: ['abcd'], fps: 30 })
  assert.equal(result.estimated, true)
  assert.equal(result.totalFrames, 30)
  assert.equal(result.cues[0].durationInFrames, 30)
})

test('deriveSubtitleTiming：空句 / 非法 fps 返回空', () => {
  assert.deepEqual(deriveSubtitleTiming({ sentences: ['', ' '], fps: 30 }).cues, [])
  assert.deepEqual(deriveSubtitleTiming({ sentences: ['a'], fps: 0 }).cues, [])
})

test('reconcileVideoDuration：偏差 > 0.5s → 按真值修正 + warning', () => {
  const check = reconcileVideoDuration(300, 8, 30)
  assert.equal(check.corrected, true)
  assert.equal(check.frames, 240)
  assert.ok(check.driftSec > VIDEO_DURATION_DRIFT_TOLERANCE_SEC)
  assert.ok(check.warning.includes('240'))
})

test('reconcileVideoDuration：偏差在容差内不动；真值缺失原样返回', () => {
  const ok = reconcileVideoDuration(240, 8, 30)
  assert.equal(ok.corrected, false)
  assert.equal(ok.frames, 240)
  assert.equal(ok.warning, undefined)

  const noTruth = reconcileVideoDuration(300, undefined, 30)
  assert.equal(noTruth.frames, 300)
  assert.equal(noTruth.corrected, false)
})

test('reconcileManifestVideoDurations：只修偏差轨并聚合 warning', () => {
  const manifest = {
    id: 'c',
    meta: {},
    tracks: [
      { id: 'a', type: 'video', src: '/canvas-studio/assets/p/a.mp4', startFrame: 0, durationInFrames: 300 },
      { id: 'b', type: 'video', src: '/canvas-studio/assets/p/b.mp4', startFrame: 300, durationInFrames: 100 },
    ],
  }
  const { tracks, warnings } = reconcileManifestVideoDurations(
    manifest,
    { '/canvas-studio/assets/p/a.mp4': 8 },
    30,
  )
  assert.equal(warnings.length, 1)
  assert.equal(tracks[0].durationInFrames, 240)
  assert.equal(tracks[1].durationInFrames, 100)
})

test('trackTransitionWindows：按 from/to 角色收集转场窗口', () => {
  const manifest = {
    id: 'c',
    meta: {},
    tracks: [
      { id: 'img', type: 'image', src: '/x' },
      { id: 'vid', type: 'video', src: '/y' },
      { id: 'tr0', type: 'transition', effect: 'fade', fromTrackId: 'img', toTrackId: 'vid', startFrame: 100, durationInFrames: 10 },
    ],
  }
  assert.deepEqual(trackTransitionWindows(manifest, 'img'), [
    { role: 'from', effect: 'fade', startFrame: 100, durationInFrames: 10 },
  ])
  assert.deepEqual(trackTransitionWindows(manifest, 'vid'), [
    { role: 'to', effect: 'fade', startFrame: 100, durationInFrames: 10 },
  ])
  assert.deepEqual(trackTransitionWindows(manifest, 'nobody'), [])
})

test('transitionOverride：淡入 / 淡出 / 窗口外 / clamp', () => {
  const toWindow = { role: 'to', effect: 'fade', startFrame: 100, durationInFrames: 10 }
  assert.equal(transitionOverride(100, [toWindow]).opacity, 0)
  assert.equal(transitionOverride(105, [toWindow]).opacity, 0.5)
  assert.equal(transitionOverride(110, [toWindow]).opacity, 1)
  const fromWindow = { role: 'from', effect: 'fade', startFrame: 100, durationInFrames: 10 }
  assert.equal(transitionOverride(100, [fromWindow]).opacity, 1)
  assert.equal(transitionOverride(105, [fromWindow]).opacity, 0.5)
})

test('transitionOverride：slide 位移 / zoom 缩放 / 多窗口叠乘', () => {
  const slide = transitionOverride(105, [{ role: 'to', effect: 'slide', startFrame: 100, durationInFrames: 10 }])
  assert.ok(slide.translateXPercent > 0)
  const zoom = transitionOverride(105, [{ role: 'to', effect: 'zoom', startFrame: 100, durationInFrames: 10 }])
  assert.ok(zoom.scale < 1)
  const stacked = transitionOverride(105, [
    { role: 'to', effect: 'fade', startFrame: 100, durationInFrames: 10 },
    { role: 'from', effect: 'fade', startFrame: 100, durationInFrames: 10 },
  ])
  assert.ok(Math.abs(stacked.opacity - 0.25) < 1e-9)
})
