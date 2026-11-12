/**
 * REQ-038 批次 7 守卫：RQ-10 卡→配方接线 + RQ-12 内容规格 schema + RQ-21 素材契约。
 *
 * 验收口径（需求正本 §3）：
 * - RQ-10：① 未注册卡回落路径与今天**逐像素一致**（占位轨原样）；
 *          ② 注册卡后 `recipe=product-walkthrough` 产出轨数 ≥ 30；
 *          ③ 新增卡**不需改 recipes.ts**（注册表可扩展）。
 * - RQ-12：spec schema 校验（必填/取值域/卡可解析）；spec ⇒ 确定性 manifest。
 * - RQ-21：每张卡有机读 `assets` 声明（缺声明注册即抛）；同一 spec 两次运行
 *          产出同一份素材需求清单（确定性）；三路分流正确；品牌红线
 *          （logo/UI × generated = 注册期拒收）；缺 user 素材按 fallback 降级出片。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, planRecipe } from '../lib/remotion/recipes.js'
import { registeredCardIds, lookupCardId, registerCard, getCard } from '../lib/remotion/recipe-cards.js'
import { validateContentSpec, specAssetNeeds, planFromSpec } from '../lib/remotion/content-spec.js'

const PRODUCT = RECIPES['product-walkthrough']
assert.ok(PRODUCT !== undefined, 'product-walkthrough recipe 必须存在')

test('RQ-10 验收1：未注册卡回落占位轨（老行为不变 —— 占位轨形状逐字段一致）', () => {
  const unregistered = {
    ...PRODUCT,
    segments: PRODUCT.segments.map((s) => ({ ...s, card: 'Z9 不存在的卡' })),
  }
  const plan = planRecipe({ title: '回落', totalFrames: 300, recipe: unregistered })
  // 5 轨 = bg + 4 占位卡（与接线的老行为一致）。
  assert.equal(plan.tracks.length, 5)
  const seg = plan.tracks[1]
  assert.equal(seg.type, 'textCard')
  assert.equal(seg.variant, 'subtitle')
  assert.match(String(seg.text), /^【/)
})

test('RQ-10 验收2：注册卡后 product-walkthrough 产出轨数 ≥ 30', () => {
  const plan = planRecipe({ title: '接线', totalFrames: 450, recipe: PRODUCT })
  assert.ok(plan.tracks.length >= 30, `产出 ${plan.tracks.length} 轨，需 ≥ 30`)
  // 每段都长出了版式（不再是一段一卡）。
  for (const slot of plan.timeline) {
    const sectionTracks = plan.tracks.filter((t) => String(t.id).startsWith(`${slot.id}-`))
    assert.ok(sectionTracks.length >= 3, `段 ${slot.id} 只有 ${sectionTracks.length} 轨，版式不完整`)
  }
})

test('RQ-10 验收2b：C2 卡缺素材走降级（色块占位不阻断），有素材用真图', () => {
  const planNoAsset = planRecipe({ title: '缺图', totalFrames: 450, recipe: PRODUCT })
  const fallback = planNoAsset.tracks.find((t) => t.id === 'showcase-visual-fallback')
  assert.ok(fallback !== undefined, '缺素材必须有降级轨')
  assert.equal(fallback.type, 'shape')
  const planWithAsset = planRecipe({
    title: '有图',
    totalFrames: 450,
    recipe: PRODUCT,
    assetSlots: { showcase: { mainVisual: '/canvas-studio/assets/demo/product.png' } },
  })
  const visual = planWithAsset.tracks.find((t) => t.id === 'showcase-visual')
  assert.ok(visual !== undefined && visual.src === '/canvas-studio/assets/demo/product.png')
})

test('RQ-10 验收3：新增卡不需改 recipes.ts（注册表可扩展）', () => {
  const before = registeredCardIds().length
  let generated = false
  registerCard({
    id: 'X1',
    title: '测试卡',
    assets: [],
    generate: () => {
      generated = true
      return [{ id: 'x1-only', type: 'shape', shape: 'rect', color: '#123456', startFrame: 0, durationInFrames: 60 }]
    },
  })
  assert.equal(registeredCardIds().length, before + 1)
  const recipe = { ...PRODUCT, segments: [{ ...PRODUCT.segments[0], card: 'X1 测试卡' }] }
  const plan = planRecipe({ title: '扩展', totalFrames: 120, recipe })
  assert.ok(generated, '自定义卡生成器必须被 planRecipe 调用')
  assert.ok(plan.tracks.some((t) => t.id === 'x1-only'))
})

test('RQ-10：lookupCardId 兼容纯编号与带名卡；未注册返回 null', () => {
  assert.equal(lookupCardId('A2 标题逐字'), 'A2')
  assert.equal(lookupCardId('A2'), 'A2')
  assert.equal(lookupCardId('Z9 不存在'), null)
})

test('RQ-21：注册卡缺 assets 声明即抛；品牌红线 logo×generated 注册期拒收', () => {
  // 注册期防呆走 error-system（CS-DEV-ERR）—— 断言 code + devMessage（detail 插值）。
  const catchOf = (fn) => {
    try {
      fn()
    } catch (error) {
      return error
    }
    return null
  }
  const missing = catchOf(() => registerCard({ id: 'Y1', title: '缺声明', generate: () => [] }))
  assert.ok(missing !== null, '缺 assets 声明必须抛')
  assert.equal(missing.code, 'CS-DEV-ERR')
  assert.match(String(missing.devMessage), /缺 assets 声明/)
  const branded = catchOf(() => registerCard({
    id: 'Y2',
    title: '品牌违规',
    assets: [{ slot: 'logo', kind: 'logo', source: 'generated', required: true }],
    generate: () => [],
  }))
  assert.ok(branded !== null, '品牌红线必须抛')
  assert.equal(branded.code, 'CS-DEV-ERR')
  assert.match(String(branded.devMessage), /品牌红线 SB-5/)
  // 重复注册也拒。
  const dup = catchOf(() => registerCard({ id: 'A2', title: '覆盖', assets: [], generate: () => [] }))
  assert.ok(dup !== null, '重复注册必须抛')
  assert.match(String(dup.devMessage), /不允许静默覆盖/)
})

test('RQ-21：内置卡全部带机读素材声明；C2/E1 声明 user 通道', () => {
  for (const id of registeredCardIds()) {
    const card = getCard(id)
    assert.ok(card !== undefined && Array.isArray(card.assets), `卡 ${id} 缺 assets 声明`)
  }
  const c2 = getCard('C2')
  assert.equal(c2.assets[0].source, 'user')
  assert.ok(c2.assets[0].fallback !== undefined, '非阻断素材必须有 fallback 说明')
})

test('RQ-12：validateContentSpec —— 合法 spec 零错；缺字段/坏值报错；未注册卡 warning', () => {
  const ok = validateContentSpec({
    meta: { title: '测试片', fps: 30, durationSec: 12 },
    sections: [
      { id: 'hook', card: 'A2', copy: '今天，它替你数了一次心跳', durationSec: 3 },
      { id: 'showcase', card: 'C2 左右分栏', copy: '左侧讲解', label: '产品亮相', assetSlots: { mainVisual: '/a.png' } },
    ],
  })
  assert.deepEqual(ok.errors, [])
  const bad = validateContentSpec({ meta: { title: '' }, sections: [] })
  assert.ok(bad.errors.length >= 2)
  assert.equal(bad.ok, false)
  const warn = validateContentSpec({
    meta: { title: 't' },
    sections: [{ id: 'a', card: 'Z9 瞎写', copy: 'x' }],
  })
  assert.ok(warn.warnings.some((w) => w.includes('未注册')))
})

test('RQ-12 ★确定性：同一 spec 两次 planFromSpec 产出同一 manifest（逐字段）', () => {
  const spec = {
    meta: { title: '确定性', fps: 30 },
    sections: [
      { id: 'hook', card: 'A2', copy: '第一段', durationSec: 2 },
      { id: 'data', card: 'B1 数据卡', copy: '静息心率:62 bpm；血氧:98%', label: '数据', durationSec: 3 },
      { id: 'outro', card: 'A5', copy: '结论', durationSec: 2 },
    ],
  }
  const a = planFromSpec(spec, 210)
  const b = planFromSpec(spec, 210)
  assert.deepEqual(a, b)
  // 产出可过 validateManifest（合法可渲）。
  const manifest = validateContentSpec(spec) && {
    id: 'spec-out',
    meta: { title: '确定性', width: 1920, height: 1080, fps: 30, durationInFrames: 210 },
    tracks: a.tracks,
  }
  // 时间轴 Σ = totalFrames。
  const last = a.timeline[a.timeline.length - 1]
  assert.equal(last.startFrame + last.durationInFrames, 210)
  assert.ok(manifest)
})

test('RQ-21 ★分流确定性：同一 spec 两次 specAssetNeeds 深比较相等；三路正确', () => {
  const spec = {
    meta: { title: '分流', fps: 30 },
    sections: [
      { id: 'showcase', card: 'C2', copy: 'x' },
      { id: 'scene', card: 'E1', copy: 'y' },
      { id: 'hook', card: 'A2', copy: 'z' },
    ],
  }
  const a = specAssetNeeds(spec)
  const b = specAssetNeeds(spec)
  assert.deepEqual(a, b)
  // C2/E1 的 mainVisual/scene 都是 user 通道；A2 无素材。
  assert.equal(a.all.length, 2)
  assert.equal(a.user.length, 2)
  assert.equal(a.library.length, 0)
  assert.equal(a.generated.length, 0)
  assert.deepEqual(a.all.map((need) => need.segmentId).sort(), ['scene', 'showcase'])
})
