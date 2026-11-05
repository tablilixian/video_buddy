/**
 * 空转探测（P1-2 / P2-3）守卫。
 *
 * 判据全部落在纯函数上：阈值、退避、重置条件都不依赖时钟或 I/O —— 这样"该出警时
 * 必须出警、不该出警时一句都不许说"可以逐条钉死，反向变异也才有意义（改阈值 400
 * 必须变红；把重置条件删掉必须变红）。
 *
 * 真实事故基线（`session-075508eb…`，2026-11-05）：251 次 bash / 0 次 render /
 * 34 个文件 304 次访问、重复率 88.8%。下面「真机规模」那条用例就按这个形状喂。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  IDLE_TOOL_CALLS,
  SOURCE_READS,
  emptyGuardCounters,
  guardNote,
  isSourceReadCall,
  noteGuardCall,
} from '../lib/milestone-guard.js'

/** 连喂 n 次同一个调用，返回末状态（每步都过一遍出警判定，模拟真实中间件）。 */
function feed(
  start,
  n,
  call,
) {
  let state = start
  const notes = []
  for (let i = 0; i < n; i += 1) {
    state = noteGuardCall(state, call)
    const judged = guardNote(state)
    state = judged.state
    if (judged.text !== null) notes.push(judged.text)
  }
  return { state, notes }
}

const readCall = { name: 'read', arguments: { file_path: '/repo/src/remotion/manifest.ts' }, isError: false }
// 中性工作（不含 src/remotion）：用来验「空转」这一条，别把两条告警混在一起。
const bashCall = { name: 'bash', arguments: { command: 'ls build && cat build/manifest.json' }, isError: false }
// 读源码形态（今天事故的主力燃料）。
const srcBashCall = { name: 'bash', arguments: { command: 'cd canvas-studio && grep -n caption src/remotion/manifest.ts' }, isError: false }
const renderCall = { name: 'render_composition', arguments: { manifestPath: '/p/build/manifest.json', quality: 'draft' }, isError: false }
const probeRender = { name: 'render_composition', arguments: { manifestPath: '/p/build/manifest.json', probe: true }, isError: false }
const spotRender = { name: 'render_composition', arguments: { manifestPath: '/p/build/manifest.json', spotFrames: [10, 40] }, isError: false }
const failedRender = { name: 'render_composition', arguments: {}, isError: true }

test('空转阈值：第 39 次不出警，第 40 次出警', () => {
  const before = feed(emptyGuardCounters(), IDLE_TOOL_CALLS - 1, bashCall)
  assert.deepEqual(before.notes, [], '阈值前一次都不许念')
  assert.equal(before.state.sinceRender, IDLE_TOOL_CALLS - 1)

  const at = feed(before.state, 1, bashCall)
  assert.equal(at.notes.length, 1, '第 40 次必须出警')
  assert.match(at.notes[0], /骨架优先/)
  // 三条动作缺一不可：拿骨架 → 落盘 → 出片。
  assert.match(at.notes[0], /scaffold_manifest/)
  assert.match(at.notes[0], /build\/manifest\.json/)
  assert.match(at.notes[0], /render_composition/)
})

test('重复播报有退避：40 出警后 41–59 闭嘴，60 再出警', () => {
  const { state, notes } = feed(emptyGuardCounters(), IDLE_TOOL_CALLS, bashCall)
  assert.equal(notes.length, 1)

  const quiet = feed(state, 19, bashCall) // 41..59
  assert.equal(quiet.state.sinceRender, 59)
  assert.deepEqual(quiet.notes, [], '退避窗口内不许重复念')

  const again = feed(quiet.state, 1, bashCall) // 60
  assert.deepEqual(again.notes.length, 1, '满一个步长必须再念一次')
})

test('出片成功重置计数，之后不再空转告警', () => {
  const spun = feed(emptyGuardCounters(), 120, bashCall)
  assert.ok(spun.notes.length > 0, '前提：这一段本来会出警')

  const afterRender = noteGuardCall(spun.state, renderCall)
  assert.equal(afterRender.sinceRender, 0)
  assert.equal(afterRender.renders, 1)
  assert.equal(afterRender.sourceReads, 0, '出片后读源码计数也该归零')

  // 已经有过成片 ⇒ 后续调用属美化迭代，不该再被判空转（哪怕 200 次）。
  const polishing = feed(afterRender, 200, bashCall)
  assert.deepEqual(polishing.notes.filter((n) => n.includes('骨架优先')), [], '有片之后不许再念骨架优先')
})

