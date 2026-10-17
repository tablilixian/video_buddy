/**
 * REQ-034（Remotion 集成）· B2 时序纯函数单测：轨激活 / 淡入淡出 / 字幕时序 / 时长核对。
 * 直连 Host tsc 编译产物 lib/remotion/timing.js（零 Remotion 依赖）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  animateStateAt,
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

// ───────────── CV-336：多段关键帧按维度选择（修复「公转 / 呼吸被钉死」） ─────────────

/** 公转：12 段线性 x/y 沿半径 R 的圆周（manifest-contract §100 套路）。 */
function orbitTrack() {
  const cx = 50, cy = 50, R = 20, N = 12, segs = []
  for (let i = 0; i < N; i++) {
    const a1 = (i * 2 * Math.PI) / N, a2 = ((i + 1) * 2 * Math.PI) / N
    segs.push({
      from: { x: cx + R * Math.cos(a1), y: cy + R * Math.sin(a1) },
      to: { x: cx + R * Math.cos(a2), y: cy + R * Math.sin(a2) },
      startFrame: i * 25, durationInFrames: 25, easing: 'linear',
    })
  }
  return { transform: {}, animate: segs, durationInFrames: 300 }
}

test('animateStateAt：公转（多段同维度 x/y）逐帧平滑绕圈，不被钉死', () => {
  const track = orbitTrack()
  const cx = 50, cy = 50, R = 20
  const at = (f) => animateStateAt(track, f)
  // 起点 (50+R, 50)
  assert.ok(Math.abs(at(0).x - 70) < 1e-6 && Math.abs(at(0).y - 50) < 1e-6)
  // 末段终点回到接近起点（闭合）
  assert.ok(Math.abs(at(299).x - 70) < 0.6 && Math.abs(at(299).y - 50) < 0.6)
  // 不同帧位置必须不同（修复前会被钉在起点附近不动）
  assert.notDeepEqual([at(0).x, at(0).y], [at(150).x, at(150).y])
  // 全程半径保持 R（匀速绕圈），取若干采样点
  for (const f of [0, 25, 50, 75, 100, 150, 200, 250, 299]) {
    const s = at(f)
    const r = Math.hypot(s.x - cx, s.y - cy)
    assert.ok(Math.abs(r - R) < 1.5, `frame ${f} 半径 ${r.toFixed(2)} 偏离 ${R}`)
  }
})

test('animateStateAt：呼吸（多段同维度 scale 首尾相接）平滑 1→1.08→1', () => {
  const track = {
    transform: {},
    animate: [
      { from: { scale: 1 }, to: { scale: 1.08 }, startFrame: 0, durationInFrames: 30 },
      { from: { scale: 1.08 }, to: { scale: 1 }, startFrame: 30, durationInFrames: 30 },
    ],
    durationInFrames: 60,
  }
  assert.ok(Math.abs(animateStateAt(track, 0).scale - 1) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 15).scale - 1.04) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 30).scale - 1.08) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 45).scale - 1.04) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 59).scale - 1) < 1e-2)
})

test('animateStateAt：单段滑入（回归）x/opacity 不受影响', () => {
  const track = {
    transform: {},
    animate: { from: { x: 115, opacity: 0 }, to: { x: 50, opacity: 1 }, durationInFrames: 18, easing: 'easeOut' },
    durationInFrames: 120,
  }
  assert.ok(Math.abs(animateStateAt(track, 0).x - 115) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 18).x - 50) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 0).opacity - 0) < 1e-6)
  assert.ok(Math.abs(animateStateAt(track, 60).opacity - 1) < 1e-6)
})

test('animateStateAt：不同维度跨段叠加（x 走一段、scale 走另一段）各自独立', () => {
  const track = {
    transform: {},
    animate: [
      { from: { x: 0 }, to: { x: 100 }, startFrame: 0, durationInFrames: 50 },
      { from: { scale: 1 }, to: { scale: 2 }, startFrame: 0, durationInFrames: 100, easing: 'linear' },
    ],
    durationInFrames: 100,
  }
  const s = animateStateAt(track, 25) // x 中段、scale 1/4
  assert.ok(Math.abs(s.x - 50) < 1e-6)
  assert.ok(Math.abs(s.scale - 1.25) < 1e-6)
})
