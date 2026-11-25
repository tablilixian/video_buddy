/**
 * REQ-041 · F3：spot 探针的「一帧卡死带走整批」修复 —— 守卫。
 *
 * 真机事故（2026-11-25 会话 `session-3140fcd3`，第 2 轮）：
 *
 *   `render_composition({ quality:"draft", spotFrames:[150,480,750,990,1230,1470,1720,1970,2250] })`
 *   连试 3 次，3 次全红，文案都是
 *   「隐藏窗口 31s 内既没有心跳也没有进度（渲染器被卡住）… 已渲染 32s，进度 50%」
 *
 * 事实链：前 4 张静帧已渲出 → 第 5 帧把主线程按死 → 宿主 30s 看门狗判死整张工单 →
 * **已渲好的 4 张一起被扔掉**（回执只有「请重试」）→ 模型以为一张都没有，退回整片
 * draft 硬猜。另有一个静默问题：9 帧超过契约上限 8，`normalizeSpotFrames` 悄悄截断，
 * 模型以为 9 处都验过了。
 *
 * 本文件钉住四件事：
 * 1. 单帧超时只丢那一帧，且文案带帧号（`runSpotFramesWithTimeout`）；
 * 2. 单帧预算必须早于隐藏窗口判失联阈值，否则连「是哪一帧」都来不及写；
 * 3. 执行器**边渲边传**：渲出一张就先回写宿主，后续卡死也只剩最后一张没落盘；
 * 4. `spotFrames` 超过 8 帧在入口拒收（不再静默丢帧）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runSpotFramesWithTimeout,
  SPOT_FRAME_DELAYRENDER_TIMEOUT_MS,
  SPOT_FRAME_TIMEOUT_MS,
} from '../lib/spot-frame-budget.js'
import { RENDER_HOST_STALE_MS } from '../lib/render-host/status.js'
import { assertSpotFrameCount } from '../lib/host-tools.js'
import { createSpotUploadLedger } from '../lib/spot-upload-ledger.js'
import { MAX_SPOT_FRAMES } from '../lib/remotion/spot-frames.js'

const never = () => new Promise(() => {})

// ─────────────────── 1. 单帧卡死不带走整批 ───────────────────

test('F3：某帧卡住 ⇒ 只丢这一帧，其余照渲，且文案点名帧号', async () => {
  const run = await runSpotFramesWithTimeout([10, 20, 30], async (frame) => {
    if (frame === 20) return await never()
    return `img-${frame}`
  }, { timeoutMs: 40 })
  assert.deepEqual(run.done.map((entry) => entry.frame), [10, 30], '卡住的那帧之外的帧必须留下（真机是 8 张全丢）')
  assert.equal(run.done[1].value, 'img-30')
  assert.equal(run.skipped.length, 1)
  assert.equal(run.skipped[0].frame, 20)
  assert.equal(run.skipped[0].reason, 'timeout')
  assert.match(run.skipped[0].message, /第 20 帧/, '文案必须点名帧号，否则模型不知道该换哪一帧')
  assert.equal(run.aborted, false, '超时不是「调用方取消」')
})

test('F3：超时会把这一帧的 signal abort 掉（别让它在后台继续按住主线程）', async () => {
  let frameSignal
  const run = await runSpotFramesWithTimeout([7], (frame, signal) => {
    frameSignal = signal
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }, { timeoutMs: 30 })
  assert.equal(frameSignal.aborted, true)
  assert.equal(run.skipped[0].reason, 'timeout')
  assert.deepEqual(run.done, [])
})

test('F3：帧内报错只丢这一帧，且带帧号与原因', async () => {
  const run = await runSpotFramesWithTimeout([1, 2, 3], async (frame) => {
    if (frame === 2) throw new Error('素材 404')
    return frame
  }, { timeoutMs: 200 })
  assert.deepEqual(run.done.map((entry) => entry.frame), [1, 3])
  assert.equal(run.skipped[0].reason, 'error')
  assert.match(run.skipped[0].message, /第 2 帧渲染失败/)
  assert.match(run.skipped[0].message, /404/)
})

test('F3：调用方取消 ⇒ 立刻停，已渲出的帧照样带出去，后续帧不再开渲', async () => {
  const controller = new AbortController()
  const calls = []
  const run = await runSpotFramesWithTimeout([1, 2, 3], async (frame) => {
    calls.push(frame)
    controller.abort()
    return frame
  }, { timeoutMs: 200, signal: controller.signal })
  assert.equal(run.aborted, true)
  assert.deepEqual(run.done.map((entry) => entry.frame), [1])
  assert.deepEqual(calls, [1], '取消之后不该再开下一帧')
  assert.deepEqual(run.skipped, [], '取消不是「帧失败」')
})

// ─────────────────── 2. 预算与看门狗的顺序不变式 ───────────────────

test('F3：单帧预算必须早于判失联阈值（否则看门狗先杀单，帧号写不下来）', () => {
  assert.ok(
    SPOT_FRAME_TIMEOUT_MS < RENDER_HOST_STALE_MS,
    `单帧预算 ${SPOT_FRAME_TIMEOUT_MS}ms 必须小于 RENDER_HOST_STALE_MS(${RENDER_HOST_STALE_MS}ms)`,
  )
  assert.ok(
    SPOT_FRAME_DELAYRENDER_TIMEOUT_MS < SPOT_FRAME_TIMEOUT_MS,
    'Remotion 的 delayRender 闸门要比硬预算先响（它才能干净地释放资源）',
  )
})

// ─────────────────── 3. 边渲边传（上传账本） ───────────────────

test('F3：渲出一张就先发一次上传（不攒批）', () => {
  const uploaded = []
  const ledger = createSpotUploadLedger(async (frame) => {
    uploaded.push(frame)
    return `/canvas-studio/assets/p/sample-${frame}.jpg`
  })
  ledger.onSample({ frame: 10, bytes: new Uint8Array([1]) })
  assert.deepEqual(uploaded, [10], '第一张渲出来就必须已经在路上 —— 攒批会在卡死时全丢')
  ledger.onSample({ frame: 20, bytes: new Uint8Array([1]) })
  assert.deepEqual(uploaded, [10, 20])
  // 第 30 帧卡死 ⇒ 渲染实现抛错，账本里已发出的 20 张照样在宿主侧落盘。
  ledger.fillMissing([{ frame: 10, bytes: new Uint8Array([1]) }, { frame: 20, bytes: new Uint8Array([1]) }])
  assert.deepEqual(uploaded, [10, 20], '同一帧只传一次（渲完的补传与 onSample 必然重叠）')
  assert.deepEqual(ledger.uploadedFrames(), [10, 20])
})

test('F3：settle 会等已发出的上传落地（撤单前不能把在飞的字节丢掉）', async () => {
  const settled = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const ledger = createSpotUploadLedger(async (frame) => {
    await gate
    settled.push(frame)
  })
  ledger.onSample({ frame: 5, bytes: new Uint8Array([1]) })
  const waiting = ledger.settle()
  assert.deepEqual(settled, [], '上传还没落地')
  release()
  await waiting
  assert.deepEqual(settled, [5], 'settle 之后必须已经落地')
})

test('F3：一次上传失败不毁整张工单（settle 不抛）', async () => {
  const ledger = createSpotUploadLedger(async (frame) => {
    if (frame === 20) throw new Error('disk full')
    return '/ok.jpg'
  })
  ledger.onSample({ frame: 10, bytes: new Uint8Array([1]) })
  ledger.onSample({ frame: 20, bytes: new Uint8Array([1]) })
  await ledger.settle()
})

// ─────────────────── 4. 帧数超上限在入口拒收 ───────────────────

test('F3：spotFrames 超过 8 帧 ⇒ CS-USER-ERR（不再静默截断）', () => {
  const nine = [150, 480, 750, 990, 1230, 1470, 1720, 1970, 2250]
  let caught
  try {
    assertSpotFrameCount(nine)
  } catch (error) {
    caught = error
  }
  assert.ok(caught, '9 帧必须拒收（旧实现静默截到 8，模型以为 9 处都验过）')
  assert.equal(caught.code, 'CS-USER-ERR')
  assert.match(caught.message, /最多 8 帧/)
  assert.match(caught.message, /9/, '文案要报出实际条数')
  assert.match(caught.message, /自动补/, '要告诉模型 0 帧 / 边界帧不必自己填')
  assert.doesNotThrow(() => assertSpotFrameCount(nine.slice(0, MAX_SPOT_FRAMES)))
})
