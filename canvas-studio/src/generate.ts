/**
 * Canvas Studio P3 媒体生成（Host 侧）。
 *
 * 调用 Drama Backend（参考 WL 适配器），下载产物并落盘到项目 `assets/`，
 * 返回 webServer 托管的 URL。浏览器侧工具经 `/canvas-studio/generate` 路由
 * 调用本模块，规避渲染进程的 CORS 限制。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isIP } from 'node:net'
import {
  DRAMA_ENDPOINTS,
  newAssetId,
  sizeForAspectRatio,
} from './config.js'
import type { ProjectRegistry } from './projects.js'
import { applySupersede, planSupersede } from './shot-versions.js'
import type { StudioAsset, StudioCanvasNode, StudioCanvasOperationType } from './contracts/canvas.js'
import { AUDIO_NODE_HEIGHT, AUDIO_NODE_WIDTH, INSTRUMENTAL_LYRICS } from './contracts/canvas.js'
import type { StudioRuntimeConfig } from './host-tools.js'
import { DEFAULT_DRAMA_API_BASE } from './host-config.js'
import { audioModeNotice, validateH3AudioReferences } from './audio-reference.js'
import type { AudioReferenceInput } from './audio-reference.js'
import { previewSizeOf } from './canvas-aspect.js'
// CV-140：产物落盘后探真实时长（请求值只作 declaredDuration 留存）。
import { probeMediaDuration } from './ffmpeg-run.js'
// CV-135：长请求传输层——把 Node 内置 fetch 的隐形 300s 上限抬到 LONG_REQUEST_TIMEOUT_MS。
import { longRequestDispatcher } from './long-request.js'
// 阶段 2：视频生成供应商抽象层。Drama 是首个（同步）供应商；fal 后续接入。
import { capabilityOf } from './providers/capability.js'
import { resolveProvider } from './providers/registry.js'
import { runVideo } from './providers/executor.js'
import { parseProviderParam } from './providers/selection.js'
import { readLocalAssetBytes } from './providers/reference.js'
import { registerBuiltinVideoProviders } from './providers/index.js'
import type { ProviderContext, VideoAspectRatio, VideoProviderId, VideoReference, VideoRequest } from './providers/types.js'

// 阶段 2：注册内置视频供应商（当前仅 Drama）。放在模块加载即执行，确保无论是运行时
// 经 index.ts 装配，还是测试直连 lib/generate.js，resolveProvider 都能取到供应商。
// registerBuiltinVideoProviders 幂等（Map.set 覆盖），重复调用无副作用。
registerBuiltinVideoProviders()

/** 运行时配置（由 Host 经 setRuntimeConfig 注入；Drama 调用的基址/时长/密钥均从此读取）。 */
let current: StudioRuntimeConfig | null = null
export function setRuntimeConfig(cfg: StudioRuntimeConfig): void { current = cfg }

/**
 * 运行时配置访问器：未注入时（测试直连 lib、或早于插件装配的调用）回退到
 * 编译期默认值（与 host-config.ts schema 的 default 对齐）——否则 `current!`
 * 会在探针的 try 块里抛 TypeError，被统一 catch 误报成「Drama Backend 不可达」。
 * 密钥解析没有安全默认（默认值是凭据引用不是真实密钥），保持显式抛错。
 */
function runtime(): StudioRuntimeConfig {
  // 用 `!= null` 同时挡住 null（未注入）与 undefined（注入了 undefined 的
  // 健壮性兜底），两者都回退编译期默认值。
  if (current != null) return current
  return {
    dramaApiBase: () => DEFAULT_DRAMA_API_BASE,
    maxVideoSeconds: () => 15,
    resolveDramaApiKey: () => Promise.resolve(''), // CR-033：未注入时按「未配置」处理，返回空串（后端无鉴权，不强制 key）
    resolveFalApiKey: () => Promise.resolve(''), // 阶段 4：fal key 未注入同样按「未配置」处理，空串由 fal adapter 报错
    defaultVideoProvider: () => 'drama',
    defaultAspectRatio: () => '16:9',
    workflowMode: () => 'confirm',
    hitlStoryboard: () => true,
    hitlKeyframe: () => false,
    autoRetry: () => true,
    maxParallel: () => 2,
    assetDir: () => '',
    autoSave: () => true,
    autoSaveInterval: () => 30,
  }
}

/** 一次生成的请求参数（来自客户端工具）。 */
export interface GenerateParams {
  prompt: string
  aspectRatio?: string
  /** 已上传到 Drama Backend 的服务器文件名（image_generate 图生图 / video_generate / image2vl 用）。 */
  filename?: string
  /** 已上传的 Drama Backend 文件名数组（video_composite 用）。 */
  filenames?: string[]
  negativePrompt?: string
  /** 画风模式：realistic（默认，写实）= txt2image/image2image；anime（卡通/日式动漫）= txt2imageanime（仅纯文生图，传参考图则回退写实图生图）。 */
  style?: 'realistic' | 'anime'
  /** 【占坑·待接入】视频模型选择：h3（默认，当前后端统一走 FL2VA 即 H3 技术路线）/ seedance2（未接入，传入会被忽略并返回提示）。 */
  model?: 'h3' | 'seedance2'
  /** 【占坑·待接入】分辨率指定（768p/1080p/720p/2k）：后端暂不支持，传入会被忽略（以 aspectRatio + 后端默认分辨率输出）。 */
  resolution?: '768p' | '1080p' | '720p' | '2k'
  /**
   * H3 原生音轨（对应官方 / 上游 skill 的 `generate_audio`）。**缺省不发送**：
   * 仅显式传值时才进请求体——`true` = 请求随画同步的原生音轨，`false` = 要求静音。
   * Drama 后端尚未开放该字段，被拒时由视频自愈摘掉并回 warning（不静默丢弃）。
   */
  generateAudio?: boolean
  /**
   * 参考音频（H3 官方「audio reference / audio reuse」通道）：已上传的 Drama
   * 文件名**有序**数组，顺序即 `<Audio N>` 的引用序，不得重排、不得去重。
   *
   * 官方规格见 `audio-reference.ts`（≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、
   * ≤15MB/段，且**必须与图或视频同行**）——超限在**发出去之前**就拦下，
   * 不浪费一次调用。
   */
  audioRefs?: string[]
  /**
   * 视频供应商选择（阶段 3）。留空 → 走设置项 `defaultVideoProvider`（默认 drama）。
   * 该字段随 generationPrompt 自动持久化并在重试时回传，故节点重试不会串台
   * （原片由哪家生成，重试仍走哪家）。非法值由 routes 与 generateAsset 双重校验拒绝。
   */
  provider?: VideoProviderId
  duration?: number
  /**
   * 衔接语义（C3，video 节点）：chain=与上一镜同场景连续（末帧作下镜首帧）/
   * cut=跨时空硬切 / bridge=同场景大跨度（首尾帧书挡）。只作落盘标注，
   * 不改变生成本身的行为（链帧由 agent 先调 extract_last_frame 再传首帧）。
   */
  shotTransition?: 'chain' | 'cut' | 'bridge'
  /**
   * 节点级重试锚点：设置时把结果写回该已有节点（保留 id/位置/血缘），
   * 而不是追加新节点 —— 重试不产生新边（plan §7.8 标准 2）。
   */
  retryOf?: string
  /**
   * CV-108 显式取代：本次生成的结果取代哪个已有视频节点（填节点 id，
   * 由 `list_shots` 获取）。用于「改了关键帧重新出这一镜」——输入指纹与旧版
   * 不同、无法自动判重，但语义上是同一镜位的新版本。旧版会被标记失效，
   * 不再进默认合成。
   */
  replaces?: string
  /**
   * 输入参考图对应的画布产物 URL（工具结果里的 url 字段）。落盘时按 URL
   * 反查画布节点并写入 sourceIds —— 血缘边（流程箭头）的唯一来源；缺省
   * 时新节点没有边（历史行为）。
   */
  sourceUrls?: string[]
  /**
   * CV-027：已解析的分镜卡节点 id（工具层由 shotRefs 解析而来），并入血缘
   * 与落位锚点——关键帧/视频排在其所属分镜卡的右侧。
   */
  shotNodeIds?: string[]
}

/** 一次生成的产物描述（返回给模型）。 */
export interface GenerateResult {
  url: string
  width: number
  height: number
  duration?: number
  /** Drama Backend 服务器文件名（图片类产物透出，供下游以 filename 链式引用）。 */
  filename?: string
  /** 占坑参数提示（如 model=seedance2 / resolution / generateAudio 暂未接入时给出），渲染时追加到返回文本。 */
  warnings?: string[]
  /** CV-108：本次产物落到的画布节点 id（供 clipIds / replaces 精确引用）。 */
  nodeId?: string
  /** CV-108：本次产出取代掉的旧节点 id（新版本作废旧版时非空）。 */
  superseded?: string[]
}

/** 钳制视频时长：1–maxVideoSeconds() 取整；未提供时用各工具的默认值。maxVideoSeconds 来自设置。 */
export function clampDuration(value: number | undefined, fallback: number): number {
  return Math.min(runtime().maxVideoSeconds(), Math.max(1, Math.round(value ?? fallback)))
}

/**
 * 把视频生成工具的参数归一化为与供应商无关的 VideoRequest（阶段 2）。
 *
 * 时长已按工具默认值（video_generate=5s、video_composite=10s）经 `clampDuration` 钳制，
 * 适配器可直接使用；各供应商如需再钳（如 fal 的 [5,15]）在自身 adapter 内处理。
 * `resolution` 是占坑参数，透传给请求体由适配器决定是否生效。
 */
function videoRequestOf(tool: string, params: GenerateParams, durationFallback?: number): VideoRequest {
  const capability = capabilityOf(tool, params)
  // CV-136：视频画幅只归一为 16:9 / 9:16 两档（方形 1:1 仅图片类工具可用）。历史节点
  // 重放 generationPrompt 时带的 '1:1' 同样落回横屏，不再进请求体。
  const aspectRatio: VideoAspectRatio = params.aspectRatio === '9:16' ? '9:16' : '16:9'
  const fallback = durationFallback ?? (tool === 'video_generate' ? 5 : 10)
  const references: VideoReference[] =
    tool === 'video_generate'
      ? (params.filename !== undefined ? [{ localPath: params.filename, index: 0 }] : [])
      : (params.filenames ?? []).map((localPath, index) => ({ localPath, index }))
  // 参考音频：顺序即 `<Audio N>` 的引用序（官方与 fal 都按 prompt 的引用序取素材，
  // 故此处只做透传映射，不排序、不去重）。
  const audios: VideoReference[] = (params.audioRefs ?? []).map((localPath, index) => ({ localPath, index }))
  return {
    capability,
    prompt: params.prompt,
    duration: clampDuration(params.duration, fallback),
    aspectRatio,
    ...(params.resolution !== undefined ? { resolution: params.resolution } : {}),
    references,
    ...(audios.length > 0 ? { audios } : {}),
    // 原生音轨：缺省不发该字段（仅调用方显式指定时才进请求体）。
    ...(params.generateAudio !== undefined ? { generateAudio: params.generateAudio } : {}),
  }
}

