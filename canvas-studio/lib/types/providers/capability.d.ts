/**
 * 工具 + 参数 → 能力 的解析（阶段 1）。
 *
 * 这是抽象层存在的核心理由之一：现状下 `video_generate` 无论有无参考图都走
 * 同一个 Drama 端点 `image2videofl2va`；但 fal 把「文生视频」与「图生视频」
 * 拆成了两个不同端点。因此「模型 = 端点路径」的隐含假设在多供应商下不成立，
 * 必须显式解析成语义能力。
 */
import type { VideoCapability } from './types.js';
/**
 * 入参的最小结构。刻意**只声明需要的两个字段**，不导入 `GenerateParams`——
 * 否则 `generate.ts`（阶段 2 起要 import 本模块）会与本模块形成循环依赖。
 * `GenerateParams` 在结构上可直接传入。
 */
export interface CapabilityInput {
    readonly filename?: string | undefined;
    readonly filenames?: readonly string[] | undefined;
}
/**
 * 解析出本次生成所需的能力。
 *
 * | 工具 | 条件 | 能力 |
 * | --- | --- | --- |
 * | `video_generate` | 无参考图 | `text-to-video` |
 * | `video_generate` | 有首帧图 | `first-last-frame` |
 * | `video_composite` | 恰好 2 张 | `first-last-frame`（首尾帧插值） |
 * | `video_composite` | 1 张或 ≥3 张 | `multi-reference` |
 *
 * @throws 传入的不是视频生成工具时抛错。
 */
export declare function capabilityOf(tool: string, params: CapabilityInput): VideoCapability;
