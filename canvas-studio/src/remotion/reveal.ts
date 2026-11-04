/**
 * P3（2026-11-03）：**分区揭示**（卡片级）—— 纯帧函数 + 校验。
 *
 * 长期缺口：TransitionShell 已有 clipPath/maskImage 原语（转场专用），但「一张卡
 * 自己的擦除显现 / 聚光强调」没有入口，模型只能拿 shape 轨手拼遮罩。本模块把揭示
 * 做成 BaseTrack 级字段 `reveal`，RevealShell 在**轨内局部帧**坐标系按帧求值
 * clip-path。确定性铁律同 animate：不用 CSS transition/@keyframes，全部纯函数，
 * 同一份 manifest 渲两次逐帧一致。
 *
 * 2026-11-04（P2 · 科普 0.1 验收 A5）：补**退场擦除** `reveal.out`。
 * 原缺口：`direction` 只描述**进场**方向，而 `exit` 又只支持 opacity/scale/rotation/x/y
 * （**不支持 clip 退场**）⇒「朝某侧擦出去」没有表达手段。实测：右面板要"右 wipe 出"
 * 只能写 `direction:"right"`，而那是**进场**方向 ⇒ 视觉正好相反（面板自左向右展开，
 * 而不是向右退去）。
 *
 * ⚠️ **两个方向不是同一口径**（本模块最容易踩的坑）：
 * - `direction`（进场）= 可见区**展开**的行进方向 ⇒ 隐藏侧 = 该方向；
 * - `out.direction`（退场）= 内容**退去**的方向 ⇒ 隐藏侧 = 该方向的对侧。
 *
 * timing.ts 在行数棘轮上零余量，故独立成模块（依赖方向 reveal → manifest 仅类型）。
 */
import type { TrackReveal, TrackRevealOut } from './manifest.js'
import { isRecord } from './manifest-track-validate.js'

export const REVEAL_DEFAULT_DURATION_FRAMES = 18
export const REVEAL_OUT_DEFAULT_DURATION_FRAMES = 18
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

/** clip-path 的四个内缩侧。 */
type ClipSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * 进场方向的**隐藏侧**：可见区自该方向展开 ⇒ 该侧被遮住。
 *
 * `left` → `inset(0 0 0 N%)`（遮左侧，可见区收在右侧）、
 * `right` → `inset(0 N% 0 0)`（遮右侧，可见区收在左侧）、
 * `up` → `inset(N% 0 0 0)`（遮顶部，可见区收在底部）、
 * `down` → `inset(0 0 N% 0)`（遮底部，可见区收在顶部）。
 */
function revealHiddenSide(direction: TrackReveal['direction']): ClipSide {
  switch (direction) {
    case 'left': return 'left'
    case 'up': return 'top'
    case 'down': return 'bottom'
    case 'right':
    default: return 'right'
  }
}

/** 退场方向的**隐藏侧**：内容朝该侧退去 ⇒ 遮住的是**对侧**。 */
function revealOutHiddenSide(direction: TrackRevealOut['direction']): ClipSide {
  switch (direction) {
    case 'left': return 'right'
    case 'up': return 'bottom'
    case 'down': return 'top'
    case 'right':
    default: return 'left'
  }
}

/** 进场遮蔽量（0–100）：揭示未开始 = 100，走完 = 0。 */
function revealHiddenPercent(reveal: TrackReveal, localFrame: number): number {
  const start = typeof reveal.startFrame === 'number' && Number.isFinite(reveal.startFrame)
    ? Math.max(0, Math.floor(reveal.startFrame))
    : 0
  const duration = typeof reveal.durationInFrames === 'number' && Number.isFinite(reveal.durationInFrames) && reveal.durationInFrames > 0
    ? Math.floor(reveal.durationInFrames)
    : REVEAL_DEFAULT_DURATION_FRAMES
  if (localFrame < start) return 100
  const p = easeOutCubic(Math.min(1, (localFrame - start) / duration))
  return (1 - p) * 100
}

/**
 * 退场擦除区间（纯函数）：轨内相对帧 `[start, start + duration)`。
 *
 * 锚定方式与 `exit` 同口径：`[轨长 - gapFrames - durationInFrames, 轨长 - gapFrames)`。
 * `gapFrames` = 距轨道末尾的提前量（缺省 0 = 贴着轨道末尾擦出去）。
 */
