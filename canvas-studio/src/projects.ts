/**
 * Canvas Studio project registry: durable project records under
 * `$DSH_HOME/canvas-studio/` with one on-disk directory per project.
 * The registry file is replaced atomically (`@deepseek-ai/dsh-atomic-write`),
 * so a crash never leaves a half-written registry behind.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { StudioPendingQuestion, StudioProject, StudioWorkflow } from './contracts/project.js'
import { normalizeWorkflow } from './contracts/project.js'
import { CANVAS_DOCUMENT_VERSION, NODE_DEFAULTS } from './contracts/canvas.js'
import type { StudioCanvasDocument, StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js'
import { normalizeCanvasView } from './canvas-view.js'

/** Registry file format version; bump with a migration when the shape changes. */
const REGISTRY_VERSION = 1

/** On-disk registry document. */
interface ProjectRegistryDocument {
  version: typeof REGISTRY_VERSION
  projects: StudioProject[]
}

/** Maximum project name length (characters). */
const MAX_NAME_LENGTH = 80

/**
 * Reject names that cannot round-trip through the registry or the filesystem.
 * @param name - trimmed candidate project name.
 * @throws when the name is empty, too long, or carries control/path characters.
 */
export function validateProjectName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new Error('项目名不能为空且不能超过 80 个字符')
  }
  if (/[\u0000-\u001f\u007f/\\]/u.test(name)) {
    throw new Error('项目名不能包含控制字符或路径分隔符')
  }
}

/** ISO 8601 timestamp for registry records. */
function nowIso(): string {
  return new Date().toISOString()
}

/**
 * The project registry owner. Lazily loads the registry document once per
 * process and keeps an in-memory copy so list/create never re-reads the
 * registry for every request.
 */
export class ProjectRegistry {
  private readonly rootProvider: () => string
  /** Cache is keyed by the root it was loaded from so a settings change
   *  to 「资产库位置」 invalidates the in-memory list automatically. */
  private cached: { root: string; projects: StudioProject[] } | null = null

  /**
   * @param root - registry root directory; accepts a static string or a
   *   provider so the root can be re-read at every operation (used by the
   *   storage → 「资产库位置」 setting, which is sourced live from
   *   `CanvasStudioConfig.assetDir`). When the root changes mid-process,
   *   subsequent reads / writes target the new location; cached records
   *   and existing files at the old root are intentionally left in place
   *   (no migration — see plan.md §1.7 「资产库位置」接入说明).
   */
  constructor(root: string | (() => string) = dshHomePath('canvas-studio')) {
    this.rootProvider = typeof root === 'function' ? root : () => root
  }

  /** Resolved registry root (current value of the provider, if any). */
  private get root(): string {
    return this.rootProvider()
  }

  /** Resolved projects directory under the current root. */
  private get projectsDir(): string {
    return join(this.root, 'projects')
  }

  /** Resolved registry file under the current root. */
  private get file(): string {
    return join(this.root, 'projects.json')
  }

  /** The absolute path of one project's directory. */
  projectDir(projectId: string): string {
    return join(this.projectsDir, projectId)
  }

