import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js';
/** Props for the node action bar (the small toolbar floating next to the node). */
export interface NodeActionBarProps {
    node: StudioCanvasNode;
    view: StudioCanvasView;
    /** 画布可视区尺寸（屏幕 px）—— 锚定与夹取都要用它，不是 window 尺寸。 */
    viewport: {
        width: number;
        height: number;
    };
    /** 底部被详情抽屉遮住的高度（屏幕 px）；抽屉关着时为 0。 */
    bottomInset: number;
    /** 同参数重新生成（判据在 node-params.isReplayable，这里不另写一套）。 */
    onRetry?(id: string): void;
    /** 打开详情抽屉并编辑提示词（画布上「改提示词」的最短路径）。 */
    onEditPrompt?(node: StudioCanvasNode): void;
    /** 把该节点作为引用标记插入右侧聊天输入框。 */
    onReferenceToChat?(node: StudioCanvasNode): void;
}
/**
 * 就近操作条 —— 贴在**选中节点旁边**的小工具条，高频动作零视线跳转。
 *
 * ## 为什么渲染在 `.csCanvasLayer` 之外
 *
 * 画布层带 `transform: translate() scale()`，画在里面的东西会跟着缩放变形：比例
 * 0.3 时按钮文字糊成一团，2.0 时又比节点还大。工具条因此与 minimap 一样渲染在
 * 画布层的**兄弟层**，用 `nodeActionAnchor` 算出的屏幕坐标定位 —— 尺寸恒定，
 * 位置跟着节点走。
 *
 * ## 只有两个前提，其余交给判据
 *
 * 「出现条件」（单选 + 非手势中）由调用方 `CanvasSurface` 决定；「显示哪些按钮」
 * 由 `node-params` 的 `isReplayable` / `promptFieldsOf` 决定。本组件不自造判据 ——
 * 从前的重试按钮就是因为在详情面板里另写了一套「有 toolName + 有 generationPrompt」
 * 的判据，才会在音频 / 四视图 / 抽帧节点上出现却打不通。
 *
 * **一个动作都不给时整条退场**（托盘、无提示词的纯媒体节点、没传回调的调用方）：
 * 空药丸比没有工具条更糟 —— 它会占着节点上方那块地方，还让人以为点得动。
 */
export declare function NodeActionBar(props: NodeActionBarProps): import("react").JSX.Element | null;
