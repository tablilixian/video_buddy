/**
 * REQ-038 R7-R8（E2）· **渲染器卡死有界自动重试**单测。
 *
 * 三条纪律必须同时成立：
 * ① **卡死才重试且只 1 次** —— watchdog 的「render host heartbeat lost」形态静默重试
 *    一次（成功带 recovered 标记 + 免打扰说明）；第二次仍失败才浮出并注明已自动重试；
 * ② **其他失败零重试** —— 非 CS-RENDER-002 / 非 heartbeat 形态（如「从未取单」要用户
 *    把画布页摆前台）自动重试是纯浪费（P0-2 病史：34 次失败全在第一档，重试白烧 28 分钟）；
 * ③ **用户取消不重试** —— signal aborted 即刻抛出。
 *
 * 直连 Host tsc 编译产物（注入 runner，不起真窗口）。定向跑：node --test tests/req038-r7-render-retry.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCanvasError } from '../lib/error-system.js'
import { isStuckRenderFailure, runRenderJobWithStuckRetry } from '../lib/remotion/render-job.js'

const STUCK = () => makeCanvasError('CS-RENDER-002', {
  message: '渲染窗口异常：隐藏窗口 31s 内既没有心跳也没有进度（渲染器被卡住），已中止本次渲染。请重试。',
  detail: 'render host heartbeat lost for 31s',
})
const OK = { url: 'u', assetFile: 'a', duration: 3, warnings: [], quality: 'draft', frames: [] }

test('isStuckRenderFailure：只认 CS-RENDER-002 + heartbeat 形态', () => {
  assert.equal(isStuckRenderFailure(STUCK()), true)
  assert.equal(isStuckRenderFailure(makeCanvasError('CS-RENDER-002', {
    message: '画布页已取走这张单，但 30s 内一帧都没有渲染',
    detail: 'client claimed but produced no progress',
  })), false, '「从未取单/取单没动」要用户摆前台，自动重试是 P0-2 病史里的纯浪费')
  assert.equal(isStuckRenderFailure(makeCanvasError('CS-RENDER-TIMEOUT', { message: '超时', detail: 'x' })), false)
  assert.equal(isStuckRenderFailure(new Error('plain')), false)
})

test('卡死 → 静默重试一次成功：recovered 标记 + 免打扰说明', async () => {
  let calls = 0
  const outcome = await runRenderJobWithStuckRetry({}, () => {
    calls += 1
    if (calls === 1) throw STUCK()
    return OK
  })
  assert.equal(calls, 2, '必须恰好重试 1 次')
  assert.equal(outcome.recovered, true)
  assert.ok(outcome.warnings.some((warning) => warning.includes('已自动重试恢复')),
    '回执必须带免打扰说明（用户无需处理）')
})

test('非卡死失败零重试（一次都不再跑）', async () => {
  let calls = 0
  await assert.rejects(
    runRenderJobWithStuckRetry({}, () => {
      calls += 1
      throw makeCanvasError('CS-RENDER-002', { message: '画布页从未取单', detail: 'client never claimed' })
    }),
    /从未取单/,
  )
  assert.equal(calls, 1, '其他失败形态不得重试')
})

test('卡死两次：第二次仍失败才浮出，文案注明已自动重试', async () => {
  let calls = 0
  await assert.rejects(
    runRenderJobWithStuckRetry({}, () => {
      calls += 1
      throw STUCK()
    }),
    /已自动重试 1 次仍失败/,
  )
  assert.equal(calls, 2, '恰好 2 次（1 原始 + 1 重试），不做无底洞')
})

test('用户取消（signal aborted）不重试', async () => {
  let calls = 0
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runRenderJobWithStuckRetry({ signal: controller.signal }, () => {
      calls += 1
      throw STUCK()
    }),
    /渲染器被卡住|已中止/,
  )
  assert.equal(calls, 1, 'aborted 信号下不重试')
})
