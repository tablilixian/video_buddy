/**
 * Pure canvas-view helpers shared by the Host persistence layer and the
 * browser store: viewport validation for `canvas.json` v3 documents and the
 * overlap-free auto-arrange grid. Kept free of runtime imports so the Host
 * tsc emit (`lib/canvas-view.js`) is directly testable under `node --test`.
 */
import type { StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js'
import { VIEW_DEFAULTS } from './contracts/canvas.js'

/** Zoom clamp range (matches the surface wheel/zoom clamp). */
export const MIN_VIEW_SCALE = 0.1
export const MAX_VIEW_SCALE = 5

/** Clamp a zoom factor into the supported range. */
export function clampViewScale(scale: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale))
}

/** 画布可视区尺寸（「适配视野」与「整理布局」共用的唯一口径）。 */
export interface CanvasViewport {
  width: number
  height: number
}

/** 适配视野时给内容留的边距 —— 画布与整理布局共用一份，避免两处各写一个数。 */
export const FIT_PADDING = 60

/**
 * CV-185：**适配视野的缩放下限**。低于它，一张 260px 的卡只剩不到 78px，
 * 卡面已分不出是图还是文字，继续缩只是把内容变成一片色块 ——
 * 不如停在这个比例上让用户自己平移（真正想缩的人还有滚轮/缩放按钮）。
 */
export const FIT_MIN_SCALE = 0.3

/** 适配视野的结果：视口位移、比例，以及「是否被下限挡住（内容大于视口）」。 */
export interface FitResult {
  x: number
  y: number
  scale: number
  /** true = 按内容算出的比例低于 FIT_MIN_SCALE，已被抬到下限、内容会超出视口。 */
  clamped: boolean
}

/** 内容盒放进可视区能放到多大（不含上下限）。 */
function rawFitScale(box: { width: number; height: number }, viewport: CanvasViewport): number {
  const usableWidth = Math.max(1, viewport.width - FIT_PADDING * 2)
  const usableHeight = Math.max(1, viewport.height - FIT_PADDING * 2)
  return Math.min(usableWidth / Math.max(1, box.width), usableHeight / Math.max(1, box.height))
}

/**
 * CV-185：适配视野的**唯一实现**（原来这段数学写在 CanvasSurface 的 JSX 里，
 * 既没法单测，也没法被整理布局引用）。装得下就居中；装不下（比例被
 * FIT_MIN_SCALE 抬过）就**对齐内容左上角**—— 排完的布局是从左上开始读的，
 * 停在中间会让用户两头都要找。
 */
export function computeFitView(box: CanvasBox, viewport: CanvasViewport): FitResult {
  const raw = rawFitScale(box, viewport)
  const scale = clampViewScale(Math.max(raw, FIT_MIN_SCALE))
  const clamped = raw < FIT_MIN_SCALE
  if (clamped) {
    return { x: FIT_PADDING - box.x * scale, y: FIT_PADDING - box.y * scale, scale, clamped }
  }
  return {
    x: viewport.width / 2 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
    scale,
    clamped,
  }
}

/**
 * Coerce an unknown parsed `view` value into a safe viewport. Returns
 * `undefined` when the value is absent or not an object, so callers can
 * distinguish "no saved view" (fit content instead) from a default one.
 * Invalid individual fields fall back to their defaults; scale is clamped.
 */
export function normalizeCanvasView(value: unknown): StudioCanvasView | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const numberOr = (candidate: unknown, fallback: number): number =>
    typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
  const boolOr = (candidate: unknown, fallback: boolean): boolean =>
    typeof candidate === 'boolean' ? candidate : fallback
  // P9.1 时间轴顺序：仅接受全字符串数组；非法（含混入非字符串）整体丢弃，
  // 客户端回退 createdAt 派生。
  const timeline = Array.isArray(raw.timeline) && raw.timeline.every(id => typeof id === 'string')
    ? raw.timeline as string[]
    : undefined
  // CV-006 合成勾选态：与 timeline 同一容忍策略——非法整体丢弃，缺省 = 全部纳入/
  // 不使用 BGM（老文档零迁移）。引用悬空不在此校验（节点表不在这里），客户端解析。
  const composeExcluded = Array.isArray(raw.composeExcluded) && raw.composeExcluded.every(id => typeof id === 'string')
    ? raw.composeExcluded as string[]
    : undefined
  const composeBgmNodeId = typeof raw.composeBgmNodeId === 'string' ? raw.composeBgmNodeId : undefined
  return {
    x: numberOr(raw.x, VIEW_DEFAULTS.x),
    y: numberOr(raw.y, VIEW_DEFAULTS.y),
    scale: clampViewScale(numberOr(raw.scale, VIEW_DEFAULTS.scale)),
    layersOpen: boolOr(raw.layersOpen, VIEW_DEFAULTS.layersOpen),
    minimapVisible: boolOr(raw.minimapVisible, VIEW_DEFAULTS.minimapVisible),
    ...(timeline !== undefined ? { timeline } : {}),
    ...(composeExcluded !== undefined ? { composeExcluded } : {}),
    ...(composeBgmNodeId !== undefined ? { composeBgmNodeId } : {}),
  }
}

