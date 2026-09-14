/**
 * DD-09 / d 输入区「项目上下文条」判定守卫（`src/project-context.ts`）。
 *
 * 这条读数要回答三件事：**身份**（项目名）、**约束**（画幅 / 目标时长 / 建议镜头数）、
 * **状态**（六段走到第几段、是不是在等你拍板）。CV-179 起阶段胶囊从会话头撤到这条
 * 带子上，于是三件事的判定收口到同一个纯函数 —— 两处各算一份必然漂移（本仓老账）。
 *
 * 它住在宿主 `conversation.composer.dock` 那条读数带里（与自带 stats 行同族），而那条
 * 带子靠空态折叠 —— 所以「未选项目时一个 DOM 都不出」不是洁癖，是**折叠的前提**
 * （c 批在会话头踩过同型的坑：渲染空壳会让折叠失效、平白留一道空白）。
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
 * 6. **工作流未载入** → `stage` 为 `null`，但身份与规格段照常出（不能因为阶段没好
 *    就把整条读数藏掉 —— 那才是真正的信息丢失）。
 * 7. **阶段判定只有一份实现** → 与 `deriveStageChipView` 逐字相等，且进度是人读口径。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deriveProjectContextView } from '../lib/project-context.js'
import { planSummaryOf } from '../lib/project-row.js'
import { deriveStageChipView } from '../lib/stage-chip.js'
import { STAGE_FILM, STAGE_SCRIPT } from '../lib/workflow-stage.js'

/** 最小可用项目记录（只填被测字段，其余走契约的必填项）。 */
const project = (extra = {}) => ({
  id: 'p-1',
  name: '测试项目',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  dir: '/tmp/p-1',
  ...extra,
})

/** 工作流记录的测试构造（只填被测字段）。 */
const wf = (state, mode = 'confirm') => ({ mode, state })

/** 画布节点构造（阶段判定吃 `kind` / `toolName` / `operationType`）。 */
const node = (id, extra = {}) => ({
  id,
  kind: 'image',
  x: 0,
  y: 0,
  width: 260,
  height: 180,
  createdAt: 0,
  origin: 'agent',
  sourceIds: [],
  ...extra,
})

/** 成片节点：`kind: 'video'` + `toolName: 'compose'`（产物 ≠ 素材，CV-160）。 */
const film = () => node('film', { kind: 'video', toolName: 'compose' })

test('未选项目返回 null —— 一个 DOM 都不出（宿主靠空态折叠那条读数带）', () => {
  assert.equal(deriveProjectContextView(undefined, undefined, []), null)
  // 即使工作流与画布都还在（比如项目刚被删、store 还留着），没有项目就不出。
  assert.equal(deriveProjectContextView(undefined, wf('executing'), [film()]), null, '无项目时证据不得让它复活')
})

test('项目名：空 / 纯空白给「未命名项目」，正常名字去首尾空白', () => {
  const of = (name) => deriveProjectContextView(project({ name }), undefined, [])
  assert.equal(of('').name, '未命名项目')
  assert.equal(of('   ').name, '未命名项目')
  assert.equal(of(' 验收右侧边栏 ').name, '验收右侧边栏')
})

test('规格摘要复用 planSummaryOf —— 读数条不得自己再拼一遍', () => {
  const plan = { aspectRatio: '16:9', targetDuration: 75 }
  const view = deriveProjectContextView(project({ plan }), undefined, [])
  assert.equal(view.plan, planSummaryOf(plan))
  assert.equal(view.plan, '16:9 · 75s')
})

test('未锁定规格：只留项目名（两段都是 null），不写「未锁定」占位', () => {
  const expected = { name: '测试项目', plan: null, shots: null, stage: null }
  const bare = deriveProjectContextView(project({ plan: undefined }), undefined, [])
  assert.deepEqual(bare, expected)
  // 空 plan 对象不许拼出空串
  assert.deepEqual(deriveProjectContextView(project({ plan: {} }), undefined, []), expected)
})

test('只锁一项：另一项为 null，互不牵连', () => {
  const onlyAspect = deriveProjectContextView(project({ plan: { aspectRatio: '9:16' } }), undefined, [])
  assert.equal(onlyAspect.plan, '9:16', '只有画幅时不带悬空分隔符')
  assert.equal(onlyAspect.shots, null, '没有时长就没有建议镜头数 —— 不许猜一个默认值')

  const onlyDuration = deriveProjectContextView(project({ plan: { targetDuration: 75 } }), undefined, [])
  assert.equal(onlyDuration.plan, '75s', '只有时长时不带悬空分隔符')
  assert.ok(onlyDuration.shots !== null && onlyDuration.shots >= 1, `建议镜头数应 ≥1，实得 ${onlyDuration.shots}`)
})

test('时长非法（0 / 负 / 非有限）：建议镜头数为 null，且不吐 `0s` 这种假值', () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const view = deriveProjectContextView(project({ plan: { aspectRatio: '16:9', targetDuration: bad } }), undefined, [])
    assert.equal(view.shots, null, `时长 ${bad} 不应给出建议镜头数`)
    // 摘要里也不该出现这个值：`0s` / `NaNs` / `Infinitys` 都长得像个真数值，
    // 比缺一段更容易被误读。判据与 suggestShotCount 同一套（见 project-row.ts）。
    assert.equal(view.plan, '16:9', `时长 ${bad} 不应进入规格摘要`)
  }
})

test('工作流未载入：stage 为 null，但身份与规格段照常出（不是整条藏掉）', () => {
  const view = deriveProjectContextView(
    project({ plan: { aspectRatio: '16:9', targetDuration: 75 } }),
    undefined,
    [],
  )
  assert.equal(view.stage, null)
  assert.equal(view.name, '测试项目', '阶段没好不该连项目名一起没了')
  assert.equal(view.plan, '16:9 · 75s')
})

test('阶段判定是复用的，不是第二份：与 deriveStageChipView 逐字相等', () => {
  const nodes = [film()]
  const view = deriveProjectContextView(project(), wf('drafting'), nodes)
  assert.deepEqual(view.stage, deriveStageChipView(wf('drafting'), nodes))
  // 复算关键格：进度是人读口径（1 基），阶段由画布证据压过状态地板。
  assert.equal(view.stage.stage, STAGE_FILM, '画布有片 = 事实证据')
  assert.equal(view.stage.index, 6, '第 5 段要显示成 6')
  assert.equal(view.stage.total, 6)
  assert.equal(view.stage.pending, false)
})

test('阶段证据来自画布节点：空画布回到状态地板，待批准点亮胶囊', () => {
  const empty = deriveProjectContextView(project(), wf('drafting'), [])
  assert.equal(empty.stage.stage, STAGE_SCRIPT)
  const pending = deriveProjectContextView(project(), wf('script_review'), [])
  assert.equal(pending.stage.pending, true, '待批准是胶囊变 gold 的唯一条件')
})
