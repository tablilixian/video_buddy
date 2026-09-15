/**
 * Pure canvas-view helpers shared by the Host persistence layer and the
 * browser store: viewport validation for `canvas.json` v3 documents and the
 * overlap-free auto-arrange grid. Kept free of runtime imports so the Host
 * tsc emit (`lib/canvas-view.js`) is directly testable under `node --test`.
 */
import type { StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js';
/** Zoom clamp range (matches the surface wheel/zoom clamp). */
export declare const MIN_VIEW_SCALE = 0.1;
export declare const MAX_VIEW_SCALE = 5;
/** Clamp a zoom factor into the supported range. */
export declare function clampViewScale(scale: number): number;
/**
 * Coerce an unknown parsed `view` value into a safe viewport. Returns
 * `undefined` when the value is absent or not an object, so callers can
 * distinguish "no saved view" (fit content instead) from a default one.
 * Invalid individual fields fall back to their defaults; scale is clamped.
 */
export declare function normalizeCanvasView(value: unknown): StudioCanvasView | undefined;
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
export declare function revealOffsetOf(box: {
    x: number;
    y: number;
    width: number;
    height: number;
}, view: StudioCanvasView, viewport: {
    width: number;
    height: number;
}, padding?: number): {
    dx: number;
    dy: number;
};
/**
 * P9.1 时间轴的有效顺序：优先持久化的 `timeline`（自动剔除已删除的节点 id），
 * 没入过列的节点（新建/旧文档）按 createdAt 追加在后。纯函数 —— Host 单测
 * 可直接跑，客户端渲染与 compose 的 clipIds 都以它为准。
 */
export declare function deriveTimelineOrder(nodes: readonly StudioCanvasNode[], timeline: readonly string[] | undefined): StudioCanvasNode[];
/**
 * Compute the auto-arrange layout: an overlap-free grid over top-level units
 * (nodes without a live parent), ordered by bloodline depth then creation
 * time. Group nodes travel with their children (relative offsets inside the
 * group are preserved), so a group's box keeps wrapping its members and no
 * two boxes can overlap regardless of user-resized sizes.
 * @returns the new canvas-space position per moved node id.
 */
export declare function computeArrangeLayout(nodes: readonly StudioCanvasNode[]): Map<string, {
    x: number;
    y: number;
}>;
/** 托盘内边距：成员四周留白（canvas 空间像素）。 */
export declare const GROUP_PADDING = 12;
/**
 * 托盘顶部抓取带高度。组框**没有 resize 把手**（showResize 只给媒体节点），
 * 所以「哪里能按住托盘拖」只能由代码保证 —— 这条 24px 的带子就是答案：
 * 不管托盘里是一张还是多张，缩放多少，顶部永远有一块可抓区。
 */
export declare const GROUP_HEAD_HEIGHT = 24;
/** 「整理托盘」时成员之间的间距。 */
export declare const GROUP_TIDY_GAP = 12;
/** 矩形盒（canvas 空间）。 */
export interface CanvasBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * 成员包围盒 → 托盘几何：四周留 GROUP_PADDING，顶部再让出 GROUP_HEAD_HEIGHT
 * 的抓取带。空成员返回 null（由调用方决定怎么处理）。
 */
export declare function groupBoxOf(members: readonly StudioCanvasNode[]): CanvasBox | null;
/**
 * 载入清洗：托盘几何只**扩张**不收缩。两件事一次做完：
 * ① 旧文档的托盘是按「成员包围盒 + 12px」存盘的，没有抓取带的位置 ——
 *    一亮相就补齐 24px，否则绘制出来的头部带会压住成员顶部；
 * ② 成员被单独拖到框外时，框重新包住它 —— 与 attachShotGroup「只扩张」
 *    的既有语义一致，不引入新解释。
 * 收缩是**用户的显式动作**，只走「整理托盘」（tidyGroupLayout）。
 */
export declare function normalizeGroupBoxes(nodes: readonly StudioCanvasNode[]): StudioCanvasNode[];
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
export declare function singleMemberGroupOf(nodes: readonly StudioCanvasNode[], node: StudioCanvasNode): StudioCanvasNode | undefined;
/** 「整理托盘」的结果：成员新位置 + 整理后的托盘几何。 */
export interface TidyGroupResult {
    positions: Map<string, {
        x: number;
        y: number;
    }>;
    box: CanvasBox | null;
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
export declare function tidyGroupLayout(group: StudioCanvasNode, members: readonly StudioCanvasNode[]): TidyGroupResult;