/**
 * Drama Backend 调用超时（毫秒）：视频生成最慢，文本类最快。**各档的真正上限**。
 *
 * 注意：本表只有在传输层允许时才生效——Node 内置 fetch（undici）默认
 * `headersTimeout = bodyTimeout = 300s` 且**先于 AbortSignal** 触发（CV-133）。
 * 因此 `dramaPost` 按请求注入 `longRequestDispatcher()`，把传输层上限抬到
 * `LONG_REQUEST_TIMEOUT_MS`(900s)，本表各档才真正可达。
 * 不变量：**本表所有取值必须严格小于 LONG_REQUEST_TIMEOUT_MS**（有单测断言）。
 */
export const DRAMA_TIMEOUT_MS = { image: 360_000, video: 600_000, text: 180_000 }

// CR-010：产物/参考图下载的硬上限——外部 URL 挂起或返回超大体时不再无限阻塞
// 或整读内存。媒体（视频）上限 512MB、超时 10 分钟；图片（参考图/单镜）上限 32MB、
// 超时 2 分钟。
const MEDIA_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024
const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const IMAGE_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024
const IMAGE_DOWNLOAD_TIMEOUT_MS = 2 * 60_000

/**
 * CR-010：带超时与字节上限的下载。用 AbortSignal.timeout 与调用方 signal 组合，
 * 流式读取并在超限时中止（不再 `arrayBuffer()` 整读内存）。桩环境（测试）可能
 * 不提供 `response.body`，此时回退 `arrayBuffer()` 并仍做大小校验。
 */
