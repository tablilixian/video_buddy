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
import { CanvasTimeline } from './canvas/CanvasTimeline.js'
import { LayerPanel } from './canvas/LayerPanel.js'
import { NodeDetailDrawer } from './canvas/NodeDetailDrawer.js'
import { VideoPlayerModal } from './canvas/VideoPlayerModal.js'
import { AudioPlayerModal } from './canvas/AudioPlayerModal.js'
import { ImagePreviewModal } from './canvas/ImagePreviewModal.js'
import { CanvasContextMenu } from './canvas/CanvasContextMenu.js'
import { CanvasBlankMenu } from './canvas/CanvasBlankMenu.js'
import { ReferenceTray } from './canvas/ReferenceTray.js'
import { uploadLocalStudioImage, uploadStudioVideo, splitStudioVideo, bytesToBase64, composeStudioVideo } from './api.js'
import type { StudioCanvasNode, StudioCanvasView } from '../contracts/canvas.js'
// CV-220：生成队列投影 → 遮罩文案（与 Host 侧同一份纯函数）。
import { generationQueueNote } from '../queue-view.js'
import { AUDIO_COMPOSITION_LABELS } from '../contracts/canvas.js'
import { deriveTimelineOrder, type FitResult } from '../canvas-view.js'
import { deriveWorkflowStage, WORKFLOW_STAGE_LABELS } from '../workflow-stage.js'
import { resolveComposeSelection, composedSourceIds } from '../compose-selection.js'
import { assetDownloadName, canDownloadNode, shouldKeepMenuOpen } from '../canvas-actions.js'
// CV-198：剪贴板链路。判定/文案在 src 根（可单测），浏览器环境在 client 侧唯一实现。
import { clipboardResultMessage, copyNodeToClipboard, copyTextToClipboard } from '../clipboard-copy.js'
import { clipboardEnv } from './canvas/clipboard-env.js'
import { toggleRetire, isShotClip } from '../shot-versions.js'
import { frameSizeOf, mediaBoxOf } from '../canvas-aspect.js'
import { formatRefToken, uniqueTitle } from '../reference-token.js'
import { buildAssetHandles } from '../reference-handle.js'
import { AssetChipPreview } from './AssetChipPreview.js'
import { BRAND } from '../brand-copy.js'
import { LogoMark } from './brand/LogoMark.js'
import { LobbyHero } from './LobbyHero.js'
import { SlateBar } from './SlateBar.js'
import { SkillCarousel } from './SkillCarousel.js'
import { SkillMarket } from './SkillMarket.js'
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
    renderSlot, useStudio, refreshProjects, createProject, openProject, deleteProject, createSampleProject, persistCanvas,
    retryNode, cancelCurrentTurn, approveStoryboard, rejectStoryboard, confirmKeyframes, rejectKeyframes, approveScreenplay, rejectScreenplay, setWorkflowMode,
    activateSkill, deactivateSkill, actions, runEffectTests,
    createGroup, renameGroup, deleteGroup, moveProjectToGroup,
    settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme, insertAssetChip, insertSkillChip,
  } = props
  const projects = useStudio(store => store.projects)
  // CV-091：用户自定义分组（左侧栏可折叠分组数据源）。
  const groups = useStudio(store => store.groups)
  const selectedProjectId = useStudio(store => store.selectedProjectId)
  const selectedNodeId = useStudio(store => store.selectedNodeId)
  const selectedNodeIds = useStudio(store => store.selectedNodeIds)
  const nodes = useStudio(store => nodesOf(store, store.selectedProjectId))
  const [hideRetired, setHideRetired] = useState(false)
  const visibleNodes = useMemo(
    () => hideRetired ? nodes.filter(n => n.retired !== true && n.supersededBy === undefined) : nodes,
    [nodes, hideRetired])
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
  // hover 缩略图三处共用同一份派生结果。
  const assetHandles = useMemo(() => buildAssetHandles(nodes), [nodes])
  // hover 卡片点击：复用已有的大图 / 播放器浮层（不新造播放器）。
  const handleOpenAsset = useCallback((nodeId: string): void => {
    const node = nodesRef.current.find(entry => entry.id === nodeId)
    if (node === undefined) return
    // CV-130：音频也走播放浮层（hover 卡片点击 → 播放器窗口，而不是图片预览）。
    if (node.kind === 'video' || node.kind === 'audio') setPlaybackNodeId(node.id)
    else setPreviewNodeId(node.id)
  }, [])
  const selectedNode = useStudio(store => selectedNodeOf(store))
  const phase = useStudio(store => store.phase)
  const error = useStudio(store => store.error)
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
  // CV-044：视频固定尺寸播放浮层（双击视频节点打开）。
  const [playbackNodeId, setPlaybackNodeId] = useState<string | null>(null)
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null)
  // 设置弹窗开合状态：主页画布上的「设置」按钮 → 弹出设置界面。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 首启设置页：localStorage 未置 onboarded 时首次进入挂载；做出选择后置 flag 收尾。
  const [showFirstRun, setShowFirstRun] = useState<boolean>(() => !isCanvasStudioOnboarded())
  // 品牌欢迎屏「新建项目」按钮与左侧栏新建表单联动（受控打开状态）。
  const [projectFormOpen, setProjectFormOpen] = useState(false)
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
   * 只来自三条显式入口 —— 节点双击 / 右键「查看详情」「修改提示词」/ 就近工具条。
   * 抽屉的渲染与工具条的避让高度共用这一个判据，两边不会各说各话。
   */
  const detailOpen = selectedNode !== null && selectedNode.id === detailNodeId

  // 首次挂载即拉取项目列表，无需手动点「刷新」。
  useEffect(() => { void refreshProjects() }, [refreshProjects])
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
        .filter((node) => node.retired !== true && node.supersededBy === undefined)
        .map((node) => node.id)
      // ① 整理 —— `recordHistory = false`：系统自动动作**不占撤销栈**，否则用户按
      //    Ctrl+Z 撤销的是「整理」而不是他自己上一个操作。
      persistAfter(() => { actions.autoArrange(activeProjectId, visible, false) })
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
  const probeImageDisplay = async (buffer: ArrayBuffer): Promise<{ display: { width: number; height: number }; mediaWidth: number; mediaHeight: number } | null> => {
    try {
      const bitmap = await createImageBitmap(new Blob([buffer]))
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
  // P8.1：本地图片上传入口（工具条按钮）。读取用户选择的图片 → base64 →
  // Host 落地并上传 Drama 拿 filename → 画布新增 import 素材节点。
  const handleUploadImage = async (file: File): Promise<void> => {
    if (projectId === null) return
    // 直接走 ArrayBuffer：file.text() 会按 UTF-8 解码二进制，把 0x80–0xFF
    // 字节替换成 U+FFFD，导致 PNG/JPEG 头部字节被破坏（验收已复现）。
    const buffer = await file.arrayBuffer()
    const dataBase64 = bytesToBase64(new Uint8Array(buffer))
    try {
      // P8.1：上传同时拿回同源 url 与 Drama filename；filename 落节点，使参考
      // 托盘 / list_references 能直接把它交给生成工具，免去运行时再上传。
      const { url, filename } = await uploadLocalStudioImage(projectId, file.name, dataBase64)
      const probe = await probeImageDisplay(buffer)
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
        filename,
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
   * 2026-09-22：上传本地音频。与图片上传共用同一条链路（`uploadLocalStudioImage`
   * 只是"落盘 + 拿 Drama filename 句柄"，并不校验图片类型），差别只在落卡走
   * `addAudioNode`（kind: 'audio' —— 音频节点的框是窄条，与图片框不同）。
   */
  const handleUploadAudio = async (file: File): Promise<void> => {
    if (projectId === null) return
    const buffer = await file.arrayBuffer()
    const dataBase64 = bytesToBase64(new Uint8Array(buffer))
    try {
      const { url, filename } = await uploadLocalStudioImage(projectId, file.name, dataBase64)
      const usedTitles = new Set<string>()
      for (const node of nodes) {
        if (node.title !== undefined && node.title !== '') usedTitles.add(node.title)
      }
      persistAfter(() => actions.addAudioNode(
        projectId,
        url,
        uniqueTitle(file.name, usedTitles),
        filename,
      ))
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error('音频上传失败')
    }
  }
  // P8.4：参考视频上传入口。原始字节流交给 Host 抽帧提风格；成功后帧图 +
  // 风格归纳 sticky 由客户端一次快照落画布并持久化。
  const handleUploadVideo = async (file: File): Promise<void> => {
    if (projectId === null) return
    // 输入框上方那张首帧卡片的三段状态（内存态）。objectURL 给「上传中」画首帧
    // （本地文件，秒出；内容与随后落盘的同源 url 相同），组件卸载时回收。
    const uploadId = `upload-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
    actions.beginVideoUpload(projectId, {
      id: uploadId,
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
      }))
      actions.settleVideoUpload(projectId, uploadId, {
        url: payload.videoUrl,
        ...(payload.duration > 0 ? { duration: payload.duration } : {}),
      })
    } catch (cause) {
      actions.failVideoUpload(projectId, uploadId, cause instanceof Error ? cause.message : String(cause))
      throw cause instanceof Error ? cause : new Error('参考视频上传失败')
    }
  }
  /**
   * 拖入文件的**唯一分发**：视频优先（→ 视频节点），其次图片（→ 素材节点）。
   *
   * 画布区内的 drop 与「全局视频接管」（下面那个 effect）共用这一份 —— 两处各写一套
   * 「取哪个文件」的规则迟早分叉（本仓铁律：同一规则只准一份实现）。
   */
  const handleDroppedFiles = (files: readonly File[]): void => {
    const video = files.find(item => item.type.startsWith('video/'))
    const image = files.find(item => item.type.startsWith('image/'))
    if (video === undefined && image === undefined) return
    void (async () => {
      try {
        if (video !== undefined) {
          // 进行中 / 成功 / 失败由输入框上方那张首帧卡片承载（VideoUploadBar）——
          // 上传已经是纯本地操作（落盘 + 探时长），不再需要一条"正在上传…"的 toast
          // 顶着等待；只有**失败**仍出 toast（卡片容易被忽视，错误要显眼）。
          await handleUploadVideo(video)
        } else if (image !== undefined) {
          await handleUploadImage(image)
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        pushToast(video !== undefined ? `视频上传失败：${message}` : `图片上传失败：${message}`, 'error')
      }
    })()
  }
  const droppedFilesRef = useRef(handleDroppedFiles)
  droppedFilesRef.current = handleDroppedFiles

  /**
   * 视频文件的**全局拖放接管**（2026-09-22）。
   *
   * 宿主把附件拖放挂在 `document` 上、**非 capture 且不区分落点**（`ui-attachment` 的
   * ComposerAttachments：document 的 dragenter / dragover / dragleave / drop）。由此
   * 产生两个症状，都是本 effect 要治的：
   * ① 视频在**任意位置**松手都会撞上宿主那条图片校验 → 弹「仅支持 PNG、JPG、WebP、
   *    GIF 格式的图片」。拖到输入框上时，用户唯一能得到的结果就是这个错。
   * ② 拖到画布上时，画布 onDrop 与宿主的 document 监听**都会跑** —— 素材已经落进画布，
   *    错误提示却照弹（同一批文件被两条链路各自处理了一次）。
   *
   * 处置：在 **capture 阶段**接管「含视频」的文件拖放，`stopPropagation` 让宿主的
   * document 监听与 React 合成事件都收不到，再走画布自己的上传链路。
   * **只拦视频**：图片仍按原样分派（拖进画布 = 落素材节点；拖到别处 = 宿主把它加进对话
   * 附件 —— 那是宿主既有能力，本插件不该覆盖）。
   *
   * dragenter / dragover 一并拦，是为压掉宿主那张「松手添加图片」的整屏遮罩：它对视频
   * 的措辞是错的。代价是视频拖放期间没有「可放下」的视觉反馈，由松手后立刻出现的进行中
   * 提示（`handleDroppedFiles` 的第一条 toast）兜住这段空档。
   */
  useEffect(() => {
    if (projectId === null) return
    // dragenter / dragover 阶段读不到文件内容，只能看 items 声明的类型；类型读不到就留给
    // drop 判定（此时宿主遮罩会闪一下，但文件仍会被正确接管）。
    const declaresVideo = (dataTransfer: DataTransfer | null): boolean => {
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return false
      return Array.from(dataTransfer.items).some(item =>
        item.kind === 'file' && item.type.startsWith('video/'))
    }
    const swallow = (event: DragEvent): void => {
      if (!declaresVideo(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer === null ? [] : Array.from(event.dataTransfer.files)
      if (!files.some(file => file.type.startsWith('video/'))) return
      event.preventDefault()
      event.stopPropagation()
      droppedFilesRef.current(files)
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
      pushToast(`视频拆分失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error')
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
    persistAfter(() => actions.removeNodes(projectId, ids))
    setDetailNodeId(null)
  }, [projectId, actions, persistAfter])
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
  const handleReferenceToChat = (node: StudioCanvasNode): void => {
    // CV-114：优先插成输入框里的真 chip（与打 @ 选中候选同一产物，带文件图标、
    // 独立可删、hover 可出缩略图）。不可用时降级为纯文本 @ref 注入。
    if (insertAssetChip(node.id)) return
    let token: string
    try {
      // 降级句柄用 node id（CV-114：id 唯一稳定，Host 侧另有标题兜底匹配）。
      token = formatRefToken(node.id)
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '无法生成引用标记')
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
  /**
   * CV-196：新建弹窗里模式 chip 的初始值 = 设置页「默认执行模式」。
   *
   * 在**打开弹窗那一刻**读一次，而不是订阅：弹窗开着的时候去改设置不是用户会做的
   * 事，而订阅会把 `settingsScope` 的快照订阅面再扩一处（`useScope` 目前只长在
   * 设置面板里）。读不到（作用域未就绪 / 冷启动）就按 schema 默认 confirm，与
   * `WORKFLOW_DEFAULT` 同值。
   *
   * 这同时把设置页那项的意义收窄成「新建项目的默认值」—— 它本来就是 registry 在
   * `create` 时的回落值，现在弹窗把它**显式**摊给用户看，两边不再各说各话。
   */
  const readDefaultCreateMode = (): 'confirm' | 'auto' => {
    try {
      const value = settingsScope
        .bind<CanvasStudioConfig>({ namespace: 'canvas-studio' })
        .getSnapshot().value?.workflowMode
      return value === 'auto' ? 'auto' : 'confirm'
    } catch {
      return 'confirm'
    }
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
      const message = cause instanceof Error ? cause.message : String(cause)
      pushToast(`成片合成失败：${message}`, 'error')
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

  const canvasBody = ((): React.ReactNode => {
    if (projectId === null) {
      // Lobby 态（CV-064）：无任何项目 → 中栏顶部显示品牌条 + 双 CTA，聊天由
      // CSS grid 重排到品牌条下方居中（见 styles.ts 的 data-mode="lobby" 段）。
      // 原先整屏的欢迎屏组件在这里过大，会把聊天挤没（StudioEmptyState 已移除，
      // lobby 态改用 LobbyHero 横向紧凑品牌条）。
      return (
        <LobbyHero
          creating={creating}
          onCreate={() => setProjectFormOpen(true)}
          onCreateSample={() => { void createSampleProject() }}
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
            // 「改提示词」与「查看详情」是同一个动作（开抽屉）—— 抽屉右栏首屏就是
            // 提示词编辑器，不为一个更短的路径造第二套入口。
            onEditPrompt={handleNodeOpenDetail}
            onNodeReferenceToChat={handleReferenceToChat}
            // 抽屉压在画布下缘：工具条必须知道它占了多少，才不会被它盖住。
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
              <LogoMark size={22} />
              <div className="csBrandMeta">
                <span className="csBrandName">{BRAND.name}</span>
                <span className="csBrandSub">{BRAND.nameZh}</span>
              </div>
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
                creating={creating}
                createOpen={projectFormOpen}
                onCreateOpenChange={setProjectFormOpen}
                onRefresh={() => void refreshProjects()}
                onCreate={createProject}
                getDefaultMode={readDefaultCreateMode}
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
          // 截断冒泡：宿主的附件拖放挂在 document 上（非 capture、不分落点），不截断的话
          // 同一批文件还会被它按「对话图片附件」再处理一次 —— 拖视频出「仅支持图片」的
          // 错，拖图片则既落画布又塞进对话草稿。落在这里的文件就该由画布独占。
          event.stopPropagation()
          handleDroppedFiles(Array.from(event.dataTransfer.files))
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
            const ids = hideRetired ? visibleNodes.map(n => n.id) : undefined
            persistAfter(() => actions.autoArrange(projectId, ids))
            fitPendingRef.current = true
            setFitRequestedAt(Date.now())
          }}
          onAddNode={kind => { if (projectId !== null) persistAfter(() => actions.addNode(projectId, kind)) }}
          onUploadImage={async (file) => {
            try {
              await handleUploadImage(file)
            } catch (cause) {
              // CV-015：上传失败不影响画布；toast 非阻塞提示。
              pushToast(`图片上传失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error')
            }
          }}
          onUploadVideo={async (file) => {
            try {
              await handleUploadVideo(file)
            } catch (cause) {
              pushToast(`参考视频上传失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error')
            }
          }}
          onUploadAudio={async (file) => {
            try {
              await handleUploadAudio(file)
            } catch (cause) {
              pushToast(`音频上传失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error')
            }
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
          onOpenSettings={() => { setSettingsOpen(true) }}
          hideRetired={hideRetired}
          onToggleHideRetired={() => {
            const next = !hideRetired
            setHideRetired(next)
            if (next && projectId !== null) {
              const ids = nodes.filter(n => n.retired !== true && n.supersededBy === undefined).map(n => n.id)
              persistAfter(() => actions.autoArrange(projectId, ids))
              fitPendingRef.current = true
              setFitRequestedAt(Date.now())
            }
          }}
        />
        <div className="csWorkflowBar">
          {/* CV-196：开关本体抽到 ModeSwitch（新建项目弹窗里那份共用同一实现，
              只差 variant 决定的外观）。二次确认留在本组件 —— 弹窗里选模式是
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
          onEditPrompt={id => { actions.selectNode(id); setDetailNodeId(id) }}
          onCancel={() => { void cancelCurrentTurn() }}
          onUngroup={id => { if (projectId !== null) persistAfter(() => actions.ungroup(projectId, id)) }}
          onTidyGroup={id => { if (projectId !== null) persistAfter(() => actions.tidyGroup(projectId, id)) }}
          onReferenceToChat={id => {
            const target = nodes.find(candidate => candidate.id === id)
            if (target !== undefined) handleReferenceToChat(target)
          }}
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
    </div>
  )
}