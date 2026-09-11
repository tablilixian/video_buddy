import type { ProjectRegistry } from './projects.js';
import type { StudioCanvasNode } from './contracts/canvas.js';
import type { StudioAudioComposition } from './contracts/canvas.js';
import type { VideoProviderId } from './providers/types.js';
import { type MusicResult } from './generate.js';
/** 产物结果 schema（工具返回给模型的结构）。 */
declare const resultSchema: {
    type: "object";
    additionalProperties: boolean;
    properties: {
        url: {
            type: "string";
            description: string;
        };
        width: {
            type: "integer";
            description: string;
        };
        height: {
            type: "integer";
            description: string;
        };
        duration: {
            type: "number";
            description: string;
        };
        filename: {
            type: "string";
            description: string;
        };
        warnings: {
            type: "array";
            items: {
                type: "string";
            };
            description: string;
        };
        nodeId: {
            type: "string";
            description: string;
        };
        superseded: {
            type: "array";
            items: {
                type: "string";
            };
            description: string;
        };
        clipCount: {
            type: "integer";
            description: string;
        };
        skippedCount: {
            type: "integer";
            description: string;
        };
        audioComposition: {
            type: "string";
            enum: readonly ["native", "native+bgm", "bgm", "none"];
            description: string;
        };
    };
};
/**
 * `music_generation` 的 output schema。
 *
 * CV-146：此前它是内联在工具定义里的，且漏了 `declaredDuration` 等 CV-127b/140 新增字段
 * → 后端已生成音频（耗时 26–64s）却在返回给模型前被 schema 校验丢弃，4/4 全败。
 * 提升为具名常量是为了让下面的编译期覆盖守卫能引用它。
 */
declare const musicResultSchema: {
    type: "object";
    additionalProperties: boolean;
    properties: {
        url: {
            type: "string";
            description: string;
        };
        filename: {
            type: "string";
            description: string;
        };
        nodeId: {
            type: "string";
            description: string;
        };
        duration: {
            type: "number";
            description: string;
        };
        declaredDuration: {
            type: "number";
            description: string;
        };
        bpm: {
            type: "number";
            description: string;
        };
        lyrics: {
            type: "string";
            description: string;
        };
        degradedFields: {
            type: "array";
            description: string;
        };
        attempts: {
            type: "number";
            description: string;
        };
    };
};
/** `compose_video` 返回给模型的结构（由 `renderComposeResult` 消费）。 */
interface ComposeToolResult {
    url: string;
    width: number;
    height: number;
    duration: number;
    nodeId: string;
    clipCount: number;
    skippedCount: number;
    audioComposition: StudioAudioComposition;
    warnings?: string[];
}
/** 校验用：取 schema 已声明的属性名。 */
type SchemaPropsOf<S> = S extends {
    properties: infer P;
} ? keyof P : never;
/** 结果类型里有、而 schema 没声明的字段。 */
type MissingInSchema<S, R> = Exclude<keyof R, SchemaPropsOf<S>>;
/** `T` 必须是 `never` —— 否则此处编译失败，错误信息里就是漏掉的字段名。 */
type MustBeNever<T extends never> = T;
/**
 * CV-146 编译期守卫：`additionalProperties: false` 的 output schema **必须**声明结果类型的
 * 全部字段。漏一个，产物就会在返回给模型前被 schema 校验丢掉 —— 外部 API 的时间照花，
 * 用户什么都拿不到，是性价比最高的一类 bug。
 *
 * 结果类型新增字段而 schema 没跟上时，下面两行会让 `tsc` 直接失败，
 * 无需等到真机验收才发现。
 */
/**
 * CV-146 编译期守卫的载体类型（无运行时形态，无需被 import）。
 *
 * 结果类型新增字段而 schema 没跟上时，`MustBeNever` 的约束会让 `tsc` 在本行失败，
 * 错误信息里就是漏掉的字段名 —— 不必等到真机验收才发现产物被丢弃。
 * 导出只是为了让本文件顶层声明不触发 `noUnusedLocals`；约束检查与是否引用无关。
 */
