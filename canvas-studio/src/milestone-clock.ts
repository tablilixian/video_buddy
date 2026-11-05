/**
 * P1-1（骨架优先出片）· 里程碑时钟 —— **纯函数**，Host 与浏览器共用。
 *
 * 只做一件事：把 `landedAt / firstDraftAt / now` 折算成一行可渲染状态。
 * 不做 IO、不读 localStorage、不认识 React —— 开关与定时器都在
 * `client/MilestoneBar.tsx` 里，这里只判时间，`node --test` 才能直测。
 *
 * ## 为什么是**内部验收件**（2026-11-05 拍板）
 * 用户只在乎能不能拿到结果；给他看「硬线剩 6:36」等于把工程焦虑外化，
 * 超线变红更像在提醒他我们没做到。⇒ 默认不渲染，只有
 * `localStorage['canvas-studio.milestone'] = '1'`（或 `canvas-studio.dev`）
 * 时才挂到画布顶部工作条。产品形态是画布上的产物卡本身，不是这行字。
 *
 * ## 两条线与方案文档同源
 * M0 骨架 8min 只作颜色过渡（gold），**不参与判定**；M1 首片 20min 是唯一硬线。
 * 改这里的数值必须同步 `docs/plans/骨架优先出片-增量迭代方案-20261105.md` §2 预算表。
 */

/** M1 硬线：故事板落地后必须出首片（20min）。`render-anchor` 的分钟口径从这里派生。 */
export const M1_DEADLINE_MS = 20 * 60_000

/** M0 骨架线：越过它只是「开始紧」，不判失败。 */
export const M0_SKELETON_MS = 8 * 60_000

/**
 * 五档：
 *  - `pending`  没有 `landedAt`（老项目 / 还没落地）⇒ 不渲染；
 *  - `running`  T+0 ~ T+8，还有富余；
 *  - `tight`    T+8 ~ T+20，该慌了但还没超；
 *  - `overdue`  越过 T+20 仍无成片；
 *  - `done`     首片已出（此后计时只作参照，不再告警）。
 */
export type MilestonePhase = 'pending' | 'running' | 'tight' | 'overdue' | 'done'

export interface MilestoneInput {
  now: number
  /** 故事板落地时刻（registry.workflow.landedAt）。老项目可能没有。 */
  landedAt?: number | undefined
  /** 第一张 draft 成片落地时刻（registry.workflow.firstDraftAt）。 */
  firstDraftAt?: number | undefined
}

export interface MilestoneState {
  visible: boolean
  phase: MilestonePhase
  hasDraft: boolean
  /** 从落地到现在（时钟回拨时钳到 0）。 */
  elapsedMs: number
  /** 距 M1 还差多少（已超线为 0）。 */
  remainingMs: number
  /** 越过 M1 多少（未超线为 0）。 */
  overdueMs: number
  /** 首片用时（未出片为 null）。 */
  firstDraftMs: number | null
  headline: string
  detail: string
}

/** 时间戳合法性：正数且有限。0 / NaN / 负数一律按「没有」处理，不给存量项目造红字。 */
function isStamp(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * `M:SS`，超过一小时才升到 `H:MM:SS`。
 * 负数与 NaN 钳到 0 —— 调用方（尤其 `now - landedAt`）不该在这里抛。
 */
export function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const total = Math.floor(safe / 1000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${String(hours)}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${String(minutes)}:${ss}`
}

const PENDING: MilestoneState = {
  visible: false,
  phase: 'pending',
  hasDraft: false,
  elapsedMs: 0,
  remainingMs: M1_DEADLINE_MS,
  overdueMs: 0,
  firstDraftMs: null,
  headline: '',
  detail: '',
}

/**
 * 折算成一行状态。
 *
 * 判定顺序写死为「已出片 → 超线 → 紧 → 富余」：已出片优先，是因为首片一旦落地，
 * 后面再花多久都是优化，不该继续报红（否则红了以后永远红，颜色就失去意义）。
 */
export function milestoneState(input: MilestoneInput): MilestoneState {
  if (!isStamp(input.landedAt)) return PENDING
  const start = input.landedAt
  const now = Number.isFinite(input.now) ? input.now : start
  const elapsedMs = Math.max(0, now - start)
  const hasDraft = isStamp(input.firstDraftAt)
  const firstDraftMs = hasDraft ? Math.max(0, (input.firstDraftAt as number) - start) : null
  const remainingMs = Math.max(0, M1_DEADLINE_MS - elapsedMs)
  const overdueMs = Math.max(0, elapsedMs - M1_DEADLINE_MS)
  const detail = `T+${formatClock(elapsedMs)}`

  if (firstDraftMs !== null) {
    return {
      visible: true,
      phase: 'done',
      hasDraft: true,
      elapsedMs,
      remainingMs,
      overdueMs,
      firstDraftMs,
      headline: `M1 已达成 · 用时 ${formatClock(firstDraftMs)}`,
      detail,
    }
  }

  // 判据用 `elapsedMs >= 硬线`，**不能**用 `overdueMs > 0`：踩线那一秒 overdueMs 恰好
  // 是 0，会把「已到期限」误判成「还剩 0:00 的紧档」—— 正是最需要报警的时刻不报警。
  const phase: MilestonePhase = elapsedMs >= M1_DEADLINE_MS
    ? 'overdue'
    : elapsedMs >= M0_SKELETON_MS ? 'tight' : 'running'

  return {
    visible: true,
    phase,
    hasDraft: false,
    elapsedMs,
    remainingMs,
    overdueMs,
    firstDraftMs: null,
    headline: phase === 'overdue'
      // 刚越过那一秒不显示「已超 0:00」（读起来像没超）：不足一秒只说事实。
      ? (overdueMs >= 1000 ? `已超 M1 硬线 ${formatClock(overdueMs)}` : '已超 M1 硬线')
      : `M1 剩 ${formatClock(remainingMs)}`,
    detail,
  }
}
