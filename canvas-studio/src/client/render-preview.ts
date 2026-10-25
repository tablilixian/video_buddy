/**
 * CV-334 · B3.3：**渲染前只读预览**的闸门（模块级状态机，零 React 依赖）。
 *
 * 为什么需要它：`render_composition` 是一条 **10 分钟量级**的重工单
 * （`RENDER_JOB_TIMEOUT_MS`）。在此之前用户只能"盲等" —— 渲完才知道排版、节奏、
 * 文字换行对不对，错了就再来十分钟。加这道闸门后，客户端取到工单**先弹只读预览**
 * （`@remotion/player` 就地播放同一份 `StudioComposition` + 同一份 manifest），
 * 用户点「开始渲染」才真渲染、点「取消」直接撤单 —— 一次点击换掉一次白等。
 *
 * 三条设计纪律：
 * 1. **只读**：预览面板不提供任何编辑能力（可视化编辑与"agent 写 JSON"的产品主线
 *    冲突），manifest 也**不落库**（它仍是一次性入参，渲完即弃）。
 * 2. **没人订阅就放行**：预览界面未挂载时（客户端未初始化 / 非画布上下文）
 *    `requestRenderPreview` 立刻返回 `true`。绝不能因为"没人看得到浮层"把渲染卡死。
 * 3. **同一时刻只挂一单**：新单到来时把上一单直接放行（宿主侧本就按项目串行）。
 */
import type { CompositionManifest } from '../remotion/manifest.js'

export interface RenderPreviewRequest {
  jobId: string
  manifest: CompositionManifest
}

type Listener = (request: RenderPreviewRequest | null) => void

let current: RenderPreviewRequest | null = null
let resolver: ((approved: boolean) => void) | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(current)
}

/** 订阅预览请求（React 侧经 `useSyncExternalStore` 消费）。 */
export function subscribeRenderPreview(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前待预览的工单（`null` = 没有）。 */
export function getRenderPreviewSnapshot(): RenderPreviewRequest | null {
  return current
}

/** 是否有界面在监听（`false` ⇒ 闸门放行，见文件头纪律 2）。 */
export function hasRenderPreviewListener(): boolean {
  return listeners.size > 0
}

/**
 * 请求一次预览；`resolve(true)` = 用户确认渲染，`resolve(false)` = 用户取消。
 *
 * 调用方拿到 `false` 时应把工单**主动撤单**（`cancelStudioRenderJob`），
 * 而不是让它挂到超时 —— 撤单能让 agent 立刻收到"用户取消了"，不必干等 10 分钟。
 */
export function requestRenderPreview(jobId: string, manifest: CompositionManifest): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(true)
  if (resolver !== null) {
    // 上一单还挂着（异常路径：同项目并发建单）：放它走，避免它永久挂起。
    const previous = resolver
    resolver = null
    current = null
    previous(true)
  }
  current = { jobId, manifest }
  emit()
  return new Promise<boolean>((resolve) => { resolver = resolve })
}

/** 用户在预览面板上做出决定；`jobId` 不匹配（旧面板 / 已撤单）返回 `false`。 */
export function resolveRenderPreview(jobId: string, approved: boolean): boolean {
  if (current === null || current.jobId !== jobId) return false
  const done = resolver
  current = null
  resolver = null
  emit()
  if (done !== null) done(approved)
  return true
}

/**
 * CV-373：外部解除当前挂起的预览 —— 工单已在别处结算（看门狗/超时/撤单），弹窗
 * 成了僵尸（agent 已继续干活，面板点了也没用）。`resolve(false)` 让挂起的渲染调用
 * 走「用户取消」收尾（对已结算单的撤单是 no-op）。没有挂起的预览时返回 `false`。
 */
export function abortRenderPreview(): boolean {
  if (current === null || resolver === null) return false
  return resolveRenderPreview(current.jobId, false)
}
