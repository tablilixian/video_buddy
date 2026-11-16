/**
 * R11（2026-11-16）· **盒高进排版预算** —— 竖屏格位投影把 box 压扁后的裁字根因。
 *
 * ## 病史（真机 100 分钟零出片的两个根因之一）
 *
 * 9:16 竖屏 + spec 格位投影后，标题轨 box 是 `{w:76, h:7.2}`
 * （= cell `h:24` × A1 卡内 title 的 30%）。旧实现**只用盒宽**定字号：
 * 1080×1920 上 `84 × 1.778 = 149px`、行高 1.15 ⇒ 每行 171px，而盒高只有
 * `7.2% × 1920 = 138px` ⇒ 一行都放不下，被层的 `overflow:hidden` 一刀裁掉。
 * 宽度那边怎么缩号都救不了纵向 —— 这是「竖屏只改画幅」补不上的第二层缺口。
 *
 * ## 本文件钉六件事
 *
 * ① 竖屏 138px 盒：字号被压到放得下 1 行，**不溢出**，`heightLimited` 为真；
 * ② 横屏 `{w:76, h:30}`：**逐字段不变**（84 / 2 行 / heightLimited=false）—— 回归纪律；
 * ③ 真实模板 `three-cards` 的 bullets 盒（h:18 = 194px / 2 条）：48px 不变、零告警；
 * ④ 矮盒里的 bullets **不许丢内容**（4 条仍是 4 行，只降字号）；
 * ⑤ 盒低到连下限字号都放不下 ⇒ 仍报 `overflow`（不静默）；
 * ⑥ 回执接线：`validateManifest` 的 warnings 里出现「盒高只有」，横屏干净样例零噪音。
 *
 * 直连 Host tsc 产物 `lib/**`（改过 `src/` 必须先 `npx tsc -p tsconfig.json`）。
 * 定向跑：node --test tests/req038-r11-vertical-fit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BULLETS_BASE_FONT_PX,
  planTextFit,
  textFitHeightLimitWarning,
  TITLE_BASE_FONT_PX,
  TITLE_LINE_HEIGHT,
} from '../lib/remotion/text-fit-plan.js'
import { auditTextFit, textFitWarnings } from '../lib/remotion/text-fit-audit.js'
import { fitTextPolicy } from '../lib/remotion/timing.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { scaffoldFromSpec } from '../lib/host-tools-spec.js'

/** 竖屏 1080×1920。 */
const VERT = { canvasWidth: 1080, canvasHeight: 1920 }
/** 横屏设计基准 1920×1080。 */
const LAND = { canvasWidth: 1920, canvasHeight: 1080 }

/** 真机那一条：cell {x:50,y:22,w:100,h:24} 投影出来的 title box。 */
const VERT_TITLE_BOX = { x: 50, y: 21.04, w: 76, h: 7.2 }

function titleOf(text, box, canvas) {
  return planTextFit({ variant: 'title', text, box, ...canvas })
}

test('R11-盒高：竖屏 7.2% 的 title 盒 ⇒ 压到放得下 1 行，且不裁字', () => {
  // 盒高 138px，一行 1.15 行高 ⇒ 上限 120px；宽度 820px 再压一档。
  const plan = titleOf('量化基金 散户', VERT_TITLE_BOX, VERT)
  assert.equal(plan.overflow, false, '竖屏标题必须不再溢出（旧实现 149px/行 > 138px 盒高）')
  assert.equal(plan.lines.length, 1)
  assert.equal(plan.heightLimited, true, '这次降号的起因是盒高，必须如实标出来')
  assert.ok(plan.fontPx < plan.baseFontPx, `字号必须真的降下来（实际 ${plan.fontPx} / 基准 ${plan.baseFontPx}）`)
  const needed = plan.fontPx * TITLE_LINE_HEIGHT
  assert.ok(needed <= 138.24, `一行实际需要 ${needed.toFixed(1)}px，盒高只有 138.24px`)
})

test('R11-盒高：横屏标准 title 盒逐字段不变（回归纪律）', () => {
  const plan = titleOf('量化基金 散户', { x: 50, y: 46, w: 76, h: 30 }, LAND)
  assert.equal(plan.baseFontPx, TITLE_BASE_FONT_PX, '1080p 设计基准字号不许被盒高改动')
  assert.equal(plan.fontPx, TITLE_BASE_FONT_PX)
  assert.equal(plan.maxLines, 2)
  assert.equal(plan.heightLimited, false, '盒高够用时不许报「被盒高压过」')
  assert.equal(plan.overflow, false)
})

test('R11-盒高：真实模板 three-cards 的 bullets 盒（194px / 2 条）零变化零告警', () => {
  const plan = planTextFit({
    variant: 'bullets',
    text: ['量化基金：规则先写死', '按信号执行'],
    box: { x: 50, y: 48, w: 56, h: 18 },
    ...LAND,
  })
  assert.equal(plan.fontPx, BULLETS_BASE_FONT_PX, '194px 盒放得下 2 条 48px，不许降号')
  assert.equal(plan.overflow, false)
  assert.equal(plan.heightLimited, false, '这条盒本来就不矮，报「被压过」就是噪音（模板测试会红）')
})

