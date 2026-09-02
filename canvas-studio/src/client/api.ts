/**
 * Canvas Studio browser API: same-origin fetch helpers over the project
 * registry and canvas routes (the community-market client fetch pattern).
 */
import type { StudioProject, StudioWorkflow, StudioWorkflowMode } from '../contracts/project.js'
import { normalizeWorkflow } from '../contracts/project.js'
import type { StudioCanvasNode, StudioCanvasView, StudioVideoStylePayload } from '../contracts/canvas.js'
import { normalizeCanvasView } from '../canvas-view.js'
import type { GenerateParams } from '../generate.js'

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

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: unknown; code?: unknown }
  if (!response.ok) {
    throw new StudioApiError(
      typeof value.error === 'string' ? value.error : `request failed: ${response.status}`,
      response.status,
      typeof value.code === 'string' ? value.code : undefined,
    )
  }
  return value
}

/** List all registered projects. */
export async function listStudioProjects(signal?: AbortSignal): Promise<readonly StudioProject[]> {
  const response = await readJson<{ projects: readonly StudioProject[] }>(await fetch('/canvas-studio/projects', {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
  return response.projects
}

/** Create a project and return its record. */
export async function createStudioProject(name: string, signal?: AbortSignal): Promise<StudioProject> {
  const response = await readJson<{ project: StudioProject }>(await fetch('/canvas-studio/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
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

/** P7：工作流动作（批准 / 驳回 / 确认关键帧 / 切换模式），返回更新后的工作流。 */
export async function postStudioWorkflowAction(
  projectId: string,
  action: 'approve' | 'reject' | 'confirm_keyframes' | 'setMode',
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
    const rewritten = node.url.replace(/^https?:\/\/127\.0\.0\.1:\d+(\/canvas-studio\/.*)$/, '$1')
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

/** P8.1：本地图片上传（base64）→ 返回同源 URL + Drama filename（供生成工具引用）。 */
export async function uploadLocalStudioImage(
  projectId: string,
  name: string,
  dataBase64: string,
  signal?: AbortSignal,
): Promise<{ url: string; filename: string }> {
  const response = await readJson<{ url: string; filename: string }>(await fetch('/canvas-studio/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, name, dataBase64 }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}

/**
 * P8.4：本地参考视频上传（原始字节流，免 base64 膨胀）→ Host 抽帧提风格。
 * 返回帧列表（含 Drama filename）与风格归纳文本，由调用方落成画布节点。
 */
export async function uploadStudioVideo(
  projectId: string,
  file: File,
  signal?: AbortSignal,
): Promise<StudioVideoStylePayload> {
  const query = new URLSearchParams({ projectId, name: file.name })
  return readJson<StudioVideoStylePayload>(await fetch(`/canvas-studio/upload-video?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** Persist a project's full canvas node list plus the current viewport state. */
export async function saveStudioCanvas(
  projectId: string,
  nodes: readonly StudioCanvasNode[],
  view: StudioCanvasView,
  signal?: AbortSignal,
): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch('/canvas-studio/canvas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, nodes, view }),
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
): Promise<{ url: string; duration: number; width?: number; height?: number }> {
  const response = await readJson<{ url: string; duration: number; width?: number; height?: number }>(await fetch('/canvas-studio/compose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bgmNodeId === undefined ? { projectId, clipIds } : { projectId, clipIds, bgmNodeId }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}

/**
 * 解析节点上保存的生成参数（generationPrompt 是原参数 JSON）；无法解析或缺失时
 * 返回 null。重试 / 修改提示词都基于它重放原参数（plan §7.8）。
 */
function generationParamsOf(node: StudioCanvasNode): GenerateParams | null {
  if (node.generationPrompt === undefined) return null
  try {
    const value = JSON.parse(node.generationPrompt) as unknown
    if (value === null || typeof value !== 'object') return null
    return value as GenerateParams
  } catch {
    return null
  }
}

/**
 * 节点级重试 / 修改提示词：按原参数（可带 overrides）重新请求 Host 生成，
 * 并把结果写回原节点（retryOf，不产生新边）。成功后返回新的产物 URL。
 */
export async function retryStudioNode(
  projectId: string,
  node: StudioCanvasNode,
  overrides?: Partial<GenerateParams>,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  if (node.toolName === undefined) throw new Error('节点缺少工具名，无法重试')
  const base = generationParamsOf(node)
  if (base === null) throw new Error('节点缺少可重放的生成参数')
  const params: GenerateParams = { ...base, ...overrides, retryOf: node.id }
  const response = await readJson<{ url: string }>(await fetch('/canvas-studio/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: node.toolName, projectId, params }),
    ...(signal === undefined ? {} : { signal }),
  }))
  return response
}