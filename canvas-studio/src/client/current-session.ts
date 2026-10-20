/**
 * 当前会话 / 最近会话的**唯一取数口径**（dsh 0.2.1）。
 *
 * 0.1.x 的 `SessionListState.current` 与 `ISessions.open()/clear()` 在 0.2.1 已删除；
 * 选择状态只存在于 `ui-workspace` 的私有 selection 与 Session 引用计数里。上游自己
 * 取「当前会话」的官方写法见 `packages/client/ui-layout/src/client/DocumentTitle.tsx`：
 * 主视图（main view）持引用的那个 Session 即当前会话。
 *
 * 因此本模块把这套推导收敛到一处，避免画布各处各写一份 `Object.values`：
 * - `currentSessionId` / `currentSession`：当前会话（主视图引用计数 > 0）；
 * - `recentSession`：最近更新的非空会话（替代已删除的 `WorkspaceSnapshot.recentWorkspaceId`）。
 */

import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
// 类型增强：`SessionReferenceSourceMap` 上获得 `mainView`（ui-session 客户端声明）。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** 会话 id 类型（沿用上游品牌类型，避免各处写 string）。 */
export type StudioSessionId = SessionSummary['id']

/**
 * 当前会话 id：主视图正在展示的那个 Session。
 * @param state - 会话列表快照。
 * @returns 当前会话 id；主视图未持引用（首页 / 无会话）时 undefined。
 */
export function currentSessionId(state: SessionListState): StudioSessionId | undefined {
  return Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}

/**
 * 当前会话摘要。
 * @param state - 会话列表快照。
 * @returns 当前会话行；无当前会话时 undefined。
 */
export function currentSession(state: SessionListState): SessionSummary | undefined {
  const id = currentSessionId(state)
  return id === undefined ? undefined : state.byId[id]
}

/**
 * 最近更新的非空会话；`blank` 空会话不参与（它们没有历史可恢复）。
 * @param state - 会话列表快照。
 * @returns 最新非空会话；全为空时 undefined。
 */
export function recentSession(state: SessionListState): SessionSummary | undefined {
  return Object.values(state.byId)
    .filter(session => session.blank !== true)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
}
