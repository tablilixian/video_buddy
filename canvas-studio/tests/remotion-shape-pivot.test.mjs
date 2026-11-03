/**
 * P1（2026-11-03）：`ShapeTrack.pivot` 旋转轴心 —— 几何纯函数 + 契约校验 + 文档对码。
 *
 * 抓的是什么：shot-cards 缺口清单曾断言「animate 缺 rotate」—— 实际 `animate.rotation`
 * 插值本就全通（VISUAL_DIMENSIONS 五维含 rotation），真正的缺口是**旋转轴心**：
 * `boxStyle` 固定 `translate(-50%,-50%)` 中心对齐，rotate 只能绕自身中心，指针甩弧/
 * 偏心圆环自转全被挡。本文件钉住三件事：
 * ① `pivotOriginStyle` 纯函数（组件唯一取值点）；② `validateManifest` 对 pivot 的校验；
 * ③ 契约文档（manifest-contract.md）与缺口清单（shot-cards.md）同步。
 *
 * 直连 Host tsc 编译产物 lib/remotion/shape-geometry.js 与 lib/remotion/manifest.js。
 * 定向跑：node --test tests/remotion-shape-pivot.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pivotOriginStyle } from '../lib/remotion/shape-geometry.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

/** 一份只有单条 shape 轨的合法基线。 */
function shapeManifest(shapeTrack) {
  return {
    id: 'comp-pivot',
    meta: { title: '轴心测试', width: 1280, height: 720, fps: 30, durationInFrames: 120 },
    tracks: [{ id: 'shp-1', type: 'shape', shape: 'rect', color: '#F59E0B', startFrame: 0, durationInFrames: 120, ...shapeTrack }],
  }
}

test('pivotOriginStyle：未声明返回空对象（老 manifest 样式串逐字符不变）', () => {
  assert.deepEqual(pivotOriginStyle(undefined), {})
})

test('pivotOriginStyle：声明后输出 transform-origin（CSS 同口径，百分比）', () => {
  assert.deepEqual(pivotOriginStyle({ x: 50, y: 100 }), { transformOrigin: '50% 100%' })
  assert.deepEqual(pivotOriginStyle({ x: 0 }), { transformOrigin: '0% 50%' })
  assert.deepEqual(pivotOriginStyle({}), { transformOrigin: '50% 50%' })
})

test('pivotOriginStyle：非有限值兜底为 50（防 NaN 渗进样式串）', () => {
  assert.deepEqual(pivotOriginStyle({ x: Number.NaN, y: 100 }), { transformOrigin: '50% 100%' })
  assert.deepEqual(pivotOriginStyle({ x: Number.POSITIVE_INFINITY }), { transformOrigin: '50% 50%' })
})

test('校验：合法 pivot 通过且无契约告警', () => {
  const result = validateManifest(shapeManifest({ pivot: { x: 50, y: 100 } }))
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(
    result.warnings.filter((w) => !w.startsWith('[编排体检 ')),
    [],
    result.warnings.join('；'),
  )
})

test('校验：pivot 超出 0–100 / 非有限 / 非对象 → 报错（守卫可反向变红）', () => {
  const over = validateManifest(shapeManifest({ pivot: { x: 150 } }))
  assert.equal(over.ok, false)
  assert.ok(over.errors.some((e) => e.includes('.pivot.x')), over.errors.join('；'))

  const nan = validateManifest(shapeManifest({ pivot: { y: Number.NaN } }))
  assert.equal(nan.ok, false)
  assert.ok(nan.errors.some((e) => e.includes('.pivot.y')), nan.errors.join('；'))

  const notObject = validateManifest(shapeManifest({ pivot: 'bottom' }))
  assert.equal(notObject.ok, false)
  assert.ok(notObject.errors.some((e) => e.includes('.pivot 必须是对象')), notObject.errors.join('；'))
})

test('文档对码：契约文档与缺口清单都记录了 pivot 能力', () => {
  const contract = read('skills/code-driven-explainer/references/manifest-contract.md')
  assert.ok(contract.includes('**`pivot`（P1 · 旋转轴心）**'), 'manifest-contract.md 缺 pivot 节')
  assert.ok(contract.includes('box 中心 + (pivot−50)% × 盒尺寸'), 'manifest-contract.md 缺轴心落点公式')

  const cards = read('skills/code-driven-explainer/references/shot-cards.md')
  assert.ok(cards.includes('ShapeTrack.pivot'), 'shot-cards.md 未更新 gauge-readout 解锁说明')
  assert.ok(!cards.includes('`animate` 缺 `rotate`'), 'shot-cards.md 仍保留过时的「animate 缺 rotate」判断')
})
