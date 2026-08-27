/**
 * Canvas Studio P3 媒体生成（Host 侧）。
 *
 * 调用 Drama Backend（参考 WL 适配器），下载产物并落盘到项目 `assets/`，
 * 返回 webServer 托管的 URL。浏览器侧工具经 `/canvas-studio/generate` 路由
 * 调用本模块，规避渲染进程的 CORS 限制。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DRAMA_ENDPOINTS,
  newAssetId,
  sizeForAspectRatio,
} from './config.js'
import type { ProjectRegistry } from './projects.js'
import type { StudioCanvasNode, StudioCanvasOperationType } from './contracts/canvas.js'
import type { StudioRuntimeConfig } from './host-tools.js'

/** 运行时配置（由 Host 经 setRuntimeConfig 注入；Drama 调用的基址/时长/密钥均从此读取）。 */
let current: StudioRuntimeConfig | null = null
export function setRuntimeConfig(cfg: StudioRuntimeConfig): void { current = cfg }

/** 一次生成的请求参数（来自客户端工具）。 */
export interface GenerateParams {
  prompt: string
  aspectRatio?: string
  /** 已上传到 Drama Backend 的服务器文件名（image_generate 图生图 / video_generate / style_transfer / image2vl / storyboard_generate 用）。 */
  filename?: string
  /** 已上传的 Drama Backend 文件名数组（video_composite 用）。 */
  filenames?: string[]
  /** 风格迁移的参考风格图文件名（style_transfer 用，已上传到 Drama Backend）。 */
  styleFilename?: string
  negativePrompt?: string
  duration?: number
  /** 分镜格子数量（storyboard_generate 用，默认 4）。 */
  gridnum?: number
  /** 是否增强风格迁移效果（style_transfer 用）。 */
  enhance?: boolean
  /**
   * 节点级重试锚点：设置时把结果写回该已有节点（保留 id/位置/血缘），
   * 而不是追加新节点 —— 重试不产生新边（plan §7.8 标准 2）。
   */
  retryOf?: string
  /**
   * 输入参考图对应的画布产物 URL（工具结果里的 url 字段）。落盘时按 URL
   * 反查画布节点并写入 sourceIds —— 血缘边（流程箭头）的唯一来源；缺省
   * 时新节点没有边（历史行为）。
   */
  sourceUrls?: string[]
}

/** 一次生成的产物描述（返回给模型）。 */
export interface GenerateResult {
  url: string
  width: number
  height: number
  duration?: number
  /** Drama Backend 服务器文件名（storyboard_generate 透出，供 storyboard_split 链式调用）。 */
  filename?: string
}

/** 钳制视频时长：1–maxVideoSeconds() 取整；未提供时用各工具的默认值。maxVideoSeconds 来自设置。 */
export function clampDuration(value: number | undefined, fallback: number): number {
  return Math.min(current!.maxVideoSeconds(), Math.max(1, Math.round(value ?? fallback)))
}

/** 把参考图列表收敛到最多 max 张：保留首/尾，中间均匀采样，避免超出接口上限。 */
function sliceToMax(images: string[], max: number): string[] {
  if (images.length <= max) return images
  const step = (images.length - 1) / (max - 1)
  const out: string[] = []
  for (let i = 0; i < max; i++) out.push(images[Math.round(i * step)]!)
  return out
}

/** Drama Backend 调用超时（毫秒）：视频生成最慢，文本类最快。 */
const DRAMA_TIMEOUT_MS = { image: 360_000, video: 600_000, text: 180_000 }

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
    const response = await fetch(`${current!.dramaApiBase()}${DRAMA_ENDPOINTS.health}`, { signal: composed })
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

