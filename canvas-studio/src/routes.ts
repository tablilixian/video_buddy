/**
 * Canvas Studio webServer routes: the project registry HTTP face consumed by
 * the browser client, plus the P3 media-generation and asset-serving faces.
 * Reads require a local loopback request; mutations add a same-origin
 * requirement (the established community-market pattern).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, mkdir, rename } from 'node:fs/promises'
import { BlockList, isIP } from 'node:net'
import { extname, join, sep, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { StudioProject, StudioProjectGroup } from './contracts/project.js'
import { normalizePlan, normalizeWorkflow, normalizeWorkflowMode, resolveSetModePatch } from './contracts/project.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import type { ProjectRegistry } from './projects.js'
import type { AssetLibrary, LibraryMediaSource, LibraryUpdatePatch } from './asset-library.js'
import { collectNodeMediaSources } from './asset-library.js'
import type { LibAnchorRef, LibCategory, LibMedia } from './contracts/asset-library.js'
import { isLibCategory } from './contracts/asset-library.js'
import { generateAsset, promoteAssetFile, saveLocalAsset, saveLocalAssetBytes, type GenerateParams } from './generate.js'
import { gcProjectAssets, trashAssetsForRemovedNodes, collectReferencedBasenames } from './asset-gc.js'
import { loadAssetHistory, markHistoryDeleted } from './asset-history.js'
import { ASSET_TRASH_DIR } from './config.js'
import { classifyFile, MEDIA_KIND_LABEL, MEDIA_UPLOAD_LIMITS } from './media-extension.js'
import { generateQueueSnapshot } from './generate-queue.js'
// Drama 异步任务恢复轮询的跟踪数（快照并入 resumedJobs，客户端据此保持轮询）。
import { activeResumeJobCount } from './video-jobs.js'
import { probeWaveformEnvelope } from './waveform-host.js'
import { parseProviderParam } from './providers/selection.js'
import { importVideoAsset, splitVideoAsset } from './video-style.js'
import { composeStudioVideo } from './compose.js'
import { normalizeCanvasView } from './canvas-view.js'
import { asCanvasError, isDevMode, routeError, throwError } from './error-system.js'
import './errors/catalog.js'

const ROUTE_PROJECTS = '/canvas-studio/projects'
const ROUTE_GROUPS = '/canvas-studio/groups'
const ROUTE_GENERATE = '/canvas-studio/generate'
const ROUTE_GENERATE_QUEUE = '/canvas-studio/generate-queue'
const ROUTE_ASSETS = '/canvas-studio/assets'
// REQ-001：全局资产库（列表/详情/CRUD/锚点/媒体共用一条前缀，路径内分派）。
const ROUTE_LIBRARY = '/canvas-studio/library'
const ROUTE_STYLE_DEMOS = '/canvas-studio/style-demos'
const ROUTE_CANVAS = '/canvas-studio/canvas'
// CV-243：资产废料回收。独立路径（不走 ROUTE_ASSETS 前缀）避免与媒体服务路由碰撞。
const ROUTE_ASSET_GC = '/canvas-studio/asset-gc'
// CV-246：生成产物历史（读列表 + 面板删除）。独立路径避免与媒体服务路由碰撞。
const ROUTE_ASSET_HISTORY = '/canvas-studio/asset-history'
const ROUTE_ACTIVE_SKILLS = '/canvas-studio/active-skills'
const ROUTE_WORKFLOW = '/canvas-studio/workflow'
const ROUTE_UPLOAD = '/canvas-studio/upload'
const ROUTE_UPLOAD_LOCAL = '/canvas-studio/upload-local'
// CV-241 Step 2：四类文件统一 octet-stream 入口（image/audio/text 走这里；
// video 仍走 /upload-video）。
const ROUTE_UPLOAD_MEDIA = '/canvas-studio/upload-media'
const ROUTE_PROMOTE = '/canvas-studio/promote'
const ROUTE_WAVEFORM = '/canvas-studio/waveform'
const ROUTE_UPLOAD_VIDEO = '/canvas-studio/upload-video'
const ROUTE_SPLIT_VIDEO = '/canvas-studio/split-video'
const ROUTE_COMPOSE = '/canvas-studio/compose'
const MAX_BODY_BYTES = 16 * 1024 * 1024
/** 参考视频上限：短参考片为主，128MB 已远超风格采样所需（上传与拆分共用）。 */
const MAX_VIDEO_BODY_BYTES = 128 * 1024 * 1024
const MAX_CANVAS_NODES = 2000
/** CV-066：单项目最多装载的 skill 数（UI 是 chip 横排，超长会溢出）。 */
const MAX_ACTIVE_SKILLS = 12

const loopbackAddresses = new BlockList()
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
loopbackAddresses.addSubnet('::1', 128, 'ipv6')

/** 包内风格演示 GIF 目录：sync 脚本从 minimax-h3 submodule copy（lib 产物 → 包根 assets/style-demos）。 */
const STYLE_DEMO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'style-demos')

/** 托管资产的扩展名 → Content-Type（P8.4 起含参考视频；CV-241 起含文本）。 */
const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  // 2026-09-22：音频也必须在表里 —— 缺 Content-Type 的话托管出去的音频会被
  // application/octet-stream 兜底，播放器与波形端点都取不到类型。
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  // CV-241：文本素材的托管 Content-Type（与 classifyFile 白名单同源）。
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
}

interface StudioRequestContext {
  readonly remoteAddress: string | undefined
  readonly origin: string | undefined
  readonly host: string | undefined
  readonly secFetchSite?: string | undefined
  readonly expectedPort: number
}