/**
 * CV-184：把一个世界坐标包围盒「带进视野」所需的**视图平移量**（不改缩放）。
 *
 * 屏幕坐标 = 世界坐标 × scale + view 偏移。轴向两端都不够就贴边，够就 0 ——
 * 返回的位移量因此是**最小值**：只在真的看不到时才动镜头，且动得刚好够。
 *
 * 比视野还大的盒子（放大后的关键帧很常见）不能贴边（贴边等于整个挪出去），
 * 规则改为：与可视区**完全不相交**才居中，否则不动 —— 用户已经在看它了。
 *
 * 纯函数，Host 与 client 共用，可直接单测。
 */
export function revealOffsetOf(
  box: { x: number; y: number; width: number; height: number },
  view: StudioCanvasView,
  viewport: { width: number; height: number },
  padding = 48,
): { dx: number; dy: number } {
  const axis = (worldStart: number, worldSize: number, offset: number, extent: number): number => {
    const scaled = worldSize * view.scale
    const screenStart = worldStart * view.scale + offset
    const screenEnd = screenStart + scaled
    const span = extent - padding * 2
    if (scaled > span) {
      const intersects = screenStart < extent - padding && screenEnd > padding
      if (intersects) return 0
      return extent / 2 - (worldStart + worldSize / 2) * view.scale - offset
    }
    if (screenStart < padding) return padding - screenStart
    if (screenEnd > extent - padding) return extent - padding - screenEnd
    return 0
  }
  return {
    dx: axis(box.x, box.width, view.x, viewport.width),
    dy: axis(box.y, box.height, view.y, viewport.height),
  }
}

/** 把值夹进 [min, max]（max < min 时取 min —— 窗口比控件还小时不许倒挂）。 */
function clampTo(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 就近操作条与节点边缘的间距。 */
export const NODE_ACTION_GAP = 8
/** 就近操作条与画布边缘的安全边距。 */
export const NODE_ACTION_MARGIN = 8

/** 就近操作条的落点结果。 */
export interface NodeActionAnchorResult {
  /** 屏幕坐标：工具条左上角。`visible === false` 时无意义。 */
  x: number
  y: number
  /** 贴在节点上边缘之外（above）还是下边缘之外（below）。 */
  placement: 'above' | 'below'
  /** 节点与可视区是否相交 —— 完全在视野外时不该冒出工具条。 */
  visible: boolean
}

/**
 * 就近操作条（节点工具条）的**屏幕几何唯一实现**。
 *
 * 为什么必须有这个纯函数：工具条渲染在 `.csCanvasLayer` **之外**（与 minimap 同层），
 * 尺寸因此不随画布缩放变形 —— 位置只能由「节点矩形 × 视图变换」现算；而「贴顶翻到
 * 下方、贴边往里夹、别落进抽屉」这三条边界一旦写进 JSX 就既没法单测、也会在下一处
 * 复用（比如 hover 卡）时被抄成第二份。屏幕坐标 = 世界坐标 × scale + view 偏移，
 * 与 `revealOffsetOf` 同一约定。
 *
 * @param box 节点在**画布坐标**下的矩形。
 * @param bar 工具条自身尺寸（屏幕 px，实测后回填）。
 * @param bottomInset 底部被抽屉遮住的高度（屏幕 px）—— 工具条不得落进抽屉里。
 */
export function nodeActionAnchor(
  box: CanvasBox,
  view: StudioCanvasView,
  viewport: CanvasViewport,
  bar: CanvasViewport,
  bottomInset = 0,
): NodeActionAnchorResult {
  const left = box.x * view.scale + view.x
  const top = box.y * view.scale + view.y
  const width = box.width * view.scale
  const height = box.height * view.scale
  const visible = left < viewport.width && top < viewport.height
    && left + width > 0 && top + height > 0
  // 可用纵向区间：上留 margin，下边再让开抽屉占掉的那一段。
  // maxY 走 max 兜底：窄窗口下抽屉可能比画布还高，区间会倒挂 —— 贴顶是最不坏的位置。
  const minY = NODE_ACTION_MARGIN
  const maxY = Math.max(minY, viewport.height - bottomInset - bar.height - NODE_ACTION_MARGIN)
  // 默认贴节点**上缘**之外（视线沿卡面往上读，不挡画面）；上方装不下才翻到下方。
  // 判据用 `above >= minY` 而不是「节点是否贴顶」：后者漏掉「工具条本身比上方空间高」。
  const above = top - NODE_ACTION_GAP - bar.height
  const placement: 'above' | 'below' = above >= minY ? 'above' : 'below'
  const y = clampTo(placement === 'above' ? above : top + height + NODE_ACTION_GAP, minY, maxY)
  // 横向：与节点同轴居中，两端夹在安全边距内（工具条比可视区还宽时贴左边距）。
  const maxX = Math.max(NODE_ACTION_MARGIN, viewport.width - NODE_ACTION_MARGIN - bar.width)
  const x = clampTo(left + width / 2 - bar.width / 2, NODE_ACTION_MARGIN, maxX)
  return { x, y, placement, visible }
}

/**
 * P9.1 时间轴的有效顺序：优先持久化的 `timeline`（自动剔除已删除的节点 id），
 * 没入过列的节点（新建/旧文档）按 createdAt 追加在后。纯函数 —— Host 单测
 * 可直接跑，客户端渲染与 compose 的 clipIds 都以它为准。
 */
export function deriveTimelineOrder(
  nodes: readonly StudioCanvasNode[],
  timeline: readonly string[] | undefined,
): StudioCanvasNode[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const))
  const ordered: StudioCanvasNode[] = []
  const seen = new Set<string>()
  if (timeline !== undefined) {
    for (const id of timeline) {
      if (seen.has(id)) continue
      const node = byId.get(id)
      if (node !== undefined) {
        ordered.push(node)
        seen.add(id)
      }
    }
  }
  for (const node of [...nodes].sort((left, right) => left.createdAt - right.createdAt)) {
    if (!seen.has(node.id)) {
      ordered.push(node)
      seen.add(node.id)
    }
  }
  return ordered
}

