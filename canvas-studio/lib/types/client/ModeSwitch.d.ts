/**
 * 执行模式开关（CV-196）—— 「逐步确认 / 放手跑」的**唯一实现**，两处外观共用一套语义。
 *
 * ## 为什么抽组件而不是复制一段 JSX
 *
 * 需求是「新建项目弹窗上也要有这两个按钮，功能一致」。复制一份的话，两处各有
 * 一份 `disabled` 判据、一份文案、一份点击处理 —— 迟早分叉成「画布顶部的放手跑
 * 会二次确认、弹窗里的不会」这类只有真机跑才发现的差异。判定与文案收在这里，
 * 两处只差**外观**（`variant`）。
 *
 * ## 两套外观的差别只在外壳，不在行为
 *
 * - `bar`：画布顶部的紧凑分段（`.csWorkflowMode` + `.csActive`），贴着六段轨道，
 *   空间只有 20 多像素高，塞不下两行字。
 * - `choice`：新建弹窗里的 chip（`.csChoiceRow` + `.csChoice`），与同排的「画幅」
 *   「目标时长」齐平 —— 那里是一张表单，孤立地摆一枚 23px 的小分段会显得突兀。
 *
 * 两者都：当前项禁用（点它没有意义）、`aria-pressed` / `disabled` 照进 DOM、
 * 有 hover 说明。**差别只有 class 与文字排布**。
 *
 * 组件本身**不做任何确认弹窗**：切到放手跑要不要二次确认由调用方决定（画布顶部
 * 要、创建弹窗不要 —— 那里用户正在显式选择一切，且项目还没有任何产物可烧）。
 */
import type { ReactElement } from 'react';
import type { StudioWorkflowMode } from '../contracts/project.js';
/** 两种模式的展示文案（两处外观共读，改文案只改这里）。 */
export declare const MODE_COPY: Readonly<Record<StudioWorkflowMode, {
    /** 主词（chip 主行 / 分段按钮文字）。 */
    readonly main: string;
    /** 副词（仅 chip 用；分段没有第二行的空间）。 */
    readonly sub: string;
    /** 当前已是该模式时的提示（禁用按钮的 title）。 */
    readonly current: string;
    /** 切过去的后果（非当前态按钮的 title）—— 两种模式各说清自己会带来什么。 */
    readonly switchTo: string;
}>>;
export interface ModeSwitchProps {
    /** 当前生效的模式（项目 workflow.mode）。 */
    readonly mode: StudioWorkflowMode;
    /** 用户点了另一枚按钮。组件自己不做确认，由调用方决定是否先弹窗。 */
    onChange(mode: StudioWorkflowMode): void;
    /** 'bar' = 画布顶部紧凑分段；'choice' = 弹窗 chip 组。 */
    readonly variant: 'bar' | 'choice';
    /** 忙碌中（创建中 / 切换中）禁用两枚按钮。 */
    readonly disabled?: boolean;
    /** 无障碍分组名（两处场景措辞不同）。 */
    readonly ariaLabel?: string;
    /** chip 版的分组标题 id（`aria-labelledby`，与同排的画幅 / 时长一致）。 */
    readonly labelledBy?: string;
}
export declare function ModeSwitch(props: ModeSwitchProps): ReactElement;
