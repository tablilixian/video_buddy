/**
 * Shared canvas-node wire types for the Canvas Studio host persistence and the
 * browser client. Pure types only: both halves import them and erase them at
 * build time, so this file never appears in the runtime bundles.
 *
 * The shape mirrors the WL-AI-Director `LayerData` model (see plan §7.2 and
 * docs/plans/canvas-studio-reference-integration.md S1) extended with the
 * fields Canvas Studio renders: visual state (locked/visible/opacity/zIndex),
 * generation provenance (operationType/generationPrompt/duration), transient
 * generation state (isLoading/progress/error), and grouping (parentId).
 * Bloodline is derived from `sourceIds` at render time — there is no separate
 * edge table (plan §7.3: bloodline IS the edge).
 */
/** Current canvas document version (3: persisted viewport/panel state). */
export const CANVAS_DOCUMENT_VERSION = 3;
/** Viewport defaults used when a document predates v3 or a field is invalid. */
export const VIEW_DEFAULTS = {
    x: 0,
    y: 0,
    scale: 1,
    // 验收反馈（2026-08-24）：面板默认收起，画布默认最大化内容区。
    layersOpen: false,
    minimapVisible: false,
};
/** Defaults applied when migrating nodes that predate a field. */
export const NODE_DEFAULTS = {
    locked: false,
    visible: true,
    opacity: 1,
    flipX: false,
    flipY: false,
};
/**
 * CV-023/025：用户首条创意节点的 toolName 标记。客户端（幂等去重）与 Host
 * （分镜/文案节点自动挂接创意血缘、落位）共用同一常量。
 */
export const BRIEF_NODE_TOOL = 'user_brief';
