/**
 * OPT-13+14（2026-10-26）：素材落位预对账单测（反向变异靶）。
 *
 * 渲染链的分辨率核对（checkManifestResolution）早已有；本组是**落位时**的
 * 预对账 —— 面积比估上采样（方向无关）+ 时长对分镜窗口（双向）。删掉
 * resolution-check.ts 里任一分支，对应 test 必红。
 *
 * 直连 Host tsc 编译产物 lib/remotion/resolution-check.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/placement-preflight.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  placementResolutionWarning,
  placementDurationWarning,
  DELIVERY_BASELINE,
  checkManifestResolution,
} from '../lib/remotion/resolution-check.js'

test('placementResolutionWarning：864×480 素材 → 报 ~1.49× 上采样 + 决策点', () => {
  const note = placementResolutionWarning(864, 480)
  assert.ok(note !== null, '低于 720p 基线的素材必须报')
  assert.match(note, /864×480/)
  assert.match(note, /1\.49×/)
  assert.match(note, /决策点/, '必须给可执行的决策点，不是一句抱怨')
})

test('placementResolutionWarning：方向无关 —— 480×854 竖片同样报 ~1.50×', () => {
  const note = placementResolutionWarning(480, 854)
  assert.ok(note !== null, '按面积比判，竖屏低清素材不能漏')
  assert.match(note, /1\.50×/)
})

test('placementResolutionWarning：达标素材不报（736p / 1080p / 640×360 草稿档）', () => {
  assert.equal(placementResolutionWarning(1280, 736), null, '736p ≥ 720p 基线')
  assert.equal(placementResolutionWarning(1920, 1080), null)
  assert.equal(placementResolutionWarning(0, 0), null, '非法尺寸放行（探测失败回退场景）')
  assert.equal(placementResolutionWarning(Number.NaN, 720), null)
})

test('placementDurationWarning：素材短于窗口 → 报覆盖缺口', () => {
  const note = placementDurationWarning(4.0, 5.0)
  assert.ok(note !== null)
  assert.match(note, /覆盖不了/)
  assert.match(note, /1\.00s/)
  assert.match(note, /决策点/)
})

test('placementDurationWarning：素材长于窗口 → 报裁切/溶解提示', () => {
  const note = placementDurationWarning(5.5, 4.0)
  assert.ok(note !== null)
  assert.match(note, /长 1\.50s/)
})

test('placementDurationWarning：容差内（H3 量化尾数）不报', () => {
  // CV-140：请求 5s → 实测 5.167s，容差 0.6s 内不动。
  assert.equal(placementDurationWarning(5.167, 5), null)
  assert.equal(placementDurationWarning(5, 5), null)
  assert.equal(placementDurationWarning(Number.NaN, 5), null)
})

test('DELIVERY_BASELINE 与渲染链核对共存：render 侧 quality 感知判定不受影响', () => {
  // 渲染链仍是权威核对（质量档感知）；落位预对账只是把发现时机前移。
  // 这里钉住两者口径不互相干扰：640×360 草稿素材在 draft 档不报、在 final 档报。
  const manifest = {
    id: 'comp-1',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 90 },
    tracks: [{ id: 'v1', type: 'video', src: '/canvas-studio/assets/p1/a.mp4', startFrame: 0, durationInFrames: 90 }],
    audio: {},
  }
  const sizes = { '/canvas-studio/assets/p1/a.mp4': { width: 640, height: 360 } }
  assert.deepEqual(checkManifestResolution(manifest, sizes, 'draft'), [], 'draft 半分辨率下不该误报')
  assert.equal(checkManifestResolution(manifest, sizes, 'final').length, 1, 'final 档必须报上采样')
  assert.equal(DELIVERY_BASELINE.width, 1280)
})
