/**
 * 订阅与积分全屏页（方案 P3 / `订阅与积分接入方案-20261102.md` §4）。
 *
 * 形态沿用资产库全屏页（`.csLibOverlay` 那套）：盖住三栏、显式关闭、Esc 可退。
 * 不塞进设置弹窗的原因很实际 —— 套餐墙需要横向空间，500px 的弹窗只能把它压成
 * 一行残废卡片。
 *
 * 这个组件**不自己发请求**：数据与动作全部来自 `billing-store`（由 StudioFrame
 * 传入）。理由与 `CreditsCard` 一致 —— 同一份状态被「左栏余额卡」「用户菜单」
 * 「这个页面」三处读，各自持有一份必然漂移。
 *
 * 文案纪律：所有用户可见文字都在这里，**不出现英文 code**；服务端 message 只用于
 * 开发者排查（`title`），不直接展示。
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { formatCredits, formatPrice } from '../account-format.js'
import type { CreditLedgerEntry } from '../contracts/account.js'
import type { BillingCreditPack, BillingPlan, BillingSnapshot } from '../contracts/billing.js'
import { getLedgerState, refreshLedger, subscribeLedger } from './ledger-store.js'
import type { BillingState } from './billing-store.js'
import { canBuy, hasIdempotencyKey } from './billing-store.js'
// 文案映射与用户菜单共用一份（唯一实现点，避免两处对同一订阅给出不同叫法）。
import { canManageSubscription, periodLabel, reasonLabel, statusLabel } from './billing-copy.js'

export interface BillingPageProps {
  state: BillingState
  /** 已登录（来自 auth store；Host 快照里的 `signedIn` 是同一事实的另一份投影）。 */
  signedIn: boolean
  /** 本地模式（未配置账号体系）：整页只显示「未配置」。 */
  localMode: boolean
  onClose(): void
  onSignIn(): void
  onRefresh(): void
  onBuy(kind: 'plan' | 'credit_pack', code: string): void
  onPortal(): void
  onDismissError(): void
}

