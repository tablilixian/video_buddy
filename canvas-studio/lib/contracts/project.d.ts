/**
 * Shared project-record wire types for the Canvas Studio host registry and
 * the browser client. Pure types only: both halves import them and erase
 * them at build time, so this file never appears in the runtime bundles.
 */
/** P7 执行模式：confirm 逐步确认；auto 放手跑（跳过审批门禁）。 */
export type StudioWorkflowMode = 'confirm' | 'auto';
/** P7 工作流状态：drafting 需求澄清中；awaiting_approval 分镜表待批准；keyframe_review 关键帧待确认；executing 执行中。 */
export type StudioWorkflowState = 'drafting' | 'awaiting_approval' | 'keyframe_review' | 'executing';
/** 每个项目的创作工作流状态机（P7 门控的持久化事实源）。 */
export interface StudioWorkflow {
    mode: StudioWorkflowMode;
    state: StudioWorkflowState;
    /** 进行中的点选问题（ask_user_choice）；无问题时缺省。 */
    pendingQuestion?: StudioPendingQuestion | null;
}
/** 旧记录 / 新建项目的默认工作流。 */
export declare const WORKFLOW_DEFAULT: StudioWorkflow;
/**
 * Leniently coerce an unknown parsed workflow into a safe value; invalid or
 * missing fields degrade to their defaults (registry records may predate P7).
 */
export declare function normalizeWorkflow(value: unknown): StudioWorkflow;
/** One Canvas Studio project record. */
export interface StudioProject {
    /** Stable project id (Host-minted UUID). */
    id: string;
    /** User-facing project name. */
    name: string;
    /** Creation timestamp (ISO 8601). */
    createdAt: string;
    /** Last change timestamp (ISO 8601). */
    updatedAt: string;
    /** Absolute path of the project directory; assets live under `assets/`. */
    dir: string;
    /**
     * P7 creation workflow (mode + gate state). Optional on the wire so
     * pre-P7 registry documents stay readable; readers must treat absence as
     * `WORKFLOW_DEFAULT`.
     */
    workflow?: StudioWorkflow;
}
/**
 * 一条待回答的选择题（ask_user_choice 工具落盘，画布端渲染成点选卡片）。
 * 用户点击后 answer 被写入，Host 工具轮询读到即回传给模型并清空本条。
 */
export interface StudioPendingQuestion {
    id: string;
    question: string;
    options: string[];
    /** true 时客户端额外展示自由输入框（如品牌名这类开放要素）。 */
    allowFreeText?: boolean;
    /** 用户的选择（选项原文或自由输入），由 workflow 路由的 answer 动作写入。 */
    answer?: string;
}
