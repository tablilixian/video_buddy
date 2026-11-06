/**
 * 错误卡渲染计划（`src/error-card-plan.ts`）冒烟测试。
 *
 * 为什么单独测纯函数：`StudioErrorState` 是 JSX，本仓测试没有渲染器（全走
 * `node --test` + 源码文本断言），于是「终态错误不能出现重试按钮」这类规则以前
 * 只能靠断言源码里有某个三元表达式来守 —— 那种守卫把逻辑删掉也能绿。计划表是纯
 * 函数，结论可以直接断言，反向变异（terminal 归回 retryable）当场变红。
 *
 * 对应 2026-11-06 真机（会话 18 §13）：故事板已落地时的版本写操作被
 * `assertNotLanded` 拦下，错误卡上唯一的按钮是「重试」，而重试必然复发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorCardPlan } from '../lib/error-card-plan.js'
import { classifyStudioFailure } from '../lib/error-kind.js'
import { ERROR_COPY } from '../lib/brand-copy.js'
import '../lib/errors/catalog.js'

/** 卡片上所有会渲染成按钮的 action。 */
const actionsOf = (plan) => [plan.primary, ...plan.secondary].filter((action) => action !== 'none')

test('终态（terminal）：绝不渲染「重试」，主行动是「知道了」', () => {
  const plan = errorCardPlan({ kind: 'terminal', hasDismiss: true })
  assert.equal(plan.primary, 'dismiss', '终态卡的主按钮必须是「知道了」')
  assert.deepEqual(plan.secondary, [], '终态卡不该再有次按钮')
  assert.ok(!actionsOf(plan).includes('retry'), '终态卡出现「重试」＝把用户推回唯一失效的按钮')
  assert.equal(plan.title, ERROR_COPY.terminalTitle)
})

test('终态（terminal）：没给关闭回调时一个按钮都不给 —— 不许退回「重试」', () => {
  const plan = errorCardPlan({ kind: 'terminal' })
  assert.equal(plan.primary, 'none')
  assert.deepEqual(plan.secondary, [])
  assert.equal(plan.closable, false)
})

test('终态（terminal）：真机上那张卡（CS-STORY-002）确实被判成 terminal', () => {
  // 端到端口径：码 → 分级 → 计划。中间任一环漂了（比如码没声明 uiKind）这条会红。
  const kind = classifyStudioFailure('CS-STORY-002', '本项目已落地（live），版本写操作已冻结。')
  assert.equal(kind, 'terminal')
  const plan = errorCardPlan({ kind, hasDismiss: true })
  assert.notEqual(plan.title, ERROR_COPY.retryable, '终态卡标题不许再是「出错了，重试一次？」')
  assert.ok(!actionsOf(plan).includes('retry'))
})

test('缺配置（config）：有设置回调时主按钮是「去设置」，重试降为次按钮', () => {
  const plan = errorCardPlan({ kind: 'config', hasSettings: true })
  assert.equal(plan.primary, 'settings')
  assert.deepEqual(plan.secondary, ['retry'])
})

test('缺配置（config）：没有设置回调时退回「重试」—— 不给用户留零按钮', () => {
  const plan = errorCardPlan({ kind: 'config' })
  assert.equal(plan.primary, 'retry')
  assert.deepEqual(plan.secondary, [])
})

test('可重试 / 不可达：主按钮仍是「重试」，标题按级切换', () => {
  const retryable = errorCardPlan({ kind: 'retryable' })
  assert.equal(retryable.primary, 'retry')
  assert.equal(retryable.title, ERROR_COPY.retryable)

  const unreachable = errorCardPlan({ kind: 'unreachable' })
  assert.equal(unreachable.primary, 'retry')
  assert.equal(unreachable.title, ERROR_COPY.unreachableTitle)
  assert.equal(unreachable.hint, ERROR_COPY.unreachableHint)
})

test('关闭出口：有 onDismiss 才渲染 ×；四级都可以关（终态例外在于它还多一个主按钮）', () => {
  for (const kind of ['retryable', 'config', 'unreachable', 'terminal']) {
    assert.equal(errorCardPlan({ kind, hasDismiss: true }).closable, true, `${kind}: 给了关闭回调就必须能关`)
    assert.equal(errorCardPlan({ kind, hasDismiss: false }).closable, false, `${kind}: 没给回调就不该画 ×`)
  }
})

test('左缘色条：四级各自一个修饰类，终态不得复用可重试的 accent 条', () => {
  const classes = ['retryable', 'config', 'unreachable', 'terminal'].map((kind) => errorCardPlan({ kind }).className)
  assert.deepEqual(classes, [
    'csErrorKindRetryable',
    'csErrorKindConfig',
    'csErrorKindUnreachable',
    'csErrorKindTerminal',
  ])
  assert.equal(new Set(classes).size, 4, '四级视觉必须可辨（同一类名 = 终态被悄悄并入某一级）')
})
