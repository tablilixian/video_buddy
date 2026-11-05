/**
 * 破坏性操作的统一确认闸门（UI-01）。
 *
 * 与 `render-preview.ts` 同构：模块级状态机 + Promise resolver + 顶层订阅，
 * 让任意深度的子组件都能「一行 await 出确认」，不必各自维护 pending state。
 *
 * ## 为什么不再用 `window.confirm`
 *
 * Electron 渲染进程里 `window.confirm` 会**阻塞渲染进程**（拖拽、轮询、心跳全停），
 * 弹窗由系统绘制、不吃插件的任何设计令牌，多行 `\n` 文案排版也不可控。仓内早有
 * `ConfirmDialog`（CV-196，取消键自动聚焦 + Esc + 遮罩拖选安全），但此前只在
 * StudioFrame 的两处切换确认里用，删除类操作仍走原生 ⇒ 双轨并存。
 *
 * ## 三条纪律
 *
 * 1. **没人订阅就拒绝**：与预览闸门不同，确认闸门在 UI 未挂载时**不能静默放行**
 *    （放行 = 在没人看见确认框的情况下删掉东西）。此时返回 `false` 并留日志。
 * 2. **同一时刻只挂一问**：新问到来时把上一问按 `false` 结算，避免用户连点两次
 *    删除后两个确认框叠在一起、或旧 Promise 永久挂起。
 * 3. **取消是缺省**：`ConfirmDialog` 的取消键自动聚焦、Esc = 取消，安全侧不靠
 *    调用方自觉。
 */
import type { ReactNode } from 'react'

export interface ConfirmRequest {
  readonly id: number
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel: string
}

export interface ConfirmOptions {
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel?: string
}

type Listener = () => void

let current: ConfirmRequest | null = null
let resolver: ((approved: boolean) => void) | null = null
let nextId = 0
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 订阅当前确认请求（React 侧经 `useSyncExternalStore` 消费）。 */
export function subscribeConfirm(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前待确认的问题（`null` = 没有）。 */
export function getConfirmSnapshot(): ConfirmRequest | null {
  return current
}

/**
 * 弹一次确认；`resolve(true)` = 用户确认，`resolve(false)` = 取消。
 *
 * 调用方拿 `false` 时**必须什么都不做**（删除类操作尤其）。返回 Promise，
 * 可 `await` 也可 `.then()`，不要求把外层函数改成 async。
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  if (listeners.size === 0) {
    console.info('[canvas-studio] confirm: no ConfirmHost mounted; rejecting destructive action')
    return Promise.resolve(false)
  }
  if (resolver !== null) {
    const previous = resolver
    resolver = null
    current = null
    previous(false)
  }
  const request: ConfirmRequest = {
    id: ++nextId,
    title: options.title,
    body: options.body,
    confirmLabel: options.confirmLabel ?? '确定',
  }
  current = request
  emit()
  return new Promise<boolean>((resolve) => { resolver = resolve })
}

/** 用户在确认框上做出决定；`id` 不匹配（旧框 / 已结算）返回 `false`。 */
export function resolveConfirm(id: number, approved: boolean): boolean {
  if (current === null || current.id !== id) return false
  const done = resolver
  current = null
  resolver = null
  emit()
  if (done !== null) done(approved)
  return true
}
