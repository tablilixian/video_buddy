/**
 * 字号与画布的绑定关系（`type-scale.ts` + `planTextFit` 的缩放口径）。
 *
 * ## 抓的是什么
 *
 * 基准号（`title` 84 / `bullets` 48 / `timecode` 36）是按 **1080 高画布**设计的绝对值，
 * 但画布高由 `manifest.meta.height` 决定。历史上 `scaffold_manifest` 出的是 1280×720 /
 * 720×1280（720 高），于是同一份文案的字比设计意图大 1.5 倍；升到 1080 档之后又会出现
 * 「字号不跟画布走 ⇒ 竖版标题偏小」。本文件钉住换算口径本身。
 *
 * ## 五条断言（每条都能反向变红）
 *
 * ① 设计基准画布 1920×1080 ⇒ 系数 1.0，三个基准号**逐像素不变**（既有 1080p 产线不受影响）。
 * ② 竖版 1080×1920 ⇒ 按画布高等比放大，「字号 / 画布高」比例与基准画布一致（观感不变）。
 * ③ 非比例口径的变体**不得二次缩放**：`dataCard`（容器驱动）在两个画布上字号相同，
 *    `caption`（0.11 × 画布高）只跟高度走一次。
 * ④ 非法 / 缺失画布高 ⇒ 回设计基准（不抛、不产出 0 或 NaN）。
 * ⑤ `bullets` 的容器上限与圆点占位随字号缩放，但仍不得溢出画布。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTextFit, TITLE_BASE_FONT_PX, BULLETS_BASE_FONT_PX, TIMECODE_BASE_FONT_PX } from '../lib/remotion/text-fit-plan.js'
import { canvasTextScale, DESIGN_CANVAS_HEIGHT, TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../lib/remotion/type-scale.js'

const LANDSCAPE = { canvasWidth: 1920, canvasHeight: 1080 }
const VERTICAL = { canvasWidth: 1080, canvasHeight: 1920 }
const OLD_VERTICAL = { canvasWidth: 720, canvasHeight: 1280 }

test('① 设计基准 1920×1080 ⇒ 系数 1.0，三个基准号逐像素不变', () => {
  assert.equal(canvasTextScale(1080), 1)
  assert.equal(planTextFit({ variant: 'title', text: '四季的成因', ...LANDSCAPE }).baseFontPx, TITLE_BASE_FONT_PX)
  assert.equal(planTextFit({ variant: 'bullets', text: ['一条'], ...LANDSCAPE }).baseFontPx, BULLETS_BASE_FONT_PX)
  assert.equal(planTextFit({ variant: 'timecode', text: '00:00:01:00', ...LANDSCAPE }).baseFontPx, TIMECODE_BASE_FONT_PX)
})

test('② 竖版 1080×1920 ⇒ 字号按画布高等比放大，字号/画布高比例不变', () => {
  const title = planTextFit({ variant: 'title', text: '四季的成因', ...VERTICAL })
  const expected = Math.round(TITLE_BASE_FONT_PX * (1920 / DESIGN_CANVAS_HEIGHT))
  assert.equal(title.baseFontPx, expected, `竖版标题应为 ${expected}px（84 × 1920/1080），实际 ${title.baseFontPx}`)
  // 核心不变量：占画布高的比例与设计基准一致（不是「像素相同」，也不是「按面积缩放」）
  const designFraction = TITLE_BASE_FONT_PX / DESIGN_CANVAS_HEIGHT
  const actualFraction = title.baseFontPx / VERTICAL.canvasHeight
  assert.ok(Math.abs(actualFraction - designFraction) < 0.005, `竖版标题占高 ${actualFraction.toFixed(4)} 应≈设计 ${designFraction.toFixed(4)}`)
  // 旧竖版 720×1280 也走同一口径（不再是「84px 一把梭」）
  const old = planTextFit({ variant: 'title', text: '四季的成因', ...OLD_VERTICAL })
  assert.equal(old.baseFontPx, Math.round(TITLE_BASE_FONT_PX * (1280 / DESIGN_CANVAS_HEIGHT)))
  assert.notEqual(old.baseFontPx, TITLE_BASE_FONT_PX, '720 高画布不得再用 1080 高的绝对值（旧行为）')
})

test('③ 非比例口径的变体不得二次缩放（dataCard / caption / subtitle）', () => {
  // dataCard：字号由容器宽驱动 ⇒ 1080 宽画布与 1920 宽画布都已是「容器 ≥ 设计宽 1060」⇒ 不缩
  const cardL = planTextFit({ variant: 'dataCard', text: '太阳直射点', dataRows: 2, ...LANDSCAPE })
  const cardV = planTextFit({ variant: 'dataCard', text: '太阳直射点', dataRows: 2, ...VERTICAL })
  assert.equal(cardL.fontPx, cardV.fontPx, 'dataCard 不得因画布变化二次缩放（它自己按容器收放）')
  // caption：0.11 × 画布高，只跟高度走一次 —— 竖版是横版的 1920/1080 倍，不是平方
  const capL = planTextFit({ variant: 'caption', text: '一句字幕', ...LANDSCAPE })
  const capV = planTextFit({ variant: 'caption', text: '一句字幕', ...VERTICAL })
  assert.equal(capL.baseFontPx, Math.round(1080 * 0.11))
  assert.equal(capV.baseFontPx, Math.round(1920 * 0.11))
  assert.ok(capV.baseFontPx < capL.baseFontPx * 2, `caption 若被二次缩放会到 ${Math.round(capL.baseFontPx * 1920 / 1080)} 以上`)
})

test('④ 非法 / 缺失画布高 ⇒ 回设计基准，且系数被钳在合法区间', () => {
  assert.equal(canvasTextScale(Number.NaN), 1)
  assert.equal(canvasTextScale(0), 1)
  assert.equal(canvasTextScale(-720), 1)
  assert.equal(canvasTextScale(10), TEXT_SCALE_MIN, '极矮画布不得把字号压到 0')
  assert.equal(canvasTextScale(100000), TEXT_SCALE_MAX, '脏数据不得把字号放大成整屏')
  const plan = planTextFit({ variant: 'title', text: '无画布高', canvasWidth: 1920, canvasHeight: Number.NaN })
  assert.equal(plan.baseFontPx, TITLE_BASE_FONT_PX)
})

test('⑤ bullets 容器上限随字号缩放，但不得溢出画布', () => {
  const vertical = planTextFit({ variant: 'bullets', text: ['一条'], ...VERTICAL })
  assert.ok(vertical.containerWidthPx <= VERTICAL.canvasWidth, `容器 ${vertical.containerWidthPx} 溢出了 ${VERTICAL.canvasWidth} 宽画布`)
  assert.equal(Math.round(vertical.containerWidthPx), Math.round(Math.min(900 * (1920 / 1080), Math.max(300 * (1920 / 1080), 1080 * 0.9))))
  // 上限确实放大了：否则 85px 的字会挤在 900px 里（约 10 字/行）
  assert.ok(vertical.containerWidthPx > 900, `竖版容器应放大到画布 90%，实际 ${vertical.containerWidthPx}`)
})
