/**
 * 血缘聚光（DD-03）：选中节点时，把它的**直接血缘**点亮、其余节点压暗。
 *
 * 边界（唯一实现，画布侧只允许调这里，见 visual-direction-plan.md 的
 * 「同一规则只准一份实现」铁律）：
 * - 血缘表**只有一份**：`StudioCanvasNode.sourceIds`（契约 §Bloodline，
 *   "There is no separate edge table — edges are derived from the node graph"）。
 *   本模块与 `CanvasEdges` 消费同一个字段，不引入第二张边表。
 * - 血缘 = **一跳**：上游（我引用的）+ 下游（引用我的）+ 我自己。
 *   多跳会让「点亮」慢慢扩散成全亮，失去聚光的意义。
 *
 * 纯函数、无 DOM、无 React：`node --test` 可直连 lib/canvas-lineage.js。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 聚光计算结果。 */
export interface CanvasSpotlight {
    /**
     * 是否启用景深压暗。**选中项没有任何血缘时为 false** —— 见下。
     */
    readonly active: boolean;
    /** 保持全亮的节点 id：选中项 + 其直接血缘（只含真实存在的节点）。 */
    readonly lit: ReadonlySet<string>;
}
/**
 * 计算选中集的血缘聚光。
 *
 * 为什么「没有血缘就不压暗」：压暗是一种**对比手段** —— 它的作用是把血缘
 * 从背景里显出来。选中一张孤立节点（既没引用谁、也没被谁引用）时，压暗只
 * 会把整屏压灰而**揭示不了任何关系**，用户看到的是"画面突然变暗"。故此处
 * 只在「确有血缘可看」时置 active。这条规则同时挡住了最刺眼的场景：刚导入
 * 素材、还没连线时随手点一下卡片，全屏变灰。
 *
 * @param nodes 画布上的全部节点（调用方传可见节点；隐藏节点不参与，否则
 *              会点亮画布上根本看不见的节点 id）。
 * @param selectedIds 当前选中集。
 */
export declare function canvasSpotlight(nodes: readonly StudioCanvasNode[], selectedIds: readonly string[]): CanvasSpotlight;
