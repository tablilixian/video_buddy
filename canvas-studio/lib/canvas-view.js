import { VIEW_DEFAULTS } from './contracts/canvas.js';
/** Zoom clamp range (matches the surface wheel/zoom clamp). */
export const MIN_VIEW_SCALE = 0.1;
export const MAX_VIEW_SCALE = 5;
/** Clamp a zoom factor into the supported range. */
export function clampViewScale(scale) {
    return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
}
/** 适配视野时给内容留的边距 —— 画布与整理布局共用一份，避免两处各写一个数。 */
export const FIT_PADDING = 60;
/**
 * CV-185：**适配视野的缩放下限**。低于它，一张 260px 的卡只剩不到 78px，
 * 卡面已分不出是图还是文字，继续缩只是把内容变成一片色块 ——
 * 不如停在这个比例上让用户自己平移（真正想缩的人还有滚轮/缩放按钮）。
 */
export const FIT_MIN_SCALE = 0.3;
/** 内容盒放进可视区能放到多大（不含上下限）。 */
function rawFitScale(box, viewport) {
    const usableWidth = Math.max(1, viewport.width - FIT_PADDING * 2);
    const usableHeight = Math.max(1, viewport.height - FIT_PADDING * 2);
    return Math.min(usableWidth / Math.max(1, box.width), usableHeight / Math.max(1, box.height));
}
/**
 * CV-185：适配视野的**唯一实现**（原来这段数学写在 CanvasSurface 的 JSX 里，
 * 既没法单测，也没法被整理布局引用）。装得下就居中；装不下（比例被
 * FIT_MIN_SCALE 抬过）就**对齐内容左上角**—— 排完的布局是从左上开始读的，
 * 停在中间会让用户两头都要找。
 */
