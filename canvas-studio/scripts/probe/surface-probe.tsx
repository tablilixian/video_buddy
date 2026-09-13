import { createElement, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { StudioCanvasNode } from '../../src/contracts/canvas.js'
import { CanvasSurface } from '../../src/client/canvas/CanvasSurface.js'

/**
 * CanvasSurface 手势探针（CV-167 引入，CV-169 扩展；不在产品构建内）。
 *
 * 用**真的 CanvasSurface 组件** + 语义与 project-store 逐字一致的迷你 store，
 * 在真实 DOM 上跑用户流程。驱动方式有两代：
 * - 合成 `PointerEvent`（`surface-probe.html` 内联脚本，CV-167 那版）；
 * - **真实鼠标/键盘**（`playwright-core` 的 page.mouse / page.keyboard，
 *   CV-169 起）：只有真实输入才会让 `:active` 命中、让 setPointerCapture 真正
 *   生效，因此「按下」「拖动中」两态的计算样式才有可信度。
 *
 * 样式不在这里注入：`STUDIO_STYLES` 是 styles.ts 的模块内常量（故意不导出），
 * 由 `drive.mjs` 走 `preview-tokens.mjs` 的抽取助手 + `brandCssText` 注入真
 * 令牌表 —— 与预览脚本同一套，避免手抄令牌导致「看着差不多对」。
 *
 * 页面通过 `window.__probe.dump()` 回吐每个节点的**计算样式快照**（类名 /
 * opacity / 边框 / 光晕 / 三个乘法变量），断言与截图都在 driver 侧。
 */

/**
 * 深蓝夜戏底图（data URI）。
 *
 * 为什么不用 1×1 透明像素：本探针要取证的是**压暗（--cs-node-dim）与选中描边**，
 * 一内容全空的卡片看起来与背景无异，压不压暗都读不出来。深蓝底让「0.42 的节点
 * 朝浅色画布退色成蓝灰」这条现象与用户截图一一对应。
 */
const NIGHT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="320">'
  + '<rect width="100%" height="100%" fill="#1A2A4A"/>'
  + '<circle cx="120" cy="90" r="40" fill="#2E4C7A"/>'
  + '<rect y="250" width="100%" height="70" fill="#0E1B2E"/>'
  + '</svg>',
)}`

type ProbeNode = StudioCanvasNode

const mkNode = (id: string, x: number, y: number, sourceIds: string[] = []): ProbeNode => ({
  id,
  kind: 'image',
  title: `图层 ${id}`,
  x,
  y,
  width: 220,
  height: 160,
  sourceIds,
  url: NIGHT,
} as ProbeNode)

/**
 * A = 孤立素材；B 引用 A（有上游血缘）；C 孤立。
 * 这样一次探针能同时覆盖两种聚光结果：
 *   选中 A / C（无血缘可揭示）→ 不压暗；选中 B → 点亮 A、压暗 C。
 */
const initialNodes: ProbeNode[] = [
  mkNode('A', 60, 80),
  mkNode('B', 420, 80, ['A']),
  mkNode('C', 780, 80),
]

/** 节点 id → 计算样式快照（driver 侧断言与截图都吃这一份）。 */
interface NodeSnapshot {
  readonly id: string
  readonly cls: string
  readonly opacity: string
  readonly borderColor: string
  readonly boxShadow: string
  readonly scale: string
  readonly nodeOpacity: string
  readonly nodeState: string
  readonly nodeDim: string
  readonly background: string
}

function snapshotNode(id: string): NodeSnapshot | { id: string; missing: true } {
  const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
  if (el === null) return { id, missing: true }
  const cs = window.getComputedStyle(el)
  return {
    id,
    cls: el.className,
    opacity: cs.opacity,
    borderColor: cs.borderColor,
    boxShadow: cs.boxShadow,
    scale: cs.scale,
    nodeOpacity: cs.getPropertyValue('--cs-node-opacity').trim(),
    nodeState: cs.getPropertyValue('--cs-node-state').trim(),
    nodeDim: cs.getPropertyValue('--cs-node-dim').trim(),
    background: cs.backgroundColor,
  }
}

function App(): ReturnType<typeof createElement> {
  const [nodes, setNodes] = useState<ProbeNode[]>(initialNodes)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })

  // —— 以下语义逐字对齐 project-store（selectNode / selectNodes / moveNode）——
  const selectNode = useCallback((id: string | null, multi?: boolean): void => {
    setSelectedNodeIds(prev => {
      if (multi === true && id !== null) {
        const roster = new Set(prev)
        if (roster.has(id)) roster.delete(id)
        else roster.add(id)
        return [...roster]
      }
      return id === null ? [] : [id]
    })
  }, [])
  const selectNodes = useCallback((ids: readonly string[]): void => {
    setSelectedNodeIds(() => [...ids])
  }, [])
  const moveNode = useCallback((id: string, x: number, y: number): void => {
    setNodes(prev => prev.map(n => (n.id === id ? { ...n, x, y } : n)))
  }, [])

  window.__probe = {
    dump: () => ({
      selection: [...selectedNodeIds],
      nodes: initialNodes.map(n => snapshotNode(n.id)),
      positions: Object.fromEntries(
        nodes.map(n => [n.id, `${Math.round(n.x)},${Math.round(n.y)}`]),
      ),
    }),
    setSelected: (ids: string[]) => { setSelectedNodeIds([...ids]) },
    getSelection: () => [...selectedNodeIds],
  }

  return createElement(
    'div',
    {
      // ⚠️ 外层必须是 **flex 容器**：`.csCanvasSurface` 的尺寸契约是
      // `flex: 1; min-height: 0`（在真机里由中间栏的 grid 单元给高度）。
      // 放在普通 block 里它会塌成 0 高 + overflow:hidden —— 节点全被裁掉，
      // 页面一片空白，真实鼠标也就永远点不中任何节点（CV-169 踩过）。
      style: { position: 'relative', display: 'flex', width: '1100px', height: '420px', overflow: 'hidden' },
    },
    createElement(CanvasSurface, {
      nodes,
      view,
      onViewChange: (patch: Partial<typeof view>) => { setView(prev => ({ ...prev, ...patch })) },
      selectedNodeId: selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null,
      selectedNodeIds,
      onSelectNode: selectNode,
      onSelectAllNodes: () => { setSelectedNodeIds(nodes.map(n => n.id)) },
      onMoveNode: moveNode,
      onUpdateNode: (id: string, updates: Partial<StudioCanvasNode>) => {
        setNodes(prev => prev.map(n => (n.id === id ? { ...n, ...updates } : n)))
      },
      onBeginEdit: () => {},
      onPersist: () => {},
      onRemoveNodes: () => {},
      onCopy: () => {},
      onPaste: () => {},
      onUndo: () => {},
      onRedo: () => {},
      onLinkLayers: () => {},
      onRename: () => {},
      onNodeTextSubmit: () => {},
      onNodeOpenDetail: () => {},
      onContextMenu: () => {},
      onBlankContextMenu: () => {},
      onRetry: () => {},
      minimapVisible: false,
    }),
  )
}

declare global {
  interface Window {
    __probe?: {
      dump(): {
        selection: string[]
        nodes: ReadonlyArray<NodeSnapshot | { id: string; missing: true }>
        positions: Record<string, string>
      }
      setSelected(ids: string[]): void
      getSelection(): string[]
    }
  }
}

const container = document.getElementById('root')!
createRoot(container).render(createElement(App))