test('R11-盒高：矮盒里的 bullets 只降号，不许吞条目', () => {
  const items = ['量化基金：规则先写死', '按信号执行', '散户：临场决定', '看心情执行']
  const plan = planTextFit({
    variant: 'bullets',
    text: items,
    box: { x: 44, y: 63.12, w: 64, h: 25.76 },
    ...VERT,
  })
  assert.equal(plan.lines.length, items.length, '内容比字号重要：4 条必须还是 4 行')
  assert.equal(plan.overflow, false)
  assert.ok(plan.fontPx < plan.baseFontPx, `竖屏基准号 48×1.778≈85，实际降到了 ${plan.fontPx}`)
  assert.equal(plan.heightLimited, true)
})

test('R11-盒高：盒低到下限字号也放不下 ⇒ 仍然报 overflow（不静默）', () => {
  const plan = titleOf('量化基金 散户 为什么涨了也拿不住', { x: 50, y: 50, w: 20, h: 1.2 }, VERT)
  assert.equal(plan.heightLimited, true)
  assert.equal(plan.overflow, true, '压不下去时必须明说会裁，而不是假装排好了')
})

test('R11-盒高：fitTextPolicy 认高度与行间距（不传时逐字段等于老口径）', () => {
  const base = { maxWidthPx: 4000, baseFontPx: 100, maxLines: 6, lineHeight: 1.5 }
  // 不传高度：3 行照旧（老口径）。
  const legacy = fitTextPolicy('a\nb\nc', base)
  assert.equal(legacy.lines.length, 3)
  assert.equal(legacy.fontPx, 100)
  assert.equal(legacy.shrankForHeight, undefined, '没给盒高就不许说自己是被盒高压的')
  // 给 460px：3 行 × 100 × 1.5 = 450 放得下。
  const fits = fitTextPolicy('a\nb\nc', { ...base, maxHeightPx: 460 })
  assert.equal(fits.fontPx, 100)
  // 给 300px：必须降号，且降完仍然 3 行（不丢内容）。
  const tight = fitTextPolicy('a\nb\nc', { ...base, maxHeightPx: 300 })
  assert.equal(tight.lines.length, 3, '降号不该丢行')
  assert.ok(tight.fontPx < 100)
  assert.equal(tight.shrankForHeight, true)
  assert.ok(tight.estimatedHeightPx <= 300, `估算高度 ${tight.estimatedHeightPx}px 必须进盒子`)
  // 行间距也占高度：同样 3 行、同样 300px，加了 18px 间距后字号必须更小。
  const spaced = fitTextPolicy('a\nb\nc', { ...base, maxHeightPx: 300, rowGapPx: 18 })
  assert.ok(spaced.fontPx <= tight.fontPx, '间距不能白吃高度')
})

test('R11-盒高：validateManifest 的告警带「盒高只有」，且可执行到 cell.h', () => {
  const manifest = {
    id: 'comp-vertical-box',
    meta: { title: '竖屏盒高', width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
    tracks: [{
      id: 'vert-title',
      type: 'textCard',
      variant: 'title',
      text: '量化基金 散户',
      box: VERT_TITLE_BOX,
      startFrame: 0,
      durationInFrames: 90,
    }],
  }
  const result = validateManifest(manifest)
  assert.equal(result.errors.length, 0, result.errors.join('；'))
  const note = result.warnings.find((line) => line.includes('盒高只有'))
  assert.ok(note, `盒高被压过必须上报，实际 warnings：${result.warnings.join('；')}`)
  assert.match(note, /cell\.h/, '要告诉模型「写 spec 时改哪个字段」，否则它只会去改宽')
})

test('R11-盒高：spec 走竖屏出片时，标题轨不再有「会被裁掉」的告警', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r11-vfit-'))
  const specPath = join(dir, 'spec.json')
  // 和真机那次同形：一屏两单元（title cell h:24 + bullets cell h:56）。
  writeFileSync(specPath, JSON.stringify({
    meta: { title: '竖屏盒高', durationSec: 12, fps: 30 },
    sections: [{
      id: 's1',
      label: '两张牌桌',
      units: [
        { card: 'A1', copy: '量化基金 散户', cell: { x: 50, y: 22, w: 100, h: 24 } },
        { card: 'A4', copy: '量化基金：规则先写死；按信号执行', cell: { x: 50, y: 62, w: 100, h: 56 } },
      ],
    }],
  }, null, 2), 'utf8')
  const text = scaffoldFromSpec({ specPath, aspect: '9:16' }).text
  const manifest = JSON.parse(/```json([\s\S]*?)```/.exec(text)[1])
  assert.equal(manifest.meta.width, 1080)
  const entries = auditTextFit(manifest)
  const titleEntry = entries.find((entry) => entry.variant === 'title')
  assert.ok(titleEntry, '竖屏 spec 里必须有 title 轨')
  assert.equal(titleEntry.heightLimited, true, 'title 盒被压扁是这台机器的常态，要标出来')
  assert.equal(titleEntry.overflow, false, '标出来的同时**不许裁字** —— 这才是这次的验收点')
  const clipping = textFitWarnings(entries).filter((line) => line.includes('会被裁掉'))
  assert.deepEqual(clipping, [], `竖屏标题不该再出现裁字告警：${clipping.join('；')}`)
})

test('R11-盒高：提示文案不出现浮点尾巴（真机回执里出现过 46.75000000000001px）', () => {
  const note = textFitHeightLimitWarning('t', {
    variant: 'title',
    fontPx: 46.75000000000001,
    baseFontPx: 84,
    boxHeightPx: 76,
  })
  assert.match(note, /47px/, '像素值必须取整后再拼进回执')
  assert.doesNotMatch(note, /46\.75/)
  assert.doesNotMatch(note, /只够 \d+ 行/, '「只够 N 行」会与 maxLines（变体上限）混淆，不许这么写')
})
