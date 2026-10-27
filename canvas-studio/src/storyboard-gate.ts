/**
 * 故事板强约束 **L1 · 单一放行点**：任何产出类工具在「本项目故事板未落地」时都不可能成功执行。
 *
 * ## 为什么要有这个文件
 *
 * 患病史（会话 #5，2026-10-25）：用户 @36 分钟当场质问「故事板完成了吗？就开始设计图片？」。
 * 根因不是模型不听劝，而是**判据有三份、各说各话**：
 *
 * | # | 判据 | 原位置 | 漏在哪 |
 * |---|---|---|---|
 * | 1 | `mode !== 'confirm' → 放行` | `approval-gate.ts` | **auto 模式全放行**：放手跑 = 可以跳过故事板 |
 * | 2 | `state === 'storyboarding'` 才拦 | `approval-gate.ts` | 只看 state 不看 landed；state 写坏了门就开了 |
 * | 3 | `landStoryboard()` 内部 `validateForSeed` | `storyboard-land.ts` | 只管「能不能落」，不管「能不能开工」 |
 *
 * 在任何单个工具里各写一遍 `if (!landed) throw` 只会把 3 份变成 4 份 —— 下次新增一个
 * 产出工具（比如「批量出图」）时，没人记得去加第 5 份。所以收敛到**一个**判定 + **一个**名单。
 *
 * ## 判据只有一个：`storyboard.json.landed`
 *
 * 与 `mode`（confirm / auto）、`state`（storyboarding / keyframe_review / executing）、
 * 入口（对话 / 自动化 / 脚本）**全部无关**。`workflow.state` 降级为派生显示（L2 自愈负责
 * 在两者不一致时补推），**不参与放行** —— 否则「自愈」就会变成后门。
 *
 * ## 为什么包装器改 `execute` 而不是给工具定义加字段
 *
 * `@deepseek-ai/dsh-tools` 的 `DefineToolOptions` 是封闭 interface，加不了自定义字段。
 * 我们自己的 `withStoryboardGate()` 是唯一能在不 fork SDK 的前提下做到「声明式 + 单点」的地方。
 *
 * ## 名单与 `approval-gate.ts` 的 `FORMAL_TOOLS` 必须相等
 *
 * 两表分居两个模块（`FORMAL_TOOLS` 还要给 `keyframe_review` 分支用，不能搬），所以
 * `tests/storyboard-gate.test.mjs` **同时 import 两处**做对账 —— 单模块里自证会漏。
 * 新增产出工具只改这里，对账测试会替你把 `FORMAL_TOOLS` 也补齐。
 */
import { throwError } from './error-system.js'
import { loadStoryboard } from './storyboard-store.js'
import type { ProjectRegistry } from './projects.js'

/**
 * 要挂「故事板已落地」前置的工具（产出类）。
 *
 * = `approval-gate.ts` 的 `FORMAL_TOOLS`（9 个）+ `write_script`。
 *
 * `write_script` 在这里而不在 `FORMAL_TOOLS`：它的产物是画布文案节点，与「产线」略有区别，
 * 且必须在 `keyframe_review` 期放行（按意见改写文案，否则流程卡死）—— 而本闸与 state 无关，
 * 挂在这里正好只锁「未落地」这一件事。
 *
 * **不挂的**：`image_generate` / `character_generate` / `look_card` 等 Look 阶段动作
 * （现状就允许在澄清期出样张），以及全部读类/分析类工具。
 */
export const STORYBOARD_GATED_TOOLS: ReadonlySet<string> = new Set([
  'video_generate',
  'video_composite',
  'compose_video',
  'extract_last_frame',
  'qc_shot',
  'music_generation',
  'tts_voiceover',
  // P1-1（2026-10-26）：批量旁白 —— 产物与 tts_voiceover 同性质（音频节点），必须同口径。
  'tts_narration',
  'render_composition',
  'write_script',
])

/** 开关（默认开，`CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED=0` 一键退回旧行为）。 */
export function enforceStoryboardLandedEnabled(): boolean {
  return process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED !== '0'
}

