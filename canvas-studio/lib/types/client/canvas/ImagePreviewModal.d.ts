/**
 * CV-044 扩展：图片固定尺寸大图预览浮层（双击图片节点打开）。
 *
 * 与视频播放浮层对称：图片按真实分辨率渲染，上限 960px 宽 / 80% 视口高
 * （CSS 钳制，保持原始宽高比）；点关闭按钮、点浮层外背景、按 Escape 三种
 * 方式关闭。复用 csModalBackdrop/csModal 弹窗样式与 csVideoModalCard 的
 * 尺寸规则。
 *
 * CV-089：标题栏下挂一行元信息条（`${width}×${height} · mime`），让用户
 * 在预览时直接看到原图分辨率。宽高来自 `<img>.naturalWidth/Height`，加载
 * 前为空。
 */
export interface ImagePreviewModalProps {
    title: string;
    url: string;
    onClose(): void;
}
export declare function ImagePreviewModal(props: ImagePreviewModalProps): import("react").JSX.Element;
