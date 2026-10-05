/**
 * 测试驱动共用模块（REQ-021 / 应用内一键测试模式）。
 *
 * 把一键效果测试（2026-09-02）在 client/index.ts 里验证过的三件最难的事——
 * 会话绑定等待、回合空闲判据、程序化发送的等待原语——抽成独立模块，供两条
 * 编排共用：
 *
 * - `runEffectTests`（effect-test-runner skill 的驱动器，既有流程零回归）；
 * - 自动测试场景执行器（REQ-021，固定剧本直发，见 index.ts 的 runAutoTestScenario）。
 *
 * 「回合空闲判据」全仓只准这一份实现（CS-UNC-000 教训：两份判据必然漂移）。
 *
 * 为什么在 src/ 根（2026-10-05 从 src/client/ 挪出）：BUG-014 的边界单测要
 * node:test 直连本模块，而客户端代码打成单包（`lib/client.js`）无法 import ——
 * 与 auto-test-checkpoints.ts / project-naming.ts 同一条先例（可单测模块落
 * src/ 根，tests/*.test.mjs 直连 lib 产物）。
 *
 * BUG-014（R001 实证 49:59.88 自然完成被判超时）后的行为口径：**deadline 让位
 * 空闲判定**——回合在预算内自然完成（见过 running）时，允许 deadline 到点后
 * 再轮询至多 2 次凑满「连续 2 次空闲」，超时语义由此成为「回合墙钟 + 空闲尾巴
 * 余量」；只有回合真未在预算内结束才抛 CS-EFFECT-003。除此之外判定逻辑、
 * 轮询间隔、超时常量与错误码保持原样。
 */
import { throwError } from './error-system.js'
import './errors/catalog.js'

/**
 * waitAgentTurn / waitSessionBound 消费的最小会话快照面（结构兼容 client
 * `ISessions.list.getSnapshot()` 的投影——本模块在 src/ 根被 Host tsc 直编，
 * Host 工程没有 skipLibCheck，直接 import client-runtime 类型会把它的
 * .d.ts 链拖进 Host 编译而炸（TS2307/TS2717）；客户端把真实 `ISessions`
 * 传进来，相容性由 client 工程（tsconfig.client.json）检查）。
 */
export interface EffectTestSessionSummary {
  id: string
  cwd?: string
  running?: boolean
  pendingInteraction?: unknown
}

export interface EffectTestSessionsFace {
  list: {
    getSnapshot(): { current?: string; byId: Record<string, EffectTestSessionSummary> }
  }
}

/** 等 openProject 的 fire-and-forget startSession 把会话绑到项目目录的上限。 */
export const EFFECT_TEST_START_TIMEOUT_MS = 240_000

/** 单条测试指令整个 agent 回合（启动 + 全部工具）的墙钟上限。 */
export const EFFECT_TEST_CASE_TIMEOUT_MS = 50 * 60_000

/** 编排轮询的睡眠原语（waitSessionBound 1500ms / waitAgentTurn 3000ms 两档沿用）。 */
export const effectTestPoll = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 编排可用的等待原语（按会话服务实例绑定）。 */
export interface TestDriver {
  /** 等当前会话切到目标项目（cwd 匹配；openProject 的 startSession 是 fire-and-forget）。 */
  waitSessionBound(projectDir: string, timeoutMs: number): Promise<string>
  /** 等一轮 agent 回合完整结束（启动 → 稳定空闲）。 */
  waitAgentTurn(sessionId: string, timeoutMs: number): Promise<void>
}

/**
 * Bind the wait primitives to a sessions service.
 *
 * @param sessions - the client sessions face（结构兼容 `ISessions`，与 index.ts 的
 *   `sessionSvc` 同一实例）。
 */
export function createTestDriver(sessions: EffectTestSessionsFace): TestDriver {
  return {
    async waitSessionBound(projectDir: string, timeoutMs: number): Promise<string> {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const summary = sessions.list.getSnapshot()
        const current = summary.current === undefined ? undefined : summary.byId[summary.current]
        if (current !== undefined && current.cwd === projectDir) return current.id
        await effectTestPoll(1500)
      }
      throwError('CS-EFFECT-001')
    },
    async waitAgentTurn(sessionId: string, timeoutMs: number): Promise<void> {
      const started = Date.now()
      let sawRunning = false
      let idleStreak = 0
      while (Date.now() - started < timeoutMs) {
        const summary = sessions.list.getSnapshot().byId[sessionId]
        if (summary?.running === true) sawRunning = true
        const idle = summary !== undefined && summary.running !== true && summary.pendingInteraction === undefined
        idleStreak = idle ? idleStreak + 1 : 0
        if (sawRunning && idleStreak >= 2) return
        if (!sawRunning && Date.now() - started > EFFECT_TEST_START_TIMEOUT_MS) {
          throwError('CS-EFFECT-002')
        }
        await effectTestPoll(3000)
      }
      // BUG-014：deadline 到点不立即判死 —— 只要见过 running，说明回合确实启动过，
      // 可能刚在预算尾段自然完成而轮询还没凑满「连续 2 次空闲」（3s 间隔 ≈ 需要
      // ≈6s 空闲尾巴，R001 turn 0 实证 49:59.88 完成 vs ≈49:54 有效判定窗）。让
      // deadline 让位空闲判定：再给至多 2 次轮询凑满 idleStreak，凑满 = 正常返回。
      // 从未见过 running（启动超时在循环内已抛 CS-EFFECT-002）或 grace 窗口内仍
      // 未凑满空闲，才算「回合真未在预算内结束」→ CS-EFFECT-003。
      if (!sawRunning) throwError('CS-EFFECT-003')
      for (let grace = 0; grace < 2; grace += 1) {
        await effectTestPoll(3000)
        const summary = sessions.list.getSnapshot().byId[sessionId]
        if (summary?.running === true) sawRunning = true
        const idle = summary !== undefined && summary.running !== true && summary.pendingInteraction === undefined
        idleStreak = idle ? idleStreak + 1 : 0
        if (sawRunning && idleStreak >= 2) return
      }
      throwError('CS-EFFECT-003')
    },
  }
}
