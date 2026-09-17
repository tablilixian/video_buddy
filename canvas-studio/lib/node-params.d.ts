/**
 * 节点生成参数（`generationPrompt`）的解析、提示词字段映射与可重放判定的
 * **唯一实现**。纯函数、无运行时依赖 —— Host tsc 会把它打进 `lib/node-params.js`，
 * 于是 `node --test` 能直接单测（同上位模块 `canvas-view.ts` 的约定）。
 *
 * ## 为什么必须收口
 *
 * 真画布实测（7 个项目 / 139 节点）里 `generationPrompt` 有**四种不同长相**，
 * 而「重放」链路只有一条：
 *
 * | toolName | 参数结构 | 可重放 |
 * |---|---|---|
 * | `image_generate` (45) | `{prompt, aspectRatio, resolution?, style, filename?/filenames?, ...}` | ✅ |
 * | `video_generate` (4) / `video_composite` (6) | `{prompt, aspectRatio, duration, filenames, ...}` | ✅ |
 * | `music_generation` (5) | `{caption_prompt, lyrics_prompt, duration, bpm, language, ...}` | ❌ 后端没有对应分支 |
 * | `character_sheet` (2) | `{image, step}` | ❌ 且 toolName 与分支名 `character_generate` 对不上 |
 * | `extract_last_frame` (1) | `{videoUrl, seek}` | ❌ 后端没有对应分支 |
 *
 * 从前「能不能重试」的判据是「有没有 toolName + 有没有 generationPrompt」——
 * 那 8 个打不通的节点因此照样显示可点的按钮，点下去落进图片分支（`params.prompt`
 * 是 undefined、又没有参考图 ⇒ 打 `txt2image`），**要么报错、要么静默出一张无
 * 提示词的图覆盖掉原节点**。判据收紧到「有没有可重放的生成参数」是本模块的职责。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 生成参数（`generationPrompt` 解析后的宽松形态）。 */
export type GenerationParams = Record<string, unknown>;
/**
 * 解析一份 `generationPrompt`。非法（缺省 / 非 JSON / 不是对象）返回 `null`。
 *
 * 返回 `null` 的调用方一律**不得写回** —— 用半份参数覆盖原值比不编辑更坏。
 */
export declare function parseGenerationParams(raw: string | undefined): GenerationParams | null;
/** 解析节点上保存的生成参数（节点级重试的回放锚点）。 */
export declare function generationParamsOf(node: StudioCanvasNode): GenerationParams | null;
/**
 * 能否原地重放（重试）。
 *
 * 两个条件缺一不可：① toolName 在 `generateAsset` 的真实分支里；② 参数可解析。
 * 只看「有没有 generationPrompt」会把音频 / 四视图 / 抽帧那 8 个节点放进来。
 */
export declare function isReplayable(node: StudioCanvasNode): boolean;
/** 生成参数里一段可编辑的自由文本。 */
export interface PromptField {
    /** 在 `generationPrompt` 里的键名。 */
    key: string;
    /** 界面标签。 */
    label: string;
}
/**
 * 某个节点上**可编辑的提示词字段**（空数组 = 该节点没有提示词可改，编辑器不出现）。
 *
 * 未登记的工具走宽容兜底：参数里真有一个字符串 `prompt` 才给编辑框（历史工具，
 * 如已下线的 `style_transfer`）。反过来，参数里没有 `prompt` 就什么都不给 ——
 * **不假设人人都有 `prompt`** 是这张表存在的全部理由。
 */
export declare function promptFieldsOf(node: StudioCanvasNode): readonly PromptField[];
/** 读某个提示词字段的当前值（缺省 / 非字符串一律空串）。 */
export declare function promptValueOf(node: StudioCanvasNode, key: string): string;
/**
 * 把某个提示词字段写回 `generationPrompt`，返回**新的 JSON 串**。
 *
 * 返回 `null` = 原参数不可解析（旧数据 / 手改），调用方必须放弃这次写入。
 * 其余键原样保留（`filename` / `sourceUrls` / `shotNodeIds` … 都是重放要用的）。
 */
export declare function withPromptField(raw: string | undefined, key: string, value: string): string | null;
