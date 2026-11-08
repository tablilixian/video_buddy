/**
 * spec 编排闸（批 2-1.2 / 2.1）单测：状态机行为 + wrapStudioToolDefinition 接线。
 *
 * 会话 19 病灶：绕开 scaffold 手搓 spec 68 步零产出 + confirm_intent_card 被跳过。
 * 直连 Host tsc 编译产物 `lib/spec-gate.js` / `lib/tool-error-boundary.js`。
 * 定向跑：node --test tests/spec-gate.test.mjs（全量走 test:smoke）。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { noteIntentCard, noteScaffold, noteStoryboard, resetSpecGateForTests, specGateSnapshot } from '../lib/spec-gate.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))

beforeEach(() => resetSpecGateForTests())

test('空状态：storyboard 未落地 ⇒ render 放行（无故事板流 / 重启 fail-open）', () => {
  const gate = specGateSnapshot('s1')
  assert.equal(gate.storyboardLanded, false)
  assert.equal(gate.renderAllowed, true)
  assert.equal(gate.missing, 'none')
})

test('顺序闸：intent → storyboard → scaffold 逐项置位，缺一即 render 拒', () => {
  noteIntentCard('s1')
  assert.equal(specGateSnapshot('s1').renderAllowed, true, '无故事板时 render 仍放行')
  noteStoryboard('s1')
  assert.equal(specGateSnapshot('s1').renderAllowed, false, '故事板落地后缺 intent 之外的项也要拦')
  assert.equal(specGateSnapshot('s1').missing, 'scaffold')
  noteScaffold('s1')
  assert.equal(specGateSnapshot('s1').renderAllowed, true)
  assert.equal(specGateSnapshot('s1').missing, 'none')
})

test('intent 缺失优先报（storyboard 已落地时）', () => {
  noteStoryboard('s1')
  noteScaffold('s1')
  assert.equal(specGateSnapshot('s1').missing, 'intent')
})

test('按会话隔离：s1 的状态不影响 s2', () => {
  noteIntentCard('s1')
  noteStoryboard('s1')
  assert.equal(specGateSnapshot('s2').storyboardLanded, false)
  assert.equal(specGateSnapshot('s2').renderAllowed, true)
})

// ── 接线：wrapStudioToolDefinition 唯一入口（镜像 render-probe-budget 的接线测试）────

test('接线：write_storyboard 未见过意图卡 ⇒ 拒收且 execute 未进入（删接线即红）', async () => {
  let entered = 0
  const wrapped = wrapStudioToolDefinition({
    name: 'write_storyboard',
    execute: async () => {
      entered += 1
      return { ok: true }
    },
  })
  await assert.rejects(
    () => wrapped.execute({ title: 't' }, {}),
    (error) => error.code === 'CS-USER-ERR' && /confirm_intent_card/.test(error.message),
    '意图卡闸必须挂在唯一入口',
  )
  assert.equal(entered, 0, '被拒的那次绝不能进 execute')
})

test('接线：intent 见过 ⇒ write_storyboard 放行并置位；render 缺 scaffold ⇒ 拒；scaffold 后放行', async () => {
  let entered = 0
  const tools = ['confirm_intent_card', 'write_storyboard', 'render_composition', 'scaffold_manifest'].map((name) => ({
    name,
    execute: async () => {
      entered += 1
      return { ok: true }
    },
  })).map((t) => wrapStudioToolDefinition(t))
  await tools[0].execute({}, {})
  await tools[1].execute({}, {})
  assert.equal(entered, 2)
  await assert.rejects(
    () => tools[2].execute({}, {}),
    (error) => error.code === 'CS-USER-ERR' && /scaffold_manifest/.test(error.message),
    '故事板落地后缺 scaffold 必须拒',
  )
  assert.equal(entered, 2, '被拒的 render 不进 execute')
  await tools[3].execute({}, {})
  await tools[2].execute({}, {})
  assert.equal(entered, 4, 'scaffold 后 render 放行')
})

test('接线：confirm_intent_card / scaffold / write_storyboard 之外的工具不设闸', async () => {
  const wrapped = wrapStudioToolDefinition({
    name: 'tts_narration',
    execute: async () => ({ ok: true }),
  })
  const ok = await wrapped.execute({}, {})
  assert.deepEqual(ok, { ok: true })
})

test('文案守卫：拒收文案必给正路出口（scaffold→spec→builder）', () => {
  const src = readFileSync(resolve(HERE, '..', 'src', 'tool-error-boundary.ts'), 'utf8')
  assert.ok(src.includes('scaffold_manifest` 出骨架'), 'scaffold 拒收文案要给正路')
  assert.ok(src.includes('不要手写 manifest'), '拒收文案要禁手写（P-06）')
  assert.ok(readFileSync(join(HERE, '..', 'src', 'spec-gate.ts'), 'utf8').includes('不弹卡、不等待'), 'intent 文案依据（auto 零成本）要在状态机头注里可查')
})
