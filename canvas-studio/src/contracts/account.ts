/**
 * 管理面账号只读视图（Host → client 的唯一形状，方案 P3 / CV-358）。
 *
 * 为什么要这一层而不是让 client 直接读 `CreditBalance`：**状态判断全在 Host 做完**
 * —— 启用闸、登录态、403 禁用、TTL、失败留旧值。client 只按字段渲染，不再自己
 * 判断「该不该发请求 / 这个错误码算不算登录问题」，否则两处判断迟早漂移。
 *
 * 契约里**没有总额度字段**：后端 `/v1/credits/balance` 只给 `available_balance` /
 * `frozen_balance` / `currency` / `lots`。UI 不得自造分母（旧的 `0 / 1,000` 占位
 * 是 REQ-030 ③ 时代的前端常量）。
 */
import type { CreditBalance } from '../drama-management.js'

/** 一次余额读取的结果（含降级态）。 */
export interface AccountCreditsView {
  /** 管理面是否启用：`businessApiBase` 与 `supabaseUrl` 均非空。false ⇒ UI 不渲染余额卡。 */
  enabled: boolean
  /** Host 是否持有会话缓存（client 已推送且未登出）。false ⇒ 「登录后查看」。 */
  signedIn: boolean
  /** 403：账号被禁用，Host 已停止业务请求（含余额）。 */
  disabled: boolean
  /** 最近一次成功读到的余额；从未读到 = null（**不是 0**）。 */
  balance: CreditBalance | null
  /** 读到 `balance` 的时刻（ISO 8601）；null = 从未读到。 */
  fetchedAt: string | null
  /** 最近一次失败；有 `balance` 时 UI 保留旧值并标灰。 */
  error: { code: string; message: string } | null
}
