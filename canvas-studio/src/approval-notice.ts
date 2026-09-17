/**
 * 审批提交的工具结果文案（提示词层）—— 三个 `submit_*_for_approval` 的返回文本
 * 唯一实现。
 *
 * ## 为什么文案要单独抽出来
 *
 * 实测（2026-09-14，同一天同一个模型）两次审批的结果文本：
 *
 * | 工具 | 文本长度 | 「本回合到此结束」的位置 | 模型行为 |
 * | --- | --- | --- | --- |
 * | `submit_screenplay_for_approval` | 152 字符 | 第 74 字符（**49%**） | ✅ 停住了 |
 * | `submit_storyboard_for_approval` | **1080 字符** | 第 **1023** 字符（**95%**） | ❌ 继续跑 |
 *
 * 差别不在"写没写停止指令"，而在**位置**：分镜那条的前 1000 字符全是 16 张分镜卡
 * 的标题 + UUID +「逐镜出图时把 shotRefs 设为…」，对一个 27B 本地模型来说这就是
 * 一份"下一步清单"，停止指令被压到最后一行等于没写。
 *
 * 所以本模块把两件事**物理隔开**，而不是靠措辞变凶：
 * 1. 第一行 = 停手指令（模型最先读到、且不掺任何可执行内容）；
 * 2. 卡清单这类**获批后才用得上**的材料统一走 `deferred`，前面加一道显式围栏，
 *    并明说"现在不要据此行动"。
 *
 * 文案的**结构**（而非字面）由 `tests/approval-notice.test.mjs` 钉住：首行必须是
 * 停手、`deferred` 必须整段出现在停手之后、放手跑分支不得出现停手。
 *
 * 真正的闸在 `approval-gate.ts`（拦调用）+ `host-tools.ts` 的 `exec.concludeTurn()`
 * （在提交那一刻结束回合）。本模块只负责**少浪费几步**：模型越早自己停，越不容易
 * 在 `concludeTurn` 生效前抢跑同一步的并发工具调用。
 */
import type { StudioWorkflowMode } from './contracts/project.js'

/** 三道审批门。 */
export type ApprovalGate = 'screenplay' | 'storyboard' | 'keyframes'

/** 审批门文案的固定部分。 */
interface GateCopy {
  /** 提交了什么（工具结果里的第一句陈述）。 */
  readonly submitted: string
  /** 在等用户做什么。 */
  readonly waiting: string
  /** 获批后该做什么（用户发「继续」之后）。 */
  readonly next: string
  /** 放手跑模式下直接往下走的那句话（不加停手横幅）。 */
  readonly autoNext: string
}

const GATE_COPY: Readonly<Record<ApprovalGate, GateCopy>> = {
  screenplay: {
    submitted: '剧本已提交到画布',
    waiting: '等用户在画布上方点「批准剧本」或「驳回，继续修改」',
    next: '读 references/shot-format.md 后输出分镜表并调 submit_storyboard_for_approval',
    autoNext: '直接进入分镜规划：按目标总时长推导镜头数（总时长 ÷ 单镜 8–10s）后输出分镜表并调用 submit_storyboard_for_approval。',
  },
  storyboard: {
    submitted: '分镜表已拆卡落到画布',
    waiting: '等用户点「批准并开始制作」或「驳回，继续修改」',
    next: '按标准工作流第 4→5→6 步继续（一致性资产卡 → 定妆锚点 → 逐镜出图）',
    autoNext: '直接开始执行生成流程：第 4→5→6 步（一致性资产卡 → 定妆锚点 → 逐镜出图）。',
  },
  keyframes: {
    submitted: '关键帧已全部生成并落到画布',
    // CV-051：确认条上多了「打回重出」，等的是两个决策而不是一个。
    waiting: '等用户点「确认关键帧」或「打回重出」（用户可能先在画布上二次编辑关键帧，编辑完成后仍需再次确认）',
    next: '按标准工作流第 8→9→10 步继续（文案 → 逐镜视频 → 成片合成）',
    autoNext: '关键帧确认已放行，继续第 8→9→10 步（文案 → 逐镜视频 → 成片合成）。',
  },
}

/**
 * 停手首行。**必须是返回文本的第一个字符起** —— 位置就是这个模块存在的理由，
 * 不要把它挪到任何陈述之后。
 */
export const APPROVAL_HOLD = '⛔ 停手：本回合到此结束，不要再调用任何工具。'

/** `deferred` 段的围栏标题。 */
export const DEFERRED_FENCE = '—— 以下是获批后才需要的信息，现在不要据此行动 ——'

/** `approvalNotice` 的入参。 */
export interface ApprovalNoticeInput {
  readonly gate: ApprovalGate
  /** 执行模式：`auto` 直接放行，不加停手横幅。 */
  readonly mode: StudioWorkflowMode
  /** 一句话概述（工具入参的 `summary`）。 */
  readonly summary?: string
  /** 获批后才需要的信息（分镜卡标题 + id 清单等）。留空则整段省略。 */
  readonly deferred?: string
}

/**
 * 产出提交审批的工具结果文本。
 *
 * `mode === 'auto'`（放手跑）返回放行文案（无停手）；逐步确认模式返回停手文案，
 * 并把 `deferred` 隔到围栏之后。
 */
export function approvalNotice(input: ApprovalNoticeInput): string {
  const copy = GATE_COPY[input.gate]
  const summary = input.summary !== undefined && input.summary.trim().length > 0
    ? `（${input.summary.trim()}）`
    : ''
  const parts: string[] = []

  if (input.mode === 'auto') {
    parts.push(`${copy.submitted}${summary}（放手跑模式，已直接放行）。${copy.autoNext}`)
  } else {
    parts.push(APPROVAL_HOLD)
    parts.push(
      `${copy.submitted}${summary}，${copy.waiting}。获批后用户会发「继续」，届时再${copy.next}。`
      + '停手期间不要读文件、不要加载 skill、也不要做任何"准备工作" ——'
      + '那些是获批后的下一步，不是可以并行做的事。',
    )
    // 「若用户给出修改意见」这条必须留着：驳回后用户可能直接在对话里说意见而不点
    // 驳回按钮，此时 state 仍停在审阅态，agent 必须照做（`approval-gate.ts` 只管
    // 产出类工具，写作类是放行的）。
    parts.push('若用户给出修改意见，按意见修改后重新提交本工具。')
  }

  const deferred = input.deferred?.trim()
  if (deferred !== undefined && deferred.length > 0) {
    parts.push(DEFERRED_FENCE)
    parts.push(deferred)
  }

  return parts.join('\n')
}
