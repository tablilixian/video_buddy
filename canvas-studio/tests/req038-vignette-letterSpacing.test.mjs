/**
 * REQ-038 批次 3 守卫：RQ-09 轨级暗角（shape:'vignette' + strength）+ RQ-02 letterSpacing。
 *
 * 验收口径（需求正本 §3）：
 * - RQ-09：11 个镜头可各自设定强度（源工程 0.45–0.7）；全局 `meta.look.vignette`
 *   作为缺省保留；老 manifest 不受影响。
 * - RQ-02：`letterSpacing`（px / em）度量与渲染同源 —— 折行预算与 CSS letter-spacing
 *   消费同一个值（组件 / 体检 / 校验三处同源）；老 manifest 不写 = 不施加。
 * - RQ-02 验收锚点：源片 `-0.022em` 紧排可表达。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateManifest, KNOWN_TRACK_KEYS } from '../lib/remotion/manifest.js'
import { fitTextPolicy, colorWithAlpha } from '../lib/remotion/timing.js'
import { planTextFit } from '../lib/remotion/text-fit-plan.js'

const here = dirname(fileURLToPath(import.meta.url))

function withTrack(track) {
  return {
    id: 'req038-b3-test',
    meta: { title: 'REQ-038 批3', width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#07070f', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 },
      track,
    ],
  }
}

test('RQ-09：vignette + strength 校验放行，11 镜头逐镜头强度可表达', () => {
  for (const strength of [0.45, 0.55, 0.7]) {
    const m = validateManifest(withTrack({ id: `vig-${strength}`, type: 'shape', shape: 'vignette', color: '#000000', strength, box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 }))
    assert.deepEqual(m.errors, [], `strength=${strength} 应放行`)
  }
  // 缺省 strength = 0.5（不写也行）。
  const def = validateManifest(withTrack({ id: 'vig-def', type: 'shape', shape: 'vignette', color: '#000000', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 }))
  assert.deepEqual(def.errors, [])
})

test('RQ-09：strength 越界拒收（0–1 白名单口径）', () => {
  const m = validateManifest(withTrack({ id: 'vig', type: 'shape', shape: 'vignette', color: '#000000', strength: 1.2, startFrame: 0, durationInFrames: 60 }))
  assert.ok(m.errors.some((e) => e.includes('.strength 必须是 0–1')))
})

test('RQ-09：KNOWN_TRACK_KEYS.shape 登记 strength；SHAPES 白名单含 vignette', () => {
  assert.ok(KNOWN_TRACK_KEYS.shape.has('strength'))
  const m = validateManifest(withTrack({ id: 'vig', type: 'shape', shape: 'vignette', color: '#000000', startFrame: 0, durationInFrames: 60 }))
  assert.ok(!m.warnings.some((w) => w.includes('"shape"')), 'vignette 不应触发非法 shape')
})

test('RQ-09：全局 meta.look.vignette 与轨级并存（look 校验不受影响）', () => {
  const m = validateManifest({
    id: 'look-both',
    meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 60, look: { vignette: 0.35 } },
    tracks: [
      { id: 'vig-track', type: 'shape', shape: 'vignette', color: '#000000', strength: 0.6, box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 },
    ],
  })
  assert.deepEqual(m.errors, [])
})

test('RQ-09 ★渲染接线：Shape.tsx 消费 strength 且按源工程口径建渐变', () => {
  const src = readFileSync(join(here, '../src/remotion/components/Shape.tsx'), 'utf8')
  assert.ok(src.includes("'vignette'"), 'vignette 分支必须在')
  assert.ok(src.includes('track.strength ?? 0.5'), 'strength 缺省 0.5')
  assert.ok(src.includes('0.44') && src.includes('1.18 0.88'), '中心 50%/44% + 半径 118%/88% = 源工程口径')
  assert.ok(src.includes('colorWithAlpha'), '边缘色 = color @ strength')
})

test('RQ-02：letterSpacing / letterSpacingEm 校验放行；同时给收 warning（em 优先）', () => {
  const px = validateManifest(withTrack({ id: 'tc', type: 'textCard', variant: 'title', text: '紧排', letterSpacing: -1.9, startFrame: 0, durationInFrames: 60 }))
  assert.deepEqual(px.errors, [])
  const em = validateManifest(withTrack({ id: 'tc', type: 'textCard', variant: 'title', text: '紧排', letterSpacingEm: -0.022, startFrame: 0, durationInFrames: 60 }))
  assert.deepEqual(em.errors, [])
  const both = validateManifest(withTrack({ id: 'tc', type: 'textCard', variant: 'title', text: '紧排', letterSpacing: -1.9, letterSpacingEm: -0.022, startFrame: 0, durationInFrames: 60 }))
  assert.deepEqual(both.errors, [])
  assert.ok(both.warnings.some((w) => w.includes('em 优先')))
})

test('RQ-02：非法字距拒收（|px|>200 / |em|>2）', () => {
  const a = validateManifest(withTrack({ id: 'tc', type: 'textCard', variant: 'title', text: 't', letterSpacing: 500, startFrame: 0, durationInFrames: 60 }))
  assert.ok(a.errors.some((e) => e.includes('.letterSpacing 必须是')))
  const b = validateManifest(withTrack({ id: 'tc', type: 'textCard', variant: 'title', text: 't', letterSpacingEm: -3, startFrame: 0, durationInFrames: 60 }))
  assert.ok(b.errors.some((e) => e.includes('.letterSpacingEm 必须是')))
})

test('RQ-02 ★度量同源：wrapByWidth 折行预算随字距收紧（同文本同宽，正字距提前折行）', () => {
  const text = '一二三四五六七八九十'
  const base = { maxWidthPx: 500, baseFontPx: 50, maxLines: 10 }
  const tight = fitTextPolicy(text, { ...base, letterSpacingPx: 10 })
  const none = fitTextPolicy(text, { ...base })
  // 10px/字 × 10 字 = +100px，必然比无字距多折一行（或同字号下更早折）。
  assert.ok(tight.lines.length > none.lines.length,
    `正字距应更早折行：tight=${tight.lines.length} none=${none.lines.length}`)
})

test('RQ-02 ★度量同源：em 按当前字号折算（字号缩了字距也跟着缩）', () => {
  const text = '一二三四五六七八九十一二三四五六七八九十一二三四五'
  const base = { maxWidthPx: 400, baseFontPx: 100, maxLines: 6 }
  const withEm = fitTextPolicy(text, { ...base, letterSpacingEm: 0.5 })
  // 0.5em = 每字 +50% 宽 ⇒ 每行装的字更少，缩号会更早发生。maxLines=6 下：
  // 无字距缩到 66px（每行 6 字）；带 0.5em 每字 1.5 倍宽，缩到下限 55 仍装不下 6 字。
  const plain = fitTextPolicy(text, { ...base })
  assert.ok(withEm.fontPx < plain.fontPx, `em 字距应驱动更早缩号：${withEm.fontPx} < ${plain.fontPx}`)
})

test('RQ-02：老调用（无字距）行为不变 —— planTextFit 输出不带字距时折行与旧实现一致', () => {
  const plan = planTextFit({ variant: 'title', text: '四季', canvasWidth: 1920, canvasHeight: 1080 })
  assert.equal(plan.fontPx, plan.baseFontPx, '短文本不缩号')
  assert.equal(plan.renderText, '四季', '未溢出 renderText = 原文')
})

test('RQ-02 ★渲染接线：TextCard.tsx 与 text-fit-audit.ts 消费同一份字距', () => {
  const card = readFileSync(join(here, '../src/remotion/components/TextCard.tsx'), 'utf8')
  const audit = readFileSync(join(here, '../src/remotion/text-fit-audit.ts'), 'utf8')
  const planSrc = readFileSync(join(here, '../src/remotion/text-fit-plan.ts'), 'utf8')
  assert.ok(card.includes('track.letterSpacingEm'), '渲染层读 em')
  assert.ok(card.includes('letterSpacing'), '渲染层读 px')
  assert.ok(card.includes('letterSpacingCss'), 'CSS 落点（em 优先）')
  assert.ok(audit.includes('letterSpacingPx') && audit.includes('letterSpacingEm'), '体检传同一份')
  assert.ok(planSrc.includes('letterSpacingPx') && planSrc.includes('letterSpacingEm'), '度量层签名在')
  // timecode 的 HUD 字距硬编码 2 不被破坏。
  assert.ok(card.includes('letterSpacing: 2'), 'timecode 原有字距保留')
})

test('colorWithAlpha：hex / rgb() → rgba；解析失败兜底黑（vignette 安全色）', () => {
  assert.equal(colorWithAlpha('#000000', 0.55), 'rgba(0, 0, 0, 0.55)')
  assert.equal(colorWithAlpha('#fff', 1), 'rgba(255, 255, 255, 1)')
  assert.equal(colorWithAlpha('rgb(20, 30, 40)', 0.5), 'rgba(20, 30, 40, 0.5)')
  assert.equal(colorWithAlpha('not-a-color', 0.6), 'rgba(0, 0, 0, 0.6)')
})
