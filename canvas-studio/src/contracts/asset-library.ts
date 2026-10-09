/**
 * Canvas Studio 全局资产库 wire 契约（REQ-001）。
 *
 * 跨项目的角色/场景/物件/群像注册表（`<registryRoot>/assets-library.json`）与
 * 库媒体（`<registryRoot>/library/<assetId>/`）的共享类型。Host（`asset-library.ts`）
 * 与 Client（资产库页 / `@` 引用候选取数）都只经本文件交流，不各自长形状。
 *
 * 与项目级 `StudioAsset`（`contracts/canvas.ts`，`role: character|scene|style`）是
 * **两套枚举**：库层用四分类（character/scene/prop/group），项目层 `StudioAsset.role`
 * 保持不动（style 是风格锚点注入用途，不进库）——方案 §2.2 的决策，避免 bump
 * `CANVAS_DOCUMENT_VERSION` 与迁移 look-asset 流程。
 */

/** 库文档/条目 schema 版本；结构变化时 bump 并在读侧迁移。 */
export const LIBRARY_SCHEMA_VERSION = 1

/** 分类枚举（需求表口径：角色 / 场景 / 物件 / 群像；REQ-032 C1 追加「音色」第五分类）。 */
export type LibCategory = 'character' | 'scene' | 'prop' | 'group' | 'voice'

/** 分类枚举的稳定枚举序（导航 / 计数按此顺序展示，不随对象键序漂移）。 */
export const LIB_CATEGORIES: readonly LibCategory[] = ['character', 'scene', 'prop', 'group', 'voice']

/** 分类中文标签（UI pill、agent 库清单共用同一份字面量）。 */
export const LIB_CATEGORY_LABELS: Readonly<Record<LibCategory, string>> = {
  character: '角色',
  scene: '场景',
  prop: '物件',
  group: '群像',
  voice: '音色',
}

/** 收口未知输入为合法分类（路由 body / 读侧迁移共用）。 */
export function isLibCategory(value: unknown): value is LibCategory {
  return value === 'character' || value === 'scene' || value === 'prop' || value === 'group'
}

/** 库媒体文件 URL（详情/卡片/hover 浮层的 `<img src>`；GET 由 requestAllowed 守卫）。 */
export function libraryMediaUrl(assetId: string, file: string): string {
  return `/canvas-studio/library/${encodeURIComponent(assetId)}/${encodeURIComponent(file)}`
}

/**
 * 库条目引用的一个画布锚点（允许跨项目）：来源节点是「从哪张画布入库的」
 * 的溯源与再生依据（正/侧/背/全身分图可挂多个锚点）。
 */
export interface LibAnchorRef {
  projectId: string
  nodeId: string
}

/** 库条目的一份媒体（文件落在 `library/<assetId>/` 下，HTTP 经 `/library/<assetId>/<file>`）。 */
export interface LibMedia {
  /** 库内文件名，如 `m_0.png`；只含 `[A-Za-z0-9._-]` 且不以 `.` 开头。 */
  file: string
  /** 首期 UI 只保证 image 渲染；video/audio 存量兼容、卡片降级占位（方案 §8-I）。 */
  kind: 'image' | 'video' | 'audio'
  /** 视图标签（如「正视图」「侧视图」），详情抽屉多图切换用。 */
  label?: string
  /** 文件内容 SHA-256（hex）：物化到目标项目前的去重依据（方案 §3.4-3）。 */
  contentHash?: string
}

/** 被引用记录（回写粒度 = `{projectId, nodeId}`，开放问题 #2 按方案取细粒度）。 */
export interface LibraryUsageRef {
  projectId: string
  /** 引用发生处的画布节点（对话 chip 引用可无节点，省略）。 */
  nodeId?: string
}

/** 一条全局库资产。 */
export interface LibraryAsset {
  /** UUID；`@ref[lib:<id>]` 句柄 `lib:` 后的 id 段。 */
  id: string
  /** = `LIBRARY_SCHEMA_VERSION`（条目级版本，读侧按此迁移）。 */
  schema: number
  category: LibCategory
  /** 主名称：自然语言引用的主键（全局唯一，大小写不敏感）。 */
  name: string
  /** 别名/外号（「女主」「Luna」），自然语言匹配与 `@` 菜单过滤都算上。 */
  aliases: string[]
  /** 描述：自然语言匹配 + 列表副标题。 */
  description: string
  tags: string[]
  /** 库媒体；封面缺省 = `media[0]`（或显式 `coverFile`）。 */
  media: LibMedia[]
  /** 显式封面文件名（`media` 内某一项）；缺省不落字段。 */
  coverFile?: string
  /** 来源画布锚点（可跨项目），用于溯源与再生。 */
  anchors: LibAnchorRef[]
  /** 冻结 SAME 块（沿用 `StudioAsset.lockedPrompt` 语义，可空）。 */
  lockedPrompt: string
  negativePrompt?: string
  /** 首次入库的项目。 */
  sourceProjectId?: string
  /** 被哪些画布节点引用（解析成功后回写，防误删展示用）。 */
  usage: LibraryUsageRef[]
  createdAt: number
  updatedAt: number
}

/** `assets-library.json` 文档形状。 */
export interface AssetLibraryDocument {
  /** = `LIBRARY_SCHEMA_VERSION`。 */
  version: number
  assets: LibraryAsset[]
  /** 墓碑（已删除资产 id）：合流时据此不复活被本实例删掉的条目（与 projects.json 同纪律）。 */
  deleted?: string[]
}

/**
 * 新建库资产的请求体（POST `/canvas-studio/library`）。
 * `anchors` 非空 = 从画布入库（媒体源由 Host 按锚点解析拷入，客户端不传路径）。
 */
export interface LibraryCreateRequest {
  category: LibCategory
  name: string
  aliases?: string[]
  description?: string
  tags?: string[]
  lockedPrompt?: string
  negativePrompt?: string
  anchors?: LibAnchorRef[]
}

/** 更新库资产的请求体（PATCH `/canvas-studio/library/:id`）；字段缺省 = 不改。 */
export interface LibraryUpdateRequest {
  category?: LibCategory
  name?: string
  aliases?: string[]
  description?: string
  tags?: string[]
  lockedPrompt?: string
  negativePrompt?: string
  coverFile?: string
  /** 媒体元数据（改 label / 排序 / 封面指向）；文件本身不由 PATCH 增删。 */
  media?: LibMedia[]
}

/** 列表查询（GET `/canvas-studio/library?category=&q=`）。 */
export interface LibraryListFilter {
  category?: LibCategory
  /** 名称/别名/描述/标签的子串匹配（大小写不敏感，Host 侧收口）。 */
  q?: string
}

/** 结构校验一条库资产（读侧：不合格条目**直接抛错**而非静默丢弃——静默丢会让紧随其后的写盘把坏条目抹掉，与 projects.json 同纪律）。 */
export function isLibraryAsset(value: unknown): value is LibraryAsset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const asset = value as Record<string, unknown>
  return typeof asset.id === 'string'
    && asset.id.length > 0
    && typeof asset.name === 'string'
    && isLibCategory(asset.category)
    && Array.isArray(asset.aliases)
    && asset.aliases.every((entry) => typeof entry === 'string')
    && typeof asset.description === 'string'
    && Array.isArray(asset.tags)
    && asset.tags.every((entry) => typeof entry === 'string')
    && Array.isArray(asset.media)
    && Array.isArray(asset.anchors)
    && typeof asset.lockedPrompt === 'string'
    && Array.isArray(asset.usage)
    && typeof asset.createdAt === 'number'
    && typeof asset.updatedAt === 'number'
}
