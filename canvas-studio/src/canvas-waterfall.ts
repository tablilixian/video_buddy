/**
 * REQ-036：历程瀑布流布局 —— 画布「历程视图」的**纯布局函数**。
 *
 * 与 `canvas-view.ts` 的 `arrangeCanvas`（CV-223 整理布局）同一纪律：
 *   - **零运行时依赖**（只 import contracts 类型与 canvas-view 的共享纯函数），
 *     Host 与 client 共用，`node --test` 直测 lib 产物；
 *   - **只读**：入参 nodes 不被修改，输出与画布存储坐标无关的全新坐标 ——
 *     历程视图是渲染层投影，**从不写回 `node.x/y`**，从不落盘；
 *   - 镜号传播 / 关键帧判据与整理布局共享同一份实现（`deriveShotSemantics`），
 *     不做第二份解析。
 *
 * 形态（交互原型 `docs/demos/canvas-waterfall-demo-2026-10-26/` 定稿）：
 *   纵向单列 feed，节 = ① 创意 → ② 分镜（**一行一镜**的行式表格）
 *   → ③ 音频 → ④ 成片 → ⑤ 其他（兜底，绝不丢节点）。空节自动塌缩。
 *   节内按 手动 order（waterfallOrder）→ createdAt 排序；被取代节点紧跟其
 *   取代者。文本类（创意需求/剧本/口播文案/便签/提示卡）与辅助卡（末帧）
 *   默认不进布局（用户拍板 2026-10-26），分镜卡除外——它是托盘归属锚点。
 *
 * 分镜节「一行一镜」（用户拍板 2026-11-24，见
 *   `docs/plans/历程视图-分镜一行一镜-方案-20261124.md`）：
 *   行 = 镜，行框即该镜容器；行内单排网格，格序 卡 → 关键帧 → 末帧 → 视频 → 配音
 *   → 其余按 createdAt；行内上限 4 格，第 5 件折到**同一行框内**的第二排。
 *   分镜卡从「108 高头带」变成网格第 1 格（与媒体等高），音频也是普通格
 *   （不再是独占整行横条）；行框宽统一到节宽（表格感），高度随内容。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'
import { isShotCard, AUDIO_NODE_HEIGHT } from './contracts/canvas.js'
import { deriveShotSemantics, isAuxiliaryNode } from './canvas-view.js'
import { isDeprecatedNode } from './shot-versions.js'

/** 历程节的五段纵向顺序。 */
export type WaterfallStage = 'creative' | 'shots' | 'audio' | 'film' | 'other'

const STAGE_ORDER: readonly WaterfallStage[] = ['creative', 'shots', 'audio', 'film', 'other']

const STAGE_TITLES: Readonly<Record<WaterfallStage, string>> = {
  creative: '创意',
  shots: '分镜',
  audio: '音频',
  film: '成片',
  other: '其他',
}

/** 默认隐藏的纯文本类工具（用户拍板：历程视图不展示创意/剧本/口播文案）。 */
const TEXT_LIKE_TOOLS: ReadonlySet<string> = new Set(['user_brief', 'write_screenplay', 'write_script'])

/** 文本类节点：文本工具 + sticky/prompt 两种便签形态。分镜卡不在此列（先判 isShotCard）。 */
function isTextLike(node: StudioCanvasNode): boolean {
  if (isShotCard(node)) return false
  return TEXT_LIKE_TOOLS.has(node.toolName ?? '') || node.kind === 'sticky' || node.kind === 'prompt'
}

/** 布局盒（画布空间，左上角定位 —— 与 CanvasNode 的 transform 同约定）。 */
export interface WaterfallBox {
  x: number
  y: number
  width: number
  height: number
}

/** 一段历程节：标题 + 成员 + 包围盒（含节头保留区）。 */
export interface WaterfallSection {
  stage: WaterfallStage
  title: string
  /** 该节全部节点 id（分镜节 = 全部托盘成员之并，托盘卡在前）。 */
  nodeIds: readonly string[]
  /** 节内生成状态统计（REQ-040 A 期：节头 / 阶段 chips 三态着色的只读数据）。 */
  stats: WaterfallStats
  box: WaterfallBox
}

/**
 * 一个镜的托盘 = 一行（一行一镜的行式表格）。box 含行框（渲染层据此画框），
 * 宽度统一到节宽、高度随行内内容（单排恒 `PAD*2 + cellH`）。
 */
