/**
 * `style-conflicts.ts` 守卫 —— 该模块此前**零测试**（见 canvas-studio-architecture-review.md §5.1）。
 *
 * 为什么值得盯：它**不抛错**。判错的表现是「该提示的冲突不提示」或「对着正常提示词
 * 乱报冲突」，两者都不会让任何测试变红，只会让用户看到错的建议。
 *
 * 本文件覆盖三类：
 *   1. **不该报就不报**（空输入 / 认不出的前缀 ⇒ `[]`，这条是刻意的「不猜」策略）；
 *   2. **该报就报**（已登记极性的风格 × 相反极性词 ⇒ 命中，且按 UI 展示序）；
 *   3. **不变量**：极性声明表与 `VISUAL_STYLES` **逐条对齐** —— 漏一条，那条风格的
 *      冲突检测就永远静默失效（模块自己把 `polarisedStyleIds()` 定义成「守卫用」，本文件即其守卫）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectStyleConflicts, polarityOfPrefix, polarisedStyleIds,
  promptCharCount, stylePrefixRatio,
} from '../lib/style-conflicts.js'
import { VISUAL_STYLES, NO_STYLE_ID, stylePrefixOf } from '../lib/visual-styles.js'

/** 已登记极性的样例风格（`polarityOfPrefix` 实测：color=mono / medium=paint）。 */
const PENCIL = stylePrefixOf('pencil-sketch')

test('风格冲突①：风格前缀或提示词为空 ⇒ 不报（没东西可冲突）', () => {
  assert.deepEqual(detectStyleConflicts('', '高饱和 霓虹'), [])
  assert.deepEqual(detectStyleConflicts('   ', '高饱和 霓虹'), [])
  assert.deepEqual(detectStyleConflicts(PENCIL, ''), [])
  assert.deepEqual(detectStyleConflicts(PENCIL, '  \n '), [])
})

test('风格冲突②：认不出的前缀 ⇒ 不猜（老节点旧文本不该被编造出冲突）', () => {
  assert.equal(polarityOfPrefix('这是一段没人认识的风格文本'), undefined)
  assert.deepEqual(
    detectStyleConflicts('这是一段没人认识的风格文本', '高饱和 霓虹 多彩'),
    [],
    '认不出的风格必须返回空 —— 对着陌生风格编造冲突比不提示更糟',
  )
})

test('风格冲突③：已登记极性的风格 × 相反极性词 ⇒ 命中，且按展示序（色彩最前）', () => {
  // 实测基线：pencil-sketch(mono/paint) ×「高饱和 霓虹 多彩 摄影」= 色彩 + 媒介
  const conflicts = detectStyleConflicts(PENCIL, '高饱和 霓虹 多彩 摄影')
  assert.deepEqual(
    conflicts.map((entry) => entry.dimension),
    ['色彩', '媒介'],
    '维度与顺序都必须稳定（顺序即 UI 展示序，色彩置首）',
  )
  for (const entry of conflicts) {
    assert.equal(typeof entry.evidence, 'string', '每条冲突都要带证据串（UI 用来高亮）')
    assert.equal(typeof entry.message, 'string')
    assert.ok(entry.message.length > 0)
  }
})

test('风格冲突④：同极性不误报（风格说「明亮」，提示词也写「明亮」⇒ 无光线冲突）', () => {
  const conflicts = detectStyleConflicts(PENCIL, '明亮 浅色底 纯净浅色')
  assert.ok(
    !conflicts.some((entry) => entry.dimension === '光线'),
    `同极性不该被判为冲突，实际命中了：${conflicts.map((entry) => entry.dimension).join(', ')}`,
  )
})

test('风格冲突⑤（不变量）：极性声明表与 VISUAL_STYLES 逐条对齐', () => {
  const declared = new Set(polarisedStyleIds())
  const styleIds = new Set(VISUAL_STYLES.map((style) => style.id))

  // ① 每个可选风格都必须登记极性 —— 漏一条，那条风格的冲突检测就永远静默失效
  const missing = [...styleIds].filter((id) => id !== NO_STYLE_ID && !declared.has(id))
  assert.deepEqual(
    missing,
    [],
    `以下风格没有极性声明 ⇒ 它们的冲突检测会静默失效（detectStyleConflicts 恒返回 []）：${missing.join(', ')}`,
  )
  // ② 极性表里不得有已不存在的风格 id（改名/删除时忘了同步）
  const orphan = [...declared].filter((id) => !styleIds.has(id))
  assert.deepEqual(orphan, [], `极性声明里有不存在的风格 id（风格被改名或删除时忘同步）：${orphan.join(', ')}`)
  // ③ NO_STYLE_ID 是「无风格」，不该有极性
  assert.ok(!declared.has(NO_STYLE_ID), `「${NO_STYLE_ID}」（无风格）不该出现在极性表里`)
})

test('风格冲突⑥：promptCharCount 去空白计字（与 Krea2 口径一致）', () => {
  assert.equal(promptCharCount(' 甲 乙\n丙 '), 3, '空格与换行不计入')
  assert.equal(promptCharCount(''), 0)
  assert.equal(promptCharCount('   \n\t '), 0)
})

test('风格冲突⑦：stylePrefixRatio 边界 —— 两者皆空返回 0（不得为 NaN）', () => {
  assert.equal(stylePrefixRatio('', ''), 0, '0/0 必须显式判 0，否则 UI 会显示 NaN%')
  assert.equal(stylePrefixRatio('ab', ''), 1, '只有风格前缀 ⇒ 占比 1')
  assert.equal(stylePrefixRatio('', 'abcd'), 0, '只有提示词 ⇒ 占比 0')
  assert.equal(stylePrefixRatio('ab', 'cd'), 0.5)
})
