/**
 * B1（REQ-038 · R7 后续）· **屏数原语**：`planStages()` 纯函数。
 *
 * ## 解决什么
 *
 * 流程推演 §3 的归因：屏数与屏长今天「靠模型在 sections[] 里自觉」—— 真机 45s
 * 模型数对了 6 屏，但屏长 3.4–12.7s 离散 3.7×，没有节奏可言。本模块把「45 秒该切
 * 几屏、每屏几秒」变成**算出来的**：
 *
 * - 屏数 = `clamp(round(totalSeconds / TARGET_STAGE_SEC), MIN_STAGES, MAX_STAGES)`；
 * - 等分后每个内部边界向 TTS 句起点（`boundaries`，来自 tts_narration 回执的
 *   `audio.voiceOver[]` 真实帧号）在 ±0.6s 内吸附 —— 字幕压屏的前提是屏与句对齐；
 *   超出容差不迁就（宁可等分，也不让屏边界跟着一句 3 秒外的台词跑）；
 * - 不足 `MIN_STAGE_SEC` 合并、超出 `MAX_STAGE_SEC` 拆分（guard 步骤，默认参数下
 *   等分 6.5s 落在 4–10s 内，此步只在自定义参数或吸附造成极短屏时触发）。
 *
 * ## 纪律
 *
 * - **纯函数**：无 IO、无时钟、无随机；同入参 ⇒ 同出参（逐字段深比较相等）。
 * - 帧为唯一时间单位（整数）；秒只在入参/常量层出现。
 * - 非法入参**抛错**，不静默降级（铁律 5）。
 * - 45s → 7 屏 × 6.4s；304s → 触到 40 屏上限并标 `clamped`（验收口径）。
 */

/** 目标屏长（秒）。来源：短视频节奏基准，详见 docs/plans/REQ-038-R7-版面层屏表-需求增补-20261113.md §1。
 * D4：改值只改这一处，并在 docs/plans 的标定表回填复核条件。 */
export const TARGET_STAGE_SEC = 6.5
/** 单屏下限（秒）：低于此值的屏是闪帧，合并掉。 */
export const MIN_STAGE_SEC = 4
/** 单屏上限（秒）：超出此值的屏信息密度失衡，拆掉。 */
export const MAX_STAGE_SEC = 10
/** 屏数下限：再短的片也至少两个屏（单屏 = 幻灯片，不是视频）。 */
export const MIN_STAGES = 2
/** 屏数上限：40 屏 ≈ 4.3 分钟全 6.5s 屏，再长就该拆需求而不是拆屏。 */
export const MAX_STAGES = 40
/** 边界吸附容差（秒）：TTS 句起点距等分边界 ≤0.6s 才吸附。 */
export const SNAP_TOLERANCE_SEC = 0.6

/** 一屏在时间轴上的窗（帧）。 */
export interface StageSlot {
  /** 屏序号（0 起，按时间升序）。 */
  index: number
  /** 首帧（含）。 */
  startFrame: number
  /** 帧数（Σ 全部 stages == round(totalSeconds * fps)）。 */
  durationInFrames: number
}

/** 屏表元信息（诊断用；工具回执原文带出，让模型看见工具替它做了什么决定）。 */
export interface StagePlanMeta {
  /** 未夹取的目标屏数（round(totalSeconds / targetStageSec)）。 */
  target: number
  /** target 越出 [MIN_STAGES, MAX_STAGES] 或越出单屏可行带（ceil(total/max)…floor(total/min)）被拉回时 true（304s → 47 → 40）。 */
  clamped: boolean
  /** 被并入该屏的**原始屏号**（按初始等分枚举，0 起）；没发生过合并的屏不出现在键里。 */
  absorbedBy: Record<number, number[]>
}

/** 屏表（planStages 的产物）。 */
export interface StagePlan {
  stages: StageSlot[]
  meta: StagePlanMeta
}