/** 带超时与一次性自动重试的 Drama POST（网络错误 / 502/503/504 时重试）。 */
async function dramaPost(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  // 探针前置：宕机时在这里就抛中文错误，不进入生成请求的长超时。
  await ensureDramaReachable(signal)
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetch(`${current!.dramaApiBase()}${endpoint}`, { ...init, signal: composed })
      if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt === 0) {
        lastError = new Error(`Drama Backend 暂时不可用（HTTP ${response.status}），已自动重试一次`)
        continue
      }
      return response
    } catch (cause) {
      // 用户主动打断不重试、不改写错误。
      if (signal?.aborted) throw cause
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
 * 2) 本地文件路径 / file://：直接读盘（节点 url 偶尔存成本地路径）。
 * 3) 其它 URL（含非资产匹配的相对路径）：补全 loopback 端口后下载。
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
  // 2) 本地绝对文件路径 / file:// → 读盘。
  const localPath = source.startsWith('file://') ? fileURLToPath(source) : (isAbsolute(source) ? source : '')
  if (localPath.length > 0 && existsSync(localPath)) {
    const ext = extname(localPath).replace(/^\./, '') || 'png'
    return { bytes: await readFile(localPath), ext }
  }
  // 3) 其它 URL（含非资产匹配的相对路径补全端口后下载）。
  const url = port !== undefined && source.startsWith('/') ? resolveImageUrl(source, port) : source
  const response = await fetch(url, { signal: signal ?? null })
  if (!response.ok) throw new Error(`参考图下载失败: ${response.status}`)
  const buf = Buffer.from(await response.arrayBuffer())
  let ext = 'png'
  try { ext = extname(new URL(response.url).pathname).replace(/^\./, '') || 'png' } catch { /* keep png */ }
  return { bytes: buf, ext }
}

/** 上传一张图（本地路径 / canvas 资产 URL / 托管 URL）到 Drama Backend，返回服务器 filename。 */
async function uploadImage(sourceUrl: string, signal?: AbortSignal, port?: number, registry?: ProjectRegistry): Promise<string> {
  await ensureDramaReachable(signal)
  const { bytes, ext } = await readSourceBytes(sourceUrl, port, signal, registry)
  return uploadBytesToDrama(bytes, ext, signal)
}

/**
 * 把图片字节上传到 Drama Backend（`uploadimage`），返回服务器 filename。
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
  const upload = await fetch(`${current!.dramaApiBase()}${DRAMA_ENDPOINTS.uploadimage}`, {
    method: 'POST',
    body: form,
    signal: signal ?? null,
  })
  if (!upload.ok) throw new Error(`参考图上传失败: ${upload.status}`)
  const data = await upload.json() as Record<string, unknown>
  // 兼容多种响应格式：{ filename } / { name } / { data: { filename } } / { data: { url } }
  const filename = (data.filename
    ?? data.name
    ?? (data.data as Record<string, unknown> | undefined)?.filename
    ?? (data.data as Record<string, unknown> | undefined)?.url
  ) as string | undefined
  if (!filename) throw new Error(`参考图上传成功但未返回 filename（响应: ${JSON.stringify(data)}）`)
  return filename
}

/**
 * P8.1：把本地图片（base64）落地到项目 assets 目录，并返回可直接供生成工具
 * 使用的两个引用：
 * - `url`：同源相对路径（/canvas-studio/assets/<projectId>/<file>），画布素材节点直接用；
 * - `filename`：经 Drama `uploadimage` 拿到的服务器文件名，供 image_generate /
 *   video_generate / video_composite 的 filename(s) 参数使用。
 */
