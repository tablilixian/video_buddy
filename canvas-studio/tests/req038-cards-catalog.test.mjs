/**
 * 卡注册表**全量可编译守卫**(REQ-038 SSR 消化批)。
 *
 * 抓的是「注册了但生成不了合法轨道」的卡:每张注册卡用 mock ctx 跑 generate,
 * 产物过 validateManifest 必须 0 error —— 双路径(素材给到 / 素材缺席的降级路径)
 * 都要过。以后任何新卡注册进来自动被本守卫覆盖,「编译不过的卡」不可能悄悄入库。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registeredCardIds, getCard } from '../lib/remotion/recipe-cards-all.js'
import { validateManifest } from '../lib/remotion/manifest.js'

/** mock ctx:素材声明了就给示例同源 URL(主路径),否则 undefined(降级路径)。 */
function mockCtx(card, withAssets) {
  const slots = {}
  for (const decl of card.assets) slots[decl.slot] = withAssets ? '/canvas-studio/assets/demo/shot.png' : undefined
  return {
    segmentId: `seg-${card.id.toLowerCase()}`,
    label: card.title,
    copy: '第一卖点；第二卖点；第三卖点',
    startFrame: 0,
    durationInFrames: 120,
    index: 0,
    sectionCount: 1,
    assetSrc: (slot) => slots[slot],
    accentColor: '#4f9cf9',
  }
}

const manifestOf = (tracks) => ({
  id: 'card-guard',
  meta: { title: 'guard', width: 1920, height: 1080, fps: 30, durationInFrames: 600 },
  tracks,
})

test('全卡守卫：每张注册卡的主路径(素材到位)产物过 validateManifest', () => {
  const ids = registeredCardIds()
  assert.ok(ids.length >= 20, `注册卡应 ≥20(旧基线 10 + 消化批),实际 ${ids.length}`)
  const failures = []
  for (const id of ids) {
    const card = getCard(id)
    try {
      const tracks = card.generate(mockCtx(card, true))
      const check = validateManifest(manifestOf(tracks))
      if (check.errors.length > 0) failures.push(`${id}: ${check.errors[0]}`)
    } catch (error) {
      failures.push(`${id}: ${error.message}`)
    }
  }
  assert.deepEqual(failures, [], `${failures.length} 张卡编译不过:\n${failures.join('\n')}`)
})

test('全卡守卫：素材缺席的降级路径同样过校验(不阻断)', () => {
  const failures = []
  for (const id of registeredCardIds()) {
    const card = getCard(id)
    if (card.assets.length === 0) continue // 无素材卡没有降级路径
    try {
      const tracks = card.generate(mockCtx(card, false))
      const check = validateManifest(manifestOf(tracks))
      if (check.errors.length > 0) failures.push(`${id}: ${check.errors[0]}`)
    } catch (error) {
      failures.push(`${id}: ${error.message}`)
    }
  }
  assert.deepEqual(failures, [], `降级路径不过:\n${failures.join('\n')}`)
})

test('全卡守卫：轨 id 前缀带段 id(同段多轨不撞车、跨段不冲突)', () => {
  for (const id of registeredCardIds()) {
    const card = getCard(id)
    const tracks = card.generate(mockCtx(card, true))
    for (const track of tracks) {
      assert.ok(String(track.id).startsWith(`seg-${id.toLowerCase()}-`), `${id} 的轨 id "${track.id}" 不带段前缀 —— 跨段会撞 id`)
    }
  }
})

test('全卡守卫：确定性(同 ctx 两次 generate 逐字节相同)', () => {
  for (const id of registeredCardIds()) {
    const card = getCard(id)
    const a = JSON.stringify(card.generate(mockCtx(card, true)))
    const b = JSON.stringify(card.generate(mockCtx(card, true)))
    assert.equal(a, b, `${id} 生成不确定(检查随机源/时钟)`)
  }
})
