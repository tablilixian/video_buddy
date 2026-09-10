/**
 * 长请求传输层（CV-135）：为**单次** HTTP 请求抬高 Node 内置 fetch 的隐形超时上限。
 *
 * ## 问题（CV-133 P0）
 * Node 的全局 `fetch` 由内置 undici 提供，其 dispatcher 默认
 * **`headersTimeout = bodyTimeout = 300s`**，且**先于我们自己的 AbortSignal 触发**。
 * Drama 后端是「同步阻塞式」生成（一次 POST 等到出片），10s 视频的推理需 5 分钟
 * 以上 → 响应头必然晚于 300s 到达 → 请求在 ~301s 被掐断（`UND_ERR_HEADERS_TIMEOUT`）。
 * 后果：`generate.ts` 的 `DRAMA_TIMEOUT_MS`（image=360s / video=600s）**两档都不可达**，
 * 有效上限恒 300s 且报错误导。实测复现：`scripts/undici-timeout-repro.mjs`
 * （传 `AbortSignal.timeout(900_000)` 仍在 301.166s 被掐）。
 *
 * ## 方案取舍（三选一，2026-09-10 定稿）
 * ① 引入 `undici` 依赖自建 Agent —— 会被打进 Electron 插件产物，代价最大；
 * ② 改走 `node:http` —— 零依赖，但要替换全仓 fetch 调用；而 fetch **同时是我们的
 *    测试缝**（10 个测试文件打桩 `globalThis.fetch`），替换即让它们集体失效；
 * ③ **本方案：按请求传 dispatcher** —— Node 的 fetch 接受非标准 `init.dispatcher`，
 *    为单次请求指定一个超时更长的 Agent。既不用引依赖，也不动全局
 *    （健康探针 / 资产下载 / fal 供应商全部不受影响），而且**仍然是调用
 *    `globalThis.fetch`** → 现有 fetch 打桩测试零改动。
 *
 * 实测确认（本机 loopback，见 `tests/long-request.test.mjs`）：
 * 传入收紧到 1s 的 dispatcher → 3s 才发响应头的请求在 1.5s 被掐；不传的对照请求
 * 正常成功 → 该参数确实生效且无全局副作用。
 *
 * ## 为什么能拿到 Agent 构造器
 * Node 不暴露 undici 模块（`import('undici')` → `ERR_MODULE_NOT_FOUND`），但 fetch
 * 使用的全局 dispatcher 挂在 well-known symbol 上，可借它的 `constructor` 造同款实例。
 * 该 symbol 属 undici 内部实现，因此这里**全程防御式**：取不到就返回 `undefined`
 * （退回 fetch 默认 300s）并告警一次，**绝不抛错**、绝不阻断生成主流程。
 */
/** 长请求的传输层上限（毫秒）：留足余量，覆盖 `DRAMA_TIMEOUT_MS` 各档。 */
export const LONG_REQUEST_TIMEOUT_MS = 900_000;
/** undici 全局 dispatcher 的 well-known symbol（Node 18–24 稳定，仍按内部实现对待）。 */
const GLOBAL_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1');
/** 按超时值缓存：同一 ms 复用同一实例（连接池才能被复用）。 */
const dispatchers = new Map();
let warned = false;
/** 只告警一次（避免每次生成都刷屏）；不抛错，影响面止于「退回 300s 上限」。 */
function warnOnce(cause) {
    if (warned)
        return;
    warned = true;
    const detail = cause instanceof Error ? `（${cause.message}）` : '';
    console.warn(`[canvas-studio] 无法抬高 fetch 传输层超时上限，退回 undici 默认 300s${detail}。` +
        '长视频生成（>300s）可能被提前掐断；请核对 Node 版本与内置 undici 的全局 dispatcher 符号。');
}
/**
 * 取一个「超时上限 = `timeoutMs`」的**请求级** dispatcher。
 *
 * 用法：`fetch(url, { ...init, dispatcher })`——只影响这一次请求。
 *
 * @param timeoutMs - 本次请求的传输层上限；默认 {@link LONG_REQUEST_TIMEOUT_MS}。
 *   （可传小值用于自测：能观察到「更短的静默即被掐断」才算证明这条通路有效。）
 * @returns dispatcher；`undefined` 表示当前运行时不支持 → 调用方**必须**退回
 *   fetch 默认行为，不得因此报错。
 */
export function longRequestDispatcher(timeoutMs = LONG_REQUEST_TIMEOUT_MS) {
    const cached = dispatchers.get(timeoutMs);
    if (cached !== undefined)
        return cached;
    try {
        const current = globalThis[GLOBAL_DISPATCHER_SYMBOL];
        const ctor = current?.constructor;
        if (typeof ctor !== 'function') {
            warnOnce();
            return undefined;
        }
        const dispatcher = new ctor({
            headersTimeout: timeoutMs,
            bodyTimeout: timeoutMs,
        });
        // 鸭子类型自检：必须是带 dispatch() 的 dispatcher 实例。若 symbol 位上放着别的
        // 对象（不同 Node 版本改了内部实现），其 constructor 可能只是 Object——那种
        // 实例一旦作为 init.dispatcher 传入，会在发请求时报出难懂的错，不如在这里挡下。
        if (typeof dispatcher?.dispatch !== 'function') {
            warnOnce();
            return undefined;
        }
        dispatchers.set(timeoutMs, dispatcher);
        return dispatcher;
    }
    catch (cause) {
        warnOnce(cause);
        return undefined;
    }
}