export interface WaterfallTray {
  shot: number
  /** 该镜的分镜卡 id（= 行内第一格；该镜没有分镜卡时为 undefined）。 */
  cardId?: string
  /** 镜内全部节点 id（卡在前，其余按 role 排列）。 */
  nodeIds: readonly string[]
  /** 托盘内生成状态统计（REQ-040 A 期：托盘状态徽标 / 边色分流的只读数据）。 */
  stats: WaterfallStats
  box: WaterfallBox
}

/**
 * 生成状态统计（REQ-040 A 期：进度层 / 节头 / 托盘徽标的只读数据）。
 *
 * 判据与节点**瞬态字段**同源（零新状态机）：`isLoading === true` = 生成中；
 * `error` 存在且不在生成中 = 失败；其余（含无 url 的占位/草稿）= 计入 done ——
 * 「推进过程」的读数是「还有多少在飞」，不是「产物齐不齐」，占位前的静态卡
 * 不该被读成未完成而永远压着进度条。
 */
export interface WaterfallStats {
  total: number
  done: number
  running: number
  failed: number
}

/**
 * 版本堆栈（REQ-040 B：D2 干净化核心）。被取代链折叠进链尾（当前生效版本）
 * 名下——画布上每一步只显当前生效版本，历史收进角标（`v3 · 2 历史`）。
 * **视图折叠不是数据删除**：节点与 `supersededBy` 关系原样保留（生成历史
 * 抽屉仍看全量），本结构是只读运行时投影，从不落盘。
 */
export interface WaterfallStack {
  /** 被折叠的历史版本数。 */
  count: number
  /** 历史版本节点 id（新→旧：shotVersion 降序、createdAt 破平）。 */
  supersededIds: readonly string[]
}

export interface WaterfallLayout {
  /** 每个参与布局节点的画布坐标（左上角）。 */
  positions: Map<string, { x: number; y: number }>
  /** 每个参与布局节点的标准缩略盒（历程视图渲染用，不含 group 容器）。 */
  boxes: Map<string, WaterfallBox>
  /** 非空节，按纵向顺序。 */
  sections: readonly WaterfallSection[]
  /** 分镜托盘，按镜号升序。 */
  trays: readonly WaterfallTray[]
  /** 全局生成状态统计（REQ-040 A 期：状态条全局进度条的只读数据）。 */
  stats: WaterfallStats
  /** 正在生成的节点 id（「跟随新产出」的检测源；顺序 = 分类序）。 */
  runningIds: readonly string[]
  /** 正在生成的摘要文案（如「镜 3 · 仓库特写」，多个附「等 N 个」）；空闲为 null。 */
  activity: string | null
  /** 版本堆栈（REQ-040 B）：键 = 链尾（当前生效版本）节点 id。fold 关闭时恒空。 */
  stacks: ReadonlyMap<string, WaterfallStack>
  /**
   * REQ-041：段产物格（一行一镜的「视频」位）。只在调用方给出
   * `segmentRefsWithMedia` 且该镜分镜卡带的 ref 确实有可播段时出现；
   * 格位同时写进 `boxes` / `trays[].nodeIds`（否则行内布局与「镜 N」角标
   * 的右边界会少算一格），但**不进** `positions`（它不是节点，没有坐标）。
   */
  segmentCells: readonly WaterfallSegmentCell[]
}

export interface WaterfallOptions {
  /** 显示纯文本类节点（默认 false —— 用户拍板默认隐藏）。 */
  showText?: boolean
  /** 显示辅助卡（末帧等，默认 false，语义同自由画布 showAuxiliary）。 */
  showAuxiliary?: boolean
  /** 额外排除的节点 id（如隐藏废弃素材开关命中的节点）。 */
  hiddenIds?: ReadonlySet<string>
  /** 手动排序覆盖（P2 拖拽写 `view.waterfallOrder`）：列表内节点按列表序，未列入的按 createdAt 追后。 */
  order?: readonly string[]
  /** 标准缩略盒宽（画布空间 px，缺省 360；高按 16:9 派生，竖版媒体按真实比例）。
   *  REQ-040 A 期：调用方应传 `thumbWidthFromViewport(viewportWidth)` 的档位值
   *  （进入历程视图时定档一次），不再恒用缺省 —— 少节点不小、多节点不溢出。 */
  thumbWidth?: number
  /**
   * 版本堆栈折叠（REQ-040 B，缺省 false = 旧行为）。true 时：被取代节点
   * （`supersededBy` 存在）不进布局（无格位），折叠进链尾的 `stacks`；
   * retired（手动作废、无替代者）一并隐藏。链尾解析不出（取代者不在场上）
   * 时该节点保持可见 —— 兜底「绝不丢节点」。调用方口径：历程视图默认折叠，
   * 「显示废弃素材」开关打开时关闭折叠（平铺回显旧行为）。
   */
  foldSuperseded?: boolean
  /**
   * REQ-041：**有可播段产物**的 ref 集合（`spec:s2` 这种）。
   *
   * 为什么要调用方给：布局函数是纯函数、只认节点，不知道某个 ref 到底渲过没有。
   * 让它在布局里凭空造格会出现「每个分镜卡旁边都挂一个空视频格」—— 没渲过段的
   * 项目（或段还在渲）立刻变形。清单到了才有格，清单为空则行形态与今天完全一致。
   */
  segmentRefsWithMedia?: ReadonlySet<string>
}

