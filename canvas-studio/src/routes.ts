/**
 * Canvas Studio webServer routes: the project registry HTTP face consumed by
 * the browser client, plus the P3 media-generation and asset-serving faces.
 * Reads require a local loopback request; mutations add a same-origin
 * requirement (the established community-market pattern).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, rm, writeFile } from 'node:fs/promises'
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
import { generateAsset, promoteAssetFile, saveLocalAsset, saveLocalAssetBytes, handlesOfAssetFile, unlinkValuesInPromptJson, type GenerateParams } from './generate.js'
import { gcProjectAssets, gcLibraryAssets, deleteUnreferencedAssets, collectReferencedBasenames, basenameOfUrl } from './asset-gc.js'
import { loadAssetHistory, markHistoryDeleted } from './asset-history.js'
import { ASSET_TRASH_DIR } from './config.js'
import { resolveRefFilenames } from './reference-resolve.js'
import { MAX_RESOLVE_REFS, type ResolveRefItem } from './contracts/reference.js'
import { classifyFile, MEDIA_KIND_LABEL, MEDIA_UPLOAD_LIMITS } from './media-extension.js'
import { generateQueueSnapshot } from './generate-queue.js'
// P1 登录闭环（Supabase OAuth PKCE）：loopback 回调服务 + 会话中转缓存。
import { startLoopback, consumePendingCallback, loopbackActive, stopLoopback } from './auth-loopback.js'
import { setAuthSession, clearAuthSession } from './auth-session.js'
// 管理面编排（方案 P2/CV-356）：会话推送触发 auth/sync + 目录拉取（fire-and-forget）。
// 余额（CV-358）：会话推送后预取，读路径见 `GET /canvas-studio/account/credits`。
import { notifyAuthSession, notifyAuthCleared, refreshCredits, creditsView } from './account-state.js'
// Drama 异步任务恢复轮询的跟踪数（快照并入 resumedJobs，客户端据此保持轮询）。
import { activeResumeJobCount } from './video-jobs.js'
import { probeWaveformEnvelope } from './waveform-host.js'
import { parseProviderParam } from './providers/selection.js'
import { importVideoAsset, splitVideoAsset } from './video-style.js'
import { composeStudioVideo } from './compose.js'
import { cancelRenderJob, claimRenderJobFor, commitRenderJob, failRenderHostJobs, listRenderJobViews, recordRenderSample, reportRenderJobProgress, type RenderExecutor, type RenderJobReport } from './remotion/render-job.js'
// REQ-034 · O-05：RenderHost 隐藏窗口（页面 / 自报状态 / 生命周期）。
import { renderHostHtml } from './render-host/page.js'
import { lastRenderHostReport, recordRenderHostReport } from './render-host/status.js'
import { setRenderHostLauncher, setRenderHostResetter } from './render-host/dispatch.js'
import { disposeRenderHost, ensureRenderHost, renderHostSnapshot, touchRenderHost } from './render-host/window.js'
import { isActiveShot, isComposeProduct } from './shot-versions.js'
import { normalizeCanvasView } from './canvas-view.js'
import { storageInfoSnapshot } from './storage-info.js'
import { ensureStoryboardSkeleton, loadStoryboard, loadStoryboardOrFail, updateStoryboardOrFail } from './storyboard-store.js'
import { landStoryboard } from './storyboard-land.js'
import { healStoryboardState } from './storyboard-gate.js'
import { BRIEF_NODE_TOOL } from './contracts/canvas.js'
import { renderStoryboard, renderStoryboardPlaceholder, renderStoryboardCorrupt, renderStoryboardNotice, filledSectionCount } from './storyboard-render.js'
import { archive as archiveVersion, nextVersionId, relabel, restoreTo, versionById } from './storyboard-history.js'
import { diffSections, summarizeDiff, type DiffEntry } from './storyboard-diff.js'
import type { StoryboardDocument, StoryboardSections, StoryboardVersions } from './contracts/storyboard.js'
import { validateForSeed } from './contracts/storyboard.js'
import { asCanvasError, isDevMode, routeError, throwError } from './error-system.js'
import { invalidateActiveSkillsPromptCache, refreshActiveSkillsPromptCache } from './active-skills-prompt.js'
import { resetLookBudget } from './look-budget.js'
import { invalidateWorkflowModeCache } from './workflow-mode-prompt.js'
// CV-331/332/333：用户上传 skill 面（列表 / 导入 / 删除 / 回收站）。
import { SKILL_CATALOG, VISIBLE_CATALOG, builtinSlotOwners } from './skill-catalog.js'
import { validateImport } from './skill-import-validate.js'
import { isValidSlug } from './skill-upload-contract.js'
import {
  countProjectsLoadingSkill, emptySkillTrash, listUserSkills, skillNameOfSlug,
  trashUserSkill, writeUserSkill,
} from './user-skills.js'
import type { DeleteSkillResult, EmptyTrashResult, ImportSkillResult } from './contracts/skill.js'
import './errors/catalog.js'

const ROUTE_PROJECTS = '/canvas-studio/projects'
// REQ-005 / T4：项目 touch（只写 updatedAt）。独立 exact 路由 —— ROUTE_PROJECTS
// 那条 exact 的 POST 语义已被「创建」占满，再挤进去只会让方法分派读起来像迷宫。
// CV-264③：touch 路由常量已删除（「打开项目」不再写 updatedAt）。
// REQ-005 v1.3（变体 A）：首页 draft 落点。幂等创建当月 draft 目录并返回路径，
// client 拿它去绑宿主 workspace / 会话（workspaces.create({path})）。
const ROUTE_PROJECT_DRAFT = '/canvas-studio/draft-landing'
// REQ-003（§4.3）：画布节点 / 资产库条目 → 可消费的 Drama 句柄（UI 的「添加参考图」用）。
const ROUTE_RESOLVE_REFS = '/canvas-studio/resolve-refs'
const ROUTE_GROUPS = '/canvas-studio/groups'
const ROUTE_GENERATE = '/canvas-studio/generate'
const ROUTE_GENERATE_QUEUE = '/canvas-studio/generate-queue'
const ROUTE_ASSETS = '/canvas-studio/assets'
// REQ-001：全局资产库（列表/详情/CRUD/锚点/媒体共用一条前缀，路径内分派）。
const ROUTE_LIBRARY = '/canvas-studio/library'
const ROUTE_STYLE_DEMOS = '/canvas-studio/style-demos'
const ROUTE_CANVAS = '/canvas-studio/canvas'
/** REQ-022（CV-293）：拍摄定稿只读覆盖层（prefix + 手动解析 `{projectId}.html`）。 */
const ROUTE_STORYBOARD = '/canvas-studio/storyboard'
/** 该 prefix 下的写类动作（POST + 同源校验）；其余路径都是只读。 */
const STORYBOARD_WRITE_ACTIONS: ReadonlySet<string> = new Set(['archive', 'restore', 'rename', 'land'])
/**
 * P1 登录闭环：Supabase OAuth PKCE 的回调中转面（prefix + 内部分派，同 storyboard
 * 模式 —— WebServer 无 `:id` 参数位）。见 auth-loopback.ts / auth-session.ts。
 */
const ROUTE_AUTH = '/canvas-studio/auth'
/** 登录弹窗右侧循环视频：包内静态资产（assets/login/intro.mp4，随包含 4.7MB）。 */
const LOGIN_VIDEO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'login', 'intro.mp4')
/**
 * REQ-022：故事板的读改写助手（`loadStoryboardOrFail` / `updateStoryboardOrFail`）
 * 已于 CV-305 搬进 `storyboard-store.ts` —— 落地执行体也需要同一套报错，
 * 两处各写一份必然漂移。本模块只 import。
 *
 * 落地本身的执行体（校验 → 快照 → 投影 → 写画布 → 推状态）搬进
 * `storyboard-land.ts`（CV-305）：那是**唯一实现点**，且它现在是可测的
 * （窄 registry 接口 + 可注入假 registry），不必再靠字符串断言兜。
 */

/** 落地后的统一拦截（单向终点：落地后不再接受任何版本写操作）。 */
function assertNotLanded(document: StoryboardDocument): void {
  if (document.landed === null) return
  throwError('CS-USER-ERR', {
    message: `本项目已落地（${document.landed.sourceVersion}），版本操作已冻结。版本列表仍可只读回看。`,
  })
}

/** 手动存档：把活副本打成一个新版本（`kind:'manual'`，可命名 + 可备注）。 */
async function archiveStoryboard(
  registry: ProjectRegistry,
  projectId: string,
  label: string | undefined,
  note: string | undefined,
): Promise<StoryboardVersions> {
  const document = await loadStoryboardOrFail(registry, projectId)
  assertNotLanded(document)
  const trimmedLabel = label?.trim() ?? ''
  const trimmedNote = note?.trim() ?? ''
  const next = await updateStoryboardOrFail(registry, projectId, (current) => ({
    ...current,
    versions: archiveVersion(current.versions, current.sections, {
      kind: 'manual',
      label: trimmedLabel === '' ? `存档 ${nextVersionId(current.versions)}` : trimmedLabel,
      ...(trimmedNote === '' ? {} : { note: trimmedNote }),
    }),
  }))
  return next.versions
}

/** 回退到某个历史版本：先打点当前活副本（不丢数据），再覆盖（方案 §3.3 选项 A）。 */
async function restoreStoryboard(
  registry: ProjectRegistry,
  projectId: string,
  version: string,
): Promise<StoryboardVersions> {
  const document = await loadStoryboardOrFail(registry, projectId)
  assertNotLanded(document)
  if (versionById(document.versions, version) === undefined) {
    throwError('CS-USER-ERR', { message: `没有这个版本：${version}` })
  }
  const next = await updateStoryboardOrFail(registry, projectId, (current) => {
    const result = restoreTo(current.versions, current.sections, version)
    if (result === undefined) throwError('CS-USER-ERR', { message: `没有这个版本：${version}` })
    return { ...current, versions: result.versions, sections: result.sections }
  })
  return next.versions
}

