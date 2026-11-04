/**
 * P3（2026-11-03）：`callout` 引线标注轨 + `BaseTrack.reveal` 分区揭示。
 *
 * 钉住四件事：① `validateManifest` 对 callout 的校验（anchor / box 必填、text 上限、
 * line 白名单）；② reveal 校验（kind 白名单、direction、正整数时长、spotlight 的
 * direction 告警）；③ `revealClipAt` 纯函数的分段语义（全遮 → 动画 → 恒等、四种
 * wipe 方向的 inset 朝向）；④ 契约文档同步（manifest-contract.md / shot-cards.md）。
 *
 * 直连 Host tsc 编译产物 lib/remotion/*.js。
 * 定向跑：node --test tests/remotion-callout-reveal.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../lib/remotion/manifest.js'
import { revealClipAt, revealClipWithOut } from '../lib/remotion/reveal.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

/** 一份单内容轨的合法基线（type 由用例决定）。 */
function baseManifest(track) {
  return {
    id: 'comp-p3',
    meta: { title: 'P3 测试', width: 1280, height: 720, fps: 30, durationInFrames: 120 },
    tracks: [track],
  }
}

function calloutTrack(overrides = {}) {
  return {
    id: 'co1', type: 'callout', startFrame: 0, durationInFrames: 90,
    anchor: { x: 62, y: 40 }, box: { x: 30, y: 30, w: 22, h: 9 }, text: '日冕层温度反超光球',
    ...overrides,
  }
}

const ok = (r) => assert.equal(r.ok, true, r.errors.join('；'))

// ─────────────────────────── callout 校验 ───────────────────────────

test('callout：合法轨通过，无 error', () => {
  const r = validateManifest(baseManifest(calloutTrack()))
  ok(r)
  assert.deepEqual(r.errors, [])
})

test('callout：缺 box / 坏 anchor / 空 text / 坏 line 全部拒收', () => {
  const r1 = validateManifest(baseManifest(calloutTrack({ box: undefined })))
  assert.equal(r1.ok, false)
  assert.ok(r1.errors.some((e) => e.includes('必须给 box')))

  const r2 = validateManifest(baseManifest(calloutTrack({ anchor: { x: 150, y: 40 } })))
  assert.equal(r2.ok, false)
  assert.ok(r2.errors.some((e) => e.includes('.anchor')))

  const r3 = validateManifest(baseManifest(calloutTrack({ text: '' })))
  assert.equal(r3.ok, false)
  assert.ok(r3.errors.some((e) => e.includes('.text')))

  const r4 = validateManifest(baseManifest(calloutTrack({ line: 'wavy' })))
  assert.equal(r4.ok, false)
  assert.ok(r4.errors.some((e) => e.includes('.line 只允许 elbow / straight')))
})

test('callout：text 超 80 字符拒收；transition 轨给 box 仍拒收（口径未放宽）', () => {
  const r = validateManifest(baseManifest(calloutTrack({ text: '长'.repeat(81) })))
  assert.equal(r.ok, false)
  const r2 = validateManifest(baseManifest({ id: 't0', type: 'transition', startFrame: 0, durationInFrames: 30, effect: 'fade', fromTrackId: 'a', toTrackId: 'b', box: { x: 50, y: 50, w: 20, h: 20 } }))
  assert.equal(r2.ok, false)
  assert.ok(r2.errors.some((e) => e.includes('.box')))
})

test('callout：契约外字段告警扫 anchor 子键（anchor.z → warning）', () => {
  const track = calloutTrack()
  track.anchor = { x: 50, y: 50, z: 3 }
  const r = validateManifest(baseManifest(track))
  ok(r)
  assert.ok(r.warnings.some((w) => w.includes('.anchor 含契约外字段 "z"')))
})

// ─────────────────────────── reveal 校验 ───────────────────────────

test('reveal：wipe / spotlight 合法配置通过', () => {
  const r = validateManifest(baseManifest(calloutTrack({ reveal: { kind: 'wipe', direction: 'up', durationInFrames: 24 } })))
  ok(r)
  const r2 = validateManifest(baseManifest(calloutTrack({ reveal: { kind: 'spotlight', center: { x: 30, y: 70 } } })))
  ok(r2)
})

test('reveal：坏 kind / 坏 direction / 非整数时长拒收；spotlight + direction 告警', () => {
  const r1 = validateManifest(baseManifest(calloutTrack({ reveal: { kind: 'iris' } })))
  assert.equal(r1.ok, false)
  assert.ok(r1.errors.some((e) => e.includes('reveal.kind 只允许 wipe / spotlight')))

  const r2 = validateManifest(baseManifest(calloutTrack({ reveal: { kind: 'wipe', direction: 'diagonal' } })))
  assert.equal(r2.ok, false)
  assert.ok(r2.errors.some((e) => e.includes('reveal.direction')))

  const r3 = validateManifest(baseManifest(calloutTrack({ reveal: { kind: 'wipe', durationInFrames: 2.5 } })))
  assert.equal(r3.ok, false)
  assert.ok(r3.errors.some((e) => e.includes('reveal.durationInFrames')))

  const r4 = validateManifest(baseManifest(calloutTrack({ reveal: { kind: 'spotlight', direction: 'left' } })))
  ok(r4)
  assert.ok(r4.warnings.some((w) => w.includes('direction 只对 wipe 生效')))
})

