/**
 * 预估积分读数（三个输入卡底栏 + 卡面「重新生成」共用的唯一渲染点）。
 *
 * ## 为什么做成组件
 *
 * 改造前三个形态各算一套（`CREDIT_ESTIMATE` 表 / `creditRows` 前端公式 /
 * `creditCostOf` 字数公式），三处口径互不相同且都与后端实价无关 ——
 * 实测最大偏差 −49%（15s 视频报 46、实扣 90）。现在三处只喂参数，读数只在这里
 * 生成：口径只有一份，改价只改后端。
 *
 * ## 三态怎么显示（不装精确）
 *
 * | 情况 | 读数 | 语义 |
 * |---|---|---|
 * | 在飞、无旧值 | `…` | 正在问服务端 |
 * | 有数 | `30` / `21.1354` | 服务端报价（与实扣一分不差） |
 * | 失败但有旧值 | `约 30`（标灰） | 上一次成功的数，仅供参考 |
 * | 失败且无旧值 | `—` | 不知道，不猜 |
 *
 * 「约」不只是文案：它是**唯一**允许出现「不精确数字」的形态。价目表兜底（B 层）
 * 也要走这一档，绝不允许把推算值渲染成精确值。
 */
import type { ReactElement } from 'react'
import { useSyncExternalStore } from 'react'
import { formatCredits } from '../../account-format.js'
import type { CreditQuoteParams } from '../../contracts/account.js'
import { getCreditsState, subscribeCredits } from '../credits-store.js'
import { formatQuoteCredits, useCreditQuote } from '../use-credit-quote.js'

export interface CreditChipProps {
  /** 报价参数；`null` = 当前没有可报的东西（读数显示 `—`）。 */
  params: CreditQuoteParams | null
  /** 追在原 title 之后的说明（如「时长与清晰度会另行结算」这类口径注记）。 */
  hint?: string
}

/** 预估读数（渲染 + title 文案）的唯一实现，两种壳子共用。 */
function useCreditChipReading(params: CreditQuoteParams | null, hint: string | undefined): {
  shown: string
  stale: boolean
  title: string
} {
  const quote = useCreditQuote(params)
  // 预估与余额同屏：用户真正的决策依据是「花得起吗」，不是单个数字。
  // 余额走 credits-store（Host 的 TTL 由它自己判），这里只读快照。
  const creditsState = useSyncExternalStore(subscribeCredits, getCreditsState, getCreditsState)
  const available = creditsState.view?.balance?.available_balance ?? null

  const shown = quote.status === 'loading'
    ? '…'
    : quote.credits === null
      ? '—'
      : `${quote.stale ? '约 ' : ''}${formatQuoteCredits(quote.credits)}`

  const parts: string[] = []
  if (quote.status === 'loading') {
    parts.push('正在向服务端报价…')
  } else if (quote.credits !== null && !quote.stale) {
    parts.push(`本次预计消耗 ${formatQuoteCredits(quote.credits)} 积分（服务端报价，与实扣一致）`)
  } else if (quote.credits !== null) {
    parts.push(`上次报价 ${formatQuoteCredits(quote.credits)} 积分（本次报价失败，仅供参考）`)
  } else {
    parts.push('本次报价暂不可用（不影响提交，服务端仍会按实价扣费）')
  }
  if (available !== null) parts.push(`当前可用 ${formatCredits(available)} 积分`)
  if (quote.error !== null) parts.push(`原因：${quote.error}`)
  if (hint !== undefined) parts.push(hint)

  return {
    shown,
    stale: quote.stale || quote.status === 'failed',
    title: parts.join(' · '),
  }
}

/** 只读预估 chip（image / audio 形态：没有明细可展开）。 */
export function CreditChip(props: CreditChipProps): ReactElement {
  const reading = useCreditChipReading(props.params, props.hint)
  return (
    <span
      className={reading.stale ? 'csInputPill csInputCredits csInputCreditsStale' : 'csInputPill csInputCredits'}
      title={reading.title}
      // 预估是会变的读数：读屏用户需要知道它更新了，但不该被反复打断 —— polite。
      aria-live="polite"
    >
      ✦ <span className="csInputCreditsNum">{reading.shown}</span> · 预估
    </span>
  )
}

export interface CreditChipButtonProps extends CreditChipProps {
  /** 弹层展开态（由卡片统一管 `openPop`：同一时刻只开一个弹层）。 */
  open: boolean
  onToggle(): void
  /**
   * 弹层里的**事实**行（模型 / 时长 / 画幅 / 清晰度…）。
   *
   * 刻意只放事实、不放「各项多少积分」：后端只给总数，逐项拆解必须等价目表
   * （方案 B 层）。自己乘一遍加出来的明细与实扣对不上时，用户会以为被多扣了。
   */
  rows: ReadonlyArray<readonly [string, string]>
  /** 弹层脚注（口径说明）。 */
  foot: string
}

/** 可展开的预估 chip（video 形态：需要「这个数是怎么来的」的解释）。 */
export function CreditChipButton(props: CreditChipButtonProps): ReactElement {
  const reading = useCreditChipReading(props.params, props.hint)
  return (
    <span className="csInputSel">
      <button
        type="button"
        className={
          'csInputPill csInputCredits'
          + (reading.stale ? ' csInputCreditsStale' : '')
          + (props.open ? ' csInputPillOn' : '')
        }
        title={reading.title}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        ✦ <span className="csInputCreditsNum">{reading.shown}</span> · 预估
      </button>
      {props.open && (
        <span className="csChipPop csCreditPop">
          {props.rows.map(([label, value]) => (
            <span className="csCreditRow" key={label}>
              <span className="csCreditRowLabel">{label}</span>
              <span className="csCreditRowValue">{value}</span>
            </span>
          ))}
          <span className="csCreditRow csCreditRowTotal">
            <span>本次预估</span>
            <span>{reading.shown}</span>
          </span>
          <span className="csCreditFoot">{props.foot}</span>
        </span>
      )}
    </span>
  )
}