/** 改版本名（`label` / `note`）—— 版本号与内容都不动。 */
async function renameStoryboard(
  registry: ProjectRegistry,
  projectId: string,
  version: string,
  label: string,
  note: string | undefined,
): Promise<StoryboardVersions> {
  // 先读一次只为「项目没有故事板 / 是旧格式」时给一致的报错；改名本身在 update 里做。
  await loadStoryboardOrFail(registry, projectId)
  const trimmed = label.trim()
  if (trimmed === '') throwError('CS-USER-ERR', { message: '版本名不能为空。' })
  const next = await updateStoryboardOrFail(registry, projectId, (current) => {
    const versions = relabel(current.versions, version, trimmed, note)
    if (versions === undefined) throwError('CS-USER-ERR', { message: `没有这个版本：${version}` })
    return { ...current, versions }
  })
  return next.versions
}

/**
 * 创意先行：storyboard 渲染的缩略图解析器 —— 把 `refImage` / `lookRef` / §07 引用
 * 解析成画布资产 URL。画布读失败时返回 `undefined`（渲染层降级为纯文本），不抛错。
 */
async function storyboardMediaResolver(
  registry: ProjectRegistry,
  projectId: string,
): Promise<((ref: { kind: 'canvasNode' | 'file'; id: string }) => string | undefined) | undefined> {
  const document = await registry.readCanvas(projectId).catch(() => null)
  if (document === null) return undefined
  const byId = new Map(document.nodes.map((node) => [node.id, node.url]))
  return (ref) => {
    if (ref.kind === 'canvasNode') return byId.get(ref.id)
    // `file` 引用 = 项目 assets/ 下的文件名，走资产路由 URL。
    return ref.id === '' ? undefined : `/canvas-studio/assets/${projectId}/${ref.id}`
  }
}

/**
 * CV-296：故事板渲染的用户原始创意 —— 画布 BRIEF 节点（CV-023 创意捕获）的全文。
 * 原话是「一切开始的地方」，故事板阶段画布被覆盖层挡住，这里把它接出来展示。
 * 画布读失败 / 没有创意节点 → `undefined`（渲染层不渲染该块），不抛错。
 */
async function storyboardSourceIdea(registry: ProjectRegistry, projectId: string): Promise<string | undefined> {
  const document = await registry.readCanvas(projectId).catch(() => null)
  if (document === null) return undefined
  const briefNode = document.nodes.find((node) => node.toolName === BRIEF_NODE_TOOL)
  const text = briefNode?.text ?? ''
  return text.trim() === '' ? undefined : text
}

/** 版本摘要（UI 用；**不含快照**，避免大 payload）。 */
async function storyboardSummary(registry: ProjectRegistry, projectId: string): Promise<Record<string, unknown>> {
  const document = await loadStoryboardOrFail(registry, projectId)
  return {
    baseline: document.versions.baseline,
    seq: document.versions.seq,
    live: {
      filled: filledSectionCount(document.sections),
      // 阶段四：落地预检前置 —— 客户端在按「确认落地」**之前**就能看到缺哪几项，
      // 而不是按下去才吃一个 400。与 Host 落地闸共用同一份 `validateForSeed`。
      blockers: validateForSeed(document).blockers,
    },
    versions: document.versions.history.map((entry) => ({
      version: entry.version,
      kind: entry.kind,
      label: entry.label,
      ...(entry.note === undefined ? {} : { note: entry.note }),
      createdAt: entry.createdAt,
      parent: entry.parent,
      filled: filledSectionCount(entry.snapshot),
      isBaseline: entry.version === document.versions.baseline,
    })),
    landed: document.landed === null ? null : { at: document.landed.at, sourceVersion: document.landed.sourceVersion },
  }
}

/** 字段级差异：`from` / `to` 各是 `live` 或版本号。 */
async function storyboardDiff(
  registry: ProjectRegistry,
  projectId: string,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  const document = await loadStoryboardOrFail(registry, projectId)
  const resolve = (which: string): { sections: StoryboardSections; label: string } => {
    if (which === 'live') return { sections: document.sections, label: '活副本' }
    const found = versionById(document.versions, which)
    if (found === undefined) throwError('CS-USER-ERR', { message: `没有这个版本：${which}` })
    return { sections: found.snapshot, label: found.label }
  }
  const left = resolve(from)
  const right = resolve(to)
  const entries = diffSections(left.sections, right.sections)
  return {
    from: { id: from, label: left.label },
    to: { id: to, label: right.label },
    total: entries.length,
    sections: summarizeDiff(entries),
    entries,
  }
}
// CV-243：资产废料回收。独立路径（不走 ROUTE_ASSETS 前缀）避免与媒体服务路由碰撞。
const ROUTE_ASSET_GC = '/canvas-studio/asset-gc'
// CV-246：生成产物历史（读列表 + 面板删除）。独立路径避免与媒体服务路由碰撞。
const ROUTE_ASSET_HISTORY = '/canvas-studio/asset-history'
// REQ-021 R001 后续（方案 B）：存储目录只读诊断面（设置页诊断区「存储目录」信息块）。
const ROUTE_STORAGE_INFO = '/canvas-studio/storage-info'
// CV-358：管理面余额只读面（左栏余额卡的数据来源）。只读 ⇒ requestAllowed。
const ROUTE_ACCOUNT_CREDITS = '/canvas-studio/account/credits'
const ROUTE_ACTIVE_SKILLS = '/canvas-studio/active-skills'
/**
 * CV-331：用户上传 skill 面（prefix + 内部分派，与 storyboard / auth 同模式 ——
 * WebServer 没有 `:id` 参数位）。四条面共享一个前缀，让「这个资源有哪些动作」
 * 在一处可见：GET 列表只读，其余三条都是写动作。
 */
const ROUTE_SKILLS = '/canvas-studio/skills'
/** 该 prefix 下的写动作（POST + 同源校验）；不在集合内的一律 405。 */
const SKILL_WRITE_ACTIONS: ReadonlySet<string> = new Set(['/import', '/delete', '/trash/empty'])
/**
 * 导入请求体上限：D5 的「总量 ≤2MB」×2 冗余。
 *
 * 比全局 `MAX_BODY_BYTES`（16MB）小得多是刻意的：用户 skill 是**纯文本知识包**，
 * 一份 4MB 的导入必然不是手写的 skill，早点拒掉比写完再发现更好。
 */
const SKILL_IMPORT_MAX_BYTES = 4 * 1024 * 1024
const ROUTE_WORKFLOW = '/canvas-studio/workflow'
// REQ-021：自动测试报告落盘（写入测试项目目录 test-report.md）。
const ROUTE_TEST_REPORT = '/canvas-studio/test-report'
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
// REQ-034 · B3：route B（CSR）渲染工单桥三路由 —— 客户端轮询取单 / 回写成片 / 撤单。
const ROUTE_REMOTION_PENDING = '/canvas-studio/remotion/pending'
const ROUTE_REMOTION_COMMIT = '/canvas-studio/remotion/commit'
const ROUTE_REMOTION_CANCEL = '/canvas-studio/remotion/cancel'
// 三期 1b：队列 + 进度（`GET` 列表 / `POST` 上报）。客户端轮询列表拿进度，上报节流到 ~3%。
const ROUTE_REMOTION_JOBS = '/canvas-studio/remotion/jobs'
const ROUTE_REMOTION_PROGRESS = '/canvas-studio/remotion/progress'
// 三期 W6-1：抽帧回写（`POST` PNG 原始字节 + `jobId` / `frame`）。
const ROUTE_REMOTION_SAMPLE = '/canvas-studio/remotion/sample'
// 三期 W2-4：颗粒 tile（随包静态 PNG，逐帧按整数偏移平铺）。
const ROUTE_REMOTION_GRAIN = '/canvas-studio/remotion/grain'
// REQ-034 · R1：随包中文字体子集（`assets/fonts/*.woff2`）只读路由。客户端 CSR 渲染前
// 以**同源** `@font-face` 注入 —— 跨源会静默 404 → 回退系统字体 → 中文观感事故
//（devdoc §8.3 第 4 条标红项），勿改成别的域或改走 base64 内联。
const ROUTE_REMOTION_FONTS = '/canvas-studio/remotion/fonts'
// REQ-034 · O-05：RenderHost 隐藏渲染窗口的三条路由（页面 / bundle / 自报状态）。
// 页面与 bundle 由**隐藏窗口自己**加载，不给外部浏览器用 ⇒ 仍然只认 loopback authority。
const ROUTE_RENDER_HOST = '/canvas-studio/render-host'
const ROUTE_RENDER_HOST_JS = '/canvas-studio/render-host.js'
const ROUTE_RENDER_HOST_STATUS = '/canvas-studio/render-host/status'
/** 窗口自报 unsupported/error 的告警去重（状态变化才再打；回到 idle 即复位）。 */
let lastRenderHostWarnedState: 'unsupported' | 'error' | undefined
/** 页面 bundle 与 routes.js 同级（tsdown 的第二个 entry 产出 `lib/render-host.js`）。 */
const RENDER_HOST_BUNDLE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'render-host.js')
const MAX_BODY_BYTES = 16 * 1024 * 1024
/** 参考视频上限：短参考片为主，128MB 已远超风格采样所需（上传与拆分共用）。 */
const MAX_VIDEO_BODY_BYTES = 128 * 1024 * 1024
/** REQ-034 · B3：CSR 成片回写上限（30s@720p h264 通常 <30MB；给到 256MB 留余量）。 */
const MAX_RENDER_BODY_BYTES = 256 * 1024 * 1024
const MAX_CANVAS_NODES = 2000
/** CV-066：单项目最多装载的 skill 数（UI 是 chip 横排，超长会溢出）。 */
const MAX_ACTIVE_SKILLS = 12

