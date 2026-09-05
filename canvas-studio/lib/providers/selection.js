const VALID_PROVIDERS = ['drama', 'fal'];
/**
 * 校验入参 provider 字段。
 * - 未提供（undefined / null）→ 返回 undefined（交由默认供应商逻辑处理）。
 * - 合法字符串 → 返回该值。
 * - 非法值 → 抛出含「仅支持 drama / fal」的明确中文错误（供 routes 转 400）。
 */
export function parseProviderParam(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string' || !VALID_PROVIDERS.includes(value)) {
        throw new Error(`非法的视频供应商: ${JSON.stringify(value)}（仅支持 drama / fal）`);
    }
    return value;
}
