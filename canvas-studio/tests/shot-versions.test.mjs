/**
 * CV-108 镜位版本链与失效标注：契约层与工具层测试。
 *
 * 覆盖：有效判定 / 输入指纹（含无锚点拒绝判重）/ 取代规划（自动指纹 + 显式
 * replaces）/ CV-277 镜位锚点集（多参考图跨镜不再串链，同镜重跑仍自动取代）/ 打标 /
 * 恢复旧版时接管者作废 / 合成默认选片排除失效片段 / list_shots 输出。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applySupersede,
  isActiveShot,
  latestActiveOf,
  planSupersede,
  shotAnchorCardsOf,
  shotFingerprintOf,
  shotFingerprintOfNode,
  shotStatusOf,
  toggleRetire,
} from '../lib/shot-versions.js'
import { createStudioTools, defaultComposeClips } from '../lib/host-tools.js'

function shotNode(overrides = {}) {
  return {
    id: 'shot-1',
    kind: 'video',
    url: '/assets/a.mp4',
    x: 0,
    y: 0,
    width: 480,
    height: 270,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    toolName: 'video_composite',
    ...overrides,
  }
}

/** 造一个带 generationPrompt（生成参数 JSON）的视频节点，指纹可被反推。 */
function videoShot(id, params, overrides = {}) {
  return shotNode({
    id,
    ...(params.duration !== undefined ? { duration: params.duration } : {}),
    generationPrompt: JSON.stringify(params),
    ...overrides,
  })
}

test('有效判定：未被取代且未作废才算有效', () => {
  assert.equal(isActiveShot(shotNode()), true)
  assert.equal(shotStatusOf(shotNode({ supersededBy: 'x' })), 'superseded')
  assert.equal(shotStatusOf(shotNode({ retired: true })), 'retired')
  assert.equal(isActiveShot(shotNode({ retired: true, supersededBy: 'x' })), false, '两者同时存在也是失效')
})

test('输入指纹：同参数同指纹；无锚点时拒绝判重', () => {
  const a = shotFingerprintOf({ toolName: 'video_composite', filenames: ['k1.png', 'k2.png'], duration: 5, shotNodeIds: ['card-1'] })
  const b = shotFingerprintOf({ toolName: 'video_composite', filenames: ['k2.png', 'k1.png'], duration: 5, shotNodeIds: ['card-1'] })
  assert.equal(a, b, '参考图顺序不同应归一')
  assert.notEqual(a, shotFingerprintOf({ toolName: 'video_composite', filenames: ['k1.png', 'k2.png'], duration: 8, shotNodeIds: ['card-1'] }), '时长不同应区分')
  assert.notEqual(a, shotFingerprintOf({ toolName: 'video_composite', filenames: ['k1.png', 'k9.png'], duration: 5, shotNodeIds: ['card-1'] }), '参考图不同应区分')
  assert.equal(shotFingerprintOf({ toolName: 'video_generate', duration: 5 }), '', '纯文生视频无锚点，不做自动判重')
})

test('节点指纹：从 generationPrompt 反推，与生成时同源', () => {
  const params = { prompt: 'x', filenames: ['k1.png'], duration: 5, shotNodeIds: ['card-1'] }
  const node = videoShot('shot-1', params)
  assert.equal(shotFingerprintOfNode(node), shotFingerprintOf({ toolName: 'video_composite', ...params }))
  assert.equal(shotFingerprintOfNode(shotNode()), '', '无 generationPrompt 不 panic')
  assert.equal(shotFingerprintOfNode(shotNode({ generationPrompt: '{ 坏 JSON' })), '', '坏 JSON 不 panic')
})

test('取代规划：同参数重复生成自动取代并递增版本', () => {
  const params = { filenames: ['k1.png', 'k2.png'], duration: 5, shotNodeIds: ['card-1'] }
  const v1 = videoShot('v1', params, { shotVersion: 1 })
  const plan = planSupersede([v1], { toolName: 'video_composite', ...params })
  assert.deepEqual(plan.supersedeIds, ['v1'])
  assert.equal(plan.version, 2, '首版被取代 → 新版本号为 2')

  const v2 = videoShot('v2', params, { shotVersion: 2 })
  const plan2 = planSupersede([{ ...v1, supersededBy: 'v2' }, v2], { toolName: 'video_composite', ...params })
  assert.deepEqual(plan2.supersedeIds, ['v2'], '旧版已失效时只取代当前有效版')
  assert.equal(plan2.version, 3, '沿版本链递增')
})

