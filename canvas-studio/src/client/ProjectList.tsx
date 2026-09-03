import { Component, useState, type ReactNode } from 'react'
import type { StudioProject, StudioProjectGroup } from '../contracts/project.js'
import { EMPTY_COPY, LOADING_COPY } from '../brand-copy.js'
import { StudioErrorState, StudioLoadingState } from './brand/States.js'
import type { EffectTestRunState } from './project-store.js'

/** 一键效果测试当前支持的用例（与 effect-test-runner skill 的 fixtures 对应）。 */
const EFFECT_TEST_CASES = ['T1', 'T1b', 'T3', 'T5', 'T6', 'T9'] as const

/** CV-091：折叠状态持久化的 localStorage key（按 groupId 记录）。 */
const GROUP_COLLAPSE_KEY = 'canvas-studio.group-collapse'

/** 读取折叠状态（groupId → collapsed）。损坏/缺失按空对象降级。 */
function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUP_COLLAPSE_KEY)
    if (raw === null) return {}
    const value = JSON.parse(raw) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    const result: Record<string, boolean> = {}
    for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
      if (typeof flag === 'boolean') result[key] = flag
    }
    return result
  } catch {
    return {}
  }
}

/** Plain props: the store projection plus plain callbacks. */
export interface ProjectListProps {
  projects: readonly StudioProject[]
  /** CV-091：用户自定义分组（含 order，渲染前再按 order 排）。 */
  groups: readonly StudioProjectGroup[]
  selectedProjectId: string | null
  phase: 'idle' | 'loading' | 'error'
  error: string | null
  creating: boolean
  /** 受控的新建表单开合（品牌欢迎屏「新建项目」按钮与左侧栏联动，落到未分组）。 */
  createOpen: boolean
  /** 新建表单开合变化回调（欢迎屏打开 → 这里展开表单）。 */
  onCreateOpenChange(open: boolean): void
  onRefresh(): void
  /** 新建项目（groupId 省略/undefined = 未分组）。 */
  onCreate(name: string, groupId?: string | null): Promise<void>
  onOpen(project: StudioProject): void
  onDelete(projectId: string): void
  /** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
  onMoveToGroup(projectId: string, groupId: string | null): void
  /** CV-091：新建分组。 */
  onCreateGroup(name: string): Promise<void>
  /** CV-091：重命名分组。 */
  onRenameGroup(groupId: string, name: string): Promise<void>
  /** CV-091：删除分组（组内项目回落未分组）。 */
  onDeleteGroup(groupId: string): Promise<void>
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
 * The studio project list (CV-091)：项目按用户自定义分组渲染，每组可折叠，
 * 支持组内新建 / 移动到分组 / 重命名 / 删除。未分组桶常驻兜底（老项目与新建
 * 未分组项目都进这里）。点击行打开项目，行 hover 出「移动到分组」与删除。
 */
function ProjectListInner(props: ProjectListProps) {
  const {
    projects: rawProjects, groups: rawGroups, selectedProjectId, phase, error, creating, createOpen, onCreateOpenChange,
    onRefresh, onCreate, onOpen, onDelete, onMoveToGroup, onCreateGroup, onRenameGroup, onDeleteGroup, onOpenSettings,
    effectTest, onRunEffectTests,
  } = props
  const projects = Array.isArray(rawProjects) ? rawProjects : []
  const groups = [...(Array.isArray(rawGroups) ? rawGroups : [])].sort((a, b) => a.order - b.order)
  const [draftName, setDraftName] = useState('')
  // CV-091：分组内联新建（key = groupId；'__ungrouped__' = 未分组桶）。
  const [groupFormKey, setGroupFormKey] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  // CV-091：新建分组名称输入开合。
  const [groupNameFormOpen, setGroupNameFormOpen] = useState(false)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  // CV-091：分组重命名内联输入（groupId；null = 无）。
  const [renameKey, setRenameKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // CV-091：折叠态（按 groupId；localStorage 持久化）。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadCollapsed())
  const toggleCollapse = (key: string): void => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(next)) } catch { /* 忽略写入失败 */ }
      return next
    })
  }
  // 一键效果测试面板：用例勾选 + 轮次号（缺省按既有项目名自增）。
  const [testPanelOpen, setTestPanelOpen] = useState(false)
  const [testCases, setTestCases] = useState<readonly string[]>([...EFFECT_TEST_CASES])
  const [testRoundDraft, setTestRoundDraft] = useState('')
  const formOpen = createOpen
  const setFormOpen = (open: boolean): void => onCreateOpenChange(open)
  const submit = async (): Promise<void> => {
    const name = draftName.trim()
    if (name.length === 0 || creating) return
    await onCreate(name)
    setFormOpen(false)
    setDraftName('')
  }
  const submitGroup = async (groupId: string | null): Promise<void> => {
    const name = groupDraft.trim()
    if (name.length === 0 || creating) return
    await onCreate(name, groupId)
    setGroupFormKey(null)
    setGroupDraft('')
  }
  const submitGroupName = async (): Promise<void> => {
    const name = groupNameDraft.trim()
    if (name.length === 0 || creating) return
    await onCreateGroup(name)
    setGroupNameFormOpen(false)
    setGroupNameDraft('')
  }
  const submitRename = async (groupId: string): Promise<void> => {
    const name = renameDraft.trim()
    if (name.length === 0 || creating) return
    await onRenameGroup(groupId, name)
    setRenameKey(null)
    setRenameDraft('')
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
  // CV-091：分组投影——未分组桶 + 各用户分组（按 order）。
  const ungrouped = projects.filter(p => p.groupId === undefined || p.groupId === null)
  const sections = groups.map(group => ({
    key: group.id,
    title: group.name,
    items: projects.filter(p => p.groupId === group.id),
    groupId: group.id as string | null,
    deletable: true,
  }))

  // 单条项目行：点击打开；hover 出「移动到分组」下拉与删除。
  const renderRows = (items: readonly StudioProject[]): ReactNode => items.map(project => (
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
      <span className="csProjectRowActions">
        <select
          className="csProjectMove"
          title="移动到分组"
          value={project.groupId ?? ''}
          disabled={creating}
          onClick={(event) => { event.stopPropagation() }}
          onChange={(event) => {
            event.stopPropagation()
            const value = event.target.value
            onMoveToGroup(project.id, value === '' ? null : value)
          }}
        >
          <option value="">未分组</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
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
      </span>
    </div>
  ))

  return (
    <div className="csProjectList">
      {/* 顶部操作：新建项目（未分组）+ 新建分组。 */}
      {!formOpen && !groupNameFormOpen && (
        <div className="csProjectListActions">
          <button type="button" className="csProjectNew" disabled={creating} onClick={() => setFormOpen(true)}>
            + 新建项目
          </button>
          <button type="button" className="csProjectNew csProjectNewGroup" disabled={creating} onClick={() => setGroupNameFormOpen(true)}>
            + 新建分组
          </button>
        </div>
      )}
      {formOpen && (
        <div className="csProjectForm">
          <input
            className="csProjectNameInput"
            value={draftName}
            placeholder="项目名（未分组）"
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
      {groupNameFormOpen && (
        <div className="csProjectForm">
          <input
            className="csProjectNameInput"
            value={groupNameDraft}
            placeholder="分组名"
            autoFocus
            disabled={creating}
            onChange={(event) => { setGroupNameDraft(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitGroupName()
              if (event.key === 'Escape') setGroupNameFormOpen(false)
            }}
          />
          <div className="csProjectFormActions">
            <button type="button" disabled={creating || groupNameDraft.trim().length === 0} onClick={() => void submitGroupName()}>
              {creating ? '创建中' : '创建'}
            </button>
            <button type="button" disabled={creating} onClick={() => setGroupNameFormOpen(false)}>取消</button>
          </div>
        </div>
      )}
      {/* 一键效果测试：入口按钮 + 用例勾选面板 + 运行进度（store 驱动）。 */}
      {!formOpen && !groupNameFormOpen && !testRunning && (
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
      {phase === 'idle' && projects.length === 0 && groups.length === 0 && (
        <div className="csProjectsEmpty">
          {EMPTY_COPY.projectEmpty}
        </div>
      )}

      {/* 未分组桶：常驻兜底，不可删/不可改名；[+] 打开未分组新建表单。 */}
      {renderSection('__ungrouped__', '未分组', ungrouped, null, false)}

      {/* 各用户分组：可折叠 / 可删 / 可改名 / [+] 组内新建。 */}
      {sections.map(section => renderSection(section.key, section.title, section.items, section.groupId, true))}
    </div>
  )

  /** 渲染一个分组区块（含折叠头、内联新建、行列表）。函数声明会被提升，可在 return 上方引用。 */
  function renderSection(
    key: string,
    title: string,
    items: readonly StudioProject[],
    groupId: string | null,
    deletable: boolean,
  ): ReactNode {
    const isCollapsed = collapsed[key] === true
    const isFormOpen = groupFormKey === key
    return (
      <div className="csProjectGroup" key={key}>
        <div className="csProjectGroupHeader">
          <button
            type="button"
            className="csProjectGroupToggle"
            title={isCollapsed ? '展开' : '折叠'}
            onClick={() => toggleCollapse(key)}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          {renameKey === key ? (
            <input
              className="csProjectGroupNameInput"
              value={renameDraft}
              autoFocus
              disabled={creating}
              onChange={(event) => { setRenameDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitRename(key)
                if (event.key === 'Escape') setRenameKey(null)
              }}
              onBlur={() => setRenameKey(null)}
            />
          ) : (
            <span
              className="csProjectGroupName"
              onDoubleClick={() => { if (deletable) { setRenameKey(key); setRenameDraft(title) } }}
              title={deletable ? '双击重命名' : undefined}
            >
              {title} <span className="csProjectGroupCount">({items.length})</span>
            </span>
          )}
          <span className="csProjectGroupActions">
            <button
              type="button"
              className="csProjectGroupAdd"
              title="在该分组下新建项目"
              disabled={creating}
              onClick={() => { setGroupFormKey(isFormOpen ? null : key); setGroupDraft('') }}
            >
              +
            </button>
            {deletable && (
              <button
                type="button"
                className="csProjectGroupDelete"
                title="删除分组（组内项目回落未分组）"
                disabled={creating}
                onClick={() => {
                  if (window.confirm(`删除分组「${title}」？组内项目将移至「未分组」，分组本身不可恢复。`)) {
                    void onDeleteGroup(key)
                  }
                }}
              >
                ×
              </button>
            )}
          </span>
        </div>
        {!isCollapsed && (
          <>
            {isFormOpen && (
              <div className="csProjectForm csProjectFormInline">
                <input
                  className="csProjectNameInput"
                  value={groupDraft}
                  placeholder="项目名"
                  autoFocus
                  disabled={creating}
                  onChange={(event) => { setGroupDraft(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitGroup(groupId)
                    if (event.key === 'Escape') setGroupFormKey(null)
                  }}
                />
                <div className="csProjectFormActions">
                  <button type="button" disabled={creating || groupDraft.trim().length === 0} onClick={() => void submitGroup(groupId)}>
                    {creating ? '创建中' : '创建'}
                  </button>
                  <button type="button" disabled={creating} onClick={() => setGroupFormKey(null)}>取消</button>
                </div>
              </div>
            )}
            {items.length === 0 && !isFormOpen && (
              <div className="csProjectGroupEmpty">空</div>
            )}
            {renderRows(items)}
          </>
        )}
      </div>
    )
  }
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