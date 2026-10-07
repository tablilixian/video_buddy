import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { libraryMediaUrl } from '../../contracts/asset-library.js'
import type { LibraryAsset } from '../../contracts/asset-library.js'
import type { ResolveRefItem } from '../../contracts/reference.js'
import { deleteEditorDraft, getEditorDraft, hasEditorDraft, setEditorDraft } from '../../editor-drafts.js'
import { promptFieldsOf, promptValueOf, referenceNamesOf, referenceSlotOf, resolveReferenceSummaries, withPromptField, withReferenceNames, type PromptField } from '../../node-params.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'

/** Props for the node input card (REQ-029, the demo-styled editing surface). */
export interface NodeInputCardProps {
  node: StudioCanvasNode
  view: StudioCanvasView
  /** 画布可视区尺寸（屏幕 px）—— 锚定与夹取都要用它。 */
  viewport: { width: number; height: number }
  /** 底部被详情抽屉遮住的高度（屏幕 px）；夹取时避开。 */
  bottomInset: number
  /** 当前项目全部节点：参考托盘的缩略图反查 + 「画布导入」来源候选池。 */
  allNodes: readonly StudioCanvasNode[]
  /** 「选择资产」来源（全局资产库）；缺省 = 只给画布导入。 */
  libraryAssets?: readonly LibraryAsset[]
  /** 解析句柄（Host 侧惰性提升 + 回写源节点）；缺省 = 托盘只读。 */
  onResolveRefs?(refs: readonly string[]): Promise<readonly ResolveRefItem[]>
  /** 悬停放大镜的落地：打开参考源节点的大图预览（CV-044 通道复用）。 */
  onOpenPreview?(node: StudioCanvasNode): void
  /** 提示词只写 `generationPrompt`（与就地浮层同一条写回路径）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 关闭（× / Esc / 选中移走共用的出口）。 */
  onClose(): void
}

/**
 * 节点输入框卡（REQ-029 / CV-281）—— 演示 `canvas-imagenode-inputbox.html` 的
 * 1:1 还原（image 形态基座；REQ-031 video 形态以同组件扩展迁入，见方案 §6.4）。
 *
 * ## 与就地浮层（NodePromptEditor）的关系：替换 + 迁移分批（拍板⑧）
 *
 * Step 2~4 两面并存：本卡管「单击节点唤起」的创建/编辑面，浮层暂留管「改提示词」
 * 入口，同一时刻互斥（CanvasSurface 接线）；Step 5 入口改道、浮层退役。能力迁移
 * 纪律：提示词编辑复用 PromptEditor + 同一份内存草稿表（`editor-drafts.ts`）；
 * 参考托盘走 ReferenceSlotEditor 同一套数据契约（`resolveReferenceSummaries` 反查
 * 缩略图 / `onResolveRefs` 换句柄〔红线②：只存可下发句柄〕/ `withReferenceNames`
 * 写回〔红线③：断链不静默〕）；写回同一条 `withPromptField` 通路 —— 浮层的两条
 * 语义红线（**编辑不触发** / **判据唯一**）原样继承：本卡只落字段，绝不发生成请求
 * （发送钮 Step 4 才接生成链路）。
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
 * 新面 accent 固定 `#ffb066`，偏差登记见方案 §九）。已登记偏差：本地上传来源
 * 置灰（解析链路只收 `lib:`/节点句柄，上传→句柄是新链路，待后续步骤评估）；
 * 档位读数用产品化命名（拍板⑥）；积分占位（拍板⑦）。
 */

/** 演示展开钮（↗↙ 对角箭头，`.on` 时旋转 180° 变 ↙↗）。 */
const EXPAND_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.5 1.5h4v4" /><path d="M12.5 1.5 8 6" /><path d="M5.5 12.5h-4v-4" /><path d="M1.5 12.5 6 8" />
  </svg>
)

/** 演示放大镜钮（悬停缩略图浮出的预览入口）。 */
const ZOOM_ICON = (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="6.5" cy="6.5" r="4.5" /><path d="m10 10 3.5 3.5" />
  </svg>
)

/** `generationPrompt` 不可解析/为空时的兜底字段（形状同 node-params 的 PROMPT_ONLY）。 */
const FALLBACK_PROMPT_FIELD: readonly PromptField[] = [{ key: 'prompt', label: '提示词' }]

/** 「添加参考图」菜单的三个来源（演示顺序）；local 置灰见文件头偏差登记。 */
type RefSource = 'local' | 'library' | 'canvas'

