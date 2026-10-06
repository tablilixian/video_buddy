/**
 * Lobby 态（无项目）中栏顶部品牌条。
 *
 * 需求 1：项目没开始时聊天在中间，开始后回到右边。中栏因此被切成上下两截
 * —— 上截是本组件（品牌 + CTA），下截是聊天。聊天下移由 CSS grid 重排
 * 完成（见 styles.ts `.csFrame[data-mode="lobby"]`），**对话槽始终挂载在原
 * DOM 位置**：JSX 条件搬家会让上游 conversation 组件卸载重建，草稿、滚动
 * 位置与会话绑定全丢。
 *
 * CV-261 → REQ-028：素材入口的迁移。四类素材「发送前只展示不上传」的暂存链路
 * 不变，入口从本条的「📎 添加素材」按钮（+ 暂存条空态不可点的问题）迁到输入框
 * 左上的 58×58「参考内容」方框（LobbyStashBar v2 形态：常驻渲染 + 双来源弹出框
 * 「本地文件 / 资产库」，缩略图排队）。入口唯一（D4 拍板），本组件不再挂文件
 * 选择器；右侧保留「资产库」全库页入口。
 */
import type { ReactElement } from 'react'
import { BRAND, EMPTY_COPY, USER_MOCK } from '../brand-copy.js'
import { LogoMark } from './brand/LogoMark.js'

export interface LobbyHeroProps {
  /** REQ-001：打开全局资产库全屏页。 */
  onOpenLibrary: () => void
}

/**
 * Lobby 品牌条：左侧品牌标识 + 引导句，右侧「资产库」入口。
 *
 * 「创建示例项目」按钮**暂时隐藏**（它打开的是 lobby-pending 态：项目已建但还没有
 * 对话，中栏只渲染开拍前条、画布整块不渲染，用户看到的是宿主欢迎卡 —— 读作
 * 「旧页面」）。入口后续改成空态引导再放回来，`createSampleProject` 链路与相关
 * 文案常量一并从调用侧摘掉、能力保留在 host 侧。
 */
export function LobbyHero(props: LobbyHeroProps): ReactElement {
  const { onOpenLibrary } = props
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
              输入卡底行（它得挨着输入框才有意义，放在这里离输入框隔了一整块
              品牌区）。这里**不再**放「+ 新建项目」按钮 —— 首页本身就是
              创建页，再挂一个入口就是两套新建体验（D4 拍板：入口唯一）。 */}
        </div>
      </div>
      <div className="csLobbyActions">
        <div className="csLobbyButtons">
          {/* REQ-001：资产库入口（lobby 态；与 work 态 toolbar 图标共用同一 overlay）。
              CV-261 的「📎 添加素材」已随 REQ-028 迁往参考内容方框（LobbyStashBar），
              此处不再有第二枚素材入口。 */}
          <button type="button" className="csWelcomeSample" onClick={onOpenLibrary}>🗂 资产库</button>
        </div>
      </div>
    </div>
  )
}
