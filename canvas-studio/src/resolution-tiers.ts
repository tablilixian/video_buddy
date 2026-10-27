/**
 * 清晰度档位（分辨率）的**唯一事实源** —— 显示名、内部键、后台真值三者同表。
 *
 * ## 为什么必须收成一张表
 *
 * 改造前同一个档位被描述了五遍：`output-size.ts` 说像素、`resolution-display.ts`
 * 说显示名、`host-config.ts` 的 schema 写字面量、`host-tools.ts` 的 enum 再抄一遍、
 * `NodeInputCard.tsx` 的两个 chip 菜单还各有一份数组。结果是**同一档位两种 megapixels**
 * （`docs/api.md:64` 写 1.0、`:297` 写 0.9、代码里 0.9），以及显示名 `720P` 对应
 * 内部键 `736p` 再对应像素 `1280×736` —— 三个数字互不相干，用户和 agent 都没法对上。
 *
 * ## 后台真值从哪来（不许自创）
 *
 * - **视频**端点只收 `aspect` + `megapixels`，**不收 width/height** ⇒ megapixels 是
 *   唯一旋钮，像素只能由 H3 官方推荐分辨率表反推。
 * - **图片**端点收 width/height，2026-09-15 实测「逐字节按请求出图」。
 * - 三档取 H3 表的 **0.4 / 1.0 / 2.0** 三行（`docs/archive/plans/resolution-tier-dev.md` §0）。
 *   上一版的 `736p → 0.9MP` 是改名时手填的、不在任何官方表内 —— 已按拍板（2026-10-27）
 *   改回官方值 `1.0MP → 1376×768`。
 *
 * ## 显示名 vs 真值
 *
 * 用户可见只用通用称呼 **480P / 720P / 1080P**（拍板：显示用通用称呼）；真值一律取
 * 本表的 `megapixels` / `frames`。注意 720P 档的真实像素是 **1376×768**（H3 表没有精确
 * 720p 行），所以**菜单里必须同时显示真实像素**，不能让「720P」这个称呼单独出现。
 *
 * 纯数据 + 纯函数：无 IO、无 React、不 import 任何 Host 专属模块 ⇒ Host、客户端 bundle
 * 与 `node --test` 三方直连（与 `node-params.ts` / `canvas-view.ts` 同一约定）。
 */

/** 规范档位键（= 显示名的机器形态）。**写路径只写这三个**。 */
export const RESOLUTION_IDS = ['480p', '720p', '1080p'] as const

/** 规范档位键类型。`VideoResolution`（providers/types.ts）是它的别名。 */
export type ResolutionId = (typeof RESOLUTION_IDS)[number]

/** 一档在某个画幅下的输出像素。 */
export interface ResolutionFrame {
  readonly width: number
  readonly height: number
}

/**
 * 档位适用范围（2026-10-27 两次拍板后的最终口径）。
 *
 * - `image` —— 图片产物（`image_generate` 等，端点是 `width/height`）。**下限 720P**。
 * - `video` —— 视频产物（`video_generate` / `video_composite`，端点是 `megapixels`）。
 *   三档全开，480P 是出厂默认（试片档）。
 *
 * 为什么没有 `project`：项目预置（`plan.videoResolution`）**只作用于视频**，
 * 图片档位归图片节点与会话设置管 —— 两者不再是同一个档位，所以「项目级视图」
 * 这个中间概念不存在了，首页直接复用 `video` 视图。
 */
export type ResolutionScope = 'image' | 'video'

/** 方形画幅三档共用（H3 没有方形输出规格，档位对 1:1 无意义）。 */
const SQUARE_FRAME: ResolutionFrame = { width: 1024, height: 1024 }

