/**
 * 左栏余额卡（CV-358，方案 P3「积分落地清单」第 3 层）。
 *
 * 这张卡在 REQ-030 ③ 时代是**纯展示占位**（`0 / 1,000` + 置灰「升级套餐」，因为
 * 没有商业化后端）。现在数据源有了，占位换成真实余额，但两件事刻意不变：
 *
 * 1. **没有分母**：后端 `/v1/credits/balance` 只给可用与冻结，没有总额度 ——
 *    `x / 1,000` 那个 1000 是当年的前端常量，接真数据后自造分母就是假数据；
 * 2. **「升级套餐」继续置灰**：商业化入口未接，这条与余额数据无关。
 *
 * 七种态都在这里收口（未配置账号体系 / 未登录 / 首帧 / 正常 / 有冻结 / 失败有旧值 /
 * 账号受限），StudioFrame 只负责给 props —— 状态判断散到两处会互相打架。
 */
import type { ReactElement } from 'react'
import { formatCredits } from '../account-format.js'
import type { AccountCreditsView } from '../contracts/account.js'

export interface CreditsCardProps {
  /** Host 视图；null = 还没问过（首帧，**不能当成 0**）。 */
  view: AccountCreditsView | null
  /** 是否已登录（client 侧 auth-store）。 */
  signedIn: boolean
  /** 本地模式（未配置账号体系）：整卡隐藏，与登录入口的既有语义一致。 */
  localMode: boolean
  /** 请求在飞：只影响 `aria-busy` / 轻提示，不换数字、不闪骨架。 */
  loading: boolean
  /** client 侧请求失败（连不上 Host）；Host 视图内的 error 是服务端失败。 */
  failure: string | null
  onRefresh(): void
  onSignIn(): void
}

function CreditGlyph(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5 9.7 6l4.5 1.6L9.7 9.2 8 13.7 6.3 9.2 1.8 7.6 6.3 6 8 1.5Z" />
    </svg>
  )
}

/** 「升级套餐」：长期 disabled（商业化后端未接入），不变。 */
function UpgradeButton(): ReactElement {
  return (
    <button type="button" className="csCreditsUpgrade" disabled title="即将上线">
      升级套餐
    </button>
  )
}

/** 更新时间 → `HH:MM:SS`；解析失败返回 null（不显示假时间）。 */
function clockOf(iso: string | null): string | null {
  if (iso === null) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleTimeString('zh-CN', { hour12: false })
}

export function CreditsCard({
  view, signedIn, localMode, loading, failure, onRefresh, onSignIn,
}: CreditsCardProps): ReactElement | null {
  // 未配置账号体系 = 本地模式：没有登录、也就没有余额，整卡隐藏。
  if (localMode) return null

  if (!signedIn) {
    return (
      <div className="csCredits">
        <button
          type="button"
          className="csCreditsRow csCreditsRowBtn"
          title="登录后查看积分余额"
          onClick={onSignIn}
        >
          <CreditGlyph />
          <span>Credits</span>
          <span className="csCreditsVal">登录后查看</span>
        </button>
        <UpgradeButton />
      </div>
    )
  }

  // 已登录但管理面被关掉（`businessApiBase` 清空）：没有任何可展示的数字。
  if (view !== null && !view.enabled) return null

  const balance = view?.balance ?? null
  const restricted = view?.disabled === true
  // Host 侧错误优先于 client 侧（前者带服务端错误码，信息更具体）。
  const problem = restricted
    ? '账号受限，暂不可用'
    : (view?.error?.message ?? failure ?? null)
  const clock = clockOf(view?.fetchedAt ?? null)

  const value = restricted ? '—' : (balance === null ? '—' : formatCredits(balance.available_balance))
  const frozenLine = balance !== null && balance.frozen_balance > 0
    ? `冻结 ${formatCredits(balance.frozen_balance)}`
    : null
  // 提示行只放一条：受限 > 失败 > 冻结。三条都塞会变成一堵小字墙。
  const hint = restricted || problem !== null || frozenLine !== null

  const title = restricted
    ? '账号受限，余额不可用'
    : (balance === null
      ? '点击读取积分余额'
      : `可用余额${clock === null ? '' : `，更新于 ${clock}`}${loading ? '（刷新中…）' : '，点击刷新'}`)

  return (
    <div className={problem === null ? 'csCredits' : 'csCredits csCreditsStale'}>
      <button
        type="button"
        className="csCreditsRow csCreditsRowBtn"
        title={title}
        aria-busy={loading}
        disabled={restricted}
        onClick={onRefresh}
      >
        <CreditGlyph />
        <span>Credits</span>
        <span className="csCreditsVal">{value}</span>
      </button>
      {hint && (
        <p className={problem === null ? 'csCreditsHint' : 'csCreditsHint csCreditsHintWarn'}>
          {restricted
            ? '账号受限，暂不可用'
            : (problem !== null
              ? (balance === null ? '读取失败' : '刷新失败，显示上次数据')
              : frozenLine)}
        </p>
      )}
      <UpgradeButton />
    </div>
  )
}