export interface PlanStagesInput {
  /** 总时长（秒）。 */
  totalSeconds: number
  /** 帧率（fps > 0）。 */
  fps: number
  /**
   * TTS 句起点（**帧号**，升序；来自 tts_narration 回执 `audio.voiceOver[]`）。
   * 缺省 = 不吸附，纯等分。
   */
  boundaries?: readonly number[]
  /** 目标屏长（秒）；缺省 TARGET_STAGE_SEC。 */
  targetStageSec?: number
  /** 单屏下限（秒）；缺省 MIN_STAGE_SEC。 */
  minStageSec?: number
  /** 单屏上限（秒）；缺省 MAX_STAGE_SEC。 */
  maxStageSec?: number
}

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0

/**
 * planStages 的输入/值域错误。为什么是自定义类而不是 `throw new Error`：
 * `tests/error-system-guards.test.mjs` 禁止 `src/**` 裸抛；也不用 `throwError('CS-…')` ——
 * 纯函数不反向依赖 error-system（同 `TemplateRegistryError` 的口径）。
 * **转换点只有一个**：`validateContentSpec` 的 catch 把它变成 spec 校验错误回给模型。
 */
export class StagePlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StagePlanError'
  }
}

/** 由内部边界数组推出各屏窗（cuts 长度 = 屏数 - 1；0 与 totalFrames 隐含）。 */
function stagesFromCuts(cuts: readonly number[], totalFrames: number): StageSlot[] {
  const stages: StageSlot[] = []
  let cursor = 0
  for (let i = 0; i <= cuts.length; i++) {
    const end = i < cuts.length ? (cuts[i] as number) : totalFrames
    stages.push({ index: i, startFrame: cursor, durationInFrames: Math.max(1, end - cursor) })
    cursor = end
  }
  return stages
}

/** 把一个内部边界吸附到最近的 TTS 句起点；容差外原样返回（不迁就）。 */
function snapCut(cut: number, boundaries: readonly number[], tolFrames: number, lower: number, upper: number): number {
  let best: number | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const boundary of boundaries) {
    const dist = Math.abs(boundary - cut)
    if (dist < bestDist || (dist === bestDist && best !== undefined && boundary < best)) {
      best = boundary
      bestDist = dist
    }
  }
  if (best === undefined || bestDist > tolFrames) return cut
  // 吸附后不得越过邻界（保持严格递增）；越界即回退等分值。
  if (best <= lower || best >= upper) return cut
  return best
}

/**
 * 算屏表。见模块头注释；非法入参抛 `Error`（含 `planStages:` 前缀便于定位）。
 */
