/**
 * 审批提交的工具结果文案（提示词层）—— 三个 `submit_*_for_approval` 的返回文本
 * 唯一实现。
 *
 * ## 为什么文案要单独抽出来
 *
 * 实测（2026-09-14，同一天同一个模型）两次审批的结果文本：
 *
 * | 工具 | 文本长度 | 「本回合到此结束」的位置 | 模型行为 |
 * | --- | --- | --- | --- |
 * | `submit_screenplay_for_approval` | 152 字符 | 第 74 字符（**49%**） | ✅ 停住了 |
 * | `submit_storyboard_for_approval` | **1080 字符** | 第 **1023** 字符（**95%**） | ❌ 继续跑 |
 *
 * 差别不在"写没写停止指令"，而在**位置**：分镜那条的前 1000 字符全是 16 张分镜卡
 * 的标题 + UUID +「逐镜出图时把 shotRefs 设为…」，对一个 27B 本地模型来说这就是
 * 一份"下一步清单"，停止指令被压到最后一行等于没写。
 *
 * 所以本模块把两件事**物理隔开**，而不是靠措辞变凶：
 * 1. 第一行 = 停手指令（模型最先读到、且不掺任何可执行内容）；
 * 2. 卡清单这类**获批后才用得上**的材料统一走 `deferred`，前面加一道显式围栏，
 *    并明说"现在不要据此行动"。
 *
 * 文案的**结构**（而非字面）由 `tests/approval-notice.test.mjs` 钉住：首行必须是
 * 停手、`deferred` 必须整段出现在停手之后、放手跑分支不得出现停手。
 *
 * 真正的闸在 `approval-gate.ts`（拦调用）+ `host-tools.ts` 的 `exec.concludeTurn()`
 * （在提交那一刻结束回合）。本模块只负责**少浪费几步**：模型越早自己停，越不容易
 * 在 `concludeTurn` 生效前抢跑同一步的并发工具调用。
 */
import type { StudioWorkflowMode } from './contracts/project.js';
/** 三道审批门。 */
export type ApprovalGate = 'screenplay' | 'storyboard' | 'keyframes';
/**
 * 停手首行。**必须是返回文本的第一个字符起** —— 位置就是这个模块存在的理由，
 * 不要把它挪到任何陈述之后。
 */
export declare const APPROVAL_HOLD = "\u26D4 \u505C\u624B\uFF1A\u672C\u56DE\u5408\u5230\u6B64\u7ED3\u675F\uFF0C\u4E0D\u8981\u518D\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\u3002";
/** `deferred` 段的围栏标题。 */
export declare const DEFERRED_FENCE = "\u2014\u2014 \u4EE5\u4E0B\u662F\u83B7\u6279\u540E\u624D\u9700\u8981\u7684\u4FE1\u606F\uFF0C\u73B0\u5728\u4E0D\u8981\u636E\u6B64\u884C\u52A8 \u2014\u2014";
/** `approvalNotice` 的入参。 */
export interface ApprovalNoticeInput {
    readonly gate: ApprovalGate;
    /** 执行模式：`auto` 直接放行，不加停手横幅。 */
    readonly mode: StudioWorkflowMode;
    /** 一句话概述（工具入参的 `summary`）。 */
    readonly summary?: string;
    /** 获批后才需要的信息（分镜卡标题 + id 清单等）。留空则整段省略。 */
    readonly deferred?: string;
}
/**
 * 产出提交审批的工具结果文本。
 *
 * `mode === 'auto'`（放手跑）返回放行文案（无停手）；逐步确认模式返回停手文案，
 * 并把 `deferred` 隔到围栏之后。
 */
export declare function approvalNotice(input: ApprovalNoticeInput): string;
