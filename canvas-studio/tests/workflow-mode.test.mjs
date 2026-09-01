/**
 * CV-052：setMode 状态决策纯函数（resolveSetModePatch）的单元测试。
 *
 * 背景：routes.ts 的 setMode 原实现三条判据只看 current.state 与目标 mode，
 * 从不比对 current.mode —— 点当前已激活的模式按钮也会被当成切换执行。最严重
 * 时（confirm + keyframe_review 点「逐步确认」）state 被翻成 drafting：确认
 * 条消失、AI 已结束回合在睡、流程死锁。修复后模式未变化时短路只写 mode。
 *
 * 直连 Host 侧编译产物 lib/contracts/project.js。运行：
 * corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkflow, resolveSetModePatch, WORKFLOW_DEFAULT } from '../lib/contracts/project.js'

test('模式未变化：只写 mode，绝不碰 state（CV-052 核心）', () => {
  for (const state of ['drafting', 'awaiting_approval', 'keyframe_review', 'executing']) {
    const current = { mode: 'confirm', state }
    const patch = resolveSetModePatch(current, 'confirm')
    assert.deepEqual(patch, { mode: 'confirm' }, `confirm + ${state} 点「逐步确认」不得改写 state`)
  }
  const auto = { mode: 'auto', state: 'executing' }
  assert.deepEqual(resolveSetModePatch(auto, 'auto'), { mode: 'auto' })
})

test('keyframe_review 死锁格：confirm 下重复点当前模式，state 保持 keyframe_review', () => {
  const current = { mode: 'confirm', state: 'keyframe_review' }
  const patch = resolveSetModePatch(current, 'confirm')
  assert.equal(patch.state, undefined, 'state 被改写就会触发确认条消失 + AI 无人唤醒的死锁')
})

test('真切换：executing 切回逐步确认 → 回到澄清态（设计意图保留）', () => {
  const patch = resolveSetModePatch({ mode: 'auto', state: 'executing' }, 'confirm')
  assert.deepEqual(patch, { mode: 'confirm', state: 'drafting' })
})

test('真切换：executing 切放手跑 → 保持 executing', () => {
  const patch = resolveSetModePatch({ mode: 'confirm', state: 'executing' }, 'auto')
  assert.deepEqual(patch, { mode: 'auto', state: 'executing' })
})

test('真切换：awaiting_approval / keyframe_review 切放手跑 → 解除等待置 executing', () => {
  assert.deepEqual(
    resolveSetModePatch({ mode: 'confirm', state: 'awaiting_approval' }, 'auto'),
    { mode: 'auto', state: 'executing' },
  )
  assert.deepEqual(
    resolveSetModePatch({ mode: 'confirm', state: 'keyframe_review' }, 'auto'),
    { mode: 'auto', state: 'executing' },
  )
})

test('真切换：awaiting_approval / keyframe_review 切逐步确认（不可能但需安全）→ 不带 state', () => {
  // confirm + 等待类态切 confirm 走短路分支；此用例防御未来重构时误删短路。
  assert.deepEqual(resolveSetModePatch({ mode: 'confirm', state: 'awaiting_approval' }, 'confirm'), { mode: 'confirm' })
})

test('normalizeWorkflow：非法输入降级默认（既有语义回归）', () => {
  assert.deepEqual(normalizeWorkflow(undefined), WORKFLOW_DEFAULT)
  assert.deepEqual(normalizeWorkflow(null), WORKFLOW_DEFAULT)
  assert.deepEqual(normalizeWorkflow('junk'), WORKFLOW_DEFAULT)
  assert.deepEqual(normalizeWorkflow({ mode: 'weird', state: 'nope' }), WORKFLOW_DEFAULT)
  assert.deepEqual(normalizeWorkflow({ mode: 'auto', state: 'keyframe_review' }), { mode: 'auto', state: 'keyframe_review' })
})
