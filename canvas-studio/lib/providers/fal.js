import { assertFalReferenceSizes, toFalDataUri } from './reference.js';
import { sliceToMax } from './shared.js';
const QUEUE_BASE = 'https://queue.fal.run';
/** 能力 → fal model_id（全部按 fal 官方 API 文档实测校准，见方案文档 §11.2）。 */
const MODEL_BY_CAPABILITY = {
    'text-to-video': 'minimax/h3/text-to-video',
    'first-last-frame': 'minimax/h3/image-to-video',
    'multi-reference': 'minimax/h3/reference-to-video',
};
/** fal 多参考图上限（reference_image_urls ≤ 9；Drama 侧为 6，差异见方案 §5.5）。 */
const FAL_MAX_REFERENCES = 9;
/**
 * fal 多参考的引用约定：提示词里按 `Image 1` / `Image 2` 的顺序引用参考图
 * （官方文档原文：Refer to reference assets by their modality and order）。
 * 提示词自带该约定时不干预；否则自动前置一句顺序说明并回 warning 告知 agent。
 */
const IMAGE_ORDER_TOKEN = /\bimage\s*\d+/iu;
/** fal 时长硬边界（秒）。越界时钳制并回 warning，不直接报错（方案 §5.2）。 */
const FAL_DURATION_MIN = 5;
const FAL_DURATION_MAX = 15;
/**
 * resolution 映射（方案 §5.3，已按实测枚举 480P/768P/2K/4K 收窄）。
 * 720p/1080p 在 H3 无对应档，就近**升档**——升档会提高费用，warning 必须写明。
 */
