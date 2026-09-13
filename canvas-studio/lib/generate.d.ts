import type { ProjectRegistry } from './projects.js';
import type { StudioAsset, StudioCanvasNode, StudioCanvasOperationType } from './contracts/canvas.js';
import { INSTRUMENTAL_LYRICS } from './contracts/canvas.js';
import type { StudioRuntimeConfig } from './host-tools.js';
import type { VideoProviderId } from './providers/types.js';
export declare function setRuntimeConfig(cfg: StudioRuntimeConfig): void;
/** 一次生成的请求参数（来自客户端工具）。 */
export interface GenerateParams {
    prompt: string;
    aspectRatio?: string;
    /**
     * 服务器文件名**句柄**（`ref-xxxxxxxx.png`），image_generate 图生图 / video_generate /
     * image2vl 用。CV-155：这里必须是上传句柄，**后端产物名（`img_*` / `z-image_*`）
     * 会被后端拒**（约 0.1s 内笼统 500）——画布节点上的产物名请用 `@ref[节点标题]` 引用，
     * Host 会自动换成句柄。
     */
    filename?: string;
    /** 已上传的 Drama Backend 文件名数组（video_composite 用）。 */
    filenames?: string[];
    negativePrompt?: string;
    /** 画风模式：realistic（默认，写实）= txt2image/image2image；anime（卡通/日式动漫）= txt2imageanime（仅纯文生图，传参考图则回退写实图生图）。 */
    style?: 'realistic' | 'anime';
    /** 【占坑·待接入】视频模型选择：h3（默认，当前后端统一走 FL2VA 即 H3 技术路线）/ seedance2（未接入，传入会被忽略并返回提示）。 */
    model?: 'h3' | 'seedance2';
    /** 【占坑·待接入】分辨率指定（768p/1080p/720p/2k）：后端暂不支持，传入会被忽略（以 aspectRatio + 后端默认分辨率输出）。 */
    resolution?: '768p' | '1080p' | '720p' | '2k';
    /**
     * H3 原生音轨（对应官方 / 上游 skill 的 `generate_audio`）。**缺省不发送**：
     * 仅显式传值时才进请求体——`true` = 请求随画同步的原生音轨，`false` = 要求静音。
     * Drama 后端尚未开放该字段，被拒时由视频自愈摘掉并回 warning（不静默丢弃）。
     */
    generateAudio?: boolean;
    /**
     * 参考音频（H3 官方「audio reference / audio reuse」通道）：已上传的 Drama
     * 文件名**有序**数组，顺序即 `<Audio N>` 的引用序，不得重排、不得去重。
     *
     * 官方规格见 `audio-reference.ts`（≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、
     * ≤15MB/段，且**必须与图或视频同行**）——超限在**发出去之前**就拦下，
     * 不浪费一次调用。
     */
    audioRefs?: string[];
    /**
     * 视频供应商选择（阶段 3）。留空 → 走设置项 `defaultVideoProvider`（默认 drama）。
     * 该字段随 generationPrompt 自动持久化并在重试时回传，故节点重试不会串台
     * （原片由哪家生成，重试仍走哪家）。非法值由 routes 与 generateAsset 双重校验拒绝。
     */
    provider?: VideoProviderId;
    duration?: number;
    /**
     * 衔接语义（C3，video 节点）：chain=与上一镜同场景连续（末帧作下镜首帧）/
     * cut=跨时空硬切 / bridge=同场景大跨度（首尾帧书挡）。只作落盘标注，
     * 不改变生成本身的行为（链帧由 agent 先调 extract_last_frame 再传首帧）。
     */
    shotTransition?: 'chain' | 'cut' | 'bridge';
    /**
     * 节点级重试锚点：设置时把结果写回该已有节点（保留 id/位置/血缘），
     * 而不是追加新节点 —— 重试不产生新边（plan §7.8 标准 2）。
     */
    retryOf?: string;
    /**
     * CV-108 显式取代：本次生成的结果取代哪个已有视频节点（填节点 id，
     * 由 `list_shots` 获取）。用于「改了关键帧重新出这一镜」——输入指纹与旧版
     * 不同、无法自动判重，但语义上是同一镜位的新版本。旧版会被标记失效，
     * 不再进默认合成。
     */
    replaces?: string;
    /**
     * 输入参考图对应的画布产物 URL（工具结果里的 url 字段）。落盘时按 URL
     * 反查画布节点并写入 sourceIds —— 血缘边（流程箭头）的唯一来源；缺省
     * 时新节点没有边（历史行为）。
     */
    sourceUrls?: string[];
    /**
     * CV-027：已解析的分镜卡节点 id（工具层由 shotRefs 解析而来），并入血缘
     * 与落位锚点——关键帧/视频排在其所属分镜卡的右侧。
     */
    shotNodeIds?: string[];
}
/** 一次生成的产物描述（返回给模型）。 */
export interface GenerateResult {
    url: string;
    width: number;
    height: number;
    duration?: number;
    /**
     * CV-155：Drama Backend 的**产物名**（不是可复用的上传句柄）。
     * 形如 `img_01287_.png` / `z-image_00852_.png`，只在产物下载通道有效；作带文件
     * 端点的入参会 500。**要链式引用请引用画布节点**（`@ref[节点标题]`），Host 会把
     * 产物名换成可用句柄（见 `isDramaProductName` / `healReferenceFilename`）。
     */
    filename?: string;
    /** 占坑参数提示（如 model=seedance2 / resolution / generateAudio 暂未接入时给出），渲染时追加到返回文本。 */
    warnings?: string[];
    /** CV-108：本次产物落到的画布节点 id（供 clipIds / replaces 精确引用）。 */
    nodeId?: string;
    /** CV-108：本次产出取代掉的旧节点 id（新版本作废旧版时非空）。 */
    superseded?: string[];
}
/** 钳制视频时长：1–maxVideoSeconds() 取整；未提供时用各工具的默认值。maxVideoSeconds 来自设置。 */
export declare function clampDuration(value: number | undefined, fallback: number): number;
/**
 * Drama Backend 调用超时（毫秒）：视频生成最慢，文本类最快。**各档的真正上限**。
 *
 * 注意：本表只有在传输层允许时才生效——Node 内置 fetch（undici）默认
 * `headersTimeout = bodyTimeout = 300s` 且**先于 AbortSignal** 触发（CV-133）。
 * 因此 `dramaPost` 按请求注入 `longRequestDispatcher()`，把传输层上限抬到
 * `LONG_REQUEST_TIMEOUT_MS`(900s)，本表各档才真正可达。
 * 不变量：**本表所有取值必须严格小于 LONG_REQUEST_TIMEOUT_MS**（有单测断言）。
 */
