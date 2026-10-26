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
 *   纵向单列 feed，节 = ① 创意 → ② 分镜（每镜一个托盘，托盘头 = 分镜卡）
 *   → ③ 音频 → ④ 成片 → ⑤ 其他（兜底，绝不丢节点）。空节自动塌缩。
 *   节内按 手动 order（waterfallOrder）→ createdAt 排序；被取代节点紧跟其
 *   取代者。文本类（创意需求/剧本/口播文案/便签/提示卡）与辅助卡（末帧）
 *   默认不进布局（用户拍板 2026-10-26），分镜卡除外——它是托盘归属锚点。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'
import { isShotCard } from './contracts/canvas.js'
import { deriveShotSemantics, isAuxiliaryNode } from './canvas-view.js'

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
  box: WaterfallBox
}

/** 一个镜的托盘：分镜卡（头）+ 镜内产物。box 含托盘框（渲染层据此画框）。 */
export interface WaterfallTray {
  shot: number
  /** 托盘头部的分镜卡 id（该镜没有分镜卡时为 undefined）。 */
  cardId?: string
  /** 镜内全部节点 id（卡在前，其余按 role 排列）。 */
  nodeIds: readonly string[]
  box: WaterfallBox
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
  /** 标准缩略盒宽（画布空间 px，缺省 360；高按 16:9 派生）。 */
  thumbWidth?: number
}

/* ================= 几何常量 ================= */
/** 网格间隙（画布空间 px）。 */
const GAP = 24
/** 节与节之间的纵向间距（大于节内间距，眼睛才把节读成块 —— CV-223 同一教训）。 */
const SECTION_GAP = 72
/** 节头保留高度（渲染层在此画节名 + 计数）。 */
const SECTION_HEAD_H = 56
/** 托盘内边距。 */
const TRAY_PAD = 16
/** 托盘头（分镜卡）保留高度。 */
const TRAY_HEAD_H = 48
/** 托盘之间的纵向间距。 */
const TRAY_GAP = 24
/** 音频缩略盒高。 */
const AUDIO_H = 96
/** 文本卡缩略盒高。 */
const TEXT_H = 140
/** 托盘内网格最大列数（原型 auto-fill 的确定性等价：≤4 个一排，更多折行）。 */
const MAX_COLUMNS = 4

/** 镜内产物的排列角色（托盘网格顺序）。 */
const ROLE = { keyframe: 1, video: 2, lastframe: 3, voice: 4 } as const

/** 标准缩略盒高：媒体 16:9，音频矮条，文本卡定高。 */
function cellHeightOf(node: StudioCanvasNode, cellW: number): number {
  if (node.kind === 'audio') return AUDIO_H
  if (node.kind === 'text' || node.kind === 'sticky' || node.kind === 'prompt') return TEXT_H
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
      offset.y = cursorY
    })
    cursorY += height + GAP
  }
  const width = columns * cellW + (columns - 1) * GAP
  return { offsets, width, height: Math.max(0, cursorY - GAP) }
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
  const orderRank = new Map((options.order ?? []).map((id, index) => [id, index] as const))
  const cellW = Math.max(120, options.thumbWidth ?? 360)
  const byId = new Map(nodes.map((node) => [node.id, node]))

  // ---- 参与布局的节点：容器不进（成员各自成卡）；文本/辅助按开关；显式隐藏剔除 ----
  const participants = nodes.filter(node => {
    if (node.kind === 'group') return false
    if (hiddenIds?.has(node.id)) return false
    if (isAuxiliaryNode(node) && !showAuxiliary) return false
    if (isTextLike(node) && !showText) return false
    return true
  })
  if (participants.length === 0) return { positions, boxes, sections: [], trays: [] }

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
    width: number
    height: number
    /** stage==='shots' 时为托盘计划，否则为单网格计划。 */
    trays: readonly { shot: number; cardId?: string; nodeIds: readonly string[]; width: number; height: number; offsets: Map<string, { x: number; y: number }> }[]
    grid?: ReturnType<typeof gridLayout>
  }

  const plans: SectionPlan[] = []
  for (const stage of STAGE_ORDER) {
    if (stage === 'shots') {
      const shots = [...trayMembers.keys()].sort((left, right) => left - right)
      if (shots.length === 0) continue
      const trayPlans = shots.map(shot => {
        const members = trayMembers.get(shot)!
        const card = members.find(item => item.role === 0)
        // 只把选作头的那张卡摘出来；同镜若有第二张卡（重复落地等），按普通格排，不丢。
        const cells = members
          .filter(item => item !== card)
          .sort((left, right) => (left.role ?? 9) - (right.role ?? 9)
            || compareSectionKey(sectionSortKeyOf(left.node, byId, orderRank), sectionSortKeyOf(right.node, byId, orderRank)))
          .map(item => ({ id: item.node.id, height: cellHeightOf(item.node, cellW) }))
        const grid = gridLayout(cells, cellW)
        const width = TRAY_PAD * 2 + Math.max(grid.width, cellW)
        const height = TRAY_HEAD_H + TRAY_PAD + grid.height + TRAY_PAD
        return {
          shot,
          ...(card !== undefined ? { cardId: card.node.id } : {}),
          nodeIds: [...(card !== undefined ? [card.node.id] : []), ...cells.map(cell => cell.id)],
          width,
          height,
          offsets: grid.offsets,
        }
      })
      const width = Math.max(...trayPlans.map(tray => tray.width))
      const height = trayPlans.reduce((sum, tray) => sum + tray.height, 0) + TRAY_GAP * (trayPlans.length - 1)
      plans.push({
        stage,
        nodeIds: trayPlans.flatMap(tray => [...tray.nodeIds]),
        width,
        height,
        trays: trayPlans,
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
    plans.push({ stage, nodeIds: [...grid.offsets.keys()], width: grid.width, height: grid.height, trays: [], grid })
  }

  if (plans.length === 0) return { positions, boxes, sections: [], trays: [] }

  // ---- 统一落位：整列以 x=0 居中，各节独立纵向游标 ----
  const contentWidth = Math.max(...plans.map(plan => plan.width))
  const sections: WaterfallSection[] = []
  const trays: WaterfallTray[] = []
  let cursorY = 0
  for (const plan of plans) {
    const x = -contentWidth / 2 + (contentWidth - plan.width) / 2
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
          box,
        })
        if (tray.cardId !== undefined) {
          positions.set(tray.cardId, { x: box.x + TRAY_PAD, y: box.y })
          boxes.set(tray.cardId, {
            x: box.x + TRAY_PAD, y: box.y, width: box.width - TRAY_PAD * 2, height: TRAY_HEAD_H,
          })
        }
        for (const [id, offset] of tray.offsets) {
          positions.set(id, { x: box.x + TRAY_PAD + offset.x, y: box.y + TRAY_HEAD_H + TRAY_PAD + offset.y })
          const node = byId.get(id)!
          boxes.set(id, { x: box.x + TRAY_PAD + offset.x, y: box.y + TRAY_HEAD_H + TRAY_PAD + offset.y, width: cellW, height: cellHeightOf(node, cellW) })
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
    sections.push({ stage: plan.stage, title: STAGE_TITLES[plan.stage], nodeIds: plan.nodeIds, box: { x, y: cursorY - SECTION_HEAD_H, width: plan.width, height } })
    cursorY += height + SECTION_GAP - SECTION_HEAD_H
  }

  return { positions, boxes, sections, trays }
}
