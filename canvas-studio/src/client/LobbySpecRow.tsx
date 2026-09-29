/**
 * REQ-005 v1.3（变体 A）：首页规格行 —— 画幅 / 目标时长 / 执行模式三组 chips
 * （§3.4：图1 的规格信息内嵌进宿主对话卡；分组砍掉，默认未分组）。
 *
 * ## 为什么挂 `conversation.input.dock` 槽
 * 规格行是宿主对话卡（slot 产物）的一部分，组件树外够不着；`input.dock` 是
 * 「卡片上方整行」的 list 槽且渲染**不带 `!hero` 条件**（`ConversationRoot.tsx`
 * —— MediaUploadBar 同款理由），首页 hero 态可见。槽是 session 作用域，work 态
 * 也会渲染 —— 组件内按 `projectId === null` 条件渲染，非首页返回 null。
 *
 * ## 数据
 * 草稿存 store（`lobbySpec`）：发送拦截分支（DivertConversation 的 lobby 认领）
 * 在组件树之外读它，随创意一起写进新项目 —— 组件 state 根本够不着那条路径。
 * 写走注入回调 `setSpec`（与 MediaUploadBar.dismissUpload 同一约定）；
 * 模式默认值对齐由注册侧 `defaultMode()` 读设置页（CV-196 口径）。
 */
import { useEffect, type ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LobbySpecRowInjected } from './contracts.js'
import { ProjectSpecChips } from './ProjectSpecChips.js'

/** props：注册时声明的 hooks 舱 + 写草稿回调 + 默认模式读取。 */
export type LobbySpecRowProps = InjectFace<LobbySpecRowInjected>

export function LobbySpecRow(props: LobbySpecRowProps): ReactElement | null {
  const { useStudio, setSpec, defaultMode } = props
  const projectId = useStudio(store => store.selectedProjectId)
  const spec = useStudio(store => store.lobbySpec)
  // 进首页按设置页「默认执行模式」对齐一次（CV-196）：只对齐没动过模式的草稿。
  // 依赖里带 spec 引用 —— 用户改画幅/时长会走 setSpec 产生新引用，重跑时若模式
  // 仍是默认则空操作，不会抖。
  useEffect(() => {
    if (projectId !== null || spec.modeDirty === true) return
    const fallback = defaultMode()
    if (fallback !== spec.mode) setSpec({ ...spec, mode: fallback })
  }, [projectId, spec, defaultMode, setSpec])
  if (projectId !== null) return null
  return (
    // 复用 LobbyComposer 规格行的行容器类（.csSpecRow）：同一套 flex/wrap 量。
    <div className="csSpecRow csLobbySpecRow">
      <ProjectSpecChips value={spec} onChange={setSpec} />
    </div>
  )
}