/* ================= 几何常量 ================= */
/** 网格间隙（画布空间 px）。 */
const GAP = 24
/** 节与节之间的纵向间距（大于节内间距，眼睛才把节读成块 —— CV-223 同一教训）。 */
const SECTION_GAP = 72
/** 节头保留高度（渲染层在此画节名 + 计数）。导出给 CanvasSurface：节头字号
 *  屏幕恒定（÷scale）缩放时会膨胀，渲染层按本值钳制画布空间字号防压到节点。 */
export const SECTION_HEAD_H = 56
/** 托盘内边距。 */
const TRAY_PAD = 16
/** 托盘之间的纵向间距。 */
const TRAY_GAP = 24
/** 音频缩略盒高 = 音频卡**真实固有高度**（480×168 契约卡）。2026-10-27 修正：
 *  此前手写 96，而卡内容（chrome 48 + 波形/控制/歌词）不随盒压缩，
 *  overflow:hidden 把下半截裁掉 —— 盒高必须给足，卡才显示完整。 */
const AUDIO_H = AUDIO_NODE_HEIGHT
/** 文本卡缩略盒高。 */
const TEXT_H = 140
/** 托盘内网格最大列数（原型 auto-fill 的确定性等价：≤4 个一排，更多折行）。 */
const MAX_COLUMNS = 4
/** 竖版媒体的高宽比封顶（= 9:16 的镜像）。超过它 cover 只微裁一点点，
 * 换来极端长图不会把所在行撑成通天柱。 */
const PORTRAIT_MAX_RATIO = 16 / 9

/** 镜内产物的排列角色（托盘网格顺序）。 */
const ROLE = { keyframe: 1, video: 2, lastframe: 3, voice: 4 } as const

/**
 * REQ-041：段产物格的角色 —— 落在「镜视频」之后、「末帧 / 配音」之前。
 *
 * 用户口径（2026-11-25 真机纠正）：历程视图一行一镜的格序是
 * **文字卡 → 关键帧 → 视频 → 音频（→ 末帧）**。段产物（Remotion 渲出的这一屏）
 * 属于「视频」这一类，不是分镜卡的附属画面 —— 上一版把段视频塞进分镜卡体区，
 * 结果是 380×214 的格里正文与视频互抢高度（真机截图：视频被压成一条、文字骑
 * 在画面上）。改成独立格后，卡回到纯文案，视频回到视频格。
 */
const ROLE_SEGMENT = 2.5

/** 段产物格的合成 id（不是节点，只在布局里占一个格位）。 */
export function segmentCellId(shot: number): string {
  return `segment:${shot}`
}

/** 历程视图里的段产物格（渲染层据 box 画一张只读视频卡）。 */
export interface WaterfallSegmentCell {
  /** 合成 id（{@link segmentCellId}），同时出现在 `trays[].nodeIds` 与 `boxes`。 */
  id: string
  shot: number
  /** `spec:<原始 id>` —— 渲染层按它去段清单取 URL。 */
  ref: string
  box: WaterfallBox
}

/** 标准缩略盒高：媒体 16:9（竖版按真实比例派生、封顶），音频矮条，文本卡定高。
 *  REQ-036 复核（2026-10-27）：竖版素材（如 768×1376）此前被硬塞 16:9 格，
 *  渲染层 object-fit:cover 把它裁成中间横带 —— 这里改按 mediaWidth/mediaHeight
 *  感知方向；两字段缺失（未加载/老数据）时维持 16:9 缺省，行为不变。
 *  REQ-036 一行一镜（2026-11-24）：分镜卡不再占 108 头带，改网格第一格并与
 *  媒体同高 —— 必须先判 `isShotCard`（它是 text 节点，否则会被下面的 TEXT_H 吃掉）。
 *  音频仍返回固有高 AUDIO_H（480×168 契约卡，卡内部不随盒压缩），行内按
 *  「盒高不足该排高就纵向居中」处理（见 {@link gridLayout} 的 centerVertically）。 */
