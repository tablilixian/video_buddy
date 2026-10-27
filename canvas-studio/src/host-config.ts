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
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BRAND_PRESET_IDS, DEFAULT_BRAND_PRESET, type BrandPresetId } from './brand.js'
import { DEFAULT_RESOLUTION } from './config.js'
// CV-196：画幅的硬编码兜底与「放手跑自动取值表」共用同一个常量 —— 设置项 schema 的
// default 与 studio-defaults 的 FALLBACK_ASPECT_RATIO 若是两个字面量，改一处忘一处
// 就会出现「设置页默认 9:16、放手跑兜底 16:9」这种自相矛盾。
import { FALLBACK_ASPECT_RATIO } from './studio-defaults.js'
import type { VideoResolution } from './providers/types.js'
import { DEFAULT_VIDEO_RESOLUTION_ID, RESOLUTION_IDS, RESOLUTION_TIERS, type ResolutionId } from './resolution-tiers.js'

/**
 * 设置命名空间（= Loader entry id，客户端卡片与 Host 两侧共用同一字符串）。
 *
 * 0.2.1 起命名空间由 Loader entry id 决定，不再需要 settingsNamespace() 构造：
 * 本插件在 profile 里的 entry id 就是 'canvas-studio'，故此处只是同一字符串的具名常量。
 */
export const CANVAS_STUDIO_NS = 'canvas-studio'

/**
 * 设置项里「档位」的合法取值 = 规范键 + 历史键。
 *
 * 为什么要收历史键：用户机器上的设置文档里可能已经存着 `736p` / `2k`（旧版本写的）。
 * schema 只认规范键会让那份文档校验失败 —— 一个旧值不该让整页设置读不出来。
 * 读路径由 `normalizeResolutionId()` 归一（`index.ts` 的 cfg getter），**写路径只写规范键**。
 *
 * 类型断言成规范键元组：schema 只是运行期宽容，对外暴露的类型与归一后的值仍只有三档。
 */
const RESOLUTION_SETTING_KEYS = [
  ...RESOLUTION_IDS,
  ...RESOLUTION_TIERS.flatMap(tier => tier.deprecatedAliases),
] as unknown as [ResolutionId, ...ResolutionId[]]

/** Drama Backend API 基址默认值（WL 自架后端）。 */
export const DEFAULT_DRAMA_API_BASE = 'http://117.50.108.73:8082'

/**
 * DramaServer 业务 API 基址默认值（方案 P1/CV-355；管理面 auth/sync · models ·
 * credits + /v1/llm 网关；与生成后端同机不同端口，2026-10-20 部署确认 80 端口）。
 * **清空 = 管理面整体降级关闭**（同 supabaseUrl 空 = 隐藏登录的既有语义）。
 */
export const DEFAULT_BUSINESS_API_BASE = 'http://117.50.108.73'

/** Drama Backend API Key 的默认凭据引用（值不落明文，经 credentials 解析）。 */
export const DEFAULT_DRAMA_API_KEY_REF = 'CANVAS_STUDIO_DRAMA_API_KEY'

/**
 * P1 登录闭环：Supabase 项目配置默认值（沿用 reelsbuddy-auth 的项目，其
 * Redirect URLs 已含 127.0.0.1 随机端口的回调地址，通配形态见迁移文档 §5.1；
 * 2026-10-15 拍板）。
 *
 * publishable key 属**公开信息**（会被打进前端产物，数据安全由 RLS 把关），
 * 因此走普通设置字段而非 credential 域 —— 参考 frontend/.env 的同款注释。
 */
export const DEFAULT_SUPABASE_URL = 'https://rotkecckjazdfujgacvb.supabase.co'
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gGXNbjjJTc9yFT0CSO94CA_O0dZMyGm'

/** fal API Key 的默认凭据引用（阶段 4；值不落明文，经 credentials 解析）。 */
export const DEFAULT_FAL_API_KEY_REF = 'CANVAS_STUDIO_FAL_API_KEY'

