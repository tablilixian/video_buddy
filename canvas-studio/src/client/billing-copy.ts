/**
 * 计费文案映射（**唯一实现点**）。
 *
 * 抽出来是因为同一套映射有三处消费者：订阅页的胶囊、用户菜单的订阅行、以及
 * `CreditsCard` 之外任何想显示套餐名的地方。三处各写一份 `switch` 的下场是
 * 「同一订阅在页面上叫『生效中』、在菜单里叫『active』」—— 本项目已经踩过同类坑。
 *
 * 口径来源：上游文档 §9.1（`provider_status` 优先，本地终态 `canceled/expired`
 * 例外），以及 `unavailable_reason` 的稳定取值表（§4.4）。
 */
import type { BillingSubscription } from '../contracts/billing.js'
import { BILLING_UNAVAILABLE_REASON } from '../contracts/billing.js'

/** 订阅状态胶囊文案。 */
export function statusLabel(sub: BillingSubscription): string {
  // 本地终态优先：canceled / expired 时 Stripe 那边可能还是 active，但对用户来说
  // 「已取消 / 已结束」才是他关心的结论。
  if (sub.status === 'canceled') return '已取消'
  if (sub.status === 'expired') return '已结束'
  if (sub.status === 'past_due') return '自动续费待处理'
  switch (sub.provider_status) {
    case 'trialing': return '试用中'
    case 'active': return '生效中'
    case 'past_due': return '自动续费待处理'
    case 'unpaid': return '待支付'
    case 'incomplete': return '待完成'
    case 'paused': return '续费已暂停'
    default: return sub.status === 'active' ? '生效中' : sub.status
  }
}

/** 周期文案；未知值原样返回（服务端新增 `week` 之类时不会显示空白）。 */
export function periodLabel(period: string): string {
  if (period === 'month') return '每月'
  if (period === 'year') return '每年'
  return period
}

/**
 * `purchasable=false` 时的按钮文案。
 *
 * 设计原因 / 旧文案（`stripe_price_missing` / `product_inactive`）一律落到
 * 「暂不可购买」：用户既看不懂也不该看到后台配置细节。
 */
export function reasonLabel(reason: string | undefined): string {
  switch (reason) {
    case BILLING_UNAVAILABLE_REASON.currentSubscription: return '当前套餐'
    case BILLING_UNAVAILABLE_REASON.subscriptionActive: return '已有订阅'
    case BILLING_UNAVAILABLE_REASON.subscriptionCheckoutPending: return '待支付'
    default: return '暂不可购买'
  }
}

/** 只有 stripe 且未终结的订阅能开 Customer Portal（manual 订阅没有 Stripe Customer）。 */
export function canManageSubscription(sub: BillingSubscription | null): boolean {
  if (sub === null) return false
  if (sub.provider !== 'stripe') return false
  return sub.status !== 'canceled' && sub.status !== 'expired'
}
