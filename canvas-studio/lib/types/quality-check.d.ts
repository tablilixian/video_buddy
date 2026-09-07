/**
 * C4 质检闭环：单镜一致性判定（VLM）与重跑预算计数。
 *
 * 方案 §4.5（docs/plans/canvas-studio-consistency-solution.md）：
 * - 生成后调 `image2vl` 自检「镜头图 vs 资产卡 lockedPrompt」→ PASS/FAIL；
 * - FAIL → 只重跑该镜；每镜重跑预算默认 2 次，超限上报用户仲裁（HITL）。
 *
 * 与 C2/C3 一致的取向：Host 只提供**判定与计数的事实**，不替 agent 做重跑
 * 决策（重跑哪些镜、怎么改 prompt 仍由总纲纪律驱动）。预算必须落盘才算数，
 * 否则跨会话/跨重跑（新节点）计数会归零。
 */
import type { StudioCanvasNode, StudioQcRecord } from './contracts/canvas.js';
/** 质检系统提示词：强制 JSON 输出，压掉 VLM 的寒暄与解释。 */
export declare const QC_SYSTEM_PROMPT = "\u4F60\u662F\u5F71\u89C6\u4E00\u81F4\u6027\u8D28\u68C0\u5458\u3002\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u6587\u5B57\u3001\u4E0D\u8981\u4EE3\u7801\u5757\u6807\u8BB0\u3002";
/** 每镜默认重跑预算（含首次判定在内，FAIL 达到该次数即交用户仲裁）。 */
export declare const DEFAULT_QC_BUDGET = 2;
/**
 * 构造质检提示词。`expect` 是判定基准（资产卡 lockedPrompt 或调用方显式给出）。
 */
export declare function buildQcPrompt(expect: string): string;
export type QcVerdictValue = 'pass' | 'fail' | 'warn';
export interface QcVerdict {
    verdict: QcVerdictValue;
    drifts: string[];
    reason: string;
}
/**
 * 解析 VLM 输出为结构化判定。容错：代码块围栏、前后寒暄、中文「通过/不通过」。
 * 解析不出结论时降级为 warn（不自动重跑，交人工确认）。
 */
export declare function parseQcVerdict(raw: string): QcVerdict;
/**
 * 选出被质检的画布节点：filename 精确匹配的 image 节点中最新的一张。
 * 找不到返回 null（此时仍可判定，只是结论不落盘）。
 */
export declare function pickQcTargetNode(nodes: readonly StudioCanvasNode[], filename: string): StudioCanvasNode | null;
/**
 * 本次质检的序号（1 起）。跨重跑继承：重跑会产出**新节点**，所以要按分镜卡
 * 血缘（shotCardIds）统计该镜历史已质检次数，而不是只看当前节点。
 */
export declare function nextQcAttempt(nodes: readonly StudioCanvasNode[], target: StudioCanvasNode | null, shotCardIds?: readonly string[]): number;
export interface QcShotOptions {
    /** VLM 调用（注入以便测试与后端不可用时降级）。 */
    analyze: (filename: string, prompt: string, systemPrompt: string, signal?: AbortSignal) => Promise<string>;
    /** 重跑预算，默认 DEFAULT_QC_BUDGET。 */
    budget?: number;
    /** 判定基准文本。 */
    expect: string;
    /** 分镜卡节点 id（用于跨重跑累计预算）。 */
    shotCardIds?: readonly string[];
    signal?: AbortSignal;
    now?: () => number;
}
export interface QcShotResult extends QcVerdict {
    /** 本次是第几次质检（1 起，跨重跑继承）。 */
    attempts: number;
    /** 重跑预算。 */
    budget: number;
    /** FAIL 且已达预算：停止自动重跑，上报用户仲裁。 */
    exhausted: boolean;
    /** 结论落盘的节点 id（未匹配到画布节点时为 null）。 */
    nodeId: string | null;
    /** 待写入节点的质检记录。 */
    record: StudioQcRecord;
    /** VLM 原始输出（便于排查误判）。 */
    raw: string;
}
/**
 * 对单个镜头产物做一致性质检。返回结构化判定 + 预算状态 + 待落盘记录。
 * 落盘由调用方完成（Host 工具持有 registry）。
 */
export declare function runShotQc(nodes: readonly StudioCanvasNode[], filename: string, options: QcShotOptions): Promise<QcShotResult>;
/** 把质检结论渲染给模型看的文本（工具 output.render 用）。 */
export declare function renderQcText(result: QcShotResult): string;