export type MusicSchemaCoverage = MustBeNever<MissingInSchema<typeof musicResultSchema, MusicResult>>;
export type ComposeSchemaCoverage = MustBeNever<MissingInSchema<typeof resultSchema, ComposeToolResult>>;
/**
 * CR-001：compose_video 缺省选片——只取「逐镜视频片段」并按生成顺序排序，
 * 排除成片节点（toolName='compose'）。否则二次合成会把上一版成片当片段再拼
 * 一次，递归叠加。
 *
 * CV-108：再排除失效版本（被新版取代 / 已作废）——返工、重复生成的旧片段
 * 不再混入成片（此前一段镜头出 2~3 版时全部被拼进去）。
 * 纯函数便于单测；显式传 clipIds 时不经过此逻辑。
 */
export declare function defaultComposeClips(nodes: readonly StudioCanvasNode[]): string[];
/**
 * 解析分镜表 markdown 表格为逐镜单元格行。容错策略：
 * - 只认含 `|` 的行；行首尾 `|` 可省略；
 * - 丢弃分隔行（`---`）与表头行（首列为「镜号」）；少于 3 列的行丢弃；
 * - 解析不出任何数据行时返回空数组（调用方回退整表单节点落盘）。
 */
export declare function parseStoryboardShots(storyboard: string): string[][];
/** CV-142：H3 输出的声明帧率（实测 24fps）——把分镜表的秒值换算成帧数用。 */
export declare const DECLARED_FPS = 24;
/**
 * CV-142：从分镜表「时长」单元格解析秒数（纯函数）。解析不出返回 0。
 *
 * 容错写入形式：`5s` / `5 秒` / `约 5 秒` / `5.5s` / `00:05`（时间码按 mm:ss 或
 * mm:ss:ff）。取第一个数字；时间码优先判定，避免 `00:05` 被读成 0。
 */
export declare function parseShotDurationSeconds(text: string): number;
/** 把一行分镜单元格格式化为逐镜卡片正文（缺失列自动跳过）。 */
export declare function formatStoryboardShot(cells: string[]): {
    title: string;
    text: string;
};
/**
 * 创建 P3 媒体生成工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 *
 * 2026-09-11 收敛后的 20 个工具（另有 2 个占位工具见 `skills/placeholder-tools.ts`）：
 * image_generate（写实/卡通 style）、character_generate（角色立绘）、character_sheet（一致性资产卡）、
 * upload_image、list_references、list_shots、extract_last_frame、qc_shot、image2vl、prompt_enhance、
 * video_generate、video_composite、music_generation、compose_video、
 * write_screenplay、write_script、ask_user_choice，
 * 以及 P7 三个审批门禁 submit_screenplay_for_approval / submit_storyboard_for_approval /
 * submit_keyframes_for_approval。
 *
 * @param registry - 项目注册表。
 */
/** 运行时配置：Host 把 settings 解析后的 Drama 基址 / 时长 / 密钥解析器透传给生成闭包。 */
export interface StudioRuntimeConfig {
    /** 返回当前 Drama Backend API 基址。 */
    dramaApiBase: () => string;
    /** 返回当前单段视频时长上限（秒）。 */
    maxVideoSeconds: () => number;
    /** 解析 dramaApiKey 凭据引用为真实密钥（未配置时返回空串）。 */
    resolveDramaApiKey: () => Promise<string>;
    /** 解析 falApiKey 凭据引用为真实密钥（未配置时返回空串；空串由 fal adapter 报错）。 */
    resolveFalApiKey: () => Promise<string>;
    /** 默认视频供应商（设置项）。agent 未显式指定 provider 时走此项。 */
    defaultVideoProvider: () => VideoProviderId;
    /** 返回默认画幅比例（agent 未指定 aspectRatio 时兜底）。 */
    defaultAspectRatio: () => '16:9' | '9:16' | '1:1';
    /** 返回默认执行模式（confirm/auto）。 */
    workflowMode: () => 'confirm' | 'auto';
    /** 分镜 HITL 门禁开关。 */
    hitlStoryboard: () => boolean;
    /** 关键帧 HITL 门禁开关。 */
    hitlKeyframe: () => boolean;
    /** 生成失败自动重试开关。 */
    autoRetry: () => boolean;
    /** 最大并行生成数。 */
    maxParallel: () => number;
    /** 资产库位置（留空 = 项目默认）。 */
    assetDir: () => string;
    /** 画布自动保存开关。 */
    autoSave: () => boolean;
    /** 自动保存间隔（秒）。 */
    autoSaveInterval: () => number;
}
export declare function createStudioTools(registry: ProjectRegistry, port: number, cfg?: StudioRuntimeConfig): import("@deepseek-ai/dsh-tools").ToolDefinition[];
export {};
