/**
 * P7 点选式澄清的对话区内联卡片：conversationEvents 定义把 ask_user_choice
 * 的 tool/call 组装成 `canvas-studio-question` 聊天节点，渲染器注册进上游
 * `conversation.chat.node` keyed seat —— 问题与选项按钮直接出现在对话流里，
 * 用户点选后答案回流给模型（Host 工具轮询 pendingQuestion）。
 *
 * S3 增强：当选项命中「风格预设」8 类名称时，把文字按钮升级为 GIF 预览卡片
 * （资源来自 webServer /canvas-studio/style-demos，sync 脚本从 minimax-h3
 * submodule copy）；未命中的选项（时长/画幅等）保持文字按钮。
 *
 * 仅客户端使用（JSX + 框架类型），不进 Host tsc 产物。
 */
import { memo, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { getSkillEntry } from '../skill-catalog.js'
import { shouldRenderStyleGrid, styleDemoSkill } from '../style-grid.js'

/**
 * CV-151：「选项文案 → skill 名」映射与网格进入判定已抽到根级 `style-grid.ts`
 * （Host 侧可单测；本组件只管渲染）。网格进入规则从「任一选项命中」收紧为
 * 「几乎全部选项都是预设」——Look 采集类问题（样张确认等）顺带提到预设名时
 * 不再误入网格；网格内未命中的兜底选项也不再被吞，改走下方文字按钮。
 */

/** 渲染器载荷（聊天节点 data）。 */
export interface StudioQuestionChatData {
  question: string
  options: string[]
  allowFreeText: boolean
  /** true 时为多选题：chips 可勾选，确认后以「、」拼接提交。 */
  multiSelect: boolean
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
    allowFreeText: record.allowFreeText !== false,
    multiSelect: record.multiSelect === true,
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
  // CV-002/CV-049：自由输入框缺省开启（allowFreeText=false 才隐藏）。
  // CV-062：统一两段式交互——单选/多选都是「点选 → 确认」（单选点新项自动
  // 替换旧项，防误触），确认按钮实时预览所选；答案以「、」拼接提交。本地
  // submitted 先行锁定提交态——工具结果回流（note/answer）有延迟，期间防重复提交。
  const [freeText, setFreeText] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const settled = data.answer !== null || data.note !== null || submitted
  // CR-089：权威结果（answer/note）回流时清空本地选态/输入——避免「已选 A +
  // 已取消/超时」这类冲突展示（本地 selected 残留会与 note 语义打架）。
  useEffect(() => {
    if (data.answer !== null || data.note !== null) {
      setSelected([])
      setFreeText('')
    }
  }, [data.answer, data.note])
  const handleAnswer = (value: string): void => {
    if (settled) return
    const projectId = hooks.getSelectedProjectId()
    if (projectId !== null) hooks.onAnswer(projectId, value)
  }
  const handleOptionClick = (option: string): void => {
    if (settled) return
    setSelected(prev => data.multiSelect
      ? (prev.includes(option) ? prev.filter(item => item !== option) : [...prev, option])
      : [option])
  }
  const confirmLabel = data.multiSelect
    ? `确认（已选 ${selected.length} 项）`
    : (selected.length > 0 ? `确认：${selected[0]}` : '确认')
  const submitSelected = (): void => {
    if (selected.length === 0 || settled) return
    handleAnswer(selected.join('、'))
    setSubmitted(true)
  }
  const submitFreeText = (): void => {
    const value = freeText.trim()
    if (value.length === 0 || settled) return
    handleAnswer(value)
    setSubmitted(true)
  }
  return (
    <div className="csQuestionCard">
      <span className="csQuestionLabel">
        <em className="csQuestionIcon">✦</em>
        {data.question}
        <i className="csQuestionHint">点选后确认</i>
      </span>
      {shouldRenderStyleGrid(data.options) ? (
        <>
          <div className="csStyleDemoGrid">
            {data.options.map(option => {
              const skill = styleDemoSkill(option)
              if (skill === null) return null
              const recommended = option.includes('（推荐）')
              const label = option.replace('（推荐）', '').trim()
              // CV-116：GIF 是否存在以 catalog 的 demo 字段为准（单点真相）。缺失时
              // 渲染降级占位而不是丢弃卡片——否则该风格在澄清里根本选不到。
              const demo = getSkillEntry(skill)?.demo
              return (
                <button
                  key={option}
                  type="button"
                  className={`csStyleDemoCard${selected.includes(option) ? ' csSelected' : ''}`}
                  disabled={settled}
                  onClick={() => { handleOptionClick(option) }}
                >
                  {demo === undefined ? (
                    <span className="csStyleDemoFallback" title="可正常选用，仅暂无预览动画">暂无预览</span>
                  ) : (
                    <img
                      className="csStyleDemoImg"
                      loading="lazy"
                      src={`/canvas-studio/style-demos/${demo}`}
                      alt={label}
                    />
                  )}
                  <span className="csStyleDemoName">
                    {label}
                    {recommended && <em className="csStyleDemoBadge">推荐</em>}
                  </span>
                </button>
              )
            })}
          </div>
          {/* CV-151：网格模式下的未命中选项（如「我自己描述」兜底项）照常渲染，
              不再被吞——旧实现 `return null` 会让用户选不到这个按钮。 */}
          {data.options.some(option => styleDemoSkill(option) === null) && (
            <div className="csQuestionOptions">
              {data.options.filter(option => styleDemoSkill(option) === null).map(option => (
                <button
                  key={option}
                  type="button"
                  className={selected.includes(option) ? 'csSelected' : undefined}
                  disabled={settled}
                  onClick={() => { handleOptionClick(option) }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="csQuestionOptions">
          {data.options.map(option => (
            <button
              key={option}
              type="button"
              className={selected.includes(option) ? 'csSelected' : undefined}
              disabled={settled}
              onClick={() => { handleOptionClick(option) }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="csQuestionConfirm"
        disabled={settled || selected.length === 0}
        onClick={submitSelected}
      >
        {confirmLabel}
      </button>
      {data.allowFreeText && (
        <div className="csQuestionFree">
          <input
            value={freeText}
            placeholder="或输入自定义答案…"
            disabled={settled}
            onChange={event => { setFreeText(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter') submitFreeText() }}
          />
          <button type="button" disabled={settled} onClick={submitFreeText}>提交</button>
        </div>
      )}
      {settled && (
        <span className="csWorkflowState">
          {data.answer !== null ? `✓ 已选择：${data.answer}` : data.note}
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
        // CR-018：message.source 盲访问点——缺结构时直接不匹配，避免 TypeError
        // 阻断事件处理（与 asset-capture 的 tool/result 同一防御）。
        const source = (event.data as { message?: { source?: { callId?: unknown } } }).message?.source
        if (source === undefined || source === null || source.callId === undefined || source.callId === null) return null
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
