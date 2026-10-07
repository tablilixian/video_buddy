import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { deleteEditorDraft, getEditorDraft, hasEditorDraft, setEditorDraft } from '../../editor-drafts.js'
import { promptFieldsOf, promptValueOf, referenceNamesOf, referenceSlotOf, withPromptField, type PromptField } from '../../node-params.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'

/** Props for the node input card (REQ-029, the demo-styled editing surface). */
export interface NodeInputCardProps {
  node: StudioCanvasNode
  view: StudioCanvasView
  /** 画布可视区尺寸（屏幕 px）—— 锚定与夹取都要用它。 */
  viewport: { width: number; height: number }
  /** 底部被详情抽屉遮住的高度（屏幕 px）；夹取时避开。 */
  bottomInset: number
  /** 提示词只写 `generationPrompt`（与就地浮层同一条写回路径）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 关闭（× / Esc / 选中移走共用的出口）。 */
  onClose(): void
}

/**
 * 节点输入框卡（REQ-029 / CV-281 Step 2）—— 演示 `canvas-imagenode-inputbox.html`
 * 的 1:1 骨架（image 形态基座；REQ-031 video 形态以同组件扩展迁入，见方案 §6.4）。
 *
 * ## 与就地浮层（NodePromptEditor）的关系：替换 + 迁移分批（拍板⑧）
 *
 * Step 2~4 两面并存：本卡管「单击节点唤起」的创建/编辑面，浮层暂留管「改提示词」
 * 入口，同一时刻互斥（CanvasSurface 接线）；Step 5 入口改道、浮层退役。能力迁移
 * 纪律：提示词编辑直接复用 PromptEditor + 同一份内存草稿表（`editor-drafts.ts`），
 * 写回同一条 `withPromptField` 通路 —— 浮层的两条语义红线（**编辑不触发** /
 * **判据唯一**）原样继承：本卡只落字段，绝不发生成请求（发送钮 Step 4 才接生成链路）。
 *
 * ## 放置
 *
 * 渲染在 `.csCanvasLayer` **之外**（与浮层同一条理由：画在层内会跟着
 * transform 缩放变形，textarea 没法打字）。常态锚在节点正下方、水平居中
 * （演示「顶边紧贴节点下沿弹出」），按实测尺寸夹取；展开态（放大编辑器）
 * 改为屏幕居中独立形态，不吃画布锚点（演示 body.zoomed）。
 *
 * ## 1:1 还原纪律
 *
 * 色值/圆角/阴影照抄演示（用户硬要求；与 lobby 的「令牌随预设」不同——画布内
 * 新面 accent 固定 `#ffb066`，偏差登记见方案 §九）。参考托盘（Step 3）与底栏
 * chips（Step 4）当前是静态视觉位：计数读数已接真值（`referenceNamesOf` / 槽位
 * max），按钮待后续步骤转真。
 */

/** 演示展开钮（↗↙ 对角箭头，`.on` 时旋转 180° 变 ↙↗）。 */
const EXPAND_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.5 1.5h4v4" /><path d="M12.5 1.5 8 6" /><path d="M5.5 12.5h-4v-4" /><path d="M1.5 12.5 6 8" />
  </svg>
)

/** `generationPrompt` 不可解析/为空时的兜底字段（形状同 node-params 的 PROMPT_ONLY）。 */
const FALLBACK_PROMPT_FIELD: readonly PromptField[] = [{ key: 'prompt', label: '提示词' }]

