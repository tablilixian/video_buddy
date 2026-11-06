/**
 * 错误卡渲染计划（纯函数，可单测）。
 *
 * 为什么把「怎么渲染」抽出来：`StudioErrorState` 是 JSX，测试里没有渲染器（本仓测试
 * 全走 `node --test` + 源码文本断言），于是「终态错误不能出现重试按钮」这条规则
 * 只能靠断言源码里有某个三元表达式来守 —— 那种守卫删掉逻辑也能绿。计划表是纯函数，
 * 语义结论可以直接断言，反向变异（把 terminal 归回 retryable）当场变红。
 *
 * 2026-11-06 真机（会话 18 / §13）：故事板已落地时的版本写操作被 `assertNotLanded`
 * 拦下，错误卡上唯一的按钮是「重试」—— 点了只刷项目列表，用户以为在重试落地，再点
 * 一次同样的操作卡立刻回来。终态错误的正确处置是「知道了，关掉它」。
 */
import { ERROR_COPY } from './brand-copy.js'
import type { StudioErrorKind } from './error-kind.js'

/** 卡片底部的可行动作。`none` = 一个按钮都不渲染（终态且没给关闭回调时的兜底）。 */
export type ErrorCardAction = 'settings' | 'retry' | 'dismiss' | 'none'

export interface ErrorCardPlanInput {
  /** 分级结论（来自 `classifyStudioFailure`）。 */
  kind: StudioErrorKind
  /** 调用方是否提供了「打开设置」回调。 */
  hasSettings?: boolean
  /** 调用方是否提供了「关闭」回调 —— 没给就没有任何关闭出口。 */
  hasDismiss?: boolean
}

export interface ErrorCardPlan {
  /** 卡片标题。 */
  title: string
  /** 标题下的一行提示（空串 = 不渲染该行）。 */
  hint: string
  /** 主按钮（accent 实底）。 */
  primary: ErrorCardAction
  /** 次按钮（描边）。 */
  secondary: ErrorCardAction[]
  /** 左缘色条修饰类名。 */
  className: string
  /** 是否渲染右上角关闭键。 */
  closable: boolean
}

const KIND_CLASS: Record<StudioErrorKind, string> = {
  retryable: 'csErrorKindRetryable',
  config: 'csErrorKindConfig',
  unreachable: 'csErrorKindUnreachable',
  terminal: 'csErrorKindTerminal',
}

/**
 * 由分级 + 回调可用性推导渲染计划。
 *
 * 只有两条硬规则，其余保持既有行为不动：
 * 1. **`terminal` 永不渲染「重试」** —— 重试必然复发，那个按钮只会拿走用户的唯一出口；
 * 2. **有任何关闭回调就必须渲染关闭键** —— 用户被一张关不掉的卡挡住是本次真机事故本身。
 */
export function errorCardPlan(input: ErrorCardPlanInput): ErrorCardPlan {
  const { kind } = input
  const hasSettings = input.hasSettings === true
  const closes = input.hasDismiss === true
  const className = KIND_CLASS[kind]

  if (kind === 'terminal') {
    // 终态：主行动是「知道了」把卡关掉；没有关闭回调就一个按钮都不给 —— 宁可只剩
    // 一段说明，也不给一个点了会复发的「重试」。
    return {
      title: ERROR_COPY.terminalTitle,
      hint: ERROR_COPY.terminalHint,
      primary: closes ? 'dismiss' : 'none',
      secondary: [],
      className,
      closable: closes,
    }
  }

  if (kind === 'config') {
    // 缺配置的主行动是「去设置」（重试在配好之前必然复发）；没有设置回调时退回重试，
    // 这是历史行为，别在没有替代出口的情况下把唯一按钮撤掉。
    return {
      title: ERROR_COPY.configTitle,
      hint: ERROR_COPY.configHint,
      primary: hasSettings ? 'settings' : 'retry',
      secondary: hasSettings ? ['retry'] : [],
      className,
      closable: closes,
    }
  }

  return {
    title: kind === 'unreachable' ? ERROR_COPY.unreachableTitle : ERROR_COPY.retryable,
    hint: kind === 'unreachable' ? ERROR_COPY.unreachableHint : '',
    primary: 'retry',
    secondary: [],
    className,
    closable: closes,
  }
}
