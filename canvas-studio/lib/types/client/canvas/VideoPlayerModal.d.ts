/**
 * CV-044：视频固定尺寸播放浮层（双击视频节点打开）。
 *
 * 背景：画布上的 <video> 用 Chromium 原生控件时，「双击=元素全屏」是 shadow
 * DOM 内部 C++ 路径触发，既不经过 JS 的 requestFullscreen，也非可取消默认动作，
 * 无法用 preventDefault / 覆盖 requestFullscreen 拦截（实测均无效）。唯一可靠
 * 手段是去掉原生 controls。这里浮层播放器同样不挂 controls，改为「点击画面
 * 切换播放/暂停」+ 居中状态图标，彻底避免任何全屏发生。
 */
export interface VideoPlayerModalProps {
    title: string;
    url: string;
    onClose(): void;
}
export declare function VideoPlayerModal(props: VideoPlayerModalProps): import("react").JSX.Element;
