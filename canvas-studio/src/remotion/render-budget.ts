/**
 * 渲染超时预算（从 `timing.ts` 拆出：CV-447 的注释与分档逻辑撞了 1200 行棘轮）。
 *
 * 公式沿用 REQ-034 O-06 的「基线 + 帧×单价」形态，只把单价改成实测口径并加分档系数。
 */
import type { RenderQuality } from './manifest.js'

/** 渲染超时下限 / 上限（毫秒）：短片不至于被误杀，长片也不会挂死。 */
export const RENDER_TIMEOUT_MIN_MS = 90_000
export const RENDER_TIMEOUT_MAX_MS = 20 * 60_000
/**
 * 每帧预算：2026-11-06 真机实测 healthy 画布页 standard 档 209.2ms/帧（45s/1350 帧，
 * 渲染 282.4s）。200ms 的「3.4× 余量」是按 render-host 58ms/帧标定的，对画布页执行器
 * 裕度只有 -4%——那次成功是**贴着 330s 上限**过去的（CV-447）。240ms 给 15% 真实裕度。
 */
export const RENDER_TIMEOUT_PER_FRAME_MS = 240
/**
 * 分档系数：high 与 standard 同 scale（同分辨率、同帧成本），但码率/关键帧间隔更密
 * （2s vs 5s）+ prefer-hardware 编码器初始化，留 15%；draft 实测 131.9ms/帧，
 * 0.7×240=168ms 覆盖。**系数待真机 high 档实测回填**（方案 §卡点③）。
 */
export const RENDER_TIMEOUT_QUALITY_FACTOR: Readonly<Record<RenderQuality, number>> = {
  draft: 0.7,
  standard: 1,
  high: 1.15,
}
/** 固定开销（字体注入、能力探测、ffprobe 复核、落盘）。 */
export const RENDER_TIMEOUT_BASE_MS = 60_000

/**
 * 按**帧数**推导渲染工单超时（REQ-034 O-06 口径，替换二期 D-04）。
 *
 * 公式：`clamp(帧数 × 240ms × 分档系数 + 60s, 90s, 20min)`。
 *
 * 为什么从「2 × 秒数 + 120s，10–30min」换成按帧：软编的耗时基本随**帧数**线性走，
 * 与 fps 无关（同一 600 帧，30fps 是 20s 片、60fps 是 10s 片，渲染成本相同）。
 * 旧公式按秒算 ⇒ 高 fps 片子的预算被平白砍半。
 *
 * 旧下限 10 分钟是本次真机事故的主因：一个 20s 片 standard 档只要 35s，挂死时却要
 * 等满 10 分钟才报错（评审 P1-5 记录了 agent 因此两次让用户「把画布切到前台」）。
 * 新下限 90s 仍比实测慢 3×，但把最坏等待从 10 分钟压到 1.5 分钟。
 */
export function renderTimeoutMs(durationInFrames: number, quality: RenderQuality = 'standard'): number {
  const frames = Number.isFinite(durationInFrames) ? Math.max(0, durationInFrames) : 0
  const factor = RENDER_TIMEOUT_QUALITY_FACTOR[quality] ?? 1
  const raw = frames * RENDER_TIMEOUT_PER_FRAME_MS * factor + RENDER_TIMEOUT_BASE_MS
  return Math.round(Math.min(RENDER_TIMEOUT_MAX_MS, Math.max(RENDER_TIMEOUT_MIN_MS, raw)))
}

/**
 * CV-449（P0-C）：总预算到期但进度仍在推进时，续期量的余量系数。
 *
 * 已渲比例算出的「每帧成本」只对**已渲的那部分**成立；后续段落可能才出现重轨
 * （真机：前 300 帧只有 3 条轨在动，后面 41 轨同时动画），所以按剩余工作量给 40%
 * 余量，而不是按剩余时间原样续。
 */
export const RENDER_TIMEOUT_EXTEND_HEADROOM = 1.4

/** 单次续期下限：低于这个数会让 timer 在「刚续期就到期」之间空转。 */
export const RENDER_TIMEOUT_EXTEND_MIN_MS = 15_000

/** `timeoutExtensionMs` 的入参（全部来自工单上已有字段，纯函数便于单测）。 */
export interface TimeoutExtensionInput {
  /** 已渲到的最大进度（0–1）。 */
  maxProgress: number
  /** 派发时刻。 */
  dispatchedAt: number
  /** 最近一次进度变化时刻。 */
  lastProgressAt: number
  /** 进度停滞判死阈值。 */
  progressStallMs: number
  /** 现在。 */
  now: number
}

/**
 * 总预算到期时的**判活**：这一单还该不该继续等。
 *
 * 背景（2026-11-06 真机）：45s 片 draft 预算 `1350×240×0.7+60s = 287s`；内容加了
 * 32 条 exit + 12 条 reveal 后实测 ≈215ms/帧、需要 ≈378s，于是**连续 6 次渲到
 * 76–85% 被准点砍掉**。而进度一直在涨 —— 它没卡死，只是比静态单价贵。
 *
 * 判据只有两条，全部复用已有字段：
 * - `maxProgress === 0` ⇒ 一帧都没出过，**不是「在渲只是慢」**，交回原结算
 *   （「取单没动」由 `clientJobOrphanReason` 管，口径不重复）；
 * - 距上次进度超过 `progressStallMs` ⇒ 进度真停了，同样交回原结算（那是卡死）。
 *
 * 续期量按**剩余工作比例**推：`elapsed × (1-p)/p × headroom`，再受绝对上限
 * `RENDER_TIMEOUT_MAX_MS` 约束 —— 每帧越来越慢的病态情况也不会无限续期。
 *
 * @returns 要续期的毫秒数；`null` = 不该续期，照旧按超时结算。
 */
export function timeoutExtensionMs(
  input: TimeoutExtensionInput,
  options: { minMs?: number } = {},
): number | null {
  const { maxProgress, dispatchedAt, lastProgressAt, progressStallMs, now } = input
  if (!Number.isFinite(maxProgress) || maxProgress <= 0 || maxProgress >= 1) return null
  if (!Number.isFinite(now) || !Number.isFinite(dispatchedAt) || !Number.isFinite(lastProgressAt)) {
    return null
  }
  // 进度停了 = 真卡死。判据只有 `progressStallMs` 一处，别在这里再造一个。
  if (now - lastProgressAt >= progressStallMs) return null
  const elapsed = now - dispatchedAt
  if (elapsed <= 0) return null
  // `minMs` 只给测试注入短阈值（生产恒为 RENDER_TIMEOUT_EXTEND_MIN_MS）：
  // 下限 15s 是「别在刚续期又到期之间空转」，而单测不可能真等 15s。
  const minMs = options.minMs ?? RENDER_TIMEOUT_EXTEND_MIN_MS
  // 绝对上限：本单从派发起算最多等 RENDER_TIMEOUT_MAX_MS。
  const remainingToHardMax = RENDER_TIMEOUT_MAX_MS - elapsed
  if (remainingToHardMax <= minMs) return null
  const projected = elapsed * ((1 - maxProgress) / maxProgress) * RENDER_TIMEOUT_EXTEND_HEADROOM
  const extend = Math.round(projected)
  if (!Number.isFinite(extend) || extend < minMs) return null
  return Math.min(extend, remainingToHardMax)
}