export function planStages(input: PlanStagesInput): StagePlan {
  const { totalSeconds, fps } = input
  if (!isFinitePositive(totalSeconds)) throw new StagePlanError(`planStages: totalSeconds 必须是正有限数，收到 ${String(totalSeconds)}`)
  if (!isFinitePositive(fps)) throw new StagePlanError(`planStages: fps 必须是正有限数，收到 ${String(fps)}`)
  const targetStageSec = input.targetStageSec ?? TARGET_STAGE_SEC
  const minStageSec = input.minStageSec ?? MIN_STAGE_SEC
  const maxStageSec = input.maxStageSec ?? MAX_STAGE_SEC
  if (!isFinitePositive(targetStageSec)) throw new StagePlanError(`planStages: targetStageSec 必须是正有限数，收到 ${String(targetStageSec)}`)
  if (!isFinitePositive(minStageSec)) throw new StagePlanError(`planStages: minStageSec 必须是正有限数，收到 ${String(minStageSec)}`)
  if (!isFinitePositive(maxStageSec)) throw new StagePlanError(`planStages: maxStageSec 必须是正有限数，收到 ${String(maxStageSec)}`)
  if (minStageSec > maxStageSec) {
    throw new StagePlanError(`planStages: minStageSec(${String(minStageSec)}) 不能大于 maxStageSec(${String(maxStageSec)})`)
  }

  const totalFrames = Math.round(totalSeconds * fps)
  const minFrames = Math.round(minStageSec * fps)
  const maxFrames = Math.round(maxStageSec * fps)
  // 值域下限：屏数下限是 2，两屏各 ≥ 下限 ⇒ 总时长至少 2×min —— 不到就明说，不静默切出闪帧屏。
  if (totalFrames < 2 * minFrames) {
    throw new StagePlanError(`planStages: 总时长 ${String(totalSeconds)}s 装不下 2 屏 × ${String(minStageSec)}s 下限 —— 开 autoStages 的片至少要 ${String(2 * minStageSec)}s，更短请关掉自己排`)
  }
  // 值域上限：屏数上限 40 × 单屏上限 —— 超过说明需求该拆（5min 已是既有证据基线的长度上限）。
  if (totalFrames > MAX_STAGES * maxFrames) {
    throw new StagePlanError(`planStages: 总时长 ${String(totalSeconds)}s 超出 autoStages 值域上限（${String(MAX_STAGES)} 屏 × ${String(maxStageSec)}s = ${String(MAX_STAGES * maxStageSec)}s）—— 更长的片请拆需求，或关掉 autoStages 自己排`)
  }

  const rawBoundaries = input.boundaries
  if (rawBoundaries !== undefined) {
    if (!Array.isArray(rawBoundaries)) throw new StagePlanError('planStages: boundaries 必须是帧号数组')
    for (let i = 0; i < rawBoundaries.length; i++) {
      const value = rawBoundaries[i] as number
      if (!Number.isInteger(value) || value < 0 || value > totalFrames) {
        throw new StagePlanError(`planStages: boundaries[${String(i)}] 必须是 [0, ${String(totalFrames)}] 内的整数帧号，收到 ${String(value)}`)
      }
      if (i > 0 && (value as number) <= (rawBoundaries[i - 1] as number)) {
        throw new StagePlanError(`planStages: boundaries 必须严格升序，[${String(i - 1)}]=${String(rawBoundaries[i - 1])} ≥ [${String(i)}]=${String(value)}`)
      }
    }
  }

  // ① 屏数：round(total / 目标屏长)，夹到 [MIN_STAGES, MAX_STAGES]。
  const target = Math.round(totalSeconds / targetStageSec)
  const count = Math.min(MAX_STAGES, Math.max(MIN_STAGES, target))
  // ①′ 可行带：单屏必须落在 [min,max] ⇒ 屏数必须落在 [ceil(total/max), floor(total/min)]。
  //    目标屏数越出可行带就拉回带内 —— 「不足合并、超出拆分」的等价确定性实现：先把屏数
  //    算对再等分，比「先等分再贪心合并/拆分」少一轮震荡（贪心合并可能造出拆不动的超长屏）。
  const countMin = Math.max(MIN_STAGES, Math.ceil(totalFrames / maxFrames))
  const countMax = Math.max(countMin, Math.floor(totalFrames / minFrames))
  const stageCount = Math.min(countMax, Math.max(countMin, count))
  const clamped = target !== stageCount

  // ② 等分（前 n-1 刀四舍五入，末屏吃余数 —— 与 planRecipe 的 Σ 自洽口径一致）。
  let cuts: number[] = []
  for (let i = 1; i < stageCount; i++) cuts.push(Math.round((i * totalFrames) / stageCount))

  // ③ 吸附：每个内部边界向最近的 TTS 句起点靠（±0.6s 内才动）；从左到右处理，
  //    下界用**已接受**的左刀、上界用**未吸附**的右邻 —— 右刀不牵引左刀（行为可
  //    逐字段复算），左刀接受值做下界则保证两刀不会吸到同一点（零宽屏）。
  if (rawBoundaries !== undefined && rawBoundaries.length > 0) {
    const tolFrames = Math.round(SNAP_TOLERANCE_SEC * fps)
    const snapped: number[] = []
    for (let i = 0; i < cuts.length; i++) {
      const lower = i === 0 ? 0 : (snapped[i - 1] as number)
      const upper = i === cuts.length - 1 ? totalFrames : (cuts[i + 1] as number)
      snapped.push(snapCut(cuts[i] as number, rawBoundaries, tolFrames, lower, upper))
    }
    cuts = snapped
  }

  // origins[i] = 构成当前屏的原始屏号（初始等分枚举）；合并时追加，拆分时首段独占。
  let origins: number[][] = stagesFromCuts(cuts, totalFrames).map((stage) => [stage.index])

  // ④ guard：不足下限合并（优先并入左邻；首屏短则吞右邻）、超出上限拆分。
  //    两个修复都收敛（合并严格减屏数；拆分的每段 ≤ maxFrames），保险计数只是兜底
  //    —— 兜底耗尽必须抛错，静默交出一张烂屏表比抛错更糟（铁律 5）。
  const guardMax = 4 * (MAX_STAGES + stageCount)
  for (let guard = 0; ; guard++) {
    if (guard >= guardMax) {
      throw new StagePlanError(`planStages: 合并/拆分修复不收敛（guard ${String(guardMax)} 次耗尽）—— 参数病态：min=${String(minStageSec)}s max=${String(maxStageSec)}s total=${String(totalSeconds)}s`)
    }
    const stages = stagesFromCuts(cuts, totalFrames)
    const shortIndex = stages.findIndex((stage) => stage.durationInFrames < minFrames)
    if (shortIndex >= 0) {
      // 只剩两屏时不再合并 —— 屏数下限 2 优先于屏长下限（短片宁可有一屏略短，也不并成单屏幻灯片）。
      if (cuts.length <= 1) break
      const removeAt = shortIndex > 0 ? shortIndex - 1 : 0
      origins[removeAt] = [...(origins[removeAt] as number[]), ...(origins[removeAt + 1] as number[])]
      origins.splice(removeAt + 1, 1)
      cuts.splice(removeAt, 1)
      continue
    }
    const longIndex = stages.findIndex((stage) => stage.durationInFrames > maxFrames)
    if (longIndex >= 0) {
      const stage = stages[longIndex] as StageSlot
      // 先按「每段 ≤ 上限」取段数；若那样每段会跌破下限（min > max/2 的病态配置），
      // 退而取「每段 ≥ 下限」的最大段数 —— 拆不动就交给循环后的硬检查抛错。
      let parts = Math.ceil(stage.durationInFrames / maxFrames)
      if (stage.durationInFrames / parts < minFrames) {
        parts = Math.floor(stage.durationInFrames / minFrames)
      }
      if (parts <= 1) break
      const inserted: number[] = []
      for (let j = 1; j < parts; j++) inserted.push(stage.startFrame + Math.round((j * stage.durationInFrames) / parts))
      origins[longIndex] = [origins[longIndex]![0] as number]
      for (let j = 1; j < parts; j++) origins.splice(longIndex + j, 0, [])
      cuts.splice(longIndex, 0, ...inserted)
      continue
    }
    break
  }

  // 硬检查：拆不动（超上限）的屏表不能交出去 —— 宁可报错让调用方调参，不给烂节奏。
  {
    const finalStages = stagesFromCuts(cuts, totalFrames)
    const overflow = finalStages.find((stage) => stage.durationInFrames > maxFrames)
    if (overflow !== undefined) {
      throw new StagePlanError(`planStages: 节奏窗口装不下 —— minStageSec=${String(minStageSec)}s / maxStageSec=${String(maxStageSec)}s 时总时长 ${String(totalSeconds)}s 只能落在 ${String(finalStages.length)} 屏、最长 ${String(Math.round((overflow.durationInFrames / fps) * 100) / 100)}s（超上限）—— 放宽窗口或调总时长`)
    }
  }

  const stages = stagesFromCuts(cuts, totalFrames)
  const absorbedBy: Record<number, number[]> = {}
  stages.forEach((_, i) => {
    const merged = (origins[i] as number[]).slice(1)
    if (merged.length > 0) absorbedBy[i] = merged
  })
  return {
    stages: stages.map((stage, i) => ({ index: i, startFrame: stage.startFrame, durationInFrames: stage.durationInFrames })),
    meta: { target, clamped, absorbedBy },
  }
}
