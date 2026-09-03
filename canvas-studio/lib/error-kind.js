/**
 * 硬性网络信号：连接被拒 / DNS 失败 / 底层 fetch 失败——服务确实不可达，
 * 即使消息里混着 api key 等词也优先提示「检查后端」（既有语义，勿改）。
 */
const UNREACHABLE_HARD_PATTERNS = [
    /fetch failed/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /connection refused/i,
    /socket hang up/i,
    /failed to fetch/i,
];
/**
 * 软性网络信号：超时 / 连接失败等措辞——可能与配置缺失同时出现
 * （「未配置密钥导致连接失败」）。CR-032：软信号与配置关键词同现时归 config，
 * 避免「连接失败：invalid api key」被误判为后端不可达、把用户带去检查服务。
 */
const UNREACHABLE_SOFT_PATTERNS = [
    /ETIMEDOUT/i,
    /network error/i,
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
    if (UNREACHABLE_HARD_PATTERNS.some((pattern) => pattern.test(message)))
        return 'unreachable';
    const hasConfig = CONFIG_PATTERNS.some((pattern) => pattern.test(message));
    if (UNREACHABLE_SOFT_PATTERNS.some((pattern) => pattern.test(message)) && !hasConfig)
        return 'unreachable';
    if (hasConfig)
        return 'config';
    return 'retryable';
}
