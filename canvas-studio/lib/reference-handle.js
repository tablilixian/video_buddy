/** 句柄前缀（按类型分道编号，图片/视频序号互不干扰）。 */
const HANDLE_PREFIX = { image: 'img', video: 'vid' };
/** 完整标题的展示截断长度（hover 卡片标题行用）。 */
const LABEL_MAX = 16;
/** 超出上限的标题截断成 `前 N 字…`（按 Unicode 码点切，避免切坏 emoji/汉字）。 */
export function truncateLabel(text, max = LABEL_MAX) {
    const chars = [...text];
    if (chars.length <= max)
        return text;
    return `${chars.slice(0, max - 1).join('')}…`;
}
/**
 * 为当前项目的可引用素材派生短句柄（按节点数组顺序 = 创建顺序编号）。
 * 只有 image / video 节点可引用（文本便利贴等没有素材语义）。
 */
export function buildAssetHandles(nodes) {
    const counters = { image: 0, video: 0 };
    const out = [];
    for (const node of nodes) {
        if (node.kind !== 'image' && node.kind !== 'video')
            continue;
        counters[node.kind] += 1;
        out.push({
            nodeId: node.id,
            handle: `${HANDLE_PREFIX[node.kind]}-${String(counters[node.kind]).padStart(2, '0')}`,
            kind: node.kind,
            title: node.title ?? '',
            url: node.url ?? null,
            ...(typeof node.duration === 'number' ? { duration: node.duration } : {}),
        });
    }
    return out;
}
/** 按短句柄反查（hover 浮层从 chip 文案回找素材；大小写不敏感）。 */
export function findAssetByHandle(handles, handle) {
    const key = handle.trim().replace(/^@/u, '').toLowerCase();
    if (key === '')
        return undefined;
    return handles.find((item) => item.handle.toLowerCase() === key);
}
/**
 * 从 chip 上的文本反查素材（hover 浮层用）。
 *
 * chip 文案有四种来源，逐个兜：
 * 1. 我们自己的短句柄 `img-01`（右键插入 / 画布素材源选中）；
 * 2. node id（`@ref[<id>]` 被原样贴进输入框时）；
 * 3. 节点标题（上游 `@` 文件源选中后 label 是文件名，恰好与画布标题同名）；
 * 4. 文件 basename（上游文件源的 label 形如 `d73ea812.png`，与节点 url 末段一致）。
 *
 * 上游文件源（ui-reference）产生的 chip 走的正是 3/4：它不认识画布节点，
 * 但只要这个名字在画布上存在同名素材，就照样能出缩略图。
 */
export function findAssetByChipText(handles, text) {
    // 0. `@ref[<id>]` —— 已发送气泡里的 chip 把前导 @ 剥掉当显示名（上游
    // projectUserText 的做法），所以这里 @ 可选。
    for (const match of text.matchAll(/@?ref\[([^\]]+)\]/giu)) {
        const id = (match[1] ?? '').trim().toLowerCase();
        if (id === '')
            continue;
        const hit = handles.find((item) => item.nodeId.toLowerCase() === id);
        if (hit !== undefined)
            return hit;
    }
    const raw = text.trim().toLowerCase();
    if (raw === '')
        return undefined;
    const key = raw.replace(/^@/u, '');
    // 只取路径末段：`@a/b/c.png` 与 `c.png` 应命中同一个素材。
    const base = key.slice(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1);
    const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
    // url 末段的「全名」与「去扩展名」两个形态：`镜头一.mp4` 与 `镜头一` 都能命中。
    const urlNames = (url) => {
        const path = url.split(/[?#]/u)[0] ?? url;
        const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
        return name.includes('.') ? [name, name.slice(0, name.lastIndexOf('.'))] : [name];
    };
    const titleKey = (title) => title.trim().toLowerCase();
    return handles.find((item) => item.handle.toLowerCase() === key)
        ?? handles.find((item) => item.nodeId.toLowerCase() === key)
        ?? handles.find((item) => titleKey(item.title) === key || titleKey(item.title) === base)
        ?? handles.find((item) => item.url !== null && urlNames(item.url).includes(base))
        ?? handles.find((item) => item.url !== null && urlNames(item.url).includes(stem));
}
/** 按 query 过滤候选（句柄 / 标题 / 类型都参与匹配，空 query 返回全部）。 */
export function filterAssetHandles(handles, query) {
    const key = query.trim().toLowerCase();
    if (key === '')
        return [...handles];
    return handles.filter((item) => {
        if (item.handle.toLowerCase().includes(key))
            return true;
        if (item.title.toLowerCase().includes(key))
            return true;
        return item.kind.toLowerCase().includes(key);
    });
}