test('探针 / 快验 / 失败的渲染都不算成片', () => {
  for (const call of [probeRender, spotRender, failedRender]) {
    const spun = feed(emptyGuardCounters(), IDLE_TOOL_CALLS, bashCall)
    const state = noteGuardCall(spun.state, call)
    assert.equal(state.renders, 0, `${call.name}(${JSON.stringify(call.arguments)}) 不能被当成成片`)
    assert.equal(state.sinceRender, IDLE_TOOL_CALLS + 1, '不算成片就不重置计数')
  }
})

test('读源码识别：只认 src/remotion，不误伤普通源码读写', () => {
  assert.equal(isSourceReadCall('read', { file_path: '/x/src/remotion/manifest.ts' }), true)
  assert.equal(isSourceReadCall('bash', { command: 'sed -n 1,80p /x/src/remotion/Chart.tsx' }), true)
  assert.equal(isSourceReadCall('read', { file_path: '/x/src/host-tools.ts' }), false, '普通源码不算燃料')
  assert.equal(isSourceReadCall('bash', { command: 'ls build && cat build/manifest.json' }), false)
  assert.equal(isSourceReadCall('write', { file_path: '/x/src/remotion/manifest.ts' }), false, '写不算读')
  assert.equal(isSourceReadCall('read', { file_path: 42 }), false, '参数形状脏了不能崩')
  assert.equal(isSourceReadCall('read', null), false)
})

test('读源码告警：第 8 次触发，退避到第 16 次', () => {
  const seven = feed(emptyGuardCounters(), SOURCE_READS - 1, readCall)
  assert.deepEqual(seven.notes, [])

  const eighth = feed(seven.state, 1, readCall)
  assert.equal(eighth.notes.length, 1)
  assert.match(eighth.notes[0], /manifest-contract\.md/, '必须指向真正的契约文件')

  const quiet = feed(eighth.state, SOURCE_READS - 1, readCall)
  assert.deepEqual(quiet.notes, [], '退避窗口内不许重复念')
})

test('真机规模：251 次 bash + 0 渲染，出警次数收敛在个位数', () => {
  // 按今天事故的形状喂：全程 bash，一次渲染都没有。
  const { notes } = feed(emptyGuardCounters(), 251, bashCall)
  assert.ok(notes.length >= 3, '长空转必须持续提醒，不能只念一次')
  assert.ok(notes.length <= 15, `251 次调用最多念 15 次，实际 ${notes.length} 次 —— 念太多等于噪声`)

  // 关键断言：只要中途出一次片，后面整段都不再念「骨架优先」。
  const recovered = noteGuardCall(feed(emptyGuardCounters(), 251, bashCall).state, renderCall)
  const after = feed(recovered, 251, bashCall)
  assert.deepEqual(after.notes.filter((n) => n.includes('骨架优先')), [], '出片后必须立刻闭嘴')
})

test('两条告警可同时命中，顺序固定（空转在前）', () => {
  // 40 次全是读源码 ⇒ 读源码告警在 8/16/24/32/40 触发，空转告警在 40 触发，末次两者同刻。
  const { notes } = feed(emptyGuardCounters(), IDLE_TOOL_CALLS, readCall)
  const both = notes.filter((n) => n.includes('骨架优先') && n.includes('manifest-contract.md'))
  assert.equal(both.length, 1, '第 40 次应把两条告警拼在一起给出')
  const text = both[0]
  assert.ok(text.indexOf('骨架优先') < text.indexOf('manifest-contract.md'), '空转在前：它决定「要不要继续这么干」')
})

test('sourceReads 只数真正的读源码调用，中性 bash 不算', () => {
  const { state } = feed(emptyGuardCounters(), 10, bashCall)
  assert.equal(state.sourceReads, 0)
  const mixed = noteGuardCall(state, srcBashCall)
  assert.equal(mixed.sourceReads, 1)
})
