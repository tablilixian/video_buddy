import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { libraryMediaUrl } from '../../contracts/asset-library.js'
import type { LibraryAsset } from '../../contracts/asset-library.js'
import type { ResolveRefItem } from '../../contracts/reference.js'
import { deleteEditorDraft, getEditorDraft, hasEditorDraft, setEditorDraft } from '../../editor-drafts.js'
import { isReplayable, promptFieldsOf, promptValueOf, referenceNamesOf, referenceSlotOf, resolveReferenceSummaries, withPromptField, withReferenceNames, type PromptField } from '../../node-params.js'
import { resolutionDisplay } from '../../resolution-display.js'
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
  /** 「发送」的落点 = 既有重试链路（判据唯一走 node-params.isReplayable）；缺省按钮禁用。 */
  onRetry?(id: string): void
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
 * 语义红线（**编辑不触发** / **判据唯一**）原样继承。
 *
 * ## 底栏 chips（Step 4 转真）
 *
 * - **模型**：默认读「自动」（REQ-025/CV-278 自动路由，拍板②）；高级展开手动指定
 *   （自动 / 文字渲染 Qwen / Krea 2，写 `modelOverride` 参数，Host 侧
 *   `routeImageModel` 在纯文生车道消费——图生图/修复车道不受影响）。
 * - **画幅·清晰度**：比例 3 种（拍板⑤）+ 档位 3 档（拍板⑥，展示名走
 *   `resolution-display.ts` 共享映射），写 `aspectRatio` / `resolution` 参数
 *   （`generate.ts` 既有消费点）。
 * - **风格 / 摄像机**：参数挂卡（`stylePrefix` / `cameraPrefix`），生成时前缀注入
 *   提示词（`composeImagePrompt`；后端无 style 参数——0.7.0 对拍，工具 description
 *   明确「风格表达直接写进 prompt」）。风格预设清单为通用 4 项，演示的风格库
 *   （古装/都市/年代分类）是内容资产级功能，待扩充（偏差登记 §九）。
 * - **积分**：纯展示占位（拍板⑦），前端按档位估算并标「预估」，无真实结算。
 * - **发送**：判据唯一走 `isReplayable`，落点 = 既有重试链路（先落字段再重试，
 *   与浮层「保存并重试」同一纪律）；不可重放/生成中一律禁用。
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
 * 置灰（解析链路只收 `lib:`/节点句柄）；档位读数产品化命名（拍板⑥）。
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

/** 底栏弹出层：模型 / 画幅档位 / 风格 / 摄像机（同一时刻只开一个）。 */
type ChipPop = 'model' | 'spec' | 'style' | 'camera' | null

/** 模型「高级」三选（拍板④：后端真实能力名；图生图/修复车道由链路自动决定）。 */
const MODEL_OPTIONS: readonly { value: string; label: string; hint: string }[] = [
  { value: '', label: '自动（推荐）', hint: '按提示词内容现算路由（含可显示文字 → Qwen）' },
  { value: 'textRender', label: '文字渲染 · Qwen', hint: '中文逐字正确（约 20s）' },
  { value: 'krea2', label: 'Krea 2', hint: '纯文生更快' },
]

/** 画幅三选（拍板⑤：后端 enum 只有这三种；清单数据驱动，扩 enum 时加行）。 */
const ASPECT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '16:9', label: '16:9 横幅' },
  { value: '9:16', label: '9:16 竖幅' },
  { value: '1:1', label: '1:1 方幅' },
]

/** 风格预设（前缀注入文本；通用 4 项——演示风格库为内容资产级功能，待扩充）。 */
const STYLE_OPTIONS: readonly { name: string; prefix: string }[] = [
  { name: '无风格', prefix: '' },
  { name: '电影感', prefix: '电影感构图，宽银幕质感' },
  { name: '写实摄影', prefix: '写实摄影风格，自然光影' },
  { name: '动漫插画', prefix: '动漫插画风格，清晰线条' },
]

