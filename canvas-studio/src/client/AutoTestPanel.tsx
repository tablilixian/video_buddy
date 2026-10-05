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
 * 运行事实（running / 步骤日志 / 检查点结论 / 上次报告）在 store 的独立
 * `autoTest` 切片（不碰 effectTest —— 它有既有消费者）；场景列表是版本化静态
 * 数据（auto-test-scenarios.ts），D2 起经 props 注入开始/停止回调。
 */
import { useMemo, useSyncExternalStore, type ReactElement } from 'react'
import type { CanvasStudioConfig } from '../host-config.js'
import { AUTO_TEST_SCENARIOS, type AutoTestScenario } from '../auto-test-scenarios.js'
import type { CanvasStudioSettingsScope } from './contracts.js'
import type { ProjectStoreState } from './project-store.js'

/** StudioFrame 的 store selector hook（宿主 hooks 舱自动生成的 useStudio）。 */
export type StudioSelectorHook = <T>(selector: (store: ProjectStoreState) => T) => T

export interface AutoTestPanelProps {
  /** 与 StudioFrame 同一来源的 store selector hook（同一份 store，不存在第二份状态）。 */
  useStudio: StudioSelectorHook
  /** 绑定 'canvas-studio' 命名空间的设置作用域（读 testMode 控制可见性）。 */
  settingsScope: CanvasStudioSettingsScope
  /** 启动一个场景（apply 世界的执行器；同一时刻只允许一个场景在跑）。 */
  onRunScenario: (scenario: AutoTestScenario) => void
  /** 请求停止当前场景（取消当前回合，执行器在两条回合之间落停）。 */
  onStop: () => void
}

export function AutoTestPanel(props: AutoTestPanelProps): ReactElement | null {
  const { useStudio, settingsScope, onRunScenario, onStop } = props
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
  // hooks 全部调用完再判可见性（React hooks 顺序纪律）。
  if (snapshot.value?.testMode !== true) return null
  const running = autoTest?.running === true
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
        </>
      )}
    </div>
  )
}