async function downloadBytes(
  url: string,
  signal: AbortSignal | undefined,
  opts: { maxBytes: number; timeoutMs: number; label: string },
): Promise<Buffer> {
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const composed = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, { signal: composed })
  if (!response.ok) throw new Error(`${opts.label}失败: ${response.status}`)
  const body = (response as { body?: ReadableStream<Uint8Array> | null }).body
  if (body === undefined || body === null) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > opts.maxBytes) {
      throw new Error(`${opts.label}超过大小上限（${opts.maxBytes} 字节）`)
    }
    return bytes
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > opts.maxBytes) {
        throw new Error(`${opts.label}超过大小上限（${opts.maxBytes} 字节）`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

/**
 * CR-011：SSRF 防护——只允许 http/https，且目标地址不得指向受限网段。
 * 覆盖本产品实际可被利用的攻击面：agent 参数诱导 Host 抓取云元数据
 * （169.254.169.254）、本机服务（127.0.0.1 / localhost）、内网（10/8、172.16/12、
 * 192.168/16、链路本地）。hostname 即 IP 字面量时直接判定；主机名只额外拦
 * localhost 族（DNS 级「域名解析到私网」属理论攻击面，桌面本机 app 已有
 * loopback 同源门禁兜底，不做 DNS 解析以免引入网络依赖与延迟）。
 */
async function assertSafeDownloadUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`非法下载地址: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`仅支持 http/https 下载地址，收到: ${parsed.protocol}`)
  }
  const hostname = parsed.hostname
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    throw new Error(`下载地址指向受限网络: ${hostname}`)
  }
  if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
    throw new Error(`下载地址指向受限网络: ${hostname}`)
  }
}

/** IPv4/IPv6 受限网段判定（环回/私网/链路本地/ULA/保留/组播/广播）。 */
function isBlockedIp(ip: string): boolean {
  if (ip === '::1' || ip === '::') return true
  const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip
  const parts = v4.split('.').map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const a = parts[0]!
    if (a === 0 || a === 127 || a === 10 || a === 255) return true // 保留 / 环回 / A 私网 / 广播
    if (a === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true // 172.16/12
    if (a === 192 && parts[1]! === 168) return true // 192.168/16
    if (a === 169 && parts[1]! === 254) return true // 链路本地（含 169.254.169.254 云元数据）
    if (a >= 224) return true // 组播/保留
    return false
  }
  const lower = ip.toLowerCase()
  // IPv6 ULA fc00::/7、链路本地 fe80::/10。
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8')
    || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')
}

/**
 * P10 `/health` 前置探针：所有 Drama 请求先确认后端可达（结果缓存 30s），
 * 宕机时立刻给出中文提示，而不是让用户在长超时里干等。
 */
const HEALTH_CACHE_MS = 30_000
const HEALTH_TIMEOUT_MS = 10_000
let healthCache: { ok: boolean; checkedAt: number } | null = null

/** 清空探针缓存（测试钩子；生产代码不需要主动失效）。 */
export function resetDramaProbeCache(): void {
  healthCache = null
}

/** 探测失败时的统一中文错误（可操作：指向服务状态而非参数）。 */
function dramaUnreachableError(cause?: unknown): Error {
  const detail = cause instanceof Error ? `（${cause.message}）` : ''
  return new Error(`Drama Backend 不可达，请检查服务是否已启动后再试${detail}。`)
}

/**
 * 确认 Drama Backend 可达：GET /api/v1/health（5s 超时），成功与失败都缓存
 * 30s —— 缓存窗口内的后续请求零开销快速通过/快速失败。
 */
export async function ensureDramaReachable(signal?: AbortSignal): Promise<void> {
  const now = Date.now()
  // 只缓存「成功」；失败不缓存，下一次调用立即重试，避免单次瞬时抖动
  // 被误判为长期不可达（原逻辑会把失败缓存 30s，期间所有请求直接抛错）。
  if (healthCache !== null && healthCache.ok && now - healthCache.checkedAt < HEALTH_CACHE_MS) {
    return
  }
  let ok = false
  try {
    const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    const composed = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(`${runtime().dramaApiBase()}${DRAMA_ENDPOINTS.health}`, { signal: composed })
    ok = response.ok
  } catch {
    ok = false
  }
  if (ok) {
    healthCache = { ok: true, checkedAt: Date.now() }
    return
  }
  healthCache = null
  throw dramaUnreachableError()
}

/**
 * 带超时与一次性自动重试的 Drama POST（网络错误 / 502/503/504 时重试）。
 *
 * CV-135：① 按请求注入长超时 dispatcher —— Node 内置 fetch 的隐形 300s 上限会
 * **先于**本函数的 AbortSignal 触发，不抬高它的话 `timeoutMs` 形同虚设（见
 * long-request.ts）；② **本地超时不再重试** —— Drama 是同步阻塞式生成，重试等于
 * 再等一个完整的 timeoutMs（视频 600s → 最坏 20 分钟才报错），而首个超时的原因
 * （后端繁忙 / 时长过长）几乎不会自愈。
 */
async function dramaPost(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  // 探针前置：宕机时在这里就抛中文错误，不进入生成请求的长超时。
  await ensureDramaReachable(signal)
  const dispatcher = longRequestDispatcher()
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    // dispatcher 取不到时保持 fetch 默认行为（不加该字段），生成主流程不受影响。
    const requestInit = { ...init, signal: composed } as RequestInit & { dispatcher?: unknown }
    if (dispatcher !== undefined) requestInit.dispatcher = dispatcher
    try {
      const response = await fetch(`${runtime().dramaApiBase()}${endpoint}`, requestInit)
      if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt === 0) {
        lastError = new Error(`Drama Backend 暂时不可用（HTTP ${response.status}），已自动重试一次`)
        continue
      }
      return response
    } catch (cause) {
      // 用户主动打断不重试、不改写错误。
      if (signal?.aborted) throw cause
      // 本地超时（timeout 先于用户 signal 触发）：如实报出上限并放弃重试。
      if (timeout.aborted) {
        throw new Error(
          `Drama Backend ${Math.round(timeoutMs / 1000)}s 内未返回结果（已放弃重试）：` +
            '后端可能繁忙，或本次时长超出该档上限——可稍后重试或缩短时长。',
        )
      }
      lastError = cause
      if (attempt === 0) continue
      throw new Error(
        `Drama Backend 连接失败（已重试一次）：${cause instanceof Error ? cause.message : String(cause)}。请检查服务是否可达。`,
      )
    }
  }
  throw lastError instanceof Error ? lastError : new Error('生成失败')
}

/**
 * 将相对 URL 解析为 loopback 绝对 URL（Host 端 fetch 用）。
 * 浏览器端 <img src> 能自动解析同源相对路径，但 Node 原生 fetch 不支持，
 * 而 image_generate 返回的产物 URL 是相对路径（/canvas-studio/assets/...），
 * 后续 video_generate / video_composite 作为参考图传入时必须先补全。
 */
function resolveImageUrl(url: string, port: number): string {
  return url.startsWith('/') ? `http://127.0.0.1:${port}${url}` : url
}

/**
 * 解析 canvas-studio 资产 URL（`/canvas-studio/assets/<projectId>/<file>` 或
 * `http://127.0.0.1:<port>/canvas-studio/assets/<projectId>/<file>`），
 * 返回 projectId 与 file；非资产 URL 返回 null。
 */
function parseCanvasAsset(source: string): { projectId: string; file: string } | null {
  const m = source.match(/\/canvas-studio\/assets\/([^/]+)\/(.+?)(?:\?.*)?$/)
  return m ? { projectId: m[1]!, file: m[2]! } : null
}

/**
 * 把来源读成字节 + 扩展名。
 * 1) canvas-studio 资产 URL：host 进程本就有权直读磁盘资产，直接读盘——
 *    本地 webServer 对 loopback 请求返回 403（Electron 安全限制），无需绕经 HTTP。
 * 2) 本地文件路径 / file://：仅当落在 registry 根目录（本项目资产库）内才读盘
 *    （CR-011 白名单）；越权路径拒绝——agent 参数不可诱导 Host 读任意本地文件。
 * 3) 其它 URL：先过 SSRF 防护（禁环回/私网/链路本地/云元数据，CR-011），
 *    再带超时与字节上限下载（CR-010）。
 */
async function readSourceBytes(
  source: string,
  port: number | undefined,
  signal?: AbortSignal,
  registry?: ProjectRegistry,
): Promise<{ bytes: Buffer; ext: string }> {
  // 1) canvas-studio 资产 URL → 直接读磁盘。
  const asset = parseCanvasAsset(source)
  if (asset !== null && registry !== undefined) {
    const localPath = join(registry.assetsDir(asset.projectId), asset.file)
    if (existsSync(localPath)) {
      const ext = extname(asset.file).replace(/^\./, '') || 'png'
      return { bytes: await readFile(localPath), ext }
    }
  }
  // 2) 本地绝对文件路径 / file:// → 仅允许读取项目资产库内的文件（CR-011 白名单）。
  const rawLocal = source.startsWith('file://') ? fileURLToPath(source) : (isAbsolute(source) ? source : '')
  if (rawLocal.length > 0) {
    if (registry === undefined) throw new Error('本地文件引用需要 registry 上下文')
    const localPath = resolve(rawLocal)
    const root = resolve(registry.registryRoot)
    if (!(localPath.startsWith(root + sep) || localPath === root)) {
      throw new Error(`本地文件引用超出资产库范围，已拒绝: ${localPath}`)
    }
    if (existsSync(localPath)) {
      const ext = extname(localPath).replace(/^\./, '') || 'png'
      return { bytes: await readFile(localPath), ext }
    }
  }
  // 3) 其它 URL（含非资产匹配的相对路径补全端口后下载）。
  const url = port !== undefined && source.startsWith('/') ? resolveImageUrl(source, port) : source
  // CR-011：SSRF 防护在下载前执行；相对路径补全成的 loopback 地址同样被拦
  // （这正是「让 Host 抓取本机任意路径」的注入面，与其误读不如显式拒绝）。
  await assertSafeDownloadUrl(url)
  const buf = await downloadBytes(url, signal, {
    maxBytes: IMAGE_DOWNLOAD_MAX_BYTES,
    timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
    label: '参考图下载',
  })
  let ext = 'png'
  try { ext = extname(new URL(url).pathname).replace(/^\./, '') || 'png' } catch { /* keep png */ }
  return { bytes: buf, ext }
}

/** 上传一张图（本地路径 / canvas 资产 URL / 托管 URL）到 Drama Backend，返回服务器 filename。 */
async function uploadImage(sourceUrl: string, signal?: AbortSignal, port?: number, registry?: ProjectRegistry): Promise<string> {
  await ensureDramaReachable(signal)
  const { bytes, ext } = await readSourceBytes(sourceUrl, port, signal, registry)
  return uploadBytesToDrama(bytes, ext, signal)
}

/**
 * 把文件字节上传到 Drama Backend（统一上传端点 `POST /api/v1/generate/upload`），
 * 返回服务器 filename —— 这是**所有以文件名为入参的接口**（image2image / image2vl /
 * fl2va / ref2va 的 image1..9 · video1..3 · audio1..3 …）的标准前置步骤（CV-137）。
 *
 * 端点演进：旧的 `/api/v1/generate/uploadimage` 已从后端路由表移除（2026-09-10 实测
 * 任何请求均 404，openapi.json 亦无此路径）；新端点不限文件类型，图片 / 视频 / 音频
 * 共用，响应结构与旧端点一致（ComfyUI 原生 `{name, subfolder, type}`）。
 *
 * P8.1 本地图片与 P8.4 视频抽帧共用；表单文件名沿用唯一安全名约定
 * （只含 [A-Za-z0-9._-]），避免触发后端去重后缀破坏下游。
 */
export async function uploadBytesToDrama(bytes: Uint8Array, ext: string, signal?: AbortSignal): Promise<string> {
  // 上传走的是裸 fetch（multipart），同样前置探针。
  await ensureDramaReachable(signal)
  const assetId = newAssetId()
  const form = new FormData()
  // new Uint8Array(...) 拷贝进全新 ArrayBuffer（BlobPart 要求非 SharedArrayBuffer 视图）。
  form.append('file', new Blob([new Uint8Array(bytes)]), `ref-${assetId.slice(0, 8)}.${ext}`)
  const upload = await fetch(`${runtime().dramaApiBase()}${DRAMA_ENDPOINTS.upload}`, {
    method: 'POST',
    body: form,
    signal: signal ?? null,
  })
  if (upload.status === 404) {
    throw new Error('文件上传失败: 404 —— 后端未注册 /api/v1/generate/upload，请确认 Drama Backend 版本')
  }
  if (!upload.ok) throw new Error(`文件上传失败: ${upload.status}`)
  const data = await upload.json() as Record<string, unknown>
  // 兼容多种响应格式：{ name } / { filename } / { data: { filename } } / { data: { url } }
  const filename = (data.name
    ?? data.filename
    ?? (data.data as Record<string, unknown> | undefined)?.filename
    ?? (data.data as Record<string, unknown> | undefined)?.url
  ) as string | undefined
  if (!filename) throw new Error(`文件上传成功但未返回 filename（响应: ${JSON.stringify(data)}）`)
  return filename
}

/**
 * 从同源资产 url 解析出 `<projectId>/<assetFile>` 键（null = 非画布资产 url）。
 * 文件段收紧到与 promoteAssetFile 相同的白名单字符集（拒绝路径穿越/编码字符），
 * 纯函数，供惰性 promote（@ref 兜底）与单测使用。
 */
export function assetKeyFromUrl(url: string): string | null {
  const match = /^\/canvas-studio\/assets\/([^/]+)\/([A-Za-z0-9._-]+)$/u.exec(url)
  if (match === null || match[1]?.includes('..') === true) return null
  return `${match[1]}/${match[2]}`
}

/**
 * 2026-09-05 体验优化：Drama 上传与发送解耦后的「后台提升」通道。同一磁盘资产
 * （projectId/assetFile）的并发提升合并为一次网络上传（in-flight 去重）——后台
 * 预热与 @ref 惰性兜底同时触发时不会重复上传。
 */
const promoteInflight = new Map<string, Promise<string>>()

/**
 * 把已落盘的项目资产（assets/<assetFile>）上传到 Drama 拿服务器 filename。
 * 只做网络上传（读盘 + uploadBytesToDrama），不写画布——回写由调用方负责
 * （host-tools 惰性兜底 / 客户端后台回填各有自己的持久化时序）。
 */
export async function promoteAssetFile(
  registry: ProjectRegistry,
  projectId: string,
  assetFile: string,
  signal?: AbortSignal,
): Promise<string> {
  // 防路径穿越：assetFile 必须是纯文件名（上传时由 Host 生成 `assetId.ext`）。
  if (!/^[A-Za-z0-9._-]+$/u.test(assetFile) || assetFile.includes('..')) {
    throw new Error(`非法资产文件名: ${assetFile}`)
  }
  const key = `${projectId}/${assetFile}`
  const inflight = promoteInflight.get(key)
  if (inflight !== undefined) return inflight
  const pending = (async () => {
    const project = (await registry.list()).find((entry) => entry.id === projectId)
    if (!project) throw new Error(`项目不存在: ${projectId}`)
    const bytes = await readFile(join(registry.assetsDir(projectId), assetFile))
    const ext = assetFile.includes('.') ? (assetFile.split('.').pop() ?? 'png') : 'png'
    return uploadBytesToDrama(bytes, ext, signal)
  })()
  promoteInflight.set(key, pending)
  try {
    return await pending
  } finally {
    // 结算后摘除：后续调用以画布里的 filename 为准；仍缺失则重新上传。
    promoteInflight.delete(key)
  }
}

/**
 * P8.1：把本地图片（base64）落地到项目 assets 目录，并返回可直接供生成工具
 * 使用的两个引用：
 * - `url`：同源相对路径（/canvas-studio/assets/<projectId>/<file>），画布素材节点直接用；
 * - `filename`：经统一上传端点（`DRAMA_ENDPOINTS.upload`）拿到的服务器文件名，供 image_generate /
 *   video_generate / video_composite 的 filename(s) 参数使用。
 */
export async function uploadLocalImage(
  registry: ProjectRegistry,
  projectId: string,
  name: string,
  dataBase64: string,
  signal?: AbortSignal,
): Promise<{ url: string; filename: string }> {
  const { url, assetFile } = await saveLocalImage(registry, projectId, name, dataBase64)
  const filename = await promoteAssetFile(registry, projectId, assetFile, signal)
  return { url, filename }
}

/**
 * 2026-09-05 体验优化（两段式上传）：只做「base64 校验 + 项目 assets 落盘」，
 * 不上传 Drama。供对话附件旁路的快速段使用——发送只等本地写盘（毫秒级），
 * Drama 上传由后台 promote / 生成时惰性兜底接力。
 */
export async function saveLocalImage(
  registry: ProjectRegistry,
  projectId: string,
  name: string,
  dataBase64: string,
): Promise<{ url: string; assetFile: string }> {
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new Error('dataBase64 不能为空')
  }
  let bytes: Buffer
  try {
    // CR-015：Buffer.from 对非法 base64 不抛错（`@@!!` 也能解出字节）——用
    // 字符集+填充+round-trip 严格校验，无效 base64 直接拒绝而非以损坏字节写盘。
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
      throw new Error('not strict base64')
    }
    bytes = Buffer.from(dataBase64, 'base64')
    if (bytes.length === 0 || bytes.toString('base64') !== dataBase64) {
      throw new Error('base64 round-trip mismatch')
    }
  } catch {
    throw new Error('dataBase64 不是有效的 base64')
  }
  // 仅允许常见图片类型；其余按 png 兜底（写盘用，不影响 Drama 侧识别）。
  const ext = /\.(png|jpe?g|webp|gif|bmp)$/iu.test(name) ? name.toLowerCase().replace(/^.*\./u, '') : 'png'

  const assetId = newAssetId()
  const file = `${assetId}.${ext}`
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, file), bytes)
  return { url: `/canvas-studio/assets/${projectId}/${file}`, assetFile: file }
}

/** 统一解析失败响应：优先结构化字段，否则带出响应体片段（便于定位 500 真因）。 */
async function describeError(response: Response): Promise<string> {
  let message = `HTTP ${response.status}`
  try {
    const text = await response.text()
    if (text.length > 0) {
      try {
        const data = JSON.parse(text) as { error?: { message?: string }; msg?: string; detail?: string }
        message = data.error?.message || data.msg || data.detail || message
      } catch {
        message = text.slice(0, 200)
      }
    }
  } catch {
    /* keep default */
  }
  return message
}

/** 调用 Drama Backend 生成接口，取回产物 URL。 */
async function callDrama(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  kind: keyof typeof DRAMA_TIMEOUT_MS = 'image',
): Promise<{ url: string; filename?: string }> {
  const response = await dramaPost(
    endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    DRAMA_TIMEOUT_MS[kind],
    signal,
  )
  if (!response.ok) {
    throw new Error(`生成失败: ${await describeError(response)}`)
  }
  const data = await response.json() as { full_url?: string; filename?: string; data?: Array<{ url?: string }> }
  const url = data.full_url ?? data.data?.[0]?.url
  if (!url) throw new Error('生成响应中未找到产物 URL')
  return data.filename !== undefined ? { url, filename: data.filename } : { url }
}

