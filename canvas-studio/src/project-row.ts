/**
 * 侧栏项目卡副行（DD-08 / R3）——「这个项目做到哪了」的**唯一组装实现**。
 *
 * 三样信息全部来自**已在 wire 上**的字段，零契约改动、零数据迁移：
 * - `workflow.state` → 阶段词（经 workflow-stage 的 STATE_FLOOR，与底部六段轨道同源）；
 * - `plan.aspectRatio` / `plan.targetDuration` → 产出规格（CV-099 创建时锁定）；
 * - `updatedAt` → 相对时间（relative-time.ts）。
 *
 * 纯函数、无 DOM、无 React：`node --test` 可直连。组件只做 JSX 拼接，不做判断 ——
 * 一旦「什么时候显示哪一段」散到组件里，卡片与列表的取值口径就会分叉。
 */
import type { StudioProject, StudioProjectPlan } from './contracts/project.js'
import { relativeTime } from './relative-time.js'
import { workflowStateStageLabel, type WorkflowStageLabel } from './workflow-stage.js'

/**
 * 产出规格摘要（`16:9 · 30s`）——**唯一组装实现**，两处共用：
 * 左栏项目卡副行（DD-08 / R3）与输入区项目上下文条（DD-09 / d）。
 *
 * 抽出来的理由不是复用癖：两个落点都必须同一种写法，否则「改了一处忘了另一处」
 * 会让同一份数据在两条 UI 上说不同的话（CV-160 的教训）。
 *
 * 用 `16:9 · 30s` 而不是 `16:9 横屏 · 目标 30 秒`：左栏只有 200~280px 宽，
 * 长了会被省略号吃掉后半截 —— 而吃掉的那半恰好是数字。
 *
 * 时长的合法性判据与 `suggestShotCount` **同一套**（存在 / 有限 / > 0）：两处
 * 由同一份数据派生，一处显示 `0s`、另一处不显示建议镜头数就是自相矛盾。
 * 契约侧的 `normalizePlan` 会拦非法值，但读路径不该相信上游 —— `NaNs` 这种
 * 字面量比缺一段更糟（它看起来像个值）。
 *
 * @param plan - 项目记录的预置规格（CV-099）；老记录无此字段即未锁定。
 * @returns 摘要串；两项都未锁定时返回 null（而不是拼出空串）。
 */
export function planSummaryOf(plan: StudioProjectPlan | undefined): string | null {
  const parts: string[] = []
  if (plan?.aspectRatio !== undefined) parts.push(plan.aspectRatio)
  const duration = plan?.targetDuration
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) parts.push(`${duration}s`)
  return parts.length === 0 ? null : parts.join(' · ')
}

/** 副行三段的取值（各自可为空 —— 空的那段不渲染，不留占位）。 */
export interface ProjectRowMeta {
  /** 当前阶段（剧本 / 分镜 / 定妆 / 关键帧 / 镜头 / 成片）。 */
  stage: WorkflowStageLabel
  /** 产出规格摘要（如 `16:9 · 30s`）；未锁定时为 null。 */
  plan: string | null
  /** 最后活动时间（如 `3 小时前`）；时间戳非法时为 null。 */
  time: string | null
}

/**
 * 组装副行。`now` 由调用方传入（理由见 relative-time.ts 的模块注释）。
 *
 * 规格摘要委托 `planSummaryOf`（本批抽出的唯一实现）；两项都未锁定时该段为 null。
 */
export function projectRowMeta(project: StudioProject, now: Date): ProjectRowMeta {
  return {
    stage: workflowStateStageLabel(project.workflow?.state),
    plan: planSummaryOf(project.plan),
    // 用 updatedAt（「最后动过」才是有用的信息）。两份时间戳在契约里都是必填，
    // 故这里不做缺失兜底 —— 真缺了说明记录本身坏了，静默改用 createdAt 会让
    // 「刚建好却显示 3 天前」这种矛盾更难查。
    time: relativeTime(project.updatedAt, now),
  }
}
