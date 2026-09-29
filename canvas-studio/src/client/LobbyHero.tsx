/**
 * Lobby 态（无项目）中栏顶部品牌条。
 *
 * 需求 1：项目没开始时聊天在中间，开始后回到右边。中栏因此被切成上下两截
 * —— 上截是本组件（品牌 + CTA），下截是聊天。聊天下移由 CSS grid 重排
 * 完成（见 styles.ts `.csFrame[data-mode="lobby"]`），**对话槽始终挂载在原
 * DOM 位置**：JSX 条件搬家会让上游 conversation 组件卸载重建，草稿、滚动
 * 位置与会话绑定全丢。
 *
 * CV-261：右侧动作区多一个「添加素材」入口 —— 宿主 composer 的附件按钮只认图片
 * （`imageMediaTypes` = png/jpeg/webp/gif），音视频文字**连文件选择器都过不了**；
 * 首页又没有项目，插件的上传链路全都要求 projectId。故首页的四类素材需要一个自己的
 * 入口：选中即进暂存条（`LobbyStashBar`），等第一句话把项目认领出来再落画布。
 * 入口放在这里而不是暂存条里，是因为**暂存条空时不渲染**，空态就没有任何可点的地方
 * ——那正是「用户根本不知道能传视频」的成因。
 */
import { useRef, type ChangeEvent, type ReactElement } from 'react'
import { BRAND, EMPTY_COPY, USER_MOCK } from '../brand-copy.js'
// CV-261：四类扩展名并集（与工具栏 / 暂存条同一份白名单来源）。
import { LOBBY_STASH_ACCEPT } from './lobby-stash.js'
import { LogoMark } from './brand/LogoMark.js'

export interface LobbyHeroProps {
  /** REQ-001：打开全局资产库全屏页。 */
  onOpenLibrary: () => void
  /**
   * CV-261：用户选中的素材文件（图片 / 视频 / 音频 / 文本，可多选）。
   *
   * 只把文件交出去 —— 分类把关、限额校验、暂存登记、拒收提示全在调用方
   * （StudioFrame 的 `handleStashedFiles`，与拖放共用同一条链路）。
   */
  onStashFiles?: (files: readonly File[]) => void
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
  const { onOpenLibrary, onStashFiles } = props
  const picker = useRef<HTMLInputElement>(null)
  /** 选完即清空：不清的话「同一个文件选第二次」不会再触发 change（浏览器行为）。 */
  const handlePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) onStashFiles?.(files)
  }
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
          {/* CV-261：四类素材入口。files 交给调用方（与拖放同一条暂存链路）。
              未接回调时按钮不渲染 —— 免得出现一个点了没反应的入口。 */}
          {onStashFiles !== undefined && (
            <button
              type="button"
              className="csWelcomeSample"
              onClick={() => { picker.current?.click() }}
              title="图片 / 视频 / 音频 / 文本 —— 选中后先暂存，发送第一句话时落进画布"
            >
              📎 添加素材
            </button>
          )}
          {/* REQ-001：资产库入口（lobby 态；与 work 态 toolbar 图标共用同一 overlay）。 */}
          <button type="button" className="csWelcomeSample" onClick={onOpenLibrary}>🗂 资产库</button>
        </div>
      </div>
      {/* 隐藏的文件选择器：真正的入口是上面那枚按钮，这里是它的原生实现。
          `multiple` + 四类 accept —— 与拖放得到的暂存结果完全一致。 */}
      <input
        ref={picker}
        className="csLobbyPicker"
        type="file"
        multiple
        accept={LOBBY_STASH_ACCEPT}
        onChange={handlePicked}
      />
    </div>
  )
}
