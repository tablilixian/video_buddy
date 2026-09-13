import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the layer list panel. */
export interface LayerPanelProps {
    nodes: readonly StudioCanvasNode[];
    selectedNodeIds: readonly string[];
    onSelect(id: string, multi: boolean): void;
    /** 按类型 / 反选 / 清除：传入的 id 集合**整体替换**当前选区（走 store.selectNodes）。 */
    onSelectIds(ids: readonly string[]): void;
    onDelete(ids: string[]): void;
    onToggleLock(id: string): void;
    onToggleVisibility(id: string): void;
    onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void;
}
/**
 * The layer list: every node as a row with thumbnail/kind, lock and visibility
 * toggles, z-order buttons, and delete. Click selects (ctrl/cmd multi-select);
 * group members indent under their group row. The header carries type-based
 * selection (marquee box-select was retired) plus invert/clear. Rendered with
 * the DSH theme tokens.
 */
export declare function LayerPanel(props: LayerPanelProps): import("react").JSX.Element;
