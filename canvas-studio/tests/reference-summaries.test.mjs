/**
 * CV-242 纯函数契约：详情面板参考句柄匹配（resolveReferenceSummaries）。
 *
 * 背景：NodeDetailDrawer 此前把「反查不中」的句柄静默 filter 丢弃——面板参考数量
 * 与 prompt 的 <Picture N> 对不上（分镜 6 提到 3 张只显示 2 张）。抽成纯函数后锁住：
 * 输出数量恒等于输入句柄数，断链句柄显式返回 node=null，由调用方渲染占位卡。
 *
 * 直连 Host tsc 产物 lib/node-params.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveReferenceSummaries } from '../lib/node-params.js'

test('CV-242：命中的句柄映射到节点，断链的句柄 node=null（不静默丢弃）', () => {
  const nodes = [
    { id: 'a', filename: 'ref-aaaabbbb.png' },
    { id: 'b', filename: 'ref-ccccdddd.png' },
  ]
  const summaries = resolveReferenceSummaries(
    ['ref-aaaabbbb.png', 'ref-7516d08b.png', 'ref-ccccdddd.png'],
    nodes,
  )
  assert.equal(summaries.length, 3, '输出数量恒等于输入句柄数')
  assert.equal(summaries[0].node.id, 'a')
  assert.equal(summaries[1].node, null, '断链句柄显式标记，不丢弃')
  assert.equal(summaries[1].name, 'ref-7516d08b.png')
  assert.equal(summaries[2].node.id, 'b')
})

test('CV-242：空句柄表返回空数组', () => {
  assert.deepEqual(resolveReferenceSummaries([], []), [])
})

test('CV-242：画布无任何节点时全部句柄判断链', () => {
  const summaries = resolveReferenceSummaries(['ref-aaaabbbb.png'], [])
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].node, null)
})
