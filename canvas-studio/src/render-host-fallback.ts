/**
 * RenderHost 连续不可用熔断（四季片复盘 R-03 保底层；独立于 bundle 未执行的根因修复，
 * 单独 commit 可回滚）。
 *
 * 病：隐藏窗口页面脚本起不来（`__csRenderHost` 永远未定义）时，每单仍要付 8s 冷启等待
 * （`pickExecutor` 的 warmup 循环），失败后才回退画布页 —— 真机连续两单 = 2×90s 盲等 +
 * 24 步排障（session 5b6dcfc6，环境空转 ≈14min）。修根因之前，先把「明知窗口死了还每单
 * 白等 8s」这笔钱省下来。
 *
 * 口径：
 * - 按 projectId 记「隐藏窗口连续不可接管」次数（`noteRenderHostSkip`，由
 *   `runRenderJob` 在 fallbackReason 为冷启超时分支时调用）；连续 `RENDER_HOST_TRIP_AFTER`
 *   次 ⇒ 后续工单跳过冷启等待直接派画布页（画布页执行器本就有完整超时/看门狗链路）。
 * - 隐藏窗成功接管一张单（`noteRenderHostServed`，结算时与 `markRenderHostServedJob`
 *   同点调用）⇒ 清零。
 * - 自愈探针：熔断后每 `RENDER_HOST_REPROBE_EVERY` 单放行一次完整冷启等待 —— 窗口若已
 *   恢复，那一单会成功并清零；否则只白等一次，不再每单都等。
 *
 * 内存态、按项目隔离、不落盘、不动历史数据（与 `render-probe-budget.ts` 同形态）。
 */

/** 连续多少次「窗口没就绪」后熔断（跳过冷启等待）。 */
export const RENDER_HOST_TRIP_AFTER = 2

/** 熔断后每隔多少单放行一次完整冷启等待（自愈探针）。 */
export const RENDER_HOST_REPROBE_EVERY = 10

const states = new Map<string, { consecutive: number }>()

function keyOf(key: string): string {
  // key 由调用方给（projectId）；空串归到同一个桶，避免 Map 里出现语义不明的键。
  return key === '' ? '*' : key
}

/** 一张单走了画布页（且原因是「窗口存在但没就绪」）—— 连续计数 +1。 */
export function noteRenderHostSkip(key: string): void {
  const k = keyOf(key)
  const state = states.get(k) ?? { consecutive: 0 }
  state.consecutive += 1
  states.set(k, state)
}

/** 隐藏窗成功接管 —— 清零（窗口恢复，下次正常走冷启等待）。 */
export function noteRenderHostServed(key: string): void {
  states.delete(keyOf(key))
}

/**
 * 该项目本单是否跳过隐藏窗冷启等待（直接派画布页）。
 * 未熔断 / 恰逢自愈探针节拍 ⇒ false（照常等待）。
 */
export function shouldSkipRenderHostWait(key: string): boolean {
  const state = states.get(keyOf(key))
  if (state === undefined || state.consecutive < RENDER_HOST_TRIP_AFTER) return false
  // consecutive 已含本次之前的次数；第 2、3、…、9 单跳过，第 10 单放行探一次
  return state.consecutive % RENDER_HOST_REPROBE_EVERY !== 0
}

/** 测试与排障辅助：读当前连续计数。 */
export function renderHostSkipCount(key: string): number {
  return states.get(keyOf(key))?.consecutive ?? 0
}

/** 测试辅助：清空全部状态（进程内单测隔离用；生产不调用）。 */
export function resetRenderHostFallbackForTests(): void {
  states.clear()
}
