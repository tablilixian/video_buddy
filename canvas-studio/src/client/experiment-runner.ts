/**
 * 借鉴+翻拍 3v3 实验执行器（从 client/index.ts 外提）。
 *
 * 为什么外提：index.ts 的 studioClient 是「单文件 1200 行 / 单函数 600 行」棘轮
 * 白名单里的巨函数，只准减不准增。把编排主体放这里，index.ts 只留依赖接线，
 * 既过了护栏，也让这段实验代码可以单独测、单独删。
 *
 * 与 runAutoTestScenario 的区别：那种场景是「同一项目里逐条发送剧本」；这里每跑
 * 建一个全新项目 + 全新会话，发的是冻结首句**原文**（不包装、不追加指令），
 * 等整轮 agent 回合空闲后才建下一跑。单跑失败不中断整轮。
 *
 * 聊天发送仍走唯一实现：send 由 index.ts 注入 sendChatText，本模块不取
 * conversation 句柄，不绕过登录闸（tests/auth-entry-gate.test.mjs 钉住）。
 */
import { asCanvasError, isDevMode, routeError, throwError } from '../error-system.js'
import { EFFECT_TEST_CASE_TIMEOUT_MS, EFFECT_TEST_START_TIMEOUT_MS, type TestDriver } from '../test-driver.js'
import type { StudioProject } from '../contracts/project.js'
import type { AutoTestRunState, ProjectStoreState } from './project-store.js'
import { EXPERIMENT_6RUN_LABEL, experiment6Cases } from '../experiment-6run.js'

export interface ExperimentDeps {
  store: {
    getSnapshot(): ProjectStoreState
    actions: { patchAutoTest(patch: Partial<AutoTestRunState>): void }
  }
  createProject(label: string): Promise<StudioProject>
  refreshProjects(): Promise<void>
  openProject(project: StudioProject): Promise<boolean>
  driver: TestDriver
  /** 唯一聊天发送实现（sendChatText），由 index.ts 注入。 */
  send(sessionId: string, text: string): Promise<boolean>
  isStopRequested(): boolean
  clearStopRequested(): void
}

type LogKind = 'info' | 'pass' | 'fail'

export async function runExperiment6(deps: ExperimentDeps): Promise<void> {
  if (deps.store.getSnapshot().autoTest?.running) return
  const cases = experiment6Cases()
  const logs: { at: number; text: string; kind: LogKind }[] = []
  const patch = (value: Partial<AutoTestRunState>): void => { deps.store.actions.patchAutoTest(value) }
  const appendLog = (text: string, kind: LogKind = 'info'): void => {
    logs.push({ at: Date.now(), text, kind })
    patch({ log: [...logs] })
  }
  deps.clearStopRequested()
  const originProjectId = deps.store.getSnapshot().selectedProjectId
  patch({
    running: true, scenarioId: 'experiment-6run', scenarioLabel: EXPERIMENT_6RUN_LABEL,
    round: null, currentStep: '准备：串行创建 6 个独立项目', projectId: null, projectName: null,
    log: [], checkpoints: [], reportProjectId: null, reportProjectName: null,
    originProjectId, finished: false, ok: null, message: null,
  })
  // 轮次号沿用 效果验证-R#（吃到既有启动清扫 + 清理按钮），6 跑共用一个轮次。
  const maxRound = deps.store.getSnapshot().projects.reduce((acc, project) => {
    const match = /^效果验证-R(\d+)-/.exec(project.name)
    return match === null ? acc : Math.max(acc, Number(match[1]))
  }, 0)
  const round = `R${String(maxRound + 1).padStart(3, '0')}`
  patch({ round })
  let done = 0
  let failed = 0
  let stopped = false
  for (const item of cases) {
    if (deps.isStopRequested()) { stopped = true; break }
    const label = `效果验证-${round}-EXP-${item.id}-${item.group}`
    patch({
      currentStep: `${item.id} / ${item.group}：新建项目 → 发送首句 → 等 agent 回合结束（上限 50 分钟）`,
      projectId: null, projectName: label,
    })
    try {
      // 放手跑模式随创建落盘，免去创建后再补一次 setWorkflowMode。
      const project = await deps.createProject(label)
      await deps.refreshProjects()
      patch({ projectId: project.id, projectName: project.name })
      await deps.openProject(project)
      const sessionId = await deps.driver.waitSessionBound(project.dir, EFFECT_TEST_START_TIMEOUT_MS)
      appendLog(`${item.id}（${item.group}）会话已绑定：${project.name}`)
      if (!await deps.send(sessionId, item.prompt)) {
        throwError('CS-EFFECT-004', { detail: 'conversation service undefined' })
      }
      await deps.driver.waitAgentTurn(sessionId, EFFECT_TEST_CASE_TIMEOUT_MS)
      done += 1
      appendLog(`${item.id}（${item.group}）回合结束，成片与转录留在项目目录`, 'pass')
    } catch (cause) {
      failed += 1
      const failure = asCanvasError(cause)
      const action = routeError(failure, { devMode: isDevMode() })
      appendLog(`${item.id}（${item.group}）失败：${action.kind === 'surface' ? action.message : action.dev}（继续下一跑）`, 'fail')
    }
  }
  patch({
    running: false, finished: true, currentStep: null,
    ok: failed === 0 && !stopped && done === cases.length,
    message: stopped
      ? `实验已手动停止：成功 ${done} · 失败 ${failed} · 未跑 ${cases.length - done - failed}。`
      : `6 跑结束：成功 ${done} · 失败 ${failed}。项目名 效果验证-${round}-EXP-X<n>-Gx；转录在 ~/.videobuddy/sessions/，跑 scripts/experiment-6run.mjs collect 出报告。`,
  })
}
