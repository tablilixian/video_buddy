/**
 * 渲染报告 → 模型可见的一行文本（REQ-034 O-01），连同它的入参形状。
 *
 * 从 `host-tools.ts` 拆出的原因：该文件撞「单文件行数 ≤1,200 白名单棘轮，只准减不准增」
 * （`tests/file-size-guard.test.mjs`）。RP-16 给 `prepareMs` 加三段拆解时主文件已到 5,022
 * 行 > 登记 5,008 ⇒ 按仓库既有先例外提（`render-budget.ts` / `render-diagnostics.ts` /
 * `host-tools-artifact.ts` 同款做法），**不改白名单登记数**。
 *
 * 这里同时是 `ComposeToolResult['report']` 的**唯一形状声明** —— 原先内联在
 * `host-tools.ts` 的 `ComposeToolResult` 里，与格式化函数一起搬过来，保证
 * 「形状」与「怎么打印」永远同步（拆开各改一处必然漂移）。
 *
 * 零依赖（纯类型 + 纯函数）⇒ 不会与 `host-tools.ts` 形成循环 import。
 */

/** `compose_video` 返回结构里的 `report` 子对象（由 `formatRenderReport` 消费）。 */
export interface ComposeRenderReport {
  quality: string
  frames: number
  totalMs: number
  prepareMs: number
  /** RP-16 准备段拆解（可选：老客户端 / spot 不带 ⇒ 文本里省略）。 */
  prepareFontMs?: number
  prepareProbeMs?: number
  prepareCapabilityMs?: number
  renderMs: number
  msPerFrame: number
  encodeDoneAtMs: number
  bytes: number
  bitrateKbps: number
  width: number
  height: number
  sampledFrames: number
  /** OPT-11：音频平台保证（manifest 确定性推导；audibleSources=0 ⇒ 成片必然无声）。 */
  audio?: { mutedVideoTracks: number; audibleSources: number }
  /** OPT-15：带动画轨的动画窗口表（QC 拿抽帧号对窗口，先看末帧再定论）。 */
  animationWindows?: { id: string; start: number; end: number; kinds: string[] }[]
  /** 三期 W1-3 / W6-2：编排体检回执（编号 + 定位 + 主文案；B-3 起返回文本给前 5 条原文）。 */
  lint?: { code: string; at: string; message: string }[]
  /** B-3（CV-439）：体检完整清单落盘路径（项目 build/ 下）。落盘失败缺省。 */
  lintPath?: string
  /** Q1 响度闸：成片综合响度（LUFS）。无声片缺省。 */
  loudnessLufs?: number
}

/**
 * 渲染报告 → 一行文本（REQ-034 O-01）。
 *
 * 报告字段早已算好并塞进 payload，但一直没进模型可见文本 ⇒ W6 闭环（按 msPerFrame /
 * 报文字段决策）在真机上 100% 失效。耗时为 0（客户端没上报）的项直接省略，
 * 避免出现一串「0ms」让人误读成「渲染没花时间」。
 */
export function formatRenderReport(report: ComposeRenderReport): string {
  const parts = [`quality=${report.quality}`]
  if (report.frames > 0) parts.push(`${report.frames} 帧`)
  if (report.totalMs > 0) parts.push(`总 ${(report.totalMs / 1000).toFixed(1)}s`)
  // 把"准备"与"渲染"分开报：准备项真机曾达十几秒，混在 msPerFrame 里会让人以为是
  // 渲染慢（REQ-035 取证结论）。带三段拆解时一并给出 —— 那十几秒到底是谁（RP-16）。
  if (report.prepareMs > 0) {
    const seg = (value: number | undefined): string => (typeof value === 'number' ? `${(value / 1000).toFixed(1)}` : '-')
    const hasBreakdown = [report.prepareFontMs, report.prepareProbeMs, report.prepareCapabilityMs]
      .some((value) => typeof value === 'number')
    parts.push(hasBreakdown
      ? `准备 ${(report.prepareMs / 1000).toFixed(1)}s（字体 ${seg(report.prepareFontMs)} / 探测 ${seg(report.prepareProbeMs)} / 能力 ${seg(report.prepareCapabilityMs)}）`
      : `准备 ${(report.prepareMs / 1000).toFixed(1)}s`)
  }
  if (report.renderMs > 0) parts.push(`渲染 ${(report.renderMs / 1000).toFixed(1)}s`)
  if (report.msPerFrame > 0) parts.push(`msPerFrame=${report.msPerFrame.toFixed(1)}`)
  if (report.encodeDoneAtMs > 0) parts.push(`编码完成于 ${(report.encodeDoneAtMs / 1000).toFixed(1)}s`)
  if (report.bytes > 0) parts.push(`${(report.bytes / 1024 / 1024).toFixed(2)}MB`)
  if (report.bitrateKbps > 0) parts.push(`${Math.round(report.bitrateKbps)}kbps`)
  // OPT-11：音频平台保证 —— 无声是确定性推论，直接给结论省掉 agent 的采电平验证。
  if (report.audio !== undefined) {
    parts.push(
      report.audio.audibleSources === 0
        ? '音频=无声（平台保证，muted/无音源，无需验证）'
        : `音频=${report.audio.audibleSources} 个出声源（muted 轨 ${report.audio.mutedVideoTracks}）`,
    )
  }
  // OPT-15：动画窗口表进可见文本（QC 铁律的载体——只列轨号不展开，细节在结构化字段里）。
  const windows = report.animationWindows ?? []
  if (windows.length > 0) {
    const brief = windows.slice(0, 4).map((w) => `${w.id}[${w.start}–${w.end}:${w.kinds.join('+')}]`).join('、')
    const more = windows.length > 4 ? ` 等 ${String(windows.length)} 轨` : ''
    parts.push(`动画窗口=${brief}${more}（抽帧落在窗口内=动画飞行中，先看末帧再定论）`)
  }
  // B-3（CV-439）：体检计数进统计行；前 N 条原文与落盘路径由 lintReceiptLines 单独成段
  //（挤在这一行里可读性差）。lint 为空不占位。
  if ((report.lint ?? []).length > 0) parts.push(`体检=${report.lint?.length} 条`)
  return `渲染报告：${parts.join(' · ')}`
}
