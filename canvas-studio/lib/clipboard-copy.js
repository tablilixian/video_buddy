/** 菜单项文案：说清「复制的是什么」，避免和就地克隆节点的「复制」撞名。 */
export const CLIPBOARD_LABELS = {
    text: '复制文字到剪贴板',
    image: '复制图片到剪贴板',
};
/** 成功提示里的名词。 */
export const CLIPBOARD_NOUNS = {
    text: '文字',
    image: '图片',
};
/** 正文就是文字内容的节点类型（画布上的标注类，没有实体产物）。 */
const TEXT_KINDS = new Set(['sticky', 'text', 'prompt']);
/**
 * 文字节点该复制出去的正文。
 *
 * `text` 是主体（保留换行与缩进原样返回，不做 trim —— 复制出去的东西要和画布
 * 上看到的一致）；`text` 全空白时退回标题（只有一个手写标题的便签，复制出去的
 * 不该是空串）；两者都没内容则返回空串，由 `clipboardPlanOf` 判成「没有载荷」。
 */
export function clipboardTextOf(node) {
    const body = typeof node.text === 'string' ? node.text : '';
    if (body.trim().length > 0)
        return body;
    const title = typeof node.title === 'string' ? node.title : '';
    return title.trim().length > 0 ? title : '';
}
/**
 * 一个节点的复制计划（唯一判定）。
 *
 * 文字类看正文，图片类看 `url`（没有资产的图片节点复制出去只能是空图，
 * 所以一并判成「没有载荷」）。视频 / 音频 / 托盘 / 其他一律 `null`。
 */
export function clipboardPlanOf(node) {
    if (TEXT_KINDS.has(node.kind)) {
        const text = clipboardTextOf(node);
        if (text.length === 0)
            return null;
        return { payload: 'text', text, label: CLIPBOARD_LABELS.text };
    }
    if (node.kind !== 'image')
        return null;
    if (typeof node.url !== 'string' || node.url.length === 0)
        return null;
    return { payload: 'image', text: '', label: CLIPBOARD_LABELS.image };
}
/** 剪贴板只收 PNG：非 PNG（webp / jpeg / 未知类型）一律要重编码。 */
export function pngTranscodeNeeded(blobType) {
    return blobType.trim().toLowerCase() !== 'image/png';
}
function errorNameOf(cause) {
    if (cause === null || typeof cause !== 'object')
        return '';
    const name = cause.name;
    return typeof name === 'string' ? name : '';
}
/** 错误的一句话描述（含 DOMException 的 `name`），用于文案括注。 */
export function errorTextOf(cause) {
    if (cause instanceof Error)
        return cause.message.length > 0 ? cause.message : cause.name;
    if (typeof cause === 'string')
        return cause;
    if (cause === null || cause === undefined)
        return 'unknown';
    return String(cause);
}
/** 按阶段 + 错误名归类。 */
export function classifyClipboardFailure(stage, cause) {
    if (stage === 'plan')
        return 'empty';
    if (stage === 'load')
        return 'fetch';
    if (stage === 'encode')
        return 'encode';
    const name = errorNameOf(cause);
    if (name === 'NotAllowedError')
        return 'not-allowed';
    if (name === 'SecurityError')
        return 'no-api';
    return 'write';
}
function fail(payload, failure, cause) {
    return { ok: false, payload, failure, detail: errorTextOf(cause) };
}
/**
 * 把节点内容写进系统剪贴板（唯一入口）。
 *
 * 不抛异常：所有失败都变成带类的 `ClipboardResult`（调用方拿它出 toast）。
 * 图片路径分三步，**每步单独 try** —— 「取资产失败」和「写入被拒」的补救办法
 * 不一样，混在一起就没法给用户可执行的下一步。
 */
export async function copyNodeToClipboard(node, env) {
    const plan = clipboardPlanOf(node);
    if (plan === null)
        return fail(null, 'empty', undefined);
    if (!env.available())
        return fail(plan.payload, 'no-api', undefined);
    if (plan.payload === 'text') {
        try {
            await env.writeText(plan.text);
        }
        catch (cause) {
            return fail('text', classifyClipboardFailure('write', cause), cause);
        }
        return { ok: true, payload: 'text' };
    }
    let blob;
    try {
        blob = await env.loadBlob(node);
    }
    catch (cause) {
        return fail('image', classifyClipboardFailure('load', cause), cause);
    }
    let png = blob;
    if (pngTranscodeNeeded(blob.type)) {
        try {
            png = await env.toPng(blob);
        }
        catch (cause) {
            return fail('image', classifyClipboardFailure('encode', cause), cause);
        }
    }
    try {
        await env.writeImage(png);
    }
    catch (cause) {
        return fail('image', classifyClipboardFailure('write', cause), cause);
    }
    return { ok: true, payload: 'image' };
}
/**
 * 只写一段文字（技能提示词 / @ref 标记 / 抽屉里的提示词）也走同一条口径。
 *
 * 存在的意义是**收口**：此前这三处各自 `navigator.clipboard.writeText(...)`，
 * 失败被 `.catch(() => {})` 吞掉，或干脆是未处理的 rejection（按钮永远不显示
 * 「已复制」，控制台里留一条没人看的报错）。
 */
export async function copyTextToClipboard(text, env) {
    if (text.trim().length === 0)
        return fail(null, 'empty', undefined);
    if (!env.available())
        return fail('text', 'no-api', undefined);
    try {
        await env.writeText(text);
    }
    catch (cause) {
        return fail('text', classifyClipboardFailure('write', cause), cause);
    }
    return { ok: true, payload: 'text' };
}
/**
 * 结果 → 给用户看的一句话（toast）。
 *
 * 失败文案**必须带下一步**：剪贴板失败在浏览器里是静默的，「复制失败」四个字
 * 等于没说。图片侧的每一条都指回「下载资产」——那是本条链路上唯一一定能走通的路。
 */
export function clipboardResultMessage(result) {
    if (result.ok) {
        const noun = result.payload === null ? '内容' : CLIPBOARD_NOUNS[result.payload];
        return `已复制${noun}到剪贴板，可直接粘贴到微信 / 文档里。`;
    }
    const detail = result.detail === undefined || result.detail.length === 0 ? '' : `（${result.detail}）`;
    switch (result.failure) {
        case 'empty':
            return '这个节点没有可复制的文字或图片。';
        case 'no-api':
            return '当前环境没有可用的剪贴板（需要安全上下文）。图片可改用「下载资产」。';
        case 'not-allowed':
            return '浏览器拒绝了剪贴板写入（缺少用户手势或权限）。请再点一次；仍不行就改用「下载资产」。';
        case 'fetch':
            return `取资产失败${detail}。可改用「下载资产」。`;
        case 'encode':
            return `图片转 PNG 失败${detail}。可改用「下载资产」。`;
        default:
            return `写入剪贴板失败${detail}。可改用「下载资产」。`;
    }
}
