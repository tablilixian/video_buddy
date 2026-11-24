/**
 * 本地价目表（B 层）：`capabilities/pricing.json` 的**唯一读取点**，以及
 * 「报价请求体 → 金额 + 逐行拆解」的**唯一纯函数**。
 *
 * ## 铁律：只做兜底与拆解，绝不覆盖 quote
 *
 * 展示优先级恒为 `quote 结果` > `价目表推算（标「约」）` > `—`。本模块的所有
 * 出口都带「这是推算」的语义标记（{@link PriceEstimate.ageDays}），调用方
 * （`account-state.ts`）按来源写 `source: 'table'`，UI 据此降级成「约 N」。
 *
 * 一条过期的表**必须**降级成「约」：后端改价时它不是「旧价」，是「猜的价」。
 *
 * ## 为什么表里只有 10 条规则
 *
 * 实测（方案 §1.1）后端只有两个计价维度：**面积**与**时长**。视频不分分辨率
 * （480P 与 1080P 同价 6/秒），图片不按档位（按像素面积），参考素材不进报价。
 * 因此这张表**不可能也不需要**长成「一分钟 480P/720P/1080P 三行」那种形式 ——
 * 写成那样就是在表里编造后端不存在的维度。
 *
 * ## 表从哪来
 *
 * `scripts/probe-pricing.mjs` 逐点调 `POST /v1/generations/quote` 采样并反推
 * rate（只读、不扣分），产出本文件。手改表中数字没有意义 —— 下次采样会被覆盖，
 * 而且改了也不会让服务端少收钱。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CreditBreakdownLine } from './contracts/account.js'
import type { GenerationQuoteRequest } from './credit-quote.js'

/** 计价基底：面积 / 时长 / 固定价。三者之外后端没有别的维度。 */
export type PriceBasis = 'pixels' | 'seconds' | 'flat'

/** 一条计价规则（= 一个 operation 的算法）。 */
export interface PriceRule {
  readonly operation: string
  /** 采样过的模型 code（**同 operation 同价**是实测事实，不是假设）。 */
  readonly models: readonly string[]
  readonly basis: PriceBasis
  /** pixels: 积分/px；seconds: 积分/秒；flat: 每次固定积分。 */
  readonly rate: number
  /** operation 级系数（`image2image` 的 1.25）；`seconds` / `flat` 恒为 1。 */
  readonly multiplier: number
  readonly sampledAt: string
}

export interface PriceTable {
  /** 整表采样时刻（ISO）；不可解析 ⇒ 整表不被采用（表龄不可知就不能标「新鲜」）。 */
  readonly sampledAt: string
  readonly source: string
  /** operation → 规则。 */
  readonly rules: ReadonlyMap<string, PriceRule>
}

/** 一次推算的结果（含拆解行与表龄）。 */
export interface PriceEstimate {
  readonly credits: number
  readonly lines: readonly CreditBreakdownLine[]
  readonly basis: PriceBasis
  /** 请求的模型在采样名单里（false ⇒ 按同 operation 的价估，文案要说清）。 */
  readonly modelMatched: boolean
  readonly ageDays: number
}

/** 表龄超过这个天数就必须按「约」展示（方案 §4.3 建议值）。 */
export const MAX_TABLE_AGE_DAYS = 7

/** 复算与服务端报价的容差：4 位小数的舍入误差，不是「差不多」。 */
const CREDITS_EPSILON = 0.0001

const DAY_MS = 86_400_000

/**
 * 4 位小数取整 —— 与服务端 quote 的精度**同源**。
 *
 * 服务端报 1376×768 得 21.1354，而 `1376*768*0.00002` 是 21.13536；不复算到同一
 * 精度就永远差最后一两位，拆解行加总也对不上总数。
 */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** 表龄（天，向下取整）；`sampledAt` 不可解析 ⇒ `null`。 */
