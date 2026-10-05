import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioProjectListInjected } from './contracts.js'
// CV-196：只借类型（`import type`）—— host-config 是 Host 侧模块，其值（schemastery /
// dsh-settings）不进客户端 bundle，这条界线与 SettingsModal 的用法一致。
import type { CanvasStudioConfig } from '../host-config.js'
import { BRIEF_NODE_TOOL, nodesOf, selectedNodeOf, viewOf, newNodeId, activeSkillsOf, hasConversationOf } from './project-store.js'
import { ProjectList } from './ProjectList.js'
import { RailStrip } from './RailStrip.js'
import { ChatStrip } from './ChatStrip.js'
import { SettingsModal } from './SettingsModal.js'
import { FirstRunSettings, isCanvasStudioOnboarded } from './FirstRunSettings.js'
import { ModeSwitch } from './ModeSwitch.js'
import { ConfirmDialog } from './ConfirmDialog.js'
// 2026-08-31：画布顶部工具栏按组做入口可见性控制（功能全部保留）——哪些组显示由
// CanvasToolbar 内部的 TOOLBAR_VISIBILITY 常量决定，见 canvas/CanvasToolbar.tsx。
import { CanvasToolbar } from './canvas/CanvasToolbar.js'
import { CanvasSurface, type CanvasSurfaceHandle } from './canvas/CanvasSurface.js'
import { clearEditorDrafts } from '../editor-drafts.js'
import { CanvasTimeline } from './canvas/CanvasTimeline.js'
import { LayerPanel } from './canvas/LayerPanel.js'
import { HistoryDrawer } from './canvas/HistoryDrawer.js'
import { NodeDetailDrawer } from './canvas/NodeDetailDrawer.js'
import { VideoPlayerModal } from './canvas/VideoPlayerModal.js'
import { AudioPlayerModal } from './canvas/AudioPlayerModal.js'
import { ImagePreviewModal } from './canvas/ImagePreviewModal.js'
import { CanvasContextMenu } from './canvas/CanvasContextMenu.js'
import { CanvasBlankMenu, CanvasEdgeCreateMenu } from './canvas/CanvasBlankMenu.js'
import { ReferenceTray } from './canvas/ReferenceTray.js'
import { uploadStudioMedia, uploadStudioVideo, splitStudioVideo, composeStudioVideo, resolveStudioRefs } from './api.js'
import { classifyFile, MEDIA_KIND_LABEL, type MediaKind } from '../media-extension.js'
import type { StudioCanvasNode, StudioCanvasView } from '../contracts/canvas.js'
// CV-220：生成队列投影 → 遮罩文案（与 Host 侧同一份纯函数）。
import { generationQueueNote } from '../queue-view.js'
import { AUDIO_COMPOSITION_LABELS } from '../contracts/canvas.js'
import { deriveTimelineOrder, isAuxiliaryNode, type FitResult } from '../canvas-view.js'
import { deriveWorkflowStage, WORKFLOW_STAGE_LABELS } from '../workflow-stage.js'
import { resolveComposeSelection, composedSourceIds } from '../compose-selection.js'
import { assetDownloadName, canDownloadNode, shouldKeepMenuOpen, isGenerationEdge } from '../canvas-actions.js'
import { screenToWorld } from './canvas/canvas-math.js'
import { errorToastText } from './error-toast.js'
// CV-234：错误可见性开关（设置页「诊断」）→ 本进程内的模块级标志。
// `error-system.ts` 是 Host / Client 两侧共用的模块，客户端这份实例只由下面那条
// effect 同步；判定侧（asset-capture 的 D2 红标 / 本文件 D4 toast / client/index 的
// routeError）读的都是同一个标志。
import { setErrorVisibility } from '../error-system.js'
// CV-198：剪贴板链路。判定/文案在 src 根（可单测），浏览器环境在 client 侧唯一实现。
import { clipboardResultMessage, copyNodeToClipboard, copyTextToClipboard } from '../clipboard-copy.js'
import { clipboardEnv } from './canvas/clipboard-env.js'
import { toggleRetire, isShotClip } from '../shot-versions.js'
import { frameSizeOf, mediaBoxOf } from '../canvas-aspect.js'
import { formatRefToken, uniqueTitle } from '../reference-token.js'
import { buildAssetHandles, buildLibraryAssetHandles } from '../reference-handle.js'
import { AssetChipPreview } from './AssetChipPreview.js'
import { BRAND } from '../brand-copy.js'
import { LogoMark } from './brand/LogoMark.js'
import { LobbyHero } from './LobbyHero.js'
// CV-261：首页暂存条目的登记（分类 + 四类限额把关 + File 句柄表，见该文件头）。
import { stashLobbyFiles } from './lobby-stash.js'
import { SlateBar } from './SlateBar.js'
import { SkillCarousel } from './SkillCarousel.js'
import { SkillMarket } from './SkillMarket.js'
import { AssetLibraryPage, LibImportDialog } from './AssetLibrary.js'
import { ActiveSkillChips } from './ActiveSkillChips.js'
import { UserCard } from './UserCard.js'
import { CanvasEmptyHint } from './brand/States.js'
// CV-065：技能广场元数据（featured / 分类 / 图标 / 色相）。放 src/ 根目录是
// 为了单测能直连编译产物（Host tsconfig 排除 src/client/**）。
import { recommendedSkills, VISIBLE_CATALOG } from '../skill-catalog.js'
import type { SkillCatalogEntry } from '../skill-catalog.js'
import { formatSkillToken } from '../skill-chip.js'
// DD-10：首屏「开拍前条」的模型 —— 与输入区读数带同一个判定入口（零新判定）。
import { deriveProjectContextView } from '../project-context.js'
// 2026-08-31：画布顶部工具栏入口暂隐藏（CanvasToolbar 组件保留，恢复时
// 在下方 JSX 注释块处取消注释）。功能（撤销/重做/添加节点/上传/自动布局/
// 缩放/图层面板/小地图等）经节点右键菜单、快捷键、未来入口触发。
// 见 canvas-studio/docs/canvas-studio-handoff.md §10 ⑪。

// Zoom step for the toolbar +/− buttons (matches the surface wheel step).
const ZOOM_STEP = 1.2

/**
 * DD-08 / R8：左栏收起态的持久化 key。
 *
 * 存 localStorage 而不是写进项目记录 / 宿主设置：这是**设备级布局偏好**
 * （「这台机器上我习惯把左栏收起来」与具体项目无关），写进 registry 会污染项目
 * 契约（每个项目多一个与项目无关的字段），宿主设置里也没有「插件布局」的位置。
 * 与 CV-091 的分组折叠记忆同一手法。
 */
const RAIL_COLLAPSE_KEY = 'canvas-studio.rail-collapsed'

/* DD-09 / b：右栏（对话区）收起态。与左栏同款**设备级布局偏好** —— 收起右栏是
   为了把宽度让给画布，与具体项目无关，写进 registry 会污染项目契约（同 R8 的理由）。 */
const CHAT_COLLAPSE_KEY = 'canvas-studio.chat-collapsed'

/* 节点详情抽屉的高度。同为**设备级布局偏好** —— 「我习惯留多高的编辑区」与具体
   项目无关（同左右栏收起的理由）。默认 320px：够放下提示词的三行正文与左栏身份，
   同时给画布留足参照；抽屉自己会按容器高度夹取，不依赖这个数是窗口的多少比例。 */
const DETAIL_HEIGHT_KEY = 'canvas-studio.detail-height'
const DETAIL_HEIGHT_DEFAULT = 320

/** 读取抽屉高度。读不到 / 不是正数一律回默认 —— 兜底方向必须是「画布还在」。 */
function loadDetailHeight(): number {
  try {
    const raw = localStorage.getItem(DETAIL_HEIGHT_KEY)
    if (raw === null) return DETAIL_HEIGHT_DEFAULT
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : DETAIL_HEIGHT_DEFAULT
  } catch {
    return DETAIL_HEIGHT_DEFAULT
  }
}

/**
 * 读取收起态。读取失败 / 缺失一律按**展开**处理 —— 兜底方向必须是「内容看得见」：
 * 一个读不出来的布局偏好把整栏藏起来，是最坏的方向。
 */
function loadCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
/** Debounce for viewport saves (pan/zoom fire per frame; disk saves must not). */
const VIEW_SAVE_DEBOUNCE_MS = 400

/**
 * 放手跑模式（`workflow.mode === 'auto'`）下，新节点落地后**自动整理布局**的防抖窗口。
 *
 * 为什么必须防抖：一次生成常常**连出多个节点**（抽帧 8 张 + 1 张便签、一个托盘 + 8 个
 * 成员、落卡一批），每个都触发一次整理 = 画布持续抖动；而且整理会移动**所有**节点，
 * 中间态被看到就是一片乱跳。
 *
 * 尾触发（每次新到达重排计时）+ **最长等待兜底**：若节点持续陆续到达（长批量），
 * 尾触发会把整理一直往后推、画布中途始终是乱的 —— `MAX_WAIT` 保证最多 3s 必整理一次。
 */
const AUTO_ARRANGE_DEBOUNCE_MS = 600
const AUTO_ARRANGE_MAX_WAIT_MS = 3000
/** CV-015：toast 自动消失时长（错误比普通提示停留更久）。 */
const TOAST_MS = { info: 3500, success: 3500, error: 6000 } as const

/**
 * C5：场记板图标（设计稿 .clapIcon）—— 审批条的打板动作载体。
 * 条挂载时 CSS 播一记 csDevelopClapHit 合板（见 styles.ts）。React 元素不可变，
 * 三处审批条复用同一个元素是安全的（同一时刻只会渲染一条审批条）。
 */
const clapIcon = (
  <span className="csWorkflowClap" aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
      {/* 机体 + 张开的上颚（上颚常开 -12°，合板动画从 -13° 弹回，像真的拍了一下） */}
      <rect x="3" y="15" width="26" height="13" rx="3" fill="currentColor" opacity="0.92" />
      <rect x="3" y="6" width="26" height="7" rx="2" fill="currentColor" transform="rotate(-12 16 9)" />
    </svg>
  </span>
)

/**
 * C1 / DD-05：六段制作轨道（剧本 → 分镜 → 定妆 → 关键帧 → 镜头 → 成片）。
 *
 * 判定已**收口到纯函数** `src/workflow-stage.ts` 的 `deriveWorkflowStage` ——
 * 本文件不得自己遍历 nodes 推阶段。同一规则只准一份实现（CV-160 的教训：
 * 三处内联、漏一条就出错），且那条规则需要单测固化（tests/workflow-stage.test.mjs）。
 *
 * 六段中有三段（定妆 / 镜头 / 成片）在 `workflow.state` 里没有独立取值，靠
 * 「state 地板 + 画布产物证据，取较大值」派生 —— 理由见该模块头部注释。
 */

/** CV-015：非阻塞提示条目。 */
interface ToastItem {
  id: number
  kind: keyof typeof TOAST_MS
  text: string
}

/**
 * 上传回执卡的本地条目 id（**不是节点 id** —— 落卡之前还没有节点）。
 * 三类上传（video/audio/text）共用这一份实现，避免各拼各的（同 handleDroppedFiles）。
 */
const newUploadId = (): string =>
  `upload-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`

/** Studio root frame props: the standard root shares plus the studio inject face. */
export type StudioFrameProps = PropsRuntime<'root'>
  & PropsRenderSlots<'conversation' | 'shell.overlay'>
  & InjectFace<StudioProjectListInjected>

/**
 * Three-region studio frame: project list + layer list on the left, the canvas
 * surface (toolbar on top, review timeline at the bottom) in the center, and
 * the official conversation seat on the right. The sidebar and details seats
 * stay declared (upstream registrants keep their paths) but are not rendered.
 * A single selected node opens the detail panel; a context menu offers node
 * ordering / lock / generation actions. The canvas shows every captured node
 * of the selected project (image/video/sticky/text/prompt/group) with
 * bloodline edges; the timeline lets the user review and jump to any node.
 */
