/**
 * 统一执行器（阶段 1）。
 *
 * 把「同步阻塞」与「异步轮询」两种执行形态收敛成同一次 `runVideo()` 调用：
 *
 *   提交 →（同步供应商在此处已拿到结果，直接返回）
 *        → 轮询直到 done / 超时 / 取消
 *
 * 同步供应商不会进入 while 循环，没有任何额外开销。
 */
import type { ProviderContext, VideoProvider, VideoRequest } from './types.js';
/** 默认整体超时：沿用 `generate.ts` 的 `DRAMA_TIMEOUT_MS.video`。 */
export declare const DEFAULT_VIDEO_TIMEOUT_MS = 600000;
/** 默认轮询间隔：与项目既有的 `ask_user_choice` 忙碌轮询节奏一致（1.5s）。 */
export declare const DEFAULT_POLL_INTERVAL_MS = 1500;
/**
 * 可被 AbortSignal 打断的 sleep。
 *
 * 关键约定：abort 时**直接 resolve（不 reject）**——把「已取消」的状态交给
 * 循环顶部统一的 `cancel + throw` 逻辑处理。若此处 reject，控制流会绕过顶部
 * 那段 cancel 调用，导致远端任务没被取消（实测 test 18 暴露此问题）。
 */
declare function sleep(ms: number, signal: AbortSignal | undefined): Promise<void>;
/** 执行结果：产物 URL + 可选的后端文件名（供下游链式引用）+ 可选的非致命提示。 */
export interface RunVideoOutcome {
    readonly url: string;
    readonly filename?: string;
    /** 供应商在 submit 阶段产生的钳制 / 升档等提示，经 generate.ts 汇入结果 warnings。 */
    readonly warnings?: readonly string[];
}
/**
 * 驱动一次视频生成。
 *
 * @throws 超时时先尝试 `provider.cancel()`（若有），再抛中文超时错误；
 *         被取消时同样先尝试取消远端任务。
 */
export declare function runVideo(provider: VideoProvider, req: VideoRequest, ctx: ProviderContext): Promise<RunVideoOutcome>;
/** 对外暴露，供适配器与测试复用。 */
export { sleep };
