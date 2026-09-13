/**
 * 制作六阶段（C1 / DD-05）——「现在拍到哪里」的**唯一派生实现**。
 *
 * ## 为什么是派生，而不是扩契约
 *
 * `StudioWorkflowState` 只有 5 个值（`drafting` / `script_review` /
 * `awaiting_approval` / `keyframe_review` / `executing`），**推不出**设计稿的
 * 六段「剧本 → 分镜 → 定妆 → 关键帧 → 镜头 → 成片」—— 定妆、镜头、成片这
 * 三段在 state 里没有独立取值（见 visual-direction-ui-closeout.md §5 Q1）。
 *
 * 两条路：
 * - 路线 ii：扩 `workflow.state` 契约。Host 路由 + 状态机 + 唤醒逻辑全动，并把
 *   「画布上已经有成片、state 还停在 executing」这类不一致变成必须由状态机保证的
 *   强约束。
 * - **路线 i（本实现，已拍板）**：state 给**地板**，画布产物给**证据**，取较大值。
 *   纯函数、零契约风险、`node --test` 可直连。
 *
 * 选路线 i 的核心理由不是省事，而是**证据比状态更可信**：state 是 agent 流程的
 * 副产物，会因重放 / 中断 / 多轮对话停在半路；而「画布上有没有成片节点」是事实。
 * 只看 state 的轨道会在「已经出片了但 state 没跟上」时说谎。
 *
 * ## 单调性（阶段只前进不后退）
 *
 * 结果 = `max(state 地板, 最强产物证据)`。中途删掉几张关键帧不会让轨道倒回
 * 「分镜」，因为后段证据（镜头 / 成片）还在。这正是「进度」的语义：进度不会
 * 因为删了一份草稿就回退。
 *
 * ## 铁律
 *
 * - 本模块是六阶段判定的**唯一实现**。`StudioFrame` 只允许 import，不得自己
 *   遍历 `nodes` 推阶段（同一规则两份实现是 CV-160 的教训）。
 * - 成片 / 逐镜片段判定复用 `shot-versions.ts` 的权威口径，不在这里重写
 *   `toolName === 'compose'` 或 `kind === 'video'`。
 * - 纯函数、无 DOM、无 React。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
import type { StudioWorkflowState } from './contracts/project.js';
/** 六段展示名（顺序即阶段序）。 */
export declare const WORKFLOW_STAGE_LABELS: readonly ["剧本", "分镜", "定妆", "关键帧", "镜头", "成片"];
export type WorkflowStageLabel = (typeof WORKFLOW_STAGE_LABELS)[number];
export declare const WORKFLOW_STAGE_COUNT: 6;
/** 阶段序号的具名常量（避免消费方各写一遍魔数）。 */
export declare const STAGE_SCRIPT = 0;
export declare const STAGE_STORYBOARD = 1;
export declare const STAGE_LOOK = 2;
export declare const STAGE_KEYFRAME = 3;
export declare const STAGE_SHOT = 4;
export declare const STAGE_FILM = 5;
/**
 * 单个节点归属哪个阶段。`null` = 不属于任何制作阶段（便签 / 文案 / 导入素材 /
 * 分组节点）。这类节点不参与进度判定，也不会被「点阶段 → 聚焦产物」选中。
 *
 * 判定优先级（从强到弱）：
 * 1. **成片** —— `isComposeProduct`（全仓唯一口径）。成片是终点产物，压过一切。
 * 2. **剧本卡** —— `toolName === BRIEF_NODE_TOOL`。必须排在 operationType 之前，
 *    因为剧本卡的 operationType 是 `import`（与手动导入同值）。
 * 3. **视频类** —— 非成片的 `kind === 'video'` 一律算镜头。不查 operationType：
 *    视频端点会随供应商增加（H3 就换过两轮），逐个列举迟早漏一个，而「画布上
 *    能播的片段 = 镜头段产物」这个语义不会漏。
 * 4. **图片类** —— 查 `OPERATION_STAGE`。
 */
export declare function stageOfNode(node: StudioCanvasNode): number | null;
/** 六阶段的派生结果。 */
export interface WorkflowStageView {
    /** 当前阶段 0..5（`max(地板, 证据)`）。 */
    readonly stage: number;
    /** 每阶段的产物节点 id，下标与 `WORKFLOW_STAGE_LABELS` 对齐。 */
    readonly idsByStage: readonly (readonly string[])[];
    /** 是否有待批准项（`script_review` / `awaiting_approval` / `keyframe_review`）。 */
    readonly approvalPending: boolean;
}
/**
 * C10：单个节点在卡片头部显示的产物名（简称「类型」）。
 *
 * 判定优先级（从强到弱）——**与 `stageOfNode` 逐条对齐**，两者若给出互相矛盾的
 * 答案（比如 `stageOfNode` 说这是剧本段、头部却写着「文本」），阶段轨道与卡片
 * 就会各说各话。所以这里复用同一个 `isComposeProduct` / `BRIEF_NODE_TOOL` 判据，
 * 而不是另写一遍。
 *
 * 1. 成片 —— `isComposeProduct`（全仓唯一口径），压过一切。
 * 2. 剧本卡 —— `toolName === BRIEF_NODE_TOOL`。必须排在 operationType 之前：
 *    剧本卡的 operationType 是 `import`，与手动导入素材同值。
 * 3. `OPERATION_PRODUCT` —— 与阶段名不同字的产物（角色 / 场景 / 片段 / BGM）。
 * 4. 音频 —— 没有 operationType 的音频节点仍是 BGM（工具生成路径都会写，但
 *    历史节点与手动落卡不保证）。
 * 5. 视频 —— 非成片的视频一律「片段」（与 `stageOfNode` 的「不查 operationType」
 *    同一理由：端点会随供应商换，逐个列举迟早漏一个）。
 * 6. 参考图 —— 标记为参考的素材。
 * 7. 导入 —— 手动素材（`import` 同时是剧本卡的值，故只能排在第 2 条之后）。
 * 8. 阶段名兜底 —— `WORKFLOW_STAGE_LABELS[stage]`。
 * 9. `KIND_PRODUCT` —— 便签 / 文本 / 提示 / 分组。
 *
 * 返回 `null` = 交调用方兜底（目前只有 `kind: 'image'` 且没有任何判据命中的
 * 裸图片节点，客户端用 `KIND_LABEL` 显示「图片」）。
 */
export declare function productLabelOf(node: StudioCanvasNode): string | null;
/**
 * 派生当前阶段 + 每阶段产物索引。
 *
 * **已作废 / 被取代的节点照常计入**（它们仍是那一步的产物，聚焦时看到灰显卡片
 * 是有信息量的）；**不可见节点也计入** —— 「看不见」是显隐开关，不是「没做过」。
 */
export declare function deriveWorkflowStage(state: StudioWorkflowState | undefined, nodes: readonly StudioCanvasNode[]): WorkflowStageView;