export function StudioFrame(props: StudioFrameProps) {
  const {
    renderSlot, useStudio, refreshProjects, openProject, deleteProject, persistCanvas,
    retryNode, cancelCurrentTurn, approveStoryboard, rejectStoryboard, confirmKeyframes, rejectKeyframes, approveScreenplay, rejectScreenplay, setWorkflowMode,
    activateSkill, deactivateSkill, actions, runEffectTests,
    createGroup, renameGroup, deleteGroup, moveProjectToGroup,
    settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme, insertAssetChip, insertSkillChip,
    refreshLibrary, createLibraryAsset, updateLibraryAsset, deleteLibraryAsset, uploadLibraryMedia, insertLibChip,
    // REQ-005 / CV-256：回首页（创意提交改走宿主发送拦截，v1.3 变体 A）。
    goHome,
  } = props
  const projects = useStudio(store => store.projects)
  // CV-091：用户自定义分组（左侧栏可折叠分组数据源）。
  const groups = useStudio(store => store.groups)
  const selectedProjectId = useStudio(store => store.selectedProjectId)
  const selectedNodeId = useStudio(store => store.selectedNodeId)
  const selectedNodeIds = useStudio(store => store.selectedNodeIds)
  const nodes = useStudio(store => nodesOf(store, store.selectedProjectId))
  const [hideRetired, setHideRetired] = useState(false)
  // D-1：辅助卡（末帧等）画布默认收起，工具栏开关恢复 —— 判读走共享谓词
  // isAuxiliaryNode（toolName 兜底，老项目的末帧卡同样收起）。参考托盘 /
  // 图层面板 / list_references 不经此过滤：@ref 引用与节点级重试不受影响。
  const [showAuxiliary, setShowAuxiliary] = useState(false)
  // CV-246：生成历史抽屉显隐（临时浮层，不进 view 持久化——每次打开默认关）。
  const [historyOpen, setHistoryOpen] = useState(false)
  // REQ-001：资产库全屏页显隐（打开时拉最新清单；lobby / work 共用同一 overlay）。
  const [libOpen, setLibOpen] = useState(false)
  // REQ-001 F1：画布节点「加入资产库」的入库对话框目标节点 id（null = 关）。
  const [libImportNodeId, setLibImportNodeId] = useState<string | null>(null)
  const visibleNodes = useMemo(
    () => nodes.filter(node => {
      // D-1：辅助卡默认收起（开关恢复）。
      if (isAuxiliaryNode(node) && !showAuxiliary) return false
      // CV-244：废弃素材隐藏开关（灰显语义见 retired 字段注释）。
      if (hideRetired && (node.retired === true || node.supersededBy !== undefined)) return false
      return true
    }),
    [nodes, hideRetired, showAuxiliary])
  // CR-041：nodes 的稳定镜像 ref——onMediaNatural 等回调经 ref 读最新节点，
  // 不因 nodes 变化重建闭包（配合 CanvasNode memo）。
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  // 参考托盘数据源：所有标记为参考图的图片节点（CR-041：useMemo 缓存派生）。
  const referenceNodes = useMemo(
    () => nodes.filter(node => node.isReference === true && node.kind === 'image'),
    [nodes],
  )
  // CV-114：可引用素材的短句柄表（img-01 / vid-01）——chip 文案、@ 候选、
  // hover 缩略图三处共用同一份派生结果。REQ-001 起并入库条目（nodeId=`lib:<id>`）：
  // hover 浮层对 `@ref[lib:…]` chip 的反查零改动即可命中（同一字段同一张表）。
  const libraryAssets = useStudio(store => store.libraryAssets)
  const assetHandles = useMemo(
    () => [...buildAssetHandles(nodes), ...buildLibraryAssetHandles(libraryAssets)],
    [nodes, libraryAssets])
  const assetHandlesRef = useRef(assetHandles)
  assetHandlesRef.current = assetHandles
  // hover 卡片点击：复用已有的大图 / 播放器浮层（不新造播放器）。
  const handleOpenAsset = useCallback((nodeId: string): void => {
    // REQ-001：库媒体不在画布节点里 —— 用浏览器原生查看器开新标签（点击事件内
    // 用户手势仍在，不被弹窗拦截），而不是走进下面的节点查找后静默无反应。
    if (nodeId.startsWith('lib:')) {
      const handle = assetHandlesRef.current.find(entry => entry.nodeId === nodeId)
      if (handle !== undefined && handle.url !== null) window.open(handle.url, '_blank', 'noopener')
      return
    }
    const node = nodesRef.current.find(entry => entry.id === nodeId)
    if (node === undefined) return
    // CV-130：音频也走播放浮层（hover 卡片点击 → 播放器窗口，而不是图片预览）。
    if (node.kind === 'video' || node.kind === 'audio') setPlaybackNodeId(node.id)
    else setPreviewNodeId(node.id)
  }, [])
  const selectedNode = useStudio(store => selectedNodeOf(store))
  const phase = useStudio(store => store.phase)
  const error = useStudio(store => store.error)
  const errorCode = useStudio(store => store.errorCode)
  const creating = useStudio(store => store.creating)
  const historyIndex = useStudio(store => store.historyIndex)
  const historyLength = useStudio(store => store.history.length)
  const viewEntry = useStudio(store => viewOf(store, store.selectedProjectId))
  const view = viewEntry.view
  // P7：当前项目的工作流（模式 + 审批门禁状态），驱动工作流条与审批按钮。
  const workflow = useStudio(store => store.selectedProjectId === null ? undefined : store.workflows[store.selectedProjectId])
  // C1：六段轨道 = 派生一次，供轨道渲染与「点某段聚焦其产物」共用同一份结果
  // （分两次算会有一个极窄的窗口让两者不一致 —— 即「按钮说可点、点了没选中」）。
  const workflowStages = useMemo(
    () => deriveWorkflowStage(workflow?.state, nodes),
    [workflow?.state, nodes],
  )
  // CV-066：当前项目已装载的 skill（work 态顶部 chip 数据源）。
  const activeSkills = useStudio(store => activeSkillsOf(store, store.selectedProjectId))
  // CV-064 二期：当前项目是否已有对话（会话 blank 翻转自动更新 → 发首条消息
  // 即切 work，无需等 agent 响应）。
  const hasConversation = useStudio(store => hasConversationOf(store, store.selectedProjectId))
  // DD-10：首屏（lobby-pending）中栏「开拍前条」的模型。三个 selector 都只取 store
  // 里**已有的引用**（projects 命中项 / workflow 对象 / nodes 数组本身），不在
  // selector 里现造对象 —— 现造对象等于常驻重渲染（与 ProjectContextBar 同款，
  // 它也读同样三个）。判定全部在 project-context.ts（纯函数，单测直连）。
  const slateProject = useStudio(store => (store.selectedProjectId === null
    ? undefined
    : store.projects.find(candidate => candidate.id === store.selectedProjectId)))
  const slateView = deriveProjectContextView(slateProject, workflow, nodes)
  // 一键效果测试：编排进度（ProjectList 展示）。
  const effectTest = useStudio(store => store.effectTest)
  // CV-220：生成队列全景。store 里存的是**投影**（{ active, waiting } | null），
  // 只在真有等待时非 null；文案由 queue-view.ts 单点生成（本文件不做判定）。
  const generationQueue = useStudio(store => store.generationQueue)
  const queueNote = generationQueueNote(generationQueue)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  // CV-030：详情面板记录目标节点 id（而非布尔开关）——否则打开后单击任何
  // 其它节点，面板会直接切到新选中节点（单击即开详情，与双击语义冲突）。
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null)
  // CV-272：就地提示词浮层的受控 id —— 右键「修改提示词」与工具条「改提示词」
  // 打开**同一个**画布浮层（此前右键开详情抽屉，两个入口各开各的面板）。
  const [promptEditNodeId, setPromptEditNodeId] = useState<string | null>(null)
  // CV-044：视频固定尺寸播放浮层（双击视频节点打开）。
  const [playbackNodeId, setPlaybackNodeId] = useState<string | null>(null)
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null)
  // 设置弹窗开合状态：主页画布上的「设置」按钮 → 弹出设置界面。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 首启设置页：localStorage 未置 onboarded 时首次进入挂载；做出选择后置 flag 收尾。
  const [showFirstRun, setShowFirstRun] = useState<boolean>(() => !isCanvasStudioOnboarded())
  // REQ-005 / CV-256：首页创作台预选的分组 —— v1.3 变体 A 下规格行**没有分组**
  //（§3.4 拍板：默认未分组，事后左栏拖拽调组），该 state 随 LobbyComposer 退役；
  // 左栏入口的 goHome() 保留（回首页仍是唯一新建入口）。
  // CV-196：切到放手跑的二次确认闸（true = 弹窗已挂起，等用户点确认）。
  // 只挡 confirm → auto 这一个方向：切回逐步确认是**无损**的（只是恢复提问），
  // 再拦一道等于把「跑歪了想刹车」也变成两步。
  const [pendingAutoMode, setPendingAutoMode] = useState(false)
  const surfaceRef = useRef<CanvasSurfaceHandle>(null)
  const [menu, setMenu] = useState<{ node: StudioCanvasNode; x: number; y: number } | null>(null)
  // CV-037：菜单根元素引用 —— 用于区分「按在菜单内 / 菜单外」（见下）。
  const menuRef = useRef<HTMLDivElement>(null)
  // CV-016：右键空白处菜单（在此新建 / 粘贴 / 适配视野），关闭语义与节点菜单一致。
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  const blankMenuRef = useRef<HTMLDivElement>(null)
  // R-P0-12：拖线落空 → 「新建节点并连线」菜单。
  const [edgeCreateMenu, setEdgeCreateMenu] = useState<{ x: number; y: number; worldX: number; worldY: number; sourceId: string } | null>(null)
  const edgeCreateMenuRef = useRef<HTMLDivElement>(null)
  // CV-015：非阻塞 toast（替代 window.alert —— 原生弹窗阻塞渲染且打断拖拽流程）。
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastSeq = useRef(0)
  const viewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fitPendingRef = useRef(false)
  const fittedProjectRef = useRef<string | null>(null)
  // CV-185：适配被可读下限挡住时的提示 —— 同一个签名（项目 + 比例）只报一次，
  // 免得用户连点几次「适配视野」被同一条提示刷屏。
  const fitHintRef = useRef('')
  // CV-185：打开项目时的自动适配不打扰用户（那条提示只给「用户主动适配」）。
  const suppressFitHintRef = useRef(false)
  // 整理布局后等新坐标渲染完成再适配视野（imperative fit 读的是渲染后的节点表）。
  const [fitRequestedAt, setFitRequestedAt] = useState(0)
  // P9.3：成片合成进行中标记（禁用按钮 + 文案「合成中…」）。
  const [composeBusy, setComposeBusy] = useState(false)
  // R1（G1）：驳回分镜时附带的不满意意见（可选）——随驳回消息定向转述给 agent。
  const [rejectFeedback, setRejectFeedback] = useState('')
  // CV-065：全屏技能广场开合（lobby 横滚「浏览全部」/ work 态工具栏「技能」进入）。
  const [skillMarketOpen, setSkillMarketOpen] = useState(false)
  // DD-08 / R8：左栏收起态（56px 缩略条 ↔ 200~280px 完整列表），localStorage 持久化。
  const [railCollapsed, setRailCollapsed] = useState(() => loadCollapsed(RAIL_COLLAPSE_KEY))
  // DD-09 / b：右栏收起态（56px 缩略条 ↔ 320~480px 对话区），同样持久化。
  const [chatCollapsed, setChatCollapsed] = useState(() => loadCollapsed(CHAT_COLLAPSE_KEY))
  const setRailCollapsedPersisted = useCallback((collapsed: boolean): void => {
    setRailCollapsed(collapsed)
    try { localStorage.setItem(RAIL_COLLAPSE_KEY, collapsed ? '1' : '0') } catch { /* 忽略写入失败 */ }
  }, [])
  const setChatCollapsedPersisted = useCallback((collapsed: boolean): void => {
    setChatCollapsed(collapsed)
    try { localStorage.setItem(CHAT_COLLAPSE_KEY, collapsed ? '1' : '0') } catch { /* 忽略写入失败 */ }
  }, [])
  // 节点详情抽屉高度（拖上缘调整，设备级记忆）。
  const [detailHeight, setDetailHeight] = useState(loadDetailHeight)
  const setDetailHeightPersisted = useCallback((height: number): void => {
    setDetailHeight(height)
    try { localStorage.setItem(DETAIL_HEIGHT_KEY, String(Math.round(height))) } catch { /* 忽略写入失败 */ }
  }, [])
  /**
   * 详情抽屉是否打开：**跟着选中走**（点空白清选、切到别的节点即关），但打开动作
   * 只来自两条显式入口 —— 节点双击 / 右键「查看详情」。右键「修改提示词」自
   * CV-272 起改开画布就地浮层（与工具条「改提示词」同一面板），不再开抽屉。
   * 抽屉的渲染与工具条的避让高度共用这一个判据，两边不会各说各话。
   */
  const detailOpen = selectedNode !== null && selectedNode.id === detailNodeId

  // REQ-003 F5：就地编辑草稿是内存表，不跨项目存活 —— 切换项目（含回首页）整体清空。
  useEffect(() => { clearEditorDrafts() }, [selectedProjectId])

  // 首次挂载即拉取项目列表，无需手动点「刷新」。
  useEffect(() => { void refreshProjects() }, [refreshProjects])
  // CV-234：错误可见性（设置页「诊断」）→ 本进程的模块级标志。
  // 必须在根组件同步，而不是只靠设置弹窗内的 onChange：那个只在弹窗打开时活着，
  // 重启后标志会退回默认值 ⇒ 出现「开关是开的、行为还是默认的」这种最难查的偏差。
  useEffect(() => {
    const scope = settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' })
    const sync = (): void => {
      setErrorVisibility(scope.getSnapshot().value?.errorVisibility === 'all' ? 'all' : 'audience')
    }
    sync()
    return scope.subscribe(sync)
  }, [settingsScope])
  // 视口/面板变化 → store 已即时更新；磁盘持久化防抖合并（拖拽平移每帧触发）。
  useEffect(() => () => {
    if (viewSaveTimer.current !== null) clearTimeout(viewSaveTimer.current)
  }, [])
  // 右键菜单：按在菜单外则关闭；按在菜单内放行（CV-037）。
  //
  // 原先「任意 mousedown 即关闭」会让菜单在 mousedown 阶段被卸载，而菜单项
  // 只绑 onClick —— mouseup 时按钮已不在 DOM，click 永不触发，14 个菜单项
  // 全部失效。现在命中菜单内部时保持挂载，由菜单项自身的 onClick 负责
  // 「先关闭再执行」。Escape 关闭为菜单的标准可用性补上。
  //
  // CV-167：监听 pointerdown 而不是 mousedown —— 画布表面在空白 pointerdown
  // 上 preventDefault（平移手势），按 Pointer Events 规范会抑制兼容性
  // mousedown，挂 mousedown 的关闭监听永远等不到事件，菜单点空白关不掉。
  // pointerdown 是主事件不受影响；菜单项的 onClick（click 不被抑制）照常。
  useEffect(() => {
    if (menu === null) return
    const close = (): void => { setMenu(null) }
    const onPointerDown = (event: PointerEvent): void => {
      if (shouldKeepMenuOpen(event.target, menuRef.current)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  // CV-016：空白处菜单的关闭语义与节点菜单完全一致（pointerdown 命中内部放行 + Escape）。
  useEffect(() => {
    if (blankMenu === null) return
    const close = (): void => { setBlankMenu(null) }
    const onPointerDown = (event: PointerEvent): void => {
      if (shouldKeepMenuOpen(event.target, blankMenuRef.current)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [blankMenu])

  // R-P0-12：连线建点菜单的关闭语义与空白菜单一致。
  useEffect(() => {
    if (edgeCreateMenu === null) return
    const close = (): void => { setEdgeCreateMenu(null) }
    const onPointerDown = (event: PointerEvent): void => {
      if (shouldKeepMenuOpen(event.target, edgeCreateMenuRef.current)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [edgeCreateMenu])

  const projectId = selectedProjectId

  // CV-015：非阻塞提示 —— 4s（错误 6s）后自动消失；不再用 window.alert（阻塞
  // 渲染进程、打断拖拽/合成流程）。
  const pushToast = (text: string, kind: ToastItem['kind'] = 'info'): void => {
    const id = ++toastSeq.current
    setToasts(prev => [...prev, { id, kind, text }])
    setTimeout(() => {
      setToasts(prev => prev.filter(entry => entry.id !== id))
    }, TOAST_MS[kind])
  }
  /**
   * CV-185：适配视野不再为了「全塞进屏幕」一路缩到看不清 —— 缩到可读下限就停，
   * 此时视野外还有内容。不说一句的话，用户会把「只看到一半」读成「整理布局把
   * 我的节点弄丢了」，所以这里必须出声。
   */
  const handleFitClamped = (result: FitResult): void => {
    if (suppressFitHintRef.current) return
    const signature = `${String(projectId)}:${result.scale.toFixed(3)}`
    if (fitHintRef.current === signature) return
    fitHintRef.current = signature
    pushToast('内容较多，已按可读比例显示，视野外还有节点 —— 滚轮缩小或拖动查看', 'info')
  }
  // 无持久化视图的旧项目：节点首次就绪后自动适配一次视野。
  useEffect(() => {
    if (projectId === null || viewEntry.saved || nodes.length === 0) return
    if (fittedProjectRef.current === projectId) return
    fittedProjectRef.current = projectId
    suppressFitHintRef.current = true
    surfaceRef.current?.fitToContent()
    suppressFitHintRef.current = false
  }, [projectId, viewEntry.saved, nodes])
  // 整理布局后的适配：等 nodes 新坐标渲染进 surface 再执行。
  useEffect(() => {
    if (fitRequestedAt === 0) return
    if (!fitPendingRef.current) return
    fitPendingRef.current = false
    surfaceRef.current?.fitToContent()
  }, [fitRequestedAt, nodes])
  // CV-184：生成产物落在视野外时，把它平移带进来（只平移，不改缩放）。
  // 判据 = 本项目**从未见过**的节点 id。用累计集合而非上一轮快照，是为了让
  // 「撤销删除 / 重做」这类把旧节点搬回来的动作不抢镜头 —— 见过的就不算新。
  // 三条排除：占位节点（本地网格算的，结算后会被真节点替换，跟它跳一次等于白跳）、
  // 创意锚点（每次开项目都可能由 flush 补落，落在原点，不该把视野拉走）、
  // 仍在加载的节点。
  const seenNodeIdsRef = useRef<{ projectId: string | null; ids: Set<string> }>({ projectId: null, ids: new Set() })
  // CR-041：核心处理器稳定化（依赖只含 projectId/actions 等稳定引用），配合
  // CanvasNode/CanvasEdges memo —— 拖拽（仅 store 变化）时这些回调引用不变，
  // 未移动节点不会重渲染。
  const beginEdit = useCallback((): void => {
    if (projectId !== null) actions.pushHistory(projectId)
  }, [projectId, actions])
  const persist = useCallback((): void => {
    if (projectId !== null) void persistCanvas(projectId).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '画布保存失败')
    })
  }, [projectId, actions, persistCanvas])
  const persistAfter = useCallback((mutate: () => void): void => {
    mutate()
    persist()
  }, [persist])

  // —— CV-184 / CV-228：新节点到达的处置（逐个揭示 / 放手跑自动整理）。
  //
  // 判据 = 本项目**从未见过**的节点 id（累计集合，故「撤销删除 / 重做」把旧节点搬回来
  // 不抢镜头）。三条排除：占位节点（本地网格算的，结算后会被真节点替换）、创意锚点
  // （每次开项目都可能由 flush 补落、落在原点）、仍在加载的节点。
  //
  // 两种处置：
  // - **逐步确认模式**：逐个把新节点平移带进视野（只平移、不改缩放）—— 用户在看着画布，
  //   任何自动重排都会打乱他刚摆好的位置，所以这里绝不整理。
  // - **放手跑模式**：防抖后**先整理布局、再揭示**。落点是「排在某来源右缘」的局部规则，
  //   不负责全局整齐；一批产物落完若不整理，画布会摊得到处都是（镜位框随之跨屏）。
  const autoArrangeOnArrival = workflow?.mode === 'auto'
  const autoArrangeTimerRef = useRef<number | null>(null)
  const autoArrangeDeadlineRef = useRef(0)
  const autoArrangeRevealRef = useRef<Set<string>>(new Set())
  const autoArrangeProjectRef = useRef(projectId)
  // 节点镜像直接复用上面 CR-041 那个 `nodesRef`（每渲染赋值、恒指向最新 nodes）。
  // 「上一轮画布已有内容」。切项目时 `seen` 把**当时**的节点记为已见，但那一刻节点可能
  // 还没载入（记的是空集）⇒ 载入完成后的第一批会被当成「新到达」。不排除的话，每次打开
  // 项目都会自动整理一遍，用户手动摆过的位置当场被冲掉。
  const hadCanvasRef = useRef(false)
  useEffect(() => { autoArrangeProjectRef.current = projectId }, [projectId])

  const scheduleAutoArrange = useCallback((ids: readonly string[]): void => {
    for (const id of ids) autoArrangeRevealRef.current.add(id)
    const now = Date.now()
    if (autoArrangeDeadlineRef.current === 0) {
      autoArrangeDeadlineRef.current = now + AUTO_ARRANGE_MAX_WAIT_MS
    }
    if (autoArrangeTimerRef.current !== null) window.clearTimeout(autoArrangeTimerRef.current)
    // 尾触发：每次新到达重排计时，但不超过「本轮首次到达 + MAX_WAIT」。
    const delay = Math.max(0, Math.min(AUTO_ARRANGE_DEBOUNCE_MS, autoArrangeDeadlineRef.current - now))
    autoArrangeTimerRef.current = window.setTimeout(() => {
      autoArrangeTimerRef.current = null
      autoArrangeDeadlineRef.current = 0
      const revealIds = [...autoArrangeRevealRef.current]
      autoArrangeRevealRef.current.clear()
      const activeProjectId = autoArrangeProjectRef.current
      if (activeProjectId === null || revealIds.length === 0) return
      const visible = nodesRef.current
        .filter((node) => node.retired !== true && node.supersededBy === undefined
          // D-1：辅助卡不占整理布局的泳道槽位（默认收起口径一致）。
          && !isAuxiliaryNode(node))
        .map((node) => node.id)
      // ① 整理 —— `recordHistory = false`：系统自动动作**不占撤销栈**，否则用户按
      //    Ctrl+Z 撤销的是「整理」而不是他自己上一个操作。
      //    CV-244：排布只对可见子集计算（隐藏节点不占槽位，BUG-004）。
      persistAfter(() => { actions.autoArrange(activeProjectId, visible, false, { layoutOverVisible: true }) })
      // ② 再揭示 —— 整理改的是 store 坐标，而 `revealNodes` 读的是**已渲染**的位置。
      //    必须等 React 用新坐标提交一帧，否则镜头先跳旧位置、再跳新位置（闪两次）。
      window.requestAnimationFrame(() => { surfaceRef.current?.revealNodes(revealIds) })
    }, delay)
  }, [actions, persistAfter])

  // 切项目时清干净：残留的 timer 会把上一个项目的整理动作打到新项目上。
  useEffect(() => () => {
    if (autoArrangeTimerRef.current !== null) window.clearTimeout(autoArrangeTimerRef.current)
    autoArrangeTimerRef.current = null
    autoArrangeDeadlineRef.current = 0
    autoArrangeRevealRef.current.clear()
    hadCanvasRef.current = false
  }, [projectId])

  useEffect(() => {
    const seen = seenNodeIdsRef.current
    if (seen.projectId !== projectId) {
      seenNodeIdsRef.current = { projectId, ids: new Set(nodes.map(node => node.id)) }
      hadCanvasRef.current = false
      return
    }
    const arrived = nodes.filter(node =>
      !seen.ids.has(node.id)
      && node.isLoading !== true
      && node.toolName !== BRIEF_NODE_TOOL)
    for (const node of nodes) seen.ids.add(node.id)
    const hadCanvas = hadCanvasRef.current
    hadCanvasRef.current = nodes.length > 0
    if (arrived.length === 0) return
    if (autoArrangeOnArrival && hadCanvas) {
      scheduleAutoArrange(arrived.map(node => node.id))
      return
    }
    surfaceRef.current?.revealNodes(arrived.map(node => node.id))
  }, [nodes, projectId, autoArrangeOnArrival, scheduleAutoArrange])
  // CV-029（用户修订）：长边固定 480，短边按真实比例缩放（与生成节点预览
  // 尺寸、媒体加载校正规则统一 —— 统一实现见 src/canvas-aspect.ts 的
  // frameSizeOf（画面 + 镜头条 chrome）与 previewSizeOf（只算画面））。
  // 上传落卡前探测图片真实宽高（解码失败返回 null，回退默认尺寸并由媒体
  // 加载校正兜底），真实分辨率同时入 mediaWidth/mediaHeight（详情面板展示）。
  const probeImageDisplay = async (source: Blob): Promise<{ display: { width: number; height: number }; mediaWidth: number; mediaHeight: number } | null> => {
    try {
      const bitmap = await createImageBitmap(source)
      const result = {
        display: frameSizeOf({ width: bitmap.width, height: bitmap.height }),
        mediaWidth: bitmap.width,
        mediaHeight: bitmap.height,
      }
      bitmap.close()
      return result
    } catch {
      return null
    }
  }
  // P8.1 → CV-241：本地图片上传入口。原始字节走 uploadStudioMedia（octet-stream，
  // Host 只落盘、秒回、不同步 promote）→ 画布新增 import 素材节点；Drama filename
  // 由消费侧惰性兜底补齐（resolveRefFilenames）。
  const handleUploadImage = async (file: File): Promise<void> => {
    if (projectId === null) return
    try {
      const { url } = await uploadStudioMedia(projectId, file)
      const probe = await probeImageDisplay(file)
      // 标题唯一化：剪贴板/同名文件重复上传时追加序号（image 2.png），
      // @ref[token] 按标题解析，重名会让引用歧义（reference-token.ts）。
      const usedTitles = new Set<string>()
      for (const node of nodes) {
        if (node.title !== undefined && node.title !== '') usedTitles.add(node.title)
      }
      persistAfter(() => actions.addImportNode(
        projectId,
        url,
        uniqueTitle(file.name, usedTitles),
        undefined,
        undefined,
        undefined,
        probe === null
          ? undefined
          : { ...probe.display, mediaWidth: probe.mediaWidth, mediaHeight: probe.mediaHeight },
      ))
    } catch (cause) {
      // 上传失败不破坏画布；错误提示由调用方（按钮）展示给用户。
      throw cause instanceof Error ? cause : new Error('图片上传失败')
    }
  }
  /**
   * 2026-09-22 → CV-241：上传本地音频。与图片共用 uploadStudioMedia（只落盘、
   * 不同步 promote），差别只在落卡走 `addAudioNode`（kind: 'audio' —— 音频节点
   * 的框是窄条，与图片框不同）。
   */
  const handleUploadAudio = async (file: File, at?: { x: number; y: number }): Promise<void> => {
    if (projectId === null) return
    // CV-247：上传回执卡（首屏 / 首条消息前画布不渲染 ⇒ 节点落了也看不见）。
    const uploadId = newUploadId()
    actions.beginMediaUpload(projectId, {
      id: uploadId, kind: 'audio', name: file.name, size: file.size, status: 'uploading',
    })
    try {
      const { url } = await uploadStudioMedia(projectId, file)
      const usedTitles = new Set<string>()
      for (const node of nodes) {
        if (node.title !== undefined && node.title !== '') usedTitles.add(node.title)
      }
      persistAfter(() => actions.addAudioNode(
        projectId,
        url,
        uniqueTitle(file.name, usedTitles),
        undefined,
        at,
      ))
      actions.settleMediaUpload(projectId, uploadId, { url })
    } catch (cause) {
      actions.failMediaUpload(projectId, uploadId, cause instanceof Error ? cause.message : String(cause))
      throw cause instanceof Error ? cause : new Error('音频上传失败')
    }
  }
  /**
   * CV-241 D2：上传文字文件 → 素材 chip（kind: 'text'，与图片 import 同级）。
   * 正文截前 4000 字符入 `node.text`（详情/画布可读）；文件本体经 uploadStudioMedia
   * 落盘，url 给只读预览与惰性 promote 兜底。不落对话附件。
   */
  const handleUploadText = async (file: File, at?: { x: number; y: number }): Promise<void> => {
    if (projectId === null) return
    // CV-247：同音频 —— 文字素材的回执此前也只有画布节点（同 BUG-010 病根）。
    const uploadId = newUploadId()
    actions.beginMediaUpload(projectId, {
      id: uploadId, kind: 'text', name: file.name, size: file.size, status: 'uploading',
    })
    try {
      const { url } = await uploadStudioMedia(projectId, file)
      const body = (await file.text()).slice(0, 4000)
      const usedTitles = new Set<string>()
      for (const node of nodes) {
        if (node.title !== undefined && node.title !== '') usedTitles.add(node.title)
      }
      persistAfter(() => actions.addTextAssetNode(
        projectId,
        url,
        body,
        uniqueTitle(file.name, usedTitles),
        at,
      ))
      actions.settleMediaUpload(projectId, uploadId, { url })
    } catch (cause) {
      actions.failMediaUpload(projectId, uploadId, cause instanceof Error ? cause.message : String(cause))
      throw cause instanceof Error ? cause : new Error('文本上传失败')
    }
  }
  // P8.4：参考视频上传入口。原始字节流交给 Host 抽帧提风格；成功后帧图 +
  // 风格归纳 sticky 由客户端一次快照落画布并持久化。
  const handleUploadVideo = async (file: File, at?: { x: number; y: number }): Promise<void> => {
    if (projectId === null) return
    // 输入框上方那张首帧卡片的三段状态（内存态）。objectURL 给「上传中」画首帧
    // （本地文件，秒出；内容与随后落盘的同源 url 相同），组件卸载时回收。
    const uploadId = newUploadId()
    actions.beginMediaUpload(projectId, {
      id: uploadId,
      kind: 'video',
      name: file.name,
      size: file.size,
      objectUrl: URL.createObjectURL(file),
      status: 'uploading',
    })
    try {
      const payload = await uploadStudioVideo(projectId, file)
      // 2026-09-22：上传只落**一个视频节点**（可播放、可被 videoRefs 当参考），
      // 抽帧与风格归纳改为右键「拆分视频」按需触发 —— 上传即抽帧会一次灌满画布。
      // 同日再改：**不再预上传 Drama 句柄**（整段视频发远端，耗时随大小线性增长，
      // 会把节点与首帧挡在门外）；句柄由 @ref 首次引用时惰性提升补上。
      persistAfter(() => actions.addVideoNode(projectId, {
        url: payload.videoUrl,
        title: file.name,
        ...(payload.duration > 0 ? { duration: payload.duration } : {}),
      }, at))
      actions.settleMediaUpload(projectId, uploadId, {
        url: payload.videoUrl,
        ...(payload.duration > 0 ? { duration: payload.duration } : {}),
      })
    } catch (cause) {
      actions.failMediaUpload(projectId, uploadId, cause instanceof Error ? cause.message : String(cause))
      throw cause instanceof Error ? cause : new Error('参考视频上传失败')
    }
  }
  /**
   * 拖入文件的**唯一分发**（CV-241）：按 `classifyFile` 四类分发 ——
   * 优先级 video > image > audio > text，逐个 await；未知扩展给 reject toast，
   * **绝不静默**。画布区 drop 与全局 capture 接管共用这一份。
   */
  // A-9：拖放落点的屏幕坐标 → 画布世界坐标（卡片中心对松手点）。落点在画布
  // 容器之外（工具栏/时间轴）时返回 null，回落网格落点。
  const dropWorldAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = document.querySelector<HTMLElement>('.csCanvasSurface')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
    return screenToWorld(clientX - rect.left, clientY - rect.top, view.x, view.y, view.scale)
  }
  const handleDroppedFiles = (files: readonly File[], at?: { x: number; y: number }): void => {
    void (async () => {
      const rejected: string[] = []
      const accepted: { kind: MediaKind; file: File }[] = []
      for (const file of files) {
        const kind = classifyFile(file.name)
        if (kind === null) {
          rejected.push(file.name)
          continue
        }
        accepted.push({ kind, file })
      }
      if (rejected.length > 0) {
        pushToast(`不支持的文件类型：${rejected.join('、')}`, 'error')
      }
      const priority: Record<MediaKind, number> = { video: 0, image: 1, audio: 2, text: 3 }
      accepted.sort((a, b) => priority[a.kind] - priority[b.kind])
      for (const { kind, file } of accepted) {
        try {
          if (kind === 'video') await handleUploadVideo(file, at)
          else if (kind === 'image') await handleUploadImage(file)
          else if (kind === 'audio') await handleUploadAudio(file, at)
          else await handleUploadText(file, at)
        } catch (cause) {
          pushToast(errorToastText(cause, `${MEDIA_KIND_LABEL[kind]}上传失败`), 'error')
        }
      }
    })()
  }
  const droppedFilesRef = useRef(handleDroppedFiles)
  droppedFilesRef.current = handleDroppedFiles

  /**
   * CV-261：首页（尚无项目）拖入 / 选择的素材 → **暂存**，不上传。
   *
   * 与上面的 `handleDroppedFiles` 分开而不是加分支：那一条的每一步都以 projectId
   * 为前提（`/canvas-studio/upload*` 全要项目目录、落卡要节点表），首页根本没有项目
   * ——硬塞进去只会得到一串 `if (projectId === null) return`，把「首页走的是另一条
   * 链路」这个事实藏起来。
   *
   * 校验在这里**当场**做（分类 + 四类限额，见 lobby-stash.ts）：落盘失败发生在项目
   * 已经建好、消息已经发出之后，那时首页的暂存条已经卸载，失败没有出口。
   */
  const handleStashedFiles = (files: readonly File[]): void => {
    if (files.length === 0) return
    const result = stashLobbyFiles(files, actions)
    // 拒收必须说出来（与 handleDroppedFiles 同一纪律：绝不静默）——而且要说清
    // 「哪一类不行」，因为用户此前收到的是一句把所有类别都排除掉的错误提示。
    if (result.unknown.length > 0) {
      pushToast(`不支持的文件类型：${result.unknown.join('、')}`, 'error')
    }
    if (result.oversized.length > 0) {
      pushToast(`超出大小限制：${result.oversized.join('、')}`, 'error')
    }
    // 收下的部分不另弹提示：可见回执就是输入框上方那条暂存条本身。
  }
  const stashedFilesRef = useRef(handleStashedFiles)
  stashedFilesRef.current = handleStashedFiles

  /**
   * 四类文件的**全局拖放接管**（2026-09-22 → CV-241；CV-261 扩到首页态）。
   *
   * 宿主把附件拖放挂在 `document` 上、**非 capture 且不区分落点**（`ui-attachment` 的
   * ComposerAttachments）。由此产生两个症状，都是本 effect 要治的：
   * ① 非图片在**任意位置**松手都会撞上宿主那条图片校验 → 弹「仅支持 PNG…」。
   * ② 拖到画布上时，画布 onDrop 与宿主的 document 监听**都会跑** —— 素材已经落进画布，
   *    错误提示却照弹（同一批文件被两条链路各自处理了一次）。
   *
   * 处置：在 **capture 阶段**接管，`stopPropagation` 让宿主的 document 监听与 React
   * 合成事件都收不到，再走画布自己的上传链路。
   * - work 态：**图片不拦** —— 仍按原样分派（拖进画布 = 落素材节点；拖到别处 = 宿主
   *   把它加进对话附件，那是宿主既有能力，本插件不该覆盖）。只有「含非 image」的批次
   *   才接管。
   * - 首页（CV-261）：**一律接管**。首页的四类都归暂存条（含夹在批次里的图片），
   *   否则接管了整批、图片却没人认领就当场丢了；而纯图片批次若不接管，会落到宿主的
   *   附件通道 —— 同一个文件在首页与项目里得到两种归宿，用户没法预期。
   *
   * dragenter / dragover 读不到文件名，只能看 items 声明的 MIME：首页只看「是不是
   * 拖的文件」，work 态看「有没有非 image」（拦下宿主那张「松手添加图片」遮罩，
   * 那张遮罩对视频是错的）；真正分类在 drop 用 `classifyFile(file.name)`。
   */
  useEffect(() => {
    const lobby = projectId === null
    /** 这一批是否由本插件接管（判定见上：首页全接管，work 态只接管含非 image 的）。 */
    const ownsDrop = (dataTransfer: DataTransfer | null): boolean => {
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return false
      if (lobby) return true
      return Array.from(dataTransfer.items).some(item =>
        item.kind === 'file' && !item.type.startsWith('image/'))
    }
    const swallow = (event: DragEvent): void => {
      if (!ownsDrop(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer === null ? [] : Array.from(event.dataTransfer.files)
      if (files.length === 0 || !ownsDrop(event.dataTransfer)) return
      // 首页：四类都进暂存清单（不上传；发送时由认领分支落画布）。
      if (lobby) {
        event.preventDefault()
        event.stopPropagation()
        stashedFilesRef.current(files)
        return
      }
      // work 态：非 image（含未知扩展 classifyFile → null）才接管；纯图片留给宿主与画布原路径。
      if (!files.some(file => classifyFile(file.name) !== 'image')) return
      event.preventDefault()
      event.stopPropagation()
      // A-9：drop 当帧捕获坐标（await 后 view 可能变）——卡片中心对松手点。
      droppedFilesRef.current(files, dropWorldAt(event.clientX, event.clientY) ?? undefined)
    }
    document.addEventListener('dragenter', swallow, true)
    document.addEventListener('dragover', swallow, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('dragenter', swallow, true)
      document.removeEventListener('dragover', swallow, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [projectId])

  /**
   * 拆分视频（右键菜单）：对**已有视频节点**抽帧 + 风格归纳，派生「帧图 + 归纳便签」。
   *
   * 原视频**不动** —— 它是画布上的正式节点；派生失败只是不落新节点（Host 侧也只清理
   * 本次新抽的帧）。抽帧要跑 ffmpeg、归纳要调 VLM，故先给一条进行中的 toast。
   */
  const handleSplitVideo = async (nodeId: string): Promise<void> => {
    if (projectId === null) return
    const node = nodes.find(candidate => candidate.id === nodeId)
    if (node === undefined || typeof node.url !== 'string' || node.url.length === 0) return
    pushToast('正在拆分视频（抽帧 + 风格归纳）…')
    try {
      const payload = await splitStudioVideo(projectId, node.url, node.title ?? '')
      persistAfter(() => actions.addVideoStyleNodes(projectId, {
        ...payload,
        name: node.title ?? '参考视频',
        sourceVideoId: nodeId,
      }))
      pushToast(`已拆出 ${payload.frames.length} 帧并生成风格归纳`)
    } catch (cause) {
      pushToast(errorToastText(cause, '视频拆分失败'), 'error')
    }
  }
  // 视口/面板状态：store 即时合并（画布受控渲染），磁盘保存防抖合并。
  const handleViewChange = useCallback((patch: Partial<StudioCanvasView>): void => {
    if (projectId === null) return
    actions.setView(projectId, patch)
    if (viewSaveTimer.current !== null) clearTimeout(viewSaveTimer.current)
    viewSaveTimer.current = setTimeout(() => {
      viewSaveTimer.current = null
      persist()
    }, VIEW_SAVE_DEBOUNCE_MS)
  }, [projectId, actions, persist])
  const handleDelete = useCallback((ids: string[]): void => {
    if (projectId === null || ids.length === 0) return
    // B-1 定案（2026-10-03）：删除 = 彻底删除、不可撤销（无回退口径）——确认是
    // 唯一防线，必须把下游引用方指名道姓列出来（A-13 残余缺口收口）。
    const removed = new Set(ids)
    const targets = nodes.filter(node => removed.has(node.id))
    const keys = new Set(targets.flatMap(node => [node.filename, node.url].filter((value): value is string => typeof value === 'string')))
    const referencing = keys.size > 0
      ? nodes.filter(node => !removed.has(node.id) && node.generationPrompt !== undefined
          && [...keys].some(key => node.generationPrompt!.includes(key)))
      : []
    const names = referencing.map(node => node.title ?? node.id).join('、')
    const message = referencing.length > 0
      ? `即将彻底删除（不可撤销）。以下 ${referencing.length} 个节点的参考将断链：${names}。确定删除？`
      : '彻底删除（不可撤销）？'
    if (!window.confirm(message)) return
    persistAfter(() => actions.removeNodes(projectId, ids))
    setDetailNodeId(null)
  }, [projectId, actions, persistAfter, nodes])
  const handleToggleVisibility = (id: string): void => {
    if (projectId === null) return
    const node = nodes.find(candidate => candidate.id === id)
    if (node === undefined) return
    actions.setVisibility(projectId, id, node.visible === false)
  }
  const handleReorder = (id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void => {
    if (projectId === null) return
    persistAfter(() => actions.reorderNode(projectId, id, direction))
  }
  const handleUndo = useCallback((): void => {
    persistAfter(() => actions.undo())
  }, [persistAfter, actions])
  const handleRedo = useCallback((): void => {
    persistAfter(() => actions.redo())
  }, [persistAfter, actions])
  const handleRename = useCallback((id: string, title: string): void => {
    if (projectId === null) return
    persistAfter(() => actions.renameNode(projectId, id, title))
  }, [projectId, actions, persistAfter])
  // P9 参考托盘：节点字段更新（角色/强度/标记）走 updateNode 并持久化。
  // CR-041：CanvasSurface 的 onUpdateNode 也复用此处理器（已 useCallback 稳定）。
  const handleUpdateNode = useCallback((id: string, updates: Partial<StudioCanvasNode>): void => {
    if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, updates))
  }, [projectId, actions, persistAfter])
  // 引用到对话：把 @ref[显示名] 直接插入右侧聊天输入框光标处；上游 InputBar 是
  // 外部结构，找不到输入框时回退「复制 + 提示」（plan §4.1 ③ 的稳健退化）。
  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    if (setter !== undefined) setter.call(el, value)
    else el.value = value
  }
  const insertReferenceToken = (input: HTMLElement, token: string): boolean => {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      const next = input.value.slice(0, start) + token + input.value.slice(end)
      setNativeValue(input, next)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      const caret = start + token.length
      try { input.setSelectionRange(caret, caret) } catch { /* 非文本选择控件忽略 */ }
      return true
    }
    if (input.isContentEditable) {
      input.focus()
      const sel = window.getSelection()
      if (sel !== null && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const textNode = document.createTextNode(token)
        range.insertNode(textNode)
        range.setStartAfter(textNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
    }
    return false
  }
  // REQ-004 / R-P2-01：多选批量「引用到对话」——逐个插 chip（不可用时合并成一条
  // 纯文本 @ref 串降级），空格分隔，一次把整组选中素材交给 agent。
  const handleReferenceSelectedToChat = (ids: readonly string[]): void => {
    const picked = nodes.filter(node => ids.includes(node.id))
    if (picked.length === 0) return
    let chipOk = true
    for (const node of picked) {
      if (!insertAssetChip(node.id)) { chipOk = false; break }
    }
    if (chipOk) return
    let token: string
    try {
      token = picked.map(node => formatRefToken(node.id)).join(' ')
    } catch (cause) {
      pushToast(errorToastText(cause, '无法生成引用标记'))
      return
    }
    const input = document.querySelector(
      '.csConversation textarea, .csConversation [contenteditable="true"], .csConversation input[type="text"]',
    )
    if (input instanceof HTMLElement && insertReferenceToken(input, token)) return
    void copyTextToClipboard(token, clipboardEnv()).then((result) => {
      pushToast(result.ok
        ? `已复制 ${picked.length} 个引用标记：${token}\n在右侧聊天框粘贴，并补充说明。`
        : clipboardResultMessage(result))
    })
  }
  const handleReferenceToChat = (node: StudioCanvasNode): void => {
    // CV-114：优先插成输入框里的真 chip（与打 @ 选中候选同一产物，带文件图标、
    // 独立可删、hover 可出缩略图）。不可用时降级为纯文本 @ref 注入。
    if (insertAssetChip(node.id)) return
    let token: string
    try {
      // 降级句柄用 node id（CV-114：id 唯一稳定，Host 侧另有标题兜底匹配）。
      token = formatRefToken(node.id)
    } catch (cause) {
      pushToast(errorToastText(cause, '无法生成引用标记'))
      return
    }
    const input = document.querySelector(
      '.csConversation textarea, .csConversation [contenteditable="true"], .csConversation input[type="text"]',
    )
    if (input instanceof HTMLElement && insertReferenceToken(input, token)) return
    // CV-198：降级路径的结果也要出 toast —— 此前 `.catch(() => {})` 把失败吞了，
    // 用户会看到「已复制引用标记」却粘出个空。
    void copyTextToClipboard(token, clipboardEnv()).then((result) => {
      pushToast(result.ok
        ? `已复制引用标记：${token}\n在右侧聊天框粘贴，并补充说明（如「用这张角色图生成分镜」）。`
        : clipboardResultMessage(result))
    })
  }
  /**
   * CV-065/066：技能广场「使用」。
   *
   * 语义是**把提示词插进对话输入框**，不自动发送、不注入 system prompt：
   * 用户不改不回车就什么都没发生（reserved 字段原则：不伪造已生效），也让
   * agent 自己决定要不要 `skill(name=X)` 加载正文（不污染模型决策）。
   * 找不到输入框时与 @ref 引用一样回退「复制 + 提示」。
   *
   * CV-066：work 态（已开项目）下**同时装载**到该项目的 activeSkills ——
   * 用户明确选了它，装载是自然结果；chip 常驻展示「已装载」，之后说
   * 「换个风格做一版」agent 仍会沿用该 skill。卸载走 chip 的 ×。
   * lobby 态没有项目可挂，只插提示词（用户回车后按消息里的技能名走软激活）。
   */
  const handleActivateSkill = (entry: SkillCatalogEntry): void => {
    setSkillMarketOpen(false)
    // CV-124：优先插**真 chip**（`⚡短标题`，整体可删；与 `/` 菜单选中同一产物）。
    // 管线不可用 / 无会话时降级为纯文本注入（CV-065 原行为）。
    if (insertSkillChip(entry.name)) {
      pushToast(`已填入技能：${entry.title}。补充说明后发送，agent 会加载该技能。`)
    } else {
      const token = formatSkillToken(entry.name, entry.title)
      // REQ-005 v1.3（变体 A）：lobby 态宿主对话卡恢复可见（v1.2 的 CSS 隐藏已撤），
      // 技能提示词直接填宿主输入框；此时无会话则宿主输入框 inert（找不到元素），
      // 走 CV-198 降级复制。
      const input = document.querySelector(
        '.csConversation textarea, .csConversation [contenteditable="true"], .csConversation input[type="text"]',
      )
      if (input instanceof HTMLElement && insertReferenceToken(input, token)) {
        pushToast(`已填入技能提示词：${entry.title}。补充说明后发送，agent 会加载该技能。`)
      } else {
        // CV-198：同上，降级复制的结果必须报出来（成功与失败各有各的文案）。
        void copyTextToClipboard(token, clipboardEnv()).then((result) => {
          pushToast(result.ok
            ? `已复制技能提示词：${token}\n粘贴到聊天框并补充说明后发送。`
            : clipboardResultMessage(result))
        })
      }
    }
    if (projectId !== null) {
      void activateSkill(projectId, entry.name).catch((cause) => {
        actions.setFailed(cause instanceof Error ? cause.message : '技能装载失败')
      })
    }
  }
  const handleDeactivateSkill = (name: string): void => {
    if (projectId === null) return
    void deactivateSkill(projectId, name).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '技能卸载失败')
    })
  }
  const handleRetry = useCallback((id: string): void => {
    if (projectId === null) return
    void retryNode(projectId, id).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '重试失败')
    })
  }, [projectId, actions, retryNode])
  /**
   * CV-198：把节点内容写进**系统**剪贴板（粘到微信 / 文档）。
   *
   * 与同菜单里就地克隆节点的「复制」是两件事（见 CanvasContextMenu 的 props 注释）。
   * 结果一律出 toast：剪贴板的失败在浏览器里是**静默**的，不报出来用户只会觉得
   * 「点了没反应」。文案由 `clipboardResultMessage` 统一生成（含下一步怎么办）。
   */
  const handleCopyToClipboard = (node: StudioCanvasNode): void => {
    void copyNodeToClipboard(node, clipboardEnv()).then((result) => {
      pushToast(clipboardResultMessage(result))
    })
  }
  /**
   * CV-020：把节点资产另存到本地。
   *
   * 资产由插件自己的 webServer 提供，与页面同源，`a[download]` 会被浏览器
   * 尊重（存到「下载」目录而非跳转打开）。万一将来资产挪到跨域地址，
   * `download` 会被忽略并退化为「在新标签打开」，仍可取回文件，不会静默失败。
   */
  const handleDownload = (node: StudioCanvasNode): void => {
    if (!canDownloadNode(node) || node.url === undefined) return
    const link = document.createElement('a')
    link.href = node.url
    link.download = assetDownloadName(node)
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }
  /**
   * CV-108：作废 / 恢复片段。失效片段不参与默认合成（compose 只收有效版），
   * 但仍留在画布上可回溯。恢复旧版时接管它的新版本自动作废，保证同一镜位
   * 只有一份有效——否则成片里会同时出现同一镜的两版。
   */
  const handleToggleRetire = useCallback((id: string): void => {
    if (projectId === null) return
    const current = nodesRef.current
    const next = toggleRetire(current, id)
    const byId = new Map(next.map((node) => [node.id, node] as const))
    persistAfter(() => {
      for (const node of current) {
        const updated = byId.get(node.id)
        if (updated === undefined || updated === node) continue
        actions.updateNode(projectId, node.id, { retired: updated.retired, supersededBy: updated.supersededBy })
      }
    })
  }, [projectId, actions, persistAfter])
  const handleTimelineSelect = useCallback((id: string): void => {
    actions.selectNode(id)
    setFocusNodeId(id)
    setDetailNodeId(null)
  }, [actions])
  // P7：审批动作后无需手动刷新 —— Host 返回的工作流已写回 store。
  const handleApprove = (): void => {
    if (projectId !== null) void approveStoryboard(projectId).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '批准失败')
    })
  }
  const handleReject = (): void => {
    if (projectId !== null) {
      void rejectStoryboard(projectId, rejectFeedback).then(() => {
        setRejectFeedback('')
      }).catch((cause) => {
        actions.setFailed(cause instanceof Error ? cause.message : '驳回失败')
      })
    }
  }
  const handleConfirmKeyframes = (): void => {
    if (projectId !== null) void confirmKeyframes(projectId).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '确认关键帧失败')
    })
  }
  // CV-051：打回关键帧 —— 与分镜驳回同一条交互（意见框复用 rejectFeedback）。
  const handleRejectKeyframes = (): void => {
    if (projectId !== null) {
      void rejectKeyframes(projectId, rejectFeedback).then(() => {
        setRejectFeedback('')
      }).catch((cause) => {
        actions.setFailed(cause instanceof Error ? cause.message : '打回关键帧失败')
      })
    }
  }
  // CV-100：剧本审批（批准 → drafting，agent 醒来进入分镜规划；驳回 → 按意见重写）。
  const handleApproveScreenplay = (): void => {
    if (projectId !== null) void approveScreenplay(projectId).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '批准剧本失败')
    })
  }
  const handleRejectScreenplay = (): void => {
    if (projectId !== null) {
      void rejectScreenplay(projectId, rejectFeedback).then(() => {
        setRejectFeedback('')
      }).catch((cause) => {
        actions.setFailed(cause instanceof Error ? cause.message : '驳回剧本失败')
      })
    }
  }
  const applyWorkflowMode = (mode: 'confirm' | 'auto'): void => {
    setPendingAutoMode(false)
    if (projectId !== null) void setWorkflowMode(projectId, mode).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '模式切换失败')
    })
  }
  /**
   * CV-196：切到放手跑先过一道确认。
   *
   * 理由是对称性被打破：切回逐步确认随时可做且无损，而放手跑会一路烧到成片、
   * 中途不再询问。现在激活态只有一点底色差（`.csActive`），误点一次要等十几分钟
   * 才知道点错了。确认内容必须说清**代价**，否则这个弹窗只是多一次点击。
   */
  const handleSetMode = (mode: 'confirm' | 'auto'): void => {
    if (mode === 'auto' && workflow?.mode !== 'auto') {
      setPendingAutoMode(true)
      return
    }
    applyWorkflowMode(mode)
  }
  // P9.1：时间轴有效顺序（持久化 timeline → 过滤已删节点 → 新节点按 createdAt 补齐）。
  // CR-041：useMemo 缓存派生数组——非节点变化的重渲染（toast/设置等）不再重算。
  const timelineOrder = useMemo(() => deriveTimelineOrder(nodes, view.timeline), [nodes, view.timeline])
  /**
   * C2：镜号表（节点 id → 成片第几段，1 起）。
   *
   * 口径与底部时间轴**同源**：同一次 `isShotClip` 筛选 + 同一个 `timelineOrder`
   * 顺序 = `CanvasTimeline` 里 `clips` 的同一份序列（该处已改为直接 filter
   * isShotClip，所以这不是「两处碰巧一致」，而是同一个判断）。因此画布卡上的
   * `#N` 与轨道上的第 N 段永远是同一个数 —— 包括用户拖拽重排之后（重排写回
   * view.timeline → timelineOrder 变 → 两边一起变）。
   *
   * 不在 CanvasNode 里各自数：节点数组的顺序是画布渲染顺序，与成片顺序无关。
   */
  const shotIndexOf = useMemo(() => {
    const map = new Map<string, number>()
    let index = 0
    for (const node of timelineOrder) {
      if (!isShotClip(node)) continue
      index += 1
      map.set(node.id, index)
    }
    return map
  }, [timelineOrder])
  const handleTimelineReorder = (ids: string[]): void => {
    handleViewChange({ timeline: ids })
  }
  // CV-006：合成选择派生（排除勾选 + BGM 下拉 + 预计时长 + 软提示），纯函数收在
  // src/compose-selection.ts —— 时间轴工具栏与导出动作共用同一份结果，不再各算各的。
  const composeSelection = useMemo(
    () => resolveComposeSelection({
      ordered: timelineOrder,
      excluded: view.composeExcluded ?? [],
      ...(view.composeBgmNodeId !== undefined ? { bgmNodeId: view.composeBgmNodeId } : {}),
    }),
    [timelineOrder, view.composeExcluded, view.composeBgmNodeId],
  )
  // CV-006：切换某片段的纳入/排除态（时间轴勾选区）。作废片段不进排除表——
  // 它们在勾选区直接禁用，有效性（retired/supersededBy）与排除是正交维度。
  const handleComposeExcludeToggle = (id: string): void => {
    const current = view.composeExcluded ?? []
    const next = current.includes(id)
      ? current.filter(existing => existing !== id)
      : [...current, id]
    handleViewChange({ composeExcluded: next })
  }
  // CV-006：选定/取消 BGM。undefined = 回「不使用」；持久化随 view 走同一条防抖通路。
  const handleComposeBgmChange = (nodeId: string | undefined): void => {
    handleViewChange(nodeId === undefined ? { composeBgmNodeId: undefined } : { composeBgmNodeId: nodeId })
  }
  // P9.3：一键导出成片。取时间轴上 kind=video 的片段（按当前顺序）作为 clipIds，
  // 调 Host 合成路由，成功回写画布 video-composite 节点。
  // CV-141：**单片段也放行**（一镜整出，保留原生环境声）——旧版硬卡 ≥2 把这条路封死。
  // CV-006：clipIds 换为 composeSelection 派生结果（排除勾选已过滤），BGM 下拉
  // 选中的节点经同一 SDK 可选参传入 —— UI 与 agent 走完全相同的 /compose 通路。
  const handleComposeExport = async (): Promise<void> => {
    if (projectId === null || composeBusy) return
    const clipIds = composeSelection.clipIds
    if (clipIds.length < 1) {
      pushToast('请先在时间轴上放置至少 1 个视频片段，再导出成片', 'error')
      return
    }
    setComposeBusy(true)
    try {
      const { url, duration, width, height, audioComposition, warnings } = await composeStudioVideo(
        projectId,
        clipIds,
        // CV-006：失效 BGM 引用已在 composeSelection 里回退 undefined（不使用）。
        ...(composeSelection.bgmNode !== undefined ? [composeSelection.bgmNode.id] : []),
      )
      const composedId = newNodeId()
      // 若画布上存在「文案」节点（write_script 产物），把其正文随成片一起落盘展示。
      const scriptNode = nodes.find(node =>
        (node.kind === 'text' || node.kind === 'prompt') && /文案/.test(node.title ?? ''))
      const script = scriptNode?.text
      persistAfter(() => actions.addComposedVideo(projectId, {
        id: composedId,
        url,
        title: `成片 ${new Date().toLocaleString('zh-CN')}`,
        duration,
        ...(typeof width === 'number' ? { mediaWidth: width } : {}),
        ...(typeof height === 'number' ? { mediaHeight: height } : {}),
        ...(typeof script === 'string' && script.length > 0 ? { script } : {}),
        ...(audioComposition !== undefined ? { audioComposition } : {}),
        sourceIds: composedSourceIds(clipIds, composeSelection.bgmNode?.id, scriptNode?.id),
      }))
      // F1：成片回写后自动居中并适配视野，确保用户立刻在画布上看到，无需手动寻找。
      setFocusNodeId(composedId)
      fitPendingRef.current = true
      setFitRequestedAt(Date.now())
      // CV-143：连音轨构成一起说清（「无声」这种结论不能只挂在角标上）。
      const audioLabel = audioComposition === undefined ? '' : ` · ${AUDIO_COMPOSITION_LABELS[audioComposition]}`
      pushToast(`成片已生成（${duration.toFixed(1)}s${audioLabel}），已添加到画布并自动定位到视图中心。`, 'success')
      // CV-138 / CV-141：降级说明（多镜无 BGM 导致无声、探测失败回退等）逐条提示。
      for (const warning of warnings ?? []) pushToast(warning, 'error')
    } catch (cause) {
      pushToast(errorToastText(cause, '成片合成失败'), 'error')
    } finally {
      setComposeBusy(false)
    }
  }

  // CR-041：稳定画布子组件回调（配合 CanvasNode/CanvasEdges memo）。依赖只含
  // projectId/actions/persistAfter 等稳定引用——拖拽时 StudioFrame 虽因 store
  // 订阅重渲染，但这些回调引用不变，未移动节点不重渲染。onMediaNatural 经
  // nodesRef 读最新节点，避免闭包随 nodes 变化。
  const handleSelectNode = useCallback((id: string | null, multi?: boolean) => {
    actions.selectNode(id, multi)
  }, [actions])
  const handleSelectAllNodes = useCallback(() => { actions.selectAllNodes() }, [actions])
  /**
   * C1：点阶段轨道 → 选中该段全部产物 + 把视口对上去。
   *
   * 「可点击」必须有动作 —— 只做高亮的按钮是假按钮（比不可点更糟：用户会反复点）。
   * 这里给的动作是**定位该阶段产物**：点「定妆」就把定妆那几张卡选中并铺满视口。
   * 无产物的段在渲染层走 `:disabled`，不会进到这里。
   */
  const handleFocusStage = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return
    actions.selectNodes(ids)
    // 下一帧再对焦：zoomToSelection 读的是入参，同一 tick 内调用拿到的还是旧选中集，
    // 视口会对到上一次选中的地方（表现为「点了定妆，镜头却飞去了分镜」）。
    requestAnimationFrame(() => { surfaceRef.current?.zoomToSelection() })
  }, [actions])
  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    if (projectId === null) return
    actions.moveNode(projectId, id, x, y)
  }, [projectId, actions])
  const handleCopy = useCallback(() => {
    if (projectId !== null) actions.copySelected(projectId)
  }, [projectId, actions])
  const handlePaste = useCallback(() => {
    if (projectId !== null) persistAfter(() => actions.pasteNodes(projectId))
  }, [projectId, actions, persistAfter])
  const handleLinkLayers = useCallback((sourceIds: string[], targetId: string) => {
    if (projectId !== null) persistAfter(() => actions.linkLayers(projectId, sourceIds, targetId))
  }, [projectId, actions, persistAfter])
  // R-P0-12：断开选中边（Delete）；拖线落空 → 弹「新建节点并连线」菜单。
  // 二增量：target 带生成操作类型（isGenerationEdge）时断开要走确认 ——
  // sourceIds 是节点级重试 / agent 再生成的取材来源，删边等于改写后续产物；
  // 导入 / 参考边（import）直接断，不打扰。pendingUnlink 持边（不是快照），
  // 确认时按 id 重查节点，标题取的是最新值。
  const [pendingUnlink, setPendingUnlink] = useState<{ sourceId: string; targetId: string } | null>(null)
  const handleUnlinkNodes = useCallback((sourceId: string, targetId: string) => {
    if (projectId === null) return
    if (isGenerationEdge(nodesRef.current.find(node => node.id === targetId))) {
      setPendingUnlink({ sourceId, targetId })
      return
    }
    persistAfter(() => actions.unlinkNodes(projectId, sourceId, targetId))
  }, [projectId, actions, persistAfter])
  const handleLinkDropEmpty = useCallback((screenX: number, screenY: number, worldX: number, worldY: number, sourceId: string) => {
    setEdgeCreateMenu({ x: screenX, y: screenY, worldX, worldY, sourceId })
  }, [])
  const handleNodeTextSubmit = useCallback((id: string, text: string) => {
    if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, { text }))
  }, [projectId, actions, persistAfter])
  const handleNodeOpenDetail = useCallback((node: StudioCanvasNode) => {
    actions.selectNode(node.id)
    setDetailNodeId(node.id)
  }, [actions])
  const handleNodeOpenPlayback = useCallback((node: StudioCanvasNode) => {
    actions.selectNode(node.id)
    setPlaybackNodeId(node.id)
  }, [actions])
  const handleNodeOpenPreview = useCallback((node: StudioCanvasNode) => {
    actions.selectNode(node.id)
    setPreviewNodeId(node.id)
  }, [actions])
  const handleCanvasContextMenu = useCallback((node: StudioCanvasNode, x: number, y: number) => {
    setBlankMenu(null)
    setMenu({ node, x, y })
  }, [])
  const handleBlankContextMenu = useCallback((x: number, y: number, worldX: number, worldY: number) => {
    setMenu(null)
    setBlankMenu({ x, y, worldX, worldY })
  }, [])
  const handleMediaNatural = useCallback((id: string, naturalWidth: number, naturalHeight: number) => {
    // CV-013：分辨率缺失时回填真实宽高（详情面板「分辨率」显示）；
    // CV-188：**不一致也纠正**（此前只在 `mediaWidth === undefined` 时回填）—— 客户端是
    // 唯一知道真实像素的一方（媒体已加载），而落盘值可能是假值：典型是视频节点，其真实
    // 产物像素由供应商决定（Drama 恒 864×480），而落盘曾是档位声明值（1280×720 / 1280×736）。
    // 只补「缺失」的话这些错值会**永远**留在画布上（详情面板给每个视频显示假数字）。
    // 写入值就是自然尺寸本身 ⇒ 第二次加载必然相等，**不会反复写盘**（与下面那条同一性质）。
    // CV-029：框比例偏差 >5% 时按长边 480 规则校正（锁定节点只回填
    // 分辨率、不动框）。修正后各条件不再满足，不会循环触发。
    if (projectId === null || naturalWidth <= 0) return
    const target = nodesRef.current.find((node) => node.id === id)
    if (target === undefined) return
    const updates: Partial<StudioCanvasNode> = {}
    if (target.mediaWidth !== naturalWidth || target.mediaHeight !== naturalHeight) {
      updates.mediaWidth = naturalWidth
      updates.mediaHeight = naturalHeight
    }
    if (!target.locked) {
      const mediaAspect = naturalWidth / naturalHeight
      // C10：比的必须是**画面区域**的比例，不是整张卡的比例。卡片比画面高
      // NODE_CHROME_HEIGHT（头 + 脚），拿卡片比例去比画面比例，任何卡片都会
      // 被判成「偏了」，于是每加载一次媒体就重设一次尺寸；而且重设的值也是错的
      // （frameSizeOf 会把 chrome 再算一遍）。逆运算 mediaBoxOf 就在同一模块里，
      // 和 frameSizeOf 共用同一个常量，不会各写各的。
      const mediaBox = mediaBoxOf(target)
      const boxAspect = mediaBox.width / mediaBox.height
      if (Math.abs(boxAspect - mediaAspect) / mediaAspect > 0.05) {
        // 画面比例偏差 >5%：按长边 480 规则重算**节点框**（画面 + chrome）。
        // 与写盘路径同一函数，避免与 canvas-aspect 的 1:1 / 地板规则漂移。
        const display = frameSizeOf({ width: naturalWidth, height: naturalHeight })
        updates.width = display.width
        updates.height = display.height
      }
    }
    if (Object.keys(updates).length === 0) return
    persistAfter(() => actions.updateNode(projectId, id, updates))
  }, [projectId, actions, persistAfter])

  // REQ-005 v1.3（变体 A）：首页创意提交改走宿主发送链路（DivertConversation 的
  // lobby 认领拦截，见 index.ts）—— handleCreateFromIdea 及其三态降级注入随
  // LobbyComposer 退役：认领失败时返回 error，宿主自己保草稿，无需第二份降级。

  const canvasBody = ((): React.ReactNode => {
    if (projectId === null) {
      // Lobby 态（CV-064 + REQ-005 v1.3 变体 A）：无任何项目 → 品牌条 + 宿主对话卡。
      // 创意输入走宿主卡（发送拦截分支认领 draft 目录建项目，见 index.ts
      // DivertConversation）；规格行挂宿主 conversation.input.dock 槽（LobbySpecRow）。
      // 宿主对话槽照旧挂载（**不再 CSS 隐藏**，v1.2 的隐藏已撤销），进项目后布局切回。
      return (
        <LobbyHero
          onOpenLibrary={() => { setLibOpen(true); void refreshLibrary() }}
          // CV-261：四类素材的**显式**入口（拖放之外的第一次使用路径）——
          // 宿主 composer 的附件按钮只认图片，非图片连选都选不出来。
          onStashFiles={handleStashedFiles}
        />
      )
    }
    // CV-064 二期：有项目但尚无对话（lobby-pending 态）→ 中栏不渲染画布，
    // 聊天居中 + 推荐技能横滚。首条消息发出（blank 翻转）后自动进入 work。
    // DD-10：这里不再一律返回 null —— 中栏第一行放「开拍前条」，与 work 态的
    // 「工具栏 + 工作流条」同位置，中栏顶部于是在两态之间连续（首屏第一次能
    // 看到这个项目锁了什么规格、走到哪一段）。
    // slateView 为 null 只可能是「未选项目」，而那种情况已经在上面走 LobbyHero
    // 分支了；这里仍保留兜底分支，是为了不让「模型缺失」变成一次空渲染。
    if (!hasConversation) {
      return slateView === null ? null : <SlateBar view={slateView} />
    }
    return (
      <>
        <div className="csCanvasBody">
          {/* REQ-003 Step 2：「改提示词」改为画布就地浮层；CV-272 起浮层 id 受控于
              宿主（promptEditNodeId）—— 工具条「改提示词」与右键「修改提示词」
              打开同一个面板；双击节点的「查看详情」仍走 handleNodeOpenDetail。
              浮层参考区依赖与详情抽屉同一份来源。 */}
          <CanvasSurface
            nodes={visibleNodes}
            shotIndexOf={shotIndexOf}
            view={view}
            onViewChange={handleViewChange}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={selectedNodeIds}
            onSelectNode={handleSelectNode}
            onSelectAllNodes={handleSelectAllNodes}
            onMoveNode={handleMoveNode}
            onUpdateNode={handleUpdateNode}
            onBeginEdit={beginEdit}
            onPersist={persist}
            onRemoveNodes={handleDelete}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onLinkLayers={handleLinkLayers}
            onUnlinkNodes={handleUnlinkNodes}
            onLinkDropEmpty={handleLinkDropEmpty}
            onRename={handleRename}
            onNodeTextSubmit={handleNodeTextSubmit}
            onNodeOpenDetail={handleNodeOpenDetail}
            onNodeOpenPlayback={handleNodeOpenPlayback}
            onNodeOpenPreview={handleNodeOpenPreview}
            onContextMenu={handleCanvasContextMenu}
            onBlankContextMenu={handleBlankContextMenu}
            onRetry={handleRetry}
            onMediaNatural={handleMediaNatural}
            {...(queueNote !== null ? { queueNote } : {})}
            focusNodeId={focusNodeId}
            ref={surfaceRef}
            minimapVisible={view.minimapVisible}
            onFitClamped={handleFitClamped}
            onNodeReferenceToChat={handleReferenceToChat}
            allNodes={nodes}
            libraryAssets={libraryAssets}
            // CV-272：右键「修改提示词」与工具条「改提示词」共用同一个就地浮层。
            promptEditNodeId={promptEditNodeId}
            onPromptEditNodeIdChange={setPromptEditNodeId}
            {...(projectId === null ? {} : { onResolveRefs: (refs: readonly string[]) => resolveStudioRefs(projectId, refs) })}
            // 抽屉压在画布下缘：工具条与浮层都必须知道它占了多少，才不会被它盖住。
            detailInset={detailOpen ? detailHeight : 0}
          />
          {nodes.length === 0 && <CanvasEmptyHint />}
          <div className="csReferenceFloat">
            {referenceNodes.length > 0
              ? (
                <ReferenceTray
                  nodes={referenceNodes}
                  onUpdateNode={handleUpdateNode}
                  onReferenceToChat={handleReferenceToChat}
                />
              )
              : (
                // CV-011：空态引导 —— 原先空托盘直接不渲染，新用户不知道该能力存在。
                // CV-058：文案与真实交互对齐 —— 上传时没有「设为参考图」勾选项，
                // 标记参考图的唯一路径是节点详情面板。
                <div className="csReferenceEmpty">
                  <p className="csReferenceEmptyTitle">参考图</p>
                  <p className="csReferenceEmptyHint">
                    上传图片后在节点详情面板点「标记为参考」—— 被标记的图片会出现在这里，
                    可指定角色 / 风格 / 首末帧用途，并通过「引用到对话」交给 agent 使用。
                  </p>
                </div>
              )}
          </div>
          {view.layersOpen && (
            <aside className="csCanvasLayers">
              <LayerPanel
                nodes={nodes}
                selectedNodeIds={selectedNodeIds}
                onSelect={(id, multi) => {
                  actions.selectNode(id, multi)
                  // CV-009：图层面板点击同步居中定位（复用时间轴的 focusNodeId 机制）。
                  setFocusNodeId(id)
                }}
                onSelectIds={ids => { actions.selectNodes(ids) }}
                onDelete={handleDelete}
                onToggleLock={id => { if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id)) }}
                onToggleVisibility={handleToggleVisibility}
                onReorder={handleReorder}
              />
            </aside>
          )}
          {/* CV-246：生成历史抽屉——右侧滑出浮层，与图层浮层同级（.csCanvasBody 内
              ⇒ 只占画布宽、不压宿主右栏）。状态徽章用全量 nodes（含 retired）。 */}
          {historyOpen && projectId !== null && (
            <HistoryDrawer
              projectId={projectId}
              nodes={nodes}
              onClose={() => { setHistoryOpen(false) }}
              onCanvasReloaded={async () => { await props.reloadCanvas(projectId) }}
              onLocate={(id) => {
                // CV-246a：历史卡片「定位」= 与双击素材同一条详情入口 + 画布居中
                // （CV-009 的 focusNodeId 机制，与图层面板点击同一份实现）。
                actions.selectNode(id)
                setDetailNodeId(id)
                setFocusNodeId(id)
              }}
            />
          )}
          {/* 节点详情抽屉：挂在 .csCanvasBody 内 ⇒ 天然「只占画布宽、不压宿主右栏」，
              底边即容器底边 = 时间轴顶边（时间轴是 .csCanvasBody 的下一个兄弟），
              不需要任何「测时间轴高度再减」的浮点账。 */}
          {detailOpen && selectedNode !== null && (
            <NodeDetailDrawer
              node={selectedNode}
              allNodes={nodes}
              height={detailHeight}
              onHeightChange={setDetailHeightPersisted}
              onClose={() => { setDetailNodeId(null) }}
              onRename={handleRename}
              onSetOpacity={(id, opacity) => { if (projectId !== null) persistAfter(() => actions.setOpacity(projectId, id, opacity)) }}
              onToggleFlip={(id, axis) => {
                const target = nodes.find(candidate => candidate.id === id)
                if (target === undefined || projectId === null) return
                persistAfter(() => actions.updateNode(projectId, id, { [axis]: !target[axis] }))
              }}
              onToggleLock={id => { if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id)) }}
              onToggleVisibility={handleToggleVisibility}
              onReorder={handleReorder}
              onDelete={id => { handleDelete([id]) }}
              onRetry={handleRetry}
              onCancel={() => { void cancelCurrentTurn() }}
              onUpdateNode={handleUpdateNode}
              onReferenceToChat={handleReferenceToChat}
              onDownload={handleDownload}
              libraryAssets={libraryAssets}
              // REQ-003：新增参考必须换句柄（产物名直接当参考会 500）——
              // 解析在 Host 侧，客户端只负责把结果写回 generationPrompt。
              {...(projectId === null ? {} : { onResolveRefs: (refs: readonly string[]) => resolveStudioRefs(projectId, refs) })}
            />
          )}
        </div>
        <CanvasTimeline
          ordered={timelineOrder}
          selectedNodeId={selectedNodeId}
          onSelect={handleTimelineSelect}
          onReorder={handleTimelineReorder}
          onCompose={handleComposeExport}
          composeBusy={composeBusy}
          composeClipCount={composeSelection.clipIds.length}
          composeEstSeconds={composeSelection.estSeconds}
          composeWarnings={composeSelection.warnings}
          composeExcluded={view.composeExcluded ?? []}
          composeBgmNodeId={composeSelection.bgmNode?.id}
          onToggleComposeExcluded={handleComposeExcludeToggle}
          onComposeBgmChange={handleComposeBgmChange}
        />
      </>
    )
  })()

  // CV-064：lobby / lobby-pending / work 三种布局形态。lobby = 无项目（聊天
  // 居中 + 右上角新建）；lobby-pending = 有项目但还没聊过（聊天居中、无新建）；
  // work = 有对话（聊天回右栏）。切换完全由 CSS grid 完成（见 styles.ts），
  // 对话槽不做条件渲染 —— 卸载重建会丢草稿、滚动位置与会话绑定。
  const mode = projectId === null ? 'lobby' : hasConversation ? 'work' : 'lobby-pending'

  return (
    <div
      className="csFrame"
      data-mode={mode}
      data-rail={railCollapsed ? 'strip' : 'full'}
      data-chat={chatCollapsed ? 'strip' : 'full'}
    >
      <aside className="csProjects">
        {railCollapsed ? (
          /* DD-08 / R8：收起态整块换成无状态的缩略条（理由见 RailStrip.tsx 模块注释：
             这里刻意不用 CSS 隐藏 —— ProjectList 里有内联表单、重命名草稿等临时态，
             收起左栏本来就该把它们收干净，展开回来应是干净的一份列表）。 */
          <RailStrip
            projects={projects}
            selectedProjectId={selectedProjectId}
            onExpand={() => { setRailCollapsedPersisted(false) }}
            onOpen={openProject}
          />
        ) : (
          <>
            <div className="csBrandHeader">
              {/* REQ-005 / CV-256：品牌区即「回首页」入口（方案 §5.3 —— 此前全仓
                  没有任何用户可达的回首页动作，LogoMark 只是个图形）。只包品牌
                  那一半：收起按钮同在栏头，嵌进本按钮会变成 button 套 button。 */}
              <button
                type="button"
                className="csBrandHome"
                title="回到首页"
                aria-label="回到首页"
                onClick={goHome}
              >
                <LogoMark size={22} />
                <div className="csBrandMeta">
                  <span className="csBrandName">{BRAND.name}</span>
                  <span className="csBrandSub">{BRAND.nameZh}</span>
                </div>
              </button>
              {/* DD-08 / R8：整栏显隐的控制常驻栏头（不放列表段头 —— 段头随列表滚动）。 */}
              <button
                type="button"
                className="csBrandCollapse"
                title="收起项目栏"
                aria-label="收起项目栏"
                onClick={() => { setRailCollapsedPersisted(true) }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M9.5 4.5 6 8l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2.5 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {/* CV-070：列表区独立滚动 —— 段头 + 项目行共享同一个滚动容器；
                滚到这里时左下角用户卡仍固定可见。 */}
            <div className="csProjectsScroll">
              <header className="csProjectsHeader">
                <span className="csProjectsHeaderTitle">项目</span>
                <span className="csProjectsHeaderActions">
                  <button type="button" disabled={phase === 'loading' || creating} onClick={() => void refreshProjects()}>
                    刷新
                  </button>
                </span>
              </header>
              <ProjectList
                projects={projects}
                groups={groups}
                selectedProjectId={selectedProjectId}
                phase={phase}
                error={error}
                errorCode={errorCode}
                creating={creating}
                onRefresh={() => void refreshProjects()}
                // REQ-005 / D4：两个新建入口都改跳首页（新建入口唯一）。v1.3 变体 A
                // 下分组预选随规格行的「分组砍掉」退役，这里只回首页。
                onNewInGroup={(_groupId) => { goHome() }}
                onOpen={openProject}
                onDelete={deleteProject}
                onMoveToGroup={moveProjectToGroup}
                onCreateGroup={createGroup}
                onRenameGroup={renameGroup}
                onDeleteGroup={deleteGroup}
                onOpenSettings={() => { setSettingsOpen(true) }}
                effectTest={effectTest}
                onRunEffectTests={(round, cases) => { void runEffectTests(round, cases) }}
              />
            </div>
            {/* CV-069 / CV-070：左栏底部用户卡（三态常驻；主题/设置接真实功能，
                固定在侧栏底部不随项目列表滚动）。 */}
            <UserCard onOpenSettings={() => { setSettingsOpen(true) }} theme={theme} />
          </>
        )}
      </aside>
      <main
        className="csCanvas"
        onDragOver={(event) => {
          // P8.1：允许把本地文件拖到画布区域，松手即上传落节点。
          // （视频在更外层就被 capture 接管了，走不到这里。）
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          // REQ-005 v1.3（变体 A）：首页（无项目）没有画布可落 —— 放行冒泡，让宿主
          // 的附件拖放链路自己收口（入库 + 遮罩 reset 一并归宿主管）。
          if (projectId === null) return
          // 截断冒泡：宿主的附件拖放挂在 document 上（非 capture、不分落点），不截断的话
          // 同一批文件还会被它按「对话图片附件」再处理一次 —— 拖视频出「仅支持图片」的
          // 错，拖图片则既落画布又塞进对话草稿。落在这里的文件就该由画布独占。
          event.stopPropagation()
          handleDroppedFiles(Array.from(event.dataTransfer.files))
          // 遮罩卡死根因修复：吞掉 drop 后宿主 document 收不到 drop，其 dragover
          // 建立的上传遮罩永远等不到收口 ⇒ 遮罩常驻。补一发合成 dragend 让宿主
          // reset（宿主的 dragend → reset 不读事件字段；isTrusted 不校验需真机确认）。
          window.dispatchEvent(new Event('dragend'))
        }}
      >
        {/* 2026-08-31：顶部工具栏按组控制显示（TOOLBAR_VISIBILITY，见 CanvasToolbar.tsx）；
            隐藏的组功能全部保留，经节点右键菜单 / 快捷键 / 详情面板触发。 */}
        <CanvasToolbar
          canUndo={historyIndex >= 0}
          canRedo={historyIndex + 1 < historyLength}
          selectedCount={selectedNodeIds.length}
          hasSelection={selectedNodeIds.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onDelete={() => { handleDelete(selectedNodeIds) }}
          onGroup={() => { if (projectId !== null) persistAfter(() => actions.groupSelected(projectId)) }}
          onUngroup={() => {
            if (selectedNode !== null && selectedNode.kind === 'group' && projectId !== null) {
              persistAfter(() => actions.ungroup(projectId, selectedNode.id))
            }
          }}
          onAutoArrange={() => {
            if (projectId === null) return
            // 按制作流程阶段排列画布节点，排完适配视野。
            // CV-244：隐藏态下排布只对可见子集计算——隐藏节点不占槽位（BUG-004）。
            // D-1：辅助卡默认收起，同样不占槽位（layoutOverVisible 口径一致）。
            const restricted = hideRetired || !showAuxiliary
            const ids = restricted ? visibleNodes.map(n => n.id) : undefined
            persistAfter(() => actions.autoArrange(projectId, ids, true,
              restricted ? { layoutOverVisible: true } : undefined))
            fitPendingRef.current = true
            setFitRequestedAt(Date.now())
          }}
          onAddNode={kind => { if (projectId !== null) persistAfter(() => actions.addNode(projectId, kind)) }}
          onUploadFile={async (file) => {
            // CV-241 D3：一个入口，四类自动分发（与拖放共用 handleDroppedFiles 规则）。
            handleDroppedFiles([file])
          }}
          layersOpen={view.layersOpen}
          onToggleLayers={() => { handleViewChange({ layersOpen: !view.layersOpen }) }}
          scale={view.scale}
          onZoomOut={() => { surfaceRef.current?.zoomBy(1 / ZOOM_STEP) }}
          onZoomIn={() => { surfaceRef.current?.zoomBy(ZOOM_STEP) }}
          onFitContent={() => { surfaceRef.current?.fitToContent() }}
          onResetZoom={() => { surfaceRef.current?.resetZoom() }}
          minimapVisible={view.minimapVisible}
          onToggleMinimap={() => { handleViewChange({ minimapVisible: !view.minimapVisible }) }}
          onOpenSkills={() => { setSkillMarketOpen(true) }}
          onOpenLibrary={() => { setLibOpen(true); void refreshLibrary() }}
          onOpenSettings={() => { setSettingsOpen(true) }}
          hideRetired={hideRetired}
          onToggleHideRetired={() => {
            // A-2 步骤三（bug-analysis/A-2.md 热点 3）：开关退化为**纯过滤**。
            // 此前切换即 actions.autoArrange + fit —— 102 节点全部换坐标
            // （autoArrange 全量两遍遍历 + tidyGroupLayout 二次遍历），一次开关
            // = 一次全量布局风暴。现在只翻 hideRetired（visibleNodes 的 useMemo
            // 过滤已有），「重排」收回到工具栏「整理布局」的**显式**路径，那里
            // 的 CV-244 语义原样保留（隐藏态只对可见子集排布、显示态全量归位）。
            // 语义变化（定案见 bug-analysis/A-2.md）：隐藏后留下的空洞不再自动
            // 回收；显示废弃素材后如与重排过的可见节点叠压，点一次「整理布局」
            // 即归位。桌面验收需确认一次观感。
            setHideRetired(!hideRetired)
          }}
          showAuxiliary={showAuxiliary}
          onToggleShowAuxiliary={() => { setShowAuxiliary(!showAuxiliary) }}
          historyOpen={historyOpen}
          onToggleHistory={() => { setHistoryOpen(!historyOpen) }}
        />
        <div className="csWorkflowBar">
          {/* CV-196：开关本体抽到 ModeSwitch（首页创作台那份共用同一实现 —— REQ-005
              后原新建弹窗已删，`choice` variant 随实现整块搬去 ProjectSpecChips ——
              只差 variant 决定的外观）。二次确认留在本组件 —— 首页选模式是
              用户显式在选一切，且项目还没有产物可烧，不需要拦。 */}
          <ModeSwitch
            variant="bar"
            mode={workflow?.mode ?? 'confirm'}
            ariaLabel="执行模式"
            onChange={handleSetMode}
          />
          {/* C1：六段制作轨道。已完成段 = 青点，当前段 = accent 点 + 脉冲；
              有产物的段可点（→ 选中并聚焦该段产物），未来段 disabled ——
              不做「能点但没动作」的假按钮。
              DD-09 修复：**「完成」= 位次在前 且 真有产物**。过去只看位次
              （`i < stage`），于是空段（实测「定妆」永远是 0 产物）也染青点、
              连线也连着，轨道等于在报告一段从没发生过的进度。同理连线只在前
              一段真有产物时才点亮，中间缺段会如实留一个断口。 */}
          <div
            className="csWorkflowStages"
            role="group"
            aria-label="制作阶段"
            title={`制作阶段：${WORKFLOW_STAGE_LABELS[workflowStages.stage]}`
              + `（${workflow?.state === 'awaiting_approval' ? '分镜待批准'
                : workflow?.state === 'script_review' ? '剧本待批准'
                : workflow?.state === 'keyframe_review' ? '关键帧待确认'
                : workflow?.state === 'executing' ? '制作中'
                : '需求沟通中'}）`}
          >
            {WORKFLOW_STAGE_LABELS.map((label, i) => {
              const ids = workflowStages.idsByStage[i] ?? []
              return (
                <Fragment key={label}>
                  {i > 0 && (
                    <span className={'csStageLink' + (i <= workflowStages.stage && (workflowStages.idsByStage[i - 1]?.length ?? 0) > 0 ? ' csStageLinkDone' : '')} />
                  )}
                  <button
                    type="button"
                    className={'csWorkflowStage'
                      + (i === workflowStages.stage ? ' csStageNow' : i < workflowStages.stage && ids.length > 0 ? ' csStageDone' : '')}
                    disabled={ids.length === 0}
                    title={ids.length === 0
                      ? `「${label}」阶段暂无产物`
                      : `定位「${label}」阶段的 ${ids.length} 个产物`}
                    onClick={() => { handleFocusStage(ids) }}
                  >
                    <i />
                    {label}
                  </button>
                </Fragment>
              )
            })}
          </div>
          {/* N4（对齐清单 §8.3）：产出计数 —— 设计稿 wfTime 的对应物。
              只数进了六阶段分桶的**产物**节点（便签 / 提示等手工件不算产出）。
              审批条激活时不渲染：那几档状态条右侧已有一条状态文案，再叠计数是噪音。 */}
          {workflow?.state !== 'script_review' && workflow?.state !== 'awaiting_approval'
            && workflow?.state !== 'keyframe_review' && (
            <span className="csWorkflowTime" title="画布上已产出的制作节点数（便签等手工件不计）">
              已产出 {WORKFLOW_STAGE_LABELS.map((_, i) => workflowStages.idsByStage[i]?.length ?? 0)
                .reduce((sum, n) => sum + n, 0)} 个节点 · 阶段 {WORKFLOW_STAGE_LABELS[workflowStages.stage]}
            </span>
          )}
          {workflow?.state === 'script_review' && (
            <div className="csWorkflowApproval">
              {clapIcon}
              <span className="csWorkflowMessage">剧本已提交到画布，请确认故事方向后批准</span>
              <input
                type="text"
                className="csRejectInput"
                value={rejectFeedback}
                onChange={(event) => { setRejectFeedback(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') handleRejectScreenplay() }}
                placeholder="不满意哪里？（可选，随驳回转给 AI）"
                title="填写具体意见（如：结尾反转太生硬），AI 将按意见重写剧本；留空则只打回"
                maxLength={500}
              />
              <button type="button" className="csPrimary" onClick={handleApproveScreenplay}>批准剧本</button>
              <button type="button" onClick={handleRejectScreenplay}>驳回，继续修改</button>
              <span className="csWorkflowState">批准后进入分镜规划</span>
            </div>
          )}
          {workflow?.state === 'awaiting_approval' && (
            <div className="csWorkflowApproval">
              {clapIcon}
              <span className="csWorkflowMessage">分镜表已提交到画布，请确认后批准</span>
              <input
                type="text"
                className="csRejectInput"
                value={rejectFeedback}
                onChange={(event) => { setRejectFeedback(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') handleReject() }}
                placeholder="不满意哪里？（可选，随驳回转给 AI）"
                title="填写具体意见（如：第 3 镜节奏太快），AI 将按意见重做分镜；留空则只打回"
                maxLength={500}
              />
              <button type="button" className="csPrimary" onClick={handleApprove}>批准并开始制作</button>
              <button type="button" onClick={handleReject}>驳回，继续修改</button>
              <span className="csWorkflowState">批准后自动恢复流程</span>
            </div>
          )}
          {workflow?.state === 'keyframe_review' && (
            <div className="csWorkflowApproval">
              {clapIcon}
              <span className="csWorkflowMessage">关键帧已生成，请确认或二次编辑后点确认</span>
              <input
                type="text"
                className="csRejectInput"
                value={rejectFeedback}
                onChange={(event) => { setRejectFeedback(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') handleRejectKeyframes() }}
                placeholder="不满意哪里？（可选，随打回转给 AI）"
                title="填写具体意见（如：第 2 镜人物走形、整体偏暗），AI 将按意见重出关键帧；留空则只打回"
                maxLength={500}
              />
              <button type="button" className="csPrimary" onClick={handleConfirmKeyframes}>确认关键帧</button>
              <button type="button" onClick={handleRejectKeyframes}>打回重出</button>
              <span className="csWorkflowState">确认后自动继续视频流程；打回则 AI 按意见重出</span>
            </div>
          )}
        </div>
        {/* CV-066：已装载技能 chip 行（仅 work 态且有装载时显示；空态不占位）。 */}
        {mode === 'work' && projectId !== null && activeSkills.length > 0 && (
          <ActiveSkillChips
            skills={activeSkills}
            onRemove={(name) => {
              void deactivateSkill(projectId, name).catch((cause) => {
                actions.setFailed(cause instanceof Error ? cause.message : '技能卸载失败')
              })
            }}
          />
        )}
        {canvasBody}
      </main>
      <aside className="csChat">
        {/* DD-09 / b：收起按钮常驻对话区左上角（贴合画布那一侧），与左栏栏头的
            收起按钮左右对称。宿主 conversation 的头部是它自己的（CSS Modules，
            选不中也改不了），所以按钮走**绝对定位的插件自有元素**，而不是去塞宿主
            头部 —— 那是改 dsh，会破坏无缝升级。
            lobby 态右栏被压到 0px、聊天已挪到中栏，此时收起没有意义，不渲染。 */}
        {!chatCollapsed && mode === 'work' && (
          <button
            type="button"
            className="csChatCollapse"
            title="收起对话区"
            aria-label="收起对话区"
            onClick={() => { setChatCollapsedPersisted(true) }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6.5 4.5 10 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.5 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <section className="csConversation">
          {renderSlot('conversation', {})}
        </section>
        {/* DD-09 / b：收起态换成 56px 竖条。与左栏 RailStrip 同理 —— 这里不用 CSS
            把对话区藏起来就完事，因为 56px 里需要「点回展开」的落点，而且竖条要能
            反映制作进度（六段轨道），否则收起就是一片死白。 */}
        {chatCollapsed && (
          <ChatStrip
            stageIndex={workflowStages.stage}
            onExpand={() => { setChatCollapsedPersisted(false) }}
          />
        )}
        {/* CV-114：素材 chip 的 hover 缩略图（常驻挂载，命中时才出卡）。 */}
        <AssetChipPreview assets={assetHandles} skills={VISIBLE_CATALOG} onOpen={handleOpenAsset} />
      </aside>
      {/* CV-065：lobby / lobby-pending 态中栏第三行 —— 推荐技能横滚（占位在聊天
          卡片下方，聊天仍是视觉中心）。work 态不渲染，第三行 auto 高度塌为 0。 */}
      {mode !== 'work' && (
        <section className="csLobbyTail">
          <header className="csLobbyTailHead">
            <span>推荐技能</span>
            <span className="csLobbyTailHint">点「使用」把提示词填进上面的输入框</span>
          </header>
          <SkillCarousel
            entries={recommendedSkills()}
            onActivate={handleActivateSkill}
            onOpenAll={() => { setSkillMarketOpen(true) }}
          />
        </section>
      )}
      {/* CV-065：全屏技能广场（lobby / work 共用同一覆盖层，盖住三栏）。
          CV-073：work 态传入 activeSkills / onDeactivate，广场内可管理已装载技能。 */}
      {skillMarketOpen && (
        <SkillMarket
          onClose={() => { setSkillMarketOpen(false) }}
          onActivate={handleActivateSkill}
          activeSkills={activeSkills}
          onDeactivate={handleDeactivateSkill}
        />
      )}
      {/* REQ-001：全局资产库全屏页（lobby / work 共用；数据 = store.libraryAssets 缓存）。
          F1 入库对话框也挂在这一层（右键菜单只回调节点 id，表单在此渲染）。 */}
      {libOpen && (
        <AssetLibraryPage
          assets={libraryAssets}
          onClose={() => { setLibOpen(false) }}
          createLibraryAsset={createLibraryAsset}
          updateLibraryAsset={updateLibraryAsset}
          deleteLibraryAsset={deleteLibraryAsset}
          uploadLibraryMedia={uploadLibraryMedia}
          insertLibChip={insertLibChip}
        />
      )}
      {libImportNodeId !== null && projectId !== null && (
        <LibImportDialog
          title="加入资产库"
          requireFile={false}
          onCancel={() => { setLibImportNodeId(null) }}
          onSubmit={async (request) => {
            // 错误 throw 回对话框本地显示（CS-LIB-002 重名等预期错误不炸全局面）。
            await createLibraryAsset({ ...request, anchors: [{ projectId, nodeId: libImportNodeId }] })
          }}
        />
      )}
      {(() => {
        if (playbackNodeId === null) return null
        const target = nodes.find(node => node.id === playbackNodeId)
        if (target === undefined || target.url === undefined) return null
        if (target.kind === 'video') {
          return (
            <VideoPlayerModal
              title={target.title ?? '视频'}
              url={target.url}
              onClose={() => { setPlaybackNodeId(null) }}
            />
          )
        }
        // CV-130：音频节点双击 → 简单播放器窗口（可拖进度 + 完整歌词）。
        if (target.kind === 'audio') {
          return (
            <AudioPlayerModal
              title={target.title ?? '音频'}
              url={target.url}
              {...(target.lyrics !== undefined ? { lyrics: target.lyrics } : {})}
              {...(target.duration !== undefined ? { duration: target.duration } : {})}
              onClose={() => { setPlaybackNodeId(null) }}
            />
          )
        }
        return null
      })()}
      {(() => {
        if (previewNodeId === null) return null
        const target = nodes.find(node => node.id === previewNodeId)
        if (target === undefined || target.kind !== 'image' || target.url === undefined) return null
        return (
          <ImagePreviewModal
            title={target.title ?? '图片'}
            url={target.url}
            onClose={() => { setPreviewNodeId(null) }}
          />
        )
      })()}
      {menu !== null && projectId !== null && (
        <CanvasContextMenu
          ref={menuRef}
          node={menu.node}
          x={menu.x}
          y={menu.y}
          onClose={() => { setMenu(null) }}
          onRename={id => { actions.selectNode(id); setDetailNodeId(id) }}
          onCopy={id => { actions.selectNode(id); actions.copySelected(projectId) }}
          onCopyToClipboard={id => {
            const target = nodes.find(candidate => candidate.id === id)
            if (target !== undefined) handleCopyToClipboard(target)
          }}
          onOpenDetail={id => { actions.selectNode(id); setDetailNodeId(id) }}
          onToggleRetire={handleToggleRetire}
          onSplitVideo={id => { void handleSplitVideo(id) }}
          onDelete={id => { handleDelete([id]) }}
          onReorder={handleReorder}
          onToggleLock={id => { if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id)) }}
          onToggleVisibility={handleToggleVisibility}
          onRetry={handleRetry}
          onEditPrompt={id => { actions.selectNode(id); setPromptEditNodeId(id) }}
          onCancel={() => { void cancelCurrentTurn() }}
          onUngroup={id => { if (projectId !== null) persistAfter(() => actions.ungroup(projectId, id)) }}
          onTidyGroup={id => { if (projectId !== null) persistAfter(() => actions.tidyGroup(projectId, id)) }}
          onReferenceToChat={id => {
            const target = nodes.find(candidate => candidate.id === id)
            if (target !== undefined) handleReferenceToChat(target)
          }}
          selectedIdsForMenu={selectedNodeIds}
          onReferenceSelectedToChat={handleReferenceSelectedToChat}
          onAddToLibrary={id => { setLibImportNodeId(id) }}
          onDownload={id => {
            const target = nodes.find(candidate => candidate.id === id)
            if (target !== undefined) handleDownload(target)
          }}
        />
      )}
      {blankMenu !== null && projectId !== null && (
        <CanvasBlankMenu
          ref={blankMenuRef}
          x={blankMenu.x}
          y={blankMenu.y}
          worldX={blankMenu.worldX}
          worldY={blankMenu.worldY}
          onClose={() => { setBlankMenu(null) }}
          onCreateNode={kind => { persistAfter(() => actions.addNode(projectId, kind, { x: blankMenu.worldX, y: blankMenu.worldY })) }}
          onPaste={() => { persistAfter(() => actions.pasteNodes(projectId)) }}
          onFit={() => { surfaceRef.current?.fitToContent() }}
        />
      )}
      {edgeCreateMenu !== null && projectId !== null && (
        <CanvasEdgeCreateMenu
          ref={edgeCreateMenuRef}
          x={edgeCreateMenu.x}
          y={edgeCreateMenu.y}
          onClose={() => { setEdgeCreateMenu(null) }}
          onCreateNode={kind => {
            persistAfter(() => actions.addNode(projectId, kind, { x: edgeCreateMenu.worldX, y: edgeCreateMenu.worldY }, [edgeCreateMenu.sourceId]))
          }}
        />
      )}
      {/* CV-015：非阻塞 toast 容器（底部居中，自动消失）。 */}
      {toasts.length > 0 && (
        <div className="csToasts" role="status" aria-live="polite">
          {toasts.map(entry => (
            <div key={entry.id} className={`csToast csToast-${entry.kind}`}>{entry.text}</div>
          ))}
        </div>
      )}
      <div className="csOverlay" data-cs-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {settingsOpen && (
        <SettingsModal
          settingsScope={settingsScope}
          getCredentials={getCredentials}
          getModelApi={getModelApi}
          getDirectoryPicker={getDirectoryPicker}
          theme={theme}
          onClose={() => { setSettingsOpen(false) }}
        />
      )}
      {showFirstRun && (
        <FirstRunSettings
          settingsScope={settingsScope}
          getDirectoryPicker={getDirectoryPicker}
          onComplete={() => { setShowFirstRun(false) }}
        />
      )}
      {/* CV-196：放手跑的切换确认。文案必须写清「代价」而不是复述按钮名 ——
          换个说法但不说会发生什么，等于多一次点击、没多一分知情。 */}
      {pendingAutoMode && (
        <ConfirmDialog
          title="切到放手跑？"
          confirmLabel="切到放手跑"
          body={(
            <>
              <p>放手跑下 AI 不再向你提问：剧本、分镜、关键帧都不再等你确认，澄清问题也直接按默认规格取值。</p>
              <p>它会一路做到成片，中途不停。已产出的内容不会被删，但这个过程可能持续十几分钟。</p>
            </>
          )}
          onConfirm={() => { applyWorkflowMode('auto') }}
          onCancel={() => { setPendingAutoMode(false) }}
        />
      )}
      {/* R-P0-12 二增量：断开生成边的确认 —— 文案说清后果（再生成取材变化），
          也说清不变的部分（节点与文件都在），让确认有信息量而不是走过场。 */}
      {pendingUnlink !== null && (
        <ConfirmDialog
          title="断开这条生成连线？"
          confirmLabel="断开连线"
          body={(() => {
            const source = nodesRef.current.find(node => node.id === pendingUnlink.sourceId)
            const target = nodesRef.current.find(node => node.id === pendingUnlink.targetId)
            const sourceTitle = source?.title ?? '来源素材'
            const targetTitle = target?.title ?? '产物节点'
            return (
              <>
                <p>「{sourceTitle}」→「{targetTitle}」这条连线是 {targetTitle} 的生成取材来源。</p>
                <p>断开后，这张卡再重试或再生成时将不再参考「{sourceTitle}」（按剩余连线取材）。节点与文件都保留，只删连线；断开可撤销。</p>
              </>
            )
          })()}
          onConfirm={() => {
            const edge = pendingUnlink
            setPendingUnlink(null)
            if (projectId !== null) persistAfter(() => actions.unlinkNodes(projectId, edge.sourceId, edge.targetId))
          }}
          onCancel={() => { setPendingUnlink(null) }}
        />
      )}
    </div>
  )
}