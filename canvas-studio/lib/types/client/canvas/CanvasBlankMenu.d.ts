/**
 * CV-016：右键画布空白处的菜单 —— 在光标处新建便签/文本/提示、粘贴、适配视野。
 *
 * 与节点右键菜单同构：forwardRef 根元素挂 ref，配合 StudioFrame 的全局
 * mousedown 监听（命中菜单内部放行，见 `shouldKeepMenuOpen`）。
 */
export interface CanvasBlankMenuProps {
    /** 屏幕坐标（定位菜单）。 */
    x: number;
    y: number;
    /** 光标处的画布世界坐标（新建节点的落点）。 */
    worldX: number;
    worldY: number;
    onClose(): void;
    /** 在光标处新建节点。 */
    onCreateNode(kind: 'sticky' | 'text' | 'prompt'): void;
    /** 粘贴剪贴板节点。 */
    onPaste(): void;
    /** 适配视野（fitToContent）。 */
    onFit(): void;
}
export declare const CanvasBlankMenu: import("react").ForwardRefExoticComponent<CanvasBlankMenuProps & import("react").RefAttributes<HTMLDivElement>>;