export declare const DRAMA_TIMEOUT_MS: {
    image: number;
    video: number;
    text: number;
};
/** 清空探针缓存（测试钩子；生产代码不需要主动失效）。 */
export declare function resetDramaProbeCache(): void;
/**
 * 确认 Drama Backend 可达：GET /api/v1/health（5s 超时），成功与失败都缓存
 * 30s —— 缓存窗口内的后续请求零开销快速通过/快速失败。
 */
export declare function ensureDramaReachable(signal?: AbortSignal): Promise<void>;
/**
 * 将相对 URL 解析为 loopback 绝对 URL（Host 端 fetch 用）。
 * 浏览器端 <img src> 能自动解析同源相对路径，但 Node 原生 fetch 不支持，
 * 而 image_generate 返回的产物 URL 是相对路径（/canvas-studio/assets/...），
 * 后续 video_generate / video_composite 作为参考图传入时必须先补全。
 */
declare function resolveImageUrl(url: string, port: number): string;
/** 上传一张图（本地路径 / canvas 资产 URL / 托管 URL）到 Drama Backend，返回服务器 filename。 */
declare function uploadImage(sourceUrl: string, signal?: AbortSignal, port?: number, registry?: ProjectRegistry): Promise<string>;
/**
 * 把文件字节上传到 Drama Backend（统一上传端点 `POST /api/v1/generate/upload`），
 * 返回服务器 filename —— 这是**所有以文件名为入参的接口**（image2image / image2vl /
 * fl2va / ref2va 的 image1..9 · video1..3 · audio1..3 …）的标准前置步骤（CV-137）。
 *
 * 端点演进：旧的 `/api/v1/generate/uploadimage` 已从后端路由表移除（2026-09-10 实测
 * 任何请求均 404，openapi.json 亦无此路径）；新端点不限文件类型，图片 / 视频 / 音频
 * 共用，响应结构与旧端点一致（ComfyUI 原生 `{name, subfolder, type}`）。
 *
 * P8.1 本地图片与 P8.4 视频抽帧共用；表单文件名沿用唯一安全名约定
 * （只含 [A-Za-z0-9._-]），避免触发后端去重后缀破坏下游。
 */
