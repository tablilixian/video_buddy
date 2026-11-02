/**
 * 复刻提效批四：Q2/Q3 双闸纯函数层（src/timing-segments.ts）单测。
 *
 * 覆盖：入参解析（合法/拒收/宽容）、动画轨判定（逐轨型双向 —— 静帧卡/静态 shape
 * 必须判「不动」，这是 Q3 要抓的反模式）、覆盖核对（差数触发 / 足额不触发 /
 * 时间窗边界 / transition 不顶数）、时序回核汇总与告警（unmatched / 大漂移 /
 * extra 三类各成行；ok=true 但漂移超 0.3s **不得**漏报 —— 匹配 ok 与告警是两回事）。
 * ffmpeg IO（verifyTeardown 本体）在 teardown-verify.test.mjs 已有真 E2E。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// 错误码目录表（CS-USER-ERR 等）靠副作用注册 —— 与 src/remotion/render-job.ts 同款引入。
import '../lib/errors/catalog.js'
import {
  parseTimingSegments,
  trackIsAnimated,
  checkElementCoverage,
  coverageWarningText,
  summarizeTimingCheck,
  timingCheckWarnings,
  TIMING_CHECK_SAMPLE_FPS,
  TIMING_CHECK_TOLERANCE_SEC,
} from '../lib/timing-segments.js'

function expectUserErr(fn) {
  assert.throws(fn, (error) => error?.code === 'CS-USER-ERR', '应抛 CS-USER-ERR（CanvasStudioError.code）')
}

test('parseTimingSegments：合法段 + elements 过滤与缺省 label', () => {
  const parsed = parseTimingSegments([
    { label: '开场', startSec: 0, endSec: 1.8 },
    { startSec: 1.8, endSec: 4.2, elements: ['产品跳升', '', '装饰星体', 42] },
  ])
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].label, '开场')
  assert.equal(parsed[0].elements, undefined)
  assert.equal(parsed[1].label, '段2')
  assert.deepEqual(parsed[1].elements, ['产品跳升', '装饰星体'])
})

test('parseTimingSegments：undefined / 空数组 → 未启用', () => {
  assert.equal(parseTimingSegments(undefined), undefined)
  assert.equal(parseTimingSegments(null), undefined)
  assert.equal(parseTimingSegments([]), undefined)
})

test('parseTimingSegments：形状非法显式拒收（双向变异）', () => {
  expectUserErr(() => parseTimingSegments('not-an-array'))
  expectUserErr(() => parseTimingSegments([{ label: 'a', startSec: 3, endSec: 1 }]))
  expectUserErr(() => parseTimingSegments([{ label: 'a', startSec: Number.NaN, endSec: 2 }]))
  // 合法边界：startSec == endSec - 0.1 必须放行
  assert.equal(parseTimingSegments([{ label: 'a', startSec: 1, endSec: 1.1 }]).length, 1)
})

test('trackIsAnimated：显式动效字段优先，静帧/静态卡判「不动」（反模式双向）', () => {
  const base = { id: 't', startFrame: 0, durationInFrames: 30 }
  assert.equal(trackIsAnimated({ ...base, type: 'image' }), false, '纯 cover 静帧不算动画轨')
  assert.equal(trackIsAnimated({ ...base, type: 'image', fit: 'cover' }), false)
  assert.equal(trackIsAnimated({ ...base, type: 'image', fit: 'kenburns' }), true)
  assert.equal(trackIsAnimated({ ...base, type: 'textCard', variant: 'title' }), false, '纯静态标题不算')
  assert.equal(trackIsAnimated({ ...base, type: 'textCard', variant: 'title', anim: 'fadeUp' }), true)
  assert.equal(trackIsAnimated({ ...base, type: 'shape', shape: 'circle' }), false)
  assert.equal(trackIsAnimated({ ...base, type: 'shape', shape: 'path', draw: { durationInFrames: 10 } }), true)
  assert.equal(trackIsAnimated({ ...base, type: 'image', animate: { from: { y: 90 }, to: { y: 50 } } }), true)
  assert.equal(trackIsAnimated({ ...base, type: 'video' }), true, '实拍内容本身就是运动')
  assert.equal(trackIsAnimated({ ...base, type: 'caption', text: 'x' }), true)
  assert.equal(trackIsAnimated({ ...base, type: 'transition', effect: 'fade' }), false, '转场不顶元素数')
})

test('checkElementCoverage：足额不报，缺额报差值', () => {
  const fps = 30
  const manifest = {
    meta: { fps },
    tracks: [
      { id: 'v', type: 'video', startFrame: 0, durationInFrames: 240 },
      { id: 's', type: 'shape', shape: 'star', startFrame: 0, durationInFrames: 120, orbit: { durationInFrames: 120 } },
      { id: 't', type: 'textCard', variant: 'title', text: 'x', startFrame: 0, durationInFrames: 120, anim: 'fadeUp' },
    ],
  }
  const ok = checkElementCoverage(manifest, [
    { label: 'p1', startSec: 0, endSec: 4, elements: ['实拍推近', '装饰星体', '标题入场'] },
  ], fps)
  assert.equal(ok.length, 0, '3 元素 vs 3 动画轨 —— 足额')
  const deficit = checkElementCoverage(manifest, [
    { label: 'p1', startSec: 0, endSec: 4, elements: ['实拍', '装饰星体', '标题', '进度条'] },
  ], fps)
  assert.equal(deficit.length, 1)
  assert.equal(deficit[0].elements, 4)
  assert.equal(deficit[0].animatedTracks, 3)
  assert.ok(coverageWarningText(deficit[0]).includes('差 1'))
})

test('checkElementCoverage：无 elements 跳过；时间窗边界与转场豁免（变异）', () => {
  const fps = 30
  const manifest = {
    meta: { fps },
    tracks: [
      // 只在窗口 [30, 90) 之外：0–30（正好在 winStart 收尾）不算重叠
      { id: 'a', type: 'video', startFrame: 0, durationInFrames: 30 },
      // 与窗口重叠 1 帧：算
      { id: 'b', type: 'video', startFrame: 89, durationInFrames: 5 },
      // 完全在窗口内的转场：不计入动画轨
      { id: 'tr', type: 'transition', effect: 'fade', startFrame: 40, durationInFrames: 10 },
    ],
  }
  const issues = checkElementCoverage(manifest, [
    { label: 'seg', startSec: 1, endSec: 3, elements: ['e1', 'e2', 'e3'] },
  ], fps)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].animatedTracks, 1, '窗口内只有轨 b；转场与窗外轨都不顶数')
  // 无 elements 的段只用于 Q2，不做覆盖核对
  assert.equal(checkElementCoverage(manifest, [{ label: 'seg', startSec: 1, endSec: 3 }], fps).length, 0)
})

test('summarizeTimingCheck + timingCheckWarnings：unmatched / extra 各成行', () => {
  const summary = summarizeTimingCheck({
    sampleFps: 4,
    frameCount: 40,
    coveredSec: 10,
    ok: false,
    boundaries: [
      { label: '开场', tableSec: 0, status: 'matched', measuredSec: 0, deltaSec: 0 },
      { label: 'p2', tableSec: 4.2, status: 'matched', measuredSec: 4.75, deltaSec: 0.55 },
      { label: 'p3', tableSec: 8.0, status: 'unmatched' },
    ],
    extraSwitches: [{ timeSec: 6.5, magnitude: 88 }],
  })
  assert.equal(summary.unmatched, 1)
  assert.equal(summary.extraSwitches, 1)
  const warnings = timingCheckWarnings(summary)
  assert.equal(warnings.length, 3, 'unmatched + 大漂移 + extra 各一行')
  assert.ok(warnings[0].includes('p3'))
  assert.ok(warnings[1].includes('p2') && warnings[1].includes('+0.55'))
  assert.ok(warnings[2].includes('1 处'))
})

test('timingCheckWarnings：ok=true 但漂移 >0.3s 不得漏报（匹配 ok ≠ 无漂移）', () => {
  const warnings = timingCheckWarnings({
    ok: true,
    matched: 2,
    unmatched: 0,
    extraSwitches: 0,
    boundaries: [
      { label: 'a', tableSec: 2, status: 'matched', measuredSec: 2.5, deltaSec: 0.5 },
      { label: 'b', tableSec: 6, status: 'matched', measuredSec: 6.1, deltaSec: 0.1 },
    ],
  })
  assert.equal(warnings.length, 1, '漂移行必须出')
  assert.ok(warnings[0].includes('a'))
  // 全部干净 → 无告警
  assert.equal(timingCheckWarnings({
    ok: true, matched: 1, unmatched: 0, extraSwitches: 0,
    boundaries: [{ label: 'a', tableSec: 2, status: 'matched', measuredSec: 2.1, deltaSec: 0.1 }],
  }).length, 0)
})

test('常量口径：4fps 抽样 + 0.45s 窗 ≈ 漂移 >0.3s 报警', () => {
  assert.equal(TIMING_CHECK_SAMPLE_FPS, 4)
  assert.equal(TIMING_CHECK_TOLERANCE_SEC, 0.45)
  assert.ok(TIMING_CHECK_TOLERANCE_SEC - 1 / TIMING_CHECK_SAMPLE_FPS / 2 >= 0.3, '量化误差后仍覆盖 0.3s 闸口')
})
