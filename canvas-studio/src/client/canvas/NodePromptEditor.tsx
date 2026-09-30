import { useLayoutEffect, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import type { LibraryAsset } from '../../contracts/asset-library.js'
import type { ResolveRefItem } from '../../contracts/reference.js'
import { NODE_ACTION_GAP, NODE_ACTION_MARGIN } from '../../canvas-view.js'
import { isReplayable, promptFieldsOf, promptValueOf, referenceSlotOf, withPromptField } from '../../node-params.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { ReferenceSlotEditor } from './ReferenceSlotEditor.js'

/** Props for the in-place prompt editor panel (the canvas floating layer). */
export interface NodePromptEditorProps {
  node: StudioCanvasNode
  view: StudioCanvasView
  /** 画布可视区尺寸（屏幕 px）—— 放置与夹取都要用它，不是 window 尺寸。 */
  viewport: { width: number; height: number }
  /** 底部被详情抽屉遮住的高度（屏幕 px）；浮层不得落进抽屉里。 */
  bottomInset: number
  /** 当前项目**全部**节点：参考候选池（含 retired / 隐藏，与详情抽屉同一份）。 */
  allNodes: readonly StudioCanvasNode[]
  /** 提示词与参考位都只写 `generationPrompt`（与详情抽屉同一条写回路径）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 「保存并重试」的重试侧（判据在 node-params.isReplayable，缺省不渲染该按钮）。 */
  onRetry?(id: string): void
  /** 关闭浮层（× / Esc / 两个保存按钮共用的出口）。 */
  onClose(): void
  /** 参考区「添加参考」的第二来源（全局资产库）；缺省只给画布节点。 */
  libraryAssets?: readonly LibraryAsset[]
  /** 新增参考的句柄解析（Host 端点）；缺省 = 参考区只读。 */
  onResolveRefs?(refs: readonly string[]): Promise<readonly ResolveRefItem[]>
}

/**
 * 就地提示词编辑浮层（REQ-003 Step 2，B 组 + C 组）—— 贴在**选中节点旁边**的
 * 编辑面板：提示词与参考图同屏（B3），底部「仅保存 / 保存并重试」（C1）。
 *
 * ## 为什么渲染在 `.csCanvasLayer` 之外
 *
 * 与 `NodeActionBar` 同一条理由：画布层带 `transform: translate() scale()`，
 * 画在里面的浮层会跟着缩放变形（textarea 在 0.5 倍下没法打字）。所以浮层渲染在
 * 画布层的兄弟层，用屏幕坐标定位 —— 尺寸恒定，位置跟着节点走。
 *
 * ## 两条语义红线（方案 §4.6）
 *
 * 1. **编辑不触发**：提示词与参考位都只写 `generationPrompt`（`withPromptField` /
 *    `ReferenceSlotEditor` 的既有契约）；「仅保存」落完字段就关浮层，**不出图**。
 * 2. **重试判据唯一**：「保存并重试」仍只走 `node-params.isReplayable`（与
 *    NodeActionBar 同款表达式，不另写一套）；不可重放的节点不出现该按钮。
 *    且它是**显式按钮** —— 先 `commitAll()` 落字段、再 `onRetry`（retryNode 从
 *    store 现读参数，同一次事件里先写后读是安全的），不是失焦自动重跑（C4）。
 *
 * ## 放置是 Step 2 的**最简规则**
 *
 * 贴节点右侧、夹进视口安全区（8px 边距 + 抽屉让位）。四侧择优与最小平移是
 * Step 3 的 `editorPlacement` 求解器，这里不预支 —— 节点贴右缘时浮层会压住节点，
 * 是已知且已登记的 Step 3 待办，不是缺陷。
 */
export function NodePromptEditor(props: NodePromptEditorProps) {
  const { node, view, viewport, bottomInset, allNodes, onUpdateNode, onRetry, onClose, libraryAssets, onResolveRefs } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const fieldRefs = useRef(new Map<string, PromptEditorHandle>())
  // 同一事件里连续提交多个提示词字段（音乐节点有两个）时，后一个字段必须看到
  // 前一个字段写完的 JSON —— ref 同步跟上；否则第二笔会用旧 raw 覆盖第一笔。
  const rawRef = useRef(node.generationPrompt)
  rawRef.current = node.generationPrompt

  const promptFields = promptFieldsOf(node)
  const slot = referenceSlotOf(node)

  // 先量再放（NodeActionBar 同款手法：layout effect 量完立刻同步重渲染，
  // 用户看不到「摆错位置的一帧」）。面板高度随内容变，不能写死。
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const next = { width: el.offsetWidth, height: el.offsetHeight }
    setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next))
  })

  /** 提示词字段提交：只写回本地字段，**不发生成请求**（与详情抽屉同契约）。 */
  const commitPrompt = (key: string, next: string): void => {
    const raw = withPromptField(rawRef.current, key, next)
    if (raw === null) return
    rawRef.current = raw
    onUpdateNode(node.id, { generationPrompt: raw })
  }

  /** 把每个字段编辑器里的当前草稿落成字段（内容没变的编辑器自己不会写）。 */
  const commitAll = (): void => {
    for (const field of promptFields) fieldRefs.current.get(field.key)?.commit()
  }

  // C2：判据与 NodeActionBar 同款（isReplayable + 不在生成中），组件不自造判据。
  const canRetry = onRetry !== undefined && node.isLoading !== true && isReplayable(node)

  /** C1/C4：显式按钮 —— 先落字段再触发重试，**不是**失焦自动重跑。 */
  const saveAndRetry = (): void => {
    commitAll()
    onRetry?.(node.id)
    onClose()
  }

  // 屏幕矩形换算与 nodeActionAnchor 同式（left = box.x * scale + view.x）。
  const nodeLeft = node.x * view.scale + view.x
  const nodeTop = node.y * view.scale + view.y
  const nodeWidth = node.width * view.scale
  const nodeHeight = node.height * view.scale
  // 节点整个滚出视野 ⇒ 浮层退场（与 nodeActionAnchor.visible 同一相交语义）：
  // 钉在屏幕边缘的编辑框只会让人不知道在改谁。
  const nodeVisible = nodeLeft < viewport.width && nodeTop < viewport.height
    && nodeLeft + nodeWidth > 0 && nodeTop + nodeHeight > 0
  if (!nodeVisible) return null
  // 贴节点右侧，夹进安全区（下边让开抽屉）。区间倒挂时 maxX/maxY 走 margin 兜底。
  const maxX = Math.max(NODE_ACTION_MARGIN, viewport.width - NODE_ACTION_MARGIN - size.width)
  const maxY = Math.max(NODE_ACTION_MARGIN, viewport.height - bottomInset - NODE_ACTION_MARGIN - size.height)
  const x = Math.min(Math.max(nodeLeft + nodeWidth + NODE_ACTION_GAP, NODE_ACTION_MARGIN), maxX)
  const y = Math.min(Math.max(nodeTop, NODE_ACTION_MARGIN), maxY)

  return (
    <div
      ref={rootRef}
      className="csNodePromptPanel"
      style={{ left: x, top: y }}
      aria-label={`就地编辑提示词：${node.title ?? node.kind}`}
      // 与 NodeActionBar 同一套手势守卫（见该组件注释）：画布空白 pointerdown
      // 「按下即清选」会把选中清掉、浮层随之卸载；双击/右键会被画布外层抢走。
      onPointerDown={event => { event.stopPropagation() }}
      onDoubleClick={event => { event.stopPropagation() }}
      onContextMenu={event => { event.stopPropagation() }}
      // Esc 关浮层。textarea 里的 Esc 被 PromptEditor 拦成「重置草稿」且 stopPropagation，
      // 冒不到这里 —— 焦点不在正文时 Esc 才关面板，两个语义不打架。
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
    >
      <div className="csNodePromptHead">
        <span className="csNodePromptTitle">编辑提示词</span>
        <span className="csNodePromptSub">{node.title}</span>
        <button type="button" className="csDetailDrawerClose" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      <div className="csNodePromptBody">
        {promptFields.map((field, index) => (
          <PromptEditor
            key={field.key}
            ref={handle => {
              if (handle === null) fieldRefs.current.delete(field.key)
              else fieldRefs.current.set(field.key, handle)
            }}
            nodeId={node.id}
            label={field.label}
            value={promptValueOf(node, field.key)}
            onCommit={next => { commitPrompt(field.key, next) }}
            {...(node.isLoading === true ? { disabled: true } : {})}
            // B1：第一个字段挂载即进就地档并聚焦，可立刻打字；其余字段从只读档开始。
            {...(index === 0 ? { autoEdit: true } : {})}
          />
        ))}
        {/* B3：参考图与提示词同屏 —— 复用 Step 1 的编辑区组件（增删换重排 +
            位次读数 + 断链占位），不在浮层里再写一份。 */}
        {slot !== null && (
          <ReferenceSlotEditor
            node={node}
            allNodes={allNodes}
            onUpdateNode={onUpdateNode}
            {...(libraryAssets !== undefined ? { libraryAssets } : {})}
            {...(onResolveRefs !== undefined ? { onResolveRefs } : {})}
          />
        )}
      </div>
      <div className="csNodePromptFoot">
        <span className="csPromptHint">改动只落参数，不会自己出图</span>
        {/* B2：仅保存 = 落字段 + 关浮层，不发生成请求。 */}
        <button type="button" className="csDetailButton" onClick={() => { commitAll(); onClose() }}>仅保存</button>
        {canRetry && (
          <button
            type="button"
            className="csDetailButton csDetailButtonActive"
            title="先把改动写进参数，再用这些参数重新生成一版"
            onClick={saveAndRetry}
          >
            保存并重试
          </button>
        )}
      </div>
    </div>
  )
}