export declare function uploadBytesToDrama(bytes: Uint8Array, ext: string, signal?: AbortSignal): Promise<string>;
/**
 * 从同源资产 url 解析出 `<projectId>/<assetFile>` 键（null = 非画布资产 url）。
 * 文件段收紧到与 promoteAssetFile 相同的白名单字符集（拒绝路径穿越/编码字符），
 * 纯函数，供惰性 promote（@ref 兜底）与单测使用。
 */
export declare function assetKeyFromUrl(url: string): string | null;
/**
 * 把已落盘的项目资产（assets/<assetFile>）上传到 Drama 拿服务器 filename。
 * 只做网络上传（读盘 + uploadBytesToDrama），不写画布——回写由调用方负责
 * （host-tools 惰性兜底 / 客户端后台回填各有自己的持久化时序）。
 */
export declare function promoteAssetFile(registry: ProjectRegistry, projectId: string, assetFile: string, signal?: AbortSignal): Promise<string>;
/**
 * CV-155：参考名自愈 —— 把「按 filename 反查画布节点 → 从本地资产重传 → 回写节点
 * filename → 返回新句柄」这条确定性修复路径抽成**单一实现**。
 *
 * 为什么需要：`ref-*` 句柄是后端 `temp/` 里的临时文件，后端重启清存储后「名字还在、
 * 文件没了」；更常见的是**产物名**（`img_*` / `z-image_*`）根本不能被带文件端点消费
 * （见 `isDramaProductName`）——两种情形后端都只报笼统的 500。而本地资产还在盘上，
 * 重传一次即可修复，不必依赖模型自觉。
 *
 * 覆盖范围：`runGeneration` 自有一套（要处理多个 filename + sourceUrls 兜底），
 * 这里覆盖它之外的带图入口 —— `analyzeImage`（`image2vl` / `qc_shot` 共用）与
 * `generateCharacterSheet`。**analyzeImage 此前直连 callDramaRaw、没有任何自愈**，
 * 而 `qc_shot` 的输入恒为「刚生成的产物名」→ 该工具在当前实现下结构性 0 成功。
 *
 * 返回新 filename；反查不中 / 节点没有本地资产 / 上传失败一律返回 **null**，
 * 由调用方保留并抛出**原始错误**（不掩盖真因）。
 *
 * 匹配不限于 `filename` 字段：也认节点的本地资产文件名（`url` 末段）—— 实测
 * Agent 会把画布上的资产文件名当 filename 传进来（`bb465e619602.png` 一类）。
 */
export declare function healReferenceFilename(registry: ProjectRegistry, projectId: string, filename: string, signal?: AbortSignal): Promise<string | null>;
/**
 * P8.1：把本地图片（base64）落地到项目 assets 目录，并返回可直接供生成工具
 * 使用的两个引用：
 * - `url`：同源相对路径（/canvas-studio/assets/<projectId>/<file>），画布素材节点直接用；
 * - `filename`：经统一上传端点（`DRAMA_ENDPOINTS.upload`）拿到的服务器文件名，供 image_generate /
 *   video_generate / video_composite 的 filename(s) 参数使用。
 */
export declare function uploadLocalImage(registry: ProjectRegistry, projectId: string, name: string, dataBase64: string, signal?: AbortSignal): Promise<{
    url: string;
    filename: string;
}>;
/**
 * 2026-09-05 体验优化（两段式上传）：只做「base64 校验 + 项目 assets 落盘」，
 * 不上传 Drama。供对话附件旁路的快速段使用——发送只等本地写盘（毫秒级），
 * Drama 上传由后台 promote / 生成时惰性兜底接力。
 */
