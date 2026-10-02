/**
 * R-P0-12（2026-10-03）：画布手动连线——断开（边点选 + Delete）与拖线建点
 * （落空白弹菜单，新节点自动连到起点）。客户端交互层无渲染环境，按仓库惯例
 * 用源码闸钉住关键接线，行为正确性由桌面验收兜底。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = rel => readFileSync(join(here, '..', rel), 'utf8')

test('R-P0-12 store：unlinkNodes 与 linkLayers 对偶（历史快照可撤销），addNode 支持血缘', () => {
  const store = read('src/client/project-store.ts')
  assert.match(store, /unlinkNodes: \(draft: ProjectStoreState, projectId: string, sourceId: string, targetId: string\) => void/, 'actions 类型必须声明 unlinkNodes')
  assert.match(store, /unlinkNodes: \(draft, projectId, sourceId, targetId\) => \{/, 'unlinkNodes 必须有实现')
  // 与 linkLayers 同一份历史语义（可撤销）
  const unlinkBlock = store.slice(store.indexOf('unlinkNodes: (draft, projectId, sourceId, targetId) => {'))
  assert.match(unlinkBlock, /snapshotHistory/, '断开必须进撤销栈（snapshotHistory）')
  assert.match(unlinkBlock, /sourceIds\.filter\(entry => entry !== sourceId\)/, '断开 = target 的 sourceIds 移除该 source')
  // addNode 血缘：拖线建点自动连到起点
  assert.match(store, /addNode: \(draft, projectId, kind, at, sourceIds\) => \{/, 'addNode 实现必须收 sourceIds')
  assert.match(store, /sourceIds: \[\.\.\.new Set\(sourceIds \?\? \[\]\)\],/, '血缘必须去重')
})

test('R-P0-12 边交互：命中层点选 + 选中高亮 + Delete 断开 + Escape 取消', () => {
  const edges = read('src/client/canvas/CanvasEdges.tsx')
  assert.match(edges, /onEdgeSelect\?\(sourceId: string, targetId: string\): void/, 'CanvasEdges 必须暴露边点选回调')
  assert.match(edges, /pointerEvents: onEdgeSelect === undefined \? 'none' : 'stroke'/, '命中层仅在可交互时吃事件（复用方不被误伤）')
  assert.match(edges, /strokeWidth=\{16 \* inv\}/, '命中层要够宽（可见线仅 3.5 单位）')
  const surface = read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /onUnlinkNodes\(selectedEdgeRef\.current\.sourceId, selectedEdgeRef\.current\.targetId\)/, 'Delete 优先断开选中边')
  assert.match(surface, /setSelectedEdge\(null\)\n\s+onSelectNode\(null\)/, 'Escape 同时清边选与节点选')
  assert.match(surface, /setSelectedEdge\(null\)\n\s+gesture\.current = \{ mode: 'pan'/, '拖画布起手清边选')
})

test('R-P0-12 拖线建点：落空白回调 + 菜单新建自动连到起点', () => {
  const surface = read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /onLinkDropEmpty\(event\.clientX, event\.clientY, world\.x, world\.y, current\.sourceId\)/, '落空白必须回调（不再静默丢弃）')
  const frame = read('src/client/StudioFrame.tsx')
  assert.match(frame, /onUnlinkNodes=\{handleUnlinkNodes\}/, '断开回调必须接线')
  assert.match(frame, /onLinkDropEmpty=\{handleLinkDropEmpty\}/, '落空回调必须接线')
  assert.match(frame, /actions\.addNode\(projectId, kind, \{ x: edgeCreateMenu\.worldX, y: edgeCreateMenu\.worldY \}, \[edgeCreateMenu\.sourceId\]\)/, '菜单建点必须带血缘与落点')
  const menu = read('src/client/canvas/CanvasBlankMenu.tsx')
  assert.match(menu, /CanvasEdgeCreateMenu/, '建点菜单组件必须存在（与空白菜单同构）')
})

test('R-P2-01（REQ-004）：滚轮=缩放、多选批量引用、选中态强化', () => {
  const surface = read('src/client/canvas/CanvasSurface.tsx')
  assert.ok(!/event\.ctrlKey \|\| event\.metaKey\)\s*\{\s*zoomAround[\s\S]*?\} else \{\s*panBy\(/.test(surface), '滚轮不得再分叉为 ctrl 缩放/普通平移（R-P2-01：滚轮一律绕光标缩放）')
  assert.match(surface, /onReferenceSelectedToChat\?\(ids: readonly string\[\]\): void/, 'Surface 必须暴露批量引用回调')
  const menu = read('src/client/canvas/CanvasContextMenu.tsx')
  assert.match(menu, /引用到对话（\$\{selectedIdsForMenu\.length\} 个）/, '多选时菜单必须出批量项')
  assert.match(menu, /selectedIdsForMenu\.includes\(node\.id\)/, '批量项只在右键目标属于多选集合时出现')
  const frame = read('src/client/StudioFrame.tsx')
  assert.match(frame, /handleReferenceSelectedToChat/, 'StudioFrame 必须实现批量引用')
  const styles = read('src/client/styles.ts')
  assert.match(styles, /\.csNodeSelected \{[\s\S]*?border-width: 2px;/, '选中态描边必须强化（REQ-004：选中效果不明显）')
})
