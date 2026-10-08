import { useLayoutEffect, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { nodeActionAnchor } from '../../canvas-view.js'
import { canDownloadNode } from '../../canvas-actions.js'
import { isReplayable, promptFieldsOf } from '../../node-params.js'

/** Props for the node action bar (the small toolbar floating next to the node). */
export interface NodeActionBarProps {
  node: StudioCanvasNode
  view: StudioCanvasView
  /** 画布可视区尺寸（屏幕 px）—— 横向夹取要用它，不是 window 尺寸。 */
  viewport: { width: number; height: number }
  /** 同参数重新生成（判据在 node-params.isReplayable，这里不另写一套）。 */
  onRetry?(id: string): void
  /**
   * 打开就地提示词编辑浮层（REQ-003 Step 2 起：浮层由 CanvasSurface 内部接线，
   * 不再开详情抽屉 —— 抽屉仍是双击「查看详情」的入口）。
   */
  onEditPrompt?(node: StudioCanvasNode): void
  /** 把该节点作为引用标记插入右侧聊天输入框。 */
  onReferenceToChat?(node: StudioCanvasNode): void
  /** image 预览（CV-283）：CV-044 大图预览通道（同输入框卡 onOpenPreview）。 */
  onOpenPreview?(node: StudioCanvasNode): void
  /** REQ-031 F4：video 节点「预览」—— CV-044 播放浮层通道。 */
  onOpenPlayback?(node: StudioCanvasNode): void
  /** image「添加到资产库」（CV-283）：LibImportDialog 通路（同右键菜单 onAddToLibrary）。 */
  onAddToLibrary?(id: string): void
  /** REQ-031 F4：「下载资产」—— 与右键菜单同一 Host 通路（按 id）。 */
  onDownload?(id: string): void
}

/**
 * 就近操作条 —— 贴在**选中节点旁边**的小工具条，高频动作零视线跳转。
 *
 * ## 为什么渲染在 `.csCanvasLayer` 之外
 *
 * 画布层带 `transform: translate() scale()`，画在里面的东西会跟着缩放变形：比例
 * 0.3 时按钮文字糊成一团，2.0 时又比节点还大。工具条因此与 minimap 一样渲染在
 * 画布层的**兄弟层**，用 `nodeActionAnchor` 算出的屏幕坐标定位 —— 自身量取的是
 * 布局尺寸，视觉上再用独立 `scale` 属性随画布缩放（演示 `--chrome-scale`：工具条
 * 与卡同倍率，100% 视觉对齐，位置仍与节点无缝相贴）。
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
  const { node, view, viewport, onRetry, onEditPrompt, onReferenceToChat, onOpenPreview, onOpenPlayback, onAddToLibrary, onDownload } = props
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // F4（REQ-031 Step 5）+ CV-283：image/video 工具条 = 演示同款 **引用到对话 /
  // （仅 image）添加到资产库 / 预览 / 下载** —— 重试 / 改提示词不在这两类占位
  // （改提示词 = 单击节点开输入框卡，重试走右键菜单与卡内「发送」）；
  // 其余 kind（audio/text/分组等）无演示覆盖，保持既有「重试 / 改提示词 / 引用」。
  const isVideo = node.kind === 'video'
  const isImage = node.kind === 'image'
  const isMedia = isVideo || isImage
  const canPreview = isMedia && node.url !== undefined && node.isLoading !== true && (
    (isVideo && onOpenPlayback !== undefined) || (isImage && onOpenPreview !== undefined)
  )
  // 下载判据与右键菜单同源（canvas-actions.canDownloadNode：仅 image/video 且带 url）。
  const canDownload = isMedia && onDownload !== undefined && node.isLoading !== true && canDownloadNode(node)
  const canAddToLibrary = isImage && onAddToLibrary !== undefined && node.url !== undefined && node.isLoading !== true
  const canRetry = !isMedia && onRetry !== undefined && node.isLoading !== true && isReplayable(node)
  const canEdit = !isMedia && onEditPrompt !== undefined && node.isLoading !== true && promptFieldsOf(node).length > 0
  // 托盘（分组）本身没有产物，引用它没有语义。
  const canReference = onReferenceToChat !== undefined && node.kind !== 'group'
  const hasActions = canRetry || canEdit || canReference || canAddToLibrary || canPreview || canDownload

  // 自身尺寸无从预知（按钮数目随节点类型变），先量再放。用 layout effect 而不是
  // effect：量完立刻同步重渲染，用户看不到「摆错位置的一帧」。
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const next = { width: el.offsetWidth, height: el.offsetHeight }
    setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next))
  })

  const anchor = nodeActionAnchor(node, view, viewport, size)
  // ① 没有动作 ② 节点整个移出视野 —— 工具条随之退场。它的动作全是针对那个节点的，
  // 钉在屏幕边缘只会变成「不知道在操作谁」的悬空按钮。
  if (!hasActions || !anchor.visible) return null

  return (
    <div
      ref={ref}
      className="csNodeActionBar"
      // anchor.x 是**定位点**（被横向夹过的节点中心）：translate -50% 水平居中、
      // scale 随画布缩放（演示 --chrome-scale），两者都是独立属性，互不覆盖。
      style={{ left: anchor.x, top: anchor.y, scale: `${view.scale}` }}
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
          title="打开就地提示词编辑面板（与右键「修改提示词」同一面板）"
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
      {canAddToLibrary && (
        <button
          type="button"
          className="csNodeActionBarBtn"
          title="把当前画面存入资产库"
          onClick={() => { onAddToLibrary(node.id) }}
        >
          添加到资产库
        </button>
      )}
      {canPreview && (
        <button
          type="button"
          className="csNodeActionBarBtn"
          title={isVideo ? '预览：打开播放浮层' : '预览：打开大图预览'}
          onClick={() => { if (isVideo) onOpenPlayback?.(node); else onOpenPreview?.(node) }}
        >
          预览
        </button>
      )}
      {canDownload && (
        <button
          type="button"
          className="csNodeActionBarBtn"
          title="把产物另存到本地"
          onClick={() => { onDownload(node.id) }}
        >
          下载
        </button>
      )}
    </div>
  )
}
