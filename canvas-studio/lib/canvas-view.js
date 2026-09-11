import { VIEW_DEFAULTS } from './contracts/canvas.js';
/** Zoom clamp range (matches the surface wheel/zoom clamp). */
export const MIN_VIEW_SCALE = 0.1;
export const MAX_VIEW_SCALE = 5;
/** Clamp a zoom factor into the supported range. */
export function clampViewScale(scale) {
    return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
}
/**
 * Coerce an unknown parsed `view` value into a safe viewport. Returns
 * `undefined` when the value is absent or not an object, so callers can
 * distinguish "no saved view" (fit content instead) from a default one.
 * Invalid individual fields fall back to their defaults; scale is clamped.
 */
export function normalizeCanvasView(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    const numberOr = (candidate, fallback) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
    const boolOr = (candidate, fallback) => typeof candidate === 'boolean' ? candidate : fallback;
    // P9.1 时间轴顺序：仅接受全字符串数组；非法（含混入非字符串）整体丢弃，
    // 客户端回退 createdAt 派生。
    const timeline = Array.isArray(raw.timeline) && raw.timeline.every(id => typeof id === 'string')
        ? raw.timeline
        : undefined;
    // CV-006 合成勾选态：与 timeline 同一容忍策略——非法整体丢弃，缺省 = 全部纳入/
    // 不使用 BGM（老文档零迁移）。引用悬空不在此校验（节点表不在这里），客户端解析。
    const composeExcluded = Array.isArray(raw.composeExcluded) && raw.composeExcluded.every(id => typeof id === 'string')
        ? raw.composeExcluded
        : undefined;
    const composeBgmNodeId = typeof raw.composeBgmNodeId === 'string' ? raw.composeBgmNodeId : undefined;
    return {
        x: numberOr(raw.x, VIEW_DEFAULTS.x),
        y: numberOr(raw.y, VIEW_DEFAULTS.y),
        scale: clampViewScale(numberOr(raw.scale, VIEW_DEFAULTS.scale)),
        layersOpen: boolOr(raw.layersOpen, VIEW_DEFAULTS.layersOpen),
        minimapVisible: boolOr(raw.minimapVisible, VIEW_DEFAULTS.minimapVisible),
        ...(timeline !== undefined ? { timeline } : {}),
        ...(composeExcluded !== undefined ? { composeExcluded } : {}),
        ...(composeBgmNodeId !== undefined ? { composeBgmNodeId } : {}),
    };
}
/**
 * P9.1 时间轴的有效顺序：优先持久化的 `timeline`（自动剔除已删除的节点 id），
 * 没入过列的节点（新建/旧文档）按 createdAt 追加在后。纯函数 —— Host 单测
 * 可直接跑，客户端渲染与 compose 的 clipIds 都以它为准。
 */
export function deriveTimelineOrder(nodes, timeline) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const ordered = [];
    const seen = new Set();
    if (timeline !== undefined) {
        for (const id of timeline) {
            if (seen.has(id))
                continue;
            const node = byId.get(id);
            if (node !== undefined) {
                ordered.push(node);
                seen.add(id);
            }
        }
    }
    for (const node of [...nodes].sort((left, right) => left.createdAt - right.createdAt)) {
        if (!seen.has(node.id)) {
            ordered.push(node);
            seen.add(node.id);
        }
    }
    return ordered;
}
/** Arrange-grid gaps between cells (canvas-space pixels). */
const ARRANGE_GAP_X = 48;
const ARRANGE_GAP_Y = 48;
const ARRANGE_ORIGIN = 40;
/**
 * Compute the auto-arrange layout: an overlap-free grid over top-level units
 * (nodes without a live parent), ordered by bloodline depth then creation
 * time. Group nodes travel with their children (relative offsets inside the
 * group are preserved), so a group's box keeps wrapping its members and no
 * two boxes can overlap regardless of user-resized sizes.
 * @returns the new canvas-space position per moved node id.
 */
export function computeArrangeLayout(nodes) {
    const positions = new Map();
    if (nodes.length === 0)
        return positions;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    // Bloodline depth (sourceIds/parentId chain length) keeps related nodes
    // adjacent in reading order; cycle-guarded like the store's depthOf.
    const depthOf = (node) => {
        let maxDepth = 0;
        const seen = new Set([node.id]);
        const queue = [
            ...node.sourceIds,
            ...(node.parentId !== undefined ? [node.parentId] : []),
        ].map((id) => ({ id, depth: 1 }));
        while (queue.length > 0) {
            const current = queue.shift();
            if (seen.has(current.id))
                continue;
            seen.add(current.id);
            maxDepth = Math.max(maxDepth, current.depth);
            const parent = byId.get(current.id);
            if (parent === undefined)
                continue;
            for (const next of [...parent.sourceIds, ...(parent.parentId !== undefined ? [parent.parentId] : [])]) {
                queue.push({ id: next, depth: current.depth + 1 });
            }
        }
        return maxDepth;
    };
    const units = [];
    const childrenByParent = new Map();
    for (const node of nodes) {
        if (node.parentId === undefined || !byId.has(node.parentId)) {
            units.push({ node, children: [], depth: depthOf(node) });
        }
        else {
            const siblings = childrenByParent.get(node.parentId) ?? [];
            siblings.push(node);
            childrenByParent.set(node.parentId, siblings);
        }
    }
    for (const unit of units) {
        unit.children = childrenByParent.get(unit.node.id) ?? [];
    }
    units.sort((left, right) => left.depth !== right.depth ? left.depth - right.depth : left.node.createdAt - right.node.createdAt);
    if (units.length === 0)
        return positions;
    // Cell size from the largest unit guarantees no overlap for any sizes.
    const cellWidth = Math.max(...units.map((unit) => unit.node.width)) + ARRANGE_GAP_X;
    const cellHeight = Math.max(...units.map((unit) => unit.node.height)) + ARRANGE_GAP_Y;
    // F4：按血缘深度分列 —— 源图层（depth 0，导入图/视频）落在最左列，生成
    // 目标层（depth 越大）依次向右排布，直观呈现「左父 → 右子」的工作流推进。
    // 同列内按 createdAt 纵向堆叠；组盒子与子图层跟随组的位移，保持包裹不重叠。
    const columnCursor = new Map();
    for (const unit of units) {
        const column = unit.depth;
        const row = columnCursor.get(column) ?? 0;
        columnCursor.set(column, row + 1);
        const targetX = ARRANGE_ORIGIN + column * cellWidth;
        const targetY = ARRANGE_ORIGIN + row * cellHeight;
        const deltaX = targetX - unit.node.x;
        const deltaY = targetY - unit.node.y;
        positions.set(unit.node.id, { x: targetX, y: targetY });
        for (const child of unit.children) {
            positions.set(child.id, { x: child.x + deltaX, y: child.y + deltaY });
        }
    }
    return positions;
}
