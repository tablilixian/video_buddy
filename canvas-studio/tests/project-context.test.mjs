/**
 * DD-09 / d 输入区「项目上下文条」判定守卫（`src/project-context.ts`）。
 *
 * 这条读数只有一个判断要回答：**显示不显示、显示哪几段**。它住在宿主
 * `conversation.composer.dock` 那条读数带里（与自带 stats 行同族），而那条带子靠
 * `:empty` / 空内容折叠 —— 所以「未选项目时一个 DOM 都不出」不是洁癖，是**折叠
 * 的前提**（c 批在会话头踩过同型的坑：渲染空壳会让折叠失效、平白留一道空白）。
 *
 * 判定收口成纯函数的理由是本仓的老账（R8）：渲染台的绿不覆盖接线，判定留在
 * `.tsx` 里就只能靠肉眼回归。这里直连纯函数，组件只负责把模型渲染出来。
 *
 * 每个用例对应一条真实会出错的边界：
 * 1. **未选项目** → `null`（不是空对象、不是空串）。
 * 2. **项目名为空 / 纯空白** → 兜底名字，否则渲染出一条只有分隔符的读数。
 * 3. **规格摘要只有一份实现** → 与 `planSummaryOf` 逐字相等（各拼一份必然漂移）。
 * 4. **未锁定规格**（CV-099 允许创建时留空）→ 两段都为 `null`，只留项目名；
 *    不写「未锁定」占位（用户 2026-09-14 拍板：保持干净）。
 * 5. **时长非法**（0 / 负数 / 非有限）→ 建议镜头数为 `null`，不吐 `0 镜` 或 `NaN`。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deriveProjectContextView } from '../lib/project-context.js'
import { planSummaryOf } from '../lib/project-row.js'

/** 最小可用项目记录（只填被测字段，其余走契约的必填项）。 */
const project = (extra = {}) => ({
  id: 'p-1',
  name: '测试项目',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  dir: '/tmp/p-1',
  ...extra,
})

test('未选项目返回 null —— 一个 DOM 都不出（宿主靠空态折叠那条读数带）', () => {
  assert.equal(deriveProjectContextView(undefined), null)
})

test('项目名：空 / 纯空白给「未命名项目」，正常名字去首尾空白', () => {
  assert.equal(deriveProjectContextView(project({ name: '' })).name, '未命名项目')
  assert.equal(deriveProjectContextView(project({ name: '   ' })).name, '未命名项目')
  assert.equal(deriveProjectContextView(project({ name: ' 验收右侧边栏 ' })).name, '验收右侧边栏')
})

test('规格摘要复用 planSummaryOf —— 读数条不得自己再拼一遍', () => {
  const plan = { aspectRatio: '16:9', targetDuration: 75 }
  assert.equal(deriveProjectContextView(project({ plan })).plan, planSummaryOf(plan))
  assert.equal(deriveProjectContextView(project({ plan })).plan, '16:9 · 75s')
})

test('未锁定规格：只留项目名（两段都是 null），不写「未锁定」占位', () => {
  const expected = { name: '测试项目', plan: null, shots: null }
  assert.deepEqual(deriveProjectContextView(project({ plan: undefined })), expected)
  assert.deepEqual(deriveProjectContextView(project({ plan: {} })), expected, '空 plan 对象不许拼出空串')
})

test('只锁一项：另一项为 null，互不牵连', () => {
  const onlyAspect = deriveProjectContextView(project({ plan: { aspectRatio: '9:16' } }))
  assert.equal(onlyAspect.plan, '9:16', '只有画幅时不带悬空分隔符')
  assert.equal(onlyAspect.shots, null, '没有时长就没有建议镜头数 —— 不许猜一个默认值')

  const onlyDuration = deriveProjectContextView(project({ plan: { targetDuration: 75 } }))
  assert.equal(onlyDuration.plan, '75s', '只有时长时不带悬空分隔符')
  assert.ok(onlyDuration.shots !== null && onlyDuration.shots >= 1, `建议镜头数应 ≥1，实得 ${onlyDuration.shots}`)
})

test('时长非法（0 / 负 / 非有限）：建议镜头数为 null，且不吐 `0s` 这种假值', () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const view = deriveProjectContextView(project({ plan: { aspectRatio: '16:9', targetDuration: bad } }))
    assert.equal(view.shots, null, `时长 ${bad} 不应给出建议镜头数`)
    // 摘要里也不该出现这个值：`0s` / `NaNs` / `Infinitys` 都长得像个真数值，
    // 比缺一段更容易被误读。判据与 suggestShotCount 同一套（见 project-row.ts）。
    assert.equal(view.plan, '16:9', `时长 ${bad} 不应进入规格摘要`)
  }
})