/* ===================== CV-223：镜位泳道布局 =====================
   分镜是短片画布的主角，「整理布局」的主干从 CV-185 的「按工具固定列」升级为
   「按镜号分行」：一个镜 = 一行，行内从左到右是 分镜卡 → 场景图×k → 关键帧 →
   视频/托盘 → 末帧；创意与源素材占头部行，文案/BGM/成片占右上尾区（demo
   canvas-layout-v2.html 定稿方案的移植）。镜号解析不出来的节点仍按泳道兜底
   落位，保证任何画布都不重叠。

   链式镜（下一镜用上一镜末帧续拍）不需要特殊处理：末帧与它的视频同镜同行，
   下一镜在下一行 —— 血缘边自然竖向衔接，不会把 18 个镜拉成 18 列。

   **分栏（验收反馈后确定）**：整块画布从左到右是
   ① 创意（创意 / 参考图 / 剧本 / 定妆照）→ ② 分镜（卡 → 场景图×k → 关键帧 →
   视频·托盘 → 末帧，按镜号纵向）→ ③ 音乐 → ④ 文案·成片（没有内容的栏自然塌缩）。
   **每栏各有一根纵向游标**：顶对齐、按自己的行高序列向下排，只有分镜栏内部按镜号
   成行。这一条是关键 —— 早期用"全局行号"时，创意栏的第 3 个素材会与分镜栏的第 3
   行硬对齐在一条水平线上，看过去糊成一团；各栏行高序列不同，排几行就自然错开。

   ⚠️ **分镜行里目前只有「绑镜的图」**：图的归属只看**有没有绑镜**（agent 传 shotRefs
   ⇒ 解析进 shotNodeIds ⇒ 并入 sourceIds ⇒ 血缘含分镜卡），绑了进关键帧泳道、没绑
   一律创意栏 ⇒ **LANE_SCENE（场景图泳道）暂时空置**（下面那些「场景子泳道行内横排」
   的分支代码就是给它留的）。等 agent 能在生成时声明"这张是场景参考还是构图关键帧"，
   它才会重新有内容。 */

/** 泳道之间、以及同行同泳道相邻单元之间的横向间距。
    验收反馈「节点左右太挤」⇒ 由 48 放宽到 80（行内更松，血缘边有走线余量）。
    只放宽横向：纵向仍走 ARRANGE_GAP_Y，保持行距紧凑。 */
const ARRANGE_GAP_X = 80
/** 分块（栏）之间额外拉开的横向间距 —— 要比栏内大，"几大块"才看得出来。 */
const ARRANGE_ZONE_GAP = 140
const ARRANGE_GAP_Y = 48
const ARRANGE_ORIGIN = 40
/** 同镜多张场景图行内横排的子泳道间距。 */
const ARRANGE_SCENE_GAP = 12
/** 被取代节点钉在取代者正下方时的间距。 */
const ARRANGE_SUPERSEDE_GAP = 6

/** 泳道号：决定 X 分栏，从左到右。 */
const LANE_SOURCE = 0 // ① 创意·源：创意 / 上传素材 / 全局锚（风格·场景锚）
const LANE_SCRIPT = 1 // ② 剧本·定妆
const LANE_CARD = 2   // ③ 分镜卡
const LANE_SCENE = 3  // ④ 场景图（行内横排子泳道）
const LANE_KF = 4     // ⑤ 关键帧
const LANE_SHOT = 5   // ⑥ 镜头视频 / 素材托盘
const LANE_FRAME = 6  // ⑦ 末帧
const LANE_MUSIC = 7  // ⑧ 音乐（独立分栏）
const LANE_FILM = 8   // ⑨ 文案·成片（兜底泳道）

/** 分块：栏间 X 分离，**每栏顶对齐、用自己的纵向游标向下排**。
    只有分镜栏内部按镜号成行（同镜横向排开），其余栏都是「素材堆」。 */
const ZONE_CREATIVE = 0 // 创意：LANE_SOURCE + LANE_SCRIPT
const ZONE_SHOT = 1     // 分镜：LANE_CARD ~ LANE_FRAME
const ZONE_MUSIC = 2    // 音乐
const ZONE_FILM = 3     // 文案·成片
const zoneOfLane = (lane: number): number =>
  lane <= LANE_SCRIPT ? ZONE_CREATIVE
    : lane <= LANE_FRAME ? ZONE_SHOT
      : lane === LANE_MUSIC ? ZONE_MUSIC : ZONE_FILM

/** 镜号解析：title 里的「分镜 N」。解析不出返回 undefined。 */
function shotNumberOfTitle(title: string | undefined): number | undefined {
  const match = /分镜\s*(\d+)/.exec(title ?? '')
  return match !== null ? Number(match[1]) : undefined
}

/** One top-level layout unit: a node plus the children that travel with it. */
interface ArrangeUnit {
  node: StudioCanvasNode
  /** Child nodes (parentId === unit.id) translated with the unit. */
  children: StudioCanvasNode[]
  /** 泳道号（决定 X 分栏）。 */
  lane: number
  /** 镜号（仅托盘组在此解析；其余节点查 shotNo 表）。 */
  shot?: number
}

