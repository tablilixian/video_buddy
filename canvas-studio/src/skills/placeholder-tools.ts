/**
 * Canvas Studio placeholder tools for MiniMax-H3 upstream skill capabilities
 * that this plugin does not actually provide (no music generation, no TTS, no
 * subtitle burn-in).
 *
 * These tools exist so the agent can follow the verbatim upstream skill
 * workflow end to end without hitting "tool not found": each placeholder
 * returns an actionable Chinese fallback path instead of an error, so the
 * agent keeps going (e.g. BGM → user-provided node + compose_video bgmNodeId).
 *
 * Pilot scope is driven by `3d-animation-short-generator`:
 * - BGM 生成（STEP 8 明确要求）→ music_generation
 * - 旁白配音（音频轨可选）→ tts_voiceover
 * - 硬字幕烧录（默认禁止，用户要求时）→ subtitle_burn
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
      name: 'music_generation',
      description:
        '占位工具（canvas-studio 当前无音乐生成能力）：返回 BGM 的替代路径指引。当上游 skill 流程要求「生成一条连续 BGM」时调用，不要报错或跳过整个流程。注意：上游 skill（如 minimalist-product-ad-generator）中出现的 `music-2.6` 即本占位工具（music_generation），不是独立工具。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: 'BGM 描述（情绪/节奏/乐器/时长要求）' },
        duration: { type: 'number' as const, description: '期望时长（秒）' },
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
        const a = args as { prompt: string; duration?: number }
        const duration = a.duration !== undefined ? `（约 ${a.duration}s）` : ''
        return {
          text: `canvas-studio 无音乐生成能力，无法按「${a.prompt}」${duration}自动作曲。替代路径：1) 请引导用户上传 BGM 音频/视频到画布（时间轴出现该节点）；2) 成片合成时调 compose_video 并传 bgmNodeId=该 BGM 节点 id；3) 把 BGM 的乐器/速度/强弱变化写进各镜头 H3 提示词的 non_diegetic_music 字段（不要写情绪形容词），并把 BGM 说明写入 write_script 文案节点。在项目简报/回复中向用户说明此限制。`,
        }
      },
    }),
    defineTool({
      name: 'tts_voiceover',
      description:
        '占位工具（canvas-studio 当前无语音合成/TTS 能力）：返回旁白配音的替代路径指引。当上游 skill 流程要求生成旁白/对白音频时调用，不要报错。',
      parameters: {
        text: { type: 'string' as const, required: true, description: '要配音的旁白/对白文本' },
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
          text: `canvas-studio 无语音合成（TTS）能力，无法为「${a.text}」${a.language ? `（${a.language}）` : ''}生成配音音频。替代路径：1) 用 write_script 把该旁白/对白逐字落到画布「文案」节点（不烧录、不生成音频）；2) 各镜头 H3 提示词中，离屏旁白用 says in an off-screen voiceover 并紧跟 while his lips remain completely closed，面对白用 <d>[语言]原话</d> 逐字保留、标记 mouth-open；3) 如需真实配音音频，请用户自备或后续接入 TTS 能力。`,
        }
      },
    }),
    defineTool({
      name: 'subtitle_burn',
      description:
        '占位工具（canvas-studio 当前无硬字幕烧录能力）：返回字幕的替代路径指引。当用户明确要求画面内硬字幕/烧录文字时调用。',
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
          text: `canvas-studio 无硬字幕烧录能力，无法把「${a.text}」${a.language ? `（${a.language}）` : ''}烧进画面。替代路径：1) 用 write_script 把字幕文本落到画布「文案」节点，成片详情页展示（不烧录）；2) 若必须画面内文字，在视频 H3 提示词的画面描述中用英文双引号逐字给出（如 A red neon sign reading "营业中" glows above the doorway），由视频模型生成画面文字；3) 需要精确时间轴字幕则请用户自备含字幕素材。`,
        }
      },
    }),
  ]
}
