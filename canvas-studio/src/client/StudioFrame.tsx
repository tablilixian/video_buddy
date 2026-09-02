import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioProjectListInjected } from './contracts.js'
import { nodesOf, selectedNodeOf, viewOf, newNodeId, activeSkillsOf, hasConversationOf } from './project-store.js'
import { ProjectList } from './ProjectList.js'
import { SettingsModal } from './SettingsModal.js'
// 2026-08-31：画布顶部工具栏按组做入口可见性控制（功能全部保留）——哪些组显示由
// CanvasToolbar 内部的 TOOLBAR_VISIBILITY 常量决定，见 canvas/CanvasToolbar.tsx。
import { CanvasToolbar } from './canvas/CanvasToolbar.js'
import { CanvasSurface, type CanvasSurfaceHandle } from './canvas/CanvasSurface.js'
import { CanvasTimeline } from './canvas/CanvasTimeline.js'
import { LayerPanel } from './canvas/LayerPanel.js'
import { LayerDetailPanel } from './canvas/LayerDetailPanel.js'
import { VideoPlayerModal } from './canvas/VideoPlayerModal.js'
import { ImagePreviewModal } from './canvas/ImagePreviewModal.js'
import { CanvasContextMenu } from './canvas/CanvasContextMenu.js'
import { CanvasBlankMenu } from './canvas/CanvasBlankMenu.js'
import { ReferenceTray } from './canvas/ReferenceTray.js'
import { uploadLocalStudioImage, uploadStudioVideo, bytesToBase64, composeStudioVideo } from './api.js'
import type { StudioCanvasNode, StudioCanvasView } from '../contracts/canvas.js'
import { deriveTimelineOrder } from '../canvas-view.js'
import { assetDownloadName, canDownloadNode, shouldKeepMenuOpen } from '../canvas-actions.js'
import { previewSizeOf } from '../canvas-aspect.js'
import { formatRefToken } from '../reference-token.js'
import { BRAND } from '../brand-copy.js'
import { LogoMark } from './brand/LogoMark.js'
import { LobbyHero } from './LobbyHero.js'
import { SkillCarousel } from './SkillCarousel.js'
import { SkillMarket } from './SkillMarket.js'
import { ActiveSkillChips } from './ActiveSkillChips.js'
import { CanvasEmptyHint } from './brand/States.js'
// CV-065：技能广场元数据（featured / 分类 / 图标 / 色相）。放 src/ 根目录是
// 为了单测能直连编译产物（Host tsconfig 排除 src/client/**）。
import { recommendedSkills } from '../skill-catalog.js'
import type { SkillCatalogEntry } from '../skill-catalog.js'
// 2026-08-31：画布顶部工具栏入口暂隐藏（CanvasToolbar 组件保留，恢复时
// 在下方 JSX 注释块处取消注释）。功能（撤销/重做/添加节点/上传/自动布局/
// 缩放/图层面板/小地图等）经节点右键菜单、快捷键、未来入口触发。
// 见 canvas-studio/docs/canvas-studio-handoff.md §10 ⑪。