/** Canvas Studio 设置分区解析后的运行时值类型。 */
export interface CanvasStudioConfig {
  /** Drama Backend API 基址。 */
  dramaApiBase: string
  /**
   * DramaServer 业务 API 基址（管理面 + /v1/llm 网关；方案 CV-355）。
   * 留空 = 管理面整体降级关闭（account-state 零请求、网关行不写）。
   */
  businessApiBase: string
  /** Drama Backend API Key 的凭据引用（credential-ref，不落明文）。 */
  dramaApiKey: string
  /** fal API Key 的凭据引用（credential-ref，不落明文；阶段 4 接入 fal H3 时使用）。 */
  falApiKey: string
  /**
   * P1 登录闭环：Supabase Project URL（PKCE + Google provider；空 = 登录入口隐藏）。
   */
  supabaseUrl: string
  /**
   * Supabase publishable key（公开信息，明文即可；绝不能放 service_role / secret）。
   */
  supabasePublishableKey: string
  /** 单段视频时长上限（秒，1–15）。 */
  maxVideoSeconds: number

  // —— 输出与导出（defaultAspectRatio 已接入 generate.ts 兜底；其余待 P3 导出管线）——
  /** 默认画幅比例（agent 未指定 aspectRatio 时生成兜底）。 */
  defaultAspectRatio: '16:9' | '9:16' | '1:1'
  /** 默认视频供应商（agent 未显式指定 provider 时走此项；升级后默认 drama，行为不变）。 */
  defaultVideoProvider: 'drama' | 'fal'
  /**
   * 默认图片分辨率档位（agent 未指定 resolution 时图片生成兜底）。
   * 像素对照见 `config.ts` 的 `OUTPUT_SIZE`。
   */
  defaultImageResolution: VideoResolution
  /**
   * 默认视频分辨率档位（agent 未指定 resolution 时视频生成兜底）。
   * 像素对照见 `config.ts` 的 `OUTPUT_SIZE`。
   */
  defaultVideoResolution: VideoResolution
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
  /**
   * 最大并行生成数（1–8）。**CV-215 起刻意不接入**：Drama 后端同步单任务（同刻只
   * 处理一个请求），并发提交只排队、墙钟不变 ⇒ 接上任何并行闸门都拿不到收益。
   * 等后端提供并发队列后再评估；设置页已如实标注「本项不会生效」。
   */
  maxParallel: number

  // —— 存储与缓存（assetDir 已接通 ProjectRegistry；autoSave/autoSaveInterval 待客户端画布自动保存接入）——
  /**
   * 项目与全局资产库的存储根目录：留空 = `$DSH_HOME/canvas-studio`（默认）。
   *
   * **语义 = 换库**（2026-10-04 校正：此前写「仅对新建项目生效（旧项目留在原位）」，
   * 与实现不符 —— 非空路径会成为整个 root，`projects.json` / `assets-library.json` /
   * `library/` 一并落到那里，切过去之后**旧根的项目在当前库里不可见**；文件仍在原处，
   * 不迁移也不删除，改回原路径即可重新看到）。
   *
   * **运行期修改立即生效**，不需要重启：Host 侧失效按路径缓存的实例状态
   * （`ProjectRegistry.invalidateRootScoped`），客户端侧重置列表 / 画布态并重建首页落点。
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

  // —— 诊断（CV-234；语义见 src/error-system.ts 的 ErrorVisibility）——
  /**
   * 错误可见性。`audience`（默认）＝ 按受众判定（`developer` / `agent` 受众的错误
   * 只进日志）；`all` ＝ **诊断模式**，所有错误一律展示。
   *
   * 为什么是设置项而不是纯环境变量：默认行为是「把一部分错误藏起来」，而藏起来的
   * 东西没有可观察迹象 ⇒ 没有这个开关就无法验收「隐藏」这条规则本身。走设置命名
   * 空间还顺带解决了跨进程同步（Host 与 Client 各读一次同一份值）。
   */
  errorVisibility: 'audience' | 'all'

