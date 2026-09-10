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
import type {
  ProviderContext,
  ProviderHandle,
  ProviderPoll,
  VideoCapability,
  VideoProvider,
  VideoRequest,
} from './types.js'
import { assertFalReferenceSizes, toFalAudioDataUri, toFalDataUri } from './reference.js'
import { sliceToMax } from './shared.js'

const QUEUE_BASE = 'https://queue.fal.run'

/** 能力 → fal model_id（全部按 fal 官方 API 文档实测校准，见方案文档 §11.2）。 */
const MODEL_BY_CAPABILITY: Record<VideoCapability, string> = {
  'text-to-video': 'minimax/h3/text-to-video',
  'first-last-frame': 'minimax/h3/image-to-video',
  'multi-reference': 'minimax/h3/reference-to-video',
}

/** fal 多参考图上限（reference_image_urls ≤ 9；Drama 侧为 6，差异见方案 §5.5）。 */
const FAL_MAX_REFERENCES = 9

/**
 * fal 参考音频字段（官方 `minimax/h3/reference-to-video`：≤3 段音频，
 * 按 prompt 里的引用顺序对齐）。字段名按参考图 `reference_image_urls` 对称命名，
 * 若 fal 实际字段名不同，**只改这一处**。
 */
const FAL_AUDIO_FIELD = 'reference_audio_urls'

/** fal 参考音频段数上限（官方 3 段；单段 2–15s、合计 ≤15s 由 audio-reference.ts 校验）。 */
const FAL_MAX_AUDIOS = 3

/**
 * fal 多参考的引用约定：提示词里按 `Image 1` / `Image 2` 的顺序引用参考图
 * （官方文档原文：Refer to reference assets by their modality and order）。
 * 提示词自带该约定时不干预；否则自动前置一句顺序说明并回 warning 告知 agent。
 */
const IMAGE_ORDER_TOKEN = /\bimage\s*\d+/iu

/** fal 时长硬边界（秒）。越界时钳制并回 warning，不直接报错（方案 §5.2）。 */
const FAL_DURATION_MIN = 5
const FAL_DURATION_MAX = 15

/**
 * resolution 映射（方案 §5.3，已按实测枚举 480P/768P/2K/4K 收窄）。
 * 720p/1080p 在 H3 无对应档，就近**升档**——升档会提高费用，warning 必须写明。
 */
const RESOLUTION_MAP: Record<NonNullable<VideoRequest['resolution']>, { value: string; warning?: string }> = {
  '768p': { value: '768P' },
  '2k': { value: '2K' },
  '720p': { value: '768P', warning: 'resolution=720p 在 fal H3 无对应档，已升档为 768P（费用更高，非等价替换）' },
  '1080p': { value: '2K', warning: 'resolution=1080p 在 fal H3 无对应档，已升档为 2K（费用更高，非等价替换）' },
}

/** 取出 falApiKey 注入；未注入或解析为空串都视为「未配置」。 */
async function requireApiKey(ctx: ProviderContext): Promise<string> {
  if (ctx.falApiKey === undefined) {
    throw new Error('未配置 fal API Key，请在设置 → Canvas Studio 中填写')
  }
  const key = await ctx.falApiKey()
  if (key.length === 0) {
    throw new Error('未配置 fal API Key，请在设置 → Canvas Studio 中填写')
  }
  return key
}

/** 取出参考图字节读取注入（首帧/尾帧必经）。 */
function requireReferenceReader(ctx: ProviderContext): NonNullable<ProviderContext['readReferenceBytes']> {
  if (ctx.readReferenceBytes === undefined) {
    throw new Error('fal 视频适配器需要 readReferenceBytes 注入（generate.ts 未注入即调用）')
  }
  return ctx.readReferenceBytes
}

