/**
 * Canvas Studio browser API: same-origin fetch helpers over the project
 * registry and canvas routes (the community-market client fetch pattern).
 */
import type { StudioProject, StudioProjectGroup, StudioProjectPlan, StudioWorkflow, StudioWorkflowMode } from '../contracts/project.js'
import { normalizeWorkflow } from '../contracts/project.js'
import type { LibAnchorRef, LibraryAsset, LibraryCreateRequest, LibraryListFilter, LibraryUpdateRequest } from '../contracts/asset-library.js'
export { libraryMediaUrl } from '../contracts/asset-library.js'
import type { StudioAudioComposition, StudioCanvasNode, StudioCanvasView, StudioVideoImportPayload, StudioVideoStylePayload } from '../contracts/canvas.js'
import { normalizeCanvasView } from '../canvas-view.js'
import { generationParamsOf } from '../node-params.js'
import { normalizeGenerateQueueSnapshot, type GenerateQueueSnapshot } from '../queue-view.js'
import type { ResolveRefItem, ResolveRefsResponse } from '../contracts/reference.js'
import type { StudioStorageInfo } from '../storage-info.js'
import { throwError } from '../error-system.js'
import type { CompositionManifest } from '../remotion/manifest.js'
import type {
  DeleteSkillResult, EmptyTrashResult, ImportSkillRequest, ImportSkillResult, UserSkillsPayload,
} from '../contracts/skill.js'
import '../errors/catalog.js'

/** HTTP facts used to localize safe Client-facing Studio failures. */
export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'StudioApiError'
  }
}

/**
 * 登录态错误码：**client 侧唯一的字面量点**（判断与抛码都从这里取，调用点别另写一份）。
 */
export const AUTH_REQUIRED_CODE = 'CS-AUTH-001' as const

/**
 * `CS-AUTH-001` 判据：登录态问题（**可恢复**，不是故障）。
 *
 * UI 侧据此走「弹登录窗 + 不写节点红标」——与工具通道 `asset-capture.ts` 对同一个
 * 码的处置同一语义（那边是移除占位、不标红）。
 */
export function isAuthRequiredError(cause: unknown): boolean {
  return cause instanceof StudioApiError && cause.code === AUTH_REQUIRED_CODE
}

/**
 * 非 JSON / 无 `error` 字段时给用户的兜底文案。
 *
 * 必须是可读中文：`StudioApiError.message` 会被三态错误卡**原样展示**，早先这里是
 * `request failed: ${status}`，用户会在错误卡上看到一行英文内部串。
 */
function requestFailedText(status: number): string {
  return `服务响应异常（HTTP ${status}），请稍后重试。`
}

async function readJson<T>(response: Response): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    // CR-086：非 JSON 错误响应（如网关 5xx 返回 HTML）——不能抛 SyntaxError，
    // 按带 status 的 StudioApiError 归类，让调用方错误分级能正常工作。
    throw new StudioApiError(requestFailedText(response.status), response.status)
  }
  // 空值护栏：`JSON.parse('null')` / 标量响应体不是对象，直接取属性会 TypeError。
  const record = (value !== null && typeof value === 'object' ? value : {}) as { error?: unknown; code?: unknown }
  if (!response.ok) {
    throw new StudioApiError(
      typeof record.error === 'string' ? record.error : requestFailedText(response.status),
      response.status,
      typeof record.code === 'string' ? record.code : undefined,
    )
  }
  return value as T
}

