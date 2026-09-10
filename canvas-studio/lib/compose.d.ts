import type { ProjectRegistry } from './projects.js';
import type { StudioAudioComposition, StudioCanvasNode } from './contracts/canvas.js';
/**
 * CV-138：BGM 时长守卫的容差（秒）。差额不超过它视为「等长」（探测本身有毫秒级
 * 抖动，不值得为此报错）。
 */
export declare const BGM_SHORTFALL_TOLERANCE_SEC = 0.05;
/** 成片合成结果（返回给客户端落画布节点）。 */
export interface ComposeResult {
    /** 同源资产 URL（webServer 托管）。 */
    url: string;
    /** 合成后成片时长（秒；探测失败为 0）。 */
    duration: number;
    /** 合成后成片分辨率宽（像素；探测失败为 undefined）。 */
    width?: number;
    /** 合成后成片分辨率高（像素；探测失败为 undefined）。 */
    height?: number;
    /**
     * CV-143：成片音轨构成。让验收一眼看出环境声有没有被丢掉、BGM 有没有混进去。
     */
    audioComposition: StudioAudioComposition;
    /**
     * CV-138 / CV-141：需要让用户与 agent 知道的降级说明（探测失败回退、
     * 多镜无 BGM 导致成片无声等）。空数组不写入结果。
     */
    warnings?: string[];
}
/** 合成可选覆盖项（测试注入 / 高级用法）。 */
export interface ComposeOptions {
    /** 显式指定 ffmpeg 可执行文件路径。 */
    ffmpegPath?: string;
    /** 统一转码目标帧率（默认 25）。 */
    fps?: number;
    /** 覆盖输出文件名（默认 export-<uuid>.mp4）。 */
    outputName?: string;
    /**
     * 统一调色预设（ffmpeg 滤镜串，如 `eq=contrast=1.02:saturation=1.02`）。
     * - 缺省：应用中性默认预设（DEFAULT_COLOR_GRADE），治各镜色调漂移；
     * - `false`：关闭调色 pass（片段已色调一致时可用）；
     * - 字符串：覆盖默认预设。
     */
    colorGrade?: string | false;
}
/** 单个分镜片段的输入描述（用于转码阶段）。 */
export interface ComposeClip {
    id: string;
    /** 同源资产 URL（/canvas-studio/assets/<projectId>/<file>）。 */
    url: string;
    /** 本地绝对文件路径。 */
    inputPath: string;
    /** 该片段是否含音轨（决定转码编码参数）。 */
    hasAudio: boolean;
    /** CV-142：下当时的**请求**时长（秒），用于与成片真值对照出时长漂移。 */
    declaredDuration?: number;
}
/**
 * 将画布节点同源 URL 反查为本地资产文件绝对路径。
 * URL 形如 `/canvas-studio/assets/<projectId>/<file>`，资产目录由 registry
 * 提供；返回 `join(assetsDir, file)`。
 */
export declare function urlToAssetPath(assetsDir: string, url: string): string;
/**
 * 从画布节点收集合成所需的视频 clip（纯函数）。
 * - 仅接受 kind=video 的节点；
 * - clipIds 中缺失/非视频/重复 id 一律跳过；
 * - 返回命中的节点与缺失的 id 列表（缺失由调用方面向用户报「片段文件不存在」）。
 */
export declare function collectClips(nodes: readonly StudioCanvasNode[], clipIds: readonly string[]): {
    clips: StudioCanvasNode[];
    missingIds: string[];
};
/** 构造 concat demuxer 清单内容（纯函数）：每行 `file '<绝对路径>'`。 */
export declare function buildConcatList(paths: readonly string[]): string;
/** 统一转码参数（纯函数）。无音轨加 `-an`，有音轨重新编码为 aac。
 * `colorGrade` 非空时在 vf 末尾追加统一调色滤镜（治各镜色调漂移）。 */
export declare function buildTranscodeArgs(input: string, output: string, width: number, height: number, fps: number, hasAudio: boolean, colorGrade?: string): string[];
/** concat 拼接参数（纯函数）。 */
export declare function buildConcatArgs(concatListPath: string, output: string): string[];
/**
 * 构造 BGM 淡入淡出滤镜串（纯函数）。时长不足一个淡入周期时只做淡入。
 * 返回空串表示不做任何淡化（如时长未知）。
 *
 * ⚠️ CV-138：传入的**不是 BGM 自身时长，而是淡化锚点**（= `fadeAnchorOf(bgm, 成片)`）。
 * 此前直接按 BGM 时长算淡出起点，BGM 长于成片时淡出区间整个落在片外——成片结尾
 * 变成硬切，而「BGM 比成片长」恰恰是最可能的默认路径。
 */
export declare function buildBgmFade(duration: number): string;
/**
 * CV-138：淡出锚点——取 BGM 与成片真值中的较小者（这就是「听着该收尾」的时刻）。
 * 两者都未知（≤0 / 非有限）时返回 0，`buildBgmFade` 会据此不加任何淡化。
 */
export declare function fadeAnchorOf(bgmDuration: number, filmDuration: number): number;
/**
 * CV-138：BGM 时长守卫（纯函数）。BGM 短于成片时返回中文报错文案，够长或无法
 * 判定（任一时长未知）时返回 `null`。
 *
 * 为什么报错而不是自动循环/拉伸：拉伸会变调，循环会在非节拍点接缝——两者都是
 * 「听得出错」的降级。报错让人重新生成一段够长的，比悄悄出错好。
 */
