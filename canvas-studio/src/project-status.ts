/**
 * 左栏项目行状态徽标（CV-467）—— 六态推导的**唯一实现**。
 *
 * 参照 Claude Code Agent View / Cursor Cloud Agents 收敛的 6 态模型：
 * `waiting / running / failed / just-done / done / idle`。与「项目状态」的分工
 * 是同一套 Cursor 结论：**项目本身不发明状态，状态由「最近一次 run」推导**。
 *
 * ## 信号来源（逐态）
 *
 * - `waiting`：`workflow.pendingQuestion` 在场且未回答 —— wire 上现成，零延迟。
 * - `running`：只认**当前打开项目**的会话活动（用户拍板 2026-11-16）。客户端从
 *   `ISessions` 投影的 `running` 标志（与 test-driver 的回合判据同源字段）拿在飞
 *   事实；`lastRun.status === 'running'`（Host turn/start 落的盘）只作兜底，且
 *   带 {@link RUNNING_STALE_MS} 判旧 —— 进程被杀时它可能永远停在 running。
 * - `failed` / `just-done` / `done` / `idle`：由 `lastRun`（Host turn/end 结算落盘）
 *   推导；`just-done` 是**瞬态**，客户端按 {@link JUST_DONE_WINDOW_MS} 回落为
 *   `done`，不落盘（与里程碑时钟的「瞬态不入契约」同一纪律）。
 *
 * ## 两条用户拍板的硬约束（视觉基准 demo）
 *
 * 1. **徽标零文字**：只含「图标 + 时间」。时间对 running/waiting 是 `mm:ss` 计时
 *    （每秒跳动），对终态是相对时间（分钟级刷新）。状态文案全部收进 hover 弹框
 *    —— {@link PROJECT_STATUS_LABELS} 只服务弹框，不进徽标。
 * 2. **一个时间基准**：`now` 由调用方传入（DD-08 / R3，与 relative-time 同纪律），
 *    全列表共用，禁止逐行 `new Date()`。
 *
 * 纯函数、无 DOM、无 React：`node --test` 直连 lib 产物。
 */
import type { StudioProject } from './contracts/project.js'
import { relativeTime } from './relative-time.js'

/** 六态（视觉与语义基准：docs/demos/2026-11-16-项目状态徽标与hover弹框-demo.html）。 */
export type ProjectStatusState = 'waiting' | 'running' | 'failed' | 'just-done' | 'done' | 'idle'

/** just-done 回落窗口（用户拍板 5 分钟，模块级常量可配置）。 */
export const JUST_DONE_WINDOW_MS = 5 * 60_000

/**
 * `lastRun.status === 'running'` 的判旧窗口。
 *
 * turn/start 落了 running 盘之后进程可能被杀（崩溃 / 强退），turn/end 永远不会来
 * —— 这条记录若不判旧会把该项目永远钉在「执行中」。30 分钟远超真实回合墙钟上限
 * （test-driver 的回合上限 50 分钟是含生成编排的最坏情形，徽标宁可早点退成 idle
 * 也不要假 running；真在跑的项目由客户端会话活动信号实时点亮，不依赖这条兜底）。
 */
export const RUNNING_STALE_MS = 30 * 60_000

/** 排序权重：waiting > running > failed > just-done > done > idle（demo §2.1）。 */
export const PROJECT_STATUS_ORDER: Readonly<Record<ProjectStatusState, number>> = {
  waiting: 0,
  running: 1,
  failed: 2,
  'just-done': 3,
  done: 4,
  idle: 5,
}

/** 弹框状态胶囊的文案（徽标零文字铁律只约束徽标；弹框照常说人话）。 */
export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatusState, string>> = {
  waiting: '待你决策',
  running: '执行中',
  failed: '失败',
  'just-done': '刚刚完成',
  done: '已完成',
  idle: '空闲',
}

/** 客户端会话活动投影（store.sessionActivity 的形状；纯函数不 import client 代码）。 */
export interface SessionActivity {
  /** 当前会话绑定的项目 id。 */
  projectId: string
  /** 当前会话的回合是否在飞（SessionSummary.running）。 */
  running: boolean
  /** 本次进入该运行态的时刻（epoch ms；running 翻转时由 store 重置）。 */
  since: number
}

