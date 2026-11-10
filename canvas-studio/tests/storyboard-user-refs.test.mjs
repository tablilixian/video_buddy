/**
 * §07 用户参考确定性登记（REQ-037 延伸，CV-459）：
 *   1. 落卡同拍 Host 写入（`planUserRefEntries` 判据 + `registerUserReferenceAssets` 写入）；
 *   2. agent 重传 assets 段冲不掉登记条目（`keepUserAssets` 合并保护）。
 *
 * 病史：登记押在 agent 身上（CV-405 纪律），真机实证会漏——翻拍本 8 个附件落了卡、
 * §07 空。本批把登记从概率性的模型行为改成确定性的 Host 行为。
 *
 * 运行：node --test tests/storyboard-user-refs.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'
import { mergeStoryboardWrite } from '../lib/contracts/storyboard.js'
import { planUserRefEntries } from '../lib/storyboard-user-refs.js'

const userEntry = {
  name: '主视觉参考',
  type: 'image',
  status: 'ready',
  ref: { kind: 'file', id: 'abc-123.png' },
  neededBy: [],
  source: 'user',
}

test('planUserRefEntries：合法条目 → source:user / status:ready / file 引用', () => {
  const { entries, rejected } = planUserRefEntries(
    [{ name: '运镜参考.mp4 原名', kind: 'video', assetFile: 'ref-video.mp4' }],
    [],
  )
  assert.equal(rejected.length, 0)
  assert.deepEqual(entries, [{
    name: '运镜参考.mp4 原名',
    type: 'video',
    status: 'ready',
    ref: { kind: 'file', id: 'ref-video.mp4' },
    neededBy: [],
    source: 'user',
  }])
})

test('planUserRefEntries：同 assetFile 已在册（不论来源）→ 幂等跳过', () => {
  const existing = [
    userEntry,
    { name: 'Look 卡', type: 'image', status: 'ready', ref: { kind: 'file', id: 'look.png' }, neededBy: [], source: 'generated' },
  ]
  const { entries } = planUserRefEntries(
    [
      { name: '主视觉参考', kind: 'image', assetFile: 'abc-123.png' },
      { name: 'Look 卡', kind: 'image', assetFile: 'look.png' },
    ],
    existing,
  )
  assert.equal(entries.length, 0)
})

test('planUserRefEntries：非法 kind / 非法文件名 / 空名称 → rejected，不牵连合法项', () => {
  const { entries, rejected } = planUserRefEntries(
    [
      { name: '坏类型', kind: 'exe', assetFile: 'a.exe' },
      { name: '越界名', kind: 'image', assetFile: '../../secret' },
      { name: '  ', kind: 'image', assetFile: 'b.png' },
      { name: '好图', kind: 'image', assetFile: 'c.png' },
    ],
    [],
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, '好图')
  assert.equal(rejected.length, 3)
})

test('planUserRefEntries：单批 32 条上限，超限进 rejected', () => {
  const items = Array.from({ length: 35 }, (_, i) => ({ name: `图${String(i)}`, kind: 'image', assetFile: `f${String(i)}.png` }))
  const { entries, rejected } = planUserRefEntries(items, [])
  assert.equal(entries.length, 32)
  assert.equal(rejected.length, 3)
})

test('合并保护：agent 重传 assets 段，Host 登记条目不被冲掉', () => {
  const current = createStoryboard({
    projectId: 'p1',
    title: 't',
    meta: { genre: 'x', targetDuration: 10, aspect: '16:9' },
    sections: { ...emptyStoryboardSections(), '07_assets': [userEntry] },
  })
  // agent 重传 §07：只写自产条目，没提用户参考
  const merged = mergeStoryboardWrite(
    { title: current.title, meta: current.meta, sections: current.sections },
    { '07_assets': [{ name: 'Look 卡', type: 'image', status: 'ready', ref: { kind: 'canvasNode', id: 'n-look' }, neededBy: [], source: 'generated' }] },
  )
  const assets = merged.sections['07_assets']
  assert.ok(Array.isArray(assets))
  assert.equal(assets.length, 2, 'agent 条目 + 保留的登记条目')
  assert.ok(assets.some((a) => a.source === 'user' && a.ref.id === 'abc-123.png'), '登记条目必须还在')
  assert.ok(assets.some((a) => a.source === 'generated'), 'agent 新条目照常写入')
})

test('合并保护：agent 原样带上同键条目 → 不重复', () => {
  const current = createStoryboard({
    projectId: 'p1',
    title: 't',
    meta: { genre: 'x', targetDuration: 10, aspect: '16:9' },
    sections: { ...emptyStoryboardSections(), '07_assets': [userEntry] },
  })
  const merged = mergeStoryboardWrite(
    { title: current.title, meta: current.meta, sections: current.sections },
    { '07_assets': [userEntry, { name: 'b-roll', type: 'video', status: 'pending', ref: { kind: 'canvasNode', id: 'n-b' }, neededBy: ['S1'], source: 'generated' }] },
  )
  const assets = merged.sections['07_assets']
  assert.equal(assets.length, 2, '同键去重：不出现两份用户参考')
})

test('合并保护：user 条目不可被 agent 移除 —— 显式清空也保留；非 user 条目照常清空', () => {
  const agentNote = { name: 'agent 补登的口述参考', type: 'text', status: 'ready', ref: { kind: 'canvasNode', id: 'n-note' }, neededBy: [], source: 'user' }
  const generated = { name: 'Look 卡', type: 'image', status: 'ready', ref: { kind: 'canvasNode', id: 'n-look' }, neededBy: [], source: 'generated' }
  const current = createStoryboard({
    projectId: 'p1',
    title: 't',
    meta: { genre: 'x', targetDuration: 10, aspect: '16:9' },
    sections: { ...emptyStoryboardSections(), '07_assets': [agentNote, generated] },
  })
  const merged = mergeStoryboardWrite(
    { title: current.title, meta: current.meta, sections: current.sections },
    { '07_assets': [] },
  )
  const assets = merged.sections['07_assets']
  assert.ok(Array.isArray(assets) && assets.length === 1, 'generated 条目被清（节级替换照旧）')
  assert.equal(assets[0].source, 'user', 'user 条目清不掉（参考属于用户，agent 无移除权）')
})
