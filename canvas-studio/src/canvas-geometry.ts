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
  const control = Math.abs(to.x - from.x) * 0.5
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`
}

/**
 * C6：框选命中判定 —— 世界坐标矩形与节点框**相交**的所有可见节点 id。
 *
 * 唯一口径：marquee 的**实时命中预览**（拖框中，CanvasSurface 的 move 分支）与
 * **松手落选**（up 分支）共用这一份实现。两边各写一份迟早分叉——预览说会选中
 * 三张、松手选中的是四张，这种不一致比没有预览更糟（CV-160 的教训：同一规则
 * 只准一份实现）。
 *
 * 「几乎没拖动」的单击判空（<2px）由调用方裁决：纯函数只回答几何问题，
 * 手势语义（单击 = 清选）留在 Surface。
 */
export function marqueeHitIds(
  nodes: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number; visible?: boolean }>,
  rect: { minX: number; maxX: number; minY: number; maxY: number },
): string[] {
  return nodes
    .filter(candidate => candidate.visible !== false
      && candidate.x < rect.maxX && candidate.x + candidate.width > rect.minX
      && candidate.y < rect.maxY && candidate.y + candidate.height > rect.minY)
    .map(candidate => candidate.id)
}