/** 单个节点的泳道（组的泳道另行按子代推断）。 */
function laneOfNode(
  node: StudioCanvasNode,
  shotNo: ReadonlyMap<string, number>,
  keyframes: ReadonlySet<string>,
): number {
  switch (node.toolName) {
    case 'user_brief':                     return LANE_SOURCE
    case 'write_screenplay':
    case 'character_sheet':                return LANE_SCRIPT
    case 'submit_storyboard_for_approval': return LANE_CARD
    case 'extract_last_frame':             return LANE_FRAME
    case 'write_script':
    case 'compose':                        return LANE_FILM
    // 用户上传的参考视频：抽帧后的帧图与「风格归纳」便签都挂这个 toolName，同在创意栏。
    case 'upload_video':                   return LANE_SOURCE
    // 音乐独立成一栏：有音乐时它占第三块，成片顺延到第四块。
    case 'music_generation':               return LANE_MUSIC
    default: break
  }
  // 图只有两种归宿（2026-09-22 拍板）：**绑了镜的图** → 分镜区（关键帧泳道），其余
  // 一律创意区。判据与 generate.ts 的 operationTypeOf 同源 —— 没绑镜的 image_generate
  // 产物在那里被记成 'look'，含义正是「定妆 / 基调样张 / 场景概念图」。
  if (node.kind === 'image') {
    return keyframes.has(node.id) ? LANE_KF : LANE_SOURCE
  }
  // 音频按**来源**分栏（2026-09-22 与用户拍板）：用户上传的进创意栏（"我给的输入"），
  // agent 生成的音乐进音乐栏 —— 与图片 / 视频同一套规则，栏位静态可预测，不随血缘变化
  // 跳栏。⚠️ 上传音频的入口**尚未实现**，规则先钉在这里：将来它会带 toolName 走进
  // switch，若不显式归位就会掉到成片栏去。
  if (node.kind === 'audio') {
    if (node.origin === 'manual') return LANE_SOURCE
    if (shotNo.has(node.id)) return LANE_SHOT
    return LANE_MUSIC
  }
  if (node.kind === 'video') {
    if (shotNo.has(node.id)) return LANE_SHOT
    // 手动上传的媒体素材（无 toolName）属于源素材，不是成片。
    if (node.toolName === undefined && node.origin === 'manual') return LANE_SOURCE
    return LANE_FILM
  }
  return LANE_FILM
}

/**
 * Compute the auto-arrange layout（CV-223 镜位泳道）：
 *
 *   - **行 = 镜号**：分镜卡、该镜的场景图/关键帧/视频/末帧落在同一行，行内按
 *     泳道从左到右；镜号沿血缘继承（视频←卡、末帧←视频、托盘←子代视频）。
 *   - **头部行**：创意 / 上传素材 / 全局锚（被 ≥8 个节点消费的无血缘图）/ 源 BGM；
 *     剧本卡对齐首行、定妆照跟随其源素材。
 *   - **尾区行**：文案 / 配乐 BGM / 无镜号视频 / 成片（compose 恒最后一行）。
 *   - **组随行**（沿用 CV-185 机制）：托盘与成员保持相对偏移，托盘按子代视频
 *     的镜号进镜位行。
 *   - **版本钉扎**：顶层被取代节点钉在其取代者正下方（取代者所在行相应加高）。
 *
 * @param nodes 全部画布节点。
 * @returns the new canvas-space position per moved node id.
 */
