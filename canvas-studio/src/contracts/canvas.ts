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

/**
 * The kinds of node Canvas Studio can place on the canvas.
 *
 * CV-128：`audio` 独立成类（此前 BGM 复用 `video`）。音频节点**不是分镜
 * 片段**——独立后天然被 collectClips / defaultComposeClips / list_shots
 * （均以 `kind === 'video'` 取镜）排除，不会 mp3 被当片段拼进成片。
 */
export type StudioCanvasNodeKind = 'image' | 'video' | 'audio' | 'sticky' | 'text' | 'prompt' | 'group'

/**
 * 音频节点默认尺寸（CV-128 / CV-130）。
 *
 * Host（`generate.ts` 落盘）与 client（`NODE_SIZE` / 占位节点尺寸表）共用同一
 * 常量——此前 `260×84` 是两边各自手写的，改一处忘一处就会让新落盘节点与
 * 用户拖拽过的旧节点对不齐。高度按「标题行 + 波形 + 播放条 + 歌词摘要行」
 * 四行内容定档（116 = 16 padding + 18+22+24+14 内容 + 20 间距）。
 */
export const AUDIO_NODE_WIDTH = 260
export const AUDIO_NODE_HEIGHT = 116

/**
 * 纯器乐的歌词占位值（CV-127 起）。官方要求纯器乐必须显式写 `[Instrumental]`
 * ——传空串虽能过校验但语义不明。
 *
 * 放在共享契约里（而非 Host 的 generate.ts）：UI 也要用它区分「纯器乐」与
 * 「真歌词」——节点 `lyrics` 等于该串时卡片显示「纯器乐」而不是这个方括号关键字。
 */
export const INSTRUMENTAL_LYRICS = '[Instrumental]'

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
  | 'text-to-audio'

/**
 * CV-143：成片音轨构成。由合成结果算出（依据「本次纳入几个片段」与「是否给了
 * BGM」），随成片节点落盘，客户端角标据此显示中文标签。
 *
 * - `native`     —— 单镜整出，保留各镜 H3 原生环境声（画面连续，环境声也连续）
 * - `native+bgm` —— 单镜整出 + BGM 叠混（`amix`）
 * - `bgm`        —— 多镜拼接，原生音轨全丢，成片只有 BGM
 * - `none`       —— 多镜拼接且未给 BGM，**成片无声**（合成时会明确告警）
 */
export type StudioAudioComposition = 'native' | 'native+bgm' | 'bgm' | 'none'

/**
 * CV-143：音轨构成的中文标签。放共享契约而非各端各写一份——Host 的工具结果
 * 文案与客户端角标必须说同一句话，否则用户看到的和模型读到的不一致。
 */
export const AUDIO_COMPOSITION_LABELS: Readonly<Record<StudioAudioComposition, string>> = {
  native: '环境声',
  'native+bgm': '环境声 + BGM',
  bgm: '纯 BGM',
  none: '无声',
}

/** CV-143：音轨构成的悬停解释（角标 title，说明「为什么是这个构成」）。 */
export const AUDIO_COMPOSITION_HINTS: Readonly<Record<StudioAudioComposition, string>> = {
  native: '单镜整出，保留该镜原生环境声',
  'native+bgm': '单镜整出，原生环境声与 BGM 叠混',
  bgm: '多镜拼接，各镜环境声已丢弃，成片只有 BGM',
  none: '多镜拼接且未提供 BGM，各镜环境声已丢弃 —— 成片无声',
}

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
  /**
   * 媒体时长（秒）。CV-140 起是**真实时长**——视频/音频产物落盘后由 ffprobe
   * 实测，不再存请求值。画布角标 / 时间线 / `list_shots` / 合成时长锚点全都
   * 读它，存请求值等于拿没校准的尺子量音画同步（实测请求 5s → 真实 5.167s，
   * 帧量化 124 帧 @24fps）。探测不可用（无 ffmpeg）时回退请求值。
   */
  duration?: number
  /**
   * CV-140：下当时的**请求**时长（秒）。真实值在 `duration`；两者不等即帧量化
   * 偏差显形。BGM 生成器用它对齐「成片需要多长」，agent 用它回溯「我原本要的是几秒」。
   */
  declaredDuration?: number
  /**
   * CV-142：`declaredDuration` 对应的帧数（24fps）。**帧才是硬单位**——H3 按帧
   * 率量化输出，秒值带小数尾数，比对时以帧为准更稳（`av-timeline-plan` §4.3）。
   */
  declaredFrames?: number
  /**
   * CV-143：成片音轨构成（仅 `toolName='compose'` 的节点写）。让验收一眼看出
   * 「各镜环境声有没有被丢掉 / BGM 有没有混进去」，不必回放听。
   */
  audioComposition?: StudioAudioComposition
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
  /**
   * CV-130：音频节点（kind='audio'）的歌词原文——即 music_generation 实际
   * 提交给后端的 `lyrics_prompt`。含 `[Verse]` / `[Chorus]` 等结构标记，
   * 纯器乐为 `[Instrumental]`（UI 渲染成「纯器乐」而不显示这个占位串）。
   *
   * 为什么要落盘：歌词是**作品的一部分**，此前只存在于当次请求体里，落盘即丢；
   * 用户事后看画布只剩一个「BGM.mp3」，既不知道唱的什么，也无法复用/改写。
   */
  lyrics?: string
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
   * Drama Backend 文件名：可作为 image_generate / video_generate / video_composite
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
  /**
   * 归属资产卡 id（C1）。character_sheet 切分产物与采纳该锚点的镜头节点
   * 携带；缺省即不属于任何资产卡。
   */
  assetId?: string
  /**
   * 手动作废（CV-108）：用户/agent 判定「这镜不要了」且无替代者。作废节点
   * 不参与默认合成，画布上灰显保留，可右键恢复。
   */
  retired?: boolean
  /**
   * 被哪个节点取代（CV-108）：非空即失效——同一镜位出了新版，旧版自动或显式
   * 让位。成片节点同理（重新合成后旧成片被新成片取代）。
   */
  supersededBy?: string
  /**
   * 取代了哪些节点（CV-108 反向索引）：便于回溯版本链与展示「本版取代了 v1」。
   */
  supersedes?: string[]
  /**
   * 镜位版本号（CV-108）：同一镜位首版为 1，每被取代一次新版 +1。
   * 用于画布角标「v2」与 `list_shots` 的版本展示。
   */
  shotVersion?: number
  /**
   * 镜头衔接语义（C3，kind=video 节点）：chain=与上一镜同场景连续（用上一镜
   * 真实末帧作首帧）；cut=跨时空硬切（不链帧）；bridge=同场景大跨度（首尾帧
   * 书挡）。缺省视为 cut。
   */
  shotTransition?: 'chain' | 'cut' | 'bridge'
  /**
   * 一致性质检结论（C4）。由 `qc_shot` 工具写入被检节点；`attempts` 累计该镜
   * 已质检次数（跨重跑继承同一分镜卡的历史），用于重跑预算硬计数。
   */
  qc?: StudioQcRecord
}