test('reveal：transition 轨给 reveal 只告警不拒收', () => {
  const r = validateManifest({
    id: 'comp-p3b',
    meta: { title: 'P3 测试', width: 1280, height: 720, fps: 30, durationInFrames: 120 },
    tracks: [
      { id: 'a', type: 'shape', shape: 'rect', color: '#333333', startFrame: 0, durationInFrames: 120 },
      { id: 'b', type: 'shape', shape: 'rect', color: '#444444', startFrame: 30, durationInFrames: 90 },
      { id: 't0', type: 'transition', startFrame: 20, durationInFrames: 20, effect: 'fade', fromTrackId: 'a', toTrackId: 'b', reveal: { kind: 'wipe' } },
    ],
  })
  ok(r)
  assert.ok(r.warnings.some((w) => w.includes('transition 轨（自身不可见）')))
})

// ─────────────────────────── revealClipAt 纯函数 ───────────────────────────

test('revealClipAt：startFrame 前全遮，走完后恒等（空串）', () => {
  const wipe = { kind: 'wipe', startFrame: 10, durationInFrames: 20 }
  assert.equal(revealClipAt(wipe, 0), 'inset(0 100% 0 0)')
  assert.equal(revealClipAt(wipe, 9), 'inset(0 100% 0 0)')
  assert.equal(revealClipAt(wipe, 30), '')
  assert.equal(revealClipAt(wipe, 999), '')
})

test('revealClipAt：wipe 四方向的 inset 朝向各就各位（p=0.5 精确值）', () => {
  // easeOutCubic(0.5) = 0.875 → remaining = 12.5%
  const mid = { kind: 'wipe', startFrame: 0, durationInFrames: 20 }
  assert.equal(revealClipAt({ ...mid, direction: 'right' }, 10), 'inset(0 12.500% 0 0)')
  assert.equal(revealClipAt({ ...mid, direction: 'left' }, 10), 'inset(0 0 0 12.500%)')
  assert.equal(revealClipAt({ ...mid, direction: 'down' }, 10), 'inset(0 0 12.500% 0)')
  assert.equal(revealClipAt({ ...mid, direction: 'up' }, 10), 'inset(12.500% 0 0 0)')
  // 缺省方向 = right；缺省时长 = 18 帧（10/18 → eased 0.91221 → remaining 8.779%）
  assert.equal(revealClipAt({ kind: 'wipe' }, 10), 'inset(0 8.779% 0 0)')
})

test('revealClipAt：spotlight 圆心与半径按帧扩出，center 落进 clip 串', () => {
  const spot = { kind: 'spotlight', center: { x: 30, y: 70 }, startFrame: 0, durationInFrames: 20 }
  const before = revealClipAt(spot, -1)
  assert.equal(before, 'circle(0% at 30% 70%)')
  const at = revealClipAt(spot, 10)
  // eased(0.5)=0.875 → 半径 = 0.875 × 85 = 74.375%
  assert.match(at, /^circle\(74\.375% at 30\.000% 70\.000%\)$/)
  // 无 center 缺省 50/50
  assert.match(revealClipAt({ kind: 'spotlight' }, 5), /at 50\.000% 50\.000%\)$/)
})

// ─────────────────── 2026-11-04 · P2 退场擦除 `reveal.out` ───────────────────
//
// 事故（科普 0.1 验收 A5）：右面板要"右 wipe 出"，但 `direction` 是**进场**方向，
// 而 `exit` 不支持 clip 退场 ⇒ "朝某侧擦出去"没有表达手段，Agent 只能写
// `direction:"right"` ⇒ 视觉正好相反（面板自左向右展开，而不是向右退去）。

test('reveal.out：合法配置通过；坏 direction / 坏时长 / 坏 gap 拒收', () => {
  const okr = validateManifest(baseManifest(calloutTrack({
    reveal: { kind: 'wipe', direction: 'right', durationInFrames: 24, out: { direction: 'right', durationInFrames: 20, gapFrames: 4 } },
  })))
  ok(okr)

  const badDir = validateManifest(baseManifest(calloutTrack({
    reveal: { kind: 'wipe', out: { direction: 'diagonal' } },
  })))
  assert.ok(badDir.errors.some((e) => e.includes('reveal.out.direction')))

  const badDur = validateManifest(baseManifest(calloutTrack({
    reveal: { kind: 'wipe', out: { direction: 'right', durationInFrames: 2.5 } },
  })))
  assert.ok(badDur.errors.some((e) => e.includes('reveal.out.durationInFrames')))

  const badGap = validateManifest(baseManifest(calloutTrack({
    reveal: { kind: 'wipe', out: { direction: 'right', gapFrames: -1 } },
  })))
  assert.ok(badGap.errors.some((e) => e.includes('reveal.out.gapFrames')))
})

