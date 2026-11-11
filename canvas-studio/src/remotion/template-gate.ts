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
 * | 3 | 时长 | 目标时长 ∉ `meta.durationRange`（缺省 = 固定片长 ±35%）⇒ 排除 |
 * | 4 | 条目数 | 用户列举条目数 > `meta.itemCapacity` ⇒ 排除 |
 * | 5 | 信息充足度 | 内容字数 / 必填槽容量 < **35%**（可配置）⇒ 排除 |
 *
 * 判据是**部分可算**的：`requirement` 里没给的字段就不判（不给 = 不知道，不是 0）。
 * 一律不通过的模板，调用方走自由编排，并**显式告知**用户（`决策` §5.3）。
 */
import { requiredCapacity, type SlotContract } from './slot-contract.js'
import type { TemplateMeta } from './template-compile.js'

/**
 * 信息充足度的缺省阈值（可配置：真实内容分布校准后可能调整）。
 *
 * 为什么是 35% 而不是 50%：模板槽位容量是**上限**而非期望值，正常内容填充率常年在
 * 40%–70%；定 50% 会把「短小精悍」的真需求误杀。
 */
export const INFO_SUFFICIENCY_MIN_RATIO = 0.35

/** 时长窗缺省半宽（固定片长 ±35%）。 */
export const DURATION_WINDOW_RATIO = 0.35

export type GateCriterion = 'capacity' | 'assets' | 'duration' | 'itemCount' | 'infoSufficiency'

/** 用户方需求（由模型从原话里抽取；未抽取到的字段留空 = 该判据不参与）。 */
export interface TemplateRequirement {
  /** 用户要讲的内容总字数（原话信息量，不含客套）。 */
  contentChars?: number
  /** 用户列举的条目数（「三点」「4 个特性」）。 */
  itemCount?: number
  /** 用户手上有几张素材（图 / 视频）。 */
  assetCount?: number
  /** 目标时长（秒）。 */
  durationSeconds?: number
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

  // ③ 时长
  const durationSeconds = positive(requirement.durationSeconds)
  if (durationSeconds !== undefined && Number.isFinite(window[1]) && (durationSeconds < window[0] || durationSeconds > window[1])) {
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

  return { pass: failures.length === 0, failures, capacity, infoRatio, durationWindow: window }
}