  // —— 测试（REQ-021；开关只控制入口可见性，无定时/自动触发）——
  /**
   * 显示应用内自动测试入口（「▶ 自动测试」浮窗），日常使用保持关闭。
   *
   * 拍板④（2026-10-05）：开关**只控制按钮可见**——跑不跑、何时跑永远由用户
   * 手点，绝不做任何定时/自动触发。运行期间也不改任何真实设置。
   */
  testMode: boolean
}

/**
 * Canvas Studio 设置 schema（作为插件 Config 导出，由 Loader 校验并注入）。
 *
 * 整棵对象标 `.volatile()`：0.2.1 起只有 volatile 节点下的字段允许经 settings 编辑，
 * 对象级 volatile 让全部字段可编辑，同时运行时经 `config.get()` 读到当前值。
 * 类型上 Config 值 = `Volatile<CanvasStudioConfig | undefined>`（见 registry 的运行时注入）。
 */
export const CanvasStudioConfig = z.object({
  dramaApiBase: z.string().default(DEFAULT_DRAMA_API_BASE),
  businessApiBase: z.string().default(DEFAULT_BUSINESS_API_BASE),
  dramaApiKey: z.string().role('credential-ref').default(DEFAULT_DRAMA_API_KEY_REF),
  falApiKey: z.string().role('credential-ref').default(DEFAULT_FAL_API_KEY_REF),
  // P1 登录闭环（沿用 reelsbuddy-auth 项目；空串 = 未配置，客户端登录入口降级隐藏）。
  supabaseUrl: z.string().default(DEFAULT_SUPABASE_URL),
  supabasePublishableKey: z.string().default(DEFAULT_SUPABASE_PUBLISHABLE_KEY),
  maxVideoSeconds: z.number().step(1).min(1).max(15).default(15),

  // 输出与导出
  defaultAspectRatio: z.union(['16:9', '9:16', '1:1']).default(FALLBACK_ASPECT_RATIO),
  defaultVideoProvider: z.union(['drama', 'fal']).default('drama'),
  // CV-187 / 2026-10-27：默认分辨率档位。取值与 `VideoResolution` 由下面的类型标注强绑
  // （漏改任一侧即编译失败），真值表在 `resolution-tiers.ts`。
  // 图片默认 720P，视频默认 480P（出厂值刻意不同：图片贵在分辨率、视频贵在时长）。
  defaultImageResolution: z.union(RESOLUTION_SETTING_KEYS).default(DEFAULT_RESOLUTION),
  defaultVideoResolution: z.union(RESOLUTION_SETTING_KEYS).default(DEFAULT_VIDEO_RESOLUTION_ID),
  exportFormat: z.string().default('mp4'),
  exportDir: z.string().default(''),
  videoQuality: z.union(['standard', 'high']).default('standard'),

  // 工作流偏好
  workflowMode: z.union(['confirm', 'auto']).default('confirm'),
  hitlStoryboard: z.boolean().default(true),
  hitlKeyframe: z.boolean().default(false),
  autoRetry: z.boolean().default(true),
  // CV-215：刻意不接入 —— 后端同步单任务，并行闸门无收益（详见字段说明）。
  maxParallel: z.number().step(1).min(1).max(8).default(2),

  // 存储与缓存
  assetDir: z.string().default(''),
  autoSave: z.boolean().default(true),
  autoSaveInterval: z.number().step(1).min(5).max(600).default(30),

  // 品牌与外观（默认电影紫）
  brandPreset: z.union([...BRAND_PRESET_IDS] as [BrandPresetId, ...BrandPresetId[]]).default(DEFAULT_BRAND_PRESET),

  // 诊断（CV-234）：默认 `audience` = 生产行为，与加这个字段之前完全一致
  //（漏改默认值会让整个错误系统默认变成「全显示」，那是行为倒退）。
  errorVisibility: z.union(['audience', 'all']).default('audience'),

  // 测试（REQ-021）：默认关闭 —— 日常用户界面上不出现自动测试入口。
  testMode: z.boolean().default(false),
}).volatile()

/** 插件 Config 值类型：对象级 volatile 包装后的运行时形态。 */
export type CanvasStudioConfigValue = Volatile<CanvasStudioConfig | undefined>
