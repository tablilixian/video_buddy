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
 * 现在：两条路径都算探针；只有**既无 probe 又无 spotFrames** 的真全片渲染才可能标记
 * 「已交付」；已交付后只放行 **1 次**批注探针，用满即拒收，且计数永不清零。
 * 全片渲染本身不受闸限制（超时续渲是唯一出片路径，不能被闸挡住）。
 *
 * ⚠️ P1-1 口径修正（2026-11-10，瑞幸 C 档 `9853fa28` 真机）：旧实现把**任何**非探针
 * 渲染（含 `quality:"draft"` 草稿）都置 `delivered=true` ⇒ 文档要求「首轮渲染就用
 * spotFrames + 每轮必渲 draft」时，第一版草稿就把成片后批注额度打开，第 1 次结构探针
 * 被误算成「成片后批注」，第 2 次即拒收 ⇒ 尾部 CTA 446–609 帧全程没验到。
 * 现在 `delivered` 只由**交付档**触发（`quality` = standard / high / 缺省 standard）；
 * `quality:"draft"` 是半分辨率草稿（0.5 scale，`compose.ts` 就地替换、不进版本链），
 * 不触发批注闸。于是两桶额度语义清晰：
 *   **结构探针 ≤3（草稿 / 交付前）+ 成片后批注 ≤1（交付档之后）** = 单会话最多 4 次。
 *
 * 额度**只在对图片有产出时扣**（2026-11-06 修正）：前置检查
 * {@link guardProbeBudget} 只判不收，成功返回后由 {@link commitProbeBudget} 记账。
 * 校验失败 / 宿主失联 / 用户打断都不消耗额度。
 *
 * 为什么在**唯一入口**（`wrapStudioToolDefinition`）判：所有 canvas-studio 工具都过这
 * 一个包装点，拒收发生在任何副作用之前（不解析项目、不落节点、不发渲染请求）。
 *
 * 计数按**会话**隔离（见 {@link keyOf}），仅驻内存 —— 插件重载即重置，但单次会话内不会
 * 因渲全片而重置。
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
  /** 是否已经发起过一次**交付档**全片渲染（成败不论，入口处判不到结果）。 */
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

/**
 * 计数桶的键。
 *
 * ⚠️ 旧实现只认 `args.projectId`，而 `render_composition` 按契约**不传** projectId
 * （工具描述第 ④ 条：「不要传 projectId（省略即当前项目）」）⇒ 永远落进
 * `_current` 一个全局桶。真机后果（2026-11-06 A/B 实测）：上一条会话留下的
 * `probes=5 / delivered / annotations=1` 被下一条会话完整继承，新会话的**第一次**
 * spotFrames 就被拒收「成片后批注已用满 1 次」，全程零探针、只能靠连渲 draft 硬猜，
 * 多烧 7 分钟。
 *
 * 现在的优先级：
 *   1. 显式 `projectId`（工具真的传了才生效；测试与显式指定项目走这条）；
 *   2. **会话 id**（`exec.agent.session.header.id`，由唯一入口传进来）—— 正常路径；
 *   3. `KEY_FALLBACK`（拿不到会话信息时兜底，例如脱离 agent 的直接调用）。
 *
 * 为什么会话而不是项目：探针预算是「一条片子的产出手法纪律」，同一项目分几天做两条
 * 片子时，新会话必须从 0 起。
 */
function keyOf(args: object, sessionKey?: string): string {
  const projectId = (args as { projectId?: unknown }).projectId
  if (typeof projectId === 'string' && projectId !== '') return projectId
  if (typeof sessionKey === 'string' && sessionKey !== '') return sessionKey
  return KEY_FALLBACK
}

/** 只有这两条路径之外的 `render_composition` 才是真全片渲染。 */
function isProbeCall(args: object): boolean {
  const input = args as { probe?: unknown; spotFrames?: unknown }
  return input.probe === true
    || (Array.isArray(input.spotFrames) && input.spotFrames.length > 0)
}

/**
 * 只有「交付档」才标记成片落地（P1-1）。
 *
 * `quality:"draft"` 是半分辨率草稿（0.5 scale + 低码率），落的是会被就地替换的
 * 草稿节点、不进版本链；把它当「成片」会让文档要求的「首轮 spotFrames + 每轮
 * 渲 draft」在第一次草稿后就撞上批注闸（真机 CTA 段因此未复核）。
 * 宿主工单结算时 `quality` 缺省按 `'standard'`（`host-tools.ts`），故缺省也算交付档。
 *
 * ⚠️ 反向变异靶：把这里改成恒 `true` 就退回旧口径，P1-1 行为断言必须变红。
 */