/** 摄像机四列的可选值（逐字取自演示 HTML）。 */
const CAMERA_BODIES = ['潘那维申 DXL2', 'ARRI Alexa LF'] as const
const CAMERA_LENSES = ['阿莱大师定焦', '阿莱 Signature'] as const
const CAMERA_FOCALS = ['14mm', '24mm', '35mm', '50mm', '85mm', '135mm'] as const
const CAMERA_APERTURES = ['f/1.4', 'f/2', 'f/2.8', 'f/4', 'f/8', 'f/16'] as const
/** 演示默认：潘那维申 DXL2 · 阿莱大师定焦 · 标准 35mm · 中光圈。 */
const CAMERA_DEFAULT = { body: 0, lens: 0, focal: 2, aperture: 3 } as const

/** 积分预估占位表（拍板⑦：无结算后端，数值为前端占位常量，标「预估」）。 */
const CREDIT_ESTIMATE: Readonly<Record<string, number>> = { '480p': 15, '736p': 25, '2k': 40 }

export function NodeInputCard(props: NodeInputCardProps) {
  const { node, view, viewport, bottomInset, allNodes, libraryAssets, onResolveRefs, onOpenPreview, onUpdateNode, onRetry, onClose } = props
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
  /** 把每个字段编辑器里的当前草稿落成字段（「发送」先落字段再重试，C4 同款）。 */
  const commitAll = (): void => {
    for (const field of promptFields) fieldRefs.current.get(field.key)?.commit()
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

  // ---- 底栏 chips（Step 4 转真）：参数全部挂 generationPrompt（同一写回通路）----
  const [openPop, setOpenPop] = useState<ChipPop>(null)
  const togglePop = (pop: Exclude<ChipPop, null>): void => {
    setOpenPop(previous => (previous === pop ? null : pop))
  }
  const modelOverride = promptValueOf(node, 'modelOverride')
  const modelLabel = MODEL_OPTIONS.find(option => option.value === modelOverride)?.label ?? '自动（推荐）'
  const aspectRatio = promptValueOf(node, 'aspectRatio') || '16:9'
  const resolution = promptValueOf(node, 'resolution') || '736p'
  const specLabel = `${aspectRatio} · ${resolutionDisplay(resolution).label}`
  const stylePrefix = promptValueOf(node, 'stylePrefix')
  const styleLabel = STYLE_OPTIONS.find(option => option.prefix === stylePrefix)?.name ?? '风格'
  const cameraPrefix = promptValueOf(node, 'cameraPrefix')
  const cameraOn = cameraPrefix.trim() !== ''
  // 摄像机面板的本地游标：从已保存前缀反解（值里没有「·」，按 ' · ' 拆安全）。
  const cameraParts = cameraPrefix.split(' · ')
  const cameraCursor = {
    body: Math.max(0, CAMERA_BODIES.indexOf(cameraParts[0] as typeof CAMERA_BODIES[number])),
    lens: Math.max(0, CAMERA_LENSES.indexOf(cameraParts[1] as typeof CAMERA_LENSES[number])),
    focal: Math.max(0, CAMERA_FOCALS.indexOf(cameraParts[2] as typeof CAMERA_FOCALS[number])),
    aperture: Math.max(0, CAMERA_APERTURES.indexOf(cameraParts[3] as typeof CAMERA_APERTURES[number])),
  }
  const [camera, setCamera] = useState(cameraCursor)
  const cameraText = `${CAMERA_BODIES[camera.body]} · ${CAMERA_LENSES[camera.lens]} · ${CAMERA_FOCALS[camera.focal]} · ${CAMERA_APERTURES[camera.aperture]}`
  /** 面板内步进/重置即写回（开着总开关才有值；关闭 = 清参数）。 */
  const applyCamera = (next: typeof camera, on: boolean): void => {
    setCamera(next)
    commitPrompt('cameraPrefix', on
      ? `${CAMERA_BODIES[next.body]} · ${CAMERA_LENSES[next.lens]} · ${CAMERA_FOCALS[next.focal]} · ${CAMERA_APERTURES[next.aperture]}`
      : '')
  }
  const credits = CREDIT_ESTIMATE[resolution] ?? CREDIT_ESTIMATE['736p'] ?? 25

  // ---- 发送：判据唯一走 isReplayable（红线②）；先落字段再重试（C4 同款）----
  const canSend = onRetry !== undefined && node.isLoading !== true && isReplayable(node)
  const send = (): void => {
    if (!canSend) return
    commitAll()
    onRetry?.(node.id)
    deleteEditorDraft(node.id)
    onClose()
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
        // 冒不到这里）。弹出层开着时先收弹出层。
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (refMenu !== null) { setRefMenu(null); return }
          if (openPop !== null) { setOpenPop(null); return }
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

      {/* 底栏 chips（Step 4 转真）：模型 / 画幅·清晰度 / 风格 / 摄像机 + 积分 + 发送。
          参数全部挂 generationPrompt（withPromptField 同一写回通路）。 */}
      <div className="csInputCardFoot">
        <div className="csInputCardFootLeft">
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'model' ? 'csInputPill csInputPillOn' : 'csInputPill'}
              title="生图模型：默认自动路由（拍板②），高级展开可手动指定（仅纯文生车道生效）"
              onClick={() => { togglePop('model') }}
            >
              {modelLabel} <span className="csInputPillCaret">▾</span>
            </button>
            {openPop === 'model' && (
              <span className="csChipPop">
                {MODEL_OPTIONS.map(option => (
                  <button
                    type="button"
                    className={modelOverride === option.value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                    key={option.value || 'auto'}
                    onClick={() => { commitPrompt('modelOverride', option.value); setOpenPop(null) }}
                  >
                    <span className="csChipMenuItemLabel">{option.label}</span>
                    <span className="csChipMenuItemHint">{option.hint}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'spec' ? 'csInputPill csInputPillOn' : 'csInputPill'}
              title="画幅与清晰度：比例 3 种（拍板⑤）；档位展示名产品化（拍板⑥），内部键 480p/736p/2k"
              onClick={() => { togglePop('spec') }}
            >
              {specLabel} <span className="csInputPillCaret">▾</span>
            </button>
            {openPop === 'spec' && (
              <span className="csChipPop">
                <span className="csChipPopSection">画幅</span>
                {ASPECT_OPTIONS.map(option => (
                  <button
                    type="button"
                    className={aspectRatio === option.value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                    key={option.value}
                    onClick={() => { commitPrompt('aspectRatio', option.value) }}
                  >
                    <span className="csChipMenuItemLabel">{option.label}</span>
                  </button>
                ))}
                <span className="csChipPopSection">清晰度</span>
                {[...['480p', '736p', '2k']].map(value => {
                  const display = resolutionDisplay(value)
                  return (
                    <button
                      type="button"
                      className={resolution === value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                      key={value}
                      onClick={() => { commitPrompt('resolution', value) }}
                    >
                      <span className="csChipMenuItemLabel">{display.label}</span>
                      <span className="csChipMenuItemHint">{display.meta}</span>
                    </button>
                  )
                })}
              </span>
            )}
          </span>
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'style' ? 'csInputPill csInputPillOn' : 'csInputPill'}
              title="风格：前缀注入提示词（不计费，与摄像机可叠加）；预设清单待扩充（偏差登记 §九）"
              onClick={() => { togglePop('style') }}
            >
              {styleLabel} <span className="csInputPillCaret">▾</span>
            </button>
            {openPop === 'style' && (
              <span className="csChipPop">
                {STYLE_OPTIONS.map(option => (
                  <button
                    type="button"
                    className={stylePrefix === option.prefix ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                    key={option.name}
                    onClick={() => { commitPrompt('stylePrefix', option.prefix); setOpenPop(null) }}
                  >
                    <span className="csChipMenuItemLabel">{option.name}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'camera' ? 'csInputPill csInputPillOn' : cameraOn ? 'csInputPill csInputPillAccent' : 'csInputPill'}
              title="摄像机：参数作前缀注入提示词，与风格叠加、不计费"
              onClick={() => { togglePop('camera') }}
            >
              摄像机{cameraOn ? ' · 开' : ''}
            </button>
            {openPop === 'camera' && (
              <span className="csChipPop csChipPopCamera">
                <span className="csChipPopSection">摄像机制</span>
                <span className="csChipPopSub">参数已作为标记挂在输入框，与预设风格叠加生效</span>
                <span className="csCameraCols">
                  {([
                    ['相机', CAMERA_BODIES, camera.body, 'body'],
                    ['镜头', CAMERA_LENSES, camera.lens, 'lens'],
                    ['焦距', CAMERA_FOCALS, camera.focal, 'focal'],
                    ['光圈', CAMERA_APERTURES, camera.aperture, 'aperture'],
                  ] as const).map(([label, values, index, key]) => (
                    <span className="csCameraCol" key={key}>
                      <span className="csCameraColLabel">{label}</span>
                      <button
                        type="button"
                        className="csCameraStep"
                        aria-label={`上一个${label}`}
                        onClick={() => { applyCamera({ ...camera, [key]: (index - 1 + values.length) % values.length }, cameraOn) }}
                      >ˆ</button>
                      <span className="csCameraValue">{values[index]}</span>
                      <button
                        type="button"
                        className="csCameraStep"
                        aria-label={`下一个${label}`}
                        onClick={() => { applyCamera({ ...camera, [key]: (index + 1) % values.length }, cameraOn) }}
                      >ˇ</button>
                    </span>
                  ))}
                </span>
                <span className="csCameraConfig">
                  <span className="csCameraConfigLabel">当前配置</span>
                  <span className="csCameraConfigValue">{cameraText}</span>
                </span>
                <span className="csCameraFoot">
                  <button
                    type="button"
                    className="csInputPill csInputPillIconWide"
                    title="恢复演示默认（潘那维申 DXL2 · 阿莱大师定焦 · 35mm · f/4）"
                    onClick={() => { applyCamera({ ...CAMERA_DEFAULT }, cameraOn) }}
                  >↺ 重置参数</button>
                  <button
                    type="button"
                    className={cameraOn ? 'csCameraToggle csCameraToggleOn' : 'csCameraToggle'}
                    role="switch"
                    aria-checked={cameraOn}
                    aria-label={cameraOn ? '关闭摄像机参数' : '启用摄像机参数'}
                    onClick={() => { applyCamera(camera, !cameraOn) }}
                  ><span className="csCameraToggleKnob" /></button>
                </span>
              </span>
            )}
          </span>
        </div>
        <div className="csInputCardFootRight">
          <span className="csInputPill csInputPillIcon" title="提示词增强：功能挂 REQ-003 Step 4 拍板，当前置灰（偏差登记 §九）">✦</span>
          <span className="csInputPill csInputCredits" title="积分：纯展示占位（拍板⑦），按档位前端估算，无真实结算">
            ✦ <span className="csInputCreditsNum">{credits}</span> · 预估
          </span>
          <button
            type="button"
            className="csInputSend"
            disabled={!canSend}
            title={!canSend
              ? onRetry === undefined
                ? '当前环境不支持重试链路'
                : node.isLoading === true ? '生成中…' : '该节点不可重放（缺参数或工具不支持）'
              : '发送：先落字段再走生成链路（判据唯一 isReplayable）'}
            aria-label="发送"
            onClick={send}
          >↑</button>
        </div>
      </div>
    </div>
  )
}
