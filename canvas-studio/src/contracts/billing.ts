/**
 * 订阅与积分计费契约（Host → client，方案 `订阅与积分接入方案-20261102.md` P1）。
 *
 * 有两条**实测得出**的硬约束（见方案 §0.3），写在这里当类型层的护栏：
 *
 * 1. **`pending_checkout` 是 omitempty**：服务端没有待支付订单时，这个 key 整个
 *    消失（不是 `null`）。所以它是可选字段，`undefined` 与 `null` 一律按「没有」
 *    处理 —— 不要写成 `| null` 后假设 key 一定在。
 * 2. **`plans[].name` 与 `code` 不同名**：`creator_monthly` 的 `name` 是 `Plus`。
 *    UI 只准渲染 `name`，禁止从 `code` 推文案（推出来会是「Creator」，与后台
 *    已发布版本不一致）。
 *
 * 金额一律 `price_cents`（整数最小货币单位）+ `currency`（ISO 大写，实测为 USD）。
 * **契约里没有任何「客户端算金额」的字段**：币种、价格、积分数量都来自服务端已
 * 发布商品版本，客户端只负责格式化。
 */

/** 订阅套餐（`overview.plans[]`）。 */
export interface BillingPlan {
  code: string
  /** 已发布版本名称；**这是唯一可展示的名字**（与 code 不同名）。 */
  name: string
  billing_period: string
  price_cents: number
  currency: string
  period_credits: number
  /** 展示型权益；实测只有 `concurrent_generations`，未知 key 忽略。 */
  entitlements: Record<string, unknown>
  purchasable: boolean
  /** `purchasable=false` 时的稳定原因（见 `BILLING_UNAVAILABLE_REASON`）。 */
  unavailable_reason?: string
}

/** 一次性积分包（`overview.credit_packs[]`）。 */
export interface BillingCreditPack {
  code: string
  name: string
  price_cents: number
  currency: string
  credit_amount: number
  /** 实测该字段**经常缺失**（= 不过期）；缺失或 0 都不显示有效期。 */
  validity_days?: number
  purchasable: boolean
  unavailable_reason?: string
}

/** 当前订阅（`overview.subscription`；从未订阅为 `null`）。 */
export interface BillingSubscription {
  /** 本地访问状态：`active` / `past_due` / `canceled` / `expired` … */
  status: string
  /** Stripe 原始状态（`trialing` / `unpaid` / `paused`）；可能缺失。 */
  provider_status?: string
  /** `stripe` 或 `manual`；只有 `stripe` 能打开 Customer Portal。 */
  provider: string
  plan_code: string
  plan_name: string
  billing_period: string
  period_credits: number
  current_period_start?: string
  current_period_end?: string
  cancel_at_period_end?: boolean
}

/** 钱包余额（`overview.credits`；读取失败时上游给 `null`）。 */
export interface BillingCredits {
  currency: string
  /** 可用积分（**不含** frozen）。 */
  available_balance: number
  /** 被任务冻结的积分；不参与「可花」判断。 */
  frozen_balance: number
}

/** 待支付 Checkout（`overview.pending_checkout`；无则整个 key 缺失）。 */
export interface BillingPendingCheckout {
  order_id: string
  kind: BillingProductKind
  product_code: string
  /** 实测只会是 `creating` 或 `open`。 */
  status: string
  /** 极少数旧数据可能为空。 */
  expires_at?: string
}

/** 商品类型。 */
export type BillingProductKind = 'plan' | 'credit_pack'

/**
 * `GET /v1/billing/overview` 的**上游**响应（未加 Host 的 `enabled/signedIn/error`
 * 装饰）。与 `BillingSnapshot` 分开是因为两者的失败语义不同：上游失败是非 2xx；
 * Host 视图永远 200，把失败塞进 `error`。
 */