/** 单个项目的六态推导结果。 */
export interface ProjectStatus {
  state: ProjectStatusState
  /** 状态起点的 epoch ms（徽标计时 / 相对时间的基准）；推不出时为 null。 */
  since: number | null
}

/** 防御性读 lastRun：wire 上的脏值一律按「没有」处理（读路径不信任上游）。 */
function lastRunOf(project: StudioProject): {
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt?: number
  endedAt?: number
} | null {
  const lastRun = project.lastRun
  if (lastRun === undefined || lastRun === null || typeof lastRun !== 'object') return null
  const status = lastRun.status
  if (status !== 'running' && status !== 'done' && status !== 'failed' && status !== 'stopped') return null
  const startedAt = lastRun.startedAt
  const endedAt = lastRun.endedAt
  return {
    status,
    ...(typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0 ? { startedAt } : {}),
    ...(typeof endedAt === 'number' && Number.isFinite(endedAt) && endedAt > 0 ? { endedAt } : {}),
  }
}

/** ISO 时间戳的 epoch ms；非法返回 null（与 relativeTime 的容错口径一致）。 */
function tsOf(iso: string | undefined): number | null {
  if (iso === undefined) return null
  const at = Date.parse(iso)
  return Number.isFinite(at) ? at : null
}

/**
 * 项目是否在等用户决策（点选问题在场且未回答）。
 *
 * **唯一判据**，两处消费：本模块的状态推导、`project-sections.ts` 的桶内置顶。
 * 「已回答未清空」（answer 在场、Host 工具轮询还没取走）不算等待 —— 答案已在
 * 流向 agent，此刻的事实是「在处理」而不是「在等」。
 */
export function isWaitingProject(project: StudioProject): boolean {
  const question = project.workflow?.pendingQuestion
  return question !== null && question !== undefined && question.answer === undefined
}

/**
 * 六态推导（唯一实现）。
 *
 * @param project - 项目记录（调用方若持有更鲜的 store workflow，请先浅合并进来）。
 * @param now - 全列表共用的时间基准（DD-08 / R3）。
 * @param activity - 当前会话的运行活动（只对 `activity.projectId` 命中的项目生效
 *   —— 用户拍板：running 只对当前打开的项目显示）。
 */
export function projectStatusOf(project: StudioProject, now: Date, activity?: SessionActivity | null): ProjectStatus {
  // waiting 最优先：它在飞时 running 也可能在飞（ask_user_choice 是阻塞工具），
  // 但「等你决策」是用户此刻唯一需要响应的事实，压过一切。
  if (isWaitingProject(project)) {
    return { state: 'waiting', since: tsOf(project.updatedAt) }
  }
  // 当前打开项目 + 回合在飞：客户端零延迟信号，优先于任何落盘状态。
  if (activity !== undefined && activity !== null && activity.projectId === project.id && activity.running) {
    return { state: 'running', since: activity.since }
  }
  const lastRun = lastRunOf(project)
  if (lastRun !== null) {
    const endedAt = lastRun.endedAt ?? lastRun.startedAt
    if (lastRun.status === 'running') {
      const startedAt = lastRun.startedAt
      if (startedAt !== undefined && now.getTime() - startedAt < RUNNING_STALE_MS) {
        return { state: 'running', since: startedAt }
      }
      // 判旧兜底：假 running 过期即退 idle，绝不用 endedAt 顶替（它本就不存在）。
    } else if (endedAt !== undefined) {
      if (lastRun.status === 'failed') return { state: 'failed', since: endedAt }
      if (lastRun.status === 'done') {
        return {
          state: now.getTime() - endedAt < JUST_DONE_WINDOW_MS ? 'just-done' : 'done',
          since: endedAt,
        }
      }
      // stopped（被停止 / 纯聊天轮次）：空闲。since 仍指向最近活动时刻，徽标的
      // 相对时间由此而来 —— 「10 分钟前停的」比「项目 updatedAt」更贴近用户问题。
      return { state: 'idle', since: endedAt }
    }
  }
  // 无任何 run 记录（老项目 / 从未跑过）：空闲，相对时间退回 updatedAt。
  return { state: 'idle', since: tsOf(project.updatedAt) }
}

