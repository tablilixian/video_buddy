import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** 渲染器载荷（聊天节点 data）。 */
export interface StudioQuestionChatData {
    question: string;
    options: string[];
    allowFreeText: boolean;
    /** true 时为多选题：chips 可勾选，确认后以「、」拼接提交。 */
    multiSelect: boolean;
    /** 用户点选 / 自由输入的答案；未回答时为 null。 */
    answer: string | null;
    /** 结算说明（超时 / 被清除 / 出错），有值时同样视为已结算。 */
    note: string | null;
}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        'canvas-studio-question': StudioQuestionChatData;
    }
}
/** definition 与 apply 世界的接线点。 */
export interface QuestionCaptureHooks {
    /** 当前画布绑定的项目 id；未绑定时为 null（按钮置灰）。 */
    getSelectedProjectId(): string | null;
    /** 提交用户选择（选项原文或自由输入）。 */
    onAnswer(projectId: string, value: string): void;
}
/** 对话区内联点选卡片渲染器。 */
export declare const QuestionNodeView: import("react").MemoExoticComponent<(props: ChatNodeViewProps<"canvas-studio-question"> & {
    hooks: QuestionCaptureHooks;
}) => import("react").JSX.Element>;
/**
 * 创建 ask_user_choice 的对话节点定义（纯事件组装；渲染交互见 QuestionNodeView）。
 * @returns 注册进 `ctx.conversationEvents` 的 definition。
 */
export declare function createQuestionCaptureDefinition(): ConversationNodeDefinition<StudioQuestionChatData>;
/**
 * 注册对话区点选卡片：definition（事件组装）+ 渲染器（keyed seat）。
 * @param ctx - active client context。
 * @param hooks - 与 apply 世界的接线。
 * @returns 注销函数。
 */
export declare function registerQuestionChatNode(ctx: Context, hooks: QuestionCaptureHooks): () => void;
