/**
 * §9 第 5 步 · 配方 seed 的反变异 2 / 2b（开发文档 §8）与结构断言。
 *
 * ## 反变异 2 —— pending 素材必须在**落地**时被拒
 * seed 按设计产出全 `pending` §07（记账用，不在生成时拦）。拦截的唯一位置是
 * 落地（`storyboard-land.ts` 调 `validateForSeed`，blockers 非空即 throw）。
 * 本文件用 story-arc 真 seed 走 saveStoryboard → landStoryboard 断言必 throw。
 *
 * ## 反变异 2b —— seed **生成**时不得被 validateForSeed 拦截
 * 若有人「顺手」在 recipeToStoryboardSeed 里调 validateForSeed（enforce 下
 * pending = blocker ⇒ 自己拦自己），三套有素材配方直接死锁。两道断言：
 * ① 三套 seed 直接调用必须返回；② 生成路径源码文本不含 `validateForSeed`。
 *
 * ## 附带钉住
 * bare 数组形态（wrapper 会被 normalize 静默清空）、语义 ID 形态、neededBy ⊆
 * 本批 shot、specSeed weight/durationSec 不双写、write_storyboard 描述不回潮
 * wrapper 教法（D8 同族的文档漂移断言）。
 *
 * 运行：node --test tests/recipe-seed.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recipeToStoryboardSeed } from '../lib/remotion/recipe-to-storyboard.js'
import { RECIPES } from '../lib/remotion/recipes.js'
import {
  createStoryboard,
  emptyStoryboardSections,
  validateForSeed,
} from '../lib/contracts/storyboard.js'
import { landStoryboard } from '../lib/storyboard-land.js'
import { saveStoryboard } from '../lib/storyboard-store.js'

const FPS = 30
const TOTAL = 30

function seedOf(id) {
  return recipeToStoryboardSeed({
    recipe: RECIPES[id],
    requirements: { totalSeconds: TOTAL },
    fps: FPS,
  })
}

/** seed 五节 + 空节 = 可落盘的完整 sections。 */
function fullSections(seed) {
  return { ...emptyStoryboardSections(), ...seed.sections }
}

function docFrom(seed) {
  return createStoryboard({
    projectId: 'p1',
    title: '配方 seed 测试片',
    meta: { genre: '测试', targetDuration: TOTAL, aspect: '16:9' },
    sections: fullSections(seed),
  })
}

// ────────────────────────── 反变异 2b：生成不被拦 ──────────────────────────

test('2b ①：三套有素材配方的 seed 直接调用必须返回（误用 validateForSeed 拦截则红）', () => {
  for (const id of ['product-walkthrough', 'story-arc', 'product-promo-60s']) {
    const seed = seedOf(id)
    assert.ok(seed.sections['07_assets'].length > 0, `${id} 应产出 §07 素材清单`)
    assert.ok(seed.sections['04_storyboard'].scenes.length > 0, `${id} 应产出 §04 分镜`)
  }
})

test('2b ②：生成路径源码不含 validateForSeed（防「顺手加拦截」让 seed 自己拦自己）', () => {
  const src = readFileSync(new URL('../src/remotion/recipe-to-storyboard.ts', import.meta.url), 'utf8')
  // 否定断言一律剥注释（text-guard 同款）：本文件/模块的注释里天然会提到这个词。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.ok(!code.includes('validateForSeed'),
    'recipeToStoryboardSeed 是生成器，不得调用 validateForSeed —— pending 素材的拦截在落地（storyboard-land.ts）')
})

// ────────────────────────── 反变异 2：落地必拒 ──────────────────────────

