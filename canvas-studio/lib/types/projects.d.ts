import type { StudioPendingQuestion, StudioProject, StudioWorkflow } from './contracts/project.js';
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
     */
    constructor(root?: string | (() => string));
    /** Resolved registry root (current value of the provider, if any). */
    private get root();
    /** Resolved projects directory under the current root. */
    private get projectsDir();
    /** Resolved registry file under the current root. */
    private get file();
    /**
     * 解析项目的磁盘目录：优先取 registry 记录里的 `dir` 字段（新建项目 = 用户名的
     * sanitize 目录；历史项目 = 旧 UUID 目录，随记录保留）；未命中回退 `projects/<id>`
     * （缓存未加载的极端时序，行为与旧版一致，仅作安全网）。
     */
    dirOf(projectId: string): string;
    /** The absolute path of one project's directory. */
    projectDir(projectId: string): string;
    /** The absolute path of one project's asset directory. */
    assetsDir(projectId: string): string;
    /** The absolute path of one project's canvas document. */
    canvasFile(projectId: string): string;
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
     * Persist a project's canvas nodes (and viewport when provided) atomically
     * (a crash never leaves a half-written canvas document behind).
     * @param projectId - target project id.
     * @param nodes - the full node list for the project.
     * @param view - the client viewport/panel state; omitted by Host-authored
     *   writes, which preserve the previously saved view untouched.
     */
    writeCanvas(projectId: string, nodes: readonly StudioCanvasNode[], view?: StudioCanvasView): Promise<void>;
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
     * @returns the created project record.
     */
    create(name: string): Promise<StudioProject>;
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
