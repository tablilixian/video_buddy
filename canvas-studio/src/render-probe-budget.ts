/**
 * 阶段二轮次硬闸（CV-447 T1-A4）：`render_composition(probe:true)` 累计 3 次后拒收。
 *
 * 依据：`skills/code-driven-explainer/references/verification.md`（T0-A3 已落的规则文本）
 * 与阶段二方案 §8 D5 —— probe ≤3 次 / 每次 ≤8 帧 + 成片后 1 次批注。
 *
 * 为什么在**唯一入口**（`wrapStudioToolDefinition`）判：所有 canvas-studio 工具都过这
 * 一个包装点，拒收发生在任何副作用之前（不解析项目、不落节点、不发渲染请求）；
 * 写在 `host-tools.ts` 的 `execute` 里也能拦，但那里还有第二道入口风险（绕过包装直接调
 * execute 的实现路径不会过闸）。
 *
 * 计数按项目隔离；任何**非 probe** 的 `render_composition`（成败不论）都会清零 ——
 * 全片草稿出来之后允许重新用探针批注，但不是无限重置。
 */
import { throwError } from './error-system.js'
// 触发错误码注册（`throwError` 依赖 REGISTRY；独立 import 本模块的调用点不会走到
// tool-error-boundary 的 catalog 导入）。
import './errors/catalog.js'

export const PROBE_LIMIT = 3

const used = new Map<string, number>()

/** 当前探针用量（测试与埋点用；不改状态）。 */
export function probeUsage(projectId?: string): number {
  return used.get(projectId ?? '_current') ?? 0
}

/** 工具执行前的硬闸：超限抛 `CS-USER-ERR`（文案直接给降级出口）。 */
export function guardProbeBudget(toolName: string, args: unknown): void {
  if (toolName !== 'render_composition' || typeof args !== 'object' || args === null) return
  const input = args as { probe?: unknown; projectId?: unknown }
  const key = typeof input.projectId === 'string' && input.projectId !== '' ? input.projectId : '_current'
  if (input.probe === true) {
    const count = (used.get(key) ?? 0) + 1
    used.set(key, count)
    if (count > PROBE_LIMIT) {
      throwError('CS-USER-ERR', {
        message: `探针已用满 ${PROBE_LIMIT} 次（第 ${count} 次被拒收）。按 verification.md 的硬闸：把剩余问题记成未决项，`
          + '转 `quality:"draft"` 渲全片落画布看整体，再在成片上核对细节——不要继续逐帧试错。',
      })
    }
    return
  }
  // 全片渲染（draft / standard / high）：出片即清零，允许成片后的批注探针。
  used.delete(key)
}

/** 测试用：清空全部计数。 */
export function resetProbeBudget(): void {
  used.clear()
}
