/**
 * Drama Backend 视频适配器（异步任务版，后端 0.5.0）。
 *
 * 后端 0.5.0 起 `image2videofl2va` / `image2videoref2va` 改为**异步任务**：
 * 提交立即返回 202 + `{job_id, status, status_url, cancel_url, result_url}`
 * （实测 48ms，`job_id` 即 ComfyUI `prompt_id`），视频在 ComfyUI 侧排队串行执行。
 * 本适配器因此从「同步阻塞」形态切换为 submit → poll → cancel 三段式，与 fal
 * 同构；executor（providers/executor.ts）的轮询 / 超时 / 取消逻辑原样复用。
 *
 * 轮询节奏：由 generate.ts 注入 `pollIntervalMs`（30s——批量提交时每个任务独立
 * 计时，不给后端加压）。瞬时错误（网络抖动 / 5xx）**容忍**：当轮「未完成」，
 * 下一轮重试，直到整体超时；只有确定性的坏消息（404 任务消失 / failed /
 * cancelled）才立即失败。
 *
 * 任务元数据：拿到 `job_id` 后经 `ctx.onSubmitted` 立即回调（generate.ts 落地到
 * 项目 jobs.json——客户端重启后 Host 据此恢复轮询并结算节点，见
 * `src/video-jobs.ts`）；状态流转经 `ctx.onJobUpdate` 增量回写台账。
 *
 * 参考图自愈（`callWithFallback`）保留在 generate.ts 内（依赖当前调用的闭包，
 * 无法在 adapter 内构造），通过 `ProviderContext.dramaPostWithFallback` 注入——
 * 202 契约下它返回原始 JSON，自愈重试对「参考图失效 500」照常生效。
 * 详见方案文档 §6 阶段 2 与 docs/api-probe/video-jobs-20260924/report.md。
 */
import { DRAMA_ENDPOINTS, MEGAPIXELS_BY_RESOLUTION, DEFAULT_RESOLUTION } from '../config.js'
import type {
  DramaJobStatus,
  DramaJobUpdate,
  ProviderContext,
  ProviderHandle,
  ProviderPoll,
  VideoCapability,
  VideoProvider,
  VideoRequest,
} from './types.js'
import { sliceToMax } from './shared.js'
import { throwError } from '../error-system.js'
import '../errors/catalog.js'

/**
 * Drama 参考音频字段前缀：`audio1` / `audio2` / `audio3`——与既有 `image1..image9`
 * 同一命名惯例（官方形态是 `content[]` + `role:"reference_audio"`，Drama 用扁平命名）。
 */
const DRAMA_AUDIO_FIELD = 'audio'

/**
 * Drama 参考视频字段前缀：`video1` / `video2` / `video3`。
 *
 * **字段名已实证**（2026-09-22 读后端 `GET /openapi.json`：`Image2VideoRef2vaRequest`
 * 的属性里 `video1`–`video3` 与 `image1`–`image9`、`audio1`–`audio3` 并列，
 * 类型 string、无附加约束描述）。
 */
const DRAMA_VIDEO_FIELD = 'video'

/** Drama 原生音轨开关字段名（对应官方 / 上游 skill 的 `generate_audio`）。 */
const DRAMA_GENERATE_AUDIO_FIELD = 'generate_audio'

/**
 * Drama 多参考图上限（CV-191）：后端 `image2videoref2va` 收 `image1`–`image9`，
 * 与 fal 的 `FAL_MAX_REFERENCES` 同值。
 *
 * 后端另有「参考文件总数 ≤12」（图 + 视频 + 音频合计，其中图 ≤9 / 视频 ≤3 / 音频 ≤3）的
 * 约束；音频段数由上层 `audio-reference.ts` 按官方规格拦下，本常量只管**参考图**。
 */
const DRAMA_MAX_REFERENCES = 9

/**
 * Drama 的画幅归一（CV-136）：**只发 16:9 / 9:16 两种**——竖屏直接传 9:16，
 * 经用户与后端确认可用。
 *
 * 契约 `VideoAspectRatio` 已是两档，这里保留函数是**运行时兜底**：画布老节点重放
 * generationPrompt 时可能仍带着历史参数 `1:1`，统一落回横屏，绝不把非法取值发出去。
 */
