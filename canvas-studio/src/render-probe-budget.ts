/**
 * 阶段二轮次硬闸（CV-447 T1-A4）：把「探针 ≤3 次 + 成片后 1 次批注」变成机器判据。
 *
 * 依据：`skills/code-driven-explainer/references/verification.md`（T0-A3 规则文本）
 * 与阶段二方案 §8 D5 —— probe ≤3 次 / 每次 ≤8 帧 + 成片后 1 次批注。
 *
 * ⚠️ 口径修正（CV-447 后续）：`render_composition` 有**两条**探针路径 ——
 * `probe:true`（诊断渲）与 `spotFrames:[...]`（只渲静帧，见
 * `host-tools.ts:3811,3826-3833`：`probe || spot` 都不落节点、不编码成片）。
 * 真机事故里反复探 `[1100,1150]` 走的是 spotFrames。只判 `probe:true` 会让主路径
 * 完全绕过闸；更糟的是旧实现把任何非 probe 调用当成「出了全片」并 `delete` 计数，
 * 一次 spot 调用就能把已用额度清零 ⇒ 闸形同虚设。
 *
 * 现在：两条路径都算探针；只有**既无 probe 又无 spotFrames** 的真全片渲染才标记
 * 「已出片」；已出片后只放行 **1 次**批注探针，用满即拒收，且计数永不清零。
 * 全片渲染本身不受闸限制（超时续渲是唯一出片路径，不能被闸挡住）。
 *
 * 为什么在**唯一入口**（`wrapStudioToolDefinition`）判：所有 canvas-studio 工具都过这
 * 一个包装点，拒收发生在任何副作用之前（不解析项目、不落节点、不发渲染请求）。
 *
 * 计数按项目隔离，仅驻内存 —— 插件重载即重置，但单次会话内不会因渲全片而重置。
 */
import { throwError } from './error-system.js'
// 触发错误码注册（`throwError` 依赖 REGISTRY；独立 import 本模块的调用点不会走到
// tool-error-boundary 的 catalog 导入）。
import './errors/catalog.js'

/** 出片前的探针预算（含 spotFrames 快验）。 */
export const PROBE_LIMIT = 3
/** 全片落地后允许的批注探针次数（D5：人工反馈收敛到成片后 1 次）。 */
export const ANNOTATION_LIMIT = 1

interface BudgetState {
  /** 累计探针类调用（含被拒收的，避免靠拒绝循环绕闸）。 */
  probes: number
  /** 是否已经发起过一次真全片渲染（成败不论，入口处判不到结果）。 */
  delivered: boolean
  /** 成片后已用掉的批注探针次数。 */
  annotations: number
}

const states = new Map<string, BudgetState>()

const KEY_FALLBACK = '_current'

function stateOf(key: string): BudgetState {
  const found = states.get(key)
  if (found !== undefined) return found
  const fresh: BudgetState = { probes: 0, delivered: false, annotations: 0 }
  states.set(key, fresh)
  return fresh
}

function keyOf(args: object): string {
  const projectId = (args as { projectId?: unknown }).projectId
  return typeof projectId === 'string' && projectId !== '' ? projectId : KEY_FALLBACK
}

/** 只有这两条路径之外的 `render_composition` 才是真全片渲染。 */
function isProbeCall(args: object): boolean {
  const input = args as { probe?: unknown; spotFrames?: unknown }
  return input.probe === true
    || (Array.isArray(input.spotFrames) && input.spotFrames.length > 0)
}

/** 当前探针用量（测试与埋点用；不改状态）。 */
export function probeUsage(projectId?: string): number {
  return stateOf(projectId ?? KEY_FALLBACK).probes
}

/** 成片后批注已用量（测试与埋点用；不改状态）。 */
export function annotationUsage(projectId?: string): number {
  return stateOf(projectId ?? KEY_FALLBACK).annotations
}

/** 是否已发起过全片渲染（测试与埋点用；不改状态）。 */
export function hasDelivered(projectId?: string): boolean {
  return stateOf(projectId ?? KEY_FALLBACK).delivered
}

/** 工具执行前的硬闸：超限抛 `CS-USER-ERR`（文案直接给降级出口）。 */
export function guardProbeBudget(toolName: string, args: unknown): void {
  if (toolName !== 'render_composition' || typeof args !== 'object' || args === null) return
  const key = keyOf(args)
  const state = stateOf(key)

  if (!isProbeCall(args)) {
    // 真全片渲染：只标记，绝不清零。成败不论（入口处拿不到结果），避免失败重试
    // 变成「再换一轮探针额度」。
    state.delivered = true
    return
  }

  state.probes += 1
  if (state.delivered) {
    if (state.annotations >= ANNOTATION_LIMIT) {
      throwError('CS-USER-ERR', {
        message: `成片后批注已用满 ${ANNOTATION_LIMIT} 次（第 ${state.probes} 次探针被拒收）。`
          + '把剩余问题写成未决项清单随片交付并结束本回合（turn/end），不要再逐帧试错。',
      })
    }
    state.annotations += 1
    return
  }

  if (state.probes > PROBE_LIMIT) {
    throwError('CS-USER-ERR', {
      message: `探针已用满 ${PROBE_LIMIT} 次（第 ${state.probes} 次被拒收）。`
        + '按 verification.md 的硬闸：把剩余问题记成未决项，'
        + '转 `quality:"draft"` 渲全片落画布看整体，成片后只允许 1 次批注——不要继续逐帧试错。',
    })
  }
}

/** 测试用：清空全部计数。 */
export function resetProbeBudget(): void {
  states.clear()
}