export function computeFitView(box, viewport) {
    const raw = rawFitScale(box, viewport);
    const scale = clampViewScale(Math.max(raw, FIT_MIN_SCALE));
    const clamped = raw < FIT_MIN_SCALE;
    if (clamped) {
        return { x: FIT_PADDING - box.x * scale, y: FIT_PADDING - box.y * scale, scale, clamped };
    }
    return {
        x: viewport.width / 2 - (box.x + box.width / 2) * scale,
        y: viewport.height / 2 - (box.y + box.height / 2) * scale,
        scale,
        clamped,
    };
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
/** 把值夹进 [min, max]（max < min 时取 min —— 窗口比控件还小时不许倒挂）。 */
function clampTo(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
/** 就近操作条与节点边缘的间距。 */
export const NODE_ACTION_GAP = 8;
/** 就近操作条与画布边缘的安全边距。 */
export const NODE_ACTION_MARGIN = 8;
/**
 * 就近操作条（节点工具条）的**屏幕几何唯一实现**。
 *
 * 为什么必须有这个纯函数：工具条渲染在 `.csCanvasLayer` **之外**（与 minimap 同层），
 * 尺寸因此不随画布缩放变形 —— 位置只能由「节点矩形 × 视图变换」现算；而「贴顶翻到
 * 下方、贴边往里夹、别落进抽屉」这三条边界一旦写进 JSX 就既没法单测、也会在下一处
 * 复用（比如 hover 卡）时被抄成第二份。屏幕坐标 = 世界坐标 × scale + view 偏移，
 * 与 `revealOffsetOf` 同一约定。
 *
 * @param box 节点在**画布坐标**下的矩形。
 * @param bar 工具条自身尺寸（屏幕 px，实测后回填）。
 * @param bottomInset 底部被抽屉遮住的高度（屏幕 px）—— 工具条不得落进抽屉里。
 */
export function nodeActionAnchor(box, view, viewport, bar, bottomInset = 0) {
    const left = box.x * view.scale + view.x;
    const top = box.y * view.scale + view.y;
    const width = box.width * view.scale;
    const height = box.height * view.scale;
    const visible = left < viewport.width && top < viewport.height
        && left + width > 0 && top + height > 0;
    // 可用纵向区间：上留 margin，下边再让开抽屉占掉的那一段。
    // maxY 走 max 兜底：窄窗口下抽屉可能比画布还高，区间会倒挂 —— 贴顶是最不坏的位置。
    const minY = NODE_ACTION_MARGIN;
    const maxY = Math.max(minY, viewport.height - bottomInset - bar.height - NODE_ACTION_MARGIN);
    // 默认贴节点**上缘**之外（视线沿卡面往上读，不挡画面）；上方装不下才翻到下方。
    // 判据用 `above >= minY` 而不是「节点是否贴顶」：后者漏掉「工具条本身比上方空间高」。
    const above = top - NODE_ACTION_GAP - bar.height;
    const placement = above >= minY ? 'above' : 'below';
    const y = clampTo(placement === 'above' ? above : top + height + NODE_ACTION_GAP, minY, maxY);
    // 横向：与节点同轴居中，两端夹在安全边距内（工具条比可视区还宽时贴左边距）。
    const maxX = Math.max(NODE_ACTION_MARGIN, viewport.width - NODE_ACTION_MARGIN - bar.width);
    const x = clampTo(left + width / 2 - bar.width / 2, NODE_ACTION_MARGIN, maxX);
    return { x, y, placement, visible };
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
/** 制作流程阶段编号（越大越靠右）。未识别的 toolName 归入阶段 0（最左）。 */
function stageOf(node) {
    switch (node.toolName) {
        case 'user_brief': return 1; // ① 创意
        case 'write_screenplay': return 2; // ② 剧本
        case 'submit_storyboard_for_approval': return 3; // ③ 分镜卡
        case 'write_script': return 6; // ⑥ 文案
        case 'music_generation': return 6; // ⑥ BGM
        case 'compose': return 7; // ⑦ 成片
        default: break;
    }
    if (node.kind === 'image' && node.isReference)
        return 4; // ④ 参考图
    if (node.kind === 'video' && node.toolName !== 'compose')
        return 5; // ⑤ 分镜视频
    if (node.kind === 'audio')
        return 6; // ⑥ 音频
    return 0;
}
/**
 * group 节点按**子节点**推断阶段：取子节点中 stage 最大的值。
 * group 通常包裹分镜视频素材，子节点是 video_composite（stage 5），
 * 所以 group 应归入阶段 ⑤ 而非 sourceIds 指向的分镜卡（stage 3）。
 */
function stageOfGroup(node, children) {
    if (node.kind !== 'group')
        return stageOf(node);
    if (children.length === 0)
        return stageOf(node);
    let maxStage = 0;
    for (const child of children) {
        const s = stageOf(child);
        if (s > maxStage)
            maxStage = s;
    }
    return maxStage > 0 ? maxStage : stageOf(node);
}
/**
 * Compute the auto-arrange layout: overlap-free columns over top-level units
 * (nodes without a live parent), ordered by **workflow stage** then creation
 * time. Group nodes travel with their children (relative offsets inside the
 * group are preserved), so a group's box keeps wrapping its members and no
 * two boxes can overlap regardless of user-resized sizes.
 *
 * Stage mapping (by toolName / kind):
 *   ① 创意 (user_brief) → ② 剧本 (write_screenplay) → ③ 分镜卡
 *   → ④ 参考图 → ⑤ 分镜视频 → ⑥ BGM/文案 → ⑦ 成片
 *
 * @param nodes 全部画布节点。
 * @returns the new canvas-space position per moved node id.
 */
export function computeArrangeLayout(nodes) {
    const positions = new Map();
    if (nodes.length === 0)
        return positions;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    // Identify top-level units (no live parent) and group children with them.
    const units = [];
    const childrenByParent = new Map();
    for (const node of nodes) {
        if (node.parentId === undefined || !byId.has(node.parentId)) {
            units.push({ node, children: [], stage: 0 });
        }
        else {
            const siblings = childrenByParent.get(node.parentId) ?? [];
            siblings.push(node);
            childrenByParent.set(node.parentId, siblings);
        }
    }
    for (const unit of units) {
        unit.children = childrenByParent.get(unit.node.id) ?? [];
        unit.stage = stageOfGroup(unit.node, unit.children);
    }
    // Sort by stage (ascending), then by createdAt within each stage.
    units.sort((left, right) => left.stage !== right.stage ? left.stage - right.stage : left.node.createdAt - right.node.createdAt);
    if (units.length === 0)
        return positions;
    // Row height unified (max unit height + gap) for horizontal alignment.
    const cellHeight = Math.max(...units.map((unit) => unit.node.height)) + ARRANGE_GAP_Y;
    // Group units by stage (sparse array: index = stage).
    const stageBands = [];
    for (const unit of units) {
        const band = stageBands[unit.stage];
        if (band === undefined)
            stageBands[unit.stage] = [unit];
        else
            band.push(unit);
    }
    // Build columns: one per non-empty stage, ordered by stage number.
    const columns = [];
    for (const band of stageBands) {
        if (band !== undefined)
            columns.push(band);
    }
    // Column widths: each column adapts to its widest unit + gap.
    const columnWidths = columns.map((column) => Math.max(...column.map((unit) => unit.node.width)) + ARRANGE_GAP_X);
    // Position each column left-to-right, units top-to-bottom within column.
    let cursorX = ARRANGE_ORIGIN;
    for (const [index, columnUnits] of columns.entries()) {
        const targetX = cursorX;
        cursorX += columnWidths[index] ?? 0;
        columnUnits.forEach((unit, row) => {
            const targetY = ARRANGE_ORIGIN + row * cellHeight;
            const deltaX = targetX - unit.node.x;
            const deltaY = targetY - unit.node.y;
            positions.set(unit.node.id, { x: targetX, y: targetY });
            for (const child of unit.children) {
                positions.set(child.id, { x: child.x + deltaX, y: child.y + deltaY });
            }
        });
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
