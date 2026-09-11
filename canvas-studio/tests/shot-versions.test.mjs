/**
 * CV-108 镜位版本链与失效标注：契约层与工具层测试。
 *
 * 覆盖：有效判定 / 输入指纹（含无锚点拒绝判重）/ 取代规划（自动指纹 + 显式
 * replaces）/ 打标 / 恢复旧版时接管者作废 / 合成默认选片排除失效片段 /
 * list_shots 输出。
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

test('取代规划：同一分镜卡下的不同子镜互不取代', () => {
  const card = ['card-s2']
  const closeA = videoShot('a', { filenames: ['chen.png'], duration: 5, shotNodeIds: card })
  const closeB = videoShot('b', { filenames: ['zhao.png'], duration: 5, shotNodeIds: card })
  const plan = planSupersede([closeA, closeB], { toolName: 'video_composite', filenames: ['zhou.png'], duration: 5, shotNodeIds: card })
  assert.deepEqual(plan.supersedeIds, [], '关键帧不同 = 另一个子镜，不是新版本')
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