test('取代规划：改了关键帧（指纹不同）时靠显式 replaces', () => {
  const v1 = videoShot('v1', { filenames: ['k1.png'], duration: 5, shotNodeIds: ['card-1'] }, { shotVersion: 1 })
  const newParams = { filenames: ['k1-v2.png'], duration: 5, shotNodeIds: ['card-1'] }
  assert.deepEqual(planSupersede([v1], { toolName: 'video_composite', ...newParams }).supersedeIds, [], '指纹不同不自动取代')
  const plan = planSupersede([v1], { toolName: 'video_composite', ...newParams }, 'v1')
  assert.deepEqual(plan.supersedeIds, ['v1'])
  assert.equal(plan.version, 2)
  assert.deepEqual(planSupersede([v1], { toolName: 'video_composite', ...newParams }, '不存在的 id').supersedeIds, [], 'replaces 指错不误伤')
})

// CV-159：图片侧只吃显式 replaces（样张重出取代旧样张），不做指纹判重。
test('取代规划：图片 replaces 只取代图片节点且不做指纹判重', () => {
  const img1 = { ...shotNode({ id: 'img1', shotVersion: 1 }), kind: 'image', isReference: true }
  const vid = shotNode({ id: 'vid1' })
  // 显式 replaces 命中图片节点 → 取代
  const plan = planSupersede([img1, vid], {}, 'img1', 'image')
  assert.deepEqual(plan.supersedeIds, ['img1'])
  assert.equal(plan.version, 2)
  // replaces 指到视频节点 → 种类不匹配，不误伤
  assert.deepEqual(planSupersede([img1, vid], {}, 'vid1', 'image').supersedeIds, [], '图片 replaces 不得取代视频节点')
  // 图片不做指纹判重：同 toolName + 同 filename 也不自动取代
  const params = { prompt: 'x', filename: 'k1.png' }
  assert.deepEqual(planSupersede([img1], { toolName: 'image_generate', ...params }, undefined, 'image').supersedeIds, [], '参考图多版本是有意的，不自动判重')
  // 反向也不误伤：视频规划的 replaces 指到图片 → 忽略
  assert.deepEqual(planSupersede([img1], { toolName: 'video_generate' }, 'img1').supersedeIds, [], '视频 replaces 不得取代图片节点')
})

// CV-222（2026-09-21 拍板）：镜位级自动取代。旧语义「同卡不同参考图 = 不同
// 子镜可并存」被推翻 —— 罗大佑画布分镜 11 重跑换参考组合后新旧两条活动视频
// 并列，会一起进 defaultComposeClips 重复拼镜；并行变体的合法消费改走「旧版
// 灰显恢复」与显式 clipIds。
test('取代规划（CV-222）：同镜位换参考组合的重跑自动取代旧版', () => {
  const card = { id: 'card-s2', kind: 'text', title: '分镜 2', x: 0, y: 0, width: 360, height: 220, createdAt: 1, toolName: 'submit_storyboard_for_approval', origin: 'agent', sourceIds: [] }
  // 真实画布形态：视频的 sourceIds 里含分镜卡（消费边）
  const v1 = videoShot('v1', { filenames: ['chen.png'], duration: 5, shotNodeIds: ['card-s2'] }, { sourceIds: ['card-s2'], shotVersion: 1 })
  // 罗大佑分镜 11 场景：重跑换了参考组合 ⇒ 指纹不同，旧机制漏判
  const plan = planSupersede([card, v1], { toolName: 'video_composite', filenames: ['zhao.png'], duration: 5, shotNodeIds: ['card-s2'] })
  assert.deepEqual(plan.supersedeIds, ['v1'], '同镜位重跑不再依赖指纹相同或 agent 自觉传 replaces')
  assert.equal(plan.version, 2)
})

