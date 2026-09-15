/**
 * 血缘聚光（DD-03 立，CV-186 改语义）：**拖动**节点时，按血缘距离分三档压暗 ——
 * 直接血缘留在亮档，隔一层的降到中间档，更远与无关的压到压暗档。
 *
 * 边界（唯一实现，画布侧只允许调这里，见 visual-direction-plan.md 的
 * 「同一规则只准一份实现」铁律）：
 * - 血缘表**只有一份**：`StudioCanvasNode.sourceIds`（契约 §Bloodline，
 *   "There is no separate edge table — edges are derived from the node graph"）。
 *   本模块与 `CanvasEdges` 消费同一个字段，不引入第二张边表。
 * - 血缘距离 = **双向最近跳数**（上游「我引用的」与下游「引用我的」等价），
 *   起点是「被拖的簇」—— 多选时是整队，拖托盘/成员时是托盘及其全部成员
 *   （一个托盘在拖动中本来就是一个整体，见 `containmentCluster`）。
 * - 数值（0.75 / 0.42）**不在这里**，本模块只判档位；实际明度由 CSS 的
 *   `--cs-dim-near` / `--cs-dim` 给出（`.csNodeNear` / `.csNodeDimmed`）。
 *
 * 纯函数、无 DOM、无 React：`node --test` 可直连 lib/canvas-lineage.js。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 档位：`near`（中间档）/ `dim`（压暗档）。亮档不传，用 `undefined` 表示。 */
export type CanvasSpotlightTier = 'near' | 'dim';
/** 聚光计算结果。 */
export interface CanvasSpotlight {
    /** 是否启用景深压暗。**没有直接血缘留在亮档时为 false** —— 见下。 */
    readonly active: boolean;
    /** 保持全亮的节点 id（被拖节点 + 其直接血缘 + 托盘簇）。 */
    readonly lit: ReadonlySet<string>;
    /** 中间档节点 id（隔一层血缘）。 */
    readonly near: ReadonlySet<string>;
    /** 压暗档节点 id（更远与无关）。 */
    readonly dim: ReadonlySet<string>;
}
/**
 * 计算本次拖动的血缘聚光。
 *
 * **两道安全阀**（缺一条都会退化成「整屏变灰」）：
 *
 * ① 「必须有直接血缘留在亮档」：拖的簇之外若**一个 1 跳邻居都没有**，整张画布
 *    除自己以外全是压暗档，压暗揭示不了任何关系，用户看到的是「画面突然变暗」。
 *    这条挡住了两个最刺眼的场景：拖一张刚导入、还没连线的素材；拖一个自成一体、
 *    对外没有血缘的托盘。
 * ② 「中间档覆盖率上限」：见 `NEAR_COVERAGE_LIMIT`。
 *
 * 触发时机由调用方保证（**只有真正开始移动**才传 `draggingIds`）—— 单击选中不
 * 压暗。这不只是体验取舍：压暗的生命周期绑手势只有 `pointerup`/`pointercancel`
 * 两条出口，而选区有十几处写入点，绑选区正是 CV-171「松手不恢复」的成因。
 *
 * @param nodes 画布上的**可见**节点（调用方传 `visible !== false` 的那批；隐藏
 *              节点不参与，否则会点亮画布上根本看不见的节点 id）。
 * @param draggingIds 正在被拖的节点 id（多选时传整队）。
 * @returns 三个档位的节点 id 集合。
 */
export declare function canvasSpotlight(nodes: readonly StudioCanvasNode[], draggingIds: readonly string[]): CanvasSpotlight;
