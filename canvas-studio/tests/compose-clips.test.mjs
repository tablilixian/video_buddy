/**
 * CR-001：compose_video 缺省选片纯函数（defaultComposeClips）的单元测试。
 *
 * 回归目标：缺省选片只取「逐镜视频片段」（video_generate / video_composite），
 * 必须排除成片节点（toolName='compose'）——否则二次合成会把上一版成片当片段
 * 再拼一次，递归叠加。显式传 clipIds 时不经过此逻辑。
 *
 * 直连 Host 侧编译产物 lib/host-tools.js。运行：
 * corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultComposeClips } from '../lib/host-tools.js'

/** 构造一个最小合法视频节点。 */
function videoNode(id, { toolName = 'video_generate', createdAt = 1000 } = {}) {
  return {
    id,
    kind: 'video',
    url: `/canvas-studio/assets/p/${id}.mp4`,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    createdAt,
    origin: 'agent',
    sourceIds: [],
    toolName,
  }
}

test('defaultComposeClips：缺省选片只取逐镜片段，按生成顺序排序', () => {
  const nodes = [
    videoNode('b', { createdAt: 2000 }),
    videoNode('a', { createdAt: 1000 }),
    videoNode('c', { toolName: 'video_composite', createdAt: 3000 }),
  ]
  assert.deepEqual(defaultComposeClips(nodes), ['a', 'b', 'c'])
})

test('defaultComposeClips：排除成片节点（toolName=compose），杜绝递归叠加', () => {
  const nodes = [
    videoNode('a', { createdAt: 1000 }),
    videoNode('b', { createdAt: 2000 }),
    // 首次合成后落盘的成片节点（kind=video、toolName=compose、createdAt 最新）。
    videoNode('final', { toolName: 'compose', createdAt: 3000 }),
  ]
  assert.deepEqual(defaultComposeClips(nodes), ['a', 'b'], '成片节点不得进入缺省选片')
})

test('defaultComposeClips：非视频节点与无血缘源一律不参与', () => {
  const nodes = [
    videoNode('a', { createdAt: 1000 }),
    { ...videoNode('img', { createdAt: 1000 }), kind: 'image' },
    { ...videoNode('sticky', { createdAt: 1000 }), kind: 'sticky' },
  ]
  assert.deepEqual(defaultComposeClips(nodes), ['a'])
})

test('defaultComposeClips：空/仅成片时返回空数组（由调用方判 <2 报错）', () => {
  assert.deepEqual(defaultComposeClips([]), [])
  assert.deepEqual(defaultComposeClips([videoNode('final', { toolName: 'compose' })]), [])
})
