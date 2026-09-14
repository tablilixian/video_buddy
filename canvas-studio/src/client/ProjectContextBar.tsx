/**
 * 输入卡片下方的「项目上下文条」（DD-09 / d）。
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
 * 我们要的正是后者：一行短读数（项目名 · 画幅 · 时长 · 建议镜头数），不换行、
 * 不带正文、不需要用户点。立项文档里那句「d 批进 `input.dock`」在本批实施时
 * 按宿主语义纠正为 `composer.dock`（两槽都是 `list` + `scope: session` + 必填
 * `id`，改回只是一个字符串的事）。
 *
 * 代价（已知并接受）：宿主对 composer.dock 的渲染条件是 `!hero` —— **hero 态
 * （尚无会话内容、输入框居中）不渲染这一带**。此时中栏画布与左栏都已在表明
 * 「你在哪个项目上」，本行是补充读数而非唯一信号，故接受；换回 `input.dock`
 * 可让它 hero 态也可见。
 *
 * ## 为什么不越界
 *
 * 我们只往这一格里加自己的元素，**不设**外层定位与 margin —— 宽度、对齐、与
 * 相邻条目的间距全部交给宿主容器与同族的 stats 行。未选项目时返回 `null`、
 * 一个 DOM 都不出（c 批在会话头踩过：塞空壳会让 `:empty` 折叠失效，平白多出
 * 一道空白）。
 *
 * ## 数据来源
 *
 * 经注册时声明的 hooks 舱拿**同一个 store 实例**（`index.ts` 的 `storeInstance`），
 * 与 `StudioFrame` 的 `useStudio` 是同一份 —— 不存在第二份状态。判定全部在
 * `src/project-context.ts`（纯函数，单测直连），本文件只负责渲染。
 *
 * ## 与头部 chip 的分工（刻意不重叠）
 *
 * 头部 chip 说**进度与状态**（第几段 / 待批准 / 执行模式），这条说**身份与规格**
 * （项目名 / 画幅 / 目标时长 / 建议镜头数）。同一句话在一屏里说两遍，改的时候
 * 必漏一处。
 */

import { Fragment, type ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectContextInjected } from './contracts.js'
import { deriveProjectContextView } from '../project-context.js'

/** props：注册时声明的 hooks 舱（owner 另外会给 InputZone，本批不用）。 */
export type ProjectContextBarProps = InjectFace<ProjectContextInjected>

export function ProjectContextBar(props: ProjectContextBarProps): ReactElement | null {
  const { useStudio } = props
  // selector 只取 store 里**已有的引用**（projects 数组本身 + 命中的元素），
  // 不在 selector 里现造对象 —— 现造对象每轮通知都判不等，退化成常驻重渲染。
  // 未选项目时返回 `undefined`（原始值，引用稳定，无需模块级常量）。
  const project = useStudio(store => (store.selectedProjectId === null
    ? undefined
    : store.projects.find(candidate => candidate.id === store.selectedProjectId)))
  const view = deriveProjectContextView(project)
  // 未选项目（lobby / 首屏）→ 不占位。判定在纯函数里，这里只认 null。
  if (view === null) return null
  // 段的拼装留在组件层（判定在纯函数里）：标题段 + 可缺的两段读数。
  const parts: string[] = [view.name]
  if (view.plan !== null) parts.push(view.plan)
  if (view.shots !== null) parts.push(`≈${view.shots} 镜`)
  const title = `当前项目：${view.name}`
    + (view.plan === null ? ' · 未锁定画幅与目标时长' : ` · ${view.plan}`)
    + (view.shots === null ? '' : ` · 建议 ${view.shots} 镜`)
  return (
    <div className="csContextBar" title={title}>
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 && <span className="csContextBarSep" aria-hidden>·</span>}
          <span className={index === 0 ? 'csContextBarName' : 'csContextBarSpec'}>{part}</span>
        </Fragment>
      ))}
    </div>
  )
}