function cellHeightOf(node: StudioCanvasNode, cellW: number): number {
  if (isShotCard(node)) return Math.round(cellW * 9 / 16)
  if (node.kind === 'audio') return AUDIO_H
  if (node.kind === 'text' || node.kind === 'sticky' || node.kind === 'prompt') return TEXT_H
  const { mediaWidth, mediaHeight } = node
  if (mediaWidth !== undefined && mediaHeight !== undefined
    && mediaWidth > 0 && mediaHeight > mediaWidth) {
    const ratio = Math.min(mediaHeight / mediaWidth, PORTRAIT_MAX_RATIO)
    return Math.round(cellW * ratio)
  }
  return Math.round(cellW * 9 / 16)
}

/** 被取代链的链尾（A←B←C 取 C）；断链（取代者不在表内）返回 undefined。 */
function resolveSuccessorEnd(node: StudioCanvasNode, byId: ReadonlyMap<string, StudioCanvasNode>): StudioCanvasNode | undefined {
  let current = node.supersededBy !== undefined ? byId.get(node.supersededBy) : undefined
  while (current !== undefined && current.supersededBy !== undefined) {
    const next = byId.get(current.supersededBy)
    if (next === undefined) break
    current = next
  }
  return current
}

/**
 * 节内排序键：手动 order 优先（列表序），未列入按 createdAt（再按 id 兜稳定）。
 * 被取代节点跟在取代者（链尾）之后 —— 与 CV-223「钉在取代者正下方」同语义，
 * 在 feed 里的等价表达是「排序上紧随其后」。
 */
function sectionSortKeyOf(
  node: StudioCanvasNode,
  byId: ReadonlyMap<string, StudioCanvasNode>,
  orderRank: ReadonlyMap<string, number>,
): { primary: number; secondary: number; tertiary: number } {
  const successor = resolveSuccessorEnd(node, byId)
  if (successor !== undefined) {
    const base = sectionSortKeyOf(successor, byId, orderRank)
    return { primary: base.primary, secondary: base.secondary + 0.5, tertiary: base.tertiary }
  }
  const rank = orderRank.get(node.id)
  if (rank !== undefined) return { primary: rank, secondary: 0, tertiary: 0 }
  return { primary: Number.MAX_SAFE_INTEGER, secondary: node.createdAt, tertiary: 0 }
}

function compareSectionKey(
  left: { primary: number; secondary: number; tertiary: number },
  right: { primary: number; secondary: number; tertiary: number },
): number {
  return left.primary - right.primary || left.secondary - right.secondary || left.tertiary - right.tertiary
}

/** 单个节点的归属判定（P0 分类表，见 REQ-036 §4.2）。 */
interface Classified {
  node: StudioCanvasNode
  stage: WaterfallStage
  /** 仅分镜节：镜号。 */
  shot?: number
  /** 托盘内排列角色；节内（非托盘）排序不用它。 */
  role?: number
}

/**
 * 音频的镜归属兜底：`shotNo` 三趟传播只覆盖 卡→视频→末帧/关键帧图，配音
 * （tts_voiceover）的血缘是 agent 传什么挂什么（generate.ts `resolveSourceIds`
 * 按 sourceUrls 现算），不在传播链上。这里在**瀑布流分类内**走查 sourceIds ——
 * 引用了分镜卡 / 已知镜号的视频或关键帧 ⇒ 跟随该镜进托盘。刻意不写入
 * `deriveShotSemantics`（那会同时改变整理布局 CV-223 的行为，超出本需求边界）。
 */
function audioShotOf(
  node: StudioCanvasNode,
  shotNo: ReadonlyMap<string, number>,
  byId: ReadonlyMap<string, StudioCanvasNode>,
): number | undefined {
  for (const id of node.sourceIds) {
    const source = byId.get(id)
    if (source === undefined) continue
    const shot = shotNo.get(source.id)
    if (shot !== undefined) return shot
  }
  return undefined
}

