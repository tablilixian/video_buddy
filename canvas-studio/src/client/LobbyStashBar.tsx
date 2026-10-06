/**
 * REQ-028：首页输入框左上的「参考内容」方框 + 缩略图排队（CV-261 暂存条的 v2 形态）。
 *
 * ## 形态（1:1 复刻演示 video-agent-inputbox.html 的 attach 条）
 *
 * 演示把附件入口从工具栏挪到输入框左上：一个 58×58 虚线圆角方框（＋ 居中，
 * 「参考内容」四字在 ＋ 下面），点开向下弹出**两个来源项**（本地文件… 多选 /
 * 资产库）；暂存素材以 58×58 缩略图从方框**左侧**排队，把 ＋ 一路往右挤，
 * 整组从输入框左上起排；hover 浮出移除钮，全部移除后 ＋ 回到最左。拖拽与
 * Ctrl+V 是快捷路径（拖拽在 StudioFrame 的全局接管里；粘贴同样由 StudioFrame
 * 在 lobby 态接 document paste —— 两条路径汇进同一份登记，见下）。
 *
 * 方框与缩略图同为 58×58，加素材不会跳高度，也不会把输入框文字往下顶（演示
 * 规格注记原文）。缩略图排队 = 暂存条目的**新形态**：v1.4 的「chip + 说明行」
 * 换成演示的方框队列，store（`lobbyStash`）与模块级文件表（lobby-stash.ts）
 * 一字未动。
 *
 * ## CV-261 暂存机制原样沿用（拍板：入口形态改造，机制不换）
 *
 * 首页 = 还没有项目，四类素材「发送前只展示不上传」：登记时分类把关 + 四类限额
 * （lobby-stash.ts 的 `stashLobbyFiles`），发送第一句话由认领分支落画布 + `@ref`
 * 进正文。 v1.4 顶部那行「已暂存 N 个素材，未上传…」说明收进来源弹出框的脚注
 * —— 演示形态没有常驻说明行，但「发出去之后会发生什么」仍要有个出口（这正是
 * 上一次用户反馈的焦点，不能丢）。
 *
 * ## 与 StudioFrame 的接线（为什么是 window 事件）
 *
 * 「本地文件」的登记与拒收提示（toast）、「资产库」浮层的开关都归 StudioFrame；
 * 本组件经 index.ts 注册，与它分属两棵树。两条 window 自定义事件（常量与约定
 * 见 lobby-stash.ts 尾部）：`LOBBY_STASH_FILES_EVENT` 交 File[]，`LOBBY_OPEN_LIBRARY_EVENT`
 * 开浮层。本组件只发事件，不做登记 —— 拒收提示与限额判定仍只有一份实现。
 *
 * ## 常驻渲染
 *
 * v1.4 无条目时不渲染（空态没有任何可点的地方 —— 那正是「不知道能传视频」的
 * 成因）；v2 的 ＋ 方框**就是**常驻入口，lobby 态恒渲染。进项目后（work 态）
 * 仍返回 null。
 */
import { useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LobbyStashBarInjected } from './contracts.js'
import type { LobbyStashItem } from './project-store.js'
import { LOBBY_OPEN_LIBRARY_EVENT, LOBBY_STASH_ACCEPT, LOBBY_STASH_FILES_EVENT } from './lobby-stash.js'
import { formatDuration } from './AssetChipPreview.js'
import { LobbyDivider, LobbyMenuItem, LobbyPopFoot, LobbyPopHead, LobbySel } from './LobbyPopover.js'

/** props：注册时声明的 hooks 舱 + 移除回调。 */
export type LobbyStashBarProps = InjectFace<LobbyStashBarInjected>

/** 字节 → 人类可读（≥10MB 取整，否则一位小数）。与上传回执卡同一口径。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return mb >= 10 ? `${String(Math.round(mb))} MB` : `${mb.toFixed(1)} MB`
}

/** 扩展名徽标（audio/text 的图位）：大写、截 5 字；没有后缀时给中性兜底。 */
function extensionBadge(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'FILE'
  return name.slice(dot + 1).toUpperCase().slice(0, 5)
}

