import type { StudioCanvasNodeKind, StudioCanvasOperationType } from '../../contracts/canvas.js'

/**
 * 画布标签唯一来源（CV-004）：节点类型与操作类型的中文名此前分散在
 * CanvasNode / CanvasEdges / LayerPanel / LayerDetailPanel / CanvasTimeline
 * 五处且已漂移（storyboard-split 缺失导致详情面板显示原始英文 key），统一
 * 收敛到本模块共用，新增类型只改这里。
 */

/** 节点类型中文标签（节点角标 / 图层行 / 详情面板 / 时间轴 chip 共用）。 */
export const KIND_LABEL: Readonly<Record<StudioCanvasNodeKind, string>> = {
  image: '图片',
  video: '视频',
  sticky: '便签',
  text: '文本',
  prompt: '提示',
  group: '分组',
}

/** 操作类型中文标签（边 chip + 详情面板共用）。 */
export const OPERATION_LABELS: Readonly<Record<StudioCanvasOperationType, string>> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'mkr-video': 'MKR 多关键帧',
  'style-transfer': '风格迁移',
  'background-replace': '背景替换',
  expand: '图片扩展',
  'background-remove': '智能抠图',
  variant: '图片变体',
  import: '导入',
  drawing: '绘图',
  storyboard: '分镜',
  'storyboard-split': '拆分单镜',
  'character-sheet': '定妆照',
  'scene-concept': '概念图',
  'video-clip': '视频片段',
  'video-composite': '视频合成',
}
