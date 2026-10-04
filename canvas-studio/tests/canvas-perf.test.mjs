/**
 * A-2（大画布性能，bug-analysis/A-2.md 三步走）守卫闸。
 *
 * 无 React 渲染环境（node --test），「拖拽时 102 个节点不再全树重渲染」无法
 * 直接断言帧率 —— 按本仓惯例用源码闸钉住结构性前提，再配纯函数单测
 * （edgeControlBounds 在 canvas-geometry.test.mjs，直连编译产物）。
 *
 *   步骤一：CanvasSurface 三个手势入口 useCallback([]) 稳定 + 回调体只读 ref
 *           镜像（selectedNodeIds 走 ref 是 CV-169 的硬要求）；
 *   步骤二：血缘边按边 memo + 视口裁剪（CanvasEdges 消费 viewport）；
 *   步骤三：废弃素材开关退化纯过滤（重排只留在显式「整理布局」路径上）。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
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

const SURFACE = read('src/client/canvas/CanvasSurface.tsx')

/** 三个手势入口的 useCallback 代码块（懒匹配到各自的 `}, [])` 收尾）。 */
function gestureHandlerBlocks() {
  return SURFACE.match(/const on(?:Node|Resize|Link)PointerDown = useCallback\([\s\S]*?\}, \[\]\)/g) ?? []
}

test('A-2 步骤一：三个手势入口 useCallback([]) 稳定，不再每渲染换引用击穿 CanvasNode memo', () => {
  for (const handler of ['onNodePointerDown', 'onResizePointerDown', 'onLinkPointerDown']) {
    assert.match(SURFACE, new RegExp(`const ${handler} = useCallback\\(`),
      `${handler} 必须是 useCallback —— 裸函数每帧新引用，102 节点全树重渲染（A-2 热点 1）`)
  }
  assert.equal(gestureHandlerBlocks().length, 3,
    '三个手势入口都必须以 `}, [])` 收尾：拖拽期间 selectedNodeIds 等渲染期值会变，带依赖的 useCallback 等于没稳定')
})

test('A-2 步骤一：回调体只读 ref 镜像 —— 选区与选择出口不得走渲染期闭包（CV-169 教训）', () => {
  assert.match(SURFACE, /const selectedNodeIdsRef = useRef\(selectedNodeIds\)/,
    'selectedNodeIds 必须有 ref 镜像：渲染期闭包会读到上一次渲染的选区（动 3 张、亮 1 张的老 bug）')
  assert.match(SURFACE, /const onSelectNodeRef = useRef\(onSelectNode\)/)
  for (const block of gestureHandlerBlocks()) {
    // `selectedNodeIdsRef` / `onSelectNodeRef` 因词边界不会命中这两条裸名正则。
    assert.ok(!/\bselectedNodeIds\b/.test(block), '手势回调体读了渲染期 selectedNodeIds —— memo 稳定性与选区时效性两失')
    assert.ok(!/\bonSelectNode\b/.test(block), '手势回调体读了渲染期 onSelectNode —— 引用随渲染抖动')
  }
})

test('A-2 步骤一：被捕获的手势辅助同样终生稳定（只碰 gesture/container ref）', () => {
  assert.match(SURFACE, /const armPointer = useCallback\(/)
  assert.match(SURFACE, /const ensureCaptured = useCallback\(/)
  assert.match(SURFACE, /const releasePointer = useCallback\(/)
})

test('A-2 步骤一：边选中回调稳定（CanvasEdges 顶层 memo 的 props 之一）', () => {
  assert.match(SURFACE, /const handleEdgeSelect = useCallback\(/,
    'handleEdgeSelect 每渲染换引用会让 CanvasEdges 的 memo 挡板失效')
})

test('A-2 步骤一：memo 收益链的两端在位（CanvasNode memo + store 只换被拖节点引用）', () => {
  assert.match(read('src/client/canvas/CanvasNode.tsx'), /export const CanvasNode = memo\(/,
    'CanvasNode 必须 memo（CR-063）—— 步骤一的收益全部经它兑现')
  assert.match(read('src/client/project-store.ts'), /moveNode: \(draft, projectId, id, x, y\) => \{/,
    'store 契约在位：moveNode 只对被拖节点及其直接子节点产生新引用（A-2 的前提）')
})
