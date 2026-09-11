import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the bottom review/timeline strip. */
export interface CanvasTimelineProps {
    /** 已按有效顺序排好的条目（调用方经 deriveTimelineOrder 派生）。 */
    ordered: readonly StudioCanvasNode[];
    selectedNodeId: string | null;
    /** Select a node from the strip (also used to jump/center it on the surface). */
    onSelect(id: string): void;
    /** P9.1：拖拽重排完成，回调整条的完整 id 顺序（由父级写入 view.timeline）。 */
    onReorder(ids: string[]): void;
    /** P9.3：调合成路由导出成片（≥1 个有效片段即可：1 个 = 一镜整出，CV-141 解禁）。 */
    onCompose(): void;
    /** P9.3：合成进行中（禁用按钮 + 文案）。 */
    composeBusy: boolean;
    /** CV-006：实际将参与合成的有效片段数（排除勾选与作废片段已剔除）。 */
    composeClipCount: number;
    /** CV-007：预计成片时长（Σ 有效纳入片段真值 duration，秒）。 */
    composeEstSeconds: number;
    /** CV-006：BGM 短于预计成片的软提示（不拦，服务端守卫兜底）。 */
    composeWarnings: readonly string[];
    /** CV-006：用户显式排除的片段 id（view.composeExcluded）。 */
    composeExcluded: readonly string[];
    /** CV-006：解析后仍有效的 BGM 节点 id（失效引用已由父级回退 undefined）。 */
    composeBgmNodeId?: string | undefined;
    /** CV-006：切换片段纳入/排除态。 */
    onToggleComposeExcluded(id: string): void;
    /** CV-006：选定/取消 BGM（undefined = 不使用）。 */
    onComposeBgmChange(nodeId: string | undefined): void;
}
/**
 * The review strip: every node of the project as a thumbnail chip. Clicking a
 * chip selects the node and (via the parent) centers it on the surface — this
 * is the "回看" entry point. P9.1: chips are drag-reorderable; the resulting
 * order persists via view.timeline and later feeds compose 的 clipIds。
 *
 * CV-006/007：默认只显媒体（image/video/audio，可切「显示全部」回看便签等）；
 * video chip 带纳入/排除勾选区（作废片段禁用），工具栏提供 BGM 下拉（仅存活
 * 音频节点）与预计成片总时长。
 */
export declare function CanvasTimeline(props: CanvasTimelineProps): import("react").JSX.Element;
