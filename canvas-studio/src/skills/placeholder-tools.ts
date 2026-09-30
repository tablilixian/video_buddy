/**
 * Canvas Studio placeholder tool for MiniMax-H3 upstream skill capabilities
 * that this plugin does not actually provide (no subtitle burn-in).
 *
 * These tools exist so the agent can follow the verbatim upstream skill
 * workflow end to end without hitting "tool not found": each placeholder
 * returns an actionable Chinese fallback path instead of an error, so the
 * agent keeps going (e.g. 字幕→write_script 文案节点 + H3 提示词处理).
 *
 * CV-125：`music_generation` 已转正（Drama txt2audio，见 host-tools.ts）。
 * CV-271：`tts_voiceover` 已转正（Drama txt2speech / VoxCPM2，见 host-tools.ts）
 * —— 占位工具只剩 subtitle_burn 一个。
 *
 * Pilot scope is driven by `3d-animation-short-generator`:
 * - 硬字幕烧录（**CV-213 默认禁止**，用户明确要求时）→ subtitle_burn
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 把占位结果渲染成模型可读的文本块。 */
function renderText(_args: unknown, value: unknown): ContentBlock[] {
  // CR-035：防御性取 text——上游 render 传入形状不符时兜底为空串，不产出 undefined 块。
  const v = value as { text?: unknown } | null | undefined
  const text = typeof v?.text === 'string' ? v.text : ''
  return [{ type: 'text', text }]
}

/**
 * 创建占位工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 * 每个工具不调用任何生成后端，只返回能力边界说明与替代路径。
 */
export function createPlaceholderTools() {
  return [
    defineTool({
      name: 'subtitle_burn',
      description:
        '占位工具（canvas-studio 当前无硬字幕烧录能力）。⚠️ **CV-213 不自动生成字幕**：画布视频生成流程**默认不会为成片添加字幕 / 字幕条 / 字幕层**——没有用户显式要求时，调用本工具即被认为违反自动字幕禁令。仅当用户**明确**要求「字幕 / subtitle / 烧录 / 时间轴字幕」时调用本工具以取替代路径指引；其它情况请直接忽略该工具的存在。',
      parameters: {
        text: { type: 'string' as const, required: true, description: '要烧录的字幕/文字内容' },
        language: { type: 'string' as const, description: '语言（如 中文/English）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: { text: { type: 'string' as const, description: '能力边界说明与替代路径' } },
        },
        render: renderText,
      },
      async execute(args) {
        const a = args as { text: string; language?: string }
        return {
          text: `canvas-studio 无硬字幕烧录能力，无法把「${a.text}」${a.language ? `（${a.language}）` : ''}烧进画面（CV-213：默认不开字幕；如需字幕请用户显式确认）。替代路径：1) 用 write_script 把字幕文本落到画布「文案」节点，成片详情页展示（不烧录）；2) 若必须画面内文字，在视频 H3 提示词的画面描述中用英文双引号逐字给出（如 A red neon sign reading "营业中" glows above the doorway），由视频模型生成画面文字——画面文字是「画内元素」不是字幕；3) 需要精确时间轴字幕则请用户自备含字幕素材。`,
        }
      },
    }),
  ]
}