export function revealOutWindow(
  out: TrackRevealOut,
  trackDurationInFrames: number,
): { start: number; duration: number } {
  const duration = Math.max(1, Math.floor(trackDurationInFrames))
  const raw = typeof out.durationInFrames === 'number' && Number.isFinite(out.durationInFrames) && out.durationInFrames > 0
    ? Math.floor(out.durationInFrames)
    : REVEAL_OUT_DEFAULT_DURATION_FRAMES
  const gap = Math.max(0, Math.min(duration - 1, Math.floor(out.gapFrames ?? 0)))
  const win = Math.min(raw, duration)
  return { start: Math.max(0, duration - gap - win), duration: win }
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

/**
 * 轨内帧 → clip-path 文本（含**退场擦除** `reveal.out`）。
 *
 * - 无 `out` ⇒ 与 `revealClipAt` **逐字一致**（老 manifest 逐像素不变）；
 * - 有 `out` ⇒ 进场遮蔽与退场遮蔽按「每侧取大」合成（同侧遮蔽互不覆盖）。
 *
 * `trackDurationInFrames` 是**轨长**（轨内相对帧的终点）—— 退场区间锚在轨尾，
 * 没有它算不出退场窗口。
 */
export function revealClipWithOut(
  reveal: TrackReveal,
  localFrame: number,
  trackDurationInFrames: number,
): string {
  const out = reveal.out
  // spotlight 与 clip 退场无法合成（circle 与 inset 的交集依赖渲染器实现）⇒ 只对 wipe 生效。
  if (out === undefined || reveal.kind === 'spotlight') return revealClipAt(reveal, localFrame)
  const sides: Record<ClipSide, number> = { top: 0, right: 0, bottom: 0, left: 0 }
  sides[revealHiddenSide(reveal.direction)] = revealHiddenPercent(reveal, localFrame)
  const window = revealOutWindow(out, trackDurationInFrames)
  if (localFrame >= window.start) {
    const p = easeOutCubic(Math.min(1, (localFrame - window.start) / window.duration))
    sides[revealOutHiddenSide(out.direction)] = Math.max(sides[revealOutHiddenSide(out.direction)], p * 100)
  }
  if (sides.top === 0 && sides.right === 0 && sides.bottom === 0 && sides.left === 0) return ''
  return `inset(${sides.top.toFixed(3)}% ${sides.right.toFixed(3)}% ${sides.bottom.toFixed(3)}% ${sides.left.toFixed(3)}%)`
}

/** `validateReveal` 的附加上下文（供语义告警用）。 */
export interface RevealValidationContext {
  /**
   * 该轨的 `box`（画布百分比**中心**语义）—— 用于判「揭示方向与本卡所在侧是否同向」。
   *
   * 缺省 = 不做该判定（无 box 的铺满卡本来就没有"所在侧"可言）。
   */
  box?: { x?: number; y?: number } | undefined
}

/** P3：reveal 配置校验（manifest.ts 通用区接线；`transition` 轨的告警在调用侧）。 */
export function validateReveal(
  reveal: unknown,
  at: string,
  errors: string[],
  warnings: string[],
  context?: RevealValidationContext,
): void {
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

  // 2026-11-04：退场擦除 `out`。
  const out = reveal.out
  if (out !== undefined) {
    if (!isRecord(out)) {
      errors.push(`${at}.reveal.out 必须是对象（{ direction, durationInFrames?, gapFrames? }）`)
    } else {
      if (typeof out.direction !== 'string' || !REVEAL_DIRECTIONS.has(out.direction)) {
        errors.push(`${at}.reveal.out.direction 只允许 left / right / up / down`)
      }
      if (out.durationInFrames !== undefined) {
        const dur = out.durationInFrames
        if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0 || !Number.isInteger(dur)) {
          errors.push(`${at}.reveal.out.durationInFrames 必须是正整数（帧）`)
        }
      }
      if (out.gapFrames !== undefined) {
        const gap = out.gapFrames
        if (typeof gap !== 'number' || !Number.isFinite(gap) || gap < 0 || !Number.isInteger(gap)) {
          errors.push(`${at}.reveal.out.gapFrames 必须是 >= 0 的整数（帧）`)
        }
      }
      if (reveal.kind === 'spotlight') {
        warnings.push(`${at} 的 reveal 是 spotlight，退场擦除 out 只对 wipe 生效（已忽略）`)
      }
    }
  }

  // 2026-11-04（A5）：**进场方向与本卡所在侧同向**的语义告警。
  //
  // 「右 wipe 出」这类需求最常见的误写就是拿 `direction` 当退场方向用 ——
  // `direction` 是**进场**方向（可见区自该侧展开），与「内容朝该侧退去」正好相反。
  // 只在方向指向本卡自己那一侧时提示（那正是同词异义最容易发生的场合）。
  // P-16（B-5）：**只在作者显式写了 direction 时判定** —— 没写时的 'right' 是引擎
  // 补的缺省值，不是作者意图；拿缺省值参与 sameSide 会对「从未写过 direction」的卡
  // 报「请改用 reveal.out.direction='right'」，作者按建议改反而真的改掉了渲染。
  if (reveal.kind === 'wipe' && context?.box !== undefined) {
    const box = context.box
    const x = typeof box.x === 'number' && Number.isFinite(box.x) ? box.x : undefined
    const y = typeof box.y === 'number' && Number.isFinite(box.y) ? box.y : undefined
    const direction = typeof reveal.direction === 'string' && REVEAL_DIRECTIONS.has(reveal.direction)
      ? reveal.direction
      : null
    if (direction === null) return
    const sameSide =
      (x !== undefined && x > 50 && direction === 'right') ||
      (x !== undefined && x < 50 && direction === 'left') ||
      (y !== undefined && y < 50 && direction === 'up') ||
      (y !== undefined && y > 50 && direction === 'down')
    if (sameSide) {
      warnings.push(
        `${at} 的 reveal.direction='${direction}' 指向本卡所在的一侧 —— 这是**进场**揭示方向（可见区自该侧展开），`
        + `不是「朝该侧擦出去」；若要退场擦除请用 reveal.out.direction='${direction}'`,
      )
    }
  }
}