/** List all registered projects. */
export async function listStudioProjects(signal?: AbortSignal): Promise<readonly StudioProject[]> {
  const response = await readJson<{ projects: readonly StudioProject[] }>(await fetch('/canvas-studio/projects', {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.projects
}

// ── P1 登录闭环（Supabase OAuth PKCE）：auth 路由的 client face ──

/** 起 Host loopback 回调服务，返回 OAuth `redirectTo` 地址。 */
export async function startAuthLoopback(signal?: AbortSignal): Promise<string> {
  const response = await readJson<{ redirectUrl: string }>(await fetch('/canvas-studio/auth/loopback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.redirectUrl
}

/** 轮询取一次 loopback 待处理回调（取走即清）；`active=false` = loopback 未启动。 */
export async function fetchPendingAuthCallback(signal?: AbortSignal): Promise<{ active: boolean; callbackUrl: string | null }> {
  return readJson<{ active: boolean; callbackUrl: string | null }>(await fetch('/canvas-studio/auth/pending', {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** 登录会话推送给 Host 的载荷（与 auth-session.ts 的 StudioAuthSession 对齐）。 */
export interface AuthSessionPush {
  accessToken: string
  expiresAt: number | null
  userId: string
  email: string | null
}

/** 把最新会话推给 Host 内存缓存（boot / SIGNED_IN / TOKEN_REFRESHED 时机）。 */
export async function pushAuthSession(event: string, session: AuthSessionPush | null, signal?: AbortSignal): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, session }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** 登录弹窗右侧循环视频的 URL（Host 静态资产路由）。 */
export const AUTH_INTRO_VIDEO_URL = '/canvas-studio/auth/video'

/** Create a project and return its record. */
export async function createStudioProject(
  name: string,
  groupId?: string | null,
  plan?: StudioProjectPlan,
  mode?: StudioWorkflowMode,
  signal?: AbortSignal,
): Promise<StudioProject> {
  // CV-099：plan 仅在有内容时随请求体发送（未锁定不占位，保持老请求形态）。
  const body: Record<string, unknown> = groupId === undefined ? { name } : { name, groupId }
  if (plan !== undefined) body.plan = plan
  // CV-196：创建时锁定的执行模式。省略 = 没指定，服务端回落到设置页默认。
  if (mode !== undefined) body.mode = mode
  const response = await readJson<{ project: StudioProject }>(await fetch('/canvas-studio/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.project
}

/** Delete a project by id (removes its directory and registry record). */
export async function deleteStudioProject(id: string, signal?: AbortSignal): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/projects', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/**
 * REQ-005 v1.3（变体 A）：取（幂等创建）首页 draft 落点目录。返回 Host 端绝对路径，
 * 调用方拿它 `workspaces.create({ path })` 绑定宿主 workspace / 会话。
 */
export async function ensureStudioDraftDir(signal?: AbortSignal): Promise<string> {
  const response = await readJson<{ dir: string }>(await fetch('/canvas-studio/draft-landing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.dir
}

/**
 * REQ-005 v1.3（变体 A）：create 认领变体 —— 把已存在的 draft 目录登记为项目
 * （不 mint 新目录，宿主会话无缝延续）。`dir` 由 Host 端校验（projects 内 /
 * 已存在 / 未被占用），失败抛 StudioApiError。
 */
export async function createStudioProjectClaimDir(
  name: string,
  dir: string,
  plan?: StudioProjectPlan,
  mode?: StudioWorkflowMode,
  signal?: AbortSignal,
): Promise<StudioProject> {
  const body: Record<string, unknown> = { name, dir }
  if (plan !== undefined) body.plan = plan
  if (mode !== undefined) body.mode = mode
  const response = await readJson<{ project: StudioProject }>(await fetch('/canvas-studio/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.project
}

/**
 * CV-091：列出全部分组（左侧栏可折叠分组的一等公民）。
 */
export async function listStudioGroups(signal?: AbortSignal): Promise<readonly StudioProjectGroup[]> {
  const response = await readJson<{ groups: readonly StudioProjectGroup[] }>(await fetch('/canvas-studio/groups', {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.groups
}

/** CV-091：新建分组，返回其记录。 */
export async function createStudioGroup(name: string, signal?: AbortSignal): Promise<StudioProjectGroup> {
  const response = await readJson<{ group: StudioProjectGroup }>(await fetch('/canvas-studio/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.group
}

/** CV-091：重命名分组。 */
export async function renameStudioGroup(id: string, name: string, signal?: AbortSignal): Promise<StudioProjectGroup> {
  const response = await readJson<{ group: StudioProjectGroup }>(await fetch('/canvas-studio/groups', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.group
}

/** CV-091：删除分组（组内项目回落未分组）。 */
export async function deleteStudioGroup(id: string, signal?: AbortSignal): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/groups', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
export async function moveStudioProjectToGroup(
  projectId: string,
  groupId: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/projects', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, groupId }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

// CV-264③：touch 的 api 封装已随 touch 路由删除 —— 「打开项目」不再写
// updatedAt（验收反馈：点哪个哪个跳第一，不稳定）。「最后修改」的燃料在
// Host 侧 writeCanvas / updateWorkflow 等真修改处落。

// ── REQ-001 全局资产库 ────────────────────────────────────────────────────────

/** 列出全局资产库条目（资产库页列表 + @ 候选取数共用；服务端按 category/q 过滤）。 */
export async function listLibraryAssets(filter?: LibraryListFilter, signal?: AbortSignal): Promise<readonly LibraryAsset[]> {
  const params = new URLSearchParams()
  if (filter?.category !== undefined) params.set('category', filter.category)
  if (filter?.q !== undefined && filter.q.length > 0) params.set('q', filter.q)
  const search = params.toString()
  const response = await readJson<{ assets: readonly LibraryAsset[] }>(await fetch(`/canvas-studio/library${search.length > 0 ? `?${search}` : ''}`, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.assets
}

/** 取一条库资产详情（详情抽屉；不存在时 Host 回 CS-LIB-001 → 404）。 */
export async function getLibraryAsset(id: string, signal?: AbortSignal): Promise<LibraryAsset> {
  const response = await readJson<{ asset: LibraryAsset }>(await fetch(`/canvas-studio/library/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.asset
}

/**
 * 新建库资产。`anchors` 非空 = 从画布入库（媒体源由 Host 按锚点解析并拷入，
 * 客户端只传 {projectId, nodeId}）。
 */
export async function createLibraryAsset(request: LibraryCreateRequest, signal?: AbortSignal): Promise<LibraryAsset> {
  const response = await readJson<{ asset: LibraryAsset }>(await fetch('/canvas-studio/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.asset
}

/** 更新库资产元数据（PATCH `/library/:id`）。 */
export async function updateLibraryAsset(id: string, request: LibraryUpdateRequest, signal?: AbortSignal): Promise<LibraryAsset> {
  const response = await readJson<{ asset: LibraryAsset }>(await fetch(`/canvas-studio/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.asset
}

/** 删除库资产（注册表墓碑 + 清媒体目录）。 */
export async function deleteLibraryAsset(id: string, signal?: AbortSignal): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch(`/canvas-studio/library/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** 追加一个画布锚点（「已有资产再挂一张新参考图」；媒体由 Host 同步拷入）。 */
export async function addLibraryAnchor(id: string, anchor: LibAnchorRef, signal?: AbortSignal): Promise<LibraryAsset> {
  const response = await readJson<{ asset: LibraryAsset }>(await fetch(`/canvas-studio/library/${encodeURIComponent(id)}/anchors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(anchor),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.asset
}

/** 上传一份媒体进库条目（octet-stream → `POST /library/:id/media`，REQ-001「上传图片到资产库」）。 */
export async function uploadLibraryMedia(id: string, file: File, label?: string, signal?: AbortSignal): Promise<LibraryAsset> {
  const query = new URLSearchParams({ name: file.name })
  if (label !== undefined && label.length > 0) query.set('label', label)
  const response = await readJson<{ asset: LibraryAsset }>(await fetch(`/canvas-studio/library/${encodeURIComponent(id)}/media?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.asset
}

/** P7：读某项目的创作工作流（模式 + 审批门禁状态），缺失字段降级为默认值。 */
export async function getStudioWorkflow(projectId: string, signal?: AbortSignal): Promise<StudioWorkflow> {
  const response = await readJson<{ workflow: unknown }>(
    await fetch(`/canvas-studio/workflow?projectId=${encodeURIComponent(projectId)}`, {
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return normalizeWorkflow(response.workflow)
}

/**
 * CV-220：读宿主生成队列快照（只读，轮询用）。
 *
 * 形状不对 ⇒ `null`（**不**降级成空队列）：空队列是「没有生成在跑」的强断言，
 * 拿不准时返回 `null`，调用方保持上一拍状态。
 */
export async function fetchStudioGenerateQueue(
  signal?: AbortSignal,
): Promise<GenerateQueueSnapshot | null> {
  try {
    const response = await fetch('/canvas-studio/generate-queue', {
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return null
    return normalizeGenerateQueueSnapshot(await response.json())
  } catch {
    // 轮询是装饰性信息：失败静默（保持上一拍状态），不打扰用户、不弹错。
    return null
  }
}

/** 存储目录诊断类型（形状在 src/storage-info.ts 定义，路由与 UI 共用同一来源）。 */
export type { StudioStorageDraftStats, StudioStorageInfo, StudioStorageProjectEntry } from '../storage-info.js'

/**
 * REQ-021 R001 后续（方案 B）：存储目录只读诊断信息（设置页诊断区「存储目录」
 * 信息块）。失败向上抛 —— 诊断信息读不到应当显式示错（附重试语义），不静默。
 */
export async function fetchStudioStorageInfo(signal?: AbortSignal): Promise<StudioStorageInfo> {
  return readJson<StudioStorageInfo>(await fetch('/canvas-studio/storage-info', {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
}

/**
 * P7：工作流动作（批准 / 驳回 / 确认关键帧 / 打回关键帧 / 切换模式），
 * 返回更新后的工作流。
 */
export async function postStudioWorkflowAction(
  projectId: string,
  action: 'confirm_keyframes' | 'reject_keyframes' | 'setMode',
  mode?: StudioWorkflowMode,
  signal?: AbortSignal,
): Promise<StudioWorkflow> {
  const response = await readJson<{ workflow: unknown }>(await fetch('/canvas-studio/workflow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mode === undefined ? { projectId, action } : { projectId, action, mode }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return normalizeWorkflow(response.workflow)
}

/**
 * REQ-022：把「拍摄定稿」落到画布（覆盖层里点「确认落地」）。
 *
 * 与审批条那条通道刻意不同：它是**用户按钮 → Host 路由**，不是 agent 工具
 * （契约 §7.2）。Host 侧会跑三层校验，`blockers` 非空时以 400 返回可读文案。
 *
 * `version` 省略 = 落**活副本**（Host 会补一个「落地前固化」checkpoint）；给了版本号 =
 * 落**那个历史版本**（契约 §5「任意历史版本可落」）。
 */
export async function landStoryboard(
  projectId: string,
  version?: string,
  signal?: AbortSignal,
): Promise<{ shots: number; nodes: number; assets: number; version: string; warnings: readonly string[]; resumed: boolean }> {
  const response = await readJson<{
    shots: number; nodes: number; assets: number; version: string; warnings: readonly string[]; resumed: boolean
  }>(await fetch('/canvas-studio/storyboard/land', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(version === undefined ? { projectId } : { projectId, version }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}

/** REQ-022：一个版本的**摘要**（不含快照 —— 版本列表不需要把整份稿子传过来）。 */
export interface StoryboardVersionSummary {
  readonly version: string
  readonly kind: 'auto' | 'manual'
  readonly label: string
  readonly note?: string
  readonly createdAt: number
  readonly parent: string | null
  readonly filled: number
  /** 是不是活副本的派生来源（UI 上打「当前」标记）。 */
  readonly isBaseline: boolean
}

/** REQ-022：版本面板的数据（`GET /storyboard/<id>.json`）。 */
export interface StoryboardVersionsPayload {
  readonly baseline: string | null
  readonly seq: number
  readonly live: { readonly filled: number }
  readonly versions: readonly StoryboardVersionSummary[]
  readonly landed: { readonly at: number; readonly sourceVersion: string } | null
}

/** 版本写操作的返回（新的 baseline 与计数）。 */
export interface StoryboardWriteResult {
  readonly baseline: string | null
  readonly seq: number
}

/** REQ-022：读版本摘要（版本面板）。 */
export async function fetchStoryboardVersions(projectId: string, signal?: AbortSignal): Promise<StoryboardVersionsPayload> {
  return readJson<StoryboardVersionsPayload>(await fetch(`/canvas-studio/storyboard/${encodeURIComponent(projectId)}.json`, {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** REQ-022：把当前活副本存成一个新版本（可命名 + 可备注）。 */
export async function archiveStoryboardVersion(
  projectId: string,
  label?: string,
  note?: string,
  signal?: AbortSignal,
): Promise<StoryboardWriteResult> {
  return readJson<StoryboardWriteResult>(await fetch('/canvas-studio/storyboard/archive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      ...(label === undefined || label.trim() === '' ? {} : { label }),
      ...(note === undefined || note.trim() === '' ? {} : { note }),
    }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** REQ-022：回退到某个历史版本（Host 会先自动打点当前活副本，不丢数据）。 */
export async function restoreStoryboardVersion(
  projectId: string,
  version: string,
  signal?: AbortSignal,
): Promise<StoryboardWriteResult> {
  return readJson<StoryboardWriteResult>(await fetch('/canvas-studio/storyboard/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, version }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** REQ-022：改版本名（版本号与内容都不动）。 */
export async function renameStoryboardVersion(
  projectId: string,
  version: string,
  label: string,
  note?: string,
  signal?: AbortSignal,
): Promise<StoryboardWriteResult> {
  return readJson<StoryboardWriteResult>(await fetch('/canvas-studio/storyboard/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, version, label, ...(note === undefined || note.trim() === '' ? {} : { note }) }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** 一条字段级差异（`GET /storyboard/<id>/diff`）。 */
export interface StoryboardDiffEntry {
  readonly section: string
  readonly path: string
  readonly label: string
  readonly kind: 'added' | 'removed' | 'changed'
  readonly from?: string
  readonly to?: string
}

/** REQ-022：读两版的字段级差异（UI 用它给出「N 处差异」的预期）。 */
export async function fetchStoryboardDiff(
  projectId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ total: number; entries: readonly StoryboardDiffEntry[] }> {
  const query = new URLSearchParams({ from, to })
  return readJson<{ total: number; entries: readonly StoryboardDiffEntry[] }>(
    await fetch(`/canvas-studio/storyboard/${encodeURIComponent(projectId)}/diff?${query.toString()}`, {
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}

/** P7 点选式澄清：提交用户对当前问题的选择，返回更新后的工作流（问题已带答案）。 */
export async function answerStudioQuestion(projectId: string, value: string, signal?: AbortSignal): Promise<StudioWorkflow> {
  const response = await readJson<{ workflow: unknown }>(await fetch('/canvas-studio/workflow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, action: 'answer', value }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return normalizeWorkflow(response.workflow)
}

/**
 * 把历史节点里写死的 `http://127.0.0.1:<port>/canvas-studio/...` 绝对 URL 归一化为
 * 同源相对路径。渲染进程与 webServer 同源，相对 URL 自动解析到当前端口，桌面重启
 * 换端口也不会 404（早期版本把端口写死在 URL 里，换端口后已有产物会失效）。
 */
function normalizeCanvasNodes(nodes: readonly StudioCanvasNode[]): StudioCanvasNode[] {
  return nodes.map((node) => {
    if (typeof node.url !== 'string') return node
    // CR-087：兼容 localhost 历史 URL（此前只归一 127.0.0.1；老数据两种都可能写死）。
    const rewritten = node.url.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/canvas-studio\/.*)$/, '$1')
    return rewritten === node.url ? node : { ...node, url: rewritten }
  })
}

/** Load a project's persisted canvas (nodes + viewport; view is null pre-v3). */
export async function loadStudioCanvas(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ nodes: StudioCanvasNode[]; view: StudioCanvasView | null }> {
  const response = await readJson<{ nodes: readonly StudioCanvasNode[]; view: unknown }>(
    await fetch(`/canvas-studio/canvas?projectId=${encodeURIComponent(projectId)}`, {
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return {
    nodes: normalizeCanvasNodes(response.nodes),
    view: normalizeCanvasView(response.view) ?? null,
  }
}

/**
 * 把 `Uint8Array` 编码为标准 base64。
 *
 * 不能用 `File.text() + btoa(unescape(encodeURIComponent(text)))` 这条捷径：
 * `File.text()` 会按 UTF-8 解码二进制，把 0x80–0xFF 的字节替换成 U+FFFD，
 * 导致 PNG/JPEG 头部字节被破坏，落地后再被 `<img>` 加载会触发 `onerror`。
 * 这里直接走字节，单测里也用真实 PNG magic 字节校验过。
 */
export { bytesToBase64 } from '../encoding.js'

/**
 * P8.1 → CV-241 §6.5：本地文件上传（base64 JSON）→ 同源 URL + 磁盘文件名。
 *
 * **DEPRECATED（保留一版兼容热更新/旧客户端）**：画布链路自 CV-241 Step 3 起
 * 已全部切到 `uploadStudioMedia`（octet-stream → `/canvas-studio/upload-media`），
 * 本函数全仓零调用方。确认热更新窗口过后，下一批与 `ROUTE_UPLOAD` 一并删除。
 *
 * **不再返回 Drama filename** —— 快速段只落盘，后端提升由消费侧惰性兜底
 * （`resolveRefFilenames`）或显式 `promoteStudioImage` 接力；上传路径永不
 * 阻塞在公网往返上（计划 §5.4）。
 */
export async function uploadLocalStudioImage(
  projectId: string,
  name: string,
  dataBase64: string,
  signal?: AbortSignal,
): Promise<{ url: string; assetFile: string }> {
  const response = await readJson<{ url: string; assetFile: string }>(await fetch('/canvas-studio/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, name, dataBase64 }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}

/**
 * 2026-09-05 两段式上传（对话附件旁路体验优化）：快速段只落盘（毫秒级），
 * 返回同源 url + 磁盘文件名；Drama 提升由 promoteStudioImage 后台接力，
 * 发送不再被公网上传阻塞。
 */
export async function uploadLocalStudioImageDeferred(
  projectId: string,
  name: string,
  dataBase64: string,
  signal?: AbortSignal,
): Promise<{ url: string; assetFile: string }> {
  const response = await readJson<{ url: string; assetFile: string }>(await fetch('/canvas-studio/upload-local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, name, dataBase64 }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}

/** 提升段：把已落盘资产上传 Drama 拿 filename（后台预热 / 惰性兜底共用）。 */
export async function promoteStudioImage(
  projectId: string,
  assetFile: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await readJson<{ filename: string }>(await fetch('/canvas-studio/promote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, assetFile }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.filename
}

/**
 * REQ-003（§4.3）：把画布节点 id / `lib:<id>` 解析成**可直接下发**的 Drama 句柄。
 *
 * 为什么 UI 不能直接拿 `node.filename`：生成产物节点上存的是后端**产物名**
 * （`img_*`），当参考传回去约 0.1s 内 500（CV-155 实测）。这条链会惰性提升并把可用
 * 句柄**回写源节点** —— 于是面板里的缩略图反查（按 filename 找节点）随后也能命中。
 *
 * **逐项返回**：成功给 `handle`、失败给 `error`；一项坏了不影响其它项（一次选多张时
 * 不该整批失败）。调用方拿到句柄后再走 `withReferenceNames` 写回参考位。
 */
export async function resolveStudioRefs(
  projectId: string,
  refs: readonly string[],
  signal?: AbortSignal,
): Promise<readonly ResolveRefItem[]> {
  const response = await readJson<ResolveRefsResponse>(await fetch('/canvas-studio/resolve-refs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, refs }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.items
}

/**
 * CV-241 Step 2：四类文件统一上传（octet-stream 原始字节）。
 *
 * 按扩展名分类**不在这里做**（api 层是哑管道）——分类上提到 UI（StudioFrame /
 * 工具栏）；Host 侧按 `classifyFile` + `MEDIA_UPLOAD_LIMITS` 校验。返回与旧
 * `/upload` 同构的 `{ url, assetFile }`；**不触发 promote**（§5.4）。
 */
export async function uploadStudioMedia(
  projectId: string,
  file: File,
  signal?: AbortSignal,
): Promise<{ url: string; assetFile: string }> {
  const query = new URLSearchParams({ projectId, name: file.name })
  return readJson<{ url: string; assetFile: string }>(await fetch(`/canvas-studio/upload-media?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
    ...(signal === undefined ? {} : { signal }),
  }))
}

/**
 * 上传参考视频（原始字节流，免 base64 膨胀）。
 *
 * 2026-09-22 改造：Host **只落盘 + 探时长 + 拿 Drama 句柄**，不再抽帧 —— 返回三样
 * 事实，由调用方落**一个视频节点**。抽帧与风格归纳改为画布右键按需触发
 * （见 `splitStudioVideo`）。
 */
export async function uploadStudioVideo(
  projectId: string,
  file: File,
  signal?: AbortSignal,
): Promise<StudioVideoImportPayload> {
  const query = new URLSearchParams({ projectId, name: file.name })
  return readJson<StudioVideoImportPayload>(await fetch(`/canvas-studio/upload-video?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
    ...(signal === undefined ? {} : { signal }),
  }))
}

/**
 * 拆分画布上**已有的视频节点**（右键「拆分视频」）：Host 对该资产抽帧 + 风格归纳。
 *
 * 与上传分开是刻意的：上传只落节点，拆分是**派生动作** —— 用户想不想拆、拆哪个、
 * 拆几次都由自己定；而且派生不动原视频（它是画布上的正式资产）。
 */
export async function splitStudioVideo(
  projectId: string,
  videoUrl: string,
  label: string,
  signal?: AbortSignal,
): Promise<StudioVideoStylePayload> {
  return readJson<StudioVideoStylePayload>(await fetch('/canvas-studio/split-video', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, videoUrl, label }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** Persist a project's full canvas node list plus the current viewport state. */
export async function saveStudioCanvas(
  projectId: string,
  nodes: readonly StudioCanvasNode[],
  view: StudioCanvasView,
  removedIds?: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/canvas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // CV-242：removedIds 是「显式删除」协议——服务端 preserved 据此排除已删节点，
    // 否则整档覆盖保存会把删除的节点在磁盘上复活。
    body: JSON.stringify({
      projectId,
      nodes,
      view,
      ...(removedIds !== undefined && removedIds.length > 0 ? { removedIds } : {}),
    }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** CV-243：项目资产废料 GC（打开项目时自动调；幂等，失败静默）。 */
export async function gcStudioAssets(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; restored: number; purged: number; orphansRemoved: number }> {
  return readJson(await fetch('/canvas-studio/asset-gc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** CV-246：历史条目（Host 落库结构，状态徽章由客户端对照画布节点派生）。 */
export interface AssetHistoryEntry {
  file: string
  kind: 'image' | 'video' | 'audio' | 'file'
  tool: string
  label: string
  createdAt: number
  size?: number
  deletedAt?: number
}

/** CV-246：读项目生成产物历史（含已删条目；首期 UI 只展示图/视频）。 */
export async function getStudioAssetHistory(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; entries: AssetHistoryEntry[] }> {
  return readJson(await fetch(`/canvas-studio/asset-history?projectId=${encodeURIComponent(projectId)}`, {
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** CV-246：历史面板删除（被画布引用 → 409 拒绝；否则进 .trash + 标记 deletedAt）。 */
export interface DeleteAssetHistoryResult {
  ok?: boolean
  error?: string
  /** B-4：409 时随附的直接引用节点清单（确认框指名道姓用）。 */
  direct?: { id: string; title: string; kind: string }[]
}

export async function deleteStudioAssetHistory(
  projectId: string,
  file: string,
  options: { force?: boolean } = {},
  signal?: AbortSignal,
): Promise<DeleteAssetHistoryResult> {
  const response = await fetch('/canvas-studio/asset-history/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, file, ...(options.force === true ? { force: true } : {}) }),
    ...(signal === undefined ? {} : { signal }),
  })
  // 409（仍被引用）不是传输错误——响应体带引用清单，交由调用方走确认→force 流程。
  return await response.json() as DeleteAssetHistoryResult
}

/** CV-277：批量清理失效产物的结果（画布节点与磁盘文件同批清，语义同单条 force 删除）。 */
export interface PruneRetiredAssetsResult {
  ok?: boolean
  error?: string
  /** 已删除的资产文件名（磁盘已物理删、历史已标 deletedAt）。 */
  removedFiles?: string[]
  /** 已从画布移除的节点数。 */
  removedNodes?: number
  /** 正在生成中而跳过的节点（不静默放过，回报给用户）。 */
  busyNodes?: { id: string; title: string }[]
}

/**
 * CV-277：一次清掉本项目全部「失效产物」（被新版取代 / 手动作废的图与视频）。
 *
 * 与逐条 `deleteStudioAssetHistory` 的差别只在**写盘次数**——服务端把 N 个文件的
 * 解引用合并成一次 `writeCanvas`，节点多时快一个量级。语义完全一致：仍被画布引用的
 * 一并移除节点、下游 `generationPrompt` 解引用（标 `[已删除:…]` 不静默降级）、
 * 文件物理删（B-1 定案：彻底删除不回退）。
 */
export async function pruneRetiredStudioAssets(
  projectId: string,
  signal?: AbortSignal,
): Promise<PruneRetiredAssetsResult> {
  const response = await fetch('/canvas-studio/asset-history/prune-retired', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
    ...(signal === undefined ? {} : { signal }),
  })
  return await response.json() as PruneRetiredAssetsResult
}

/**
 * REQ-021：把自动测试报告写到测试项目目录的 `test-report.md`（Host 覆盖写；
 * 增量更新靠调用方每检查点后重发全量 markdown）。
 */
export async function saveTestReport(
  projectId: string,
  markdown: string,
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/test-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, markdown }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** CV-066：读某项目已装载的 skill 清单（skills.json）。 */
export async function loadActiveSkills(
  projectId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await readJson<{ skills: string[] }>(await fetch(
    `/canvas-studio/active-skills?projectId=${encodeURIComponent(projectId)}`,
    { cache: 'no-store', ...(signal === undefined ? {} : { signal }) },
  ))
  return response.skills
}

/** CV-066：整表替换某项目已装载的 skill 清单（幂等；activate/deactivate 都是调它）。 */
export async function saveActiveSkills(
  projectId: string,
  skills: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/active-skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, skills }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** P9.2/P9.3：合成成片。提交选中的分镜视频 clip id（与可选 BGM 节点 id），返回成片同源 URL + 时长。 */
export async function composeStudioVideo(
  projectId: string,
  clipIds: readonly string[],
  bgmNodeId?: string,
  signal?: AbortSignal,
): Promise<{
  url: string
  duration: number
  width?: number
  height?: number
  /** CV-143：成片音轨构成（角标展示）。 */
  audioComposition?: StudioAudioComposition
  /** CV-138 / CV-141：降级说明（探测失败回退、多镜无 BGM 导致无声等）。 */
  warnings?: string[]
}> {
  const response = await readJson<{
    url: string
    duration: number
    width?: number
    height?: number
    audioComposition?: StudioAudioComposition
    warnings?: string[]
  }>(await fetch('/canvas-studio/compose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bgmNodeId === undefined ? { projectId, clipIds } : { projectId, clipIds, bgmNodeId }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}

/**
 * 节点级重试：按节点上**已保存的**生成参数重新请求 Host，结果写回原节点
 * （`retryOf`，不产生新边）。成功后返回新的产物 URL。
 *
 * 这里刻意**没有 overrides**：参数的唯一来源是节点自己的 `generationPrompt`，
 * 而它的编辑走 `updateNode`（普通本地字段写入，进撤销栈、能落盘）。从前那条
 * 「调用点临时覆盖 prompt」的通道已被「改完再点重试」取代 —— 留着它就等于有两条
 * 改参数的路，其中一条改完什么都不留。
 */
export async function retryStudioNode(
  projectId: string,
  node: StudioCanvasNode,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  if (node.toolName === undefined) throwError('CS-CLIENT-ERR', { message: '节点缺少工具名，无法重试' })
  const base = generationParamsOf(node)
  if (base === null) throwError('CS-NODE-001')
  // `base` 是节点上那份参数（键即后端契约）；只补 retryOf 告诉 Host「原地更新」。
  const params = { ...base, retryOf: node.id }
  const response = await readJson<{ url: string }>(await fetch('/canvas-studio/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: node.toolName, projectId, params }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}
/**
 * C3 真波形：取音频包络（0–1 峰值序列）。任何失败（ffmpeg 缺失 / 解码失败 /
 * 非音频资产）返回 null —— 波形是装饰性信息，调用方静默退回确定性公式，
 * 不重试、不报 UI 错。
 */
export async function fetchStudioWaveform(
  projectId: string,
  file: string,
  signal?: AbortSignal,
): Promise<readonly number[] | null> {
  try {
    const response = await readJson<{ envelope?: unknown }>(await fetch('/canvas-studio/waveform', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, file }),
      ...(signal === undefined ? {} : { signal }),
    }))
    if (!Array.isArray(response.envelope)) return null
    return response.envelope.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? (response.envelope as readonly number[])
      : null
  } catch {
    return null
  }
}

// ── REQ-034 · B3：route B（CSR）渲染工单桥的 client face ─────────────────────
// 宿主建单（工具 render_composition）→ 本端轮询取单 → CSR 渲染 → 回写/撤单。

/** `/canvas-studio/remotion/pending` 返回的待渲染工单（与宿主 `PendingRenderJob` 对齐）。 */
export interface PendingStudioRenderJob {
  jobId: string
  projectId: string
  manifest: CompositionManifest
  fps: number
}

/** 取该项目当前待渲染工单；无单返回 `null`。 */
export async function fetchPendingStudioRenderJob(
  projectId: string,
  signal?: AbortSignal,
): Promise<PendingStudioRenderJob | null> {
  const response = await readJson<{ job: PendingStudioRenderJob | null }>(await fetch(
    `/canvas-studio/remotion/pending?projectId=${encodeURIComponent(projectId)}`,
    { cache: 'no-store', ...(signal === undefined ? {} : { signal }) },
  ))
  return response.job
}

/** 回写成片字节（octet-stream）+ 渲染期告警；宿主落盘并结算等待中的工具调用。 */
export async function commitStudioRenderJob(
  jobId: string,
  bytes: Uint8Array,
  warnings: readonly string[] = [],
  signal?: AbortSignal,
): Promise<void> {
  const query = new URLSearchParams({ jobId })
  if (warnings.length > 0) query.set('warnings', JSON.stringify([...warnings]))
  await readJson<{ ok: boolean }>(await fetch(`/canvas-studio/remotion/commit?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    // lib.dom 把 BodyInit 收窄到 ArrayBufferView<ArrayBuffer>，而 Uint8Array 缺省泛型是
    // ArrayBufferLike；运行时 fetch 完全接受 Uint8Array，故此处收窄断言。
    body: bytes as unknown as BodyInit,
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** 撤单：`failed=true` = 渲染失败（带 reason）；否则视为主动取消。幂等（宿主可能已超时）。 */export async function cancelStudioRenderJob(
  jobId: string,
  failed: boolean,
  reason?: string,
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/remotion/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, ...(failed ? { failed: true } : {}), ...(reason === undefined ? {} : { reason }) }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

// ── CV-331/332/333：用户上传 skill 面的 client face ─────────────────────────

/**
 * 读技能广场列表（内置常量 + 用户条目 + 每条在本项目的生效状态）。
 *
 * `projectId` 为 `null`（lobby 态无项目）时不传 —— 不带 cwd 就拿不到项目层，
 * 「被项目级同名顶掉」这一态在 lobby 下无从判断，属预期。
 */
export async function fetchUserSkills(
  projectId: string | null,
  signal?: AbortSignal,
): Promise<UserSkillsPayload> {
  const query = projectId === null ? '' : `?projectId=${encodeURIComponent(projectId)}`
  return readJson<UserSkillsPayload>(await fetch(`/canvas-studio/skills${query}`, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
}

/**
 * 导入一份用户 skill。
 *
 * ⚠️ **不走 `readJson`**：400（校验拒绝）与 409（落点已存在）的响应体里带的是
 * 结构化的 `verdict`，正是向导第 2 步要显示的东西 —— `readJson` 会把它们抛成
 * `StudioApiError`，调用方就只能看到一句 message 而拿不到逐条建议。
 */
export async function importUserSkill(
  request: ImportSkillRequest,
  signal?: AbortSignal,
): Promise<ImportSkillResult> {
  const response = await fetch('/canvas-studio/skills/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal === undefined ? {} : { signal }),
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  // 结构化 verdict（200 成功 / 400 校验拒绝 / 409 落点冲突）原样回传 —— 向导第 2 步
  // 要显示逐条建议，`ok` 是唯一的形状判据。
  if (payload !== null && typeof payload === 'object' && typeof (payload as { ok?: unknown }).ok === 'boolean') {
    return payload as ImportSkillResult
  }
  // ⚠️ 非结构化失败（413 体积超限 / 500 兜底）的 body 是 `{ error, code }` ——
  // 若直接当成 ImportSkillResult 返回，调用方读到的是 `ok: undefined`，
  // 然后掉进「导入失败。」这个万能兜底，真因（「超过 4MB 上限」）被丢掉。
  const bodyError = payload !== null && typeof payload === 'object'
    ? (payload as { error?: unknown }).error
    : undefined
  throw new StudioApiError(
    typeof bodyError === 'string' && bodyError !== ''
      ? bodyError
      : (response.status === 413 ? '导入内容过大，请精简后再试。' : requestFailedText(response.status)),
    response.status,
  )
}

/** 删除一个用户 skill（移入应用内回收站，可手工恢复）。 */
export async function deleteUserSkill(slug: string, signal?: AbortSignal): Promise<DeleteSkillResult> {
  return readJson<DeleteSkillResult>(await fetch('/canvas-studio/skills/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** 清空技能回收站（真删除；用户显式动作）。 */
export async function emptyUserSkillTrash(signal?: AbortSignal): Promise<EmptyTrashResult> {
  return readJson<EmptyTrashResult>(await fetch('/canvas-studio/skills/trash/empty', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    ...(signal === undefined ? {} : { signal }),
  }))
}

// ── 二期 1b：渲染进度（client face） ─────────────────────────────────
//
// ⚠️ 这里**故意没有**「取队列」的客户端函数：客户端只需要 ① 取本项目的待渲染单
// （`/remotion/pending`）② 上报本条进度。队列深度 / 历史状态是**宿主侧观测面**
// （`GET /remotion/jobs`，curl 可查、将来接进度面板时再用），客户端拿它做不出
// 任何有用决策 —— 取单本身已经由宿主按队列派发/屏蔽（排队中的单客户端根本看不到）。

/**
 * 上报渲染进度（0–1）。**调用方负责节流**（客户端按 3% 粒度上报）——
 * 每帧一发会把这条本机回环打满，且宿主侧也只是覆盖一个数字。
 */
export async function reportStudioRenderProgress(
  jobId: string,
  progress: number,
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/remotion/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, progress }),
    ...(signal === undefined ? {} : { signal }),
  }))
}
