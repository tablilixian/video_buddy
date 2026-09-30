import { useLayoutEffect, useRef, useState, useCallback, useEffect } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import type { LibraryAsset } from '../../contracts/asset-library.js'
import type { ResolveRefItem } from '../../contracts/reference.js'
import {
  EDITOR_SHEET_BREAKPOINT,
  editorPlacement,
} from '../../canvas-view.js'
import { pictureIssues, pictureNumbersIn, rewritePictureNumbers } from '../../prompt-refs.js'
import { deleteEditorDraft, getEditorDraft, hasEditorDraft, setEditorDraft } from '../../editor-drafts.js'
import { isReplayable, promptFieldsOf, promptValueOf, referenceNamesOf, referenceSlotOf, withPromptField, withReferenceNames } from '../../node-params.js'
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
  /** 关闭浮层（× / Esc / 两个保存按钮 / 选中移走 共用的出口）。 */
  onClose(): void
  /** 视口补丁（E5「恢复视野」走这条既有通路；CanvasSurface 转发自己的 prop）。 */
  onViewChange(patch: Partial<StudioCanvasView>): void
  /**
   * E3/E4：把求解器算出的**最小平移**施加到 view。由 CanvasSurface 实现 ——
   * 只有它知道手势状态：用户滚轮/拖动期间必须立即放弃自动平移（不抢视野）。
   */
  onPan(dx: number, dy: number): void
  /** 参考区「添加参考」的第二来源（全局资产库）；缺省只给画布节点。 */
  libraryAssets?: readonly LibraryAsset[]
  /** 新增参考的句柄解析（Host 端点）；缺省 = 参考区只读。 */
  onResolveRefs?(refs: readonly string[]): Promise<readonly ResolveRefItem[]>
}

/**
 * 就地提示词编辑浮层（REQ-003，B/C/D/E/F 组的画布宿主）—— 贴在**选中节点旁边**
 * 的编辑面板：提示词与参考图同屏（B3），「仅保存 / 保存并重试」在页脚（C1），
 * 长文本分档、贴边四侧择优、`<Picture N>` 一致性、草稿与键盘都在这一层。
 *
 * ## 为什么渲染在 `.csCanvasLayer` 之外
 *
 * 与 `NodeActionBar` 同一条理由：画布层带 `transform: translate() scale()`，
 * 画在里面的浮层会跟着缩放变形（textarea 在 0.5 倍下没法打字）。所以浮层渲染在
 * 画布层的兄弟层，用**屏幕坐标**定位 —— 尺寸恒定，位置跟着节点走；而平移作用在
 * **view** 上（画布动，面板不动），两者不要混。
 *
 * ## 两条语义红线（方案 §4.6）
 *
 * 1. **编辑不触发**：提示词与参考位都只写 `generationPrompt`；「仅保存」落完字段
 *    就关浮层，**不出图**。草稿是没保存的东西，只进内存草稿表（`editor-drafts.ts`）。
 * 2. **重试判据唯一**：「保存并重试」仍只走 `node-params.isReplayable`；且是
 *    **显式按钮** —— 先 `commitAll()` 落字段、再 `onRetry`（retryNode 从 store
 *    现读参数，同一次事件里先写后读是安全的），不是失焦自动重跑（C4）。
 *
 * ## 放置与视野（E 组）
 *
 * 位置由 `editorPlacement` 求解（四侧择优 → 夹取 → 必要时最小平移；窄窗降级底部
 * 抽屉）。求解器输入矩形与渲染**同一份**节点数据；平移经 `onPan` 交给
 * CanvasSurface —— 只有它知道手势状态，用户滚轮/拖动期间立即放弃（E4）。
 * 关闭**不回弹**：打开时的 view 快照只供头部「恢复视野」按钮手动回位（E5）。
 */