/**
 * 判断错误是否由「参考图 filename 失效」导致（触发重新上传容错）。
 * 「Internal Server Error / HTTP 500」也在列：实测 Drama 后端把 temp/ 文件
 * 丢失（重启清存储）统一报成笼统 500，与真实服务端 bug 无法区分；误判的
 * 代价只是多一次重传 + 一次重试，重试仍失败时抛出的仍是原始错误。
 */
function isBadReferenceError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return /HTTP 400|HTTP 404|HTTP 5\d\d|not (found|exist)|file (not|doesn')|invalid|no (such|file)|internal server error|参考图|filename|image.*(missing|not)/i.test(e.message)
}

/** 生成工具名 → 画布操作类型（边颜色/标签的语义来源）。 */
export function operationTypeOf(tool: string, params: GenerateParams): StudioCanvasOperationType {
  if (tool === 'image_generate') return params.filename !== undefined ? 'image-to-image' : 'text-to-image'
  if (tool === 'character_generate') return 'text-to-image'
  if (tool === 'video_generate') return 'image-to-video'
  if (tool === 'video_composite') return 'mkr-video'
  return 'import'
}

/** 把生成参数序列化为 generationPrompt（节点重试时原样重放；retryOf 不入档）。 */
export function generationPromptOf(params: GenerateParams): string {
  const { retryOf: _retryOf, ...rest } = params
  return JSON.stringify(rest)
}

