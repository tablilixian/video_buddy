import type { StudioCanvasNodeKind, StudioCanvasOperationType } from '../../contracts/canvas.js'

/**
 * 画布标签唯一来源（CV-004）：节点类型与操作类型的中文名此前分散在
 * CanvasNode / CanvasEdges / LayerPanel / NodeDetailDrawer / CanvasTimeline
 * 五处且已漂移（storyboard-split 缺失导致详情面板显示原始英文 key），统一
 * 收敛到本模块共用，新增类型只改这里。
 */

/** 节点类型中文标签（节点角标 / 图层行 / 详情面板 / 时间轴 chip 共用）。 */
export const KIND_LABEL: Readonly<Record<StudioCanvasNodeKind, string>> = {
  image: '图片',
  video: '视频',
  // CV-128：音频（BGM）。
  audio: '音频',
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
  // DD-09：Look 阶段的**通用**图片值（基调样张 / 定妆照 / 场景概念图都走它，
  // 因为工具层只能区分「绑了分镜卡没有」，分不出这三者的细分）。标签写成
  // 「Look 图」而不是「定妆照」：后者已被 character-sheet 占用，写重了用户
  // 看边 chip 分不清这一张到底是资产卡拼图还是随手出的样张。
  look: 'Look 图',
  'character-sheet': '定妆照',
  'scene-concept': '概念图',
  'video-clip': '视频片段',
  'video-composite': '视频合成',
  'text-to-audio': 'BGM 生成',
}

/** CV-011：参考角色短标签（节点角标用；托盘里用 ReferenceTray 的全称版）。 */
export const REFERENCE_ROLE_SHORT: Readonly<Record<string, string>> = {
  image: '构图',
  character: '角色',
  style: '风格',
  frame: '首末帧',
}

/**
 * CV-197：节点类型的**色彩身份**（画布卡片 / 图层面板 / 时间轴 chip / 参考托盘 /
 * 详情抽屉五处共用这一份判据）。
 *
 * ## 为什么是「类名」而不是「色值」
 *
 * 色值住在 `styles.ts` 的令牌层（`--cs-accent` / `--cs-teal` / `--cs-gold`），
 * 这里只回答「这类节点属于哪一个色彩身份」。把 HEX 写进 TS 会在主题切换、
 * 预设切换时全部失效 —— 本仓已经有过一次「硬编码 `#6c5ce7` 在四个品牌预设下
 * 都在悄悄用错色」的教训（见 styles.ts 的 DD-03 注释）。
 *
 * ## 三色 + 中性
 *
 * 判据只有一条：**这是不是媒体、是哪种媒体**。非媒体节点（文本 / 便签 / 提示 /
 * 分组）没有色彩身份 = 空串 —— 不给它们上色是刻意的：它们本来就没有「画面」，
 * 染一道彩边只会让画布更花，而且会把「有彩边 = 有画面」这条扫读规则污染掉。
 *
 * ⚠️ 视频 = teal 与既有「成片节点用青描边」（`.csNodeFilm`，DD-03）**同色不冲突**：
 * 成片本来就是视频，青 = 视频系是一条规则，成片只是在这条规则上多一个「成片」
 * 标签与略重的描边。反过来说，若给成片另配一色，画布上会出现两套青互抢。
 */
export const KIND_ACCENT: Readonly<Record<StudioCanvasNodeKind, string>> = {
  image: 'csKindImage',
  video: 'csKindVideo',
  // CV-128：音频（BGM）—— 与工作流条上的 gold 语义一致（提示 / 需注意的附加物）。
  audio: 'csKindAudio',
  sticky: '',
  text: '',
  prompt: '',
  group: '',
}

/** 取某类节点的色彩身份类名；非媒体节点返回空串（调用方按 `filter(Boolean)` 拼类）。 */
export function kindAccentOf(kind: StudioCanvasNodeKind): string {
  return KIND_ACCENT[kind] ?? ''
}
