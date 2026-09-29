/**
 * REQ-005 v1.4 / CV-261：首页（lobby）「已暂存素材」条 —— 拖入 / 选择之后、**发送之前**
 * 的可见回执。
 *
 * ## 为什么需要它（用户原话）
 *
 * 「上传文字/mp4/mp3 显示了『仅支持 PNG、JPG、WebP、GIF』」—— 宿主附件通道固定只收
 * 图片（`imageMediaTypes` = png/jpeg/webp/gif），音视频文字进不去；而首页又没有项目，
 * `/canvas-studio/upload*` 无从落盘。于是这四类在首页「既传不了、也看不见」。
 * 用户的诉求是「不上传后台，显示出来即可，等点击开始对话后，再直接落到画布上…
 * 可以理解为是暂存并展示」—— 本组件就是那个「展示」。
 *
 * ## 形态：与 `.csUploadBar`（上传回执卡）同族
 *
 * 同一位置（`conversation.input.dock`，卡片上方整行）、同一套 chip 结构（图位 +
 * 文件名 + 事实读数 + 移除）。差别只在**读数**：那张卡读上传状态
 * （上传中 / 已就绪 / 上传失败），这张读「已暂存」—— 因为这里确实什么都还没上传，
 * 谎称「已就绪」会在随后落盘失败时自相矛盾。
 *
 * 顶部额外一行说明（`.csStashNote`）：这一态是**新行为**，不说清楚用户不知道
 * 「发出去之后会发生什么」，而这正是他上一次反馈的焦点。
 *
 * ## 数据
 * 与规格行同一份 store（`lobbyStash`）—— 发送拦截分支（lobby 认领）在组件树之外
 * 读同一份清单去落画布，不存在第二份状态。
 *
 * ## 盒宽
 * 与同一条 dock 下的规格行 deck **左边缘对齐**（66px：卡片内容左缘）——两条读数上下
 * 相邻，一条缩进一条不缩进会显得散。故这里 `padding: 0` + 与 deck 同 max-width，
 * 而不是抄 `.csUploadBar` 的 `clearance + 16`（那条与 composer.dock 的场记板对齐，
 * 且**永不与暂存条同时出现**：一个在 work 态、一个在 lobby 态）。
 */
import { useState, type ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LobbyStashBarInjected } from './contracts.js'
import type { LobbyStashItem } from './project-store.js'
import { formatDuration } from './AssetChipPreview.js'

/** props：注册时声明的 hooks 舱 + 移除回调。 */
export type LobbyStashBarProps = InjectFace<LobbyStashBarInjected>

/**
 * 无条目时交给 selector 的稳定空引用。
 *
 * 必须模块级：在 selector 里现写 `[]` 每次都是新引用，订阅层每轮通知都判不等，
 * 退化成常驻重渲染（与 MediaUploadBar 的 NO_UPLOADS 同因）。
 */
const NO_STASH: readonly LobbyStashItem[] = []

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
  // selector 只取 store 里**已有的引用**（数组本身），不现造对象/数组。
  const stash = useStudio(store => (store.selectedProjectId === null ? store.lobbyStash : NO_STASH))
  // 只在首页渲染：进项目后清单已被消费清空，理论上也取不到；这条判定是**防御性**的
  // —— 万一落盘中途失败留下残余条目，也不该在项目页突然弹出一条「暂存」。
  if (projectId !== null || stash.length === 0) return null
  return (
    <div className="csStashBar">
      {stash.map(item => (
        <StashChip
          key={item.id}
          item={item}
          onDismiss={() => { dismissStash(item.id) }}
        />
      ))}
      <p className="csStashNote">
        已暂存 {stash.length} 个素材，<b>未上传</b>。发送第一句话后：建项目 → 逐个落进画布
        → 正文自动追加 <b>@ref 引用</b>。
      </p>
    </div>
  )
}

function StashChip({ item, onDismiss }: {
  item: LobbyStashItem
  onDismiss: () => void
}): ReactElement {
  /**
   * 视频时长的**组件本地**探测。
   *
   * 不写回 store：这里只是把一个浏览器已经解析出来的事实显示出来（`<video>` 反正
   * 要加载 metadata 才能画首帧），为一个纯展示读数去改 store 会平白多一条订阅通知。
   */
  const [probed, setProbed] = useState(0)
  const facts = [formatSize(item.size)]
  if (probed > 0) facts.push(formatDuration(probed))
  return (
    <div className="csStashChip" title={item.name}>
      <span className="csStashChipArt">
        {item.kind === 'video' && item.objectUrl !== undefined && (
          <video
            className="csStashChipMedia"
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
          <img className="csStashChipMedia" src={item.objectUrl} alt="" />
        )}
        {item.kind !== 'video' && item.kind !== 'image' && (
          <span className="csStashChipExt">{extensionBadge(item.name)}</span>
        )}
      </span>
      <span className="csStashChipText">
        <span className="csStashChipName">{item.name}</span>
        <span className="csStashChipMeta">已暂存 · {facts.join(' · ')}</span>
      </span>
      <button
        type="button"
        className="csStashChipClose"
        onClick={onDismiss}
        aria-label={`移除 ${item.name}`}
        title="移除（尚未落盘，移除即丢弃）"
      >
        ×
      </button>
    </div>
  )
}
