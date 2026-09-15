import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { resolveVisibleSections } from '../lib/project-sections.js'

const GROUPS = [
  { id: 'g_a', name: 'A 组', order: 0 },
  { id: 'g_b', name: 'B 组', order: 1 },
]

const project = (id, groupId) => ({ id, name: id, dir: `/tmp/${id}`, groupId })

test('resolveVisibleSections：未分组（undefined / null）落兜底桶', () => {
  const { ungrouped, sections } = resolveVisibleSections(
    [project('p1', undefined), project('p2', null), project('p3', 'g_a')],
    GROUPS,
  )
  assert.deepEqual(ungrouped.map(p => p.id), ['p1', 'p2'])
  assert.deepEqual(sections[0].items.map(p => p.id), ['p3'])
  assert.deepEqual(sections[1].items.map(p => p.id), [])
})

/**
 * 这条是本批存在的理由：`groupId` 指向已删除的分组时，**旧实现两个桶都不收**，
 * 项目在左栏彻底消失。断言它必须出现在未分组桶里。
 */
test('resolveVisibleSections：悬空 groupId 回落未分组（旧实现在这里丢卡片）', () => {
  const { ungrouped, sections } = resolveVisibleSections(
    [project('p_lost', 'g_deleted'), project('p_ok', 'g_b')],
    GROUPS,
  )
  assert.deepEqual(ungrouped.map(p => p.id), ['p_lost'], '悬空 groupId 的项目必须能被看到')
  assert.deepEqual(sections[1].items.map(p => p.id), ['p_ok'])
})

test('resolveVisibleSections：分组一个都没有时全部进兜底桶', () => {
  const { ungrouped, sections } = resolveVisibleSections(
    [project('p1', 'g_a'), project('p2', undefined)],
    [],
  )
  assert.deepEqual(ungrouped.map(p => p.id), ['p1', 'p2'])
  assert.deepEqual(sections, [])
})

test('resolveVisibleSections：分组顺序原样保持，不在这里二次排序', () => {
  const groups = [
    { id: 'g_b', name: 'B 组', order: 1 },
    { id: 'g_a', name: 'A 组', order: 0 },
  ]
  const { sections } = resolveVisibleSections([], groups)
  assert.deepEqual(sections.map(s => s.key), ['g_b', 'g_a'])
  assert.deepEqual(sections.map(s => s.title), ['B 组', 'A 组'])
})

test('resolveVisibleSections：空项目列表不产生幽灵段（仍列出空分组）', () => {
  const { ungrouped, sections } = resolveVisibleSections([], GROUPS)
  assert.deepEqual(ungrouped, [])
  assert.equal(sections.length, 2)
  assert.ok(sections.every(s => s.items.length === 0))
})

test('resolveVisibleSections：不改写入参（同一数组重复调用结果一致）', () => {
  const projects = [project('p1', 'g_a'), project('p2', 'g_deleted')]
  const snapshot = JSON.stringify(projects)
  const first = resolveVisibleSections(projects, GROUPS)
  const second = resolveVisibleSections(projects, GROUPS)
  assert.equal(JSON.stringify(projects), snapshot)
  assert.deepEqual(first.ungrouped.map(p => p.id), second.ungrouped.map(p => p.id))
})

/**
 * 守卫：接线。判定收口到纯函数之后，组件里**不得再出现本地分桶**，
 * 否则「悬空回落」这条口径又会分裂出第二份实现 —— 而这份实现恰好是漏的。
 */
test('ProjectList 必须消费 resolveVisibleSections，不得本地分桶', () => {
  const src = readFileSync(new URL('../src/client/ProjectList.tsx', import.meta.url), 'utf8')
  assert.match(src, /resolveVisibleSections\(/, '左栏分桶必须走唯一实现')
  assert.match(src, /from '\.\.\/project-sections\.js'/, '必须从 project-sections 导入')
  assert.doesNotMatch(
    src,
    /projects\.filter\(\s*p\s*=>\s*p\.groupId === group\.id\s*\)/,
    '本地 filter 只看相等 —— 悬空 groupId 的卡片会被静默吞掉（本批修复的正是它）',
  )
})
