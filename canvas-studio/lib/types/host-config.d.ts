import z from '@deepseek-ai/schemastery';
/** 设置命名空间（与客户端卡片、Host 注册三处共用同一字符串）。 */
export declare const CANVAS_STUDIO_NS: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Drama Backend API 基址默认值（WL 自架后端）。 */
export declare const DEFAULT_DRAMA_API_BASE = "http://117.50.108.73:8082";
/** Drama Backend API Key 的默认凭据引用（值不落明文，经 credentials 解析）。 */
export declare const DEFAULT_DRAMA_API_KEY_REF = "CANVAS_STUDIO_DRAMA_API_KEY";
/** Canvas Studio 设置分区解析后的运行时值类型。 */
export interface CanvasStudioConfig {
    /** Drama Backend API 基址。 */
    dramaApiBase: string;
    /** Drama Backend API Key 的凭据引用（credential-ref，不落明文）。 */
    dramaApiKey: string;
    /** 单段视频时长上限（秒，1–15）。 */
    maxVideoSeconds: number;
}
/** Canvas Studio 设置 schema（注册进 settings 服务，作为组装 base 层）。 */
export declare const CanvasStudioConfig: z<CanvasStudioConfig>;