export function LobbyStashBar(props: LobbyStashBarProps): ReactElement | null {
  const { useStudio, dismissStash } = props
  const projectId = useStudio(store => store.selectedProjectId)
  const stash = useStudio(store => store.lobbyStash)
  const libraryCount = useStudio(store => store.libraryAssets.length)
  const picker = useRef<HTMLInputElement>(null)

  if (projectId !== null) return null

  /** 选完即清空：不清的话「同一个文件选第二次」不会再触发 change（浏览器行为）。 */
  const handlePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) {
      window.dispatchEvent(new CustomEvent<File[]>(LOBBY_STASH_FILES_EVENT, { detail: files }))
    }
  }

  return (
    <div className="csLobbyAttach">
      {/* 缩略图从左起排，＋ 方框永远留在组尾（演示：加一个就把 ＋ 往右挤）。 */}
      {stash.map(item => (
        <StashThumb
          key={item.id}
          item={item}
          onDismiss={() => { dismissStash(item.id) }}
        />
      ))}

      {/* ＋ 参考内容方框：向下弹两个来源项（面板在 below 方向展开 + 尖角翻上沿）。 */}
      <LobbySel
        expand="below"
        chipClassName="csLobbyAttachAdd"
        chipLabel="添加参考内容"
        popWidth={238}
        chip={(
          <>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M12 5.5v13M5.5 12h13" />
            </svg>
            <span className="csLobbyAttachLb">参考内容</span>
          </>
        )}
      >
        {close => (
          <>
            <LobbyPopHead>添加素材</LobbyPopHead>
            <LobbyMenuItem
              label="本地文件…"
              meta="多选"
              onSelect={() => { close(); picker.current?.click() }}
            />
            <LobbyMenuItem
              label="资产库"
              {...(libraryCount > 0 ? { meta: `${String(libraryCount)} 项` } : {})}
              onSelect={() => { close(); window.dispatchEvent(new Event(LOBBY_OPEN_LIBRARY_EVENT)) }}
            />
            <LobbyDivider />
            {/* CV-261 的「未上传 / 发送后落画布」说明的新出口（原顶部长说明行
                收进脚注）；拖拽与 Ctrl+V 快捷路径一并写明。 */}
            <LobbyPopFoot>也可直接把文件拖入输入框或 Ctrl+V 粘贴；发送第一句话后自动落进画布。</LobbyPopFoot>
          </>
        )}
      </LobbySel>

      {/* 隐藏的文件选择器：真正的入口是弹出框的「本地文件」项，这里是它的原生实现。
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

/** 58×58 缩略图（图 / 视频出画面，音频 / 文本出扩展名徽标；文件名压底条）。 */
function StashThumb({ item, onDismiss }: {
  item: LobbyStashItem
  onDismiss: () => void
}): ReactElement {
  /**
   * 视频时长的**组件本地**探测。不写回 store：这里只是把一个浏览器已经解析出来
   * 的事实显示出来（`<video>` 反正要加载 metadata 才能画首帧），为一个纯展示
   * 读数去改 store 会平白多一条订阅通知（v1.4 同款理由）。
   */
  const [probed, setProbed] = useState(0)
  const facts = [formatSize(item.size)]
  if (probed > 0) facts.push(formatDuration(probed))
  // v1.4 chip 上的「已暂存 · 大小 · 时长」读数收进 hover title：58px 方框里
  // 只放画面与文件名（演示形态），读数事实仍随手可得。
  return (
    <div className="csLobbyThumb" title={`${item.name} · ${facts.join(' · ')}`}>
      {item.kind === 'video' && item.objectUrl !== undefined && (
        <video
          className="csLobbyThumbMedia"
          src={item.objectUrl}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration
            if (Number.isFinite(seconds) && seconds > 0) setProbed(seconds)
          }}
        />
      )}
      {item.kind === 'image' && item.objectUrl !== undefined && (
        <img className="csLobbyThumbMedia" src={item.objectUrl} alt={item.name} />
      )}
      {item.kind !== 'video' && item.kind !== 'image' && (
        <span className="csLobbyThumbExt">{extensionBadge(item.name)}</span>
      )}
      <span className="csLobbyThumbFn">{item.name}</span>
      <button
        type="button"
        className="csLobbyThumbRm"
        onClick={onDismiss}
        aria-label={`移除 ${item.name}`}
        title="移除（尚未落盘，移除即丢弃）"
      >
        ×
      </button>
    </div>
  )
}