/** The request's local authority when it arrives from the loopback device. */
function studioAuthority(context: StudioRequestContext): URL | undefined {
  if (context.remoteAddress === undefined || context.host === undefined) return undefined
  const address = context.remoteAddress.replace(/^\[|\]$/gu, '').split('%', 1)[0]!
  const family = isIP(address)
  if (family === 0 || !loopbackAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')) return undefined
  let authority: URL
  try {
    authority = new URL(`http://${context.host}`)
  } catch {
    return undefined
  }
  if (
    authority.protocol !== 'http:'
    || Number(authority.port || '80') !== context.expectedPort
    || authority.hostname !== '127.0.0.1'
    || context.secFetchSite === 'cross-site'
  ) return undefined
  return authority
}

function requestContext(req: IncomingMessage, expectedPort: number): StudioRequestContext {
  const secFetchSite = req.headers['sec-fetch-site']
  return {
    remoteAddress: req.socket.remoteAddress,
    origin: req.headers.origin,
    host: req.headers.host,
    ...(typeof secFetchSite === 'string' ? { secFetchSite } : {}),
    expectedPort,
  }
}

function requestAllowed(req: IncomingMessage, expectedPort: number): boolean {
  return studioAuthority(requestContext(req, expectedPort)) !== undefined
}

function mutationAllowed(req: IncomingMessage, expectedPort: number): boolean {
  const context = requestContext(req, expectedPort)
  const authority = studioAuthority(context)
  if (authority === undefined || context.origin === undefined) return false
  try {
    const origin = new URL(context.origin)
    return origin.protocol === 'http:' && origin.host === authority.host && origin.pathname === '/'
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  // CR-005：客户端已断连（大文件下载中途断开等）时不再 setHeader/end，避免
  // ERR_HTTP_HEADERS_SENT / 对已销毁 socket 写入。
  if (res.destroyed) return
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

/**
 * Parse a single-range `bytes=` header against the asset size. Returns the
 * inclusive byte span, `'invalid'` for an unsatisfiable range (HTTP 416), or
 * `undefined` when the header is absent/malformed (serve the whole file).
 */
function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | undefined {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  let start: number
  let end: number
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
    return 'invalid'
  }
  return { start, end }
}

/** Read a bounded JSON request body, rejecting on abort, oversize, or invalid JSON. */
function readJson(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const abortReason = () => signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  if (signal.aborted) return Promise.reject(abortReason())
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onRequestAbort)
      signal.removeEventListener('abort', onSignalAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        const cause = new Error('body too large')
        finish(() => {
          req.destroy(cause)
          reject(cause)
        })
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        finish(() => resolve(value))
      } catch {
        finish(() => reject(new Error('invalid json')))
      }
    }
    const onError = (cause: Error) => finish(() => reject(cause))
    const onRequestAbort = () => finish(() => reject(abortReason()))
    const onSignalAbort = () => finish(() => reject(abortReason()))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('aborted', onRequestAbort)
    signal.addEventListener('abort', onSignalAbort, { once: true })
  })
}

/** Read a bounded raw (octet-stream) request body, rejecting on abort or oversize. */
function readRawBody(req: IncomingMessage, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  const abortReason = () => signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  if (signal.aborted) return Promise.reject(abortReason())
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onRequestAbort)
      signal.removeEventListener('abort', onSignalAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) {
        const cause = new Error(`body too large（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`)
        finish(() => {
          req.destroy(cause)
          reject(cause)
        })
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks)))
    const onError = (cause: Error) => finish(() => reject(cause))
    const onRequestAbort = () => finish(() => reject(abortReason()))
    const onSignalAbort = () => finish(() => reject(abortReason()))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('aborted', onRequestAbort)
    signal.addEventListener('abort', onSignalAbort, { once: true })
  })
}

/** Parse a create-project body into a trimmed display name. */
function asProjectName(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throwError('CS-USER-ERR', { message: '请求体必须是 JSON 对象' })
  }
  const name = (value as Record<string, unknown>).name
  if (typeof name !== 'string') throwError('CS-USER-ERR', { message: '缺少项目名（name 字段）' })
  return name
}

/** 请求体的字符串数组字段收口（aliases/tags）；形状不符返回 undefined，调用方回 400。 */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((entry) => typeof entry === 'string')) return undefined
  return value as string[]
}

/** PATCH media 的媒体元数据数组收口：file 过安全字符集、kind 限三类；形状不符回 undefined。 */
function asLibMediaArray(value: unknown): LibMedia[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: LibMedia[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const record = entry as Record<string, unknown>
    if (typeof record.file !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(record.file) || record.file.startsWith('.')) {
      return undefined
    }
    if (record.kind !== 'image' && record.kind !== 'video' && record.kind !== 'audio') return undefined
    const media: LibMedia = { file: record.file, kind: record.kind }
    if (typeof record.label === 'string') media.label = record.label
    if (typeof record.contentHash === 'string') media.contentHash = record.contentHash
    out.push(media)
  }
  return out
}

/**
 * Register the canvas-studio project, generation, and asset routes.
 * @param ctx - active Host context (webServer service injected).
 * @param registry - the project registry this plugin owns.
 * @returns the route disposer (all registered routes).
 */
