/**
 * 渲染轮询决策表（`src/render-poll-gate.ts`）—— 2026-10-23 真机 11 连败的守卫。
 *
 * 反向变红的口径写在每个用例注释里。核心回归：**在飞的 render_composition
 * 期间，扑空绝不允许停表**（老代码一扑空就 stopRenderPoll，宿主建单又晚于
 * 最早几拍 ⇒ 工单没人认领 ⇒ CS-RENDER-TIMEOUT）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { decideRenderPollStep } = await import('../lib/render-poll-gate.js')

const step = (over) => decideRenderPollStep({
  hasProjectId: true,
  jobFound: false,
  mirrorRunning: false,
  renderRunsInFlight: 0,
  ...over,
})

test('有单必取：不管有没有在飞调用、有没有镜像', () => {
  assert.equal(step({ jobFound: true }), 'claim')
  assert.equal(step({ jobFound: true, renderRunsInFlight: 2 }), 'claim', '在飞计数不阻塞新单（host 并发 1 保证不会真并发）')
  assert.equal(step({ jobFound: true, mirrorRunning: true }), 'claim', '自己的单优先于镜像')
})

test('没单但有在飞调用 ⇒ hold（本次修复的核心行，反向变红：改成 stop 即复现 11 连败）', () => {
  assert.equal(step({ renderRunsInFlight: 1 }), 'hold')
  assert.equal(step({ renderRunsInFlight: 3, mirrorRunning: true }), 'mirror', '镜像优先：先跟住隐藏窗口的进度，不能空转刷屏')
})

test('没单、没在飞 ⇒ stop（老的「工单已结算收工」路径保持不变）', () => {
  assert.equal(step({}), 'stop')
  assert.equal(step({ mirrorRunning: true }), 'mirror', '只有镜像在跑也要跟住（隐藏窗口的单）')
})

test('项目没解析出来：在飞 ⇒ hold 等同步；不在飞 ⇒ stop', () => {
  assert.equal(step({ hasProjectId: false, renderRunsInFlight: 1 }), 'hold', '画布页刚启动时项目晚几拍才同步，不能因此放弃取单')
  assert.equal(step({ hasProjectId: false }), 'stop', '没有渲染在飞就别空转（空闲即停纪律）')
  assert.equal(step({ hasProjectId: false, jobFound: true }), 'stop', '没 projectId 就拿不到单（防御性行：jobFound 与 hasProjectId 不该同时为真）')
})
