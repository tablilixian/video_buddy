/**
 * REQ-022 · 字段级 diff 的判定测试（`storyboard-diff.ts`）。
 *
 * 这一层的价值全在**匹配口径**上：按语义 ID 配对还是按下标配对，决定了「在第 1 镜
 * 前面插一镜」被报成 1 处新增，还是一串错位的 changed。后者会让审阅者以为整段重写了。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffSections, summarizeDiff } from '../lib/storyboard-diff.js'
import { emptyStoryboardSections } from '../lib/contracts/storyboard.js'

function shot(id, extra = {}) {
  return {
    id, duration: 2.5, frames: 60, camera: 'Push in',
    visual: '雨夜弄堂', audio: '雨声', backup: false, ...extra,
  }
}

function withScene(shots) {
  return {
    ...emptyStoryboardSections(),
    '04_storyboard': { scenes: [{ id: 'S1', title: '开场', shots }] },
  }
}

test('空 vs 满：全部报为 added，且带分节与中文标签', () => {
  const entries = diffSections(emptyStoryboardSections(), withScene([shot('S1-Sh1')]))
  const added = entries.filter((entry) => entry.kind === 'added')
  assert.ok(added.length > 0)
  assert.ok(added.every((entry) => entry.section === 's4'))
  // 粒度是「分镜」：整块新加时只报一条（不需要把里面每个字段都列一遍）。
  assert.ok(added.some((entry) => entry.label === '开场'))
  assert.ok(added.some((entry) => entry.path === '04 分镜.S1.分镜标题'))
})

test('未变 → 零差异', () => {
  assert.deepEqual([...diffSections(withScene([shot('S1-Sh1')]), withScene([shot('S1-Sh1')]))], [])
})

test('改一个 shot 的时长 → 恰好一条 changed，路径与标签可读', () => {
  const before = withScene([shot('S1-Sh1')])
  const after = withScene([shot('S1-Sh1', { duration: 4.2 })])
  const entries = diffSections(before, after)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'changed')
  assert.equal(entries[0].section, 's4')
  assert.equal(entries[0].path, '04 分镜.S1.S1-Sh1.时长')
  assert.equal(entries[0].label, 'S1.S1-Sh1.时长')
  assert.equal(entries[0].from, '2.5')
  assert.equal(entries[0].to, '4.2')
})

test('按 shot ID 配对：在前面插一镜不会把后面的报成一串 changed', () => {
  const before = withScene([shot('S1-Sh1'), shot('S1-Sh2')])
  const after = withScene([shot('S1-Sh9'), shot('S1-Sh1'), shot('S1-Sh2')])
  const entries = diffSections(before, after)
  assert.deepEqual(entries.map((entry) => entry.kind), ['added'], '只应报新插入的那一镜')
  assert.ok(entries[0].path.startsWith('04 分镜.S1.S1-Sh9'))
})

test('往已有分镜里插一镜 → 锚点在分镜卡 id 上（渲染层能找到）', () => {
  const before = withScene([shot('S1-Sh1')])
  const after = withScene([shot('S1-Sh1'), shot('S1-Sh2')])
  const entries = diffSections(before, after)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'added')
  assert.equal(entries[0].path, '04 分镜.S1.S1-Sh2')
  assert.equal(entries[0].label, 'S1-Sh2')
})

test('删一镜 → removed（不是整段 changed）', () => {
  const before = withScene([shot('S1-Sh1'), shot('S1-Sh2')])
  const after = withScene([shot('S1-Sh1')])
  const entries = diffSections(before, after)
  assert.deepEqual(entries.map((entry) => entry.kind), ['removed'])
  assert.equal(entries[0].label, 'S1-Sh2')
})

test('角色：gen.lockedPrompt 改动被单独抓出来（L 类回写的核心字段）', () => {
  const character = (locked) => [{
    id: 'C1', label: 'ROLE A', name: '苏婉', tags: [],
    profile: { temperament: '', face: '', costume: '' },
    palette: { base: '', accent: '' }, appearsIn: [],
    gen: { lockedPrompt: locked, negativePrompt: '' },
  }]
  const before = { ...emptyStoryboardSections(), '05_characters': character('26-year-old woman') }
  const after = { ...emptyStoryboardSections(), '05_characters': character('26-year-old woman, oval face') }
  const entries = diffSections(before, after)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].path, '05 角色.C1.锁定提示词')
  assert.equal(entries[0].section, 's5')
})

test('无键字符串数组：按下标配对（硬约束增删）', () => {
  const before = { ...emptyStoryboardSections(), '08_constraints': ['A', 'B'] }
  const after = { ...emptyStoryboardSections(), '08_constraints': ['A', 'C'] }
  const entries = diffSections(before, after)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'changed')
  assert.equal(entries[0].path, '08 硬约束.硬约束[2]')
  assert.equal(entries[0].from, 'B')
  assert.equal(entries[0].to, 'C')
})

test('按自然键配对：§02 token 改值只报一条，不是「整节重写」', () => {
  const tokens = (v) => [{ k: '色彩', v }, { k: '节奏', v: '文戏 2.5s' }]
  const before = { ...emptyStoryboardSections(), '02_visual': { tokens: tokens('青灰冷调') } }
  const after = { ...emptyStoryboardSections(), '02_visual': { tokens: tokens('暖黄调') } }
  const entries = diffSections(before, after)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].path, '02 视觉规范.色彩')
})

test('summarizeDiff：按分节汇总，顺序稳定', () => {
  const before = withScene([shot('S1-Sh1')])
  const after = {
    ...before,
    '00_creative': { brief: '新创意' },
    '04_storyboard': { scenes: [{ id: 'S1', title: '开场', shots: [shot('S1-Sh1', { camera: 'Static' }), shot('S1-Sh2')] }] },
  }
  const groups = summarizeDiff(diffSections(before, after))
  assert.deepEqual(groups.map((group) => group.section), ['s0', 's4'])
  assert.equal(groups[0].count, 1)
  assert.ok(groups[1].count >= 2)
})
