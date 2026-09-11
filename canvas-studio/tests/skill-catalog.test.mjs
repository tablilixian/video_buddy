/**
 * 技能广场元数据冒烟测试（CV-065 Phase B）。
 *
 * 核心保障（双向）：
 *   正向：skills/ 目录下每个已注册 skill 都能在 skill-catalog 取到展示元数据
 *         —— 新增 skill 忘记补表直接红（否则广场静默漏技能）。
 *   反向（CV-117）：catalog 每条都必须在 skills/ 下真实存在 —— 删除或改名后
 *         残留的幽灵条目直接红（否则广场出现点不动的死卡）。
 *
 * 直连 Host tsc 编译产物 lib/skill-catalog.js。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILL_CATALOG, VISIBLE_CATALOG, SKILL_CATEGORY_IDS, SKILL_CATEGORY_LABELS, SKILL_ICON_IDS,
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

test('CV-117：反向断言 —— catalog 条目必须在 skills/ 真实存在（幽灵条目直接红）', () => {
  const registered = new Set(MINIMAX_SKILL_NAMES)
  const ghosts = SKILL_CATALOG.filter(entry => !registered.has(entry.name)).map(entry => entry.name)
  assert.deepEqual(ghosts, [], `catalog 里有 skills/ 下已不存在的条目（删除/改名后残留）：${ghosts.join(', ')}`)
})

test('CV-118：生命周期 stage 合法（试跑期必须 hidden，已上线不得 hidden）', () => {
  for (const entry of SKILL_CATALOG) {
    if (entry.stage === undefined) continue
    assert.ok(entry.stage === 'ga' || entry.stage === 'preview', `非法 stage：${entry.name} → ${entry.stage}`)
    // 2026-09-09 语义修订：preview 与可见性正交（可上广场带「试跑」角标，也可 hidden），
    // 不再强制 preview 必须 hidden。
    if (entry.stage === 'ga') {
      assert.notEqual(entry.hidden, true, `已上线技能不应 hidden：${entry.name}`)
    }
  }
})

test('getSkillEntry：未知名返回 null（不抛错、不返回 undefined）', () => {
  assert.equal(getSkillEntry('does-not-exist'), null)
  assert.equal(getSkillEntry(''), null)
})

test('skillsByCategory / skillCountByCategory：分类与计数自洽（只统计广场可见）', () => {
  const counts = skillCountByCategory()
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  assert.equal(total, VISIBLE_CATALOG.length)
  for (const id of SKILL_CATEGORY_IDS) {
    assert.equal(skillsByCategory(id).length, counts[id], `分类 ${id} 计数不一致`)
    assert.ok(typeof SKILL_CATEGORY_LABELS[id] === 'string' && SKILL_CATEGORY_LABELS[id].length > 0)
  }
})

test('recommendedSkills：在可见条目中 featured 优先、去重、limit 生效', () => {
  const featured = VISIBLE_CATALOG.filter(entry => entry.featured)
  assert.ok(featured.length > 0, '至少要有一个广场可见的 featured 条目')

  const picked = recommendedSkills()
  assert.equal(new Set(picked.map(e => e.name)).size, picked.length, '推荐列表不能重复')
  // 前缀必须是全部广场可见 featured（且顺序与 catalog 一致）
  assert.deepEqual(picked.slice(0, featured.length).map(e => e.name), featured.map(e => e.name))

  assert.equal(recommendedSkills(3).length, Math.min(3, VISIBLE_CATALOG.length))
  assert.equal(recommendedSkills(0).length, 0)
  assert.ok(recommendedSkills(999).length <= VISIBLE_CATALOG.length)
})

test('CV-121：总纲防回弹——SKILL.md 保持路由级骨架（体积上限 + 分册存在）', async () => {
  const { readFile, stat } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'canvas-studio-creation')

  const main = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  assert.ok(
    Buffer.byteLength(main) <= 15 * 1024,
    '总纲 SKILL.md 超过 15KB 上限（当前 ' + Buffer.byteLength(main) + ' 字节）——新内容请抽到 references/ 分册，保持路由级骨架',
  )
  // 骨架铁律：路由级内容必须内联（体积缩水说明被误删）
  assert.ok(Buffer.byteLength(main) >= 8 * 1024, '总纲骨架异常缩水（<8KB），执行模式/核心规则/工作流骨架可能被误删')
  for (const marker of ['执行模式与审批门禁', '风格 skill 优先原则', '标准工作流', '需求澄清']) {
    assert.ok(main.includes(marker), '总纲缺少路由级小节/指令：' + marker)
  }

  const booklets = [
    'clarification.md', 'toolchain.md', 'prompt-writing.md', 'style-presets.md',
    'screenplay.md', 'shot-format.md', 'consistency.md', 'look.md',
  ]
  for (const name of booklets) {
    const p = join(skillDir, 'references', name)
    const s = await stat(p).catch(() => null)
    assert.ok(s && s.size > 200, '分册缺失或过小：references/' + name)
  }
})

test('CV-121：风格预设表与 skill 集合对齐（加 skill 忘配预设行直接红）', async () => {
  const { readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const presets = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'canvas-studio-creation', 'references', 'style-presets.md'),
    'utf8',
  )
  const styleIds = ['minimalist-product-ad-generator', '3d-animation-short-generator', 'papercraft-stop-motion-explainer',
    'brand-promo-video-generator', 'music-video-subtitle-generator', 'co-op-game-intro-generator',
    'paper-collage-explainer-generator', 'handdrawn-live-video-generator', 'oriental-mythic-visual-director',
    'direct-street-interview-video', 'stage-startle-to-truce-encounter']
  for (const id of styleIds) {
    assert.ok(presets.includes(id), '风格预设表缺少 skill 行：' + id + '（新增风格必须同步 style-presets.md）')
  }
})