export function ageDaysOf(sampledAt: string, now: number = Date.now()): number | null {
  const at = Date.parse(sampledAt)
  if (!Number.isFinite(at)) return null
  // 未来时间（时钟回拨/采样机时区错）按 0 天算，不当成负龄 —— 负数会让「过期」
  // 判断永远为假，等于悄悄关掉了新鲜度闸。
  return Math.max(0, Math.floor((now - at) / DAY_MS))
}

/** 表是否在新鲜期内。没有表 ⇒ false。 */
export function isTableFresh(table: PriceTable | null, now: number = Date.now()): boolean {
  if (table === null) return false
  const days = ageDaysOf(table.sampledAt, now)
  return days !== null && days <= MAX_TABLE_AGE_DAYS
}

/**
 * 从磁盘读表。**永不抛错**：读不到 / JSON 坏 / 结构不合规 ⇒ `null`，
 * 调用方回落到「没有拆解、没有兜底」，而不是让整个报价链路 500。
 */
export function loadPriceTable(): PriceTable | null {
  if (cached !== undefined) return cached
  let raw: unknown
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'capabilities', 'pricing.json')
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    cached = null
    return null
  }
  cached = parsePriceTable(raw)
  return cached
}

/** 清缓存（测试用：换一份表给同一进程内的多次断言）。 */
export function resetPriceTableCache(): void {
  cached = undefined
}

/** `undefined` = 还没读过；`null` = 读过但不可用（不重复打盘）。 */
let cached: PriceTable | null | undefined

/**
 * 解析表文档。**单条坏规则只丢那条**（其余仍可用），但 `sampled_at` 不可解析
 * ⇒ 整表作废：没有表龄的表无法判定新鲜度，用它会伪装成精确值。
 */
export function parsePriceTable(raw: unknown): PriceTable | null {
  if (raw === null || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const sampledAt = typeof doc['sampled_at'] === 'string' ? doc['sampled_at'] : ''
  if (ageDaysOf(sampledAt) === null) return null
  const source = typeof doc['source'] === 'string' ? doc['source'] : 'unknown'
  const rules = new Map<string, PriceRule>()
  const list = Array.isArray(doc['rules']) ? doc['rules'] : []
  for (const item of list) {
    const rule = parseRule(item, sampledAt)
    if (rule !== null) rules.set(rule.operation, rule)
  }
  if (rules.size === 0) return null
  return { sampledAt, source, rules }
}

function parseRule(raw: unknown, tableSampledAt: string): PriceRule | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const operation = typeof item['operation'] === 'string' ? item['operation'] : ''
  const basis = item['basis']
  const rate = item['rate']
  if (operation === '') return null
  if (basis !== 'pixels' && basis !== 'seconds' && basis !== 'flat') return null
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  const multiplierRaw = item['multiplier']
  const multiplier = typeof multiplierRaw === 'number' && Number.isFinite(multiplierRaw) && multiplierRaw > 0
    ? multiplierRaw
    : 1
  const modelsRaw = item['models']
  const models = Array.isArray(modelsRaw)
    ? modelsRaw.filter((model): model is string => typeof model === 'string' && model !== '')
    : []
  const sampledAtRaw = item['sampledAt']
  const sampledAt = typeof sampledAtRaw === 'string' && ageDaysOf(sampledAtRaw) !== null ? sampledAtRaw : tableSampledAt
  return { operation, models, basis, rate, multiplier, sampledAt }
}

/**
 * 推算一次报价。
 *
 * 返回 `null` 的三种情况（都是「不知道」，不是「0」）：
 * 1. 表里没有这个 operation；
 * 2. 该 operation 需要尺寸而请求没带正数 `width`/`height`；
 * 3. 该 operation 需要时长而请求没带正数 `duration`。
 *
 * 注意**不看 prompt**：它只影响模型路由，而计价与模型无关（图片按面积、视频按
 * 时长）。把 prompt 掺进来会让同一价格的请求算出不同的数。
 */
