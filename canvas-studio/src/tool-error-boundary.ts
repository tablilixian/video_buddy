/**
 * Canvas Studio 工具边界：结构化错误出口（**Host 侧**）。
 *
 * 为什么需要这一层：框架的工具运行时把「`execute` 抛出的异常」转成工具结果时，
 * 只对 `HarnessError` 记录结构化 `{ name, code }`（`core/tools` 的 `errorInfo()`），
 * 其余一律只剩 `message` 字符串。而本项目里 canvas-studio 与桌面宿主各自装有一份
 * `@deepseek-ai/dsh-llm` 的**实体副本**（非软链，见 `node_modules` 布局）⇒ 跨副本
 * `instanceof HarnessError` 恒为 `false`，**继承 `HarnessError` 这条路不可靠**。
 *
 * 因此改走框架公开的中间件：本模块在工具结果上补 `error.info = { name, code }`。
 * 框架会把它原样透传进 `tool/result` 会话事件的 `data.error`
 * （`agent-loop` 的 `tool-calls.ts` 取 `result.error.info`），客户端据此按码路由
 * （D2 节点错误态 / D3 面板 / D4 toast），不再解析字符串。
 *
 * 分工（两半都必须有）：
 *  - {@link wrapStudioToolDefinition}：包住 `execute`，异常统一过 error-system 归类，
 *    把「本次调用对应的错误码」暂存起来 —— 中间件**看不到原始异常**（框架已经把它
 *    降级成结果了），只能靠暂存传递。它同时是 **CV-235 入参占位守卫**的挂载点
 *    （`execute` 之前先拦占位值 ⇒ 零副作用拒收；详见 `param-guard.ts`）。
 *  - {@link registerStudioToolErrorBoundary}：`tools/execute` 中间件，取出暂存的码，
 *    写进结果的 `error.info`。
 *
 * 参考实现：`deepseek-harness/packages/guard/timeout-policy`（同一个注入点的官方用法）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { asCanvasError, isDevMode, routeError } from './error-system.js'
import { assertNoPlaceholderParams, withPlaceholderParamRule } from './param-guard.js'
import './errors/catalog.js'

/** 结构化错误在工具结果 `error.info` 里的 `name`（客户端据此认出码来自本系统）。 */
export const STUDIO_ERROR_INFO_NAME = 'CanvasStudioError'

/** 一次工具失败暂存下来的信息（供中间件落日志 + 注入错误码）。 */
export interface PendingFailure {
  /** 已登记的错误码，形如 `CS-NET-009`。 */
  code: string
  /** 排障细节（stack / 内网地址 / provider 原始响应），**只进日志**。 */
  devDetail: string
}

/**
 * 「工具体抛错」→「中间件注入」之间的传递通道。
 * 两端拿到的是**同一个 `exec` 对象**（框架把同一个上下文同时交给二者），故用它做键；
 * `WeakMap` 保证随 exec 一起回收，不累积。
 */
const PENDING = new WeakMap<object, PendingFailure>()

/**
 * 归类一次工具失败：统一收敛为 `CanvasStudioError`、暂存错误码、返回**可直接抛出**的
 * 错误实例。
 *
 * 关键点：返回的实例其 `message` 就是 `userMessage`（已脱敏、无内网地址 / stack /
 * provider blob），框架的 `errorMessage()` 会把它写进模型可见的 `Error: <message>`。
 * `devMessage` 永远留在本进程日志里，绝不跨进程。
 */
export function recordStudioToolFailure(cause: unknown, exec: unknown): unknown {
  const err = asCanvasError(cause)
  const action = routeError(err, { devMode: isDevMode() })
  const devDetail = action.kind === 'surface'
    ? `${action.message}${action.recoveryHint === undefined ? '' : `（${action.recoveryHint}）`}`
    : action.dev
  if (typeof exec === 'object' && exec !== null) {
    PENDING.set(exec, { code: err.code, devDetail })
  }
  return err
}

/**
 * 包住一条工具定义的 `execute`：异常不再裸穿，而是统一过错误系统后抛出。
 *
 * 做两件事，都在「所有工具的唯一入口」这一点上完成：
 * 1. **入参占位守卫（CV-235）**：`execute` **之前**先查一遍入参（见 `param-guard.ts`），
 *    命中占位值时抛 `CS-PARAM-002`。放在这里而不是各工具的 `execute` 内部，是因为
 *    这里是唯一实现点，且拒收发生在任何副作用之前（不解析项目、不落节点、不发请求）。
 * 2. **异常归口**：`execute` 抛出的任何异常统一收敛为 `CanvasStudioError`。
 *
 * 另外按参数分类给**有句柄入参**的工具描述追加一层占位纪律（事前提示）：错误文案只在
 * 犯错那一刻出现，模型在没犯错时也得读到「本工具不接受占位值」。判定从工具自己声明的
 * `parameters` 现算（`toolNeedsPlaceholderRule`），没有句柄入参的工具描述一个字都不动。
 *
 * `description` / `parameters` / `output` / `timeoutMs` … 其余字段原样保留，
 * 只可能给 `description` 追加那段纪律（浅拷贝安全，`defineTool` 返回的是普通对象字面量）。
 */