export function registerStudioRoutes(ctx: Context, registry: ProjectRegistry, library: AssetLibrary): () => void {
  const expectedPort = ctx.webServer.port
  /**
   * HTTP 错误响应的**唯一出口**（凡「可能是异常导致的失败」都走这里）。
   *
   * 为什么不直接透传 `cause.message`：HTTP 面是客户端的主数据通道，Node 的 fs /
   * 网络异常原文常含绝对路径（`/Users/<name>/…`）与内部地址，会一路显示到用户面前。
   * 这里统一过 `routeError`：
   * - 需展示的错误（含 user 受众）→ 用 catalog 的 `userMessage`（登记时已保证脱敏）；
   * - 其余（agent / developer 受众、auto 恢复）→ 落日志，响应体只给中性兜底文案。
   *
   * `fallback` 是**给用户看的**最后一道文案，必须本身可读（中文、无内部术语）——
   * 此前这里传的是英文标签（`'project list unavailable'`），而「非 surface」恰是
   * 最常走的分支（裸 Error 收敛成 `CS-UNC-000` 就落这一支）⇒ 用户在一整屏错误卡
   * 上看到的是英文内部串。路由标签只留在日志里。
   *
   * 响应体带 `code`（**原始**错误码，供日志/路由用），让客户端能按码路由而不是
   * 解析字符串（与工具链同一条规则）；客户端据它决定是否画节点错误标。
   */
  const sendRouteFailure = (res: ServerResponse, cause: unknown, status: number, fallback: string): void => {
    const err = asCanvasError(cause)
    const action = routeError(err, { devMode: isDevMode() })
    if (action.kind !== 'surface') {
      ctx.logger.warn(`[canvas-studio][http:${status}][${err.code}] ${action.dev}`)
    }
    if (res.destroyed) return
    sendJson(res, status, {
      error: action.kind === 'surface' ? err.userMessage : fallback,
      code: err.code,
    })
  }
  const routes = [
    ctx.webServer.register({ kind: 'exact', path: ROUTE_PROJECTS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        try {
          const projects: readonly StudioProject[] = await registry.list()
          if (!res.destroyed) sendJson(res, 200, { projects })
        } catch (cause) {
          if (!res.destroyed) sendRouteFailure(res, cause, 500, '项目列表加载失败，请稍后重试。')
        }
        return
      }
      if (req.method === 'DELETE') {
        if (!mutationAllowed(req, expectedPort)) {
          sendJson(res, 403, { error: 'canvas-studio delete requires a local same-origin DELETE' })
          return
        }
        const controller = new AbortController()
        const stopWatching = () => {
          req.off('aborted', onRequestAbort)
          res.off('close', onResponseClose)
        }
        const onRequestAbort = () => controller.abort()
        const onResponseClose = () => {
          if (!res.writableEnded) controller.abort()
        }
        req.once('aborted', onRequestAbort)
        res.once('close', onResponseClose)
        try {
          const body = await readJson(req, controller.signal) as { id?: unknown }
          if (typeof body.id !== 'string') {
            sendJson(res, 400, { error: '缺少 id' })
            return
          }
          await registry.removeProject(body.id)
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
        } catch (cause) {
          if (!controller.signal.aborted && !res.destroyed) {
            sendRouteFailure(res, cause, 400, '项目删除失败，请稍后重试。')
          }
        } finally {
          stopWatching()
        }
        return
      }
      if (req.method === 'PATCH') {
        if (!mutationAllowed(req, expectedPort)) {
          sendJson(res, 403, { error: 'canvas-studio project move requires a local same-origin PATCH' })
          return
        }
        const controller = new AbortController()
        const stopWatching = () => {
          req.off('aborted', onRequestAbort)
          res.off('close', onResponseClose)
        }
        const onRequestAbort = () => controller.abort()
        const onResponseClose = () => {
          if (!res.writableEnded) controller.abort()
        }
        req.once('aborted', onRequestAbort)
        res.once('close', onResponseClose)
        try {
          const body = await readJson(req, controller.signal) as { id?: unknown; groupId?: unknown }
          if (typeof body.id !== 'string') {
            sendJson(res, 400, { error: '缺少 id' })
            return
          }
          const groupId = body.groupId === null ? null : typeof body.groupId === 'string' ? body.groupId : null
          await registry.moveProjectToGroup(body.id, groupId)
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
        } catch (cause) {
          if (!controller.signal.aborted && !res.destroyed) {
            sendRouteFailure(res, cause, 400, '项目移动失败，请稍后重试。')
          }
        } finally {
          stopWatching()
        }
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'project changes require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as { name?: unknown; groupId?: unknown; plan?: unknown; mode?: unknown }
        const name = asProjectName(body)
        const groupId = typeof body.groupId === 'string' ? body.groupId : null
        // CV-099：预置规格（画幅 / 目标总时长）。非法值由 normalizePlan 降级为
        // undefined，等价于「未锁定」，不因脏输入让创建失败。
        const plan = normalizePlan(body.plan)
        // CV-196：创建时锁定的执行模式。非法 / 缺失 → undefined，由 registry 回落到
        // 设置页「默认执行模式」（**不是**在这里兜 'confirm'，那会把设置页开关架空）。
        const mode = normalizeWorkflowMode(body.mode)
        const project = await registry.create(name, groupId, plan, mode)
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 201, { project })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '项目创建失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // CV-091: project-group face. GET lists groups; POST creates; PATCH renames;
    // DELETE removes (its projects fall back to ungrouped). Reads need loopback
    // authority; mutations add the same-origin check used by the project routes.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_GROUPS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        try {
          const groups: readonly StudioProjectGroup[] = await registry.listGroups()
          if (!res.destroyed) sendJson(res, 200, { groups })
        } catch (cause) {
          if (!res.destroyed) sendRouteFailure(res, cause, 500, '分组列表加载失败，请稍后重试。')
        }
        return
      }
      if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
        sendJson(res, 405, { error: 'groups route requires GET/POST/PATCH/DELETE' })
        return
      }
      if (!mutationAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio group changes require a local same-origin request' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        if (req.method === 'POST') {
          const body = await readJson(req, controller.signal) as { name?: unknown }
          if (typeof body.name !== 'string') {
            sendJson(res, 400, { error: '缺少分组名(name)' })
            return
          }
          const group = await registry.createGroup(body.name)
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 201, { group })
        } else if (req.method === 'PATCH') {
          const body = await readJson(req, controller.signal) as { id?: unknown; name?: unknown }
          if (typeof body.id !== 'string' || typeof body.name !== 'string') {
            sendJson(res, 400, { error: '缺少 id 或 name' })
            return
          }
          const group = await registry.renameGroup(body.id, body.name)
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { group })
        } else {
          const body = await readJson(req, controller.signal) as { id?: unknown }
          if (typeof body.id !== 'string') {
            sendJson(res, 400, { error: '缺少 id' })
            return
          }
          await registry.deleteGroup(body.id)
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '分组操作失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // P3: media generation. The client tool posts the generation request; the
    // Host calls Drama Backend, downloads the asset, writes it to the project's
    // assets/ directory, and returns the webServer-hosted URL.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_GENERATE, handler: async (req, res) => {
      if (!mutationAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio generate requires a local same-origin POST' })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'generate requires POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          tool?: unknown
          projectId?: unknown
          params?: unknown
        }
        if (typeof body.tool !== 'string' || typeof body.projectId !== 'string') {
          sendJson(res, 400, { error: '缺少 tool 或 projectId' })
          return
        }
        const params = (body.params ?? {}) as GenerateParams
        // 约束 4：provider 字段无白名单校验，必须在入口处枚举校验，否则是不可控注入面。
        try {
          parseProviderParam((body.params as { provider?: unknown } | undefined)?.provider)
        } catch (cause) {
          sendRouteFailure(res, cause, 400, '非法的视频供应商')
          return
        }
        const result = await generateAsset(
          registry,
          body.tool,
          body.projectId,
          params,
          controller.signal,
        )
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, result)
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '生成失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // CV-220：生成队列快照（**只读**）。客户端在有待结算的生成时轮询它，用于
    // ① 显示「排队中（第 N 位）」；② 把排队时间从占位节点的结算上限里摘出去
    // （后端同步单任务 + 660s 截止只剩 60s 余量 ⇒ 重叠一次就误报「生成超时」）。
    // 只读 ⇒ 走 requestAllowed（不要求 same-origin）：无 body、无副作用、不改盘。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_GENERATE_QUEUE, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'generate-queue is read-only' })
        return
      }
      // resumedJobs：Host 正在恢复轮询的 Drama 异步视频任务数（jobs.json 续查），
      // 客户端据此保持轮询并在任务结算时重载画布（见 client 的 pollGenerationQueue）。
      sendJson(res, 200, { ...generateQueueSnapshot(), resumedJobs: activeResumeJobCount() })
    }}),

    // P3: asset serving. The Host writes generated media into each project's
    // assets/ directory; this prefix route streams those files back. Only
    // loopback + same-origin requests are allowed, and path traversal is
    // blocked by verifying the resolved path stays under the project assets dir.
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_ASSETS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'assets only support GET' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
      // CR-002：decodeURIComponent 对 malformed 编码（如 %zz）会抛 URIError——
      // 必须放进 try，否则 handler 直接 reject、响应悬空。
      let relative = ''
      try {
        relative = decodeURIComponent(requestUrl.pathname.replace(ROUTE_ASSETS, ''))
      } catch {
        sendJson(res, 400, { error: 'malformed asset path' })
        return
      }
      const parts = relative.split('/').filter(Boolean)
      if (parts.length !== 2) {
        sendJson(res, 400, { error: 'asset path must be /<projectId>/<file>' })
        return
      }
      const projectId = parts[0]
      const file = parts[1]
      if (!projectId || !file) {
        sendJson(res, 400, { error: 'asset path must be /<projectId>/<file>' })
        return
      }
      const base = registry.assetsDir(projectId)
      const target = join(base, file)
      if (!target.startsWith(base + sep)) {
        sendJson(res, 403, { error: 'forbidden asset path' })
        return
      }
      try {
        let data: Buffer
        try {
          data = await readFile(target)
        } catch (error) {
          // CV-243：根目录 miss → 回收站兜底。删除节点文件移入 `.trash/` 后，
          // undo 恢复的节点（url 不变）从这里继续回源，图片/视频不断链。
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          data = await readFile(join(base, ASSET_TRASH_DIR, file))
        }
        const contentType = ASSET_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
        res.setHeader('content-type', contentType)
        res.setHeader('cache-control', 'no-store')
        res.setHeader('x-content-type-options', 'nosniff')
        // Media elements issue `Range` requests; honor a single byte range so
        // <video> can stream and seek (206), falling back to the full 200 body.
        const range = parseByteRange(req.headers.range, data.byteLength)
        if (range === 'invalid') {
          res.statusCode = 416
          res.setHeader('content-range', `bytes */${data.byteLength}`)
          res.end()
          return
        }
        if (range !== undefined) {
          res.statusCode = 206
          res.setHeader('accept-ranges', 'bytes')
          res.setHeader('content-range', `bytes ${range.start}-${range.end}/${data.byteLength}`)
          res.end(data.subarray(range.start, range.end + 1))
          return
        }
        res.statusCode = 200
        res.setHeader('accept-ranges', 'bytes')
        res.end(data)
      } catch {
        sendJson(res, 404, { error: 'asset not found' })
      }
    }}),

    // REQ-001：全局资产库面。一条前缀路由覆盖方案 §3.3.1 的全部端点（路径内分派）：
    //   GET    /library                → 列表（?category=&q=）
    //   POST   /library                → 新建（anchors 非空 = 从画布入库）
    //   GET    /library/:id            → 详情
    //   PATCH  /library/:id            → 更新元数据 / 分类 / 媒体元数据
    //   DELETE /library/:id            → 删除（合流写墓碑 + 清媒体目录）
    //   POST   /library/:id/anchors    → 追加锚点（从画布节点入库）
    //   GET    /library/:assetId/:file → 媒体文件（字符集 + 目录前缀双校验）
    // 只读走 requestAllowed；写走 mutationAllowed（同源 + pathname '/'，与项目/分组面一致）。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_LIBRARY, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      const method = req.method ?? 'GET'
      const isRead = method === 'GET' || method === 'HEAD'
      if (!isRead && !mutationAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio library changes require a local same-origin request' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
      // CR-002：decodeURIComponent 对 malformed 编码会抛 URIError，必须进 try。
      let relative = ''
      try {
        relative = decodeURIComponent(requestUrl.pathname.slice(ROUTE_LIBRARY.length))
      } catch {
        sendJson(res, 400, { error: 'malformed library path' })
        return
      }
      const parts = relative.split('/').filter(Boolean)
      // 资产 id / 媒体文件名的字符集（与库内部同一判据；在 throw 之前先回 4xx，
      // 不把用户输入当开发错误打到日志里）。
      const safeSegment = (segment: string): boolean =>
        /^[A-Za-z0-9._-]+$/u.test(segment) && !segment.startsWith('.')
      /** 读体 + Abort 联动 + 统一错误出口（照分组面的写法，抽出来复用 5 个写分支）。 */
      const withBody = async (handle: (body: Record<string, unknown>) => Promise<void>): Promise<void> => {
        const controller = new AbortController()
        const stopWatching = () => {
          req.off('aborted', onRequestAbort)
          res.off('close', onResponseClose)
        }
        const onRequestAbort = () => controller.abort()
        const onResponseClose = () => {
          if (!res.writableEnded) controller.abort()
        }
        req.once('aborted', onRequestAbort)
        res.once('close', onResponseClose)
        try {
          const body = await readJson(req, controller.signal)
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
            return
          }
          await handle(body as Record<string, unknown>)
        } catch (cause) {
          if (!controller.signal.aborted && !res.destroyed) {
            sendRouteFailure(res, cause, 400, '资产库操作失败，请稍后重试。')
          }
        } finally {
          stopWatching()
        }
      }
      try {
        // ── GET：列表 / 详情 / 媒体 ────────────────────────────────────────
        if (isRead) {
          if (parts.length === 0) {
            const categoryRaw = requestUrl.searchParams.get('category')
            const q = requestUrl.searchParams.get('q') ?? undefined
            let category: LibCategory | undefined
            if (categoryRaw !== null && categoryRaw.length > 0) {
              if (!isLibCategory(categoryRaw)) {
                sendJson(res, 400, { error: '无效的分类（category）' })
                return
              }
              category = categoryRaw
            }
            const assets = await library.list({
              ...(category !== undefined ? { category } : {}),
              ...(q !== undefined && q.length > 0 ? { q } : {}),
            })
            if (!res.destroyed) sendJson(res, 200, { assets })
            return
          }
          if (parts.length === 1) {
            const id = parts[0]!
            if (!safeSegment(id)) {
              sendJson(res, 400, { error: '非法的资产 id' })
              return
            }
            const asset = await library.require(id)
            if (!res.destroyed) sendJson(res, 200, { asset })
            return
          }
          if (parts.length === 2) {
            const [assetId, file] = parts as [string, string]
            if (!safeSegment(assetId) || !safeSegment(file)) {
              sendJson(res, 400, { error: '非法的媒体路径' })
              return
            }
            let target: string
            try {
              target = library.mediaFile(assetId, file)
            } catch {
              sendJson(res, 404, { error: 'asset not found' })
              return
            }
            try {
              const data = await readFile(target)
              const contentType = ASSET_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
              res.setHeader('content-type', contentType)
              res.setHeader('cache-control', 'no-store')
              res.setHeader('x-content-type-options', 'nosniff')
              const range = parseByteRange(req.headers.range, data.byteLength)
              if (range === 'invalid') {
                res.statusCode = 416
                res.setHeader('content-range', `bytes */${data.byteLength}`)
                res.end()
                return
              }
              if (range !== undefined) {
                res.statusCode = 206
                res.setHeader('accept-ranges', 'bytes')
                res.setHeader('content-range', `bytes ${range.start}-${range.end}/${data.byteLength}`)
                res.end(data.subarray(range.start, range.end + 1))
                return
              }
              res.statusCode = 200
              res.setHeader('accept-ranges', 'bytes')
              res.end(data)
            } catch {
              sendJson(res, 404, { error: 'asset not found' })
            }
            return
          }
          sendJson(res, 404, { error: 'library path not found' })
          return
        }
        // ── POST：新建 / 追加锚点 ──────────────────────────────────────────
        if (method === 'POST' && parts.length === 0) {
          await withBody(async (body) => {
            const name = body.name
            if (!isLibCategory(body.category)) {
              sendJson(res, 400, { error: '缺少或无效的分类（category）' })
              return
            }
            if (typeof name !== 'string' || name.trim().length === 0) {
              sendJson(res, 400, { error: '缺少名称（name）' })
              return
            }
            // anchors 非空 = 从画布入库：逐锚点解析媒体源（节点不存在/文件缺失
            // 由 collectNodeMediaSources 抛 CS-LIB-003，经 sendRouteFailure 出站）。
            const anchors: LibAnchorRef[] = []
            const sources: LibraryMediaSource[] = []
            if (body.anchors !== undefined && !Array.isArray(body.anchors)) {
              sendJson(res, 400, { error: 'anchors 必须是数组' })
              return
            }
            for (const entry of (body.anchors as unknown[] | undefined) ?? []) {
              if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                sendJson(res, 400, { error: '锚点必须是 {projectId, nodeId} 对象' })
                return
              }
              const projectId = (entry as Record<string, unknown>).projectId
              const nodeId = (entry as Record<string, unknown>).nodeId
              if (typeof projectId !== 'string' || typeof nodeId !== 'string') {
                sendJson(res, 400, { error: '锚点必须是 {projectId, nodeId} 对象' })
                return
              }
              const collected = await collectNodeMediaSources(registry, projectId, nodeId)
              anchors.push({ projectId, nodeId })
              sources.push(...collected.sources)
            }
            const asset = await library.create({
              category: body.category,
              name,
              ...(asStringArray(body.aliases) !== undefined ? { aliases: asStringArray(body.aliases)! } : {}),
              ...(typeof body.description === 'string' ? { description: body.description } : {}),
              ...(asStringArray(body.tags) !== undefined ? { tags: asStringArray(body.tags)! } : {}),
              ...(typeof body.lockedPrompt === 'string' ? { lockedPrompt: body.lockedPrompt } : {}),
              ...(typeof body.negativePrompt === 'string' ? { negativePrompt: body.negativePrompt } : {}),
              ...(anchors[0] !== undefined ? { sourceProjectId: anchors[0].projectId } : {}),
              anchors,
              media: sources,
            })
            if (!res.destroyed) sendJson(res, 201, { asset })
          })
          return
        }
        if (method === 'POST' && parts.length === 2 && parts[1] === 'anchors') {
          const id = parts[0]!
          if (!safeSegment(id)) {
            sendJson(res, 400, { error: '非法的资产 id' })
            return
          }
          await withBody(async (body) => {
            const projectId = body.projectId
            const nodeId = body.nodeId
            if (typeof projectId !== 'string' || typeof nodeId !== 'string') {
              sendJson(res, 400, { error: '缺少 projectId 或 nodeId' })
              return
            }
            const collected = await collectNodeMediaSources(registry, projectId, nodeId)
            const asset = await library.addAnchor(id, { projectId, nodeId }, collected.sources)
            if (!res.destroyed) sendJson(res, 200, { asset })
          })
          return
        }
        // ── PATCH：更新元数据 ──────────────────────────────────────────────
        if (method === 'PATCH' && parts.length === 1) {
          const id = parts[0]!
          if (!safeSegment(id)) {
            sendJson(res, 400, { error: '非法的资产 id' })
            return
          }
          await withBody(async (body) => {
            const patch: LibraryUpdatePatch = {}
            if (body.category !== undefined) {
              if (!isLibCategory(body.category)) {
                sendJson(res, 400, { error: '无效的分类（category）' })
                return
              }
              patch.category = body.category
            }
            if (body.name !== undefined) {
              if (typeof body.name !== 'string') {
                sendJson(res, 400, { error: 'name 必须是字符串' })
                return
              }
              patch.name = body.name
            }
            if (body.aliases !== undefined) {
              const values = asStringArray(body.aliases)
              if (values === undefined) {
                sendJson(res, 400, { error: 'aliases 必须是字符串数组' })
                return
              }
              patch.aliases = values
            }
            if (body.tags !== undefined) {
              const values = asStringArray(body.tags)
              if (values === undefined) {
                sendJson(res, 400, { error: 'tags 必须是字符串数组' })
                return
              }
              patch.tags = values
            }
            if (body.description !== undefined) {
              if (typeof body.description !== 'string') {
                sendJson(res, 400, { error: 'description 必须是字符串' })
                return
              }
              patch.description = body.description
            }
            if (body.lockedPrompt !== undefined) {
              if (typeof body.lockedPrompt !== 'string') {
                sendJson(res, 400, { error: 'lockedPrompt 必须是字符串' })
                return
              }
              patch.lockedPrompt = body.lockedPrompt
            }
            if (body.negativePrompt !== undefined) {
              if (typeof body.negativePrompt !== 'string') {
                sendJson(res, 400, { error: 'negativePrompt 必须是字符串' })
                return
              }
              patch.negativePrompt = body.negativePrompt
            }
            if (body.coverFile !== undefined) {
              if (typeof body.coverFile !== 'string') {
                sendJson(res, 400, { error: 'coverFile 必须是字符串' })
                return
              }
              patch.coverFile = body.coverFile
            }
            if (body.media !== undefined) {
              const media = asLibMediaArray(body.media)
              if (media === undefined) {
                sendJson(res, 400, { error: 'media 必须是媒体元数据数组' })
                return
              }
              patch.media = media
            }
            const asset = await library.update(id, patch)
            if (!res.destroyed) sendJson(res, 200, { asset })
          })
          return
        }
        // ── DELETE：删除 ───────────────────────────────────────────────────
        if (method === 'DELETE' && parts.length === 1) {
          const id = parts[0]!
          if (!safeSegment(id)) {
            sendJson(res, 400, { error: '非法的资产 id' })
            return
          }
          await withBody(async () => {
            await library.remove(id)
            if (!res.destroyed) sendJson(res, 200, { ok: true })
          })
          return
        }
        sendJson(res, 405, { error: 'library route method/path mismatch' })
      } catch (cause) {
        if (!res.destroyed) {
          // CS-LIB-001（不存在）按 404 出站，其余读失败 500 / 写失败 400。
          const code = asCanvasError(cause).code
          const status = code === 'CS-LIB-001' ? 404 : isRead ? 500 : 400
          sendRouteFailure(res, cause, status, isRead ? '资产库加载失败，请稍后重试。' : '资产库操作失败，请稍后重试。')
        }
      }
    }}),

    // CV-243：资产废料 GC——打开项目时客户端自动调（fire-and-forget），这里同时
    // 是手动兜底入口。幂等：重复调用无害（没有可回收的就没有动作）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_ASSET_GC, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'asset gc requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown }
        if (typeof body.projectId !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        const result = await gcProjectAssets(registry, body.projectId)
        sendJson(res, 200, { ok: true, ...result })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '资产回收失败，请稍后重试。')
        }
      }
    }}),

    // CV-246：生成产物历史——GET 列表（含已删条目，客户端按 deletedAt 过滤展示）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_ASSET_HISTORY, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'asset-history only supports GET / POST' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', 'http://localhost')
      const projectId = requestUrl.searchParams.get('projectId')
      if (projectId === null || projectId.length === 0) {
        sendJson(res, 400, { error: '缺少 projectId' })
        return
      }
      try {
        const history = await loadAssetHistory(registry, projectId)
        sendJson(res, 200, { ok: true, entries: history.entries })
      } catch (cause) {
        sendRouteFailure(res, cause, 400, '历史读取失败，请稍后重试。')
      }
    }}),

    // CV-246：历史面板删除——两段式：仍被画布引用 → 409 拒绝（防断链）；否则
    // 移入 .trash + 登记表标 deletedAt，物理清交给打开项目 GC（与 CV-243 同语义）。
    ctx.webServer.register({ kind: 'exact', path: `${ROUTE_ASSET_HISTORY}/delete`, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'history delete requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown; file?: unknown }
        if (typeof body.projectId !== 'string' || typeof body.file !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId 或 file' })
          return
        }
        // 防路径穿越：与资产文件名同一判据。
        if (!/^[A-Za-z0-9._-]+$/u.test(body.file) || body.file.startsWith('.')) {
          sendJson(res, 400, { error: '非法的资产文件名' })
          return
        }
        const doc = await registry.readCanvas(body.projectId)
        const referenced = collectReferencedBasenames(doc)
        if (referenced.has(body.file)) {
          sendJson(res, 409, { error: '该产物仍被画布节点引用，请先移除画布上的对应节点' })
          return
        }
        const assetsDir = registry.assetsDir(body.projectId)
        const trashDir = join(assetsDir, ASSET_TRASH_DIR)
        await mkdir(trashDir, { recursive: true })
        try {
          await rename(join(assetsDir, body.file), join(trashDir, body.file))
        } catch {
          // 源不存在（已进 .trash / 已被清）——只补账，不报错。
        }
        await markHistoryDeleted(registry, body.projectId, body.file)
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '历史删除失败，请稍后重试。')
        }
      }
    }}),

    // S3: 风格澄清 GIF 预览。包内静态资源（sync 脚本从 minimax-h3 submodule copy
    // 的 8 张风格 demo），只读 GET + loopback authority；文件名单段 kebab + .gif，
    // join + startsWith 防穿越。静态不变资源用强缓存（与项目资产 no-store 不同）。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_STYLE_DEMOS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'style-demos only support GET' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
      // CR-002：decodeURIComponent 对 malformed 编码会抛 URIError——放进 try，
      // 避免 handler 直接 reject、响应悬空。
      let file = ''
      try {
        file = decodeURIComponent(requestUrl.pathname.replace(ROUTE_STYLE_DEMOS, '').replace(/^\/+/, ''))
      } catch {
        sendJson(res, 400, { error: 'malformed style demo path' })
        return
      }
      if (!/^[a-z0-9-]+\.gif$/.test(file)) {
        sendJson(res, 400, { error: 'style demo path must be /<name>.gif' })
        return
      }
      const target = join(STYLE_DEMO_DIR, file)
      if (!target.startsWith(STYLE_DEMO_DIR + sep)) {
        sendJson(res, 403, { error: 'forbidden style demo path' })
        return
      }
      try {
        const data = await readFile(target)
        res.setHeader('content-type', ASSET_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'image/gif')
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        res.setHeader('x-content-type-options', 'nosniff')
        res.statusCode = 200
        res.end(data)
      } catch {
        sendJson(res, 404, { error: 'style demo not found' })
      }
    }}),

    // P4+: canvas persistence. The client saves the project's node list so the
    // canvas survives a restart (plan §7.7). Reads require loopback authority;
    // writes add the same-origin check used by the project routes.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_CANVAS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
        const projectId = requestUrl.searchParams.get('projectId')
        if (!projectId) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        try {
          const document = await registry.readCanvas(projectId)
          if (!res.destroyed) {
            sendJson(res, 200, { nodes: document.nodes, view: document.view ?? null })
          }
        } catch (cause) {
          if (!res.destroyed) sendRouteFailure(res, cause, 500, '画布加载失败，请稍后重试。')
        }
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'canvas changes require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          nodes?: unknown
          view?: unknown
          removedIds?: unknown
        }
        if (typeof body.projectId !== 'string' || !Array.isArray(body.nodes)) {
          sendJson(res, 400, { error: '缺少 projectId 或 nodes' })
          return
        }
        const nodes = body.nodes as StudioCanvasNode[]
        if (nodes.length > MAX_CANVAS_NODES) {
          sendJson(res, 413, { error: 'canvas node count exceeded' })
          return
        }
        // The view is client-owned UI state; validate leniently (invalid
        // fields degrade to defaults, absence keeps the previously saved one).
        const view = normalizeCanvasView(body.view)
        // CV-242：显式删除协议 + filename 字段保护。客户端保存是整档覆盖，
        // preserved 分不清「还不知道」与「已删除」——removedIds 让删除真删；
        // author: 'client' 让 Host 中途回写的 filename 不被旧副本冲掉。
        const removedIds = Array.isArray(body.removedIds)
          ? body.removedIds.filter((id): id is string => typeof id === 'string')
          : undefined
        // CV-243：保存**前**抓一份节点表——被删节点的 url 只在这里拿得到
        //（writeCanvas 落盘后节点已不在文档里）。
        const beforeDoc = removedIds !== undefined && removedIds.length > 0
          ? await registry.readCanvas(body.projectId)
          : null
        await registry.writeCanvas(body.projectId, nodes, view, undefined, {
          author: 'client',
          ...(removedIds !== undefined && removedIds.length > 0 ? { removedIds } : {}),
        })
        // CV-243：删除节点的无引用文件移入回收站（不物理删，undo/生成中引用免疫）。
        if (beforeDoc !== null) {
          try {
            await trashAssetsForRemovedNodes(registry, body.projectId, removedIds!, beforeDoc.nodes)
          } catch {
            /* trash 是维护操作，失败不阻塞保存 */
          }
        }
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '画布保存失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // CV-066: active-skill roster face. GET returns a project's loaded skills
    // (skills.json); POST replaces the whole roster (activate / deactivate are
    // client-side diffs against this face, so the API stays idempotent).
    ctx.webServer.register({ kind: 'exact', path: ROUTE_ACTIVE_SKILLS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
        const projectId = requestUrl.searchParams.get('projectId')
        if (!projectId) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        try {
          const skills = await registry.readActiveSkills(projectId)
          if (!res.destroyed) sendJson(res, 200, { skills })
        } catch (cause) {
          if (!res.destroyed) sendRouteFailure(res, cause, 500, '技能清单加载失败，请稍后重试。')
        }
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'active-skills changes require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          skills?: unknown
        }
        if (typeof body.projectId !== 'string' || !Array.isArray(body.skills)) {
          sendJson(res, 400, { error: '缺少 projectId 或 skills' })
          return
        }
        const skills = body.skills.filter((entry): entry is string => typeof entry === 'string')
        if (skills.length > MAX_ACTIVE_SKILLS) {
          sendJson(res, 413, { error: 'active skill count exceeded' })
          return
        }
        await registry.writeActiveSkills(body.projectId, skills)
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '技能清单保存失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // P7: creation-workflow gate face. GET returns a project's workflow
    // (mode + approval state); POST applies user actions (approve / reject /
    // setMode) so the approval bar and mode toggle drive the Host-side gate.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_WORKFLOW, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
        const projectId = requestUrl.searchParams.get('projectId')
        if (!projectId) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        const project = await registry.getProject(projectId)
        if (project === null) {
          sendJson(res, 404, { error: `项目不存在: ${projectId}` })
          return
        }
        if (!res.destroyed) {
          const workflow = normalizeWorkflow(project.workflow)
          sendJson(res, 200, { workflow, pendingQuestion: workflow.pendingQuestion ?? null })
        }
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'workflow changes require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          action?: unknown
          mode?: unknown
          value?: unknown
        }
        if (typeof body.projectId !== 'string' || typeof body.action !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId 或 action' })
          return
        }
        let project
        if (body.action === 'approve') {
          project = await registry.updateWorkflow(body.projectId, { state: 'executing' })
        } else if (body.action === 'reject') {
          project = await registry.updateWorkflow(body.projectId, { state: 'drafting' })
        } else if (body.action === 'approve_script') {
          // CV-100：剧本批准后回到规划态（drafting）——绝不能设 executing，
          // 否则 GATED_TOOLS 直接放行、分镜审批被整体跳过。
          project = await registry.updateWorkflow(body.projectId, { state: 'drafting' })
        } else if (body.action === 'reject_script') {
          project = await registry.updateWorkflow(body.projectId, { state: 'drafting' })
        } else if (body.action === 'confirm_keyframes') {
          // 关键帧确认：用户点击「确认关键帧」后放行，进入执行态继续视频流程。
          project = await registry.updateWorkflow(body.projectId, { state: 'executing' })
        } else if (body.action === 'reject_keyframes') {
          // CV-051：打回关键帧。与确认**同样回到 executing** —— 逐镜关键帧走的是
          // `image_generate`，它在 `keyframe_review` 下属于 PRODUCING_TOOLS 被门禁
          // 拦死（approval-gate.ts）；停在审阅态 agent 根本重出不了图。
          // 放行不等于失控：AI 重出完仍必须再调 submit_keyframes_for_approval
          // 才会回到确认条，用户仍有第二次裁决。
          project = await registry.updateWorkflow(body.projectId, { state: 'executing' })
        } else if (body.action === 'answer') {
          if (typeof body.value !== 'string') {
            sendJson(res, 400, { error: '缺少 value（用户的选择）' })
            return
          }
          await registry.answerPendingQuestion(body.projectId, body.value)
          // answerPendingQuestion 成功即项目存在。
          project = (await registry.getProject(body.projectId)) as StudioProject
        } else if (body.action === 'setMode') {
          if (body.mode !== 'confirm' && body.mode !== 'auto') {
            sendJson(res, 400, { error: 'mode 必须是 confirm 或 auto' })
            return
          }
          const current = normalizeWorkflow((await registry.getProject(body.projectId))?.workflow)
          // CV-052：状态决策抽为纯函数 resolveSetModePatch（contracts/project.ts），
          // 模式未变化时短路只写 mode 不碰 state；tests/workflow-mode.test.mjs 覆盖。
          project = await registry.updateWorkflow(body.projectId, resolveSetModePatch(current, body.mode))
        } else {
          sendJson(res, 400, { error: `未知 action: ${body.action}` })
          return
        }
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { workflow: normalizeWorkflow(project.workflow) })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '工作流更新失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // CV-241 Step 2：四类文件统一上传（octet-stream 原始字节，无 base64 膨胀）。
    // Query: projectId（必填）、name（原始文件名，扩展名决定分类与落盘后缀）。
    // Body: application/octet-stream；按 classifyFile 分类型限额（MEDIA_UPLOAD_LIMITS）
    // 在读流阶段拒绝超限（413）与未知扩展（400）。成功回 { url, assetFile } ——
    // 与 /upload 同构；**不调用 promoteAssetFile**（§5.4 惰性提升）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_UPLOAD_MEDIA, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'upload-media requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      let name = ''
      try {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
        const projectId = requestUrl.searchParams.get('projectId')
        name = requestUrl.searchParams.get('name') ?? ''
        if (projectId === null || projectId.length === 0) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        if (name.length === 0) {
          sendJson(res, 400, { error: '缺少 name' })
          return
        }
        const kind = classifyFile(name)
        if (kind === null) {
          sendJson(res, 400, {
            error: `不支持的文件类型：${name}（仅支持图片 / 视频 / 音频 / 文本）`,
            code: 'CS-USER-ERR',
          })
          return
        }
        const label = MEDIA_KIND_LABEL[kind]
        const limit = MEDIA_UPLOAD_LIMITS[kind]
        // content-length 预检：声明即超限的请求不必读 body 就回 413（省带宽）。
        const declared = Number(req.headers['content-length'] ?? '0')
        if (Number.isFinite(declared) && declared > limit) {
          sendJson(res, 413, {
            error: `${label}上传失败：超出大小上限（${Math.round(limit / 1024 / 1024)}MB）`,
            code: 'CS-USER-ERR',
          })
          return
        }
        const bytes = await readRawBody(req, controller.signal, limit)
        // 快速段只落盘；Drama 提升由消费侧惰性兜底（§5.4）——此处禁止 promote。
        const result = await saveLocalAssetBytes(registry, projectId, name, bytes)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { url: result.url, assetFile: result.assetFile })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          const kind = classifyFile(name)
          const label = kind === null ? '文件' : MEDIA_KIND_LABEL[kind]
          const message = cause instanceof Error ? cause.message : String(cause)
          // readRawBody 超限是流式拒绝（无 content-length 或边读边超）→ 413。
          if (message.includes('body too large')) {
            sendJson(res, 413, { error: `${label}上传失败：${message}`, code: 'CS-USER-ERR' })
            return
          }
          sendRouteFailure(res, cause, 400, `${label}上传失败，请稍后重试。`)
        }
      } finally {
        stopWatching()
      }
    }}),

    // DEPRECATED（CV-241 §6.5）：JSON+base64 旧入口，保留一版兼容热更新/旧客户端；
    // 新代码请走 /canvas-studio/upload-media (octet-stream)。确认零调用后下一批删除。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_UPLOAD, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'upload requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      // CV-241：错误文案按实际分类措辞 —— name 提到 try 外，catch 才能读到
      //（旧实现写死「图片上传失败」，传音频失败时误导）。
      let name = 'local.png'
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          name?: unknown
          dataBase64?: unknown
        }
        if (typeof body.projectId !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        if (typeof body.dataBase64 !== 'string') {
          sendJson(res, 400, { error: '缺少 dataBase64' })
          return
        }
        name = typeof body.name === 'string' && body.name.length > 0 ? body.name : 'local.png'
        // CV-241：快速段只落盘（saveLocalAsset），Drama 提升由消费侧惰性兜底 ——
        // 上传路径不再同步 promote（旧 uploadLocalImage 已删）。
        const result = await saveLocalAsset(registry, body.projectId, name, body.dataBase64)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { url: result.url, assetFile: result.assetFile })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          const kind = classifyFile(name)
          const label = kind === null ? '文件' : MEDIA_KIND_LABEL[kind]
          sendRouteFailure(res, cause, 400, `${label}上传失败，请稍后重试。`)
        }
      } finally {
        stopWatching()
      }
    }}),

    // 2026-09-05 两段式上传（对话附件旁路体验优化）：快速段只做「校验 + 项目
    // assets 落盘」（毫秒级），返回同源 url 与磁盘文件名——发送不再被 Drama
    // 公网上传阻塞。Drama 提升走 /canvas-studio/promote（后台 / 生成时惰性兜底）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_UPLOAD_LOCAL, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'upload-local requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      let name = 'local.png'
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          name?: unknown
          dataBase64?: unknown
        }
        if (typeof body.projectId !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        if (typeof body.dataBase64 !== 'string') {
          sendJson(res, 400, { error: '缺少 dataBase64' })
          return
        }
        name = typeof body.name === 'string' && body.name.length > 0 ? body.name : 'local.png'
        const result = await saveLocalAsset(registry, body.projectId, name, body.dataBase64)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { url: result.url, assetFile: result.assetFile })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          const kind = classifyFile(name)
          const label = kind === null ? '文件' : MEDIA_KIND_LABEL[kind]
          sendRouteFailure(res, cause, 400, `${label}保存失败，请稍后重试。`)
        }
      } finally {
        stopWatching()
      }
    }}),

    // 提升段：读项目 assets 已落盘字节 → 统一上传端点拿 filename。后台
    // 预热与 @ref 惰性兜底共用；Host 侧 per-asset in-flight 去重防并发重复上传。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_PROMOTE, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'promote requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          assetFile?: unknown
        }
        if (typeof body.projectId !== 'string' || typeof body.assetFile !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId / assetFile' })
          return
        }
        const filename = await promoteAssetFile(registry, body.projectId, body.assetFile, controller.signal)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { filename })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '图片后端上传失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // C3 真波形：POST { projectId, file } → { envelope: number[] }（0–1 峰值
    // 序列，固定 96 桶）。ffmpeg 解码失败 / ffmpeg 缺失 → 400 带中文错误，
    // 客户端（use-waveform.ts）静默退回确定性降级公式 —— 波形是装饰性信息。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_WAVEFORM, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'waveform requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          file?: unknown
        }
        if (typeof body.projectId !== 'string' || typeof body.file !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId / file' })
          return
        }
        const envelope = await probeWaveformEnvelope(registry, body.projectId, body.file, controller.signal)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { envelope })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '波形加载失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // 上传参考视频（raw octet-stream，无 multipart / 无 base64 膨胀）。
    //
    // 2026-09-22 改造：**上传只落视频节点，不再自动抽帧**。Host 落盘 + 探时长 +
    // 上传 Drama 拿句柄，返回三样事实；画布节点仍由客户端写（P8.1 不变式）。
    // 抽帧与风格归纳改为画布右键「拆分视频」按需触发（见下方 ROUTE_SPLIT_VIDEO）。
    // 动因：上传即抽帧会一次刷出 N 张帧图 + 便签；且视频不落节点 ⇒ 既不能播放，
    // 也当不了参考视频（CV-226 已接通 video1..3）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_UPLOAD_VIDEO, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'video upload requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`)
        const projectId = requestUrl.searchParams.get('projectId')
        const name = requestUrl.searchParams.get('name') ?? ''
        if (projectId === null || projectId.length === 0) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        const bytes = await readRawBody(req, controller.signal, MAX_VIDEO_BODY_BYTES)
        const result = await importVideoAsset(registry, projectId, name, bytes, {}, controller.signal)
        if (!controller.signal.aborted && !res.destroyed) {
          // 只回两样事实（2026-09-22）：落盘 url 与时长。Drama 句柄**刻意不在这里拿**
          // —— 那是整段视频的远端上传，会挡住节点与首帧出现；句柄改由 @ref 首次引用
          // 时惰性提升（resolveRefFilenames）。
          sendJson(res, 200, {
            videoUrl: result.videoUrl,
            duration: result.duration,
          })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '视频上传失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // 拆分参考视频（2026-09-22 新增）：对**画布上已有的视频节点**按需抽帧 + 风格归纳。
    // 入参 `{ projectId, videoUrl, label? }` —— videoUrl 必须是本项目的画布资产
    // （`splitVideoAsset` 内用 assetKeyFromUrl 校验，顺带挡住路径穿越）。返回帧列表
    // （含 Drama filename）与归纳文本，节点仍由客户端落。
    //
    // **不删原视频**：它是画布上的正式节点；派生失败只清理本次新抽的帧。
    // 抽帧依据见 `video-style.ts` 的 planFrameTimes（短片每 2s 一帧、>16s 改全片均匀取 8 帧）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_SPLIT_VIDEO, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'video split requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown; videoUrl?: unknown; label?: unknown }
        const projectId = typeof body.projectId === 'string' ? body.projectId : ''
        const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl : ''
        const label = typeof body.label === 'string' ? body.label : ''
        if (projectId.length === 0) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        if (videoUrl.length === 0) {
          sendJson(res, 400, { error: '缺少 videoUrl' })
          return
        }
        const result = await splitVideoAsset(registry, projectId, videoUrl, label, {}, controller.signal)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, {
            videoUrl: result.videoUrl,
            duration: result.duration,
            frames: result.frames,
            summary: result.summary,
            tokens: result.tokens,
          })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '视频拆分失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // P9.2: 成片合成。客户端 POST 选中的分镜视频片段 id（与可选 BGM 节点
    // id）；Host 统一转码 → concat 拼接 → 可选 BGM 混音 → 落 assets 根目录
    // export-<uuid>.mp4，返回同源 URL + 成片时长，由 P9.3 前端回写画布节点。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_COMPOSE, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'compose requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const stopWatching = () => {
        req.off('aborted', onRequestAbort)
        res.off('close', onResponseClose)
      }
      const onRequestAbort = () => controller.abort()
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.once('aborted', onRequestAbort)
      res.once('close', onResponseClose)
      try {
        const body = await readJson(req, controller.signal) as {
          projectId?: unknown
          clipIds?: unknown
          bgmNodeId?: unknown
        }
        if (typeof body.projectId !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        if (!Array.isArray(body.clipIds) || !body.clipIds.every((id) => typeof id === 'string')) {
          sendJson(res, 400, { error: 'clipIds 必须是字符串数组' })
          return
        }
        const bgmNodeId = typeof body.bgmNodeId === 'string' ? body.bgmNodeId : undefined
        const result = await composeStudioVideo(
          registry,
          body.projectId,
          body.clipIds as string[],
          bgmNodeId,
          {},
          controller.signal,
        )
        if (!controller.signal.aborted && !res.destroyed) {
          // CV-143：音轨构成与降级说明一并回给前端（角标展示 + 提示条）。
          sendJson(res, 200, {
            url: result.url,
            duration: result.duration,
            width: result.width,
            height: result.height,
            audioComposition: result.audioComposition,
            ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
          })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '成片合成失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),
  ]
  return () => {
    for (const dispose of routes) dispose()
  }
}
