import { askConfirm } from './confirm.js'
import { Component, Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { StudioProject, StudioProjectGroup, StudioWorkflow } from '../contracts/project.js'
import { EMPTY_COPY, LOADING_COPY } from '../brand-copy.js'
import { coverInitial, coverToneClass } from '../project-cover.js'
import { planSummaryOf, projectRowMeta } from '../project-row.js'
import { resolveVisibleSections } from '../project-sections.js'
import {
  absoluteTimeOf,
  badgeTimeOf,
  countActiveStatuses,
  formatClock,
  PROJECT_STATUS_LABELS,
  projectStatusOf,
  statusDetailOf,
  type ProjectStatus,
  type ProjectStatusState,
  type SessionActivity,
} from '../project-status.js'
import { workflowStateStageLabel } from '../workflow-stage.js'
import { ProjectRowMenu } from './ProjectRowMenu.js'
import { StudioErrorState, StudioLoadingState } from './brand/States.js'
import type { EffectTestRunState } from './project-store.js'

/** 一键效果测试当前支持的用例（与 effect-test-runner skill 的 fixtures 对应）。 */
const EFFECT_TEST_CASES = ['T1', 'T1b', 'T3', 'T5', 'T6', 'T9', 'T10'] as const

/** CV-091：折叠状态持久化的 localStorage key（按 groupId 记录）。 */
const GROUP_COLLAPSE_KEY = 'canvas-studio.group-collapse'

/* REQ-005 / CV-256：原先此处的 DURATION_PRESETS / DURATION_CUSTOM / ASPECT_OPTIONS
   与整套新建项目弹窗（CV-092/099/182/196 的表单）已随「首页对话式创建」一并删除
   （D4 拍板：新建入口唯一）。规格 chips 的唯一实现搬到
   `ProjectSpecChips.tsx`，首页 LobbyComposer 是它当前唯一的使用方。 */

/**
 * DD-08 / R5：dev 入口开关（拍板 C —— 「跑效果测试」默认不出现在栏面）。
 *
 * 它是**开发/自测**入口，不属于用户可见的产品动作，此前却与「新建项目」
 * 「新建分组」并排成三枚同响的虚线按钮 —— 栏内最响的位置承载了最次要的动作。
 * 现在默认隐藏；需要时在 DevTools 执行
 * `localStorage.setItem('canvas-studio.dev', '1')` 后刷新即可恢复。
 *
 * 为什么不用构建期判断（`import.meta.env.DEV`）：插件跑在宿主的渲染进程里，
 * dev 与打包跑的是同一份 bundle，「是不是开发构建」没有可靠信号；写死它会让
 * 入口在打包后永久消失，连真机自测都开不出来。localStorage 开关可控、可解释，
 * 也不会在生产环境里意外亮起。
 */
const DEV_TOGGLE_KEY = 'canvas-studio.dev'

/** 读取 dev 开关（读取失败 / 缺失一律按关处理）。 */
function loadDevToggle(): boolean {
  try {
    return localStorage.getItem(DEV_TOGGLE_KEY) === '1'
  } catch {
    return false
  }
}

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
  /** 失败的结构化错误码（可空）—— 有码时三态错误卡的处置级别按码判定（CV-233）。 */
  errorCode: string | null
  creating: boolean
  /**
   * REQ-005 / D4：分组头「+」的「组内新建」（跳首页）。左栏顶的新建项目入口已随
   * REQ-030 重排退役（「＋ 创作」主按钮跳首页，入口唯一），本回调不再收 null。
   *
   * 不再是「打开弹窗」而是「跳首页」——首页创作台就是唯一的新建入口
   * （D4 拍板）。分组由 StudioFrame 持有（入口在左栏、落点在中栏），跨栏传值。
   */
  onNewInGroup(groupId: string | null): void
  onRefresh(): void
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
  /**
   * 关掉当前错误卡（清全局错误槽）。
   *
   * 2026-11-06 真机（会话 18 §13）：错误卡原先只有「重试」一个出口，而落地冻结这类
   * 终态错误重试必然复发 —— 用户被一张关不掉的卡挡住列表区。关闭是用户的基本出口，
   * 与「这条错误来自哪个操作」无关。
   */
  onDismissError(): void
  /** 一键效果测试编排状态（null = 本会话从未跑过）。 */
  effectTest: EffectTestRunState | null
  /** 启动一轮效果测试（apply 世界串行编排）。 */
  onRunEffectTests(round: string, cases: readonly string[]): void
  /**
   * CV-467：各项目工作流的 store 投影（比列表记录里的 workflow 更鲜 —— 点选问题
   * 落盘后由 refreshWorkflow 先行同步）。waiting 判据用它覆盖记录值。
   */
  workflows: Readonly<Record<string, StudioWorkflow>>
  /** CV-467：当前会话运行活动（running 只对 activity.projectId 命中的项目生效）。 */
  sessionActivity: SessionActivity | null
}