/**
 * 一致性质检记录（C4）：VLM 对照资产卡冻结描述判定单镜是否漂移。
 * verdict=warn 表示判定不明确（VLM 输出不可解析/自相矛盾），按方案 §7 风险 2
 * 降级为「提示用户人工确认」，不触发自动重跑。
 */
export interface StudioQcRecord {
  /** 判定结论：pass=一致 / fail=漂移 / warn=判定不明确需人工确认。 */
  verdict: 'pass' | 'fail' | 'warn'
  /** 漂移元素列表（如「发色偏棕」「风衣变成夹克」），pass 时为空。 */
  drifts: string[]
  /** 一句话判定理由。 */
  reason: string
  /** 该镜累计质检次数（含本次）。 */
  attempts: number
  /** 判定时间戳（epoch millis）。 */
  checkedAt: number
  /** 判定依据的期望描述（资产卡 lockedPrompt 或调用方传入），便于回溯。 */
  expect?: string
}

/**
 * 一致性资产卡（C1）：项目级的角色/场景/风格锚点注册表。
 * 锚点分图来自 character_sheet 工具（image2character 四视图 + splitegrid 切分）；
 * lockedPrompt 是冻结的 SAME 块文本，组装镜头 prompt 时逐字节复用。
 */
export interface StudioAsset {
  /** Stable asset id (UUID)。 */
  id: string
  /** Display name（如「女主」）。 */
  name: string
  /** 资产角色：决定注入强度与用途（Runway 式分类）。 */
  role: 'character' | 'scene' | 'style'
  /** 视觉锚点分图的画布节点 id 列表（正/侧/背/全身）。 */
  anchorNodeIds: string[]
  /** 冻结的 SAME 块文本：外貌/服装/光感固定描述，逐字节复用。 */
  lockedPrompt: string
  /** 负面约束（如「不更换服装」），注入 prompt 约束段。 */
  negativePrompt?: string
  /** Creation timestamp (epoch millis)。 */
  createdAt: number
}

/** Canvas persistence document written to `<project>/canvas.json`. */
export interface StudioCanvasDocument {
  /** Bump with a migration when the node shape changes. */
  version: number
  /** All nodes of the project (order is not significant; sort by createdAt). */
  nodes: StudioCanvasNode[]
  /**
   * 项目级一致性资产卡（v4）。Absent in older documents; the host and client
   * treat a missing/invalid value as an empty registry.
   */
  assets?: StudioAsset[]
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
  /**
   * CV-006：用户显式排除出合成的片段 id（时间轴勾选态，随视口一起持久化）。
   * 缺省 = 全部纳入（老项目零迁移）。作废片段不进这里——它们在勾选区直接
   * 禁用，有效性与排除是两个正交维度。
   */
  composeExcluded?: string[]
  /**
   * CV-006：用户选定的 BGM 节点 id（时间轴下拉，随视口一起持久化）。
   * 缺省/显式 undefined = 不使用。引用失效（节点删除/非音频/作废）时 UI 自动
   * 回退「不使用」（resolveComposeSelection 的 bgmInvalid 路径）。
   */
  composeBgmNodeId?: string | undefined
}

/** Current canvas document version (4: project-level consistency assets). */
export const CANVAS_DOCUMENT_VERSION = 4

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
