/**
 * CV-212：含文字 prompt 的自动 image_fix 触发判定 —— 单测。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasNonAscii,
  extractQuotedText,
  shouldAutoFixText,
  buildTextFixPrompt,
} from '../lib/text-detection.js'

test('hasNonAscii: 纯 ASCII / 中文 / 日文 / 韩文 / 阿拉伯 / 重音拉丁', () => {
  assert.equal(hasNonAscii('Hello SALE 2024'), false)
  assert.equal(hasNonAscii(''), false)
  assert.equal(hasNonAscii('中文测试'), true)
  assert.equal(hasNonAscii('日本語テスト'), true)
  assert.equal(hasNonAscii('한국어'), true)
  assert.equal(hasNonAscii('العربية'), true)
  assert.equal(hasNonAscii('café résumé'), true) // 重音拉丁
  assert.equal(hasNonAscii('Привет'), true) // 西里尔
})

test('extractQuotedText: 双引号 / 中文双引号 / 日文方括号 / 书名号', () => {
  assert.deepEqual(
    extractQuotedText('把标题 "SUMMER SALE" 居中，副标题 "限时优惠"'),
    ['SUMMER SALE', '限时优惠'],
  )
  assert.deepEqual(
    extractQuotedText('标题 "SALE"，下方文字「新品上市」'),
    ['SALE', '新品上市'],
  )
  assert.deepEqual(
    extractQuotedText('"Hello" 『世界』 《2024》'),
    ['Hello', '世界', '2024'],
  )
  assert.deepEqual(extractQuotedText('一幅风景画，无文字'), [])
  assert.deepEqual(extractQuotedText("她说 hello, 没有引号"), [])
})

test('shouldAutoFixText: 全 ASCII 引号文本 → 不触发', () => {
  const r = shouldAutoFixText('画一张海报，标题 "SUMMER SALE"')
  assert.equal(r.needsFix, false)
  assert.deepEqual(r.quotedTexts, ['SUMMER SALE'])
})

test('shouldAutoFixText: 含中文 → 触发', () => {
  const r = shouldAutoFixText('画一张海报，标题 "限时特惠"')
  assert.equal(r.needsFix, true)
  assert.deepEqual(r.quotedTexts, ['限时特惠'])
})

test('shouldAutoFixText: 中英文混合 → 任一非 ASCII 即触发；quotedTexts 全部返回', () => {
  const r = shouldAutoFixText('标题 "SALE" 中文副标题 "新品上市"')
  assert.equal(r.needsFix, true)
  assert.deepEqual(r.quotedTexts, ['SALE', '新品上市'])
})

test('shouldAutoFixText: 引号文本去重 + 保序', () => {
  const r = shouldAutoFixText('"限时" 与 "限时" + "新品"')
  assert.equal(r.needsFix, true)
  assert.deepEqual(r.quotedTexts, ['限时', '新品'])
})

test('shouldAutoFixText: 无引号 → 不触发', () => {
  const r = shouldAutoFixText('画一张清新风格的咖啡海报')
  assert.equal(r.needsFix, false)
  assert.deepEqual(r.quotedTexts, [])
})

test('buildTextFixPrompt: 单文本', () => {
  const p = buildTextFixPrompt(['限时特惠'])
  assert.match(p, /限时特惠/)
  assert.match(p, /保持原字体、字号、颜色、位置不变/)
  assert.match(p, /只修正文字/)
})

test('buildTextFixPrompt: 多文本 / 顺序一致', () => {
  const p = buildTextFixPrompt(['SALE', '限时特惠'])
  const lines = p.split('\n')
  const saleIdx = lines.findIndex((l) => l.includes('SALE'))
  const zhIdx = lines.findIndex((l) => l.includes('限时特惠'))
  assert.ok(saleIdx >= 0 && zhIdx >= 0)
  assert.ok(saleIdx < zhIdx)
})

test('buildTextFixPrompt: 空数组 → 空串', () => {
  assert.equal(buildTextFixPrompt([]), '')
})