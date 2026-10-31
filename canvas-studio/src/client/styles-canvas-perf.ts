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

/* CV-384 批 2（真机反馈：拖动改善、缩小仍有 tile 告警）：手势进行中临时关掉
   节点级 cv-auto。缩小时大量节点跨越「相关」边界，每帧子树布局 + 瓦片失效
   叠加在 scale 驱动的全量重光栅上；手势中可见区内节点反正全要画，cv-auto
   只剩失效成本。滚轮停 200ms / 指针松手回落（.csCanvasGesturing 由
   CanvasSurface 的手势态挂）。 */
.csCanvasGesturing .csNode {
  content-visibility: visible;
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
