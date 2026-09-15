/**
 * 血缘聚光（DD-03 立，CV-186 改语义）：**拖动**节点时，按血缘距离分三档压暗 ——
 * 直接血缘留在亮档，隔一层的降到中间档，更远与无关的压到压暗档。
 *
 * 边界（唯一实现，画布侧只允许调这里，见 visual-direction-plan.md 的
 * 「同一规则只准一份实现」铁律）：
 * - 血缘表**只有一份**：`StudioCanvasNode.sourceIds`（契约 §Bloodline，
 *   "There is no separate edge table — edges are derived from the node graph"）。
 *   本模块与 `CanvasEdges` 消费同一个字段，不引入第二张边表。
 * - 血缘距离 = **双向最近跳数**（上游「我引用的」与下游「引用我的」等价），
 *   起点是「被拖的簇」—— 多选时是整队，拖托盘/成员时是托盘及其全部成员
 *   （一个托盘在拖动中本来就是一个整体，见 `containmentCluster`）。
 * - 数值（0.75 / 0.42）**不在这里**，本模块只判档位；实际明度由 CSS 的
 *   `--cs-dim-near` / `--cs-dim` 给出（`.csNodeNear` / `.csNodeDimmed`）。
 *
 * 纯函数、无 DOM、无 React：`node --test` 可直连 lib/canvas-lineage.js。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/**
 * 中间档边界：跳数恰好为 `NEAR_HOPS`(2) 的节点进中间档。
 *
 * 为什么是 2 而不是 1：DD-03 原版「1 跳亮、其余压暗」在真实画布上平均压暗 68%
 * （53 个拖动目标里 39 个压暗超过 70%），用户读到的是「一点就整屏变灰」。把
 * 一跳之外再留一档，实测平均压暗降到 28%、**没有一个目标超过 70%**。
 */
const NEAR_HOPS = 2

/** 跳数达到 `FAR_HOPS`(3) 及以上即进压暗档。 */
const FAR_HOPS = 3

/**
 * 中间档覆盖率上限。中间档占全画布超过这个比例时整体退到亮档
 * （等价于「只压无关」）。
 *
 * 为什么需要：星形项目的形状是「一个枢纽 + 一圈叶子」，叶子之间互为 2 跳 ——
 * 实测 `测试音乐` 里 22 张卡有 19 张会落进中间档（83%）。梯度在那个形状下没有
 * 区分度（哪里都降一档 = 整屏一起变闷），此时诚实的做法是不假装有梯度。
 */
const NEAR_COVERAGE_LIMIT = 0.7

/** 档位：`near`（中间档）/ `dim`（压暗档）。亮档不传，用 `undefined` 表示。 */
export type CanvasSpotlightTier = 'near' | 'dim'

/** 聚光计算结果。 */
export interface CanvasSpotlight {
  /** 是否启用景深压暗。**没有直接血缘留在亮档时为 false** —— 见下。 */
  readonly active: boolean
  /** 保持全亮的节点 id（被拖节点 + 其直接血缘 + 托盘簇）。 */
  readonly lit: ReadonlySet<string>
  /** 中间档节点 id（隔一层血缘）。 */
  readonly near: ReadonlySet<string>
  /** 压暗档节点 id（更远与无关）。 */
  readonly dim: ReadonlySet<string>
}

/** 空结果：拖动尚未真正开始、或安全阀拦下时返回它。 */
function inactive(): CanvasSpotlight {
  return { active: false, lit: new Set(), near: new Set(), dim: new Set() }
}

/** 托盘 → 成员表（`parentId` 指向托盘）。幽灵 parentId（指向已删节点）不会入表。 */
function membersOf(nodes: readonly StudioCanvasNode[]): Map<string, string[]> {
  const members = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentId === undefined) continue
    const list = members.get(node.parentId)
    if (list === undefined) members.set(node.parentId, [node.id])
    else list.push(node.id)
  }
  return members
}

/**
 * 被拖的「簇」：托盘与它的成员在**拖动中是一个整体**（成员随托盘平移、托盘包围盒
 * 跟着成员走），所以压暗必须同档 —— 否则会出现「亮托盘里套着灰成员」的断裂。
 * 实测：不加这条时「托盘与成员落进不同档」在真画布上出现 22 次。
 */
function containmentCluster(
  nodes: readonly StudioCanvasNode[],
  roots: readonly string[],
  members: Map<string, string[]>,
): Set<string> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const cluster = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.pop()
    if (id === undefined || cluster.has(id)) continue
    cluster.add(id)
    const node = byId.get(id)
    if (node === undefined) continue
    // 成员 → 自己所属的托盘；托盘 → 自己的全部成员。
    if (node.parentId !== undefined) queue.push(node.parentId)
    for (const child of members.get(id) ?? []) queue.push(child)
  }
  return cluster
}

/**
 * 血缘距离表：从被拖节点集合出发、沿 `sourceIds` **双向**走 BFS。
 * 未出现在表里的节点 = 与本次拖动没有任何血缘关系。
 */
