/**
 * 首屏「开拍前条」（DD-10）—— **纯展示组件**，渲染在中栏第一行。
 *
 * ## 它回答什么
 *
 * lobby-pending（项目已选定、还没有第一轮对话）时中栏第一行本来什么都不渲染，
 * 整屏只剩中间那张对话卡：看不到这个项目锁了什么规格、走到六段的哪一段。而 work
 * 态的中栏顶部是有东西的（工具栏 + P7 工作流条），位置相同、语义也接得上
 * （「这台制作台现在什么状态」）。这条带子补上同一位置的那一格，让中栏顶部在
 * 两态之间连续。
 *
 * ## 为什么是它的替身
 *
 * work 态的规格读数住在宿主槽 `conversation.composer.dock`（输入卡下方的读数带
 * 右端，见 ProjectContextBar）。而宿主对该槽的渲染条件是 `!hero` —— **hero 态
 * 不渲染**，所以首屏天生看不到那条带子。这条就是它在首屏的替身，两者数据同源
 * （同一个 `deriveProjectContextView`，同一份 `specPartsOf` 拼装），只是位置从
 * 「输入卡下方」挪到「中栏顶部」。
 *
 * ## 边界（为什么这里什么都不判）
 *
 * - 模型由 `deriveProjectContextView` 给（`src/project-context.ts`，单测直连）；
 * - 规格段的拼装由 `specPartsOf` 给 —— 不在这里重写一遍「为空即不渲染」；
 * - 阶段由 `view.stage` 给（内部走 `deriveStageChipView`），本文件不读
 *   `workflow.state`，也不碰画布节点；
 * - 「显不显示」由父组件按 `view === null` 决定，这里拿到的 `view` 一定有效
 *   （所以本组件没有 null 分支，也不需要）。
 *
 * 换句话说：本文件只有「把模型渲染成 DOM」一件事。判定留在 `.tsx` 里就只能靠
 * 渲染台测，而渲染台的绿**不覆盖接线**（R8 事故），所以判定一律不在这里。
 */

import { Fragment, type ReactElement } from 'react'
import { SLATE_COPY } from '../brand-copy.js'
import { type ProjectContextView, contextTitleOf, specPartsOf } from '../project-context.js'
import { StageChip } from './StageChip.js'

/** props：只有模型，没有 hooks —— 展示组件不从 store 取数。 */
export interface SlateBarProps {
  /** 由 `deriveProjectContextView` 产出的显示模型。 */
  readonly view: ProjectContextView
}

export function SlateBar({ view }: SlateBarProps): ReactElement {
  const specParts = specPartsOf(view)
  return (
    <section className="csSlateBar" title={contextTitleOf(view, '待开拍项目')}>
      <span className="csSlateTag">{SLATE_COPY.tag}</span>
      <span className="csSlateName">{view.name}</span>
      {/* 规格整段为空时给替身文案，而不是留白：空着会读成「这里坏了」或
          「已经锁了但没显示」，明确说「待定」才是真信息。 */}
      {specParts.length === 0
        ? (
            <Fragment>
              <span className="csSlateSep" aria-hidden>·</span>
              <span className="csSlateSpec">{SLATE_COPY.planUnset}</span>
            </Fragment>
          )
        : specParts.map(part => (
            <Fragment key={part}>
              <span className="csSlateSep" aria-hidden>·</span>
              <span className="csSlateSpec">{part}</span>
            </Fragment>
          ))}
      <span className="csSlateSpacer" />
      {view.stage === null ? null : <StageChip view={view.stage} />}
    </section>
  )
}