function isDeliveryRender(args: object): boolean {
  return (args as { quality?: unknown }).quality !== 'draft'
}

/** 当前探针用量（测试与埋点用；不改状态）。`key` 缺省读兜底桶。 */
export function probeUsage(key?: string): number {
  return stateOf(key ?? KEY_FALLBACK).probes
}

/** 成片后批注已用量（测试与埋点用；不改状态）。 */
export function annotationUsage(key?: string): number {
  return stateOf(key ?? KEY_FALLBACK).annotations
}

/** 是否已发起过交付档全片渲染（测试与埋点用；不改状态）。 */
export function hasDelivered(key?: string): boolean {
  return stateOf(key ?? KEY_FALLBACK).delivered
}

/**
 * 工具执行**前**的硬闸：超限抛 `CS-USER-ERR`（文案直接给降级出口）。
 *
 * ⚠️ 只判不收（2026-11-06 修正）：额度在 {@link commitProbeBudget} 里扣，而它只在
 * `execute` **没有抛错**时被调用。旧实现「进闸就 +1」的代价是真机实测出来的 ——
 * 3 次探针里 2 次被自己的契约校验（`box` 与 `animate.x/y` 互斥）和宿主失联
 * （`90s 内 0/8 帧`）吃掉，**一张图都没产出**，模型却已经用掉 2/3 额度，只能靠
 * 连渲 7 次全片碰运气。闸的目的是「限制产出图片的轮次」，不是「限制出错次数」。
 *
 * 为什么不会因此被「拒绝循环」绕过：拒收本身就是抛错，绕不出任何一张图；而每一次
 * 尝试都要花一个模型步，反复撞墙只有代价没有收益。
 *
 * @param sessionKey - 调用方会话 id（`exec.agent.session.header.id`）。唯一入口
 *   `wrapStudioToolDefinition` 负责取；缺省时退回 `args.projectId` 或兜底桶。
 */
export function guardProbeBudget(toolName: string, args: unknown, sessionKey?: string): void {
  if (toolName !== 'render_composition' || typeof args !== 'object' || args === null) return
  if (!isProbeCall(args)) return
  const state = stateOf(keyOf(args, sessionKey))

  if (state.delivered) {
    if (state.annotations >= ANNOTATION_LIMIT) {
      throwError('CS-USER-ERR', {
        message: `本会话成片后批注已用满 ${ANNOTATION_LIMIT} 次（第 ${state.probes + 1} 次探针被拒收）。`
          + '把剩余问题写成未决项清单随片交付并结束本回合（turn/end），不要再逐帧试错。',
      })
    }
    return
  }

  if (state.probes >= PROBE_LIMIT) {
    throwError('CS-USER-ERR', {
      message: `本会话结构探针已用满 ${PROBE_LIMIT} 次（第 ${state.probes + 1} 次被拒收）。`
        + '按 verification.md 的硬闸：把剩余问题记成未决项，'
        + '转交付档 `quality:"standard"` / `"high"` 定稿（`quality:"draft"` 只是草稿、不会重置额度），'
        + '交付档之后还有 1 次成片后批注探针——不要继续逐帧试错。',
    })
  }
}

/**
 * 工具执行**成功**后记账：探针 +1，交付档全片渲染标记 `delivered`。
 *
 * 唯一入口 `wrapStudioToolDefinition` 在 `execute` 正常返回后调用；抛错的调用不记账
 *（校验失败 / 宿主失联 / 用户打断都不消耗额度，理由见 {@link guardProbeBudget}）。
 *
 * @param sessionKey - 同 {@link guardProbeBudget}，必须与前置检查用同一个键。
 */
export function commitProbeBudget(toolName: string, args: unknown, sessionKey?: string): void {
  if (toolName !== 'render_composition' || typeof args !== 'object' || args === null) return
  const state = stateOf(keyOf(args, sessionKey))

  if (!isProbeCall(args)) {
    // 只有交付档才标记「已交付」；draft 是草稿，不打开批注额度。
    // 计数永不清零 —— 反复渲草稿 / 交付档都换不来新的批注次数。
    if (isDeliveryRender(args)) state.delivered = true
    return
  }

  state.probes += 1
  if (state.delivered) state.annotations += 1
}

/** 测试用：清空全部计数。 */
export function resetProbeBudget(): void {
  states.clear()
}
