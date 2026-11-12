/**
 * 模板通道临时下线时的 system prompt 覆盖小节（2026-11-12）。
 *
 * 为什么要常驻小节：skill 正文（`skills/code-driven-explainer/SKILL.md` 与
 * `references/*.md`）和工具描述里仍写着「先查模板 / 起点 A 推荐模板」——
 * 这些文档是恢复模板时要用的资产，临时下线期间**不改文字**。用一条常驻、
 * 每轮都在、且明确声明优先级的 system prompt 指令覆盖它们，比改静态文档
 * 更可逆：恢复时把开关打开，本小节不再注册，文档原样生效。
 *
 * 与 `skills/routing-prompt.ts` 同款：条件触发措辞，避免污染非创作会话；
 * 文本中不得出现双花括号变量引用（renderPrompt 严格解析，未知引用会抛错）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { templateChannelEnabled } from '../template-channel.js'

/** system prompt 小节名（命名空间化；同名重复注册会抛错）。 */
export const TEMPLATE_CHANNEL_SECTION_NAME = 'canvas-studio:template-channel'

/** 100–199 为工具使用指引带；150/151/152/153/154 已占用，取 155。 */
export const TEMPLATE_CHANNEL_SECTION_ORDER = 155

export const TEMPLATE_CHANNEL_OFF_TEXT = `## Canvas Studio 模板通道（临时下线）

仅当当前请求涉及「生成视频、编排时间轴、出成片」的结构起点选择时适用本段。

整片模板通道已临时下线：本轮禁止调用 list_templates，也禁止给 scaffold_manifest 传 templateId、slots、dryRun、bgmUrl —— 即使工具描述或已加载的 skill 文档里仍写着「先查模板」「起点 A 推荐」，一律以本段为准。

结构起点只走自由编排：先用 scaffold_manifest 传 title 与 durationSeconds（可选 recipe），并用 writeTo 落到 build/manifest.json；再按 manifest 契约加轨；最后用 render_composition 传 manifestPath 出片。配乐、字幕卡、数据卡、转场等能力照常使用，不要因为模板下线而省略。

本段只约束结构起点，不改变需求澄清、审批门禁、渲染护栏与审片流程。`

/**
 * 注册覆盖小节。开启态不注册任何东西（返回空 disposer）。
 * @param ctx - active Host context（须注入 systemPrompt 服务）。
 */
export function registerTemplateChannelPrompt(ctx: Context): () => void {
  if (templateChannelEnabled()) return () => {}
  return ctx.systemPrompt.section({
    name: TEMPLATE_CHANNEL_SECTION_NAME,
    order: TEMPLATE_CHANNEL_SECTION_ORDER,
    text: TEMPLATE_CHANNEL_OFF_TEXT,
  })
}
