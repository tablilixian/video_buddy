/**
 * CV-114：画布素材接入聊天输入框的引用管线。
 *
 * 两件事，都只碰**公开服务名**（运行时 `ctx.get` 惰性取，不写进 `inject`——
 * 声明 `conversation` 会让依赖图成环，见 client/index.ts 顶部注释）：
 *
 * 1. `registerCanvasAssetSource`：向上游 `@` 触发管线注册「画布素材」候选源，
 *    于是在输入框打 `@` 能搜到画布素材并选中插入 chip；
 * 2. `insertAssetChip`：右键 / 参考托盘 / 详情面板的「引用到对话」直接插入
 *    **同一种 chip**（走 `conversation.input.shell(id).insertReference`），
 *    与打 `@` 选中产生的东西完全一致。
 *
 * 上游类型面刻意不引入依赖，只本地收窄成最小结构（runtime facade）：
 * 拿不到服务或签名漂移时静默失败，调用方降级回纯文本注入，行为不退化。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { AssetHandle } from '../reference-handle.js';
/**
 * 触发源名字（occurrence 的 source，也是提交时序列化器的路由键）。
 * 改名会让已插入但未发送的 chip 失去 owner → 渲染成 invalid，勿动。
 */
export declare const CANVAS_ASSET_SOURCE = "canvas-asset";
/** 当前会话 id 的解析（由 apply 世界注入，避免本模块依赖 sessions 服务）。 */
export interface CanvasAssetSourceDeps {
    /** 当前项目可引用素材（每次调用读最新快照）。 */
    assets(): readonly AssetHandle[];
    /** 当前会话 id；无会话时返回 undefined。 */
    sessionId(): string | undefined;
}
/**
 * 注册 `@` 画布素材源。
 * @returns disposer；上游服务不可用时返回 null（调用方照旧，不注册）。
 */
export declare function registerCanvasAssetSource(ctx: ClientContext, deps: CanvasAssetSourceDeps): (() => void) | null;
/**
 * 等服务就绪后注册 `@` 画布素材源（调用方唯一入口）。
 *
 * 为什么不能直接在 apply 里 `ctx.get('inputTriggers')`：服务读取要求提供方的
 * fiber 已 ACTIVE，而 canvas-studio 的 client apply 常常跑在 ui-input-trigger
 * 之前（roster 顺序 + 我们没声明该依赖）→ 那一刻 get 恒为 undefined，注册被
 * 静默跳过，@ 菜单里自然没有画布素材分组。上游 ui-reference 就是靠静态声明
 * `inject: ['inputTriggers']` 规避的，这里用等价的运行时写法 `ctx.inject`，
 * 服务一到就注册；再加一次延时兜底，任何一环失灵都能在控制台看到原因。
 */
export declare function registerCanvasAssetSourceWhenReady(ctx: ClientContext, deps: CanvasAssetSourceDeps): void;
/**
 * 把一个画布素材作为**真 chip** 插入当前会话的输入框。
 *
 * 走 `conversation.input.shell(id).insertReference`：与用户在输入框打 `@`
 * 选中候选走的是同一条通路，因此产物（occurrence chip）完全一致。
 * 上游服务缺失 / 会话未绑定 / draftRev CAS 失败 → 返回 false，调用方降级。
 */
export declare function insertAssetChip(ctx: ClientContext, sessionId: string | undefined, asset: AssetHandle): boolean;
