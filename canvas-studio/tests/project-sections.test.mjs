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

/**
 * REQ-005 / T4：桶内按「最近改动」倒序（新 → 旧）。
 *
 * 这条是本批的产品主张：左栏回答的是**「我最近在做哪个」**，所以口径是
 * `updatedAt` 而不是 `createdAt`（建完就放着的项目会永远压在上面）。
 * 比较器收口在 resolveVisibleSections 内 —— 组件里再排一次就是第二份口径。
 */
test('resolveVisibleSections：每桶按 updatedAt 倒序（未分组与分组段都算）', () => {
  const at = (id, groupId, updatedAt) => ({ ...project(id, groupId), updatedAt })
  const { ungrouped, sections } = resolveVisibleSections(
    [
      at('p_old', 'g_a', '2026-01-01T00:00:00.000Z'),
      at('p_new', 'g_a', '2026-06-01T00:00:00.000Z'),
      at('p_ung_new', undefined, '2026-05-01T00:00:00.000Z'),
      at('p_ung_old', null, '2026-02-01T00:00:00.000Z'),
      at('p_other_group', 'g_b', '2026-09-01T00:00:00.000Z'),
    ],
    GROUPS,
  )
  assert.deepEqual(ungrouped.map(p => p.id), ['p_ung_new', 'p_ung_old'])
  assert.deepEqual(sections[0].items.map(p => p.id), ['p_new', 'p_old'])
  assert.deepEqual(sections[1].items.map(p => p.id), ['p_other_group'])
  // 分组顺序仍由 groups 决定 —— 倒序只作用于桶**内**的项目。
  assert.deepEqual(sections.map(s => s.key), ['g_a', 'g_b'])
})

test('resolveVisibleSections：updatedAt 不可解析的记录垫底，不抢占头版', () => {
  const at = (id, updatedAt) => ({ ...project(id, undefined), updatedAt })
  const { ungrouped } = resolveVisibleSections(
    [at('p_bad', '不是时间'), at('p_mid', '2026-01-01T00:00:00.000Z'), at('p_new', '2026-07-01T00:00:00.000Z')],
    GROUPS,
  )
  // 倒序下最前面是黄金位：坏数据抢头版比它沉底伤得多。
  assert.deepEqual(ungrouped.map(p => p.id), ['p_new', 'p_mid', 'p_bad'])

  // 两条都坏 → 返回 0 交给稳定排序，原相对顺序不许被打乱。
  const allBad = ['p_a', 'p_b', 'p_c'].map(id => ({ ...project(id, undefined), updatedAt: '?' }))
  assert.deepEqual(
    resolveVisibleSections(allBad, GROUPS).ungrouped.map(p => p.id),
    ['p_a', 'p_b', 'p_c'],
    '坏数据之间要保持输入顺序（sort 稳定是这里唯一的排序依据）',
  )
})

test('resolveVisibleSections：比的是时间戳，不是字符串字典序', () => {
  const { ungrouped } = resolveVisibleSections(
    [
      // = 2025-12-31T16:00Z，但字符串以「2026-」开头
      { ...project('p_east', undefined), updatedAt: '2026-01-01T00:00:00+08:00' },
      { ...project('p_utc', undefined), updatedAt: '2025-12-31T17:00:00Z' },
    ],
    GROUPS,
  )
  // localeCompare 会把 2026-… 排在前面 —— 同一时刻的不同表示被排成了两个顺序。
  assert.deepEqual(ungrouped.map(p => p.id), ['p_utc', 'p_east'],
    'ISO 8601 里 Z 与 +08:00 混用时，字典序与时间序不等价')
})

/**
 * 守卫：排序口径只有一处。组件里再排一次，就等于有了两个「谁在前」的判定 ——
 * 而它们迟早会给出不同结果（与 CV-181 分桶收口同一个理由）。
 */
test('ProjectList 不得给项目本地排序：排序口径只有 project-sections 一处', () => {
  const src = readFileSync(new URL('../src/client/ProjectList.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(
    src,
    /\.(?:items|projects|ungrouped)\.sort\(/,
    '项目列表的顺序必须来自 resolveVisibleSections；组件里再排一次会分裂出第二份口径',
  )
  assert.match(src, /resolveVisibleSections\(projects, groups\)/, '分桶 + 排序都走唯一实现')
})
