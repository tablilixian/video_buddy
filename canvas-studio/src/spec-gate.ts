/**
 * spec 编排闸（批 2-1.2 / 2.1，会话 19 病灶：绕开 scaffold 手搓 spec 68 步未出 +
 * confirm_intent_card 被模型跳过——真机 0 次调用）。
 *
 * 三态按「会话键」隔离（与 render-probe-budget.ts 同形态，仅驻内存；插件重载即重置，
 * 重启后 fail-open —— 手写 manifest 由 `meta.generatedBy` 标记的观察期 warning 兜底观测）：
 * - `confirm_intent_card` 成功 ⇒ intentCardSeen。放手跑（auto）下该工具**不弹卡、不等待**、
 *   直接返回默认值组装的意图卡（host-tools.ts 描述原文），调用零成本 —— 会话 19 的
 *   0 次调用是模型跳过，不是模式限制，所以这道闸对 auto 模式零负担；
 * - `write_storyboard` 成功 ⇒ storyboardLanded；
 * - `scaffold_manifest` 成功 ⇒ scaffoldSeen。
 *
 * 检查点（唯一入口 `wrapStudioToolDefinition`，先于一切 execute 副作用）：
 * - `write_storyboard`：intentCardSeen=false ⇒ 拒收（文案说明 auto 下零成本）；
 * - `render_composition`：storyboardLanded=false ⇒ 放行（无故事板的流不受限）；
 *   intentCardSeen=false ⇒ 拒收；scaffoldSeen=false ⇒ 拒收（文案给 scaffold→spec→builder 正路）。
 *
 * 与 probe budget 的差别：闸的是「流程顺序」不是「次数」——见一次成功即置位、永不清零。
 *
 * 已知边界（有意为之，登记备查）：
 * - 状态按**会话键**隔离 ⇒ 同一会话先后做多个项目时，前一个项目置位的 intent/scaffold
 *   会让后一个项目免检（近似而非逐项目精确）；probe budget 同款取舍（render_composition
 *   契约要求不传 projectId，见 tool-error-boundary.sessionKeyOf 注释）。
 * - 闸对全部体裁生效：六体裁 / 复刻线的 write_storyboard 同样要求先 confirm_intent_card
 *   （auto 下零成本、confirm 下本就是设计中的 HITL）；拒收文案自带出口，模型可自愈。
 */

export interface SpecGateVerdict {
  readonly intentCardSeen: boolean
  readonly storyboardLanded: boolean
  readonly scaffoldSeen: boolean
  /** render_composition 是否放行（storyboard 未落地 ⇒ 一律放行）。 */
  readonly renderAllowed: boolean
  /** renderAllowed=false 时的缺项（'intent' | 'scaffold'）。 */
  readonly missing: 'none' | 'intent' | 'scaffold'
}

interface SpecGateState {
  intentCardSeen: boolean
  storyboardLanded: boolean
  scaffoldSeen: boolean
}

const states = new Map<string, SpecGateState>()

function stateOf(key: string): SpecGateState {
  const found = states.get(key)
  if (found !== undefined) return found
  const fresh: SpecGateState = { intentCardSeen: false, storyboardLanded: false, scaffoldSeen: false }
  states.set(key, fresh)
  return fresh
}

/** 会话键为空时归入同一个桶（与 render-probe-budget 的 KEY_FALLBACK 同口径）。 */
function keyOf(key?: string): string {
  return key === undefined || key === '' ? '_current' : key
}

/** confirm_intent_card 成功返回（auto 下 = 直接拿到默认卡）⇒ 置位。 */
export function noteIntentCard(key?: string): void {
  stateOf(keyOf(key)).intentCardSeen = true
}

/** write_storyboard 成功返回 ⇒ 置位。 */
export function noteStoryboard(key?: string): void {
  stateOf(keyOf(key)).storyboardLanded = true
}

/** scaffold_manifest 成功返回 ⇒ 置位（此后 render_composition 的 scaffold 缺项解除）。 */
export function noteScaffold(key?: string): void {
  stateOf(keyOf(key)).scaffoldSeen = true
}

/** 只读快照（测试与诊断用）。 */
export function specGateSnapshot(key?: string): SpecGateVerdict {
  const state = stateOf(keyOf(key))
  const missing: SpecGateVerdict['missing'] = !state.intentCardSeen
    ? 'intent'
    : !state.scaffoldSeen ? 'scaffold' : 'none'
  return {
    intentCardSeen: state.intentCardSeen,
    storyboardLanded: state.storyboardLanded,
    scaffoldSeen: state.scaffoldSeen,
    renderAllowed: !state.storyboardLanded || (state.intentCardSeen && state.scaffoldSeen),
    missing: state.storyboardLanded ? missing : 'none',
  }
}

/** 测试辅助：清空全部状态（生产不调用）。 */
export function resetSpecGateForTests(): void {
  states.clear()
}
