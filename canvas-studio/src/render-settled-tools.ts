/**
 * REQ-041 第 2 批（2026-11-25）· **渲染结算后要刷新段清单的工具名单**。
 *
 * ## 为什么是常量集合
 *
 * `asset-capture.ts` 里的判据原来是硬编码 `state.toolName === 'render_composition'`。
 * N1 加了 `rerender_segment` 之后，那个字符串比较不会知道「这也是渲了一次」——
 * 表现为：段文件已经换新、卡上还是旧画面（清单没被重新拉取，`?v=` 变了也没人去看），
 * 用户以为「说了意见但没变化」。
 *
 * 名单放独立文件而不是塞在 `asset-capture.ts` 里：守卫要能**直接断言集合内容**，
 * 并且反向变异（从集合里删掉一个名字）必须能把行为测试打红。
 */
export const RENDER_SETTLED_TOOLS: ReadonlySet<string> = new Set([
  'render_composition',
  // REQ-041 N1：单段重渲同样换了盘上的 `assets/seg-<id>.mp4`，必须刷清单。
  'rerender_segment',
])

/** 这次结算要不要刷段清单（非渲染工具 / 未知工具一律不刷）。 */
export function isRenderSettledTool(toolName: string | undefined): boolean {
  return toolName !== undefined && RENDER_SETTLED_TOOLS.has(toolName)
}