// Zoom step for the toolbar +/− buttons (matches the surface wheel step).
const ZOOM_STEP = 1.2
/** Debounce for viewport saves (pan/zoom fire per frame; disk saves must not). */
const VIEW_SAVE_DEBOUNCE_MS = 400
/** CV-015：toast 自动消失时长（错误比普通提示停留更久）。 */
const TOAST_MS = { info: 3500, success: 3500, error: 6000 } as const

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
    retryNode, steerNode, cancelCurrentTurn, approveStoryboard, rejectStoryboard, confirmKeyframes, setWorkflowMode,
    activateSkill, deactivateSkill, actions, runEffectTests,
    settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme,
  } = props
  const projects = useStudio(store => store.projects)
  const selectedProjectId = useStudio(store => store.selectedProjectId)
  const selectedNodeId = useStudio(store => store.selectedNodeId)
  const selectedNodeIds = useStudio(store => store.selectedNodeIds)
  const nodes = useStudio(store => nodesOf(store, store.selectedProjectId))
  // 参考托盘数据源：所有标记为参考图的图片节点。
  const referenceNodes = nodes.filter(node => node.isReference === true && node.kind === 'image')
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
  // CV-066：当前项目已装载的 skill（work 态顶部 chip 数据源）。
  const activeSkills = useStudio(store => activeSkillsOf(store, store.selectedProjectId))
  // CV-064 二期：当前项目是否已有对话（会话 blank 翻转自动更新 → 发首条消息
  // 即切 work，无需等 agent 响应）。
  const hasConversation = useStudio(store => hasConversationOf(store, store.selectedProjectId))
  // 一键效果测试：编排进度（ProjectList 展示）。
  const effectTest = useStudio(store => store.effectTest)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  // CV-030：详情面板记录目标节点 id（而非布尔开关）——否则打开后单击任何
  // 其它节点，面板会直接切到新选中节点（单击即开详情，与双击语义冲突）。
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null)
  // CV-044：视频固定尺寸播放浮层（双击视频节点打开）。
  const [playbackNodeId, setPlaybackNodeId] = useState<string | null>(null)
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null)
  // 设置弹窗开合状态：主页画布上的「设置」按钮 → 弹出设置界面。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 品牌欢迎屏「新建项目」按钮与左侧栏新建表单联动（受控打开状态）。
  const [projectFormOpen, setProjectFormOpen] = useState(false)
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
  // 整理布局后等新坐标渲染完成再适配视野（imperative fit 读的是渲染后的节点表）。
  const [fitRequestedAt, setFitRequestedAt] = useState(0)
  // P9.3：成片合成进行中标记（禁用按钮 + 文案「合成中…」）。
  const [composeBusy, setComposeBusy] = useState(false)
  // R1（G1）：驳回分镜时附带的不满意意见（可选）——随驳回消息定向转述给 agent。
  const [rejectFeedback, setRejectFeedback] = useState('')
  // CV-065：全屏技能广场开合（lobby 横滚「浏览全部」/ work 态工具栏「技能」进入）。
  const [skillMarketOpen, setSkillMarketOpen] = useState(false)

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
  useEffect(() => {
    if (menu === null) return
    const close = (): void => { setMenu(null) }
    const onMouseDown = (event: MouseEvent): void => {
      if (shouldKeepMenuOpen(event.target, menuRef.current)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  // CV-016：空白处菜单的关闭语义与节点菜单完全一致（mousedown 命中内部放行 + Escape）。
  useEffect(() => {
    if (blankMenu === null) return
    const close = (): void => { setBlankMenu(null) }
    const onMouseDown = (event: MouseEvent): void => {
      if (shouldKeepMenuOpen(event.target, blankMenuRef.current)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
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
  // 无持久化视图的旧项目：节点首次就绪后自动适配一次视野。
  useEffect(() => {
    if (projectId === null || viewEntry.saved || nodes.length === 0) return
    if (fittedProjectRef.current === projectId) return
    fittedProjectRef.current = projectId
    surfaceRef.current?.fitToContent()
  }, [projectId, viewEntry.saved, nodes])
  // 整理布局后的适配：等 nodes 新坐标渲染进 surface 再执行。
  useEffect(() => {
    if (fitRequestedAt === 0) return
    if (!fitPendingRef.current) return
    fitPendingRef.current = false
    surfaceRef.current?.fitToContent()
  }, [fitRequestedAt, nodes])
  const beginEdit = (): void => {
    if (projectId !== null) actions.pushHistory(projectId)
  }
  const persist = (): void => {
    if (projectId !== null) void persistCanvas(projectId).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '画布保存失败')
    })
  }
  const persistAfter = (mutate: () => void): void => {
    mutate()
    persist()
  }
  // CV-029（用户修订）：长边固定 480，短边按真实比例缩放（与生成节点预览
  // 尺寸、媒体加载校正规则统一 —— 统一实现见 src/canvas-aspect.ts 的 previewSizeOf）。
  // 上传落卡前探测图片真实宽高（解码失败返回 null，回退默认尺寸并由媒体
  // 加载校正兜底），真实分辨率同时入 mediaWidth/mediaHeight（详情面板展示）。
  const probeImageDisplay = async (buffer: ArrayBuffer): Promise<{ display: { width: number; height: number }; mediaWidth: number; mediaHeight: number } | null> => {
    try {
      const bitmap = await createImageBitmap(new Blob([buffer]))
      const result = {
        display: previewSizeOf({ width: bitmap.width, height: bitmap.height }),
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
      persistAfter(() => actions.addImportNode(
        projectId,
        url,
        file.name || '本地素材',
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
  // P8.4：参考视频上传入口。原始字节流交给 Host 抽帧提风格；成功后帧图 +
  // 风格归纳 sticky 由客户端一次快照落画布并持久化。
  const handleUploadVideo = async (file: File): Promise<void> => {
    if (projectId === null) return
    try {
      const payload = await uploadStudioVideo(projectId, file)
      persistAfter(() => actions.addVideoStyleNodes(projectId, { ...payload, name: file.name }))
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error('参考视频处理失败')
    }
  }
  // 视口/面板状态：store 即时合并（画布受控渲染），磁盘保存防抖合并。
  const handleViewChange = (patch: Partial<StudioCanvasView>): void => {
    if (projectId === null) return
    actions.setView(projectId, patch)
    if (viewSaveTimer.current !== null) clearTimeout(viewSaveTimer.current)
    viewSaveTimer.current = setTimeout(() => {
      viewSaveTimer.current = null
      persist()
    }, VIEW_SAVE_DEBOUNCE_MS)
  }
  const handleDelete = (ids: string[]): void => {
    if (projectId === null || ids.length === 0) return
    persistAfter(() => actions.removeNodes(projectId, ids))
    setDetailNodeId(null)
  }
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
  const handleUndo = (): void => {
    persistAfter(() => actions.undo())
  }
  const handleRedo = (): void => {
    persistAfter(() => actions.redo())
  }
  const handleRename = (id: string, title: string): void => {
    if (projectId === null) return
    persistAfter(() => actions.renameNode(projectId, id, title))
  }
  // P9 参考托盘：节点字段更新（角色/强度/标记）走 updateNode 并持久化。
  const handleUpdateNode = (id: string, updates: Partial<StudioCanvasNode>): void => {
    if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, updates))
  }
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
    const token = formatRefToken(node.title ?? node.id)
    const input = document.querySelector(
      '.csConversation textarea, .csConversation [contenteditable="true"], .csConversation input[type="text"]',
    )
    if (input instanceof HTMLElement && insertReferenceToken(input, token)) return
    void navigator.clipboard?.writeText(token).catch(() => {})
    pushToast(`已复制引用标记：${token}\n在右侧聊天框粘贴，并补充说明（如「用这张角色图生成分镜」）。`)
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
    const token = `使用技能「${entry.title}」（${entry.name}）：`
    const input = document.querySelector(
      '.csConversation textarea, .csConversation [contenteditable="true"], .csConversation input[type="text"]',
    )
    if (input instanceof HTMLElement && insertReferenceToken(input, token)) {
      pushToast(`已填入技能提示词：${entry.title}。补充说明后发送，agent 会加载该技能。`)
    } else {
      void navigator.clipboard?.writeText(token).catch(() => {})
      pushToast(`已复制技能提示词：${token}\n粘贴到聊天框并补充说明后发送。`)
    }
    if (projectId !== null) {
      void activateSkill(projectId, entry.name).catch((cause) => {
        actions.setFailed(cause instanceof Error ? cause.message : '技能装载失败')
      })
    }
  }
  const handleRetry = (id: string): void => {
    if (projectId === null) return
    void retryNode(projectId, id).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '重试失败')
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
  const handleSteer = (id: string, prompt: string): void => {
    if (projectId === null) return
    void steerNode(projectId, id, prompt).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '重新生成失败')
    })
  }
  const handleTimelineSelect = (id: string): void => {
    actions.selectNode(id)
    setFocusNodeId(id)
    setDetailNodeId(null)
  }
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
  const handleSetMode = (mode: 'confirm' | 'auto'): void => {
    if (projectId !== null) void setWorkflowMode(projectId, mode).catch((cause) => {
      actions.setFailed(cause instanceof Error ? cause.message : '模式切换失败')
    })
  }

  // P9.1：时间轴有效顺序（持久化 timeline → 过滤已删节点 → 新节点按 createdAt 补齐）。
  const timelineOrder = deriveTimelineOrder(nodes, view.timeline)
  const handleTimelineReorder = (ids: string[]): void => {
    handleViewChange({ timeline: ids })
  }
  // P9.3：一键导出成片。取时间轴上 kind=video 的片段（按当前顺序）作为 clipIds，
  // 调 Host 合成路由，成功回写画布 video-composite 节点；BGM 第一版从简（无选择器）。
  const handleComposeExport = async (): Promise<void> => {
    if (projectId === null || composeBusy) return
    const clipIds = timelineOrder.filter(node => node.kind === 'video').map(node => node.id)
    if (clipIds.length < 2) {
      pushToast('请先在时间轴上排列至少 2 个视频片段，再导出成片', 'error')
      return
    }
    setComposeBusy(true)
    try {
      const { url, duration, width, height } = await composeStudioVideo(projectId, clipIds)
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
        sourceIds: clipIds,
      }))
      // F1：成片回写后自动居中并适配视野，确保用户立刻在画布上看到，无需手动寻找。
      setFocusNodeId(composedId)
      fitPendingRef.current = true
      setFitRequestedAt(Date.now())
      pushToast(`成片已生成（${duration.toFixed(1)}s），已添加到画布并自动定位到视图中心，可在时间轴或画布播放。`, 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      pushToast(`成片合成失败：${message}`, 'error')
    } finally {
      setComposeBusy(false)
    }
  }

  const canvasBody = ((): React.ReactNode => {
    if (projectId === null) {
      // Lobby 态（CV-064）：无任何项目 → 中栏顶部显示品牌条 + 双 CTA，聊天由
      // CSS grid 重排到品牌条下方居中（见 styles.ts 的 data-mode="lobby" 段）。
      // 原先整屏的 StudioEmptyState 欢迎卡在这里过大，会把聊天挤没。
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
    if (!hasConversation) return null
    return (
      <>
        <div className="csCanvasBody">
          <CanvasSurface
            nodes={nodes}
            view={view}
            onViewChange={handleViewChange}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={selectedNodeIds}
            onSelectNode={(id, multi) => { actions.selectNode(id, multi) }}
            onSelectAllNodes={() => { actions.selectAllNodes() }}
            onMoveNode={(id, x, y) => { actions.moveNode(projectId, id, x, y) }}
            onUpdateNode={(id, updates) => { actions.updateNode(projectId, id, updates) }}
            onBeginEdit={beginEdit}
            onPersist={persist}
            onRemoveNodes={handleDelete}
            onCopy={() => { actions.copySelected(projectId) }}
            onPaste={() => { persistAfter(() => actions.pasteNodes(projectId)) }}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onLinkLayers={(sourceIds, targetId) => { persistAfter(() => actions.linkLayers(projectId, sourceIds, targetId)) }}
            onRename={handleRename}
            onNodeTextSubmit={(id, text) => { if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, { text })) }}
            onNodeOpenDetail={(node) => { actions.selectNode(node.id); setDetailNodeId(node.id) }}
            onNodeOpenPlayback={(node) => { actions.selectNode(node.id); setPlaybackNodeId(node.id) }}
            onNodeOpenPreview={(node) => { actions.selectNode(node.id); setPreviewNodeId(node.id) }}
            onContextMenu={(node, x, y) => { setBlankMenu(null); setMenu({ node, x, y }) }}
            onBlankContextMenu={(x, y, worldX, worldY) => { setMenu(null); setBlankMenu({ x, y, worldX, worldY }) }}
            onRetry={handleRetry}
            onMediaNatural={(id, naturalWidth, naturalHeight) => {
              // CV-013：分辨率缺失时回填真实宽高（详情面板「分辨率」显示）；
              // CV-029：框比例偏差 >5% 时按长边 480 规则校正（锁定节点只回填
              // 分辨率、不动框）。修正后各条件不再满足，不会循环触发。
              if (projectId === null || naturalWidth <= 0) return
              const target = nodes.find((node) => node.id === id)
              if (target === undefined) return
              const updates: Partial<StudioCanvasNode> = {}
              if (target.mediaWidth === undefined) {
                updates.mediaWidth = naturalWidth
                updates.mediaHeight = naturalHeight
              }
              if (!target.locked) {
                const mediaAspect = naturalWidth / naturalHeight
                const boxAspect = target.width / target.height
                if (Math.abs(boxAspect - mediaAspect) / mediaAspect > 0.05) {
                  // 框比例偏差 >5%：按长边 480 规则重算（与写盘路径同一函数，
                  // 避免与 canvas-aspect 的 1:1/地板规则漂移）。
                  const display = previewSizeOf({ width: naturalWidth, height: naturalHeight })
                  updates.width = display.width
                  updates.height = display.height
                }
              }
              if (Object.keys(updates).length === 0) return
              persistAfter(() => actions.updateNode(projectId, id, updates))
            }}
            focusNodeId={focusNodeId}
            ref={surfaceRef}
            minimapVisible={view.minimapVisible}
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
                onDelete={handleDelete}
                onToggleLock={id => { if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id)) }}
                onToggleVisibility={handleToggleVisibility}
                onReorder={handleReorder}
              />
            </aside>
          )}
        </div>
        <CanvasTimeline
          ordered={timelineOrder}
          selectedNodeId={selectedNodeId}
          onSelect={handleTimelineSelect}
          onReorder={handleTimelineReorder}
          onCompose={handleComposeExport}
          composeBusy={composeBusy}
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
    <div className="csFrame" data-mode={mode}>
      <aside className="csProjects">
        <div className="csBrandHeader">
          <LogoMark size={22} />
          <div className="csBrandMeta">
            <span className="csBrandName">{BRAND.name}</span>
            <span className="csBrandSub">{BRAND.nameZh}</span>
          </div>
        </div>
        <header className="csProjectsHeader">
          <span>项目</span>
          <button type="button" disabled={phase === 'loading' || creating} onClick={() => void refreshProjects()}>
            刷新
          </button>
        </header>
        <ProjectList
          projects={projects}
          selectedProjectId={selectedProjectId}
          phase={phase}
          error={error}
          creating={creating}
          createOpen={projectFormOpen}
          onCreateOpenChange={setProjectFormOpen}
          onRefresh={() => void refreshProjects()}
          onCreate={createProject}
          onOpen={openProject}
          onDelete={deleteProject}
          onOpenSettings={() => { setSettingsOpen(true) }}
          effectTest={effectTest}
          onRunEffectTests={(round, cases) => { void runEffectTests(round, cases) }}
        />
      </aside>
      <main
        className="csCanvas"
        onDragOver={(event) => {
          // P8.1：允许把本地图片拖到画布区域，松手即上传落素材节点。
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          const files = Array.from(event.dataTransfer.files)
          // P8.4：视频文件优先（拖参考视频 = 抽帧提风格），其次按图片上传。
          const video = files.find(item => item.type.startsWith('video/'))
          const image = files.find(item => item.type.startsWith('image/'))
          if (video === undefined && image === undefined) return
          void (async () => {
            try {
              if (video !== undefined) await handleUploadVideo(video)
              else if (image !== undefined) await handleUploadImage(image)
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : String(cause)
              pushToast(video !== undefined ? `参考视频处理失败：${message}` : `图片上传失败：${message}`, 'error')
            }
          })()
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
            persistAfter(() => actions.autoArrange(projectId))
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
              pushToast(`参考视频处理失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error')
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
        />
        <div className="csWorkflowBar">
          <div className="csWorkflowMode" role="group" aria-label="执行模式">
            <button
              type="button"
              className={workflow?.mode !== 'auto' ? 'csActive' : ''}
              disabled={workflow?.mode !== 'auto'}
              title={workflow?.mode !== 'auto' ? '当前已是逐步确认模式' : undefined}
              onClick={() => { handleSetMode('confirm') }}
            >
              逐步确认
            </button>
            <button
              type="button"
              className={workflow?.mode === 'auto' ? 'csActive' : ''}
              disabled={workflow?.mode === 'auto'}
              title={workflow?.mode === 'auto' ? '当前已是放手跑模式' : undefined}
              onClick={() => { handleSetMode('auto') }}
            >
              放手跑
            </button>
          </div>
          <span className="csWorkflowState">
            {workflow?.state === 'awaiting_approval' ? '等待批准'
              : workflow?.state === 'keyframe_review' ? '关键帧待确认'
              : workflow?.state === 'executing' ? '制作中'
              : '需求沟通中'}
          </span>
          {workflow?.state === 'awaiting_approval' && (
            <div className="csWorkflowApproval">
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
              <span className="csWorkflowMessage">关键帧已生成，请确认或二次编辑后点确认</span>
              <button type="button" className="csPrimary" onClick={handleConfirmKeyframes}>确认关键帧</button>
              <span className="csWorkflowState">确认后自动继续视频流程</span>
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
        <section className="csConversation">
          {renderSlot('conversation', {})}
        </section>
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
      {/* CV-065：全屏技能广场（lobby / work 共用同一覆盖层，盖住三栏）。 */}
      {skillMarketOpen && (
        <SkillMarket
          onClose={() => { setSkillMarketOpen(false) }}
          onActivate={handleActivateSkill}
        />
      )}
      {selectedNode !== null && projectId !== null && selectedNode.id === detailNodeId && (
        <LayerDetailPanel
          node={selectedNode}
          allNodes={nodes}
          onClose={() => { setDetailNodeId(null) }}
          onRename={handleRename}
          onSetOpacity={(id, opacity) => { if (projectId !== null) persistAfter(() => actions.setOpacity(projectId, id, opacity)) }}
          onToggleFlip={(id, axis) => {
            if (projectId !== null) {
              const node = nodes.find(candidate => candidate.id === id)
              if (node === undefined) return
              persistAfter(() => actions.updateNode(projectId, id, { [axis]: !node[axis] }))
            }
          }}
          onToggleLock={id => { if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id)) }}
          onToggleVisibility={handleToggleVisibility}
          onReorder={handleReorder}
          onDelete={id => { handleDelete([id]) }}
          onRetry={handleRetry}
          onSteer={handleSteer}
          onCancel={() => { void cancelCurrentTurn() }}
          onUpdateNode={handleUpdateNode}
          onReferenceToChat={handleReferenceToChat}
          onDownload={handleDownload}
        />
      )}
      {(() => {
        if (playbackNodeId === null) return null
        const target = nodes.find(node => node.id === playbackNodeId)
        if (target === undefined || target.kind !== 'video' || target.url === undefined) return null
        return (
          <VideoPlayerModal
            title={target.title ?? '视频'}
            url={target.url}
            onClose={() => { setPlaybackNodeId(null) }}
          />
        )
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
          onOpenDetail={id => { actions.selectNode(id); setDetailNodeId(id) }}
          onDelete={id => { handleDelete([id]) }}
          onReorder={handleReorder}
          onToggleLock={id => { if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id)) }}
          onToggleVisibility={handleToggleVisibility}
          onRetry={handleRetry}
          onSteer={id => { actions.selectNode(id); setDetailNodeId(id) }}
          onCancel={() => { void cancelCurrentTurn() }}
          onUngroup={id => { if (projectId !== null) persistAfter(() => actions.ungroup(projectId, id)) }}
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
    </div>
  )
}