/**
 * P9.1 时间轴排序持久化 契约测试。
 *
 * 1. normalizeCanvasView：timeline 字段的合法往返与非法丢弃（旧文档兼容）。
 * 2. deriveTimelineOrder：持久化顺序优先、已删节点剔除、新节点按 createdAt
 *    追加、无 timeline 时整体按 createdAt 派生。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCanvasView, deriveTimelineOrder } from '../lib/canvas-view.js'

function node(id, createdAt, extra = {}) {
  return {
    id,
    kind: 'video',
    url: `/assets/${id}.mp4`,
    x: 0,
    y: 0,
    width: 260,
    height: 180,
    createdAt,
    origin: 'agent',
    sourceIds: [],
    ...extra,
  }
}

test('normalizeCanvasView：timeline 合法数组保留，非法/缺失丢弃', () => {
  const view = normalizeCanvasView({ x: 1, y: 2, scale: 1, layersOpen: false, minimapVisible: false, timeline: ['b', 'a'] })
  assert.deepEqual(view?.timeline, ['b', 'a'])

  const mixed = normalizeCanvasView({ timeline: ['b', 3] })
  assert.equal(mixed?.timeline, undefined, '混入非字符串应整体丢弃')

  const legacy = normalizeCanvasView({})
  assert.equal(legacy?.timeline, undefined, '旧文档无该字段应保持缺失（兼容）')
})

test('deriveTimelineOrder：持久化顺序优先，剔除已删除节点', () => {
  const nodes = [node('a', 1), node('b', 2), node('c', 3)]
  const ordered = deriveTimelineOrder(nodes, ['c', 'a', 'ghost'])
  assert.deepEqual(ordered.map(n => n.id), ['c', 'a', 'b'], 'ghost 应被剔除；未入列的 b 按 createdAt 追加在后')
})

test('deriveTimelineOrder：重复 id 只保留一次；新节点追加到末尾', () => {
  const nodes = [node('a', 1), node('b', 2)]
  const ordered = deriveTimelineOrder(nodes, ['a', 'a'])
  assert.deepEqual(ordered.map(n => n.id), ['a', 'b'])

  const withNew = deriveTimelineOrder([node('a', 1), node('b', 2), node('new', 0)], ['b', 'a'])
  assert.deepEqual(withNew.map(n => n.id), ['b', 'a', 'new'], 'new 不在持久化列表，createdAt 最小也应追加在末尾')
})

test('deriveTimelineOrder：无 timeline 时整体按 createdAt 派生（旧文档兼容）', () => {
  const nodes = [node('late', 9), node('early', 1), node('mid', 5)]
  const ordered = deriveTimelineOrder(nodes, undefined)
  assert.deepEqual(ordered.map(n => n.id), ['early', 'mid', 'late'])
  // 空画布安全。
  assert.deepEqual(deriveTimelineOrder([], ['x']), [])
})

/* ==== DD-04a：真时间轴布局数学（src/timeline-layout.ts 唯一权威） ==== */

import {
  FALLBACK_CLIP_S,
  clipIdAt,
  clipTotalSeconds,
  niceRulerMax,
  planClipLayout,
  playheadLeftPct,
  playheadPx,
  rulerTicks,
} from '../lib/timeline-layout.js'

test('DD-04a 布局：片段宽度比例 = duration / 总时长（设计稿数学期望固化）', () => {
  const spans = planClipLayout([
    { id: 'a', duration: 3 },
    { id: 'b', duration: 1 },
    { id: 'c', duration: 6 },
  ])
  const total = 10
  for (const span of spans) {
    const duration = { a: 3, b: 1, c: 6 }[span.id]
    assert.ok(
      Math.abs(span.widthPct - duration / total * 100) < 1e-9,
      `${span.id} 宽度应为 ${duration / total * 100}%，实得 ${span.widthPct}`,
    )
    assert.ok(
      Math.abs(span.leftPct - span.start / niceRulerMax(total) * 100) < 1e-9,
      'left 应等于起点秒相对标尺的百分比',
    )
  }
})

test('DD-04a 布局：片段首尾相接无重叠无间隙；未探测时长按占位宽且 measured=false', () => {
  const spans = planClipLayout([
    { id: 'a', duration: 2.5 },
    { id: 'ghost' },
    { id: 'c', duration: 4 },
  ])
  assert.equal(spans[1].measured, false, '无真值不得谎称实测')
  assert.equal(spans[1].span, FALLBACK_CLIP_S)
  assert.equal(spans[1].start, 2.5)
  assert.equal(spans[2].start, 2.5 + FALLBACK_CLIP_S)
  for (let i = 1; i < spans.length; i++) {
    assert.equal(spans[i].start, spans[i - 1].start + spans[i - 1].span, `片段 ${i} 应紧接上一段末尾`)
  }
  assert.equal(clipTotalSeconds([{ id: 'a', duration: 2.5 }, { id: 'ghost' }, { id: 'c', duration: 4 }]), 7.5)
})

test('DD-04a 播放头：位置 = 进度 × 可用宽度（越界夹紧）；百分比换算一致', () => {
  assert.equal(playheadPx(0.25, 800), 200)
  assert.equal(playheadPx(-1, 800), 0, '负进度夹到 0')
  assert.equal(playheadPx(2, 800), 800, '超进度夹到右端')
  assert.equal(playheadLeftPct(5, 10), 50)
  assert.equal(playheadLeftPct(99, 10), 100, '时间越界夹到标尺右端')
  assert.equal(playheadLeftPct(5, 0), 0, '空时间轴不产生 NaN')
})

test('DD-04a 标尺：rulerMax 向上取整到刻度步长；刻度数量可读', () => {
  assert.equal(niceRulerMax(10.7), 12, '10.7 → 步长 2 → 12')
  assert.equal(niceRulerMax(0), 0)
  assert.equal(niceRulerMax(75), 80, '75 → 步长 10 → 80')
  const ticks = rulerTicks(12)
  assert.deepEqual(ticks.map(t => t.t), [0, 2, 4, 6, 8, 10, 12])
  assert.ok(rulerTicks(60).length <= 12, '刻度数量必须可读')
})

test('DD-04a 联动：播放头时间命中片段判定（含左闭右开边界）', () => {
  const spans = planClipLayout([{ id: 'a', duration: 3 }, { id: 'b', duration: 3 }])
  assert.equal(clipIdAt(0, spans), 'a')
  assert.equal(clipIdAt(2.9, spans), 'a')
  assert.equal(clipIdAt(3, spans), 'b', '左闭右开：3s 归下一段')
  assert.equal(clipIdAt(99, spans), undefined, '超出总时长不命中')
})
