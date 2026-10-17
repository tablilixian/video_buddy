/**
 * REQ-034 · 二期 1b：**渲染进度**的模块级状态（零 React 依赖，与 `render-preview.ts` 同一套模式）。
 *
 * 为什么单独一个模块而不是塞进项目 store：进度是**高频、短命**的渲染期状态
 * （每 3% 一变，渲完即消失），进 store 会牵动整棵画布重渲染，而它只服务一个角标。
 *
 * 数据流：`client/index.ts` 的 `onProgress` → `setRenderProgress`（本模块，驱动 UI）
 * ＋ `reportStudioRenderProgress`（回传宿主，供 `GET /remotion/jobs` 与 agent 观测）。
 */
export interface RenderProgressState {
  jobId: string
  /** 0–1。 */
  progress: number
}

type Listener = () => void

let current: RenderProgressState | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 订阅进度变化（React 侧经 `useSyncExternalStore` 消费）。 */
export function subscribeRenderProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前进度快照（`null` = 没有正在渲染的成片）。 */
export function getRenderProgressSnapshot(): RenderProgressState | null {
  return current
}

/** 更新进度（同一单才覆盖；换单直接替换 —— 并发已被宿主限制为 1）。 */
export function setRenderProgress(jobId: string, progress: number): void {
  const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  if (current !== null && current.jobId === jobId && current.progress === clamped) return
  current = { jobId, progress: clamped }
  emit()
}

/** 清掉进度；传 `jobId` 时只清那一单（避免 A 单收工把 B 单的进度抹掉）。 */
export function clearRenderProgress(jobId?: string): void {
  if (current === null) return
  if (jobId !== undefined && current.jobId !== jobId) return
  current = null
  emit()
}
