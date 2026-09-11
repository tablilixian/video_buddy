/**
 * CV-006/007：合成选择纯函数（compose-selection.ts）单测。
 *
 * 覆盖：排除过滤 / 作废片段剔除（retired + supersededBy 双路径）/ 全排除 /
 * BGM 有效命中与三类失效回退（不存在 / 非音频 / 作废）/ 软提示的 0.05s 容差
 * 边界（差 0.05 不提示、差 0.06 提示）/ 无 duration 片段按 0 计。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveComposeSelection, BGM_TOLERANCE_SECONDS, isComposableClip, isComposedFilm,
} from '../lib/compose-selection.js'
import { defaultComposeClips } from '../lib/host-tools.js'

/** 造一个最小可用节点（只带 compose-selection 用到的字段）。 */
function node(overrides = {}) {
  return {
    id: 'n',
    kind: 'video',
    x: 0,
    y: 0,
    width: 260,
    height: 180,
    createdAt: 0,
    origin: 'manual',
    sourceIds: [],
    ...overrides,
  }
}

const CLIPS = [
  node({ id: 'v1', duration: 5.17 }),
  node({ id: 'v2', duration: 10.33 }),
  node({ id: 't1', kind: 'text', text: '文案' }),
]

test('全纳入：只收 video，非媒体与排除无关地不进 clipIds，estSeconds = Σ 真值', () => {
  const result = resolveComposeSelection({ ordered: CLIPS, excluded: [] })
  assert.deepEqual(result.clipIds, ['v1', 'v2'])
  assert.ok(Math.abs(result.estSeconds - 15.5) < 1e-9)
  assert.equal(result.warnings.length, 0)
  assert.equal(result.bgmInvalid, false)
  assert.equal(result.bgmNode, undefined)
})

test('排除过滤：被勾掉的片段不进 clipIds，estSeconds 同步减少', () => {
  const result = resolveComposeSelection({ ordered: CLIPS, excluded: ['v1'] })
  assert.deepEqual(result.clipIds, ['v2'])
  assert.ok(Math.abs(result.estSeconds - 10.33) < 1e-9)
})

test('作废片段剔除：retired 与 supersededBy 两条失效路径都不进 clipIds', () => {
  const ordered = [
    node({ id: 'v1', duration: 5 }),
    node({ id: 'v2', duration: 5, retired: true }),
    node({ id: 'v3', duration: 5, supersededBy: 'v1' }),
  ]
  const result = resolveComposeSelection({ ordered, excluded: [] })
  assert.deepEqual(result.clipIds, ['v1'])
  assert.equal(result.estSeconds, 5)
})

test('全排除：clipIds 空、estSeconds 0（按钮禁用语义由 UI 层负责）', () => {
  const result = resolveComposeSelection({ ordered: CLIPS, excluded: ['v1', 'v2'] })
  assert.deepEqual(result.clipIds, [])
  assert.equal(result.estSeconds, 0)
})

test('BGM 有效命中：audio 存活节点 → bgmNode 返回该节点', () => {
  const bgm = node({ id: 'a1', kind: 'audio', duration: 16.02 })
  const result = resolveComposeSelection({ ordered: [...CLIPS, bgm], excluded: [], bgmNodeId: 'a1' })
  assert.equal(result.bgmNode?.id, 'a1')
  assert.equal(result.bgmInvalid, false)
})

test('BGM 失效回退：不存在 / 非音频 / 作废 / 被取代 → bgmNode undefined 且 bgmInvalid = true', () => {
  const bgm = node({ id: 'a1', kind: 'audio', duration: 16.02 })
  const deadBgm = node({ id: 'a2', kind: 'audio', retired: true })
  const supersededBgm = node({ id: 'a3', kind: 'audio', supersededBy: 'a1' })
  const ordered = [...CLIPS, bgm, deadBgm, supersededBgm]
  for (const badId of ['ghost', 'v1', 'a2', 'a3']) {
    const result = resolveComposeSelection({ ordered, excluded: [], bgmNodeId: badId })
    assert.equal(result.bgmNode, undefined, badId)
    assert.equal(result.bgmInvalid, true, badId)
  }
})