export declare function saveLocalImage(registry: ProjectRegistry, projectId: string, name: string, dataBase64: string): Promise<{
    url: string;
    assetFile: string;
}>;
/**
 * CV-155：判断文件名是否是 Drama 后端的**产物名**（生成结果的服务器文件名）。
 *
 * 后端有两类文件名，**可消费性完全不同**：
 * - `ref-<uuid8>.<ext>`：**上传句柄**，落在后端 `temp/`，可作带文件端点的入参；
 * - `img_01287_.png` / `z-image_00852_.png`：**产物名**，只在产物下载通道有效，
 *   拿去当 `image` / `filename(s)` 入参会**约 0.1 秒内 500**（后端把「文件不存在」
 *   与「服务端错误」统一报成笼统的 `Internal Server Error`，看不出真因）。
 *
 * 判据取产物名共有的「计数器段」形态（ComfyUI 工作流 `prefix_%0Nd_` 约定）：
 * 要求「下划线 + 4 位以上数字」，`ref-<8hex>` 这类句柄天然不含该形态，不会误伤。
 * 有意取窄：漏判由 `healReferenceFilename` 的失败自愈兜底，误判的代价只是多一次
 * 上传 —— 两个方向都安全，所以不需要穷举后端所有可能的前缀。
 *
 * 纯函数，供落盘前的主动换名与单测使用。
 */
export declare function isDramaProductName(filename: string): boolean;
/** 生成工具名 → 画布操作类型（边颜色/标签的语义来源）。 */
export declare function operationTypeOf(tool: string, params: GenerateParams): StudioCanvasOperationType;
/** 把生成参数序列化为 generationPrompt（节点重试时原样重放；retryOf 不入档）。 */
export declare function generationPromptOf(params: GenerateParams): string;
/** CV-080：提示词摘要（节点标题用）——压平空白后取前 max 字（默认 12）。 */
export declare function promptSummary(prompt: string, max?: number): string;
export interface MediaNodeTitleInput {
    isVideo: boolean;
    /** 血缘里分镜卡节点（toolName=submit_storyboard_for_approval）的标题集合。 */
    shotTitles: readonly string[];
    /** 生成提示词原文（params.prompt）。 */
    prompt: string;
}
/**
 * CV-080：生成节点标题（图层列表 / 节点头部显示，替代泛化的「图片 / 视频」）。
 * 规则：① 血缘含分镜卡时按镜号命名「分镜 N · 关键帧/视频」；② 否则用提示词
 * 摘要（前 12 字）；③ 两者皆缺返回 undefined，节点保持无 title（渲染层回退
 * 现有泛化标签，行为不变）。纯函数，单测直连。
 */
export declare function mediaNodeTitle(input: MediaNodeTitleInput): string | undefined;
/**
 * CV-079：把新生成的关键帧/视频并入其分镜卡的「素材组」（自动编组）。
 * - 组不存在：新建 kind=group 节点（sourceIds 记住分镜卡 id，后续同镜产物
 *   据此找到组并入），组标题「分镜 N · 素材」；新节点 parentId 指向组。
 * - 组已存在：新节点并入，组框扩到新成员包围盒。
 * 纯函数：返回完整的新节点数组（其余节点原样 + 新节点 + 组），调用方整体
 * 写盘（writeCanvas 替代 appendCanvasNode）。
 */
export declare function attachShotGroup(nodes: readonly StudioCanvasNode[], shotCard: StudioCanvasNode, newNode: StudioCanvasNode): StudioCanvasNode[];
/**
 * 按画布产物 URL 反查节点 id（血缘 sourceIds 的来源）。URL 兼容两种形态：
 * 工具结果里的同源相对路径（/canvas-studio/assets/...）与早期版本写死的
 * http://127.0.0.1:<port> 绝对路径 —— 都归一化到相对路径后精确匹配。
 */
export declare function resolveSourceIds(nodes: readonly StudioCanvasNode[], urls: readonly string[] | undefined): string[];
/**
 * 按 Drama filename 反查画布节点 id（血缘自动补全）。生成参数里的
 * filename/filenames 都是素材节点落盘时写入的 Drama 文件名，
 * 据此可以确定性地还原「这次生成参考了哪些节点」——不依赖模型自觉填写
 * sourceUrls。与 URL 反查结果取并集后作为节点血缘。
 */
