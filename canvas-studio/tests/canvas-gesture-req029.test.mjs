/**
 * REQ-029 拍板①②③ 手势层守卫；拍板①经 CV-283 验收前修正、**拍板①②经 CV-286 再修订**。
 *
 * 拍板口径（tracking.md REQ-029 条目「拍板」段，CV-286 后以本批为准）：
 *   ① 双击空白 = **无操作**（CV-286 推翻「视图复位 100%」——旧出口 resetZoom
 *     钉死世界原点，双击哪儿画布都落到同一处）；image/video 双击 = **该节点
 *     移到视口正中 + 100%**（onCenterNode → canvas-view.centerViewOf 纯函数）；
 *     工具栏「1:1」= 保持视口中心的世界点回到 100%；audio/文本/详情语义不动，
 *     预览与播放走就近工具条；
 *   ② 单击空白 = 清选 + 收起打开中的 UI（叠加）——**判定在 pointerup**（累计
 *     位移 ≤ CLICK_CLEAR_SLOP = 5px 才算单击；CV-286：按下即清会在拖拽第一帧
 *     卸掉工具条/输入框卡，拖拽全程保留选区）；就地浮层 / 就近工具条 / 边选中 /
 *     右键菜单都在这条链上；
 *   ③ 缩放范围维持 10%~500%（演示 25%~400% 让步）——MIN/MAX_VIEW_SCALE 不许动。
 *
 * 连带（REQ-004 / R-P2-01，CV-286）：滚轮缩放灵敏度 —— 因子按滚动量指数化
 * （exp(-deltaY/800)），不再每事件固定 ×1.2（触控板高频小增量连乘爆炸）。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法：够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（centerViewOf 数学断言读 `../lib/canvas-view.js`，
 * 与 canvas-chrome-align 同款 —— 改 canvas-view.ts 后须先 build 再跑）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { centerViewOf } from '../lib/canvas-view.js'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
/** 在源码里截取 [startMarker, endMarker) 区间（守卫只断言自己关心的函数体）。 */
const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + 1)
  assert.ok(start >= 0 && end > start, `找不到切片区间：${startMarker} → ${endMarker}`)
  return source.slice(start, end)
}

test('REQ-029 手势①（CV-286）：双击空白 = 无操作；工具栏 1:1 保持视口中心回 100%', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 容器不再挂任何双击 handler —— 写回 resetZoom/fitToContent 即回归旧语义。
  assert.ok(!/onDoubleClick=\{/.test(surface), '画布容器不得挂双击 handler（双击空白 = 无操作）')
  // 适配视野不许丢：handle 继续暴露 fitToContent（角落控件/工具栏通道）。
  assert.match(surface, /fitToContent, zoomToSelection, resetZoom/, 'useImperativeHandle 必须继续暴露 fitToContent')
  // resetZoom = 视口中心世界点保持 + 100%（不再钉原点）。
  const resetBody = sliceBetween(surface, 'const resetZoom = useCallback', 'const centerNode = useCallback')
  assert.match(resetBody, /cx - world\.x/, 'resetZoom 必须保持视口中心的世界点（cx − world.x）')
  assert.match(resetBody, /scale: 1\b/, 'resetZoom 必须回到 100%')
  assert.ok(!/\{ x: 0, y: 0, scale: 1 \}/.test(resetBody), 'resetZoom 不得再钉世界原点 {0,0,1}（双击/1:1 跳同一处的根因）')
})

test('REQ-029 手势①（CV-286 修订）：image/video 双击 = 节点居中 + 100%，audio/文本语义不动', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 节点双击处理仍由 CanvasNode 挂（CV-071 钉过的约定）；内层控件豁免不被删。
  assert.match(node, /onDoubleClick=\{handleDoubleClick\}/, '节点双击处理必须保留在 CanvasNode')
  assert.match(node, /onDoubleClick=\{event => \{ event\.stopPropagation\(\) \}\}/, '内层控件的 dblclick 豁免必须保留')
  // image/video：stopPropagation + 调 onCenterNode（不再放行冒泡）。
  assert.match(
    node,
    /if \(node\.kind === 'image' \|\| node\.kind === 'video'\) \{\s*\n\s*event\.stopPropagation\(\)\s*\n\s*onCenterNode\?\.\(node\)/,
    'image/video 双击必须 stopPropagation 并调 onCenterNode（节点居中 + 100%）',
  )
  assert.ok(
    !/if \(node\.kind === 'image' \|\| node\.kind === 'video'\) return/.test(node),
    'image/video 双击不得再放行冒泡（CV-286：双击空白已是无操作，放行 = 双击没反应）',
  )
  assert.equal(
    node.includes("node.kind === 'image' && node.url !== undefined && onOpenPreview"),
    false,
    'image 双击不得再开预览浮层（预览改走工具条）',
  )
  assert.equal(
    /node\.kind === 'video' \|\| node\.kind === 'audio'\) && node\.url/.test(node),
    false,
    'video 双击不得再进播放（播放改走工具条「预览」）',
  )
  // audio 保留双击播放（无演示覆盖，不随 image/video 一起改）。
  assert.match(
    node,
    /node\.kind === 'audio' && node\.url !== undefined && onOpenPlayback !== undefined/,
    'audio 双击必须保留播放语义',
  )
  // 画布侧接线：CanvasNode 渲染必须传 onCenterNode，中心数学收口到纯函数。
  assert.match(surface, /onCenterNode=\{centerNode\}/, 'CanvasSurface 必须把 centerNode 传给 CanvasNode')
  assert.match(surface, /centerViewOf\(node, \{ width: el\.clientWidth, height: el\.clientHeight \}, 1\)/, 'centerNode 必须调 centerViewOf（viewport + scale=1）')
})