/**
 * 徽标的时间段（唯一格式化口径）。
 *
 * running/waiting 出 `mm:ss` 计时（负差值按 0 处理：时钟漂移时显示 00:00 而不是
 * 「-03:12」）；终态出相对时间（复用 relative-time 的分档，弹框里补绝对时刻）。
 * 推不出起点时返回 null（不渲染时间段，不留占位）。
 */
export function badgeTimeOf(status: ProjectStatus, now: Date): string | null {
  if (status.since === null || !Number.isFinite(status.since)) return null
  if (status.state === 'running' || status.state === 'waiting') {
    return formatClock(Math.max(0, now.getTime() - status.since))
  }
  return relativeTime(new Date(status.since).toISOString(), now)
}

/** 计时时钟：`mm:ss`，跨小时进位成 `h:mm:ss`（放手跑的长回合不显示成 91:24）。 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const twoDigits = (value: number): string => String(value).padStart(2, '0')
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`
}

/** 弹框「更新于」的绝对时刻（`M/D HH:MM`）；副行的相对时间只说「3 小时前」，弹框补精确时刻。 */
export function absoluteTimeOf(iso: string, now: Date): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const sameYear = at.getFullYear() === now.getFullYear()
  const date = `${at.getMonth() + 1}/${at.getDate()}`
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return sameYear ? `${date} ${time}` : `${at.getFullYear()}/${date} ${time}`
}

/** 弹框的状态专属块（按状态分派；无专属内容的态返回 null）。 */
export interface StatusDetail {
  kind: 'question' | 'reason' | 'ready'
  text: string
}

/**
 * 组装状态专属块。
 *
 * - waiting：问题原文（`pendingQuestion.question`）—— 用户要处理的正是它。
 * - failed：`lastRun.reason`（Host turn/end 落的失败原因；缺失则整块省略）。
 * - just-done / done：「成片已就绪 · 相对时间」（demo 的收工行）。
 * - running / idle：无专属块（running 的进度条由组件渲染，idle 无事可说）。
 */
export function statusDetailOf(status: ProjectStatus, project: StudioProject, now: Date): StatusDetail | null {
  if (status.state === 'waiting') {
    const question = project.workflow?.pendingQuestion?.question
    if (question === undefined || question.trim() === '') return null
    return { kind: 'question', text: question }
  }
  if (status.state === 'failed') {
    const reason = project.lastRun?.reason
    if (reason === undefined || reason.trim() === '') return null
    return { kind: 'reason', text: reason }
  }
  if (status.state === 'just-done' || status.state === 'done') {
    const endedAt = project.lastRun?.endedAt
    const relative = endedAt !== undefined && Number.isFinite(endedAt)
      ? relativeTime(new Date(endedAt).toISOString(), now)
      : null
    return { kind: 'ready', text: relative === null ? '成片已就绪' : `成片已就绪 · ${relative}` }
  }
  return null
}

/** 段头计数摘要（图标 + 数字，零文字；只有 > 0 的态才出现在 UI 上）。 */
export interface ProjectStatusCounts {
  waiting: number
  running: number
  failed: number
}

/**
 * 全列表的三态计数（waiting / running / failed）。
 *
 * `activity` 与 {@link projectStatusOf} 同一份入参口径 —— 计数与徽标必须说同一套话，
 * 「段头写 1 执行中、行上却找不着」比不写计数更糟。
 */
export function countActiveStatuses(
  projects: readonly StudioProject[],
  now: Date,
  activity?: SessionActivity | null,
): ProjectStatusCounts {
  const counts: ProjectStatusCounts = { waiting: 0, running: 0, failed: 0 }
  for (const project of projects) {
    const state = projectStatusOf(project, now, activity).state
    if (state === 'waiting' || state === 'running' || state === 'failed') counts[state] += 1
  }
  return counts
}
