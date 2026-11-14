/**
 * 1（CV-463）· **模板适配闸门**（五条可计算判据）。
 *
 * ## 为什么必须机器判，不能靠模型自觉
 *
 * 实测（`决策-模板需求收口.md` §12）抓出两个「机器看不见」的缺口：
 *
 * - 用户说 **4 条**要点、模板只有 **3 个**卡片位 ⇒ 第 4 条被**静默丢弃**且 `ok=true`；
 * - 用户只说**一句话**、其余槽位全靠**编造** ⇒ 也 `ok=true`。
 *
 * 这两条靠提示词治不住（模型宁可硬套也不肯说「模板不合适」），只能算。
 *
 * ## 五条判据（`决策` §5.1）
 *
 * | # | 判据 | 算法 |
 * |---|---|---|
 * | 1 | 容量 | 内容字数 > σ(必填槽 `maxChars`) ⇒ 排除 |
 * | 2 | 素材 | 模板 `requiredAssets` 数量 > 用户手上素材数 ⇒ 排除 |
 * | 3 | 时长 | **屏级**：`stageSeconds` ∉ 适用窗（缺省 = 固有屏长 ±40%）⇒ 排除；旧 `durationSeconds`（整片）保持原判定不动 |
 * | 4 | 条目数 | 用户列举条目数 > `meta.itemCapacity` ⇒ 排除 |
 * | 5 | 信息充足度 | 内容字数 / 必填槽容量 < **35%**（可配置）⇒ 排除 |
 *
 * ## D2（2026-11-14 拍板）· 模板定位 = 屏级可复用版式单元
 *
 * 模板机制的真实粒度是「一段固定节拍的版式」（2.5–24s），整片单屏叙事撑不起版面 ——
 * 长片里模板**最多吃 2–3 屏**（开场 / 落版 / 罗列），主力必须是「卡 + 格位」（R7 实证）。
 * 所以判据 3 拆两段（RQ-29）：
 * - `stageSeconds`（**必判**）：这一屏分给模板几秒 —— 直接比适用窗；缺省 = 模板自身时长（窗内，不触发）；
 * - `totalSeconds`（**只提示**）：整片多长 —— 只用来估屏数（`TARGET_STAGE_SEC` 节奏），不参与拒收；
 * - 旧 `durationSeconds`：**保持原判定与文案逐字不变**（既有调用兼容），新调用应传 `stageSeconds`。
 *
 * 判据是**部分可算**的：`requirement` 里没给的字段就不判（不给 = 不知道，不是 0）。
 * 一律不通过的模板，调用方走自由编排，并**显式告知**用户（`决策` §5.3）。
 */
import { requiredCapacity, type SlotContract } from './slot-contract.js'
import { MAX_STAGES, TARGET_STAGE_SEC } from './stage-plan.js'
import type { TemplateMeta } from './template-compile.js'

/**
 * 信息充足度的缺省阈值（可配置：真实内容分布校准后可能调整）。
 *
 * 为什么是 35% 而不是 50%：模板槽位容量是**上限**而非期望值，正常内容填充率常年在
 * 40%–70%；定 50% 会把「短小精悍」的真需求误杀。
 */
export const INFO_SUFFICIENCY_MIN_RATIO = 0.35

/** 时长窗缺省半宽（固定片长 ±35%）。**旧 `durationSeconds`（整片）路径专用，冻结不动** —— 既有调用结论逐字不变。 */
export const DURATION_WINDOW_RATIO = 0.35

/**
 * 屏级时长窗缺省半宽（固有屏长 ±40%）。D4 标定初值，标定表见 docs/plans/REQ-038-R7-…md §11.6：
 * 样本 = 10 模板窗 × 39s/45s 两份真实屏表的屏长 + 验收对（45s + ink-open 9s 过 / three-cards 仍拒）。
 * 复核条件：真机出现「模板屏被拉伸失真」样本 ⇒ 收紧；出现合理屏被误拒 ⇒ 放宽。改值只改此处。
 */
export const STAGE_WINDOW_RATIO = 0.4

export type GateCriterion = 'capacity' | 'assets' | 'duration' | 'itemCount' | 'infoSufficiency'

