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

/** 设置命名空间（与客户端卡片、Host 注册三处共用同一字符串）。 */
export const CANVAS_STUDIO_NS = settingsNamespace('canvas-studio')

/** Drama Backend API 基址默认值（WL 自架后端）。 */
export const DEFAULT_DRAMA_API_BASE = 'http://117.50.108.73:8082'

/** Drama Backend API Key 的默认凭据引用（值不落明文，经 credentials 解析）。 */
export const DEFAULT_DRAMA_API_KEY_REF = 'CANVAS_STUDIO_DRAMA_API_KEY'

/** Canvas Studio 设置分区解析后的运行时值类型。 */
export interface CanvasStudioConfig {
  /** Drama Backend API 基址。 */
  dramaApiBase: string
  /** Drama Backend API Key 的凭据引用（credential-ref，不落明文）。 */
  dramaApiKey: string
  /** 单段视频时长上限（秒，1–15）。 */
  maxVideoSeconds: number
}

/** Canvas Studio 设置 schema（注册进 settings 服务，作为组装 base 层）。 */
export const CanvasStudioConfig: z<CanvasStudioConfig> = z.object({
  dramaApiBase: z.string().default(DEFAULT_DRAMA_API_BASE),
  dramaApiKey: z.string().role('credential-ref').default(DEFAULT_DRAMA_API_KEY_REF),
  maxVideoSeconds: z.number().step(1).min(1).max(15).default(15),
})
