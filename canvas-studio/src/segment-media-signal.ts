/**
 * REQ-041 L2：**渲染完成 → 段清单刷新**的轻量信号（零 React 依赖）。
 *
 * 为什么不放项目 store：段清单是渲染态产物，不是用户文档（更不能写回 canvas.json）。
 * 为什么不用轮询：渲染结算点已经唯一（`client/index.ts` 的 `onRenderToolSettled`），
 * 在那里发一次信号即可；画布就绪由 hook 的 projectId effect 覆盖。
 *
 * 监听器抛错不能影响渲染结算 —— 吞掉，最坏结果只是这一屏暂时还是旧画面。
 */
type Listener = (projectId: string) => void

const listeners = new Set<Listener>()

export function subscribeSegmentMediaRefresh(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 渲染结算后由 client/index.ts 调用；只通知同一项目的订阅者。 */
export function notifySegmentMediaRefresh(projectId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(projectId)
    } catch {
      // 刷新是尽力而为，失败由 Hook 自己的静默回退兜底。
    }
  }
}

/** 仅测试用：清空订阅（模块级单例）。 */
export function disposeSegmentMediaSignal(): void {
  listeners.clear()
}
