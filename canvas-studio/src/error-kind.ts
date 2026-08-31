/**
 * Studio 错误分级（纯函数）：把错误消息归类为三级处置，驱动三态 error 组件
 * 的提示与按钮（brand-identity-proposal.md §6.1）。
 *
 * - `unreachable`：生成服务不可达（fetch 失败 / 连接拒绝 / 超时）→ 提示检查后端；
 * - `config`：配置缺失（API Key / 基址 / 未授权）→ 引导打开设置；
 * - `retryable`：其它（业务错误、参数错误等）→ 直接重试。
 *
 * 归类是启发式的（消息特征匹配），宁可归 `retryable` 也不误导——未知消息一律
 * 走重试，不瞎引导去设置。
 */
export type StudioErrorKind = 'retryable' | 'config' | 'unreachable'

const UNREACHABLE_PATTERNS: readonly RegExp[] = [
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
]

const CONFIG_PATTERNS: readonly RegExp[] = [
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
]

/** 把错误消息归类为三级处置（空消息一律 retryable）。 */
export function classifyStudioError(message: string | null | undefined): StudioErrorKind {
  if (message === null || message === undefined || message.length === 0) return 'retryable'
  if (UNREACHABLE_PATTERNS.some((pattern) => pattern.test(message))) return 'unreachable'
  if (CONFIG_PATTERNS.some((pattern) => pattern.test(message))) return 'config'
  return 'retryable'
}