test('取代规划（CV-222）：不同镜位互不误伤；成片与已失效版本排除', () => {
  const card1 = { id: 'card-1', kind: 'text', title: '分镜 1', x: 0, y: 0, width: 360, height: 220, createdAt: 1, toolName: 'submit_storyboard_for_approval', origin: 'agent', sourceIds: [] }
  const card2 = { id: 'card-2', kind: 'text', title: '分镜 2', x: 400, y: 0, width: 360, height: 220, createdAt: 2, toolName: 'submit_storyboard_for_approval', origin: 'agent', sourceIds: [] }
  const shot1 = videoShot('shot-1', { filenames: ['k1.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['card-1'] })
  const shot2 = videoShot('shot-2', { filenames: ['k2.png'], duration: 5, shotNodeIds: ['card-2'] }, { sourceIds: ['card-2'] })
  const composed = shotNode({ id: 'film', toolName: 'compose', sourceIds: ['card-1'] })
  const oldShot1 = videoShot('shot-1-old', { filenames: ['k0.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['card-1'], supersededBy: 'shot-1' })
  const plan = planSupersede([card1, card2, shot1, shot2, composed, oldShot1], { toolName: 'video_composite', filenames: ['k1-v2.png'], duration: 5, anchorShotCardIds: ['card-1'] })
  assert.deepEqual(plan.supersedeIds, ['shot-1'], '分镜 2 的视频与成片、已失效旧版都不动')
})

test('取代规划（CV-222）：无锚点不触发（纯文生视频不互相误伤）；错 id 不验证通过', () => {
  const v1 = videoShot('v1', { prompt: 'x', duration: 5 })
  // 新视频没有任何分镜卡锚点（无 anchorShotCardIds、shotNodeIds 为空）→ 不取代
  assert.deepEqual(planSupersede([v1], { toolName: 'video_generate', duration: 5 }).supersedeIds, [])
  // shotNodeIds 指向的节点存在但不是分镜卡 → 现场验证不过，不触发
  const sticky = shotNode({ id: 'sticky-1', kind: 'sticky', toolName: undefined })
  assert.deepEqual(planSupersede([sticky, v1], { toolName: 'video_generate', duration: 5, shotNodeIds: ['sticky-1'] }).supersedeIds, [])
  // shotNodeIds 指向真实分镜卡 → 触发（现场验证通道）
  const card = shotNode({ id: 'card-1', kind: 'text', toolName: 'submit_storyboard_for_approval', sourceIds: [] })
  const withCard = videoShot('v2', { prompt: 'x', duration: 5 }, { sourceIds: ['card-1'] })
  assert.deepEqual(planSupersede([card, withCard], { toolName: 'video_generate', duration: 5, shotNodeIds: ['card-1'] }).supersedeIds, ['v2'])
})

test('取代规划（CV-222）：镜位级与显式 replaces 取并集，版本沿最大链递增', () => {
  const card = { id: 'card-1', kind: 'text', title: '分镜 1', x: 0, y: 0, width: 360, height: 220, createdAt: 1, toolName: 'submit_storyboard_for_approval', origin: 'agent', sourceIds: [] }
  const v1 = videoShot('v1', { filenames: ['k1.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['card-1'], shotVersion: 1 })
  const v2 = videoShot('v2', { filenames: ['k2.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['card-1'], shotVersion: 2 })
  // agent 显式只声明取代 v1，但镜位级判定会把 v2 一并收进来
  const plan = planSupersede([card, v1, v2], { toolName: 'video_composite', filenames: ['k3.png'], duration: 5, anchorShotCardIds: ['card-1'] }, 'v1')
  assert.deepEqual([...plan.supersedeIds].sort(), ['v1', 'v2'])
  assert.equal(plan.version, 3, '被取代者最大版本 +1')
})

// ── CV-277：多参考图跨镜导致镜位级取代退化为全局串链 ──────────────────
// 现场：揽月湾 3 镜，每镜按 shot-format.md 第 9 步传 3 张参考图（本镜关键帧 +
// 别镜关键帧 + Look 样张），CV-031 继承把两张分镜卡都写进 sourceIds ⇒
// 「血缘含同一张卡即取代」让 6 条视频串成 v1→v6 单链、5 条误标废弃，
// 其中 2 条实际已在成片里（defaultComposeClips 只剩 1 条 ⇒ UI 导出得单镜残片）。

/** 造分镜卡：kind=text + toolName=submit_storyboard_for_approval（isCanvasNode 口径）。 */
function storyboardCard(id, title) {
  return { id, kind: 'text', title, x: 0, y: 0, width: 360, height: 220, createdAt: 1, toolName: 'submit_storyboard_for_approval', origin: 'agent', sourceIds: [] }
}

test('CV-277：血缘多卡交叉时不再互取代（揽月湾串链回归）', () => {
  const c1 = storyboardCard('card-1', '分镜 1 · 大远景')
  const c2 = storyboardCard('card-2', '分镜 2 · 中景')
  const c3 = storyboardCard('card-3', '分镜 3 · 中近景')
  // 真实形态：显式 shotRefs 只声明本镜，血缘里却有本镜 + 别镜两张卡
  const v1 = videoShot('v1', { filenames: ['k1.png', 'k2.png', 'look.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['k1', 'k2', 'look', 'card-1', 'card-2'] })
  const v2 = videoShot('v2', { filenames: ['k2.png', 'k1.png', 'look.png'], duration: 5, shotNodeIds: ['card-2'] }, { sourceIds: ['k2', 'k1', 'look', 'card-2', 'card-1'] })
  const v3 = videoShot('v3', { filenames: ['k3.png', 'k1.png', 'look.png'], duration: 5, shotNodeIds: ['card-3'] }, { sourceIds: ['k3', 'k1', 'look', 'card-3', 'card-1'] })
  const nodes = [c1, c2, c3, v1, v2, v3]

  // 镜 3 提交新一条：显式声明 card-3
  const plan = planSupersede(nodes, {
    toolName: 'video_composite', filenames: ['k3b.png', 'k1.png', 'look.png'], duration: 5, shotNodeIds: ['card-3'],
  })
  assert.deepEqual(plan.supersedeIds, ['v3'], '只取代镜 3 自己；镜 1 / 镜 2 携带的血缘卡不得牵连')
  assert.equal(plan.version, 2, '镜 3 是首版（无 shotVersion 记为 1），新版为 2')
})

test('CV-277：同镜位换参考组合重跑仍自动取代（CV-222 原语义不回归）', () => {
  const c1 = storyboardCard('card-1', '分镜 1 · 大远景')
  const c2 = storyboardCard('card-2', '分镜 2 · 中景')
  // 镜 1 两条：血缘同样含 card-2（都引用了镜 2 关键帧），但显式声明都是 card-1
  const v1 = videoShot('v1', { filenames: ['k1.png', 'k2.png', 'look.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['k1', 'k2', 'look', 'card-1', 'card-2'], shotVersion: 1 })
  const other = videoShot('other', { filenames: ['k2.png', 'k1.png', 'look.png'], duration: 5, shotNodeIds: ['card-2'] }, { sourceIds: ['k2', 'k1', 'look', 'card-2', 'card-1'] })
  // 镜 1 返工：换参考图 + 改时长（指纹必不同），显式声明仍是 card-1
  const plan = planSupersede([c1, c2, v1, other], {
    toolName: 'video_composite', filenames: ['k1-v2.png', 'k2.png', 'look.png'], duration: 8, shotNodeIds: ['card-1'],
  })
  assert.deepEqual(plan.supersedeIds, ['v1'], '同镜位（显式同卡）仍自动取代旧版')
  assert.equal(plan.version, 2)
})

test('CV-277：漏传 shotRefs 时仅唯一血缘卡可判镜位，多张拒绝自动取代', () => {
  const c1 = storyboardCard('card-1', '分镜 1 · 大远景')
  const c2 = storyboardCard('card-2', '分镜 2 · 中景')
  // 旧节点漏传 shotRefs 且血缘挂了两张卡 ⇒ 判不准归属，拒绝自动取代
  const ambiguous = videoShot('ambiguous', { filenames: ['k1.png', 'k2.png', 'look.png'], duration: 5 }, { sourceIds: ['k1', 'k2', 'card-1', 'card-2'] })
  // 旧节点漏传 shotRefs 但血缘恰好一张卡 ⇒ 唯一可判，回退采纳（保住 CV-031 价值）
  const unique = videoShot('unique', { filenames: ['k2.png', 'look.png'], duration: 5 }, { sourceIds: ['k2', 'look', 'card-2'] })

  const planAmbiguous = planSupersede([c1, c2, ambiguous], {
    toolName: 'video_composite', filenames: ['k2b.png', 'look.png'], duration: 5, shotNodeIds: ['card-2'],
  })
  assert.deepEqual(planAmbiguous.supersedeIds, [], '锚点无法唯一确定的旧节点不被自动取代（需显式 replaces）')

  const planUnique = planSupersede([c1, c2, unique], {
    toolName: 'video_composite', filenames: ['k2b.png', 'look.png'], duration: 8, shotNodeIds: ['card-2'],
  })
  assert.deepEqual(planUnique.supersedeIds, ['unique'], '血缘唯一卡仍能锚定镜位（CV-031 兜底不退化）')
})

test('CV-277：无任何分镜卡锚点时拒绝镜位级取代（纯文生视频不互相误伤）', () => {
  const a = videoShot('a', { prompt: 'x', duration: 5 }, { sourceIds: [] })
  const b = videoShot('b', { prompt: 'y', duration: 5 }, { sourceIds: [] })
  const plan = planSupersede([a, b], { toolName: 'video_generate', duration: 5, filenames: ['p1.png'] })
  assert.deepEqual(plan.supersedeIds, [], '无锚点 ⇒ 指纹不同且镜位级不触发，两条并存')
})

test('CV-277：锚点解析以显式声明为准，血缘多卡不参与（shotAnchorCardsOf 契约）', () => {
  const c1 = storyboardCard('card-1', '分镜 1')
  const c2 = storyboardCard('card-2', '分镜 2')
  const nodes = [c1, c2]
  // 显式声明 card-1，血缘含 card-1 + card-2 ⇒ 取显式单卡
  const explicit = videoShot('v1', { filenames: ['k.png'], duration: 5, shotNodeIds: ['card-1'] }, { sourceIds: ['k', 'card-1', 'card-2'] })
  assert.deepEqual([...shotAnchorCardsOf(explicit, nodes)], ['card-1'])
  // 显式为空、血缘两张 ⇒ 空集（拒绝）
  const ambiguous = videoShot('v2', { filenames: ['k.png'], duration: 5 }, { sourceIds: ['k', 'card-1', 'card-2'] })
  assert.deepEqual([...shotAnchorCardsOf(ambiguous, nodes)], [])
  // 显式为空、血缘一张 ⇒ 该卡
  const inherited = videoShot('v3', { filenames: ['k.png'], duration: 5 }, { sourceIds: ['k', 'card-2'] })
  assert.deepEqual([...shotAnchorCardsOf(inherited, nodes)], ['card-2'])
  // 显式传了非分镜卡 id（现场验证不过）⇒ 视为无声明，回退血缘
  const bogus = videoShot('v4', { filenames: ['k.png'], duration: 5, shotNodeIds: ['not-a-card'] }, { sourceIds: ['k', 'card-1'] })
  assert.deepEqual([...shotAnchorCardsOf(bogus, nodes)], ['card-1'])
})


test('打标与恢复：恢复旧版时接管者自动作废', () => {
  const v1 = shotNode({ id: 'v1', shotVersion: 1, supersededBy: 'v2' })
  const v2 = shotNode({ id: 'v2', shotVersion: 2 })
  const nodes = [v1, v2]

  const restored = toggleRetire(nodes, 'v1')
  assert.equal(isActiveShot(restored[0]), true, '旧版复活')
  assert.equal(restored[0].supersededBy, undefined, '取代标记已清除')
  assert.equal(restored[1].retired, true, '接管者自动作废，避免同镜两份同时进成片')

  const retiredAgain = toggleRetire(restored, 'v2')
  assert.equal(retiredAgain[1].retired, undefined, '再切回来清除作废')

  const retired = toggleRetire(nodes, 'v2')
  assert.equal(retired[1].retired, true, '手动作废当前有效版')
  assert.deepEqual(toggleRetire(nodes, '不存在'), nodes, '未知 id 原样返回')
})

test('版本链追踪：沿 supersededBy 找到当前有效版（成环不死锁）', () => {
  const v1 = shotNode({ id: 'v1', supersededBy: 'v2' })
  const v2 = shotNode({ id: 'v2', supersededBy: 'v3' })
  const v3 = shotNode({ id: 'v3' })
  assert.equal(latestActiveOf([v1, v2, v3], 'v1')?.id, 'v3')
  assert.equal(latestActiveOf([v1, v2, v3], 'v3')?.id, 'v3')
  assert.equal(latestActiveOf([shotNode({ id: 'loop', supersededBy: 'loop' })], 'loop'), undefined, '自环返回 undefined')
})

test('打标：被取代节点写入 supersededBy，其余节点不动', () => {
  const nodes = [shotNode({ id: 'a' }), shotNode({ id: 'b' })]
  const patched = applySupersede(nodes, 'c', ['a'])
  assert.equal(patched[0].supersededBy, 'c')
  assert.equal(patched[1].supersededBy, undefined)
  assert.equal(nodes[0].supersededBy, undefined, '不改原数组')
})

// ---------------------------------------------------------------------------
// 工具层：合成默认选片 + list_shots
// ---------------------------------------------------------------------------
function stubRegistry(nodes, dir) {
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => dir,
    readCanvas: async () => ({ version: 3, nodes }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
  }
}

const EXEC = (dir) => ({ signal: undefined, agent: { session: { header: { cwd: dir } } } })

test('defaultComposeClips：排除失效片段与成片节点', () => {
  const nodes = [
    shotNode({ id: 'old', createdAt: 1, supersededBy: 'new' }),
    shotNode({ id: 'new', createdAt: 2 }),
    shotNode({ id: 'retired', createdAt: 3, retired: true }),
    shotNode({ id: 'composed', createdAt: 4, toolName: 'compose' }),
    { ...shotNode({ id: 'img', createdAt: 5 }), kind: 'image' },
  ]
  assert.deepEqual(defaultComposeClips(nodes), ['new'], '只收当前有效片段（按生成顺序）')
})

test('list_shots：默认只列有效片段，带版本号与分镜卡；可含失效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-shots-'))
  try {
    const card = { id: 'card-1', kind: 'text', title: '分镜 S2 · 特写', url: undefined, x: 0, y: 0, width: 10, height: 10, createdAt: 0, origin: 'agent', sourceIds: [], toolName: 'submit_storyboard_for_approval' }
    const nodes = [
      card,
      shotNode({ id: 'v1', createdAt: 1, duration: 5, sourceIds: ['card-1'], shotVersion: 1, supersededBy: 'v2' }),
      shotNode({ id: 'v2', createdAt: 2, duration: 5, sourceIds: ['card-1'], shotVersion: 2 }),
    ]
    const tools = createStudioTools(stubRegistry(nodes, dir), 3005)
    const listShots = tools.find((tool) => tool.name === 'list_shots')
    assert.ok(listShots !== undefined, 'list_shots 工具应已注册')

    const active = await listShots.execute({}, EXEC(dir))
    assert.deepEqual(active.shots.map((shot) => shot.id), ['v2'], '默认只列有效片段')
    assert.equal(active.shots[0].version, 2)
    assert.equal(active.shots[0].status, 'active')
    assert.equal(active.shots[0].shotCard, '分镜 S2 · 特写')

    const all = await listShots.execute({ includeRetired: true }, EXEC(dir))
    assert.deepEqual(all.shots.map((shot) => shot.id), ['v1', 'v2'])
    assert.equal(all.shots[0].status, 'superseded')
    assert.equal(all.shots[0].supersededBy, 'v2')

    const text = listShots.output.render({}, all)[0].text
    assert.match(text, /v1（已失效）/, '渲染文本标出失效版本')
    assert.match(text, /id=v2/, '渲染文本带节点 id 供 clipIds 引用')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// CV-159：样张重出取代旧样张——image_generate 暴露 replaces + list_references 过滤失效参考。
test('CV-159：image_generate 暴露 replaces，list_references 默认滤掉失效参考', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-refs-'))
  try {
    const refImage = (id, overrides = {}) => ({
      ...shotNode({ id, createdAt: 1 }), kind: 'image', isReference: true, referenceRole: 'image',
      title: `样张-${id}`, url: `/assets/${id}.png`, ...overrides,
    })
    const nodes = [
      refImage('img-old', { createdAt: 1, supersededBy: 'img-new' }),
      refImage('img-new', { createdAt: 2 }),
      refImage('img-retired', { createdAt: 3, retired: true }),
    ]
    const tools = createStudioTools(stubRegistry(nodes, dir), 3005)

    const imageGen = tools.find((tool) => tool.name === 'image_generate')
    assert.ok(imageGen !== undefined, 'image_generate 工具应已注册')
    assert.ok(imageGen.parameters.properties.replaces !== undefined, 'image_generate 应暴露 replaces 参数（样张重出的取代入口）')

    const listRefs = tools.find((tool) => tool.name === 'list_references')
    assert.ok(listRefs !== undefined, 'list_references 工具应已注册')
    const active = await listRefs.execute({}, EXEC(dir))
    assert.deepEqual(active.references.map((r) => r.title), ['样张-img-new'], '失效参考默认不列（不占参考位）')

    const all = await listRefs.execute({ includeRetired: true }, EXEC(dir))
    assert.deepEqual(all.references.map((r) => r.title), ['样张-img-old', '样张-img-new', '样张-img-retired'])
    assert.deepEqual(all.references.map((r) => r.status), ['superseded', 'active', 'retired'], '带失效列表时逐项给状态')

    const text = listRefs.output.render({}, all)[0].text
    assert.match(text, /已被新版取代/, '渲染文本标出被取代')
    assert.match(text, /已作废/, '渲染文本标出手动作废')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
