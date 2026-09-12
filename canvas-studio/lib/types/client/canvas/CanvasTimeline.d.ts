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
 * The review timeline（DD-04a：从等宽 chip 列表升维为真时间轴）。
 *
 * 三轨：视频轨（片段宽度 = 真实 duration 比例，可拖拽重排 + 勾选纳入合成）、
 * BGM 轨（音频资产按时长比例排布，点选即选定）、参考·产物轨（图片素材 +
 * 成片产物 + 失效版本，固定宽 chip——它们不属于合成序列，不参与比例布局）。
 * 标尺 + 可拖播放头：在标尺或轨道空白处按下即擦洗，播放头下的片段高亮
 * （isHot），松手时联动画布选中该片段。
 *
 * CV-006/007 语义不变：成片产物与失效版本不计入片段数 / 预计时长 / 布局
 * （CV-160：产物 ≠ 素材）；工具栏能力（BGM 下拉、显示全部、导出）原样保留。
 */
export declare function CanvasTimeline(props: CanvasTimelineProps): import("react").JSX.Element;