/** 一档的完整定义。 */
export interface ResolutionTier {
  /** 规范键（内部唯一标识，落 `generationPrompt` / `project.plan` / 设置项）。 */
  readonly id: ResolutionId
  /** 用户可见通用称呼（480P / 720P / 1080P）。 */
  readonly label: string
  /** 视频端点唯一画质旋钮（后台约定值，H3 官方表的 0.4 / 1.0 / 2.0）。 */
  readonly megapixels: number
  /** 图片端点直发的像素；视频产物按同一张表核对。 */
  readonly frames: {
    readonly '16:9': ResolutionFrame
    readonly '9:16': ResolutionFrame
    readonly '1:1': ResolutionFrame
  }
  /** 菜单右侧 meta（耗时倍数，以 720P 为 1× 基准；推荐档写「推荐」）。 */
  readonly costMeta: string
  /**
   * 这一档**允许用于哪些产物类型**。`480p` 只标 `video` —— 那就是「图片下限 720P」
   * 的全部实现（判定走 `isResolutionIdFor`，菜单走 `resolutionIdsFor`）。
   *
   * 为什么图片不给 480P：图片是**定内容的静态依据**（首帧图直接决定视频内容），
   * 降档省下的 0.6× 远小于判断失真导致的废片重出；视频则相反 —— 它贵在时长与
   * 重出成本，先出一版低档看内容再按需升档是划算的。两者不是同一条规则。
   */
  readonly scopes: readonly ResolutionScope[]
  /**
   * 历史键（读路径归一用，写路径永不产生）。
   *
   * `736p` 是 2026-09-20 改名时留下的键（当时取值 1280×736 / 0.9MP）；`2k` 是同一批
   * 的老键。老节点的 `generationPrompt` 里存着它们，删掉会让重放查表得 `undefined` ——
   * 参照画幅侧 `dramaAspect()` 处理历史 `1:1` 的先例，就地归一、不回 warning。
   */
  readonly deprecatedAliases: readonly string[]
}

/**
 * 三档定义（**唯一事实源**）。顺序即菜单顺序：480P → 720P（推荐）→ 1080P。
 *
 * 像素硬约束：宽高均为 **32 的倍数**（后端按 8 对齐、非 32 倍数会静默换成另一个尺寸，
 * 2026-09-15 实测 `1400×780 → 1400×776`），由 `tests/resolution-tier.test.mjs` 钉住。
 */
export const RESOLUTION_TIERS: readonly ResolutionTier[] = [
  {
    id: '480p',
    label: '480P',
    megapixels: 0.4,
    frames: { '16:9': { width: 864, height: 480 }, '9:16': { width: 480, height: 864 }, '1:1': SQUARE_FRAME },
    costMeta: '0.4×',
    scopes: ['video'],
    deprecatedAliases: [],
  },
  {
    id: '720p',
    label: '720P',
    megapixels: 1.0,
    frames: { '16:9': { width: 1376, height: 768 }, '9:16': { width: 768, height: 1376 }, '1:1': SQUARE_FRAME },
    costMeta: '推荐',
    scopes: ['image', 'video'],
    deprecatedAliases: ['736p'],
  },
  {
    id: '1080p',
    label: '1080P',
    megapixels: 2.0,
    frames: { '16:9': { width: 1920, height: 1088 }, '9:16': { width: 1088, height: 1920 }, '1:1': SQUARE_FRAME },
    costMeta: '2.0×',
    scopes: ['image', 'video'],
    deprecatedAliases: ['2k'],
  },
]

/** 出厂默认档（图片 / 视频的设置项默认值、`sizeForAspectRatio` 的缺省都取它）。 */
export const DEFAULT_RESOLUTION_ID: ResolutionId = '720p'

/**
 * **视频**出厂默认档 = 480P。
 *
 * 为什么与图片默认（720P）不同：图片贵在分辨率（一次到位，降档会让内容判断失真），
 * 视频贵在时长与重出（先出低档看内容、确认后再升档更划算）。这个差异是拍板结果，
 * 不是巧合 —— 两处默认值都必须引用本常量，不要再写字面量。
 */
export const DEFAULT_VIDEO_RESOLUTION_ID: ResolutionId = '480p'

