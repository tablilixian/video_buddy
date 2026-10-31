/**
 * CV-384（2026-10-31）：画布渲染性能批的样式。
 *
 * 为什么独立成文件：styles.ts 在文件行数棘轮白名单上（10731，「只准减不准增」），
 * 新规则一律落新文件（先例 styles-audio.ts）。本批两条规则：
 *
 * 1. `.csNode { content-visibility: auto }` —— 视口外节点跳过渲染与光栅
 *    （方案 P0-3 主案 A）。`.csNode` 本就 `overflow: hidden`（连线手柄当年
 *    为此贴内），cv-auto 带来的 paint containment 不产生新的裁切；占位尺寸
 *    `contain-intrinsic-size` 由 CanvasNode 内联精确填 node.width/height。
 * 2. `.csNodeDragging { will-change: transform }` —— **仅拖拽中的节点**提升
 *    为合成层（方案 P0-1）：静态节点画进世界层（`.csCanvasLayer`）的瓦片，
 *    只有被拖的卡逐帧动。类由 CanvasSurface 的手势态（spotDragIds）挂上、
 *    松手摘除 —— **禁止画布级全员态**（CV-186 历史教训：data-dragging 全员
 *    压暗那条路已废）。
 *
 * 由 CanvasSurface 挂载时注入（幂等，与 installStudioStyles 同一模式）。
 */
const CANVAS_PERF_STYLES = `
/* CV-384 P0-3：节点视口裁剪（A 案）。离屏节点跳过 paint + 光栅，进入视口
   自动恢复；节点的宽高本就是 inline 精确值，占位尺寸不会塌框。 */
.csNode {
  content-visibility: auto;
}

/* CV-384 P0-1：拖拽中的节点才提升合成层（静态节点画进世界层瓦片）。
   只准由 CanvasSurface 的手势态挂上 —— 画布级全员态是 CV-186 已废的路。 */
.csNodeDragging {
  will-change: transform;
}
`

let installed = false

/** 注入画布渲染性能样式（幂等；CanvasSurface 挂载时调用）。 */
export function installCanvasPerfStyles(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const element = document.createElement('style')
  element.setAttribute('data-plugin', 'canvas-studio-canvas-perf')
  element.textContent = CANVAS_PERF_STYLES
  document.head.appendChild(element)
}
