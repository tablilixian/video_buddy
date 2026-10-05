/**
 * REQ-021 应用内一键测试模式的浮窗（右下角）。
 *
 * ## 为什么挂在 StudioFrame 根部
 *
 * 首页（lobby）与项目页（work）共用 StudioFrame 这一个客户端外壳 —— 浮窗挂在
 * 根 div 上，开关一开两态都可见（设计文档 §4.3「跟 effectTest 进度条同层」）。
 *
 * ## 可见性口径（拍板④，2026-10-05）
 *
 * 设置项 `testMode` **只控制按钮可见**：关 → 本组件返回 null（一个 DOM 都不出）；
 * 开 → 浮窗出现。跑不跑、何时跑永远由用户手点，没有任何定时/自动触发。
 *
 * ## 状态来源
 *
 * 运行事实（running / 步骤日志 / 检查点结论 / 上次报告项目 / 原项目 id）在 store
 * 的独立 `autoTest` 切片（不碰 effectTest —— 它有既有消费者）；场景列表是版本化
 * 静态数据（auto-test-scenarios.ts）。清理/返回/打开项目走 apply 世界的既有回调
 * （deleteStudioProject / openProject），组件只负责「看得见 + 能点」。
 */
import { useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { CanvasStudioConfig } from '../host-config.js'
import { AUTO_TEST_SCENARIOS, type AutoTestScenario } from '../auto-test-scenarios.js'
import type { StudioProject } from '../contracts/project.js'
import type { CanvasStudioSettingsScope } from './contracts.js'
import type { ProjectStoreState } from './project-store.js'

/** StudioFrame 的 store selector hook（宿主 hooks 舱自动生成的 useStudio）。 */
export type StudioSelectorHook = <T>(selector: (store: ProjectStoreState) => T) => T

export interface AutoTestPanelProps {
  /** 与 StudioFrame 同一来源的 store selector hook（同一份 store，不存在第二份状态）。 */
  useStudio: StudioSelectorHook
  /** 绑定 'canvas-studio' 命名空间的设置作用域（读 testMode 控制可见性）。 */
  settingsScope: CanvasStudioSettingsScope
  /** 项目注册表快照（清理按钮统计匹配数量用；与左栏同源）。 */
  projects: readonly StudioProject[]
  /** 启动一个场景（apply 世界的执行器；同一时刻只允许一个场景在跑）。 */
  onRunScenario: (scenario: AutoTestScenario) => void
  /** 请求停止当前场景（取消当前回合，执行器在两条回合之间落停）。 */
  onStop: () => void
  /** 清理全部历史测试项目（含已确认；返回实删数量）。 */
  onCleanup: () => Promise<number>
  /** 打开某项目（返回原项目 / 打开测试项目；走既有 openProject 链路）。 */
  onOpenProject: (projectId: string) => void
}

export function AutoTestPanel(props: AutoTestPanelProps): ReactElement | null {
  const { useStudio, settingsScope, projects, onRunScenario, onStop, onCleanup, onOpenProject } = props
  // 客户端设置作用域只有 subscribe 无推送（client/index.ts 设置订阅同款口径），
  // 用 useSyncExternalStore 订阅快照 —— 与 SettingsModal.useScope 同构。
  const scope = useMemo(
    () => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }),
    [settingsScope],
  )
  const subscribe = useMemo(() => (listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useMemo(() => () => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const autoTest = useStudio(store => store.autoTest)
  const selectedProjectId = useStudio(store => store.selectedProjectId)
  // 清理确认的本地态：删除前列数量让用户确认一次（设计文档 §4.7）。
  const [cleanupAsk, setCleanupAsk] = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupNote, setCleanupNote] = useState<string | null>(null)
  const testProjects = projects.filter(project => /^效果验证-R\d+/.test(project.name))
  // hooks 全部调用完再判可见性（React hooks 顺序纪律）。
  if (snapshot.value?.testMode !== true) return null
  const running = autoTest?.running === true
  const confirmCleanup = async (): Promise<void> => {
    setCleanupBusy(true)
    try {
      const removed = await onCleanup()
      setCleanupNote(removed > 0 ? `已删除 ${removed} 个测试项目。` : '没有可删除的测试项目。')
      setCleanupAsk(false)
    } finally {
      setCleanupBusy(false)
    }
  }
  return (
    <div className="csAutoTestPanel" role="complementary" aria-label="自动测试">
      <div className="csAutoTestHead">
        <span className="csAutoTestTitle">▶ 自动测试</span>
        <span className={`csAutoTestBadge${running ? ' csAutoTestBadgeRunning' : ''}`}>
          {running ? '运行中' : '待机'}
        </span>
      </div>
      {running && (
        <p className="csAutoTestWarning">测试运行中，请勿操作当前项目。</p>
      )}
      {/* 场景列表（一期 1 个；场景本体是版本化静态数据，见 auto-test-scenarios.ts）。 */}
      <div className="csAutoTestScenarios">
        {AUTO_TEST_SCENARIOS.map(scenario => (
          <div key={scenario.id} className="csAutoTestScenarioRow">
            <span className="csAutoTestScenarioName" title={scenario.id}>{scenario.label}</span>
            <button
              type="button"
              className="csAutoTestRunBtn"
              disabled={running}
              onClick={() => onRunScenario(scenario)}
            >
              ▶ 开始
            </button>
          </div>
        ))}
      </div>
      {running && (
        <button type="button" className="csAutoTestStopBtn" onClick={onStop}>■ 停止</button>
      )}
      {autoTest !== null && (
        <>
          {running && autoTest.currentStep !== null && (
            <p className="csAutoTestStep">{autoTest.currentStep}</p>
          )}
          {autoTest.log.length > 0 && (
            <div className="csAutoTestLog">
              {autoTest.log.map((entry, index) => (
                <span key={`${entry.at}-${index}`} className={`csAutoTestLogLine csAutoTestLog-${entry.kind}`}>
                  {entry.text}
                </span>
              ))}
            </div>
          )}
          {autoTest.finished && autoTest.message !== null && (
            <p className={`csAutoTestSummary${autoTest.ok === false ? ' csAutoTestSummaryFail' : ''}`}>
              {autoTest.message}
            </p>
          )}
          {/* 结束后的出口：报告在测试项目目录 test-report.md（验收方直接读盘），
              应用内给「打开测试项目」跳画布；「返回原项目」记住进入前的选中态。 */}
          {!running && (
            <div className="csAutoTestActions">
              {autoTest.reportProjectId !== null && (
                <button
                  type="button"
                  className="csAutoTestActionBtn"
                  onClick={() => { if (autoTest.reportProjectId !== null) onOpenProject(autoTest.reportProjectId) }}
                >
                  打开测试项目
                </button>
              )}
              {autoTest.originProjectId !== null && autoTest.originProjectId !== selectedProjectId && (
                <button
                  type="button"
                  className="csAutoTestActionBtn"
                  onClick={() => { if (autoTest.originProjectId !== null) onOpenProject(autoTest.originProjectId) }}
                >
                  返回原项目
                </button>
              )}
            </div>
          )}
        </>
      )}
      {/* 清理历史测试项目（含有内容的 —— 启动清扫只回收空项目）。 */}
      {!running && (
        <div className="csAutoTestActions">
          <button
            type="button"
            className="csAutoTestActionBtn"
            disabled={cleanupBusy}
            onClick={() => { setCleanupNote(null); setCleanupAsk(true) }}
          >
            清理历史测试项目
          </button>
        </div>
      )}
      {cleanupAsk && (
        <div className="csAutoTestConfirm">
          <span>
            将删除 {testProjects.length} 个「效果验证-」项目（含画布、产物与报告，彻底删除不可恢复）。
          </span>
          <div className="csAutoTestActions">
            <button
              type="button"
              className="csAutoTestStopBtn csAutoTestStopInline"
              disabled={cleanupBusy || testProjects.length === 0}
              onClick={() => { void confirmCleanup() }}
            >
              {cleanupBusy ? '删除中…' : '确认删除'}
            </button>
            <button
              type="button"
              className="csAutoTestActionBtn"
              disabled={cleanupBusy}
              onClick={() => { setCleanupAsk(false) }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {cleanupNote !== null && <p className="csAutoTestHint">{cleanupNote}</p>}
    </div>
  )
}
