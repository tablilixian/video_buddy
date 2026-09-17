import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the node detail drawer. */
export interface NodeDetailDrawerProps {
    node: StudioCanvasNode;
    /** 当前项目全部节点：按 Drama filename 反查参考图缩略图。 */
    allNodes: readonly StudioCanvasNode[];
    /** 抽屉高度（px，设备级偏好，由上层持久化）。 */
    height: number;
    onHeightChange(height: number): void;
    onClose(): void;
    onRename(id: string, title: string): void;
    onSetOpacity(id: string, opacity: number): void;
    onToggleFlip(id: string, axis: 'flipX' | 'flipY'): void;
    onToggleLock(id: string): void;
    onToggleVisibility(id: string): void;
    onReorder(id: string, direction: 'front' | 'back'): void;
    onDelete(id: string): void;
    /** 节点级重试（同参数重新生成）。 */
    onRetry(id: string): void;
    /** 取消运行中的回合（loading 节点）。 */
    onCancel(id: string): void;
    /** 更新节点字段（正文 / 参考图角色 / 强度 / 生成参数）。 */
    onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void;
    /** 把该节点作为引用标记插入右侧聊天输入框。 */
    onReferenceToChat(node: StudioCanvasNode): void;
    /** CV-020：把节点的图片/视频/音频产物另存到本地。 */
    onDownload(node: StudioCanvasNode): void;
}
/**
 * 节点详情抽屉 —— 底部通栏、只占画布宽、底边贴时间轴顶边。
 *
 * ## 为什么从「右上角浮动卡」换成「底部抽屉」
 *
 * 旧面板是 `position: fixed; top: 64px; right: 12px`，与节点坐标**毫无关系**：
 * 节点在哪它都在右上角，离被查看的对象很远，还盖住宿主右栏的对话区。换成画布
 * 内的底部抽屉之后：位置由「画布的下边缘」决定（恒定、可预期），横向空间从
 * 320px 变成整个画布宽 —— 一行能读 60+ 字，提示词终于放得下。
 *
 * ## 信息架构：左身份 / 右内容 / 底操作
 *
 * 旧面板 15 行平铺同权，元信息与编辑项混在一起。这里按「读者要用它干什么」分栏：
 * 左栏只读（身份与变换，扫一眼确认「我选中的是什么」），右栏是可编辑的内容
 * （正文 / 提示词 / 参考图 / 参数），底栏是操作（危险项靠右）。
 */
export declare function NodeDetailDrawer(props: NodeDetailDrawerProps): import("react").JSX.Element;
