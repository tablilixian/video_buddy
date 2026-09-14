/**
 * 会话头右侧的「制作阶段」chip（DD-09 / c）。
 *
 * ## 它挂在哪儿、为什么不越界
 *
 * 挂载到宿主的**公开槽** `conversation.session.header.utilities`
 * （`{ kind: 'list'; scope: 'session' }`，由 ui-conversation 在
 * `apply.ts` 的 header 注册里声明、在 `ConversationSession.tsx` 渲染）。我们只往这一格
 * 里加一个自己的元素 —— **不去改宿主头部本身**：宿主头部是 CSS Modules（hash 类名），
 * 插件选不中也改不了，硬改就是动 dsh 本体，随时会丢升级能力。
 *
 * 宿主容器是 `display:flex; align-items:center; gap:8px; margin-left:20px` +
 * `:empty { display: none }`。所以：
 * - 我们**不设**自己的 margin / 外层定位，间距交给宿主那 8px gap（与相邻的宿主
 *   utilities 自然对齐）；
 * - 未选项目时返回 `null`、一个 DOM 都不出 → 容器仍是 `:empty`、整排折叠，
 *   不会在会话头右侧留一道空白。
 *
 * ## 数据来源
 *
 * 经注册时声明的 hooks 舱拿**同一个 store 实例**（`index.ts` 里 `storeInstance`），
 * 与 `StudioFrame` 的 `useStudio` 是同一份 —— 不存在第二份状态。
 * 判定全部在 `src/stage-chip.ts`（纯函数，单测直连），本文件只负责渲染。
 *
 * 本批**不做交互**：它是一个状态读数（`title` 里有完整信息），不是按钮。
 * 点击要做的事（跳到某段产物 / 打开审批）属于 e / f 批，且需要新的动作面。
 */

import type { ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { StageChipInjected } from './contracts.js'
import type { StudioCanvasNode } from '../contracts/canvas.js'
import { deriveStageChipView, modeShortLabel } from '../stage-chip.js'

/** chip props：注册时声明的 hooks 舱（owner 不给任何东西，自足）。 */
export type StageChipProps = InjectFace<StageChipInjected>

/**
 * 未选项目时交给 selector 的稳定空数组。
 *
 * 必须是模块级常量：在 selector 里现写 `[]` 每次调用都是新引用，订阅层每轮通知都判
 * 不等，退化成常驻重渲染（React 的 `getSnapshot` 缓存警告同源）。
 */
const NO_NODES: readonly StudioCanvasNode[] = []

export function StageChip(props: StageChipProps): ReactElement | null {
  const { useStudio } = props
  // 两个 selector 都只取 store 里**已有的引用**（workflow 对象 / nodes 数组本身），
  // 不在 selector 里现造对象 —— 同上，现造对象等于常驻重渲染。
  const workflow = useStudio(store => (store.selectedProjectId === null
    ? undefined
    : store.workflows[store.selectedProjectId]))
  const nodes = useStudio(store => (store.selectedProjectId === null
    ? NO_NODES
    : store.nodes[store.selectedProjectId] ?? NO_NODES))
  const view = deriveStageChipView(workflow, nodes)
  // 未选项目（lobby / 首屏）→ 不占位。判定在纯函数里，这里只认 null。
  if (view === null) return null
  const mode = modeShortLabel(view.mode)
  return (
    <span
      className={'csStageChip' + (view.pending ? ' csStageChipPending' : '')}
      title={`制作阶段：${view.label}（${view.index}/${view.total}）· ${mode}`
        + ` · 已产出 ${view.produced} 个节点${view.pending ? ' · 正在等你拍板' : ''}`}
    >
      <span className="csStageChipDot" aria-hidden="true" />
      <span className="csStageChipLabel">{view.label}</span>
      <span className="csStageChipProgress">{view.index}/{view.total}</span>
      <span className="csStageChipMode">{mode}</span>
    </span>
  )
}