export interface BillingOverviewResponse {
  subscription: BillingSubscription | null
  credits: BillingCredits | null
  /** omitempty：无待支付订单时整个 key 缺失。 */
  pending_checkout?: BillingPendingCheckout | null
  plans: BillingPlan[]
  credit_packs: BillingCreditPack[]
}

/** 计费读取错误（Host 侧归一化后的形状，不是上游信封）。 */
export interface BillingError {
  code: string
  message: string
  /** 上游 HTTP 状态；网络层失败为 0。 */
  status: number
  retryAfterSeconds: number | null
}

/**
 * 计费快照 —— client 渲染订阅页的**唯一**数据来源。
 *
 * `error !== null` 时**其它字段仍然可信**（保留上一次成功的值）：这是「读不到账单
 * 不等于账单是空的」的具体落法，也是 `GET` 路径永远 200 的原因。
 */
export interface BillingSnapshot {
  /** 管理面是否启用（`businessApiBase` + `supabaseUrl` 都配了）。false ⇒ 页面显示未配置。 */
  enabled: boolean
  /** Host 是否持有会话缓存。false ⇒ 页面显示登录引导。 */
  signedIn: boolean
  /** 403：账号被禁用，Host 已停掉业务请求。 */
  disabled: boolean
  subscription: BillingSubscription | null
  credits: BillingCredits | null
  /** 无待支付订单时**缺失**（omitempty），不是 `null`。 */
  pending_checkout?: BillingPendingCheckout | null
  plans: BillingPlan[]
  credit_packs: BillingCreditPack[]
  /** 快照时刻（ISO 8601）；null = 从未成功读到。 */
  fetchedAt: string | null
  error: BillingError | null
}

/** 创建 Checkout 的请求体（**只允许这两个字段**，多余字段服务端拒收）。 */
export interface BillingCheckoutRequest {
  kind: BillingProductKind
  product_code: string
}

/** 创建成功的 Checkout（上游 201）。 */
export interface BillingCheckoutSession {
  order_id: string
  order_no: string
  checkout_session_id: string
  /** Stripe 托管页；必须交系统浏览器打开（Host 已校验 host）。 */
  checkout_url: string
  expires_at?: string
}

/** Stripe Customer Portal Session（上游 201）。 */
export interface BillingPortalSession {
  portal_url: string
}

/**
 * `unavailable_reason` 的**稳定取值**（方案 §4.4）。未知原因统一落到
 * `暂不可购买`，不给用户看英文 code。
 */
export const BILLING_UNAVAILABLE_REASON = {
  stripeProductNotConfigured: 'stripe_product_not_configured',
  stripePriceNotConfigured: 'stripe_price_not_configured',
  invalidPrice: 'invalid_price',
  invalidCurrency: 'invalid_currency',
  currentSubscription: 'current_subscription',
  subscriptionActive: 'subscription_active',
  subscriptionCheckoutPending: 'subscription_checkout_pending',
  /** 兼容旧文案（上游文档标注）：按「暂不可购买」展示。 */
  legacyStripePriceMissing: 'stripe_price_missing',
  legacyProductInactive: 'product_inactive',
} as const

/**
 * checkout 失败原因的**内部**枚举。上游所有 409 的 `code` 恒为 `conflict`，
 * 真实原因只在 `message`（实测：`idempotency key conflict`）。所以必须在这里
 * 归一化成有限集合，UI 与幂等键策略只认这个类型。
 */
export type CheckoutConflictReason =
  /** 幂等键相同但商品不同：换键即可重试。 */
  | 'idem_mismatch'
  /** 幂等键对应的 Checkout 已过期 / 创建失败 / 已支付完成：换键。 */
  | 'expired'
  /** 已有待支付套餐订单：**不换键**，刷新 overview 让 UI 显示待支付横幅。 */
  | 'pending'
  /** 已有 active/past_due 订阅。 */
  | 'subscribed'
  /** 商品不可售（未绑 Stripe、价格非法、已下架）。 */
  | 'not_purchasable'
  /** 未识别的 409。 */
  | 'unknown'
