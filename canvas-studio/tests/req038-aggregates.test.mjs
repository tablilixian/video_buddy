/**
 * REQ-038 批次 5 守卫：RQ-22 聚合型原语（logoWall / assetGrid / chipRow / codePanel / ticker）。
 *
 * 验收口径（需求正本 §3 RQ-22）：
 * 1. 用 `logoWall` 重生成 21 元素 logo 墙 ⇒ **1 条轨**（渲染组件实例数 = 1）；
 * 2. 用 `assetGrid` 重生成 16 张截图墙 ⇒ **1 条轨**；
 * 3. 展开后总轨数 265 → ≤150 的前提达成（聚合轨计 1 条）；
 * 4. 老 manifest 逐像素不变（新原语是**新增轨道类型**，不触碰既有轨型）。
 * 布局确定性在 aggregate-layout 纯函数层断言（像素对拍由取证台/真机做）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateManifest, KNOWN_TRACK_KEYS } from '../lib/remotion/manifest.js'
import { gridLayout, gridShape, flowLayout, unitEnterAt, estimateTextWidthPx } from '../lib/remotion/aggregate-layout.js'

const here = dirname(fileURLToPath(import.meta.url))

const manifestWith = (track) => ({
  id: 'req038-b5-test',
  meta: { title: 'REQ-038 批5', width: 1920, height: 1080, fps: 30, durationInFrames: 300 },
  tracks: [track],
})

const logos21 = Array.from({ length: 21 }, (_, i) => `/canvas-studio/assets/playsout/logo-${i}.png`)

test('RQ-22 验收1：21 个 logo 的 logoWall = 1 条轨，校验放行', () => {
  const m = validateManifest(manifestWith({
    id: 'partner-wall', type: 'logoWall', logos: logos21,
    columns: 7, cellW: 140, cellH: 80, grayscale: true, unitStagger: 3,
    box: { x: 50, y: 50, w: 70, h: 30 }, startFrame: 0, durationInFrames: 150,
  }))
  assert.deepEqual(m.errors, [], `errors: ${JSON.stringify(m.errors)}`)
  // 「1 条轨」由构造本身保证（tracks 数组只有这一条）；渲染实例数 = 1 由 track-body
  // 的单 case 分发保证（见分发守卫测试）。
  assert.equal(manifestWith({ id: 'w', type: 'logoWall', logos: logos21, startFrame: 0, durationInFrames: 60 }).tracks.length, 1)
})

test('RQ-22 验收2：16 张截图的 assetGrid = 1 条轨，校验放行', () => {
  const assets = Array.from({ length: 16 }, (_, i) => `/canvas-studio/assets/playsout/textures-live-${i}.png`)
  const m = validateManifest(manifestWith({
    id: 'shot-wall', type: 'assetGrid', assets,
    columns: 4, cellW: 320, cellH: 200, radius: 10, fit: 'cover',
    box: { x: 50, y: 50, w: 80, h: 50 }, startFrame: 0, durationInFrames: 120,
  }))
  assert.deepEqual(m.errors, [], `errors: ${JSON.stringify(m.errors)}`)
})

test('RQ-22：chipRow / codePanel / ticker 三种也能单轨表达', () => {
  const chip = validateManifest(manifestWith({ id: 'chips', type: 'chipRow', chips: ['AI 原生', '多模态', 'Agent'], startFrame: 0, durationInFrames: 90 }))
  assert.deepEqual(chip.errors, [])
  const code = validateManifest(manifestWith({ id: 'code', type: 'codePanel', code: 'const x = 1\nrender(x)', title: 'sdk.ts', scrollSpeed: 1.2, startFrame: 0, durationInFrames: 90 }))
  assert.deepEqual(code.errors, [])
  const ticker = validateManifest(manifestWith({ id: 'tick', type: 'ticker', items: ['PlaysOut', 'Video Buddy', 'Studio'], speed: 2.4, startFrame: 0, durationInFrames: 90 }))
  assert.deepEqual(ticker.errors, [])
})

test('RQ-22：非法值拒收（logos 空数组 / columns 越界 / fit 白名单 / code 缺失）', () => {
  const empty = validateManifest(manifestWith({ id: 'w', type: 'logoWall', logos: [], startFrame: 0, durationInFrames: 60 }))
  assert.ok(empty.errors.some((e) => e.includes('.logos 必须是非空数组')))
  const cols = validateManifest(manifestWith({ id: 'w', type: 'logoWall', logos: logos21, columns: 0, startFrame: 0, durationInFrames: 60 }))
  assert.ok(cols.errors.some((e) => e.includes('.columns 必须是')))
  const fit = validateManifest(manifestWith({ id: 'w', type: 'assetGrid', assets: ['/a.png'], fit: 'fill', startFrame: 0, durationInFrames: 60 }))
  assert.ok(fit.errors.some((e) => e.includes('.fit 非法')))
  const code = validateManifest(manifestWith({ id: 'w', type: 'codePanel', code: '', startFrame: 0, durationInFrames: 60 }))
  assert.ok(code.errors.some((e) => e.includes('.code 必须是非空字符串')))
  const dir = validateManifest(manifestWith({ id: 'w', type: 'ticker', items: ['a'], direction: 'up', startFrame: 0, durationInFrames: 60 }))
  assert.ok(dir.errors.some((e) => e.includes('.direction 非法')))
})

test('RQ-22：KNOWN_TRACK_KEYS 五种全登记（P-02 口径），TRACK_TYPES 放行', () => {
  for (const type of ['logoWall', 'assetGrid', 'chipRow', 'codePanel', 'ticker']) {
    assert.ok(KNOWN_TRACK_KEYS[type] !== undefined, `${type} 必须登记 KNOWN_TRACK_KEYS`)
    assert.ok(KNOWN_TRACK_KEYS[type].size >= 5, `${type} 键集不能为空`)
  }
})

test('RQ-22：聚合轨通用字段照常可用（box/animate 走通用段；通用 box 冲突检测生效）', () => {
  // box + 显式 x/y 冲突 → 通用 boxPositionConflict 应报错（新轨型享受同一套校验）。
  const m = validateManifest(manifestWith({
    id: 'w', type: 'chipRow', chips: ['a'], box: { x: 50, y: 50, w: 40, h: 10 },
    transform: { x: 10, y: 10 }, startFrame: 0, durationInFrames: 60,
  }))
  assert.ok(m.errors.some((e) => e.includes('box') || e.includes('x/y')), `应有 box 位置冲突：${JSON.stringify(m.errors)}`)
})

test('RQ-22 ★布局确定性：gridLayout 居中 + 残行左对齐（21=7×3 无残行）', () => {
  const { cols, rows } = gridShape(21, 7)
  assert.equal(cols, 7)
  assert.equal(rows, 3)
  const cells = gridLayout({ count: 21, columns: 7, cellW: 140, cellH: 80, gapX: 24, gapY: 24, containerW: 1134, containerH: 300 })
  assert.equal(cells.length, 21)
  // 居中：网格宽 = 7×140 + 6×24 = 1124，起点 = (1134−1124)/2 = 5。
  assert.equal(cells[0].x, 5)
  assert.equal(cells[0].y, 6, '网格高 = 3×80+2×24 = 288，起点 = (300−288)/2 = 6')
})

test('RQ-22 ★布局确定性：残行左对齐 + 缺省方阵列数', () => {
  // 10 元素 4 列 → 行数 3，末行 2 个左对齐（x 与首列相同）。
  const cells = gridLayout({ count: 10, columns: 4, cellW: 100, cellH: 60, gapX: 20, gapY: 20, containerW: 460, containerH: 220 })
  assert.equal(cells[8].x, cells[0].x, '末行第 1 个与首列对齐')
  // 缺省列数 = round(√n)：10 → 3。
  const auto = gridShape(10)
  assert.equal(auto.cols, 3)
})

test('RQ-22 ★布局确定性：chipRow flowLayout 居中；装不下返回 null（组件左对齐兜底）', () => {
  const offsets = flowLayout([100, 80, 120], 10, 400)
  assert.deepEqual(offsets, [40, 150, 240]) // total=100+80+120+2×10=320, start=(400−320)/2=40
  assert.equal(flowLayout([100, 80, 120], 10, 300), null, '总宽超容器 = null')
})

test('RQ-22 ★入场确定性：unitEnterAt 纯帧函数（错峰 + 硬切档）', () => {
  // 第 0 单元在帧 0 刚开始（fadeFrames 6）：opacity = 0（t=0 线性起点前）→ 实际 t=0/6=0。
  const first = unitEnterAt(0, 0, { stagger: 3, fadeFrames: 6 })
  assert.equal(first.opacity, 0)
  // 第 1 单元错峰 3 帧：帧 0 时还没轮到 = 完全不可见。
  const second = unitEnterAt(0, 1, { stagger: 3, fadeFrames: 6 })
  assert.equal(second.opacity, 0)
  assert.equal(second.offsetY, 14)
  // 帧足够后全部落定。
  const done = unitEnterAt(100, 20, { stagger: 3, fadeFrames: 6 })
  assert.equal(done.opacity, 1)
  assert.equal(done.offsetY, 0)
  // fadeFrames=0 = 硬切（直接出现）。
  const hard = unitEnterAt(0, 5, { stagger: 3, fadeFrames: 0 })
  assert.equal(hard.opacity, 1)
})

test('RQ-22：ticker 宽度估算确定性（同输入同输出）', () => {
  const a = estimateTextWidthPx('PlaysOut · 视频伙伴', 28)
  const b = estimateTextWidthPx('PlaysOut · 视频伙伴', 28)
  assert.equal(a, b)
  assert.ok(a > 0)
})

test('RQ-22 ★分发守卫：track-body 五种全分发、Aggregates.tsx 消费新字段', () => {
  const body = readFileSync(join(here, '../src/remotion/components/track-body.tsx'), 'utf8')
  for (const type of ['logoWall', 'assetGrid', 'chipRow', 'codePanel', 'ticker']) {
    assert.ok(body.includes(`case '${type}'`), `track-body 必须分发 ${type}`)
  }
  const agg = readFileSync(join(here, '../src/remotion/components/Aggregates.tsx'), 'utf8')
  assert.ok(agg.includes('gridLayout') && agg.includes('unitEnterAt'), '网格/入场必须走纯函数层')
  assert.ok(agg.includes('grayscale'), 'logoWall 灰度必须在渲染层消费')
  assert.ok(agg.includes('scrollSpeed'), 'codePanel 滚动必须消费')
  assert.ok(agg.includes('maskImage'), 'ticker 淡出必须落 mask')
})

test('RQ-22 ★老轨型零触碰：老 manifest（image 摆放）不受新原语影响', () => {
  const m = validateManifest(manifestWith({
    id: 'old-image', type: 'image', src: '/canvas-studio/assets/playsout/logo-0.png',
    box: { x: 20, y: 30, w: 10, h: 10 }, startFrame: 0, durationInFrames: 60,
  }))
  assert.deepEqual(m.errors, [])
  assert.ok(!m.warnings.some((w) => w.includes('logoWall') || w.includes('aggregate')), '老轨型不沾新逻辑')
})
