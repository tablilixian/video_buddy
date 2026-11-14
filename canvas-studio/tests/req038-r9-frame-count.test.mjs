/**
 * REQ-038 R9-P2b（#4，D5 拍板 v1 软计数）· **渲染次数软计数**单测。
 *
 * 三条纪律必须同时成立：
 * ① **只统计不拦截** —— 计数进回执（含本次），>12 才追加转定稿建议；硬口径挂账（K3）；
 * ② **会话键隔离** —— 不同会话各自计数（与预算闸同键位口径：args.projectId 优先，
 *    缺省落会话键，再缺省落兜底桶）；
 * ③ **口径覆盖全部返回抽帧的渲染** —— probe / spotFrames / 普通渲染一视同仁。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r9-frame-count.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameCountNote, frameRenderCount, noteFrameRender } from '../lib/render-probe-budget.js'

test('frameCountNote：≤12 只报数，>12 追加转定稿建议（阈值钉死）', () => {
  const one = frameCountNote(1)
  assert.match(one, /第 1 次/)
  assert.ok(!one.includes('偏高'), '≤12 不给建议（不制造常驻噪音）')
  const twelve = frameCountNote(12)
  assert.match(twelve, /第 12 次/)
  assert.ok(!twelve.includes('偏高'))
  const thirteen = frameCountNote(13)
  assert.match(thirteen, /第 13 次/)
  assert.match(thirteen, /渲染次数偏高/)
  assert.match(thirteen, /转定稿/)
})

test('计数递增 + 会话键隔离（不同会话互不串）', () => {
  const a = { projectId: undefined }
  const n1 = noteFrameRender(a, 'sess-A')
  const n2 = noteFrameRender(a, 'sess-A')
  assert.equal(n2, n1 + 1, '同会话递增')
  const b = noteFrameRender(a, 'sess-B')
  assert.equal(b, 1, '另一会话从 1 起（键隔离）')
  assert.equal(frameRenderCount(a, 'sess-A'), n2)
  assert.equal(frameRenderCount(a, 'sess-B'), 1)
})

test('兜底桶：无会话键时落同一兜底桶（与预算闸同口径）', () => {
  const n1 = noteFrameRender({}, undefined)
  const n2 = noteFrameRender({}, undefined)
  assert.equal(n2, n1 + 1)
})