export async function uploadLocalImage(
  registry: ProjectRegistry,
  projectId: string,
  name: string,
  dataBase64: string,
  signal?: AbortSignal,
): Promise<{ url: string; filename: string }> {
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new Error('dataBase64 不能为空')
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(dataBase64, 'base64')
    if (bytes.length === 0) throw new Error('空图片')
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
  const url = `/canvas-studio/assets/${projectId}/${file}`

  // 同一份字节上传到 Drama，拿到服务器 filename（供后续生成引用）。
  const filename = await uploadBytesToDrama(bytes, ext, signal)
  return { url, filename }
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
 * 仅用于重试分支；误判最多浪费一次上传，不会造成数据错误。
 */
function isBadReferenceError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return /HTTP 400|HTTP 404|not (found|exist)|file (not|doesn')|invalid|no (such|file)|参考图|filename|image.*(missing|not)/i.test(e.message)
}

/** 生成工具名 → 画布操作类型（边颜色/标签的语义来源）。 */
export function operationTypeOf(tool: string, params: GenerateParams): StudioCanvasOperationType {
  if (tool === 'image_generate') return params.filename !== undefined ? 'image-to-image' : 'text-to-image'
  if (tool === 'video_generate') return 'image-to-video'
  if (tool === 'video_composite') return 'mkr-video'
  if (tool === 'style_transfer') return 'style-transfer'
  if (tool === 'storyboard_generate') return 'storyboard'
  return 'import'
}

/** 把生成参数序列化为 generationPrompt（节点重试时原样重放；retryOf 不入档）。 */
export function generationPromptOf(params: GenerateParams): string {
  const { retryOf: _retryOf, ...rest } = params
  return JSON.stringify(rest)
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

/** 提示词增强：调用 Drama Backend 的 image2promptenhance 接口。 */
export async function enhancePrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = await callDramaRaw(DRAMA_ENDPOINTS.promptEnhance, { prompt }, signal)
  return (data.output ?? data.msg ?? data) as string
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
 * @param tool - 工具名（image_generate / video_generate / video_composite / style_transfer / storyboard_generate）。
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

  const size = sizeForAspectRatio(params.aspectRatio)
  const isVideo = tool === 'video_generate' || tool === 'video_composite'
  let mediaUrl: string
  // 生成类节点也要持久化 Drama 服务器文件名（fix: 让生成图可直接被后端链路引用，省掉重复 upload_image）。
  let dramaFilename: string | undefined
  // storyboard_generate 时捕获 Drama 文件名，透出给 storyboard_split 链式拆分。
  let storyboardName: string | undefined

  // —— 参考图容错：后台因 filename 失效（400/404 / 参考图不存在）时，
  // 用 sourceUrls 指向的本地资产重新上传拿新 filename 并重试一次。 ——
  const collectProvidedNames = (): string[] => {
    const names: string[] = []
    if (params.filename) names.push(params.filename)
    if (params.styleFilename) names.push(params.styleFilename)
    if (params.filenames) names.push(...params.filenames)
    return names
  }
  const reuploadSources = async (sig?: AbortSignal): Promise<string[]> => {
    const urls = params.sourceUrls ?? []
    const out: string[] = []
    for (const u of urls) {
      const file = u.split('/').pop()
      if (!file) continue
      const localPath = join(registry.assetsDir(projectId), file)
      const bytes = await readFile(localPath)
      const ext = extname(file).replace(/^\./, '') || 'png'
      out.push(await uploadBytesToDrama(new Uint8Array(bytes), ext, sig))
    }
    return out
  }
  const callWithFallback = async (
    endpoint: string,
    body: Record<string, unknown>,
    kind: keyof typeof DRAMA_TIMEOUT_MS,
  ): Promise<{ url: string; filename?: string }> => {
    try {
      return await callDrama(endpoint, body, signal, kind)
    } catch (cause) {
      if (!isBadReferenceError(cause) || (params.sourceUrls?.length ?? 0) === 0) throw cause
      const fresh = await reuploadSources(signal)
      const provided = collectProvidedNames()
      if (provided.length === 0 || fresh.length === 0) throw cause
      const mapped: Record<string, string> = {}
      provided.forEach((n, i) => { if (fresh[i] !== undefined) mapped[n] = fresh[i]! })
      let patched = JSON.stringify(body)
      for (const [oldN, newN] of Object.entries(mapped)) patched = patched.split(oldN).join(newN)
      return callDrama(endpoint, JSON.parse(patched) as Record<string, unknown>, signal, kind)
    }
  }

  if (tool === 'image_generate') {
    // 多参考图生图：filenames（≤3）映射到 image1~imageN；否则回退单 filename（image1）。
    const refs = (params.filenames ?? []).slice(0, 3)
    const imageKeys: Record<string, unknown> = {}
    if (refs.length > 0) {
      refs.forEach((image, i) => { imageKeys[`image${i + 1}`] = image })
    } else if (params.filename !== undefined) {
      imageKeys.image1 = params.filename
    }
    if (refs.length > 0 || params.filename !== undefined) {
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
  } else if (tool === 'video_generate') {
    // 单图/文生视频统一走 FL2VA（首尾帧接口，也可纯文生或仅首帧）。
    // 该接口用 aspect + megapixels，仅支持 16:9 / 9:16（1:1 就近落到 16:9）。
    const aspect = params.aspectRatio === '9:16' ? '9:16' : '16:9'
      const _r = await callWithFallback(
        DRAMA_ENDPOINTS.videoFl2va,
        {
          prompt: params.prompt,
          aspect,
          megapixels: 0.4,
          // 时长钳制 ≤15s（后端长视频易失败，建议 ~10s）。
          duration: clampDuration(params.duration, 5),
          // 提供 filename 时为「首帧」模式；不提供则为纯文生视频。
          ...(params.filename ? { image1: params.filename } : {}),
        },
        'video',
      )
      mediaUrl = _r.url
      if (_r.filename !== undefined) dramaFilename = _r.filename
  } else if (tool === 'video_composite') {
    const filenames = params.filenames ?? []
    if (filenames.length < 1) throw new Error('video_composite 需要提供 filenames（来自 upload_image 工具）')
    if (filenames.length === 2) {
      // 首尾帧插值优先（image2videofl2va）：两图场景下比 MKR 关键帧插值更稳。
      // 该接口用 aspect + megapixels 而非 width/height，且只支持 16:9 / 9:16
      // （1:1 就近落到 16:9）。
      const aspect = params.aspectRatio === '9:16' ? '9:16' : '16:9'
        const _r = await callWithFallback(
          DRAMA_ENDPOINTS.videoFl2va,
          {
            prompt: params.prompt,
            aspect,
            megapixels: 0.4,
            duration: clampDuration(params.duration, 10),
            image1: filenames[0],
            image2: filenames[1],
          },
          'video',
        )
        mediaUrl = _r.url
        if (_r.filename !== undefined) dramaFilename = _r.filename
    } else {
      // 多参考图 REF2VA（image2videoref2va）：最多 6 张（image1–image6），
      // 后端自动排布参考图以保持角色/场景一致性。超过 6 张时保留首尾 +
      // 中间均匀采样。同样用 aspect + megapixels，时长钳制 ≤15s。
      const aspect = params.aspectRatio === '9:16' ? '9:16' : '16:9'
      const duration = clampDuration(params.duration, 10)
      const refs = sliceToMax(filenames, 6)
      const refBody: Record<string, unknown> = { prompt: params.prompt, aspect, megapixels: 0.4, duration }
      refs.forEach((image, i) => { refBody[`image${i + 1}`] = image })
      const _r = await callWithFallback(DRAMA_ENDPOINTS.videoRef2va, refBody, 'video')
      mediaUrl = _r.url
      if (_r.filename !== undefined) dramaFilename = _r.filename
    }
  } else if (tool === 'style_transfer') {
    if (!params.filename || !params.styleFilename) {
      throw new Error('style_transfer 需要提供 filename（目标图）和 styleFilename（风格参考图）')
    }
    const _r = await callWithFallback(
      DRAMA_ENDPOINTS.styleTransfer,
      {
        image1: params.filename,
        image2: params.styleFilename,
        ...(params.prompt ? { prompt: params.prompt } : {}),
        ...(params.enhance !== undefined ? { enhance: params.enhance } : {}),
      },
      'image',
    )
    mediaUrl = _r.url
    if (_r.filename !== undefined) dramaFilename = _r.filename
  } else if (tool === 'storyboard_generate') {
    const _r = await callWithFallback(
      DRAMA_ENDPOINTS.storyboard,
      {
        prompt: params.prompt,
        gridnum: params.gridnum ?? 4,
        width: size.width,
        ...(params.filename ? { image: params.filename } : {}),
      },
      'image',
    )
    mediaUrl = _r.url
    storyboardName = _r.filename
  } else {
    throw new Error(`未知的生成工具: ${tool}`)
  }

  const finalFilename = storyboardName ?? dramaFilename
  const download = await fetch(mediaUrl, { signal: signal ?? null })
  if (!download.ok) throw new Error(`产物下载失败: ${download.status}`)
  const bytes = Buffer.from(await download.arrayBuffer())

  const assetId = newAssetId()
  const extension = isVideo ? 'mp4' : 'png'
  const filename = `${assetId}.${extension}`
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, filename), bytes)

  // 同源相对路径：渲染进程与 webServer 同源，相对 URL 自动解析到当前端口，
  // 桌面重启换端口也不失效（此前写死 127.0.0.1:<port> 在端口变化后会 404）。
  const url = `/canvas-studio/assets/${projectId}/${filename}`

  // Persist a canvas node the moment the asset lands on disk (Host is the
  // source of truth). The client reloads the canvas document on tool/result,
  // so a successful generation shows on the canvas even if the conversation
  // event's rendered text carries no usable URL.
  // 血缘：按 params.sourceUrls 反查输入参考图对应的画布节点（流程箭头）。
  const sourceIds = resolveSourceIds((await registry.readCanvas(projectId)).nodes, params.sourceUrls)

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
      width: size.width,
      height: size.height,
      mediaWidth: size.width,
      mediaHeight: size.height,
      operationType: operationTypeOf(tool, params),
      toolName: tool,
      generationPrompt: generationPromptOf(params),
      ...(isVideo ? { duration: clampDuration(params.duration, tool === 'video_composite' ? 10 : 5) } : {}),
    }
    await registry.writeCanvas(projectId, existing.map((node) => (node.id === target.id ? updated : node)))
  } else {
    const node: StudioCanvasNode = {
      id: assetId,
      kind: isVideo ? 'video' : 'image',
      url,
      ...(finalFilename !== undefined ? { filename: finalFilename } : {}),
      // 图片产物默认成为可复用参考（参考托盘 / list_references 来源）；
      // 视频暂不直接作为工具参考图，故不标记。
      ...(isVideo ? {} : { isReference: true, referenceRole: 'image' as const }),
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      createdAt: Date.now(),
      toolName: tool,
      runId: assetId,
      origin: 'agent',
      sourceIds,
      operationType: operationTypeOf(tool, params),
      generationPrompt: generationPromptOf(params),
      mediaWidth: size.width,
      mediaHeight: size.height,
      ...(isVideo ? { duration: clampDuration(params.duration, tool === 'video_composite' ? 10 : 5) } : {}),
    }
    await registry.appendCanvasNode(projectId, node)
  }

  const result: GenerateResult = { url, width: size.width, height: size.height }
  if (isVideo) result.duration = clampDuration(params.duration, tool === 'video_composite' ? 10 : 5)
  if (finalFilename !== undefined) result.filename = finalFilename
  return result
}

