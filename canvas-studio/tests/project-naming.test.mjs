import assert from 'node:assert/strict'
import test from 'node:test'

import { UNTITLED_PROJECT_NAME, dedupeProjectName, summarizeName } from '../lib/project-naming.js'

const BELL = String.fromCharCode(7)

test('summarizeName：折叠换行/制表/连续空格为单空格', () => {
  assert.equal(summarizeName('做一条\n  30 秒的\t咖啡广告'), '做一条 30 秒的 咖啡广告')
})

test('summarizeName：清洗 validateProjectName 黑名单（控制字符与路径分隔符）', () => {
  // 换行/制表先被空白折叠吃掉，这里验的是折不掉的控制字符与 / \。
  assert.equal(summarizeName(`a${BELL}b/c\\d`), 'a b c d')
})

test('summarizeName：超长摘要按 20 个码点截断，且不撕裂多字节字符', () => {
  assert.equal(summarizeName('一'.repeat(30)), '一'.repeat(20))
  // 按 UTF-16 码元切会把 emoji 切成半个孤 surrogate —— 用 emoji 挡住这种回归。
  const summarized = summarizeName('🎬'.repeat(30))
  assert.equal(summarized, '🎬'.repeat(20))
  assert.equal(hasLoneSurrogate(summarized), false, '截断结果不能含孤立代理项')
})

test('summarizeName：清洗后为空 → 兜底项目名（E1）', () => {
  assert.equal(summarizeName(''), UNTITLED_PROJECT_NAME)
  assert.equal(summarizeName('   \n\t  '), UNTITLED_PROJECT_NAME)
  assert.equal(summarizeName('///\\\\'), UNTITLED_PROJECT_NAME)
  assert.equal(summarizeName(BELL), UNTITLED_PROJECT_NAME)
})

test('dedupeProjectName：不撞名原样返回', () => {
  assert.equal(dedupeProjectName('咖啡广告', ['汽水广告']), '咖啡广告')
  assert.equal(dedupeProjectName('咖啡广告', []), '咖啡广告')
})

test('dedupeProjectName：撞名追加序号（2、3…）', () => {
  assert.equal(dedupeProjectName('咖啡广告', ['咖啡广告']), '咖啡广告 2')
  assert.equal(dedupeProjectName('咖啡广告', ['咖啡广告', '咖啡广告 2']), '咖啡广告 3')
})

test('dedupeProjectName：大小写不同也算撞名（对齐 Host 的 toLowerCase 口径，E10）', () => {
  assert.equal(dedupeProjectName('Coffee Ad', ['coffee ad']), 'Coffee Ad 2')
  // 序号候选同样按小写比对：占用的是「COFFEE AD 2」也不能落回去。
  assert.equal(dedupeProjectName('Coffee Ad', ['coffee ad', 'COFFEE AD 2']), 'Coffee Ad 3')
})

test('dedupeProjectName：空白基名回落兜底名再去重', () => {
  assert.equal(dedupeProjectName('   ', []), UNTITLED_PROJECT_NAME)
  assert.equal(dedupeProjectName('   ', [UNTITLED_PROJECT_NAME]), `${UNTITLED_PROJECT_NAME} 2`)
})

/** 是否存在孤立的 UTF-16 代理项（emoji 被按码元切开的痕迹）。 */
function hasLoneSurrogate(text) {
  let pendingHigh = false
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (pendingHigh) return true
      pendingHigh = true
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      if (!pendingHigh) return true
      pendingHigh = false
    } else {
      pendingHigh = false
    }
  }
  return pendingHigh
}
