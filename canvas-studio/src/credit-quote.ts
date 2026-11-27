/**
 * 预估报价的**唯一推导点**：把「界面上那组参数」翻成 `POST /v1/generations/quote`
 * 的请求体（`{model, operation, input}`）。
 *
 * ## 为什么不许 client 自己拼请求体
 *
 * 报价的分母（模型 + operation + input 里的尺寸/时长）必须与**生成链**完全同源，
 * 否则「预估 21.14、实扣 26.42」这种偏差在 UI 上完全看不出来 —— 两个数字都自洽。
 * 因此本模块只跑在 Host，client 只发声明式参数（见 `contracts/account.ts` 的
 * `CreditQuoteParams`），由这里统一推导。
 *
 * ## 三条实测结论（2026-11-24，逐点采样 quote，见
 * `docs/plans/积分预估与实扣展示方案-20261124.md` §1.1）
 *
 * 1. **视频只看时长**：`megapixels` 取 0.4 / 1.0 / 2.0 同一条 5s 视频都是 30 分
 *    ⇒ 清晰度对视频**不计价**（历史前端「清晰度 +6 / +14」是凭空加的钱）。
 * 2. **图片按面积**：面积(px) × 0.00002，跨模型同价（Krea2 与 Qwen 一致）
 *    ⇒ 所以 `prompt` 只用于选模型（含可显示文字 → Qwen），不影响报出来的数。
 * 3. **参考素材不进报价**：quote 不吃 `inputs`，`image2image` 的 ×1.25 是
 *    operation 级系数，不是「每张图 +2」。**待验证项 V-1**：ref2va 真实带 9 张
 *    参考图时 commit 是否仍是「秒 × 6」，需真跑一次对照（验收用例 A-9）。
 *
 * 本模块**不联网**：只产出请求体，发不发、发给谁由调用方（`account-state.ts`）
 * 决定。纯函数 ⇒ `node --test` 可零依赖直连。
 */
import { BUSINESS_MODEL_CODES } from './config.js'
import { INSTRUMENTAL_LYRICS } from './contracts/canvas.js'
import { normalizeImageModelOverride, routeImageModel } from './model-route.js'
import { DEFAULT_RESOLUTION_ID, frameOf, megapixelsOf } from './resolution-tiers.js'
import type { CreditQuoteParams } from './contracts/account.js'
import type { GenerationOperation } from './contracts/generation.js'

/** 报价请求体（与 `POST /v1/generations/quote` 的字段一一对应；只收这三个键）。 */
export interface GenerationQuoteRequest {
  readonly model: string
  readonly operation: GenerationOperation
  readonly input: Record<string, unknown>
}

/** 视频时长的兜底（与 `generate.ts` 的 `video_generate` 缺省同值 5s）。 */
const DEFAULT_VIDEO_DURATION = 5
/** `video_composite` 的缺省时长（与 `host-tools.ts` 该车道的 clampDuration fallback 同源）。 */
const DEFAULT_VIDEO_COMPOSITE_DURATION = 10
/** music 时长的兜底（与 `generate.ts` 的 `DEFAULT_MUSIC_DURATION` 同值）。 */
const DEFAULT_MUSIC_DURATION = 30
/** 分辨率档位缺省（`resolution-tiers.ts` 的出厂值，不在本地另写一个）。 */
const ASPECT_FALLBACK = '16:9'
/**
 * 报价占位 prompt：只在用户还没写提示词时用。
 *
 * 报价**不消费** prompt（图片按面积、视频按时长），但它的入参校验与创建任务同源
 * ——空串大概率被拒，于是「还没写提示词」的节点会显示「暂不可用」。占位串让读数
 * 先出来；它**只进报价请求**，永远不会被提交成一次生成。
 */
const QUOTE_PROMPT_FALLBACK = 'pricing'

/**
 * 推导报价请求体。
 *
 * 除 `kind` 外全部字段可缺省 —— 界面上的 chip 在用户还没点过任何档位时就要能报
 * 出价，所以每一维都必须有与生成链同值的兜底（不是随便一个数）。
 */