// 导出供 host-tools.ts 中 upload_image 工具使用。
export { uploadImage, resolveImageUrl }

/**
 * P8.3：把一张格子分镜图（storyboard_generate 产物）拆分为若干单镜。
 * 调用 Drama `image2splitegrid`，按 gridnum 推导行列（4→2×2、6→2×3、9→3×3），
 * 把返回的每个单镜图下载到本地 assets，并逐个 appendCanvasNode 为独立 image
 * 节点，sourceIds 指向传入的分镜网格节点（血缘箭头）。
 */
function gridDims(gridnum: number): { row: number; column: number } {
  if (gridnum === 6) return { row: 2, column: 3 }
  if (gridnum === 9) return { row: 3, column: 3 }
  return { row: 2, column: 2 } // 4 及其它默认 2×2
}

export interface SplitStoryboardParams {
  /** 分镜网格图在 Drama Backend 的服务器文件名（来自 storyboard_generate 的 filename）。 */
  filename: string
  /** 格子数量，默认 4；仅支持 4 / 6 / 9。 */
  gridnum?: number
  /** 分镜网格图的画布产物 URL（用于反查节点、画血缘箭头）。 */
  sourceUrls?: string[]
}

export interface SplitStoryboardResult extends GenerateResult {
  /** 拆分出的单镜数量。 */
  count: number
}

