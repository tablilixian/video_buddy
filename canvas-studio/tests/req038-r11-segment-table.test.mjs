/**
 * R11 · O-2（2026-11-16）· **段表（meta.segments）与段窗**
 *
 * 锁三件事：
 * ① 段表 = 每段首轨的实际起点（左移预卷后），首尾相接、Σ = 总帧；
 * ② 段表优先于 spec 等分边界（190/390 而不是 200/400），且不自洽时整表不用；
 * ③ 段表**不进**全局指纹 ⇒ 改 s2 的文案只脏 s2（“改一段不动全片”的最小证明）。
 *
 * 反向变异（改回旧行为必须红）：
 * - `resolveShotBoundaries` 删掉 segments 分支 ⇒ 「段表优先」用例红；
 * - `manifestGlobalsFingerprint` 把 segments 放回 meta ⇒ 「段表不进指纹」用例红；
 * - 段表改回等分起点（190→200） ⇒ 「改 s2 只脏 s2」用例红（s1 会跟着脏）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { planSegmentsFromScreens, planFromSpec } from '../lib/remotion/content-spec.js'
import { resolveShotBoundaries, sliceByShots } from '../lib/shot-slice.js'
import { manifestGlobalsFingerprint, segmentHash } from '../lib/shot-cache.js'

/** 三段屏桶：s2 / s3 已被 applyStageTransitions 左移 10 帧（200→190、400→390）。 */
function screenBuckets() {
  return [
    [{ id: 's1-base', type: 'shape', startFrame: 0, durationInFrames: 200 }],
    [{ id: 'u0-s2-u0-base', type: 'shape', startFrame: 190, durationInFrames: 210 }],
    [{ id: 's3-base', type: 'shape', startFrame: 390, durationInFrames: 210 }],
  ]
}

const TIMELINE = [
  { id: 's1', startFrame: 0 },
  { id: 's2', startFrame: 200 },
  { id: 's3', startFrame: 400 },
]

function manifestWith(segments, tracks) {
  return {
    id: 'm-test',
    meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 600, ...(segments === undefined ? {} : { segments }) },
    tracks,
  }
}

/** 三段内容互不重叠（模拟段表生效后的 manifest）。 */
function threeSegTracks() {
  return [
    { id: 'bg', type: 'shape', shape: 'rect', startFrame: 0, durationInFrames: 600 },
    { id: 's1-title', type: 'textCard', variant: 'title', text: 'ONE', startFrame: 0, durationInFrames: 190 },
    { id: 's2-title', type: 'textCard', variant: 'title', text: 'TWO', startFrame: 190, durationInFrames: 200 },
    { id: 's3-title', type: 'textCard', variant: 'title', text: 'THREE', startFrame: 390, durationInFrames: 210 },
  ]
}

const SEGMENTS = [
  { id: 's1', startFrame: 0, frames: 190 },
  { id: 's2', startFrame: 190, frames: 200 },
  { id: 's3', startFrame: 390, frames: 210 },
]

test('段表：取每段首轨实际起点（预卷后 190/390），首尾相接，Σ = 总帧', () => {
  const segments = planSegmentsFromScreens(screenBuckets(), TIMELINE, 600)
  assert.deepEqual(segments, SEGMENTS)
  assert.equal(segments.reduce((sum, seg) => sum + seg.frames, 0), 600, 'Σ frames 必须等于片长')
  for (let i = 1; i < segments.length; i += 1) {
    assert.equal(segments[i].startFrame, segments[i - 1].startFrame + segments[i - 1].frames, '相邻段必须首尾相接')
  }
})

test('段表：首段强制从 0 起（首轨若从 4 帧入场也不许留空白）', () => {
  const buckets = [[{ id: 'a', startFrame: 4, durationInFrames: 196 }], [{ id: 'b', startFrame: 190, durationInFrames: 210 }]]
  const segments = planSegmentsFromScreens(buckets, [{ id: 's1', startFrame: 0 }, { id: 's2', startFrame: 200 }], 400)
  assert.equal(segments[0].startFrame, 0)
  assert.equal(segments[0].frames, 190)
})

test('段表：非严格升序 ⇒ 整表作废（返回空，让调用方回退）', () => {
  const buckets = [
    [{ id: 'a', startFrame: 0, durationInFrames: 100 }],
    [{ id: 'b', startFrame: 300, durationInFrames: 100 }],
    [{ id: 'c', startFrame: 200, durationInFrames: 100 }],
  ]
  assert.deepEqual(planSegmentsFromScreens(buckets, TIMELINE, 600), [])
})

test('段表：空屏用 timeline 起点兜底，但段序与 sections 一一对应', () => {
  const buckets = [
    [{ id: 'a', startFrame: 0, durationInFrames: 190 }],
    [],
    [{ id: 'c', startFrame: 390, durationInFrames: 210 }],
  ]
  const segments = planSegmentsFromScreens(buckets, TIMELINE, 600)
  assert.deepEqual(segments.map((seg) => seg.id), ['s1', 's2', 's3'])
  assert.equal(segments[1].startFrame, 200, '空屏退到 timeline 起点，不从上一段硬拐')
})

test('边界解析：段表优先于 spec 等分边界（190/390，source=segments）', () => {
  const resolved = resolveShotBoundaries(manifestWith(SEGMENTS, threeSegTracks()), [200, 400])
  assert.deepEqual(resolved.cuts, [190, 390])
  assert.equal(resolved.source, 'segments')
})

