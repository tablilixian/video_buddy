/**
 * 就近工具条「显示哪几个按钮」的唯一判据（REQ-041 抽出，纯函数）。
 *
 * 为什么从组件里抽出来：这套判据原先写在 `NodeActionBar` 的组件体里，只有「源码
 * 里有没有这行字」这种闸能测它，行为层面（某类节点到底出几个钮、什么顺序）没有
 * 可断言的入口。抽成纯函数后，测试直接喂节点快照断言返回的槽位数组。
 *
 * ## 两条硬规则
 *
 * 1. **不自造判据**：能不能重试 = `node-params.isReplayable`；能不能改词 =
 *    `promptFieldsOf` 非空；能不能下载 = `canvas-actions.canDownloadNode`。
 *    组件只提供「宿主有没有接这个回调」（caps）。
 * 2. **REQ-041 分镜卡按媒体卡三项处理**（用户口径 2026-11-25）：段产物不是节点
 *    产物 —— URL 由清单按 `segmentRef` 派生，节点上 `kind` 仍是 text、`url` 仍空。
 *    只按 kind/url 判，分镜卡会落回 text 分支，而它 `isReplayable` 为 false、
 *    `promptFields` 为空 ⇒ 真机上只剩「引用到对话」，与 H3 视频卡的三个按钮对不上。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'
import { canDownloadNode } from './canvas-actions.js'
import { isReplayable, promptFieldsOf } from './node-params.js'

/** 工具条可出的一格（渲染顺序 = `NODE_ACTION_ORDER`，与历史视觉顺序一致）。 */
export type NodeActionSlot = 'retry' | 'edit' | 'reference' | 'library' | 'preview' | 'download'

/** 渲染顺序固定：重试 → 改提示词 → 引用 → 添加到资产库 → 预览 → 下载。 */
export const NODE_ACTION_ORDER: readonly NodeActionSlot[] = ['retry', 'edit', 'reference', 'library', 'preview', 'download']

/** 宿主接没接对应回调（没接 = 该钮不出现，既有调用方不必全接）。 */
export interface NodeActionCapabilities {
  retry: boolean
  edit: boolean
  reference: boolean
  library: boolean
  /** image 的「预览」走大图浮层（CV-283）。 */
  previewImage: boolean
  /** video / audio / 分镜段的「预览」走播放浮层（CV-044）。 */
  playback: boolean
  download: boolean
}

/**
 * REQ-041：这张 text 卡要不要按**媒体卡三项**处理 = 它有没有命中清单的段产物。
 *
 * 只认 `kind === 'text'`：`segmentRef` 只由 `seedStoryboardShot` /
 * `submit_storyboard_for_approval` 两种生产者写（见 `canvas-actions.isShotCard`），
 * 其余 kind 带同名 prop 也不该改判据。
 */
export function isSegmentReviewMedia(
  node: Pick<StudioCanvasNode, 'kind' | 'isLoading'>,
  segmentVideoUrl: string | undefined,
): boolean {
  if (node.kind !== 'text' || node.isLoading === true) return false
  return typeof segmentVideoUrl === 'string' && segmentVideoUrl.length > 0
}

/** 该节点应显示的动作槽位（已按 `NODE_ACTION_ORDER` 排好）。 */
export function nodeActionSlots(
  node: StudioCanvasNode,
  segmentVideoUrl: string | undefined,
  caps: NodeActionCapabilities,
): readonly NodeActionSlot[] {
  const isVideo = node.kind === 'video'
  const isImage = node.kind === 'image'
  const isAudio = node.kind === 'audio'
  const isMedia = isVideo || isImage || isAudio
  const idle = node.isLoading !== true
  const hasSegment = isSegmentReviewMedia(node, segmentVideoUrl)

  const slots: NodeActionSlot[] = []
  // 重试 / 改提示词不在这三类媒体占位（REQ-031 Step 5 / REQ-032 F5）。
  if (!isMedia && idle && caps.retry && isReplayable(node)) slots.push('retry')
  if (!isMedia && idle && caps.edit && promptFieldsOf(node).length > 0) slots.push('edit')
  // 托盘（分组）本身没有产物，引用它没有语义。
  if (caps.reference && node.kind !== 'group') slots.push('reference')
  if ((isImage || isAudio) && idle && caps.library && node.url !== undefined) slots.push('library')

  // 预览：媒体卡按 kind 分派（image → 大图，video/audio → 播放浮层）；
  // 分镜段恒走播放浮层（播清单里那一版，带声副本优先）。
  const mediaPreview = isMedia && node.url !== undefined && idle && (
    ((isVideo || isAudio) && caps.playback) || (isImage && caps.previewImage)
  )
  if (mediaPreview || (hasSegment && caps.playback)) slots.push('preview')

  // 下载：媒体卡与右键菜单同源；分镜段走同一 Host 通路（URL 由宿主按 ref 现取）。
  const mediaDownload = isMedia && idle && caps.download && canDownloadNode(node)
  if (mediaDownload || (hasSegment && caps.download)) slots.push('download')

  return NODE_ACTION_ORDER.filter(slot => slots.includes(slot))
}
