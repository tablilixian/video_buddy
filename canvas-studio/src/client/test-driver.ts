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
 * 既有行为逐字节不变：判定逻辑、轮询间隔、超时常量与错误码全部原样搬迁。
 */
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { throwError } from '../error-system.js'
import '../errors/catalog.js'

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
 * @param sessions - the client `ISessions` face（与 index.ts 的 `sessionSvc` 同一实例）。
 */
export function createTestDriver(sessions: ISessions): TestDriver {
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
      throwError('CS-EFFECT-003')
    },
  }
}
