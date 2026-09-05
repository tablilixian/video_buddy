/**
 * Drama Backend 视频适配器（阶段 2）。
 *
 * 把原本散落在 generate.ts:970-1023 的视频分支逻辑迁到这里，行为逐字节不变。
 * Drama 是「同步阻塞」供应商——`submit` 内部一次 POST 等到底，结果放进
 * `handle.settled`，因此 executor 不会进入轮询（零额外开销）。
 *
 * 参考图自愈（`callWithFallback`）保留在 generate.ts 内（依赖当前调用的闭包，
 * 无法在 adapter 内构造），通过 `ProviderContext.dramaPostWithFallback` 注入。
 * 详见方案文档 §6 阶段 2。
 */
import { DRAMA_ENDPOINTS } from '../config.js';
import { sliceToMax } from './shared.js';
/** Drama 固定 0.4 兆像素（与改造前请求体一致）。 */
const MEGAPIXELS = 0.4;
/** Drama 的画幅归一：仅 16:9 / 9:16，'1:1' 等就近落到 16:9（与改造前一致）。 */
function dramaAspect(ratio) {
    return ratio === '9:16' ? '9:16' : '16:9';
}
/** 取出 Drama 同步 POST 注入（参考图自愈闭包，由 generate.ts 每次调用时注入）。 */
function requirePoster(ctx) {
    const post = ctx.dramaPostWithFallback;
    if (post === undefined) {
        throw new Error('Drama 视频适配器需要 dramaPostWithFallback 注入（generate.ts 未注入即调用）');
    }
    return post;
}
/** 构造一个 Drama 视频供应商实例。 */
export function createDramaProvider() {
    return {
        id: 'drama',
        label: 'Drama Backend',
        capabilities: new Set(['text-to-video', 'first-last-frame', 'multi-reference']),
        maxReferences: 6,
        async submit(req, ctx) {
            const post = requirePoster(ctx);
            const aspect = dramaAspect(req.aspectRatio);
            const images = req.references.map((ref) => ref.localPath);
            let endpoint;
            let body;
            if (req.capability === 'multi-reference') {
                // 多参考图 REF2VA：最多 6 张（image1–image6），超过则保留首尾 + 中间均匀采样。
                endpoint = DRAMA_ENDPOINTS.videoRef2va;
                const refs = sliceToMax(images, 6);
                body = { prompt: req.prompt, aspect, megapixels: MEGAPIXELS, duration: req.duration };
                refs.forEach((image, i) => { body[`image${i + 1}`] = image; });
            }
            else if (images.length >= 2) {
                // first-last-frame：首尾帧插值（video_composite 两图场景，比多参考更稳）。
                endpoint = DRAMA_ENDPOINTS.videoFl2va;
                body = {
                    prompt: req.prompt,
                    aspect,
                    megapixels: MEGAPIXELS,
                    duration: req.duration,
                    image1: images[0],
                    image2: images[1],
                };
            }
            else if (images.length === 1) {
                // first-last-frame：仅首帧（video_generate 带 filename）。
                endpoint = DRAMA_ENDPOINTS.videoFl2va;
                body = {
                    prompt: req.prompt,
                    aspect,
                    megapixels: MEGAPIXELS,
                    duration: req.duration,
                    image1: images[0],
                };
            }
            else {
                // text-to-video：纯文生视频（不传参考图）。
                endpoint = DRAMA_ENDPOINTS.videoFl2va;
                body = { prompt: req.prompt, aspect, megapixels: MEGAPIXELS, duration: req.duration };
            }
            // Drama 同步完成，结果直接内嵌进 handle.settled，executor 不会进入轮询。
            const settled = await post(endpoint, body, 'video');
            return { token: settled.url, settled };
        },
        // 同步供应商：submit 已 settled，poll 首次即返回 done（executor 实际不会走到这里）。
        async poll(handle) {
            if (handle.settled !== undefined) {
                return {
                    done: true,
                    url: handle.settled.url,
                    ...(handle.settled.filename !== undefined ? { filename: handle.settled.filename } : {}),
                };
            }
            return { done: true, url: handle.token };
        },
    };
}
