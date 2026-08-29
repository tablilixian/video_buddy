/**
 * Pure canvas-interaction predicates shared by the browser UI and the node
 * smoke tests: which failed nodes expose an inline retry, and whether a
 * global pointer press should leave the context menu open. Kept free of
 * runtime imports so the Host tsc emit (`lib/canvas-actions.js`) is directly
 * testable under `node --test`.
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/**
 * CV-018：该节点是否支持「就地重试」。判定条件与 client 侧 `rerunNode`
 * 的重放前置检查保持一致（`toolName` + `generationPrompt` 齐备），因此徽章
 * 一旦可点，点击必然真的重放，不会出现「点了才提示没有可重放参数」。
 * 生成中的节点（`isLoading`）不显示重试。
 */
export function canRetryNode(node: StudioCanvasNode): boolean {
  if (node.isLoading === true) return false
  return node.toolName !== undefined && node.generationPrompt !== undefined
}

/** Minimal DOM container contract (tests pass a stub). */
export interface ContainerLike {
  contains(other: unknown): boolean
}

/**
 * CV-037：一次全局 `mousedown` 是否应保持右键菜单打开。
 *
 * 背景：菜单原先在任意 window mousedown 时无条件卸载，`mousedown` 先于
 * `click` 到达，菜单项在 mouseup 前就从 DOM 消失，`click` 永不触发 —— 全部
 * 菜单项失效。现在只有「按在菜单外」才关闭；按在菜单内部时事件照常冒泡
 * 给菜单项自身，`onClick` 内自行 onClose + 执行动作。
 *
 * @param target 事件目标（`event.target`）
 * @param menu 菜单根元素；`null`（尚未挂载/已关闭）时一律不拦截
 */
export function shouldKeepMenuOpen(target: unknown, menu: ContainerLike | null): boolean {
  if (menu === null) return false
  if (target === null || target === undefined) return false
  return menu.contains(target)
}
