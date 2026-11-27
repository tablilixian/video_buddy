/**
 * 生成结果文本里的**积分口径**（预估 → 实扣）。
 *
 * 为什么单独一个文件而不是写在 `generate.ts` 里：这两件事（查账、改文案）与生成
 * 链路本身无关，而 `generate.ts` 已经贴着单文件行数闸。更重要的是它表达的是一条
 * **纪律**，值得有自己的门面：
 *
 * - 提交时只能说「预估」——那一刻服务端还没结算，任何「实际」都是编的；
 * - 生成成功后若账本里已经有 `commit`，把那一句**就地换成**实扣（替换而不是追加：
 *   同一笔钱在结果里只该有一句陈述）；
 * - 账还没落库 / 查询超时 / 账户面故障 ⇒ **保留预估**，绝不猜一个数字。
 */
import { generationSpend, markGenerationSpendPending } from './account-state.js'

/**
 * 查实扣的等待上限（毫秒）。
 *
 * 这笔查询是**锦上添花**（把结果文本里的「预估」换成真数），绝不能拖慢一次已经
 * 成功的生成：账没落库时服务端就是没有这条记录，等多久都白等。
 */
export const SPEND_LOOKUP_TIMEOUT_MS = 2_000

/** 积分数的展示精度：服务端给 4 位小数，前端只做四舍五入到同位，不改口径。 */
function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** 提交时刻的预估文案；`null` = 没报出价（不写这条 warning）。 */
export function estimateCreditNote(estimated: number | null): string | null {
  return estimated === null
    ? null
    : `本次生成预估消耗 ${round(estimated)} 积分（提交时冻结，任务失败自动释放；以服务端结算为准）。`
}

/** 查一次某笔生成的实扣；超时 / 失败 / 没有记录一律 `null`。 */
export async function settledCreditsOf(generationId: string): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const view = await Promise.race([
      generationSpend([generationId]),
      new Promise<null>((resolve) => { timer = setTimeout(() => { resolve(null) }, SPEND_LOOKUP_TIMEOUT_MS) }),
    ])
    if (view === null) return null
    const credits = view.credits[generationId]
    return typeof credits === 'number' ? credits : null
  } catch {
    // 账户面故障（未登录 / 网络）不该影响生成结果的措辞：保持预估。
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 生成成功后的收尾：登记待对账 + 尽量把「预估」改写成实扣。
 *
 * 登记与改写放在一起，是因为它们必须成对出现——只登记不改写，客户端拿得到数字
 * 但结果文本还在说「预估」；只改写不登记，客户端那次查询会白跑一趟（缺了
 * `ledgerStale` 就只剩 TTL 兜底）。
 */
export async function noteGenerationSettled(
  warnings: string[] | undefined,
  estimateNote: string | null,
  generationId: string,
  estimated: number | null,
  /**
   * 查实扣（缺省 `settledCreditsOf`）。测试注入桩 —— 行为（就地替换 / 保留预估 /
   * 超时不拖慢）必须是行为断言，源码字符串断言抓不住「替换变追加」「indexOf 永远 -1」
   * 这类破坏（2026-11-27 审查 P1-4）。
   */
  spendLookup: (generationId: string) => Promise<number | null> = settledCreditsOf,
): Promise<void> {
  markGenerationSpendPending(generationId)
  if (warnings === undefined || estimateNote === null || estimated === null) return
  const index = warnings.indexOf(estimateNote)
  if (index < 0) return
  const spent = await spendLookup(generationId)
  if (spent === null) return
  warnings[index] = Math.abs(spent - estimated) < 0.00005
    ? `本次生成消耗 ${round(spent)} 积分（服务端结算，与预估一致）。`
    : `本次生成实际消耗 ${round(spent)} 积分（预估 ${round(estimated)}，以服务端结算为准）。`
}
