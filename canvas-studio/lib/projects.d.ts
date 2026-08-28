import type { StudioPendingQuestion, StudioProject, StudioWorkflow } from './contracts/project.js';
import type { StudioCanvasDocument, StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js';
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
    /** The absolute path of one project's directory. */
    projectDir(projectId: string): string;
    /** The absolute path of one project's asset directory. */
    assetsDir(projectId: string): string;
    /** The absolute path of one project's canvas document. */
    canvasFile(projectId: string): string;
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