  /** The absolute path of one project's asset directory. */
  assetsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'assets')
  }

  /** The absolute path of one project's canvas document. */
  canvasFile(projectId: string): string {
    return join(this.projectDir(projectId), 'canvas.json')
  }

  /**
   * Read a project's canvas document (nodes + persisted viewport). Returns an
   * empty node list and no view when the document is missing or corrupt (the
   * canvas is disposable UI state, never fatal).
   * @param projectId - target project id.
   */
  async readCanvas(projectId: string): Promise<StudioCanvasDocument> {
    let text: string
    try {
      text = await readFile(this.canvasFile(projectId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: CANVAS_DOCUMENT_VERSION, nodes: [] }
      throw error
    }
    try {
      const document = JSON.parse(text) as unknown
      return normalizeCanvasDocument(document)
    } catch {
      return { version: CANVAS_DOCUMENT_VERSION, nodes: [] }
    }
  }

  /**
   * Persist a project's canvas nodes (and viewport when provided) atomically
   * (a crash never leaves a half-written canvas document behind).
   * @param projectId - target project id.
   * @param nodes - the full node list for the project.
   * @param view - the client viewport/panel state; omitted by Host-authored
   *   writes, which preserve the previously saved view untouched.
   */
  async writeCanvas(
    projectId: string,
    nodes: readonly StudioCanvasNode[],
    view?: StudioCanvasView,
  ): Promise<void> {
    // Merge-protect: a client save replaces the whole document, but generated
    // media nodes written by the Host during `generateAsset` may not be present
    // in the client's in-memory list yet (a generation just completed). Keep any
    // Host-authored node whose id the client did not include, so a drag-save
    // cannot clobber a freshly generated asset.
    const incomingIds = new Set(nodes.map((node) => node.id))
    const existing = await this.readCanvas(projectId)
    const preserved = existing.nodes.filter((node) => !incomingIds.has(node.id))
    // Host writes omit `view`; keep whatever view the last client save left.
    const nextView = view ?? normalizeCanvasView(existing.view)
    const document: StudioCanvasDocument = {
      version: CANVAS_DOCUMENT_VERSION,
      nodes: [...nodes, ...preserved],
      ...(nextView !== undefined ? { view: nextView } : {}),
    }
    await writeFileAtomic(this.canvasFile(projectId), `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  /**
   * Append one generated-media node to a project's canvas document. The Host
   * writes this the moment an asset lands on disk, so the canvas reflects a
   * successful generation deterministically (the client reloads the document
   * on `tool/result`), independent of how the conversation event renders the
   * tool result text.
   * @param projectId - target project id.
   * @param node - the node to append (id must be unique within the project).
   */
  async appendCanvasNode(projectId: string, node: StudioCanvasNode): Promise<void> {
    const existing = await this.readCanvas(projectId)
    if (existing.nodes.some((candidate) => candidate.id === node.id)) return
    await this.writeCanvas(projectId, [...existing.nodes, node])
  }

  /**
   * List all registered projects in creation order.
   * @returns the durable project records.
   * @throws when the registry document exists but is unreadable or corrupt.
   */
  async list(): Promise<readonly StudioProject[]> {
    const currentRoot = this.root
    if (this.cached === null || this.cached.root !== currentRoot) {
      this.cached = { root: currentRoot, projects: await this.readRegistry() }
    }
    return this.cached.projects
  }

  /**
   * Create a project: mint its directory (with `assets/`), append the record
   * to the registry, and persist the registry atomically.
   * @param name - display name (trimmed and validated).
   * @returns the created project record.
   */
  async create(name: string): Promise<StudioProject> {
    const trimmed = name.trim()
    validateProjectName(trimmed)
    const projects = [...await this.list()]
    if (projects.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`项目名已存在: ${trimmed}`)
    }
    const id = randomUUID()
    const project: StudioProject = {
      id,
      name: trimmed,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      dir: this.projectDir(id),
    }
    await mkdir(this.assetsDir(id), { recursive: true, mode: 0o700 })
    projects.push(project)
    await this.writeRegistry(projects)
    this.cached = { root: this.root, projects }
    return project
  }

  /**
   * Delete a project: remove its on-disk directory (registry, assets, canvas)
   * and drop the record. Refuses when the resolved directory is not safely
   * nested under the projects directory.
   * @param projectId - target project id.
   */
  async removeProject(projectId: string): Promise<void> {
    const projects = [...await this.list()]
    const index = projects.findIndex((entry) => entry.id === projectId)
    if (index === -1) throw new Error(`项目不存在: ${projectId}`)
    const dir = this.projectDir(projectId)
    if (!dir.startsWith(this.projectsDir + sep)) throw new Error('非法项目目录，拒绝删除')
    await rm(dir, { recursive: true, force: true })
    projects.splice(index, 1)
    await this.writeRegistry(projects)
    this.cached = { root: this.root, projects }
  }

  /**
   * Read one project record (with its P7 workflow defaulted when absent).
   * @returns the record, or null when the id is unknown.
   */
  async getProject(projectId: string): Promise<StudioProject | null> {
    return (await this.list()).find((entry) => entry.id === projectId) ?? null
  }

  /**
   * Patch a project's P7 workflow (mode / gate state) and persist the
   * registry atomically. Returns the updated record.
   */
  async updateWorkflow(projectId: string, patch: Partial<StudioWorkflow>): Promise<StudioProject> {
    const projects = [...await this.list()]
    const index = projects.findIndex((entry) => entry.id === projectId)
    if (index === -1) throw new Error(`项目不存在: ${projectId}`)
    const current = projects[index]!
    const updated: StudioProject = {
      ...current,
      workflow: { ...normalizeWorkflow(current.workflow), ...patch },
      updatedAt: nowIso(),
    }
    projects[index] = updated
    await this.writeRegistry(projects)
    this.cached = { root: this.root, projects }
    return updated
  }

  /**
   * 写入 / 清除项目的待回答问题（ask_user_choice 工具与 answer 动作使用）。
   */
  async setPendingQuestion(projectId: string, question: StudioPendingQuestion | null): Promise<void> {
    const projects = [...await this.list()]
    const index = projects.findIndex((entry) => entry.id === projectId)
    if (index === -1) throw new Error(`项目不存在: ${projectId}`)
    const current = projects[index]!
    const { pendingQuestion: _omitted, ...workflow } = normalizeWorkflow(current.workflow)
    const next: StudioProject = {
      ...current,
      workflow: question === null ? workflow : { ...workflow, pendingQuestion: question },
      updatedAt: nowIso(),
    }
    projects[index] = next
    await this.writeRegistry(projects)
    this.cached = { root: this.root, projects }
  }

  /**
   * 记录用户对当前问题的选择（画布点选卡片 → workflow 路由调用）。
   * ask_user_choice 工具轮询读到后负责清空。
   */
  async answerPendingQuestion(projectId: string, value: string): Promise<void> {
    const projects = [...await this.list()]
    const index = projects.findIndex((entry) => entry.id === projectId)
    if (index === -1) throw new Error(`项目不存在: ${projectId}`)
    const current = projects[index]!
    const workflow = normalizeWorkflow(current.workflow)
    if (workflow.pendingQuestion === null || workflow.pendingQuestion === undefined) {
      throw new Error('当前没有待回答的问题')
    }
    const trimmed = value.trim()
    if (trimmed.length === 0) throw new Error('回答不能为空')
    const next: StudioProject = {
      ...current,
      workflow: { ...workflow, pendingQuestion: { ...workflow.pendingQuestion, answer: trimmed } },
      updatedAt: nowIso(),
    }
    projects[index] = next
    await this.writeRegistry(projects)
    this.cached = { root: this.root, projects }
  }

  private async readRegistry(): Promise<StudioProject[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    let document: unknown
    try {
      document = JSON.parse(text) as unknown
    } catch {
      throw new Error(`canvas-studio: registry file is corrupt: ${this.file}`)
    }
    if (
      document === null
      || typeof document !== 'object'
      || Array.isArray(document)
      || (document as { version?: unknown }).version !== REGISTRY_VERSION
      || !Array.isArray((document as { projects?: unknown }).projects)
    ) {
      throw new Error(`canvas-studio: registry file is not a project registry: ${this.file}`)
    }
    const projects = (document as ProjectRegistryDocument).projects
    for (const entry of projects) {
      if (!isProjectRecord(entry)) {
        throw new Error(`canvas-studio: registry file contains an invalid project record: ${this.file}`)
      }
    }
    // P7 migration-on-read: records predating the workflow field get the
    // default (confirm + drafting). Absence stays legal on disk.
    return projects.map((entry) => (
      entry.workflow === undefined ? { ...entry, workflow: normalizeWorkflow(undefined) } : entry
    ))
  }

  private async writeRegistry(projects: readonly StudioProject[]): Promise<void> {
    const document: ProjectRegistryDocument = { version: REGISTRY_VERSION, projects: [...projects] }
    await writeFileAtomic(this.file, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}

/** Narrow check of one registry entry against the wire shape. */
function isProjectRecord(value: unknown): value is StudioProject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.name === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
    && typeof record.dir === 'string'
}

/** Accept only canvas nodes we can safely render; drop anything malformed. */
function isCanvasNode(value: unknown): value is StudioCanvasNode {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  return typeof node.id === 'string'
    && node.id.length > 0
    && (
      node.kind === 'image'
      || node.kind === 'video'
      || node.kind === 'sticky'
      || node.kind === 'text'
      || node.kind === 'prompt'
    )
    && typeof node.x === 'number'
    && typeof node.y === 'number'
    && typeof node.width === 'number'
    && typeof node.height === 'number'
    && typeof node.createdAt === 'number'
    && (node.origin === 'agent' || node.origin === 'manual')
    && Array.isArray(node.sourceIds)
}

/** Coerce an unknown parsed canvas document into a safe document (lenient). */
function normalizeCanvasDocument(value: unknown): StudioCanvasDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { version: CANVAS_DOCUMENT_VERSION, nodes: [] }
  }
  const document = value as Record<string, unknown>
  if (!Array.isArray(document.nodes)) return { version: CANVAS_DOCUMENT_VERSION, nodes: [] }
  // S1 migration: nodes predating the visual-state fields get defaults. zIndex
  // falls back to the document order (stable for ties broken by createdAt).
  let nextZ = 1
  const nodes = document.nodes
    .filter(isCanvasNode)
    .map((node) => {
      const migrated: StudioCanvasNode = {
        ...node,
        locked: node.locked ?? NODE_DEFAULTS.locked,
        visible: node.visible ?? NODE_DEFAULTS.visible,
        opacity: node.opacity ?? NODE_DEFAULTS.opacity,
        flipX: node.flipX ?? NODE_DEFAULTS.flipX,
        flipY: node.flipY ?? NODE_DEFAULTS.flipY,
        zIndex: node.zIndex ?? nextZ,
      }
      nextZ += 1
      return migrated
    })
  // v3 migration: documents predating the viewport/panel state carry no view;
  // invalid fields degrade to their defaults (normalizeCanvasView is lenient).
  const view = normalizeCanvasView(document.view)
  return {
    version: CANVAS_DOCUMENT_VERSION,
    nodes,
    ...(view !== undefined ? { view } : {}),
  }
}