/** CV-080：提示词摘要（节点标题用）——压平空白后取前 max 字（默认 12）。 */
export function promptSummary(prompt: string, max = 12): string {
  const cleaned = prompt.replace(/\s+/gu, ' ').trim()
  if (cleaned.length === 0) return ''
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`
}

export interface MediaNodeTitleInput {
  isVideo: boolean
  /** 血缘里分镜卡节点（toolName=submit_storyboard_for_approval）的标题集合。 */
  shotTitles: readonly string[]
  /** 生成提示词原文（params.prompt）。 */
  prompt: string
}

/**
 * CV-080：生成节点标题（图层列表 / 节点头部显示，替代泛化的「图片 / 视频」）。
 * 规则：① 血缘含分镜卡时按镜号命名「分镜 N · 关键帧/视频」；② 否则用提示词
 * 摘要（前 12 字）；③ 两者皆缺返回 undefined，节点保持无 title（渲染层回退
 * 现有泛化标签，行为不变）。纯函数，单测直连。
 */
export function mediaNodeTitle(input: MediaNodeTitleInput): string | undefined {
  for (const shotTitle of input.shotTitles) {
    const match = /分镜\s*(\d+)/u.exec(shotTitle)
    if (match !== null) return `分镜 ${match[1]} · ${input.isVideo ? '视频' : '关键帧'}`
  }
  const summary = promptSummary(input.prompt)
  return summary.length > 0 ? summary : undefined
}

/** CV-079：组框内边距（与 client groupSelected 的 12px 一致）。 */
const GROUP_PADDING = 12

/**
 * CV-079：把新生成的关键帧/视频并入其分镜卡的「素材组」（自动编组）。
 * - 组不存在：新建 kind=group 节点（sourceIds 记住分镜卡 id，后续同镜产物
 *   据此找到组并入），组标题「分镜 N · 素材」；新节点 parentId 指向组。
 * - 组已存在：新节点并入，组框扩到新成员包围盒。
 * 纯函数：返回完整的新节点数组（其余节点原样 + 新节点 + 组），调用方整体
 * 写盘（writeCanvas 替代 appendCanvasNode）。
 */
export function attachShotGroup(
  nodes: readonly StudioCanvasNode[],
  shotCard: StudioCanvasNode,
  newNode: StudioCanvasNode,
): StudioCanvasNode[] {
  const existing = nodes.find(node => node.kind === 'group' && node.sourceIds.includes(shotCard.id))
  const match = /分镜\s*(\d+)/u.exec(shotCard.title ?? '')
  const groupTitle = match !== null ? `分镜 ${match[1]} · 素材` : (shotCard.title ?? '分镜素材')
  const parentId = existing?.id ?? `grp-${newNode.id}`
  const members = [...nodes.filter(node => node.parentId === parentId), newNode]
  const minX = Math.min(...members.map(member => member.x))
  const minY = Math.min(...members.map(member => member.y))
  const maxX = Math.max(...members.map(member => member.x + member.width))
  const maxY = Math.max(...members.map(member => member.y + member.height))
  const group: StudioCanvasNode = existing !== undefined
    ? {
        ...existing,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
      }
    : {
        id: parentId,
        kind: 'group',
        title: groupTitle,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
        createdAt: Date.now(),
        origin: 'agent',
        sourceIds: [shotCard.id],
        zIndex: -1,
      }
  const withParent: StudioCanvasNode = { ...newNode, parentId }
  return [...nodes.filter(node => node.id !== group.id), withParent, group]
}

/**
 * 按画布产物 URL 反查节点 id（血缘 sourceIds 的来源）。URL 兼容两种形态：
 * 工具结果里的同源相对路径（/canvas-studio/assets/...）与早期版本写死的
 * http://127.0.0.1:<port> 绝对路径 —— 都归一化到相对路径后精确匹配。
 */
export function resolveSourceIds(nodes: readonly StudioCanvasNode[], urls: readonly string[] | undefined): string[] {
  if (urls === undefined || urls.length === 0) return []
  const relative = (value: string): string => value.replace(/^https?:\/\/127\.0\.0\.1:\d+(\/canvas-studio\/.*)$/, '$1')
  const byUrl = new Map(nodes.map((node) => [node.url !== undefined ? relative(node.url) : '', node.id]))
  const ids: string[] = []
  for (const url of urls) {
    if (typeof url !== 'string' || url.length === 0) continue
    const id = byUrl.get(relative(url))
    if (id !== undefined && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * 按 Drama filename 反查画布节点 id（血缘自动补全）。生成参数里的
 * filename/filenames 都是素材节点落盘时写入的 Drama 文件名，
 * 据此可以确定性地还原「这次生成参考了哪些节点」——不依赖模型自觉填写
 * sourceUrls。与 URL 反查结果取并集后作为节点血缘。
 */
export function resolveSourceIdsByFilename(
  nodes: readonly StudioCanvasNode[],
  filenames: readonly (string | undefined)[],
): string[] {
  const byFilename = new Map(nodes.map((node) => [node.filename ?? '', node.id] as const))
  const out: string[] = []
  for (const name of filenames) {
    if (name === undefined || name.length === 0) continue
    const id = byFilename.get(name)
    if (id !== undefined && !out.includes(id)) out.push(id)
  }
  return out
}

/** 合并两种血缘来源（URL 反查 + filename 反查），去重保序。 */
export function mergeSourceIds(primary: readonly string[], secondary: readonly string[]): string[] {
  return [...primary, ...secondary.filter((id) => !primary.includes(id))]
}

/**
 * CV-031：从已解析的来源节点继承分镜卡血缘。视频经关键帧生成时
 * （video_generate / video_composite），模型常漏传 shotRefs，导致视频只连
 * 关键帧、不连分镜卡。只要关键帧节点已连着所属分镜卡
 * （toolName=submit_storyboard_for_approval），就把该卡并入新节点父集合 ——
 * 「分镜 → 关键帧 → 视频」叙事链不因模型漏参断链。只上溯一层且只认分镜卡，
 * 不扩散到创意等其它上游。
 */
export function inheritShotCardIds(nodes: readonly StudioCanvasNode[], sourceIds: readonly string[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const out: string[] = []
  for (const id of sourceIds) {
    const source = byId.get(id)
    if (source === undefined) continue
    for (const parentId of source.sourceIds) {
      const parent = byId.get(parentId)
      if (parent?.toolName !== 'submit_storyboard_for_approval') continue
      if (sourceIds.includes(parent.id) || out.includes(parent.id)) continue
      out.push(parent.id)
    }
  }
  return out
}

/** 落点网格常量（与客户端 project-store 的 LAYOUT 对齐）。 */
const PLACEMENT_GRID = { origin: 40, stepX: 300, stepY: 240, columns: 4 }
/** 血缘落位：新节点与来源节点右缘的间距。 */
const PLACEMENT_GAP = 60

/** 真实分辨率 → 画布显示框：统一走 src/canvas-aspect.ts 的 previewSizeOf。 */

/**
 * CV-024 落点策略：新节点排在其血缘来源节点的右侧一列（y 取来源最小 y），
 * 形成「创意 → 素材 → 生成物」的左到右流向；与现有节点重叠时逐步右移避让
 * （有界 50 步）。无来源时回退到与客户端一致的网格空位。
 * 必须在写入前用「当前画布节点」调用；多个子节点的调用方需在返回值基础上
 * 自行做行内偏移。
 */
export function deriveNodePlacement(
  nodes: readonly StudioCanvasNode[],
  sourceIds: readonly string[],
  width: number,
  height: number,
): { x: number; y: number } {
  const sources = sourceIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is StudioCanvasNode => node !== undefined)
  if (sources.length === 0) {
    const index = nodes.length
    return {
      x: PLACEMENT_GRID.origin + (index % PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepX,
      y: PLACEMENT_GRID.origin + Math.floor(index / PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepY,
    }
  }
  const left = Math.max(...sources.map((source) => source.x + source.width))
  const top = Math.min(...sources.map((source) => source.y))
  let x = left + PLACEMENT_GAP
  for (let step = 0; step < 50; step += 1) {
    const clash = nodes.some((node) =>
      x < node.x + node.width
      && x + width > node.x
      && top < node.y + node.height
      && top + height > node.y)
    if (!clash) break
    x += width + PLACEMENT_GAP
  }
  return { x, y: top }
}

/** 提示词增强：调用 Drama Backend 的 image2promptenhance 接口。 */
export async function enhancePrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = await callDramaRaw(DRAMA_ENDPOINTS.promptEnhance, { prompt }, signal)
  // CR-016：output/msg 都缺时不再把整个对象当字符串（`[object Object]`），
  // 序列化兜底，保证返回的一定是模型可读文本。
  const raw = data.output ?? data.msg
  return typeof raw === 'string' ? raw : JSON.stringify(raw ?? data)
}

/** 图像分析（VLM）：调用 Drama Backend 的 image2vl 接口，使用已上传的文件名。 */
export async function analyzeImage(
  filename: string,
  prompt: string,
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = await callDramaRaw(DRAMA_ENDPOINTS.image2vl, {
    image: filename,
    prompt,
    system_prompt: systemPrompt,
  }, signal)
  return (data.output ?? data.msg ?? JSON.stringify(data)) as string
}

/** 带 raw 响应解析的 callDrama（文本工具用，返回完整 JSON）。 */
async function callDramaRaw(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await dramaPost(
    endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    DRAMA_TIMEOUT_MS.text,
    signal,
  )
  if (!response.ok) {
    throw new Error(`生成失败: ${await describeError(response)}`)
  }
  return response.json() as Promise<Record<string, unknown>>
}

/**
 * 执行一次生成并落盘。
 * @param registry - 项目注册表（提供 assetsDir）。
 * @param tool - 生成工具名（image_generate / character_generate / video_generate / video_composite）。
 * @param projectId - 目标项目 id。
 * @param params - 生成参数。
 * @param signal - 取消信号。
 */
export async function generateAsset(
  registry: ProjectRegistry,
  tool: string,
  projectId: string,
  params: GenerateParams,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const projects = await registry.list()
  const project = projects.find((entry) => entry.id === projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)

  // CV-099：项目预置兜底，优先级 = 显式工具参数 > 项目 plan > 全局设置。
  // 画幅：未显式指定时补项目预置（仍缺省由 runtime().defaultAspectRatio() 兜底）。
  // 时长：单镜兜底（5/10s）钳到不超过目标总时长——单镜长过总时长必然超产；
  //       更长的目标总时长不在此拆镜，由 systemPrompt 引导 agent 按分镜规划。
  if (params.aspectRatio === undefined && project.plan?.aspectRatio !== undefined) {
    params.aspectRatio = project.plan.aspectRatio
  }
  const planTotal = project.plan?.targetDuration
  const perShotFallback = (base: number): number => (planTotal !== undefined ? Math.min(base, planTotal) : base)

  const size = sizeForAspectRatio(params.aspectRatio ?? runtime().defaultAspectRatio())
  // CV-028：画布显示框用预览尺寸；size（媒体分辨率）只进 Drama 请求体、
  // mediaWidth/mediaHeight 与工具返回值。
  const display = previewSizeOf(size)
  const isVideo = tool === 'video_generate' || tool === 'video_composite'
  // 占坑参数提示：model/generateAudio 尚未接入任何供应商（请求体不携带这些字段），
  // 显式传入时收集提示并随结果返回，避免 agent 误以为已生效。
  // 注意 resolution 不在此处统一提示：阶段 4 起 fal 真实消费该参数（升档映射），
  // 仅 Drama 侧维持「已忽略」占坑提示，条件在视频分支按实际供应商判定。
  const warnings: string[] = []
  if (isVideo) {
    if (params.model === 'seedance2') warnings.push('model=seedance2 暂未接入，当前后端统一走 FL2VA（H3 技术路线），本次按 h3 生成')
    // generateAudio / audioRefs 不再是占坑：已按 H3 官方标准透传给供应商
    // （见 providers/drama.ts、providers/fal.ts）。后端拒收时由视频自愈摘字段并回
    // warning，不再在此处假定「后端一定不支持」。
  }
  let mediaUrl: string
  // 生成类节点也要持久化 Drama 服务器文件名（fix: 让生成图可直接被后端链路引用，省掉重复 upload_image）。
  let dramaFilename: string | undefined

  // —— 参考图容错：filename 是 Drama temp/ 里的临时文件名，后端重启清存储
  // 后「名字还在、文件没了」（实测报笼统的 500 Internal Server Error）。
  // 此时不依赖模型自觉，Host 确定性自愈：按文件名反查画布节点的本地资产
  // （readCanvas + assetsDir），重传拿新 filename 并回写节点（与 host-tools
  // 的 backfillUploadFilename 同一不变式：节点 filename 必须是后端当前可用
  // 的名字），再带新名重试一次；反查不中时回退 sourceUrls 逐个重传（旧行为）。
  /**
   * 解析参考音频的**实测规格**（时长 / 字节数），供 H3 官方规格预检使用。
   *
   * - 时长优先取画布音频节点的 `duration`（CV-128 音频节点落盘时已记录真实时长）；
   *   拿不到就留 undefined 跳过时长项——**不猜**，避免误拦合法请求。
   * - 字节数从本地资产读（节点 url 的文件名 → assetsDir）；读不到同样跳过。
   */
  const collectAudioInputs = async (): Promise<AudioReferenceInput[]> => {
    const names = params.audioRefs ?? []
    if (names.length === 0) return []
    const doc = await registry.readCanvas(projectId)
    const byFilename = new Map(doc.nodes.map((node) => [node.filename ?? '', node] as const))
    const inputs: AudioReferenceInput[] = []
    for (const name of names) {
      const node = byFilename.get(name)
      const file = node?.url?.split('/').pop()
      let bytes: number | undefined
      if (file !== undefined && file.length > 0) {
        try {
          bytes = (await readLocalAssetBytes(registry, projectId, file)).bytes.byteLength
        } catch { /* 本地资产缺失：跳过大小项，不阻断（后端仍会校验） */ }
      }
      const seconds = typeof node?.duration === 'number' && node.duration > 0 ? node.duration : undefined
      inputs.push({
        label: name,
        ...(seconds !== undefined ? { seconds } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      })
    }
    return inputs
  }
  const collectProvidedNames = (): string[] => {
    const names: string[] = []
    if (params.filename) names.push(params.filename)
    if (params.filenames) names.push(...params.filenames)
    return names
  }
  const reuploadLocalAsset = async (file: string, sig?: AbortSignal): Promise<string> => {
    const { bytes, ext } = await readLocalAssetBytes(registry, projectId, file)
    return uploadBytesToDrama(bytes, ext, sig)
  }
  /** 按文件名反查节点重传：返回 旧名 → 新名 映射，并回写节点 filename。 */
  const refreshByCanvasNodes = async (sig?: AbortSignal): Promise<Map<string, string>> => {
    const mapping = new Map<string, string>()
    const doc = await registry.readCanvas(projectId)
    const byFilename = new Map(doc.nodes.map((node) => [node.filename ?? '', node] as const))
    const patchedNodes = new Map<string, StudioCanvasNode>()
    for (const name of collectProvidedNames()) {
      if (mapping.has(name)) continue
      const node = byFilename.get(name)
      const file = node?.url?.split('/').pop()
      if (node === undefined || file === undefined || file.length === 0) continue
      const fresh = await reuploadLocalAsset(file, sig)
      mapping.set(name, fresh)
      patchedNodes.set(node.id, { ...node, filename: fresh })
    }
    if (patchedNodes.size > 0) {
      await registry.writeCanvas(projectId, doc.nodes.map((node) => patchedNodes.get(node.id) ?? node))
    }
    return mapping
  }
  /** 兜底：模型显式提供 sourceUrls 时按序重传，按位映射到 provided 名字。 */
  const refreshBySourceUrls = async (sig?: AbortSignal): Promise<Map<string, string>> => {
    const fresh: string[] = []
    for (const u of params.sourceUrls ?? []) {
      const file = u.split('/').pop()
      if (!file) continue
      try {
        fresh.push(await reuploadLocalAsset(file, sig))
      } catch { /* 单个资产缺失跳过，映射不满时上层抛原始错误 */ }
    }
    const mapping = new Map<string, string>()
    collectProvidedNames().forEach((n, i) => { if (fresh[i] !== undefined) mapping.set(n, fresh[i]!) })
    return mapping
  }
  const callWithFallback = async (
    endpoint: string,
    body: Record<string, unknown>,
    kind: keyof typeof DRAMA_TIMEOUT_MS,
  ): Promise<{ url: string; filename?: string }> => {
    try {
      return await callDrama(endpoint, body, signal, kind)
    } catch (cause) {
      if (!isBadReferenceError(cause) || collectProvidedNames().length === 0) throw cause
      let mapping: Map<string, string>
      try {
        mapping = await refreshByCanvasNodes(signal)
        if (mapping.size === 0) mapping = await refreshBySourceUrls(signal)
      } catch {
        throw cause // 自愈失败（本地资产缺失 / 上传报错）→ 保留原始错误
      }
      if (mapping.size === 0) throw cause
      let patched = JSON.stringify(body)
      for (const [oldN, newN] of mapping) patched = patched.split(oldN).join(newN)
      return callDrama(endpoint, JSON.parse(patched) as Record<string, unknown>, signal, kind)
    }
  }

  if (tool === 'image_generate') {
    // 画风模式：anime（卡通）→ txt2imageanime（仅纯文生图）；realistic（默认，写实）走原 txt2image/image2image。
    // CV-153：后端 `image2image` 只有 image1/image2/image3 三个具名槽位，第 4 张会被**静默丢弃**
    // —— `slice` 不报错、不警告，用户看到的现象只是「风格没生效」而毫无线索（与 CV-145 的
    // 1×1 占位图同属「证据缺失导致的错误归因」）。这里补显式告警，复用既有 warnings 通道
    // （renderResult 会渲染成「注意: …」）。
    const providedRefs = params.filenames ?? []
    const refs = providedRefs.slice(0, 3)
    if (providedRefs.length > refs.length) {
      const dropped = providedRefs.slice(refs.length)
      warnings.push(
        `参考图最多 3 张生效（后端 image2image 仅 image1~image3），本次已忽略后 ${dropped.length} 张：${dropped.join('、')}`,
      )
    }
    const hasRef = refs.length > 0 || params.filename !== undefined
    if (params.style === 'anime' && !hasRef) {
      // 卡通文生图：txt2imageanime（日式动漫风格，z-anime-aio 工作流）。
      const _r = await callWithFallback(
        DRAMA_ENDPOINTS.txt2imageanime,
        {
          prompt: params.prompt,
          width: size.width,
          height: size.height,
          ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
        },
        'image',
      )
      mediaUrl = _r.url
      if (_r.filename !== undefined) dramaFilename = _r.filename
    } else if (hasRef) {
      // 图生图：image2image（最多 3 张参考，image1~image3）。anime 模式不支持图生图，回退写实。
      const imageKeys: Record<string, unknown> = {}
      if (refs.length > 0) {
        refs.forEach((image, i) => { imageKeys[`image${i + 1}`] = image })
      } else if (params.filename !== undefined) {
        imageKeys.image1 = params.filename
      }
      const _r = await callWithFallback(
        DRAMA_ENDPOINTS.image2image,
        {
          prompt: params.prompt,
          width: size.width,
          height: size.height,
          ...imageKeys,
          ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
        },
        'image',
      )
      mediaUrl = _r.url
      if (_r.filename !== undefined) dramaFilename = _r.filename
    } else {
      // 写实文生图：txt2image（nunchaku-z-image-turbo 工作流）。
      const _r = await callWithFallback(
        DRAMA_ENDPOINTS.txt2image,
        {
          prompt: params.prompt,
          width: size.width,
          height: size.height,
          ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
        },
        'image',
      )
      mediaUrl = _r.url
      if (_r.filename !== undefined) dramaFilename = _r.filename
    }
  } else if (tool === 'character_generate') {
    // 基于角色设计图生成角色立绘图（三视图）：image2character（qwen_4view_char_2step 工作流）。
    if (!params.filename) {
      throw new Error('character_generate 需要提供 filename（角色设计图，来自 upload_image 工具）')
    }
    const _r = await callWithFallback(
      DRAMA_ENDPOINTS.character,
      { image: params.filename },
      'image',
    )
    mediaUrl = _r.url
    if (_r.filename !== undefined) dramaFilename = _r.filename
  } else if (tool === 'video_generate' || tool === 'video_composite') {
    // 阶段 2：经「能力路由 + 供应商注册表 + 统一执行器」驱动，行为与改造前逐字节一致。
    // Drama 是同步供应商，executor 在 submit 内即拿到结果，不会进入轮询（零额外开销）。
    // 阶段 3：provider 优先级 = 参数显式指定（含重试回传）> 设置项 defaultVideoProvider > 'drama'。
    // parseProviderParam 对非法值抛错（约束 4：路由 provider 字段必须枚举校验）。
    if (tool === 'video_composite') {
      const filenames = params.filenames ?? []
      if (filenames.length < 1) throw new Error('video_composite 需要提供 filenames（来自 upload_image 工具）')
    }
    // —— H3 官方音频通道预检：规格不合就**不发出去**（官方是硬校验，超限会被截断
    // 或整单被拒——既白等一次调用，也可能悄悄产出不符预期的结果）。
    const visualCount = (params.filename !== undefined ? 1 : 0) + (params.filenames?.length ?? 0)
    const audioIssues = validateH3AudioReferences(await collectAudioInputs(), visualCount)
    if (audioIssues.length > 0) {
      throw new Error(
        `参考音频不符合 H3 官方规格（未发起生成）：\n${audioIssues.map((issue) => `- ${issue.message}`).join('\n')}`,
      )
    }
    // 官方：帧模式（首尾帧）与参考模式（r2v）互斥。带音频一律走 r2v——若调用方
    // 原本会是首尾帧插值，把语义变更说清楚，而不是静默按原意图生成。
    const modeNotice = audioModeNotice(capabilityOf(tool, { ...params, audioRefs: [] }), visualCount)
    if (modeNotice !== undefined) warnings.push(modeNotice)
    const preferred =
      parseProviderParam(params.provider) ?? runtime().defaultVideoProvider?.() ?? 'drama'
    const provider = resolveProvider(capabilityOf(tool, params), preferred)
    // resolution 占坑提示仅 Drama 生效（阶段 4 起 fal 真实消费 resolution，见 providers/fal.ts）。
    if (provider.id === 'drama' && params.resolution !== undefined) {
      warnings.push(`resolution=${params.resolution} 暂未接入，已忽略（以 aspectRatio 与后端默认分辨率输出）`)
    }
    const req = videoRequestOf(tool, params, perShotFallback(tool === 'video_generate' ? 5 : 10))
    const ctx: ProviderContext = {
      ...(signal !== undefined ? { signal } : {}),
      timeoutMs: DRAMA_TIMEOUT_MS.video,
      // 参考图失效自愈闭包（依赖本调用的 registry/projectId/params）以回调注入，
      // 由 Drama adapter 在 submit 内调用（详见 docs/plans/video-provider-abstraction.md §6）。
      dramaPostWithFallback: callWithFallback,
      // 阶段 4：fal 注入 —— key 解析（空串 = 未配置，adapter 报错）与参考图字节读取
      // （Drama filename → 本地资产字节 → adapter 内转 base64 data URI）。均为 `?.()`
      // 防御式调用：测试注入的 cfg mock 可能缺新字段，缺省按「未配置」处理。
      falApiKey: () => runtime().resolveFalApiKey?.() ?? Promise.resolve(''),
      readReferenceBytes: (ref) => readLocalAssetBytes(registry, projectId, ref.localPath),
    }
    let outcome: Awaited<ReturnType<typeof runVideo>>
    try {
      outcome = await runVideo(provider, req, ctx)
    } catch (error) {
      // 后端尚未开放音频入参时，笼统的 500 会被误读成「参考图失效」或「提示词问题」
      // ——那两条自愈路径都救不了音频字段。此处把音频参数显式点出来，让 agent
      // 能一眼定位到真正原因，而不是在错误方向上反复重试。
      const audioCount = params.audioRefs?.length ?? 0
      if (audioCount === 0 && params.generateAudio === undefined) throw error
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `视频生成失败：${detail}\n`
        + `本次带了 H3 音频参数（参考音频 ${audioCount} 段`
        + `${params.generateAudio !== undefined ? `、generateAudio=${params.generateAudio}` : ''}）：`
        + '若后端尚未开放音频入参，去掉这些参数后重试。',
      )
    }
    mediaUrl = outcome.url
    if (outcome.filename !== undefined) dramaFilename = outcome.filename
    // 供应商在 submit 阶段产生的非致命提示（时长钳制 / 分辨率升档）汇入结果 warnings。
    if (outcome.warnings !== undefined) warnings.push(...outcome.warnings)
  } else {
    throw new Error(`未知的生成工具: ${tool}`)
  }

  const finalFilename = dramaFilename
  // CR-010：产物下载带超时与字节上限（视频最慢，用媒体档参数），不再无限阻塞/整读。
  const bytes = await downloadBytes(mediaUrl, signal, {
    maxBytes: MEDIA_DOWNLOAD_MAX_BYTES,
    timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
    label: '产物下载',
  })

  const assetId = newAssetId()
  const extension = isVideo ? 'mp4' : 'png'
  const filename = `${assetId}.${extension}`
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, filename), bytes)

  // 同源相对路径：渲染进程与 webServer 同源，相对 URL 自动解析到当前端口，
  // 桌面重启换端口也不失效（此前写死 127.0.0.1:<port> 在端口变化后会 404）。
  const url = `/canvas-studio/assets/${projectId}/${filename}`

  // CV-140：把「请求时长」换成「真实时长」。`duration` 是画布角标 / 时间线 /
  // list_shots / 合成时长锚点的共同数据源——存请求值等于拿没校准的尺子量音画
  // 同步（实测请求 5s → 真实 5.167s，H3 按帧率量化成 124 帧）。产物刚落本地盘，
  // 就地探测；ffmpeg 不可用或探测失败时回退请求值并留 warning，不阻断生成。
  const declaredDuration = isVideo
    ? clampDuration(params.duration, perShotFallback(tool === 'video_composite' ? 10 : 5))
    : undefined
  let mediaDuration = declaredDuration
  if (isVideo && declaredDuration !== undefined) {
    const probed = await probeMediaDuration(join(directory, filename), undefined, signal)
    if (probed > 0) {
      mediaDuration = probed
    } else {
      warnings.push(`未能探测产物真实时长，本次按请求值 ${declaredDuration}s 记录（后续音画对齐可能偏一帧量级）。`)
    }
  }
  // 两个字段同写同不写，避免出现「有 duration 无 declaredDuration」的半截节点。
  const durationFields = mediaDuration === undefined
    ? {}
    : { duration: mediaDuration, ...(declaredDuration !== undefined ? { declaredDuration } : {}) }

  // Persist a canvas node the moment the asset lands on disk (Host is the
  // source of truth). The client reloads the canvas document on tool/result,
  // so a successful generation shows on the canvas even if the conversation
  // event's rendered text carries no usable URL.
  // 血缘：sourceUrls（agent 显式提供）与 filename 反查（确定性，不依赖模型
  // 自觉）取并集——生成参数里的 filename(s) 都是素材节点的
  // Drama 文件名，可精确还原参考了哪些画布节点；shotNodeIds 是分镜卡
  // （CV-027），让关键帧/视频连到所属分镜并右侧落位。
  const canvasNodes = (await registry.readCanvas(projectId)).nodes
  const resolvedSources = mergeSourceIds(
    mergeSourceIds(
      resolveSourceIds(canvasNodes, params.sourceUrls),
      resolveSourceIdsByFilename(canvasNodes, [params.filename, ...(params.filenames ?? [])]),
    ),
    params.shotNodeIds ?? [],
  )
  // CV-031：来源节点（关键帧）挂着分镜卡时自动继承——模型漏传 shotRefs 也
  // 不断链（实测各项目视频全部只连关键帧，即此根因）。
  const sourceIds = mergeSourceIds(resolvedSources, inheritShotCardIds(canvasNodes, resolvedSources))

  // CV-108：本次产物的落点节点 id 与被取代的旧版 id（回传给工具，供 agent
  // 精确引用 clipIds / replaces，无需再猜节点是哪张卡）。
  let createdNodeId: string | undefined
  let supersededIds: string[] = []
  // 节点级重试（params.retryOf）：原地更新已有节点，保留 id/位置/血缘/编组，
  // 边不增加（plan §7.8 标准 2）。普通生成则追加新节点。
  if (params.retryOf !== undefined) {
    const existing = (await registry.readCanvas(projectId)).nodes
    const target = existing.find((node) => node.id === params.retryOf)
    if (target === undefined) {
      throw new Error(`重试目标节点不存在: ${params.retryOf}`)
    }
    const { error: _staleError, ...targetRest } = target
    const updated: StudioCanvasNode = {
      ...targetRest,
      url,
      ...(finalFilename !== undefined ? { filename: finalFilename } : {}),
      width: display.width,
      height: display.height,
      mediaWidth: size.width,
      mediaHeight: size.height,
      operationType: operationTypeOf(tool, params),
      toolName: tool,
      generationPrompt: generationPromptOf(params),
      ...(isVideo ? { duration: clampDuration(params.duration, perShotFallback(tool === 'video_composite' ? 10 : 5)) } : {}),
      ...(isVideo && params.shotTransition !== undefined ? { shotTransition: params.shotTransition } : {}),
    }
    await registry.writeCanvas(projectId, existing.map((node) => (node.id === target.id ? updated : node)))
    createdNodeId = target.id
  } else {
    // CV-024：落点 = 血缘来源右侧（自动反查的 sourceIds），不再全叠在原点。
    const placement = deriveNodePlacement(canvasNodes, sourceIds, display.width, display.height)
    // CV-080：按血缘里的分镜卡镜号 / 提示词摘要命名（无 title 时渲染层回退泛化标签）。
    const shotCards = sourceIds
      .map((id) => canvasNodes.find((node) => node.id === id))
      .filter((node): node is StudioCanvasNode => node?.toolName === 'submit_storyboard_for_approval')
    const nodeTitle = mediaNodeTitle({ isVideo, shotTitles: shotCards.map(node => node.title ?? ''), prompt: params.prompt })
    // CV-108：同镜位版本链。视频产物落盘前先算取代关系——指纹相同（同参考图
    // + 同时长 + 同分镜卡）视为重复生成，agent 显式传 replaces 视为返工新版，
    // 命中者一律标记失效，不再进默认合成。图片产物不参与（参考图多版本是有意的）。
    // CV-108：指纹用**请求值**（declaredDuration）而非探测真值——同样输入必然
    // 落到同一个请求时长，指纹稳定；真值含帧量化尾数，不参与判重。
    const nodeDuration = declaredDuration
    const supersedePlan = isVideo
      ? planSupersede(canvasNodes, {
          toolName: tool,
          ...(params.filename !== undefined ? { filename: params.filename } : {}),
          ...(params.filenames !== undefined ? { filenames: params.filenames } : {}),
          ...(nodeDuration !== undefined ? { duration: nodeDuration } : {}),
          ...(params.shotNodeIds !== undefined ? { shotNodeIds: params.shotNodeIds } : {}),
        }, params.replaces)
      : { version: 1, supersedeIds: [] as string[] }
    const node: StudioCanvasNode = {
      id: assetId,
      kind: isVideo ? 'video' : 'image',
      url,
      ...(finalFilename !== undefined ? { filename: finalFilename } : {}),
      ...(nodeTitle !== undefined ? { title: nodeTitle } : {}),
      // 图片产物默认成为可复用参考（参考托盘 / list_references 来源）；
      // 视频暂不直接作为工具参考图，故不标记。
      ...(isVideo ? {} : { isReference: true, referenceRole: 'image' as const }),
      x: placement.x,
      y: placement.y,
      width: display.width,
      height: display.height,
      createdAt: Date.now(),
      toolName: tool,
      runId: assetId,
      origin: 'agent',
      sourceIds,
      operationType: operationTypeOf(tool, params),
      generationPrompt: generationPromptOf(params),
      mediaWidth: size.width,
      mediaHeight: size.height,
      ...durationFields,
      ...(isVideo && params.shotTransition !== undefined ? { shotTransition: params.shotTransition } : {}),
      ...(supersedePlan.supersedeIds.length > 0
        ? { shotVersion: supersedePlan.version, supersedes: supersedePlan.supersedeIds }
        : {}),
    }
    // CV-079：有分镜卡血缘时并入「分镜 N · 素材」组（不存在则建组）；无
    // 分镜卡保持 appendCanvasNode 旧行为。整体写盘替代单节点追加。
    const shotCard = shotCards[0]
    if (shotCard !== undefined) {
      await registry.writeCanvas(projectId, attachShotGroup(canvasNodes, shotCard, node))
    } else {
      await registry.appendCanvasNode(projectId, node)
    }
    // CV-108：把被取代的旧版标记失效（新节点已落盘，二次写盘补 supersededBy）。
    if (supersedePlan.supersedeIds.length > 0) {
      const persisted = (await registry.readCanvas(projectId)).nodes
      await registry.writeCanvas(projectId, applySupersede(persisted, node.id, supersedePlan.supersedeIds))
    }
    supersededIds = supersedePlan.supersedeIds
    createdNodeId = node.id
  }

  const result: GenerateResult = { url, width: size.width, height: size.height }
  // CV-140：回传真实时长（探测失败时即请求值），下游按它算成片总长。
  if (isVideo && mediaDuration !== undefined) result.duration = mediaDuration
  if (finalFilename !== undefined) result.filename = finalFilename
  if (createdNodeId !== undefined) result.nodeId = createdNodeId
  if (supersededIds.length > 0) result.superseded = supersededIds
  if (warnings.length > 0) result.warnings = warnings
  return result
}

// 导出供 host-tools.ts 中 upload_image 工具使用。
export { uploadImage, resolveImageUrl }

/**
 * C1：基于角色设计图/定妆照生成四视图立绘（白底：正面特写/侧面全身/背面全身，
 * Drama `image2character` qwen_4view_char_2step 工作流），并建立项目级
 * 一致性资产卡（StudioAsset）。CV-122：锚点 = 四视图拼图整图（上游官方
 * reference-sheet 用法——拼图自带角色/视角标签，下游直接整图作参考），
 * 不再切分：2026-09-11 收敛时 `image2splitegrid` 端点与 storyboard_split 工具
 * 已一并删除，由此砍掉整类切分 500 故障与逐片下载/上传开销。
 */
export interface CharacterSheetParams {
  /** 角色设计图/定妆照在 Drama Backend 的服务器文件名（来自 upload_image）。 */
  filename: string
  /** 资产卡显示名（如「女主」）。 */
  assetName: string
  /** 冻结的 SAME 块文本：外貌/发型/服装/配色/光感固定描述。 */
  lockedPrompt: string
  /** 负面约束（如「不更换服装」），可选。 */
  negativePrompt?: string
  /** 设计图的画布产物 URL（反查节点、画血缘箭头），可选。 */
  sourceUrls?: string[]
}

export interface CharacterSheetResult {
  /** 四视图拼图的同源 URL（画布节点已落盘，即资产卡唯一锚点）。 */
  url: string
  /** 建立/更新的资产卡 id。 */
  assetId: string
  /** 资产卡显示名。 */
  name: string
  /** 四视图拼图的 Drama 文件名（可直接用于 image_generate / video_composite 的 filenames）。 */
  filename: string
}

/**
 * C2：资产卡槽位解析——**同名即覆盖**（复用原 id），不同名才新建。
 * 冻结的 lockedPrompt 写错时，重调 character_sheet 传同名即可整体更新，
 * 不会在注册表里堆积同角色的多张卡。
 * @param assets - 项目现有资产卡。
 * @param name - 本次资产卡显示名。
 * @param mint - 新建时生成 id 的回调（测试可注入确定性 id）。
 */
export function resolveAssetSlot(
  assets: readonly StudioAsset[] | undefined,
  name: string,
  mint: () => string,
): { id: string; replacing: boolean } {
  const hit = assets?.find((entry) => entry.name === name)
  return hit !== undefined ? { id: hit.id, replacing: true } : { id: mint(), replacing: false }
}

export async function generateCharacterSheet(
  registry: ProjectRegistry,
  projectId: string,
  params: CharacterSheetParams,
  signal?: AbortSignal,
): Promise<CharacterSheetResult> {
  // 1) 四视图立绘（确定性 ComfyUI 工作流，图片级超时）。
  // 参考图容错与 runGeneration.callWithFallback 同一不变式：输入 filename 是
  // Drama temp/ 临时名，后端重启清存储后「名字还在、文件没了」（实测报笼统
  // 500 Internal Server Error）。本工具是 runGeneration 之外唯一带图输入的
  // 生成入口，补齐同款确定性自愈：按文件名反查画布节点 → 本地资产重传换
  // 新名 → 回写节点 filename → 带新名重试一次；反查不中时抛原始错误。
  const fetchSheet = (image: string) => callDrama(DRAMA_ENDPOINTS.character, { image }, signal)
  const sheet = await fetchSheet(params.filename).catch(async (cause) => {
    if (!isBadReferenceError(cause)) throw cause
    const doc = await registry.readCanvas(projectId)
    const node = doc.nodes.find((n) => n.filename === params.filename)
    const file = node?.url?.split('/').pop()
    if (node === undefined || file === undefined || file.length === 0) throw cause
    const { bytes, ext } = await readLocalAssetBytes(registry, projectId, file)
    const fresh = await uploadBytesToDrama(bytes, ext, signal)
    await registry.writeCanvas(projectId, doc.nodes.map((n) => (n.id === node.id ? { ...n, filename: fresh } : n)))
    return fetchSheet(fresh)
  })
  const { url: sheetRemoteUrl, filename: sheetDramaName } = sheet

  // 2) 拼图下载落盘 + 落画布节点（资产卡唯一锚点）。资产卡 id 在此提前生成，
  // 拼图节点携带，保证节点 → 资产卡的双向可追溯。
  const canvas = await registry.readCanvas(projectId)
  const sourceIds = resolveSourceIds(canvas.nodes, params.sourceUrls)
  // C2：同名卡命中即覆盖（冻结文案写错时重调即可更新），不另建卡。
  const slot = resolveAssetSlot(canvas.assets, params.assetName, newAssetId)
  const assetId = slot.id
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  const sheetDownload = await fetch(sheetRemoteUrl, { signal: signal ?? null })
  if (!sheetDownload.ok) throw new Error(`三视图拼图下载失败: ${sheetDownload.status}`)
  const sheetBytes = Buffer.from(await sheetDownload.arrayBuffer())
  const sheetNodeId = newAssetId()
  const sheetFile = `${sheetNodeId}.png`
  await writeFile(join(directory, sheetFile), sheetBytes)
  const sheetUrl = `/canvas-studio/assets/${projectId}/${sheetFile}`
  const sheetNode: StudioCanvasNode = {
    id: sheetNodeId,
    kind: 'image',
    url: sheetUrl,
    isReference: true,
    referenceRole: 'character',
    x: 0,
    y: 0,
    width: 260,
    height: 180,
    createdAt: Date.now(),
    toolName: 'character_sheet',
    runId: sheetNodeId,
    origin: 'agent',
    sourceIds,
    operationType: 'text-to-image',
    generationPrompt: JSON.stringify({ image: params.filename, step: 'four-view' }),
    assetId,
  }
  await registry.appendCanvasNode(projectId, sheetNode)

  // 3) 建立资产卡。锚点 = 四视图拼图整图单节点（CV-122：不再切分——
  // 上游官方 reference-sheet 用法，拼图整图直接作下游参考）。
  const anchorNodeIds = [sheetNodeId]
  // 覆盖场景：先把不再属于本卡的旧锚点节点摘干净，再写卡片，避免旧分图
  // 继续以 assetId 冒充当前锚点（同名覆盖的语义 = 换掉锚点与冻结描述）。
  if (slot.replacing) await registry.releaseAssetNodes(projectId, assetId, anchorNodeIds)
  await registry.upsertAsset(projectId, {
    id: assetId,
    name: params.assetName,
    role: 'character',
    anchorNodeIds,
    lockedPrompt: params.lockedPrompt,
    ...(params.negativePrompt !== undefined ? { negativePrompt: params.negativePrompt } : {}),
    createdAt: Date.now(),
  })

  return { url: sheetUrl, assetId, name: params.assetName, filename: sheetDramaName ?? params.filename }
}

/**
 * CV-125：文本生成音乐（Drama `txt2audio`，ACE Step Audio 工作流）。
 * 返回 mp3 产物：下载落盘 + 落画布节点（kind=video 复用 BGM 既有消费路径——
 * HTML video 元素可直接播放 mp3，compose_video 的 bgmNodeId 混音走 ffmpeg amix
 * 对音频容器同样适用）。节点可直接作 compose_video 的 bgmNodeId。
 */

/**
 * 纯器乐的 lyrics 占位值（本体已移到共享契约 `contracts/canvas.ts`，因为客户端
 * 渲染音频卡片时也要用它区分「纯器乐」与「真歌词」）。此处转出保持既有导入面
 * 不变（`lib/generate.js` 的 INSTRUMENTAL_LYRICS 仍可用）。
 */
export { INSTRUMENTAL_LYRICS }
/** 音乐默认时长（秒），与 music_generation 工具描述声明的缺省一致。 */
export const DEFAULT_MUSIC_DURATION = 30
/** 音乐默认速度，与工具描述声明的缺省一致。 */
export const DEFAULT_MUSIC_BPM = 128

/**
 * CV-127b：音乐生成的「可降级」字段，按丢弃优先级排序。
 *
 * 这三个都是**非核心元数据**：后端不接受时摘掉仍能出音频（由后端自行推断），
 * 而 caption / lyrics / duration 摘掉会直接改变作品本身，不可降级。
 */
const MUSIC_DEGRADABLE_FIELDS = ['keyscale', 'timesignature', 'bpm'] as const
/** 快速失败阈值（ms）：低于此值 = 请求没进生成队列（参数未被接受）；高于 = 生成中崩溃。 */
const MUSIC_FAST_FAIL_MS = 2000
/** 最多尝试次数（含首次）。 */
const MUSIC_MAX_ATTEMPTS = 3

/**
 * CV-127b：决定音乐生成失败后的下一次尝试怎么发。
 *
 * 实测 `txt2audio` 有两种 500（同为 500、都不给原因）：
 *  - **快失败**（~0.07s）：请求没进队列，参数大概率不被接受 → 重试同参数没意义，
 *    摘掉一个非核心字段再试。
 *  - **慢失败**（≈正常生成耗时，如 8.6s）：生成过程中崩，**纯偶发**——同参数
 *    重跑一次大概率成功（实测同参数 `E minor` 一次 200 一次 500）→ 原样重试。
 *    但已重试过一次还失败就别再傻等了，改为摘字段。
 *
 * 纯函数便于单测各种失败组合；返回 null 表示放弃。
 *
 * @param body 上一次尝试的请求体
 * @param attempt 已完成的尝试次数（1 = 首次失败）
 * @param elapsedMs 上一次尝试的耗时
 */
export function planMusicRetry(
  body: Record<string, unknown>,
  attempt: number,
  elapsedMs: number,
): Record<string, unknown> | null {
  if (attempt >= MUSIC_MAX_ATTEMPTS) return null
  const remaining = MUSIC_DEGRADABLE_FIELDS.filter((field) => field in body)
  const dropOne = (): Record<string, unknown> | null => {
    const target = remaining[0]
    if (target === undefined) return null
    const next = { ...body }
    delete next[target]
    return next
  }
  // 快失败：参数没被接受 → 摘字段
  if (elapsedMs < MUSIC_FAST_FAIL_MS) {
    const dropped = dropOne()
    if (dropped !== null) return dropped
  }
  // 慢失败：先原样重试一次（偶发）；第二次仍失败则摘字段，避免无意义的重复等待
  if (attempt >= 2) {
    const dropped = dropOne()
    if (dropped !== null) return dropped
  }
  return { ...body }
}
export interface MusicParams {
  /** 音频整体描述（tags：情绪/风格/乐器/节奏）。 */
  captionPrompt: string
  /** 歌词提示词（有歌声时给歌词结构，纯器乐留空）。 */
  lyricsPrompt?: string
  /** 音频时长（秒），默认 30。 */
  duration?: number
  /** 每分钟节拍数，默认 128。 */
  bpm?: number
  /** 调式（root + quality，如「Bb major」「A minor」）。 */
  keyscale?: string
  /** 语言代码（如 zh / en；unknown=纯器乐无人声）。 */
  language?: string
  /** 拍号：2 / 3 / 4 / 6。 */
  timesignature?: string
  /** 关联的画布产物 URL（画血缘箭头），可选。 */
  sourceUrls?: string[]
}

export interface MusicResult {
  /** 音频的同源 URL（画布节点已落盘）。 */
  url: string
  /** Drama 侧文件名（mp3）。 */
  filename: string
  /** 画布节点 id（可直接作 compose_video 的 bgmNodeId）。 */
  nodeId: string
  /**
   * CV-140：**真实**音频时长（秒，落盘后 ffprobe 实测；探测失败回退请求值）。
   * 这是成片时长守卫的判据来源，也是画布角标/时间线显示的值。
   * ⚠️ 响应里的 `duration` 字段是**生成耗时**（30s 音频返回 8.56），不是音频
   * 时长 —— 本字段与它无关，勿改用响应值。请求值见 `declaredDuration`。
   */
  duration: number
  /** CV-140：下当时的请求时长（秒）。真实值与它可能差几十毫秒（实测 30→30.024）。 */
  declaredDuration: number
  /** CV-127：实际使用的 bpm（未显式传时为缺省 128）。供分镜按拍拆镜参考。 */
  bpm: number
  /**
   * CV-130：实际提交给后端的歌词（纯器乐为 `[Instrumental]`）。已随画布节点
   * 落盘，这里回显供模型知道自己「唱的是什么」，避免复述用户输入时不一致。
   */
  lyrics: string
  /**
   * CV-127b：本次生成**实际被忽略**的参数名（后端不接受，已自动降级摘除）。
   * 空数组 = 请求的参数全部生效。⚠️ 非空时必须让模型知道——否则它会以为
   * 自己拿到了指定调性/拍号的曲子（「智能体错觉」的主要来源）。
   */
  degradedFields: string[]
  /** CV-127b：实际尝试次数（>1 表示首次失败后重试成功）。 */
  attempts: number
}

export async function generateMusic(
  registry: ProjectRegistry,
  projectId: string,
  params: MusicParams,
  signal?: AbortSignal,
): Promise<MusicResult> {
  const duration = params.duration !== undefined ? Math.max(1, Math.round(params.duration)) : DEFAULT_MUSIC_DURATION
  const bpm = params.bpm !== undefined ? Math.max(1, Math.round(params.bpm)) : DEFAULT_MUSIC_BPM
  // CV-130：先把「生效歌词」定下来——纯器乐显式填 [Instrumental]。空串一并兜住
  // ——agent 显式传 "" 时也要按纯器乐处理（此前 `??` 只在 undefined 时生效）。
  // 定成局部变量是为了后面原样写进节点 `lyrics`：画布上显示的就是真正提交给
  // 后端的那份歌词，不是参数拼串，也不是原始输入。
  const effectiveLyrics = params.lyricsPrompt !== undefined && params.lyricsPrompt.trim() !== ''
    ? params.lyricsPrompt
    : INSTRUMENTAL_LYRICS
  const body: Record<string, unknown> = {
    caption_prompt: params.captionPrompt,
    lyrics_prompt: effectiveLyrics,
    duration,
    bpm,
    ...(params.keyscale !== undefined ? { keyscale: params.keyscale } : {}),
    ...(params.language !== undefined ? { language: params.language } : {}),
    ...(params.timesignature !== undefined ? { timesignature: params.timesignature } : {}),
  }
  // CV-127b：txt2audio 实测存在**偶发 500**（同参数一次 200 一次 500）且一律
  // 不返回原因，所以这里必须自愈——纯文本输入同样会失败，CV-125 时「不需
  // callWithFallback」的判断是错的。策略见 planMusicRetry：快失败摘字段、
  // 慢失败原样重试。超时沿用 image 档（360s）。
  let attempt = 0
  let requestBody = body
  const degradedFields: string[] = []
  let remoteUrl = ''
  let filename: string | undefined
  for (;;) {
    attempt += 1
    const startedAt = Date.now()
    try {
      const produced = await callDrama(DRAMA_ENDPOINTS.txt2audio, requestBody, signal)
      remoteUrl = produced.url
      filename = produced.filename
      break
    } catch (error) {
      const next = planMusicRetry(requestBody, attempt, Date.now() - startedAt)
      if (next === null) throw error
      for (const field of MUSIC_DEGRADABLE_FIELDS) {
        if (field in requestBody && !(field in next)) degradedFields.push(field)
      }
      requestBody = next
    }
  }
  const canvas = await registry.readCanvas(projectId)
  const sourceIds = resolveSourceIds(canvas.nodes, params.sourceUrls)
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  const download = await fetch(remoteUrl, { signal: signal ?? null })
  if (!download.ok) throw new Error(`音频下载失败: ${download.status}`)
  const bytes = Buffer.from(await download.arrayBuffer())
  const nodeId = newAssetId()
  const file = `${nodeId}.mp3`
  await writeFile(join(directory, file), bytes)
  const url = `/canvas-studio/assets/${projectId}/${file}`
  // CV-140：探测真实音频时长，取代原先「≈请求值 ±0.03s」的估算——compose 的
  // BGM 时长守卫要拿它跟成片真值比，估算值会在边界上误判（15.024 与 15.000 之
  // 差正是「BGM 比成片短」这类报错能不能触发的分野）。探测失败仍回退请求值。
  const probedDuration = await probeMediaDuration(join(directory, file), undefined, signal)
  const realDuration = probedDuration > 0 ? probedDuration : duration
  // CV-128：独立 kind='audio'（此前复用 kind='video'，会被取镜逻辑当成一镜）。
  const node: StudioCanvasNode = {
    id: nodeId,
    kind: 'audio',
    url,
    x: 0,
    y: 0,
    // CV-130：尺寸取契约常量（与 client NODE_SIZE.audio / 占位节点同源），
    // 卡片四行 = 标题 + 波形 + 播放条 + 歌词摘要。
    width: AUDIO_NODE_WIDTH,
    height: AUDIO_NODE_HEIGHT,
    createdAt: Date.now(),
    title: 'BGM',
    // CV-140：真实时长（ffprobe 实测；探测失败回退请求值）。节点角标、时间线
    // 与 compose 的时长守卫都读它。
    duration: realDuration,
    /** 请求时长，见 `duration` 注释。 */
    declaredDuration: duration,
    // CV-130：歌词随节点落盘 —— 画布卡片显示首行、播放器窗口显示全文。
    // 纯器乐存 [Instrumental] 占位串，UI 侧识别后渲染成「纯器乐」。
    lyrics: effectiveLyrics,
    toolName: 'music_generation',
    runId: nodeId,
    origin: 'agent',
    sourceIds,
    operationType: 'text-to-audio',
    // 记最终生效的请求体（降级后与原始请求不同），便于回溯「到底按什么参数生成的」。
    generationPrompt: JSON.stringify(requestBody),
  }
  await registry.appendCanvasNode(projectId, node)
  return { url, filename: filename ?? file, nodeId, duration: realDuration, declaredDuration: duration, bpm, lyrics: effectiveLyrics, degradedFields, attempts: attempt }
}
