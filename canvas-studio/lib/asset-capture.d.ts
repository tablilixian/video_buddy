/**
 * P4+ 画布产物捕获：conversationEvents 节点 definition 工厂（纯副作用）。
 *
 * 放在 src/ 顶层（非 src/client/）：Host 侧 tsc 会编译出 lib/asset-capture.js，
 * 供 Node 冒烟测试直连；客户端 bundle（tsdown）也引用同一份源码。本模块**只**
 * 含 dsh-llm 的 type-only 导入（Host 侧编译安全），不引入 dsh-client-runtime
 * 类型 —— 那会把客户端运行时类型图拖进 Host tsc，触发上游 .d.ts 的模块合并
 * 冲突。definition 用本地结构类型描述，注册时由结构兼容匹配框架契约。
 *
 * 接线模型：agent 调用画布三工具后，会话 surface 依次产生 tool/call 与
 * tool/result。客户端注册一个「副作用型」conversationEvents 节点 definition：
 * - match：画布工具的 tool/call（start）；任意画布工具相关的 tool/result
 *   （update）。不再要求 surfaceOp==='append'（重载幂等，重复无害）。
 * - start：记录工具名，并从 tool/call 参数抽取参考图 URL（video_generate /
 *   video_composite 的 imageUrl）；该参考图用于血缘，但血缘真正的写入由 Host
 *   在落盘时完成（见 generate.ts 的 appendCanvasNode）。
 * - update：在选中项目时调用 hooks.reloadCanvas —— 生成产物的节点由 Host 写入
 *   canvas.json（单一真相源），客户端从这里重载，彻底摆脱对「解析会话事件渲染
 *   文本里的 URL」这一脆弱路径的依赖（后端异常 / 渲染差异时不可靠）。
 * - buildViewNode：恒返回 null —— 对话里的工具卡片渲染仍由内置 tool-call
 *   节点负责，本节点不重复渲染。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
/**
 * 画布媒体工具名 → 产物类型。
 *
 * ⚠️ **这是「工具能否上画布」的唯一白名单**：不在表里的工具，`tool/call` 不会
 * 产生 start，于是它的 `tool/result` 在 conversationEvents 里找不到挂载点，
 * `reloadCanvas` 永不触发 —— **产物已经落盘，画布却要切窗口才刷新**。
 * 新增任何「会 appendCanvasNode 的工具」必须同时在此登记（CV-130 就踩过
 * music_generation 漏登记的坑），`tests/asset-capture.test.mjs` 有对应用例。
 */
export declare const STUDIO_TOOL_KINDS: Readonly<Record<string, 'image' | 'video' | 'audio'>>;
/** 判断工具名是否属于画布媒体工具。 */
export declare function isStudioTool(name: string): name is keyof typeof STUDIO_TOOL_KINDS;
/**
 * P7 工作流工具：结果会改变审批门禁状态 / 落分镜表节点 / 弹出点选问题。
 * 它们不产生媒体产物（不放占位节点），但 tool/call 与 tool/result 后客户端
 * 必须刷新工作流状态与画布，否则审批条与点选卡片永远不出现。
 */
export declare const WORKFLOW_TOOLS: ReadonlySet<string>;
/**
 * 从 tool/result 的内容块中抽取托管 URL。
 * Host 的 renderResult 产出形如 `已生成产物: <url> (WxH...)` 的文本块，产物
 * 是完整 http(s) URL，正则可稳定提取。
 */
