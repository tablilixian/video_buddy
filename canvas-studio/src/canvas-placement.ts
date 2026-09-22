/**
 * CV-184：画布落点唯一实现。
 *
 * 在这之前，「新节点落在哪」这件事在四个文件里各写了一遍（Host 的
 * `generate.ts`、成片 `compose.ts`、占位节点 `client/index.ts`、手动新建
 * `client/project-store.ts`），其中三份是同一套裸数字（40 / 300 / 240 / 4 列）
 * 的复制粘贴，**只有一份带血缘避让**。后果不是理论上的：成片节点（480 宽）
 * 走 300 的步距必然与前一格重叠，而它连血缘避让都没有。
 *
 * 本模块与 `canvas-view.ts` 同层（Host 与 client 共用，纯函数、零运行时依赖）：
 * - 排列（整理布局 / 整理托盘）在 canvas-view.ts；
 * - 落点（新节点放哪）在这里 —— 两件事不同，不要互相掺。
 *
 * 改这里的任何数字都会同时影响四条链路，这正是要的效果。
 */
import { STORYBOARD_NODE_TOOL } from './contracts/canvas.js'
import type { StudioCanvasNode } from './contracts/canvas.js'

/** 网格落点：与「手动新建」的历史观感保持一致（4 列，300 × 240 步距）。 */
export const PLACEMENT_GRID = { origin: 40, stepX: 300, stepY: 240, columns: 4 } as const

/** 血缘落位：新节点与来源节点右缘的间距。 */
export const PLACEMENT_GAP = 60

/** 血缘落位向右避让的步数上限（与原实现一致：每步 = 自身宽 + 间隙）。 */
export const PLACEMENT_STEPS = 50

/** 无来源落位向后找空位的格数上限（正常画布远用不到，纯粹防死循环）。 */
export const PLACEMENT_SCAN = 256

/** 轴对齐矩形相交判定（半开区间：贴边不算重叠）。 */
export function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

/** 该位置是否与画布上任一节点重叠。 */
function clashes(
  nodes: readonly StudioCanvasNode[],
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return nodes.some(node => boxesOverlap(box, node))
}

/**
 * 新节点落点。两支规则：
 *
 * ① **有血缘来源**（`sourceIds` 命中画布节点）：排在来源右缘 + 间隙，`y` 对齐来源
 *    最高处，与现有节点重叠则整格右移（有界 `PLACEMENT_STEPS` 步）。
 *    **多来源时优先锚定分镜卡**（见函数内注释：同镜产物必须跟着自己的镜走）；
 *    血缘里没有分镜卡时才退回「最右来源的右缘 + 最上来源的顶」；
 * ② **无来源**：从「节点数对应的格位」起，按格位顺序找**第一个不重叠**的格子。
 *
 * 第 ② 支此前是「直接落在 index 格、不查重叠」—— 一旦删过节点或手工挪过位置，
 * `index` 与「这个格子是否被占」就毫无关系，新节点会直接叠在别人身上；而
 * `stepX`(300) 比 16:9 媒体节点(480)、分镜卡(360) 都窄，连「没删过节点」的正常
 * 情形都在叠。所以两支共用同一份 `clashes`。
 *
 * 必须在写入前用**当前画布节点**调用（多个节点的调用方需把已排好的算进去，
 * 否则同一批会全部落在同一个格子里）。
 */
export function deriveNodePlacement(
  nodes: readonly StudioCanvasNode[],
  sourceIds: readonly string[],
  width: number,
  height: number,
): { x: number; y: number } {
  const sources = sourceIds
    .map(id => nodes.find(node => node.id === id))
    .filter((node): node is StudioCanvasNode => node !== undefined)

  if (sources.length > 0) {
    // 锚点选择：**有分镜卡就锚定分镜卡**，否则退回「最右来源的右缘 + 最上来源的顶」。
    //
    // 2026-09-22：用户报「同镜成员散落在画布各处 ⇒ 镜位框跨屏」。多来源取 max 右缘时，
    // 只要血缘里**任意一张素材**在画布右边，产物就会被拉到它旁边、脱离自己的分镜卡；
    // 而镜位框按成员**当前坐标**算包围盒 ⇒ 框跨出半个画布。
    // 分镜卡是这一组产物唯一的**结构锚**（其余来源是素材，本来就可能散落四处），
    // 锚定它 = 同镜产物永远落在自己那一镜的右侧。
    const anchor = sources.find(source => source.toolName === STORYBOARD_NODE_TOOL)
    const left = anchor !== undefined
      ? anchor.x + anchor.width
      : Math.max(...sources.map(source => source.x + source.width))
    const top = anchor !== undefined ? anchor.y : Math.min(...sources.map(source => source.y))
    let x = left + PLACEMENT_GAP
    for (let step = 0; step < PLACEMENT_STEPS; step += 1) {
      if (!clashes(nodes, { x, y: top, width, height })) return { x, y: top }
      x += width + PLACEMENT_GAP
    }
    return { x, y: top }
  }

  const start = nodes.length
  for (let step = 0; step < PLACEMENT_SCAN; step += 1) {
    const cell = start + step
    const position = {
      x: PLACEMENT_GRID.origin + (cell % PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepX,
      y: PLACEMENT_GRID.origin + Math.floor(cell / PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepY,
    }
    if (!clashes(nodes, { ...position, width, height })) return position
  }
  // 兜底（扫描上限内全被占，正常画布不会出现）：放到现有内容的下方，
  // 确定性优先，不再无限找空位。
  const bottom = nodes.length === 0
    ? PLACEMENT_GRID.origin
    : Math.max(...nodes.map(node => node.y + node.height)) + PLACEMENT_GAP
  return { x: PLACEMENT_GRID.origin, y: bottom }
}

/**
 * 依次落点：把「本批已排好的节点」算进占用表，避免同批节点全部落在同一格。
 * 调用方按自己的顺序准备宽高（含逐个索引依赖的场景，如按帧落卡）。
 */
export function placeSequence(
  nodes: readonly StudioCanvasNode[],
  sizes: ReadonlyArray<{ width: number; height: number }>,
  sourceIds: readonly string[] = [],
): Array<{ x: number; y: number }> {
  const placed: StudioCanvasNode[] = []
  return sizes.map((size, index) => {
    const position = deriveNodePlacement([...nodes, ...placed], sourceIds, size.width, size.height)
    // 只借用一个占位壳推进占用表，不构造真节点（调用方自己建）。
    placed.push({
      id: `__placing_${index}`,
      kind: 'sticky',
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      createdAt: 0,
      origin: 'agent',
      sourceIds: [],
    })
    return position
  })
}