/* DD-08 / R3：原本这里的 createdLabel（把 createdAt 格式化成绝对日期）已被
   src/project-row.ts 的 projectRowMeta 取代 —— 副行要回答的是「我还要不要打开
   它」，而「最后动过」比「什么时候建的」更接近这个问题，相对时间又比绝对日期
   读得快。绝对日期在当前列表里没有消费者。 */

/**
 * The studio project list (CV-091 + REQ-030 ①A)：段头「项目 + ＋」之下，未分组
 * 项目平铺、「项目」标题即其节头；用户自定义分组渲染在分隔线之下，每组可折叠，
 * 支持组内新建 / 移动到分组 / 重命名 / 删除。点击行打开项目，行 hover 出
 * 「移动到分组」与删除。
 */
function ProjectListInner(props: ProjectListProps) {
  const {
    projects: rawProjects, groups: rawGroups, selectedProjectId, phase, error, errorCode, creating,
    onRefresh, onNewInGroup, onOpen, onDelete, onMoveToGroup, onCreateGroup, onRenameGroup, onDeleteGroup, onOpenSettings,
    onDismissError,
    effectTest, onRunEffectTests,
    workflows, sessionActivity,
  } = props
  const projects = Array.isArray(rawProjects) ? rawProjects : []
  const groups = [...(Array.isArray(rawGroups) ? rawGroups : [])].sort((a, b) => a.order - b.order)
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
  // DD-08 / R2：行内 kebab 菜单（展开的项目 id + 触发按钮的实测视口坐标）。
  // 坐标在**打开那一刻**量并冻结进 state：按钮会随列表滚动移动，而菜单是 fixed
  // 定位（逃出 .csProjectsScroll 的 overflow 裁剪），没法用 CSS 跟着按钮走。
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const closeMenu = (): void => {
    setMenuProjectId(null)
    setMenuAnchor(null)
  }
  const toggleMenu = (projectId: string): void => {
    if (menuProjectId === projectId) { closeMenu(); return }
    const button = menuButtonRefs.current.get(projectId)
    if (button === undefined) return
    const rect = button.getBoundingClientRect()
    setMenuAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom })
    setMenuProjectId(projectId)
  }
  // 滚动 / 改变窗口大小会让冻结的坐标失效 —— 直接关掉菜单，而不是跟着重算：
  // kebab 菜单是瞬时动作，一个跟着列表滚动的菜单比关掉更难用。
  useEffect(() => {
    if (menuProjectId === null) return
    const close = (): void => { closeMenu() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuProjectId])
  // DD-08 / R5：dev 入口（「跑效果测试」）默认隐藏，见 DEV_TOGGLE_KEY。
  const [devOpen] = useState(() => loadDevToggle())
  // 一键效果测试面板：用例勾选 + 轮次号（缺省按既有项目名自增）。
  const [testPanelOpen, setTestPanelOpen] = useState(false)
  const [testCases, setTestCases] = useState<readonly string[]>([...EFFECT_TEST_CASES])
  const [testRoundDraft, setTestRoundDraft] = useState('')
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
  // CV-181 / E-2：分桶收口到 resolveVisibleSections。此前的两行本地 filter 只看
  // 「等不等于」—— groupId 指向已删除的分组时两个桶都不收，卡片在左栏彻底消失
  // （「项目有记录但看不见」）。判定与理由见 src/project-sections.ts 头注。
  const { ungrouped, sections } = resolveVisibleSections(projects, groups)

  // DD-08 / R3：整个列表共用一个时间基准。逐行取 `new Date()` 会让同一屏里出现
  // 「59 分钟前」与「1 小时前」并存（两次调用跨过了边界），看起来像数据不一致。
  const now = new Date()

  // ── CV-467：六态徽标 + hover 详情弹框 ──────────────────────────────────
  // workflow 取值：store.workflows 比列表记录更鲜（点选问题落盘后 refreshWorkflow
  // 先行同步进来，列表要等 refreshProjects 才有）——徽标与覆盖层必须说同一套话，
  // 所以 store 有就用 store 的，否则退回记录自带值（两处都是权威同步的产物）。
  const workflowOf = (project: StudioProject): StudioWorkflow | undefined => workflows[project.id] ?? project.workflow
  const statusOf = (project: StudioProject): ProjectStatus => {
    const workflow = workflowOf(project)
    return projectStatusOf(workflow === undefined ? project : { ...project, workflow }, now, sessionActivity)
  }
  // 段头计数（图标 + 数字，零文字）与徽标共用同一份推导 —— 计数说「1 执行中」
  // 而列表里找不着 running 行，比不写计数更糟。
  const effectiveProjects = projects.map(project => {
    const workflow = workflowOf(project)
    return workflow === undefined ? project : { ...project, workflow }
  })
  const counts = countActiveStatuses(effectiveProjects, now, sessionActivity)
  const hasLive = counts.waiting > 0 || counts.running > 0
  // 计时器：running/waiting 的徽标时间是 mm:ss（每秒跳动），存在 live 行时才启动
  // 秒级重渲染；行数归零即清（纯终态列表回到 React 默认的「状态变化才渲染」）。
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!hasLive) return
    const timer = setInterval(() => { setTick(tick => tick + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [hasLive])
  // hover / focus 详情弹框：单例 + 打开那一刻量 anchor 冻结进 state（照 kebab 菜单
  // 的 anchor 模式 —— 行会随列表滚动移动，弹框是 fixed 定位，没法用 CSS 跟着走）。
  const [hoverProjectId, setHoverProjectId] = useState<string | null>(null)
  const [hoverAnchor, setHoverAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const closeHover = (): void => {
    setHoverProjectId(null)
    setHoverAnchor(null)
  }
  const openHover = (projectId: string, row: Element): void => {
    const rect = row.getBoundingClientRect()
    setHoverAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    setHoverProjectId(projectId)
  }
  // 列表滚动 / 窗口缩放会让冻结的坐标失效 —— 直接关掉（与 kebab 菜单同一决策：
  // 移开鼠标本来就会关弹框，滚动的瞬间弹框跟着行跑反而更怪）。
  useEffect(() => {
    if (hoverProjectId === null) return
    const close = (): void => { closeHover() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverProjectId])

  // DD-08 / R2+R3：单条项目卡 —— 封面（首字色块）+ 名称 + 副行，行内动作收进 kebab。
  // 副行三段（阶段 / 规格 / 时间）由 src/project-row.ts 组装，任一段为空即不渲染，
  // 因此分隔号必须与段同生共死（写在文本节点里会留下悬空的「·」）。
  // CV-467：行尾新增状态徽标列（图标 + 时间，零文字）+ hover/focus 详情弹框触发。
  const renderRows = (items: readonly StudioProject[]): ReactNode => items.map(project => {
    const meta = projectRowMeta(project, now)
    const segments: ReactNode[] = [
      <span className="csProjectStage" key="stage">{meta.stage}</span>,
    ]
    if (meta.plan !== null) segments.push(<span className="csProjectSubText" key="plan">{meta.plan}</span>)
    if (meta.time !== null) segments.push(<span className="csProjectSubText" key="time">{meta.time}</span>)
    const status = statusOf(project)
    const badgeTime = badgeTimeOf(status, now)
    const waiting = status.state === 'waiting'
    const itemClass = [
      'csProjectItem',
      project.id === selectedProjectId ? 'csProjectItemActive' : '',
      waiting ? 'csProjectItemWaiting' : '',
    ].filter(entry => entry !== '').join(' ')
    return (
      <div
        key={project.id}
        className={itemClass}
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
        // CV-467：hover/focus 同源显示详情弹框（键盘用户 Tab 进行同样看得到详情）。
        onMouseEnter={(event) => { openHover(project.id, event.currentTarget) }}
        onMouseLeave={closeHover}
        onFocus={(event) => { openHover(project.id, event.currentTarget) }}
        onBlur={closeHover}
      >
        <span className={`csProjectCover ${coverToneClass(project.id)}`} aria-hidden="true">
          {coverInitial(project.name)}
        </span>
        <span className="csProjectMeta">
          <span className="csProjectName">{project.name}</span>
          <span className="csProjectSub">
            {segments.map((segment, index) => (
              <Fragment key={index}>
                {index > 0 && <span className="csProjectSubSep" aria-hidden="true">·</span>}
                {segment}
              </Fragment>
            ))}
          </span>
        </span>
        {/* 状态徽标：图标 + 时间，零文字（用户拍板硬约束 —— 为国际化留空间，
            状态文案全在 hover 弹框里）。等待行有专属高亮，图标呼吸动画只在
            waiting/running 两态出现（终态一律静止）。 */}
        <ProjectStatusBadge status={status} badgeTime={badgeTime} />
        <span className="csProjectRowActions">
          <button
            type="button"
            ref={(element) => {
              // 回调 ref 收进 Map：菜单定位要在打开那一刻拿到按钮的实测矩形。
              if (element === null) menuButtonRefs.current.delete(project.id)
              else menuButtonRefs.current.set(project.id, element)
            }}
            className="csProjectMenuBtn"
            title="更多操作"
            aria-label={`${project.name} 的更多操作`}
            aria-haspopup="menu"
            aria-expanded={menuProjectId === project.id}
            disabled={creating}
            // 阻止冒泡：否则点 kebab 会先打开项目，且键盘 Enter 会同时触发
            // 本按钮的 click 与父行 onKeyDown 的 onOpen（一次回车打开两个动作）。
            onClick={(event) => { event.stopPropagation(); toggleMenu(project.id) }}
            onKeyDown={(event) => { event.stopPropagation() }}
          >
            ⋯
          </button>
        </span>
      </div>
    )
  })

  return (
    <div className="csProjectList">
      {/* REQ-030（拍板 ①A）：段头 =「项目」标题 + 段头「＋」（新建分组，点开
          直接展开下方分组名表单）。原「+ 新建项目 / 新建分组」动作区已随 REQ-030
          左栏重排退役 —— 新建项目入口唯一（左栏「＋ 创作」主按钮跳首页，D4），
          新建分组入口上移段头。段头放本组件内：「＋」要开的是这里的表单状态。 */}
      <header className="csProjectsHeader">
        <span className="csProjectsHeaderTitle">项目</span>
        {/* CV-467：段头计数摘要（图标 + 数字，零文字，demo §2.3）。只有 > 0 的态才
            出现；key 绑计数内容 —— 内容一变整块重挂，CSS 的 flash 动画随之重放。 */}
        {(counts.waiting > 0 || counts.running > 0 || counts.failed > 0) && (
          <span className="csProjectsHeaderCounts" key={`${counts.waiting}-${counts.running}-${counts.failed}`}>
            {counts.waiting > 0 && (
              <span className="csStatusCount csStatusCountWaiting" title={`${counts.waiting} 个项目等你决策`}>
                <i className="csStatusCountDot" aria-hidden="true" />{counts.waiting}
              </span>
            )}
            {counts.running > 0 && (
              <span className="csStatusCount csStatusCountRunning" title={`${counts.running} 个项目执行中`}>
                <i className="csStatusCountDot" aria-hidden="true" />{counts.running}
              </span>
            )}
            {counts.failed > 0 && (
              <span className="csStatusCount csStatusCountFailed" title={`${counts.failed} 个项目失败`}>
                <i className="csStatusCountDot" aria-hidden="true" />{counts.failed}
              </span>
            )}
          </span>
        )}
        <span className="csProjectsHeaderActions">
          <button
            type="button"
            title="新建分组"
            aria-label="新建分组"
            disabled={creating}
            onClick={() => setGroupNameFormOpen(true)}
          >
            ＋
          </button>
        </span>
      </header>
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
      {/* 一键效果测试（dev 自测入口）：DD-08 / R5 起默认隐藏，见 DEV_TOGGLE_KEY。
          入口按钮与用例面板都受开关门控。 */}
      {devOpen && !groupNameFormOpen && !testRunning && (
        <button
          type="button"
          className="csProjectNewIcon csProjectNewWide"
          disabled={creating || testCases.length === 0}
          onClick={() => setTestPanelOpen(open => !open)}
        >
          ▶ 跑效果测试
        </button>
      )}
      {devOpen && testPanelOpen && !testRunning && (
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
      {/* 运行进度块**不受 dev 开关门控**：已经在跑的一轮必须能看完 —— 若跟着入口
          一起藏起来，打开开关之前跑的那轮进度会静默消失（只剩控制台里有）。 */}
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
        <StudioErrorState
          message={error}
          code={errorCode ?? undefined}
          onRetry={onRefresh}
          onOpenSettings={onOpenSettings}
          onDismiss={onDismissError}
        />
      )}
      {phase === 'idle' && projects.length === 0 && groups.length === 0 && (
        <div className="csProjectsEmpty">
          {EMPTY_COPY.projectEmpty}
        </div>
      )}

      {/* REQ-030 ①A：未分组项**平铺**在「项目」段头下，不再渲染「未分组」小节头
          （拍板：不单独渲染「未分组」桶头，「项目」标题即其节头；折叠/计数/动作
          都是分组才有的语义）。数据层不动：未分组仍是 groupId=null 的兜底桶，
          删组回落、移动到分组照旧落这里。 */}
      {renderRows(ungrouped)}
      {sections.length > 0 && <div className="csProjectFlatDivider" aria-hidden="true" />}

      {/* 各用户分组：可折叠 / 可删 / 可改名 / [+] 组内新建（CV-091 语义全保留）。 */}
      {sections.map(section => renderSection(section.key, section.title, section.items, section.groupId, true))}

      {/* DD-08 / R2：行内 kebab 菜单。position: fixed，逃出 .csProjectsScroll 的
          overflow 裁剪，所以渲染在列表末尾而不是每一行里（一份菜单 + 一个 anchor，
          行数再多也只有一份 DOM）。菜单对应的项目在渲染期查——项目被删掉后这一帧
          会自然收敛为 null（不会对着已消失的项目渲染菜单）。 */}
      {menuProjectId !== null && menuAnchor !== null && (() => {
        const menuProject = projects.find(candidate => candidate.id === menuProjectId)
        if (menuProject === undefined) return null
        return (
          <ProjectRowMenu
            project={menuProject}
            groups={groups}
            anchor={menuAnchor}
            creating={creating}
            onClose={closeMenu}
            onMoveToGroup={onMoveToGroup}
            onDelete={(projectId) => { void onDelete(projectId) }}
          />
        )
      })()}

      {/* CV-467：hover / focus 详情弹框。与 kebab 菜单同一套单例 + anchor 冻结 +
          portal 到 body 的模式（fixed 逃得出行内 overflow 裁剪、逃不出祖先层叠
          上下文，portal 到根层叠上下文才压得过中栏 —— 见 ProjectRowMenu 头注）。
          项目被删掉后这一帧自然收敛为 null。 */}
      {hoverProjectId !== null && hoverAnchor !== null && (() => {
        const hoverProject = effectiveProjects.find(candidate => candidate.id === hoverProjectId)
        if (hoverProject === undefined) return null
        return (
          <ProjectStatusPopover
            project={hoverProject}
            status={statusOf(hoverProject)}
            now={now}
            anchor={hoverAnchor}
          />
        )
      })()}
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
    return (
      <div className="csProjectGroup" key={key}>
        <div className="csProjectGroupHeader">
          <button
            type="button"
            className="csProjectGroupToggle"
            title={isCollapsed ? '展开' : '折叠'}
            // DD-08 / R4：箭头旋转由 aria-expanded 驱动（CSS 侧 `.csProjectGroupToggle
            // [aria-expanded="false"] svg`），替掉「▸ / ▾ 两个字形互相替换」——
            // 换字形是瞬跳，且文字符的基线与粗细随字体变。
            aria-expanded={!isCollapsed}
            onClick={() => toggleCollapse(key)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.6 4.4 6 7.8l3.4-3.4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
              {title}
            </span>
          )}
          {/* DD-08 / R4：计数独立成列、右对齐。此前写进名字里（「名称 (8)」），
              名字一长计数先被省略号吃掉，而且与名字同字号同色，读起来像名字的一部分。 */}
          <span className="csProjectGroupCount">{items.length}</span>
          <span className="csProjectGroupActions">
            <button
              type="button"
              className="csProjectGroupAdd"
              title="在该分组下新建项目"
              disabled={creating}
              onClick={() => { onNewInGroup(groupId) }}
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
                  void askConfirm({
                    title: '删除这个分组？',
                    body: `「${title}」删除后组内项目会移至「未分组」，分组本身不可恢复。`,
                    confirmLabel: '删除分组',
                  }).then((confirmed) => { if (confirmed) void onDeleteGroup(key) })
                }}
              >
                ×
              </button>
            )}
          </span>
        </div>
        {!isCollapsed && (
          <>
            {items.length === 0 && (
              <div className="csProjectGroupEmpty">空</div>
            )}
            {renderRows(items)}
          </>
        )}
      </div>
    )
  }
}

