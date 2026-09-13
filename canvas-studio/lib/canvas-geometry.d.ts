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
    x: number;
    y: number;
}
/** Minimal box contract — avoids depending on the full node type. */
export interface BoxLike {
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * 边的**出发点**：来源节点的右缘中点。
 * 与 `CanvasEdges` 的正式锚点严格一致，起草线必须复用它。
 */
export declare function sourceAnchor(box: BoxLike): Point;
/**
 * 边的**落点**：目标节点的左缘中点。
 * 起草线拖拽过程中目标尚未确定，此时落点是光标的世界坐标。
 */
export declare function targetAnchor(box: BoxLike): Point;
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
export declare function buildEdgePath(from: Point, to: Point): string;
