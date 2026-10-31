/**
 * 能力基准 #04 收口（2026-10-31）：`chart` 轨契约单测。
 *
 * 覆盖 validateManifest 对 chart 轨的边界：variant 枚举、labels/values 形状与
 * 长度一致、非负有限、全零拒收、dual 的 lineValues 必填与长度校验、bars 带冗余
 * lineValues 只告警、契约外字段告警、box 生效（chart 是内容轨）。
 * 直连 Host tsc 编译产物 `lib/remotion/manifest.js`。
 * 定向跑：node --test tests/manifest-chart.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/remotion/manifest.js'

function base(overrides = {}) {
  return {
    id: 'comp-chart',
    meta: { title: '图表契约', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
    ],
    ...overrides,
  }
}

function chart(overrides = {}) {
  return {
    id: 't-chart',
    type: 'chart',
    variant: 'bars',
    labels: ['shot1', 'shot2', 'shot3'],
    values: [8, 7.27, 6],
    startFrame: 0,
    durationInFrames: 300,
    ...overrides,
  }
}

test('chart：合法 bars / dual 放行且零告警', () => {
  for (const t of [
    chart(),
    chart({ variant: 'dual', lineValues: [8, 16, 23], lineLabel: '累计' }),
    chart({ variant: 'dual', lineValues: [1, 2, 3], unit: 's', lineUnit: 's', color: '#fff', lineColor: '#000' }),
  ]) {
    const v = validateManifest(base({ tracks: [t] }))
    assert.equal(v.ok, true, JSON.stringify(v.errors))
    assert.deepEqual(v.warnings, [], `应零告警：${JSON.stringify(v.warnings)}`)
  }
})

test('chart：variant 非法拒收', () => {
  const v = validateManifest(base({ tracks: [chart({ variant: 'pie' })] }))
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('.variant 只允许 bars / dual')))
})

test('chart：labels/values 形状与长度一致性', () => {
  const emptyLabels = validateManifest(base({ tracks: [chart({ labels: [] })] }))
  assert.ok(emptyLabels.errors.some((e) => e.includes('.labels 必须是非空字符串数组')))

  const mismatch = validateManifest(base({ tracks: [chart({ values: [1, 2] })] }))
  assert.ok(mismatch.errors.some((e) => e.includes('长度（2）必须与 labels（3）一致')))

  const negative = validateManifest(base({ tracks: [chart({ values: [1, -2, 3] })] }))
  assert.ok(negative.errors.some((e) => e.includes('.values 必须是非负有限数值数组')))

  const allZero = validateManifest(base({ tracks: [chart({ values: [0, 0, 0] })] }))
  assert.ok(allZero.errors.some((e) => e.includes('不能全为 0')))

  const tooMany = validateManifest(base({ tracks: [chart({ labels: Array.from({ length: 33 }, (_, i) => `k${i}`), values: Array.from({ length: 33 }, (_, i) => i + 1) })] }))
  assert.ok(tooMany.errors.some((e) => e.includes('.labels 必须是非空字符串数组（1–32 项')))
})

test('chart：dual 必须给 lineValues 且长度一致；bars 带冗余 lineValues 只告警不拒收', () => {
  const missing = validateManifest(base({ tracks: [chart({ variant: 'dual' })] }))
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((e) => e.includes("是 variant:'dual'，必须提供 lineValues")))

  const badLen = validateManifest(base({ tracks: [chart({ variant: 'dual', lineValues: [1, 2] })] }))
  assert.ok(badLen.errors.some((e) => e.includes('.lineValues 长度（2）必须与 labels（3）一致')))

  const redundant = validateManifest(base({ tracks: [chart({ lineValues: [1, 2, 3] })] }))
  assert.equal(redundant.ok, true)
  assert.ok(redundant.warnings.some((w) => w.includes("lineValues 只在 variant:'dual' 下生效")))
})

test('chart：契约外字段告警（KNOWN_TRACK_KEYS.chart 覆盖全部字段，无幽灵告警）', () => {
  const v = validateManifest(base({ tracks: [chart({ typo: 1 })] }))
  assert.equal(v.ok, true)
  assert.equal(v.warnings.filter((w) => w.includes('typo')).length, 1, '未知键恰好告警一次')
  // 合法字段一个都不许告警
  const clean = validateManifest(base({ tracks: [chart({ variant: 'dual', lineValues: [1, 2, 3], lineLabel: 'L', unit: 's', lineUnit: 's', color: '#fff', lineColor: '#000' })] }))
  assert.deepEqual(clean.warnings, [])
})

test('chart：内容轨身份 —— box 生效、animate/exit 通用字段可用', () => {
  const v = validateManifest(base({
    tracks: [
      chart({
        box: { x: 50, y: 50, w: 80, h: 70 },
        animate: [{ from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 18 }],
      }),
    ],
  }))
  assert.equal(v.ok, true, JSON.stringify(v.errors))
  assert.ok(!v.errors.some((e) => e.includes('.box 只支持')), 'chart 是内容轨，box 不应被拒')
})
