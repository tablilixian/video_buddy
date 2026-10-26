/**
 * OPT-15（2026-10-26）：动画窗口表单测（反向变异靶）。
 *
 * 背景：QC 曾把 maskReveal 动画中段的标题判成「偏移 ~100px」，末帧其实居中，
 * 烧 ~4 轮排查。窗口表让 agent 拿抽帧号对窗口、先看末帧再定论。
 *
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/manifest-animation-windows.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectAnimationWindows } from '../lib/remotion/manifest.js'

function manifestWith(tracks) {
  return {
    id: 'comp-1',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks,
    audio: {},
  }
}

test('collectAnimationWindows：animate / exit / orbit 各自计入 kinds，窗口=轨区间', () => {
  const windows = collectAnimationWindows(manifestWith([
    { id: 'title', type: 'textCard', variant: 'subtitle', text: 'x', startFrame: 90, durationInFrames: 60,
      animate: { from: { opacity: 0 }, to: { opacity: 1 } }, exit: { effect: 'fade' } },
    { id: 'plain', type: 'image', src: '/canvas-studio/assets/p1/a.png', startFrame: 0, durationInFrames: 300 },
  ]))
  assert.equal(windows.length, 1, '无动画轨不进表')
  assert.deepEqual(windows[0], { id: 'title', start: 90, end: 150, kinds: ['animate', 'exit'] })
})

test('collectAnimationWindows：orbit 也算动画；空 manifest → 空表', () => {
  const windows = collectAnimationWindows(manifestWith([
    { id: 'v1', type: 'video', src: '/canvas-studio/assets/p1/a.mp4', startFrame: 0, durationInFrames: 300,
      orbit: { cx: 50, cy: 50, rx: 10, ry: 10 } },
  ]))
  assert.deepEqual(windows, [{ id: 'v1', start: 0, end: 300, kinds: ['orbit'] }])
  assert.deepEqual(collectAnimationWindows(manifestWith([])), [])
})