function dramaAspect(ratio: VideoRequest['aspectRatio'] | string): '16:9' | '9:16' {
  return ratio === '9:16' ? '9:16' : '16:9'
}

/** 取出 Drama 提交 POST 注入（参考图自愈闭包，由 generate.ts 每次调用时注入）。 */
function requirePoster(
  ctx: ProviderContext,
): NonNullable<ProviderContext['dramaPostWithFallback']> {
  const post = ctx.dramaPostWithFallback
  if (post === undefined) {
    throwError('CS-PROV-003', { detail: 'drama 需要 dramaPostWithFallback 注入' })
  }
  return post
}

/** 取出 Drama 异步任务端点请求注入（状态 / 结果 / 取消，由 generate.ts 注入）。 */
function requireJobRequest(
  ctx: ProviderContext,
): NonNullable<ProviderContext['dramaJobRequest']> {
  const request = ctx.dramaJobRequest
  if (request === undefined) {
    throwError('CS-PROV-003', { detail: 'drama 需要 dramaJobRequest 注入' })
  }
  return request
}

/** 异步任务端点路径（`/api/v1/jobs/{job_id}` + 可选后缀 `/cancel` / `/result`）。 */
function jobPath(jobId: string, suffix: '' | '/cancel' | '/result' = ''): string {
  return `${DRAMA_ENDPOINTS.jobs}/${jobId}${suffix}`
}

/**
 * 从状态查询响应体解析任务状态；形状不对返回 `null`（**不猜**——宁可当一次
 * 「本轮未完成」容忍过去，也不把未知值误判成终态）。
 * 纯函数，供单测直接钉住后端契约。
 */
export function jobStatusOf(payload: unknown): DramaJobStatus | null {
  if (typeof payload !== 'object' || payload === null) return null
  const status = (payload as { status?: unknown }).status
  return status === 'pending' || status === 'in_progress' || status === 'completed'
    || status === 'failed' || status === 'cancelled'
    ? status
    : null
}

/**
 * 从 result 响应解析产物（`full_url` 必须为非空字符串）；形状不对返回 `null`。
 * result 结构 = 旧同步响应 `{prompt_id, filename, full_url, duration}`（探针实证）。
 * 纯函数，供单测直接钉住后端契约。
 */
export function jobResultOf(payload: unknown): { url: string; filename?: string } | null {
  if (typeof payload !== 'object' || payload === null) return null
  const url = (payload as { full_url?: unknown }).full_url
  if (typeof url !== 'string' || url.length === 0) return null
  const filename = (payload as { filename?: unknown }).filename
  return typeof filename === 'string' && filename.length > 0 ? { url, filename } : { url }
}

/** 每个 handle 已通知过的状态（`onJobUpdate` 只在变化时回调，避免台账重复写盘）。 */
const notifiedStatuses = new WeakMap<ProviderHandle, DramaJobStatus>()

/** 状态变化时回调台账钩子；首次必回调。 */
function notifyStatus(
  handle: ProviderHandle,
  ctx: ProviderContext,
  jobId: string,
  status: DramaJobStatus,
  executionError?: string | null,
): void {
  if (notifiedStatuses.get(handle) === status) return
  notifiedStatuses.set(handle, status)
  ctx.onJobUpdate?.({ jobId, status, ...(executionError !== undefined ? { executionError } : {}) } satisfies DramaJobUpdate)
}

/** failed 状态的错误详情（`execution_error` 可能是任意形状，尽量取出可读文本）。 */
export function executionErrorText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const raw = (payload as { execution_error?: unknown }).execution_error
  if (raw === null || raw === undefined) return undefined
  if (typeof raw === 'string' && raw.length > 0) return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