/* ── CV-467：六态徽标 ──────────────────────────────────────────────────────
   图形语言（视觉基准 demo，已与用户确认两轮）：呼吸点 = running（蓝）/ waiting（琥珀，
   行左侧另有琥珀标 + 微底色，永远置顶）；叹号 = failed；弹入绿勾 = just-done；
   淡绿勾 = done；暂停 = idle。**零文字**：状态文案全在弹框，图标 + 时间跨语言可读。 */

/** 六态的图标（14×14 SVG；颜色由 CSS 按 state class 提供，不在 JSX 里写字面量色）。 */
function statusIcon(state: ProjectStatusState): ReactNode {
  if (state === 'running' || state === 'waiting') {
    return <i className="csStatusDot" aria-hidden="true" />
  }
  if (state === 'failed') {
    return (
      <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.6" fill="currentColor" />
        <rect x="6.3" y="3.6" width="1.4" height="4.6" rx="0.7" fill="var(--cs-status-on-icon)" />
        <circle cx="7" cy="10.2" r="0.85" fill="var(--cs-status-on-icon)" />
      </svg>
    )
  }
  if (state === 'just-done' || state === 'done') {
    return (
      <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M2.8 7.4 5.6 10.2 11.2 4.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  // idle：暂停双竖条。
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4.2" y="3.8" width="2" height="6.4" rx="1" fill="currentColor" />
      <rect x="7.8" y="3.8" width="2" height="6.4" rx="1" fill="currentColor" />
    </svg>
  )
}

/** 徽标列（图标 + 时间）。时间可为空（推不出起点时不渲染，不留占位）。 */
function ProjectStatusBadge(props: { status: ProjectStatus; badgeTime: string | null }): ReactNode {
  const { status, badgeTime } = props
  return (
    <span className={`csProjectBadge csProjectBadge-${status.state}`} aria-hidden="true">
      {statusIcon(status.state)}
      {badgeTime !== null && <span className="csProjectBadgeTime">{badgeTime}</span>}
    </span>
  )
}

/* ── CV-467：hover / focus 详情弹框 ────────────────────────────────────────
   纯展示（pointer-events: none，不拦截鼠标 —— 移开行即消失，从不是可交互目标）。
   内容 = 标题 + 状态胶囊 + 五行环境信息（阶段 / 模式 / 目录 / 更新于 / 规格）+
   状态专属块（进度条 / 问题原文 / 失败原因 / 成片就绪行）—— 2026-11-16 用户拍板
   五行全要、running 用不确定进度条（wire 上没有真实进度百分比，不显示假数字）。 */

/** 弹框与行的间距（px）。 */
const POPOVER_GAP = 10
/** 视口边缘留白（px）。 */
const POPOVER_PAD = 12
/** 首帧高度估算（真实高度 paint 前实测修正，照 ProjectRowMenu 的做法）。 */
const POPOVER_HEIGHT_GUESS = 260

function ProjectStatusPopover(props: {
  project: StudioProject
  status: ProjectStatus
  now: Date
  anchor: { left: number; right: number; top: number; bottom: number }
}): ReactNode {
  const { project, status, now, anchor } = props
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
    left: anchor.right + POPOVER_GAP,
    top: anchor.top,
  }))
  // paint 前定位：默认贴行右侧；放不下翻左侧；两个方向都放不下时视口夹紧
  // （算法照 demo 的 showTip，垂直方向额外夹紧）。
  useLayoutEffect(() => {
    const element = popoverRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const height = rect.height === 0 ? POPOVER_HEIGHT_GUESS : rect.height
    let left = anchor.right + POPOVER_GAP
    if (left + rect.width > window.innerWidth - POPOVER_PAD) {
      left = anchor.left - rect.width - POPOVER_GAP
    }
    if (left < POPOVER_PAD) left = POPOVER_PAD
    let top = anchor.top
    if (top + height > window.innerHeight - POPOVER_PAD) top = window.innerHeight - height - POPOVER_PAD
    if (top < POPOVER_PAD) top = POPOVER_PAD
    setPos({ left, top })
  }, [anchor.left, anchor.right, anchor.top])

  const badgeTime = badgeTimeOf(status, now)
  const detail = statusDetailOf(status, project, now)
  const updatedAt = absoluteTimeOf(project.updatedAt, now)
  const plan = planSummaryOf(project.plan)
  const mode = project.workflow?.mode === 'auto' ? '放手跑' : '逐步确认'
  const rows: { className: string; label: string; value: string }[] = [
    { className: 'stage', label: '阶段', value: workflowStateStageLabel(project.workflow?.state) },
    { className: 'mode', label: '模式', value: mode },
    { className: 'dir', label: '目录', value: project.dir },
    ...(updatedAt !== null ? [{ className: 'time', label: '更新于', value: updatedAt }] : []),
    ...(plan !== null ? [{ className: 'plan', label: '规格', value: plan }] : []),
  ]
  const pillTime = badgeTime !== null && (status.state === 'running' || status.state === 'waiting')
    ? ` · ${badgeTime}`
    : ''
  return createPortal(
    <div
      ref={popoverRef}
      className={`csStatusPopover csStatusPopover-${status.state}`}
      role="status"
      aria-label={`${project.name}：${PROJECT_STATUS_LABELS[status.state]}`}
      style={{ left: pos.left, top: pos.top }}
    >
      <span className="csStatusPopoverTitle">{project.name}</span>
      <span className="csStatusPill">
        <i className="csStatusDot" aria-hidden="true" />
        {PROJECT_STATUS_LABELS[status.state]}
        {pillTime}
      </span>
      <span className="csStatusPopoverRows">
        {rows.map(row => (
          <span className={`csStatusRow csStatusRow-${row.className}`} key={row.className}>
            <span className="csStatusRowLabel">{row.label}</span>
            <span className="csStatusRowValue" title={row.value}>{row.value}</span>
          </span>
        ))}
      </span>
      {/* 状态专属块：running 出不确定进度条（流动条纹表达「在跑」，不显示假百分比）；
          waiting 出已等待时长 + 满宽琥珀条 + 问题原文；failed 出失败原因；
          done / just-done 出成片就绪行。 */}
      {status.state === 'running' && (
        <span className="csStatusDetail">
          <span className="csStatusLiveBar" aria-hidden="true"><i /></span>
          <span className="csStatusDetailText">已运行 {badgeTime ?? formatClock(0)}</span>
        </span>
      )}
      {status.state === 'waiting' && (
        <span className="csStatusDetail csStatusDetailQuestion">
          <span className="csStatusDetailText">{detail === null ? '等待你的选择' : detail.text}</span>
        </span>
      )}
      {status.state === 'failed' && detail !== null && (
        <span className="csStatusDetail csStatusDetailReason">
          <span className="csStatusDetailText">{detail.text}</span>
        </span>
      )}
      {(status.state === 'done' || status.state === 'just-done') && detail !== null && (
        <span className="csStatusDetail csStatusDetailReady">
          <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3.4 1.8v8.4l6.4-4.2z" />
          </svg>
          <span className="csStatusDetailText">{detail.text}</span>
        </span>
      )}
    </div>,
    document.body,
  )
}

interface ProjectListErrorBoundaryState {  crashed: boolean
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