export function quoteRequestFor(params: CreditQuoteParams): GenerationQuoteRequest {
  switch (params.kind) {
    case 'image':
      return imageQuote(params)
    case 'video':
      return videoQuote(params)
    case 'audio':
      return audioQuote(params)
  }
}

/**
 * 图片：模型/operation 走 `routeImageModel`（与生成链同一函数），尺寸走档位表。
 *
 * `hasImages` ⇒ 带参考图 ⇒ 路由到 `image2image`（Qwen，×1.25）。这一步不能省：
 * 图生图与文生图在 **720P 差 5.28 分**（26.42 vs 21.14），猜错的偏差是可见的。
 */
function imageQuote(params: CreditQuoteParams): GenerationQuoteRequest {
  const override = normalizeImageModelOverride(params.modelOverride)
  const route = routeImageModel({
    tool: params.imageTool ?? 'image_generate',
    prompt: params.prompt ?? '',
    hasReferences: params.hasImages === true,
    ...(override !== undefined ? { override } : {}),
  })
  // 角色四视图：固定价、**不吃尺寸也不吃 prompt**（生成链发的就是空 input）。
  // 若照面积报，会得到 26.42 而实扣 30 —— 这一维必须与生成链同形。
  if (route.operation === 'image2character') {
    return { model: route.model, operation: route.operation, input: {} }
  }
  const frame = frameOf(params.resolution ?? DEFAULT_RESOLUTION_ID, params.aspectRatio ?? ASPECT_FALLBACK)
  return {
    model: route.model,
    operation: route.operation,
    input: { prompt: promptOf(params), width: frame.width, height: frame.height },
  }
}

/**
 * 视频：唯一真模型 H3；`fl2va` / `ref2va` 只是 operation 不同（quote 层同价）。
 *
 * `megapixels` 照发（生成链也发它），但实测**不影响报价** —— 保留它是为了让请求体
 * 与生成请求长得一样，方便对照日志。
 */
function videoQuote(params: CreditQuoteParams): GenerationQuoteRequest {
  // P1-7（2026-11-27 审查）：时长口径与生成链同源 —— ① 缺省按车道取（video_composite
  // 10s / 其余 5s，与 `host-tools.ts` 两条车道的 fallback 一致，此前一律 5s ⇒ composite
  // 报 30 实扣 60）；② 上钳 `maxVideoSeconds`（路由从 runtime 注入，与 `clampDuration`
  // 同一把尺）。不传 maxVideoSeconds 不钳（fail-open，别把读数变成拦路）。
  const fallback = params.videoTool === 'video_composite'
    ? DEFAULT_VIDEO_COMPOSITE_DURATION
    : DEFAULT_VIDEO_DURATION
  const rounded = params.duration !== undefined && Number.isFinite(params.duration)
    ? Math.max(1, Math.round(params.duration))
    : fallback
  const duration = params.maxVideoSeconds !== undefined && Number.isFinite(params.maxVideoSeconds)
    ? Math.min(rounded, Math.max(1, Math.round(params.maxVideoSeconds)))
    : rounded
  const megapixels = megapixelsOf(params.resolution)
  return {
    model: BUSINESS_MODEL_CODES.videoH3,
    operation: params.videoMode === 'omni' ? 'image2videoref2va' : 'image2videofl2va',
    input: {
      prompt: promptOf(params),
      aspect: params.aspectRatio ?? ASPECT_FALLBACK,
      megapixels,
      duration,
    },
  }
}

/**
 * 音频：`music` 按时长（秒 × 1），`voice` / `design` 走 `txt2speech` 固定价。
 *
 * music 的 `lyrics` 缺省按 `[Instrumental]`（与生成链 CV-130 同值）—— 发空串会
 * 让后端当成「没填歌词」，与真正提交的那次不是同一个请求。
 */
