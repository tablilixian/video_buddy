/**
 * 会话头「制作阶段」chip 的判定（DD-09 / c）—— 纯函数，无 React、无 DOM。
 *
 * ## 为什么收口成纯函数
 *
 * 这个 chip 要回答三个问题：**渲染不渲染**（未选项目 / lobby 态不占位 —— 宿主那排
 * utilities 是 `:empty { display: none }` 折叠的，但它前面还挂着 `margin-left: 20px`，
 * 塞个空壳会在会话头右侧留一道 20px 空白）、**显示第几段**、**是不是在等你拍板**。
 * 三件事都只有一份判定。判定留在 `.tsx` 里就只能靠渲染台测，而渲染台的绿
 * **不覆盖接线**（R8 事故：32 条断言全绿，`data-rail` 根本没挂上 DOM），
 * 所以判定搬到这里，由 `node --test` 直连，组件只剩「把模型渲染成 DOM」。
 *
 * ## 与既有实现的关系（都不新造）
 *
 * - 阶段序号**不重新推导**：复用 `workflow-stage.ts` 的 `deriveWorkflowStage`
 *   —— 六阶段判定的唯一实现（CV-160 的教训：同一规则两份实现必然漂移）。
 * - 阶段名复用 `WORKFLOW_STAGE_LABELS` —— 与审批条 / 收起态竖条同一份词表。
 * - 待批准复用 `deriveWorkflowStage(...).approvalPending` —— 不自己看 `workflow.state`
 *   是不是三个 review 值之一（那就是第二份门禁判定）。
 *
 * 本模块**不碰** `workflow.state` 的语义，只做「把它翻译成 chip 该显示什么」。
 */
import { deriveWorkflowStage, WORKFLOW_STAGE_COUNT, WORKFLOW_STAGE_LABELS } from './workflow-stage.js';
/**
 * 由「该项目的 workflow + 画布节点」派生 chip 模型。
 *
 * @param workflow - 该项目的工作流记录；**未选项目时为 `undefined`**，此时返回 `null`
 *   （组件据此不渲染任何 DOM，让宿主容器保持 `:empty` 折叠）。
 * @param nodes - 该项目的画布节点（判定产物证据用）。
 * @returns 显示模型，或 `null` 表示「这条会话头不该出现 chip」。
 */
export function deriveStageChipView(workflow, nodes) {
    if (workflow === undefined)
        return null;
    const derived = deriveWorkflowStage(workflow.state, nodes);
    return {
        stage: derived.stage,
        label: WORKFLOW_STAGE_LABELS[derived.stage] ?? '',
        index: derived.stage + 1,
        total: WORKFLOW_STAGE_COUNT,
        mode: workflow.mode,
        pending: derived.approvalPending,
        produced: derived.idsByStage.reduce((sum, ids) => sum + ids.length, 0),
    };
}
/**
 * 模式的短词。
 *
 * chip 里没有位置放「逐步确认 / 放手跑」整句，但它恰恰是**用户最该一眼看到的信息**
 * —— 放手跑意味着可以离开屏幕，逐步确认意味着每道门都要有人点。所以用两个动词短语
 * 而不是「自动 / 手动」：后者不说明「谁在等谁」。
 *
 * @param mode - 工作流执行模式。
 * @returns 短词。
 */
export function modeShortLabel(mode) {
    return mode === 'auto' ? '放手跑' : '逐步确认';
}