export declare function extractAssetUrl(blocks: readonly ContentBlock[] | undefined): string | null;
/** 一条被捕获的画布资产（写入 store 前的形态）。 */
export interface StudioCaptureAsset {
    /** 托管产物 URL。 */
    url: string;
    /** 产物类型（image / video / audio）。 */
    kind: 'image' | 'video' | 'audio';
    /** 产生该资产的工具名。 */
    toolName: string;
    /** 对应 tool/call 事件 id（血缘 / 重试锚点）。 */
    runId: string;
    /** 参考图 URL（image_generate 产物的 URL）；用于反向查找源节点做血缘链接。 */
    sourceUrl?: string;
    /** 创建时间（epoch millis）。 */
    createdAt: number;
}
/** 一次工具调用的身份与参数（用于画布占位节点）。 */
export interface StudioToolCallInfo {
    /** 工具名（image_generate / video_generate / video_composite）。 */
    toolName: string;
    /** 对应 tool/call 事件 id。 */
    runId: string;
    /** 产物类型。 */
    kind: 'image' | 'video' | 'audio';
    /** 工具参数（原始 JSON 字符串，节点 generationPrompt 的来源）。 */
    arguments?: string;
}
/** definition 与目标项目画布之间的接线点（React 之外调用）。 */
export interface AssetCaptureHooks {
    /**
     * 重新载入某项目的画布节点。生成产物的节点由 Host 在落盘时写入
     * `canvas.json`（单一真相源），此处只触发客户端重载，避免依赖对会话事件
     * 渲染文本的脆弱 URL 解析。
     */
    reloadCanvas(projectId: string): void;
    /** 当前画布绑定的项目 id；未绑定任何项目时返回 null。 */
    getSelectedProjectId(): string | null;
    /**
     * 工具调用开始：在画布上放置一个「生成中」占位节点（client 侧瞬态，
     * 不持久化；产物落盘后由重载替换，失败时标记错误）。
     */
    onToolCall?(projectId: string, info: StudioToolCallInfo): void;
    /** 工具调用失败：占位节点标记错误（tool/result 的 data.error）。 */
    onToolError?(projectId: string, runId: string, message: string): void;
    /**
     * P7 工作流工具结算回调（成功或失败都触发）：客户端借此刷新工作流状态
     * （审批条显隐）并重载画布（分镜表文本节点落盘）。
     */
    onToolFinished?(projectId: string, toolName: string): void;
    /**
     * P7 工作流工具开始回调：ask_user_choice 在 execute 一开始就写入待回答
     * 问题，客户端延迟刷新一两次才能把点选卡片拉出来（事件先于写盘到达时
     * 单次刷新会扑空）。
     */
    onWorkflowToolStarted?(projectId: string, toolName: string): void;
}
/** definition 自身维护的节点状态：记录发起调用的工具名与参考图 URL。 */
export interface AssetCaptureState {
    toolName: string;
    /** 参考图 URL；空串表示无参考图（image_generate）。 */
    sourceUrl: string;
    /** 产物类型；workflow 表示 P7 工作流工具（无媒体产物）。 */
    kind: 'image' | 'video' | 'audio' | 'workflow';
}
/**
 * conversationEvents 契约的本地结构投影（注册时由结构类型兼容自动匹配
 * ConversationNodeDefinition，无需在 Host 侧引入框架类型）。
 */
/** 本 definition 关心的会话事件最小形态（data 在运行时按 type 收窄）。 */
export interface StudioCaptureEvent {
    readonly type: string;
    readonly data: unknown;
    surfaceOp?: unknown;
}
/** match 的返回：本 definition 的事件身份与生命周期角色。 */
export interface StudioCaptureMatchResult {
    readonly id: string;
    readonly role: 'start' | 'update';
}
/** 被本 definition 接受的 start/update 事件（含事件原文，便于读取 data）。 */
export interface StudioCaptureMatch {
    readonly event: StudioCaptureEvent;
    readonly role: 'start' | 'update';
}
/** 本 definition 产出的节点定义（与 ConversationNodeDefinition 结构兼容）。 */
export interface StudioCaptureDefinition {
    readonly kind: string;
    readonly target: string;
    match(event: StudioCaptureEvent): StudioCaptureMatchResult | null;
    start(context: unknown, match: StudioCaptureMatch): AssetCaptureState;
    /**
     * context 参数放宽为 { state: unknown }：注册端（ConversationNodeDefinition<unknown>）
     * 的 update 上下文 state 是 unknown，收窄后在内部使用，保证逆变兼容。
     */
    update(context: {
        state: unknown;
    }, match: StudioCaptureMatch): AssetCaptureState;
    buildViewNode(): null;
}
/**
 * 创建 P4 的 conversationEvents 节点 definition。
 * @param hooks - 与画布 store 的接线（React 之外）。
 * @returns 节点 definition，供 `ctx.conversationEvents.register` 注册。
 */
export declare function createAssetCaptureDefinition(hooks: AssetCaptureHooks): StudioCaptureDefinition;
