/**
 * SK-01：把「创作任务必须先加载创作总纲」从 skill description 的软性祈使句
 * 升级为系统提示词里的常驻硬指令。
 *
 * 背景：CV-094 复盘一场会话发现，模型先凭直觉追问了三轮（主题 / 时长+画幅 /
 * 自造风格选项）才加载 `canvas-studio-creation`，导致风格题自造、风格 skill
 * 全程未加载。CV-094 当时只改了总纲的 frontmatter description（即 skill-catalog
 * 里那一行摘要），靠模型自觉——它能生效，但存在两个不受控点：
 *   1. catalog 摘要只是「技能广告位」，模型是否优先读它取决于自身策略；
 *   2. description 有长度上限（见 {@link DESCRIPTION_LIMIT}），硬指令会挤占
 *      本该用于「路由匹配」的负向路由语。
 *
 * 本模块改为在 system prompt 里注册一个常驻小节，位于每轮上下文前缀：
 *   - 位置稳定 → 不随 skill 加载状态变化，每轮都在；
 *   - 与 catalog 解耦 → 不占 description 配额，硬指令与路由语各司其职。
 *
 * 指令写成**条件触发**（仅创作类请求生效）而非无条件 persona，因为
 * canvas-studio 由 bundle patch 在插件列表顶层插入（cordis.patch.yml），
 * 属于全局激活插件，其 system prompt 小节会注入到所有会话。条件式措辞
 * 使非创作会话自动跳过本段，不会污染其它用途。
 *
 * 注意：文本中不得出现 `{{variable}}`——renderPrompt 对变量引用是严格的，
 * 未知引用会直接抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** 创作总纲的注册名（同 `skills/canvas-studio-creation/` 目录名）。 */
export const CREATION_SKILL_NAME = 'canvas-studio-creation'

/**
 * system prompt 小节名。命名空间化以防与 harness / 其它插件冲突；
 * `SystemPrompt.section()` 对同名重复注册会直接抛错。
 */
export const SKILL_ROUTING_SECTION_NAME = 'canvas-studio:skill-routing'

/**
 * 小节顺序。约定见 `@deepseek-ai/dsh-system-prompt`：-100 为 harness 身份、
 * 0 为部署 persona、100–199 为工具使用指引。本段属于「工具调用顺序」指引，
 * 取 150（留出上下空间供后续插入更前置/更后置的指引）。
 */
export const SKILL_ROUTING_SECTION_ORDER = 150

/**
 * 创作任务路由指令正文。
 *
 * 三条硬要求：① 创作任务的第一个动作是加载总纲；② 严格先于一切提问与工具
 * 调用；③ 已即兴流程则中止并重走。外加一条降级条款（加载失败两次就声明并
 * 继续），避免模型卡在重试里。
 */
export const SKILL_ROUTING_SECTION_TEXT = `## Canvas Studio 创作任务路由（条件触发）

仅当当前请求涉及「生成图片或视频、分镜规划、AI 短片 / 漫剧创作」时适用本段；其它请求请完全忽略。

此类任务的**第一个动作必须是调用 skill(name="${CREATION_SKILL_NAME}") 加载创作规范**——严格先于一切提问（ask_user_choice）与任何工具调用。禁止凭直觉先行澄清需求，也禁止先动手生成。

必须先加载它，因为它规定了：需求澄清的顺序与要素、分镜审批门禁、以及用户选定的视觉风格如何映射到具体风格 skill——跳过它做出的澄清一定是不合规的。

- 若你在读到本段之前已经提问或调用过工具：立即停止当前即兴流程，向用户说明「已加载创作规范，按规范重走需求澄清」，然后从该规范的需求澄清重新开始。
- 若加载失败：重试一次；两次仍失败，则向用户声明「未按原版 skill 细节执行」，并按你已知的最佳流程继续，不要卡住。

本段只约束创作任务的执行顺序，不改变你的身份、语气与能力范围。`

/**
 * 注册创作任务路由小节。
 * @param ctx - active Host context（须注入 `systemPrompt` 服务）。
 * @returns the disposer that removes the section.
 */
export function registerSkillRoutingPrompt(ctx: Context): () => void {
  return ctx.systemPrompt.section({
    name: SKILL_ROUTING_SECTION_NAME,
    order: SKILL_ROUTING_SECTION_ORDER,
    text: SKILL_ROUTING_SECTION_TEXT,
  })
}
