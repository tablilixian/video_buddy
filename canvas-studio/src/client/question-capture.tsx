/**
 * P7 点选式澄清的对话区内联卡片：conversationEvents 定义把 ask_user_choice
 * 的 tool/call 组装成 `canvas-studio-question` 聊天节点，渲染器注册进上游
 * `conversation.chat.node` keyed seat —— 问题与选项按钮直接出现在对话流里，
 * 用户点选后答案回流给模型（Host 工具轮询 pendingQuestion）。
 *
 * 仅客户端使用（JSX + 框架类型），不进 Host tsc 产物。
 */
import { memo } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 渲染器载荷（聊天节点 data）。 */
export interface StudioQuestionChatData {
  question: string
  options: string[]
  allowFreeText: boolean
  /** 用户点选 / 自由输入的答案；未回答时为 null。 */
  answer: string | null
  /** 结算说明（超时 / 被清除 / 出错），有值时同样视为已结算。 */
  note: string | null
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'canvas-studio-question': StudioQuestionChatData
  }
}

/** definition 与 apply 世界的接线点。 */
export interface QuestionCaptureHooks {
  /** 当前画布绑定的项目 id；未绑定时为 null（按钮置灰）。 */
  getSelectedProjectId(): string | null
  /** 提交用户选择（选项原文或自由输入）。 */
  onAnswer(projectId: string, value: string): void
}

/** 从 tool/call 参数解析问题（arguments 是 JSON 字符串）。 */
function parseQuestionArguments(raw: unknown): Omit<StudioQuestionChatData, 'answer' | 'note'> {
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    parsed = null
  }
  const record = (parsed ?? {}) as Record<string, unknown>
  return {
    question: typeof record.question === 'string' ? record.question : '（问题解析失败）',
    options: Array.isArray(record.options) ? record.options.map(String) : [],
    allowFreeText: record.allowFreeText === true,
  }
}

/** 从 renderTextResult 的文本块提取结算说明。 */
function extractResultNote(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '已结算'
  for (const block of blocks) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.length > 0) return text
    }
  }
  return '已结算'
}

/** 对话区内联点选卡片渲染器。 */
export const QuestionNodeView = memo(function QuestionNodeView(
  props: ChatNodeViewProps<'canvas-studio-question'> & { hooks: QuestionCaptureHooks },
) {
  const { node, hooks } = props
  const data = node.data
  const settled = data.answer !== null || data.note !== null
  const handleAnswer = (value: string): void => {
    if (settled) return
    const projectId = hooks.getSelectedProjectId()
    if (projectId !== null) hooks.onAnswer(projectId, value)
  }
  return (
    <div className="csQuestionCard">
      <span className="csQuestionLabel">{data.question}</span>
      <div className="csQuestionOptions">
        {data.options.map(option => (
          <button key={option} type="button" disabled={settled} onClick={() => { handleAnswer(option) }}>
            {option}
          </button>
        ))}
      </div>
      {settled && (
        <span className="csWorkflowState">
          {data.answer !== null ? `已选择：${data.answer}` : data.note}
        </span>
      )}
    </div>
  )
})

/**
 * 创建 ask_user_choice 的对话节点定义（纯事件组装；渲染交互见 QuestionNodeView）。
 * @returns 注册进 `ctx.conversationEvents` 的 definition。
 */
export function createQuestionCaptureDefinition():
  ConversationNodeDefinition<StudioQuestionChatData> {
  return {
    kind: 'canvas-studio-question',
    target: 'chat',
    match(event: ConversationMatch['event']): { id: string; role: 'start' | 'update' } | null {
      if (event.type === 'tool/call') {
        const data = event.data as { callId: unknown; name: string }
        if (data.name === 'ask_user_choice') return { id: String(data.callId), role: 'start' }
        return null
      }
      if (event.type === 'tool/result') {
        const source = (event.data as { message: { source: { callId: unknown } } }).message.source
        return { id: String(source.callId), role: 'update' }
      }
      return null
    },
    start: (_context, startMatch) => {
      const data = startMatch.event.data as { arguments?: unknown }
      return { ...parseQuestionArguments(data.arguments), answer: null, note: null }
    },
    update: (context, updateMatch) => {
      if (updateMatch.event.type !== 'tool/result') return context.state
      const data = updateMatch.event.data as { error?: unknown; message: { content?: unknown } }
      if (data.error !== undefined) {
        const message = typeof data.error === 'string'
          ? data.error
          : '提问已取消'
        return { ...context.state, note: message }
      }
      return { ...context.state, note: extractResultNote(data.message?.content) }
    },
    buildViewNode: (context: ConversationNodeContext<StudioQuestionChatData>) => {
      const state = context.state
      if (state === undefined) return null
      const anchorSeq = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0
      const location = context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' as const }
      return {
        key: context.key,
        kind: 'canvas-studio-question',
        id: context.id,
        target: 'chat',
        anchorSeq,
        location,
        visibility: 'visible',
        data: state,
      }
    },
  }
}

/**
 * 注册对话区点选卡片：definition（事件组装）+ 渲染器（keyed seat）。
 * @param ctx - active client context。
 * @param hooks - 与 apply 世界的接线。
 * @returns 注销函数。
 */
export function registerQuestionChatNode(ctx: Context, hooks: QuestionCaptureHooks): () => void {
  const disposeDefinition = ctx.conversationEvents.register(
    createQuestionCaptureDefinition() as never,
  )
  const disposeRenderer = ctx.slots.inject('conversation.chat.node' as never, () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'canvas-studio-question' } as never,
    ((props: ChatNodeViewProps<'canvas-studio-question'>) => (
      <QuestionNodeView {...props} hooks={hooks} />
    )) as never,
  ))
  return () => {
    disposeRenderer()
    disposeDefinition()
  }
}
