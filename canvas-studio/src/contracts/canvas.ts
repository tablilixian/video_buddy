/**
 * Shared canvas-node wire types for the Canvas Studio host persistence and the
 * browser client. Pure types only: both halves import them and erase them at
 * build time, so this file never appears in the runtime bundles.
 *
 * The shape mirrors the WL-AI-Director `LayerData` model (see plan §7.2 and
 * docs/plans/canvas-studio-reference-integration.md S1) extended with the
 * fields Canvas Studio renders: visual state (locked/visible/opacity/zIndex),
 * generation provenance (operationType/generationPrompt/duration), transient
 * generation state (isLoading/progress/error), and grouping (parentId).
 * Bloodline is derived from `sourceIds` at render time — there is no separate
 * edge table (plan §7.3: bloodline IS the edge).
 */

/** The kinds of node Canvas Studio can place on the canvas. */
export type StudioCanvasNodeKind = 'image' | 'video' | 'sticky' | 'text' | 'prompt' | 'group'

/**
 * What operation produced a node. Keeps the WL generic values (their edge
 * colors/labels live in CanvasEdges) plus Canvas Studio's own tool semantics;
 * `import`/`drawing` cover manual nodes.
 */
export type StudioCanvasOperationType =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'mkr-video'
  | 'style-transfer'
  | 'background-replace'
  | 'expand'
  | 'background-remove'
  | 'variant'
  | 'import'
  | 'drawing'
  | 'storyboard'
  | 'storyboard-split'
  | 'character-sheet'
  | 'scene-concept'
  | 'video-clip'
  | 'video-composite'

/** One canvas node (a generation result or a manual annotation). */
export interface StudioCanvasNode {
  /** Stable node id (Host/client-minted UUID). */
  id: string
  /** What the node represents. */
  kind: StudioCanvasNodeKind
  /** Media URL for image/video nodes (webServer-hosted asset URL). */
  url?: string
  /** Optional display title. */
  title?: string
  /** Body text for sticky/text/prompt nodes. */
  text?: string
  /** Canvas-space top-left position. */
  x: number
  y: number
  /** Rendered box size (canvas-space). */
  width: number
  height: number
  /** Creation timestamp (epoch millis). */
  createdAt: number
  /** Producing tool name (image_generate / video_generate / video_composite). */
  toolName?: string
  /** The `tool/call` event id that produced this node (retry anchor). */
  runId?: string
  /** Where the node came from: an agent tool call or a manual action. */
  origin: 'agent' | 'manual'
  /** Bloodline: ids of the nodes this node was derived from. */
  sourceIds: string[]
  /** The operation that produced this node (edge color/label source). */
  operationType?: StudioCanvasOperationType
  /**
   * The generation inputs that produced this node. For agent tools this is the
   * JSON-encoded parameter object, so a node-level retry can replay the exact
   * generation (reference §9.7 semantics; Host `generate.ts` retryOf).
   */
  generationPrompt?: string
  /** 256px LOD thumbnail URL (unused yet; kept for the reference model). */
  thumbnail?: string
  /** Video duration in seconds. */
  duration?: number
  /**
   * 媒体原始分辨率宽（像素）。区别于画布显示尺寸 `width/height`：导入节点的
   * 显示尺寸是默认 260×180，而真实媒体分辨率未知（落盘时不探测）；生成/合成
   * 节点把真实产物分辨率写入此字段，详情面板据此展示「分辨率」。
   */
  mediaWidth?: number
  /** 媒体原始分辨率高（像素）。 */
  mediaHeight?: number
  /**
   * 成片文案：广告词 / 对白 / 背景音乐 / 音效 / 字幕等结构化脚本文本（来自
   * `write_script` 工具或画布「文案」节点），随成片节点落盘，详情面板展示。
   */
  script?: string
  /** Group this node belongs to (group nodes reference children via parentId). */
  parentId?: string
  /** Locked nodes refuse drag/resize. */
  locked?: boolean
  /** Hidden nodes are skipped by rendering, drag, and edge derivation. */
  visible?: boolean
  /** Node opacity 0-1. */
  opacity?: number
  /** Z-order (render order; ties break by createdAt). */
  zIndex?: number
  /** Mirror horizontally (media content only). */
  flipX?: boolean
  /** Mirror vertically (media content only). */
  flipY?: boolean
  /** Transient: generation in flight (never persisted as true). */
  isLoading?: boolean
  /** Transient: generation progress 0-100 (indeterminate bar when absent). */
  progress?: number
  /** Transient: last failure message (never persisted). */
  error?: string
  /**
   * Drama Backend 文件名：可作为 image_generate / video_generate / style_transfer
   * 等工具的参考图句柄。上传图与经 upload_image 复用的产物携带；落盘即写入，
   * 使 list_references 能直接把 filename 交给 agent，免去运行时再上传。
   */
  filename?: string
  /** 是否为可复用参考图（参考托盘与 list_references 的来源）。 */
  isReference?: boolean
  /** 参考图角色：决定 agent 选用哪个生成工具与强度（Runway 式分类）。 */
  referenceRole?: 'image' | 'character' | 'style' | 'frame'
  /** 参考强度 0–1（对应 Runway 参考强度滑块；1=强保真）。 */
  referenceStrength?: number
  /**
   * 内容 SHA-256（hex，仅对话附件旁路落卡时写入）：同字节图片再次旁路时
   * 复用已有节点，避免「草稿还原后重发 / 双击」导致的重复上传与重复落卡。
   */
  contentHash?: string
}