test('2 ①：story-arc seed 落盘后 landStoryboard 必须被拒（pending 素材 = 阻断项）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-recipe-seed-'))
  try {
    const project = {
      id: 'p1',
      name: 'P1',
      dir,
      createdAt: '1',
      updatedAt: '1',
      workflow: { mode: 'confirm', state: 'storyboarding' },
    }
    const canvas = { version: 1, nodes: [], assets: [] }
    const registry = {
      list: async () => [project],
      getProject: async () => project,
      storyboardFile: (id) => join(dir, `${id}.storyboard.json`),
      readCanvas: async () => structuredClone(canvas),
      writeCanvas: async () => {},
      updateWorkflow: async (_id, patch) => {
        project.workflow = { ...project.workflow, ...patch }
        return project
      },
    }
    await saveStoryboard(registry, 'p1', docFrom(seedOf('story-arc')))
    await assert.rejects(
      () => landStoryboard(registry, 'p1'),
      (error) => {
        const message = String(error?.message ?? error)
        assert.match(message, /不能落地/u, 'pending 素材必须拦住落地')
        assert.match(message, /未就绪/u, '阻断项要点名未就绪素材')
        return true
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('2 ②：validateForSeed(enforce) 对 seed 报 blocker；幽灵 neededBy 只进 warnings', () => {
  const seed = seedOf('story-arc')
  const doc = docFrom(seed)
  const enforced = validateForSeed(doc, { enforceAssetReadiness: true })
  assert.ok(enforced.blockers.some((line) => line.includes('未就绪')),
    `enforce 下 pending 必须是 blocker（实际：${enforced.blockers.join(' | ')}）`)

  // 幽灵引用：素材指了一个不存在的 shot —— 只进 warnings，不当 blocker
  // （storyboard.ts:983-988 的既定语义；转换函数自己保证 neededBy ⊆ 本批 shot）。
  const ghostSections = fullSections(seed)
  ghostSections['07_assets'] = ghostSections['07_assets'].map((asset) => ({
    ...asset,
    status: 'ready',
    neededBy: ['S999-Sh1'],
  }))
  const ghostDoc = createStoryboard({
    projectId: 'p1',
    title: '幽灵引用测试',
    meta: { genre: '测试', targetDuration: TOTAL, aspect: '16:9' },
    sections: ghostSections,
  })
  const ghost = validateForSeed(ghostDoc, { enforceAssetReadiness: true })
  assert.deepEqual(ghost.blockers, [], '幽灵 neededBy 不是 blocker')
  assert.ok(ghost.warnings.some((line) => line.includes('不存在的 shot')),
    `幽灵引用必须进 warnings（实际：${ghost.warnings.join(' | ')}）`)
})

// ────────────────────────── 结构断言 ──────────────────────────

test('结构：语义 ID 形态、neededBy ⊆ 本批 shot、frames 与 duration 同源', () => {
  for (const id of Object.keys(RECIPES)) {
    const seed = seedOf(id)
    const shots = seed.sections['04_storyboard'].scenes.flatMap((scene) => scene.shots)
    assert.ok(shots.length > 0, `${id} 必须有 shot`)
    for (const scene of seed.sections['04_storyboard'].scenes) {
      assert.match(scene.id, /^S\d+$/u, `${id} 分镜 ID 形态：${scene.id}`)
    }
    const shotIds = new Set()
    for (const shot of shots) {
      assert.match(shot.id, /^S\d+-Sh\d+$/u, `${id} shot ID 形态：${shot.id}`)
      assert.ok(shot.visual.trim() !== '' && shot.camera.trim() !== '' && shot.audio.trim() !== '',
        `${id} ${shot.id} 三要素非空`)
      assert.equal(shot.frames, Math.round(shot.duration * FPS), `${id} ${shot.id} frames 同源`)
      shotIds.add(shot.id)
    }
    for (const asset of seed.sections['07_assets']) {
      assert.equal(asset.status, 'pending', `${id} 素材必须 pending（记账，落地才拦）`)
      assert.ok(Array.isArray(seed.sections['07_assets']), '§07 必须是 bare 数组')
      for (const ref of asset.neededBy) {
        assert.ok(shotIds.has(ref), `${id} 素材「${asset.name}」neededBy 指向本批 shot（${ref}）`)
      }
    }
    assert.ok(Array.isArray(seed.sections['08_constraints']), '§08 必须是 bare 数组')
    assert.ok(seed.sections['08_constraints'].length > 0, `${id} §08 至少有结构起点约束`)
    assert.ok(seed.sections['00_creative'].brief.includes(id), '§00 brief 含配方 id（结构可审计）')
  }
})

test('零素材配方：explainer-cards 的 §07 为空数组', () => {
  const seed = seedOf('explainer-cards')
  assert.deepEqual(seed.sections['07_assets'], [])
})

test('specSeed：weight 不双写 durationSec、units/carry 留空、autoStages 不开', () => {
  const seed = seedOf('product-promo-60s')
  const { meta, sections } = seed.specSeed
  assert.equal(meta.theme, RECIPES['product-promo-60s'].theme)
  assert.equal(meta.durationSec, TOTAL)
  assert.ok(Array.isArray(sections))
  assert.equal(sections.length, RECIPES['product-promo-60s'].segments.length)
  for (const section of sections) {
    assert.ok(typeof section.weight === 'number', '只写 weight')
    assert.equal(section.durationSec, undefined, '不双写 durationSec')
  }
  assert.equal(meta.autoStages, undefined, 'autoStages 不开')
  assert.equal(seed.specSeed.units, undefined, 'units 留空')
  assert.equal(seed.specSeed.carry, undefined, 'carry 留空')
  assert.deepEqual(seed.filledSections,
    ['00_creative', '02_visual', '04_storyboard', '07_assets', '08_constraints'])
})

test('性质：全部配方 seed 的 frames = round(duration×fps)（结构自检的恒真锚）', () => {
  // 诚实说明（2026-11-27 审查 P1-5 修正）：这里**不能**测「坏数据必抛」——
  // frames/duration 由 `frames` 单源派生（duration = frames/fps），坏组合在公开 API
  // 面根本构造不出来，旧标题「写盘自检失败必须抛」名实不符（删自检照样绿 = ❌假守卫）。
  // 改为跨**全部**配方的性质断言：谁改坏了 frames/duration 的派生，这里立刻红。
  // （函数内的结构自检是防未来改动的回归锚，不是现值校验。）
  const ids = Object.keys(RECIPES)
  assert.ok(ids.length >= 4, `配方数异常（${String(ids.length)}）—— 注册表没加载全？（现为 4 套配方模板）`)
  for (const id of ids) {
    const seed = seedOf(id)
    const shots = seed.sections['04_storyboard'].scenes.flatMap((scene) => scene.shots)
    assert.ok(shots.length > 0, `${id} 的 seed 必须有 shot`)
    for (const shot of shots) {
      assert.equal(shot.frames, Math.round(shot.duration * FPS),
        `${id}/${shot.id}：frames 与 duration 不同源（派生被改坏了？）`)
    }
  }
})

// ────────────────────────── 描述漂移（D8 同族） ──────────────────────────

test('write_storyboard 描述：assets/constraints 示例必须 bare，wrapper 教法不得回潮', () => {
  const src = readFileSync(new URL('../src/host-tools.ts', import.meta.url), 'utf8')
  const start = src.indexOf("name: 'write_storyboard'")
  assert.ok(start >= 0, 'write_storyboard 工具定义必须存在')
  const end = src.indexOf('parameters:', start)
  const description = src.slice(start, end)
  // 旧形态是 `assets：{"assets":[…]}` / `constraints：{"constraints":[…]}` ——
  // wrapper 会被 normalizeStoryboard 静默清空成 []（contracts/storyboard.ts:709-710）。
  assert.ok(!/assets：\{"assets":\[/u.test(description),
    'assets 示例不得教 wrapper 形态（会被静默清空）')
  assert.ok(!/constraints：\{"constraints":\[/u.test(description),
    'constraints 示例不得教 wrapper 形态（会被静默清空）')
  assert.ok(description.includes('bare 数组'), '描述应显式点名 bare 数组')
})
