/**
 * OPT-12（2026-10-26）：按工具的**必填参数**守卫（Host 侧，唯一入口接线）。
 *
 * ## 抓的是什么 bug
 *
 * 模型漏传「下游不可补救」的关键参数，产物带着错值走完全链路才发现 ——
 * session.v4-4 实证：为分镜生成效果图漏传 `aspectRatio` → 按 16:9 缺省出图，
 * 画幅不符，同图重做 3 次（~100s 纯浪费）。
 *
 * ## 为什么拦在唯一入口
 *
 * 与占位值守卫（`param-guard.ts`）同一手法：`wrapStudioToolDefinition` 是全部
 * studio 工具的必经点，拒收发生在 `execute` 之前 ⇒ **零副作用**（不解析项目、
 * 不落节点、不发请求）。每条规则一个函数、一条工具一行注册；
 * `tests/tool-required-params.test.mjs` 直接打本模块与包装器两层。
 *
 * ## 收窄口径（宁可漏判，不可误判）
 *
 * 只收「缺了必然产出错误产物、且模型在调用点能自行推出正确值」的参数。
 * `aspectRatio` 缺省 16:9 对大多数调用是**对的** —— 所以只在「为分镜生成效果图」
 * （`shotRefs` 在场）时强制显式：分镜 meta.aspect 是设计决定，模型此刻手里就有它，
 * 不该靠缺省赌。其余工具/场景一律放行。
 */

import { throwError } from './error-system.js'

/** 单条工具的参数规则：返回 `null` = 放行；返回字符串 = 拒收理由（要可执行）。 */
type ToolParamRule = (args: Record<string, unknown>) => string | null

/** 分镜效果图必须显式定画幅：三个出图工具（都有 shotRefs + aspectRatio）共用。 */
const shotAspectRule: ToolParamRule = (args) => {
  const shotRefs = args.shotRefs
  if (Array.isArray(shotRefs) && shotRefs.length > 0 && args.aspectRatio === undefined) {
    return '为分镜生成效果图（传了 shotRefs）时必须**显式传 aspectRatio** —— 从该镜所属分镜的 meta.aspect 取（16:9 / 9:16 / 1:1）。'
      + '缺省会按 16:9 出图，画幅不符只能整图重做。'
  }
  return null
}

const TOOL_PARAM_RULES: Readonly<Record<string, ToolParamRule>> = {
  image_generate: shotAspectRule,
  image_generate_withtxt: shotAspectRule,
  character_generate: shotAspectRule,
}

/**
 * 工具入参必填校验（在 `execute` 之前调用）。未注册规则的工具直接放行。
 * @throws `CS-USER-ERR` —— 命中规则时，文案即修正指引。
 */
export function assertRequiredToolParams(tool: string, args: unknown): void {
  if (args === null || typeof args !== 'object') return
  const rule = TOOL_PARAM_RULES[tool]
  if (rule === undefined) return
  const reason = rule(args as Record<string, unknown>)
  if (reason !== null) {
    throwError('CS-USER-ERR', { message: reason })
  }
}
