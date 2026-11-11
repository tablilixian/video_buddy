/**
 * 0B（CV-461）：**真实字形测量器**（浏览器侧 `canvas.measureText`）—— 组件与渲染前体检共用一份。
 *
 * 为什么单独成文件：0B 的文本容量体检要求「体检的度量口径 = 组件的度量口径」，否则会出现
 * 「体检说没溢出、成片却裁了」这种比没有体检更糟的结论。原来这份实现在
 * `components/TextCard.tsx` 里私有，体检（`text-fit-audit.ts`）拿不到；两边各写一份必然漂移。
 *
 * 纪律：
 *   - **只读 DOM，不 import 任何 Node 内置**（会被客户端 bundle 与 `.tsx` 组件消费）；
 *   - 非浏览器环境（Host / node 测试）返回 `undefined` ⇒ 调用方回落 `fitTextPolicy` 的
 *     字符宽度估算（老行为完全不变）；
 *   - 缓存 key 含字号：`fitTextPolicy` 的迭代里字号会变，漏进 key 就会拿到错宽度。
 */
import type { TextMeasurer } from './timing.js'

/**
 * 测量结果缓存（模块级）。key = `family|weight|px|text`。
 *
 * 文本重复度高（字幕 / 要点），缓存命中率很高。上限 4096 条 —— 超过就整体清空
 * （一次渲染的文本量远小于这个数，简单清空比 LRU 更不容易出错）。
 */
const MEASURE_CACHE = new Map<string, number>()
const MEASURE_CACHE_LIMIT = 4096

/** 清空测量缓存（单测用：同一进程里换假 measurer 时不必污染真实缓存）。 */
export function clearMeasureCache(): void {
  MEASURE_CACHE.clear()
}

/**
 * 建一个 `canvas.measureText` 测量器；环境不支持时返回 `undefined`
 *（调用方回落字符宽度估算 ⇒ Host / node / 老浏览器行为不变）。
 */
export function createCanvasMeasurer(): TextMeasurer | undefined {
  if (typeof document === 'undefined') return undefined
  let context: CanvasRenderingContext2D | null = null
  try {
    const canvas = document.createElement('canvas')
    context = canvas.getContext('2d')
  } catch {
    return undefined
  }
  if (context === null) return undefined
  const ctx = context
  return (text, fontPx, family, weight) => {
    const key = `${family}|${weight}|${fontPx}|${text}`
    const cached = MEASURE_CACHE.get(key)
    if (cached !== undefined) return cached
    // `ctx.font` 的语法与 CSS `font` 简写一致；family 是已组好的栈（含逗号/引号）。
    ctx.font = `${weight} ${fontPx}px ${family}`
    let width = 0
    try {
      width = ctx.measureText(text).width
    } catch {
      width = 0
    }
    if (!Number.isFinite(width) || width < 0) width = 0
    if (MEASURE_CACHE.size >= MEASURE_CACHE_LIMIT) MEASURE_CACHE.clear()
    MEASURE_CACHE.set(key, width)
    return width
  }
}