function classifyNode(
  node: StudioCanvasNode,
  shotNo: ReadonlyMap<string, number>,
  keyframes: ReadonlySet<string>,
  byId: ReadonlyMap<string, StudioCanvasNode>,
): Classified {
  const shot = shotNo.get(node.id)
  if (isShotCard(node)) {
    // 分镜卡永远显示（归属锚点）；镜号解析不出时进「其他」兜底（罕见边角）。
    return shot !== undefined
      ? { node, stage: 'shots', shot, role: 0 }
      : { node, stage: 'other' }
  }
  if (isAuxiliaryNode(node)) {
    return shot !== undefined && node.kind === 'image'
      ? { node, stage: 'shots', shot, role: ROLE.lastframe }
      : { node, stage: 'other' }
  }
  if (node.kind === 'image') {
    return keyframes.has(node.id)
      ? { node, stage: 'shots', shot: shot!, role: ROLE.keyframe }
      : { node, stage: 'creative' }
  }
  if (node.kind === 'video') {
    if (node.toolName === 'compose') return { node, stage: 'film', role: 9 }
    if (shot !== undefined) return { node, stage: 'shots', shot, role: ROLE.video }
    // 与 CV-223 laneOfNode 同口径：手动上传（无 toolName）是源素材，不是成片。
    if (node.toolName === undefined && node.origin === 'manual') return { node, stage: 'creative' }
    return { node, stage: 'film' }
  }
  if (node.kind === 'audio') {
    const audioShot = shot ?? audioShotOf(node, shotNo, byId)
    if (audioShot !== undefined) return { node, stage: 'shots', shot: audioShot, role: ROLE.voice }
    if (node.origin === 'manual') return { node, stage: 'creative' }
    return { node, stage: 'audio' }
  }
  if (isTextLike(node)) return { node, stage: 'creative' }
  // group 容器在上方被跳过；其余未知（text 未知工具等）兜底。
  return { node, stage: 'other' }
}

/** 行主序网格：返回每格坐标（相对内容区原点）与内容区尺寸。 */
function gridLayout(
  cells: readonly { id: string; height: number }[],
  cellW: number,
  options: { centerVertically?: boolean } = {},
): { offsets: Map<string, { x: number; y: number }>; width: number; height: number } {
  const offsets = new Map<string, { x: number; y: number }>()
  if (cells.length === 0) return { offsets, width: 0, height: 0 }
  const columns = Math.min(cells.length, MAX_COLUMNS)
  const rowHeights: number[] = []
  cells.forEach((cell, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, cell.height)
    offsets.set(cell.id, { x: column * (cellW + GAP), y: 0 }) // y 在第二趟回填
  })
  let cursorY = 0
  for (let row = 0; row < rowHeights.length; row += 1) {
    const height = rowHeights[row] ?? 0
    cells.forEach((cell, index) => {
      if (Math.floor(index / columns) !== row) return
      const offset = offsets.get(cell.id)!
      // 居中：矮格（音频 168 落在媒体排 214 里）纵向居中，不留顶对齐的豁口。
      const slack = options.centerVertically === true ? Math.max(0, height - cell.height) : 0
      offset.y = cursorY + Math.round(slack / 2)
    })
    cursorY += height + GAP
  }
  const width = columns * cellW + (columns - 1) * GAP
  return { offsets, width, height: Math.max(0, cursorY - GAP) }
}

/**
 * 视口像素宽 → 标准缩略盒宽档位（REQ-040 A 期：进入历程视图时定档一次，
 * resize 不重排 —— 避免拖拽窗口时布局反复跳动）。
 *
 * 目标：默认 scale≈1 时整列内容宽 ≈ 视口宽（四列），fit 适配后卡片以自然
 * 尺寸呈现 —— 少节点不再是固定 360px 的小卡 + 右半空场，多节点不用缩到
 * 很小才看得全。钳制 240~480：下限保单卡可读，上限防大屏虚胖。
 */
export function thumbWidthFromViewport(viewportWidth: number): number {
  const width = Math.max(0, viewportWidth)
  if (width <= 860) return 240
  if (width <= 1200) return 300
  if (width <= 1700) return 380
  return 480
}

/** 状态统计判据（见 {@link WaterfallStats} 注）。 */
function statsOf(ids: readonly string[], byId: ReadonlyMap<string, StudioCanvasNode>): WaterfallStats {
  let running = 0
  let failed = 0
  for (const id of ids) {
    const node = byId.get(id)
    if (node === undefined) continue
    if (node.isLoading === true) running += 1
    else if (node.error !== undefined) failed += 1
  }
  return { total: ids.length, done: ids.length - running - failed, running, failed }
}

/** 空统计（空画布 / 空节早退共用）。 */
const EMPTY_STATS: WaterfallStats = { total: 0, done: 0, running: 0, failed: 0 }

/** 活动行摘要：`镜 3 · 仓库特写`（无镜号只给标题）；多个在调用侧拼「等 N 个」。 */
function activityLabelOf(node: StudioCanvasNode, shot: number | undefined): string {
  const label = node.title ?? node.toolName ?? node.kind
  return shot !== undefined ? `镜 ${shot} · ${label}` : label
}

