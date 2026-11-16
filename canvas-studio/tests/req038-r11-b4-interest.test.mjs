/**
 * R11-B4（2026-11-16）· 「利息」批的纯函数契约
 *
 * 三件事，全部来自真机会话 6f8ba13c 的实测代价：
 *
 * ① **超时预算的分母**：`renderTimeoutMs` 按帧数算预算，而调用方恒传
 *    `manifest.meta.durationInFrames`。段 manifest 刻意保留整片 600 帧（段窗外的轨
 *    也要能算帧号）⇒ 每段拿整片预算：3 段合计 612s vs 整片 204s。一个真卡死的段
 *    白等 204s，`render-budget.ts` 头注释「把最坏等待压到 1.5 分钟」当场失效。
 * ② **units 型段允许缺省 copy**：旧口径强制非空 ⇒ 模型为过校验编一句拼合文案，
 *    顺手把 `-60°C` 写成 `-64°C`。一个纯格式校验污染了成片里唯一的数值。
 * ③ **口径细节**：`copy` 缺省是「不给」，不是「给什么都行」—— 数字/对象仍要拒收。
 *
 * 反向变异（必须红）：
 * - `plannedFrameCount` 改回只读 `durationInFrames` ⇒ ①的用例红；
 * - 校验改回 `!isNonEmptyString(copy)` 一律报错 ⇒ ②的用例红；
 * - 校验改成「有 units 就完全不看 copy」⇒ ③的用例红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { plannedFrameCount, renderTimeoutMs } from '../lib/remotion/render-budget.js'
import { validateContentSpec } from '../lib/remotion/content-spec.js'

test('plannedFrameCount：段帧窗优先于片长（600 帧片里渲 200 帧的预算）', () => {
  assert.equal(plannedFrameCount({ durationInFrames: 600, frameRange: [0, 189] }), 190, '闭区间含首含尾')
  assert.equal(plannedFrameCount({ durationInFrames: 600, frameRange: [390, 599] }), 210)
  assert.equal(plannedFrameCount({ durationInFrames: 600 }), 600, '整片渲染口径不变')
})

test('plannedFrameCount：spot 目标帧数最优先（只渲静帧，不编码整片）', () => {
  assert.equal(plannedFrameCount({ durationInFrames: 600, spotFrames: [10, 20, 30] }), 3)
  // spot 与 frameRange 同时给（理论上互斥）：spot 更小更准，按 spot 算
  assert.equal(plannedFrameCount({ durationInFrames: 600, spotFrames: [10], frameRange: [0, 199] }), 1)
})

test('plannedFrameCount：非法帧窗不放大预算（回退片长而不是返回 0/NaN）', () => {
  assert.equal(plannedFrameCount({ durationInFrames: 600, frameRange: [200, 100] }), 600, '反序窗当无效')
  assert.equal(plannedFrameCount({ durationInFrames: 600, frameRange: [NaN, 100] }), 600)
  assert.equal(plannedFrameCount({ durationInFrames: 0, spotFrames: [] }), 0)
})

test('超时预算：200 帧段 108s，整片 600 帧 204s（差值就是要省掉的白等）', () => {
  const segment = renderTimeoutMs(plannedFrameCount({ durationInFrames: 600, frameRange: [0, 199] }), 'standard')
  const whole = renderTimeoutMs(plannedFrameCount({ durationInFrames: 600 }), 'standard')
  assert.equal(segment, 108_000)
  assert.equal(whole, 204_000)
  assert.ok(whole - segment >= 90_000, '每段省下的白等必须 ≥90s，否则这处修改没有意义')
})

test('units 型段可以不给 copy（那一屏没有屏级文案槽）', () => {
  const spec = {
    meta: { title: 't', durationSec: 20, fps: 30 },
    sections: [
      { id: 's1', copy: '飞机为什么飞不过 2 万米？', card: 'A2' },
      {
        id: 's2',
        units: [
          { card: 'A4', copy: '同温层顶部 -60°C', cell: { x: 6, y: 8, w: 88, h: 34 } },
          { card: 'A4', copy: '客机巡航约 1 万米', cell: { x: 6, y: 56, w: 88, h: 34 } },
        ],
      },
      { id: 's3', copy: '关注我', card: 'A5' },
    ],
  }
  const result = validateContentSpec(spec)
  assert.deepEqual(result.errors, [], `units 段缺 copy 不该报错：${result.errors.join('；')}`)
})

test('单单元段仍然必须给 copy（没有 units 就没有别的文案来源）', () => {
  const spec = {
    meta: { title: 't', durationSec: 20, fps: 30 },
    sections: [{ id: 's1', card: 'A2' }],
  }
  const result = validateContentSpec(spec)
  assert.ok(
    result.errors.some((error) => error.includes('copy 必须是非空字符串')),
    '缺 units 又缺 copy 必须拒收（否则那一屏是空的）',
  )
})

test('units 段给错类型仍然拒收（缺省 ≠ 什么都行）', () => {
  const spec = {
    meta: { title: 't', durationSec: 20, fps: 30 },
    sections: [{ id: 's1', copy: 123, units: [{ card: 'A4', copy: '甲' }] }],
  }
  const result = validateContentSpec(spec)
  assert.ok(
    result.errors.some((error) => error.includes('copy 必须是字符串')),
    '数字塞进文案槽必须拒收 —— 否则「能过就行」会一路带到上屏',
  )
})