test('软提示容差边界：BGM 比 est 恰好短 0.05s 不提示，短 0.06s 提示且含精确差额', () => {
  // 排除 v1，让 est 恰为 10.33（v2 的真值），容差边界才能对得上。
  const est = 10.33
  const atTolerance = node({ id: 'a1', kind: 'audio', duration: est - BGM_TOLERANCE_SECONDS })
  const belowTolerance = node({ id: 'a2', kind: 'audio', duration: est - BGM_TOLERANCE_SECONDS - 0.01 })
  const quiet = resolveComposeSelection({
    ordered: [...CLIPS, atTolerance], excluded: ['v1'], bgmNodeId: 'a1',
  })
  assert.equal(quiet.warnings.length, 0)
  const warned = resolveComposeSelection({
    ordered: [...CLIPS, belowTolerance], excluded: ['v1'], bgmNodeId: 'a2',
  })
  assert.equal(warned.warnings.length, 1)
  assert.match(warned.warnings[0], /0\.06s/)
})

test('BGM 长于成片或成片为空：都不提示；无 duration 的片段按 0 计入 est', () => {
  const longBgm = node({ id: 'a1', kind: 'audio', duration: 30 })
  const probed = resolveComposeSelection({ ordered: [...CLIPS, longBgm], excluded: [], bgmNodeId: 'a1' })
  assert.equal(probed.warnings.length, 0)
  const noDuration = [node({ id: 'v9' }), longBgm]
  const zeroEst = resolveComposeSelection({ ordered: noDuration, excluded: [], bgmNodeId: 'a1' })
  assert.deepEqual(zeroEst.clipIds, ['v9'])
  assert.equal(zeroEst.estSeconds, 0)
  assert.equal(zeroEst.warnings.length, 0)
})

// ---- CV-160：成片产物不是片段（口径唯一性 + 回归） ----

test('CV-160：成片节点（kind=video + toolName=compose）不进 clipIds、不计入预计时长', () => {
  // 桌面实测场景：上一版成片 15.48s + 3 个真实片段 5.17s。
  // 修复前 est = 30.99s（成片被当成片段重复计入），修复后 = 15.51s。
  const ordered = [
    node({ id: 'f1', duration: 15.48, toolName: 'compose', title: '成片 2026/9/11' }),
    node({ id: 'v1', duration: 5.17, toolName: 'video_generate' }),
    node({ id: 'v2', duration: 5.17, toolName: 'video_generate' }),
    node({ id: 'v3', duration: 5.17, toolName: 'video_generate' }),
  ]
  const result = resolveComposeSelection({ ordered, excluded: [] })
  assert.deepEqual(result.clipIds, ['v1', 'v2', 'v3'])
  assert.ok(Math.abs(result.estSeconds - 15.51) < 1e-9, `est 应为 15.51，实际 ${result.estSeconds}`)
})

test('CV-160：video_composite（多图合成镜）仍是合法片段——只排除 toolName=compose', () => {
  const ordered = [
    node({ id: 'c1', duration: 5, toolName: 'video_composite' }),
    node({ id: 'f1', duration: 20, toolName: 'compose' }),
  ]
  assert.deepEqual(resolveComposeSelection({ ordered, excluded: [] }).clipIds, ['c1'])
})

test('CV-160：isComposedFilm 只认 kind=video + toolName=compose', () => {
  assert.equal(isComposedFilm(node({ id: 'f', toolName: 'compose' })), true)
  assert.equal(isComposedFilm(node({ id: 'v', toolName: 'video_generate' })), false)
  assert.equal(isComposedFilm(node({ id: 'v', toolName: 'video_composite' })), false)
  assert.equal(isComposedFilm(node({ id: 'a', kind: 'audio', toolName: 'compose' })), false)
})

test('CV-160 护栏：时间轴口径与 Host 缺省选片口径必须同集合（防再次分叉）', () => {
  // 这次事故的根因就是「同一规则两处各写一份」，只改一处就静默分叉。
  const mixed = [
    node({ id: 'shot1', duration: 5.17, toolName: 'video_generate', createdAt: 1 }),
    node({ id: 'shot2', duration: 15.48, toolName: 'video_composite', createdAt: 2 }),
    node({ id: 'film', duration: 20.65, toolName: 'compose', createdAt: 3 }),
    node({ id: 'old', duration: 5.17, toolName: 'video_generate', createdAt: 4, supersededBy: 'shot1' }),
    node({ id: 'dead', duration: 5.17, toolName: 'video_generate', createdAt: 5, retired: true }),
    node({ id: 'img', kind: 'image', createdAt: 6 }),
    node({ id: 'bgm', kind: 'audio', createdAt: 7 }),
  ]
  const fromTimeline = mixed.filter(isComposableClip).map(item => item.id).sort()
  const fromHost = [...defaultComposeClips(mixed)].sort()
  assert.deepEqual(fromHost, ['shot1', 'shot2'], '成片 / 失效版本 / 非视频都不算片段')
  assert.deepEqual(fromTimeline, fromHost, '时间轴与 /compose 缺省选片必须同口径')
})