export async function splitStoryboard(
  registry: ProjectRegistry,
  projectId: string,
  params: SplitStoryboardParams,
  signal?: AbortSignal,
): Promise<SplitStoryboardResult> {
  const grid = params.gridnum ?? 4
  const { row, column } = gridDims(grid)
  const data = await callDramaRaw(
    DRAMA_ENDPOINTS.spliteGrid,
    { row, column, target_width: 1024, target_height: 768, image: params.filename },
    signal,
  ) as { images?: Array<{ filename: string; url: string }>; total_count?: number }

  const images = data.images ?? []
  if (images.length === 0) throw new Error('分镜拆分未返回任何单镜图像')

  const sourceIds = resolveSourceIds((await registry.readCanvas(projectId)).nodes, params.sourceUrls)
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })

  let firstUrl = ''
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!
    // 下载单镜到本地 assets，与 storyboard_generate 一致（避免依赖远端 view 服务稳定性）。
    const download = await fetch(img.url, { signal: signal ?? null })
    if (!download.ok) throw new Error(`分镜单镜下载失败: ${download.status}`)
    const bytes = Buffer.from(await download.arrayBuffer())
    const assetId = newAssetId()
    const file = `${assetId}.png`
    await writeFile(join(directory, file), bytes)
    const url = `/canvas-studio/assets/${projectId}/${file}`
    if (i === 0) firstUrl = url
    const node: StudioCanvasNode = {
      id: assetId,
      kind: 'image',
      url,
      isReference: true,
      referenceRole: 'image',
      x: 0,
      y: 0,
      width: 260,
      height: 180,
      createdAt: Date.now(),
      toolName: 'storyboard_split',
      runId: assetId,
      origin: 'agent',
      sourceIds,
      operationType: 'storyboard-split',
      generationPrompt: JSON.stringify({ filename: params.filename, gridnum: grid, index: i + 1, total: images.length }),
    }
    await registry.appendCanvasNode(projectId, node)
  }

  return { url: firstUrl, width: 260, height: 180, count: images.length }
}
