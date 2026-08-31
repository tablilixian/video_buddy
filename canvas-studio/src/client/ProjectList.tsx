import { Component, useState } from 'react'
import type { StudioProject } from '../contracts/project.js'
import { EMPTY_COPY, LOADING_COPY } from '../brand-copy.js'
import { StudioErrorState, StudioLoadingState } from './brand/States.js'

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
    onRefresh, onCreate, onOpen, onDelete, onOpenSettings,
  } = props
  const projects = Array.isArray(rawProjects) ? rawProjects : []
  const [draftName, setDraftName] = useState('')
  const formOpen = createOpen
  const setFormOpen = (open: boolean): void => onCreateOpenChange(open)
  const submit = async () => {
    const name = draftName.trim()
    if (name.length === 0 || creating) return
    await onCreate(name)
    setFormOpen(false)
    setDraftName('')
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
      {/* 左下角固定设置图标（flex column + margin-top:auto 推到底部）。 */}
      <div className="csProjectListFooter">
        <button
          type="button"
          className="csProjectSettingsIcon"
          aria-label="打开设置"
          title="设置"
          onClick={() => onOpenSettings()}
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
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