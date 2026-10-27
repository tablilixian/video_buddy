/**
 * 多段旁白排期（`src/voice-timeline.ts`）的算术守卫。
 *
 * ## 为什么这份测试值得存在
 *
 * 排帧此前是 LLM 手算：`round(秒 × fps)` 再逐段累加。三个错法都**不会当场报错**——
 * 帧号大一点小一点 manifest 完全合法，只有整片渲完（几分钟）才看得出来：叠字、
 * 静默空档、最后一句被切。把算术搬进纯函数后，这里用固定输入钉死每一格数字，
 * 任何「四舍五入改成向上取整 / 间隔语义改成相对开始 / 丢掉 startFrame 偏移」的
 * 改动都会立刻变红。
 *
 * 断言里的数字都是手算的，公式写在注释里 —— 不要用被测函数自证。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_VOICE_GAP_SECONDS,
  MAX_NARRATION_LINES,
  VOICE_FPS,
  isVoiceFps,
  planVoiceTimeline,
  totalVoiceFrames,
  voiceOverEntries,
} from '../lib/voice-timeline.js'

test('排期：30fps / 间隔 0.4s（=12 帧）下逐段起止帧正确', () => {
  // 2.0s→60 帧、1.5s→45 帧、1.0s→30 帧
  // 起点：0 / (0+60+12)=72 / (72+45+12)=129
  const timings = planVoiceTimeline([2, 1.5, 1], { fps: 30 })
  assert.deepEqual(timings, [
    { startFrame: 0, endFrame: 60, frames: 60 },
    { startFrame: 72, endFrame: 117, frames: 45 },
    { startFrame: 129, endFrame: 159, frames: 30 },
  ])
  assert.equal(totalVoiceFrames(timings), 159, '旁白总占帧 = 最后一段 endFrame')
})

test('排期：startFrame 偏移整体平移，间隔不变', () => {
  const timings = planVoiceTimeline([1, 1], { fps: 25, startFrame: 15 })
  // 25fps：1s = 25 帧；gap 0.4s = 10 帧
  assert.deepEqual(timings.map((entry) => entry.startFrame), [15, 50])
  assert.deepEqual(timings.map((entry) => entry.endFrame), [40, 75])
})

test('排期：gapSeconds=0 时首尾相接（不能重叠、不能留空）', () => {
  const timings = planVoiceTimeline([1, 1, 1], { fps: 24, gapSeconds: 0 })
  assert.deepEqual(timings.map((entry) => [entry.startFrame, entry.endFrame]), [[0, 24], [24, 48], [48, 72]])
})

test('排期：负间隔 = 有意重叠，起点不早于上一段起点', () => {
  const timings = planVoiceTimeline([2, 2], { fps: 30, gapSeconds: -0.5 })
  // 第二段起点 = 60 - 15 = 45（与第一段重叠 15 帧 = 0.5s）
  assert.equal(timings[1].startFrame, 45)
  // 极端负间隔（-10s）仍必须晚于上一段起点（否则 manifest 里就是倒序）
  const extreme = planVoiceTimeline([2, 2], { fps: 30, gapSeconds: -10 })
  assert.equal(extreme[1].startFrame, 1, '下限 = 上一段起点 + 1 帧')
})

test('排期：逐段间隔覆盖全局间隔（gapsSeconds 的第 0 项无意义）', () => {
  const timings = planVoiceTimeline([1, 1, 1], {
    fps: 30,
    gapSeconds: 0.4,
    // 第一段前的值（9s）必须被忽略；第二段前 2s、第三段前 0s
    gapsSeconds: [9, 2, 0],
  })
  assert.deepEqual(timings.map((entry) => entry.startFrame), [0, 90, 120])
})

test('排期：时长为 0 / 负数 / NaN 时至少占 1 帧（不吞掉这一句）', () => {
  const timings = planVoiceTimeline([0, -3, Number.NaN], { fps: 30, gapSeconds: 0 })
  assert.deepEqual(timings.map((entry) => entry.frames), [1, 1, 1])
})

test('排期：小数秒按最近的整帧取整（不是一律向上）', () => {
  // 1.02s × 30 = 30.6 → 31；1.01s × 30 = 30.3 → 30
  const timings = planVoiceTimeline([1.02, 1.01], { fps: 30, gapSeconds: 0 })
  assert.deepEqual(timings.map((entry) => entry.frames), [31, 30])
})

test('排期：非法 fps 走错误系统抛 CS-USER-ERR（不是裸 RangeError）', () => {
  // 本项目铁律：`src/` 内禁止裸抛（`error-system-guards.test.mjs` 静态扫描）。
  // 所以这里断言的是**可判别的错误码**，而不是 JS 内置异常类型 —— 前端按 code 决定
  // 是弹提示还是走兜底，拿到一个裸 RangeError 只能显示一段英文栈。
  assert.throws(
    () => planVoiceTimeline([1], { fps: 23 }),
    (error) => {
      assert.equal(error.code, 'CS-USER-ERR')
      assert.match(error.message, /24 \/ 25 \/ 30 \/ 60/u)
      return true
    },
  )
  for (const fps of VOICE_FPS) {
    assert.ok(isVoiceFps(fps), `${fps} 应是合法 fps`)
  }
  assert.equal(isVoiceFps(29), false)
  assert.equal(isVoiceFps('30'), false)
  assert.equal(isVoiceFps(undefined), false)
})

test('voiceOverEntries：src 原样取产物 URL（不加工成 @ref），顺序与帧号对齐', () => {
  const timings = planVoiceTimeline([1, 1], { fps: 30, gapSeconds: 0 })
  const entries = voiceOverEntries([
    '/canvas-studio/assets/p1/a.mp3',
    '/canvas-studio/assets/p1/b.mp3',
  ], timings)
  assert.deepEqual(entries, [
    { src: '/canvas-studio/assets/p1/a.mp3', startFrame: 0 },
    { src: '/canvas-studio/assets/p1/b.mp3', startFrame: 30 },
  ])
  // url 少一个时不能造出 undefined.src
  assert.deepEqual(voiceOverEntries(['/canvas-studio/assets/p1/a.mp3'], timings), [
    { src: '/canvas-studio/assets/p1/a.mp3', startFrame: 0 },
  ])
})

test('常量口径：缺省间隔 0.4s、单次上限 32 段（都在 manifest 64 条以内）', () => {
  assert.equal(DEFAULT_VOICE_GAP_SECONDS, 0.4)
  assert.ok(MAX_NARRATION_LINES <= 64, '不能超过 audio.voiceOver 的 64 条上限')
  assert.deepEqual([...VOICE_FPS], [24, 25, 30, 60])
})
