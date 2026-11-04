/**
 * animate 窗口校验表测（2026-11-04 · 科普 0.1 验收事故沉淀）。
 *
 * 钉住三件事：
 * ① **反向变异靶** —— 真实事故 manifest（`s2_callout`：`animate.startFrame=31` +
 *    `durationInFrames=1` 配 32 帧轨）必须被判为 error，且错误文案**指名道姓**指向
 *    `s2_callout` 与"整层永久不可见"；把它改好，测试必须转红。
 * ② 三条判据的边界（越界段 / 段尾越界 / 正常段 / 单帧段不误报）。
 * ③ **零误报** —— 合法 manifest 不得因为本组判据多出任何 error。
 *
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/manifest-animate-window.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../lib/remotion/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

/** 单轨 manifest 外壳（meta 够用即可，判据只看轨）。 */
function manifestWith(tracks, durationInFrames = 300) {
  return {
    id: 'comp-aw',
    meta: { title: 'animate 窗口', width: 1920, height: 1080, fps: 30, durationInFrames },
    tracks,
  }
}

/** 一条普通 textCard 轨（合法基线）。 */
function card(overrides = {}) {
  return {
    id: 'card', type: 'textCard', variant: 'subtitle', text: 'x',
    startFrame: 0, durationInFrames: 100,
    ...overrides,
  }
}

// ─────────────────── ① 反向变异靶（真实事故 manifest）───────────────────

test('反向变异靶：真实 s2_callout 轨必须报错且指名指向该轨', () => {
  const manifest = JSON.parse(read('tests/fixtures/animate-window/real-s2-callout.json'))
  const r = validateManifest(manifest)
  assert.equal(r.ok, false, '这份 manifest 带着 A4 事故，必须判不通过')
  const hit = r.errors.filter((e) => e.includes('s2_callout'))
  assert.equal(hit.length, 1, `应恰好一条错误指向 s2_callout，实际 ${JSON.stringify(r.errors)}`)
  assert.match(hit[0], /整层永久不可见/, '错误文案要说清是"整层不可见"而不是泛泛的数值非法')
  assert.match(hit[0], /tracks\[0\]/, '错误文案要带轨下标，便于定位')
})

test('反向变异靶：真实成片 manifest 现在必须无 animate 窗口类错误；把 A4 事故注回去必须恰好报 s2_callout 一处', () => {
  const real = '/Users/wl/Desktop/job/VideoOut/new222/projects/用 code-driven-explai/build/manifest.json'
  if (!existsSync(real)) return  // 本机没有该产物时跳过（CI 不依赖外部目录）
  const manifest = JSON.parse(readFileSync(real, 'utf8'))

  // ① 修好之后（2026-11-04 P10a：s2_callout 的 animate 改回轨内相对帧）：
  //    真实成片 manifest 不得再有本组判据的错误 —— 既证修复生效，也证零误报。
  const now = validateManifest(manifest)
  const animateErrs = now.errors.filter((e) => /永不命中|整层永久不可见|越出轨道|轨内相对帧/u.test(e))
  assert.deepEqual(animateErrs, [], '修好后真实 manifest 不应再有 animate 窗口类错误')

  // ② 反向变异：把 A4 事故（注回 31/1 的越界淡入）注回同一条轨 ⇒ 必须恰好报这一处。
  const broken = JSON.parse(JSON.stringify(manifest))
  const callout = broken.tracks.find((t) => t.id === 's2_callout')
  assert.ok(callout, '真实 manifest 里应还有 s2_callout 轨')
  callout.animate = { from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 31, durationInFrames: 1 }
  const r = validateManifest(broken)
  assert.equal(r.ok, false, '注回 A4 事故后必须判不通过')
  const ours = r.errors.filter((e) => e.includes('s2_callout'))
  assert.equal(ours.length, 1, `应恰好一条错误指向 s2_callout，实际 ${JSON.stringify(r.errors)}`)
  assert.match(ours[0], /整层永久不可见/)
  // 零误报：本组判据不得在 61 轨的真实 manifest 上多报别的轨。
  const unrelated = r.errors.filter((e) => !e.includes('s2_callout'))
  assert.deepEqual(unrelated, [], '除 s2_callout 外不得有其它 error')
})

// ─────────────────── ② 三条判据的边界 ───────────────────

test('① 段整段落在轨外（startFrame ≥ 轨长）⇒ error', () => {
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 32, animate: { from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 40, durationInFrames: 8 } }),
  ]))
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /永不命中/)
  assert.match(r.errors.join('\n'), /轨内相对帧/)
})

test('② 段尾越出轨尾 ⇒ warning（不断言）', () => {
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 94, animate: { from: { scale: 0.994 }, to: { scale: 1.006 }, startFrame: 68, durationInFrames: 28 } }),
  ]))
  assert.equal(r.ok, true, '段尾被截断是良性场景，不阻断渲染')
  assert.match(r.warnings.join('\n'), /越出轨尾 2 帧/)
})

test('③ 整层永久不可见 ⇒ error', () => {
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 32, animate: { from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 31, durationInFrames: 1 } }),
  ]))
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /整层永久不可见/)
  assert.match(r.errors.join('\n'), /全程读到 0/)
})

// ─────────────────── ③ 零误报 ───────────────────

test('零误报：正常淡入段不报', () => {
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 100, animate: { from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 0, durationInFrames: 20 } }),
  ]))
  assert.equal(r.ok, true, r.errors.join('；'))
  assert.deepEqual(r.errors, [])
})

test('零误报：单帧段但 from.opacity 非 0 ⇒ 不报"整层不可见"', () => {
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 32, animate: { from: { opacity: 1 }, to: { opacity: 1 }, startFrame: 31, durationInFrames: 1 } }),
  ]))
  assert.equal(r.ok, true, r.errors.join('；'))
})

test('零误报：淡入段只覆盖轨尾但尾部仍有可见帧 ⇒ 不报', () => {
  // startFrame=10 + dur=1：帧 10 的 progress=0，但 11 帧起 hold 末段终点 1 ⇒ 可见。
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 32, animate: { from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 10, durationInFrames: 1 } }),
  ]))
  assert.equal(r.ok, true, r.errors.join('；'))
})

test('零误报：只动 scale 的轨与"整层不可见"无关', () => {
  const r = validateManifest(manifestWith([
    card({ durationInFrames: 100, animate: { from: { scale: 0.3 }, to: { scale: 1 } } }),
  ]))
  assert.equal(r.ok, true, r.errors.join('；'))
})

test('零误报：无 animate 的轨不受影响', () => {
  const r = validateManifest(manifestWith([card({ durationInFrames: 100 })]))
  assert.equal(r.ok, true, r.errors.join('；'))
})
