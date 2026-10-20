/**
 * REQ-034 · O-05 RenderHost 自报状态（**纯存储，无副作用**）。
 *
 * 隐藏窗口每拍把「我是什么状态、WebCodecs 能不能用」报到宿主；宿主用它：
 * - 真机验收时一眼看出窗口是 idle / unsupported（不用打开 DevTools）；
 * - O-06 派单前判活（`state === 'idle'` 且心跳新鲜）。
 *
 * 存内存不落盘：这与工单表同口径（`render-job.ts` 的模块级 Map），进程重启即清零。
 */

export type RenderHostReportState = 'booting' | 'idle' | 'unsupported' | 'error'

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
  const raw = (input ?? {}) as { state?: unknown; detail?: unknown; selfCheck?: unknown }
  const state = normalizeState(raw.state)
  const detail = typeof raw.detail === 'string' ? raw.detail.slice(0, MAX_DETAIL_CHARS) : undefined
  const selfCheck = normalizeSelfCheck(raw.selfCheck)
  const report: RenderHostReport = {
    state,
    at: now,
    ...(detail === undefined ? {} : { detail }),
    ...(selfCheck === undefined ? {} : { selfCheck }),
  }
  lastReport = report
  return report
}

export function lastRenderHostReport(): RenderHostReport | undefined {
  return lastReport
}

/** 测试与「窗口重建」用：清掉上一窗口留下的状态，避免误判为活的。 */
export function resetRenderHostReport(): void {
  lastReport = undefined
}

function normalizeState(value: unknown): RenderHostReportState {
  switch (value) {
    case 'booting':
    case 'idle':
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
