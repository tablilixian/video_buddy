/**
 * 管理面金额格式化（CV-358，方案 §0.3：金额固定 4 位小数）。
 *
 * 后端 `available_balance` / `frozen_balance` 是 JSON number，**四位小数是合同的一
 * 部分**（分/厘级余额确实存在）。所以这里既不做 `parseInt`，也不 `toFixed(0)`
 * 抹零 —— 那会让 0.0500 显示成 0，用户以为余额空了。
 *
 * 单独成模块而不是塞进组件：Host 侧测试（`lib/account-format.js`）能直接断言，
 * 不必为了测一行格式化去挂 React。
 */

/** 固定 4 位小数 + 千分位（`12.3456` / `1,234.0000`）。 */
const CREDIT_FORMAT = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

/**
 * 格式化一笔余额。非有限值（NaN / Infinity，服务端字段异常）返回 `—`：
 * 显示 `NaN` 比显示破折号更糟 —— 用户会以为余额算出错了。
 */
export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return CREDIT_FORMAT.format(value)
}