export declare function resolveSourceIdsByFilename(nodes: readonly StudioCanvasNode[], filenames: readonly (string | undefined)[]): string[];
/** 合并两种血缘来源（URL 反查 + filename 反查），去重保序。 */
export declare function mergeSourceIds(primary: readonly string[], secondary: readonly string[]): string[];
/**
 * CV-031：从已解析的来源节点继承分镜卡血缘。视频经关键帧生成时
 * （video_generate / video_composite），模型常漏传 shotRefs，导致视频只连
 * 关键帧、不连分镜卡。只要关键帧节点已连着所属分镜卡
 * （toolName=submit_storyboard_for_approval），就把该卡并入新节点父集合 ——
 * 「分镜 → 关键帧 → 视频」叙事链不因模型漏参断链。只上溯一层且只认分镜卡，
 * 不扩散到创意等其它上游。
 */
export declare function inheritShotCardIds(nodes: readonly StudioCanvasNode[], sourceIds: readonly string[]): string[];
/** 真实分辨率 → 画布显示框：统一走 src/canvas-aspect.ts 的 frameSizeOf
 *  （画面 + 镜头条 chrome）。 */
/**
 * CV-024 落点策略：新节点排在其血缘来源节点的右侧一列（y 取来源最小 y），
 * 形成「创意 → 素材 → 生成物」的左到右流向；与现有节点重叠时逐步右移避让
 * （有界 50 步）。无来源时回退到与客户端一致的网格空位。
 * 必须在写入前用「当前画布节点」调用；多个子节点的调用方需在返回值基础上
 * 自行做行内偏移。
 */
export declare function deriveNodePlacement(nodes: readonly StudioCanvasNode[], sourceIds: readonly string[], width: number, height: number): {
    x: number;
    y: number;
};
/** 提示词增强：调用 Drama Backend 的 image2promptenhance 接口。 */
export declare function enhancePrompt(prompt: string, signal?: AbortSignal): Promise<string>;
/**
 * CV-155：带图端点的自愈上下文。由 Host 调用点提供（它本来就有 registry 与
 * projectId），不传即关闭自愈 —— 行为与修复前完全一致，纯逻辑层不必依赖注册表。
 */
export interface AnalyzeHealContext {
    registry: ProjectRegistry;
    projectId: string;
}
/** 图像分析（VLM）：调用 Drama Backend 的 image2vl 接口，使用已上传的文件名。 */
export declare function analyzeImage(filename: string, prompt: string, systemPrompt: string, signal?: AbortSignal, heal?: AnalyzeHealContext): Promise<string>;
/**
 * 执行一次生成并落盘。
 * @param registry - 项目注册表（提供 assetsDir）。
 * @param tool - 生成工具名（image_generate / character_generate / video_generate / video_composite）。
 * @param projectId - 目标项目 id。
 * @param params - 生成参数。
 * @param signal - 取消信号。
 */
export declare function generateAsset(registry: ProjectRegistry, tool: string, projectId: string, params: GenerateParams, signal?: AbortSignal): Promise<GenerateResult>;
export { uploadImage, resolveImageUrl };
/**
 * C1：基于角色设计图/定妆照生成四视图立绘（白底：正面特写/侧面全身/背面全身，
 * Drama `image2character` qwen_4view_char_2step 工作流），并建立项目级
 * 一致性资产卡（StudioAsset）。CV-122：锚点 = 四视图拼图整图（上游官方
 * reference-sheet 用法——拼图自带角色/视角标签，下游直接整图作参考），
 * 不再切分：2026-09-11 收敛时 `image2splitegrid` 端点与 storyboard_split 工具
 * 已一并删除，由此砍掉整类切分 500 故障与逐片下载/上传开销。
 */
export interface CharacterSheetParams {
    /** 角色设计图/定妆照在 Drama Backend 的服务器文件名（来自 upload_image）。 */
    filename: string;
    /** 资产卡显示名（如「女主」）。 */
    assetName: string;
    /** 冻结的 SAME 块文本：外貌/发型/服装/配色/光感固定描述。 */
    lockedPrompt: string;
    /** 负面约束（如「不更换服装」），可选。 */
    negativePrompt?: string;
    /** 设计图的画布产物 URL（反查节点、画血缘箭头），可选。 */
    sourceUrls?: string[];
}
export interface CharacterSheetResult {
    /** 四视图拼图的同源 URL（画布节点已落盘，即资产卡唯一锚点）。 */
    url: string;
    /** 建立/更新的资产卡 id。 */
    assetId: string;
    /** 资产卡显示名。 */
    name: string;
    /** 四视图拼图的 Drama 文件名（可直接用于 image_generate / video_composite 的 filenames）。 */
    filename: string;
}
/**
 * C2：资产卡槽位解析——**同名即覆盖**（复用原 id），不同名才新建。
 * 冻结的 lockedPrompt 写错时，重调 character_sheet 传同名即可整体更新，
 * 不会在注册表里堆积同角色的多张卡。
 * @param assets - 项目现有资产卡。
 * @param name - 本次资产卡显示名。
 * @param mint - 新建时生成 id 的回调（测试可注入确定性 id）。
 */
