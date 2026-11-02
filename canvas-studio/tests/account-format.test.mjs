/**
 * 积分 / 金额格式化（`src/account-format.ts`）。
 *
 * 2026-11-02 口径变更：**积分一律整数展示**（与 WorkBuddy 一致），取整用**截断**，
 * 保证显示值不超过真实值。这个文件锁住三件事：
 *   1. 小数被截断而不是四舍五入（223.6111 → 223，不是 224）；
 *   2. 千分位与 `-0` / 非有限值的边界；
 *   3. 金额（`price_cents`）**仍然精确到分**，不被积分口径带跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCredits, formatPrice } from '../lib/account-format.js'

test('formatCredits：整数展示，小数位截断', () => {
  assert.equal(formatCredits(12.3456), '12')
  assert.equal(formatCredits(223.6111), '223')
  assert.equal(formatCredits(5500), '5,500')
  assert.equal(formatCredits(0), '0')
})

test('formatCredits：截断而非四舍五入（不许虚高）', () => {
  // 0.99 四舍五入会变成 1，截断必须是 0 —— 显示值永不超过真实值。
  assert.equal(formatCredits(0.99), '0')
  assert.equal(formatCredits(9.999), '9')
  assert.equal(formatCredits(1.9), '1')
})

test('formatCredits：千分位分组', () => {
  assert.equal(formatCredits(1234.5), '1,234')
  assert.equal(formatCredits(1234567), '1,234,567')
})

test('formatCredits：-0 归一成 0（不显示 "-0"）', () => {
  assert.equal(formatCredits(-0), '0')
  assert.equal(formatCredits(-0.4), '0')
})

test('formatCredits：非有限值给破折号，不显示 NaN', () => {
  assert.equal(formatCredits(Number.NaN), '—')
  assert.equal(formatCredits(Number.POSITIVE_INFINITY), '—')
  assert.equal(formatCredits(Number.NEGATIVE_INFINITY), '—')
})

test('formatPrice：金额仍精确到分，且按币种取符号', () => {
  assert.match(formatPrice(1000, 'USD'), /10\.00/)
  assert.match(formatPrice(1000, 'USD'), /\$/)
  assert.match(formatPrice(5500, 'USD'), /55\.00/)
  // 空/非法币种回退 USD（不炸、不显示 undefined）。
  assert.match(formatPrice(1000, ''), /10\.00/)
  assert.equal(formatPrice(Number.NaN, 'USD'), '—')
})
