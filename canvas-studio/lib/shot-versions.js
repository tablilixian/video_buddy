/** 版本递增上限：防御脏数据成环时无限循环。 */
const MAX_CHAIN_DEPTH = 64;
function normalizeList(values) {
    const seen = new Set();
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0)
            seen.add(value);
    }
    return [...seen].sort();
}
/** 节点状态判定（有效 = 未被取代且未手动作废）。 */
export function shotStatusOf(node) {
    if (node.retired === true)
        return 'retired';
    if (node.supersededBy !== undefined)
        return 'superseded';
    return 'active';
}
/** 是否参与默认合成的「有效」节点。 */
export function isActiveShot(node) {
    return shotStatusOf(node) === 'active';
}
/**
 * 输入指纹：同一镜位的不同版本共有的输入特征。
 *
 * 参考图与分镜卡都为空时返回 `''`——没有锚点就无法安全判重（否则所有纯文生
 * 视频会互相判重），调用方须跳过自动取代。
 */
export function shotFingerprintOf(input) {
    const files = normalizeList([...(input.filenames ?? []), input.filename]);
    const cards = normalizeList(input.shotNodeIds ?? []);
    if (files.length === 0 && cards.length === 0)
        return '';
    const duration = input.duration === undefined ? '' : String(Math.round(input.duration * 100) / 100);
    return [input.toolName ?? '', files.join(','), cards.join(','), duration].join('|');
}
/** 解析节点 `generationPrompt`（生成参数的 JSON 序列化）为指纹素材。 */
function parseGenerationPrompt(raw) {
    if (raw === undefined || raw.length === 0)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null)
            return {};
        const record = parsed;
        const filenames = Array.isArray(record.filenames)
            ? record.filenames.filter((item) => typeof item === 'string')
            : undefined;
        const shotNodeIds = Array.isArray(record.shotNodeIds)
            ? record.shotNodeIds.filter((item) => typeof item === 'string')
            : undefined;
        return {
            ...(typeof record.filename === 'string' ? { filename: record.filename } : {}),
            ...(filenames !== undefined ? { filenames } : {}),
            ...(shotNodeIds !== undefined ? { shotNodeIds } : {}),
        };
    }
    catch {
        return {};
    }
}
/** 从已落盘节点反推输入指纹（与生成时同源）。 */
export function shotFingerprintOfNode(node) {
    return shotFingerprintOf({ toolName: node.toolName, duration: node.duration, ...parseGenerationPrompt(node.generationPrompt) });
}
/**
 * 规划新节点的取代关系（纯函数，不落盘）。
 *
 * - `replaces` 命中且节点种类匹配 `kind` → 无条件取代（agent 显式声明）；
 * - **仅视频**：指纹非空 → 所有「有效 + 非成片 + 同指纹」的视频节点一并取代
 *   （吃掉同参数重复调用）；
 * - **图片**（CV-159）：不做指纹判重——参考图多版本是有意的，只吃显式
 *   `replaces`（样张重出取代旧样张）；
 * - 两者皆无 → 返回 version 1、空列表（普通新镜头 / 新参考）。
 */
export function planSupersede(nodes, input, replaces, kind = 'video') {
    const ids = new Set();
    if (replaces !== undefined) {
        const target = nodes.find((node) => node.id === replaces);
        if (target !== undefined && target.kind === kind)
            ids.add(target.id);
    }
    const fingerprint = kind === 'video' ? shotFingerprintOf(input) : '';
    if (fingerprint !== '') {
        for (const node of nodes) {
            if (node.kind !== 'video' || node.toolName === 'compose')
                continue;
            if (!isActiveShot(node))
                continue;
            if (shotFingerprintOfNode(node) === fingerprint)
                ids.add(node.id);
        }
    }
    if (ids.size === 0)
        return { version: 1, supersedeIds: [] };
    let maxVersion = 0;
    for (const node of nodes) {
        if (!ids.has(node.id))
            continue;
        maxVersion = Math.max(maxVersion, node.shotVersion ?? 1);
    }
    return { version: maxVersion + 1, supersedeIds: [...ids] };
}
/** 给被取代节点打上 `supersededBy`（返回新数组，不改原数组）。 */
export function applySupersede(nodes, newId, supersedeIds) {
    const set = new Set(supersedeIds);
    if (set.size === 0)
        return [...nodes];
    return nodes.map((node) => (set.has(node.id) ? { ...node, supersededBy: newId } : node));
}
/** 沿 `supersededBy` 追到当前有效版（脏数据成环时返回 undefined）。 */
export function latestActiveOf(nodes, id) {
    let current = nodes.find((node) => node.id === id);
    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
        if (current === undefined)
            return undefined;
        if (isActiveShot(current))
            return current;
        if (current.supersededBy === undefined)
            return current;
        current = nodes.find((node) => node.id === current?.supersededBy);
    }
    return undefined;
}
/**
 * 作废 / 恢复（画布右键用，纯函数）。
 *
 * - 有效节点 → 置 `retired: true`；
 * - 失效节点 → 清除 `retired` 与 `supersededBy` 复活，**并把接管它的那个节点
 *   作废**，保证同一镜位始终只有一份有效（避免恢复后成片里出现两份同镜）。
 */
export function toggleRetire(nodes, id) {
    const target = nodes.find((node) => node.id === id);
    if (target === undefined)
        return [...nodes];
    if (isActiveShot(target)) {
        return nodes.map((node) => (node.id === id ? { ...node, retired: true } : node));
    }
    const takerId = target.supersededBy;
    return nodes.map((node) => {
        if (node.id === id) {
            const { retired: _retired, supersededBy: _supersededBy, ...rest } = node;
            return rest;
        }
        if (takerId !== undefined && node.id === takerId)
            return { ...node, retired: true };
        return node;
    });
}
