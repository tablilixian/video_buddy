/**
 * 视频生成供应商抽象层 —— 契约定义（阶段 1）。
 *
 * 目标：把「视频生成」从单一 Drama Backend 解耦成「能力路由 + 供应商适配器」，
 * 使新增模型（如 fal 的 MiniMax H3）只需新增一个适配器文件，不再改动
 * `generate.ts` 的主流程。
 *
 * 核心设计：**同步与异步执行形态的差异完全封装在适配器内部**。
 * - 同步供应商（Drama）：`submit()` 内部一次请求等到底，结果放进
 *   `handle.settled`，`poll()` 首次即返回 done，零额外开销。
 * - 异步供应商（fal，队列三段式）：`submit()` 返回 request_id，
 *   `poll()` 反复查询直到 done。
 *
 * 上层（executor）只认 `submit()` + `poll()` 两段，对两者一视同仁。
 *
 * 本阶段只落地契约与注册表骨架，**不接入任何调用方**。
 * 方案文档：docs/plans/video-provider-abstraction.md
 */
/** 视频生成能力。新增能力需同步更新参数映射矩阵与注册表自述。 */
export type VideoCapability = 
/** 纯提示词出片（无参考图）。 */
'text-to-video'
/** 首帧图生视频 / 首尾帧插值。 */
 | 'first-last-frame'
/** 多参考图生成（角色、风格一致性）。 */
 | 'multi-reference';
/** 已接入的供应商标识。 */
export type VideoProviderId = 'drama' | 'fal';
/** 归一化画幅。 */
export type VideoAspectRatio = '16:9' | '9:16' | '1:1';
/**
 * 分辨率档位。源自 `GenerateParams.resolution`——该参数在 Drama 侧是占坑
 * （传入无效并回 warning），fal 接入后才真正生效（见文档 §5.3 映射）。
 */
export type VideoResolution = '768p' | '1080p' | '720p' | '2k';
/**
 * 参考素材：已解析为**本地绝对路径**，由适配器自行决定转成何种形态
 * （Drama 用服务器 filename 句柄，fal 用 base64 data URI）。
 */
export interface VideoReference {
    readonly localPath: string;
    /** 顺序语义：多参考场景下按「第 N 张」与提示词中的引用对应。 */
    readonly index: number;
}
/** 归一化后的视频生成请求：与供应商无关的中间表示。 */
export interface VideoRequest {
    readonly capability: VideoCapability;
    readonly prompt: string;
    /** 秒。已按工具默认值归一，最终由各适配器按自身能力再钳制一次。 */
    readonly duration: number;
    readonly aspectRatio: VideoAspectRatio;
    readonly resolution?: VideoResolution;
    readonly references: readonly VideoReference[];
}
/** 供应商回传的产物。filename 供下游工具链式引用（目前仅 Drama 会返回）。 */
export interface ProviderSettled {
    readonly url: string;
    readonly filename?: string;
}
/**
 * 供应商句柄。刻意保持可 JSON 序列化，以便后续写进节点元数据支持断点续查。
 * 同步供应商在 `submit` 阶段即填充 `settled`。
 */
export interface ProviderHandle {
    /** 供应商内部标识：fal 存请求基址 URL（status/result/cancel 均由它派生）；Drama 存产物 URL。 */
    readonly token: string;
    readonly settled?: ProviderSettled;
    /**
     * 非致命提示（如参数钳制、分辨率升档），submit 阶段产生，经 executor 汇入
     * 生成结果的 warnings 通道回流给 agent。不改变成败语义。
     */
    readonly warnings?: readonly string[];
}
/** 一次 poll 的结果。未完成时携带可选进度（0–1）与阶段说明。 */
export type ProviderPoll = {
    readonly done: true;
    readonly url: string;
    readonly filename?: string;
} | {
    readonly done: false;
    readonly progress?: number;
    readonly stage?: string;
};
/** 执行上下文：取消信号、进度回调与轮询参数。不进请求体。 */
export interface ProviderContext {
    readonly signal?: AbortSignal;
    /** 0–1 进度；同步供应商可只回调一次 1。 */
    readonly onProgress?: (progress: number, stage?: string) => void;
    /** 单次 poll 间隔（毫秒），默认见 executor 的 DEFAULT_POLL_INTERVAL_MS。 */
    readonly pollIntervalMs?: number;
    /** 整体超时（毫秒），默认见 executor 的 DEFAULT_VIDEO_TIMEOUT_MS。 */
    readonly timeoutMs?: number;
    /**
     * **Drama 专用**：带参考图失效自愈的同步 POST（仅 Drama adapter 使用）。
     *
     * 自愈闭包依赖当前 `generateAsset` 调用的 `registry`/`projectId`/`params`，无法在
     * adapter 内构造，故由 generate.ts 在每次调用时注入。`kind` 取值 `'image' | 'video' | 'text'`
     *（与 `DRAMA_TIMEOUT_MS` 的键一致）。详见方案文档 §6 阶段 2。
     */
    readonly dramaPostWithFallback?: (endpoint: string, body: Record<string, unknown>, kind: 'image' | 'video' | 'text') => Promise<{
        url: string;
        filename?: string;
    }>;
    /**
     * **fal 专用**：解析 fal API Key（仅 fal adapter 使用）。由 generate.ts 每次
     * 调用时注入（与 dramaPostWithFallback 同一注入模式，规避 adapter 直连
     * generate.ts runtime() 的循环依赖）。未配置（空串）时 adapter 抛中文错误。
     */
    readonly falApiKey?: () => Promise<string>;
    /**
     * **fal 专用**：把请求中的参考素材（Drama filename 句柄）读为本地字节。
     * 闭包依赖当前调用的 registry/projectId，无法在 adapter 内构造，故注入。
     * fal 不认 Drama 的服务器文件名，必须把字节转成 base64 data URI 内联。
     */
    readonly readReferenceBytes?: (ref: VideoReference) => Promise<{
        bytes: Uint8Array;
        ext: string;
    }>;
}
/** 视频供应商适配器。新增供应商 = 新增一个本接口的实现。 */
export interface VideoProvider {
    readonly id: VideoProviderId;
    /** 展示名，用于错误文案与设置页。 */
    readonly label: string;
    /** 自述能力：注册表据此路由，不可路由时报明确错误。 */
    readonly capabilities: ReadonlySet<VideoCapability>;
    /**
     * 多参考图上限。Drama 的 REF2VA 为 6，fal 的 reference-to-video 为 9。
     * 由适配器自述，`generate.ts` 不再硬编码 `sliceToMax(filenames, 6)`。
     */
    readonly maxReferences: number;
    /** 提交一次生成。同步实现直接把结果放进 `handle.settled`。 */
    submit(req: VideoRequest, ctx: ProviderContext): Promise<ProviderHandle>;
    /** 查询句柄。`handle.settled` 存在时应直接返回 done。 */
    poll(handle: ProviderHandle, ctx: ProviderContext): Promise<ProviderPoll>;
    /** 可选。异步供应商应实现，用于取消排队中 / 进行中的任务。 */
    cancel?(handle: ProviderHandle, ctx: ProviderContext): Promise<void>;
}
