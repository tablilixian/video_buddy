/**
 * CV-332/333：用户 skill 的契约形状（Host 与 Client 共用）。
 *
 * 放 `contracts/` 而不是 `client/` 或根目录：Host 侧的路由返回它、Client 侧的
 * 广场渲染它，两边必须**同一份类型**——否则「Host 多返回一个字段」或「Client 少读
 * 一个字段」只能靠人眼在两端各读一遍才能发现。
 */
import type { SkillCategoryId, SkillIconId } from '../skill-catalog.js'
import type { SkillUploadErrorCode, UploadAdvisory } from '../skill-upload-contract.js'

/** 契约层的两个类型从本模块**转出**：UI 只 import `contracts/skill.js` 一处即可。 */
export type { SkillUploadErrorCode, UploadAdvisory }

/** 条目来源：决定卡片角标与能否删除。 */
export type SkillOrigin = 'builtin' | 'user'

/**
 * 生效状态三态（`SkillMarket` 详情卡的核心）。
 *
 * ⚠️ 三态**不是**「有没有进 catalog」的二态 —— 用户最常问的是「我传了为什么没用」，
 * 而「没用」的两种成因（没装载 / 被同名顶掉）处置完全不同。
 */
export type SkillEffectiveStatus =
  /** 在 catalog 中，且已装载进本项目 `skills.json`。 */
  | 'active'
  /** 在 catalog 中，但未装载 —— 模型能看到，不一定会用。 */
  | 'idle'
  /** catalog 里的赢家不是它（被更高优先级的同名条目顶掉）。 */
  | 'conflict'

/**
 * 该条目在**上游 catalog** 里的落地情况。
 *
 * 与 `SkillEffectiveStatus` 是两个维度：前者回答「上游认不认它」，后者回答
 * 「本项目用不用它」。分开的理由见 `UserSkillsPayload.complete` 的注释 ——
 * 「还没扫完」与「真的没进目录」必须给用户不同的说法。
 */
export type SkillCatalogState =
  /** snapshot 里赢家就是这条用户 skill。 */
  | 'found'
  /** snapshot 里有同名条目但赢家是更高的层（project / runtime）。 */
  | 'conflict'
  /** `complete === true` 却查无此名 ⇒ **真失败**（多半 frontmatter 被上游丢弃）。 */
  | 'missing'
  /** `complete === false` 且查无此名 ⇒ **扫描中**，继续轮询，不要标红。 */
  | 'unknown'

/**
 * 面向 UI 的一条技能条目（内置与用户共用形状）。
 *
 * `status` / `catalogState` 由 **Host 侧算完**再返回（唯一实现）：前端不重算规则，
 * 否则两处判定必然漂移，而漂移的表现是「卡片说已生效、模型其实没看到」。
 */
export interface SkillListItem {
  /** frontmatter `name`（内置 = 注册名）。 */
  readonly name: string
  /** 展示标题：用户条目回落 `name`。 */
  readonly title: string
  /** 一句话说明：用户条目 = 截断后的 description。 */
  readonly summary: string
  readonly category: SkillCategoryId
  /** 用户条目缺省 `null`（UI 渲染首字母）。 */
  readonly icon: SkillIconId | null
  readonly origin: SkillOrigin
  /** 用户条目才有（删除 / 改名用）；内置为 `null`。 */
  readonly slug: string | null
  readonly status: SkillEffectiveStatus
  readonly catalogState: SkillCatalogState
  /** `status === 'conflict'` 时点名赢家。 */
  readonly conflictWith: string | null
  /** 上游是否放行模型调用（`disable-model-invocation: true` ⇒ false）。 */
  readonly modelInvocable: boolean
}

/**
 * `GET /canvas-studio/skills` 的返回。
 *
 * `complete` 必须一并返回：上游 `snapshot()` 返回的 `SkillCatalogSnapshot` 带
 * `complete` 字段，`false` 表示**本轮发现未完成**（不是「不存在」）。
 * 丢掉它会让 UI 在落盘后的头 ~200ms 把「还没扫完」误判成「导入失败」——一次假红。
 */
export interface UserSkillsPayload {
  readonly items: readonly SkillListItem[]
  /** 上游发现是否完整；`false` = 扫描中，UI 应继续轮询而不是标红。 */
  readonly complete: boolean
  /** 内置条目数（编译期常量，供 UI 显示「官方 N · 我的 M」）。 */
  readonly builtinCount: number
  /** 落点目录绝对路径（UI 的「打开技能目录」与导入完成页展示）。 */
  readonly skillsRoot: string
}

/** `POST /canvas-studio/skills/import` 的请求体。 */
export interface ImportSkillRequest {
  /** 文件内容列表（**不是路径** —— Host 永不读用户给的路径）。 */
  readonly files: readonly { readonly path: string; readonly text?: string }[]
  /** 用户显式指定的落点 slug；缺省从目录名 / frontmatter name 派生。 */
  readonly slug?: string
  /** 目标已存在时是否覆盖（先整体移入回收站）。缺省 false。 */
  readonly overwrite?: boolean
}

/** `POST /canvas-studio/skills/import` 的返回。 */
export interface ImportSkillResult {
  readonly ok: boolean
  /** 失败时的错误码（`CS-SKILL-*`）。 */
  readonly code?: SkillUploadErrorCode
  readonly reason?: string
  /** 落点目录（成功时）。 */
  readonly slug?: string
  /** 实际落盘的相对路径清单（成功时，供「完成」页展示）。 */
  readonly files?: readonly string[]
  /** 建议清单（成功时）。 */
  readonly advisories?: readonly UploadAdvisory[]
  readonly note?: string
  /** 覆盖导入时旧版本的去向。 */
  readonly trashedTo?: string
}

/** `POST /canvas-studio/skills/delete` 的请求体。 */
export interface DeleteSkillRequest {
  readonly slug: string
}

/** `POST /canvas-studio/skills/delete` 的返回。 */
export interface DeleteSkillResult {
  readonly ok: boolean
  /** 回收站目录（可恢复路径，UI 要显示给用户）。 */
  readonly trashedTo?: string
  /** 装载过它的项目数（**不自动清理** `skills.json`，只如实告知）。 */
  readonly loadedByProjects?: number
}

/** `POST /canvas-studio/skills/trash/empty` 的返回。 */
export interface EmptyTrashResult {
  readonly ok: boolean
  readonly removed: number
}
