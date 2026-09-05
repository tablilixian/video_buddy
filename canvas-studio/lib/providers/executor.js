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
/** 默认整体超时：沿用 `generate.ts` 的 `DRAMA_TIMEOUT_MS.video`。 */
export const DEFAULT_VIDEO_TIMEOUT_MS = 600_000;
/** 默认轮询间隔：与项目既有的 `ask_user_choice` 忙碌轮询节奏一致（1.5s）。 */
export const DEFAULT_POLL_INTERVAL_MS = 1500;
/**
 * 可被 AbortSignal 打断的 sleep。
 *
 * 关键约定：abort 时**直接 resolve（不 reject）**——把「已取消」的状态交给
 * 循环顶部统一的 `cancel + throw` 逻辑处理。若此处 reject，控制流会绕过顶部
 * 那段 cancel 调用，导致远端任务没被取消（实测 test 18 暴露此问题）。
 */
function sleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal?.aborted === true) {
            resolve();
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            if (signal !== undefined)
                signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        if (signal !== undefined && !signal.aborted) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}
/** 取出 AbortSignal 的中断原因，统一成 Error（reason 可能是任意值）。 */
function abortError(signal) {
    const reason = signal?.reason;
    return reason instanceof Error ? reason : new Error('生成已取消');
}
/** 把 handle.warnings 拼进产物（exactOptionalPropertyTypes：非空才落字段）。 */
function outcomeWith(base, handle) {
    if (handle.warnings !== undefined && handle.warnings.length > 0) {
        return { ...base, warnings: handle.warnings };
    }
    return base;
}
/**
 * 驱动一次视频生成。
 *
 * @throws 超时时先尝试 `provider.cancel()`（若有），再抛中文超时错误；
 *         被取消时同样先尝试取消远端任务。
 */
export async function runVideo(provider, req, ctx) {
    const handle = await provider.submit(req, ctx);
    // 同步供应商：submit 阶段即已 settled，无需轮询。
    if (handle.settled !== undefined) {
        ctx.onProgress?.(1);
        return outcomeWith(handle.settled.filename !== undefined
            ? { url: handle.settled.url, filename: handle.settled.filename }
            : { url: handle.settled.url }, handle);
    }
    const deadline = Date.now() + (ctx.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS);
    const interval = ctx.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    for (;;) {
        if (ctx.signal?.aborted === true) {
            await provider.cancel?.(handle, ctx).catch(() => { });
            throw abortError(ctx.signal);
        }
        if (Date.now() > deadline) {
            // 尽力取消远端任务，避免留下继续计费 / 占位的孤儿任务。
            await provider.cancel?.(handle, ctx).catch(() => { });
            // 至少显示 1 秒，避免 round(毫秒/1000) 在短超时时算出 0 秒。
            const seconds = Math.max(1, Math.round((ctx.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS) / 1000));
            throw new Error(`${provider.label} 生成超时（超过 ${seconds} 秒），已尝试取消任务`);
        }
        const polled = await provider.poll(handle, ctx);
        if (polled.done) {
            ctx.onProgress?.(1);
            return outcomeWith(polled.filename !== undefined ? { url: polled.url, filename: polled.filename } : { url: polled.url }, handle);
        }
        ctx.onProgress?.(polled.progress ?? 0, polled.stage);
        await sleep(interval, ctx.signal);
    }
}
/** 对外暴露，供适配器与测试复用。 */
export { sleep };