const loopbackAddresses = new BlockList()
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
loopbackAddresses.addSubnet('::1', 128, 'ipv6')

/** 包内风格演示 GIF 目录：sync 脚本从 minimax-h3 submodule copy（lib 产物 → 包根 assets/style-demos）。 */
const STYLE_DEMO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'style-demos')

/** REQ-034 · R1：随包中文字体子集目录（`scripts/build-font-subset.mjs` 产出，产物入库）。 */
const REMOTION_FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts')
/** 三期 W2-4：颗粒 tile（`scripts/build-grain-tile.mjs` 产出，确定性噪点、产物入库）。 */
const REMOTION_GRAIN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'remotion', 'grain.png')

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
  readonly expectedPort: number | undefined
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

function requestContext(req: IncomingMessage, expectedPort: number | undefined): StudioRequestContext {
  const secFetchSite = req.headers['sec-fetch-site']
  return {
    remoteAddress: req.socket.remoteAddress,
    origin: req.headers.origin,
    host: req.headers.host,
    ...(typeof secFetchSite === 'string' ? { secFetchSite } : {}),
    expectedPort,
  }
}

function requestAllowed(req: IncomingMessage, expectedPort: number | undefined): boolean {
  return studioAuthority(requestContext(req, expectedPort)) !== undefined
}

function mutationAllowed(req: IncomingMessage, expectedPort: number | undefined): boolean {
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

/**
 * REQ-034 · B3：`/remotion/commit` 的 `warnings` query 收口 —— URL 编码的 JSON
 * 字符串数组。形状不符 / 解析失败一律返回 `[]`（告警是非关键信息，不因它 400）。
 */
function asRenderWarnings(raw: string | null): string[] {
  if (raw === null || raw.length === 0) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) return []
    return parsed as string[]
  } catch {
    return []
  }
}

/**
 * 三期 W6-2：`/remotion/commit` 的 `metrics` query 收口（URL 编码 JSON）。
 *
 * 只接受有限数；形状不符返回 `undefined`（报告是观测信息，不因它 400）。
 */
