/**
 * REQ-038 R11-C5 · **分镜渲染决策**（planShotRender）单测。
 *
 * 回退矩阵（每条都是一次「整片路径」的守卫）：
 * - probe/spot 单 / 带 video 轨（原生声找不回）⇒ whole；
 * - 无可用边界（spec 派生失败 + 无 transition）⇒ whole；
 * - 切片后不足 2 段 ⇒ whole；无项目目录 ⇒ whole；
 * - 正常三屏 spec ⇒ shots（段数/hash/缓存目录齐备）。
 *
 * **2026-11-27 口径变更（P0-2）**：`manifest.audio` 本身不再是回退理由。
 * 旧口径「有 audio ⇒ whole」是因为分镜链路缺最后一步混音，于是「挂了旁白」这个最基本
 * 情形被迫整片重渲（改一屏 68–150s，而段补渲 5–15s，真机会话 12 次整片渲染 820s）。
 * 现在拼接后由 `muxManifestAudio` 补整轨混音 ⇒ 纯代码/图文片带旁白也走分镜。
 * 唯一例外是**画面里有 video 轨**：它的原生声在段渲染 mute 之后就找不回来，仍整片渲。
 *
 * 定向跑：node --test tests/req038-r11-plan-shots.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import { planShotRender } from '../lib/shot-cache.js'
import { boundariesFromSpec } from '../lib/shot-slice.js'
import { audioCompatibleWithShots } from '../lib/manifest-audio-mux.js'

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
  // P1-2：全局态指纹随 plan 下发（调用方三方共用同一把缓存钥匙）。
  assert.equal(typeof plan.globals, 'string')
  assert.ok(plan.globals.length > 0)
})

test('P0-2：带 audio 但无 video 轨 ⇒ 仍走 shots（混音在拼接后补，不再整片重渲）', () => {
  const plan = planShotRender(manifestWith({ bgmUrl: '/x.mp3' }), base)
  assert.equal(plan.mode, 'shots')
  assert.equal(plan.segments.length, 3)
  // 判据是「有没有 video 轨」，不是「有没有 audio」。
  assert.equal(audioCompatibleWithShots(manifestWith({ bgmUrl: '/x.mp3' })), true)
  assert.equal(audioCompatibleWithShots(manifestWith(undefined)), true)
})

test('P0-2：带 audio + 有 video 轨 ⇒ 判据拒绝分镜（原生声在段渲染静音后找不回）', () => {
  const withVideo = manifestWith({ bgmUrl: '/x.mp3' })
  withVideo.tracks = [
    ...withVideo.tracks,
    { id: 'clip', type: 'video', src: '/assets/p/abc.mp4', box: { x: 0, y: 0, w: 100, h: 100 }, startFrame: 0, durationInFrames: 600 },
  ]
  assert.equal(audioCompatibleWithShots(withVideo), false)
  // 调用方据此传 allowShots:false ⇒ 回退整片，且回执说清是 video 轨而非 audio。
  const plan = planShotRender(withVideo, { ...base, allowShots: audioCompatibleWithShots(withVideo) })
  assert.equal(plan.mode, 'whole')
  assert.match(plan.reason, /video 轨/)
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
