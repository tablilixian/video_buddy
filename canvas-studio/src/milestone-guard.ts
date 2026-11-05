/**
 * 空转探测（P1-2 + P2-3）：把「只读不产」从**事后复盘**变成**当步可见的机器信号**。
 *
 * ## 为什么需要
 *
 * 2026-11-05 真机事故（`session-075508eb…`，3h37m 零成片）里，最刺眼的不是模型不会写
 * manifest，而是它在 2 小时 40 分里做了 **251 次 bash、其中 230+ 次是重复读同一批
 * `src/remotion/**` 源码**，而 `scaffold_manifest` / `render_composition` 各 0 次。
 * 全程没有任何一个信号告诉它「你在空转」—— 里程碑时钟只挂在**本插件工具**的返回上，
 * 而它那段时间一个本插件工具都没调。
 *
 * ## 为什么能修（P0 之后才成立的事实）
 *
 * `tools/execute` 是 **ToolRuntime 上的 waterfall**，对所有工具（含 dsh 自带的 `bash` /
 * `read`）都会触发，且 `exec` 带 `name` 与解析后的 `arguments` ⇒ **不必改 dsh 本体**就能
 * 观测到「读了什么」。原先规划把「跨仓读源码探测」列为 P2（需 dsh 侧钩子）是保守误判，
 * 这里合并实现。
 *
 * ## 设计约束
 *
 * 1. **计入的是「距上次成功出片以来的工具调用数」**，不是绝对累积。正常迭代阶梯
 *    （R0–R6，每轮都出片）单轮约 40–60 次调用，不重置就会把**健康的片子**判成空转。
 * 2. **只在「本次会话还没有任何成片」时提示**。已经有 v1 之后的调用是美化迭代，
 *    不是空转 —— 那条路径的正确反馈是里程碑时钟，不是这条告警。
 * 3. **重复播报有退避**（+20 / +8），否则阈值一过，每次 bash 都念一遍，反而变成噪声，
 *    模型会学会忽略它。
 * 4. 全纯函数：状态进出、无 I/O、无时钟 —— 阈值与文本都能在单测里钉死。
 */

/** 距上次出片多少次工具调用开始提示空转。 */
export const IDLE_TOOL_CALLS = 40

/** 累计多少次读 `src/remotion/**` 开始提示「源码不是契约判据」。 */
export const SOURCE_READS = 8

/** 空转告警的重复播报步长（每再涨这么多次再念一遍）。 */
const IDLE_REPEAT = 20

/** 读源码告警的重复播报步长。 */
const SOURCE_REPEAT = 8

/** 一个 cwd（≈ 一个项目会话）的空转计数。 */
export interface GuardCounters {
  /** 自上次成功出片以来的工具调用数（含 dsh 自带工具）。 */
  sinceRender: number
  /** 本次会话成功出片次数（`render_composition` 成功且非 probe / spot）。 */
  renders: number
  /** 自上次成功出片以来读 `src/remotion/**` 的次数。 */
  sourceReads: number
  /** 下一次「空转」告警的触发点。 */
  nextIdleAt: number
  /** 下一次「读源码」告警的触发点。 */
  nextSourceAt: number
}

/** 一次工具调用的观测值（`tools/execute` 中间件能拿到的全部信息）。 */
export interface GuardCall {
  name: string
  /** 解析后的参数；形状未知，按需探测（工具自己才拥有 schema）。 */
  arguments: unknown
  /** 本次是否失败。失败的渲染不计入成片。 */
  isError: boolean
  /** 是否为探针 / spot-check 渲染（都不落画布节点，不算成片）。缺省由 `arguments` 推断。 */
  probe?: boolean
}

/** 全新计数（每个 cwd 首次出现时用）。 */
export function emptyGuardCounters(): GuardCounters {
  return {
    sinceRender: 0,
    renders: 0,
    sourceReads: 0,
    nextIdleAt: IDLE_TOOL_CALLS,
    nextSourceAt: SOURCE_READS,
  }
}

