/**
 * CV-212：text-fix-trigger 纯函数契约测试。
 *
 * 覆盖：
 * - extractQuotedText：识别 ASCII 引号 / 中文 / 日文 / 全角等不同形态的引号
 * - containsNonAscii：纯 ASCII 段落不触发，含一个非 ASCII 字符即触发
 * - shouldAutoFixText：典型海报 prompt（中文/日文/阿拉伯/Cyrillic/Emoji）触发；
 *   纯英文 prompt 不触发；多段引号中只要有一段含非 ASCII 即触发
 * - buildAutoFixTextPrompt：模板拼装正确，"重绘...正确显示为"格式 + 不带场景描述
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractQuotedText,
  containsNonAscii,
  shouldAutoFixText,
  buildAutoFixTextPrompt,
} from '../lib/text-fix-trigger.js'

test('extractQuotedText：识别 ASCII 引号', () => {
  const prompts = [
    `把标题 "SUMMER SALE" 以粗体居中`,
    `标签 'Limited' 放在右下角`,
  ]
  for (const prompt of prompts) {
    const got = extractQuotedText(prompt)
    assert.ok(got.length > 0, `应该抽到引号内: ${prompt}`)
  }
})

test('extractQuotedText：识别中文/日文引号', () => {
  const cases = [
    [`标题"双十一大促"放在顶部`, ['双十一大促']],
    [`商品「新品上市」的价格牌`, ['新品上市']],
    [`ボタン『スタート』を押す`, ['スタート']],
  ]
  for (const [prompt, expected] of cases) {
    const got = extractQuotedText(prompt)
    assert.deepStrictEqual(got, expected, `prompt=${prompt}`)
  }
})

test('containsNonAscii：纯 ASCII = false', () => {
  assert.equal(containsNonAscii('SUMMER SALE'), false)
  assert.equal(containsNonAscii('Limited Time Offer 50% OFF'), false)
  assert.equal(containsNonAscii(''), false)
})

test('containsNonAscii：含非 ASCII = true', () => {
  assert.equal(containsNonAscii('双十一'), true)
  assert.equal(containsNonAscii('新品'), true)
  assert.equal(containsNonAscii('البيع'), true) // Arabic
  assert.equal(containsNonAscii('СКИДКА'), true) // Cyrillic
  assert.equal(containsNonAscii('セール'), true) // Katakana
  assert.equal(containsNonAscii('한정'), true) // Hangul
  assert.equal(containsNonAscii('Limited ⏰'), true) // emoji
})

test('shouldAutoFixText：纯英文 = false', () => {
  assert.equal(shouldAutoFixText('海报主标题 "SUMMER SALE" 居中粗体'), false)
  assert.equal(shouldAutoFixText("subtitle '50% OFF' at bottom-right"), false)
})

test('shouldAutoFixText：含非 ASCII = true（CJK）', () => {
  assert.equal(shouldAutoFixText('主标题"双十一大促"居中粗体'), true)
  assert.equal(shouldAutoFixText(`ボタン『スタート』を押して`), true)
  assert.equal(shouldAutoFixText(`한정판 "한정 수량 100개" 배너`), true)
})

test('shouldAutoFixText：非 CJK 也触发（Arabic / Cyrillic / Devanagari / Thai / Emoji）', () => {
  assert.equal(shouldAutoFixText(`تخفيض كبير "خصومات تصل إلى ٥٠٪"`), true)
  assert.equal(shouldAutoFixText(`Распродажа "СКИДКА 50%" сегодня`), true)
  assert.equal(shouldAutoFixText(`सेल "50% की छूट" आज`), true)
  assert.equal(shouldAutoFixText(`โปรโมชั่น "ลด 50%" วันนี้`), true)
  assert.equal(shouldAutoFixText(`Summer Sale ☀️ "限定 50% OFF"`), true)
})

test('shouldAutoFixText：空 / 非字符串 / 无引号', () => {
  assert.equal(shouldAutoFixText(''), false)
  assert.equal(shouldAutoFixText('没有引号的纯文本描述'), false)
  assert.equal(shouldAutoFixText('中文描述但没用引号锁字'), false)
})

test('shouldAutoFixText：多段引号只要有一段非 ASCII 就触发', () => {
  // 英文标题 + 中文副标题
  const prompt = `标题 "SALE TIME" 与副标"限时 5 折"分两行`
  assert.equal(shouldAutoFixText(prompt), true)
  // 顺序无所谓：先中文后英文
  const prompt2 = `副标"限时 5 折"加上标题 "SALE TIME"`
  assert.equal(shouldAutoFixText(prompt2), true)
  // 全英文不触发
  const prompt3 = `标题 "SALE TIME" 与副标 "LIMITED 5 OFF"`
  assert.equal(shouldAutoFixText(prompt3), false)
})

test('buildAutoFixTextPrompt：仅含非 ASCII 段进入模板', () => {
  const segments = ['SALE TIME', '限时 5 折', 'SUMMER']
  const prompt = buildAutoFixTextPrompt(segments)
  // 中文段进入；纯 ASCII 段被过滤
  assert.match(prompt, /"限时 5 折"/)
  assert.doesNotMatch(prompt, /"SALE TIME"/)
  assert.doesNotMatch(prompt, /"SUMMER"/)
  // 修复 prompt 应有的核心措辞
  assert.match(prompt, /重绘/)
  assert.match(prompt, /正确显示/)
  assert.match(prompt, /保持原有的字体风格/)
  assert.match(prompt, /不要新增其他文字/)
  // 反面戒律：不带场景/角色/画风的"动作描述"——保留子句里提到"保持 X 不变"是允许的，
  // 但不应该出现让模型"重新创意"的词（如"改进"、"创意"、"重新设计"、"调亮"）。
  assert.doesNotMatch(prompt, /改进|创意|重新设计|调亮|换色|重画一张/)
  // 模板里允许出现"保留画面其余部分...完全不变"这条"keep"子句；这里只检查
  // 该子句确实存在，作为锚点。
  assert.match(prompt, /保留画面其余部分/)
})

test('buildAutoFixTextPrompt：空数组 = 兜底提示', () => {
  const prompt = buildAutoFixTextPrompt([])
  // 没有可修复目标时，模板仍要可读、不砸 prompt
  assert.match(prompt, /重绘/)
  // 不应该有空引号在 "重绘...正确显示为" 里出现
  assert.doesNotMatch(prompt, /正确显示为 ""/)
})

test('buildAutoFixTextPrompt：多段非 ASCII 用「、」分隔', () => {
  const segments = ['双十一', 'セール']
  const prompt = buildAutoFixTextPrompt(segments)
  // 两段都用顿号串接
  assert.match(prompt, /"双十一"、/)
  assert.match(prompt, /"セール"/)
})
