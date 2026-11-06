/**
 * CV-447（P1-C）：spot-check 结构帧 ∪ agent 自选。
 *
 * 事故签名：19 轮 spotFrames 从 8 帧收窄到单点，漏掉 222 帧「双地球」（场景 2 在 214
 * 帧入场）与 0 帧空画面。结构帧必须每次都看，不能被自选的 8 个中段帧挤掉。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withStructuralSpotFrames } from '../lib/remotion/spot-frames.js'

/** 最小 manifest：两轨，场景边界可预测。 */
function manifestOf(durationInFrames, tracks) {
  return { meta: { durationInFrames, fps: 30 }, tracks }
}

test('P1-C：0 帧与末帧必在集合内（即使 agent 自选塞满 8 个）', () => {
  const manifest = manifestOf(600, [])
  const picked = withStructuralSpotFrames(manifest, [30, 60, 90, 120, 150, 180, 210, 240])
  assert.ok(picked.includes(0), '0 帧空画面必须查')
  assert.ok(picked.includes(599), '末帧收尾必须查')
  assert.equal(picked.length, 8)
})

test('P1-C：场景起止 ±2 并入，且不超过 8 帧', () => {
  const manifest = manifestOf(600, [
    { startFrame: 214, durationInFrames: 60 },
    { startFrame: 380, durationInFrames: 90 },
  ])
  const picked = withStructuralSpotFrames(manifest, [])
  assert.ok(picked.includes(212), '入场前 2 帧（场景 2 在 214 入场）')
  assert.ok(picked.includes(214), '入场帧')
  assert.ok(picked.includes(216), '入场后 2 帧')
  assert.ok(picked.length <= 8, '仍受 8 帧上限')
})

test('P1-C：越界帧钳到片长内、非法值丢弃', () => {
  const manifest = manifestOf(100, [{ startFrame: 99, durationInFrames: 5 }])
  const picked = withStructuralSpotFrames(manifest, [-10, 999, Number.NaN])
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b), '升序返回')
  assert.ok(picked.every((f) => f >= 0 && f <= 99), '全部在片长内')
})
