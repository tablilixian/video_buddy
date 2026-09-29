/**
 * REQ-005 / CV-256：首页（lobby 态）对话式创建 —— 大输入框 + 规格 chips + 分组下拉。
 *
 * ## 它取代了什么
 *
 * 取代「新建项目弹窗」+「首页对话槽」两个窗口：用户在这里描述创意回车 →
 * 项目自动创建（摘要命名）→ 切入项目 → 首条消息自动发出（主链路见方案 §4.1）。
 * 旧弹窗按拍板 D4 **彻底删除**，本组件是唯一的新建入口。
 *
 * ## 两条不能违反的约束
 *
 * 1. **宿主 conversation 槽永不条件卸载**（`LobbyHero.tsx` 模块注释）：lobby 态
 *    宿主对话槽只是被 CSS 隐藏（`.csFrame[data-mode="lobby"] .csChat`），本组件
 *    是**另一块常驻 JSX**，不接管那个槽 —— 否则草稿 / 滚动 / 会话绑定全丢。
 * 2. **草稿不落 localStorage**：创建失败（`'failed'`）时本组件仍挂载（projectId
 *    仍为 null → 仍是 lobby 态），草稿自然留在 state 里可重试；创建成功则组件随
 *    布局切换卸载，而创意文本此时已进了会话输入框，无需再留一份。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { StudioProjectGroup, StudioProjectPlan, StudioWorkflowMode } from '../contracts/project.js'
import type { CreateIdeaResult } from './contracts.js'
import { LOBBY_COPY } from '../brand-copy.js'
import { ProjectSpecChips, buildPlan, type ProjectSpecDraft } from './ProjectSpecChips.js'

export interface LobbyComposerProps {
  /** 创建中（含首条消息发送前的整条链路）：输入与 chips 全禁用。 */
  readonly creating: boolean
  /** 用户自定义分组（分组下拉的数据源，未分组恒为兜底项）。 */
  readonly groups: readonly StudioProjectGroup[]
  /** 预选分组（左栏「+ 新建项目」= null，分组头「+」= 该组；受控）。 */
  readonly groupId: string | null
  onGroupIdChange(groupId: string | null): void
  /**
   * 设置页「默认执行模式」的**惰性**读取（CV-196 口径）：每次挂载取一次当时的
   * 设置，而不是组件挂载时的旧闭包值 —— 首页每次进 lobby 都是新挂载，天然对齐。
   */
  defaultMode(): StudioWorkflowMode
  /**
   * 提交创意。返回三态（见 `CreateIdeaResult`）：
   * - `sent`：项目已建、首条消息已发出（布局随 blank 翻转自动切 work）；
   * - `degraded`：项目已建但消息没发出去（调用方负责 toast + 文本注入对话输入框）；
   * - `failed`：项目没建成（Host 错误面已由 failWith 展示，草稿保留可重试）。
   */
  onCreateWithIdea(
    idea: string,
    plan: StudioProjectPlan | undefined,
    mode: StudioWorkflowMode,
    groupId: string | null,
  ): Promise<CreateIdeaResult>
}

const MAX_DRAFT_HEIGHT = 220

/** 首页创作台：大输入框（Enter 发送 / Shift+Enter 换行）+ 规格 chips + 分组 + 提示句。 */
export function LobbyComposer(props: LobbyComposerProps): ReactElement {
  const { creating, groups, groupId, onGroupIdChange, defaultMode, onCreateWithIdea } = props
  const [draft, setDraft] = useState('')
  const [spec, setSpec] = useState<ProjectSpecDraft>(() => ({
    aspect: '',
    duration: '',
    durationCustom: '',
    mode: defaultMode(),
  }))
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自增高：内容变了就把高度收回再按 scrollHeight 展开（否则只会长不会缩）。
  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_DRAFT_HEIGHT)}px`
  }, [draft])

  const submit = (): void => {
    const idea = draft.trim()
    if (idea.length === 0 || creating) return
    void (async () => {
      const result = await onCreateWithIdea(idea, buildPlan(spec), spec.mode, groupId)
      // 'failed'：项目没建成，本组件仍挂载（还是 lobby 态）—— 草稿原样留着可重试。
      // 其余两态都会离开 lobby，草稿随之卸载；'degraded' 的文本已由调用方注入
      // 宿主对话输入框，不再需要第二份。
      if (result !== 'failed') setDraft('')
    })()
  }

  return (
    <div className="csLobbyComposer">
      <div className="csLobbyComposerCard">
        <textarea
          ref={inputRef}
          className="csLobbyComposerInput"
          value={draft}
          rows={3}
          placeholder="描述你想构建的内容…（例：做一条 30 秒的咖啡广告，竖屏）"
          aria-label="创意描述"
          disabled={creating}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // 阻止默认换行：回车 = 开工（Shift+Enter 才是换行）。
            event.preventDefault()
            submit()
          }}
        />
        <div className="csSpecRow">
          <ProjectSpecChips value={spec} disabled={creating} onChange={setSpec} />
          <div className="csSpecGroup csSpecGroupSelect">
            <span className="csSpecLabel" id="cs-spec-group-label">所属分组</span>
            <div className="csSelectBox">
              <svg className="csSelectIcon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M1.6 4.1c0-.7.6-1.3 1.3-1.3h2.3c.4 0 .7.2.9.4l.9 1h6.1c.7 0 1.3.6 1.3 1.3v6.4c0 .7-.6 1.3-1.3 1.3H2.9c-.7 0-1.3-.6-1.3-1.3V4.1Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <select
                className="csFieldSelect"
                aria-labelledby="cs-spec-group-label"
                value={groupId ?? ''}
                disabled={creating}
                onChange={(event) => onGroupIdChange(event.target.value === '' ? null : event.target.value)}
              >
                <option value="">未分组</option>
                {groups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
              <svg className="csSelectChev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
        <div className="csLobbyComposerFoot">
          <p className="csLobbyComposerHint">{LOBBY_COPY.hint}</p>
          <button
            type="button"
            className="csLobbySend"
            disabled={creating || draft.trim().length === 0}
            onClick={submit}
          >
            {creating ? '开工中…' : '开工'}
          </button>
        </div>
      </div>
    </div>
  )
}
