/**
 * 积分 / 金额格式化（**全项目唯一实现点**，CV-358 → 20261102 改为整数展示）。
 *
 * ## 为什么积分是整数
 *
 * 契约上余额是 4 位小数的 JSON number（实测 `223.6111`），但产品口径（2026-11-02
 * 用户拍板）是**所有积分一律整数展示**，与 WorkBuddy 一致：小数位只会让用户困惑
 * 「为什么余额一直不变」，收益为零。
 *
 * ## 取整方式：截断（向零取整）
 *
 * 与「四舍五入」相比，截断保证**显示值不超过真实值**：显示 223 时真实是 223.6111，
 * 用户看到 223 一定花得出去；四舍五入成 224 则可能出现「显示 224、实际 223.6」
 * 的虚高。负数（欠费/冲正）用向零取整而非向下取整 —— 不把 -0.4 显示成 -1，
 * 不放大负债数字。`-0` 归一成 `0`（`Intl` 会把它格式化成 `-0`，很难看）。
 *
 * ## 调用纪律
 *
 * 余额卡、订阅页、用户菜单、错误文案**全部**走 `formatCredits`。任何地方出现
 * `toFixed` / `Math.round` / 手动拼小数，就是本函数被绕过 —— 两处数字不一致的
 * 锅都从这里起。
 *
 * 单独成模块而不是塞进组件：Host 侧测试（`lib/account-format.js`）能直接断言，
 * 不必为了测一行格式化去挂 React。
 */

/** 整数 + 千分位（`1,234`）。 */
const CREDIT_FORMAT = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * 格式化一笔积分。非有限值（NaN / Infinity，服务端字段异常）返回 `—`：
 * 显示 `NaN` 比显示破折号更糟 —— 用户会以为余额算出错了。
 */
export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const truncated = Math.trunc(value)
  // `Object.is(-0, 0)` 为 false，必须显式归一，否则 Intl 输出 "-0"。
  return CREDIT_FORMAT.format(truncated === 0 ? 0 : truncated)
}

/**
 * 金额格式化（`price_cents` → `US$10.00`）。
 *
 * 与积分**刻意不同**：钱要精确到分，不能整数化。币种符号走 `Intl`（USD → `US$`，
 * CNY → `¥`），**不做任何换算** —— 服务端是金额权威，客户端只负责显示。
 */
export function formatPrice(cents: number, currency: string): string {
  if (!Number.isFinite(cents)) return '—'
  const code = typeof currency === 'string' && currency.length === 3 ? currency.toUpperCase() : 'USD'
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    // 未知币种（Intl 抛 RangeError）：退化成「数字 + 代码」，可读且不炸。
    return `${(cents / 100).toFixed(2)} ${code}`
  }
}