/** 用户方需求（由模型从原话里抽取；未抽取到的字段留空 = 该判据不参与）。 */
export interface TemplateRequirement {
  /** 用户要讲的内容总字数（原话信息量，不含客套）。 */
  contentChars?: number
  /** 用户列举的条目数（「三点」「4 个特性」）。 */
  itemCount?: number
  /** 用户手上有几张素材（图 / 视频）。 */
  assetCount?: number
  /** 目标时长（秒）—— **旧整片口径**，保持原判定不动；屏表调用请改传 `stageSeconds`。 */
  durationSeconds?: number
  /** 这一屏分给模板的秒数（屏表 / 模板屏预留；D2 屏级判定的主入口）。 */
  stageSeconds?: number
  /** 整片总时长（秒）—— 只用于估屏数（提示），不参与拒收。 */
  totalSeconds?: number
}

export interface GateFailure {
  criterion: GateCriterion
  /** **可执行**文案：说清「差多少」+「下一步改什么」。 */
  message: string
}

export interface GateResult {
  pass: boolean
  failures: GateFailure[]
  /** 必填槽容量（诊断用：模型可以据此决定删多少字）。 */
  capacity: number
  /** 信息充足度（0–1；`capacity` 为 0 时记 1 = 不判）。 */
  infoRatio: number
  /** 实际使用的时长窗（秒）。 */
  durationWindow: [number, number]
  /** 整片节奏提示（仅 `totalSeconds` 给了才出；估屏数不参与拒收）。 */
  stageHint?: string
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** 模板的适用时长窗：显式 `durationRange` 优先，否则由固定片长推 ±35%。 */
export function durationWindowOf(meta: TemplateMeta): [number, number] {
  const range = meta.durationRange
  if (Array.isArray(range) && range.length === 2 && positive(range[0]) !== undefined && positive(range[1]) !== undefined) {
    return [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
  }
  const seconds = meta.fps > 0 ? meta.durationInFrames / meta.fps : 0
  if (seconds <= 0) return [0, Number.POSITIVE_INFINITY]
  return [
    Math.round(seconds * (1 - DURATION_WINDOW_RATIO) * 10) / 10,
    Math.round(seconds * (1 + DURATION_WINDOW_RATIO) * 10) / 10,
  ]
}

/** 模板的**屏级**适用窗：显式 `durationRange` 优先，否则由固有屏长推 ±40%（D4 标定）。 */
export function stageWindowOf(meta: TemplateMeta): [number, number] {
  const range = meta.durationRange
  if (Array.isArray(range) && range.length === 2 && positive(range[0]) !== undefined && positive(range[1]) !== undefined) {
    return [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
  }
  const seconds = meta.fps > 0 ? meta.durationInFrames / meta.fps : 0
  if (seconds <= 0) return [0, Number.POSITIVE_INFINITY]
  return [
    Math.round(seconds * (1 - STAGE_WINDOW_RATIO) * 10) / 10,
    Math.round(seconds * (1 + STAGE_WINDOW_RATIO) * 10) / 10,
  ]
}

/**
 * 判一个模板是否装得下这份需求。**纯函数**（无 IO、无时间依赖）⇒ 可单测、可反向变异。
 */
export function gateTemplate(
  meta: TemplateMeta,
  slots: readonly SlotContract[],
  requirement: TemplateRequirement,
  options?: { minInfoRatio?: number },
): GateResult {
  const failures: GateFailure[] = []
  const capacity = requiredCapacity(slots)
  const window = durationWindowOf(meta)
  const label = `${meta.name}（${meta.id}）`

  // ① 容量
  const contentChars = positive(requirement.contentChars)
  if (contentChars !== undefined && capacity > 0 && contentChars > capacity) {
    failures.push({
      criterion: 'capacity',
      message: `内容约 ${String(contentChars)} 字，而${label}的必填槽位总共只装得下 ${String(capacity)} 字 —— `
        + `请删减约 ${String(contentChars - capacity)} 字，或换容量更大的模板`,
    })
  }

  // ② 素材
  const requiredAssets = Array.isArray(meta.requiredAssets) ? meta.requiredAssets : []
  if (requiredAssets.length > 0) {
    const have = positive(requirement.assetCount) ?? 0
    if (have < requiredAssets.length) {
      failures.push({
        criterion: 'assets',
        message: `${label}需要 ${String(requiredAssets.length)} 份素材（${requiredAssets.join(' / ')}），`
          + `你目前有 ${String(have)} 份 —— 先补素材，或换不需要素材的模板`,
      })
    }
  }

  // ③ 时长（D2/RQ-29：屏级 stageSeconds 必判；旧整片 durationSeconds 原判定原文案逐字保留）
  const stageSeconds = positive(requirement.stageSeconds)
  const durationSeconds = positive(requirement.durationSeconds)
  if (stageSeconds !== undefined) {
    const stageWin = stageWindowOf(meta)
    if (Number.isFinite(stageWin[1]) && (stageSeconds < stageWin[0] || stageSeconds > stageWin[1])) {
      failures.push({
        criterion: 'duration',
        message: `这一屏分给模板的 ${String(stageSeconds)}s 不在${label}的屏级适用区间 ${String(stageWin[0])}–${String(stageWin[1])}s 内 —— `
          + `模板是屏级版式单元，要么把这一屏排成 ${String(stageWin[0])}–${String(stageWin[1])}s，要么换更短/更长的模板（整片节奏归屏表管，主力是卡 + 格位）`,
      })
    }
  } else if (durationSeconds !== undefined && Number.isFinite(window[1]) && (durationSeconds < window[0] || durationSeconds > window[1])) {
    failures.push({
      criterion: 'duration',
      message: `目标时长 ${String(durationSeconds)}s 不在${label}的适用区间 ${String(window[0])}–${String(window[1])}s 内 —— `
        + `按 ${String(window[0])}–${String(window[1])}s 出片，或走自由编排按你的时长生成`,
    })
  }

  // ④ 条目数（用户说 4 条、模板 3 卡 ⇒ 第 4 条会被静默丢弃）
  const itemCount = positive(requirement.itemCount)
  const itemCapacity = positive(meta.itemCapacity)
  if (itemCount !== undefined && itemCapacity !== undefined && itemCount > itemCapacity) {
    failures.push({
      criterion: 'itemCount',
      message: `你列了 ${String(itemCount)} 条要点，${label}只有 ${String(itemCapacity)} 个卡片位 —— `
        + `请合并到 ${String(itemCapacity)} 条以内，或换卡片位更多的模板（第 ${String(itemCapacity + 1)} 条及以后会被丢掉）`,
    })
  }

  // ⑤ 信息充足度（内容太少会逼模型编造）
  const minRatio = positive(options?.minInfoRatio) ?? INFO_SUFFICIENCY_MIN_RATIO
  const infoRatio = capacity > 0 && contentChars !== undefined ? contentChars / capacity : 1
  if (capacity > 0 && contentChars !== undefined && infoRatio < minRatio) {
    failures.push({
      criterion: 'infoSufficiency',
      message: `你提供的内容约 ${String(contentChars)} 字，而${label}的必填槽位能装 ${String(capacity)} 字`
        + `（信息充足度 ${String(Math.round(infoRatio * 100))}% < ${String(Math.round(minRatio * 100))}%）—— `
        + '内容太少，剩下的槽位只能靠编造；请先补素材，或改自由编排（不套模板）',
    })
  }

  // 整片节奏提示（只提示不拒收，RQ-29）：totalSeconds 在手时估屏数，模型据此决定模板吃几屏。
  const totalSeconds = positive(requirement.totalSeconds)
  const stageHint = totalSeconds === undefined
    ? undefined
    : (() => {
      const screens = Math.min(MAX_STAGES, Math.max(2, Math.round(totalSeconds / TARGET_STAGE_SEC)))
      const own = meta.fps > 0 ? Math.round((meta.durationInFrames / meta.fps) * 10) / 10 : 0
      return `整片 ${String(totalSeconds)}s ≈ ${String(screens)} 屏（6.5s/屏节奏，上限 40）；${label}固有 ${String(own)}s，长片里最多占 1 屏（其余屏用卡 + 格位拼）`
    })()

  return {
    pass: failures.length === 0,
    failures,
    capacity,
    infoRatio,
    durationWindow: window,
    ...(stageHint === undefined ? {} : { stageHint }),
  }
}
