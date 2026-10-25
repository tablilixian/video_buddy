/**
 * 片型配方（`src/remotion/recipes.ts`）的守卫。
 *
 * 抓两类错：
 *   1. **时间轴不自洽** —— `Σ 段时长` 必须等于总帧数。宿主有「尾部完整性校验」，
 *      差一帧就拒收整条 manifest，而配方是自动算的，出错就是每支片子都错。
 *   2. **素材清单缺失** —— 配方说"这段要用产品图"但 assets 里没有 ⇒ 用户按配方做完
 *      才发现缺图，正是这次要根治的"临时组织素材"。
 *
 * 运行：node --test tests/render-recipes.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, planRecipe, recipeAssetsJson } from '../lib/remotion/recipes.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { THEMES } from '../lib/remotion/themes.js'

const META = (totalFrames) => ({
  title: '配方自测',
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: totalFrames,
  backgroundColor: '#000000',
})

test('R·①：三套配方自洽 —— 键与 id 一致、权重为正、推荐主题存在', () => {
  assert.ok(Object.keys(RECIPES).length >= 3, '至少 3 套（否则"选配方"没有意义）')
  for (const [key, recipe] of Object.entries(RECIPES)) {
    assert.equal(recipe.id, key)
    assert.ok(recipe.segments.length >= 3, `${key} 至少 3 段`)
    for (const segment of recipe.segments) {
      assert.ok(segment.weight > 0, `${key}.${segment.id} 权重必须为正`)
      assert.ok(segment.card.length > 0, `${key}.${segment.id} 要标用哪张卡`)
    }
    assert.ok(THEMES[recipe.theme] !== undefined, `${key} 推荐的主题 ${recipe.theme} 必须存在`)
    assert.ok(recipe.note.length > 10, `${key} 要写明适用片型（用户看不到代码）`)
  }
})

test('R·②：时间轴必须严丝合缝 —— Σ 段时长 = 总帧数，且段间无空洞', () => {
  const total = 900 // 30s @30fps
  for (const recipe of Object.values(RECIPES)) {
    const plan = planRecipe({ title: 't', totalFrames: total, recipe })
    const sum = plan.timeline.reduce((acc, slot) => acc + slot.durationInFrames, 0)
    assert.equal(sum, total, `${recipe.id} 的段时长合计必须是 ${total}（差一帧就会被尾部完整性校验拒收）`)
    let cursor = 0
    for (const slot of plan.timeline) {
      assert.equal(slot.startFrame, cursor, `${recipe.id}.${slot.id} 的起点必须紧接上一段（无缝）`)
      assert.ok(slot.durationInFrames > 0)
      cursor += slot.durationInFrames
    }
  }
})

test('R·③：极端时长也不塌 —— 1 帧总长时每段至少 1 帧（不允许出现 0 帧轨）', () => {
  const plan = planRecipe({ title: 't', totalFrames: 4, recipe: RECIPES['explainer-cards'] })
  for (const slot of plan.timeline) assert.ok(slot.durationInFrames >= 1)
  assert.equal(plan.timeline.reduce((a, s) => a + s.durationInFrames, 0), 4)
})

test('R·④：生成的骨架必须能过 validateManifest（这是配方的存在前提）', () => {
  const total = 450
  for (const recipe of Object.values(RECIPES)) {
    const plan = planRecipe({ title: 't', totalFrames: total, recipe })
    const result = validateManifest({ id: 'recipe-check', meta: META(total), tracks: plan.tracks })
    assert.deepEqual(result.errors, [], `${recipe.id} 生成的骨架不合法：${result.errors.join('；')}`)
  }
})

test('R·⑤：零素材配方必须真的零素材；有素材的配方必须列在 assets 里', () => {
  assert.deepEqual(RECIPES['explainer-cards'].assets, [], 'explainer-cards 是对外承诺的"零素材"档')
  for (const recipe of Object.values(RECIPES)) {
    if (recipe.id === 'explainer-cards') continue
    assert.ok(recipe.assets.length > 0, `${recipe.id} 有 E/C 类卡就必须列素材`)
    for (const asset of recipe.assets) {
      assert.ok(recipe.segments.some((s) => s.id === asset.segmentId),
        `${recipe.id}.${asset.name} 指向的段 ${asset.segmentId} 必须存在`)
      assert.ok(asset.note.length > 5, `${asset.name} 要写清怎么用（拿不到时会误导）`)
    }
  }
})

test('R·⑥：素材清单 JSON 可直接填 §07 —— pending + 空 ref + source', () => {
  const json = recipeAssetsJson(RECIPES['product-walkthrough'])
  const parsed = JSON.parse(json)
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length > 0)
  for (const asset of parsed.assets) {
    assert.equal(asset.status, 'pending', '默认 pending ⇒ 会阻断落地（先备齐再动手）')
    assert.deepEqual(asset.ref, { kind: 'file', id: '' })
    assert.ok(['user', 'library', 'generated', 'stock'].includes(asset.source))
  }
})
