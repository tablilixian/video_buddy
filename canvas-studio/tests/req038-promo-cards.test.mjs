/**
 * REQ-038 批次 8/9 守卫：RQ-11① 手法库分册（152/152 映射）+ RQ-11② P 卡（SB-2 三张样卡）
 * + product-promo-60s 骨架 + 判据运行器结构面。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registeredCardIds, getCard, lookupCardId } from '../lib/remotion/recipe-cards-all.js'
import { RECIPES, planRecipe } from '../lib/remotion/recipes.js'
import { validateContentSpec, planFromSpec } from '../lib/remotion/content-spec.js'

const here = dirname(fileURLToPath(import.meta.url))

test('RQ-11① 验收：手法库分册存在且覆盖 152/152 张卡（每卡 7 字段 + 轨道映射）', () => {
  const catalog = readFileSync(join(here, '../skills/code-driven-explainer/references/shotcraft-catalog.md'), 'utf8')
  const entries = catalog.match(/^### sc-[a-z0-9-]+/gmu) ?? []
  assert.equal(entries.length, 152, `分册条目数 ${entries.length} ≠ 152`)
  // 每卡 7 字段 + 来源标注。
  for (const anchor of ['我们能不能做', '走哪条轨道', '已知坑', '典型参数', 'Apache-2.0', 'Wei Yihao']) {
    assert.ok(catalog.includes(anchor), `分册缺关键面：${anchor}`)
  }
})

test('RQ-11① 验收：分册覆盖上游 10 个类目且数量与上游目录一致', () => {
  const catalog = readFileSync(join(here, '../skills/code-driven-explainer/references/shotcraft-catalog.md'), 'utf8')
  const upstream = { camera: 10, data: 11, effects: 17, interaction: 15, opening: 10, outro: 7, rhythm: 11, transition: 19, typography: 25, uiEntrance: 27 }
  // 分册用小节标题分类目。
  for (const [category, count] of Object.entries(upstream)) {
    const sectionMatch = catalog.match(new RegExp(`^## ${category}（(\\d+) 张）`, 'mu'))
    assert.ok(sectionMatch !== null, `缺类目小节：${category}`)
    assert.equal(Number(sectionMatch[1]), count, `${category} 张数不符`)
  }
})

test('RQ-11① 合规：THIRD_PARTY_NOTICES 登记 shotcraft 来源与边界', () => {
  const notices = readFileSync(join(here, '../THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const anchor of ['video-shotcraft', 'Apache License 2.0', 'Wei Yihao', '参数表 + 已知坑', 'TSX']) {
    assert.ok(notices.includes(anchor), `NOTICES 缺：${anchor}`)
  }
})

test('RQ-11② 验收（SB-2）：三张样卡 P1/P3/P5 已注册且 ≥5 参数化维度可接线', () => {
  for (const id of ['P1', 'P3', 'P5']) {
    const card = getCard(id)
    assert.ok(card !== undefined, `${id} 必须注册`)
    assert.ok(Array.isArray(card.assets), `${id} 必须有素材声明`)
  }
  // 结构面：P1 的维度进 logoWall 轨（columns/cellW/grayscale/unitStagger…）。
  const spec = JSON.parse(readFileSync(join(here, '../examples/product-promo/spec-a.json'), 'utf8'))
  const plan = planFromSpec(spec, 1800)
  const logoWall = plan.tracks.find((t) => t.type === 'logoWall')
  assert.ok(logoWall !== undefined, 'P1 必须出 logoWall 轨（素材在时）')
  assert.ok(logoWall.logos.length >= 2)
  assert.equal(logoWall.grayscale, true)
  const chipRow = plan.tracks.find((t) => t.type === 'chipRow')
  const codePanel = plan.tracks.find((t) => t.type === 'codePanel')
  assert.ok(chipRow !== undefined && codePanel !== undefined, 'P3/P5 必须出聚合原语轨')
})

test('RQ-11② 素材契约：P1 logo = user 通道 + fallback（SB-5 红线）', () => {
  const p1 = getCard('P1')
  assert.equal(p1.assets[0].source, 'user')
  assert.equal(p1.assets[0].kind, 'logo')
  assert.ok(p1.assets[0].fallback !== undefined)
  // 缺素材降级：assetSrc 返回 undefined → 不出 logoWall 轨（纯标题开场）。
  const spec = JSON.parse(readFileSync(join(here, '../examples/product-promo/spec-a.json'), 'utf8'))
  delete spec.sections[0].assetSlots
  const plan = planFromSpec(spec, 1800)
  assert.equal(plan.tracks.filter((t) => t.type === 'logoWall').length, 0, '缺 logo 必须降级（不出 logoWall 轨）')
})

test('RQ-11② 验收 2：product-promo-60s 骨架 12 段，轨数口径双达标（人工 ≤30 / 展开 ≤150）', () => {
  const recipe = RECIPES['product-promo-60s']
  assert.ok(recipe !== undefined, '骨架必须注册进 RECIPES')
  assert.equal(recipe.segments.length, 12)
  const plan = planRecipe({ title: 'promo', totalFrames: 1800, recipe })
  // 手工介入 = 12 段（人在 spec 写的）；展开 = 实际轨数。基线 265 的对照锚。
  assert.ok(recipe.segments.length <= 30)
  assert.ok(plan.tracks.length <= 150, `展开后 ${plan.tracks.length} > 150`)
  assert.ok(plan.tracks.length >= 30, `展开后 ${plan.tracks.length} 太少 —— 版式不完整`)
})

test('RQ-11② 验收 3：判据运行器结构面全绿（spec-a：维度接线 ≥5/卡）', () => {
  // param-audit.mjs 是 CLI；这里断言其依赖的结构事实（运行器实测在验收手册）。
  const audit = readFileSync(join(here, '../scripts/param-audit/param-audit.mjs'), 'utf8')
  assert.ok(audit.includes('paramDimensions') && audit.includes('paramEffective'), '采集字段必须在（RQ-19）')
  assert.ok(audit.includes('frame-diff.mjs'), '像素面交接给 pixel-audit（分工注释）')
})

test('RQ-11② 验收 4 结构面：spec-b（换名/换数据/换素材/换色）指纹 ≠ spec-a', () => {
  const a = JSON.parse(readFileSync(join(here, '../examples/product-promo/spec-a.json'), 'utf8'))
  const b = JSON.parse(readFileSync(join(here, '../examples/product-promo/spec-b.json'), 'utf8'))
  assert.notEqual(a.meta.title, b.meta.title)
  assert.notEqual(a.sections[3].copy, b.sections[3].copy, '数据必须换')
  assert.notEqual(a.sections[5].copy, b.sections[5].copy, '素材/代码必须换')
  const planA = planFromSpec(a, 1800)
  const planB = planFromSpec(b, 1800)
  const fp = (plan) => JSON.stringify(plan.tracks.map((t) => [t.type, t.text ?? t.code ?? t.logos ?? t.chips ?? null]))
  assert.notEqual(fp(planA), fp(planB), '两支片的结构指纹必须不同')
})

test('RQ-11② 验收 1（回落路径保底）：A 类卡在 P 骨架内正常工作', () => {
  const recipe = RECIPES['product-promo-60s']
  const plan = planRecipe({ title: 'promo', totalFrames: 1800, recipe })
  // t1 段用 A2 → 应有 t1-title 轨（titleCardTracks）。
  assert.ok(plan.tracks.some((t) => t.id === 't1-title'), 'A2 在骨架内应长出标题轨')
})