const RESOLUTION_MAP = {
    '768p': { value: '768P' },
    '2k': { value: '2K' },
    '720p': { value: '768P', warning: 'resolution=720p 在 fal H3 无对应档，已升档为 768P（费用更高，非等价替换）' },
    '1080p': { value: '2K', warning: 'resolution=1080p 在 fal H3 无对应档，已升档为 2K（费用更高，非等价替换）' },
};
/** 取出 falApiKey 注入；未注入或解析为空串都视为「未配置」。 */
async function requireApiKey(ctx) {
    if (ctx.falApiKey === undefined) {
        throw new Error('未配置 fal API Key，请在设置 → Canvas Studio 中填写');
    }
    const key = await ctx.falApiKey();
    if (key.length === 0) {
        throw new Error('未配置 fal API Key，请在设置 → Canvas Studio 中填写');
    }
    return key;
}
/** 取出参考图字节读取注入（首帧/尾帧必经）。 */
function requireReferenceReader(ctx) {
    if (ctx.readReferenceBytes === undefined) {
        throw new Error('fal 视频适配器需要 readReferenceBytes 注入（generate.ts 未注入即调用）');
    }
    return ctx.readReferenceBytes;
}
/** 带鉴权头与超时/取消信号的 fetch（4xx/5xx 统一转可读中文错误）。 */
async function falFetch(url, init, apiKey, ctx, label) {
    const response = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Key ${apiKey}`,
            'Content-Type': 'application/json',
            ...init.headers,
        },
        ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
        // 截断响应体，避免把整页 HTML 塞进错误文案。
        const detail = text.length > 300 ? `${text.slice(0, 300)}…` : text;
        throw new Error(`${label}失败: ${response.status}${detail.length > 0 ? ` ${detail}` : ''}`);
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`${label}失败: 响应不是合法 JSON（${response.status}）`);
    }
}
/** 从 submit 响应取出请求基址 URL（status/result/cancel 均由它派生）。 */
function requestBaseUrlOf(submitted, modelId) {
    const responseUrl = submitted.response_url;
    if (typeof responseUrl === 'string' && responseUrl.length > 0)
        return responseUrl;
    const statusUrl = submitted.status_url;
    if (typeof statusUrl === 'string' && statusUrl.length > 0)
        return statusUrl.replace(/\/status$/, '');
    const requestId = submitted.request_id;
    if (typeof requestId === 'string' && requestId.length > 0) {
        // fal 常规会回传 response_url；兜底按官方 URL 形态自行构造（model 路径本函数可知）。
        return `${QUEUE_BASE}/${modelId}/requests/${requestId}`;
    }
    throw new Error('fal submit 响应缺少 request_id / response_url，无法查询任务');
}
/** 构造一个 fal 视频供应商实例（阶段 5：三种能力全支持）。 */
export function createFalProvider() {
    return {
        id: 'fal',
        label: 'fal (MiniMax H3)',
        capabilities: new Set(['text-to-video', 'first-last-frame', 'multi-reference']),
        maxReferences: FAL_MAX_REFERENCES,
        async submit(req, ctx) {
            const apiKey = await requireApiKey(ctx);
            const warnings = [];
            const modelId = MODEL_BY_CAPABILITY[req.capability];
            // —— 时长钳制：fal 硬边界 [5,15]，越界钳制并回 warning（Drama 侧不受影响）。
            let duration = Math.round(req.duration);
            if (duration < FAL_DURATION_MIN) {
                warnings.push(`duration=${req.duration} 低于 fal 下限，已钳制为 ${FAL_DURATION_MIN} 秒`);
                duration = FAL_DURATION_MIN;
            }
            else if (duration > FAL_DURATION_MAX) {
                warnings.push(`duration=${req.duration} 超过 fal 上限，已钳制为 ${FAL_DURATION_MAX} 秒`);
                duration = FAL_DURATION_MAX;
            }
            // —— 分辨率：fal 真实生效（Drama 仍是占坑）。未指定则不传，走 fal 默认（2K）。
            const input = { duration };
            if (req.resolution !== undefined) {
                const mapped = RESOLUTION_MAP[req.resolution];
                input.resolution = mapped.value;
                if (mapped.warning !== undefined)
                    warnings.push(mapped.warning);
            }
            // —— 画幅与参考图（端点差异已实测校准）：
            // t2v / 多参考都传 aspect_ratio（1:1 原生支持，与 Drama 的降级不同）；
            // i2v 无 aspect_ratio（画幅跟随首帧图），只传 image_url / end_image_url。
            let prompt = req.prompt;
            const images = sliceToMax(req.references, FAL_MAX_REFERENCES);
            if (req.capability === 'text-to-video') {
                input.aspect_ratio = req.aspectRatio;
            }
            else if (req.capability === 'multi-reference') {
                input.aspect_ratio = req.aspectRatio;
                const reader = requireReferenceReader(ctx);
                const uris = [];
                for (const ref of images) {
                    uris.push(await toFalDataUri(await reader(ref), { ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}) }));
                }
                // 逃生阀：超过单张 2MB / 合计 12MB 就地报错，别等 fal 回 413。
                assertFalReferenceSizes(uris);
                input.reference_image_urls = uris;
                if (req.references.length > images.length) {
                    warnings.push(`参考图共 ${req.references.length} 张，超过 fal 上限 ${FAL_MAX_REFERENCES} 张，`
                        + `已保留 ${images.length} 张（首尾必留，中间均匀采样）`);
                }
                // 多参考靠「提示词按 Image N 顺序引用」对齐；提示词没写则自动前置顺序说明。
                if (!IMAGE_ORDER_TOKEN.test(prompt)) {
                    const order = images.map((_, i) => `Image ${i + 1}`).join(' / ');
                    prompt = `参考图按 ${order} 的顺序对应（与 reference_image_urls 顺序一致）。${prompt}`;
                    warnings.push(`fal 多参考需在提示词里按 ${order} 的顺序引用参考图，已自动前置顺序说明；`
                        + '由你自行书写该顺序（如「Image 1 是女主，Image 2 是她的狗」）一致性会更好。');
                }
            }
            else {
                const reader = requireReferenceReader(ctx);
                const uris = [];
                // first-last-frame 只有首/尾帧语义（capabilityOf 保证 2 图才走此分支）。
                for (const ref of images.slice(0, 2)) {
                    uris.push(await toFalDataUri(await reader(ref), { ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}) }));
                }
                assertFalReferenceSizes(uris);
                if (uris[0] !== undefined)
                    input.image_url = uris[0];
                if (uris[1] !== undefined)
                    input.end_image_url = uris[1];
            }
            input.prompt = prompt;
            const submitted = await falFetch(`${QUEUE_BASE}/${modelId}`, {
                method: 'POST',
                body: JSON.stringify({ input, webhookUrl: null }),
            }, apiKey, ctx, 'fal 任务提交');
            const token = requestBaseUrlOf(submitted, modelId);
            // exactOptionalPropertyTypes：warnings 非空才落字段。
            return warnings.length > 0 ? { token, warnings } : { token };
        },
        async poll(handle, ctx) {
            const apiKey = await requireApiKey(ctx);
            const status = await falFetch(`${handle.token}/status`, { method: 'GET' }, apiKey, ctx, 'fal 状态查询');
            if (status.status === 'COMPLETED') {
                const result = await falFetch(handle.token, { method: 'GET' }, apiKey, ctx, 'fal 结果获取');
                const video = result.video;
                const url = (video !== undefined && typeof video.url === 'string' && video.url.length > 0 ? video.url : undefined) ??
                    (typeof result.url === 'string' ? result.url : undefined);
                if (url === undefined) {
                    throw new Error('fal 结果获取失败: 响应中没有 video.url');
                }
                return { done: true, url };
            }
            // fal 队列不提供数值进度，只区分排队 / 生成中。
            return status.status === 'IN_PROGRESS'
                ? { done: false, stage: '生成中' }
                : { done: false, stage: '排队中' };
        },
        async cancel(handle, ctx) {
            // 尽力取消：取消失败（任务已完成 / 已不存在）不应掩盖原始错误，executor 会吞掉本异常。
            const apiKey = await requireApiKey(ctx);
            await falFetch(`${handle.token}/cancel`, { method: 'PUT' }, apiKey, ctx, 'fal 任务取消');
        },
    };
}