export declare function bgmShortfallMessage(bgmDuration: number, filmDuration: number): string | null;
/**
 * BGM 混音参数（纯函数）。
 *
 * - `hasConcatAudio = true`（**单镜整出**，保留着原生环境声）：与 BGM 做
 *   `amix=inputs=2:duration=first:normalize=0`——线性求和（CV-141：默认
 *   `normalize=1` 会把每一路各乘 0.5，两条声音一起被压暗），BGM 走
 *   `BGM_MIX_VOLUME` 只作铺底，环境声留在前景。
 * - `hasConcatAudio = false`（**多镜拼接**，原生音轨已丢）：直接把 BGM 作为
 *   成片音轨，走 `BGM_VOLUME`（该分支无 amix、无归一化，无需补偿）。
 *
 * 两种情形 BGM 都过 `buildBgmFade` 淡入淡出（C5：BGM 单轨贯穿 + 头尾不突兀），
 * 锚点取 `fadeAnchorOf(bgm, film)`（CV-138）。输出时长用 `-t <成片真值>` 而不是
 * `-shortest`——后者在单轨分支会按 BGM 长度把画面裁掉（6s 画面 + 2s BGM →
 * 2.000s，`exit=0` 且一句报错都没有）；真值不可得时退回 `-shortest`。
 */
export declare function buildAmixArgs(concatOutput: string, bgmInput: string, output: string, hasConcatAudio: boolean, bgmDuration?: number, filmDuration?: number): string[];
/**
 * CV-142：时长漂移告警阈值（秒，约 6 帧 @24fps）。
 *
 * 取值理由：单镜的帧量化偏差在 0.167s 量级（请求 5s → 5.167s），不值得每次都打扰；
 * 而多镜累计会线性放大（3 镜 → 0.5s），那正是「BGM 按声明值生成就会短」的分野，
 * 必须报出来。0.25s 正好把两者分开。
 */
export declare const TIMELINE_DRIFT_TOLERANCE_SEC = 0.25;
/** CV-142：结构化时间轴校验的输入。 */
export interface TimelineAuditInput {
    /** 分镜卡声明时长之和（秒；无分镜卡或未解析出数字时为 0）。 */
    storyboardDeclared: number;
    /** 本次实际纳入片段的**请求**时长之和（秒）。 */
    clipDeclared: number;
    /** 成片真值（秒；探测失败为 0）。 */
    filmDuration: number;
    /** 项目目标总时长（秒，可选；项目创建时锁定）。 */
    targetDuration?: number;
}
/**
 * CV-142：结构化时间轴校验（纯函数）——把「分镜表声明 / 实际生成请求 / 成片真值 /
 * 目标总时长」四个数互相对照，返回需要提醒的漂移说明（空数组 = 对齐）。
 *
 * 为什么值得做：**时长漂移此前从不显形**。分镜表写「5s」，agent 可能传
 * `duration=8`；请求 5s 经 H3 按帧率量化又变成 5.167s。用户直到听见音乐与画面对
 * 不上才知道出事。这里让它在合成那一刻就变成一句可读的提示。
 *
 * 三组对照按「危害从近到远」排列：
 * 1. **请求 vs 成片真值**——帧量化漂移，直接决定「BGM 该生成多长」（最近）；
 * 2. **分镜声明 vs 实际请求**——agent 没照分镜表传参（工程层面的不一致）；
 * 3. **成片真值 vs 项目目标总时长**——整体偏离立项规格。
 */
export declare function auditTimeline(input: TimelineAuditInput): string[];
/**
 * 执行成片合成全流程（Host 侧）：
 * 1) 读取画布节点，收集 clip 并反查本地文件，缺失报「片段文件不存在」；
 * 2) 探测首个 clip 的分辨率（后续片段统一到此尺寸），无分辨率则报错；
 * 3) 逐段统一转码（25fps / yuv420p；**CV-141：仅单镜整出保留音轨**，多镜一律
 *    `-an` 丢弃原生环境声，有音轨时转 aac）；
 * 4) concat demuxer 拼接，并探测产物真值（时长 + 是否有音轨）；
 * 5) 可选 BGM：**CV-138 先做时长守卫**（BGM 短于成片即报错、不落半成品），
 *    再按有无 concat 音轨走「叠混（normalize=0）」或「BGM 单轨」，输出时长锚定
 *    成片真值（`-t`）；
 * 6) 落 `export-<uuid>.mp4` 于 assets 根目录，返回同源 URL + 成片时长 +
 *    音轨构成（CV-143）。
 *
 * 整体受 120s 超时与调用方 `signal` 双重约束，超时/中断即抛中文错误。
 */
export declare function composeStudioVideo(registry: ProjectRegistry, projectId: string, clipIds: readonly string[], bgmNodeId?: string, options?: ComposeOptions, signal?: AbortSignal): Promise<ComposeResult>;
/** Host 侧把成片结果落为画布 video-composite 节点（供模型工具 compose_video 直接回写）。 */
export interface ComposedNodeInput {
    url: string;
    duration?: number;
    width?: number;
    height?: number;
    /** 源片段节点 id（血缘边指向它们）。 */
    sourceIds: string[];
    /** 成片文案（广告词/对白/字幕等），来自 write_script 节点。 */
    script?: string;
    /** CV-143：成片音轨构成（角标展示）。 */
    audioComposition?: StudioAudioComposition;
}
/**
 * 把合成结果写为画布节点（video-composite，origin=agent，血缘指向源片段），
 * 返回新建节点。位置沿用 4 列网格；真实分辨率写入 mediaWidth/mediaHeight，
 * 文案写入 `script`，使详情面板可展示。客户端工具/结果重载后即出现在画布。
 * 节点框按真实分辨率等比换算（竖屏成片不再被 260×180 横屏占位框 cover 裁切）。
 */
export declare function appendComposedVideoNode(registry: ProjectRegistry, projectId: string, input: ComposedNodeInput): Promise<StudioCanvasNode>;
