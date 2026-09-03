/**
 * Canvas Studio project registry: durable project records under
 * `$DSH_HOME/canvas-studio/` with one on-disk directory per project.
 * The registry file is replaced atomically (`@deepseek-ai/dsh-atomic-write`),
 * so a crash never leaves a half-written registry behind.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { StudioPendingQuestion, StudioProject, StudioProjectGroup, StudioWorkflow, StudioWorkflowMode } from './contracts/project.js'
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

/**
 * CV-091：分组元信息独立文件版本（与 projects.json 解耦，不 bump REGISTRY_VERSION；
 * 缺失/损坏按空数组降级，零迁移风险）。
 */
const GROUPS_VERSION = 1

/** On-disk groups document (independent of projects.json). */
interface ProjectGroupDocument {
  version: typeof GROUPS_VERSION
  groups: StudioProjectGroup[]
}

/** Maximum project name length (characters). */
const MAX_NAME_LENGTH = 80

/** macOS/Windows 均不允许的路径保留字符（Windows 保留集是超集；/ \ 已被
 * validateProjectName 拒绝，这里兜底其它保留字符）。 */
const INVALID_DIR_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
/** Windows 保留设备名（不区分大小写，含扩展名形式 CON.txt 等）。 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
/** 目录名最大 UTF-8 字节数（macOS 单目录项 255 字节；留出唯一化后缀空间）。 */
const MAX_DIR_BYTES = 200

/**
 * 把项目显示名转换为安全的磁盘目录名（2026-08-31：项目落盘目录从 UUID 改为用户名）。
 * - 非法/保留字符替换为 `-`；去首尾点与空白（macOS 首点 = 隐藏文件、尾点 Windows 非法）；
 * - Windows 保留设备名加 `project-` 前缀；空结果回退 `project`；
 * - 按 UTF-8 字节截断（中文 3 字节/字），避免 macOS 255 字节上限。
 * 幂等、纯函数。同名项目已被 `create` 拒绝；sanitize 碰撞（如 "a/b" 与 "a?b"）由
 * `uniqueDirName` 追加后缀兜底。
 */
