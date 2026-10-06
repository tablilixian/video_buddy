/**
 * REQ-028 验收反馈（卡内参考内容条）：首页输入卡**内部**的参考内容条 —— 暂存
 * 缩略图 + 宿主遗留草稿图 + 58×58「参考内容」方框（CV-261 暂存条 + v2 形态的
 * 槽位接管版）。
 *
 * ## 为什么长在卡片里（动态槽位接管，2026-10-06 拍板）
 *
 * 演示的 attach 条在输入卡**内部**左上（textarea 之上）；dock 行（本组件 v2 的
 * 原落点）在卡片外面，是验收对照里最大的结构差距。宿主恰好有一个单占槽长在这个
 * 位置：`conversation.input.attachments`（ui-attachment 注册，priority 0，画的是
 * 宿主自己的草稿图片条）。SlotCore 的注册语义为这种场景而设：**不同优先级 =
 * 合法遮蔽，低者渲染**（同优先级才抛错）—— index.ts 的动态桥在首页以 priority -1
 * 注册本组件遮蔽宿主条，进项目时 dispose 退位，宿主条目自动回为 winner。
 * **work 态零变化、零上游 import**；桥的注册/退位由 store 订阅驱动（只在
 * lobby↔work 翻转时动注册表），见 index.ts。
 *
 * ## 遗留草稿图（为什么本组件也画宿主的 attachments）
 *
 * 宿主草稿跟会话走：项目里贴的图（或引用 chip）在回首页后仍在草稿里，发送时
 * 会被一起带出去。接管前宿主条画它们、接管后不画 = 「首页看不见、发送却带上」
 * 的显示-语义背离（验收截图里「田祝融」正是这个形态）。本组件用槽 props 里的
 * 宿主数据（`attachments`，自带 previewUrl）与宿主自己的移除回调
 * （`onRemoveImage`）把这部分内容接着画 —— 不是第二份状态，是转显。
 *
 * ## 形态与机制（沿 v2 拍板，逐条不变）
 *
 * 58×58 虚线方框（＋ 居中、「参考内容」在 ＋ 下）常驻；缩略图从方框左侧排队；
 * 点开向下弹两个来源项（本地文件… / 资产库）；CV-261 机制原样沿用 —— 分类把关、
 * 四类限额、拒收 toast 仍只有 StudioFrame `handleStashedFiles` 一份实现（组件只发
 * `LOBBY_STASH_FILES_EVENT` / `LOBBY_OPEN_LIBRARY_EVENT` 两条 window 事件，约定见
 * lobby-stash.ts 尾部）；拖拽 / Ctrl+V 由 StudioFrame 的全局接管汇进同一份登记。
 * 「发送第一句话后自动落进画布」的语义出口保留在来源弹出框脚注里。
 */
import { useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LobbyStashBarInjected } from './contracts.js'
import type { LobbyStashItem } from './project-store.js'
import { LOBBY_OPEN_LIBRARY_EVENT, LOBBY_STASH_ACCEPT, LOBBY_STASH_FILES_EVENT } from './lobby-stash.js'
import { formatDuration } from './AssetChipPreview.js'
import { LobbyDivider, LobbyMenuItem, LobbyPopFoot, LobbyPopHead, LobbySel } from './LobbyPopover.js'

/**
 * props：注册时声明的 hooks 舱 + 移除回调 + 附件槽的 **runtime share**（宿主
 * InputBar 的 renderSlot 固定传入；声明为可选 —— 槽契约在编译期对账，这里宽容
 * 一档，缺省时只少画遗留草稿图，不炸渲染）。
 */
export type LobbyStashBarProps = InjectFace<LobbyStashBarInjected> & {
  /** 宿主草稿图片（跟会话走；回首页不清空，发送时会被一起带出去）。 */
  readonly attachments?: readonly ComposerAttachment[]
  /** 摘掉一枚宿主草稿图（走宿主 conversation service，宿主自己的数据流）。 */
  readonly onRemoveImage?: (id: ComposerAttachment['id']) => void
}

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

/** 稳定空引用：selector/props 缺省路径不得现造数组（订阅层每轮判不等 → 常驻重渲染）。 */
const NO_ATTACHMENTS: readonly ComposerAttachment[] = []

export function LobbyStashBar(props: LobbyStashBarProps): ReactElement | null {
  const { useStudio, dismissStash, attachments, onRemoveImage } = props
  const projectId = useStudio(store => store.selectedProjectId)
  const stash = useStudio(store => store.lobbyStash)
  const libraryCount = useStudio(store => store.libraryAssets.length)
  const picker = useRef<HTMLInputElement>(null)

  // 防御性兜底：动态桥理论上只在首页注册本组件（进项目先退位）；万一退位竞态
  // 让 work 态抢渲染到一次，宁可不画也不把首页条画进项目卡。
  if (projectId !== null) return null
  const hostDrafts = attachments ?? NO_ATTACHMENTS

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
      {/* 缩略图从左起排，＋ 方框永远留在组尾（演示：加一个就把 ＋ 往右挤）。
          暂存条目在前（本页刚加的），宿主遗留草稿图在后（上一段会话带来的）。 */}
      {stash.map(item => (
        <StashThumb
          key={item.id}
          item={item}
          onDismiss={() => { dismissStash(item.id) }}
        />
      ))}
      {hostDrafts.map(attachment => (
        <HostDraftThumb
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemoveImage}
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

/**
 * 宿主遗留草稿图（`attachments` 槽 runtime share 的转显）：与暂存缩略图同一套
 * 58×58 视觉。previewUrl 与移除都走宿主自己的数据流（conversation service），
 * 生命周期归宿主 —— 本组件只画，不持有、不回收。
 */
function HostDraftThumb({ attachment, onRemove }: {
  attachment: ComposerAttachment
  onRemove: ((id: ComposerAttachment['id']) => void) | undefined
}): ReactElement {
  return (
    <div className="csLobbyThumb" title={attachment.file.name}>
      <img className="csLobbyThumbMedia" src={attachment.previewUrl} alt={attachment.file.name} />
      <span className="csLobbyThumbFn">{attachment.file.name}</span>
      {onRemove !== undefined && (
        <button
          type="button"
          className="csLobbyThumbRm"
          onClick={() => { onRemove(attachment.id) }}
          aria-label={`移除 ${attachment.file.name}`}
          title="移除草稿图片"
        >
          ×
        </button>
      )}
    </div>
  )
}
