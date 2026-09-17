import type { StudioPendingQuestion, StudioProject, StudioProjectGroup, StudioProjectPlan, StudioWorkflow, StudioWorkflowMode } from './contracts/project.js';
import type { StudioAsset, StudioCanvasDocument, StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js';
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
    writeCanvas(projectId: string, nodes: readonly StudioCanvasNode[], view?: StudioCanvasView, assets?: StudioAsset[]): Promise<void>;
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
     * 新增或更新一条一致性资产卡（C1，character_sheet 工具使用）。按 id 合并：
     * 已存在同名 id 则整体替换，否则追加到注册表末尾。
     * @param projectId - target project id.
     * @param asset - the asset card to upsert.
     */
    upsertAsset(projectId: string, asset: StudioAsset): Promise<void>;
    /**
     * 摘除失效的资产卡归属（C2，同名卡覆盖时用）：把 `assetId` 指向该卡、但已不
     * 在新锚点清单里的节点的 `assetId` 清空，避免旧分图继续冒充当前资产的锚点。
     * @param projectId - target project id.
     * @param assetId - the asset card whose anchors were replaced.
     * @param keepNodeIds - node ids that remain anchors of the card.
     */
    releaseAssetNodes(projectId: string, assetId: string, keepNodeIds: readonly string[]): Promise<void>;
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
     * @param plan - CV-099：产出规格（画幅 / 目标总时长）；非法值经 `normalizePlan`
     *   降级，整体非法时按「未锁定」处理（不写该字段）。
     * @param mode - CV-196：创建时锁定的执行模式。**显式传入优先于设置页默认**
     *   —— 新建弹窗上选的那一枚是具体决定，设置页那项是「没别的指示时的默认」。
     *   省略 = 没指定，仍走 `defaultWorkflowMode()`（老调用点行为不变）。
     * @returns the created project record.
     */
    create(name: string, groupId?: string | null, plan?: StudioProjectPlan, mode?: StudioWorkflowMode): Promise<StudioProject>;
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
    /**
     * 读注册表文档（项目记录 + 墓碑）。文件不存在返回 `null`；存在但损坏/形状不符
     * 则抛错 —— **不静默当空表**：那会让紧随其后的写盘把整个注册表抹掉。
     */
    private readDocument;
    /** 仅取项目记录（`list()` 用的投影）。 */
    private readRegistry;
    /** 原子写注册表（低层出口，调用方一律走 `commitRegistry`）。 */
    private writeRegistry;
    /**
     * CV-046：写注册表 —— **先与磁盘合流，再落盘**。
     *
     * ## 为什么必须合流
     *
     * 本实例的 `cached` 是「上次读盘那一刻的世界」。注册表落在 `$DSH_HOME/canvas-studio/`
     * （home 根下、**跨 profile 共享**），用户完全可能把插件装进两个共享同一 DSH home
     * 的实例（已有 web 端 server + 本项目桌面壳）。此时后写方会拿自己的内存副本**整表
     * 覆盖** `projects.json` —— 先写方新建的项目记录从注册表消失（目录还在磁盘上，
     * 表现为「项目丢了」）。原子写只保证文件不损坏，防不了两份内存态互相覆盖。
     *
     * 合流规则：磁盘记录 ∪ 内存记录（同 id 以内存为准，内存里没有的磁盘记录**保留**），
     * 再减去墓碑里的 id。于是：
     * - 别人新建的 → 留住（本实例下一次 `list()` 也能看见）；
     * - 本实例改的 → 覆盖（内存态就是最新真相）；
     * - 本实例删的 → `removed` 落进墓碑，别的实例再写也不会把它复活。
     *
     * 读不出磁盘时退化为「照写内存态」（旧行为）。正常路径到不了这里——本类的每个
     * 公开写方法都先走 `list()` 读盘，注册表损坏会在那一步就报错（宁可拒绝写入，也
     * 不把用户还能手工修复的坏文件改写成空表）。这一支只作纵深防御。
     *
     * @param memory - 本实例认为的最新记录表。
     * @param removed - 本次调用**显式删除**的 id（写进墓碑）。
     */
    private commitRegistry;
}
/**
 * CV-128：把 CV-125 时代以 `kind='video'` 落盘的音频节点归位成 `kind='audio'`。
 *
 * 背景：BGM 起初复用视频节点的消费路径（kind=video + operationType
 * 'text-to-audio'），但这会让 mp3 被「取所有 kind=video 节点」的分镜逻辑
 * （defaultComposeClips / list_shots / 时间线）当成一镜。纯函数便于单测，
 * 对其它节点原样返回。
 */
export declare function migrateAudioNode(node: StudioCanvasNode): StudioCanvasNode;
