/**
 * 输入区「项目上下文条」的判定（DD-09 / d）—— 纯函数，无 React、无 DOM。
 *
 * ## 它回答什么
 *
 * 挂在宿主公开槽 `conversation.input.dock` 的那条环境读数带要回答：**这条会话
 * 现在挂在哪个项目上、这个项目锁了什么产出规格**。宿主的槽文档把它定义为
 * 「the seat for an ambient readout about the conversation」，与「用户要点的
 * 东西」分属 `input.left` / `input.right` —— 所以本批只做读数，不做按钮。
 *
 * ## 与头部 chip 的分工（刻意不重叠）
 *
 * - 会话头 chip（c 批）：**进度与状态** —— 第几段 / 待批准 / 执行模式；
 * - 本条：**身份与规格** —— 项目名 / 画幅 / 目标时长 / 建议镜头数。
 *
 * 两处都显示阶段或都显示模式就是同一句话在一屏里说两遍，一改必漏一处。
 *
 * ## 为什么收口成纯函数
 *
 * 判定留在 `.tsx` 里就只能靠渲染台测，而渲染台的绿**不覆盖接线**（R8 事故：
 * 32 条 computed-style 断言全绿，`data-rail` 根本没挂上 DOM）。搬到这里由
 * `node --test` 直连，组件只剩「把模型渲染成 DOM」。
 *
 * ## 不新造的东西
 *
 * - 规格摘要复用 `project-row.ts` 的 `planSummaryOf` —— 左栏项目卡副行与这条
 *   带子必须同一句实现（同一规则只准一份）。
 * - 建议镜头数复用 `contracts/project.ts` 的 `suggestShotCount` —— CV-099 起就
 *   存在并有单测的纯函数，不在这里重算。
 */

import type { StudioProject } from './contracts/project.js'
import { suggestShotCount } from './contracts/project.js'
import { planSummaryOf } from './project-row.js'

/** 项目名为空时的兜底（与素材 / 片段同一套措辞）。 */
const UNNAMED = '未命名项目'

/** 上下文条的显示模型（组件拿它渲染，组件内不再做任何判断）。 */
export interface ProjectContextView {
  /** 项目名；记录里为空时给 `未命名项目`。 */
  readonly name: string
  /** 规格摘要（`16:9 · 30s`）；两项都未锁定时为 null —— 不渲染该段。 */
  readonly plan: string | null
  /** 建议镜头数（目标时长 ÷ 单镜建议时长）；未锁定/非法时长时为 null。 */
  readonly shots: number | null
}

/**
 * 由当前项目记录派生上下文条模型。
 *
 * @param project - 当前选中项目的记录；**未选项目时为 `undefined`**，此时返回
 *   `null`（组件据此不渲染任何 DOM）。宿主那排 dock 条目靠 `:empty` 折叠，
 *   塞一个没有内容的空壳会让折叠失效、平白多出一条空白带。
 * @returns 显示模型，或 `null` 表示「这条带子不该出现」。
 */
export function deriveProjectContextView(
  project: StudioProject | undefined,
): ProjectContextView | null {
  if (project === undefined) return null
  const name = project.name.trim()
  return {
    name: name === '' ? UNNAMED : name,
    plan: planSummaryOf(project.plan),
    shots: suggestShotCount(project.plan?.targetDuration) ?? null,
  }
}