export function NodeInputCard(props: NodeInputCardProps) {
  const { node, view, viewport, bottomInset, onUpdateNode, onClose } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [expanded, setExpanded] = useState(false)
  // 入场动画：演示「未选中态停在锚点上，16px 下坠偏移 + 渐隐」——挂载次帧才挂
  // In 类，让过渡从偏移态走到落位（不写从视口外滑入，丢贴合感）。
  const [entered, setEntered] = useState(false)
  useEffect(() => { setEntered(true) }, [])

  const fieldRefs = useRef(new Map<string, PromptEditorHandle>())
  // 同一事件里连续提交多个字段时，后一个必须看到前一个写完的 JSON（浮层同款）。
  const rawRef = useRef(node.generationPrompt)
  rawRef.current = node.generationPrompt
  // 槽位表里没有的工具（generationPrompt 不可解析等）退到单一 prompt 字段；
  // 写回由 withPromptField 兜底（不可解析返回 null ⇒ 放弃写入，不留半截状态）。
  const parsedFields = promptFieldsOf(node)
  const promptFields: readonly PromptField[] = parsedFields.length > 0 ? parsedFields : FALLBACK_PROMPT_FIELD

  // ---- 草稿（与浮层同一份内存表：重开回填 + 「未保存」；显式取消才丢弃）----
  const [hadDraft] = useState(() => hasEditorDraft(node.id))
  const seed = useRef(getEditorDraft(node.id))
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({})
  const reportField = useCallback((key: string, next: string) => {
    setFieldDrafts(previous => (previous[key] === next ? previous : { ...previous, [key]: next }))
  }, [])
  const dirtyCount = promptFields.filter(field => fieldDrafts[field.key] !== undefined && fieldDrafts[field.key] !== promptValueOf(node, field.key)).length

  // ---- F1/F3 同款字段提交：只写 generationPrompt，不发生成请求 ----
  const commitPrompt = (key: string, next: string): void => {
    const raw = withPromptField(rawRef.current, key, next)
    if (raw === null) return
    rawRef.current = raw
    onUpdateNode(node.id, { generationPrompt: raw })
  }

  /** Esc / × / 选中移走 —— 草稿保留（重开回填），与浮层同一纪律。 */
  const closeKeepingDraft = (): void => {
    const dirty = promptFields.some(field => fieldDrafts[field.key] !== undefined && fieldDrafts[field.key] !== promptValueOf(node, field.key))
    if (dirty) setEditorDraft(node.id, { prompt: fieldDrafts })
    else deleteEditorDraft(node.id)
    onClose()
  }

  // ---- 参考托盘（Step 3 转真）：计数读数接真值，槽位上限来自 REFERENCE_SLOTS ----
  const refCount = referenceNamesOf(node.generationPrompt).length
  const refCap = referenceSlotOf(node)?.max ?? 4

  // ---- 放置：先量再放（浮层同款 layout effect 手法）----
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const next = { width: el.offsetWidth, height: el.offsetHeight }
    setSize(previous => (previous.width === next.width && previous.height === next.height ? previous : next))
  })

  const scale = view.scale
  const anchorX = view.x + (node.x + node.width / 2) * scale
  const nodeBottom = view.y + (node.y + node.height) * scale
  const nodeTop = view.y + node.y * scale
  // E7 同款：节点整个滚出视野 ⇒ 卡退场。
  if (nodeBottom < 0 || nodeTop > viewport.height) return null
  const left = expanded ? viewport.width / 2 : anchorX
  const top = expanded ? viewport.height / 2 : nodeBottom + 10
  // 水平夹取：卡心不越出视口两侧；垂直夹取：底部避开详情抽屉，顶不低于 8px。
  const half = size.width / 2
  const clampedLeft = size.width > 0
    ? Math.min(Math.max(left, half + 8), Math.max(viewport.width - half - 8, half + 8))
    : left
  const maxTop = viewport.height - bottomInset - size.height - 8
  const clampedTop = !expanded && size.height > 0 ? Math.min(Math.max(top, 8), Math.max(maxTop, 8)) : top

  return (
    <div
      ref={rootRef}
      className={
        'csNodeInputCard'
        + (entered ? ' csNodeInputCardIn' : '')
        + (expanded ? ' csNodeInputCardZoomed' : '')
      }
      style={{ left: clampedLeft, top: clampedTop }}
      aria-label={`节点输入框：${node.title ?? node.kind}`}
      // 与浮层同一套手势守卫：卡上的按下/双击/右键不能落进画布空白语义
      // （按下即清选会卸载本卡），也不能触发画布平移。
      onPointerDown={event => { event.stopPropagation() }}
      onDoubleClick={event => { event.stopPropagation() }}
      onContextMenu={event => { event.stopPropagation() }}
      onKeyDown={event => {
        // F6 同款：Esc 关卡（textarea 里的 Esc 被 PromptEditor 拦成「重置草稿」，
        // 冒不到这里）。
        if (event.key === 'Escape') { event.stopPropagation(); closeKeepingDraft() }
      }}
    >
      <div className="csInputCardAct">
        <button
          type="button"
          className={expanded ? 'csInputCardIb on' : 'csInputCardIb'}
          aria-label={expanded ? '收起' : '展开'}
          title={expanded ? '收起' : '展开'}
          onClick={() => { setExpanded(value => !value) }}
        >
          {EXPAND_ICON}
        </button>
        <button type="button" className="csInputCardIb" aria-label="关闭" onClick={closeKeepingDraft}>×</button>
      </div>
      {(hadDraft || dirtyCount > 0) && (
        <span className="csPromptDirtyPill csInputCardDirty">{dirtyCount > 0 ? `未保存 · 已改 ${dirtyCount} 处` : '未保存'}</span>
      )}

      {/* 参考托盘（Step 3 转真）：缩略图迁入 + 三来源菜单 + 放大镜；当前只有
          「+ N/上限」占位瓦片 —— 视觉 1:1，交互待接入。 */}
      <div className="csInputCardRefs">
        <div className="csRefStrip" />
        <span className="csRefAdd" aria-hidden="true">
          <span className="csRefAddPlus">+</span>
          <span className="csRefAddCount">{refCount}/{refCap}</span>
        </span>
      </div>

      <div className="csInputCardPromptWrap">
        {promptFields.map(field => (
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
            autoEdit
            {...(seed.current !== undefined && seed.current.prompt[field.key] !== undefined
              ? { seedDraft: seed.current.prompt[field.key] }
              : {})}
            {...(node.isLoading === true ? { disabled: true } : {})}
            onDraftChange={next => { reportField(field.key, next) }}
          />
        ))}
      </div>

      {/* 底栏 chips（Step 4 转真）：模型/画幅档位/风格/摄像机/调参/积分/发送 ——
          视觉 1:1 的静态占位（span 不是 button：不装可交互）。档位读数用产品化
          命名（拍板⑥），模型读数用「自动」（拍板②，路由结果 Step 4 接）。 */}
      <div className="csInputCardFoot">
        <div className="csInputCardFootLeft">
          <span className="csInputPill">自动 <span className="csInputPillCaret">▾</span></span>
          <span className="csInputPill">16:9 · 720P <span className="csInputPillCaret">▾</span></span>
          <span className="csInputPill">风格 <span className="csInputPillCaret">▾</span></span>
          <span className="csInputPill">摄像机</span>
        </div>
        <div className="csInputCardFootRight">
          <span className="csInputPill csInputPillIcon" title="提示词增强：功能挂 REQ-003 Step 4 拍板，当前置灰（偏差登记 §九）">✦</span>
          <span className="csInputPill csInputCredits" title="积分：纯展示占位（拍板⑦），结算数值为前端预估">✦ <span className="csInputCreditsNum">25</span></span>
          <button type="button" className="csInputSend" disabled title="发送：Step 4 接入生成链路（CV-281）" aria-label="发送">↑</button>
        </div>
      </div>
    </div>
  )
}