export declare function resolveAssetSlot(assets: readonly StudioAsset[] | undefined, name: string, mint: () => string): {
    id: string;
    replacing: boolean;
};
export declare function generateCharacterSheet(registry: ProjectRegistry, projectId: string, params: CharacterSheetParams, signal?: AbortSignal): Promise<CharacterSheetResult>;
/**
 * Look 卡名前缀：与角色卡/场景卡共用一份 `assets` 注册表且「同名即整体覆盖」，
 * 撞名会静默换掉另一张卡（角色卡被 Look tokens 覆盖 = 全片角色描述错乱）。
 */
export declare const LOOK_CARD_PREFIX = "Look \u00B7 ";
/** 归一 Look 卡名（幂等）：缺前缀则补上，已带前缀原样返回。 */
export declare function normalizeLookCardName(name: string): string;
export interface LookCardParams {
    /** 卡片显示名（可带或不带 `Look · ` 前缀，落卡前统一归一）。 */
    name: string;
    /** 5 项 tokens 文本（`色彩：…` 等 5 行）。 */
    lockedPrompt: string;
    /** 锚点画布节点 id（Host 侧已解析：`@ref` / 节点 id / 文件名 → 节点）。 */
    anchorNodeId?: string;
    /** 锚点解析失败时原样带下来，用于给一条可操作提示（不阻断落卡）。 */
    anchorRef?: string;
    negativePrompt?: string;
}
/**
 * 锚点摘要（与 `list_references` 的 assets[].anchors 同形）。
 *
 * 用 type alias 而非 interface：interface 不获得**隐式索引签名**，会被工具 output
 * schema 的 `JsonValue` 约束拒收（`anchors: JsonValue[]`），type alias 可以。
 */
export type LookCardAnchor = {
    title: string;
    url: string;
    filename: string | null;
};
export interface LookCardResult {
    assetId: string;
    name: string;
    lockedPrompt: string;
    anchors: LookCardAnchor[];
    /** 非致命提示（tokens 不全 / 锚点没对应上画布节点）。 */
    warnings?: string[];
}
/**
 * 建立/覆盖一张 Look 卡（纯注册表操作，**不调用任何后端生成**）。
 *
 * 与 `generateCharacterSheet` 的关键差异：角色卡的四视图拼图是**本工具当场生成**的，
 * 所以锚点是一个新节点；Look 卡的样张在澄清 ②-2 阶段已由 `image_generate` 落到画布上，
 * 因此这里是**复用既有节点作锚点**（不重下载、不新建节点）。
 *
 * tokens 处理取「能完全理解才改写」：5 项齐全 → 归一成权威行序（逐镜注入是逐字节复用，
 * 行序/标点漂移会让卡与 prompt 对不上）；缺项 → 原样保留 + 告警，不去改写看不懂的输入。
 */
export declare function registerLookCard(registry: ProjectRegistry, projectId: string, params: LookCardParams): Promise<LookCardResult>;
/**
 * CV-125：文本生成音乐（Drama `txt2audio`，ACE Step Audio 工作流）。
 * 返回 mp3 产物：下载落盘 + 落画布节点（kind=video 复用 BGM 既有消费路径——
 * HTML video 元素可直接播放 mp3，compose_video 的 bgmNodeId 混音走 ffmpeg amix
 * 对音频容器同样适用）。节点可直接作 compose_video 的 bgmNodeId。
 */
/**
 * 纯器乐的 lyrics 占位值（本体已移到共享契约 `contracts/canvas.ts`，因为客户端
 * 渲染音频卡片时也要用它区分「纯器乐」与「真歌词」）。此处转出保持既有导入面
 * 不变（`lib/generate.js` 的 INSTRUMENTAL_LYRICS 仍可用）。
 */
