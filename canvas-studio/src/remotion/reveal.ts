/**
 * P3（2026-11-03）：**分区揭示**（卡片级）—— 纯帧函数 + 校验。
 *
 * 长期缺口：TransitionShell 已有 clipPath/maskImage 原语（转场专用），但「一张卡
 * 自己的擦除显现 / 聚光强调」没有入口，模型只能拿 shape 轨手拼遮罩。本模块把揭示
 * 做成 BaseTrack 级字段 `reveal`，RevealShell 在**轨内局部帧**坐标系按帧求值
 * clip-path。确定性铁律同 animate：不用 CSS transition/@keyframes，全部纯函数，
 * 同一份 manifest 渲两次逐帧一致。
 *
 * timing.ts 在行数棘轮上零余量，故独立成模块（依赖方向 reveal → manifest 仅类型）。
 */
import type { TrackReveal } from './manifest.js'
import { isRecord } from './manifest-track-validate.js'

export const REVEAL_DEFAULT_DURATION_FRAMES = 18
export const REVEAL_SPOTLIGHT_FINAL_RADIUS_PERCENT = 85

const REVEAL_DIRECTIONS = new Set(['left', 'right', 'up', 'down'])

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}

function centerOf(reveal: TrackReveal): { x: number; y: number } {
  const center = reveal.center
  const x = isRecord(center) && typeof center.x === 'number' && Number.isFinite(center.x) ? center.x : 50
  const y = isRecord(center) && typeof center.y === 'number' && Number.isFinite(center.y) ? center.y : 50
  return { x, y }
}

/**
 * 轨内帧 → clip-path 文本（`''` = 揭示完成后的恒等态，不写样式 ⇒ 老路径零开销）。
 *
 * - `wipe`：inset 帘式擦除，`direction` = 揭示行进方向（缺省 `right`，从左往右揭开）；
 * - `spotlight`：circle 从 `center` 半径 0 扩到 85%（clip-path circle 的 % 半径以
 *   参考盒对角线归一，任意画幅下等比成立）。
 *
 * `startFrame` 之前返回**全遮**（内容不可见 —— 揭示没开始就该看不见），走完后恒 `''`。
 */
export function revealClipAt(reveal: TrackReveal, localFrame: number): string {
  const start = typeof reveal.startFrame === 'number' && Number.isFinite(reveal.startFrame)
    ? Math.max(0, Math.floor(reveal.startFrame))
    : 0
  const duration = typeof reveal.durationInFrames === 'number' && Number.isFinite(reveal.durationInFrames) && reveal.durationInFrames > 0
    ? Math.floor(reveal.durationInFrames)
    : REVEAL_DEFAULT_DURATION_FRAMES
  const { x, y } = centerOf(reveal)
  if (localFrame < start) {
    return reveal.kind === 'spotlight'
      ? `circle(0% at ${x}% ${y}%)`
      : 'inset(0 100% 0 0)'
  }
  const p = easeOutCubic(Math.min(1, (localFrame - start) / duration))
  if (p >= 1) return ''
  if (reveal.kind === 'spotlight') {
    return `circle(${(p * REVEAL_SPOTLIGHT_FINAL_RADIUS_PERCENT).toFixed(3)}% at ${x.toFixed(3)}% ${y.toFixed(3)}%)`
  }
  const remaining = ((1 - p) * 100).toFixed(3)
  switch (reveal.direction) {
    case 'left': return `inset(0 0 0 ${remaining}%)` // 从右往左揭开：可见区收在右侧
    case 'up': return `inset(${remaining}% 0 0 0)` // 从下往上揭开：可见区收在底部
    case 'down': return `inset(0 0 ${remaining}% 0)` // 从上往下揭开：可见区收在顶部
    case 'right':
    default: return `inset(0 ${remaining}% 0 0)` // 从左往右揭开：可见区收在左侧
  }
}

/** P3：reveal 配置校验（manifest.ts 通用区接线；`transition` 轨的告警在调用侧）。 */
export function validateReveal(reveal: unknown, at: string, errors: string[], warnings: string[]): void {
  if (!isRecord(reveal)) {
    errors.push(`${at}.reveal 必须是对象（{ kind, direction?, durationInFrames?, startFrame?, center? }）`)
    return
  }
  if (reveal.kind !== 'wipe' && reveal.kind !== 'spotlight') {
    errors.push(`${at}.reveal.kind 只允许 wipe / spotlight（当前：${String(reveal.kind)}）`)
  }
  if (reveal.direction !== undefined && (typeof reveal.direction !== 'string' || !REVEAL_DIRECTIONS.has(reveal.direction))) {
    errors.push(`${at}.reveal.direction 只允许 left / right / up / down`)
  }
  if (reveal.durationInFrames !== undefined) {
    const dur = reveal.durationInFrames
    if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0 || !Number.isInteger(dur)) {
      errors.push(`${at}.reveal.durationInFrames 必须是正整数（帧）`)
    }
  }
  if (reveal.startFrame !== undefined) {
    const start = reveal.startFrame
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || !Number.isInteger(start)) {
      errors.push(`${at}.reveal.startFrame 必须是 >= 0 的整数（轨内相对帧）`)
    }
  }
  if (reveal.center !== undefined) {
    if (!isRecord(reveal.center)) {
      errors.push(`${at}.reveal.center 必须是 { x?, y? }（画布百分比 0–100）`)
    } else {
      for (const axis of ['x', 'y'] as const) {
        const value = reveal.center[axis]
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) {
          errors.push(`${at}.reveal.center.${axis} 必须是 0–100 的有限数（百分比）`)
        }
      }
    }
  }
  if (reveal.kind === 'spotlight' && reveal.direction !== undefined) {
    warnings.push(`${at} 的 reveal 是 spotlight，direction 只对 wipe 生效（已忽略）`)
  }
}
