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

/**
 * CV-020：该节点是否有可下载的资产。
 *
 * 只有 image / video 且带 `url` 的节点才有实体产物；sticky / text / prompt /
 * group 是画布上的标注，没有可另存的文件。
 */
export function canDownloadNode(node: StudioCanvasNode): boolean {
  if (node.kind !== 'image' && node.kind !== 'video') return false
  return typeof node.url === 'string' && node.url.length > 0
}

/** 各节点类型的产物扩展名（`assetDownloadName` 兜底补后缀用）。 */
const ASSET_EXTENSION: Readonly<Record<string, string>> = {
  image: '.png',
  video: '.mp4',
}

/** 文件名不安全字符（路径分隔符与控制字符）替换为 `-`。 */
function sanitizeFileName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
}

/**
 * CV-020：资产的下载文件名。
 *
 * 优先用 Drama 落盘的 `filename`（与存储里的名字一致，方便和 agent 的
 * `@ref` 句柄对上）；没有则退回「标题」，再退回节点 id 前 8 位。缺扩展名时
 * 按节点类型补 `.png` / `.mp4`，避免存下一个无后缀的文件。
 */
export function assetDownloadName(node: StudioCanvasNode): string {
  const preferred = node.filename !== undefined && node.filename.trim().length > 0
    ? node.filename
    : node.title !== undefined && node.title.trim().length > 0
      ? node.title
      : `canvas-${node.id.slice(0, 8)}`
  const base = sanitizeFileName(preferred)
  if (base.length === 0) return `canvas-${node.id.slice(0, 8)}${ASSET_EXTENSION[node.kind] ?? ''}`
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}${ASSET_EXTENSION[node.kind] ?? ''}`
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

/**
 * CV-017：计算一次方向键微调后各选中节点的新位置。
 *
 * 锁定节点跳过（与拖拽行为一致）；返回按 id 逐个移动的指令列表，调用方
 * 对每项执行 `onMoveNode`。`dx`/`dy` 已含步长（1px，Shift 时 10px）。
 */
export function computeNudge(
  nodes: readonly StudioCanvasNode[],
  selectedIds: readonly string[],
  dx: number,
  dy: number,
): Array<{ id: string; x: number; y: number }> {
  const moves: Array<{ id: string; x: number; y: number }> = []
  for (const id of selectedIds) {
    const node = nodes.find(candidate => candidate.id === id)
    if (node === undefined || node.locked === true) continue
    moves.push({ id, x: node.x + dx, y: node.y + dy })
  }
  return moves
}
