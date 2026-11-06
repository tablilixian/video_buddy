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
