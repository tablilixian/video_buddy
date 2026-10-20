/**
 * REQ-034 · O-05 RenderHost 自报状态（**纯存储，无副作用**）。
 *
 * 隐藏窗口每拍把「我是什么状态、WebCodecs 能不能用」报到宿主；宿主用它：
 * - 真机验收时一眼看出窗口是 idle / unsupported（不用打开 DevTools）；
 * - O-06 派单前判活（`state === 'idle'` 且心跳新鲜）。
 *
 * 存内存不落盘：这与工单表同口径（`render-job.ts` 的模块级 Map），进程重启即清零。
 */

/** 渲染窗口每 1s 自报一拍；超过这个间隔没收到就算失联（方案 O-06 的心跳判活）。 */
export const RENDER_HOST_HEARTBEAT_MS = 1000

/**
 * 判失联阈值（毫秒）。
 *
 * 为什么不是「一拍没到就算死」：`draft` 档用 `pageResponsiveness: 'disabled'`，
 * 渲染期主线程几乎不让出（这是它快的原因）—— 定时器会抖。30s 是「抖」与「真挂」
 * 的分界：`pageResponsiveness: 'disabled'` 下最坏一次让出间隔也在秒级。
 */
export const RENDER_HOST_STALE_MS = 30_000

export type RenderHostReportState = 'booting' | 'idle' | 'rendering' | 'unsupported' | 'error'

export interface RenderHostSelfCheckReport {
  webCodecs: boolean
  videoEncoder: boolean
  videoDecoder: boolean
  hardwareConcurrency: number
}

export interface RenderHostReport {
  state: RenderHostReportState
  detail?: string
  selfCheck?: RenderHostSelfCheckReport
  /** 正在渲染的工单 id（观测用；让 `/status` 一眼看出「忙在哪一单」）。 */
  jobId?: string
  /** 收到这一拍的时间戳（宿主时钟）。 */
  at: number
}

/** 文案/字段长度上限：这条通道来自页面，不能让它把宿主内存写成任意大。 */
const MAX_DETAIL_CHARS = 240

let lastReport: RenderHostReport | undefined

/**
 * 记录一次自报。
 *
 * 未知 `state` 一律收敛成 `error` —— 让宿主侧的联合类型永远可信，
 * 而不是把页面的脏值透传到派单判断里。
 */
export function recordRenderHostReport(input: unknown, now = Date.now()): RenderHostReport {
  const raw = (input ?? {}) as { state?: unknown; detail?: unknown; selfCheck?: unknown; jobId?: unknown }
  const state = normalizeState(raw.state)
  const detail = typeof raw.detail === 'string' ? raw.detail.slice(0, MAX_DETAIL_CHARS) : undefined
  const selfCheck = normalizeSelfCheck(raw.selfCheck)
  const jobId = typeof raw.jobId === 'string' && raw.jobId.length > 0 && raw.jobId.length <= 80
    ? raw.jobId
    : undefined
  const report: RenderHostReport = {
    state,
    at: now,
    ...(detail === undefined ? {} : { detail }),
    ...(selfCheck === undefined ? {} : { selfCheck }),
    ...(jobId === undefined ? {} : { jobId }),
  }
  lastReport = report
  return report
}

export function lastRenderHostReport(): RenderHostReport | undefined {
  return lastReport
}

/**
 * 心脏还跳不跳（纯读时钟，无副作用）。
 *
 * `alive` 只看「最近一次上报是否新鲜」，不看具体状态 —— `unsupported` 的窗口也活着，
 * 只是干不了活。要不要把工单交给它由 `renderHostReady()` 判。
 */
export interface RenderHostHealth {
  alive: boolean
  state: RenderHostReportState
  /** 距最近一次上报的毫秒数；从未上报时为 `Number.POSITIVE_INFINITY`。 */
  ageMs: number
  jobId?: string
}

export function renderHostHealth(now = Date.now()): RenderHostHealth {
  if (lastReport === undefined) return { alive: false, state: 'error', ageMs: Number.POSITIVE_INFINITY }
  const ageMs = Math.max(0, now - lastReport.at)
  return {
    alive: ageMs <= RENDER_HOST_STALE_MS,
    state: lastReport.state,
    ageMs,
    ...(lastReport.jobId === undefined ? {} : { jobId: lastReport.jobId }),
  }
}

/**
 * 能不能接单（派单闸）。
 *
 * 只认 `idle` / `rendering`：前者空着，后者在忙但活着 —— 忙时**也**该归它，
 * 宿主侧的串行队列会排队，不能因为它在忙就把同一线片子甩回客户端。
 * `booting` 不算：窗口刚起来还没自检完，交给它等于赌。
 */
export function renderHostReady(now = Date.now()): boolean {
  const health = renderHostHealth(now)
  if (!health.alive) return false
  return health.state === 'idle' || health.state === 'rendering'
}

/** 测试与「窗口重建」用：清掉上一窗口留下的状态，避免误判为活的。 */
export function resetRenderHostReport(): void {
  lastReport = undefined
}

function normalizeState(value: unknown): RenderHostReportState {
  switch (value) {
    case 'booting':
    case 'idle':
    case 'rendering':
    case 'unsupported':
    case 'error':
      return value
    default:
      return 'error'
  }
}

function normalizeSelfCheck(value: unknown): RenderHostSelfCheckReport | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const flag = (key: string): boolean => v[key] === true
  const cores = typeof v.hardwareConcurrency === 'number' && Number.isFinite(v.hardwareConcurrency)
    ? Math.max(0, Math.trunc(v.hardwareConcurrency))
    : 0
  return {
    webCodecs: flag('webCodecs'),
    videoEncoder: flag('videoEncoder'),
    videoDecoder: flag('videoDecoder'),
    hardwareConcurrency: cores,
  }
}
