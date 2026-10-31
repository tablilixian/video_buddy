/**
 * CV-384 P0-1/P0-3：节点合成层结构守卫（G1 源码闸）。
 *
 * 根因回顾：`.csNode` 曾同时被 `will-change: transform`（styles）与
 * `translate3d`（CanvasNode 定位）**双重强制**提升合成层 —— 节点多时每节点
 * 一套瓦片，把合成器瓦片内存预算摊爆（tile memory limits exceeded + 拖缩
 * 抖动）。本闸把修复后的结构钉死：
 *
 *   - 静态节点不设 will-change、定位用 2D translate（画进世界层瓦片）；
 *   - 拖拽态提升走 styles-canvas-perf.ts 的 `.csNodeDragging`（仅被拖节点）；
 *   - 视口裁剪 A 案（content-visibility）与占位尺寸在位；
 *   - 世界层 `.csCanvasLayer` 的 will-change **保留**（它该合成，一屏一套瓦片）；
 *   - CanvasSurface 的合并器收口（onPointerUp / onPointerCancel 前 flush）在位。
 *
 * 无 React 渲染环境（node --test），按本仓惯例用源码闸钉结构性前提；行为契约
 * 在 canvas-gesture-raf.test.mjs（G3）与 canvas-viewport-cull.test.mjs（G2）。
 *
 * 运行：corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** 去注释切片：断言只看代码本体，不受注释里出现旧字样的干扰。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (rel) => codeOnly(readFileSync(join(here, '..', rel), 'utf8'))

const STYLES = read('src/client/styles.ts')
const PERF_STYLES = read('src/client/styles-canvas-perf.ts')
const NODE = read('src/client/canvas/CanvasNode.tsx')
const SURFACE = read('src/client/canvas/CanvasSurface.tsx')

function ruleBlock(source, selector) {
  const match = source.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `找不到规则块：${selector}`)
  return match[1]
}

test('G1-①：.csNode 不得含 will-change —— 节点不再常驻合成层（瓦片预算根因）', () => {
  const block = ruleBlock(STYLES, '\\.csNode')
  assert.ok(!block.includes('will-change'),
    '.csNode 挂回 will-change = 每节点一层，瓦片预算摊爆（CV-384 根因回归）')
})

test('G1-②：世界层 .csCanvasLayer 的 will-change 必须保留 —— 该合成的是世界层', () => {
  const block = ruleBlock(STYLES, '\\.csCanvasLayer')
  assert.ok(block.includes('will-change'), '世界层去合成会让拖缩回到逐帧 paint，方向反了')
  // 全文件 will-change 只剩两处：世界层 + 讲片器轨道（styles.ts:10380 csPcTrack）。
  const count = (STYLES.match(/will-change/g) ?? []).length
  assert.equal(count, 2, `styles.ts 的 will-change 应为 2 处（世界层 + csPcTrack），实测 ${count}`)
})

test('G1-③：CanvasNode 定位必须是 2D translate —— translate3d 本身就强制合成层', () => {
  assert.ok(!/translate3d/.test(NODE), 'translate3d 是 3D 变换，与 will-change 同效强制每节点一层（CV-384）')
  assert.match(NODE, /transform: `translate\(\$\{node\.x\}px, \$\{node\.y\}px\)`/, '节点位移走 2D translate')
})

test('G1-④：拖拽态提升与视口裁剪 A 案在 styles-canvas-perf.ts 在位', () => {
  const dragging = ruleBlock(PERF_STYLES, '\\.csNodeDragging')
  assert.ok(dragging.includes('will-change'), '.csNodeDragging 必须带 will-change（仅被拖节点提升）')
  const csNode = ruleBlock(PERF_STYLES, '\\.csNode')
  assert.ok(csNode.includes('content-visibility: auto'), '.csNode 必须开 content-visibility: auto（视口裁剪 A 案）')
})

test('G1-⑤：CanvasNode 的 cv-auto 占位尺寸按节点真实尺寸内联', () => {
  assert.match(NODE, /containIntrinsicSize: `\$\{node\.width\}px \$\{node\.height\}px`/,
    'contain-intrinsic-size 必须内联节点真实宽高（离屏跳渲染时不塌框）')
})

test('G1-⑥：拖拽类只挂被拖节点 —— 条件展开保住 CanvasNode memo（R-P0-12 纪律）', () => {
  assert.match(SURFACE, /spotDragIds\?\.includes\(node\.id\) === true \? \{ dragging: true \} : \{\}/,
    'dragging 必须条件展开（不参与的节点 props 全等），禁止无条件传值击穿 memo')
  assert.ok(!/dragging=\{/.test(SURFACE), '不得用恒等 JSX 属性传 dragging（未拖节点也会拿到 false，props 不再全等）')
})

test('G1-⑦：合并器收口 —— onPointerUp 与 onPointerCancel 都必须先 flush', () => {
  const flushCount = (SURFACE.match(/moveCoalescerRef\.current\?\.flush\(\)/g) ?? []).length
  assert.ok(flushCount >= 2, `onPointerUp / onPointerCancel 两处收口都要 flush（最后一帧坐标必须入账），实测 ${flushCount} 处`)
  assert.match(SURFACE, /moveCoalescerRef\.current\?\.push\(\{ x: event\.clientX, y: event\.clientY \}\)/,
    'pointermove 必须落合并器（不再每事件同步应用）')
})

test('G1-⑧（批 2）：手势期 cv-auto 抑制在位 —— 缩小的「翻边界」失效风暴', () => {
  // 缩小时大量节点跨越 content-visibility 的「相关」边界，每帧子树布局 + 瓦片
  // 失效叠加在 scale 全量重光栅上；手势中可见区节点反正全要画。规则与接线都要在。
  const block = ruleBlock(PERF_STYLES, '\\.csCanvasGesturing \\.csNode')
  assert.ok(block.includes('content-visibility: visible'),
    '.csCanvasGesturing .csNode 必须压回 content-visibility: visible（手势期抑制）')
  assert.match(SURFACE, /gesturing \? 'csCanvasSurface csCanvasGesturing' : 'csCanvasSurface'/,
    '表面必须按手势态挂 .csCanvasGesturing')
  assert.match(SURFACE, /setGesturing\(true\)/, '手势开始（armPointer / 滚轮 apply）必须点亮手势态')
  assert.ok((SURFACE.match(/setGesturing\(false\)/g) ?? []).length >= 2,
    'onPointerUp / onPointerCancel / 滚轮去抖 至少两处回落')
})

/* 反向变异（仓库惯例：改源码 → 跑闸验红 → 还原，结果记台账，不进守卫本体）：
 *   M1 把 `will-change: transform;` 塞回 .csNode 规则块   → G1-① 红
 *   M2 canvas-cull.ts 的 margin 去掉 `/ view.scale`       → G2-② 红
 *   M3 CanvasNode 定位改回 translate3d                    → G1-③ 红
 */
