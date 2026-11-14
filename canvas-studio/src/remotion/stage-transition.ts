/**
 * B4（REQ-038 R7 后续 · D1 方案②）· **段间转场**：在 compose 层给相邻屏插既有
 * `transition` 轨（**不新增轨类型**，`fade` 效果 = 逐帧 opacity 交叉叠化）。
 *
 * ## 解决什么
 *
 * 卡生成器不给 `exit`，段末直切 —— 真机 45s 与 spec 45s 都是 12 条 ML-02
 * 「戛然而止」，观感是「一张卡啪地换掉」。D1 拍板：在 compose 层加段间转场，
 * **不改 56 张卡的生成器**（§11.5 有 git diff 佐证）。
 *
 * ## 机制（与 `P1-3 startAfter 与转场互斥` 同一口径）
 *
 * - `transition` 轨的 `fromTrackId`/`toTrackId` 引用**相邻两屏的既有轨**；
 * - 叠化需要重叠窗口：下一屏（to 侧）的内容轨整体左移 T 帧（`startFrame -= T`、
 *   `durationInFrames += T`，末端不变），上一屏（from 侧）的轨原样不动 ——
 *   重叠窗 `[boundary - T, boundary]` 就是交叉叠化期，边界帧 = 叠化中点；
 * - 这里**不用** `startAfter`：本层已算出绝对帧，显式 startFrame 与 startAfter
 *   互斥（manifest 校验三期 W1-2），走显式帧避免互斥陷阱；
 * - **from 侧右延到边界帧**（`durationInFrames += boundary - trackEnd`）：卡内部轨的
 *   末端带固定偏移（chart 提前 6 帧收等），不延就死在叠化窗之前 = 硬切照旧；延到
 *   边界帧后整屏所有轨都活过窗口，渐隐恰好完成在转场终点；
 * - 配对按 `max(fromCount, toCount)` 轮转（`i % len`），保证每条轨至少被一个
 *   转场覆盖（from 侧逐轨渐隐、to 侧逐轨渐显）；to 侧只配「左移 T 后起点已越过
 *   边界帧」的轨（内部偏移 δ < T）—— 偏移 ≥ T 的晚入场轨起于叠化窗之后，
 *   与 from 侧完全不相交（manifest rule 4 直接 error），且它们本来就不是
 *   屏边界切变的一部分（卡内部自己的入场节拍管它们）；
 * - `bg` / `carry`（全片底色与常驻层）**不参与**：常驻层的定义就是跨屏不变。
 *
 * ## 口径
 *
 * - 只动 compose 层产出的轨对象（每次 planFromSpec 新建），**不改卡生成器**；
 * - 纯函数式：输入轨数组被原地左移（它们是本次编译新建的），返回新增的转场轨；
 * - `STAGE_TRANSITION_FRAMES = 10`：任务拍板默认 6–10 帧，取上限（≥ MIN_VISIBLE_OVERLAP_FRAMES=6，
 *   不触发 ML-06；ML-06 hint 建议 12–20 是给手写轨的）。改值只改这一处常量。
 */

/** 段间叠化帧数（缺省）。6–10 帧拍板区间的上限；≥ MIN_VISIBLE_OVERLAP_FRAMES(6) 不触发 ML-06。 */
export const STAGE_TRANSITION_FRAMES = 10

/** compose 层产出的一屏轨清单（元素为卡生成器 / 占位回落产出的原始轨对象）。 */
type ScreenTracks = readonly Record<string, unknown>[]

const numeric = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export interface ApplyStageTransitionsInput {
  /**
   * 按屏序排列的轨清单（每屏 = 卡 / 单元投影出的**内容轨**，不含全片 bg 与 carry）。
   * to 侧轨会被原地左移 T 帧（它们是本次编译新建的对象，调用方不复用）。
   */
  screens: readonly ScreenTracks[]
  /** 各屏的边界帧（timeline 的 startFrame；第 0 屏的值不使用）。长度必须与 screens 一致。 */
  boundaryFrames: readonly number[]
  /**
   * 全片末帧（meta.durationInFrames）：**末屏**的内容轨右延到它 —— 末屏没有下一边界，
   * 内部轨带偏移的末端会在片尾前几帧硬切（ML-02 的最后一处来源）；延到片尾 = 收尾屏
   * 静止持到黑场前，观感正确。
   */
  filmEndFrame?: number
  /** 叠化帧数；缺省 STAGE_TRANSITION_FRAMES。 */
  transitionFrames?: number
}

