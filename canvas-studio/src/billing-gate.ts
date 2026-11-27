/**
 * 计费拦截（G1 余额闸 + B4 quote 硬闸）的**唯一实现点**。
 *
 * 2026-11-27 代码审查 P0-1/P1-6 的修复：此前两道闸散在 `generate.ts` 的任务执行层
 * 且**同一道 quote 闸写了两份**（图像 `runBusinessGenerationTask` 与 video
 * `businessRun` 各一份），video 车道还漏了 G1 —— 余额为 0 + 报价 fail-open 时直接
 * 放行建单。零测试覆盖（删闸全绿）。
 *
 * 归位后的口径（铁律：计费拦截的唯一入口是 `wrapStudioToolDefinition`）：
 *
 * | 闸 | 触发 | 落点 |
 * | --- | --- | --- |
 * | G1 `CS-BILL-001` | 确定读到 `available_balance <= 0` | **wrap execute 前置**（拒收先于 execute）——消耗型工具见 {@link BILLING_TOOL_NAMES} |
 * | B4 `CS-BILL-002` | 预估 > 可用余额 | 报价点（estimate 只在那里有）——图像与 video 共用 {@link assertQuoteWithinBalance} |
 *
 * 两道闸都是 fail-open：读不到余额 / 报价失败一律放行（把网络抖动变成「不能生成」
 * 是负优化；`CS-AUTH-001` 已单独拦未登录）。**不做预扣/冻结**（G2 需要后端
 * freeze/settle 接口，`/v1/credits/pricing` 全 404）。
 *
 * 判定本体是纯函数（{@link billableBalanceVerdict} / {@link quoteOverBalanceVerdict}），
 * 可零依赖单测；`assert*` 是带运行时状态的薄壳。**删掉 wrap 里的调用即失去守卫**
 * （反向变异靶见 `tests/billing-gate.test.mjs`）。
 */
import { creditsView } from './account-state.js'
import { formatCredits } from './account-format.js'
import { isDramaAuthRequired } from './auth-session.js'
import { throwError } from './error-system.js'

/**
 * **消耗积分**的工具白名单（生成类）。wrap 层只对名单内的工具拦 G1：
 * 「上传参考图」「列参考」本身不花积分，不该因为余额为 0 而被拦。
 *
 * 判据 = 该工具最终会走带报价的业务生成链（`runBusinessGenerationTask` /
 * video `businessRun` / `generateSpeech` / `generateMusic`）。**新增消耗型工具
 * 必须登记**，否则余额见底后它会照跑（`tests/billing-gate.test.mjs` 的契约名单
 * 断言会红，逼你登记）。VL/ASR（`image2vl`/`video2vl`/`asr2txt`）**在**名单内
 * ——价目表 `capabilities/pricing.json` 有真价（4/8/3 分 flat，2026-11-24 采样），
 * 是消耗型业务调用；它们只是没进 `credit-quote.ts` 的预估面（B4 预检不到，G1 仍拦）。
 * `look_card`/`compose_video`/`render_composition`/`upload_image` **不在**名单内：
 * 本地登记/合成/上传，不消耗积分（「上传参考图不该因为余额为 0 而被拦」）。
 */
export const BILLING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'image_generate',
  'image_generate_withtxt',
  'character_generate',
  'character_sheet',
  'video_generate',
  'video_composite',
  'video_rerender',
  'music_generation',
  'tts_voiceover',
  'tts_narration',
  'image2vl',
  'video2vl',
  'asr2txt',
])

/** 余额快照（`CreditBalance` 的最小读面；结构同 `contracts/account.ts`）。 */
export interface BillableBalanceView {
  available_balance: number
  frozen_balance: number
  currency: string
}

/** G1 判定参数（CS-BILL-001 的插值字段）。type 别名而非 interface：要过 `Record<string, unknown>` 入参。 */
export type BillableVerdict = {
  balance: string
  frozen: string
  currency: string
}

/**
 * G1 纯判定：确定读到 `available_balance <= 0` 时返回错误参数，否则 `null` 放行。
 *
 * 放行情形（fail-open，逐条与 `generate.ts` 原注释对齐）：余额为 `null`（从未读到 /
 * 未登录 / 管理面关闭 / 网络失败）、`available_balance` 非有限值（NaN/Infinity——
 * 服务端字段异常不该由用户承担）、余额 > 0。
 */
export function billableBalanceVerdict(balance: BillableBalanceView | null): BillableVerdict | null {
  if (balance === null) return null
  const available = balance.available_balance
  if (!Number.isFinite(available) || available > 0) return null
  return {
    balance: formatCredits(available),
    frozen: formatCredits(balance.frozen_balance),
    currency: balance.currency,
  }
}

/**
 * G1 余额闸（抛 `CS-BILL-001`）。**wrap execute 前置的唯一入口**；生成链内部
 * 不再各拦一遍（视频车道此前漏拦，就是因为闸住在执行层、各车道要自己记得抄）。
 */
export function assertBillableBalance(): void {
  // 本地模式（未配置账号体系）没有钱包，门禁无从判起。
  if (!isDramaAuthRequired()) return
  const verdict = billableBalanceVerdict(creditsView().balance)
  if (verdict !== null) throwError('CS-BILL-001', verdict)
}

/** B4 判定参数（CS-BILL-002 的插值字段）。type 别名同上。 */
export type QuoteVerdict = {
  estimated: string
  available: string
}

/**
 * B4 纯判定：预估 > 可用余额时返回错误参数，否则 `null` 放行。
 *
 * fail-open：`estimated === null`（报价接口失败）或余额读不到 / 非有限值一律放行
 * ——最终以创建响应为准。比较用严格大于（预估 == 余额放行，别把「刚好够」拦掉）。
 */
export function quoteOverBalanceVerdict(
  estimated: number | null,
  balance: BillableBalanceView | null,
): QuoteVerdict | null {
  if (estimated === null || balance === null) return null
  const available = balance.available_balance
  if (!Number.isFinite(available) || estimated <= available) return null
  return {
    estimated: String(Math.round(estimated * 10000) / 10000),
    available: String(Math.round(available * 10000) / 10000),
  }
}

/**
 * B4 quote 硬闸（抛 `CS-BILL-002`）。图像与 video 两条生成车道**共用这一个实现**
 * ——各自手写比较正是审查 P0-1 点名的漂移源。
 */
export function assertQuoteWithinBalance(estimated: number | null): void {
  const verdict = quoteOverBalanceVerdict(estimated, creditsView().balance)
  if (verdict !== null) throwError('CS-BILL-002', verdict)
}

/** 是否消耗型工具（wrap 层据此决定拦不拦 G1）。 */
export function isBillingTool(toolName: string): boolean {
  return BILLING_TOOL_NAMES.has(toolName)
}