test('CV-286 纯函数实测：centerViewOf 把盒子中心对齐视口中心', () => {
  // 基准：盒子中心 (125, 220)，视口 1000×800 的中心 (500, 400) ⇒ 平移量 = 中心差。
  assert.deepEqual(
    centerViewOf({ x: 100, y: 200, width: 50, height: 40 }, { width: 1000, height: 800 }, 1),
    { x: 500 - 125, y: 400 - 220, scale: 1 },
  )
  // scale 参与世界坐标换算（200% 时中心距翻倍）。
  assert.deepEqual(
    centerViewOf({ x: 100, y: 200, width: 50, height: 40 }, { width: 1000, height: 800 }, 2),
    { x: 500 - 250, y: 400 - 440, scale: 2 },
  )
  // 出界 scale 走 clampViewScale（与画布缩放上下限同一口径）。
  assert.equal(centerViewOf({ x: 0, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }, 99).scale, 5)
  assert.equal(centerViewOf({ x: 0, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }, 0).scale, 0.1)
})

test('REQ-029 手势②（CV-286）：单击空白 = 清选 + 收起（判定在 pointerup，拖拽保留选区）', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  const minimap = await read('src/client/canvas/Minimap.tsx')
  // pointerdown：只起手平移，**不得**清选（拖拽第一帧卸工具条/卡的根因）。
  const down = sliceBetween(surface, 'const onSurfacePointerDown =', 'const onNodePointerDown =')
  assert.ok(!/\bonSelectNode\b/.test(down), '空白 pointerdown 不得清选（CV-286：单击才清）')
  assert.ok(!/setSelectedEdge/.test(down), '空白 pointerdown 不得清边选')
  assert.match(down, /movedDist: 0/, 'pan 手势必须初始化累计位移（单击判定的依据）')
  // onPointerMove：pan 分支逐帧累计位移路径（在 startX/startY 改写之前）。
  assert.match(surface, /current\.movedDist = \(current\.movedDist \?\? 0\)/, 'pan 必须累计 movedDist')
  // pointerup：累计 ≤ 5px = 单击 ⇒ 此刻清选 + 清边选（Ctrl/Cmd 例外保留）。
  const up = sliceBetween(surface, 'const onPointerUp =', 'const deprecatedCount =')
  assert.match(up, /current\.mode === 'pan' && \(current\.movedDist \?\? 0\) <= CLICK_CLEAR_SLOP/, 'pointerup 必须按 pan + 位移阈值判定单击')
  assert.match(up, /event\.button === 0 && !\(event\.ctrlKey \|\| event\.metaKey\)\) onSelectNode\(null\)/, '单击空白必须清选（Ctrl/Cmd 例外）')
  assert.match(up, /setSelectedEdge\(null\)/, '单击空白必须清边选中')
  assert.match(surface, /const CLICK_CLEAR_SLOP = 5\b/, '单击位移阈值必须是 5px（2026-09-13 教训的宽容档）')
  // 联动轴一：就地浮层绑选区（选走即关）。
  assert.match(surface, /selectedNodeId !== promptEditNodeId/, '就地浮层必须绑选区（清选即收起）')
  // 联动轴二：就近工具条只在单选时出现 ⇒ 清选即收起。
  assert.match(surface, /selectedNodeIds\.length !== 1 \|\| primaryDragId !== null/, '就近工具条必须只在单选时出现')
  // minimap 同款（CV-286）：按下只记位，mouseup 没拖过阈值才代清选。
  assert.match(minimap, /onSurfaceClick\?\.\(\)/, 'minimap 必须走 onSurfaceClick（单击代清选）')
  assert.ok(!/onSurfacePointerDown/.test(minimap), 'minimap 不得再挂按下即清的回调（prop 已改名）')
  assert.match(minimap, /event\.button === 0 && press !== null && !press\.moved/, 'minimap 只在左键单击且未拖动时清选')
  assert.match(surface, /onSurfaceClick=\{\(\) => \{ onSelectNode\(null\); setSelectedEdge\(null\) \}\}/, '画布必须给 minimap 传 onSurfaceClick')
})

test('REQ-029 手势③：缩放范围维持 10%~500%（演示 25%~400% 让步）', async () => {
  const view = await read('src/canvas-view.ts')
  assert.match(view, /MIN_VIEW_SCALE = 0\.1/, '缩放下限必须维持 10%')
  assert.match(view, /MAX_VIEW_SCALE = 5\b/, '缩放上限必须维持 500%')
})

test('REQ-004/CV-286 滚轮灵敏度：按滚动量指数化，不再每事件固定步长', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /const WHEEL_ZOOM_DIVISOR = 800\b/, '滚轮灵敏度除数必须在位（800px ≈ e 倍）')
  assert.match(surface, /Math\.exp\(-deltaPixels \/ WHEEL_ZOOM_DIVISOR\)/, '滚轮因子必须按滚动量指数化（exp(−δ/除数)）')
  assert.match(surface, /deltaMode === 1/, '须兼容行/页滚动单位（deltaMode 换算）')
  assert.ok(!/ZOOM_STEP/.test(surface), '每事件固定步长 ZOOM_STEP 不得复用（触控板连乘爆炸的根因）')
})
