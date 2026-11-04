/**
 * #11 运动口径漂移检查（B-2 反向变异靶）。
 *
 * 守卫两件事：① 四处判据都从 motion-features.ts 派生，同一轨结论一致；
 * ② 新增动效字段若没进 MOTION_FIELD_KINDS，这里应能检出（新增字段时同步扩表）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  trackMotionFeatures, motionIntervalsFor, MOTION_FIELD_KINDS, ML10_INTERVAL_KINDS,
} from '../lib/remotion/motion-features.js'
import { trackIsAnimated } from '../lib/timing-segments.js'
import { collectAnimationWindows } from '../lib/remotion/manifest.js'

const base = { id: 't', startFrame: 10, durationInFrames: 60 }

test('静帧 / 显式动效 / 素材运动：四处判据一致', () => {
  const still = { ...base, type: 'image', src: 'a.png' }
  assert.equal(trackMotionFeatures(still).animated, false)
  assert.equal(trackIsAnimated(still), false, 'Q3 与 SSOT 必须同结论')
  assert.deepEqual(collectAnimationWindows({ tracks: [still] }), [], '静帧不进窗口表')

  const animated = { ...base, type: 'textCard', variant: 'title', text: 'x', animate: { from: { opacity: 0 }, to: { opacity: 1 } } }
  assert.equal(trackMotionFeatures(animated).animated, true)
  assert.equal(trackIsAnimated(animated), true)
  assert.deepEqual(collectAnimationWindows({ tracks: [animated] })[0].kinds, ['animate'])

  const video = { ...base, type: 'video', src: 'a.mp4' }
  assert.equal(trackIsAnimated(video), true, 'video 自身就是运动')
  assert.deepEqual(collectAnimationWindows({ tracks: [video] }), [], 'intrinsic 不撑大窗口表')
  assert.ok(motionIntervalsFor(video).length > 0, '但算进 ML-10 分子')
})

test('reveal.out / kenburns / orbit 都进 SSOT（CV-428 配套漏项已补）', () => {
  const revealOut = { ...base, type: 'shape', shape: 'rect', reveal: { startFrame: 0, durationInFrames: 12, out: { direction: 'right', durationInFrames: 10 } } }
  const kinds = trackMotionFeatures(revealOut).windowKinds
  assert.ok(kinds.includes('reveal'), '进场')
  assert.ok(kinds.includes('revealOut'), '退场擦除')

  const ken = { ...base, type: 'image', src: 'a.png', fit: 'kenburns' }
  assert.ok(trackMotionFeatures(ken).windowKinds.includes('kenburns'))
  assert.ok(motionIntervalsFor(ken).length > 0, 'kenburns 补进 ML-10 分子')

  const orbit = { ...base, type: 'video', src: 'a.mp4', orbit: { cx: 50, cy: 50, rx: 10, ry: 10 } }
  assert.ok(trackMotionFeatures(orbit).windowKinds.includes('orbit'))
})

test('漂移靶：ML-10 用到的每个 kind 都登记在 MOTION_FIELD_KINDS', () => {
  for (const kind of ML10_INTERVAL_KINDS) {
    const root = kind.startsWith('intrinsic:') ? 'intrinsic' : kind
    assert.ok(MOTION_FIELD_KINDS.includes(root), `kind ${kind} 未登记进漂移白名单`)
  }
  assert.ok(MOTION_FIELD_KINDS.includes('revealOut'))
})
