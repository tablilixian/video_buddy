import type { StudioProject, StudioProjectGroup } from './contracts/project.js'
import { isWaitingProject } from './project-status.js'

/**
 * CV-181 / E-2：左栏分区分桶的唯一实现。
 *
 * 起因是一次真实的数据丢失。原来的投影写在 `ProjectList.tsx` 里：
 *
 *     const ungrouped = projects.filter(p => p.groupId === undefined || p.groupId === null)
 *     const sections  = groups.map(g => ({ ..., items: projects.filter(p => p.groupId === g.id) }))
 *
 * 两行都只看「等不等于」，于是 `groupId` 指向一个**已不存在的分组**时，
 * 项目两个桶都不收 —— 既不在任何分组段，也不在未分组段，
 * **卡片在左栏彻底消失**（数据好好的，只是没人渲染它）。
 *
 * 什么时候会悬空：`groups.json` 被删除/回滚、或切换资产库根之后
 * （两个根各有一份 `groups.json`，项目记录却可能来自另一份）。
 * 表现为「项目有记录但看不见」，用户只会觉得「我的项目丢了」。
 *
 * 现在的口径：**分组认不出来就回落未分组**。未分组桶是常驻兜底，
 * 宁可让用户在一个显眼的地方看到它，也不要静默吞掉。
 *
 * 顺序约定：`groups` 的先后由调用方决定（store 已按 `order` 升序给出），
 * 本函数**原样保持**、不给分组二次排序；桶内项目按「CV-467 waiting 置顶 + 其余
 * 按 `updatedAt` 倒序」（见 {@link byStatusThenUpdatedDesc}）。两条顺序规则都收
 * 在这个函数里 —— 排序口径仍然只有一处。
 */
export interface ProjectSection {
  readonly key: string
  readonly title: string
  readonly groupId: string
  readonly items: readonly StudioProject[]
}

export interface ProjectSections {
  /** 未分组桶的内容（含 groupId 悬空的回落项）。 */
  readonly ungrouped: readonly StudioProject[]
  /** 各用户分组（顺序同入参）。 */
  readonly sections: readonly ProjectSection[]
}

/**
 * CV-264③：桶内按「最后修改」倒序（新 → 旧）。
 *
 * 口径定稿（2026-09-30）：REQ-005 / T4 按 `updatedAt` 的意图没变（「我最近在
 * 做哪个」），错的只是**燃料**——「打开项目即 touch」让纯浏览也顶到第一
 * （验收反馈「点哪个哪个排第一，不稳定」）。定稿：删 touch，`updatedAt` 只由
 * **真修改**写入（writeCanvas 画布保存 / 生成结算、updateWorkflow、移组、
 * 创建），打开浏览零扰动。
 *
 * 用 `Date.parse` 而不是 `localeCompare`：ISO 8601 字符串里可能混着 `Z` 与
 * `+08:00`，字典序会把「同一时刻」排成两个顺序；数值比较没有这个坑，还能
 * 顺手把「不可解析」识别出来。
 *
 * 不可解析的记录**垫底**：倒序下最前面是黄金位，坏数据抢头版比它沉底伤得多。
 * 两者都坏时返回 0 —— 交给 Array.prototype.sort 的稳定性保持原相对顺序
 * （Node ≥ 11 已保证稳定，不去动它）。
 */
const byUpdatedAtDesc = (left: StudioProject, right: StudioProject): number => {
  const leftAt = Date.parse(left.updatedAt)
  const rightAt = Date.parse(right.updatedAt)
  const leftOk = Number.isFinite(leftAt)
  const rightOk = Number.isFinite(rightAt)
  if (!leftOk || !rightOk) return leftOk === rightOk ? 0 : (leftOk ? -1 : 1)
  return rightAt - leftAt
}

/**
 * CV-467：桶内排序 = **waiting 置顶 + 其余 updatedAt 倒序**（用户拍板 2026-11-16）。
 *
 * demo 的六态全量权重排序（waiting > running > failed > …）**没有**采纳：全量重排
 * 会把 REQ-005 已验收的「按最后修改倒序」（CV-264③ 定稿口径）整个推翻，徽标自己
 * 已经把六态说清楚了，顺序再跟着状态抖动反而让「我最近在做的项目」从指缝里溜走。
 * 只有 waiting 例外 —— 「在等你决策」的项目不置顶就等于不存在（列表长的时候它
 * 沉在中段，用户不点进去永远不知道有个问题在等），这正是徽标要回答的第 2 个问题。
 *
 * waiting 判据复用 `isWaitingProject`（project-status.ts 的唯一实现），不在这里
 * 重写一份 `pendingQuestion != null` —— 判据分叉迟早漂移。
 */
const byStatusThenUpdatedDesc = (left: StudioProject, right: StudioProject): number => {
  const leftWaiting = isWaitingProject(left)
  const rightWaiting = isWaitingProject(right)
  if (leftWaiting !== rightWaiting) return leftWaiting ? -1 : 1
  return byUpdatedAtDesc(left, right)
}

/** 把项目分成「未分组桶 + 各分组段」，悬空 groupId 回落未分组；每桶内 waiting 置顶、其余按改动时间倒序。 */
export function resolveVisibleSections(
  projects: readonly StudioProject[],
  groups: readonly StudioProjectGroup[],
): ProjectSections {
  const known = new Set(groups.map(group => group.id))
  const buckets = new Map<string, StudioProject[]>()
  for (const group of groups) buckets.set(group.id, [])

  const ungrouped: StudioProject[] = []
  for (const project of projects) {
    const groupId = project.groupId
    // 三种都算「没有可归属的分组」：字段缺失、显式归零、指向已删除的分组。
    if (groupId === undefined || groupId === null || !known.has(groupId)) {
      ungrouped.push(project)
      continue
    }
    // known.has 已保证键存在；取不到就不硬塞 —— 这里不制造第二份归属口径。
    const bucket = buckets.get(groupId)
    if (bucket !== undefined) bucket.push(project)
  }

  return {
    // 排序口径收口在这里（分桶的同一处）：分组顺序仍由 groups 决定、不重排，
    // 只有**桶内**的项目按 waiting 置顶 + updatedAt 倒序（CV-467）。
    ungrouped: ungrouped.sort(byStatusThenUpdatedDesc),
    sections: groups.map(group => ({
      key: group.id,
      title: group.name,
      groupId: group.id,
      items: (buckets.get(group.id) ?? []).sort(byStatusThenUpdatedDesc),
    })),
  }
}