export function NodePromptEditor(props: NodePromptEditorProps) {
  const { node, view, viewport, bottomInset, allNodes, onUpdateNode, onRetry, onClose, onViewChange, onPan, libraryAssets, onResolveRefs } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const fieldRefs = useRef(new Map<string, PromptEditorHandle>())
  // 同一事件里连续提交多个提示词字段（音乐节点有两个）时，后一个字段必须看到
  // 前一个字段写完的 JSON —— ref 同步跟上；否则第二笔会用旧 raw 覆盖第一笔。
  const rawRef = useRef(node.generationPrompt)
  rawRef.current = node.generationPrompt

  const promptFields = promptFieldsOf(node)
  const slot = referenceSlotOf(node)
  const names = referenceNamesOf(node.generationPrompt)
  const promptText = promptValueOf(node, 'prompt')

  // ---- E5：打开时的视野快照（关闭不回弹；「恢复视野」手动回位）----
  const viewBeforeOpen = useRef(view)
  const viewPanned = view.x !== viewBeforeOpen.current.x || view.y !== viewBeforeOpen.current.y

  // ---- F2/F3：参考位与 `<Picture N>` 一致性的基线（打开时的 refs + prompt；
  //      撤销 = 回到基线；同步编号不改基线 —— 撤销仍能一路退回改动前）----
  const baseline = useRef({ names, prompt: promptText })
  /** F8：同步编号之后的中性回执（撤销入口在这里，不随警告条一起消失）。 */
  const [receipt, setReceipt] = useState<string | null>(null)

  // ---- F5：草稿（内存表；重开回填 + 「未保存」标记；显式取消才丢弃）----
  const [hadDraft] = useState(() => hasEditorDraft(node.id))
  const seed = useRef(getEditorDraft(node.id))
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({})
  const reportField = useCallback((key: string, next: string) => {
    setFieldDrafts(previous => (previous[key] === next ? previous : { ...previous, [key]: next }))
  }, [])
  const dirtyCount = promptFields.filter(field => fieldDrafts[field.key] !== undefined && fieldDrafts[field.key] !== promptValueOf(node, field.key)).length

  // ---- F1/F3 共用的字段提交：只写 generationPrompt，不发生成请求 ----
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

  // ---- C2：重试判据与 NodeActionBar 同款（isReplayable + 不在生成中）----
  const canRetry = onRetry !== undefined && node.isLoading !== true && isReplayable(node)

  // ---- C1/C4：显式按钮 —— 先落字段再触发重试；成功后清草稿 ----
  const saveAndRetry = (): void => {
    commitAll()
    onRetry?.(node.id)
    deleteEditorDraft(node.id)
    onClose()
  }
  const saveOnly = (): void => {
    commitAll()
    deleteEditorDraft(node.id)
    onClose()
  }
  /** F5：Esc / × / 选中移走 —— 草稿保留（重开回填），显式「取消」才丢弃。 */
  const closeKeepingDraft = (): void => {
    const dirty = promptFields.some(field => fieldDrafts[field.key] !== undefined && fieldDrafts[field.key] !== promptValueOf(node, field.key))
    if (dirty) setEditorDraft(node.id, { prompt: fieldDrafts })
    else deleteEditorDraft(node.id)
    onClose()
  }
  const discardAndClose = (): void => {
    deleteEditorDraft(node.id)
    onClose()
  }

  // ---- F2/F3：一致性判定与两个动作 ----
  const pictures = pictureNumbersIn(promptText)
  const pictureAware = (slot?.ordered ?? false) || pictures.length > 0
  const issues = pictureIssues(promptText, names.length)
  const namesChanged = names.length !== baseline.current.names.length
    || names.some((name, index) => name !== baseline.current.names[index])
  const showPictureBar = pictureAware && receipt === null
    && (issues.dangling.length > 0 || (namesChanged && pictures.length > 0))
  /** F3：同步编号 = 按出现顺序致密化 1..k，越界夹到 k（改用户文本 ⇒ 必须留回执）。 */
  const syncPictures = (): void => {
    const result = rewritePictureNumbers(promptText, names.length)
    if (result.text !== promptText) commitPrompt('prompt', result.text)
    setReceipt(result.clamped > 0
      ? `已把 <Picture N> 同步为 1..${names.length}，其中 ${result.clamped} 处越界是猜的，请人工确认。`
      : '已把 <Picture N> 按出现顺序同步为 1..k。')
  }
  /** F3/F8：撤销这次改动 = 回到基线（refs + prompt），回执随之消失。 */
  const undoRefChange = (): void => {
    const base = baseline.current
    let raw: string | null = node.generationPrompt ?? ''
    if (slot !== null) {
      const restored = withReferenceNames(raw, slot, base.names)
      if (restored !== null) raw = restored
    }
    if (promptText !== base.prompt) {
      const restoredPrompt = withPromptField(raw, 'prompt', base.prompt)
      if (restoredPrompt !== null) raw = restoredPrompt
    }
    if (raw !== (node.generationPrompt ?? '')) onUpdateNode(node.id, { generationPrompt: raw })
    baseline.current = { names: base.names, prompt: base.prompt }
    setReceipt(null)
  }

  // ---- 放置（E 组）：求解器输入与渲染同一份节点数据；先夹高度（body 的 CSS
  //      max-height）→ 再测量（layout effect）→ 再定位 ----
  const narrow = viewport.width < EDITOR_SHEET_BREAKPOINT
  const placement = editorPlacement(node, view, viewport, { width: size.width, height: size.height }, narrow, bottomInset)

  // 先量再放（NodeActionBar 同款手法：layout effect 量完立刻同步重渲染，
  // 用户看不到「摆错位置的一帧」）。面板高度随内容变，不能写死。
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const next = { width: el.offsetWidth, height: el.offsetHeight }
    setSize(previous => (previous.width === next.width && previous.height === next.height ? previous : next))
  })

  // E3：把求解器算出的最小平移交上去（CanvasSurface 负责手势守卫与落盘）。
  // 依赖是序列化的 pan：手势期间被拒绝的 pan 不重试（E4 —— 立即放弃，不抢视野）。
  const panKey = `${placement.pan.dx},${placement.pan.dy}`
  useEffect(() => {
    if (placement.pan.dx === 0 && placement.pan.dy === 0) return
    onPan(placement.pan.dx, placement.pan.dy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panKey])

  // E7：节点整个滚出视野 ⇒ 浮层退场（钩子之后才允许 early return）。
  if (!placement.visible) return null

  const restoreView = (): void => {
    onViewChange({ x: viewBeforeOpen.current.x, y: viewBeforeOpen.current.y })
  }

  return (
    <div
      ref={rootRef}
      className={placement.mode === 'sheet' ? 'csNodePromptPanel csNodePromptPanelSheet' : 'csNodePromptPanel'}
      style={{
        left: placement.rect.x,
        top: placement.rect.y,
        ...(placement.mode === 'sheet' ? { width: placement.rect.width, height: placement.rect.height } : {}),
      }}
      aria-label={`就地编辑提示词：${node.title ?? node.kind}`}
      // 与 NodeActionBar 同一套手势守卫（见该组件注释）：画布空白 pointerdown
      // 「按下即清选」会把选中清掉、浮层随之卸载；双击/右键会被画布外层抢走。
      onPointerDown={event => { event.stopPropagation() }}
      onDoubleClick={event => { event.stopPropagation() }}
      onContextMenu={event => { event.stopPropagation() }}
      // F6：Esc 关浮层（textarea 里的 Esc 被 PromptEditor 拦成「重置草稿」，
      // 冒不到这里）；Cmd/Ctrl+Enter = 保存并重试（焦点在正文里时由编辑器
      // 的 onCmdEnter 接走并拦冒泡，这里只管焦点不在正文的情况）。
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); closeKeepingDraft(); return }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveAndRetry() }
      }}
    >
      <div className="csNodePromptHead">
        <span className="csNodePromptTitle">编辑提示词</span>
        <span className="csNodePromptSub">{node.title}</span>
        {(hadDraft || dirtyCount > 0) && (
          <span className="csPromptDirtyPill">{dirtyCount > 0 ? `未保存 · 已改 ${dirtyCount} 处` : '未保存'}</span>
        )}
        {/* E5：恢复打开前的视野。没平移过时禁用。 */}
        <button
          type="button"
          className="csDetailButton csNodePromptRestore"
          disabled={!viewPanned}
          title="回到打开编辑器之前的视野（关闭不会自动回弹）"
          onClick={restoreView}
        >恢复视野</button>
        <button type="button" className="csDetailDrawerClose" aria-label="关闭" onClick={closeKeepingDraft}>×</button>
      </div>

      {/* F2/F3：参考位改动与提示词编号失配 —— amber 提示 + 两个动作（不阻断）。 */}
      {showPictureBar && (
        <div className="csPromptWarnbar">
          <span className="csPromptWarnbarText">
            {issues.dangling.length > 0
              ? `提示词引用了 <Picture ${issues.max}>，但现在只有 ${names.length} 张参考 —— 参考顺序就是编号。`
              : '参考顺序已改变 —— 提示词里的 <Picture N> 按位次指向，指向随之改变。'}
          </span>
          <button type="button" className="csDetailButton" title="按出现顺序把编号压成 1..k（越界夹到 k）" onClick={syncPictures}>同步编号</button>
          {namesChanged && <button type="button" className="csDetailButton" onClick={undoRefChange}>撤销这次改动</button>}
        </div>
      )}
      {/* F8：工具性改动执行后的**中性回执** —— 撤销入口在这里，不随警告条消失。 */}
      {receipt !== null && (
        <div className="csPromptWarnbar csPromptWarnbarNeutral">
          <span className="csPromptWarnbarText">{receipt}</span>
          <button type="button" className="csDetailButton" onClick={undoRefChange}>撤销</button>
        </div>
      )}

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
            onDraftChange={next => { reportField(field.key, next) }}
            {...(seed.current !== undefined && seed.current.prompt[field.key] !== undefined
              ? { seedDraft: seed.current.prompt[field.key] }
              : {})}
            {...(node.isLoading === true ? { disabled: true } : {})}
            // B1：第一个字段挂载即进就地档并聚焦，可立刻打字；其余字段从只读档开始。
            {...(index === 0 ? { autoEdit: true } : {})}
            onCmdEnter={saveAndRetry}
          />
        ))}
        {/* B3：参考图与提示词同屏 —— 复用 Step 1 的编辑区组件（增删换重排 +
            位次读数 + F1 参数行 + F4 横滚），不在浮层里再写一份。 */}
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
        {/* F5：显式「取消」是唯一丢弃草稿的路径。 */}
        <button type="button" className="csDetailButton" onClick={discardAndClose}>取消</button>
        {/* B2：仅保存 = 落字段 + 关浮层，不发生成请求。 */}
        <button type="button" className="csDetailButton" onClick={saveOnly}>仅保存</button>
        {canRetry && (
          <button
            type="button"
            className="csDetailButton csDetailButtonActive"
            title="先把改动写进参数，再用这些参数重新生成一版（⌘↵）"
            onClick={saveAndRetry}
          >
            保存并重试
          </button>
        )}
      </div>
    </div>
  )
}
