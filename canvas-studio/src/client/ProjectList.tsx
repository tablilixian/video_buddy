import { Component, useState } from 'react'
import type { StudioProject } from '../contracts/project.js'
import { EMPTY_COPY, LOADING_COPY } from '../brand-copy.js'
import { StudioErrorState, StudioLoadingState } from './brand/States.js'
import type { EffectTestRunState } from './project-store.js'

/** 一键效果测试当前支持的用例（与 effect-test-runner skill 的 fixtures 对应）。 */
const EFFECT_TEST_CASES = ['T1', 'T1b', 'T3', 'T5', 'T6', 'T9'] as const

/** Plain props: the store projection plus plain callbacks. */
export interface ProjectListProps {
  projects: readonly StudioProject[]
  selectedProjectId: string | null
  phase: 'idle' | 'loading' | 'error'
  error: string | null
  creating: boolean
  /** 受控的新建表单开合（品牌欢迎屏「新建项目」按钮与左侧栏联动）。 */
  createOpen: boolean
  /** 新建表单开合变化回调（欢迎屏打开 → 这里展开表单）。 */
  onCreateOpenChange(open: boolean): void
  onRefresh(): void
  onCreate(name: string): Promise<void>
  onOpen(project: StudioProject): void
  onDelete(projectId: string): void
  onOpenSettings(): void
  /** 一键效果测试编排状态（null = 本会话从未跑过）。 */
  effectTest: EffectTestRunState | null
  /** 启动一轮效果测试（apply 世界串行编排）。 */
  onRunEffectTests(round: string, cases: readonly string[]): void
}

