/**
 * P2'（2026-11-03）：dataCard **数位滚动**的纯帧函数（零 Remotion 依赖、零 DOM）。
 *
 * 抓的是什么：shot-cards 缺口清单 DigitRoll —— 之前只能多轨文本阶跃近似（F6）。
 * 数值从 0 缓出滚到目标值是 KPI 揭晓的标准语言；这里把「解析 + 插值 + 格式化」
 * 收进纯函数，组件只取字符串，`node --test` 可直接覆盖。
 *
 * 解析口径（刻意从严）：`v` 必须是「前后缀 + **恰好一段**连续数字」——`16%` /
 * `¥3.2` / `45.1亿` 可滚；含两段数字（`12abc34`）或纯文案的 v **静态返回原串**
 * （容错不报错：数位滚动是增强，不是数据校验器；保真纪律由 chart/dataCard 的
 * 「数据显式声明」承担）。小数位与目标值对齐（`3.2` 滚动全程保留 1 位小数）。
 */

/** 滚动时长（帧，缺省 45 ≈ 1.5s@30fps，easeOutCubic 收尾）。 */
export const COUNT_UP_DURATION_FRAMES = 45

/** 恰好一段数字（可带负号/小数），前后缀均为非数字字符。 */
const COUNT_UP_PATTERN = /^(\D*?)(-?\d+(?:\.\d+)?)(\D*)$/

/**
 * `frame` 帧时的 dataCard 数值文本（纯函数）。
 *
 * - `v` 不可解析（无数字 / 多段数字）→ 原样返回（静态）；
 * - `frame <= 0` → 前后缀 + 0；`frame >= durationInFrames` → 原值精确收敛（端点不漂）；
 * - 缓出：`value = target × (1 − (1 − p)³)`，p = frame / durationInFrames 线性。
 */
export function countUpTextAt(v: string, frame: number, durationInFrames: number = COUNT_UP_DURATION_FRAMES): string {
  const match = COUNT_UP_PATTERN.exec(v)
  if (match === null) return v
  const prefix = match[1] ?? ''
  const digits = match[2] ?? '0'
  const suffix = match[3] ?? ''
  const target = Number(digits)
  if (!Number.isFinite(target)) return v
  const p = Number.isFinite(frame) && frame > 0
    ? Math.min(1, frame / Math.max(1, durationInFrames))
    : 0
  const eased = 1 - Math.pow(1 - p, 3)
  const decimals = digits.includes('.') ? (digits.split('.')[1] ?? '').length : 0
  return prefix + (target * eased).toFixed(decimals) + suffix
}
