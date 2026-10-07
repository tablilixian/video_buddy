/**
 * REQ-029 拍板①②③（CV-281 Step 1）手势层守卫。
 *
 * 拍板口径（tracking.md REQ-029 条目「拍板」段）：
 *   ① 双击节点 = 播放/详情保留（CV-044/BUG-028 不动）；双击空白 = 视图复位 100%
 *     （替代 CV-019 的双击空白适配视野；适配能力仍经 handle.fitToContent 保留）；
 *   ② 单击空白 = 清选 + 收起打开中的 UI（叠加）——按下即清选是联动轴，就地浮层 /
 *     就近工具条 / 边选中 / 右键菜单都在这条链上；
 *   ③ 缩放范围维持 10%~500%（演示 25%~400% 让步）——MIN/MAX_VIEW_SCALE 不许动。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法：够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-029 手势①：双击空白 = 复位 100%，适配视野能力仍保留', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 容器双击挂的是 resetZoom —— 写回 fitToContent 即回归到「适配视野」旧语义。
  assert.match(surface, /onDoubleClick=\{\(\) => \{ resetZoom\(\) \}\}/, '双击空白必须挂 resetZoom（拍板①）')
  // 适配视野不许丢：handle 继续暴露 fitToContent（角落控件/工具栏通道）。
  assert.match(surface, /fitToContent, zoomToSelection, resetZoom/, 'useImperativeHandle 必须继续暴露 fitToContent')
  // 复位语义 = 原点 + 100%。
  assert.match(surface, /\{ x: 0, y: 0, scale: 1 \}/, 'resetZoom 必须回到原点 100%')
})

test('REQ-029 手势①：双击节点 = 播放/详情（CV-044）不受影响', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  // 节点双击仍由 CanvasNode 自己处理（CV-071 钉过的 stopPropagation 约定）。
  assert.match(node, /onDoubleClick=\{handleDoubleClick\}/, '节点双击处理必须保留在 CanvasNode')
  // 内层可双击控件的 dblclick 豁免不被删。
  assert.match(node, /onDoubleClick=\{event => \{ event\.stopPropagation\(\) \}\}/, '内层控件的 dblclick 豁免必须保留')
})

test('REQ-029 手势②：单击空白 = 清选 + 收起打开中的 UI（叠加）', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 按下即清选（2026-09-13 验收教训：清选必须在 pointerdown，不能等位移阈值）。
  assert.match(
    surface,
    /event\.button === 0 && !\(event\.ctrlKey \|\| event\.metaKey\)\) onSelectNode\(null\)/,
    '空白按下必须立即清选（Ctrl/Cmd 例外）',
  )
  // 边选中同帧清掉。
  assert.match(surface, /setSelectedEdge\(null\)/, '空白按下必须清边选中')
  // 收起叠加的联动轴一：就地浮层绑选区（选走即关）。
  assert.match(surface, /selectedNodeId !== promptEditNodeId/, '就地浮层必须绑选区（清选即收起）')
  // 联动轴二：就近工具条只在单选时出现 ⇒ 清选即收起。
  assert.match(surface, /selectedNodeIds\.length !== 1 \|\| primaryDragId !== null/, '就近工具条必须只在单选时出现')
})

test('REQ-029 手势③：缩放范围维持 10%~500%（演示 25%~400% 让步）', async () => {
  const view = await read('src/canvas-view.ts')
  assert.match(view, /MIN_VIEW_SCALE = 0\.1/, '缩放下限必须维持 10%')
  assert.match(view, /MAX_VIEW_SCALE = 5\b/, '缩放上限必须维持 500%')
})