function hopDistances(
  nodes: readonly StudioCanvasNode[],
  roots: readonly string[],
): Map<string, number> {
  const present = new Set(nodes.map(node => node.id))
  const neighbours = new Map<string, Set<string>>(nodes.map(node => [node.id, new Set<string>()]))
  for (const node of nodes) {
    for (const sourceId of node.sourceIds) {
      if (sourceId === node.id) continue
      const back = neighbours.get(sourceId)
      const self = neighbours.get(node.id)
      // 指向已删节点的 sourceId（幽灵血缘）只跳过它自己，不影响其余边。
      if (back === undefined || self === undefined || !present.has(sourceId)) continue
      self.add(sourceId)
      back.add(node.id)
    }
  }

  const hops = new Map<string, number>()
  for (const id of roots) hops.set(id, 0)
  let frontier = [...roots]
  let depth = 0
  while (frontier.length > 0) {
    depth += 1
    const next: string[] = []
    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (hops.has(other)) continue
        hops.set(other, depth)
        next.push(other)
      }
    }
    frontier = next
  }
  return hops
}

/**
 * 计算本次拖动的血缘聚光。
 *
 * **两道安全阀**（缺一条都会退化成「整屏变灰」）：
 *
 * ① 「必须有直接血缘留在亮档」：拖的簇之外若**一个 1 跳邻居都没有**，整张画布
 *    除自己以外全是压暗档，压暗揭示不了任何关系，用户看到的是「画面突然变暗」。
 *    这条挡住了两个最刺眼的场景：拖一张刚导入、还没连线的素材；拖一个自成一体、
 *    对外没有血缘的托盘。
 * ② 「中间档覆盖率上限」：见 `NEAR_COVERAGE_LIMIT`。
 *
 * 触发时机由调用方保证（**只有真正开始移动**才传 `draggingIds`）—— 单击选中不
 * 压暗。这不只是体验取舍：压暗的生命周期绑手势只有 `pointerup`/`pointercancel`
 * 两条出口，而选区有十几处写入点，绑选区正是 CV-171「松手不恢复」的成因。
 *
 * @param nodes 画布上的**可见**节点（调用方传 `visible !== false` 的那批；隐藏
 *              节点不参与，否则会点亮画布上根本看不见的节点 id）。
 * @param draggingIds 正在被拖的节点 id（多选时传整队）。
 * @returns 三个档位的节点 id 集合。
 */
export function canvasSpotlight(
  nodes: readonly StudioCanvasNode[],
  draggingIds: readonly string[],
): CanvasSpotlight {
  const present = new Set(nodes.map(node => node.id))
  const roots = draggingIds.filter(id => present.has(id))
  if (roots.length === 0) return inactive()

  const members = membersOf(nodes)
  // 先算簇，再**从整簇出发**走 BFS：拖一个托盘时，托盘自己对外没有血缘（它不是
  // 被生成的），但它的成员有 —— 从整簇出发才能把「托盘里那批图的来源」点亮，
  // 否则拖托盘会退化成「拖一个孤岛」，安全阀 ① 直接把它拦下、一格都不压暗。
  const cluster = containmentCluster(nodes, roots, members)
  const hops = hopDistances(nodes, [...cluster].filter(id => present.has(id)))

  // 安全阀 ①：簇之外必须至少有一个 1 跳邻居留在亮档。
  const hasBrightNeighbour = nodes.some(node =>
    !cluster.has(node.id) && (hops.get(node.id) ?? Number.POSITIVE_INFINITY) <= 1)
  if (!hasBrightNeighbour) return inactive()

  // 按距离分档（1 = 亮 / 2 = 中间 / 3 = 压暗）。
  const ladder = new Map<string, 1 | 2 | 3>()
  for (const node of nodes) {
    const depth = hops.get(node.id)
    if (depth === undefined || depth >= FAR_HOPS) ladder.set(node.id, 3)
    else if (depth >= NEAR_HOPS) ladder.set(node.id, 2)
    else ladder.set(node.id, 1)
  }

  // 托盘与成员取**最亮**档：托盘本身没有血缘（它不是被生成的），若按它自己的
  // 距离判档，一个装着「本次拖动的直接来源」的托盘会整体压暗 —— 把要紧的那张
  // 图一起压掉。取最亮档同时保证簇内不断裂。
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    const kids = members.get(node.id)
    if (kids === undefined || kids.length === 0) continue
    const family = [node.id, ...kids]
    // ⚠️ 初值必须是**最暗档**再取小：档位数值越小越亮，初值给 1 的话
    // 「value < brightest」永远不成立，整簇会被无条件抬成亮档（反向验证逮到过）。
    let brightest: 1 | 2 | 3 = 3
    for (const id of family) {
      const value = ladder.get(id) ?? 3
      if (value < brightest) brightest = value
    }
    for (const id of family) ladder.set(id, brightest)
  }

  // 安全阀 ②：中间档铺满整屏时，梯度不再有区分度 —— 整体退到亮档。
  const nearCount = [...ladder.values()].filter(value => value === 2).length
  if (nearCount > nodes.length * NEAR_COVERAGE_LIMIT) {
    for (const [id, value] of ladder) if (value === 2) ladder.set(id, 1)
  }

  const lit = new Set<string>()
  const near = new Set<string>()
  const dim = new Set<string>()
  for (const [id, value] of ladder) {
    if (value === 1) lit.add(id)
    else if (value === 2) near.add(id)
    else dim.add(id)
  }
  return { active: true, lit, near, dim }
}