/**
 * 历程瀑布流布局（REQ-036 P0 核心）。
 *
 * @param nodes 全部画布节点（函数只读，不改输入）。
 * @param options 见 {@link WaterfallOptions}。
 * @returns 全新坐标 / 盒 / 节 / 托盘。坐标以 x=0 为整列中轴（渲染层用
 *          `computeFitView` 装进视口即可）。
 */
export function computeWaterfallLayout(
  nodes: readonly StudioCanvasNode[],
  options: WaterfallOptions = {},
): WaterfallLayout {
  const positions = new Map<string, { x: number; y: number }>()
  const boxes = new Map<string, WaterfallBox>()
  const showText = options.showText ?? false
  const showAuxiliary = options.showAuxiliary ?? false
  const hiddenIds = options.hiddenIds
  const foldSuperseded = options.foldSuperseded === true
  /** REQ-040 B：被取代链折叠记录（链尾 id → 历史成员）。fold 关闭时恒空。
   *  构建期用可变数组（push/sort），返回前整体作为只读 WaterfallStack 暴露。 */
  const stacks = new Map<string, { count: number; supersededIds: string[] }>()
  const orderRank = new Map((options.order ?? []).map((id, index) => [id, index] as const))
  const cellW = Math.max(120, options.thumbWidth ?? 360)
  const byId = new Map(nodes.map((node) => [node.id, node]))

  // ---- 参与布局的节点：容器不进（成员各自成卡）；文本/辅助按开关；显式隐藏剔除 ----
  // REQ-040 B（foldSuperseded）：废弃节点在**辅助/文本开关之前**判定（末帧等
  // 辅助卡被取代时也该折叠进历史，不能被辅助开关抢先吞掉不留痕）。被取代 →
  // 折叠进链尾 stacks；retired → 直接隐藏；链尾不在场 → 保持可见（兜底不丢）。
  const participants = nodes.filter(node => {
    if (node.kind === 'group') return false
    if (hiddenIds?.has(node.id)) return false
    if (foldSuperseded && isDeprecatedNode(node)) {
      if (node.retired === true) return false
      const end = resolveSuccessorEnd(node, byId)
      if (end !== undefined && end.id !== node.id) {
        const entry = stacks.get(end.id) ?? { count: 0, supersededIds: [] }
        entry.count += 1
        entry.supersededIds.push(node.id)
        stacks.set(end.id, entry)
        return false
      }
    }
    if (isAuxiliaryNode(node) && !showAuxiliary) return false
    if (isTextLike(node) && !showText) return false
    return true
  })
  if (participants.length === 0) {
    return { positions, boxes, sections: [], trays: [], stats: EMPTY_STATS, runningIds: [], activity: null, stacks, segmentCells: [] }
  }

  const { shotNo, keyframes } = deriveShotSemantics(nodes)

  // ---- 归类 + 手动 order 追加（order 里的 id 若不在 participants 中则忽略）----
  const classified = participants.map(node => classifyNode(node, shotNo, keyframes, byId))
  for (const id of orderRank.keys()) {
    if (byId.has(id) && !classified.some(item => item.node.id === id)) {
      // order 引用了被过滤掉的节点：忽略（保持过滤语义优先）。
      orderRank.delete(id)
    }
  }

  // ---- 分节聚合 ----
  const byStage = new Map<WaterfallStage, Classified[]>(STAGE_ORDER.map(stage => [stage, []]))
  for (const item of classified) byStage.get(item.stage)!.push(item)

  // 镜号 → 托盘成员（卡 + 产物）。
  const trayMembers = new Map<number, Classified[]>()
  for (const item of byStage.get('shots')!) {
    const list = trayMembers.get(item.shot!) ?? []
    list.push(item)
    trayMembers.set(item.shot!, list)
  }

  /** 内容区（不含节头）几何的中间结果：先算宽度定 contentW，再统一落 y。 */
  interface SectionPlan {
    stage: WaterfallStage
    nodeIds: string[]
    stats: WaterfallStats
    width: number
    height: number
    /** stage==='shots' 时为托盘计划，否则为单网格计划。 */
    trays: readonly { shot: number; cardId?: string; nodeIds: readonly string[]; stats: WaterfallStats; width: number; height: number; offsets: Map<string, { x: number; y: number }>; cellHeights: ReadonlyMap<string, number>; segment?: { id: string; ref: string } }[]
    grid?: ReturnType<typeof gridLayout>
  }

  const segmentRefsWithMedia = options.segmentRefsWithMedia
  /** 段产物格的盒高：与媒体格同口径（16:9）。 */
  const segmentCellHeight = Math.round(cellW * 9 / 16)

  const plans: SectionPlan[] = []
  for (const stage of STAGE_ORDER) {
    if (stage === 'shots') {
      const shots = [...trayMembers.keys()].sort((left, right) => left - right)
      if (shots.length === 0) continue
      const trayPlans = shots.map(shot => {
        const members = trayMembers.get(shot)!
        const card = members.find(item => item.role === 0)
        // 只把选作头的那张卡摘出来；同镜若有第二张卡（重复落地等），按普通格排，不丢。
        const others = members
          .filter(item => item !== card)
          .sort((left, right) => (left.role ?? 9) - (right.role ?? 9)
            || compareSectionKey(sectionSortKeyOf(left.node, byId, orderRank), sectionSortKeyOf(right.node, byId, orderRank)))
        // 一行一镜（2026-11-24 拍板）：卡是**网格第一格**（不再是 108 高头带），音频也是
        // 普通格（不再独占整行横条）—— 两类都进 gridItems，格序靠 role 保证
        // 卡(0) → 关键帧(1) → 视频(2) → 末帧(3) → 配音(4) → 其余按 createdAt。
        //
        // REQ-041（2026-11-25 真机纠正）：段产物**自己占一格**（role 2.5 = 视频位），
        // 不再塞进分镜卡的体区。格序因此是 卡 → 关键帧 → 视频 → 段 → 末帧 → 配音，
        // 与效果图 `docs/demos/shot-rows-2026-11-24/` 的「文字卡 / 关键帧 / 镜视频 /
        // 配音」一致；镜子有 H3 镜视频时两者并排（原始镜视频 vs 排版后的这一屏）。
        const cardRef = card?.node.segmentRef
        const segment = cardRef !== undefined && segmentRefsWithMedia?.has(cardRef) === true
          ? { id: segmentCellId(shot), ref: cardRef }
          : undefined
        const orderedCells: { id: string; height: number; role: number }[] = (card !== undefined ? [card, ...others] : others)
          .map(item => ({ id: item.node.id, height: cellHeightOf(item.node, cellW), role: item.role ?? 9 }))
        if (segment !== undefined) {
          const at = orderedCells.findIndex(cell => cell.role > ROLE_SEGMENT)
          orderedCells.splice(at === -1 ? orderedCells.length : at, 0,
            { id: segment.id, height: segmentCellHeight, role: ROLE_SEGMENT })
        }
        const cells = orderedCells.map(cell => ({ id: cell.id, height: cell.height }))
        // centerVertically：音频 168 落在 214 的媒体排里纵向居中（卡内部布局不动）。
        const grid = gridLayout(cells, cellW, { centerVertically: true })
        // 行高 = 内边距 + 网格高 + 内边距（单排 246；折行时随内容变高，不强制等高）。
        const height = TRAY_PAD + grid.height + TRAY_PAD
        const memberIds = orderedCells.map(cell => cell.id)
        return {
          shot,
          ...(card !== undefined ? { cardId: card.node.id } : {}),
          nodeIds: memberIds,
          // 合成格没有节点，statsOf 会跳过它 —— 计数仍按真实节点读，不会被读成「多一个产物」。
          stats: statsOf(memberIds, byId),
          /** 内容宽（未统一）：节宽 = 全部托盘取 max 后回填（见下）。 */
          width: TRAY_PAD * 2 + grid.width,
          height,
          offsets: grid.offsets,
          cellHeights: new Map(orderedCells.map(cell => [cell.id, cell.height] as const)),
          ...(segment !== undefined ? { segment } : {}),
        }
      })
      // 行框统一到节宽（表格感）：先算 sectionWidth，再回填每个托盘 —— 不按内容缩，
      // 否则「只有一条视频的镜」又变回细长条（本需求要根治的形态）。
      const width = Math.max(...trayPlans.map(tray => tray.width))
      const traysPlanned = trayPlans.map(tray => ({ ...tray, width }))
      const height = traysPlanned.reduce((sum, tray) => sum + tray.height, 0) + TRAY_GAP * (traysPlanned.length - 1)
      plans.push({
        stage,
        nodeIds: traysPlanned.flatMap(tray => [...tray.nodeIds]),
        stats: statsOf(traysPlanned.flatMap(tray => [...tray.nodeIds]), byId),
        width,
        height,
        trays: traysPlanned,
      })
      continue
    }
    const items = byStage.get(stage)!
    if (items.length === 0) continue
    // 成片节：compose（role 9）恒排最后 —— 它是终点（与 CV-223 同拍板）。
    const sorted = [...items].sort((left, right) => {
      const leftCompose = (left.role ?? 0) >= 9 ? 1 : 0
      const rightCompose = (right.role ?? 0) >= 9 ? 1 : 0
      if (leftCompose !== rightCompose) return leftCompose - rightCompose
      return compareSectionKey(
        sectionSortKeyOf(left.node, byId, orderRank),
        sectionSortKeyOf(right.node, byId, orderRank),
      )
    })
    const cells = sorted.map(item => ({ id: item.node.id, height: cellHeightOf(item.node, cellW) }))
    const grid = gridLayout(cells, cellW)
    const gridIds = [...grid.offsets.keys()]
    plans.push({ stage, nodeIds: gridIds, stats: statsOf(gridIds, byId), width: grid.width, height: grid.height, trays: [], grid })
  }

  if (plans.length === 0) {
    return { positions, boxes, sections: [], trays: [], stats: EMPTY_STATS, runningIds: [], activity: null, stacks, segmentCells: [] }
  }

  // ---- 统一落位：整列**居左对齐**（x=0 起排，用户 2026-10-27 拍板，原为居中），
  //      各节独立纵向游标 ----
  const sections: WaterfallSection[] = []
  const trays: WaterfallTray[] = []
  const segmentCells: WaterfallSegmentCell[] = []
  let cursorY = 0
  for (const plan of plans) {
    const x = 0
    // 节头保留区。
    cursorY += SECTION_HEAD_H
    if (plan.stage === 'shots') {
      let trayY = cursorY
      for (const tray of plan.trays) {
        const box: WaterfallBox = { x, y: trayY, width: tray.width, height: tray.height }
        trays.push({
          shot: tray.shot,
          ...(tray.cardId !== undefined ? { cardId: tray.cardId } : {}),
          nodeIds: tray.nodeIds,
          stats: tray.stats,
          box,
        })
        // 一行一镜：卡与全部产物都由**网格格位**定位（不再有头带 / 音轨条两套口径），
        // 格宽恒 = cellW；盒高按各自的 cellHeightOf（音频 168 居中在 214 排里）。
        for (const [id, offset] of tray.offsets) {
          const cellX = box.x + TRAY_PAD + offset.x
          const cellY = box.y + TRAY_PAD + offset.y
          const node = byId.get(id)
          const height = tray.cellHeights.get(id)
            ?? (node !== undefined ? cellHeightOf(node, cellW) : segmentCellHeight)
          boxes.set(id, { x: cellX, y: cellY, width: cellW, height })
          // 合成格（段产物）没有节点坐标 —— positions 只放真实节点，避免
          // 任何按 id 反查节点的调用方拿到一个不存在的 id。
          if (node !== undefined) positions.set(id, { x: cellX, y: cellY })
        }
        if (tray.segment !== undefined) {
          const cellBox = boxes.get(tray.segment.id)
          if (cellBox !== undefined) {
            segmentCells.push({ id: tray.segment.id, shot: tray.shot, ref: tray.segment.ref, box: cellBox })
          }
        }
        trayY += tray.height + TRAY_GAP
      }
    } else {
      for (const [id, offset] of plan.grid!.offsets) {
        positions.set(id, { x: x + offset.x, y: cursorY + offset.y })
        const node = byId.get(id)!
        boxes.set(id, { x: x + offset.x, y: cursorY + offset.y, width: cellW, height: cellHeightOf(node, cellW) })
      }
    }
    const height = SECTION_HEAD_H + plan.height
    sections.push({ stage: plan.stage, title: STAGE_TITLES[plan.stage], nodeIds: plan.nodeIds, stats: plan.stats, box: { x, y: cursorY - SECTION_HEAD_H, width: plan.width, height } })
    cursorY += height + SECTION_GAP - SECTION_HEAD_H
  }

  // ---- 全局进度 / 活动行（REQ-040 A 期）：对全部参与布局节点求状态 ----
  const runningItems = classified.filter(item => item.node.isLoading === true)
  const runningIds = runningItems.map(item => item.node.id)
  const activity = runningItems.length === 0
    ? null
    : `${activityLabelOf(runningItems[0]!.node, runningItems[0]!.shot)}${runningItems.length > 1 ? ` 等 ${runningItems.length} 个` : ''}`
  // ---- 版本堆栈排序（REQ-040 B）：历史成员新→旧（shotVersion 降序、createdAt 破平）----
  for (const entry of stacks.values()) {
    entry.supersededIds.sort((left, right) => {
      const a = byId.get(left)
      const b = byId.get(right)
      if (a === undefined || b === undefined) return 0
      return (b.shotVersion ?? 0) - (a.shotVersion ?? 0) || b.createdAt - a.createdAt
    })
  }
  return { positions, boxes, sections, trays, stats: statsOf(participants.map(node => node.id), byId), runningIds, activity, stacks, segmentCells }
}
