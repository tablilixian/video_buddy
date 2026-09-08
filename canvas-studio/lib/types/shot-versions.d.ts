/**
 * CV-108：镜位版本链与失效标注（纯函数层，可单测）。
 *
 * 背景：agent 对同一镜头会重复/返工生成多个视频节点（实测会话里 6 个镜头
 * 出了 12~13 段），而成片合成默认收「全部视频节点」，导致返工前后的版本
 * 一起被拼进成片。用户要求「最后合成时只合成合理的分镜视频」。
 *
 * 机制：节点上记录版本链——
 * - `shotVersion`：同一镜位的版本号（首版 1，被取代后新版 +1）；
 * - `supersededBy`：被哪个节点取代（有值即失效）；
 * - `retired`：手动作废（无替代者，如「这镜不要了」）；
 * - `supersedes`：取代了谁（反向索引，回溯用）。
 *
 * 取代关系三条建立通道（用户拍板）：
 * 1. **输入指纹相同自动取代** —— 同 toolName + 同参考图 filename + 同时长 +
 *    同分镜卡，视为同一镜位的重复生成，新版自动作废旧版（保守：指纹没有
 *    锚点时拒绝判重，避免误伤）；
 * 2. **agent 显式 `replaces`** —— 返工改了关键帧（指纹不同但语义是替代）时，
 *    生成工具显式声明取代哪个节点；
 * 3. **用户手动作废 / 恢复** —— 画布右键。恢复旧版时接管者自动作废，
 *    保证同一镜位只有一份有效。
 *
 * 消费方：`defaultComposeClips` 只取有效节点；`list_shots` 把版本与状态
 * 暴露给 agent，使其能精确指定 clipIds。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 节点状态：有效 / 被新版取代 / 手动作废。 */
export type ShotStatus = 'active' | 'superseded' | 'retired';
/** 生成输入的指纹素材（用于判重）。 */
export interface ShotFingerprintInput {
    /** 产出工具名（video_generate / video_composite …）。 */
    toolName?: string | undefined;
    /** 单参考图（video_generate）。 */
    filename?: string | undefined;
    /** 多参考图（video_composite）。 */
    filenames?: string[] | undefined;
    /** 时长（秒）。 */
    duration?: number | undefined;
    /** 关联分镜卡节点 id。 */
    shotNodeIds?: string[] | undefined;
}
/** 节点状态判定（有效 = 未被取代且未手动作废）。 */
export declare function shotStatusOf(node: StudioCanvasNode): ShotStatus;
/** 是否参与默认合成的「有效」节点。 */
export declare function isActiveShot(node: StudioCanvasNode): boolean;
/**
 * 输入指纹：同一镜位的不同版本共有的输入特征。
 *
 * 参考图与分镜卡都为空时返回 `''`——没有锚点就无法安全判重（否则所有纯文生
 * 视频会互相判重），调用方须跳过自动取代。
 */
export declare function shotFingerprintOf(input: ShotFingerprintInput): string;
/** 从已落盘节点反推输入指纹（与生成时同源）。 */
export declare function shotFingerprintOfNode(node: StudioCanvasNode): string;
/** 版本链规划结果。 */
export interface SupersedePlan {
    /** 新节点的版本号（被取代者最大版本 + 1；无取代者为 1）。 */
    version: number;
    /** 应被标失效的节点 id。 */
    supersedeIds: string[];
}
/**
 * 规划新节点的取代关系（纯函数，不落盘）。
 *
 * - `replaces` 命中且是视频节点 → 无条件取代（agent 显式声明）；
 * - 指纹非空 → 所有「有效 + 非成片 + 同指纹」的视频节点一并取代
 *   （吃掉同参数重复调用）；
 * - 两者皆无 → 返回 version 1、空列表（普通新镜头）。
 */
export declare function planSupersede(nodes: readonly StudioCanvasNode[], input: ShotFingerprintInput, replaces?: string): SupersedePlan;
/** 给被取代节点打上 `supersededBy`（返回新数组，不改原数组）。 */
export declare function applySupersede(nodes: readonly StudioCanvasNode[], newId: string, supersedeIds: readonly string[]): StudioCanvasNode[];
/** 沿 `supersededBy` 追到当前有效版（脏数据成环时返回 undefined）。 */
export declare function latestActiveOf(nodes: readonly StudioCanvasNode[], id: string): StudioCanvasNode | undefined;
/**
 * 作废 / 恢复（画布右键用，纯函数）。
 *
 * - 有效节点 → 置 `retired: true`；
 * - 失效节点 → 清除 `retired` 与 `supersededBy` 复活，**并把接管它的那个节点
 *   作废**，保证同一镜位始终只有一份有效（避免恢复后成片里出现两份同镜）。
 */
export declare function toggleRetire(nodes: readonly StudioCanvasNode[], id: string): StudioCanvasNode[];
