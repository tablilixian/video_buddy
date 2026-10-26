/**
 * OPT-11（2026-10-26）：成片音频构成摘要单测（反向变异靶）。
 *
 * `audibleSources === 0` 是「成片必然无声」的平台保证 —— 删掉 manifest.ts 的
 * 任一统计分支（muted 轨 / bgmUrl / voiceOverUrl / voiceOver[]），对应 test 必红。
 *
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/manifest-audio-summary.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeManifestAudio } from '../lib/remotion/manifest.js'

function manifestWith(tracks, audio = {}) {
  return {
    id: 'comp-1',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks,
    audio,
  }
}

test('全 muted video 轨 + 无 audio 段 → audibleSources=0（平台保证无声）', () => {
  const m = manifestWith([
    { id: 'v1', type: 'video', src: '/canvas-studio/assets/p1/a.mp4', startFrame: 0, durationInFrames: 300, muted: true },
    { id: 'img1', type: 'image', src: '/canvas-studio/assets/p1/b.png', startFrame: 0, durationInFrames: 300 },
    { id: 'card', type: 'textCard', variant: 'subtitle', text: 'x', startFrame: 0, durationInFrames: 300 },
  ])
  const summary = summarizeManifestAudio(m)
  assert.deepEqual(summary, { mutedVideoTracks: 1, audibleSources: 0 })
})

test('未静音 video 轨计入出声源；image/textCard/shape 不计', () => {
  const m = manifestWith([
    { id: 'v1', type: 'video', src: '/canvas-studio/assets/p1/a.mp4', startFrame: 0, durationInFrames: 300, muted: true },
    { id: 'v2', type: 'video', src: '/canvas-studio/assets/p1/b.mp4', startFrame: 0, durationInFrames: 300 },
    { id: 'img1', type: 'image', src: '/canvas-studio/assets/p1/c.png', startFrame: 0, durationInFrames: 300 },
  ])
  const summary = summarizeManifestAudio(m)
  assert.deepEqual(summary, { mutedVideoTracks: 1, audibleSources: 1 })
})

test('audio 段：bgmUrl / voiceOverUrl / voiceOver[] 各计入出声源', () => {
  const m = manifestWith(
    [{ id: 'card', type: 'textCard', variant: 'subtitle', text: 'x', startFrame: 0, durationInFrames: 300 }],
    { bgmUrl: '/canvas-studio/assets/p1/bgm.mp3', voiceOverUrl: '/canvas-studio/assets/p1/v1.mp3' },
  )
  assert.equal(summarizeManifestAudio(m).audibleSources, 2)

  const m2 = manifestWith([], { voiceOver: [{ src: '/canvas-studio/assets/p1/v1.mp3', startFrame: 0 }, { src: '/canvas-studio/assets/p1/v2.mp3', startFrame: 90 }] })
  assert.equal(summarizeManifestAudio(m2).audibleSources, 2)
})

test('空 manifest → 双零（纯代码片无声）', () => {
  const summary = summarizeManifestAudio(manifestWith([]))
  assert.deepEqual(summary, { mutedVideoTracks: 0, audibleSources: 0 })
})