export function computeArrangeLayout(
  nodes: readonly StudioCanvasNode[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions
  const byId = new Map(nodes.map((node) => [node.id, node]))

  // ---- 镜号解析（血缘传播，三趟）：卡 → 视频 → 末帧/关键帧 ----
  // 图只认「有没有绑镜」：agent 传了 shotRefs ⇒ 解析进 shotNodeIds ⇒ 并入 sourceIds
  // （generate.ts）⇒ 这里认出它引用分镜卡 ⇒ 关键帧。其余图一律创意区，**不看它被谁
  // 消费** —— 那趟"被视频消费过的无血缘图 = 该镜场景图"的推断已于 2026-09-22 删除，
  // 因为它把"被当参考用了"读成了"是这一镜的场景图"，实测把 9 张跨镜色彩参考图塞进了
  // 分镜栏（其中一张被 6 个镜共用，却被安到"镜 3"那一行）。
  const shotNo = new Map<string, number>()
  const keyframes = new Set<string>()
  for (const node of nodes) {
    if (node.toolName !== 'submit_storyboard_for_approval') continue
    const no = shotNumberOfTitle(node.title)
    if (no !== undefined) shotNo.set(node.id, no)
  }
  for (const node of nodes) {
    if (node.kind !== 'video' || node.toolName === 'compose') continue
    const card = node.sourceIds.map(id => byId.get(id)).find(src => src !== undefined && shotNo.has(src.id))
    if (card !== undefined) shotNo.set(node.id, shotNo.get(card.id)!)
  }
  for (const node of nodes) {
    if (node.toolName === 'extract_last_frame') {
      const video = node.sourceIds.map(id => byId.get(id)).find(src => src !== undefined && shotNo.has(src.id))
      if (video !== undefined) shotNo.set(node.id, shotNo.get(video.id)!)
      continue
    }
    if (node.kind !== 'image') continue
    // 图引用分镜卡 = 绑了镜 = 该镜的关键帧（构图参考）。
    const card = node.sourceIds.map(id => byId.get(id)).find(src => src !== undefined
      && src.toolName === 'submit_storyboard_for_approval' && shotNo.has(src.id))
    if (card !== undefined) {
      keyframes.add(node.id)
      // 顺手继承镜号 —— 不继承的话关键帧就没有行、会被下面的兜底排到画布最后
      // （原实现的隐藏缺陷：罗大佑画布一张关键帧都没有，所以一直没暴露）。
      shotNo.set(node.id, shotNo.get(card.id)!)
    }
  }

  // ---- 顶层单元 + 组随行（沿用既有机制：成员相对偏移保持）----
  const units: ArrangeUnit[] = []
  const childrenByParent = new Map<string, StudioCanvasNode[]>()
  for (const node of nodes) {
    if (node.parentId === undefined || !byId.has(node.parentId)) {
      units.push({ node, children: [], lane: LANE_FILM })
    } else {
      const siblings = childrenByParent.get(node.parentId) ?? []
      siblings.push(node)
      childrenByParent.set(node.parentId, siblings)
    }
  }
  for (const unit of units) unit.children = childrenByParent.get(unit.node.id) ?? []

  // 顶层单元的镜号：托盘（组）从 title / 子代视频 / 血缘卡继承。
  for (const unit of units) {
    if (unit.node.kind !== 'group') continue
    const own = shotNumberOfTitle(unit.node.title)
    if (own !== undefined) { unit.shot = own; continue }
    const childShots = unit.children
      .map(child => shotNo.get(child.id))
      .filter((value): value is number => value !== undefined)
    if (childShots.length > 0) { unit.shot = Math.min(...childShots); continue }
    const card = unit.node.sourceIds
      .map(id => byId.get(id))
      .find(src => src !== undefined && shotNo.has(src.id))
    const cardShot = card !== undefined ? shotNo.get(card.id) : undefined
    if (cardShot !== undefined) unit.shot = cardShot
  }
  for (const unit of units) {
    if (unit.shot !== undefined) { unit.lane = LANE_SHOT; continue }
    unit.lane = unit.node.kind === 'group' && unit.children.length > 0
      // 组按子代归泳道：参考托盘（图片成员）归源素材区，镜头托盘归镜位泳道。
      ? Math.min(...unit.children.map(child => laneOfNode(child, shotNo, keyframes)))
      : laneOfNode(unit.node, shotNo, keyframes)
  }

  // 被取代的顶层单元不参与行分配，最终钉在其取代者正下方；取代者丢失时按普通节点处理。
  const isSuperseded = (unit: ArrangeUnit): boolean =>
    unit.node.supersededBy !== undefined && byId.has(unit.node.supersededBy)
  // 取代链尽头（A←B←C 时取 C）——钉扎与加高都以链尾为准。
  const resolveSuccessor = (unit: ArrangeUnit): StudioCanvasNode | undefined => {
    let current = byId.get(unit.node.supersededBy!)
    while (current !== undefined && current.supersededBy !== undefined
      && byId.has(current.supersededBy)) {
      current = byId.get(current.supersededBy)
    }
    return current
  }
  const topUnitIdOf = (node: StudioCanvasNode): string => {
    let current = node
    while (current.parentId !== undefined) {
      const parent = byId.get(current.parentId)
      if (parent === undefined) break
      current = parent
    }
    return current.id
  }

  // ---- 行分配：**每栏独立编号** ----
  //
  // 这里曾经是一套**全局行号**（头部让位给镜位、尾区从 0 起……），于是「第几栏」与
  // 「第几行」被绑死：创意栏的第 3 个素材会与分镜栏的第 3 行硬对齐在一条水平线上，
  // 整片看上去糊成一团（验收反馈「分镜和参考混到一起」）。
  //
  // 现在改成**每栏自己的纵向游标**：只有分镜栏按镜号成行（同镜在行内横向排开），
  // 其余栏都是「素材堆」—— 顶对齐、按 createdAt 依次向下。各栏行高序列不同，排几行
  // 就自然错开，不再有「同一水平带」的读感。
  const rowOf = new Map<string, number>()
  /** 排布组：分镜栏的 5 条泳道共享一套行（按镜号对齐），其余每条泳道各排各的。 */
  const groupOfUnit = (unit: ArrangeUnit): string =>
    zoneOfLane(unit.lane) === ZONE_SHOT ? 'shot' : `lane-${unit.lane}`
  /** 行的唯一键：`组#行号`。分栏之间行号可以重号，互不影响。 */
  const rowKey = (unit: ArrangeUnit, row: number): string => `${groupOfUnit(unit)}#${row}`
  const isComposeUnit = (unit: ArrangeUnit): boolean => unit.node.toolName === 'compose'

  // 分镜栏：行号 = 镜号 - 1（镜 1 落在第 0 行，与创意栏首行顶对齐）。
  const shotNumbers = [...new Set(units
    .filter(unit => !isSuperseded(unit))
    .map(unit => unit.shot ?? shotNo.get(unit.node.id))
    .filter((value): value is number => value !== undefined))]
    .sort((left, right) => left - right)
  const shotRow = new Map<number, number>()
  // 镜号从 1 起算；Math.max 兜住异常镜号（0 / 负数），免得算出取不到 rowY 的负行。
  for (const shot of shotNumbers) shotRow.set(shot, Math.max(0, shot - 1))

  // 逐单元落行：分镜栏查镜号表；其余栏在**本泳道内**依次向下（各栏游标互不干扰）。
  // 成片（compose）恒排在成片栏末尾 —— 它是终点，不该被后落的文案压到中间。
  const laneCursor = new Map<number, number>()
  for (const unit of [...units].sort((left, right) => {
    const leftCompose = isComposeUnit(left) ? 1 : 0
    const rightCompose = isComposeUnit(right) ? 1 : 0
    return leftCompose !== rightCompose
      ? leftCompose - rightCompose
      : left.node.createdAt - right.node.createdAt
  })) {
    if (isSuperseded(unit) || rowOf.has(unit.node.id)) continue
    const shot = unit.shot ?? shotNo.get(unit.node.id)
    const shotRowIndex = shot !== undefined ? shotRow.get(shot) : undefined
    if (shotRowIndex !== undefined && zoneOfLane(unit.lane) === ZONE_SHOT) {
      rowOf.set(unit.node.id, shotRowIndex)
      continue
    }
    const index = laneCursor.get(unit.lane) ?? 0
    laneCursor.set(unit.lane, index + 1)
    rowOf.set(unit.node.id, index)
  }

  if (units.every(unit => isSuperseded(unit))) return positions

  // ---- 行高与泳道宽（按实际单元尺寸自适应）----
  // 行高按 `组#行号` 索引：分栏之间行号可以重号，各栏只受自己栏内最高单元影响。
  const rowHeights = new Map<string, number>()
  const laneWidths = new Map<number, number>()
  const unitOfId = new Map(units.map(unit => [unit.node.id, unit]))
  for (const unit of units) {
    if (isSuperseded(unit)) continue // 钉在取代者下方，不占自己的行列
    const row = rowOf.get(unit.node.id)
    if (row === undefined) continue
    const key = rowKey(unit, row)
    rowHeights.set(key, Math.max(rowHeights.get(key) ?? 0, unit.node.height))
    laneWidths.set(unit.lane, Math.max(laneWidths.get(unit.lane) ?? 0, unit.node.width))
  }
  // 场景泳道按「每镜最多几张」开子泳道，行内横排、跨镜对齐。
  const sceneWidth = laneWidths.get(LANE_SCENE)
  let maxScenes = 1
  if (sceneWidth !== undefined) {
    const scenesByShot = new Map<number, number>()
    for (const unit of units) {
      if (unit.lane !== LANE_SCENE) continue
      const shot = unit.shot ?? shotNo.get(unit.node.id)
      if (shot === undefined) continue
      const count = (scenesByShot.get(shot) ?? 0) + 1
      scenesByShot.set(shot, count)
      maxScenes = Math.max(maxScenes, count)
    }
    laneWidths.set(LANE_SCENE, maxScenes * (sceneWidth + ARRANGE_SCENE_GAP))
  }
  // 被取代单元钉在取代者下方：先给取代者所在行加高，避免压到下一行。
  for (const unit of units) {
    if (!isSuperseded(unit)) continue
    const successor = resolveSuccessor(unit)
    if (successor === undefined) continue
    const ownerId = topUnitIdOf(successor)
    const ownerRow = rowOf.get(ownerId)
    const ownerUnit = unitOfId.get(ownerId)
    if (ownerRow === undefined || ownerUnit === undefined) continue
    const key = rowKey(ownerUnit, ownerRow)
    rowHeights.set(key, (rowHeights.get(key) ?? 0) + unit.node.height + ARRANGE_SUPERSEDE_GAP)
  }

  // 泳道 X：按泳道最大宽度逐栏累加（空泳道塌缩成一段间隙）。
  // 跨分块时多让出 ARRANGE_ZONE_GAP - ARRANGE_GAP_X，让「创意 | 分镜 | 音乐 | 成片」
  // 在视觉上成块 —— 栏间距 > 栏内间距，眼睛才能把它们读成几大块而不是一串等距的列。
  const laneX = new Map<number, number>()
  let cursorX = ARRANGE_ORIGIN
  let previousZone = zoneOfLane(LANE_SOURCE)
  for (let lane = LANE_SOURCE; lane <= LANE_FILM; lane += 1) {
    const zone = zoneOfLane(lane)
    if (zone !== previousZone) cursorX += ARRANGE_ZONE_GAP - ARRANGE_GAP_X
    laneX.set(lane, cursorX)
    cursorX += (laneWidths.get(lane) ?? 0) + ARRANGE_GAP_X
    previousZone = zone
  }
  // 行 Y：**每组独立累加** —— 每栏都从 ARRANGE_ORIGIN 顶对齐、用自己的行高序列向下排，
  // 所以创意栏的第 3 个素材不会与分镜栏的第 3 行落在同一条水平线上。
  const rowY = new Map<string, number>()
  {
    const maxRowOfGroup = new Map<string, number>()
    for (const key of rowHeights.keys()) {
      const [group, rowText] = key.split('#')
      if (group === undefined || rowText === undefined) continue
      maxRowOfGroup.set(group, Math.max(maxRowOfGroup.get(group) ?? -1, Number(rowText)))
    }
    for (const [group, maxRow] of maxRowOfGroup) {
      let cursorY = ARRANGE_ORIGIN
      for (let row = 0; row <= maxRow; row += 1) {
        rowY.set(`${group}#${row}`, cursorY)
        cursorY += (rowHeights.get(`${group}#${row}`) ?? 0) + ARRANGE_GAP_Y
      }
    }
  }
  // 场景子泳道：每镜内的场景图按 createdAt 依次向右排。
  const sceneStep = sceneWidth !== undefined ? sceneWidth + ARRANGE_SCENE_GAP : 0
  const sceneIndexByNode = new Map<string, number>()
  {
    const scenesByShot = new Map<number, StudioCanvasNode[]>()
    for (const unit of units) {
      if (unit.lane !== LANE_SCENE) continue
      const shot = unit.shot ?? shotNo.get(unit.node.id)
      if (shot === undefined) continue
      const list = scenesByShot.get(shot) ?? []
      list.push(unit.node)
      scenesByShot.set(shot, list)
    }
    for (const list of scenesByShot.values()) {
      list.sort((left, right) => left.createdAt - right.createdAt)
        .forEach((node, index) => sceneIndexByNode.set(node.id, index))
    }
  }

  // 逐单元落位：同一行同一泳道出现多个单元（重复卡 / 多托盘等）时横向错开。
  const stagger = new Map<string, number>()
  for (const unit of [...units].sort((left, right) => left.node.createdAt - right.node.createdAt)) {
    if (isSuperseded(unit)) continue
    const row = rowOf.get(unit.node.id)
    if (row === undefined) continue
    const baseX = laneX.get(unit.lane) ?? ARRANGE_ORIGIN
    const y = rowY.get(rowKey(unit, row)) ?? ARRANGE_ORIGIN
    let x: number
    if (unit.lane === LANE_SCENE) {
      const sceneIndex = sceneIndexByNode.get(unit.node.id) ?? 0
      x = baseX + sceneIndex * sceneStep
    } else {
      const key = `${rowKey(unit, row)}:${unit.lane}`
      const offset = stagger.get(key) ?? 0
      x = baseX + offset
      stagger.set(key, offset + unit.node.width + ARRANGE_GAP_X)
    }
    positions.set(unit.node.id, { x, y })
    const deltaX = x - unit.node.x
    const deltaY = y - unit.node.y
    for (const child of unit.children) {
      positions.set(child.id, { x: child.x + deltaX, y: child.y + deltaY })
    }
  }

  // 被取代的顶层单元：钉在（取代链尾的）取代者正下方；链上多个一起钉时纵向续接。
  const pinCount = new Map<string, number>()
  for (const unit of units) {
    if (!isSuperseded(unit)) continue
    const successor = resolveSuccessor(unit)
    const succPos = successor !== undefined ? positions.get(successor.id) : undefined
    if (successor === undefined || succPos === undefined) continue
    const index = pinCount.get(successor.id) ?? 0
    pinCount.set(successor.id, index + 1)
    positions.set(unit.node.id, {
      x: succPos.x,
      y: succPos.y + successor.height + ARRANGE_SUPERSEDE_GAP
        + index * (unit.node.height + ARRANGE_SUPERSEDE_GAP),
    })
  }
  return positions
}

/* ===================== CV-177：托盘（素材组）几何与排版 =====================
   托盘 = kind='group' 的容器节点，成员靠 parentId 挂进来（CV-079 自动编组 /
   手动编组）。几何与排版收在这一份纯函数里，Host（生成时自动编组）与 client
   （手动编组 / 整理托盘 / 载入规范化）都调这里 —— 改前是两处各算一遍
   （generate.ts 的 GROUP_PADDING 与 project-store 里硬编码的 -12 / +24），
   只要加一条抓取带就会当场分叉。 */

/** 托盘内边距：成员四周留白（canvas 空间像素）。 */
export const GROUP_PADDING = 12

/**
 * 托盘顶部抓取带高度。组框**没有 resize 把手**（showResize 只给媒体节点），
 * 所以「哪里能按住托盘拖」只能由代码保证 —— 这条 24px 的带子就是答案：
 * 不管托盘里是一张还是多张，缩放多少，顶部永远有一块可抓区。
 */
export const GROUP_HEAD_HEIGHT = 24

/** 「整理托盘」时成员之间的间距。 */
export const GROUP_TIDY_GAP = 12

/** 矩形盒（canvas 空间）。 */
export interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 成员包围盒 → 托盘几何：四周留 GROUP_PADDING，顶部再让出 GROUP_HEAD_HEIGHT
 * 的抓取带。空成员返回 null（由调用方决定怎么处理）。
 */
export function groupBoxOf(members: readonly StudioCanvasNode[]): CanvasBox | null {
  if (members.length === 0) return null
  const minX = Math.min(...members.map(member => member.x))
  const minY = Math.min(...members.map(member => member.y))
  const maxX = Math.max(...members.map(member => member.x + member.width))
  const maxY = Math.max(...members.map(member => member.y + member.height))
  return {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING - GROUP_HEAD_HEIGHT,
    width: maxX - minX + GROUP_PADDING * 2,
    height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEAD_HEIGHT,
  }
}

/**
 * 载入清洗：托盘几何只**扩张**不收缩。两件事一次做完：
 * ① 旧文档的托盘是按「成员包围盒 + 12px」存盘的，没有抓取带的位置 ——
 *    一亮相就补齐 24px，否则绘制出来的头部带会压住成员顶部；
 * ② 成员被单独拖到框外时，框重新包住它 —— 与 attachShotGroup「只扩张」
 *    的既有语义一致，不引入新解释。
 * 收缩是**用户的显式动作**，只走「整理托盘」（tidyGroupLayout）。
 */
export function normalizeGroupBoxes(nodes: readonly StudioCanvasNode[]): StudioCanvasNode[] {
  if (!nodes.some(node => node.kind === 'group')) return [...nodes]
  const membersByParent = new Map<string, StudioCanvasNode[]>()
  for (const node of nodes) {
    if (node.parentId === undefined) continue
    const list = membersByParent.get(node.parentId)
    if (list === undefined) membersByParent.set(node.parentId, [node])
    else list.push(node)
  }
  return nodes.map(node => {
    if (node.kind !== 'group') return node
    const box = groupBoxOf(membersByParent.get(node.id) ?? [])
    if (box === null) return node
    const minX = Math.min(node.x, box.x)
    const minY = Math.min(node.y, box.y)
    const maxX = Math.max(node.x + node.width, box.x + box.width)
    const maxY = Math.max(node.y + node.height, box.y + box.height)
    const grown = minX !== node.x || minY !== node.y
      || maxX !== node.x + node.width || maxY !== node.y + node.height
    return grown ? { ...node, x: minX, y: minY, width: maxX - minX, height: maxY - minY } : node
  })
}

/**
 * 单成员托盘：拖这个成员 == 拖它的托盘。
 *
 * 为什么需要：托盘的可抓区是成员四周的边环（12px）加顶部抓取带，缩放到 50%
 * 时边环只剩 6px，用户实际只能按住成员图片 —— 而 store.moveNode 的跟随规则
 * 只有一条（parentId === id），拖成员只动成员自己，于是「图片被拖出托盘、
 * 托盘原地不动」。多成员托盘保留「成员可单独拖走」（确认过的语义），被拖
 * 出去的成员靠「整理托盘」收回。
 *
 * @returns 组内只有这一个成员时返回该托盘，否则 undefined。
 */
export function singleMemberGroupOf(
  nodes: readonly StudioCanvasNode[],
  node: StudioCanvasNode,
): StudioCanvasNode | undefined {
  if (node.parentId === undefined) return undefined
  const group = nodes.find(candidate => candidate.id === node.parentId && candidate.kind === 'group')
  if (group === undefined) return undefined
  const memberCount = nodes.filter(candidate => candidate.parentId === group.id).length
  return memberCount === 1 ? group : undefined
}

/** 「整理托盘」的结果：成员新位置 + 整理后的托盘几何。 */
export interface TidyGroupResult {
  positions: Map<string, { x: number; y: number }>
  box: CanvasBox | null
}

/**
 * 「整理托盘」：以**托盘左上角为锚**，把成员按当前阅读顺序重排成网格 ——
 * ≤3 张排一行，更多则列数取 ceil(sqrt(n))（接近正方形）；格子尺寸取成员的
 * 最大宽 / 最大高，格内居中，间距 GROUP_TIDY_GAP。
 *
 * 锚在托盘而不是成员包围盒上，有三个后果，都是要的：
 * ① 被单独拖出托盘的成员会被**收回**（这就是多成员托盘的「复位」路径）；
 * ② 只有一张时，「整理」= 把它放回托盘内的标准位置，幂等；
 * ③ 返回的 box 由新位置重算，所以整理后托盘必定恰好贴合 —— 画布上**唯一**
 *    能收缩托盘的路径（其余路径只扩张）。
 */
export function tidyGroupLayout(
  group: StudioCanvasNode,
  members: readonly StudioCanvasNode[],
): TidyGroupResult {
  const positions = new Map<string, { x: number; y: number }>()
  if (members.length === 0) return { positions, box: null }

  const ordered = readingOrder(members)
  const columns = ordered.length <= 3 ? ordered.length : Math.ceil(Math.sqrt(ordered.length))
  const cellWidth = Math.max(...ordered.map(member => member.width))
  const cellHeight = Math.max(...ordered.map(member => member.height))
  const originX = group.x + GROUP_PADDING
  const originY = group.y + GROUP_PADDING + GROUP_HEAD_HEIGHT

  ordered.forEach((member, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    positions.set(member.id, {
      x: originX + column * (cellWidth + GROUP_TIDY_GAP) + (cellWidth - member.width) / 2,
      y: originY + row * (cellHeight + GROUP_TIDY_GAP) + (cellHeight - member.height) / 2,
    })
  })

  const moved = members.map(member => {
    const position = positions.get(member.id)
    return position === undefined ? member : { ...member, x: position.x, y: position.y }
  })
  return { positions, box: groupBoxOf(moved) }
}

/**
 * 阅读顺序：先按 y 分「行」（**垂直区间有重叠**即同一行），行内按 x，最后用
 * createdAt 兜底。不按「y 完全相等」判行 —— 手工摆过的成员几乎不可能对齐，
 * 只有按垂直重叠分簇才能把视觉上的一行认出来。
 */
function readingOrder(members: readonly StudioCanvasNode[]): StudioCanvasNode[] {
  const sorted = [...members].sort((left, right) => left.y - right.y || left.x - right.x)
  const rows: StudioCanvasNode[][] = []
  let rowTop = 0
  let rowBottom = 0
  for (const member of sorted) {
    const row = rows[rows.length - 1]
    if (row !== undefined && member.y < rowBottom && member.y + member.height > rowTop) {
      row.push(member)
      rowTop = Math.min(rowTop, member.y)
      rowBottom = Math.max(rowBottom, member.y + member.height)
      continue
    }
    rows.push([member])
    rowTop = member.y
    rowBottom = member.y + member.height
  }
  return rows.flatMap(row => row.sort((left, right) => left.x - right.x || left.createdAt - right.createdAt))
}
