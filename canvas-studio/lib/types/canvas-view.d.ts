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
/** 画布可视区尺寸（「适配视野」与「整理布局」共用的唯一口径）。 */
export interface CanvasViewport {
    width: number;
    height: number;
}
/** 适配视野时给内容留的边距 —— 画布与整理布局共用一份，避免两处各写一个数。 */
export declare const FIT_PADDING = 60;
/**
 * CV-185：**适配视野的缩放下限**。低于它，一张 260px 的卡只剩不到 78px，
 * 卡面已分不出是图还是文字，继续缩只是把内容变成一片色块 ——
 * 不如停在这个比例上让用户自己平移（真正想缩的人还有滚轮/缩放按钮）。
 */
export declare const FIT_MIN_SCALE = 0.3;
/** 适配视野的结果：视口位移、比例，以及「是否被下限挡住（内容大于视口）」。 */
export interface FitResult {
    x: number;
    y: number;
    scale: number;
    /** true = 按内容算出的比例低于 FIT_MIN_SCALE，已被抬到下限、内容会超出视口。 */
    clamped: boolean;
}
/**
 * CV-185：适配视野的**唯一实现**（原来这段数学写在 CanvasSurface 的 JSX 里，
 * 既没法单测，也没法被整理布局引用）。装得下就居中；装不下（比例被
 * FIT_MIN_SCALE 抬过）就**对齐内容左上角**—— 排完的布局是从左上开始读的，
 * 停在中间会让用户两头都要找。
 */
export declare function computeFitView(box: CanvasBox, viewport: CanvasViewport): FitResult;
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
/** 就近操作条与节点边缘的间距。 */
export declare const NODE_ACTION_GAP = 8;
/** 就近操作条与画布边缘的安全边距。 */
export declare const NODE_ACTION_MARGIN = 8;
/** 就近操作条的落点结果。 */
export interface NodeActionAnchorResult {
    /** 屏幕坐标：工具条左上角。`visible === false` 时无意义。 */
    x: number;
    y: number;
    /** 贴在节点上边缘之外（above）还是下边缘之外（below）。 */
    placement: 'above' | 'below';
    /** 节点与可视区是否相交 —— 完全在视野外时不该冒出工具条。 */
    visible: boolean;
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
export declare function nodeActionAnchor(box: CanvasBox, view: StudioCanvasView, viewport: CanvasViewport, bar: CanvasViewport, bottomInset?: number): NodeActionAnchorResult;
/**
 * P9.1 时间轴的有效顺序：优先持久化的 `timeline`（自动剔除已删除的节点 id），
 * 没入过列的节点（新建/旧文档）按 createdAt 追加在后。纯函数 —— Host 单测
 * 可直接跑，客户端渲染与 compose 的 clipIds 都以它为准。
 */
export declare function deriveTimelineOrder(nodes: readonly StudioCanvasNode[], timeline: readonly string[] | undefined): StudioCanvasNode[];
/**
 * Compute the auto-arrange layout: overlap-free columns over top-level units
 * (nodes without a live parent), ordered by **workflow stage** then creation
 * time. Group nodes travel with their children (relative offsets inside the
 * group are preserved), so a group's box keeps wrapping its members and no
 * two boxes can overlap regardless of user-resized sizes.
 *
 * Stage mapping (by toolName / kind):
 *   ① 创意 (user_brief) → ② 剧本 (write_screenplay) → ③ 分镜卡
 *   → ④ 参考图 → ⑤ 分镜视频 → ⑥ BGM/文案 → ⑦ 成片
 *
 * @param nodes 全部画布节点。
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