export function sanitizeProjectDirName(name: string): string {
  let result = name.trim()
    .replace(INVALID_DIR_CHARS, '-')
    .replace(/^[-.]+/u, '')
    .replace(/[-.\s]+$/u, '')
  if (WINDOWS_RESERVED_NAME.test(result)) result = `project-${result}`
  if (result.length === 0) return 'project'
  while (Buffer.byteLength(result, 'utf8') > MAX_DIR_BYTES && result.length > 0) {
    result = result.slice(0, -1)
  }
  return result.length === 0 ? 'project' : result
}

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
  /** R1：新建项目时读取的默认执行模式（设置页「默认执行模式」的事实源，live 读取）。 */
  private readonly defaultWorkflowMode: () => StudioWorkflowMode
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
   * @param defaultWorkflowMode - live provider for the settings-page 「默认执行
   *   模式」; consulted once per `create` so new projects start in the mode the
   *   user picked (R1: the setting previously existed but was never consumed).
   */
  constructor(
    root: string | (() => string) = dshHomePath('canvas-studio'),
    defaultWorkflowMode: () => StudioWorkflowMode = () => 'confirm',
  ) {
    this.rootProvider = typeof root === 'function' ? root : () => root
    this.defaultWorkflowMode = defaultWorkflowMode
  }

  /** Resolved registry root (current value of the provider, if any). */
  private get root(): string {
    return this.rootProvider()
  }

  /** 公开的 registry 根目录（供 host-tools 等把「本地文件读取」白名单约束在
   * 本项目资产库内——CR-011 纵深防御）。只读快照，不做目录存在性校验。 */
  get registryRoot(): string {
    return this.root
  }

  /** Resolved projects directory under the current root. */
  private get projectsDir(): string {
    return join(this.root, 'projects')
  }

  /** Resolved registry file under the current root. */
  private get file(): string {
    return join(this.root, 'projects.json')
  }

  /** CV-091：分组元信息文件（独立于 projects.json，缺失即空分组）。 */
  private get groupsFile(): string {
    return join(this.root, 'groups.json')
  }

  /**
   * 解析项目的磁盘目录：优先取 registry 记录里的 `dir` 字段（新建项目 = 用户名的
   * sanitize 目录；历史项目 = 旧 UUID 目录，随记录保留）；未命中回退 `projects/<id>`
   * （缓存未加载的极端时序，行为与旧版一致，仅作安全网）。
   * CR-003：回退路径先 resolve 再校验落在 projects 目录内——projectId 由路由传入
   * （canvas POST / assets / active-skills），可为 `../x` 等穿越片段；不校验的话
   * `writeFileAtomic` 会按需建父目录，把 canvas.json / skills.json 写到 projects 之外。
   */
  dirOf(projectId: string): string {
    const record = this.cached?.projects.find((entry) => entry.id === projectId)
    if (record?.dir !== undefined && typeof record.dir === 'string' && record.dir.length > 0) {
      return record.dir
    }
    const fallback = resolve(join(this.projectsDir, projectId))
    const root = resolve(this.projectsDir) + sep
    if (fallback !== root.slice(0, -1) && !fallback.startsWith(root)) {
      throw new Error(`非法项目目录引用: ${projectId}`)
    }
    return fallback
  }

  /** The absolute path of one project's directory. */
  projectDir(projectId: string): string {
    return this.dirOf(projectId)
  }

  /** The absolute path of one project's asset directory. */
  assetsDir(projectId: string): string {
    return join(this.dirOf(projectId), 'assets')
  }

  /** The absolute path of one project's canvas document. */
  canvasFile(projectId: string): string {
    return join(this.dirOf(projectId), 'canvas.json')
  }

  /** The absolute path of one project's active-skill roster (CV-066). */
  activeSkillsFile(projectId: string): string {
    return join(this.dirOf(projectId), 'skills.json')
  }

  /**
   * 目标目录名与现有项目 dir 冲突（sanitize 碰撞）时追加 -2/-3…；999 个仍冲突
   * （理论不可达）则以短 id 兜底，保证目录唯一且可读。
   */
  private uniqueDirName(desired: string, projects: readonly StudioProject[]): string {
    const used = new Set(projects.map((entry) => entry.dir))
    const base = sanitizeProjectDirName(desired)
    if (!used.has(join(this.projectsDir, base))) return base
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`
      if (!used.has(join(this.projectsDir, candidate))) return candidate
    }
    return `${base}-${randomUUID().slice(0, 8)}`
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
   * 原子写一份 canvas 文档（追加/合并路径共用；host 与 client 都经此落盘）。
   * @param projectId - target project id.
   * @param document - 完整文档（version + nodes [+ view]）。
   */
  private async writeCanvasDocument(projectId: string, document: StudioCanvasDocument): Promise<void> {
    await writeFileAtomic(this.canvasFile(projectId), `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
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
    await this.writeCanvasDocument(projectId, document)
  }

  /**
   * CV-066：读某项目已装载的 skill 清单（skills.json）。缺失/损坏按空列表
   * 处理 —— 装载状态是展示层的软状态，从不致命。
   * @param projectId - target project id.
   */
  async readActiveSkills(projectId: string): Promise<string[]> {
    let text: string
    try {
      text = await readFile(this.activeSkillsFile(projectId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    try {
      const parsed = JSON.parse(text) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      return []
    }
  }

  /**
   * CV-066：持久化某项目已装载的 skill 清单（skills.json，原子写）。
   * @param projectId - target project id.
   * @param skills - the full active-skill roster (deduped by the caller).
   */
  async writeActiveSkills(projectId: string, skills: readonly string[]): Promise<void> {
    const clean = [...new Set(skills.filter((entry): entry is string => typeof entry === 'string'))]
    await writeFileAtomic(this.activeSkillsFile(projectId), `${JSON.stringify(clean, null, 2)}\n`, {
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
    // CR-006：只读一次盘，直接构造文档写回——不再经过 writeCanvas（它会再次
    // readCanvas 做 merge-protect，但这里已有完整快照，合并是冗余的）。此路径
    // 是生成热路径（splitStoryboard 每帧一次），避免 2 读+1 写。
    const existing = await this.readCanvas(projectId)
    if (existing.nodes.some((candidate) => candidate.id === node.id)) return
    const nextView = normalizeCanvasView(existing.view)
    const document: StudioCanvasDocument = {
      version: CANVAS_DOCUMENT_VERSION,
      nodes: [...existing.nodes, node],
      ...(nextView !== undefined ? { view: nextView } : {}),
    }
    await this.writeCanvasDocument(projectId, document)
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
   * @param groupId - CV-091：归属分组 id；`null`/省略 = 未分组。
   * @returns the created project record.
   */
  async create(name: string, groupId?: string | null): Promise<StudioProject> {
    const trimmed = name.trim()
    validateProjectName(trimmed)
    const group = groupId ?? null
    if (group !== null) {
      const groups = await this.listGroups()
      if (!groups.some((entry) => entry.id === group)) {
        throw new Error(`分组不存在: ${group}`)
      }
    }
    const projects = [...await this.list()]
    if (projects.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`项目名已存在: ${trimmed}`)
    }
    const id = randomUUID()
    // 2026-08-31：目录名 = 用户名的 sanitize 版本（不再是 UUID），便于用户在磁盘
    // 管理项目文件；id 仍是内部稳定引用（registry 记录 / 路由 / 画布均用 id）。
    const dir = join(this.projectsDir, this.uniqueDirName(trimmed, projects))
    const project: StudioProject = {
      id,
      name: trimmed,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      dir,
      // R1（缺口 C）：设置页「默认执行模式」落进新项目工作流——此前该开关从不被
      // 消费（projects.create 不写 workflow，新项目恒为 confirm/drafting）。
      // 历史项目不受影响（缺 workflow 字段按 WORKFLOW_DEFAULT 降级）。
      workflow: { mode: this.defaultWorkflowMode(), state: 'drafting' },
      // CV-091：归属分组（仅当显式指定时落字段；未分组不含 groupId，保持老记录形态）。
      ...(group !== null ? { groupId: group } : {}),
    }
    // CR-007：目录创建放在注册表写入之前（assets 需先存在）；注册表写失败时
    // 回滚已建目录，避免留下空项目孤儿目录。写前对缓存再查一次同名——并发 create
    // 同名时后到者在此被拦（两个都成功会让后写方整表覆盖先写方，项目「丢失」）。
    await mkdir(join(dir, 'assets'), { recursive: true, mode: 0o700 })
    const fresh = this.cached?.projects ?? []
    if (fresh.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      throw new Error(`项目名已存在: ${trimmed}`)
    }
    const next = [...fresh, project]
    try {
      await this.writeRegistry(next)
    } catch (cause) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      throw cause
    }
    this.cached = { root: this.root, projects: next }
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

  // ── CV-091：分组元信息（groups.json，独立于 projects.json）─────────────

  private async readGroups(): Promise<StudioProjectGroup[]> {
    let text: string
    try {
      text = await readFile(this.groupsFile, 'utf8')
    } catch (error) {
      // 文件缺失 = 无分组（首次使用）；不致命。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    let document: unknown
    try {
      document = JSON.parse(text) as unknown
    } catch {
      // 损坏按空数组降级（分组是软状态，绝不致命）。
      return []
    }
    if (
      document === null
      || typeof document !== 'object'
      || Array.isArray(document)
      || (document as { version?: unknown }).version !== GROUPS_VERSION
      || !Array.isArray((document as { groups?: unknown }).groups)
    ) {
      return []
    }
    return (document as ProjectGroupDocument).groups.filter(isGroupRecord).map((entry) => ({ ...entry }))
  }

  private async writeGroups(groups: readonly StudioProjectGroup[]): Promise<void> {
    const document: ProjectGroupDocument = { version: GROUPS_VERSION, groups: [...groups] }
    await writeFileAtomic(this.groupsFile, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  /** CV-091：列出全部分组（按 order 升序）。 */
  async listGroups(): Promise<readonly StudioProjectGroup[]> {
    const groups = await this.readGroups()
    return [...groups].sort((left, right) => left.order - right.order)
  }

  /** CV-091：新建分组，返回记录（order 取当前最大 +1）。 */
  async createGroup(name: string): Promise<StudioProjectGroup> {
    const trimmed = name.trim()
    validateProjectName(trimmed)
    const groups = await this.readGroups()
    if (groups.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`分组名已存在: ${trimmed}`)
    }
    const order = groups.reduce((max, entry) => Math.max(max, entry.order), 0) + 1
    const group: StudioProjectGroup = { id: randomUUID(), name: trimmed, order }
    await this.writeGroups([...groups, group])
    return group
  }

  /** CV-091：重命名分组。 */
  async renameGroup(groupId: string, name: string): Promise<StudioProjectGroup> {
    const trimmed = name.trim()
    validateProjectName(trimmed)
    const groups = await this.readGroups()
    const index = groups.findIndex((entry) => entry.id === groupId)
    if (index === -1) throw new Error(`分组不存在: ${groupId}`)
    const next = [...groups]
    next[index] = { ...next[index]!, name: trimmed }
    await this.writeGroups(next)
    return next[index]!
  }

  /** CV-091：删除分组；组内项目回落未分组（groupId 置 null）。 */
  async deleteGroup(groupId: string): Promise<void> {
    const groups = await this.readGroups()
    if (!groups.some((entry) => entry.id === groupId)) {
      throw new Error(`分组不存在: ${groupId}`)
    }
    await this.writeGroups(groups.filter((entry) => entry.id !== groupId))
    const projects = [...await this.list()]
    const hasAffected = projects.some((entry) => entry.groupId === groupId)
    if (!hasAffected) return
    const next = projects.map((entry) =>
      entry.groupId === groupId ? { ...entry, groupId: null } : entry)
    await this.writeRegistry(next)
    this.cached = { root: this.root, projects: next }
  }

  /** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
  async moveProjectToGroup(projectId: string, groupId: string | null): Promise<void> {
    const projects = [...await this.list()]
    const index = projects.findIndex((entry) => entry.id === projectId)
    if (index === -1) throw new Error(`项目不存在: ${projectId}`)
    if (groupId !== null) {
      const groups = await this.listGroups()
      if (!groups.some((entry) => entry.id === groupId)) {
        throw new Error(`分组不存在: ${groupId}`)
      }
    }
    const current = projects[index]!
    const updated: StudioProject = groupId === null
      ? (() => { const { groupId: _drop, ...rest } = current; return rest })()
      : { ...current, groupId }
    projects[index] = updated
    await this.writeRegistry(projects)
    this.cached = { root: this.root, projects }
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
      // CR-008：记录 dir 必须落在 projects 目录内——损坏/手改注册表若指向系统路径
      // （如 /etc），assetsDir/canvasFile 会把读写带到非预期位置。
      const resolved = resolve(entry.dir)
      const root = resolve(this.projectsDir)
      if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error(`canvas-studio: project record dir 越界: ${entry.dir}`)
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

/** Narrow check of one groups entry against the wire shape (CV-091). */
function isGroupRecord(value: unknown): value is StudioProjectGroup {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.name === 'string'
    && typeof record.order === 'number'
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