/** 严格判定：只认规范键（写路径 / schema 用）。 */
export function isResolutionId(value: unknown): value is ResolutionId {
  return typeof value === 'string' && (RESOLUTION_IDS as readonly string[]).includes(value)
}

/**
 * 读路径归一：规范键原样返回，历史键映射到规范键，其余（脏值 / 缺省）返回 `undefined`。
 *
 * **所有读「档位」的路径都必须经过这里**（工具入参、`generationPrompt`、`plan`、设置项）——
 * 绕过去就会在查表处拿到 `undefined`。返回 `undefined` 而不是回默认值：调用方要自己
 * 决定往下一层（项目预置 / 设置页 / 出厂）落，而不是被这里提前定死。
 */
export function normalizeResolutionId(value: unknown): ResolutionId | undefined {
  if (isResolutionId(value)) return value
  if (typeof value !== 'string') return undefined
  const tier = RESOLUTION_TIERS.find(candidate => candidate.deprecatedAliases.includes(value))
  return tier?.id
}

/** 档位定义（键已规范，调用前请先 `normalizeResolutionId`）。 */
export function resolutionTierOf(id: ResolutionId): ResolutionTier {
  const tier = RESOLUTION_TIERS.find(candidate => candidate.id === id)
  // 联合类型穷尽 ⇒ 运行期不可能落到这里；`??` 只为 noUncheckedIndexedAccess 习惯。
  return tier ?? (RESOLUTION_TIERS.find(candidate => candidate.id === DEFAULT_RESOLUTION_ID) as ResolutionTier)
}

/** 档位 → 用户可见称呼（未知值回落默认档，防脏数据把 chip 渲成 undefined）。 */
export function resolutionLabelOf(value: unknown): string {
  return resolutionTierOf(normalizeResolutionId(value) ?? DEFAULT_RESOLUTION_ID).label
}

/** 档位 → 后台 megapixels（视频端点唯一旋钮）。 */
export function megapixelsOf(value: unknown): number {
  return resolutionTierOf(normalizeResolutionId(value) ?? DEFAULT_RESOLUTION_ID).megapixels
}

/** 档位 → 某画幅下的像素；画幅未知按 16:9（与 `sizeForAspectRatio` 的兜底同构）。 */
export function frameOf(value: unknown, aspectRatio: string | undefined): ResolutionFrame {
  const frames = resolutionTierOf(normalizeResolutionId(value) ?? DEFAULT_RESOLUTION_ID).frames
  if (aspectRatio === '9:16') return frames['9:16']
  if (aspectRatio === '1:1') return frames['1:1']
  return frames['16:9']
}

/**
 * 某个适用范围可选的档位（顺序 = `RESOLUTION_TIERS` 顺序 = 菜单顺序）。
 */
export function resolutionIdsFor(scope: ResolutionScope): readonly ResolutionId[] {
  return RESOLUTION_TIERS.filter(tier => tier.scopes.includes(scope)).map(tier => tier.id)
}

/**
 * 该档位是否允许用于这个适用范围（菜单与**写入前**的选择校验）。
 *
 * ⚠️ **读路径不要用它拦历史值**：存量 480P 图片节点必须照常读、照常重放
 * （项目铁律「只修产生数据的路径，不动历史数据」）。它回答的是「能不能新选」，
 * 不是「能不能读」—— 后者一律走 `normalizeResolutionId` 的宽容归一。
 */
export function isResolutionIdFor(value: unknown, scope: ResolutionScope): boolean {
  const id = normalizeResolutionId(value)
  if (id === undefined) return false
  return resolutionIdsFor(scope).includes(id)
}

/**
 * 档位在表里的序（`480p`=0 → `1080p`=2；脏值 -1）。**升档判定**用它比大小：
 * 只有 `resolutionRank(目标) > resolutionRank(当前)` 才是「升档重出」。
 */
export function resolutionRank(value: unknown): number {
  const id = normalizeResolutionId(value)
  return id === undefined ? -1 : RESOLUTION_TIERS.findIndex(tier => tier.id === id)
}
