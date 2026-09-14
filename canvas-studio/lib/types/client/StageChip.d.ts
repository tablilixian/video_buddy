/**
 * 制作阶段胶囊（DD-09 / c）—— **纯展示组件**，CV-179 起并入输入区读数带。
 *
 * ## 它为什么搬家
 *
 * 原本单独挂在宿主公开槽 `conversation.session.header.utilities`。2026-09-14 用户
 * 报「会话头上面那串字永远显示不全」——根因不在标题本身（那是宿主给这条会话自动
 * 生成的 14 字标题），而在**头部右排抢宽度**：宿主 `.headerUtilities` 是
 * `flex: none`、标题簇是 `flex: 1; min-width: 0`，标题只能被压；`.crumb` 的硬上限
 * 是 220px。本胶囊占 133px，把标题挤到只剩约 93px —— 实测只显示出三个字。
 * 压窄救不回来（压到最简也只剩 ~93px 可用），**唯一解是撤出会话头**；实测撤走后
 * 标题可用宽度回到 ~234px ≥ 其所需的 ~202px，完整可读。
 *
 * 撤出后它渲染在 `ProjectContextBar` 里（同一条读数带的右端），本文件因此退化成
 * 纯展示：**不做订阅、不做判定**。
 *
 * ## 边界（为什么这里什么都不判）
 *
 * - 模型由 `deriveProjectContextView` 给（`src/project-context.ts`，单测直连）；
 * - 阶段序号 / 阶段名 / 待批准全部来自 `stage-chip.ts` 的 `deriveStageChipView`，
 *   本文件不读 `workflow.state`、不碰 `approvalPending` —— 那是第二份阶段判定；
 * - 「显不显示」由父组件按 `view.stage === null` 决定，这里拿到的 `view` 一定有效
 *   （所以本组件没有 `null` 分支，也不需要）。
 */
import type { ReactElement } from 'react';
import { type StageChipView } from '../stage-chip.js';
/** props：只有模型，没有 hooks —— 展示组件不从 store 取数。 */
export interface StageChipProps {
    /** 由 `deriveProjectContextView` 产出的胶囊模型。 */
    readonly view: StageChipView;
}
export declare function StageChip({ view }: StageChipProps): ReactElement;
