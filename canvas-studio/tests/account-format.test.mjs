/**
 * 余额格式化（CV-358）：`src/account-format.ts`。
 *
 * 锁的是**不许抹零**这条合同（api(10).md：金额固定 4 位小数）。曾经的占位卡是
 * `0 / 1,000`，接入真数据后最危险的写法是 `Math.round` / `toFixed(0)` —— 0.0500
 * 会变成 0，用户会以为钱没了。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCredits } from '../lib/account-format.js'

test('formatCredits：固定 4 位小数', () => {
  assert.equal(formatCredits(12.3), '12.3000')
  assert.equal(formatCredits(12.3456), '12.3456')
  assert.equal(formatCredits(0), '0.0000')
})

test('formatCredits：极小余额不被抹成 0', () => {
  assert.equal(formatCredits(0.0001), '0.0001')
  assert.equal(formatCredits(0.05), '0.0500')
})

test('formatCredits：千分位分组（大额余额仍可读）', () => {
  assert.equal(formatCredits(1234.5), '1,234.5000')
})

test('formatCredits：非有限值给破折号，不显示 NaN', () => {
  assert.equal(formatCredits(Number.NaN), '—')
  assert.equal(formatCredits(Number.POSITIVE_INFINITY), '—')
})
