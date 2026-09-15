/**
 * 输入区「项目上下文条」的判定（DD-09 / d）—— 纯函数，无 React、无 DOM。
 *
 * ## 它回答什么
 *
 * 挂在宿主公开槽 `conversation.composer.dock` 的那条环境读数带要回答三件事：
 * **这条会话挂在哪个项目上**（身份）、**这个项目锁了什么产出规格**（约束）、
 * **现在走到六段的第几段、是不是在等你拍板**（状态）。宿主的槽文档把它定义为
 * 「the seat for an ambient readout about the conversation」，与「用户要点的
 * 东西」分属 `input.left` / `input.right` —— 所以本批只做读数，不做按钮。
 *
 * ## 为什么阶段判定也在这里（CV-179）
 *
 * 阶段胶囊原本单独挂在宿主的 `conversation.session.header.utilities`（c 批）。
 * 2026-09-14 用户报「会话头上面那串字永远显示不全」——查下来根因是**头部右排
 * 抢宽度**：宿主 `.headerUtilities` 是 `flex: none`、标题簇是 `flex: 1; min-width: 0`，
 * 标题只能被压；而 `.crumb` 的硬上限是 220px。我们的胶囊占 133px，把标题挤到
 * 只剩约 93px（实测只显示三字「创作演…」，而真标题是 14 字的
 * 「创作演唱会MV及简单女声歌曲」）。胶囊**压窄也救不回来**（压到最简只剩 ~93px
 * 可用），唯一解是把它撤出会话头。撤走后标题可用宽度回到 ~234px ≥ 其所需的
 * ~202px —— 完整可读。
 *
 * 撤出后这两个读数就同住一条带子，于是**判定也收口到一处**：本条同时给出
 * 身份 / 规格 / 阶段，组件只负责渲染。两处各算一份必然漂移（本仓老账）。
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
 * - 阶段判定复用 `stage-chip.ts` 的 `deriveStageChipView` —— 六段轨道判定的唯一
 *   门面（本模块不碰 `workflow.state` 的语义）。
 */
import { suggestShotCount } from './contracts/project.js';
import { planSummaryOf } from './project-row.js';
import { deriveStageChipView } from './stage-chip.js';
/** 项目名为空时的兜底（与素材 / 片段同一套措辞）。 */
const UNNAMED = '未命名项目';
/**
 * 由当前项目记录 + 该项目的工作流与画布派生上下文条模型。
 *
 * @param project - 当前选中项目的记录；**未选项目时为 `undefined`**，此时返回
 *   `null`（组件据此不渲染任何 DOM）。宿主那条 dock 靠空态折叠，塞一个没有内容的
 *   空壳会让折叠失效、平白多出一条空白带。
 * @param workflow - 该项目的工作流记录；未载入时为 `undefined`（阶段胶囊不显示）。
 * @param nodes - 该项目的画布节点（阶段判定的产物证据）。
 * @returns 显示模型，或 `null` 表示「这条带子不该出现」。
 */
export function deriveProjectContextView(project, workflow, nodes) {
    if (project === undefined)
        return null;
    const name = project.name.trim();
    return {
        name: name === '' ? UNNAMED : name,
        plan: planSummaryOf(project.plan),
        shots: suggestShotCount(project.plan?.targetDuration) ?? null,
        stage: deriveStageChipView(workflow, nodes),
    };
}
/**
 * 规格段的拼装（项目名之后的那些段）—— **读数带与首屏开拍前条共用一份**。
 *
 * 规则只有一条：为空即不出段。之所以把它抽出来而不是两处各写一遍，是因为两处
 * 都要回答同一个问题（「这个项目锁了什么」），段数一旦不一致，同一条信息在首屏
 * 和 work 态就会写成两句不同的话 —— 本仓对「同一规则只准一份实现」的老账。
 *
 * DD-10 新增：首屏（lobby-pending）看不到输入区读数带（宿主在 hero 阶段不渲染
 * `conversation.composer.dock`），中栏「开拍前条」是它在首屏的替身，于是两条带子
 * 必须同源。
 *
 * @param view - {@link deriveProjectContextView} 的产物。
 * @returns 依次为规格摘要与建议镜头数；两者都可缺，全缺时返回空数组
 *   （调用方据此决定是留白还是给替身文案）。
 */
export function specPartsOf(view) {
    const parts = [];
    if (view.plan !== null)
        parts.push(view.plan);
    if (view.shots !== null)
        parts.push(`≈${view.shots} 镜`);
    return parts;
}
/**
 * 读数带的 `title`（悬浮全文）—— 与 {@link specPartsOf} 同源，只是把「缺项」
 * 也写成话：悬浮时正是用户问「为什么不锁定」的时刻，这里要答上来。
 *
 * @param view - {@link deriveProjectContextView} 的产物。
 * @param prefix - 前缀（读数带写「当前项目」，首屏开拍前条写「待开拍项目」）。
 * @returns 完整的一句悬浮文案。
 */
export function contextTitleOf(view, prefix) {
    return `${prefix}：${view.name}`
        + (view.plan === null ? ' · 未锁定画幅与目标时长' : ` · ${view.plan}`)
        + (view.shots === null ? '' : ` · 建议 ${view.shots} 镜`);
}
