/**
 * REQ-034 · O-13：草稿成片「后一版替换前一版」。
 *
 * 真机症状：7 次成功渲染 ⇒ 画布上 7 个 video-composite 节点并排（6 个 draft:true，
 * 各约 1MB），用户要手工清，画布随迭代线性膨胀。草稿是**一次性预览**，历史价值为 0；
 * 交付档必须留版本链（CV-108）供对比回滚 —— 所以只对 draft 做就地替换。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendComposedVideoNode } from '../lib/compose.js'

function fakeRegistry(initial) {
  const state = { nodes: [...initial] }
  return {
    state,
    async readCanvas() {
      return { nodes: [...state.nodes], view: undefined, assets: [] }
    },
    async writeCanvas(_projectId, next) {
      state.nodes = [...next]
    },
    async appendCanvasNode(_projectId, node) {
      state.nodes = [...state.nodes, node]
    },
  }
}

const DRAFT = {
  id: 'draft-1',
  kind: 'video',
  title: '草稿成片 10:00:00',
  url: '/canvas-studio/assets/p1/old.mp4',
  x: 640,
  y: 320,
  width: 480,
  height: 270,
  createdAt: 1000,
  toolName: 'compose',
  origin: 'agent',
  sourceIds: ['shot-1'],
  operationType: 'video-composite',
  draft: true,
  shotVersion: 1,
}

test('第二次草稿渲染：就地替换 —— 节点数不变、id 与位置不变、url 与血缘更新', async () => {
  const registry = fakeRegistry([DRAFT])
  const node = await appendComposedVideoNode(registry, 'p1', {
    url: '/canvas-studio/assets/p1/new.mp4',
    duration: 12,
    width: 1280,
    height: 720,
    sourceIds: ['shot-2'],
    draft: true,
  })
  assert.equal(node.id, 'draft-1', '草稿必须复用同一节点，不能堆新卡')
  assert.equal(registry.state.nodes.length, 1, '画布上只保留一个草稿预览节点')
  assert.equal(node.url, '/canvas-studio/assets/p1/new.mp4')
  assert.deepEqual(node.sourceIds, ['shot-2'])
  assert.equal(node.x, 640, '用户手动摆过的位置不能被替换动作重置')
  assert.equal(node.y, 320)
  assert.equal(node.mediaWidth, 1280)
  assert.equal(node.shotVersion, 2, '替换后版本号仍要递增（可审计「第几版预览」）')
  assert.equal(node.draft, true)
})

test('首次草稿（画布无草稿）：正常 append 一个新节点，标题带「草稿成片」', async () => {
  const registry = fakeRegistry([])
  const node = await appendComposedVideoNode(registry, 'p1', { url: '/a.mp4', sourceIds: ['shot-1'], draft: true })
  assert.equal(registry.state.nodes.length, 1)
  assert.match(node.title, /^草稿成片 /)
  assert.equal(node.draft, true)
  assert.equal(node.shotVersion, 1)
})

test('交付档渲染：仍走 append + supersede（草稿节点退场，版本链留档）', async () => {
  const registry = fakeRegistry([DRAFT])
  const node = await appendComposedVideoNode(registry, 'p1', { url: '/final.mp4', sourceIds: ['shot-1'] })
  assert.notEqual(node.id, 'draft-1', '交付档必须是新节点（要能回滚对比）')
  assert.equal(registry.state.nodes.length, 2)
  const oldDraft = registry.state.nodes.find((candidate) => candidate.id === 'draft-1')
  assert.equal(oldDraft.supersededBy, node.id, '定稿后草稿节点应标记为被取代')
  assert.equal(node.draft, undefined, '交付档不带 draft 标')
  assert.match(node.title, /^成片 /)
})

test('版本号对全部成片求最大值：上一版被取代后新版继续递增（不从 1 重来）', async () => {
  const superseded = { ...DRAFT, id: 'compose-old', draft: undefined, shotVersion: 5, supersededBy: 'compose-newer' }
  const newer = { ...DRAFT, id: 'compose-newer', draft: undefined, shotVersion: 6 }
  const registry = fakeRegistry([superseded, newer])
  const node = await appendComposedVideoNode(registry, 'p1', { url: '/next.mp4', sourceIds: ['shot-1'] })
  assert.equal(node.shotVersion, 7)
})