export function NodeInputCard(props: NodeInputCardProps) {
  const { node, view, viewport, bottomInset, allNodes, libraryAssets, onResolveRefs, onOpenPreview, onUpdateNode, onClose } = props
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

  // ---- 参考托盘（Step 3 转真）：ReferenceSlotEditor 同一套数据契约 ----
  const slot = referenceSlotOf(node)
  const names = useMemo(() => referenceNamesOf(node.generationPrompt), [node.generationPrompt])
  const refCap = slot?.max ?? 4
  const refCount = names.length
  const canEdit = onResolveRefs !== undefined
  // 必填单槽「只换不空」（image_fix / character 系）：删成空一定在重试时报参数错。
  const canDelete = !(slot?.required === true && refCount <= 1)
  const atMax = slot !== null && refCount >= slot.max
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 添加菜单：null = 关着；否则展示对应来源的候选（local 置灰见文件头）。 */
  const [refMenu, setRefMenu] = useState<RefSource | null>(null)
  /** 本次解析拿到的句柄 → 来源缩略图（ReferenceSlotEditor 同款兜底：解析回写后
      allNodes 还是旧的，刚加的那张会被判断链；等下一次画布载入自然收敛）。 */
  const [localThumbs, setLocalThumbs] = useState<Readonly<Record<string, { url: string; label: string }>>>({})
  const summaries = useMemo(() => resolveReferenceSummaries(names, allNodes), [names, allNodes])
  const thumbOf = (name: string): { url: string; label: string } | null => {
    const hit = summaries.find(summary => summary.name === name)
    if (hit !== undefined && hit.node !== null && hit.node.url !== undefined) {
      return { url: hit.node.url, label: hit.node.title ?? hit.node.filename ?? name }
    }
    return localThumbs[name] ?? null
  }

  /** 候选池（画布图片节点 + 资产库图片媒体）；只收图片——`<img>` 渲染视频必破图
      （ReferenceSlotEditor 同款纪律），视频/音频参考走生成参数的 videoRefs/audioRefs。 */
  const candidates = useMemo(() => {
    const taken = new Set(names)
    const fromCanvas = allNodes
      .filter(candidate => candidate.id !== node.id
        && candidate.url !== undefined
        && candidate.kind === 'image'
        && !(candidate.filename !== undefined && taken.has(candidate.filename)))
      .map(candidate => ({
        ref: candidate.id,
        label: candidate.title ?? candidate.filename ?? '未命名',
        url: candidate.url as string,
        source: 'canvas' as const,
      }))
    const fromLibrary = (libraryAssets ?? []).flatMap(asset => {
      const media = asset.media.find(entry => entry.kind === 'image')
      if (media === undefined) return []
      const handle = `lib:${asset.id}`
      if (taken.has(handle)) return []
      return [{ ref: handle, label: asset.name, url: libraryMediaUrl(asset.id, media.file), source: 'library' as const }]
    })
    return [...fromCanvas, ...fromLibrary]
  }, [allNodes, libraryAssets, node.id, names])
  const menuCandidates = refMenu === 'canvas'
    ? candidates.filter(candidate => candidate.source === 'canvas')
    : refMenu === 'library'
      ? candidates.filter(candidate => candidate.source === 'library')
      : []

  /** 唯一的写入口：归一化失败一律**不写**，并把理由说出来（红线③同款）。 */
  const commitRefs = (next: readonly string[]): boolean => {
    if (slot === null) return false
    const raw = withReferenceNames(node.generationPrompt, slot, next)
    if (raw === null) {
      setError(refCount >= slot.max && next.length > slot.max
        ? `最多 ${slot.max} 张参考，这次没有改动。`
        : slot.required && next.length === 0
          ? '这个工具的参考图是必填的（删成空会重试失败），所以只能替换。'
          : '这个节点的生成参数无法解析（老数据或被手改过），为避免写坏，本次改动已放弃。')
      return false
    }
    setError(null)
    onUpdateNode(node.id, { generationPrompt: raw })
    return true
  }

  const resolveAndCommit = async (refs: readonly string[]): Promise<void> => {
    if (onResolveRefs === undefined || refs.length === 0) return
    setBusy(true)
    try {
      const items = await onResolveRefs(refs)
      const handles: string[] = []
      const failures: string[] = []
      const learned: Record<string, { url: string; label: string }> = {}
      for (const item of items) {
        if (item.handle !== undefined) {
          handles.push(item.handle)
          const source = candidates.find(candidate => candidate.ref === item.ref)
          if (source !== undefined) learned[item.handle] = { url: source.url, label: source.label }
        } else {
          failures.push(`${candidates.find(candidate => candidate.ref === item.ref)?.label ?? item.ref}：${item.error?.message ?? '解析失败'}`)
        }
      }
      if (Object.keys(learned).length > 0) setLocalThumbs(previous => ({ ...previous, ...learned }))
      if (handles.length > 0) commitRefs([...names, ...handles])
      setError(failures.length > 0 ? failures.join('；') : null)
      setRefMenu(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取参考图句柄失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const removeRefAt = (index: number): void => {
    commitRefs(names.filter((_, current) => current !== index))
  }

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
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (refMenu !== null) { setRefMenu(null); return }
          closeKeepingDraft()
        }
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

      {/* 参考托盘（Step 3 转真）：52px 缩略图（位次角标 + 悬停放大镜 + × 移除）
          + 「+ N/上限」添加瓦片 + 三来源菜单。数据契约与 ReferenceSlotEditor 同源
          （换句柄红线 / 断链不静默 / 必填只换不空）。 */}
      <div className="csInputCardRefs">
        <div className="csRefStrip">
          {names.map((name, index) => {
            const thumb = thumbOf(name)
            return (
              <div className="csRefItem" key={`${name}-${index}`} title={name}>
                {thumb === null
                  ? <span className="csRefItemFill csRefItemBroken">参考<br />已断链</span>
                  : <img className="csRefItemFill" src={thumb.url} alt={thumb.label} />}
                <span className="csRefItemIx">参考图 {index + 1}</span>
                <button
                  type="button"
                  className="csRefItemPv"
                  aria-label={`放大预览 ${thumb?.label ?? name}`}
                  disabled={thumb === null || onOpenPreview === undefined}
                  title={thumb?.label ?? '参考已断链'}
                  onClick={() => {
                    const source = summaries.find(summary => summary.name === name)?.node ?? null
                    if (source !== null && source.url !== undefined) onOpenPreview?.(source)
                  }}
                >
                  <span className="csRefItemRing">{ZOOM_ICON}</span>
                </button>
                <button
                  type="button"
                  className="csRefItemRm"
                  aria-label={`移除 参考图 ${index + 1}`}
                  disabled={!canEdit || !canDelete || busy}
                  title={!canDelete ? '必填单槽：不能删成空，只能替换' : '移除这张'}
                  onClick={() => { removeRefAt(index) }}
                >×</button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className={atMax ? 'csRefAdd full' : 'csRefAdd'}
          disabled={!canEdit || busy}
          title={!canEdit
            ? '当前环境不支持解析句柄（只能查看）'
            : atMax ? `已达上限 ${refCap} 张，超出会被拦截` : '添加参考图'}
          onClick={() => { setRefMenu(previous => (previous === null ? 'canvas' : null)) }}
        >
          <span className="csRefAddPlus">+</span>
          <span className="csRefAddCount">{refCount}/{refCap}</span>
        </button>
        {/* 三来源菜单（演示 .ref-menu：向下弹出、168px、尖角朝上）。本地上传置灰
            —— 解析链路只收 lib:/节点句柄，上传→句柄是新链路（偏差登记 §九）。 */}
        {refMenu !== null && (
          <div className="csRefMenuPop">
            {refMenu === 'canvas' || refMenu === 'library' ? (
              <>
                <div className="csRefMenuHead">
                  <span>{refMenu === 'canvas' ? '从画布导入' : '从资产库选择'}</span>
                  <button type="button" className="csInputCardIb" aria-label="返回" onClick={() => { setRefMenu(null) }}>‹</button>
                </div>
                {menuCandidates.length === 0
                  ? <div className="csRefMenuHint">暂无可用图片素材（参考位只收图片；视频/音频参考走生成参数）。</div>
                  : menuCandidates.map(candidate => (
                    <button
                      type="button"
                      className="csRefMenuItem"
                      key={candidate.ref}
                      disabled={busy || atMax}
                      title={atMax ? `已达上限 ${refCap} 张` : candidate.label}
                      onClick={() => { void resolveAndCommit([candidate.ref]) }}
                    >
                      <img className="csRefMenuItemThumb" src={candidate.url} alt="" />
                      <span className="csRefMenuItemLabel">{candidate.label}</span>
                    </button>
                  ))}
              </>
            ) : (
              <>
                <button type="button" className="csRefMenuItem" disabled title="本地上传通道待接线（偏差登记 §九）">本地上传</button>
                <button
                  type="button"
                  className="csRefMenuItem"
                  disabled={!canEdit || busy || (libraryAssets ?? []).length === 0}
                  onClick={() => { setRefMenu('library') }}
                >选择资产</button>
                <button
                  type="button"
                  className="csRefMenuItem"
                  disabled={!canEdit || busy}
                  onClick={() => { setRefMenu('canvas') }}
                >画布导入</button>
                <div className="csRefMenuHint">上限 {refCap} 张，超出会被拦截</div>
              </>
            )}
          </div>
        )}
      </div>
      {busy && <div className="csRefMenuHint">解析句柄…（生成产物需要先换成可用句柄才能作参考）</div>}
      {error !== null && <div className="csRefMenuError">{error}</div>}

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
