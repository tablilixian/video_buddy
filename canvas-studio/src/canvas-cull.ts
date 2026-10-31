/**
 * CV-384（2026-10-31）：画布视口裁剪的纯函数。
 *
 * 为什么独立成文件：这组函数要被单测直连 `lib/` 编译产物（`src/client/**`
 * 不进 tsc 产物，client 里的 canvas-math.ts 够不着），又是方案 P0-3 的
 * B 案兜底（React 条件挂载）与连线视口裁剪共用的口径。
 *
 * A 案（`content-visibility: auto`，styles-canvas-perf.ts）生效时本模块只有
 * 连线裁剪在消费；A 案若真机实证失效，B 案（节点条件挂载）直接取
 * `viewportWorldRect` + `rectIntersects` 接线，口径不变。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/**
 * World-space viewport rect: the visible screen area mapped back into canvas
 * coordinates, padded by `marginPx` **screen** pixels on every side (hence
 * divided by scale — at 0.1x a 48px screen margin swells to 480 world px).
 */
export function viewportWorldRect(
  view: { x: number; y: number; scale: number },
  viewport: { width: number; height: number },
  marginPx: number,
): { x: number; y: number; width: number; height: number } {
  const margin = marginPx / view.scale
  return {
    x: -view.x / view.scale - margin,
    y: -view.y / view.scale - margin,
    width: viewport.width / view.scale + margin * 2,
    height: viewport.height / view.scale + margin * 2,
  }
}

/** Whether two world-space rects overlap (edge-touching does not count). */
export function rectIntersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Whether a canvas node's box overlaps the world-space viewport rect. */
export function nodeIntersectsViewport(
  node: Pick<StudioCanvasNode, 'x' | 'y' | 'width' | 'height'>,
  viewportRect: { x: number; y: number; width: number; height: number },
): boolean {
  return rectIntersects(
    { x: node.x, y: node.y, width: node.width, height: node.height },
    viewportRect,
  )
}