export { INSTRUMENTAL_LYRICS };
/** 音乐默认时长（秒），与 music_generation 工具描述声明的缺省一致。 */
export declare const DEFAULT_MUSIC_DURATION = 30;
/** 音乐默认速度，与工具描述声明的缺省一致。 */
export declare const DEFAULT_MUSIC_BPM = 128;
/**
 * CV-127b：决定音乐生成失败后的下一次尝试怎么发。
 *
 * 实测 `txt2audio` 有两种 500（同为 500、都不给原因）：
 *  - **快失败**（~0.07s）：请求没进队列，参数大概率不被接受 → 重试同参数没意义，
 *    摘掉一个非核心字段再试。
 *  - **慢失败**（≈正常生成耗时，如 8.6s）：生成过程中崩，**纯偶发**——同参数
 *    重跑一次大概率成功（实测同参数 `E minor` 一次 200 一次 500）→ 原样重试。
 *    但已重试过一次还失败就别再傻等了，改为摘字段。
 *
 * 纯函数便于单测各种失败组合；返回 null 表示放弃。
 *
 * @param body 上一次尝试的请求体
 * @param attempt 已完成的尝试次数（1 = 首次失败）
 * @param elapsedMs 上一次尝试的耗时
 */
export declare function planMusicRetry(body: Record<string, unknown>, attempt: number, elapsedMs: number): Record<string, unknown> | null;
export interface MusicParams {
    /** 音频整体描述（tags：情绪/风格/乐器/节奏）。 */
    captionPrompt: string;
    /** 歌词提示词（有歌声时给歌词结构，纯器乐留空）。 */
    lyricsPrompt?: string;
    /** 音频时长（秒），默认 30。 */
    duration?: number;
    /** 每分钟节拍数，默认 128。 */
    bpm?: number;
    /** 调式（root + quality，如「Bb major」「A minor」）。 */
    keyscale?: string;
    /** 语言代码（如 zh / en；unknown=纯器乐无人声）。 */
    language?: string;
    /** 拍号：2 / 3 / 4 / 6。 */
    timesignature?: string;
    /** 关联的画布产物 URL（画血缘箭头），可选。 */
    sourceUrls?: string[];
}
export interface MusicResult {
    /** 音频的同源 URL（画布节点已落盘）。 */
    url: string;
    /** Drama 侧文件名（mp3）。 */
    filename: string;
    /** 画布节点 id（可直接作 compose_video 的 bgmNodeId）。 */
    nodeId: string;
    /**
     * CV-140：**真实**音频时长（秒，落盘后 ffprobe 实测；探测失败回退请求值）。
     * 这是成片时长守卫的判据来源，也是画布角标/时间线显示的值。
     * ⚠️ 响应里的 `duration` 字段是**生成耗时**（30s 音频返回 8.56），不是音频
     * 时长 —— 本字段与它无关，勿改用响应值。请求值见 `declaredDuration`。
     */
    duration: number;
    /** CV-140：下当时的请求时长（秒）。真实值与它可能差几十毫秒（实测 30→30.024）。 */
    declaredDuration: number;
    /** CV-127：实际使用的 bpm（未显式传时为缺省 128）。供分镜按拍拆镜参考。 */
    bpm: number;
    /**
     * CV-130：实际提交给后端的歌词（纯器乐为 `[Instrumental]`）。已随画布节点
     * 落盘，这里回显供模型知道自己「唱的是什么」，避免复述用户输入时不一致。
     */
    lyrics: string;
    /**
     * CV-127b：本次生成**实际被忽略**的参数名（后端不接受，已自动降级摘除）。
     * 空数组 = 请求的参数全部生效。⚠️ 非空时必须让模型知道——否则它会以为
     * 自己拿到了指定调性/拍号的曲子（「智能体错觉」的主要来源）。
     */
    degradedFields: string[];
    /** CV-127b：实际尝试次数（>1 表示首次失败后重试成功）。 */
    attempts: number;
}
export declare function generateMusic(registry: ProjectRegistry, projectId: string, params: MusicParams, signal?: AbortSignal): Promise<MusicResult>;