export function estimatePrice(
  request: GenerationQuoteRequest,
  table: PriceTable | null = loadPriceTable(),
  now: number = Date.now(),
): PriceEstimate | null {
  if (table === null) return null
  const rule = table.rules.get(request.operation)
  if (rule === undefined) return null
  const ageDays = ageDaysOf(table.sampledAt, now)
  if (ageDays === null) return null
  const input = request.input
  const modelMatched = rule.models.includes(request.model)

  if (rule.basis === 'flat') {
    return {
      credits: round4(rule.rate),
      lines: [{ label: '固定价', detail: '按次计费，与尺寸/时长无关', credits: round4(rule.rate) }],
      basis: 'flat',
      modelMatched,
      ageDays,
    }
  }

  if (rule.basis === 'seconds') {
    const duration = positiveOf(input, 'duration')
    if (duration === null) return null
    const credits = round4(duration * rule.rate)
    const lines: CreditBreakdownLine[] = []
    if (positiveOf(input, 'megapixels') !== null) {
      // 这一行是**纠正**而不是凑数：旧 UI 给清晰度加 6/14 分，而后端根本不按它计价。
      lines.push({ label: '清晰度', detail: `${String(input['megapixels'])} MP · 不计价`, credits: 0 })
    }
    lines.push({ label: '时长', detail: `${trimNumber(duration)}s × ${trimNumber(rule.rate)}`, credits })
    return { credits, lines, basis: 'seconds', modelMatched, ageDays }
  }

  const width = positiveOf(input, 'width')
  const height = positiveOf(input, 'height')
  if (width === null || height === null) return null
  const area = width * height
  const base = round4(area * rule.rate)
  const credits = round4(area * rule.rate * rule.multiplier)
  const lines: CreditBreakdownLine[] = [{
    label: '画面面积',
    detail: `${trimNumber(width)}×${trimNumber(height)} = ${(area / 1_000_000).toFixed(2)}MP × ${trimNumber(rule.rate)}`,
    credits: base,
  }]
  if (rule.multiplier !== 1) {
    // 系数行用**差值**而不是再乘一遍：两行相加必须严格等于总数，否则明细加总
    // 与合计差 0.0001，用户会以为算错了。
    lines.push({ label: '图生图系数', detail: `×${trimNumber(rule.multiplier)}`, credits: round4(credits - base) })
  }
  return { credits, lines, basis: 'pixels', modelMatched, ageDays }
}

/**
 * 用价目表把**服务端已给出的总数**拆成单项（B1）。
 *
 * 复算与 `credits` 不一致 ⇒ `null`（不返回拆解）。这是硬闸：后端改价后表就是旧
 * 的，此时继续展示拆解会出现「拆解加总 90、总数 105」这种自相矛盾的明细，比不给
 * 明细更糟。调用方只把它当可选装饰，`null` 就退回「只显示总数」。
 */
export function breakdownOf(
  request: GenerationQuoteRequest,
  credits: number,
  table: PriceTable | null = loadPriceTable(),
  now: number = Date.now(),
): readonly CreditBreakdownLine[] | null {
  const estimate = estimatePrice(request, table, now)
  if (estimate === null) return null
  if (Math.abs(estimate.credits - credits) > CREDITS_EPSILON) return null
  return estimate.lines
}

/** 表元信息（给 BillingPage / 详情抽屉写「价目表采样于 X」）。 */
export function priceTableMeta(table: PriceTable | null = loadPriceTable(), now: number = Date.now()): {
  sampledAt: string
  ageDays: number
  fresh: boolean
  rules: number
} | null {
  if (table === null) return null
  const ageDays = ageDaysOf(table.sampledAt, now)
  if (ageDays === null) return null
  return { sampledAt: table.sampledAt, ageDays, fresh: ageDays <= MAX_TABLE_AGE_DAYS, rules: table.rules.size }
}

function positiveOf(input: Record<string, unknown>, key: string): number | null {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** 数字 → 文案（去掉浮点尾巴：`0.00002` 保持原样，`15.0` 变 `15`）。 */
function trimNumber(value: number): string {
  return String(value)
}