/** Canvas persistence document written to `<project>/canvas.json`. */
export interface StudioCanvasDocument {
  /** Bump with a migration when the node shape changes. */
  version: number
  /** All nodes of the project (order is not significant; sort by createdAt). */
  nodes: StudioCanvasNode[]
  /**
   * Persisted viewport + panel state (v3). Absent in older documents; the
   * client falls back to defaults and fits the content instead.
   */
  view?: StudioCanvasView
}

/**
 * Per-project canvas viewport and panel toggles. `x`/`y` are the surface
 * translate (screen space), `scale` the zoom factor (clamped 0.1–5).
 */
export interface StudioCanvasView {
  x: number
  y: number
  scale: number
  layersOpen: boolean
  minimapVisible: boolean
  /**
   * P9.1 时间轴条目的有序节点 id 列表（拖拽排序结果，随视口一起持久化）。
   * 缺省/部分失效时客户端按 createdAt 派生补齐；成片导出取其中 kind=video
   * 的片段作为 clipIds。
   */
  timeline?: string[]
}

/** Current canvas document version (3: persisted viewport/panel state). */
export const CANVAS_DOCUMENT_VERSION = 3

/** Viewport defaults used when a document predates v3 or a field is invalid. */
export const VIEW_DEFAULTS: StudioCanvasView = {
  x: 0,
  y: 0,
  scale: 1,
  // 验收反馈（2026-08-24）：面板默认收起，画布默认最大化内容区。
  layersOpen: false,
  minimapVisible: false,
}

/** Defaults applied when migrating nodes that predate a field. */
export const NODE_DEFAULTS: Readonly<{
  locked: boolean
  visible: boolean
  opacity: number
  flipX: boolean
  flipY: boolean
}> = {
  locked: false,
  visible: true,
  opacity: 1,
  flipX: false,
  flipY: false,
}

/**
 * CV-023/025：用户首条创意节点的 toolName 标记。客户端（幂等去重）与 Host
 * （分镜/文案节点自动挂接创意血缘、落位）共用同一常量。
 */
export const BRIEF_NODE_TOOL = 'user_brief'

/** P8.4 参考视频抽帧的单帧产物（Host → 客户端落画布节点）。 */
export interface StudioVideoFramePayload {
  /** 帧图同源 URL（Host 已写入项目 assets）。 */
  url: string
  /** Drama Backend 文件名（可直接作生成工具的 filename 输入）。 */
  filename: string
  /** 采样时间点（秒）。 */
  time: number
}

/** P8.4 参考视频抽帧提风格的完整结果（upload-video 路由响应）。 */
export interface StudioVideoStylePayload {
  /** 视频本体落盘后的同源 URL（留档）。 */
  videoUrl: string
  /** 探测到的视频时长（秒）。 */
  duration: number
  frames: StudioVideoFramePayload[]
  /** 风格归纳文本（风格归纳 sticky 节点正文）。 */
  summary: string
}
