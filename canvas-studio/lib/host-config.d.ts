import z from '@deepseek-ai/schemastery';
import { type BrandPresetId } from './brand.js';
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
    /** 默认画幅比例（agent 未指定 aspectRatio 时生成兜底）。 */
    defaultAspectRatio: '16:9' | '9:16' | '1:1';
    /** 导出格式（当前仅 mp4，预留）。 */
    exportFormat: string;
    /** 导出目录（留空 = 项目默认目录，预留）。 */
    exportDir: string;
    /** 视频质量/码率档位（standard/high，预留）。 */
    videoQuality: 'standard' | 'high';
    /** 默认执行模式：confirm=每步人工确认；auto=全自动。 */
    workflowMode: 'confirm' | 'auto';
    /** 分镜阶段需人工批准（HITL 门禁）。 */
    hitlStoryboard: boolean;
    /** 关键帧阶段需人工批准（HITL 门禁，预留）。 */
    hitlKeyframe: boolean;
    /** 生成失败自动重试。 */
    autoRetry: boolean;
    /** 最大并行生成数（1–8）。 */
    maxParallel: number;
    /**
     * 全局资产库根目录：留空 = `$DSH_HOME/canvas-studio`（默认）。
     * 填了非空路径后，**仅对新建项目生效**（旧项目留在原位，不迁移）。
     * 路径经桌面 `/_dsh/desktop/validate-directory` 验证安全（macOS 沙盒 / Windows ACL 由桌面侧负责）。
     * 详见 plan.md §1.7「资产库位置」接入说明。
     */
    assetDir: string;
    /** 画布自动保存开关（待 P2-P4 客户端画布自动保存接入）。 */
    autoSave: boolean;
    /** 自动保存间隔（秒，5–600，待客户端画布自动保存接入）。 */
    autoSaveInterval: number;
    /** 品牌配色预设 id（设置页「外观」区切换，控制 --cs-* accent 族，明暗双轨）。 */
    brandPreset: BrandPresetId;
}
/** Canvas Studio 设置 schema（注册进 settings 服务，作为组装 base 层）。 */
export declare const CanvasStudioConfig: z<CanvasStudioConfig>;