function asRenderReport(raw: string | null): Partial<RenderJobReport> | undefined {
  if (raw === null || raw.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const source = parsed as Record<string, unknown>
  const num = (key: string): number | undefined => {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const report: Partial<RenderJobReport> = {}
  for (const key of ['frames', 'totalMs', 'prepareMs', 'renderMs', 'msPerFrame', 'encodeDoneAtMs', 'bytes', 'bitrateKbps', 'width', 'height', 'sampledFrames'] as const) {
    const value = num(key)
    if (value !== undefined) report[key] = value
  }
  if (source.quality === 'draft' || source.quality === 'standard' || source.quality === 'high') {
    report.quality = source.quality
  }
  return report
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
  const expectedPort = (): number | undefined => ctx.webServer.port
  // REQ-005 v1.3（变体 A）：启动清扫 —— 回收上一次会话遗留的无人认领 draft 目录。
  // fire-and-forget：清扫失败不影响任何路由；结果只落日志。
  // CV-292：走 sweepOnceForCurrentRoot（按 root 键控、每进程每根至多一次）—— 这一拍
  // 早于「资产库位置」hydration，自定义根的用户这一趟扫的是默认根；真正的清扫由
  // 首页落点（ensureDraftDir → sweepOnceForCurrentRoot）在配置生效后补上，同根不会重复扫。
  void registry.sweepOnceForCurrentRoot().then(
    (removed) => { if (removed > 0) ctx.logger.info(`[canvas-studio] draft 清扫：回收 ${removed} 个未认领目录`) },
    (cause: unknown) => { ctx.logger.warn(`[canvas-studio] draft 清扫失败: ${cause instanceof Error ? cause.message : String(cause)}`) },
  )
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
      if (!requestAllowed(req, expectedPort())) {
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
        if (!mutationAllowed(req, expectedPort())) {
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
        if (!mutationAllowed(req, expectedPort())) {
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
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
        const body = await readJson(req, controller.signal) as { name?: unknown; groupId?: unknown; plan?: unknown; mode?: unknown; dir?: unknown }
        const name = asProjectName(body)
        const groupId = typeof body.groupId === 'string' ? body.groupId : null
        // CV-099：预置规格（画幅 / 目标总时长）。非法值由 normalizePlan 降级为
        // undefined，等价于「未锁定」，不因脏输入让创建失败。
        const plan = normalizePlan(body.plan)
        // CV-196：创建时锁定的执行模式。非法 / 缺失 → undefined，由 registry 回落到
        // 设置页「默认执行模式」（**不是**在这里兜 'confirm'，那会把设置页开关架空）。
        const mode = normalizeWorkflowMode(body.mode)
        // REQ-005 v1.3（变体 A）：body.dir 存在 = 认领变体 —— 把已存在的 draft 目录
        // 直接登记为项目（不 mint 新目录）。目录合法性（projects 内 / 已存在 / 未被
        // 占用）由 createClaimingDir 收口校验，客户端给的路径面在这里收死。
        const project = typeof body.dir === 'string' && body.dir.length > 0
          ? await registry.createClaimingDir(name, body.dir, plan, mode)
          : await registry.create(name, groupId, plan, mode)
        // 创意先行：建项目即预建故事板骨架 v1（仅 meta），中栏从 0/9 起随 agent
        // 分次写逐节填满；骨架写失败不阻断创建（agent 首稿路径原样兜底）。
        await ensureStoryboardSkeleton(registry, project.id, project.name, plan).catch(() => undefined)
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 201, { project })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '项目创建失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // CV-264③：REQ-005/T4 的 touch 路由已删除 —— 「打开项目」不再写 updatedAt
    // （验收反馈：点哪个哪个跳第一，不稳定）。列表按「最后修改」倒序，燃料来自
    // writeCanvas（画布保存 / 生成结算）、updateWorkflow、移组等真修改。

    // REQ-005 v1.3（变体 A）：首页 draft 落点。幂等创建当月 draft 目录并返回绝对
    // 路径，client 拿它 `workspaces.create({ path })` 绑定宿主 workspace / 会话。
    // 无请求体（POST + same-origin 仅为对齐变更面安全口径）；不认领、不登记，
    // registry 无记录 —— 未被认领的目录由启动清扫回收。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_PROJECT_DRAFT, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'draft landing requires a local same-origin POST' })
        return
      }
      try {
        const dir = await registry.ensureDraftDir()
        if (!res.destroyed) sendJson(res, 200, { dir })
      } catch (cause) {
        if (!res.destroyed) sendRouteFailure(res, cause, 500, '首页准备失败，请稍后重试。')
      }
    }}),

    // REQ-003（§4.3）：把画布节点 id / `lib:<id>` 解析成**可直接下发**的 Drama 文件名。
    // UI 的「添加参考图」必须走这里：生成产物节点上的 filename 是后端**产物名**
    // （`img_*`），直接当参考会 500（CV-155 实测）—— 可用句柄要靠解析链现造并回写源节点。
    // **逐项 try/catch**：一次选 5 张、坏了 1 张，只该坏那一张，不能整批失败。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_RESOLVE_REFS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'resolve-refs requires POST' })
        return
      }
      if (!mutationAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio resolve-refs requires a local same-origin request' })
        return
      }
      const controller = new AbortController()
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown; refs?: unknown }
        if (typeof body.projectId !== 'string' || body.projectId.length === 0 || !Array.isArray(body.refs)) {
          sendJson(res, 400, { error: 'resolve-refs requires { projectId, refs[] }' })
          return
        }
        const projectId = body.projectId
        const refs = body.refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
        const items: ResolveRefItem[] = []
        for (const ref of refs.slice(0, MAX_RESOLVE_REFS)) {
          try {
            const resolved = await resolveRefFilenames(registry, projectId, [ref], library)
            const handle = resolved[0]
            if (handle === undefined) {
              const err = asCanvasError(throwError('CS-USER-001', { ref, detail: 'resolve-refs 返回空' }))
              items.push({ ref, error: { code: err.code, message: err.userMessage } })
              continue
            }
            items.push({ ref, handle })
          } catch (cause) {
            const err = asCanvasError(cause)
            items.push({ ref, error: { code: err.code, message: err.userMessage } })
          }
        }
        if (!res.destroyed) sendJson(res, 200, { items })
      } catch (cause) {
        if (!res.destroyed) sendRouteFailure(res, cause, 500, '取参考图句柄失败，请稍后重试。')
      }
    }}),

    // CV-091: project-group face. GET lists groups; POST creates; PATCH renames;
    // DELETE removes (its projects fall back to ungrouped). Reads need loopback
    // authority; mutations add the same-origin check used by the project routes.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_GROUPS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
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
      if (!mutationAllowed(req, expectedPort())) {
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
      if (!mutationAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
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

    // REQ-021 R001 后续（方案 B）：存储目录只读诊断面。设置页诊断区渲染
    // 「存储目录」信息块：draft 堆积统计（空 X / 非空 Y）+ 项目「名称 → 目录名」
    // 对照。认领时已就地改名为项目名（CV-294 方案 A），`.draft-` 点前缀只剩未认领
    // 落点（及改名失败回退的个别项目）—— 点前缀目录在 Finder 默认不可见，这里把
    // 「落在哪、堆积多少」变成可读的。
    // 只读 ⇒ 走 requestAllowed（不要求 same-origin），与 generate-queue 同款；
    // 快照组装（storageInfoSnapshot）永不抛错的纪律在模块内成立，这里的 catch
    // 只是 HTTP 面的最后一道兜底。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_STORAGE_INFO, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'storage-info is read-only' })
        return
      }
      try {
        const info = await storageInfoSnapshot(registry)
        if (!res.destroyed) sendJson(res, 200, info)
      } catch (cause) {
        if (!res.destroyed) sendRouteFailure(res, cause, 500, '存储信息读取失败，请稍后重试。')
      }
    }}),

    // CV-358：管理面余额只读面（左栏余额卡的数据来源）。
    // `?refresh=1` 绕 Host 的 30s TTL（用户点卡片 / 生成结束后的强刷）；**在飞去重
    // 在 account-state 里做**（连点只发一个请求），这里不二次判断。失败不 500 ——
    // 视图本身带 error + 旧值，UI 保留数字并标灰，比一张错误卡有用。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_ACCOUNT_CREDITS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'account credits is read-only' })
        return
      }
      const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
      try {
        await refreshCredits(force)
        if (!res.destroyed) sendJson(res, 200, creditsView())
      } catch (cause) {
        // refreshCredits 自身不抛；这是 HTTP 面的最后一道兜底。
        if (!res.destroyed) sendRouteFailure(res, cause, 500, '积分读取失败，请稍后重试。')
      }
    }}),

    // P3: asset serving. The Host writes generated media into each project's
    // assets/ directory; this prefix route streams those files back. Only
    // loopback + same-origin requests are allowed, and path traversal is
    // blocked by verifying the resolved path stays under the project assets dir.
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_ASSETS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'assets only support GET' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
    //   POST   /library/:id/media      → 上传媒体（octet-stream，?name=&label=）
    //   GET    /library/:assetId/:file → 媒体文件（字符集 + 目录前缀双校验）
    // 只读走 requestAllowed；写走 mutationAllowed（同源 + pathname '/'，与项目/分组面一致）。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_LIBRARY, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      const method = req.method ?? 'GET'
      const isRead = method === 'GET' || method === 'HEAD'
      if (!isRead && !mutationAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio library changes require a local same-origin request' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
        // ── POST /library/:id/media：上传媒体（octet-stream 原始字节，REQ-001
        //    「上传图片到资产库」）。Query: name（原始文件名，扩展名决定分类与
        //    落盘后缀）、label（可选视图标签）。照 /upload-media 纪律：按
        //    classifyFile 分类型限额（MEDIA_UPLOAD_LIMITS）在读流阶段拒绝超限
        //    （413）与不支持类型（400）；成功回整条 asset（media 已追加）。
        if (method === 'POST' && parts.length === 2 && parts[1] === 'media') {
          const id = parts[0]!
          if (!safeSegment(id)) {
            sendJson(res, 400, { error: '非法的资产 id' })
            return
          }
          const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
          const name = requestUrl.searchParams.get('name') ?? ''
          const label = requestUrl.searchParams.get('label') ?? undefined
          if (name.length === 0) {
            sendJson(res, 400, { error: '缺少 name（原始文件名）' })
            return
          }
          const kind = classifyFile(name)
          if (kind === null || kind === 'text') {
            sendJson(res, 400, {
              error: `不支持的文件类型：${name}（资产库仅收图片 / 视频 / 音频）`,
              code: 'CS-USER-ERR',
            })
            return
          }
          const mediaLabel = MEDIA_KIND_LABEL[kind]
          const limit = MEDIA_UPLOAD_LIMITS[kind]
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
            const declared = Number(req.headers['content-length'] ?? '0')
            if (Number.isFinite(declared) && declared > limit) {
              sendJson(res, 413, {
                error: `${mediaLabel}上传失败：超出大小上限（${Math.round(limit / 1024 / 1024)}MB）`,
                code: 'CS-USER-ERR',
              })
              return
            }
            const bytes = await readRawBody(req, controller.signal, limit)
            const asset = await library.addMedia(id, name, bytes, label)
            if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { asset })
          } catch (cause) {
            if (!controller.signal.aborted && !res.destroyed) {
              const message = cause instanceof Error ? cause.message : String(cause)
              if (message.includes('body too large')) {
                sendJson(res, 413, { error: `${mediaLabel}上传失败：${message}`, code: 'CS-USER-ERR' })
                return
              }
              sendRouteFailure(res, cause, 400, '媒体上传失败，请稍后重试。')
            }
          } finally {
            stopWatching()
          }
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'asset gc requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown; purgeTransient?: unknown }
        if (typeof body.projectId !== 'string') {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        // F-17：抽帧/探针产物默认只报告；`purgeTransient: true` 才真的清（显式动作）。
        const result = await gcProjectAssets(registry, body.projectId, {
          ...(body.purgeTransient === true ? { purgeTransient: true } : {}),
        })
        // REQ-001 §8-L：项目 GC 的同一次手动触发顺带清全局库孤儿（目录/文件两档）。
        const libResult = await gcLibraryAssets(library)
        sendJson(res, 200, { ok: true, ...result, library: libResult })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '资产回收失败，请稍后重试。')
        }
      }
    }}),

    // CV-246：生成产物历史——GET 列表（含已删条目，客户端按 deletedAt 过滤展示）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_ASSET_HISTORY, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'history delete requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown; file?: unknown; force?: unknown }
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
          // B-4（2026-10-03）：被引用时默认 409 并**列名**直接引用节点（确认框
          // 指名道姓）；`force: true` 走「彻底删除 = 解除引用 + 物理删」：
          // ① 直接引用节点（url 挂着该文件）随删——生成中（isLoading）保护；
          // ② 间接引用（generationPrompt 里的句柄/文件名）按 manifest 全历史
          //    解引用——数组删元素、标量首帧位打 [已删除:<值>] 标记（重放时
          //    指名道姓失败，不静默降级成文生视频）。
          const direct = doc.nodes
            .filter(node => node.url !== undefined && basenameOfUrl(node.url) === body.file)
            .map(node => ({ id: node.id, title: node.title ?? '', kind: node.kind }))
          if (body.force !== true) {
            sendJson(res, 409, { error: '该产物仍被画布节点引用', direct })
            return
          }
          const busy = direct.filter(node => doc.nodes.find(entry => entry.id === node.id)?.isLoading === true)
          if (busy.length > 0) {
            sendJson(res, 409, { error: '以下节点正在生成中，请等结束后再删', direct: busy })
            return
          }
          const directIds = new Set(direct.map(node => node.id))
          const handles = await handlesOfAssetFile(registry, body.projectId, body.file)
          const unlinkValues = new Set<string>([...handles, body.file])
          const keptNodes = doc.nodes
            .filter(node => !directIds.has(node.id))
            .map(node => {
              if (node.generationPrompt === undefined) return node
              const generationPrompt = unlinkValuesInPromptJson(node.generationPrompt, unlinkValues)
              if (generationPrompt === node.generationPrompt) return node
              const next = { ...node }
              if (generationPrompt !== undefined) next.generationPrompt = generationPrompt
              return next
            })
          await registry.writeCanvas(body.projectId, keptNodes, undefined, undefined, { removedIds: [...directIds] })
        }
        const assetsDir = registry.assetsDir(body.projectId)
        // B-1 定案（2026-10-03）：彻底删除 = 物理删（无回退口径，不再 rename 进 .trash）。
        try {
          await rm(join(assetsDir, body.file), { force: true })
        } catch {
          // 源不存在（早已删过）——只补账，不报错。
        }
        await markHistoryDeleted(registry, body.projectId, body.file)
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '历史删除失败，请稍后重试。')
        }
      }
    }}),

    // CV-277：批量清理「失效产物」——一次请求清掉全部被取代 / 手动作废的素材。
    //
    // 为什么需要（NEW-3）：CV-246 的设计是「未删的历史条目 = GC 保护名单」，本意是
    // 让用户能回溯被顶掉的版本；但它没有给「不想要了」一条批量出口 —— 逐条点删除
    // 在一次误判造成 5 条废弃视频时（揽月湾实测 4.25 MB）几乎没人会做，磁盘只增
    // 不减。本路由给出显式出口，且**不改变 GC 保护语义**（仍是用户主动触发）。
    //
    // 判据 = `isActiveShot` 的反面（retired 或 supersededBy 有值）**且**不是成片
    // 节点（成片是产物不是素材，见 `isComposeProduct`）。生效中（isLoading）节点
    // 跳过并在响应里回报，不静默放过。
    //
    // 复用单条删除的**两段式**语义：逐文件走同一套「删引用节点 + 解引用下游
    // generationPrompt + 物理删 + 标 deletedAt」。写盘合并为**一次** writeCanvas
    // （逐条删会 N 次全量重写画布，节点多时很慢）。
    ctx.webServer.register({ kind: 'exact', path: `${ROUTE_ASSET_HISTORY}/prune-retired`, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'history prune requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const body = await readJson(req, controller.signal) as { projectId?: unknown }
        if (typeof body.projectId !== 'string' || body.projectId.length === 0) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        const doc = await registry.readCanvas(body.projectId)
        // 候选节点 = 失效的图/视频素材节点（成片、音频、文本一律不收：成片是产物，
        // 音频无 superseded 语义，文本删了会丢脚本）。
        const staleNodes = doc.nodes.filter((node) => (
          (node.kind === 'video' && !isComposeProduct(node) || node.kind === 'image')
          && !isActiveShot(node)
        ))
        const busy = staleNodes.filter((node) => node.isLoading === true)
        const stale = staleNodes.filter((node) => node.isLoading !== true)
        // 文件名 → 直接引用它的失效节点（一个文件可能被粘贴复制出多个节点）。
        // 防路径穿越：与单条删除路由同一判据（`promoteAssetFile` 白名单同源）。
        const byFile = new Map<string, string[]>()
        for (const node of stale) {
          const file = basenameOfUrl(node.url ?? '')
          if (file === null || !/^[A-Za-z0-9._-]+$/u.test(file) || file.startsWith('.')) continue
          const list = byFile.get(file)
          if (list === undefined) byFile.set(file, [node.id])
          else list.push(node.id)
        }
        if (byFile.size === 0) {
          sendJson(res, 200, { ok: true, removedFiles: [], removedNodes: 0, busyNodes: busy.map((node) => ({ id: node.id, title: node.title ?? '' })) })
          return
        }
        // 逐文件解引用下游节点的 generationPrompt（同一文件的历史句柄一并解绑）
        const removedIds = new Set<string>()
        const unlinkAll = new Set<string>()
        for (const [file, nodeIds] of byFile) {
          for (const id of nodeIds) removedIds.add(id)
          unlinkAll.add(file)
          for (const handle of await handlesOfAssetFile(registry, body.projectId, file)) unlinkAll.add(handle)
        }
        const keptNodes = doc.nodes
          .filter((node) => !removedIds.has(node.id))
          .map((node) => {
            if (node.generationPrompt === undefined) return node
            const generationPrompt = unlinkValuesInPromptJson(node.generationPrompt, unlinkAll)
            if (generationPrompt === node.generationPrompt) return node
            const next = { ...node }
            if (generationPrompt !== undefined) next.generationPrompt = generationPrompt
            return next
          })
        await registry.writeCanvas(body.projectId, keptNodes, undefined, undefined, { removedIds: [...removedIds] })
        const assetsDir = registry.assetsDir(body.projectId)
        for (const file of byFile.keys()) {
          try {
            await rm(join(assetsDir, file), { force: true })
          } catch {
            // 源不存在（早已删过）——只补账，不报错。
          }
          await markHistoryDeleted(registry, body.projectId, file)
        }
        sendJson(res, 200, {
          ok: true,
          removedFiles: [...byFile.keys()],
          removedNodes: removedIds.size,
          busyNodes: busy.map((node) => ({ id: node.id, title: node.title ?? '' })),
        })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '清理失效产物失败，请稍后重试。')
        }
      }
    }}),

    // S3: 风格澄清 GIF 预览。包内静态资源（sync 脚本从 minimax-h3 submodule copy
    // 的 8 张风格 demo），只读 GET + loopback authority；文件名单段 kebab + .gif，
    // join + startsWith 防穿越。静态不变资源用强缓存（与项目资产 no-store 不同）。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_STYLE_DEMOS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'style-demos only support GET' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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

    // REQ-022：拍摄定稿的**全部** HTTP 面收在这一条 prefix 下，内部按路径段分派 ——
    // 读：`/<id>.html`（渲染，可带 `version`）、`/<id>.json`（版本摘要）、`/<id>/diff`（字段级差异）；
    // 写：`/archive`、`/restore`、`/rename`、`/land`（POST + 同源校验）。
    // 收成一条是因为 WebServer 只支持 exact/prefix（**无 `:id` 参数位**）；一条 prefix
    // 内部分派比注册七八条 exact 更省心，也不会出现 exact 与 prefix 互相遮蔽。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_STORYBOARD, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
      // decodeURIComponent 对 malformed 编码会抛 URIError —— 必须进 try（CR-002）。
      let tail = ''
      try {
        tail = decodeURIComponent(requestUrl.pathname.slice(ROUTE_STORYBOARD.length))
      } catch {
        sendJson(res, 400, { error: 'malformed storyboard path' })
        return
      }
      const parts = tail.split('/').filter((part) => part !== '')
      const asText = (value: unknown): string | undefined =>
        typeof value === 'string' && value.length > 0 ? value : undefined

      // ── 写类：/archive | /restore | /rename | /land ──
      const action = parts.length === 1 ? parts[0] : undefined
      if (action !== undefined && STORYBOARD_WRITE_ACTIONS.has(action)) {
        if (!mutationAllowed(req, expectedPort())) {
          sendJson(res, 403, { error: 'canvas-studio storyboard changes require a local same-origin request' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'storyboard write actions only support POST' })
          return
        }
        const controller = new AbortController()
        const onRequestAbort = (): void => { controller.abort() }
        const onResponseClose = (): void => { if (!res.writableEnded) controller.abort() }
        req.once('aborted', onRequestAbort)
        res.once('close', onResponseClose)
        try {
          const body = await readJson(req, controller.signal)
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
            return
          }
          const record = body as Record<string, unknown>
          const projectId = asText(record.projectId)
          if (projectId === undefined) {
            sendJson(res, 400, { error: '缺少 projectId' })
            return
          }
          if (action === 'archive') {
            const versions = await archiveStoryboard(registry, projectId, asText(record.label), asText(record.note))
            sendJson(res, 200, { ok: true, baseline: versions.baseline, seq: versions.seq })
            return
          }
          if (action === 'restore') {
            const version = asText(record.version)
            if (version === undefined) {
              sendJson(res, 400, { error: '缺少 version' })
              return
            }
            const versions = await restoreStoryboard(registry, projectId, version)
            sendJson(res, 200, { ok: true, baseline: versions.baseline, seq: versions.seq })
            return
          }
          if (action === 'rename') {
            const version = asText(record.version)
            const label = asText(record.label)
            if (version === undefined || label === undefined) {
              sendJson(res, 400, { error: '缺少 version 或 label' })
              return
            }
            const versions = await renameStoryboard(registry, projectId, version, label, asText(record.note))
            sendJson(res, 200, { ok: true, baseline: versions.baseline, seq: versions.seq })
            return
          }
          const result = await landStoryboard(registry, projectId, asText(record.version))
          sendJson(res, 200, { ok: true, ...result })
        } catch (cause) {
          if (!controller.signal.aborted && !res.destroyed) {
            sendRouteFailure(res, cause, 400, '操作失败，请稍后重试。')
          }
        } finally {
          req.off('aborted', onRequestAbort)
          res.off('close', onResponseClose)
        }
        return
      }

      // ── 读类 ──
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'storyboard reads only support GET' })
        return
      }
      try {
        if (parts.length === 2 && parts[1] === 'diff') {
          const projectId = parts[0] ?? ''
          const from = requestUrl.searchParams.get('from') ?? 'live'
          const to = requestUrl.searchParams.get('to') ?? 'live'
          if (await registry.getProject(projectId) === null) {
            sendJson(res, 404, { error: 'project not found' })
            return
          }
          sendJson(res, 200, await storyboardDiff(registry, projectId, from, to))
          return
        }
        const segment = parts.length === 1 ? parts[0] ?? '' : ''
        const htmlMatch = /^([A-Za-z0-9._-]+)\.html$/u.exec(segment)
        const jsonMatch = /^([A-Za-z0-9._-]+)\.json$/u.exec(segment)
        if (htmlMatch === null && jsonMatch === null) {
          sendJson(res, 400, {
            error: 'storyboard path must be /<projectId>.html、/<projectId>.json or /<projectId>/diff',
          })
          return
        }
        const projectId = (htmlMatch ?? jsonMatch)![1] ?? ''
        const project = await registry.getProject(projectId)
        if (project === null) {
          sendJson(res, 404, { error: 'project not found' })
          return
        }
        if (jsonMatch !== null) {
          sendJson(res, 200, await storyboardSummary(registry, projectId))
          return
        }

        const requestedVersion = asText(requestUrl.searchParams.get('version'))
        const version = requestedVersion === 'live' ? undefined : requestedVersion
        // `from` 存在即进入**对比模式**：在渲染目标版本时把与 `from` 的字段级差异就地高亮
        // （方案 §7.3）。放在 HTML 路由里而不是让客户端拿 diff JSON 再注入，是为了保住
        // 故事板文档**零 JS** 的约束 —— iframe 里没有脚本，也就没有注入通道。
        const requestedFrom = asText(requestUrl.searchParams.get('from'))
        // 阶段五：宿主当前色板经 `?theme=` 透传进来，故事板与覆盖层同色（缺省深色）。
        const theme = asText(requestUrl.searchParams.get('theme')) === 'light' ? 'light' as const : 'dark' as const
        const load = await loadStoryboard(registry, projectId)
        let html: string
        if (load.status === 'ok') {
          const known = version === undefined
            || load.document.versions.history.some((entry) => entry.version === version)
          let diffView: { entries: readonly DiffEntry[]; fromLabel: string; toLabel: string } | undefined
          if (requestedFrom !== undefined && known) {
            const resolve = (which: string): { sections: StoryboardSections; label: string } | undefined => {
              if (which === 'live') return { sections: load.document.sections, label: '活副本' }
              const found = versionById(load.document.versions, which)
              return found === undefined ? undefined : { sections: found.snapshot, label: found.label }
            }
            const left = resolve(requestedFrom)
            const right = resolve(version ?? 'live')
            if (left === undefined || right === undefined) {
              html = renderStoryboardNotice(project.name, '对比源不存在',
                `找不到要对比的版本 <code>${String(left === undefined ? requestedFrom : version)}</code>。`, theme)
              res.setHeader('content-type', 'text/html; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.setHeader('x-content-type-options', 'nosniff')
              res.statusCode = 200
              res.end(html)
              return
            }
            diffView = { entries: diffSections(left.sections, right.sections), fromLabel: left.label, toLabel: right.label }
          }
          html = !known
            ? renderStoryboardNotice(project.name, '没有这个版本', `故事板里找不到版本 <code>${String(version)}</code>。它可能已被回退覆盖，或本来就写错了。`, theme)
            : renderStoryboard(load.document, {
                ...(version === undefined ? {} : { version }),
                ...(load.document.landed === null ? {} : { landedVersion: load.document.landed.sourceVersion }),
                ...(diffView === undefined ? {} : { diff: diffView }),
                // 创意先行：把 refImage / lookRef / §07 引用解析成缩略图 URL。
                // 画布读失败降级为不渲染图（纯文本渲染），不阻断整个文档。
                mediaUrl: await storyboardMediaResolver(registry, projectId),
                // CV-296：用户原始创意（画布 BRIEF 节点全文）展示进 §00；读失败同上降级。
                sourceIdea: await storyboardSourceIdea(registry, projectId),
                // 阶段五：跟随宿主浅色 / 深色。
                theme,
              })
        } else if (load.status === 'corrupt') {
          html = renderStoryboardCorrupt(project.name, load.backup, theme)
        } else if (load.status === 'stale') {
          html = renderStoryboardNotice(
            project.name,
            '故事板是旧格式',
            `这个项目的故事板由更早的版本写入（schemaVersion ${String(load.found)}，当前需要 ${String(load.expected)}）。`
              + '<br />本轮数据结构已升级、不做静默迁移：请让 agent 用 <b>write_storyboard</b> 重新写一份。',
            theme,
          )
        } else {
          html = renderStoryboardPlaceholder(project.name, theme)
        }
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('x-content-type-options', 'nosniff')
        res.statusCode = 200
        res.end(html)
      } catch (cause) {
        if (!res.destroyed) {
          sendRouteFailure(res, cause, 400, '读取拍摄定稿失败，请稍后重试。')
        }
      }
    }}),

    // P4+: canvas persistence. The client saves the project's node list so the
    // canvas survives a restart (plan §7.7). Reads require loopback authority;
    // writes add the same-origin check used by the project routes.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_CANVAS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
        // B-1 定案（2026-10-03）：删除节点的无引用文件**直接物理删**（无回退口径
        // ——客户端撤销栈已随删除清空，两段式 .trash 失去存在理由）；有引用的
        // 留在盘上（归引用它的节点）。仍不阻塞保存。删除的文件同步给历史条目
        // 补 deletedAt（否则历史保护名单会让 GC 永不清理它们的残余——B-1 缺口①）。
        if (beforeDoc !== null) {
          try {
            await deleteUnreferencedAssets(registry, body.projectId, removedIds!, beforeDoc.nodes)
          } catch {
            /* 删除是维护操作，失败不阻塞保存 */
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
        // ⚠️ 这行必须**紧跟**写盘：守卫 `tests/active-skills-prompt.test.mjs` 取
        // `writeActiveSkills(` 之后 400 字符的窗口找它。中间插长注释会把接线断言挤红
        // ——CV-335 实测：10 行说明 ≈ 440 字符，恰好把它推出窗口（接线本身没错）。
        invalidateActiveSkillsPromptCache()
        // CV-323 / CV-331：装载清单进了 system prompt 小节，写完必须**同步重算**缓存。
        //
        // 原实现只 `invalidate`（整表清空）：provider 在缓存未命中时 `return ''` 并
        // **异步**刷新（`active-skills-prompt.ts` 的 provider 分支）⇒「用户点完 chips
        // 后的那一轮 assemble 看不到激活集，第二轮才看到」——恰好是最需要它的那一轮，
        // 与原注释「写完立刻下一轮一定读到新值」正好相反。
        //
        // 改法：清空后**立刻按该项目的 cwd 预热**一次，下一轮 assemble 必然命中新值。
        // 复用 `refreshActiveSkillsPromptCache`（CV-323 既有导出），不新增第二份装配逻辑。
        // 预热失败不影响保存结果（清单已落盘，下一轮 provider 自愈分支仍会兜住）。
        try {
          await refreshActiveSkillsPromptCache(registry, registry.dirOf(body.projectId))
        } catch {
          // 清单已保存成功；预热只影响「下一轮能否立刻读到」。
        }
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '技能清单保存失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // CV-331/332/333：用户上传 skill 面（prefix + 内部分派）。
    //
    // 数据源的**分工**（不是「第二份事实源」）：目录枚举回答「用户上传过哪些」，
    // `ctx.skills.snapshot({ cwd })` 回答「哪些真的生效了」。只看后者会让「被同名
    // 内置顶掉的用户 skill 从广场消失」—— 而那正是最需要展示给用户看的冲突态。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_SKILLS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
      const action = requestUrl.pathname.slice(ROUTE_SKILLS.length)

      if (req.method === 'GET') {
        if (action !== '') {
          sendJson(res, 404, { error: '未知的技能端点' })
          return
        }
        try {
          const projectId = requestUrl.searchParams.get('projectId')
          const loaded = projectId === null ? [] : await registry.readActiveSkills(projectId)
          // cwd 要传：项目级（rank 100）优先于用户级（400），不传就判不出「项目级顶掉
          // 用户级」这一真实冲突态。`dirOf` 就是宿主 workspace 绑定的目录（= 会话 cwd）。
          let cwd: string | undefined
          if (projectId !== null) {
            try {
              cwd = registry.dirOf(projectId)
            } catch {
              cwd = undefined
            }
          }
          const payload = await listUserSkills(ctx.skills, {
            ...(cwd === undefined ? {} : { cwd }),
            loaded,
            builtinCount: VISIBLE_CATALOG.length,
          })
          if (!res.destroyed) sendJson(res, 200, payload)
        } catch (cause) {
          if (!res.destroyed) sendRouteFailure(res, cause, 500, '技能列表加载失败，请稍后重试。')
        }
        return
      }

      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort()) || !SKILL_WRITE_ACTIONS.has(action)) {
        sendJson(res, 405, { error: 'skill changes require a local same-origin POST' })
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
        if (action === '/trash/empty') {
          const emptied = await emptySkillTrash()
          const result: EmptyTrashResult = { ok: true, removed: emptied.removed }
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, result)
          return
        }

        const raw = await readRawBody(req, controller.signal, SKILL_IMPORT_MAX_BYTES)
        let body: unknown
        try {
          body = JSON.parse(raw.toString('utf8')) as unknown
        } catch {
          sendJson(res, 400, { error: '请求体不是合法 JSON' })
          return
        }
        const record = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>

        if (action === '/delete') {
          const slug = typeof record.slug === 'string' ? record.slug : ''
          if (!isValidSlug(slug)) {
            sendJson(res, 400, { error: '技能目录名不合法，无法删除。', code: 'CS-SKILL-004' })
            return
          }
          // 删除前如实告知「有多少个项目装载过它」——**不自动改** `skills.json`：
          // 那份清单是项目自己的事实，自动清理等于替用户做决定且不可撤销。
          const name = await skillNameOfSlug(slug)
          const trashed = await trashUserSkill(slug)
          const result: DeleteSkillResult = {
            ok: true,
            trashedTo: trashed.trashedTo,
            ...(name === null ? {} : { loadedByProjects: await countProjectsLoadingSkill(registry, name) }),
          }
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, result)
          return
        }

        // ── /import ──
        const rawFiles = Array.isArray(record.files) ? record.files : []
        const files = rawFiles.flatMap((entry) => {
          if (entry === null || typeof entry !== 'object') return []
          const item = entry as Record<string, unknown>
          if (typeof item.path !== 'string') return []
          return typeof item.text === 'string'
            ? [{ path: item.path, text: item.text }]
            : [{ path: item.path }]
        })
        const listed = await listUserSkills(ctx.skills, { builtinCount: VISIBLE_CATALOG.length })
        // 冲突判据 = **注册名**（内置 catalog ∪ 已有用户条目），不是目录名 ——
        // 上游注册名取自 frontmatter `name`，目录名只决定物理位置。
        const takenNames = [...SKILL_CATALOG.map(entry => entry.name), ...listed.items.map(item => item.name)]
        const verdict = validateImport(files, {
          owners: builtinSlotOwners(),
          takenNames,
          ...(typeof record.slug === 'string' && record.slug.trim() !== '' ? { requestedSlug: record.slug.trim() } : {}),
        })
        if (!verdict.ok) {
          const failed: ImportSkillResult = { ok: false, code: verdict.code, reason: verdict.reason, advisories: verdict.advisories }
          if (!controller.signal.aborted && !res.destroyed) sendJson(res, 400, failed)
          return
        }
        let trashedTo: string | null = null
        try {
          trashedTo = (await writeUserSkill(verdict.slug, verdict.files, { overwrite: record.overwrite === true })).trashedTo
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'SkillExistsError') {
            const conflict: ImportSkillResult = {
              ok: false,
              code: 'CS-SKILL-007',
              reason: `落点 \`${verdict.slug}\` 已存在。确认要覆盖的话，请勾选「覆盖同名技能」后重试`
                + '（旧版本会先移入回收站，可恢复）。',
              advisories: verdict.advisories,
            }
            if (!controller.signal.aborted && !res.destroyed) sendJson(res, 409, conflict)
            return
          }
          throw cause
        }
        const result: ImportSkillResult = {
          ok: true,
          slug: verdict.slug,
          files: verdict.files.map(file => file.path),
          advisories: verdict.advisories,
          note: verdict.note,
          ...(trashedTo === null ? {} : { trashedTo }),
        }
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, result)
      } catch (cause) {
        if (controller.signal.aborted || res.destroyed) return
        // 超过导入上限：明确 413，而不是笼统的 400（用户要知道是「太大」而不是「格式错」）。
        if (cause instanceof Error && cause.message === 'body too large') {
          sendJson(res, 413, { error: `导入内容超过 ${String(SKILL_IMPORT_MAX_BYTES / 1024 / 1024)}MB 上限`, code: 'CS-SKILL-006' })
          return
        }
        sendRouteFailure(res, cause, 400, '技能导入失败，请稍后重试。')
      } finally {
        stopWatching()
      }
    }}),

    // P7: creation-workflow gate face. GET returns a project's workflow
    // (mode + approval state); POST applies user actions (approve / reject /
    // setMode) so the approval bar and mode toggle drive the Host-side gate.
    ctx.webServer.register({ kind: 'exact', path: ROUTE_WORKFLOW, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
          // 故事板强约束 L2（2026-10-25）：`state` 降级为**派生显示**，事实源是
          // `storyboard.json.landed`。两者不一致（历史数据 / 迁移写坏）时在这里补推，
          // 免得覆盖层永远停在「拍摄定稿」而画布其实早就能开工了。
          // 注意：只修显示 —— 放行仍由 `assertStoryboardLanded` 只认 landed（见 storyboard-gate.ts）。
          if (await healStoryboardState(registry, projectId, workflow.state)) {
            workflow.state = 'executing'
          }
          sendJson(res, 200, { workflow, pendingQuestion: workflow.pendingQuestion ?? null })
        }
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
        // REQ-022：`approve` / `reject` / `approve_script` / `reject_script` 四个动作随
        // 剧本门与分镜门一并删除 —— 那两个门已由「拍摄定稿」的落地按钮（POST
        // `/canvas-studio/storyboard/land`）取代。此处保留的只有关键帧门与点选答复。
        if (body.action === 'confirm_keyframes') {
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
          // 用户答复即进入新的「一轮」：落地前样张/定妆照软预算清零（look-budget.ts）。
          // 语义是「每多出一批图都要用户点头一次」，所以只有**答复**能重置 —— 光是
          // 模型自己再问一遍不算（问题没被作答，预算照旧封顶）。
          resetLookBudget(body.projectId)
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
          // 会话效率优化（2026-10-26）：mode 会话中期热切换不发事件，主动失效
          // workflow-mode 小节缓存，provider 下一轮 assemble 自愈刷新新值。
          invalidateWorkflowModeCache()
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

    // REQ-021：自动测试报告落盘。入参 { projectId, markdown }，校验项目存在后
    // 覆盖写 `<projectDir>/test-report.md` —— 报告与项目同目录（拍板②），验收方
    // 直接读盘；增量更新由客户端每检查点后重发全量 markdown，Host 不做合并。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_TEST_REPORT, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'test-report requires a local same-origin POST' })
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
        const body = await readJson(req, controller.signal) as { projectId?: unknown; markdown?: unknown }
        if (typeof body.projectId !== 'string' || body.projectId.length === 0) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        if (typeof body.markdown !== 'string' || body.markdown.trim().length === 0) {
          sendJson(res, 400, { error: '缺少 markdown 报告内容' })
          return
        }
        const project = await registry.getProject(body.projectId)
        if (project === null) {
          sendJson(res, 404, { error: `项目不存在: ${body.projectId}` })
          return
        }
        // 报告必须落在项目目录内（拍板②）；project.dir 由 registry 维护，直接 join。
        await writeFile(join(project.dir, 'test-report.md'), body.markdown, 'utf8')
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 500, '测试报告写入失败，请稍后重试。')
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
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

    // ── REQ-034 · B3：route B（CSR）渲染工单桥（devdoc §6.3）──
    // 宿主建单（工具 `render_composition`）→ 画布客户端轮询取单 → CSR 渲染 → 回写/撤单。
    // 三条都是「本机回环」面：pending 是只读 GET；commit / cancel 是写类 POST（同源校验）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_PENDING, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'remotion pending requires GET' })
        return
      }
      try {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
        // O-06：`owner` 决定「谁在取单」。缺省 `client` = 三期之前的老行为（旧客户端不带参数也照跑）。
        const owner: RenderExecutor = requestUrl.searchParams.get('owner') === 'host' ? 'render-host' : 'client'
        const projectId = requestUrl.searchParams.get('projectId')
        if (owner === 'client' && (projectId === null || projectId.length === 0)) {
          sendJson(res, 400, { error: '缺少 projectId' })
          return
        }
        // 隐藏窗口不绑画布页 ⇒ 允许不带 projectId（= 任意项目，只认归它渲的单）。
        const scope = owner === 'render-host' && (projectId === null || projectId.length === 0) ? null : projectId
        const job = claimRenderJobFor(scope, owner, {
          // 滞留改派（CV 2026-10-23）：client 单宽限期内无人认领 ⇒ 窗口接管。
          // 必须留痕：这条路径生效意味着「画布页取单链路没跑起来」，不记日志的话
          // 排障只能靠 CS-RENDER-TIMEOUT 倒推（10-20 起 11 连败就是这么查的）。
          onTakeover: (takenJobId, reason) => {
            ctx.logger.warn(`[canvas-studio] 滞留渲染工单 ${takenJobId} 已改派隐藏渲染窗口（${reason}；请检查画布页取单/渲染链路）`)
          },
        })
        // 取到单 = 窗口真的在干活 ⇒ 重置空闲回收计时（心跳本身不算活动，否则窗口永不回收）。
        if (job !== null) touchRenderHost()
        if (!res.destroyed) sendJson(res, 200, { job })
      } catch (cause) {
        if (!res.destroyed) sendRouteFailure(res, cause, 400, '读取渲染工单失败，请稍后重试。')
      }
    }}),

    // 二期 1b：队列 / 进度列表（只读 GET）。`projectId` 可选 —— 缺省返回全部在册工单。
    // 为什么单开一条而不是往 pending 里塞 progress：pending 是"我能渲哪张"的**调度**语义，
    // 列表是"整体在跑什么"的**观测**语义；混在一起会让客户端每拍都拿到与自己无关的单。
    // ⚠️ 产品侧**当前没有调用方**（客户端取单已由 pending 按队列屏蔽，队列深度对它无决策价值）——
    // 这条是给诊断 / 将来的进度面板用的观测面（`curl` 可查），不要"看到没人调"就删掉。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_JOBS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'remotion jobs requires GET' })
        return
      }
      try {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
        const projectId = requestUrl.searchParams.get('projectId')
        if (!res.destroyed) {
          sendJson(res, 200, { jobs: listRenderJobViews(projectId === null || projectId.length === 0 ? undefined : projectId) })
        }
      } catch (cause) {
        if (!res.destroyed) sendRouteFailure(res, cause, 400, '读取渲染队列失败，请稍后重试。')
      }
    }}),

    // 二期 1b：客户端上报渲染进度（JSON `{jobId, progress}`，progress 0–1，客户端已节流）。
    // 幂等：单不存在 / 已结算 / 未在渲染 → `applied: false`，一律 200（不制造假错误）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_PROGRESS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'remotion progress requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      try {
        const body = await readJson(req, controller.signal) as { jobId?: unknown; progress?: unknown }
        if (typeof body.jobId !== 'string' || body.jobId.length === 0) {
          sendJson(res, 400, { error: '缺少 jobId' })
          return
        }
        const applied = typeof body.progress === 'number'
          ? reportRenderJobProgress(body.jobId, body.progress)
          : false
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true, applied })
      } catch (cause) {
        if (!res.destroyed) sendRouteFailure(res, cause, 400, '上报渲染进度失败，请稍后重试。')
      }
    }}),

    // 客户端回写成片：octet-stream 原始 mp4 字节 + `warnings`（URL 编码 JSON 字符串数组，
    // 可选）。宿主落盘 + 探测真值后结算等待中的工具调用。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_COMMIT, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'remotion commit requires a local same-origin POST' })
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
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort()}`)
        const jobId = requestUrl.searchParams.get('jobId')
        if (jobId === null || jobId.length === 0) {
          sendJson(res, 400, { error: '缺少 jobId' })
          return
        }
        const declared = Number(req.headers['content-length'] ?? '0')
        if (Number.isFinite(declared) && declared > MAX_RENDER_BODY_BYTES) {
          sendJson(res, 413, {
            error: `成片回写失败：超出大小上限（${Math.round(MAX_RENDER_BODY_BYTES / 1024 / 1024)}MB）`,
            code: 'CS-USER-ERR',
          })
          return
        }
        const warnings = asRenderWarnings(requestUrl.searchParams.get('warnings'))
        const report = asRenderReport(requestUrl.searchParams.get('metrics'))
        const bytes = await readRawBody(req, controller.signal, MAX_RENDER_BODY_BYTES)
        const result = await commitRenderJob(registry, jobId, {
          bytes,
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(report !== undefined ? { report } : {}),
        })
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, result)
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '成片回写失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // 客户端撤单：`failed=1` + `reason` = 渲染失败（CS-RENDER-002）；否则视为主动取消
    //（CS-GEN-207）。工单不存在 / 已结算属幂等成功（可能刚超时），一律回 200。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_CANCEL, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'remotion cancel requires a local same-origin POST' })
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
          jobId?: unknown
          failed?: unknown
          reason?: unknown
        }
        if (typeof body.jobId !== 'string' || body.jobId.length === 0) {
          sendJson(res, 400, { error: '缺少 jobId' })
          return
        }
        const applied = cancelRenderJob(body.jobId, {
          ...(body.failed === true ? { failed: true } : {}),
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
        })
        if (!controller.signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true, applied })
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '渲染撤单失败，请稍后重试。')
        }
      } finally {
        stopWatching()
      }
    }}),

    // 三期 W6-1：客户端回写一张抽帧（octet-stream PNG + `jobId` / `frame` query）。
    // 幂等：工单不存在 / 已结算 → `{ok:true, url:null}`（不制造假错误）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_SAMPLE, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 405, { error: 'remotion sample requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      req.once('aborted', onAbort)
      try {
        const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${String(expectedPort())}`)
        const jobId = requestUrl.searchParams.get('jobId')
        const frameRaw = Number(requestUrl.searchParams.get('frame') ?? '0')
        if (jobId === null || jobId.length === 0) {
          sendJson(res, 400, { error: '缺少 jobId' })
          return
        }
        const png = await readRawBody(req, controller.signal, MAX_BODY_BYTES)
        const sample = await recordRenderSample(registry, jobId, Number.isFinite(frameRaw) ? frameRaw : 0, png)
        if (!controller.signal.aborted && !res.destroyed) {
          sendJson(res, 200, { ok: true, url: sample === null ? null : sample.url })
        }
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          sendRouteFailure(res, cause, 400, '抽帧回写失败。')
        }
      } finally {
        req.off('aborted', onAbort)
      }
    }}),

    // 三期 W2-4：颗粒 tile（只读静态 PNG；内容不变 ⇒ 强缓存）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_REMOTION_GRAIN, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'grain tile only supports GET' })
        return
      }
      try {
        const data = await readFile(REMOTION_GRAIN_FILE)
        res.setHeader('content-type', 'image/png')
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        res.setHeader('x-content-type-options', 'nosniff')
        res.statusCode = 200
        res.end(data)
      } catch {
        sendJson(res, 404, { error: 'grain tile not found' })
      }
    }}),

    // ── REQ-034 · O-05：RenderHost 页面 / bundle / 自报状态 ──
    // 页面只被隐藏窗口加载；`no-store` 是因为 bundle 名不变、构建后会换内容，
    // 缓存住会让「改了代码但窗口还是老的」这种问题查半天。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_RENDER_HOST, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'render host page only supports GET' })
        return
      }
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-content-type-options', 'nosniff')
      res.statusCode = 200
      res.end(renderHostHtml())
    }}),

    ctx.webServer.register({ kind: 'exact', path: ROUTE_RENDER_HOST_JS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'render host bundle only supports GET' })
        return
      }
      try {
        const data = await readFile(RENDER_HOST_BUNDLE_FILE)
        res.setHeader('content-type', 'text/javascript; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('x-content-type-options', 'nosniff')
        res.statusCode = 200
        res.end(data)
      } catch {
        // 没构建过（或产物被清掉）时要给出**可操作**的提示，而不是一个空白 404。
        sendJson(res, 503, { error: 'render host bundle missing — 先跑一次 tsdown 构建' })
      }
    }}),

    // 自报状态：页面每拍报一次；GET 供验收/调试读（含生命周期快照，判断窗口是否还活着）。
    ctx.webServer.register({ kind: 'exact', path: ROUTE_RENDER_HOST_STATUS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, {
          report: lastRenderHostReport() ?? null,
          lifecycle: renderHostSnapshot() ?? null,
        })
        return
      }
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'render host status requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      try {
        const body = await readJson(req, controller.signal)
        const report = recordRenderHostReport(body)
        // ⚠️ 心跳 ≠ 活动：每拍都 touch 的话空闲回收永远不触发（窗口每天 24h 挂着吃内存）。
        // 只有「正在渲」才算活动；取单成功那条路另外 touch（见 pending 路由）。
        if (report.state === 'rendering') touchRenderHost()
        // 2026-10-23：窗口自报「干不了活」必须留痕 —— unsupported/error 的窗口自报
        // 一拍后就停手（不心跳不取单），5min 后被 idle 回收，全程无任何其它日志。
        // 桌面 11 连败期间它在不在场只能靠这条日志判（排障时先看这里，再看滞留改派）。
        if ((report.state === 'unsupported' || report.state === 'error') && report.state !== lastRenderHostWarnedState) {
          lastRenderHostWarnedState = report.state
          ctx.logger.warn(`[canvas-studio] 渲染窗口自报 ${report.state}${report.detail === undefined ? '' : `（${report.detail}）`} —— 该窗口不会承担渲染，工单将回退画布页或等待改派`)
        } else if (report.state === 'idle') {
          lastRenderHostWarnedState = undefined
        }
        sendJson(res, 200, { ok: true, state: report.state })
      } catch (cause) {
        sendRouteFailure(res, cause, 400, '渲染窗口状态上报失败。')
      }
    }}),

    // ── REQ-034 · R1：随包中文字体子集只读面 ──
    // 与 style-demos 同口径：loopback authority + 单段文件名白名单（`^[a-z0-9-]+\.woff2$`
    // 天然挡掉 `..`、子目录与扩展名伪装）+ join/startsWith 兜底防穿越；静态不可变 ⇒ 强缓存。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_REMOTION_FONTS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'remotion fonts only support GET' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${String(expectedPort())}`)
      // CR-002：decodeURIComponent 对 malformed 编码会抛 URIError —— 必须进 try，
      // 否则 handler 直接 reject、响应悬空。
      let file = ''
      try {
        file = decodeURIComponent(requestUrl.pathname.slice(ROUTE_REMOTION_FONTS.length)).replace(/^\/+/, '')
      } catch {
        sendJson(res, 400, { error: 'malformed font path' })
        return
      }
      if (!/^[a-z0-9-]+\.woff2$/.test(file)) {
        sendJson(res, 400, { error: 'font path must be /<name>.woff2' })
        return
      }
      const target = join(REMOTION_FONT_DIR, file)
      if (!target.startsWith(REMOTION_FONT_DIR + sep)) {
        sendJson(res, 403, { error: 'forbidden font path' })
        return
      }
      try {
        const data = await readFile(target)
        res.setHeader('content-type', 'font/woff2')
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        res.setHeader('x-content-type-options', 'nosniff')
        res.statusCode = 200
        res.end(data)
      } catch {
        sendJson(res, 404, { error: 'font not found' })
      }
    }}),

    // ── P1 登录闭环（Supabase OAuth PKCE；方案拍板 2026-10-15）──
    // 四个内部动作：loopback（POST，起回调服务）/ pending（GET，轮询取回调，
    // 取走即清）/ session（POST，client 推送最新会话）/ video（GET，登录弹窗循环视频）。
    // session 与 loopback 是写类动作（POST + 同源校验）；video 是只读静态资产。
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_AUTH, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort())) {
        sendJson(res, 403, { error: 'canvas-studio request authority rejected' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${String(expectedPort())}`)
      const tail = requestUrl.pathname.slice(ROUTE_AUTH.length).replace(/^\/+/, '')
      if (tail === 'video') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'auth video only supports GET' })
          return
        }
        try {
          const data = await readFile(LOGIN_VIDEO_PATH)
          res.setHeader('content-type', ASSET_CONTENT_TYPES['.mp4'] ?? 'video/mp4')
          res.setHeader('cache-control', 'public, max-age=31536000, immutable')
          res.setHeader('x-content-type-options', 'nosniff')
          res.statusCode = 200
          res.end(data)
        } catch {
          sendJson(res, 404, { error: 'login video not found' })
        }
        return
      }
      if (tail === 'loopback') {
        if (!mutationAllowed(req, expectedPort())) {
          sendJson(res, 403, { error: 'canvas-studio auth changes require a local same-origin request' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'auth loopback only supports POST' })
          return
        }
        try {
          const redirectUrl = await startLoopback()
          sendJson(res, 200, { redirectUrl })
        } catch (cause) {
          stopLoopback() // listen 失败的半开状态清干净，下次点击可重试
          sendRouteFailure(res, cause, 500, '本机回调服务启动失败，请重试。')
        }
        return
      }
      if (tail === 'pending') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'auth pending only supports GET' })
          return
        }
        // 轮询即消费（取走即清）：PKCE code 一次性语义在 Host 侧也成立；
        // active=false 表示 loopback 未启动（client 以此识别异常时序）。
        sendJson(res, 200, { active: loopbackActive(), callbackUrl: consumePendingCallback() })
        return
      }
      if (tail === 'session') {
        if (!mutationAllowed(req, expectedPort())) {
          sendJson(res, 403, { error: 'canvas-studio auth changes require a local same-origin request' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'auth session only supports POST' })
          return
        }
        const controller = new AbortController()
        req.once('aborted', () => controller.abort())
        try {
          const body = await readJson(req, controller.signal) as {
            event?: unknown
            session?: unknown
          }
          if (body.event === 'SIGNED_OUT') {
            clearAuthSession()
            notifyAuthCleared()
            sendJson(res, 200, { ok: true })
            return
          }
          // SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION：携带会话快照覆盖缓存。
          const session = (body.session ?? {}) as {
            accessToken?: unknown
            expiresAt?: unknown
            userId?: unknown
            email?: unknown
          }
          if (typeof session.accessToken !== 'string' || session.accessToken === '') {
            sendJson(res, 400, { error: '缺少 accessToken' })
            return
          }
          setAuthSession({
            accessToken: session.accessToken,
            expiresAt: typeof session.expiresAt === 'number' ? session.expiresAt : null,
            userId: typeof session.userId === 'string' ? session.userId : '',
            email: typeof session.email === 'string' ? session.email : null,
          })
          // 管理面 bootstrap（方案 P2/CV-356）：fire-and-forget，幂等去重；失败只进
          // 日志、不回滚登录态、不影响本次推送响应。
          notifyAuthSession(session.accessToken)
          sendJson(res, 200, { ok: true })
        } catch (cause) {
          sendRouteFailure(res, cause, 400, '登录状态同步失败，请重试。')
        }
        return
      }
      sendJson(res, 404, { error: 'unknown auth action' })
    }}),
  ]
  // ── REQ-034 · O-06：RenderHost 派单登记 ──
  // 默认**懒启**：只有真要渲染时才建隐藏窗口（空闲零成本），`CANVAS_STUDIO_RENDER_HOST=0` 可整体关掉。
  // `=1` 时额外在启动阶段就拉起（S1 人工验收要看 `/render-host/status` 自报 idle，等不到派单）。
  if (process.env.CANVAS_STUDIO_RENDER_HOST !== '0') {
    const launchRenderHost = (): boolean => ensureRenderHost({
      url: `http://127.0.0.1:${String(expectedPort())}${ROUTE_RENDER_HOST}`,
      log: (message) => { ctx.logger.info(message) },
      onLost: (reason) => {
        // 崩溃 / 无响应 / 被关：主进程立刻知道，比 30s 看门狗早得多。
        const failed = failRenderHostJobs(`render host lost: ${reason}`)
        if (failed > 0) ctx.logger.warn(`[canvas-studio] 渲染窗口失联（${reason}），已中止 ${failed} 单渲染`)
      },
    }) !== undefined
    setRenderHostLauncher(launchRenderHost)
    // B2-2（D10）：窗口自己失败时把它丢掉，下一单拿干净的 —— 事故里"越试越死"
    // 就是半残窗口继续接单造成的。节流在 dispatch 侧（30s 内不重复重置）。
    setRenderHostResetter((reason) => {
      disposeRenderHost(reason)
      ctx.logger.warn(`[canvas-studio] 渲染窗口已重置（${reason}），下一单将重建`)
    })
    if (process.env.CANVAS_STUDIO_RENDER_HOST === '1') launchRenderHost()
  }
  return () => {
    // P1 登录闭环：路由卸载 = 插件停用，loopback 服务一并关闭（幂等）。
    setRenderHostLauncher(undefined)
    setRenderHostResetter(undefined)
    stopLoopback()
    disposeRenderHost('plugin-dispose')
    for (const dispose of routes) dispose()
  }
}