function audioQuote(params: CreditQuoteParams): GenerationQuoteRequest {
  if (params.audioFn === 'music') {
    const duration = params.duration !== undefined && Number.isFinite(params.duration)
      ? Math.max(1, Math.round(params.duration))
      : DEFAULT_MUSIC_DURATION
    return {
      model: BUSINESS_MODEL_CODES.txt2audio,
      operation: 'txt2audio',
      input: {
        prompt: promptOf(params),
        lyrics: params.lyrics !== undefined && params.lyrics.trim() !== '' ? params.lyrics : INSTRUMENTAL_LYRICS,
        duration,
      },
    }
  }
  return {
    model: BUSINESS_MODEL_CODES.txt2speech,
    operation: 'txt2speech',
    input: { prompt: promptOf(params) },
  }
}

/** 报价请求里的 prompt（空则占位；见 `QUOTE_PROMPT_FALLBACK`）。 */
function promptOf(params: CreditQuoteParams): string {
  const text = params.prompt ?? ''
  return text.trim() === '' ? QUOTE_PROMPT_FALLBACK : text
}

/**
 * 把 HTTP 请求体解析成 {@link CreditQuoteParams}（路由层唯一的入口校验）。
 *
 * 只做**形状与范围**校验，不做「这个档位合不合法」的产品判断 —— 后者是
 * `resolution-tiers` 的事，而报价这一侧对未知档位的正确行为是**按出厂档报**而不是
 * 拒掉（用户界面上那个值可能是历史脏值，报个价总比空着好）。
 *
 * `kind` 缺失或不是三选之一 ⇒ `null`（路由回 400）：那不是「参数不全」，是
 * 调用方搞错了接口，静默回一个兜底价只会让错误更难查。
 */
export function parseQuoteParams(value: unknown): CreditQuoteParams | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const kind = raw['kind']
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null
  const prompt = typeof raw['prompt'] === 'string' ? raw['prompt'] : undefined
  const lyrics = typeof raw['lyrics'] === 'string' ? raw['lyrics'] : undefined
  const resolution = typeof raw['resolution'] === 'string' ? raw['resolution'] : undefined
  const aspectRatio = typeof raw['aspectRatio'] === 'string' ? raw['aspectRatio'] : undefined
  const imageTool = raw['imageTool']
  const duration = typeof raw['duration'] === 'number' && Number.isFinite(raw['duration']) ? raw['duration'] : undefined
  const videoTool = raw['videoTool']
  const maxVideoSeconds = typeof raw['maxVideoSeconds'] === 'number' && Number.isFinite(raw['maxVideoSeconds'])
    ? raw['maxVideoSeconds']
    : undefined
  const videoMode = raw['videoMode']
  const audioFn = raw['audioFn']
  const modelOverride = raw['modelOverride']
  return {
    kind,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(lyrics !== undefined ? { lyrics } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(raw['hasImages'] === true ? { hasImages: true } : {}),
    ...(imageTool === 'image_generate' || imageTool === 'image_generate_withtxt' || imageTool === 'character_generate'
      ? { imageTool }
      : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(videoTool === 'video_generate' || videoTool === 'video_composite' ? { videoTool } : {}),
    ...(maxVideoSeconds !== undefined ? { maxVideoSeconds } : {}),
    ...(videoMode === 'fl' || videoMode === 'omni' ? { videoMode } : {}),
    ...(audioFn === 'music' || audioFn === 'voice' || audioFn === 'design' ? { audioFn } : {}),
    ...(modelOverride === 'textRender' || modelOverride === 'krea2' ? { modelOverride } : {}),
  }
}

/**
 * 报价指纹：同一组**计价参数**必须命中同一个缓存/在飞请求。
 *
 * 刻意**不含** `prompt` / `lyrics`：它们只影响模型路由（而 Krea2 与 Qwen 同价）
 * 与内容，不影响金额。含进去会让「改一个字就重报一次价」，一次输入 = 一串请求。
 */
export function quoteFingerprint(params: CreditQuoteParams): string {
  return [
    params.kind,
    params.imageTool ?? '',
    params.resolution ?? '',
    params.aspectRatio ?? '',
    params.hasImages === true ? 'ref' : 'text',
    params.duration === undefined ? '' : String(Math.round(params.duration)),
    params.videoTool ?? '',
    params.videoMode ?? '',
    params.audioFn ?? '',
    params.modelOverride ?? '',
  ].join('|')
}
