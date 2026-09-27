/**
 * 输入卡片**上方**的「刚拖入 / 上传中素材」回执条（2026-09-22 视频；CV-247 泛化到音频与文字）。
 *
 * ## 为什么要有它
 * 上传的可见反馈不能只靠画布节点 —— 首屏态（lobby）与「首条消息发出前」
 * （lobby-pending）**画布根本不渲染**（`StudioFrame.canvasBody` 三态），节点落进 store
 * 也无人画它 ⇒ 用户拖完「看不到任何东西」：视频这条 2026-09-22 验收反馈原话
 * 「好像没有地方能看到上传是否成功」；**音频与文字同病**（BUG-010：图片有宿主附件
 * 缩略图、视频有这张卡，音频两头都没有 ⇒ 拖完像没反应）。图片刻意不进这张卡：
 * capture 不拦 image，它落宿主 `ComposerAttachments` —— 对话区恒可见的附件缩略图，
 * 已是同等回执。
 *
 * ## 为什么挂这个槽
 * 宿主槽目录把 `conversation.input.dock` 定义为「独占一行、叠在输入卡片之上」
 * （dsh 自己就把排队消息与待办条放这儿）；**且宿主对它的渲染条件不含 `!hero`** ——
 * `ConversationRoot.tsx` 里同行相邻的两句：
 *   `{zone !== undefined && renderSlot('conversation.input.dock', zone)}`   ← 无条件
 *   `footer: !hero && zone !== undefined ? … 'conversation.composer.dock' …` ← 带 !hero
 * 首屏态（正是用户拖文件的场景）只有前者会渲染，所以卡片必须挂这里。
 *
 * ## 形态：向「图片附件」看齐
 * 用户要求「跟图片的处理情况相同」。图片拖进输入框会作为附件出现**缩略图 + 文件名 +
 * 可移除** —— 而宿主的附件通道只收图片（`imageMediaTypes` 固定 png/jpeg/webp/gif），
 * 音视频文字进不去。于是这里按同一形态自绘：**图位 + 文件名 + 大小/时长 + 状态 +
 * 移除**。图位按 kind 分两档：video 用 `<video preload="metadata">` 交给浏览器画首帧
 * （不抽帧、不等 ffmpeg、不等任何远端 —— 与「上传只落盘」那条链路一致）；audio/text
 * 没有可视帧，给**扩展名徽标**（`MP3` / `TXT`），不伪造缩略图。
 *
 * ## 盒子几何
 * 与 `.csContextBar`（同一输入区、宿主的 composer.dock）**镜像同一套量**：同 max-width、
 * 同侧边距。两条读数一上一下，宽度不齐会显得散（详见 styles.ts 该段的说明）。
 *
 * ## 数据
 * 与 StudioFrame 同一个 store（`mediaUploads`，内存态）—— **不存在第二份状态**。
 * 无条目时返回 `null`，一个 DOM 都不出（宿主那条「空态折叠」的教训）。
 */
import { type ReactElement, useEffect } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { MediaUploadBarInjected } from './contracts.js'
import type { MediaUploadItem } from './project-store.js'
import { formatDuration } from './AssetChipPreview.js'

/** props：注册时声明的 hooks 舱 + 移除回调（owner 另外会给 InputZone，本批不用）。 */
export type MediaUploadBarProps = InjectFace<MediaUploadBarInjected>

/**
 * 无条目时交给 selector 的稳定空数组。
 *
 * 必须模块级：在 selector 里现写 `[]` 每次都是新引用，订阅层每轮通知都判不等，
 * 退化成常驻重渲染（与 ProjectContextBar 的 NO_NODES 同因）。
 */
const NO_UPLOADS: readonly MediaUploadItem[] = []

const STATUS_LABEL: Record<MediaUploadItem['status'], string> = {
  uploading: '上传中',
  ready: '已就绪',
  failed: '上传失败',
}

/** 字节 → 人类可读（≥10MB 取整，否则一位小数）。 */
function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

/** 扩展名徽标（audio/text 的图位）：大写、截 5 字；没有后缀时给中性兜底。 */
function extensionBadge(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'FILE'
  return name.slice(dot + 1).toUpperCase().slice(0, 5)
}

export function MediaUploadBar(props: MediaUploadBarProps): ReactElement | null {
  const { useStudio, dismissUpload } = props
  const projectId = useStudio(store => store.selectedProjectId)
  // selector 只取 store 里**已有的引用**（数组本身），不现造对象/数组。
  const uploads = useStudio(store => (store.selectedProjectId === null
    ? NO_UPLOADS
    : store.mediaUploads[store.selectedProjectId] ?? NO_UPLOADS))
  if (projectId === null || uploads.length === 0) return null
  return (
    <div className="csUploadBar">
      {uploads.map(item => (
        <UploadChip
          key={item.id}
          item={item}
          onDismiss={() => { dismissUpload(projectId, item.id) }}
        />
      ))}
    </div>
  )
}

function UploadChip({ item, onDismiss }: {
  item: MediaUploadItem
  onDismiss: () => void
}): ReactElement {
  // objectURL 是浏览器持有的资源：卡片卸载时必须回收，否则整个会话都在漏 blob。
  // 依赖写 objectUrl 本身 —— 它若被替换（当前不会，留作防御）也按旧值回收。
  useEffect(() => () => {
    if (item.objectUrl !== undefined) URL.revokeObjectURL(item.objectUrl)
  }, [item.objectUrl])

  // 成功后优先用同源 url（持久、可跨刷新）；上传中只有本地 objectURL 可画首帧。
  const src = item.url ?? item.objectUrl
  const facts = [formatSize(item.size)]
  if (item.duration !== undefined && item.duration > 0) facts.push(formatDuration(item.duration))

  return (
    <div className={`csUploadChip is-${item.status}`} title={item.message ?? item.name}>
      <span className="csUploadChipArt">
        {item.kind === 'video' && src !== undefined ? (
          <video className="csUploadChipVideo" src={src} preload="metadata" muted playsInline />
        ) : (
          <span className="csUploadChipExt">{extensionBadge(item.name)}</span>
        )}
      </span>
      <span className="csUploadChipText">
        <span className="csUploadChipName">{item.name}</span>
        <span className="csUploadChipMeta">{STATUS_LABEL[item.status]} · {facts.join(' · ')}</span>
      </span>
      <button
        type="button"
        className="csUploadChipClose"
        onClick={onDismiss}
        aria-label={`移除 ${item.name}`}
        title="移除提示（画布节点不受影响）"
      >
        ×
      </button>
    </div>
  )
}
