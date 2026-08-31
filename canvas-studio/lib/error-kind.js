const UNREACHABLE_PATTERNS = [
    /fetch failed/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /connection refused/i,
    /network error/i,
    /failed to fetch/i,
    /socket hang up/i,
    /无响应/i,
    /不可达/i,
    /无法连接/i,
    /连接失败/i,
    /超时/i,
    /timeout/i,
];
const CONFIG_PATTERNS = [
    /api[ _-]?key/i,
    /apikey/i,
    /密钥/i,
    /credential/i,
    /未配置/i,
    /unauthor/i,
    /forbidden/i,
    /\b401\b/i,
    /\b403\b/i,
    /invalid (api|base)/i,
    /基址/i,
];
/** 把错误消息归类为三级处置（空消息一律 retryable）。 */
export function classifyStudioError(message) {
    if (message === null || message === undefined || message.length === 0)
        return 'retryable';
    if (UNREACHABLE_PATTERNS.some((pattern) => pattern.test(message)))
        return 'unreachable';
    if (CONFIG_PATTERNS.some((pattern) => pattern.test(message)))
        return 'config';
    return 'retryable';
}