export function wrapStudioToolDefinition<T>(definition: T): T {
  const source = definition as unknown as {
    name?: unknown
    execute(args: unknown, exec: unknown): Promise<unknown>
  } & Record<string, unknown>
  const original = source.execute
  const wrapped: Record<string, unknown> = withPlaceholderParamRule({ ...source }) as Record<string, unknown>
  wrapped.execute = async (args: unknown, exec: unknown): Promise<unknown> => {
    try {
      assertNoPlaceholderParams(typeof source.name === 'string' ? source.name : '未知工具', args)
      return await original.call(source, args, exec)
    } catch (cause) {
      throw recordStudioToolFailure(cause, exec)
    }
  }
  return wrapped as T
}

/**
 * 注册工具边界中间件：给 canvas-studio 工具失败的结果补上结构化错误码。
 *
 * 只对**经 {@link wrapStudioToolDefinition} 包装过**的调用生效（没暂存记录就直接放行），
 * 因此不会碰别人注册的工具。
 */
export function registerStudioToolErrorBoundary(ctx: Context): void {
  // ⚠️ 必须挂在 **root** 上，**不能**写 `ctx.on`。
  //
  // 框架派发这个事件时用的 carrier 是 `scopeTarget(this, exec.agent)`
  // （`dsh-tools` 的 `dispatchScheduledExecution`），而 `dsh-scope` 的
  // `scopeTarget` 只放行两类监听器：
  //   1. `scopeOf(ctx) === undefined` —— 注册所在 ctx **没有** scope 标签；
  //   2. 注册所在的 scope 是派发 key（= agent scope）**本身或它的祖先**。
  // 注释原话：「events flow up the chain, never down」—— 标签在派发 key
  // **之下**的监听器一律被排除。
  //
  // canvas-studio 插件的 ctx 带自己的 scope 标签，且与 agent scope 是
  // **平级**（不是它的祖先），所以 `ctx.on` 注册的中间件**永远不会被调用**：
  // 实测命中 0 次、`data.error.info` 恒为空 ⇒ 客户端拿不到码、D2 无从按受众
  // 判断（本该只进日志的错误照样画红标）。根 ctx 没有 scope 标签，命中规则 1，
  // 因此恒被放行。回归守卫见 `tests/tool-error-boundary.test.mjs`「中间件必须
  // 能被 agent scope 的派发命中」。
  //
  // 用 `ctx.effect(...)` 包一层：`ctx.root.on` 的 disposer 属于 **root 的
  // fiber**，直接返回会随插件卸载而泄漏；交给插件自己的 effect 收集才随插件
  // 一起清理。多实例并存时会注册多个监听器，但 `takePending` 是「取一次即删」，
  // 后续监听器拿到 `undefined` 直接放行，故行为幂等、无需额外去重（用 WeakSet
  // 去重反而会在「先注册的实例先卸载」时留下无监听器的空标记）。
  ctx.effect(
    () => ctx.root.on('tools/execute', async (exec, next) => {
      const result = await next()
      const pending = takePending(exec)
      if (pending === undefined) return result
      ctx.logger.warn(`[canvas-studio][${pending.code}] ${pending.devDetail}`)
      return decorateStudioToolResult(result, pending.code)
    }),
    'canvas-studio: tool error boundary',
  )
}

/** 取出并清除本次调用暂存的失败信息；没暂存（或 exec 不是对象）时返回 undefined。 */
export function takePending(exec: unknown): PendingFailure | undefined {
  if (typeof exec !== 'object' || exec === null) return undefined
  const pending = PENDING.get(exec)
  if (pending === undefined) return undefined
  PENDING.delete(exec)
  return pending
}

/**
 * 纯函数：把错误码写进工具结果的 `error.info`（框架据此填 session 事件的
 * `data.error = { name, code }`）。
 *
 * 两条不写规则：
 * - 不是失败结果 → 原样返回（成功结果没有 `error` 字段）。
 * - 已经有 `info` → 原样返回。框架自己写入的结构化身份优先（`TOOL_ABORTED`
 *   用户打断 / `TOOL_TIMEOUT` 超时）：覆盖它会让客户端把「用户主动取消」误判
 *   成业务失败。
 */
export function decorateStudioToolResult(result: ToolExecutionResult, code: string): ToolExecutionResult {
  if (!result.isError) return result
  if (result.error.info !== undefined) return result
  return {
    ...result,
    error: { ...result.error, info: { name: STUDIO_ERROR_INFO_NAME, code } },
  }
}
