import { useLayoutEffect, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { nodeActionAnchor } from '../../canvas-view.js'
import { isReplayable, promptFieldsOf } from '../../node-params.js'

/** Props for the node action bar (the small toolbar floating next to the node). */
export interface NodeActionBarProps {
  node: StudioCanvasNode
  view: StudioCanvasView
  /** 画布可视区尺寸（屏幕 px）—— 锚定与夹取都要用它，不是 window 尺寸。 */
  viewport: { width: number; height: number }
  /** 底部被详情抽屉遮住的高度（屏幕 px）；抽屉关着时为 0。 */
  bottomInset: number
  /** 同参数重新生成（判据在 node-params.isReplayable，这里不另写一套）。 */
  onRetry?(id: string): void
  /** 打开详情抽屉并编辑提示词（画布上「改提示词」的最短路径）。 */
  onEditPrompt?(node: StudioCanvasNode): void
  /** 把该节点作为引用标记插入右侧聊天输入框。 */
  onReferenceToChat?(node: StudioCanvasNode): void
}

/**
 * 就近操作条 —— 贴在**选中节点旁边**的小工具条，高频动作零视线跳转。
 *
 * ## 为什么渲染在 `.csCanvasLayer` 之外
 *
 * 画布层带 `transform: translate() scale()`，画在里面的东西会跟着缩放变形：比例
 * 0.3 时按钮文字糊成一团，2.0 时又比节点还大。工具条因此与 minimap 一样渲染在
 * 画布层的**兄弟层**，用 `nodeActionAnchor` 算出的屏幕坐标定位 —— 尺寸恒定，
 * 位置跟着节点走。
 *
 * ## 只有两个前提，其余交给判据
 *
 * 「出现条件」（单选 + 非手势中）由调用方 `CanvasSurface` 决定；「显示哪些按钮」
 * 由 `node-params` 的 `isReplayable` / `promptFieldsOf` 决定。本组件不自造判据 ——
 * 从前的重试按钮就是因为在详情面板里另写了一套「有 toolName + 有 generationPrompt」
 * 的判据，才会在音频 / 四视图 / 抽帧节点上出现却打不通。
 *
 * **一个动作都不给时整条退场**（托盘、无提示词的纯媒体节点、没传回调的调用方）：
 * 空药丸比没有工具条更糟 —— 它会占着节点上方那块地方，还让人以为点得动。
 */
export function NodeActionBar(props: NodeActionBarProps) {
  const { node, view, viewport, bottomInset, onRetry, onEditPrompt, onReferenceToChat } = props
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const canRetry = onRetry !== undefined && node.isLoading !== true && isReplayable(node)
  const canEdit = onEditPrompt !== undefined && node.isLoading !== true && promptFieldsOf(node).length > 0
  // 托盘（分组）本身没有产物，引用它没有语义。
  const canReference = onReferenceToChat !== undefined && node.kind !== 'group'
  const hasActions = canRetry || canEdit || canReference

  // 自身尺寸无从预知（按钮数目随节点类型变），先量再放。用 layout effect 而不是
  // effect：量完立刻同步重渲染，用户看不到「摆错位置的一帧」。
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const next = { width: el.offsetWidth, height: el.offsetHeight }
    setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next))
  })

  const anchor = nodeActionAnchor(node, view, viewport, size, bottomInset)
  // ① 没有动作 ② 节点整个移出视野 —— 工具条随之退场。它的动作全是针对那个节点的，
  // 钉在屏幕边缘只会变成「不知道在操作谁」的悬空按钮。
  if (!hasActions || !anchor.visible) return null

  return (
    <div
      ref={ref}
      className={`csNodeActionBar csNodeActionBar${anchor.placement === 'above' ? 'Above' : 'Below'}`}
      style={{ left: anchor.x, top: anchor.y }}
      // 画布表面在**空白 pointerdown 上「按下即清选」**（见 CanvasSurface 的
      // onSurfacePointerDown）：不拦冒泡的话，按「重试」的**按下瞬间**选中就被清掉，
      // 工具条随之卸载，click 落在空气上 —— 按钮看起来完全失灵。
      onPointerDown={event => { event.stopPropagation() }}
      // 同理：双击会命中画布外层的「双击空白 = 适配视野」，镜头会被无端拽走。
      onDoubleClick={event => { event.stopPropagation() }}
      // 右键不外传：外层的空白菜单（新建节点 / 粘贴 / 适配）与这里的语境无关。
      onContextMenu={event => { event.stopPropagation() }}
    >
      {canRetry && (
        <button
          type="button"
          className="csNodeActionBarBtn"
          title="用当前保存的参数重新生成一版"
          onClick={() => { onRetry(node.id) }}
        >
          重试
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className="csNodeActionBarBtn"
          title="打开详情并编辑提示词"
          onClick={() => { onEditPrompt(node) }}
        >
          改提示词
        </button>
      )}
      {canReference && (
        <button
          type="button"
          className="csNodeActionBarBtn"
          title="把该节点作为引用标记插入右侧输入框"
          onClick={() => { onReferenceToChat(node) }}
        >
          引用到对话
        </button>
      )}
    </div>
  )
}