/** 带鉴权头与超时/取消信号的 fetch（4xx/5xx 统一转可读中文错误）。 */
async function falFetch(
  url: string,
  init: RequestInit,
  apiKey: string,
  ctx: ProviderContext,
  label: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
  })
  const text = await response.text()
  if (!response.ok) {
    // 截断响应体，避免把整页 HTML 塞进错误文案。
    const detail = text.length > 300 ? `${text.slice(0, 300)}…` : text
    throw new Error(`${label}失败: ${response.status}${detail.length > 0 ? ` ${detail}` : ''}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`${label}失败: 响应不是合法 JSON（${response.status}）`)
  }
}

/** 从 submit 响应取出请求基址 URL（status/result/cancel 均由它派生）。 */
function requestBaseUrlOf(submitted: Record<string, unknown>, modelId: string): string {
  const responseUrl = submitted.response_url
  if (typeof responseUrl === 'string' && responseUrl.length > 0) return responseUrl
  const statusUrl = submitted.status_url
  if (typeof statusUrl === 'string' && statusUrl.length > 0) return statusUrl.replace(/\/status$/, '')
  const requestId = submitted.request_id
  if (typeof requestId === 'string' && requestId.length > 0) {
    // fal 常规会回传 response_url；兜底按官方 URL 形态自行构造（model 路径本函数可知）。
    return `${QUEUE_BASE}/${modelId}/requests/${requestId}`
  }
  throw new Error('fal submit 响应缺少 request_id / response_url，无法查询任务')
}

/** 构造一个 fal 视频供应商实例（阶段 5：三种能力全支持）。 */
export function createFalProvider(): VideoProvider {
  return {
    id: 'fal',
    label: 'fal (MiniMax H3)',
    capabilities: new Set<VideoCapability>(['text-to-video', 'first-last-frame', 'multi-reference']),
    maxReferences: FAL_MAX_REFERENCES,

    async submit(req: VideoRequest, ctx: ProviderContext): Promise<ProviderHandle> {
      const apiKey = await requireApiKey(ctx)
      const warnings: string[] = []
      const modelId = MODEL_BY_CAPABILITY[req.capability]

      // —— 时长钳制：fal 硬边界 [5,15]，越界钳制并回 warning（Drama 侧不受影响）。
      let duration = Math.round(req.duration)
      if (duration < FAL_DURATION_MIN) {
        warnings.push(`duration=${req.duration} 低于 fal 下限，已钳制为 ${FAL_DURATION_MIN} 秒`)
        duration = FAL_DURATION_MIN
      } else if (duration > FAL_DURATION_MAX) {
        warnings.push(`duration=${req.duration} 超过 fal 上限，已钳制为 ${FAL_DURATION_MAX} 秒`)
        duration = FAL_DURATION_MAX
      }

      // —— 分辨率：fal 真实生效（Drama 仍是占坑）。未指定则不传，走 fal 默认（2K）。
      const input: Record<string, unknown> = { duration }
      if (req.resolution !== undefined) {
        const mapped = RESOLUTION_MAP[req.resolution]
        input.resolution = mapped.value
        if (mapped.warning !== undefined) warnings.push(mapped.warning)
      }

      // —— 画幅与参考图（端点差异已实测校准）：
      // t2v / 多参考都传 aspect_ratio（1:1 原生支持，与 Drama 的降级不同）；
      // i2v 无 aspect_ratio（画幅跟随首帧图），只传 image_url / end_image_url。
      let prompt = req.prompt
      const images = sliceToMax(req.references, FAL_MAX_REFERENCES)
      if (req.capability === 'text-to-video') {
        input.aspect_ratio = req.aspectRatio
      } else if (req.capability === 'multi-reference') {
        input.aspect_ratio = req.aspectRatio
        const reader = requireReferenceReader(ctx)
        const uris: string[] = []
        for (const ref of images) {
          uris.push(await toFalDataUri(await reader(ref), { ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}) }))
        }
        // 逃生阀：超过单张 2MB / 合计 12MB 就地报错，别等 fal 回 413。
        assertFalReferenceSizes(uris)
        input.reference_image_urls = uris
        if (req.references.length > images.length) {
          warnings.push(
            `参考图共 ${req.references.length} 张，超过 fal 上限 ${FAL_MAX_REFERENCES} 张，`
            + `已保留 ${images.length} 张（首尾必留，中间均匀采样）`,
          )
        }
        // H3 官方音频参考：≤3 段，按 prompt 里的引用顺序对齐（不得重排、不得去重）。
        // 刻意**不走** toFalDataUri——那条路径含「ffmpeg 降采样成 JPEG」，套到音频
        // 上只会产出坏载荷；音频按原字节 base64 内联，格式校验在上层按官方规格做。
        const audios = (req.audios ?? []).slice(0, FAL_MAX_AUDIOS)
        if (audios.length > 0) {
          const audioUris: string[] = []
          for (const ref of audios) {
            audioUris.push(toFalAudioDataUri(await reader(ref)))
          }
          input[FAL_AUDIO_FIELD] = audioUris
          const requested = req.audios?.length ?? 0
          if (requested > audios.length) {
            warnings.push(`参考音频共 ${requested} 段，超过 fal 上限 ${FAL_MAX_AUDIOS} 段，已保留前 ${audios.length} 段`)
          }
        }
        // 多参考靠「提示词按 Image N 顺序引用」对齐；提示词没写则自动前置顺序说明。
        if (!IMAGE_ORDER_TOKEN.test(prompt)) {
          const order = images.map((_, i) => `Image ${i + 1}`).join(' / ')
          prompt = `参考图按 ${order} 的顺序对应（与 reference_image_urls 顺序一致）。${prompt}`
          warnings.push(
            `fal 多参考需在提示词里按 ${order} 的顺序引用参考图，已自动前置顺序说明；`
            + '由你自行书写该顺序（如「Image 1 是女主，Image 2 是她的狗」）一致性会更好。',
          )
        }
      } else {
        const reader = requireReferenceReader(ctx)
        const uris: string[] = []
        // first-last-frame 只有首/尾帧语义（capabilityOf 保证 2 图才走此分支）。
        for (const ref of images.slice(0, 2)) {
          uris.push(await toFalDataUri(await reader(ref), { ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}) }))
        }
        assertFalReferenceSizes(uris)
        if (uris[0] !== undefined) input.image_url = uris[0]
        if (uris[1] !== undefined) input.end_image_url = uris[1]
      }
      input.prompt = prompt

      // 原生音轨：fal 的 H3 音频随画面**同一次推理**产出，没有独立开关。
      // 传 true = 默认行为已满足（不重复传参）；传 false 时只能落在提示词层，
      // 这里如实说明，不让 agent 误以为参数已被后端接受。
      if (req.generateAudio === true) {
        warnings.push('fal H3 原生音轨随画同步产出，无需额外参数即已生效')
      } else if (req.generateAudio === false) {
        warnings.push('fal H3 没有「关闭原生音轨」的开关；如需静音请在提示词里写明 silent / no audio')
      }

      const submitted = await falFetch(
        `${QUEUE_BASE}/${modelId}`,
        {
          method: 'POST',
          body: JSON.stringify({ input, webhookUrl: null }),
        },
        apiKey,
        ctx,
        'fal 任务提交',
      )
      const token = requestBaseUrlOf(submitted, modelId)

      // exactOptionalPropertyTypes：warnings 非空才落字段。
      return warnings.length > 0 ? { token, warnings } : { token }
    },

    async poll(handle: ProviderHandle, ctx: ProviderContext): Promise<ProviderPoll> {
      const apiKey = await requireApiKey(ctx)
      const status = await falFetch(
        `${handle.token}/status`,
        { method: 'GET' },
        apiKey,
        ctx,
        'fal 状态查询',
      )
      if (status.status === 'COMPLETED') {
        const result = await falFetch(handle.token, { method: 'GET' }, apiKey, ctx, 'fal 结果获取')
        const video = result.video as { url?: unknown } | undefined
        const url =
          (video !== undefined && typeof video.url === 'string' && video.url.length > 0 ? video.url : undefined) ??
          (typeof result.url === 'string' ? result.url : undefined)
        if (url === undefined) {
          throw new Error('fal 结果获取失败: 响应中没有 video.url')
        }
        return { done: true, url }
      }
      // fal 队列不提供数值进度，只区分排队 / 生成中。
      return status.status === 'IN_PROGRESS'
        ? { done: false, stage: '生成中' }
        : { done: false, stage: '排队中' }
    },

    async cancel(handle: ProviderHandle, ctx: ProviderContext): Promise<void> {
      // 尽力取消：取消失败（任务已完成 / 已不存在）不应掩盖原始错误，executor 会吞掉本异常。
      const apiKey = await requireApiKey(ctx)
      await falFetch(`${handle.token}/cancel`, { method: 'PUT' }, apiKey, ctx, 'fal 任务取消')
    },
  }
}
