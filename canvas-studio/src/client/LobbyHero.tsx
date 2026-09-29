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
  /** 创建示例项目。 */
  onCreateSample: () => void
  /** 示例项目创建中。 */
  creating: boolean
  /** REQ-001：打开全局资产库全屏页。 */
  onOpenLibrary: () => void
}

/** Lobby 品牌条：左侧品牌标识 + 引导句，右侧「示例项目 / 资产库」两个入口。 */
export function LobbyHero(props: LobbyHeroProps): ReactElement {
  const { onCreateSample, creating, onOpenLibrary } = props
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
          {/* C7（DD-06）：tagline 落「未开拍的现场」意象 —— 破折号连接
              意象（此刻是没开拍的片场）与承诺（从创意到成片）。英文句
              From idea to final cut. 与 taglineZh 同义，不再重复占行。 */}
          <p className="csLobbyTagline">未开拍的现场 —— {BRAND.taglineZh}</p>
          {/* REQ-005 / CV-256：引导句已随「描述创意回车即开工」的入口下移到
              LobbyComposer 的底行（它得挨着输入框才有意义，放在这里离输入框
              隔了一整块品牌区）。这里**不再**放「+ 新建项目」按钮 —— 首页本身就是
              创建页，再挂一个入口就是两套新建体验（D4 拍板：入口唯一）。 */}
        </div>
      </div>
      <div className="csLobbyActions">
        <div className="csLobbyButtons">
          <button type="button" className="csWelcomeSample" disabled={creating} onClick={onCreateSample}>
            {creating ? '创建中…' : EMPTY_COPY.createSample}
          </button>
          {/* REQ-001：资产库入口（lobby 态；与 work 态 toolbar 图标共用同一 overlay）。 */}
          <button type="button" className="csWelcomeSample" onClick={onOpenLibrary}>🗂 资产库</button>
        </div>
        <p className="csLobbySampleHint">{LOBBY_COPY.sampleHint}</p>
      </div>
    </div>
  )
}