/** ISO → 本地「2026/11/02 10:08」；解析失败原样返回（不显示 Invalid Date）。 */
function dateTimeLabel(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—'
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return iso
  const date = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 流水条目的中文名。
 *
 * 契约里 `entry_type` 刻意**不枚举**（后端已经在加新类型），所以查不到就原样显示
 * ——「条目类型多了个 `refund`」的后果应该是「多一行写着 refund」，而不是整页渲染
 * 空白。
 */
const ENTRY_LABELS: Readonly<Record<string, string>> = {
  grant: '积分发放',
  hold: '冻结',
  commit: '生成消耗',
  release: '退回',
}

/** 流水金额（`commit` 是负数、`grant` 是正数，符号本身就是语义，不在这里翻转）。 */
function amountLabel(entry: CreditLedgerEntry): string {
  const value = entry.amount
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : value > 0 ? '+' : ''
  return `${sign}${formatQuoteAmount(Math.abs(value))}`
}

/**
 * 金额显示：**4 位小数**（与预估同口径）。
 *
 * 不用 `formatCredits` 的取整：流水是账本，把 −21.1354 显示成 −21 会让用户对不上
 * 余额的最后两位，而「为什么差 0.1354」是最难解释的一类客服问题。
 */
function formatQuoteAmount(value: number): string {
  return value.toFixed(4)
}

/** 冻结条目上真正被占住的金额（`amount` 恒为 0，冻结数在 metadata 里）。 */
function holdAmountOf(entry: CreditLedgerEntry): number | null {
  const meta = entry.metadata
  if (meta === undefined || meta === null) return null
  const frozen = meta['frozen_amount']
  return typeof frozen === 'number' && Number.isFinite(frozen) ? Math.abs(frozen) : null
}

function LedgerSection(): ReactElement {
  const state = useSyncExternalStore(subscribeLedger, getLedgerState, getLedgerState)
  const view = state.view
  const entries = view?.entries ?? []

  // 打开账务页才拉流水：这些条目在别处不显示，没必要随页面存活一直轮询。
  useEffect(() => { void refreshLedger(false) }, [])

  if (view !== null && view.enabled === false) {
    return (
      <section className="csBillSection">
        <h3 className="csBillSectionTitle">积分流水</h3>
        <p className="csBillHint">当前构建未配置账号与计费服务，流水不可用。</p>
      </section>
    )
  }
  if (view !== null && !view.signedIn) {
    return (
      <section className="csBillSection">
        <h3 className="csBillSectionTitle">积分流水</h3>
        <p className="csBillHint">登录后可查看积分流水。</p>
      </section>
    )
  }

  return (
    <section className="csBillSection">
      <h3 className="csBillSectionTitle">积分流水</h3>
      {state.failure !== null && (
        <div className="csBillNotice csBillNoticeWarn">无法连接本地服务：{state.failure}</div>
      )}
      {view?.error != null && (
        <div className="csBillNotice csBillNoticeWarn" title={view.error.message}>
          流水读取失败，下方可能是上次成功获取的记录。
        </div>
      )}

      {entries.length === 0 ? (
        <p className="csBillHint">
          {state.loading
            ? '正在读取…'
            : view?.error != null ? '暂时读不到流水，点右上角刷新重试。' : '还没有积分记录。生成图片或视频后，这里会逐笔列出消耗。'}
        </p>
      ) : (
        <>
          <div className="csLedgerHead" aria-hidden="true">
            <span>时间</span>
            <span>类型</span>
            <span className="csLedgerAmount">积分</span>
            <span className="csLedgerAmount">余额</span>
          </div>
          <ul className="csLedgerList">
            {entries.map((entry) => {
              const frozen = entry.entry_type === 'hold' ? holdAmountOf(entry) : null
              return (
                <li className="csLedgerRow" key={entry.id}>
                  <span className="csLedgerTime">{dateTimeLabel(entry.created_at)}</span>
                  <span className="csLedgerKind" data-kind={entry.entry_type}>
                    {ENTRY_LABELS[entry.entry_type] ?? entry.entry_type}
                  </span>
                  <span
                    className="csLedgerAmount csLedgerValue"
                    data-kind={entry.entry_type}
                    title={frozen !== null ? `冻结 ${formatQuoteAmount(frozen)} 积分（尚未结算）` : undefined}
                  >
                    {frozen !== null ? `冻结 ${formatQuoteAmount(frozen)}` : amountLabel(entry)}
                  </span>
                  <span className="csLedgerAmount csLedgerBalance">{formatQuoteAmount(entry.lot_balance_after)}</span>
                </li>
              )
            })}
          </ul>
          {view?.hasMore === true && (
            <button
              type="button"
              className="csBillBtn"
              disabled={state.loadingMore}
              onClick={() => { void refreshLedger(false, true) }}
            >
              {state.loadingMore ? '读取中…' : '加载更早的记录'}
            </button>
          )}
          <p className="csBillHint">
            流水由服务端记账：「冻结」是提交时占住的额度，「生成消耗」才是真正扣掉的；
            任务失败会自动退回，那一笔会显示为「退回」。
          </p>
        </>
      )}
    </section>
  )
}

export function BillingPage(props: BillingPageProps): ReactElement {
  const { state, signedIn, localMode, onClose } = props
  const view: BillingSnapshot | null = state.view

  // Esc 关闭：全屏页没有「点外面」这种退路，键盘必须能用。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const pending = view?.pending_checkout ?? null
  const subscription = view?.subscription ?? null
  const plans = view?.plans ?? []
  const packs = view?.credit_packs ?? []
  const error = view?.error ?? null
  const wallet = view?.credits ?? null
  const disabled = view?.disabled === true
  const notConfigured = localMode || (view !== null && !view.enabled)

  /** pending 的商品名：目录里按 code 查；查不到（已下架）就用 code 兜底。 */
  const pendingName = ((): string => {
    if (pending == null) return ''
    const pool: (BillingPlan | BillingCreditPack)[] = pending.kind === 'plan' ? plans : packs
    return pool.find((item) => item.code === pending.product_code)?.name ?? pending.product_code
  })()

  return (
    <div className="csBillOverlay" role="dialog" aria-modal="true" aria-label="订阅与积分">
      <header className="csBillBar">
        <h2 className="csBillTitle">订阅与积分</h2>
        <span className="csBillStamp">
          {view?.fetchedAt != null ? `更新于 ${dateTimeLabel(view.fetchedAt)}` : '尚未加载'}
        </span>
        <div className="csBillBarActions">
          <button
            type="button"
            className="csBillBtn"
            onClick={props.onRefresh}
            disabled={state.loading}
            aria-busy={state.loading}
          >
            {state.loading ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="csBillBtn csBillBtnGhost" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>
      </header>

      <div className="csBillBody">
        {/* 优先级：未配置 > 未登录 > 账号受限 > 服务端读取失败 > client 连不上 > 写动作失败 > 待支付 > 提示 */}
        {notConfigured && (
          <div className="csBillNotice">
            当前构建未配置账号与计费服务（`businessApiBase` / `supabaseUrl` 为空），订阅功能不可用。
          </div>
        )}

        {!notConfigured && !signedIn && (
          <div className="csBillNotice">
            登录后即可查看订阅与积分。
            <button type="button" className="csBillBtn csBillBtnInline" onClick={props.onSignIn}>去登录</button>
          </div>
        )}

        {disabled && (
          <div className="csBillNotice csBillNoticeWarn">
            当前账号受限，订阅与积分暂不可用。请联系客服处理。
          </div>
        )}

        {error !== null && error.status !== 401 && (
          <div className="csBillNotice csBillNoticeWarn" title={error.message}>
            读取失败：{error.code === 'unavailable' ? '支付服务暂时不可用，请稍后重试。' : '暂时无法获取订阅信息。'}
            {error.retryAfterSeconds !== null ? `（${error.retryAfterSeconds} 秒后自动解除限制）` : ''}
            {view?.fetchedAt != null ? ' 下方显示的是上次成功获取的数据。' : ''}
          </div>
        )}

        {state.failure !== null && (
          <div className="csBillNotice csBillNoticeWarn">无法连接本地服务：{state.failure}</div>
        )}

        {state.actionError !== null && (
          <div className="csBillNotice csBillNoticeWarn">
            <span>{state.actionError.message}</span>
            <button type="button" className="csBillBtn csBillBtnInline" onClick={props.onDismissError}>知道了</button>
          </div>
        )}

        {state.notice !== null && (
          <div className="csBillNotice">{state.notice}</div>
        )}

        {pending != null && (
          <div className="csBillNotice csBillNoticePending">
            <span>
              待支付：{pendingName}
              {pending.expires_at !== undefined ? ` · 有效至 ${dateTimeLabel(pending.expires_at)}` : ''}
            </span>
            <span className="csBillPendingActions">
              <button type="button" className="csBillBtn csBillBtnInline" onClick={props.onRefresh}>刷新状态</button>
              {hasIdempotencyKey(pending.kind, pending.product_code) && (
                <button
                  type="button"
                  className="csBillBtn csBillBtnInline"
                  onClick={() => { props.onBuy(pending.kind, pending.product_code) }}
                >
                  继续支付
                </button>
              )}
            </span>
          </div>
        )}

        {/* 钱包：只显示「可用」与「冻结」，**没有分母**（后端不给总额度）。 */}
        <section className="csBillWallet">
          <div className="csBillWalletItem">
            <span className="csBillWalletLabel">可用积分</span>
            <strong className="csBillWalletValue">
              {wallet === null ? '—' : formatCredits(wallet.available_balance)}
            </strong>
          </div>
          <div className="csBillWalletItem">
            <span className="csBillWalletLabel">冻结中</span>
            <strong className="csBillWalletValue">
              {wallet === null ? '—' : formatCredits(wallet.frozen_balance)}
            </strong>
          </div>
        </section>

        <LedgerSection />

        <section className="csBillSection">
          <h3 className="csBillSectionTitle">当前订阅</h3>
          {subscription === null ? (
            <div className="csBillSubCard csBillSubCardEmpty">
              <div>
                <div className="csBillSubName">未订阅</div>
                <p className="csBillHint">
                  订阅按月发放积分，并提高并发上限。也可以只买一次性积分包（不影响订阅状态）。
                </p>
              </div>
            </div>
          ) : (
            <div className="csBillSubCard">
              <div className="csBillSubMain">
                <div className="csBillSubName">
                  {subscription.plan_name}
                  <span className={subscription.status === 'active' ? 'csBillPill csBillPillActive' : 'csBillPill'}>
                    {statusLabel(subscription)}
                  </span>
                </div>
                <p className="csBillHint">
                  {periodLabel(subscription.billing_period)}发放 {formatCredits(subscription.period_credits)} 积分
                  {' · '}本周期至 {dateTimeLabel(subscription.current_period_end)}
                  {subscription.cancel_at_period_end === true ? ' · 到期后停止续费' : ''}
                </p>
              </div>
              {canManageSubscription(subscription) && (
                <button
                  type="button"
                  className="csBillBtn"
                  onClick={props.onPortal}
                  disabled={state.portal}
                >
                  {state.portal ? '打开中…' : '管理订阅'}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="csBillSection">
          <h3 className="csBillSectionTitle">订阅套餐</h3>
          {plans.length === 0 ? (
            <p className="csBillHint">
              {error === null ? '当前没有可购买的套餐。' : '暂时读不到套餐列表，请点右上角刷新重试。'}
            </p>
          ) : (
            <div className="csBillGrid">
              {plans.map((plan) => {
                const buyable = plan.purchasable && canBuy('plan', plan.code) && !disabled
                const buying = state.buying === `plan:${plan.code}`
                const concurrency = Number(plan.entitlements['concurrent_generations'])
                return (
                  <article key={plan.code} className="csBillCard">
                    <div className="csBillCardHead">
                      <span className="csBillCardName">{plan.name}</span>
                      <span className="csBillPrice">
                        {formatPrice(plan.price_cents, plan.currency)}
                        <span className="csBillPriceUnit">/{periodLabel(plan.billing_period)}</span>
                      </span>
                    </div>
                    <ul className="csBillFacts">
                      <li>{periodLabel(plan.billing_period)} {formatCredits(plan.period_credits)} 积分</li>
                      {Number.isFinite(concurrency) && concurrency > 0 && (
                        <li>并发生成 {concurrency} 个</li>
                      )}
                    </ul>
                    <button
                      type="button"
                      className="csBillBtn csBillBtnPrimary"
                      disabled={!buyable}
                      title={plan.purchasable ? undefined : reasonLabel(plan.unavailable_reason)}
                      onClick={() => { props.onBuy('plan', plan.code) }}
                    >
                      {buying ? '打开支付页…' : (plan.purchasable ? '订阅' : reasonLabel(plan.unavailable_reason))}
                    </button>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="csBillSection">
          <h3 className="csBillSectionTitle">积分包</h3>
          {packs.length === 0 ? (
            <p className="csBillHint">
              {error === null ? '当前没有可购买的积分包。' : '暂时读不到积分包列表，请点右上角刷新重试。'}
            </p>
          ) : (
            <div className="csBillGrid">
              {packs.map((pack) => {
                const buyable = pack.purchasable && canBuy('credit_pack', pack.code) && !disabled
                const buying = state.buying === `credit_pack:${pack.code}`
                return (
                  <article key={pack.code} className="csBillCard">
                    <div className="csBillCardHead">
                      <span className="csBillCardName">{pack.name}</span>
                      <span className="csBillPrice">{formatPrice(pack.price_cents, pack.currency)}</span>
                    </div>
                    <ul className="csBillFacts">
                      <li>{formatCredits(pack.credit_amount)} 积分</li>
                      {/* 实测 `validity_days` 常缺失 = 不过期，此时不写任何有效期文案。 */}
                      {pack.validity_days !== undefined && pack.validity_days > 0 && (
                        <li>{pack.validity_days} 天内有效</li>
                      )}
                    </ul>
                    <button
                      type="button"
                      className="csBillBtn csBillBtnPrimary"
                      disabled={!buyable}
                      title={pack.purchasable ? undefined : reasonLabel(pack.unavailable_reason)}
                      onClick={() => { props.onBuy('credit_pack', pack.code) }}
                    >
                      {buying ? '打开支付页…' : (pack.purchasable ? '购买' : reasonLabel(pack.unavailable_reason))}
                    </button>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <p className="csBillFoot">
          支付在系统浏览器完成（Stripe 托管页），本应用不接触银行卡信息；积分到账以服务端为准，
          支付后切回本窗口会自动刷新。订阅与积分按账号记录，同一账号在其它桌面客户端通用。
        </p>
      </div>
    </div>
  )
}
