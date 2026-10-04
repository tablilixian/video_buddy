/**
 * Pure canvas geometry helpers shared by the browser UI and the node smoke
 * tests. Kept free of runtime imports so the Host tsc emit
 * (`lib/canvas-geometry.js`) is directly testable under `node --test`.
 *
 * 历史背景（CV-038）：正式边与「拖拽中的起草线」原本各自算路径 —— 正式边
 * 从来源节点**右缘中点**出发走三次贝塞尔，起草线则从**指针按下位置**出发
 * 走直线。结果是连线落定瞬间，线条的起点和曲率都会跳变。现在两者共用本
 * 模块，起草线所见即落定所得。
 */

/** A point in canvas (world) coordinates. */
export interface Point {
  x: number
  y: number
}

/** Minimal box contract — avoids depending on the full node type. */
export interface BoxLike {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 边的**出发点**：来源节点的右缘中点。
 * 与 `CanvasEdges` 的正式锚点严格一致，起草线必须复用它。
 */
export function sourceAnchor(box: BoxLike): Point {
  return { x: box.x + box.width, y: box.y + box.height / 2 }
}

/**
 * 边的**落点**：目标节点的左缘中点。
 * 起草线拖拽过程中目标尚未确定，此时落点是光标的世界坐标。
 */
export function targetAnchor(box: BoxLike): Point {
  return { x: box.x, y: box.y + box.height / 2 }
}

/**
 * 三次贝塞尔控制点的水平外扩量 —— buildEdgePath 与 edgeControlBounds 共用
 * 同一份，路径形状与外包盒两条结论不可能各自漂移（同一规则只准一份实现）。
 */
function edgeControlSpan(from: Point, to: Point): number {
  return Math.abs(to.x - from.x) * 0.5
}

/**
 * 三次贝塞尔路径，水平方向外扩控制点 —— 与正式边逐字一致。
 *
 * 控制点偏移量取水平距离的一半：两点越远，曲线外扩越明显；纵向落差由
 * 贝塞尔自然吸收，因此上下错位的节点也能连出平滑曲线而非折线。
 *
 * @param from 出发点（右缘中点）
 * @param to 落点（左缘中点，或拖拽中的光标世界坐标）
 * @returns SVG `path` 的 `d` 属性
 */
export function buildEdgePath(from: Point, to: Point): string {
  const control = edgeControlSpan(from, to)
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`
}

/**
 * A-2 步骤二：边的**绘制外包盒** = 三次贝塞尔控制点的包围盒。
 *
 * 曲线恒在控制点凸包内，控制点包围盒就是它的保守上界，视口裁剪据此粗剔除：
 * 整盒落在可视区外的边不可能有任何一段画进屏幕。控制点只做水平外扩
 * （y 与端点相同，y 区间即端点 y 区间）；**反向边**（目标在来源左侧）的
 * 控制点越过两端各半个跨度，盒随之放宽。不含描边 / 箭头宽度 —— 调用方
 * 在可视区一侧自行外扩余量。
 */
export function edgeControlBounds(from: Point, to: Point): { x: number; y: number; width: number; height: number } {
  const span = edgeControlSpan(from, to)
  const left = Math.min(from.x, to.x, from.x + span, to.x - span)
  const right = Math.max(from.x, to.x, from.x + span, to.x - span)
  const top = Math.min(from.y, to.y)
  const bottom = Math.max(from.y, to.y)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
