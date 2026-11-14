/**
 * REQ-038 R7-R8（E1）· **放手跑模式下顺序门自动代办**单测。
 *
 * 四条纪律必须同时成立：
 * ① **auto 放行且透明** —— write_storyboard 意图卡缺项在 auto 模式自动登记放行，
 *    返回透明说明（追加进工具结果）；intentCardSeen 置位（后续闸不再拦）；
 * ② **confirm 维持拒收** —— 正常确认模式用户核对是本意，闸行为与改动前逐字一致；
 * ③ **未注入 fail-safe** —— 判定器缺失（或抛错）时回拒收路径，闸行为不变；
 * ④ **scaffold 缺项不可代办** —— 骨架要模型产出，render_composition 缺 scaffold 维持拒收。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-spec-gate-auto.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  guardSpecGate,
  setSpecGateAutoResolver,
} from '../lib/tool-error-boundary.js'
import { specGateSnapshot } from '../lib/spec-gate.js'

test('auto 模式：write_storyboard 意图卡缺项自动放行 + 透明说明 + 状态置位', async () => {
  setSpecGateAutoResolver(async () => true)
  const note = await guardSpecGate('write_storyboard', 'e1-auto')
  assert.ok(note !== null && note.includes('自动确认'), '必须返回透明说明')
  assert.equal(specGateSnapshot('e1-auto').intentCardSeen, true, '自动登记后状态置位')
})

test('confirm 模式：维持拒收（用户核对是本意），文案不变', async () => {
  setSpecGateAutoResolver(async () => false)
  await assert.rejects(
    guardSpecGate('write_storyboard', 'e1-confirm'),
    /先调 `confirm_intent_card`/,
  )
  assert.equal(specGateSnapshot('e1-confirm').intentCardSeen, false)
})

test('未注入判定器：fail-safe 回拒收路径（闸行为不变）', async () => {
  setSpecGateAutoResolver(async () => false)
  // 模拟「未注入」：注入一个抛错的判定器走 isAutoMode 的 catch → false
  setSpecGateAutoResolver(async () => { throw new Error('registry unavailable') })
  await assert.rejects(guardSpecGate('write_storyboard', 'e1-none'), /confirm_intent_card/)
})

test('render_composition 缺 intent：auto 自动登记后 scaffold 仍在 ⇒ 放行说明', async () => {
  setSpecGateAutoResolver(async () => true)
  // 先补 scaffold 与 storyboard（模拟模型已走到这一步，只差意图卡登记）
  const { noteScaffold, noteStoryboard } = await import('../lib/spec-gate.js')
  noteStoryboard('e1-render')
  noteScaffold('e1-render')
  const note = await guardSpecGate('render_composition', 'e1-render', {})
  assert.ok(note !== null && note.includes('自动确认'))
  assert.equal(specGateSnapshot('e1-render').renderAllowed, true)
})

test('render_composition 缺 scaffold：auto 也不可代办，维持拒收', async () => {
  setSpecGateAutoResolver(async () => true)
  // 故事板落地后闸才启用（未落地一律放行是既有设计）；落地后缺 intent+scaffold：
  // intent 可自动代办，scaffold 不可 ⇒ 落到 scaffold 拒收文案
  const { noteStoryboard } = await import('../lib/spec-gate.js')
  noteStoryboard('e1-no-scaffold')
  await assert.rejects(
    guardSpecGate('render_composition', 'e1-no-scaffold', {}),
    /先 `scaffold_manifest` 出骨架/,
  )
})
