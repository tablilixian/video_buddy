/**
 * REQ-038 R11 · **段渲染工单参数**（segmentRenderOptions）单测 —— P0 修复的集成断言。
 *
 * 背景（2026-11-16 review）：C5 接线把段渲染参数内联在 host-tools 里，漏传了
 * frameRange/muteAudio（commit message 声称传了、代码没传）→ 每段按整片时长
 * 渲染 → concat = N × 整片时长，且错误产物进了缓存。C3 的透传单测只测
 * runRenderJob 两端、C5 单测只测纯决策函数——中间的集成点零测试。
 *
 * 修复后：参数构造收进纯函数 `segmentRenderOptions`（唯一构造点），host-tools
 * 只负责 spread + projectId/signal。本文件把口径钉死：
 * ① frameRange 是**闭区间** `[start, end-1]`——Remotion `getRealFrameRange`
 *   对 `end >= durationInFrames` 直接抛错，直传半开窗会让末段越界、中间段
 *   每段多渲一帧（边界重复帧）；
 * ② muteAudio 恒 true（D3），且段 manifest 已剥 audio（双保险）；
 * ③ fps / quality / realDurations 按原工单口径透传。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r11-segment-render.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import { manifestGlobalsFingerprint, planShotRender, segmentRenderOptions } from '../lib/shot-cache.js'
import { boundariesFromSpec, sliceByShots } from '../lib/shot-slice.js'

const SPEC = {
  meta: { title: '工单参数样例', durationSec: 20, fps: 30, autoStages: true },
  sections: [
    { id: 's1', copy: '开场', card: 'A2' },
    { id: 's2', copy: '数据', card: 'B1' },
    { id: 's3', copy: '收尾', card: 'A5' },
  ],
}

function manifestWith(audio) {
  const plan = planFromSpec(SPEC, 600)
  const manifest = {
    id: 'm',
    meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 600, backgroundColor: '#0B1220' },
    tracks: plan.tracks,
  }
  if (audio !== undefined) manifest.audio = audio
  return manifest
}

test('frameRange 闭区间换算：[start, end-1]（Remotion 端越界即抛错）', () => {
  const manifest = manifestWith(undefined)
  const { segments } = sliceByShots(manifest, [200, 400])
  const opts = segmentRenderOptions(manifest, segments[0], 'standard')
  assert.deepEqual(opts.frameRange, [0, 199], '半开窗 [0,200) → 闭区间 [0,199]')
  const last = segmentRenderOptions(manifest, segments[2], 'standard')
  assert.deepEqual(last.frameRange, [400, 599], '末段 end-1 = 599 < durationInFrames=600，不越界')
  const middle = segmentRenderOptions(manifest, segments[1], 'standard')
  assert.deepEqual(middle.frameRange, [200, 399], '相邻段不共享帧：拼接零重复')
})

test('muteAudio 恒 true + 段 manifest 剥 audio（D3 双保险）', () => {
  const manifest = manifestWith({ bgmUrl: '/x.mp3' })
  const { segments } = sliceByShots(manifest, [200, 400])
  const opts = segmentRenderOptions(manifest, segments[1], 'standard')
  assert.equal(opts.muteAudio, true)
  assert.equal(opts.manifest.audio, undefined, '工单 manifest 不带 audio')
  assert.equal(opts.manifest.tracks.length, segments[1].tracks.length, '段活跃轨')
})

test('fps / quality / realDurations 透传；不传 realDurations 不带字段', () => {
  const manifest = manifestWith(undefined)
  const { segments } = sliceByShots(manifest, [200, 400])
  const withReal = segmentRenderOptions(manifest, segments[0], 'high', { 'a.mp4': 5.167 })
  assert.equal(withReal.fps, 30)
  assert.equal(withReal.quality, 'high')
  assert.deepEqual(withReal.realDurations, { 'a.mp4': 5.167 })
  const bare = segmentRenderOptions(manifest, segments[0], 'standard')
  assert.equal('realDurations' in bare, false, '缺省不带 realDurations 字段')
})

test('degenerate 段（endFrame <= startFrame）不许产出倒挂区间', () => {
  const manifest = manifestWith(undefined)
  const { segments } = sliceByShots(manifest, [200, 400])
  const broken = { ...segments[0], startFrame: 50, endFrame: 50 }
  const opts = segmentRenderOptions(manifest, broken, 'standard')
  assert.deepEqual(opts.frameRange, [50, 50], 'end-1 取 max(start) 兜底')
})

test('planShotRender 携带 globals 指纹，且与 manifestGlobalsFingerprint 一致', () => {
  const manifest = manifestWith(undefined)
  const specBoundaries = boundariesFromSpec(SPEC, 600, 30)
  const plan = planShotRender(manifest, {
    specBoundaries,
    quality: 'standard',
    projectDir: '/tmp/r11-segment-render',
    allowShots: true,
  })
  assert.equal(plan.mode, 'shots')
  assert.equal(plan.globals, manifestGlobalsFingerprint(manifest), '决策方与比对方必须同一把钥匙')
  assert.equal(plan.hashes.length, plan.segments.length)
})

test('改 meta.look 后 planShotRender 的 hashes 全变（全局态进决策 hash）', () => {
  const manifestA = manifestWith(undefined)
  const manifestB = { ...manifestWith(undefined), meta: { ...manifestWith(undefined).meta, look: { vignette: 0.35 } } }
  const specBoundaries = boundariesFromSpec(SPEC, 600, 30)
  const base = { specBoundaries, quality: 'standard', projectDir: '/tmp/r11-segment-render', allowShots: true }
  const planA = planShotRender(manifestA, base)
  const planB = planShotRender(manifestB, base)
  assert.notEqual(planA.globals, planB.globals)
  assert.notDeepEqual(planA.hashes, planB.hashes, '调色变了不许复用旧段 hash')
})
