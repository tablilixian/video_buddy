/**
 * REQ-008：对话流工具行组件（三档中文行）—— `tool.call.toolview`（keyed 槽）
 * 的 canvas-studio 接管渲染器。
 *
 * 注册侧见 client/index.ts：对 `tool-presentation.ts` 的 TOOLVIEW_KEYS 逐 key
 * 以 priority -1 注册（上游 keyed 全在默认 0，-1 胜出、无同键同优先级抛错）。
 * keyed 命中只替换行内容；外壳 data 锚点与 subCalls 递归都在上游
 * ToolCallTree 的槽外，不受接管影响。
 *
 * 三档（表见 tool-presentation.ts）：A 展示级大字 + 动态摘要；B 流程级一行弱化；
 * C 内部级极简灰字、默认可展开看参数与结果。状态四态（对齐上游 ToolRowState）：
 * running（扫光 + 进行中）/ ok（勾 + 耗时）/ error（红 + 错误首行，任何档不降级）/
 * stopped（中性灰「已取消」，interrupted 不是错误）。
 *
 * 展开能力（CV-264 泛化）：C 档恒可展开；A/B 档在 **error / stopped 态可展开**
 * —— 错误摘要被截断时用户必须能读到全文（验收反馈 2026-09-30：H3-IR 报错
 * 首行截成 `(mod…`）。展开交互手写（button / role=button + aria-expanded），
 * 不引 `ui-primitives` 的 DisclosureRow：该包没有 ./client 子路径导出，root
 * 引入会把 CSS Modules 组件拖进本包 cjs 客户端 bundle（本包 client 侧从未依赖它）。
 */
import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  argsRawOfBlock, durationSeconds, errorSummaryOf, formatDuration,
  nameOfBlock, outputTextOf, presentationOf, stateOfBlock, summaryOf,
} from '../tool-presentation.js'

/** 展开详情的高度上限（对齐上游 ToolRow 的 max-height scroll 行为）。 */
const DETAIL_MAX_PX = 180

/**
 * 三档工具行。
 * @param props - keyed 槽 owner 数据（callId / toolName / block / openFile…）。
 * @returns the tool row.
 */
export function ToolCallRow(props: ToolCallViewProps) {
  const { toolName, block, openFile } = props
  const presentation = presentationOf(toolName)
  const [open, setOpen] = useState(false)
  // 防御：keyed 命中必然有表项（注册键 = 表键）；表外命中按 C 档兜底渲染，
  // 不回落上游（比英文通用行可读，且不会因漏表静默变英文）。
  const tier = presentation?.tier ?? 'C'
  const title = presentation?.title ?? nameOfBlock(block, toolName)
  const state = stateOfBlock(block)
  const argsRaw = argsRawOfBlock(block)
  const summary = argsRaw === null ? null : summaryOf(toolName, argsRaw)
  const errorSummary = state === 'error' ? errorSummaryOf(block) : null
  const duration = durationSeconds(block)
  const output = state === 'running' ? null : outputTextOf(block)

  // 展开策略：C 档恒可展开（有料就行）；A/B 档只在 error / stopped 态展开
  // （成功行没有可读的详情诉求，保持一行不抢戏）。
  const expandable = tier === 'C'
    ? (argsRaw !== null || output !== null)
    : (state === 'error' || state === 'stopped') && (output !== null || argsRaw !== null)

  const stateClass = state === 'running' ? ' csToolRowRunning'
    : state === 'ok' ? ' csToolRowOk'
      : state === 'error' ? ' csToolRowErr' : ' csToolRowStopped'
  const className = `csToolRow csToolRow${tier}${stateClass}`
  const toggle = (): void => { setOpen(!open) }

  // 状态徽标：error 用错误首行替换摘要（永不隐藏、永不降级）。
  const summaryText = errorSummary ?? summary
  const meta = state === 'running' ? '进行中'
    : state === 'stopped' ? '已取消'
      : state === 'error' ? '✗'
        : duration !== null ? `✓ ${formatDuration(duration)}` : '✓'

  const icon = presentation?.icon ?? '·'
  const pathValue = pathValueOf(argsRaw, presentation?.pathKey)

  const detail = expandable && open ? (
    <div className="csToolRowDetail" style={{ maxHeight: DETAIL_MAX_PX }}>
      {argsRaw !== null && argsRaw !== '' && (
        <div className="csToolRowSection">
          <span className="csToolRowKey">参数</span>
          <pre className="csToolRowPre">{prettyJson(argsRaw) ?? argsRaw}</pre>
        </div>
      )}
      {pathValue !== undefined && (
        <button
          type="button"
          className="csToolRowPath"
          onClick={() => { openFile(pathValue) }}
        >打开 {pathValue}</button>
      )}
      {output !== null && (
        <div className="csToolRowSection">
          <span className="csToolRowKey">{state === 'error' ? '错误' : '结果'}</span>
          <pre className="csToolRowPre">{output}</pre>
        </div>
      )}
    </div>
  ) : null

  // C 档：极简灰字一行，整行按钮点开。
  if (tier === 'C') {
    return (
      <div className={className} data-cs-tool-row data-tier="c" data-state={state}>
        <button
          type="button"
          className="csToolRowLine"
          aria-expanded={expandable ? open : undefined}
          onClick={() => { if (expandable) toggle() }}
        >
          <span className="csToolRowCaret" data-open={open || undefined}>{expandable ? '▸' : '·'}</span>
          <span className="csToolRowTitle">{title}</span>
          {summaryText !== null && summaryText !== '' && (
            <span className="csToolRowSummary">{summaryText}</span>
          )}
          <span className="csToolRowMeta">{meta}</span>
        </button>
        {detail}
      </div>
    )
  }

  // A / B 档：单行（图标 + 标题 + 摘要 + 状态徽标）；error/stopped 态整行可点开
  // 读完整错误（键盘可达：role=button + Enter/Space）。
  const abExpandProps = expandable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-expanded': open,
        onClick: toggle,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        },
      }
    : {}
  return (
    <div
      className={className}
      data-cs-tool-row
      data-tier={tier.toLowerCase()}
      data-state={state}
      data-expandable={expandable || undefined}
      {...abExpandProps}
    >
      <span className="csToolRowIcon" aria-hidden>{icon}</span>
      <span className="csToolRowTitle">{title}</span>
      {summaryText !== null && summaryText !== '' && (
        <span className="csToolRowSummary">{summaryText}</span>
      )}
      <span className="csToolRowMeta">{meta}</span>
      {detail}
    </div>
  )
}

/** 从入参 JSON 提取路径参数原值（「打开」用；坏 JSON / 缺键 → undefined）。 */
function pathValueOf(argsRaw: string | null, key: 'path' | 'file_path' | undefined): string | undefined {
  if (key === undefined || argsRaw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const value = (parsed as Record<string, unknown>)[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/** 入参原文美化（坏 JSON 原样返回）。 */
function prettyJson(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return null
  }
}
