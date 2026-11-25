/**
 * CV-082 / REQ-041：hover 静音预览的**全局单例**（全画布同一时刻最多一个视频在播）。
 *
 * 为什么抽成模块：段产物格（历程视图里独立成格的「这一屏」）和视频卡是两种组件，
 * 但它们在同一行里并排出现 —— 各留一份模块级变量就等于「最多一张」这条验收口径
 * 在两个组件之间漏掉一次。改前这份登记在 `CanvasNode.tsx` 里，段产物上卡后
 * 两处各播各的。
 *
 * 纪律：这里的函数**只管元素归属与播放**，什么时候开始（150ms 延迟）、什么时候
 * 停（离开/卸载）仍由各组件自己的指针事件决定 —— 两边手势语义不同（卡可拖拽，
 * 格是只读），不该共用一套生命周期。
 */

/** 启动延迟：快速扫过一排卡时不 play/pause 抖动。 */
export const HOVER_PREVIEW_DELAY = 150

/** 系统减少动效偏好（会话内极少变化，模块加载时算一次）。 */
export const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 当前持麦的元素（模块级登记，非 React 状态 —— 它不驱动渲染）。 */
const slot: { current: HTMLVideoElement | null } = { current: null }

/** 当前正在 hover 播放的元素（供需要「先停别人」的调用方读取）。 */
export function activeHoverVideo(): HTMLVideoElement | null {
  return slot.current
}

/**
 * 接管播放：先把上一个停掉（回到首帧），再静音循环播放本次元素。
 * 自动播放被拒（策略/无用户手势）时静默 —— 保持缩略图，不抛到控制台。
 */
export function claimHoverVideo(el: HTMLVideoElement): void {
  const previous = slot.current
  if (previous !== null && previous !== el) {
    previous.pause()
    previous.currentTime = 0
  }
  slot.current = el
  el.muted = true
  el.loop = true
  el.play().catch(() => { /* 静默：保持缩略图 */ })
}

/** 归还麦：仅当仍归自己时清空，避免把别人刚接管的登记抹掉。 */
export function releaseHoverVideo(el: HTMLVideoElement): void {
  if (slot.current === el) slot.current = null
}