/**
 * §07 素材就绪门禁的开关（默认开，`CANVAS_STUDIO_ENFORCE_ASSET_READINESS=0` 退回旧行为）。
 *
 * 为什么放在这个模块：它和「故事板已落地」是**同一类闸**（拦的是"还没准备好就动手"），
 * 而且都必须能被一次 env 全关掉以便回滚。集中在一处，回滚清单就不会漏。
 */
export function enforceAssetReadinessEnabled(): boolean {
  return process.env.CANVAS_STUDIO_ENFORCE_ASSET_READINESS !== '0'
}

/**
 * 断言本项目故事板已落地；未落地即抛 `CS-STORY-001`。
 *
 * 文件缺失 / 读不出来 / 旧 schema 一律按「未落地」处理 —— 这三种情况下画布上不可能有
 * 由故事板铸出的分镜卡（落地是唯一铸造入口），放行只会让产物与规划脱节。
 */
export async function assertStoryboardLanded(
  registry: ProjectRegistry,
  projectId: string,
  toolName: string,
): Promise<void> {
  if (!enforceStoryboardLandedEnabled()) return

  const loaded = await loadStoryboard(registry, projectId)
  if (loaded.status === 'ok' && loaded.document.landed !== null) return

  // 损坏留证的情况单独说清：agent 重试一万次也不会好，必须先处理盘上那个文件。
  if (loaded.status === 'corrupt') {
    throwError('CS-USER-ERR', {
      message: `本项目的故事板文件读不出来（已留证为 ${loaded.backup}），无法确认是否已落地，因此产线工具「${toolName}」暂不可用。请先处理该文件，再重试。`,
    })
  }
  if (loaded.status === 'stale') {
    throwError('CS-USER-ERR', {
      message: `本项目的故事板是旧格式（schemaVersion ${String(loaded.found)}，当前需要 ${String(loaded.expected)}），无法确认是否已落地，因此产线工具「${toolName}」暂不可用。请先用 write_storyboard 重新写一份。`,
    })
  }

  throwError('CS-STORY-001', { tool: toolName })
}

/** 包装器需要的依赖：**只决定「怎么拿到 projectId 并断言」**，不重复实现解析。 */
export type StoryboardGateCheck = (toolName: string, exec: unknown) => Promise<void>
/** 被包装工具的最小形状（`execute` 的入参形状由 SDK 决定，这里不复制它的签名）。 */
interface GatedTool {
  readonly name: string
  readonly execute?: (...args: never[]) => unknown
}

/**
 * 给名单内的工具统一套上「故事板已落地」前置。名单外原样返回（同一个对象，零开销）。
 */
export function withStoryboardGate<T extends GatedTool>(
  tools: readonly T[],
  check: StoryboardGateCheck,
): T[] {
  return tools.map((tool) => {
    if (!STORYBOARD_GATED_TOOLS.has(tool.name)) return tool
    if (typeof tool.execute !== 'function') return tool
    const original = tool.execute.bind(tool) as (...args: unknown[]) => unknown
    return {
      ...tool,
      execute: async (args: unknown, exec: unknown) => {
        await check(tool.name, exec)
        return original(args, exec)
      },
    } as T
  })
}

/**
 * **L2 · 状态自愈**：`landed` 存在、`state` 却还停在 `storyboarding`（历史数据不一致、
 * 迁移写坏、或早期版本先落 `landed` 后崩在推状态那一步）⇒ 补推 `executing`。
 *
 * **只修显示，不放行**：放行仍只认 `landed`（见 `assertStoryboardLanded`）。这条边界
 * 必须守住 —— 否则「自愈」就变成绕过门禁的后门（把 state 写坏即可开工）。
 *
 * 返回 `true` 表示本次真的补推了（调用方据此刷新自己手里的 state 副本）。
 */
export async function healStoryboardState(
  registry: ProjectRegistry,
  projectId: string,
  state: string,
): Promise<boolean> {
  if (state !== 'storyboarding') return false
  // 闸关掉（回滚模式）时不碰用户状态：那时 state 仍是唯一判据，改它等于改了行为。
  if (!enforceStoryboardLandedEnabled()) return false
  const loaded = await loadStoryboard(registry, projectId)
  if (loaded.status !== 'ok' || loaded.document.landed === null) return false
  await registry.updateWorkflow(projectId, { state: 'executing' })
  return true
}
