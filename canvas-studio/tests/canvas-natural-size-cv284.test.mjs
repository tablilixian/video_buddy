/**
 * CV-284 自然像素批：迁移、锁比与视野护栏的契约测试。
 *
 * 本批把画布 image/video 节点从「长边 480 压图规则」切到**自然像素**
 * （100% 视图 1 CSS px = 1 像素）。四个面各自钉一条：
 *
 * 1. **迁移** —— 文档 v5 + `migrateNaturalMediaSize` 把旧 480 框批量收口；
 *    用户手动调过的框、锁定节点、缺分辨率的节点都不许碰（缺的留给媒体
 *    首次加载的懒迁移，见 resolution-tier 的 K 组源码闸）。
 * 2. **旧规则退役** —— MEDIA_LONG_SIDE / SQUARE_SIDE 不得复活。
 * 3. **resize 锁比** —— 媒体节点拖角必须锁**画面**比例（自由拖会与媒体
 *    加载的比例自愈打架）；非媒体节点保持自由 resize。
 * 4. **视野护栏** —— FIT_MIN_SCALE 降到 0.1；装不下的 reveal 改走适配；
 *    落点与整理布局按真实尺寸累加（大卡不许压行/重叠）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CANVAS_DOCUMENT_VERSION } from '../lib/contracts/canvas.js'
import { migrateNaturalMediaSize } from '../lib/projects.js'
import * as aspect from '../lib/canvas-aspect.js'
import { frameSizeOf, NODE_CHROME_HEIGHT } from '../lib/canvas-aspect.js'
import { FIT_MIN_SCALE, MIN_VIEW_SCALE, fitsViewport, computeArrangeLayout } from '../lib/canvas-view.js'
import { deriveNodePlacement, PLACEMENT_GAP } from '../lib/canvas-placement.js'

const here = dirname(fileURLToPath(import.meta.url))
const readSrc = (...parts) => readFileSync(join(here, '..', 'src', ...parts), 'utf8')
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ---------------------------------------------------------------------------
// 1. 迁移：v5 文档 + migrateNaturalMediaSize
// ---------------------------------------------------------------------------

test('文档版本推进到 v6（v5 = 自然像素书签；CV-288 音频卡尺寸抬齐再推一格）', () => {
  assert.equal(CANVAS_DOCUMENT_VERSION, 6, '版本只进不退；音频卡一次性抬齐按 <6 门控')
})

function oldRuleNode(extra = {}) {
  // 旧规则下 1280×720 产物的落盘形态：画面 480×270 + 48 chrome。
  return {
    id: 'n1',
    kind: 'image',
    x: 0,
    y: 0,
    width: 480,
    height: 318,
    mediaWidth: 1280,
    mediaHeight: 720,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    ...extra,
  }
}

test('migrateNaturalMediaSize：旧 480 框 → 自然像素（宽不动比例、高补 chrome）', () => {
  const migrated = migrateNaturalMediaSize(oldRuleNode())
  assert.equal(migrated.width, 1280)
  assert.equal(migrated.height, 720 + NODE_CHROME_HEIGHT)
  assert.equal(migrated.mediaWidth, 1280, '分辨率字段原样保留')
})

test('migrateNaturalMediaSize：用户手动调过的框（媒体区长边 ≠ 480）不碰', () => {
  const resized = oldRuleNode({ width: 960, height: 600 })
  assert.equal(migrateNaturalMediaSize(resized), resized, '尺寸是用户意图，必须原样返回')
})

test('migrateNaturalMediaSize：锁定节点不碰（self-heal 同口径：只保分辨率不动框）', () => {
  const locked = oldRuleNode({ locked: true })
  assert.equal(migrateNaturalMediaSize(locked), locked)
})

test('migrateNaturalMediaSize：缺 mediaWidth/Height 的节点留给懒迁移', () => {
  const unknown = oldRuleNode({ mediaWidth: undefined, mediaHeight: undefined })
  assert.equal(migrateNaturalMediaSize(unknown), unknown)
})

test('migrateNaturalMediaSize：已是自然尺寸（含长边恰为 480 的自然值）不抖动', () => {
  const natural = oldRuleNode({ width: 1280, height: 768, mediaWidth: 1280, mediaHeight: 720 })
  assert.equal(migrateNaturalMediaSize(natural), natural, '1280 宽的自然框不是 480 指纹')
  // 480×270 的自然产物媒体区长边恰是 480 —— 命中指纹但目标值相等 ⇒ 也不动。
  const edge = { ...oldRuleNode({ width: 480, height: 318 }), mediaWidth: 480, mediaHeight: 270 }
  assert.equal(migrateNaturalMediaSize(edge), edge)
})

test('migrateNaturalMediaSize：非媒体节点原样', () => {
  const sticky = oldRuleNode({ kind: 'sticky' })
  assert.equal(migrateNaturalMediaSize(sticky), sticky)
})

test('迁移已挂在 normalizeCanvasDocument 链上，且在音频归位之后', () => {
  const code = stripComments(readSrc('projects.ts'))
  assert.match(code, /\.map\(migrateNaturalMediaSize\)/, 'normalizeCanvasDocument 必须逐节点跑迁移')
  assert.match(
    code,
    /\.map\(migrateAudioNode\)\s*\.map\(node => documentVersion < 6 \? migrateAudioLegacySize\(node\) : node\)\s*\.map\(migrateNaturalMediaSize\)/,
    '顺序：先把历史视频 BGM 归位成 audio，再做 v6 一次性尺寸抬齐，最后自然像素迁移（audio 不进后者）',
  )
})

// ---------------------------------------------------------------------------
// 2. 旧规则退役
// ---------------------------------------------------------------------------

test('旧「长边 480 / 420 紧凑框」常量已退役（不得复活）', () => {
  assert.equal(aspect.MEDIA_LONG_SIDE, undefined, 'MEDIA_LONG_SIDE 必须删除')
  assert.equal(aspect.SQUARE_SIDE, undefined, 'SQUARE_SIDE 必须删除')
  const code = stripComments(readSrc('canvas-aspect.ts'))
  assert.doesNotMatch(code, /export const MEDIA_LONG_SIDE/, 'canvas-aspect 源码不得再导出 MEDIA_LONG_SIDE')
  assert.doesNotMatch(code, /export const SQUARE_SIDE/, 'canvas-aspect 源码不得再导出 SQUARE_SIDE')
})

// ---------------------------------------------------------------------------
// 3. resize 锁比（媒体节点）+ 自由 resize（非媒体）
// ---------------------------------------------------------------------------

test('媒体节点 resize 锁画面比例：一个轴驱动、另一轴按比例派生', () => {
  const surface = stripComments(readSrc('client', 'canvas', 'CanvasSurface.tsx'))
  assert.match(surface, /const lockedResizeAspect = \(node: StudioCanvasNode/, '锁比必须收在唯一助手里')
  assert.match(surface, /node\.kind !== 'image' && node\.kind !== 'video'/, '只锁 image/video —— 非媒体不参与')
  assert.match(surface, /const mediaAspect = lockedResizeAspect\(/, 'resize 分支必须先算锁比比例')
  assert.match(surface, /if \(mediaAspect === null\) \{[\s\S]*?onUpdateNode\(current\.nodeId/, '非媒体节点保留自由 resize 出口')
  assert.match(surface, /height = width \/ mediaAspect \+ NODE_CHROME_HEIGHT/, '派生轴按画面比例算（chrome 不吃比例）')
  assert.match(surface, /corner\.includes\('w'\) \? current\.originX \+ current\.originWidth - width/, '拖 w 锚对侧（右缘不动）')
  assert.match(surface, /corner\.includes\('n'\) \? current\.originY \+ current\.originHeight - height/, '拖 n 锚对侧（下缘不动）')
  // 比例取真实像素；缺省回退手势起点（不能拿 node 当前值 —— 拖拽中它在变）
  assert.match(surface, /nw > 0 && nh > 0/, '真实像素可用时优先')
  assert.match(surface, /originWidth > 0 && mediaHeight > 0/, '缺分辨率回退 origin 画面区比例')
})

// ---------------------------------------------------------------------------
// 4. 视野护栏：FIT_MIN_SCALE 0.1 / 装不下的 reveal 改走适配 / 尺寸感知布局
// ---------------------------------------------------------------------------

test('FIT_MIN_SCALE 降到 0.1：自然像素的 1080p 卡装得进适配视野', () => {
  assert.equal(FIT_MIN_SCALE, 0.1)
  assert.ok(FIT_MIN_SCALE <= MIN_VIEW_SCALE, '适配下限不高于手动缩放下限（fit 不许一步踩到 min 之外）')
})

test('fitsViewport 与 reveal 同款 padding；装不下时 revealNodesOrFit 走 computeFitView', () => {
  const view = { x: 0, y: 0, scale: 1 }
  const viewport = { width: 1000, height: 600 }
  assert.equal(fitsViewport({ x: 0, y: 0, width: 800, height: 400 }, view, viewport), true)
  assert.equal(fitsViewport({ x: 0, y: 0, width: 1968, height: 1128 }, view, viewport), false, '1080p 卡 @100% 装不下')

  const surface = stripComments(readSrc('client', 'canvas', 'CanvasSurface.tsx'))
  assert.match(surface, /revealNodesOrFit\(ids: readonly string\[\]\): void/, 'handle 必须暴露 revealNodesOrFit')
  assert.match(surface, /if \(fitsViewport\(bounds, viewRef\.current, viewport\)\) \{[\s\S]*?revealNodes\(ids\)/, '装得下 → 照旧平移')
  assert.match(surface, /fitToBounds\(bounds\)\n  \}, \[revealNodes, fitToBounds\]\)/, '装不下 → 适配视野（computeFitView 收口在 fitToBounds）')
  const frame = stripComments(readSrc('client', 'StudioFrame.tsx'))
  assert.match(frame, /surfaceRef\.current\?\.revealNodesOrFit\(arrived\.map\(node => node\.id\)\)/, 'arrived 分支必须走 OrFit')
})

test('落点/整理布局按真实尺寸累加（自然像素大卡不重叠、不压行）', () => {
  // 落点：来源右缘 = 来源 x + 来源**真实宽**（1920 的卡不能按 260 算右缘）
  const source = { id: 's', kind: 'image', x: 40, y: 40, width: 1920, height: 1128, createdAt: 1, origin: 'manual', sourceIds: [] }
  const placed = deriveNodePlacement([source], ['s'], 640, 408)
  assert.ok(placed.x >= 40 + 1920 + PLACEMENT_GAP, `来源右侧落位要算真实宽（x=${placed.x}）`)
  assert.equal(placed.y, 40, 'y 对齐来源')

  // 整理布局：行高按节点真实高度累加 —— 1080p 卡（+chrome 1128 高）的下一行
  // 必须整行让开，而不是按旧 480 规则的 318 高算。
  const big = { id: 'a', kind: 'image', x: 0, y: 0, width: 1920, height: 1128, createdAt: 1, origin: 'agent', sourceIds: [] }
  const next = { id: 'b', kind: 'image', x: 0, y: 0, width: 400, height: 348, createdAt: 2, origin: 'agent', sourceIds: [] }
  const positions = computeArrangeLayout([big, next])
  const a = positions.get('a')
  const b = positions.get('b')
  assert.ok(a !== undefined && b !== undefined)
  assert.ok(b.y >= a.y + big.height, `下一行必须让开整行高度（b.y=${b.y} < ${a.y + big.height}）`)
})
