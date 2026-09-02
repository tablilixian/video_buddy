/**
 * Lobby 态（无项目）中栏顶部品牌条。
 *
 * 需求 1：项目没开始时聊天在中间，开始后回到右边。中栏因此被切成上下两截
 * —— 上截是本组件（品牌 + 双 CTA），下截是聊天。聊天下移由 CSS grid 重排
 * 完成（见 styles.ts `.csFrame[data-mode="lobby"]`），**对话槽始终挂载在原
 * DOM 位置**：JSX 条件搬家会让上游 conversation 组件卸载重建，草稿、滚动
 * 位置与会话绑定全丢。
 */
import type { ReactElement } from 'react'
import { BRAND, EMPTY_COPY, LOBBY_COPY, USER_MOCK } from '../brand-copy.js'
import { LogoMark } from './brand/LogoMark.js'

export interface LobbyHeroProps {
  /** 新建项目（打开左侧栏新建表单）。 */
  onCreate: () => void
  /** 创建示例项目。 */
  onCreateSample: () => void
  /** 示例项目创建中。 */
  creating: boolean
}

/** Lobby 品牌条：左侧品牌标识 + 引导句，右侧双 CTA。 */
export function LobbyHero(props: LobbyHeroProps): ReactElement {
  const { onCreate, onCreateSample, creating } = props
  return (
    <div className="csLobbyHero">
      <div className="csLobbyBrand">
        <LogoMark size={38} />
        <div className="csLobbyBrandMeta">
          <h1 className="csLobbyTitle">
            {BRAND.name}
            <span className="csLobbyNameZh">{BRAND.nameZh}</span>
          </h1>
          {/* CV-088：个性化问候（persona 与用户卡 USER_MOCK 同源）。 */}
          <p className="csLobbyGreet">你好，{USER_MOCK.name}，{EMPTY_COPY.welcomeTitle}。</p>
          <p className="csLobbyTagline">{BRAND.tagline} · {BRAND.taglineZh}</p>
          <p className="csLobbyHint">{LOBBY_COPY.hint}</p>
        </div>
      </div>
      <div className="csLobbyActions">
        <div className="csLobbyButtons">
          <button type="button" className="csPrimary" onClick={onCreate}>+ {EMPTY_COPY.createProject}</button>
          <button type="button" className="csWelcomeSample" disabled={creating} onClick={onCreateSample}>
            {creating ? '创建中…' : EMPTY_COPY.createSample}
          </button>
        </div>
        <p className="csLobbySampleHint">{LOBBY_COPY.sampleHint}</p>
      </div>
    </div>
  )
}
