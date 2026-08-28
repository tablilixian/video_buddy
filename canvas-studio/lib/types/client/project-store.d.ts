/**
 * Project + canvas store: the registry snapshot, the current selection
 * (single + multi), per-project canvas node lists, snapshot history
 * (undo/redo), and the clipboard.
 *
 * Reads happen through the framework-bound `useStore`; writes go through the
 * declared actions only (async fetching lives in the apply-world inject
 * callbacks, which commit through these actions). The canvas node list is the
 * full P4+ model: every captured generation result (image/video) or manual
 * annotation (sticky/text/prompt/group) is a node, and bloodline edges are
 * derived from each node's `sourceIds` at render time (plan §7.3).
 *
 * History semantics follow the reference canvas store (snapshot the pre-mutation
 * list, cap 20): atomic actions snapshot first, while drags call `pushHistory`
 * explicitly at drag start (moveNode itself never snapshots — it fires every
 * pointer-move frame). Transient generation state (isLoading/progress/error)
 * lives on client-minted pending nodes and is stripped on reload.
 */
import { type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';
import type { StudioCanvasNode, StudioCanvasView, StudioVideoStylePayload } from '../contracts/canvas.js';
import { BRIEF_NODE_TOOL } from '../contracts/canvas.js';
import type { StudioCaptureAsset } from '../asset-capture.js';
import type { StudioProject, StudioWorkflow } from '../contracts/project.js';
/**
 * CV-023 创意节点的 toolName 标记：用户首条真人消息自动落的「创意」文本节点。
 * 幂等去重与画布识别都靠它（每项目至多一个）；常量本体在共享契约
 * （contracts/canvas.ts），Host 侧分镜/文案连边共用。
 */
export { BRIEF_NODE_TOOL };
/** Mint a node id in the browser (secure context over loopback). */
export declare function newNodeId(): string;
/**
 * 客户端瞬态节点判定：生成中的占位（isLoading / `pending-*` id）以及没有产物
 * URL 的 agent 媒体节点。它们只应存在于内存 —— 持久化前必须剔除，载入时也要
 * 丢弃（否则一次生成中途的保存就会让画布永久残留「黑块」节点）。
 */
export declare function isTransientNode(node: StudioCanvasNode): boolean;
/**
 * 节点字段补丁：与 Partial 不同，允许显式传 undefined 来清除可选字段
 * （exactOptionalPropertyTypes 下 `Partial<T>` 不接受 undefined 值）。
 */
export type NodePatch = {
    [K in keyof StudioCanvasNode]?: StudioCanvasNode[K] | undefined;
};
/** One undo/redo history entry: a full node-list snapshot of one project. */
export interface HistoryEntry {
    projectId: string;
    nodes: readonly StudioCanvasNode[];
}
/** Per-project viewport entry: the view plus whether it came from disk. */
export interface ProjectViewEntry {
    view: StudioCanvasView;
    /** False when no persisted view existed (client should fit content once). */
    saved: boolean;
}
/** Project-list + canvas store state. */
export interface ProjectStoreState {
    projects: readonly StudioProject[];
    selectedProjectId: string | null;
    selectedNodeId: string | null;
    /** Multi-select roster (contains selectedNodeId when non-null). */
    selectedNodeIds: string[];
    phase: 'idle' | 'loading' | 'error';
    error: string | null;
    creating: boolean;
    /** 每个项目的画布节点（按生成时间追加）。 */
    nodes: Readonly<Record<string, readonly StudioCanvasNode[]>>;
    /** 每个项目的视口/面板状态（缩放、平移、图层与小地图开关）。 */
    views: Readonly<Record<string, ProjectViewEntry>>;
    /** P7：每个项目的创作工作流（模式 + 审批门禁状态）。 */
    workflows: Readonly<Record<string, StudioWorkflow>>;
    /** Undo/redo snapshot history (global, entries carry their project). */
    history: HistoryEntry[];
    historyIndex: number;
    /** Client-side clipboard (copy/paste). */
    clipboard: StudioCanvasNode[];
}
/** Annotation twin of the actions literal below. */
export type ProjectStoreActions = {
    setPhase: (draft: ProjectStoreState, phase: ProjectStoreState['phase']) => void;
    setLoaded: (draft: ProjectStoreState, projects: readonly StudioProject[]) => void;
    setFailed: (draft: ProjectStoreState, error: string) => void;
    select: (draft: ProjectStoreState, projectId: string | null) => void;
    setCreating: (draft: ProjectStoreState, creating: boolean) => void;
    /** 打开项目时载入持久化节点（剥离瞬态状态）。 */
    setNodes: (draft: ProjectStoreState, projectId: string, nodes: readonly StudioCanvasNode[]) => void;
    /**
     * 载入 / 更新某项目的视口与面板状态（增量合并）。`saved` 标记该视图是否
     * 来自磁盘（未保存过时客户端应先适配内容一次）。
     */
    setView: (draft: ProjectStoreState, projectId: string, patch: Partial<StudioCanvasView>, saved?: boolean) => void;
    /** P7：写入某项目的工作流状态（打开项目 / 审批动作后调用）。 */
    setWorkflow: (draft: ProjectStoreState, projectId: string, workflow: StudioWorkflow) => void;
    /** 捕获一条 agent 资产 → 自动布局 + 血缘链接后写入节点列表。 */
    addAsset: (draft: ProjectStoreState, projectId: string, asset: StudioCaptureAsset) => void;
    /** 选中节点（ctrl/cmd 追加多选；null 清空）。 */
    selectNode: (draft: ProjectStoreState, id: string | null, multi?: boolean) => void;
    /** 全选当前项目节点。 */
    selectAllNodes: (draft: ProjectStoreState) => void;
    /** 移动节点（拖拽逐帧调用；不写历史）。group 节点联动子图层。 */
    moveNode: (draft: ProjectStoreState, projectId: string, id: string, x: number, y: number) => void;
    /** 增量更新节点字段（拖拽 resize 逐帧；不写历史）。补丁可传 undefined 清除字段。 */
    updateNode: (draft: ProjectStoreState, projectId: string, id: string, updates: NodePatch) => void;
    /** 删除节点并清理指向它的血缘（写历史）。 */
    removeNodes: (draft: ProjectStoreState, projectId: string, ids: string[]) => void;
    /** 快照当前项目节点列表进历史（拖拽/缩放开始时调用）。 */
    pushHistory: (draft: ProjectStoreState, projectId: string) => void;
    undo: (draft: ProjectStoreState) => void;
    redo: (draft: ProjectStoreState) => void;
    /** 复制选中节点到剪贴板。 */
    copySelected: (draft: ProjectStoreState, projectId: string) => void;
    /** 粘贴剪贴板节点（偏移 +20，新 id，写历史）。 */
    pasteNodes: (draft: ProjectStoreState, projectId: string) => void;
    /** z 序操作（zIndex 字段语义，写历史）。 */
    reorderNode: (draft: ProjectStoreState, projectId: string, id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void;
    toggleLock: (draft: ProjectStoreState, projectId: string, id: string) => void;
    setVisibility: (draft: ProjectStoreState, projectId: string, id: string, visible: boolean) => void;
    setOpacity: (draft: ProjectStoreState, projectId: string, id: string, opacity: number) => void;
    renameNode: (draft: ProjectStoreState, projectId: string, id: string, title: string) => void;
    /** 手动连线：给目标节点追加 sourceIds（写历史）。 */
    linkLayers: (draft: ProjectStoreState, projectId: string, sourceIds: string[], targetId: string) => void;
    /** 编组：创建 group 节点包裹选中节点（写历史）。 */
    groupSelected: (draft: ProjectStoreState, projectId: string) => void;
    /** 解组：移除 group 节点并释放子节点 parentId（写历史）。 */
    ungroup: (draft: ProjectStoreState, projectId: string, groupId: string) => void;
    /** 一键整理布局：无重叠网格 + 组随行（写历史）。适配视野由调用方负责。 */
    autoArrange: (draft: ProjectStoreState, projectId: string) => void;
    /** 生成中的占位节点（client 侧瞬态）。 */
    setPendingNode: (draft: ProjectStoreState, projectId: string, node: StudioCanvasNode) => void;
    /** 手动新增一个便签/文本/提示节点（写历史）。 */
    addNode: (draft: ProjectStoreState, projectId: string, kind: 'sticky' | 'text' | 'prompt') => void;
    /** CV-023：用户首条创意落画布（幂等：已有 BRIEF_NODE_TOOL 节点或画布未载入时跳过）。 */
    addBriefNode: (draft: ProjectStoreState, projectId: string, text: string) => void;
    /** P8.1：把本地上传的图片作为参考素材节点落到画布（manual origin，带 url/filename）。 */
    addImportNode: (draft: ProjectStoreState, projectId: string, url: string, title?: string, filename?: string, referenceRole?: StudioCanvasNode['referenceRole'], isReference?: boolean) => void;
    /**
     * P8.4：参考视频抽帧结果落画布（一次历史快照）：每个抽帧一张 image 参考节点
     * （role=style，带 Drama filename），外加一张风格归纳 sticky 节点（sourceIds
     * 指向全部帧，形成血缘边）。选中 sticky 便于用户立刻看到归纳文本。
     */
    addVideoStyleNodes: (draft: ProjectStoreState, projectId: string, payload: StudioVideoStylePayload & {
        name: string;
    }) => void;
    /** P9.3：成片合成结果回写画布（video-composite 终节点，manual origin，血缘指向全部源 clip）。 */
    addComposedVideo: (draft: ProjectStoreState, projectId: string, asset: {
        /** 可选预生成 id（合成后自动聚焦用，缺省则内部生成）。 */
        id?: string;
        url: string;
        title: string;
        duration?: number;
        /** 成片真实分辨率（探测所得），落 mediaWidth/mediaHeight。 */
        mediaWidth?: number;
        mediaHeight?: number;
        /** 成片文案（广告词/对白/字幕等），来自「文案」节点。 */
        script?: string;
        sourceIds: string[];
    }) => void;
    /** 移除 runId 匹配的占位节点（重载/完成时）。 */
    removePendingByRunId: (draft: ProjectStoreState, projectId: string, runId: string) => void;
    /** 占位节点标记失败（tool/result 的 data.error）。 */
    markPendingError: (draft: ProjectStoreState, projectId: string, runId: string, error: string) => void;
    /** 清空某项目的画布（清掉内存态；持久化由调用方负责）。 */
    clearProject: (draft: ProjectStoreState, projectId: string) => void;
};
/** 取某项目的全部节点（未绑定或空时返回空数组）。 */
export declare function nodesOf(state: ProjectStoreState, projectId: string | null): readonly StudioCanvasNode[];
/** 取某项目的视口条目（缺失时回退默认值，`saved: false`）。 */
export declare function viewOf(state: ProjectStoreState, projectId: string | null): ProjectViewEntry;
/** 取某项目最新的画布节点（用于回看 / 默认聚焦）；缺失时返回 null。 */
export declare function lastNodeOf(state: ProjectStoreState, projectId: string | null): StudioCanvasNode | null;
/** 取当前选中的节点。 */
export declare function selectedNodeOf(state: ProjectStoreState): StudioCanvasNode | null;
/** 取当前多选节点列表（按 zIndex+createdAt 排序）。 */
export declare function selectedNodesOf(state: ProjectStoreState): StudioCanvasNode[];
/** 渲染序：zIndex 升序，同层按 createdAt 稳定。 */
export declare function compareNodes(left: StudioCanvasNode, right: StudioCanvasNode): number;
/** 节点的直接子图层（parentId === id）。 */
export declare function childrenOf(nodes: readonly StudioCanvasNode[], id: string): StudioCanvasNode[];
/** 从节点列表里找 union 边界（空表返回 null）。 */
export declare function boundsOf(nodes: readonly StudioCanvasNode[]): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null;
/**
 * Create the project + canvas store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export declare function createProjectStore(): EngineStoreHandle<ProjectStoreState, ProjectStoreActions>;
