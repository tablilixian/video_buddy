import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Resize corners (grid of 9, center omitted). */
declare const RESIZE_CORNERS: readonly ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export type ResizeCorner = typeof RESIZE_CORNERS[number];
/** Props for a single canvas node box. */
export interface CanvasNodeProps {
    node: StudioCanvasNode;
    selected: boolean;
    /** CV-089：主被拖节点标记 —— 仅在拖动中被按下那个节点为 true；
     * 多选拖拽时区分「主」与「随从」成员，给主节点更明显的视觉。 */
    primary?: boolean;
    /**
     * DD-03：血缘聚光生效时，非血缘节点为 true —— 该节点交给 `.csNodeDimmed`
     * 压暗。判定口径在 `src/canvas-lineage.ts`（唯一实现），本组件只负责上色。
     */
    dimmed?: boolean;
    /**
     * C6：框选**进行中**的实时命中预览 —— 该节点与框选矩形相交但尚未松手。
     * 判定口径在 `src/canvas-geometry.ts` 的 `marqueeHitIds`（与松手落选同一份），
     * 本组件只负责上色（`.csNodeHit` 轻 accent 描边）。
     */
    hitPreview?: boolean;
    /**
     * C2：该片段在**成片序列**里的序号（1 起）。口径与底部时间轴同源 —— 都由
     * `src/shot-versions.ts` 的 `isShotClip` 筛出、按 `deriveTimelineOrder` 的顺序
     * 数号。undefined = 这个节点不进成片序列（关键帧 / 参考图 / 文案 / 音频 /
     * 已作废版本），不显示镜号 chip。
     *
     * 为什么不给每张卡都编号：产品里已有的两套编号都不可替代 ——
     * 标题里的「分镜 N」来自分镜卡、由生成血缘决定；时间轴上的序号是成片顺序、
     * 可被拖拽重排。再发明一套「按阶段数」的序位，会让同一张卡上出现三个
     * 互不相干的数字。镜号 chip 只回答一个问题：**它排在成片的第几段**。
     */
    shotIndex?: number;
    /** Begin a drag (also selects; multi-select via ctrl/cmd). */
    onNodePointerDown(event: React.PointerEvent, node: StudioCanvasNode): void;
    /** Begin a resize gesture. */
    onResizePointerDown(event: React.PointerEvent, node: StudioCanvasNode, corner: ResizeCorner): void;
    /** Begin a manual connection drag (S6). */
    onLinkPointerDown(event: React.PointerEvent, node: StudioCanvasNode): void;
    /** Commit an inline rename. */
    onRenameSubmit(id: string, title: string): void;
    /** CV-001：提交文本类节点（sticky/text/prompt）的内联正文编辑。 */
    onTextSubmit(id: string, text: string): void;
    /** 双击媒体类节点：打开详情 / 编辑面板（D1 方案 A：文本类双击=内联编辑）。 */
    onOpenDetail(node: StudioCanvasNode): void;
    /** CV-044：双击视频节点 —— 打开固定尺寸播放浮层（替代原生双击全屏）。 */
    onOpenPlayback?(node: StudioCanvasNode): void;
    /** CV-044 扩展：双击图片节点 —— 打开大图预览浮层（替代打开详情面板）。 */
    onOpenPreview?(node: StudioCanvasNode): void;
    /** Request the context menu at screen coordinates. */
    onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void;
    /** CV-018：失败节点就地重试（重放同参数生成）。 */
    onRetry(id: string): void;
    /**
     * CV-013/029：媒体加载后上报真实宽高（总是上报；分辨率回填与框比例校正
     * 的决策在 frame 侧统一处理）。加载失败（无真实尺寸）不上报。
     */
    onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void;
}
/**
 * One canvas node: media box or text annotation, placed at its canvas-space
 * coordinates. The surface owns pan/zoom/drag/resize gestures; this component
 * is presentational and reports pointer-downs with the intended gesture.
 * Visual state follows the reference LayerData semantics: locked (no drag),
 * loading overlay, error badge, opacity, flipX/flipY (media only), hidden
 * nodes are filtered by the surface.
 */
export declare function CanvasNodeInner(props: CanvasNodeProps): import("react").JSX.Element;
export declare const CanvasNode: import("react").MemoExoticComponent<typeof CanvasNodeInner>;
export {};
