/**
 * fal.ai 视频适配器（阶段 4 建立 / 阶段 5 补齐多参考）—— MiniMax H3 系列，
 * 队列三段式（异步供应商）。
 *
 * 与 Drama（同步阻塞）不同，fal 的协议是 submit → poll → result：
 * - submit：POST https://queue.fal.run/{model_id}，取 request_id
 * - poll：  GET  .../requests/{id}/status，COMPLETED 后拉 .../requests/{id} 取产物
 * - cancel：PUT  .../requests/{id}/cancel（超时 / 用户取消时由 executor 驱动）
 *
 * 端点与字段已于 2026-09-04 按 fal 官方 API 文档校准（方案文档 §11.2 的勘误）：
 * - t2v：minimax/h3/text-to-video，aspect_ratio 六档（21:9/16:9/4:3/1:1/3:4/9:16，无 adaptive）
 * - i2v：minimax/h3/image-to-video，无 aspect_ratio（画幅跟随首帧图）；
 *        字段为 image_url（首帧）+ end_image_url（尾帧），不是计划假设的 image_urls 数组
 * - ref2v：minimax/h3/reference-to-video（阶段 5），reference_image_urls 数组 ≤9 张，
 *          aspect_ratio 枚举在此端点才有 adaptive（默认）；提示词按 `Image 1` / `Image 2`
 *          顺序引用参考图（官方约定），缺失时本模块自动前置顺序说明并回 warning
 * - duration 5–15 秒；resolution 480P/768P/2K/4K（默认 2K）
 * - 输出 { video: { url } }；鉴权 `Authorization: Key <FAL_KEY>`
 *
 * 参考图：fal 不认 Drama 的 filename 句柄，需把本地字节内联为 base64 data URI
 * （readReferenceBytes 注入 + reference.ts 的 toFalDataUri：ffmpeg 降采样到长边 ≤1024
 * 的 JPEG，失败回退原字节；编码后经 assertFalReferenceSizes 逃生阀校验体积）。
 *
 * 不引入 @fal-ai/client SDK，用裸 fetch 直连 REST——与项目全部网络调用一致，
 * 且测试打桩覆盖 globalThis.fetch 的既有方式不会失效（方案文档 §6 阶段 4 步骤 3）。
 */
import type { VideoProvider } from './types.js';
/** 构造一个 fal 视频供应商实例（阶段 5：三种能力全支持）。 */
export declare function createFalProvider(): VideoProvider;