/**
 * 给相邻屏插交叉叠化转场。返回新增的 transition 轨（追加到 manifest.tracks 尾部；
 * transition 轨自身不可见，DOM 顺序无关）。屏数 < 2 或某屏没有内容轨时该边界跳过
 * （没有可引用的轨就诚实地不造转场，不静默造一个指空引用的坏轨）。
 */
export function applyStageTransitions(input: ApplyStageTransitionsInput): Record<string, unknown>[] {
  const { screens, boundaryFrames } = input
  const t = input.transitionFrames ?? STAGE_TRANSITION_FRAMES
  if (!Number.isInteger(t) || t < 1) {
    throw new StageTransitionError(`stage-transition: transitionFrames 必须是正整数，收到 ${String(t)}`)
  }
  if (screens.length !== boundaryFrames.length) {
    throw new StageTransitionError(`stage-transition: screens(${String(screens.length)}) 与 boundaryFrames(${String(boundaryFrames.length)}) 数量不一致`)
  }
  const transitions: Record<string, unknown>[] = []
  for (let k = 1; k < screens.length; k++) {
    const prev = screens[k - 1] as ScreenTracks
    const cur = screens[k] as ScreenTracks
    const boundary = boundaryFrames[k] as number
    const windowStart = boundary - t
    if (windowStart < 0) continue
    if (prev.length === 0 || cur.length === 0) continue
    // from 侧右延到边界帧：内部轨末端带偏移（chart 提前 6 帧收等），不延就死在叠化窗之前。
    // 残缺轨（缺 startFrame/durationInFrames）跳过不改写 —— trackEnd 会把它们当 0 算出假 gap。
    for (const track of prev) {
      const start = numeric(track.startFrame)
      const duration = numeric(track.durationInFrames)
      if (start === undefined || duration === undefined) continue
      const gap = boundary - (start + duration)
      if (gap > 0) track.durationInFrames = duration + gap
    }
    // to 侧候选：内部偏移 δ < T 的轨（左移后起点越过边界帧，与 from 侧有真实重叠）。
    const toCandidates = cur.filter((track) => (numeric(track.startFrame) ?? 0) - boundary < t)
    if (toCandidates.length === 0) continue
    const pairCount = Math.max(prev.length, toCandidates.length)
    for (let i = 0; i < pairCount; i++) {
      const from = prev[i % prev.length] as Record<string, unknown>
      const to = toCandidates[i % toCandidates.length] as Record<string, unknown>
      transitions.push({
        id: `trans-${String(k)}-${String(i)}`,
        type: 'transition',
        effect: 'fade',
        fromTrackId: String(from.id),
        toTrackId: String(to.id),
        startFrame: windowStart,
        durationInFrames: t,
      })
    }
    // to 侧整屏左移 T 帧（末端不变）：重叠窗就是叠化期，边界帧回到「下一屏完整可见」的时刻。
    for (const track of cur) {
      const start = numeric(track.startFrame)
      const duration = numeric(track.durationInFrames)
      if (start === undefined || duration === undefined) continue
      track.startFrame = Math.max(0, start - t)
      track.durationInFrames = duration + (start - (track.startFrame as number))
    }
  }
  // 末屏右延到片尾（没有下一边界，靠显式延长消除片尾前几帧的内部轨硬切）。
  const filmEnd = input.filmEndFrame
  if (filmEnd !== undefined && screens.length > 0) {
    const last = screens[screens.length - 1] as ScreenTracks
    for (const track of last) {
      const start = numeric(track.startFrame)
      const duration = numeric(track.durationInFrames)
      if (start === undefined || duration === undefined) continue
      const gap = filmEnd - (start + duration)
      if (gap > 0) track.durationInFrames = duration + gap
    }
  }
  return transitions
}

/**
 * stage-transition 的输入错误。自定义类而非裸抛（error-system-guards 静态守卫）；
 * 本模块是纯 compose 函数，不反向依赖 error-system（同 `StagePlanError` / `TemplateRegistryError` 口径）。
 */
export class StageTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageTransitionError'
  }
}
