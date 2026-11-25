/**
 * REQ-041 L2/L3（2026-11-25）· 客户端段媒体接线（纯逻辑 + 信号，行为断言）。
 *
 * 反向变异：改成按 id 建索引 ⇒ 「只按 ref」用例红；URL 不加 ?v= ⇒ 缓存版本用例红；
 * 信号只发第一个监听器 / 抛错中断 ⇒ 「结算刷新」用例红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { segmentMediaByRefOf } from '../lib/segment-media-map.js'
import { disposeSegmentMediaSignal, notifySegmentMediaRefresh, subscribeSegmentMediaRefresh } from '../lib/segment-media-signal.js'

const ITEMS = [
  { id: 's1', ref: 'spec:s1', url: '/canvas-studio/assets/p/seg-s1.mp4', startFrame: 0, frames: 10, durationSec: 0.33, v: 111 },
  { id: 'seg-2', ref: 'spec:第二屏', url: '/canvas-studio/assets/p/seg-seg-2.mp4', startFrame: 10, frames: 10, durationSec: 0.33, v: 222 },
  { id: 's3', url: '/canvas-studio/assets/p/seg-s3.mp4', startFrame: 20, frames: 10, durationSec: 0.33, v: 333 },
]

test('只按 ref 建索引：清洗后的 id 不参与；没有 ref 的历史段不显示', () => {
  const map = segmentMediaByRefOf(ITEMS)
  assert.deepEqual([...map.keys()], ['spec:s1', 'spec:第二屏'])
  assert.equal(map.get('spec:第二屏'), '/canvas-studio/assets/p/seg-seg-2.mp4?v=222')
  assert.equal(map.get('s3'), undefined, '禁止按 id / 序号瞎配')
  assert.equal(map.get('spec:seg-2'), undefined, '禁止从产物 id 反推 ref')
})

test('URL 带 mtimeMs 版本串，覆盖写同名文件也能破已解码媒体的缓存', () => {
  const map = segmentMediaByRefOf(ITEMS)
  assert.equal(map.get('spec:s1'), '/canvas-studio/assets/p/seg-s1.mp4?v=111')
  assert.equal(segmentMediaByRefOf([]).size, 0)
})

test('渲染结算信号：多订阅者都收到；只通知目标项目；单个监听器抛错不中断', () => {
  disposeSegmentMediaSignal()
  const seen = []
  const off1 = subscribeSegmentMediaRefresh((pid) => { seen.push(`a:${pid}`) })
  const off2 = subscribeSegmentMediaRefresh((pid) => { seen.push(`b:${pid}`); throw new Error('listener bug') })
  const off3 = subscribeSegmentMediaRefresh((pid) => { seen.push(`c:${pid}`) })
  notifySegmentMediaRefresh('p1')
  assert.deepEqual(seen, ['a:p1', 'b:p1', 'c:p1'])
  notifySegmentMediaRefresh('p2')
  assert.deepEqual(seen.slice(3), ['a:p2', 'b:p2', 'c:p2'])
  off1(); off2(); off3()
  disposeSegmentMediaSignal()
  notifySegmentMediaRefresh('p3')
  assert.equal(seen.length, 6, '取消订阅后不再收到')
})