test('边界解析：段表 Σ 与片长不符（过期 manifest）⇒ 整表不用，回退 spec', () => {
  const stale = [
    { id: 's1', startFrame: 0, frames: 190 },
    { id: 's2', startFrame: 190, frames: 200 },
    { id: 's3', startFrame: 390, frames: 300 }, // 390+300=690 ≠ 600
  ]
  const resolved = resolveShotBoundaries(manifestWith(stale, threeSegTracks()), [200, 400])
  assert.deepEqual(resolved.cuts, [200, 400])
  assert.equal(resolved.source, 'spec')
})

test('边界解析：段表首段不从 0 起 ⇒ 不自洽，回退', () => {
  const broken = [
    { id: 's1', startFrame: 10, frames: 180 },
    { id: 's2', startFrame: 190, frames: 410 },
  ]
  const resolved = resolveShotBoundaries(manifestWith(broken, threeSegTracks()), [200])
  assert.equal(resolved.source, 'spec')
})

test('边界解析：无段表 ⇒ 旧路径逐字段不变（回归纪律）', () => {
  const resolved = resolveShotBoundaries(manifestWith(undefined, threeSegTracks()), [200, 400])
  assert.deepEqual(resolved.cuts, [200, 400])
  assert.equal(resolved.source, 'spec')
})

test('切片：段窗 [0,190) [190,390) [390,600)，相邻段不共享帧', () => {
  const { segments } = sliceByShots(manifestWith(SEGMENTS, threeSegTracks()), [190, 390])
  assert.deepEqual(segments.map((seg) => [seg.startFrame, seg.endFrame]), [[0, 190], [190, 390], [390, 600]])
  assert.equal(segments.reduce((sum, seg) => sum + (seg.endFrame - seg.startFrame), 0), 600)
})

test('段表不进全局指纹：加/删 segments 指纹相同（否则改一段就全段失效）', () => {
  const withSeg = manifestGlobalsFingerprint(manifestWith(SEGMENTS, threeSegTracks()))
  const without = manifestGlobalsFingerprint(manifestWith(undefined, threeSegTracks()))
  assert.equal(withSeg, without)
})

test('改 s2 的文案 ⇒ 只有 s2 脏（s1 / s3 复用）', () => {
  const base = manifestWith(SEGMENTS, threeSegTracks())
  const globals = manifestGlobalsFingerprint(base)
  const before = sliceByShots(base, [190, 390]).segments.map((seg) => segmentHash(seg, 'standard', globals))

  const edited = manifestWith(SEGMENTS, threeSegTracks().map((track) => (track.id === 's2-title' ? { ...track, text: 'TWO-EDITED' } : track)))
  const globals2 = manifestGlobalsFingerprint(edited)
  const after = sliceByShots(edited, [190, 390]).segments.map((seg) => segmentHash(seg, 'standard', globals2))

  assert.equal(after[0], before[0], 's1 必须复用（旧段窗 0-200 会因 s2 入场帧而脏）')
  assert.notEqual(after[1], before[1], 's2 必须重渲')
  assert.equal(after[2], before[2], 's3 必须复用')
})

test('改常驻轨（bg）⇒ 全段脏（跨段轨在每段活跃集里，这是正确代价）', () => {
  const base = manifestWith(SEGMENTS, threeSegTracks())
  const globals = manifestGlobalsFingerprint(base)
  const before = sliceByShots(base, [190, 390]).segments.map((seg) => segmentHash(seg, 'standard', globals))

  const edited = manifestWith(SEGMENTS, threeSegTracks().map((track) => (track.id === 'bg' ? { ...track, color: '#000000' } : track)))
  const after = sliceByShots(edited, [190, 390]).segments.map((seg) => segmentHash(seg, 'standard', manifestGlobalsFingerprint(edited)))

  assert.notEqual(after[0], before[0])
  assert.notEqual(after[1], before[1])
  assert.notEqual(after[2], before[2])
})

test('端到端：autoStages spec → planFromSpec 返回段表，段窗比 planStages 早 10 帧（预卷）', () => {
  const spec = {
    meta: { title: '段表接线', durationSec: 20, fps: 30, autoStages: true },
    sections: [
      { id: 's1', card: 'A2', copy: '飞机为什么飞不过 2 万米？' },
      { id: 's2', card: 'A4', copy: '客机巡航约 1 万米' },
      { id: 's3', card: 'A5', copy: '关注我，下期讲急流层' },
    ],
  }
  const plan = planFromSpec(spec, 600)
  assert.equal(plan.segments.length, 3, 'autoStages 20s ⇒ 3 段')
  assert.deepEqual(plan.segments.map((seg) => seg.id), ['s1', 's2', 's3'], '段 id 必须与 sections 对齐')
  assert.equal(plan.segments.reduce((sum, seg) => sum + seg.frames, 0), 600)
  assert.equal(plan.segments[1].startFrame, 190, 's2 起点 = planStages 200 − 预卷 10')
  assert.equal(plan.segments[2].startFrame, 390, 's3 起点 = planStages 400 − 预卷 10')

  // 写进 meta 后，边界来源必须是 segments（不是 spec 等分）。
  const manifest = {
    id: 'from-spec',
    meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 600, segments: plan.segments },
    tracks: plan.tracks,
  }
  const resolved = resolveShotBoundaries(manifest, [200, 400])
  assert.equal(resolved.source, 'segments')
  assert.deepEqual(resolved.cuts, [190, 390])
})
