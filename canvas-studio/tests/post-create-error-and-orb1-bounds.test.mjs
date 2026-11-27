/**
 * P1-5 / P1-8（2026-11-27 审查）：
 *
 * - **P1-5**：`CS-GEN-206`（终态 failed/canceled 的通用包装）此前漏出
 *   `POST_CREATE_ERROR_CODES` —— 它的 message 内嵌服务端 error.message，命中兜底
 *   正则（`invalid|filename|参考图`…）的概率不低 ⇒ 句柄自愈把「生成失败」改写成
 *   「素材失效」，再白跑一轮必败任务（212 事件同款故障模式）。且 `httpStatus`
 *   分支此前**优先于**码表判断，带 httpStatus 的终态码会绕过排除集。
 * - **P1-8**：ORB1 椭圆折线的采样段数写反成 `Math.max(total, budget)` ——
 *   `periodSec≤2` 叠加大半径/短段时 bounds 铺出轨长，卡内自检抛 CS-DEV-ERR，
 *   合法输入把整卡生成打成「产品缺陷」。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isBadReferenceError } from '../lib/generate.js'
import { makeCanvasError } from '../lib/error-system.js'
import { getCard } from '../lib/remotion/recipe-cards-all.js'
import { mockCtx } from '../scripts/gen-card-catalog.mjs'
import '../lib/errors/catalog.js'

// ─────────────────── P1-5：终态码不进句柄自愈 ───────────────────

test('P1-5：终态 206 不自愈、创建期 206（带 httpStatus）照常自愈 —— 两种 206 必须分家', () => {
  // ① 终态包装（assertGenerationSucceeded，带 phase:'terminal'）：任务已建好、
  //    失败在轮询终态 —— message 内嵌服务端 error.message（invalid/filename 高命中），
  //    但重传句柄救不了（212 事件同款故障模式）。
  const terminal = makeCanvasError('CS-GEN-206', {
    detail: 'terminal=failed not_found: invalid filename: img_00852_.png',
    phase: 'terminal',
  })
  assert.equal(isBadReferenceError(terminal), false, '终态失败 ≠ 句柄失效，不许改写成素材失效')

  // ② 创建期非 2xx（businessErrorToGenerationError，带 httpStatus）：CV-238 的
  //    结构化判据 —— 400/404/5xx = 句柄可能失效，**必须**能自愈（一刀切排除会
  //    把 7 条自愈回归打红）。
  const createPhase = makeCanvasError('CS-GEN-206', {
    safe: 'image2vl 生成失败：请求失败（HTTP 500）',
    detail: 'internal（HTTP 500）：boom',
    httpStatus: 500,
  })
  assert.equal(isBadReferenceError(createPhase), true, '创建期 500 照常触发一轮重传')

  // ③ 创建后包装码（无 httpStatus）一律不自愈。
  assert.equal(isBadReferenceError(makeCanvasError('CS-NET-012', { attempts: 3 })), false, '产物字节不完整不自愈')
  assert.equal(isBadReferenceError(makeCanvasError('CS-GEN-212', { detail: '参考图数量超限' })), false, '212 回归：文案带参考图也不许改写')

  // ④ 无标记 206（既无 phase 也无 httpStatus）：保守不自愈。
  assert.equal(isBadReferenceError(makeCanvasError('CS-GEN-206', { detail: 'invalid filename' })), false)
})

test('P1-5：真·创建期句柄错误照常判（别把自愈修没了）', () => {
  assert.equal(isBadReferenceError(new Error('HTTP 400: invalid filename supplied')), true, '创建期 400 照常自愈')
  assert.equal(isBadReferenceError(new Error('HTTP 404 not found')), true)
  assert.equal(isBadReferenceError(new Error('文件不存在：参考图 missing')), true)
  assert.equal(isBadReferenceError(new Error('something unrelated')), false, '无关错误不许触发重传')
})

// ─────────────────── P1-8：ORB1 时间线不许自爆 ───────────────────

/** 极值组合（审查 P1-8 的复现条件）：periodSec 小 ⇒ k 大 ⇒ total 溢出预算。 */
function orb1Tracks({ durationInFrames, data }) {
  const card = getCard('ORB1')
  const ctx = {
    ...mockCtx(card, '轨道演示：近地点', '轨道'),
    durationInFrames,
    fps: 30,
    data,
  }
  return card.generate(ctx)
}

test('P1-8：periodSec=1 + 大半径 + 150 帧 ⇒ 生成不抛、折线窗不越轨长', () => {
  // 复现审查算例：dur=150、hold≈12、rx=26 ⇒ n≈36、k=5 ⇒ total=180 > 预算 126。
  // 原式 usable=Math.max(total, budget) 会把 bounds 铺出轨长 ⇒ 自检抛 CS-DEV-ERR。
  let tracks
  assert.doesNotThrow(() => {
    tracks = orb1Tracks({ durationInFrames: 150, data: { periodSec: 1, radiusX: 26, radiusY: 13 } })
  }, '合法参数不许把生成打成 CS-DEV-ERR（P1-8）')
  assert.ok(Array.isArray(tracks) && tracks.length > 0)

  // 每条 animate 段的窗口必须落在轨内（自检之外的第二道几何断言）。
  for (const track of tracks) {
    const dur = track.durationInFrames ?? 0
    const segs = Array.isArray(track.animate) ? track.animate : (track.animate === undefined ? [] : [track.animate])
    for (const seg of segs) {
      const start = seg.startFrame ?? 0
      const length = seg.durationInFrames ?? dur
      assert.ok(start >= 0 && start + length <= dur,
        `轨 ${String(track.id)} 的 animate 段 [${String(start)}, ${String(start + length)}) 越出 [0, ${String(dur)}]`)
    }
  }
})

test('P1-8：2s 短段 + periodSec=1 同样不抛（另一组复现条件）', () => {
  assert.doesNotThrow(() => {
    orb1Tracks({ durationInFrames: 60, data: { periodSec: 1, radiusX: 30, radiusY: 15 } })
  })
  // 常规参数（periodSec=6）回归：不该被裁剪逻辑弄坏。
  assert.doesNotThrow(() => {
    orb1Tracks({ durationInFrames: 150, data: { periodSec: 6, radiusX: 26, radiusY: 13 } })
  })
})
