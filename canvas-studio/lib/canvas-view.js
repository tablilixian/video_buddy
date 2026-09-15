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
 * CV-184：把一个世界坐标包围盒「带进视野」所需的**视图平移量**（不改缩放）。
 *
 * 屏幕坐标 = 世界坐标 × scale + view 偏移。轴向两端都不够就贴边，够就 0 ——
 * 返回的位移量因此是**最小值**：只在真的看不到时才动镜头，且动得刚好够。
 *
 * 比视野还大的盒子（放大后的关键帧很常见）不能贴边（贴边等于整个挪出去），
 * 规则改为：与可视区**完全不相交**才居中，否则不动 —— 用户已经在看它了。
 *
 * 纯函数，Host 与 client 共用，可直接单测。
 */
export function revealOffsetOf(box, view, viewport, padding = 48) {
    const axis = (worldStart, worldSize, offset, extent) => {
        const scaled = worldSize * view.scale;
        const screenStart = worldStart * view.scale + offset;
        const screenEnd = screenStart + scaled;
        const span = extent - padding * 2;
        if (scaled > span) {
            const intersects = screenStart < extent - padding && screenEnd > padding;
            if (intersects)
                return 0;
            return extent / 2 - (worldStart + worldSize / 2) * view.scale - offset;
        }
        if (screenStart < padding)
            return padding - screenStart;
        if (screenEnd > extent - padding)
            return extent - padding - screenEnd;
        return 0;
    };
    return {
        dx: axis(box.x, box.width, view.x, viewport.width),
        dy: axis(box.y, box.height, view.y, viewport.height),
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
/* ===================== CV-177：托盘（素材组）几何与排版 =====================
   托盘 = kind='group' 的容器节点，成员靠 parentId 挂进来（CV-079 自动编组 /
   手动编组）。几何与排版收在这一份纯函数里，Host（生成时自动编组）与 client
   （手动编组 / 整理托盘 / 载入规范化）都调这里 —— 改前是两处各算一遍
   （generate.ts 的 GROUP_PADDING 与 project-store 里硬编码的 -12 / +24），
   只要加一条抓取带就会当场分叉。 */
/** 托盘内边距：成员四周留白（canvas 空间像素）。 */
export const GROUP_PADDING = 12;
/**
 * 托盘顶部抓取带高度。组框**没有 resize 把手**（showResize 只给媒体节点），
 * 所以「哪里能按住托盘拖」只能由代码保证 —— 这条 24px 的带子就是答案：
 * 不管托盘里是一张还是多张，缩放多少，顶部永远有一块可抓区。
 */
export const GROUP_HEAD_HEIGHT = 24;
/** 「整理托盘」时成员之间的间距。 */
export const GROUP_TIDY_GAP = 12;
/**
 * 成员包围盒 → 托盘几何：四周留 GROUP_PADDING，顶部再让出 GROUP_HEAD_HEIGHT
 * 的抓取带。空成员返回 null（由调用方决定怎么处理）。
 */
export function groupBoxOf(members) {
    if (members.length === 0)
        return null;
    const minX = Math.min(...members.map(member => member.x));
    const minY = Math.min(...members.map(member => member.y));
    const maxX = Math.max(...members.map(member => member.x + member.width));
    const maxY = Math.max(...members.map(member => member.y + member.height));
    return {
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - GROUP_HEAD_HEIGHT,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEAD_HEIGHT,
    };
}
/**
 * 载入清洗：托盘几何只**扩张**不收缩。两件事一次做完：
 * ① 旧文档的托盘是按「成员包围盒 + 12px」存盘的，没有抓取带的位置 ——
 *    一亮相就补齐 24px，否则绘制出来的头部带会压住成员顶部；
 * ② 成员被单独拖到框外时，框重新包住它 —— 与 attachShotGroup「只扩张」
 *    的既有语义一致，不引入新解释。
 * 收缩是**用户的显式动作**，只走「整理托盘」（tidyGroupLayout）。
 */
export function normalizeGroupBoxes(nodes) {
    if (!nodes.some(node => node.kind === 'group'))
        return [...nodes];
    const membersByParent = new Map();
    for (const node of nodes) {
        if (node.parentId === undefined)
            continue;
        const list = membersByParent.get(node.parentId);
        if (list === undefined)
            membersByParent.set(node.parentId, [node]);
        else
            list.push(node);
    }
    return nodes.map(node => {
        if (node.kind !== 'group')
            return node;
        const box = groupBoxOf(membersByParent.get(node.id) ?? []);
        if (box === null)
            return node;
        const minX = Math.min(node.x, box.x);
        const minY = Math.min(node.y, box.y);
        const maxX = Math.max(node.x + node.width, box.x + box.width);
        const maxY = Math.max(node.y + node.height, box.y + box.height);
        const grown = minX !== node.x || minY !== node.y
            || maxX !== node.x + node.width || maxY !== node.y + node.height;
        return grown ? { ...node, x: minX, y: minY, width: maxX - minX, height: maxY - minY } : node;
    });
}
/**
 * 单成员托盘：拖这个成员 == 拖它的托盘。
 *
 * 为什么需要：托盘的可抓区是成员四周的边环（12px）加顶部抓取带，缩放到 50%
 * 时边环只剩 6px，用户实际只能按住成员图片 —— 而 store.moveNode 的跟随规则
 * 只有一条（parentId === id），拖成员只动成员自己，于是「图片被拖出托盘、
 * 托盘原地不动」。多成员托盘保留「成员可单独拖走」（确认过的语义），被拖
 * 出去的成员靠「整理托盘」收回。
 *
 * @returns 组内只有这一个成员时返回该托盘，否则 undefined。
 */
export function singleMemberGroupOf(nodes, node) {
    if (node.parentId === undefined)
        return undefined;
    const group = nodes.find(candidate => candidate.id === node.parentId && candidate.kind === 'group');
    if (group === undefined)
        return undefined;
    const memberCount = nodes.filter(candidate => candidate.parentId === group.id).length;
    return memberCount === 1 ? group : undefined;
}
/**
 * 「整理托盘」：以**托盘左上角为锚**，把成员按当前阅读顺序重排成网格 ——
 * ≤3 张排一行，更多则列数取 ceil(sqrt(n))（接近正方形）；格子尺寸取成员的
 * 最大宽 / 最大高，格内居中，间距 GROUP_TIDY_GAP。
 *
 * 锚在托盘而不是成员包围盒上，有三个后果，都是要的：
 * ① 被单独拖出托盘的成员会被**收回**（这就是多成员托盘的「复位」路径）；
 * ② 只有一张时，「整理」= 把它放回托盘内的标准位置，幂等；
 * ③ 返回的 box 由新位置重算，所以整理后托盘必定恰好贴合 —— 画布上**唯一**
 *    能收缩托盘的路径（其余路径只扩张）。
 */
export function tidyGroupLayout(group, members) {
    const positions = new Map();
    if (members.length === 0)
        return { positions, box: null };
    const ordered = readingOrder(members);
    const columns = ordered.length <= 3 ? ordered.length : Math.ceil(Math.sqrt(ordered.length));
    const cellWidth = Math.max(...ordered.map(member => member.width));
    const cellHeight = Math.max(...ordered.map(member => member.height));
    const originX = group.x + GROUP_PADDING;
    const originY = group.y + GROUP_PADDING + GROUP_HEAD_HEIGHT;
    ordered.forEach((member, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        positions.set(member.id, {
            x: originX + column * (cellWidth + GROUP_TIDY_GAP) + (cellWidth - member.width) / 2,
            y: originY + row * (cellHeight + GROUP_TIDY_GAP) + (cellHeight - member.height) / 2,
        });
    });
    const moved = members.map(member => {
        const position = positions.get(member.id);
        return position === undefined ? member : { ...member, x: position.x, y: position.y };
    });
    return { positions, box: groupBoxOf(moved) };
}
/**
 * 阅读顺序：先按 y 分「行」（**垂直区间有重叠**即同一行），行内按 x，最后用
 * createdAt 兜底。不按「y 完全相等」判行 —— 手工摆过的成员几乎不可能对齐，
 * 只有按垂直重叠分簇才能把视觉上的一行认出来。
 */
function readingOrder(members) {
    const sorted = [...members].sort((left, right) => left.y - right.y || left.x - right.x);
    const rows = [];
    let rowTop = 0;
    let rowBottom = 0;
    for (const member of sorted) {
        const row = rows[rows.length - 1];
        if (row !== undefined && member.y < rowBottom && member.y + member.height > rowTop) {
            row.push(member);
            rowTop = Math.min(rowTop, member.y);
            rowBottom = Math.max(rowBottom, member.y + member.height);
            continue;
        }
        rows.push([member]);
        rowTop = member.y;
        rowBottom = member.y + member.height;
    }
    return rows.flatMap(row => row.sort((left, right) => left.x - right.x || left.createdAt - right.createdAt));
}
