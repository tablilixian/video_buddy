/**
 * 2026-11-04（科普 0.1 验收 P10b）：字幕卡**排版预算**表测（`subtitle-fit.ts`）。
 *
 * ## 事故（成片像素实证）
 *
 * 带 `box` 的 `textCard` + `variant:'subtitle'` 轨**文字被裁**：
 * `"0° Equator"` 只剩 `"Equator"`、`"+23.5°N · Solstice"` 只剩 `"Solstice"`、
 * 两行的 `"Direct · 90°" / "Concentrated → warms fast"` 只剩最后一行且首行被削成一条线。
 *
 * ## 根因
 *
 * 旧实现按**画布**算字号/行数预算，而真实容器是**盒子**（常常只有画布的 1/6 宽）
 * ⇒ 算出的字号偏大、行数偏多 ⇒ 文字溢出、被 `overflow:hidden` 裁掉。
 *
 * ## 本文件钉三件事
 *
 * ① **铺满卡逐字不变**（老 manifest 逐像素不变）；
 * ② 事故里的三张真实卡片，预算算出的**实际渲染高度必须装得进盒子**；
 * ③ 盒子越矮 ⇒ 字号越小、行数越少（高度预算真的在起作用）。
 *
 * 直连 Host tsc 编译产物 lib/remotion/subtitle-fit.js 与 lib/remotion/timing.js。
 * 定向跑：node --test tests/remotion-subtitle-fit.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUBTITLE_LINE_HEIGHT, subtitleFitBudget } from '../lib/remotion/subtitle-fit.js'
import { fitTextPolicy } from '../lib/remotion/timing.js'

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 }

/** 预算 + 排版策略 ⇒ 实际渲染出来的文字高度（px）。 */
function renderedHeight(text, box) {
  const budget = subtitleFitBudget({ box, ...CANVAS })
  const fit = fitTextPolicy(text, {
    maxWidthPx: budget.maxWidthPx,
    baseFontPx: budget.baseFontPx,
    maxLines: budget.maxLines,
    lineHeight: SUBTITLE_LINE_HEIGHT,
  })
  return {
    height: fit.lines.length * fit.fontPx * SUBTITLE_LINE_HEIGHT + budget.padY * 2,
    fontPx: fit.fontPx,
    lines: fit.lines.length,
    budget,
  }
}

// ── 事故现场的三张真实卡片（逐字取自成片 manifest）────────────────────────

const INCIDENT_CARDS = [
  {
    name: 's3_center「0° Equator」',
    box: { w: 16, h: 7 },
    text: '0° Equator',
  },
  {
    name: 's3_rN「+23.5°N · Solstice」',
    box: { w: 26, h: 8 },
    text: '+23.5°N · Solstice',
  },
  {
    name: 's4_lCap 两行字幕',
    box: { w: 38, h: 15 },
    text: 'Direct · 90°\nConcentrated → warms fast',
  },
]

test('P10b：事故里的三张卡片，文字高度必须装得进盒子（旧实现全部溢出）', () => {
  for (const card of INCIDENT_CARDS) {
    const boxHeightPx = (card.box.h / 100) * CANVAS.canvasHeight
    const { height, budget } = renderedHeight(card.text, card.box)
    assert.ok(
      height <= boxHeightPx + 0.5,
      `${card.name}：文字高 ${height.toFixed(1)}px 超出盒子 ${boxHeightPx.toFixed(1)}px`
        + `（预算 ${JSON.stringify(budget)}）—— 溢出即被 overflow:hidden 裁掉`,
    )
  }
})

test('P10b：事故卡片不得把文字裁掉（行数与字号都在盒子里）', () => {
  // 「0° Equator」曾经只剩 "Equator" —— 根因是宽度预算按画布算、行数按盒子装。
  const { lines, fontPx } = renderedHeight('0° Equator', { w: 16, h: 7 })
  assert.equal(lines, 1, '「0° Equator」必须排成 1 行（曾被裁成只剩 "Equator"）')
  assert.ok(fontPx > 16, `字号不得被压到下限（实际 ${fontPx}px）`)
})

test('P10b：两行字幕必须真的排成两行，且都在盒子里', () => {
  const { lines, height } = renderedHeight('Direct · 90°\nConcentrated → warms fast', { w: 38, h: 15 })
  assert.equal(lines, 2, '两段文本必须是两行（曾只剩最后一行）')
  assert.ok(height <= (15 / 100) * CANVAS.canvasHeight + 0.5, `两行总高 ${height.toFixed(1)}px 超出盒子`)
})

// ── 铺满卡：老路径逐字不变 ────────────────────────────────────────────────

test('P10b：铺满卡（无 box）走老参数，老 manifest 逐像素不变', () => {
  const budget = subtitleFitBudget({ box: undefined, ...CANVAS })
  assert.deepEqual(budget, {
    maxWidthPx: Math.max(200, CANVAS.canvasWidth * 0.86 - 64),
    baseFontPx: 44,
    maxLines: 3,
    padX: 32,
    padY: 18,
    layerPad: 72,
  })
})

// ── 高度预算真的在起作用 ─────────────────────────────────────────────────

test('P10b：盒子越矮 ⇒ 基准字号越小、行数上限越少', () => {
  const tall = subtitleFitBudget({ box: { w: 38, h: 30 }, ...CANVAS })
  const short = subtitleFitBudget({ box: { w: 38, h: 5 }, ...CANVAS })
  assert.ok(short.baseFontPx < tall.baseFontPx, `矮盒子字号应更小（${short.baseFontPx} vs ${tall.baseFontPx}）`)
  assert.ok(short.maxLines <= tall.maxLines, '矮盒子行数上限不应更多')
  assert.equal(short.maxLines, 1, '5% 高的盒子只放得下 1 行')
  assert.equal(tall.baseFontPx, 44, '30% 高的盒子不该压字号')
  // 7% 高的盒子刚好放得下一行 44px（59.4 ≤ 59.6）⇒ 不压字号，但行数仍是 1。
  const seven = subtitleFitBudget({ box: { w: 38, h: 7 }, ...CANVAS })
  assert.equal(seven.baseFontPx, 44)
  assert.equal(seven.maxLines, 1)
})

test('P10b：盒子再矮也不得把字号压到 16px 以下（不可读）', () => {
  const tiny = subtitleFitBudget({ box: { w: 10, h: 1 }, ...CANVAS })
  assert.ok(tiny.baseFontPx >= 16, `字号下限 16px，实际 ${tiny.baseFontPx}`)
  assert.equal(tiny.maxLines, 1)
})
