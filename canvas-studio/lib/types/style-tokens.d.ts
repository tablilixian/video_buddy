/**
 * Look tokens（5 项风格 tokens）的**单一权威定义**（纯常量 + 纯函数，无 IO / 无网络）。
 *
 * 背景见 docs/look-asset-plan.md §3.2：把「风格」从「澄清问卷里的一个选项」换成
 * 「一份可寻址的 5 元组」，让四种输入（一句创意 / 参考图 / 参考视频 / 预设）都归一到
 * 同一份 tokens —— 因为它同时是**完备基**（任何 look 都只能用这 5 个自由度表达）与
 * **汇合点**（四种输入都能产出同一个 5 元组）。
 *
 * 为什么要结构化而不是让模型写一段风格描述：自由文本一改就牵连全段、跨镜复制会漂移、
 * 样张不对时说不清是哪一项的问题。结构化把这三个缺陷同时消掉（改「再暗一点」只动「光线」一行）。
 *
 * 本文件是**唯一权威**：
 * - Host 侧 `video-style.ts`（参考视频归纳）从这里取提示词；
 * - Agent 侧 `skills-local/…/references/look.md` 里的提示词原文由测试断言与本文件逐字节一致
 *   （防 CV-116 那类「多处同改漏一处」的漂移）；
 * - 不要在别处重复写这 5 个字段名的字面量。
 */
/** Look tokens 的 5 个字段。**顺序固定、不增不减** —— 四路输入与逐镜注入都按此顺序。 */
export declare const LOOK_TOKEN_KEYS: readonly ["色彩", "光线", "材质", "镜头语汇", "节奏"];
export type LookTokenKey = (typeof LOOK_TOKEN_KEYS)[number];
/** VLM 归纳时的系统提示词（参考视频逐帧归纳与参考图归纳共用）。 */
export declare const LOOK_ANALYST_SYSTEM_PROMPT = "\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u5F71\u89C6\u89C6\u89C9\u5206\u6790\u5E08\uFF0C\u64C5\u957F\u4ECE\u753B\u9762\u4E2D\u63D0\u70BC\u53EF\u590D\u7528\u7684\u98CE\u683C\u8981\u7D20\u3002";
/**
 * 画面 → 5 项 tokens 的归纳提示词（参考视频逐帧归纳的**每一帧**、参考图归纳都用它）。
 *
 * 只给**字段名**、不给字段解释 —— 否则模型会把解释照抄回来当结论。措辞要求「具体结论」
 * 是为了防这类退让：字段名是「问什么」，结论是「这部片子怎么答」。
 */
export declare const LOOK_TOKENS_PROMPT: string;
/**
 * 从任意文本里解析 5 项 tokens（**容错**：解析不到就返回空对象，绝不抛）。
 *
 * 容错是刻意的 —— 归纳文本来自 VLM，格式不可能 100% 守约（可能出现序号、加粗、
 * 换行续写、或干脆回退成自由要点）。解析失败时上层走降级路径（提示用户改用反推），
 * 而不是把生成流程打断。
 */
export declare function parseLookTokens(text: string): Partial<Record<LookTokenKey, string>>;
/**
 * 把多份归纳文本**归并**成一份 5 项 tokens（纯函数，零额外 VLM 调用）。
 *
 * 参考视频的逐帧分析现状只是 `join('\n\n')` 拼接 —— 那不是归纳，是把 N 帧的观察堆在一起，
 * 读的人还得自己做合并。归并按「字段 → 子句」两级去重：同一字段下多帧观察到的相同子句只留一份，
 * 不同的子句按帧序并列，于是「色彩」一行就是全片色彩的完整描述。
 *
 * 返回 `''` 表示**一份可用的 tokens 都没归纳出来**（VLM 没按格式输出）→ 调用方应走降级：
 * 如实说明未归纳成功，请用户改用参考图或直接描述。
 */
export declare function mergeLookTokens(texts: readonly string[]): string;
/**
 * 把**已解析**的 tokens 按固定行序拼回文本（缺的字段跳过）。
 *
 * 与 `mergeLookTokens` 的分工：那个是「多份归纳文本 → 归并」，本函数是「一份 tokens →
 * 单一格式化」。Look 卡落卡时用它把 Agent 传入的 lockedPrompt 归一成权威行序与行格式 ——
 * 逐镜注入是**逐字节复用**，行序或标点漂移会让「同一份 tokens」在卡里和 prompt 里长得不一样。
 */
export declare function formatLookTokens(tokens: Partial<Record<LookTokenKey, string>>): string;
/**
 * 缺哪些字段（按固定顺序返回）。
 *
 * 落卡时用它出**告警**而不是硬拦：5 项不全会让风格注入出现空洞，但用户确实可能只要其中
 * 几项（例如纯色背景的片子没有「材质」诉求）—— 如实告知 + 允许同名重调覆盖即可。
 */
export declare function missingLookTokenKeys(tokens: Partial<Record<LookTokenKey, string>>): LookTokenKey[];