/**
 * 判定一次调用是否在「读渲染器源码」。
 *
 * 只认两种形态（今天事故里的全部形态）：`read` 的 `file_path`、`bash` 的 `command`
 * 命中 `src/remotion`。**不做模糊匹配**：命中范围一旦放宽到 `src/`，正常改代码也会被
 * 当成空转燃料，这条告警就废了。
 */
export function isSourceReadCall(name: string, args: unknown): boolean {
  if (args === null || typeof args !== 'object') return false
  const record = args as Record<string, unknown>
  if (name === 'read') {
    const path = record['file_path']
    return typeof path === 'string' && path.includes('src/remotion')
  }
  if (name === 'bash') {
    const command = record['command']
    return typeof command === 'string' && command.includes('src/remotion')
  }
  return false
}

/** 记一次工具调用，返回新状态（不改入参）。 */
export function noteGuardCall(state: GuardCounters, call: GuardCall): GuardCounters {
  const record = (call.arguments ?? {}) as Record<string, unknown>
  // 探针 / 快验都不落画布节点 ⇒ 不算成片。这条判定放在这里（而不是接线处），
  // 是为了让「什么算成片」只有一个事实源，能被单测钉死。
  const ephemeral = call.probe === true || record['probe'] === true || Array.isArray(record['spotFrames'])
  const rendered = call.name === 'render_composition' && !call.isError && !ephemeral
  if (rendered) {
    // 出片成功 ⇒ 空转链断掉。计数归零，告警点回到初始值（下一轮迭代重新开始算）。
    return {
      ...state,
      sinceRender: 0,
      renders: state.renders + 1,
      sourceReads: 0,
      nextIdleAt: IDLE_TOOL_CALLS,
      nextSourceAt: SOURCE_READS,
    }
  }
  const readSource = isSourceReadCall(call.name, call.arguments)
  return {
    ...state,
    sinceRender: state.sinceRender + 1,
    sourceReads: state.sourceReads + (readSource ? 1 : 0),
  }
}

/** 一条告警的产出：要追加的文本 + 播报点已推进的状态。 */
export interface GuardNote {
  /** 写给模型看的告警；`null` 表示本次不追加。 */
  text: string | null
  state: GuardCounters
}

/**
 * 出警判定（纯函数）。返回要追加的文本，并把播报点推到下一次。
 *
 * 两条告警可以同时命中，此时按固定顺序拼接（空转在前 —— 它更接近「要不要继续这么干」，
 * 读源码只是它的一个成因）。
 */
export function guardNote(state: GuardCounters): GuardNote {
  const lines: string[] = []
  let next = state

  if (state.renders === 0 && state.sinceRender >= state.nextIdleAt) {
    lines.push(
      `⚠️ 骨架优先：距开始已 ${state.sinceRender} 次工具调用、0 次成片。`
      + '下一步只做三件事 —— `scaffold_manifest`(recipe:"explainer-cards") → 写 `build/manifest.json`'
      + ' → `render_composition`({quality:"draft"})。**先把片子渲出来，再谈好不好看**；'
      + '不要在写 manifest 之前继续读源码或重排时间轴。',
    )
    next = { ...next, nextIdleAt: state.sinceRender + IDLE_REPEAT }
  }

  if (state.renders === 0 && state.sourceReads >= state.nextSourceAt) {
    lines.push(
      `⚠️ 已 ${state.sourceReads} 次读 \`src/remotion/**\`：契约只认 \`references/manifest-contract.md\`，`
      + '源码不是判据（每读一处都会「发现」一条新校验，然后推翻上一版设计 —— 这是空转的燃料）。',
    )
    next = { ...next, nextSourceAt: state.sourceReads + SOURCE_REPEAT }
  }

  return { text: lines.length === 0 ? null : lines.join('\n'), state: next }
}
