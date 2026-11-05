/**
 * P2-1 · max-tokens 兜底（**降级版**：不 steer，只落宿主观察）。
 *
 * ## 事故形状
 * 11-05 会话第 2、3 个 turn 的 `turn/end.reason.kind` 都是 `max-tokens`，且该轮
 * **0 次工具调用** —— 输出预算全烧在思考里，一步没落地就结束了，下一轮再从零想一遍。
 * 三个小时就是这么过去的。
 *
 * ## 为什么不做 steer
 * 宿主替不了「落草稿」：计划在模型脑子里，只有它能写。`steer()` 能逼它立刻写
 * `build/NEXT.md`，但那会改变 turn 语义，**验收只能真机**、失败也没法回滚。
 * 所以这里只做两件确定的事：
 *  1. 把观察落成 `build/NEXT.md`（磁盘事实，压缩也不会丢）；
 *  2. 下一轮第一次工具返回时，把提醒挂在结果尾部（模型必然会读到的地方）。
 *
 * ## 为什么是 NEXT.md 而不是 PROGRESS.md
 * `PROGRESS.md` 每次出片都由宿主整体重写（只保留模型手写的「下一步 / 未决」两段），
 * 往里追加会被下一次渲染冲掉；`NEXT.md` 独立成文件，只在下一次 max-tokens 时覆盖。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 与 `render-anchor.ts` 的 `build/` 同目录；独立文件，不被 PROGRESS.md 重写波及。 */
export const NEXT_FILE = 'NEXT.md'

/**
 * 落 `build/NEXT.md`；失败返回 null。
 *
 * **不抛**：这是辅助设施，turn 已经在收尾，写盘失败不该再制造一个错误出来。
 */
export function writeBudgetNote(projectDir: string, markdown: string): string | null {
  try {
    const dir = join(projectDir, 'build')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, NEXT_FILE)
    writeFileSync(path, markdown, 'utf8')
    return path
  } catch {
    return null
  }
}

export interface BudgetNoteInput {
  now: number
  /** 故事板落地时刻；老项目可能没有（此时不提 T+，只提「本轮被掐断」）。 */
  landedAt?: number | undefined
  /** 当前最佳版本（没有成片时不传）。 */
  best?: { version: number; durationSec: number; trackCount: number } | undefined
  /** 该轮工具调用数（触发条件就是 0）。 */
  toolCalls: number
  /** 本次会话第几次被掐断（含本次）。 */
  strikes: number
}

function minutesSince(now: number, landedAt: number | undefined): number | null {
  if (landedAt === undefined || !Number.isFinite(landedAt) || landedAt <= 0) return null
  return Math.max(0, Math.floor((now - landedAt) / 60_000))
}

/**
 * `build/NEXT.md` 正文。
 *
 * 刻意**不给计划模板**（「第一步…第二步…」）：那会诱导模型用小作文填满它，再被
 * 同一次输出的预算掐死。这里只写事实 + 三条动作，且明确要求它用**工具**回答。
 */
export function renderBudgetNote(input: BudgetNoteInput): string {
  const elapsed = minutesSince(input.now, input.landedAt)
  const clock = elapsed === null ? '未落地（还没到画布可开工那一刻）' : `T+${String(elapsed)}min`
  const best = input.best === undefined
    ? '尚无成片'
    : `当前最佳 v${String(input.best.version)} · ${input.best.durationSec.toFixed(2)}s · ${String(input.best.trackCount)} 轨`
  return [
    '# 上一轮因输出预算耗尽（max-tokens）被掐断',
    '',
    `- 时间：${new Date(input.now).toISOString()}（${clock}）`,
    `- 该轮工具调用：${String(input.toolCalls)} 次`,
    `- 累计被掐断：${String(input.strikes)} 次`,
    `- 进度：${best}`,
    '',
    '## 下一轮怎么做（按顺序，别跳）',
    '',
    '1. 先读 `build/PROGRESS.md`（当前版本 / 下一步 / 未决）。**不要重推整片，不要读 `src/remotion/**`**。',
    '2. 如果要改片：`scaffold_manifest({ writeTo: "build/manifest.json" })` → `render_composition({ manifestPath, quality: "draft" })`。',
    '3. 把新的「下一步」写回 `build/PROGRESS.md` 的对应段（宿主重写时会保留这两段）。',
    '',
    '> 这份文件是**宿主**写的观察，不是你的计划。计划请写进 `build/PROGRESS.md` 的「下一步」段。',
    '',
  ].join('\n')
}

/**
 * 挂在下一次工具返回尾部的一行（只给一次，读到即消费）。
 *
 * 为什么必须挂在工具返回上：模型不读文件也可能继续干 —— 但工具返回它一定会看到。
 */
export function budgetGuardLine(input: { toolCalls: number; strikes: number }): string {
  const turn = input.toolCalls === 0 ? '该轮 0 次工具调用' : `该轮仅 ${String(input.toolCalls)} 次工具调用`
  return `⚠️ 上一轮因输出预算耗尽被掐断（${turn}，第 ${String(input.strikes)} 次）：`
    + '已把观察写进 `build/NEXT.md`。恢复后先读它 + `build/PROGRESS.md`，'
    + '**别在思考里重推整片** —— 下一步直接用工具出片（`scaffold_manifest({writeTo})` → `render_composition`）。'
}
