import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the minimap overlay (drawn inside the surface, screen-space). */
export interface MinimapProps {
    nodes: readonly StudioCanvasNode[];
    offset: {
        x: number;
        y: number;
    };
    scale: number;
    onSetOffset(offset: {
        x: number;
        y: number;
    }): void;
    /** 画布表面容器实测尺寸（CV-003：三栏布局下不能用 window 尺寸居中）。 */
    viewportWidth: number;
    viewportHeight: number;
    /**
     * 画布表面「空白按下」通知 —— 用于把 minimap 这块被 stopPropagation 截断的
     * 区域也纳入「点空白清选」语义。否则：用户在小地图区域按下，pointerdown 被
     * minimap 截下不冒泡，画布容器的 `onSelectNode(null)` 永不触发，选区就一直
     * 挂着。回调先于 stopPropagation 执行，时序与画布容器的 onSurfacePointerDown
     * 等价。
     */
    onSurfacePointerDown?(): void;
}
/**
 * Content-fit minimap: every node as a colored rect, the current viewport as
 * a draggable frame. Click/drag jumps the canvas so the viewport centers on
 * the minimap position (reference Minimap behavior).
 */
export declare function Minimap(props: MinimapProps): import("react").JSX.Element;
