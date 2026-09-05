/**
 * 供应商注册表（阶段 1）。
 *
 * 提供注册与按能力路由。注册顺序即「未指定供应商时的默认优先级」，
 * 当前由 `index.ts` 在插件装配时决定（阶段 2 起 drama 先注册）。
 *
 * 阶段 3 会在此基础上叠加「设置项默认值 → 参数显式指定」的优先级链。
 */
const providers = new Map();
/** 注册一个供应商。重复注册同一 id 会覆盖（便于测试与热替换）。 */
export function registerProvider(provider) {
    providers.set(provider.id, provider);
}
/** 注销一个供应商（测试与热替换用）。 */
export function unregisterProvider(id) {
    providers.delete(id);
}
/** 清空注册表（测试用，避免用例间互相污染）。 */
export function clearProviders() {
    providers.clear();
}
/** 按 id 取供应商。 */
export function getProvider(id) {
    return providers.get(id);
}
/** 列出全部已注册供应商（按注册顺序）。 */
export function listProviders() {
    return [...providers.values()];
}
/**
 * 选出能处理该能力的供应商。
 *
 * 优先级：显式指定 > 注册顺序（阶段 3 会在中间插入设置项默认值）。
 *
 * **显式指定但不支持时抛错，不静默回退**——静默换供应商会让出片风格突变，
 * 用户更难排查。（策略待文档 §10 Q1 审批确认，当前按此实现。）
 */
export function resolveProvider(capability, preferred) {
    if (preferred !== undefined) {
        const hit = providers.get(preferred);
        if (hit === undefined) {
            throw new Error(`未注册的视频供应商: ${preferred}。${describeProviders()}`);
        }
        if (!hit.capabilities.has(capability)) {
            throw new Error(`视频供应商 ${hit.label}（${hit.id}）不支持 ${capability}。${describeProviders()}`);
        }
        return hit;
    }
    for (const provider of providers.values()) {
        if (provider.capabilities.has(capability))
            return provider;
    }
    throw new Error(`没有可用的视频供应商支持 ${capability}。${describeProviders()}`);
}
/**
 * 生成「哪家支持什么」的清单，拼进错误文案——让 agent 能据此自我纠正，
 * 而不是只收到一句干巴巴的失败。
 */
function describeProviders() {
    const items = listProviders();
    if (items.length === 0)
        return '当前没有任何已注册的视频供应商。';
    const detail = items
        .map((provider) => `${provider.id}（${[...provider.capabilities].join('、')}）`)
        .join('；');
    return `当前已注册：${detail}。`;
}
