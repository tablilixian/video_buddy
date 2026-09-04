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
import type { Context } from '@deepseek-ai/cordis';
/** 创作总纲的注册名（同 `skills/canvas-studio-creation/` 目录名）。 */
export declare const CREATION_SKILL_NAME = "canvas-studio-creation";
/**
 * system prompt 小节名。命名空间化以防与 harness / 其它插件冲突；
 * `SystemPrompt.section()` 对同名重复注册会直接抛错。
 */
export declare const SKILL_ROUTING_SECTION_NAME = "canvas-studio:skill-routing";
/**
 * 小节顺序。约定见 `@deepseek-ai/dsh-system-prompt`：-100 为 harness 身份、
 * 0 为部署 persona、100–199 为工具使用指引。本段属于「工具调用顺序」指引，
 * 取 150（留出上下空间供后续插入更前置/更后置的指引）。
 */
export declare const SKILL_ROUTING_SECTION_ORDER = 150;
/**
 * 创作任务路由指令正文。
 *
 * 三条硬要求：① 创作任务的第一个动作是加载总纲；② 严格先于一切提问与工具
 * 调用；③ 已即兴流程则中止并重走。外加一条降级条款（加载失败两次就声明并
 * 继续），避免模型卡在重试里。
 */
export declare const SKILL_ROUTING_SECTION_TEXT = "## Canvas Studio \u521B\u4F5C\u4EFB\u52A1\u8DEF\u7531\uFF08\u6761\u4EF6\u89E6\u53D1\uFF09\n\n\u4EC5\u5F53\u5F53\u524D\u8BF7\u6C42\u6D89\u53CA\u300C\u751F\u6210\u56FE\u7247\u6216\u89C6\u9891\u3001\u5206\u955C\u89C4\u5212\u3001AI \u77ED\u7247 / \u6F2B\u5267\u521B\u4F5C\u300D\u65F6\u9002\u7528\u672C\u6BB5\uFF1B\u5176\u5B83\u8BF7\u6C42\u8BF7\u5B8C\u5168\u5FFD\u7565\u3002\n\n\u6B64\u7C7B\u4EFB\u52A1\u7684**\u7B2C\u4E00\u4E2A\u52A8\u4F5C\u5FC5\u987B\u662F\u8C03\u7528 skill(name=\"canvas-studio-creation\") \u52A0\u8F7D\u521B\u4F5C\u89C4\u8303**\u2014\u2014\u4E25\u683C\u5148\u4E8E\u4E00\u5207\u63D0\u95EE\uFF08ask_user_choice\uFF09\u4E0E\u4EFB\u4F55\u5DE5\u5177\u8C03\u7528\u3002\u7981\u6B62\u51ED\u76F4\u89C9\u5148\u884C\u6F84\u6E05\u9700\u6C42\uFF0C\u4E5F\u7981\u6B62\u5148\u52A8\u624B\u751F\u6210\u3002\n\n\u5FC5\u987B\u5148\u52A0\u8F7D\u5B83\uFF0C\u56E0\u4E3A\u5B83\u89C4\u5B9A\u4E86\uFF1A\u9700\u6C42\u6F84\u6E05\u7684\u987A\u5E8F\u4E0E\u8981\u7D20\u3001\u5206\u955C\u5BA1\u6279\u95E8\u7981\u3001\u4EE5\u53CA\u7528\u6237\u9009\u5B9A\u7684\u89C6\u89C9\u98CE\u683C\u5982\u4F55\u6620\u5C04\u5230\u5177\u4F53\u98CE\u683C skill\u2014\u2014\u8DF3\u8FC7\u5B83\u505A\u51FA\u7684\u6F84\u6E05\u4E00\u5B9A\u662F\u4E0D\u5408\u89C4\u7684\u3002\n\n- \u82E5\u4F60\u5728\u8BFB\u5230\u672C\u6BB5\u4E4B\u524D\u5DF2\u7ECF\u63D0\u95EE\u6216\u8C03\u7528\u8FC7\u5DE5\u5177\uFF1A\u7ACB\u5373\u505C\u6B62\u5F53\u524D\u5373\u5174\u6D41\u7A0B\uFF0C\u5411\u7528\u6237\u8BF4\u660E\u300C\u5DF2\u52A0\u8F7D\u521B\u4F5C\u89C4\u8303\uFF0C\u6309\u89C4\u8303\u91CD\u8D70\u9700\u6C42\u6F84\u6E05\u300D\uFF0C\u7136\u540E\u4ECE\u8BE5\u89C4\u8303\u7684\u9700\u6C42\u6F84\u6E05\u91CD\u65B0\u5F00\u59CB\u3002\n- \u82E5\u52A0\u8F7D\u5931\u8D25\uFF1A\u91CD\u8BD5\u4E00\u6B21\uFF1B\u4E24\u6B21\u4ECD\u5931\u8D25\uFF0C\u5219\u5411\u7528\u6237\u58F0\u660E\u300C\u672A\u6309\u539F\u7248 skill \u7EC6\u8282\u6267\u884C\u300D\uFF0C\u5E76\u6309\u4F60\u5DF2\u77E5\u7684\u6700\u4F73\u6D41\u7A0B\u7EE7\u7EED\uFF0C\u4E0D\u8981\u5361\u4F4F\u3002\n\n\u672C\u6BB5\u53EA\u7EA6\u675F\u521B\u4F5C\u4EFB\u52A1\u7684\u6267\u884C\u987A\u5E8F\uFF0C\u4E0D\u6539\u53D8\u4F60\u7684\u8EAB\u4EFD\u3001\u8BED\u6C14\u4E0E\u80FD\u529B\u8303\u56F4\u3002";
/**
 * 注册创作任务路由小节。
 * @param ctx - active Host context（须注入 `systemPrompt` 服务）。
 * @returns the disposer that removes the section.
 */
export declare function registerSkillRoutingPrompt(ctx: Context): () => void;
