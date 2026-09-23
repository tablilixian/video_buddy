/**
 * Studio 错误分级（纯函数）：把错误消息归类为三级处置，驱动三态 error 组件
 * 的提示与按钮（brand-identity-proposal.md §6.1）。
 *
 * - `unreachable`：生成服务不可达（fetch 失败 / 连接拒绝 / 超时）→ 提示检查后端；
 * - `config`：配置缺失（API Key / 基址 / 未授权）→ 引导打开设置；
 * - `retryable`：其它（业务错误、参数错误等）→ 直接重试。
 *
 * 归类有两条路径：
 * - **主路径**（`classifyStudioFailure`）：拿到 `CS-*` 错误码时读注册表里登记的
 *   `uiKind`（每条错误在登记时就声明好了自己的处置级别）；
 * - **兜底**（`classifyStudioError`）：没有结构化码时按消息特征启发式猜。
 *
 * 两者都宁可归 `retryable` 也不误导——未知一律走重试，不瞎引导去设置。
 */
import { getErrorSpec, isStudioErrorCode, type ErrorUiKind } from './error-system.js'

/**
 * 三级处置。**就是** `ErrorUiKind`（`error-system.ts` 里定义）的别名 —— 同一个
 * 概念只留一份定义，免得两处联合类型各自演化后悄悄漂移（分级在注册表里声明、
 * 在这里消费，两边必须永远是同一组取值）。
 *
 * 保留这个名字是因为消费方（三态错误卡）按「UI 分级」的语义读它，而不是按
 * 「错误规格字段」读它。
 */
export type StudioErrorKind = ErrorUiKind

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

/**
 * 把错误消息归类为三级处置（空消息一律 retryable）。
 *
 * **仅作兜底**：这条路径靠字符串特征匹配，是 `error-kind.ts` 的历史实现，服务于
 * 「手上只有一句文案、没有错误码」的场景。凡是有 `CS-*` 码，一律走
 * `classifyStudioFailure` —— 分级信息在错误登记时就定好了，不该在下游重新猜
 * （本系统 §6-1「下游不再靠字符串匹配」；code-review CR-032 也是这条启发式的
 * 副作用）。新代码请直接用 `classifyStudioFailure`。
 */
export function classifyStudioError(message: string | null | undefined): StudioErrorKind {
  if (message === null || message === undefined || message.length === 0) return 'retryable'
  if (UNREACHABLE_HARD_PATTERNS.some((pattern) => pattern.test(message))) return 'unreachable'
  const hasConfig = CONFIG_PATTERNS.some((pattern) => pattern.test(message))
  if (UNREACHABLE_SOFT_PATTERNS.some((pattern) => pattern.test(message)) && !hasConfig) return 'unreachable'
  if (hasConfig) return 'config'
  return 'retryable'
}

/**
 * 错误分级**主路径**：优先按结构化错误码判定，仅在没有码可用时退回启发式。
 *
 * - 有 `CS-*` 码且已登记 → 读该码声明的 `uiKind`（未声明即 `retryable`，见
 *   `CanvasErrorSpec.uiKind`）。这是「登记时定好、下游只读结论」的路径，
 *   文案怎么改都不影响分级。
 * - 非本系统的码（框架码如 `TOOL_ABORTED`）或未登记的码 → 退回
 *   `classifyStudioError(message)`：宁可多一次启发式，也不要因为缺登记而
 *   把「去设置」的分级丢掉。
 *
 * @param code - 错误码（可为空；`StudioApiError.code` / `tool/result.error.code`）
 * @param message - 展示给用户的消息（仅在无码时用于兜底归类）
 */
export function classifyStudioFailure(
  code: string | null | undefined,
  message: string | null | undefined,
): StudioErrorKind {
  if (typeof code === 'string' && isStudioErrorCode(code)) {
    const spec = getErrorSpec(code)
    if (spec !== undefined) return spec.uiKind ?? 'retryable'
  }
  return classifyStudioError(message)
}
