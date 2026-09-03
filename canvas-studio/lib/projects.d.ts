import type { StudioPendingQuestion, StudioProject, StudioProjectGroup, StudioWorkflow, StudioWorkflowMode } from './contracts/project.js';
import type { StudioCanvasDocument, StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js';
/**
 * 把项目显示名转换为安全的磁盘目录名（2026-08-31：项目落盘目录从 UUID 改为用户名）。
 * - 非法/保留字符替换为 `-`；去首尾点与空白（macOS 首点 = 隐藏文件、尾点 Windows 非法）；
 * - Windows 保留设备名加 `project-` 前缀；空结果回退 `project`；
 * - 按 UTF-8 字节截断（中文 3 字节/字），避免 macOS 255 字节上限。
 * 幂等、纯函数。同名项目已被 `create` 拒绝；sanitize 碰撞（如 "a/b" 与 "a?b"）由
 * `uniqueDirName` 追加后缀兜底。
 */
export declare function sanitizeProjectDirName(name: string): string;
/**
 * Reject names that cannot round-trip through the registry or the filesystem.
 * @param name - trimmed candidate project name.
 * @throws when the name is empty, too long, or carries control/path characters.
 */
export declare function validateProjectName(name: string): void;
/**
 * The project registry owner. Lazily loads the registry document once per
 * process and keeps an in-memory copy so list/create never re-reads the
 * registry for every request.
 */
export declare class ProjectRegistry {
    private readonly rootProvider;
    /** R1：新建项目时读取的默认执行模式（设置页「默认执行模式」的事实源，live 读取）。 */
    private readonly defaultWorkflowMode;
    /** Cache is keyed by the root it was loaded from so a settings change
     *  to 「资产库位置」 invalidates the in-memory list automatically. */
    private cached;
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
    constructor(root?: string | (() => string), defaultWorkflowMode?: () => StudioWorkflowMode);
    /** Resolved registry root (current value of the provider, if any). */
    private get root();
    /** 公开的 registry 根目录（供 host-tools 等把「本地文件读取」白名单约束在
     * 本项目资产库内——CR-011 纵深防御）。只读快照，不做目录存在性校验。 */
    get registryRoot(): string;
    /** Resolved projects directory under the current root. */
    private get projectsDir();
    /** Resolved registry file under the current root. */
    private get file();
    /** CV-091：分组元信息文件（独立于 projects.json，缺失即空分组）。 */
    private get groupsFile();
    /**
     * 解析项目的磁盘目录：优先取 registry 记录里的 `dir` 字段（新建项目 = 用户名的
     * sanitize 目录；历史项目 = 旧 UUID 目录，随记录保留）；未命中回退 `projects/<id>`
     * （缓存未加载的极端时序，行为与旧版一致，仅作安全网）。
     * CR-003：回退路径先 resolve 再校验落在 projects 目录内——projectId 由路由传入
     * （canvas POST / assets / active-skills），可为 `../x` 等穿越片段；不校验的话
     * `writeFileAtomic` 会按需建父目录，把 canvas.json / skills.json 写到 projects 之外。
     */
    dirOf(projectId: string): string;
    /** The absolute path of one project's directory. */
    projectDir(projectId: string): string;
    /** The absolute path of one project's asset directory. */
    assetsDir(projectId: string): string;
    /** The absolute path of one project's canvas document. */
    canvasFile(projectId: string): string;
    /** The absolute path of one project's active-skill roster (CV-066). */
    activeSkillsFile(projectId: string): string;
    /**
     * 目标目录名与现有项目 dir 冲突（sanitize 碰撞）时追加 -2/-3…；999 个仍冲突
     * （理论不可达）则以短 id 兜底，保证目录唯一且可读。
     */
    private uniqueDirName;
    /**
     * Read a project's canvas document (nodes + persisted viewport). Returns an
     * empty node list and no view when the document is missing or corrupt (the
     * canvas is disposable UI state, never fatal).
     * @param projectId - target project id.
     */
    readCanvas(projectId: string): Promise<StudioCanvasDocument>;
    /**
     * 原子写一份 canvas 文档（追加/合并路径共用；host 与 client 都经此落盘）。
     * @param projectId - target project id.
     * @param document - 完整文档（version + nodes [+ view]）。
     */
    private writeCanvasDocument;
    /**
     * Persist a project's canvas nodes (and viewport when provided) atomically
     * (a crash never leaves a half-written canvas document behind).
     * @param projectId - target project id.
     * @param nodes - the full node list for the project.
     * @param view - the client viewport/panel state; omitted by Host-authored
     *   writes, which preserve the previously saved view untouched.
     */
    writeCanvas(projectId: string, nodes: readonly StudioCanvasNode[], view?: StudioCanvasView): Promise<void>;
    /**
     * CV-066：读某项目已装载的 skill 清单（skills.json）。缺失/损坏按空列表
     * 处理 —— 装载状态是展示层的软状态，从不致命。
     * @param projectId - target project id.
     */
    readActiveSkills(projectId: string): Promise<string[]>;
    /**
     * CV-066：持久化某项目已装载的 skill 清单（skills.json，原子写）。
     * @param projectId - target project id.
     * @param skills - the full active-skill roster (deduped by the caller).
     */
    writeActiveSkills(projectId: string, skills: readonly string[]): Promise<void>;
    /**
     * Append one generated-media node to a project's canvas document. The Host
     * writes this the moment an asset lands on disk, so the canvas reflects a
     * successful generation deterministically (the client reloads the document
     * on `tool/result`), independent of how the conversation event renders the
     * tool result text.
     * @param projectId - target project id.
     * @param node - the node to append (id must be unique within the project).
     */
    appendCanvasNode(projectId: string, node: StudioCanvasNode): Promise<void>;
    /**
     * List all registered projects in creation order.
     * @returns the durable project records.
     * @throws when the registry document exists but is unreadable or corrupt.
     */
    list(): Promise<readonly StudioProject[]>;
    /**
     * Create a project: mint its directory (with `assets/`), append the record
     * to the registry, and persist the registry atomically.
     * @param name - display name (trimmed and validated).
     * @param groupId - CV-091：归属分组 id；`null`/省略 = 未分组。
     * @returns the created project record.
     */
    create(name: string, groupId?: string | null): Promise<StudioProject>;
    /**
     * Delete a project: remove its on-disk directory (registry, assets, canvas)
     * and drop the record. Refuses when the resolved directory is not safely
     * nested under the projects directory.
     * @param projectId - target project id.
     */
    removeProject(projectId: string): Promise<void>;
    /**
     * Read one project record (with its P7 workflow defaulted when absent).
     * @returns the record, or null when the id is unknown.
     */
    getProject(projectId: string): Promise<StudioProject | null>;
    private readGroups;
    private writeGroups;
    /** CV-091：列出全部分组（按 order 升序）。 */
    listGroups(): Promise<readonly StudioProjectGroup[]>;
    /** CV-091：新建分组，返回记录（order 取当前最大 +1）。 */
    createGroup(name: string): Promise<StudioProjectGroup>;
    /** CV-091：重命名分组。 */
    renameGroup(groupId: string, name: string): Promise<StudioProjectGroup>;
    /** CV-091：删除分组；组内项目回落未分组（groupId 置 null）。 */
    deleteGroup(groupId: string): Promise<void>;
    /** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
    moveProjectToGroup(projectId: string, groupId: string | null): Promise<void>;
    /**
     * Patch a project's P7 workflow (mode / gate state) and persist the
     * registry atomically. Returns the updated record.
     */
    updateWorkflow(projectId: string, patch: Partial<StudioWorkflow>): Promise<StudioProject>;
    /**
     * 写入 / 清除项目的待回答问题（ask_user_choice 工具与 answer 动作使用）。
     */
    setPendingQuestion(projectId: string, question: StudioPendingQuestion | null): Promise<void>;
    /**
     * 记录用户对当前问题的选择（画布点选卡片 → workflow 路由调用）。
     * ask_user_choice 工具轮询读到后负责清空。
     */
    answerPendingQuestion(projectId: string, value: string): Promise<void>;
    private readRegistry;
    private writeRegistry;
}