/** Relative-day label for the project creation date. */
function createdLabel(project: StudioProject): string {
  const date = new Date(project.createdAt)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

/**
 * The studio project list: an inline create form plus one row per project.
 * Clicking a row opens the project (session binding happens in the callback).
 * Each row also carries a delete affordance (confirmed before firing).
 */
function ProjectListInner(props: ProjectListProps) {
  const {
    projects: rawProjects, selectedProjectId, phase, error, creating, createOpen, onCreateOpenChange,
    onRefresh, onCreate, onOpen, onDelete, onOpenSettings, effectTest, onRunEffectTests,
  } = props
  const projects = Array.isArray(rawProjects) ? rawProjects : []
  const [draftName, setDraftName] = useState('')
  // 一键效果测试面板：用例勾选 + 轮次号（缺省按既有项目名自增）。
  const [testPanelOpen, setTestPanelOpen] = useState(false)
  const [testCases, setTestCases] = useState<readonly string[]>([...EFFECT_TEST_CASES])
  const [testRoundDraft, setTestRoundDraft] = useState('')
  const formOpen = createOpen
  const setFormOpen = (open: boolean): void => onCreateOpenChange(open)
  const submit = async () => {
    const name = draftName.trim()
    if (name.length === 0 || creating) return
    await onCreate(name)
    setFormOpen(false)
    setDraftName('')
  }
  // 轮次号自增：扫既有项目名 效果验证-R(\d+)- 取最大 +1（空输入时作为缺省值）。
  const maxRound = projects.reduce((acc, project) => {
    const match = /^效果验证-R(\d+)-/.exec(project.name)
    return match === null ? acc : Math.max(acc, Number(match[1]))
  }, 0)
  const defaultRound = `R${String(maxRound + 1).padStart(3, '0')}`
  const round = testRoundDraft.trim().length > 0 ? testRoundDraft.trim().toUpperCase() : defaultRound
  const testRunning = effectTest?.running === true
  const toggleCase = (caseId: string): void => {
    setTestCases(current => current.includes(caseId)
      ? current.filter(candidate => candidate !== caseId)
      : [...current, caseId])
  }
  return (
    <div className="csProjectList">
      {!formOpen && (
        <button
          type="button"
          className="csProjectNew"
          disabled={creating}
          onClick={() => setFormOpen(true)}
        >
          + 新建项目
        </button>
      )}
      {formOpen && (
        <div className="csProjectForm">
          <input
            className="csProjectNameInput"
            value={draftName}
            placeholder="项目名"
            autoFocus
            disabled={creating}
            onChange={(event) => { setDraftName(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
              if (event.key === 'Escape') setFormOpen(false)
            }}
          />
          <div className="csProjectFormActions">
            <button type="button" disabled={creating || draftName.trim().length === 0} onClick={() => void submit()}>
              {creating ? '创建中' : '创建'}
            </button>
            <button type="button" disabled={creating} onClick={() => setFormOpen(false)}>取消</button>
          </div>
        </div>
      )}
      {/* 一键效果测试：入口按钮 + 用例勾选面板 + 运行进度（store 驱动）。 */}
      {!formOpen && !testRunning && (
        <button
          type="button"
          className="csProjectNew"
          disabled={creating || testCases.length === 0}
          onClick={() => setTestPanelOpen(open => !open)}
        >
          ▶ 跑效果测试
        </button>
      )}
      {testPanelOpen && !testRunning && (
        <div className="csProjectForm">
          <div className="csEffectTestCases">
            {EFFECT_TEST_CASES.map(caseId => (
              <label key={caseId} className="csEffectTestCase">
                <input
                  type="checkbox"
                  checked={testCases.includes(caseId)}
                  onChange={() => toggleCase(caseId)}
                />
                {caseId}
              </label>
            ))}
          </div>
          <input
            className="csProjectNameInput"
            value={testRoundDraft}
            placeholder={`轮次号（缺省 ${defaultRound}）`}
            disabled={creating}
            onChange={(event) => { setTestRoundDraft(event.target.value) }}
          />
          <div className="csProjectFormActions">
            <button
              type="button"
              disabled={creating || testCases.length === 0}
              onClick={() => {
                onRunEffectTests(round, testCases)
                setTestPanelOpen(false)
              }}
            >
              开始（{testCases.length} 例）
            </button>
            <button type="button" disabled={creating} onClick={() => setTestPanelOpen(false)}>取消</button>
          </div>
        </div>
      )}
      {effectTest !== null && (testRunning || effectTest.finished) && (
        <div className="csEffectTestProgress">
          <span className="csEffectTestTitle">
            {testRunning
              ? `${effectTest.round} 进行中（${effectTest.currentIndex + 1}/${effectTest.queue.length}）`
              : `${effectTest.round} 已结束`}
          </span>
          {testRunning && effectTest.currentLabel !== null && (
            <span className="csEffectTestCurrent">{effectTest.currentLabel}</span>
          )}
          <span>完成 {effectTest.done.length} · 失败 {effectTest.failures.length}</span>
          {effectTest.failures.map(entry => (
            <span key={entry} className="csEffectTestFailure">{entry}</span>
          ))}
          {effectTest.finished && effectTest.message !== null && (
            <span className="csEffectTestSummary">{effectTest.message}</span>
          )}
        </div>
      )}
      {phase === 'loading' && <StudioLoadingState label={LOADING_COPY.projects} />}
      {phase === 'error' && error !== null && (
        <StudioErrorState message={error} onRetry={onRefresh} onOpenSettings={onOpenSettings} />
      )}
      {phase === 'idle' && projects.length === 0 && (
        <div className="csProjectsEmpty">
          {EMPTY_COPY.projectEmpty}
        </div>
      )}
      {projects.map(project => (
        <div
          key={project.id}
          className={project.id === selectedProjectId ? 'csProjectItem csProjectItemActive' : 'csProjectItem'}
          onClick={() => onOpen(project)}
          // CR-053：项目行键盘可达（div onClick 对键盘用户不可 Tab/回车打开）。
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen(project)
            }
          }}
        >
          <span className="csProjectMeta">
            <span className="csProjectName">{project.name}</span>
            <span className="csProjectDate">{createdLabel(project)}</span>
          </span>
          <button
            type="button"
            className="csProjectDelete"
            title="删除项目"
            disabled={creating}
            onClick={(event) => {
              event.stopPropagation()
              if (window.confirm(`确定删除项目「${project.name}」？该操作会同时删除其目录与画布，不可恢复。`)) {
                void onDelete(project.id)
              }
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

interface ProjectListErrorBoundaryState {
  crashed: boolean
  crashError: Error | null
}

/** Render boundary: if the list crashes, show the error instead of vanishing. */
class ProjectListErrorBoundary extends Component<
  { children: React.ReactNode },
  ProjectListErrorBoundaryState
> {
  override state: ProjectListErrorBoundaryState = { crashed: false, crashError: null }

  static getDerivedStateFromError(error: unknown): ProjectListErrorBoundaryState {
    return {
      crashed: true,
      crashError: error instanceof Error ? error : new Error(String(error)),
    }
  }

  override componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[canvas-studio] ProjectList render error:', error, errorInfo)
  }

  override render(): React.ReactNode {
    if (this.state.crashed) {
      return (
        <div className="csProjectError">
          <span>项目列表渲染失败: {this.state.crashError?.message ?? '未知错误'}</span>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * The studio project list: an inline create form plus one row per project.
 * Wrapped in an error boundary so crashes surface in the UI instead of being
 * swallowed by the upstream slot boundary.
 */
export function ProjectList(props: ProjectListProps) {
  return (
    <ProjectListErrorBoundary>
      <ProjectListInner {...props} />
    </ProjectListErrorBoundary>
  )
}