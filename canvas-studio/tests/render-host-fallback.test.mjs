/**
 * RenderHost 连续不可用熔断（四季片复盘 R-03 保底层）单测 + 文案守卫。
 *
 * 状态机：连续 2 次「窗口存在但冷启超时」⇒ 跳过冷启等待直接派画布页；
 * 隐藏窗成功接管一次 ⇒ 清零；熔断后每 10 单放行一次完整等待（自愈探针）。
 * 直连 Host tsc 编译产物 `lib/render-host-fallback.js`。
 * 定向跑：node --test tests/render-host-fallback.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import {
  RENDER_HOST_REPROBE_EVERY,
  RENDER_HOST_TRIP_AFTER,
  noteRenderHostServed,
  noteRenderHostSkip,
  renderHostSkipCount,
  resetRenderHostFallbackForTests,
  shouldSkipRenderHostWait,
} from '../lib/render-host-fallback.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))

test('阈值常量口径（改阈值必须显式改这里）', () => {
  assert.equal(RENDER_HOST_TRIP_AFTER, 2)
  assert.equal(RENDER_HOST_REPROBE_EVERY, 10)
})

test('连续 2 次冷启超时 ⇒ 第 3 单起跳过等待；单次不熔断', () => {
  resetRenderHostFallbackForTests()
  assert.equal(shouldSkipRenderHostWait('p1'), false, '零记录 ⇒ 不熔断')
  noteRenderHostSkip('p1')
  assert.equal(shouldSkipRenderHostWait('p1'), false, '连续 1 次 ⇒ 仍不熔断（给窗口正常机会）')
  noteRenderHostSkip('p1')
  assert.equal(shouldSkipRenderHostWait('p1'), true, '连续 2 次 ⇒ 熔断')
  assert.equal(shouldSkipRenderHostWait('p2'), false, '按项目隔离：p2 不受 p1 影响')
})

test('隐藏窗成功接管 ⇒ 清零（窗口恢复，回到正常冷启等待）', () => {
  resetRenderHostFallbackForTests()
  noteRenderHostSkip('p1')
  noteRenderHostSkip('p1')
  assert.equal(shouldSkipRenderHostWait('p1'), true)
  noteRenderHostServed('p1')
  assert.equal(shouldSkipRenderHostWait('p1'), false, '清零后照常等待')
  assert.equal(renderHostSkipCount('p1'), 0)
})

test('自愈探针：熔断后每 10 单放行一次完整等待', () => {
  resetRenderHostFallbackForTests()
  for (let i = 0; i < 10; i += 1) noteRenderHostSkip('p1')
  // consecutive=10：10 % 10 === 0 ⇒ 放行
  assert.equal(shouldSkipRenderHostWait('p1'), false, `第 10 单应放行自愈探针（consecutive=${renderHostSkipCount('p1')}）`)
  noteRenderHostSkip('p1')
  assert.equal(shouldSkipRenderHostWait('p1'), true, 'consecutive=11 ⇒ 恢复跳过')
  assert.equal(renderHostSkipCount('p1'), 11)
})

test('文案守卫：回执不再引导模型查宿主日志；日志行与自查指引含两种写法', () => {
  // R-03/P-02：排障指引依赖「匹配不到的字符串」= 把定论证据自己滤掉。
  const renderJob = readFileSync(resolve(HERE, '..', 'src', 'remotion', 'render-job.ts'), 'utf8')
  assert.ok(renderJob.includes('已自动回退画布页执行器'), '超时回执要明说「已自动回退，可直接继续」')
  assert.ok(!renderJob.includes('先查宿主日志'), '旧文案「先查宿主日志…再决定重试」必须清零（排障是宿主侧的活）')

  const windowTs = readFileSync(join(HERE, '..', 'src', 'render-host', 'window.ts'), 'utf8')
  assert.ok(windowTs.includes('grep -aE "RenderHost|render-host"'), '自查指引给现成可粘贴命令（两种写法都匹配）')
  assert.ok(windowTs.includes('RenderHost 页面已加载（render-host window）'), '页面已加载行同时含驼峰与连字符')
})
