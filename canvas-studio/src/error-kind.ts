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

/**
 * 硬性网络信号：连接被拒 / DNS 失败 / 底层 fetch 失败——服务确实不可达，
 * 即使消息里混着 api key 等词也优先提示「检查后端」（既有语义，勿改）。
 */
const UNREACHABLE_HARD_PATTERNS: readonly RegExp[] = [
  /fetch failed/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /connection refused/i,
  /socket hang up/i,
  /failed to fetch/i,
]

/**
 * 软性网络信号：超时 / 连接失败等措辞——可能与配置缺失同时出现
 * （「未配置密钥导致连接失败」）。CR-032：软信号与配置关键词同现时归 config，
 * 避免「连接失败：invalid api key」被误判为后端不可达、把用户带去检查服务。
 */
const UNREACHABLE_SOFT_PATTERNS: readonly RegExp[] = [
  /ETIMEDOUT/i,
  /network error/i,
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
  if (UNREACHABLE_HARD_PATTERNS.some((pattern) => pattern.test(message))) return 'unreachable'
  const hasConfig = CONFIG_PATTERNS.some((pattern) => pattern.test(message))
  if (UNREACHABLE_SOFT_PATTERNS.some((pattern) => pattern.test(message)) && !hasConfig) return 'unreachable'
  if (hasConfig) return 'config'
  return 'retryable'
}
