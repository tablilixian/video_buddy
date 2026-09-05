/**
 * Canvas Studio Host 设置命名空间与 schema。
 *
 * Drama Backend 的连接配置从写死的常量外置到 DSH 设置系统（块 2）：
 * - dramaApiBase / maxVideoSeconds 是普通字段，走 settings 用户层（credential 之外）；
 * - dramaApiKey 以 credential-ref 形式存储，不落明文，运行时经 resolveDramaApiKey
 *   解析真实密钥（密钥值只在 credentials 领域流动，绝不进入设置文档）。
 *
 * 同一命名空间字符串 'canvas-studio' 在 Host 注册、客户端卡片两侧共用。
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { BRAND_PRESET_IDS, DEFAULT_BRAND_PRESET, type BrandPresetId } from './brand.js'

/** 设置命名空间（与客户端卡片、Host 注册三处共用同一字符串）。 */
export const CANVAS_STUDIO_NS = settingsNamespace('canvas-studio')

/** Drama Backend API 基址默认值（WL 自架后端）。 */
export const DEFAULT_DRAMA_API_BASE = 'http://117.50.108.73:8082'

/** Drama Backend API Key 的默认凭据引用（值不落明文，经 credentials 解析）。 */
export const DEFAULT_DRAMA_API_KEY_REF = 'CANVAS_STUDIO_DRAMA_API_KEY'

/** fal API Key 的默认凭据引用（阶段 4；值不落明文，经 credentials 解析）。 */
export const DEFAULT_FAL_API_KEY_REF = 'CANVAS_STUDIO_FAL_API_KEY'

/** Canvas Studio 设置分区解析后的运行时值类型。 */
export interface CanvasStudioConfig {
  /** Drama Backend API 基址。 */
  dramaApiBase: string
  /** Drama Backend API Key 的凭据引用（credential-ref，不落明文）。 */
  dramaApiKey: string
  /** fal API Key 的凭据引用（credential-ref，不落明文；阶段 4 接入 fal H3 时使用）。 */
  falApiKey: string
  /** 单段视频时长上限（秒，1–15）。 */
  maxVideoSeconds: number

  // —— 输出与导出（defaultAspectRatio 已接入 generate.ts 兜底；其余待 P3 导出管线）——
  /** 默认画幅比例（agent 未指定 aspectRatio 时生成兜底）。 */
  defaultAspectRatio: '16:9' | '9:16' | '1:1'
  /** 默认视频供应商（agent 未显式指定 provider 时走此项；升级后默认 drama，行为不变）。 */
  defaultVideoProvider: 'drama' | 'fal'
  /** 导出格式（当前仅 mp4，预留）。 */
  exportFormat: string
  /** 导出目录（留空 = 项目默认目录，预留）。 */
  exportDir: string
  /** 视频质量/码率档位（standard/high，预留）。 */
  videoQuality: 'standard' | 'high'

  // —— 工作流偏好（待 P2-P4 agent 编排接入消费）——
  /** 默认执行模式：confirm=每步人工确认；auto=全自动。 */
  workflowMode: 'confirm' | 'auto'
  /** 分镜阶段需人工批准（HITL 门禁）。 */
  hitlStoryboard: boolean
  /** 关键帧阶段需人工批准（HITL 门禁，预留）。 */
  hitlKeyframe: boolean
  /** 生成失败自动重试。 */
  autoRetry: boolean
  /** 最大并行生成数（1–8）。 */
  maxParallel: number

  // —— 存储与缓存（assetDir 已接通 ProjectRegistry；autoSave/autoSaveInterval 待客户端画布自动保存接入）——
  /**
   * 全局资产库根目录：留空 = `$DSH_HOME/canvas-studio`（默认）。
   * 填了非空路径后，**仅对新建项目生效**（旧项目留在原位，不迁移）。
   * 路径经桌面 `/_dsh/desktop/validate-directory` 验证安全（macOS 沙盒 / Windows ACL 由桌面侧负责）。
   * 详见 plan.md §1.7「资产库位置」接入说明。
   */
  assetDir: string
  /** 画布自动保存开关（待 P2-P4 客户端画布自动保存接入）。 */
  autoSave: boolean
  /** 自动保存间隔（秒，5–600，待客户端画布自动保存接入）。 */
  autoSaveInterval: number

  // —— 品牌与外观（brandPreset 已接入客户端品牌令牌注入，见 src/brand.ts / brand-inject.ts）——
  /** 品牌配色预设 id（设置页「外观」区切换，控制 --cs-* accent 族，明暗双轨）。 */
  brandPreset: BrandPresetId
}

/** Canvas Studio 设置 schema（注册进 settings 服务，作为组装 base 层）。 */
export const CanvasStudioConfig: z<CanvasStudioConfig> = z.object({
  dramaApiBase: z.string().default(DEFAULT_DRAMA_API_BASE),
  dramaApiKey: z.string().role('credential-ref').default(DEFAULT_DRAMA_API_KEY_REF),
  falApiKey: z.string().role('credential-ref').default(DEFAULT_FAL_API_KEY_REF),
  maxVideoSeconds: z.number().step(1).min(1).max(15).default(15),

  // 输出与导出
  defaultAspectRatio: z.union(['16:9', '9:16', '1:1']).default('16:9'),
  defaultVideoProvider: z.union(['drama', 'fal']).default('drama'),
  exportFormat: z.string().default('mp4'),
  exportDir: z.string().default(''),
  videoQuality: z.union(['standard', 'high']).default('standard'),

  // 工作流偏好
  workflowMode: z.union(['confirm', 'auto']).default('confirm'),
  hitlStoryboard: z.boolean().default(true),
  hitlKeyframe: z.boolean().default(false),
  autoRetry: z.boolean().default(true),
  maxParallel: z.number().step(1).min(1).max(8).default(2),

  // 存储与缓存
  assetDir: z.string().default(''),
  autoSave: z.boolean().default(true),
  autoSaveInterval: z.number().step(1).min(5).max(600).default(30),

  // 品牌与外观（默认电影紫）
  brandPreset: z.union([...BRAND_PRESET_IDS] as [BrandPresetId, ...BrandPresetId[]]).default(DEFAULT_BRAND_PRESET),
})
