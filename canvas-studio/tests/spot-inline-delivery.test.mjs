/**
 * REQ-041 F3 边渲边传 —— P0-2 接线守卫（2026-11-27 审查）。
 *
 * 真机事故形态：spot 8 帧渲到第 5 帧把主线程按死（同步卡死）→ 25s 单帧定时器同样
 * 被阻塞 → 心跳停 → 宿主 30s 看门狗撤单 → **前 4 张已渲静帧在内存里、盘上一张没有**。
 * 根因不是 ledger 不行（`spot-upload-ledger` 的「渲出一张就立刻发」写得很清楚），而是
 * `renderSpotFramesOnWeb` 把 `onSample` 的触发放在**整批渲完之后**的回放循环里，且
 * `run.aborted` 抛在交付之前 —— 承诺与接线之间断了。
 *
 * 本文件守两层：
 * 1. **组合契约（行为断言）**：runner 的 renderOne 闭包里逐帧交 ledger —— 中途死亡时
 *    已渲帧必须已经在盘上（uploadedFrames 非空、settle 落地）；且交付必须发生在
 *    下一帧开渲之前（不是批末回放）。
 * 2. **接线守卫（剥注释源码断言，本仓既定手法）**：`src/client/remotion-render.ts`
 *    必须把 `options.onSample?.(` 放进 renderOne 闭包、且批末回放循环
 *    （`for (const entry of run.done)`）必须已经删干净 —— 换个写法回来就红。
 *    （client 源不进 `lib/`（tsconfig exclude），无法 import 行为测试，结构性弱守卫
 *    ——与 `lobby-stash.test.mjs` 同一档，但它是这条链路唯一能钉住 client 接线的手段。）
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSpotFramesWithTimeout } from '../lib/spot-frame-budget.js'
import { createSpotUploadLedger } from '../lib/spot-upload-ledger.js'

/** 手搓一个永不 resolve 的 promise（模拟「这一帧把主线程按死」）。 */
const never = () => new Promise(() => {})

/**
 * 按修复后的组合形态跑一批 spot：renderOne 字节到手就交 ledger（这正是
 * `renderSpotFramesOnWeb` 修复后的形态），返回 ledger 与事件时序。
 */
async function runWithInlineDelivery(frames, renderOneByteSource, { signal, timeoutMs = 50 } = {}) {
  const uploaded = []
  const ledger = createSpotUploadLedger(async (frame, bytes) => {
    uploaded.push({ frame, size: bytes.length })
    return undefined
  })
  const events = []
  const run = await runSpotFramesWithTimeout(frames, async (frame, frameSignal) => {
    events.push(`start:${frame}`)
    const bytes = await renderOneByteSource(frame, frameSignal)
    // ── 修复后的接线形态（P0-2）：这一帧到手就交，不等整批 ──
    if (bytes.length > 0) ledger.onSample({ frame, bytes })
    events.push(`deliver:${frame}`)
    return bytes
  }, {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  })
  return { run, ledger, uploaded, events }
}

test('P0-2 场景：第 5 帧按死 + 看门狗撤单 ⇒ 前 4 张已渲帧在盘上（不再「一张都没有」）', async () => {
  const controller = new AbortController()
  const frames = [1, 2, 3, 4, 5, 6, 7, 8]
  const bytesOf = new Uint8Array([1, 2, 3])
  const { run, ledger, uploaded } = await runWithInlineDelivery(frames, async (frame) => {
    if (frame === 5) {
      // 同步卡死形态：这一帧永不结算，直到外面撤单。
      controller.abort()
      return await never()
    }
    return bytesOf
  }, { signal: controller.signal, timeoutMs: 1000 })

  assert.equal(run.aborted, true, '撤单如实上报')
  assert.equal(uploaded.length, 4, '前 4 张必须已经交出去（边渲边传的全部意义）')
  assert.deepEqual(ledger.uploadedFrames(), [1, 2, 3, 4])
  // settle 是撤单路径的第一件事（executor catch 里先 settle 再撤单）——必须已落地。
  await ledger.settle()
  assert.equal(uploaded.length, 4, 'settle 不重不漏（ledger 按帧号去重）')
})

test('交付发生在下一帧开渲之前 —— 批末回放形态必红', async () => {
  const frames = [10, 20, 30]
  const { run, events } = await runWithInlineDelivery(frames, async () => new Uint8Array([9]), { timeoutMs: 1000 })
  assert.equal(run.aborted, false)
  assert.deepEqual(events, [
    'start:10', 'deliver:10',
    'start:20', 'deliver:20',
    'start:30', 'deliver:30',
  ], '每帧 start/deliver 交替 —— 若变回批末回放，三个 deliver 会挤在三个 start 之后')
})

test('超时丢一帧不影响已交账：跳过帧不进账本，其余照传', async () => {
  const frames = [1, 2, 3]
  const { run, ledger, uploaded } = await runWithInlineDelivery(frames, async (frame) => {
    if (frame === 2) return await never()
    return new Uint8Array([7])
  }, { timeoutMs: 30 })
  assert.equal(run.aborted, false, '单帧超时不是取消')
  assert.equal(run.skipped.length, 1)
  assert.equal(uploaded.length, 2, '1 与 3 必须在盘上')
  assert.deepEqual(ledger.uploadedFrames(), [1, 3])
})

// ── 接线守卫（client 源不进 lib/，剥注释源码断言）────────────────────────────

test('接线守卫：renderSpotFramesOnWeb 的 onSample 必须在 renderOne 闭包里逐帧交', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  // 剥注释再读 —— 注释里的示例会把接线断言喂饱（本仓接线守卫的既定手法）。
  const source = readFileSync(join(srcDir, 'client', 'remotion-render.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')

  // ① 批末回放循环必须已经删干净（它是 P0-2 的事故形态本体）。
  assert.doesNotMatch(source, /for \(const entry of run\.done\)/,
    '批末回放 run.done 是 P0-2 事故形态 —— onSample 必须在 renderOne 里逐帧交，不许换写法回来')

  // ② onSample 调用必须在 renderOne 闭包内（= 第一个 `return bytes` 之前），
  //    这同时就是「先交付后返回」的判据：切片以 `return bytes` 截断，命中即在其前。
  const runnerStart = source.indexOf('runSpotFramesWithTimeout(')
  assert.ok(runnerStart > 0, 'renderSpotFramesOnWeb 必须还在用 runSpotFramesWithTimeout')
  const closureEnd = source.indexOf('return bytes', runnerStart)
  assert.ok(closureEnd > runnerStart, 'renderOne 闭包以 return bytes 收尾（形态变了先想清楚交付时机）')
  const closure = source.slice(runnerStart, closureEnd)
  assert.match(closure, /options\.onSample\?\.\(/,
    'onSample 必须在 renderOne 闭包内触发（字节到手就交，先交付再 return bytes）')
  assert.ok(closure.search(/options\.onSample\?\.\(/) > 0,
    'onSample 必须在闭包体内（runSpotFramesWithTimeout( 之后）')
})