/** 构造一个 Drama 视频供应商实例。 */
export function createDramaProvider(): VideoProvider {
  return {
    id: 'drama',
    label: 'Drama Backend',
    capabilities: new Set<VideoCapability>(['text-to-video', 'first-last-frame', 'multi-reference']),
    maxReferences: DRAMA_MAX_REFERENCES,

    async submit(req: VideoRequest, ctx: ProviderContext): Promise<ProviderHandle> {
      const post = requirePoster(ctx)
      const aspect = dramaAspect(req.aspectRatio)
      const megapixels = MEGAPIXELS_BY_RESOLUTION[req.resolution ?? DEFAULT_RESOLUTION]
      const images = req.references.map((ref) => ref.localPath)
      // 非致命提示（截断等）经 executor 汇入生成结果 warnings 回流给 agent。
      const warnings: string[] = []

      let endpoint: string
      let body: Record<string, unknown>

      if (req.capability === 'multi-reference') {
        // 多参考图 REF2VA：最多 9 张（image1–image9），超过则保留首尾 +
        // 中间均匀采样，并回 warning —— 与 fal 同一规则，不静默丢弃。
        endpoint = DRAMA_ENDPOINTS.videoRef2va
        const refs = sliceToMax(images, DRAMA_MAX_REFERENCES)
        body = { prompt: req.prompt, aspect, megapixels, duration: req.duration }
        refs.forEach((image, i) => { body[`image${i + 1}`] = image })
        if (images.length > refs.length) {
          warnings.push(
            `参考图共 ${images.length} 张，超过 Drama 上限 ${DRAMA_MAX_REFERENCES} 张，`
            + `已保留 ${refs.length} 张（首尾必留，中间均匀采样）`,
          )
        }
      } else if (images.length >= 2) {
        // first-last-frame：首尾帧插值（video_composite 两图场景，比多参考更稳）。
        endpoint = DRAMA_ENDPOINTS.videoFl2va
        body = {
          prompt: req.prompt,
          aspect,
          megapixels,
          duration: req.duration,
          image1: images[0]!,
          image2: images[1]!,
        }
      } else if (images.length === 1) {
        // first-last-frame：仅首帧（video_generate 带 filename）。
        endpoint = DRAMA_ENDPOINTS.videoFl2va
        body = {
          prompt: req.prompt,
          aspect,
          megapixels,
          duration: req.duration,
          image1: images[0]!,
        }
      } else {
        // text-to-video：纯文生视频（不传参考图）。
        endpoint = DRAMA_ENDPOINTS.videoFl2va
        body = { prompt: req.prompt, aspect, megapixels, duration: req.duration }
      }

      // —— H3 官方参考视频通道（`video1`–`video3`，后端已支持）。与音频同一纪律：
      // 顺序即 prompt 里 `<Video N>` 的引用序，不重排、不去重。段数（≤3）/ 单段时长 /
      // 合计 ≤15s 由 video-reference.ts 在上层按官方规格拦下，这里不再自行截断
      // （与 audios 对称：两处都判会漂移）。
      const videos = req.videos ?? []
      videos.forEach((video, i) => { body[`${DRAMA_VIDEO_FIELD}${i + 1}`] = video.localPath })

      // —— H3 官方音频通道。`generate_audio` 仍未见于后端文档，缺省不发送、
      // 显式指定时才发，被拒时由上层（generate.ts 的视频自愈）摘字段重试并回
      // warning，**不静默丢弃**。参考音频按 `<Audio N>` 的顺序落在 audio1..audio3：
      // 顺序即引用序，不得重排；段数 / 单段时长 / 合计 ≤15s 已由 audio-reference.ts
      // 在上层按官方规格拦下。
      const audios = req.audios ?? []
      audios.forEach((audio, i) => { body[`${DRAMA_AUDIO_FIELD}${i + 1}`] = audio.localPath })
      // 原生音轨：仅调用方显式指定时发送（缺省不发送，交后端默认行为决定）。
      if (req.generateAudio !== undefined) body[DRAMA_GENERATE_AUDIO_FIELD] = req.generateAudio

      // 提交：后端 0.5.0 起 202 立即返回任务信封（实测 48ms），参考图失效自愈
      // （500 → 重传 → 重试）在注入的闭包内照常生效。超时取独立短档
      // `videoSubmit`（60s）——202 秒级返回，长超时只会在后端宕机时拖慢快失败。
      const envelope = await post(endpoint, body, 'videoSubmit')
      const jobId = typeof envelope.job_id === 'string' && envelope.job_id.length > 0
        ? envelope.job_id
        : undefined
      if (jobId === undefined) throwError('CS-NET-010')
      // 台账落地钩子：job_id 必须在进入轮询前写进 jobs.json（客户端重启后据此恢复）。
      ctx.onSubmitted?.({ jobId })
      // exactOptionalPropertyTypes：warnings 非空才落字段。
      return warnings.length > 0 ? { token: jobId, warnings } : { token: jobId }
    },

    async poll(handle: ProviderHandle, ctx: ProviderContext): Promise<ProviderPoll> {
      const request = requireJobRequest(ctx)
      const jobId = handle.token

      // 瞬时错误容忍：网络抖动 / 5xx / 响应形状异常一律当「本轮未完成」，下一轮
      // 重试，直到 executor 的整体超时兜底。只有 404（任务消失）与确定的终态才失败。
      // 用户主动取消不吞：signal 已中止时直接抛出，交给 executor 顶部统一 cancel。
      let snapshot: { status: number; json: unknown }
      try {
        snapshot = await request('GET', jobPath(jobId))
      } catch (cause) {
        if (ctx.signal?.aborted === true) throw cause
        return { done: false, stage: '状态查询失败，稍后重试' }
      }
      if (snapshot.status === 404) {
        // 后端重启清队列 / 排队中任务被取消后消散——确定性坏消息，立即失败。
        throwError('CS-PROV-016', { jobId })
      }
      const status = jobStatusOf(snapshot.json)
      if (status === null) {
        if (snapshot.status >= 500 || snapshot.status === 0) return { done: false, stage: '状态查询失败，稍后重试' }
        // 2xx 但形状不对：后端契约变了，容忍到超时只会掩盖问题，直接报结构异常。
        throwError('CS-NET-010')
      }
      switch (status) {
        case 'pending': {
          notifyStatus(handle, ctx, jobId, status)
          return { done: false, stage: '排队中' }
        }
        case 'in_progress': {
          notifyStatus(handle, ctx, jobId, status)
          return { done: false, stage: '生成中' }
        }
        case 'failed': {
          const detail = executionErrorText(snapshot.json)
          notifyStatus(handle, ctx, jobId, status, detail ?? null)
          throwError('CS-PROV-015', { jobId, ...(detail !== undefined ? { detail } : {}) })
        }
        case 'cancelled': {
          notifyStatus(handle, ctx, jobId, status)
          throwError('CS-PROV-015', { jobId, detail: '任务已被取消（cancelled）' })
        }
        case 'completed': {
          // 状态已 completed，取产物。result 端点：200 = 产物；202 = 未就绪
          //（状态与产物落盘之间的窗口，实测 39ms，但保守容忍一轮）；404/409 = 失败。
          let result: { status: number; json: unknown }
          try {
            result = await request('GET', jobPath(jobId, '/result'))
          } catch (cause) {
            if (ctx.signal?.aborted === true) throw cause
            return { done: false, stage: '结果获取失败，稍后重试' }
          }
          if (result.status === 202) return { done: false, stage: '生成中' }
          if (result.status === 404 || result.status === 409) {
            throwError('CS-PROV-015', { jobId, detail: `任务已完成但结果不可取（HTTP ${result.status}）` })
          }
          const media = jobResultOf(result.json)
          if (media === null) {
            if (result.status >= 500) return { done: false, stage: '结果获取失败，稍后重试' }
            throwError('CS-NET-010')
          }
          notifyStatus(handle, ctx, jobId, 'completed')
          return media.filename !== undefined
            ? { done: true, url: media.url, filename: media.filename }
            : { done: true, url: media.url }
        }
      }
    },

    async cancel(handle: ProviderHandle, ctx: ProviderContext): Promise<void> {
      // 尽力取消：取消失败（任务已完成 / 已不存在）不应掩盖原始错误，
      // executor 会吞掉本异常。取消后状态由后端异步翻转（实测 ~5s 内 cancelled）。
      const request = requireJobRequest(ctx)
      await request('POST', jobPath(handle.token, '/cancel'))
    },
  }
}
