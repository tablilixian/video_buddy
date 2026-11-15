/**
 * REQ-038 R11-C5 · **分镜渲染决策**（planShotRender）单测。
 *
 * 回退矩阵（每条都是一次「整片路径」的守卫）：
 * - probe/spot 单 / manifest 有 audio 段 ⇒ whole（D3：音频整轨后配 = Phase 1.5）；
 * - 无可用边界（spec 派生失败 + 无 transition）⇒ whole；
 * - 切片后不足 2 段 ⇒ whole；无项目目录 ⇒ whole；
 * - 正常三屏 spec ⇒ shots（段数/hash/缓存目录齐备）。
 *
 * 定向跑：node --test tests/req038-r11-plan-shots.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import { planShotRender } from '../lib/shot-cache.js'
import { boundariesFromSpec } from '../lib/shot-slice.js'

const SPEC = {
  meta: { title: '决策样例', durationSec: 20, fps: 30, autoStages: true },
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

const base = { specBoundaries: boundariesFromSpec(SPEC, 600, 30), quality: 'standard', projectDir: '/tmp/r11-plan', allowShots: true }

test('正常三屏：mode shots，段数 3、hash 3、缓存目录在 build/shot-cache', () => {
  const plan = planShotRender(manifestWith(undefined), base)
  assert.equal(plan.mode, 'shots')
  assert.equal(plan.segments.length, 3)
  assert.equal(plan.hashes.length, 3)
  assert.match(plan.cacheDir, /build[\\/]shot-cache$/)
  for (const h of plan.hashes) assert.match(h, /^[0-9a-f]{16}$/)
})

test('有 audio 段 ⇒ whole（D3：音频整轨后配 = Phase 1.5）', () => {
  const plan = planShotRender(manifestWith({ bgmUrl: '/x.mp3' }), { ...base, allowShots: false })
  assert.equal(plan.mode, 'whole')
  assert.match(plan.reason, /音频/)
})

test('probe/spot 单 ⇒ whole（allowShots false）', () => {
  const plan = planShotRender(manifestWith(undefined), { ...base, allowShots: false })
  assert.equal(plan.mode, 'whole')
})

test('无可用边界（spec 派生失败 + 无 transition）⇒ whole', () => {
  const bare = { ...manifestWith(undefined), tracks: manifestWith(undefined).tracks.filter((t) => t.type !== 'transition') }
  const plan = planShotRender(bare, { ...base, specBoundaries: null })
  assert.equal(plan.mode, 'whole')
  assert.match(plan.reason, /无可用边界/)
})

test('切片后不足 2 段 ⇒ whole（单段不值得走分镜）', () => {
  // 无 spec 边界 + 无 transition ⇒ 回退单段 ⇒ 单段不值得走分镜
  const bare = { ...manifestWith(undefined), tracks: manifestWith(undefined).tracks.filter((t) => t.type !== 'transition') }
  // spec 边界为空 + 无 transition ⇒ fallback-single ⇒ 整片回退（单段不值得走分镜）
  const plan = planShotRender(bare, { ...base, specBoundaries: [] })
  assert.equal(plan.mode, 'whole')
  assert.match(plan.reason, /无可用边界/)
})

test('无项目目录 ⇒ whole（首页态 fail-safe）', () => {
  const plan = planShotRender(manifestWith(undefined), { ...base, projectDir: null })
  assert.equal(plan.mode, 'whole')
  assert.match(plan.reason, /项目目录/)
})

test('hash 随质量档变化（quality 进 hash 输入）', () => {
  const p1 = planShotRender(manifestWith(undefined), base)
  const p2 = planShotRender(manifestWith(undefined), { ...base, quality: 'high' })
  assert.notDeepEqual(p1.hashes, p2.hashes)
})
