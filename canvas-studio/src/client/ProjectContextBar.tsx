/**
 * 输入卡片下方的「项目上下文条」（DD-09 / d，CV-179 起同时承载阶段胶囊）。
 *
 * ## 挂在哪个槽：宿主把两个槽分了工，本批用读数那一个
 *
 * 宿主的槽目录对这两个位置有**明确分工**（`cordis-client-runner/src/client/slot-catalog.ts`）：
 * - `conversation.input.dock`：「a full-width row of its own, **stacked above**
 *   the composer card —— the seat for anything that needs a line to itself
 *   (queue rows, a todo strip, a goal bar)」，并提示「content **wraps or carries
 *   prose** 时选它」；
 * - `conversation.composer.dock`：「the band under the composer card, inside the
 *   bar's width column —— the seat for an **ambient readout**」，自带的 stats 行
 *   就住在这里。
 *
 * 我们要的正是后者：一行短读数，不换行、不带正文、不需要用户点。
 *
 * 代价（已知并接受）：宿主对 composer.dock 的渲染条件是 `!hero` —— **hero 态
 * （尚无会话内容、输入框居中）不渲染这一带**。此时中栏画布与左栏都已在表明
 * 「你在哪个项目上」，本行是补充读数而非唯一信号，故接受。
 *
 * ## 为什么阶段胶囊在这里（CV-179）
 *
 * 它原本挂在 `conversation.session.header.utilities`，把宿主的会话标题挤到只剩
 * 三字（根因与实测数据见 `src/project-context.ts` 文件头）。撤出会话头后落在
 * 这条带子的右端 —— 位置语义也顺：左边是「我是谁 / 锁了什么」（稳定），右边是
 * 「走到哪一步了」（动态）。
 *
 * ## 为什么不越界
 *
 * 我们只往这一格里加自己的元素，**不设**外层定位与 margin —— 宽度、对齐、与
 * 相邻条目的间距全部交给宿主容器与同族的 stats 行。未选项目时返回 `null`、
 * 一个 DOM 都不出（c 批在会话头踩过：塞空壳会让空态折叠失效，平白多出一道空白）。
 *
 * ## 数据来源
 *
 * 经注册时声明的 hooks 舱拿**同一个 store 实例**（`index.ts` 的 `storeInstance`），
 * 与 `StudioFrame` 的 `useStudio` 是同一份 —— 不存在第二份状态。判定全部在
 * `src/project-context.ts`（纯函数，单测直连），本文件只负责渲染。
 */

import { type ReactElement, Fragment } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectContextInjected } from './contracts.js'
import type { StudioCanvasNode } from '../contracts/canvas.js'
import { deriveProjectContextView } from '../project-context.js'
import { StageChip } from './StageChip.js'

/** props：注册时声明的 hooks 舱（owner 另外会给 InputZone，本批不用）。 */
export type ProjectContextBarProps = InjectFace<ProjectContextInjected>

/**
 * 未选项目时交给 selector 的稳定空数组。
 *
 * 必须是模块级常量：在 selector 里现写 `[]` 每次调用都是新引用，订阅层每轮通知都判
 * 不等，退化成常驻重渲染（React 的 `getSnapshot` 缓存警告同源）。
 */
const NO_NODES: readonly StudioCanvasNode[] = []

export function ProjectContextBar(props: ProjectContextBarProps): ReactElement | null {
  const { useStudio } = props
  // 三个 selector 都只取 store 里**已有的引用**（projects 数组命中项 / workflow 对象 /
  // nodes 数组本身），不在 selector 里现造对象 —— 现造对象等于常驻重渲染。
  const project = useStudio(store => (store.selectedProjectId === null
    ? undefined
    : store.projects.find(candidate => candidate.id === store.selectedProjectId)))
  const workflow = useStudio(store => (store.selectedProjectId === null
    ? undefined
    : store.workflows[store.selectedProjectId]))
  const nodes = useStudio(store => (store.selectedProjectId === null
    ? NO_NODES
    : store.nodes[store.selectedProjectId] ?? NO_NODES))
  const view = deriveProjectContextView(project, workflow, nodes)
  // 未选项目（lobby / 首屏）→ 不占位。判定在纯函数里，这里只认 null。
  if (view === null) return null
  // 段的拼装留在组件层（判定在纯函数里）：项目名 + 可缺的两段规格 + 可缺的阶段胶囊。
  const specParts: string[] = []
  if (view.plan !== null) specParts.push(view.plan)
  if (view.shots !== null) specParts.push(`≈${view.shots} 镜`)
  const title = `当前项目：${view.name}`
    + (view.plan === null ? ' · 未锁定画幅与目标时长' : ` · ${view.plan}`)
    + (view.shots === null ? '' : ` · 建议 ${view.shots} 镜`)
  return (
    <div className="csContextBar" title={title}>
      <span className="csContextBarName">{view.name}</span>
      {specParts.map(part => (
        <Fragment key={part}>
          <span className="csContextBarSep" aria-hidden>·</span>
          <span className="csContextBarSpec">{part}</span>
        </Fragment>
      ))}
      {view.stage === null ? null : <StageChip view={view.stage} />}
    </div>
  )
}
