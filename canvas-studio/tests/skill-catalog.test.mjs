/**
 * 技能广场元数据冒烟测试（CV-065 Phase B）。
 *
 * 核心保障：**skills/ 目录下每个已注册 skill 都能在 skill-catalog 取到展示
 * 元数据**。新增上游 skill 忘记补表 → 这里直接红（否则广场会静默漏技能）。
 *
 * 直连 Host tsc 编译产物 lib/skill-catalog.js。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILL_CATALOG, SKILL_CATEGORY_IDS, SKILL_CATEGORY_LABELS, SKILL_ICON_IDS,
  getSkillEntry, recommendedSkills, skillCountByCategory, skillsByCategory,
} from '../lib/skill-catalog.js'
import { MINIMAX_SKILL_NAMES } from '../lib/skills/minimax-skills.js'

test('catalog：条目自身合法（name 唯一 / 字段非空 / hue 在 0-360 / icon 与 category 已声明）', () => {
  const seen = new Set()
  for (const entry of SKILL_CATALOG) {
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.name), `name 必须是 kebab-case：${entry.name}`)
    assert.equal(seen.has(entry.name), false, `name 重复：${entry.name}`)
    seen.add(entry.name)
    assert.ok(entry.title.length > 0 && entry.title.length <= 20, `标题过长/为空：${entry.name}`)
    assert.ok(entry.summary.length > 0 && entry.summary.length <= 60, `说明需 1-60 字：${entry.name}（${entry.summary.length}）`)
    assert.ok(SKILL_CATEGORY_IDS.includes(entry.category), `未声明的分类：${entry.category}`)
    assert.ok(SKILL_ICON_IDS.includes(entry.icon), `未声明的图标：${entry.icon}`)
    assert.ok(Number.isInteger(entry.hue) && entry.hue >= 0 && entry.hue <= 360, `hue 越界：${entry.hue}`)
    assert.equal(typeof entry.featured, 'boolean')
  }
})

test('CV-070：demo GIF 必须真实存在于 assets/style-demos/（文件名拼错/漏拷直接红）', async () => {
  const { stat } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const demoDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'style-demos')
  for (const entry of SKILL_CATALOG.filter(candidate => candidate.demo !== undefined)) {
    const target = join(demoDir, entry.demo)
    let ok = true
    try { ok = (await stat(target)).isFile() } catch { ok = false }
    assert.ok(ok, `demo GIF 缺失：${entry.name} → ${target}`)
  }
})

test('catalog：覆盖 skills/ 下全部已注册 skill（漏补表直接红）', () => {
  assert.ok(MINIMAX_SKILL_NAMES.length > 0, 'skills/ 目录为空 —— 先跑 scripts/sync-minimax-skills.mjs')
  const missing = MINIMAX_SKILL_NAMES.filter(name => getSkillEntry(name) === null)
  assert.deepEqual(missing, [], `以下 skill 缺少展示元数据：${missing.join(', ')}`)
})

test('getSkillEntry：未知名返回 null（不抛错、不返回 undefined）', () => {
  assert.equal(getSkillEntry('does-not-exist'), null)
  assert.equal(getSkillEntry(''), null)
})

test('skillsByCategory / skillCountByCategory：分类与计数自洽', () => {
  const counts = skillCountByCategory()
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  assert.equal(total, SKILL_CATALOG.length)
  for (const id of SKILL_CATEGORY_IDS) {
    assert.equal(skillsByCategory(id).length, counts[id], `分类 ${id} 计数不一致`)
    assert.ok(typeof SKILL_CATEGORY_LABELS[id] === 'string' && SKILL_CATEGORY_LABELS[id].length > 0)
  }
})

test('recommendedSkills：featured 优先、去重、limit 生效', () => {
  const featured = SKILL_CATALOG.filter(entry => entry.featured)
  assert.ok(featured.length > 0, '至少要有一个 featured 条目')

  const picked = recommendedSkills()
  assert.equal(new Set(picked.map(e => e.name)).size, picked.length, '推荐列表不能重复')
  // 前缀必须是全部 featured（且顺序与 catalog 一致）
  assert.deepEqual(picked.slice(0, featured.length).map(e => e.name), featured.map(e => e.name))

  assert.equal(recommendedSkills(3).length, Math.min(3, SKILL_CATALOG.length))
  assert.equal(recommendedSkills(0).length, 0)
  assert.ok(recommendedSkills(999).length <= SKILL_CATALOG.length)
})
