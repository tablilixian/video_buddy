/**
 * 放手跑（auto）的**自动取值表** —— 「不问用户时该按什么跑」的唯一事实来源。
 *
 * ## 为什么必须有这张表，而不是让模型自由发挥
 *
 * 放手跑的语义是「用户已授权一路跑完」（见 `approval-gate.ts` 的「谁不受限」）。
 * 审批门禁那一半早已落地，但 `ask_user_choice` 过去**完全不看 `workflow.mode`**：
 * auto 下照样落一张点选卡片、然后阻塞到 `QUESTION_WAIT_MS`（10 分钟）才返回
 * 「请采用推荐项继续」。一轮流程里澄清问题 3~5 个 ⇒ 半小时到一小时空转。
 *
 * skill 层（`references/clarification.md`）写了「放手跑跳过提问」，但那是**提示词层的
 * 自觉** —— 而「靠提示词让模型自己停」这条已被证伪（同一天同一模型，剧本审批的停止
 * 指令落在第 49% 处它停了、分镜审批落到第 95% 处它没停，见 `approval-gate.ts` 实测
 * 记录）。所以判定必须下沉到这里，由 Host 硬拦。
 *
 * ## 三层优先级（唯一一张表，别处不许再解析一遍）
 *
 * | 层 | 来源 | 覆盖字段 |
 * | --- | --- | --- |
 * | 项目预置 | 新建弹窗锁定的 `project.plan`（CV-099） | 画幅 / 目标时长 |
 * | 设置页 | `defaultAspectRatio` / `defaultResolution` | 画幅 / 分辨率 |
 * | 硬编码兜底 | 本文件 `FALLBACK_*` | 画幅 16:9 / 时长 30s / 分辨率 768p |
 *
 * 项目预置排在设置页之前是刻意的：用户在**创建这个项目时**点的画幅是具体决定，
 * 设置页那项是「没别的指示时的默认」。
 *
 * ## 不在这里的东西
 *
 * **风格（画风）不归本表管**：它不是契约里的字段，也没有机器可读的默认项 —— 它是
 * Look 采集的产物（`references/look.md`：有参考就归纳、没有就从用户原话反推 5 项
 * tokens）。Host 凭空发明一个风格值会把「给古装套纸艺定格」那类灾难固化成默认。
 * 放手跑下这步由模型照常反推、不提问，本模块只在文案里说明这一点。
 *
 * 纯函数、无 IO、无 React —— 判定表在 `tests/studio-defaults.test.mjs` 里逐格验。
 */
import { type StudioPlanAspectRatio, type StudioProjectPlan, type StudioWorkflowMode } from './contracts/project.js';
import type { VideoResolution } from './providers/types.js';
/** 兜底画幅（项目未预置、设置页也没读到时的最后一层）。 */
export declare const FALLBACK_ASPECT_RATIO: StudioPlanAspectRatio;
/**
 * 兜底目标总时长（秒）。
 *
 * 30s 的取法：`SUGGESTED_SHOT_SECONDS`（10s）的整数倍 ⇒ 5 镜不到，是一个「短剧
 * 单条」的合理起点，且远低于 `MAX_TARGET_DURATION`（300s）不会一上来就烧掉预算。
 */
export declare const FALLBACK_TARGET_DURATION = 30;
/** 兜底分辨率档位（与设置项 schema 的 default 同源，不另写字面量）。 */
export declare const FALLBACK_RESOLUTION: VideoResolution;
/** 各项取自哪一层（进模型可读的文案，让「预置 > 设置页 > 兜底」对 agent 可见）。 */
export type StudioDefaultSource = 'plan' | 'settings' | 'fallback';
/** 设置页侧的两个入参（缺省 = 读不到，按兜底处理）。 */
export interface StudioDefaultsSettings {
    readonly defaultAspectRatio?: string;
    readonly defaultResolution?: VideoResolution;
}
/** `resolveStudioDefaults` 的入参（都可缺省：老项目无 plan、测试可只喂一半）。 */
export interface StudioDefaultsInput {
    readonly plan?: StudioProjectPlan;
    readonly settings?: StudioDefaultsSettings;
}
/** 放手跑会自动采用的一套规格。 */
export interface StudioDefaults {
    readonly aspectRatio: StudioPlanAspectRatio;
    readonly aspectRatioSource: StudioDefaultSource;
    readonly targetDuration: number;
    readonly targetDurationSource: StudioDefaultSource;
    /** 由目标时长推导的建议镜头数（`suggestShotCount`，至少 1 镜）。 */
    readonly shotCount: number;
    readonly resolution: VideoResolution;
    readonly resolutionSource: StudioDefaultSource;
}
/**
 * 解析放手跑要用的规格。三层优先级逐项独立生效（画幅走预置不代表时长也走预置）。
 */
export declare function resolveStudioDefaults(input?: StudioDefaultsInput): StudioDefaults;
/**
 * 规格 → 一行可读文本（进工具结果，模型据此知道哪些是硬约束）。
 *
 * 每项后面挂来源标记：模型看到「画幅 9:16（项目预置）」就不会拿一道「要横屏还是
 * 竖屏？」的自问自答去覆盖它 —— 这是把优先级表**真正送达模型**的那一步。
 */
export declare function describeStudioDefaults(defaults: StudioDefaults): string;
/**
 * 推荐项挑选的**唯一实现**：带「推荐」标记的优先，否则首项。
 *
 * 工具描述要求 agent 把推荐项写成「xxx（推荐）」，所以这是**问题维度内**的默认值；
 * 而项目规格是**跨问题**的硬约束。两者都给模型，让它自己判断该听谁的（README 的
 * 「选哪一个」类问题以选项为准，「多长」类问题以规格为准）。
 *
 * 超时兜底与放手跑自动应答共用本函数 —— 两处各写一遍的话，同一份推荐项会在
 * 「超时」与「放手跑」两条路上给出不同答案。
 */
export declare function recommendedOptionOf(options: readonly string[]): string | undefined;
/** `autoAnswerFor` 的入参。 */
export interface AutoAnswerInput {
    readonly mode: StudioWorkflowMode;
    /** 原问题文本（回显给模型，帮它把答案对上是哪一问）。 */
    readonly question: string;
    readonly options: readonly string[];
    readonly defaults: StudioDefaults;
}
/**
 * 放手跑下的自动应答。返回 `null` = **需要真的问用户**（逐步确认模式）。
 *
 * 返回非 null 时调用方必须做到三件事，缺一件就等于没做：
 * ① 不落 `pendingQuestion`（否则画布上会弹出一张用户根本没打算答的卡片）；
 * ② 不进入轮询等待（否则白等 `QUESTION_WAIT_MS`）；
 * ③ 把答案与规格明确回给模型（否则它只能瞎猜，或在下一轮再问一次）。
 */
export declare function autoAnswerFor(input: AutoAnswerInput): string | null;