test('reveal.out：spotlight 只告警不拒收（退场擦除只对 wipe 生效）', () => {
  const r = validateManifest(baseManifest(calloutTrack({
    reveal: { kind: 'spotlight', out: { direction: 'right' } },
  })))
  ok(r)
  assert.ok(r.warnings.some((w) => w.includes('退场擦除 out 只对 wipe 生效')))
})

test('revealClipWithOut：无 out 时与 revealClipAt 逐字一致（老 manifest 逐像素不变）', () => {
  const wipe = { kind: 'wipe', direction: 'right', startFrame: 10, durationInFrames: 20 }
  for (const f of [0, 9, 10, 15, 29, 30, 999]) {
    assert.equal(revealClipWithOut(wipe, f, 200), revealClipAt(wipe, f), `frame ${f}`)
  }
})

test('revealClipWithOut：退场擦除锚在轨尾，方向与进场方向口径相反', () => {
  const base = { kind: 'wipe', direction: 'right', startFrame: 0, durationInFrames: 20 }
  const outRight = { ...base, out: { direction: 'right', durationInFrames: 20 } }
  const outLeft = { ...base, out: { direction: 'left', durationInFrames: 20 } }
  const TRACK = 100
  // 退场起点 = 轨长 - 退场时长 = 80
  // 内容向右退去 ⇒ 遮**左**侧（left inset 0 → 100）
  assert.equal(revealClipWithOut(outRight, 79, TRACK), '')
  // frame 90 ⇒ progress = 10/20 = 0.5 ⇒ easeOutCubic(0.5) = 0.875 ⇒ 遮 87.5%
  assert.match(revealClipWithOut(outRight, 90, TRACK), /^inset\(0\.000% 0\.000% 0\.000% 87\.500%\)$/)
  assert.match(revealClipWithOut(outRight, 99, TRACK), /^inset\(0\.000% 0\.000% 0\.000% 99\.987%\)$/)
  // 内容向左退去 ⇒ 遮**右**侧
  assert.match(revealClipWithOut(outLeft, 90, TRACK), /^inset\(0\.000% 87\.500% 0\.000% 0\.000%\)$/)
})

test('revealClipWithOut：进场遮蔽与退场遮蔽按「每侧取大」合成', () => {
  // 进场方向 left（遮左）+ 退场方向 right（遮左）⇒ 同侧遮蔽取大
  const both = { kind: 'wipe', direction: 'left', startFrame: 0, durationInFrames: 20, out: { direction: 'right', durationInFrames: 20 } }
  const clip = revealClipWithOut(both, 90, 100)
  assert.match(clip, /^inset\(0\.000% 0\.000% 0\.000% 87\.500%\)$/)
})

test('语义告警：揭示方向指向本卡所在侧 ⇒ 提示这是进场方向、退出请用 out', () => {
  // 右半边的卡 + direction:'right' ⇒ 同侧 ⇒ 告警
  const rRight = validateManifest(baseManifest(calloutTrack({
    box: { x: 74, y: 48, w: 44, h: 60 },
    reveal: { kind: 'wipe', direction: 'right' },
  })))
  ok(rRight)
  assert.ok(rRight.warnings.some((w) => w.includes('进场') && w.includes('reveal.out.direction')))

  // 左半边的卡 + direction:'right' ⇒ 异侧 ⇒ 不告警
  const rLeft = validateManifest(baseManifest(calloutTrack({
    box: { x: 26, y: 48, w: 44, h: 60 },
    reveal: { kind: 'wipe', direction: 'right' },
  })))
  ok(rLeft)
  assert.equal(rLeft.warnings.filter((w) => w.includes('reveal.out.direction')).length, 0)
})

// ─────────────────────────── 文档对码 ───────────────────────────

test('契约文档同步：manifest-contract.md 有 callout 节与 reveal 字段行', () => {
  const doc = read('skills/code-driven-explainer/references/manifest-contract.md')
  assert.ok(doc.includes('### `callout`（引线标注'))
  assert.ok(doc.includes('`reveal`（可选，P3'))
  assert.ok(doc.includes('shape / chart / callout 生效'))
})

test('缺口清单同步：shot-cards.md 标注 callout / reveal 解锁', () => {
  const doc = read('skills/code-driven-explainer/references/shot-cards.md')
  assert.ok(doc.includes('`callout` 轨'))
  assert.ok(doc.includes('`BaseTrack.reveal`'))
})
