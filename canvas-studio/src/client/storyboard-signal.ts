/**
 * REQ-022：拍摄定稿的**刷新信号**（模块级事件总线）。
 *
 * ## 为什么需要它
 *
 * 「一步一步填满」要求：agent 每次写完故事板，正开着的覆盖层要**立刻**重渲染。
 * 覆盖层是个 iframe（`/canvas-studio/storyboard/<id>.html`），iframe 不会自己重载
 * —— 必须由外层 React 换 `src`（带版本号破缓存）。
 *
 * 而「故事板被写了」这件事发生在 `client/index.ts` 的工具结果管线里，`StudioFrame`
 * 拿不到 —— 两者之间没有现成的响应式通道（注入给 frame 的 actions 是注册期捕获的
 * 快照，不会随事件重渲染）。把 rev 塞进 project store 是另一条路，但那要给事件总线
 * 引入与画布无关的状态。
 *
 * 所以用最小的一条显式通道：谁写完谁 `bump`，谁在看谁 `subscribe`。
 *
 * ## 边界
 *
 * - **只增不减**：rev 是单调计数器（不是布尔开关），`?v=N` 每次都是新 URL
 *   ⇒ 不会命中 iframe 的缓存。
 * - **不跨会话**：模块级 Map，刷新页面即清空 —— 覆盖层本来就是读盘渲染，不需要持久化。
 * - 只服务覆盖层刷新；画布/工作流的刷新走既有 `reloadCanvasQueued` / `refreshWorkflow`，
 *   不要在别处复用本模块（一个通道一件事）。
 */

/** projectId → 已 bump 次数。 */
const revs = new Map<string, number>()

const listeners = new Set<(projectId: string) => void>()

/** 故事板被写入后调用。两个源头：`write_storyboard` 结算点（按工具名），
 *  以及生成工具回写（显式 `storyboardRef` 或 CV-306 自动兜底）—— 后者由 Host 附注里的
 *  `STORYBOARD_TOUCH_MARKER` 判定（CV-308），不依赖入参。 */
export function bumpStoryboardRev(projectId: string): void {
  revs.set(projectId, (revs.get(projectId) ?? 0) + 1)
  for (const listener of listeners) listener(projectId)
}

/** 当前 rev（未 bump 过即 0）。 */
export function storyboardRevOf(projectId: string): number {
  return revs.get(projectId) ?? 0
}

/** 订阅 bump 事件；返回退订函数。 */
export function subscribeStoryboardRev(listener: (projectId: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
