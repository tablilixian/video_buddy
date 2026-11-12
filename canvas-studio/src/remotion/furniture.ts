/**
 * 1C（CV-462）· **场景装饰构件层**（scene furniture）。
 *
 * ## 为什么需要
 *
 * 逐帧比对参考成片（GT）后确认：我们复刻成功的是**内容层**（文字 / 卡片 / 路径 / 错峰 /
 * 时机），GT 里还有整整一层**场景装饰**（四角括线、底部进度条、光斑、时间码……），我们
 * 一个都没有。差距的根因不是「画不出来」，而是**没有任何东西把它们固化下来、复用**。
 *
 * ## 形态：声明式配方 → 展开成普通轨道
 *
 * 构件是**纯函数**：输入「构件规格 + 画布上下文」，输出**普通 manifest 轨道数组**。
 * 渲染器完全不知道构件的存在 —— 这是本方案唯一的硬约束（不新造渲染管线）。
 *
 * ```
 * furniture.json（模板声明）
 *   { "id": "cornerBrackets", "params": { "inset": 2.4, ... } }
 *        ↓  expandFurniture(spec, ctx)   ← 纯函数、零 IO、可单测
 *   manifest.tracks[]（普通 shape 轨）
 * ```
 *
 * ## 两条铁律
 *
 * 1. **确定性**：同 spec + 同 ctx 必须逐字节同结果（星点走固定种子 PRNG，禁 `Math.random()`）；
 * 2. **纯追加**：调用方把结果 append 到 `tracks` 末尾，不改既有轨 ⇒ 构件默认关闭时
 *    逐帧像素天然不变。
 *
 * ## 为什么括线用 8 个 rect 而不是 `shape:'path'`
 *
 * `path` 的坐标空间是 0–100 双轴百分比 + `preserveAspectRatio="none"` ⇒ 16:9 下**非等比**：
 * 一条竖线和一条横线的像素长度没法取同一个值。8 个 rect 更笨但更准，且**零契约扩展**。
 */
import type { Animate } from './manifest.js'
import type { Transform } from './manifest-transform.js'

/** 构件 id。1C-min 落地三个；新模板批第 2 步加 `cardWall`（见 D-39 / D-40）。 */
export type FurnitureId = 'cornerBrackets' | 'progressBar' | 'starfield' | 'cardWall'

/** 构件声明（模板 `furniture.json` 的一项）。 */
export interface FurnitureSpec {
  id: FurnitureId
  /** 构件参数；缺省项取 `FURNITURE_DEFAULTS[id]`。 */
  params?: Record<string, unknown>
  /** 起始帧（绝对）。缺省 0。 */
  startFrame?: number
  /** 结束帧（绝对，**不含**）。缺省 = 到片尾。 */
  endFrame?: number
}

/**
 * 展开上下文。四个字段都必填 —— 「缺 ctx 就静默出 0 尺寸」是最坏的失败方式：
 * 构件会变成看不见的空轨，而模板作者以为它生效了。
 */
export interface FurnitureContext {
  canvasWidth: number
  canvasHeight: number
  fps: number
  totalFrames: number
}

/**
 * 展开产物：**manifest 轨道的字段形状**（不新建类型体系 —— 展开完直接塞进 `tracks`）。
 *
 * S3（2026-11-11）起是**双形态联合**：
 * - `FurnitureShapeDraft`：普通 `shape` 轨（括线 / 进度条 / 星点 / 卡墙的子卡）；
 * - `FurnitureGroupDraft`：`group` 容器轨（S1-B 契约）—— 卡墙容器化后整面墙是
 *   **1 个** WebGL 预合成层（#14 实测 62 卡 82ms/帧），子卡是平面网格、统一吃容器
 *   的 3D 投影（统一灭点）。旧的「每卡自带透视」公式保留在 `card-wall-geometry.ts`
 *   （#13 探针专用），产品路径不再用。
 */
export interface FurnitureShapeDraft {
  id: string
  type: 'shape'
  shape: 'rect' | 'circle'
  color: string
  /** 0–100 画布百分比，**x / y 是中心**（与 `ShapeTrack.box` 同域）。 */
  box: { x: number; y: number; w: number; h: number }
  startFrame: number
  durationInFrames: number
  /** 缺省 `0` = 硬切（装饰层不该在片头整体淡入）；`cardWall` 的错峰入场会写正数。 */
  fadeFrames: number
  animate?: Animate | Animate[]
  /** 颜色过渡（S4：卡墙辉光脉冲子轨用 —— 亮起后缓暗到 `to` 色）。 */
  colorShift?: { from: string; to: string; startFrame?: number; durationInFrames?: number; easing?: string }
  /** 静态 3D 姿势（旧每卡透视模式遗留；容器模式下子卡一律平面、不写）。 */
  transform?: Transform
  /** 退场（ML-02：`fadeFrames:0` 且在片尾前结束的轨必须有 exit）。 */
  exit?: { to: Record<string, number>; durationInFrames: number; easing?: string }
}

/** `group` 容器轨展开产物（目前只有 `cardWall` 会产出）。 */
export interface FurnitureGroupDraft {
  id: string
  type: 'group'
  /** 子轨时间**相对组起点**、坐标是画布绝对百分比（S1-B 契约，校验层会复核）。 */
  children: FurnitureShapeDraft[]
  startFrame: number
  durationInFrames: number
  fadeFrames: number
  animate?: Animate | Animate[]
  transform?: Transform
  exit?: { to: Record<string, number>; durationInFrames: number; easing?: string }
}

export type FurnitureTrackDraft = FurnitureShapeDraft | FurnitureGroupDraft

/** 构件参数错误 / 上下文错误（都是**调用方**的错，不是渲染问题）。 */
export class FurnitureError extends Error {
  readonly code: 'FURNITURE_UNKNOWN_ID' | 'FURNITURE_BAD_CONTEXT' | 'FURNITURE_BAD_RANGE' | 'FURNITURE_ID_CONFLICT' | 'FURNITURE_BAD_PARAMS'

  constructor(code: FurnitureError['code'], message: string) {
    super(message)
    this.name = 'FurnitureError'
    this.code = code
  }
}

/** 每个构件的缺省参数（也是**唯一**的参数文档：改这里等于改契约，测试会跟着变）。 */
export const FURNITURE_DEFAULTS = {
  cornerBrackets: {
    /** 距画布边缘的百分比（GT 实测约 2.4%）。 */
    inset: 2.4,
    /** 单边长度（画布百分比）。 */
    arm: 1.2,
    /** 线宽（画布百分比）。 */
    thickness: 0.08,
    /** GT 括线是低饱和蓝灰；纯白会盖过内容。 */
    color: '#5b6b86',
    corner: 'all' as 'all' | 'tl' | 'tr' | 'bl' | 'br',
  },
  progressBar: {
    /** 距画布底部的百分比。 */
    bottomInset: 3.2,
    /** 刻度带起点 / 终点 x（百分比）。 */
    left: 4.4,
    right: 95.6,
    ticks: 40,
    tickWidth: 0.16,
    tickHeight: 1.1,
    tickColor: '#2a3648',
    cursorWidth: 0.55,
    cursorHeight: 1.6,
    cursorColor: '#f2a33c',
    /** 游标走完全程的帧数；缺省 = 全片（`ctx.totalFrames`）。 */
    cursorTravelFrames: 0,
  },
  starfield: {
    count: 60,
    seed: 11,
    /** 最大半径（画布宽度的百分比）。 */
    maxRadius: 0.05,
    /** 星点亮度只能靠 color 本身（`shape` 轨没有 opacity 字段）。 */
    color: '#7d93b8',
  },
  /**
   * 3D 卡片墙（S3 容器化版）：**1 个 `group` 容器 + 平面网格子卡**。
   *
   * 旧版「每卡自带透视、一卡一 WebGL 层」的成本账（D-40：12 张 58ms/帧、36 张 243ms/帧）
   * 被容器化推翻 —— #14 实证容器包 62 张平面子卡 = 1 个 WebGL 层、82ms/帧、整面统一
   * 灭点（与原片卡墙同构）。旧投影公式保留在 `card-wall-geometry.ts`（#13 探针专用）。
   *
   * 入场节奏 = **批次制**（不是逐卡 stagger）：参考片卡墙是「一批一批亮起来」，
   * 批次帧距对齐参考片的运动峰值间隔（0.6s ≈ 36–39 帧）。
   */
  cardWall: {
    /** 主卡色（S4：参考片墙面以暗卡为主 —— 稳态亮度对齐原片 0.15–0.16）。 */
    color: '#e9edf3',
    /** 亮卡色（约 2/9 的卡；S4 起与主色对调语义：accent 是墙上少数亮卡）。 */
    accentColor: '#16233a',
    /** 少量浅蓝卡（参考片的电蓝点缀）。 */
    lightColor: '#9fc2e8',
    /** 每卡淡入帧数（3 帧 ≈ 快闪，既进得来又留帧差尖峰）。 */
    fadeFrames: 3,
    /** 网格：列 / 行 / 卡宽高 / 间隙（画布百分比，网格可越出画布）。 */
    cols: 9,
    rows: 7,
    cardW: 10.5,
    cardH: 12.5,
    gapX: 2.5,
    gapY: 2.5,
    /** 墙中心（画布百分比）。 */
    originX: 50,
    originY: 50,
    /** 实际卡数（≤ cols×rows；缺省全网格，多出的格位跳过）。 */
    count: 62,
    /** 容器 3D 姿势（角度受 S1-B 硬闸 ≤30° 约束，校验层复核）。 */
    rotateX: 14,
    rotateY: -8,
    perspective: 1100,
    /** 推近：容器 animate scale 从 pushFrom 到 pushTo（linear 全程）。0=0 关闭。 */
    pushFrom: 0.9,
    pushTo: 1.25,
    /** 批次入场：首帧（组内相对）、批间隔、首批张数、常规批张数（批帧差 ≈ 张数×单卡屏幕占比）。 */
    batchStart: 0,
    batchFrames: 37,
    firstBatch: 16,
    /** 常规批张数（首批之后每批几张；S3 调参：批差要落在参考片 0.09–0.12 帧差带内）。
     *  R10（2026-11-12）：batchStart/batchFrames/perBatch 三值曾为 30/39/8 的调参残留，
     *  与同提交新建的 cardwall 容器测试（首批 0 帧 / 批距 37 / 9 批次）及 kinetic-promo
     *  furniture.json 实际覆盖值三方矛盾，测试出生即红 —— 统一回 0/37/6（默认=契约=模板）。 */
    perBatch: 6,
    /** 特征卡条纹：每隔 stripeEvery 张卡带 3 条卡内条纹（数据卡观感），0 = 不画。 */
    stripeEvery: 8,
    /** 墙退场帧数（1 = 硬切；0 = 不写 exit，需调用方自查 ML-02）。 */
    exitFrames: 1,
    /** 特征卡条纹色（S4：主卡色改暗后，条纹要能在暗卡上读出来）。 */
    stripeColor: '#2c4a78',
    /** 批次辉光脉冲：每个批次时刻亮起一块蓝色辉光再缓暗（S4 —— 参考片的运动
     *  尖峰来自墙面的辉光节奏，不是卡片本身；卡片 settle 成暗色后，5fps 采样
     *  下的帧差尖峰全靠它）。0 = 关闭。 */
    glowFrames: 37,
    glowColor: '#6fa8e8',
    glowDim: '#1a2942',
    glowW: 48,
    glowH: 40,
  },
} as const

/** 未知 id 的报错文案（列出全部可选值 —— 让调用方一次改对）。 */
const FURNITURE_IDS: readonly FurnitureId[] = ['cornerBrackets', 'progressBar', 'starfield', 'cardWall']

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key]
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/** 4 位小数收口（与 `card-wall-geometry.ts` / 探针同一口径）。 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** 上下文校验：任何一个字段不合法 ⇒ 抛错（绝不静默按 0 处理）。 */
function assertContext(ctx: FurnitureContext): void {
  const bad: string[] = []
  if (!(typeof ctx?.canvasWidth === 'number' && Number.isFinite(ctx.canvasWidth) && ctx.canvasWidth > 0)) bad.push('canvasWidth')
  if (!(typeof ctx?.canvasHeight === 'number' && Number.isFinite(ctx.canvasHeight) && ctx.canvasHeight > 0)) bad.push('canvasHeight')
  if (!(typeof ctx?.fps === 'number' && Number.isFinite(ctx.fps) && ctx.fps > 0)) bad.push('fps')
  if (!(typeof ctx?.totalFrames === 'number' && Number.isFinite(ctx.totalFrames) && ctx.totalFrames > 0)) bad.push('totalFrames')
  if (bad.length > 0) {
    throw new FurnitureError(
      'FURNITURE_BAD_CONTEXT',
      `expandFurniture 的 ctx 缺字段或不合法：${bad.join(' / ')}（四个字段都必填且必须为正数）`,
    )
  }
}

/** 帧区间：[start, end)，缺省 [0, totalFrames)；非法区间直接拒收。 */
function resolveRange(spec: FurnitureSpec, ctx: FurnitureContext): { startFrame: number; durationInFrames: number } {
  const start = typeof spec.startFrame === 'number' && Number.isFinite(spec.startFrame) ? Math.round(spec.startFrame) : 0
  const rawEnd = typeof spec.endFrame === 'number' && Number.isFinite(spec.endFrame)
    ? Math.round(spec.endFrame)
    : ctx.totalFrames
  const duration = rawEnd - start
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new FurnitureError(
      'FURNITURE_BAD_RANGE',
      `构件 ${spec.id} 的帧区间非法：[${String(start)}, ${String(rawEnd)}) —— endFrame 必须大于 startFrame`,
    )
  }
  return { startFrame: start, durationInFrames: duration }
}

/** 把中心语义的 box 收口到 4 位小数（浮点噪声会让「同输入两次逐字节相同」变得脆弱）。 */
function box(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const round = (value: number): number => Math.round(value * 10000) / 10000
  return { x: round(x), y: round(y), w: round(w), h: round(h) }
}

/**
 * **四角括线**：8 条 `rect`（每角一竖一横）。
 *
 * 几何（`box` 是**中心**语义，这是构件最容易算错半屏的地方）：
 * - 左上竖线：中心 `(inset, inset + arm/2)`，宽 `thickness`、高 `arm`
 * - 左上横线：中心 `(inset + arm/2, inset)`，宽 `arm`、高 `thickness`
 * - 右下 = `100 − 对应值` 镜像
 */
function cornerBrackets(spec: FurnitureSpec, ctx: FurnitureContext, range: { startFrame: number; durationInFrames: number }): FurnitureTrackDraft[] {
  void ctx
  const p = (spec.params ?? {}) as Record<string, unknown>
  const d = FURNITURE_DEFAULTS.cornerBrackets
  const inset = num(p, 'inset', d.inset)
  const arm = num(p, 'arm', d.arm)
  const thickness = num(p, 'thickness', d.thickness)
  const color = str(p, 'color', d.color)
  const corner = str(p, 'corner', d.corner)
  const corners: readonly ('tl' | 'tr' | 'bl' | 'br')[] = corner === 'all' || !['tl', 'tr', 'bl', 'br'].includes(corner)
    ? ['tl', 'tr', 'bl', 'br']
    : [corner as 'tl' | 'tr' | 'bl' | 'br']
  const halfArm = arm / 2
  const near = inset
  const far = 100 - inset
  const tracks: FurnitureTrackDraft[] = []
  for (const key of corners) {
    const left = key === 'tl' || key === 'bl'
    const top = key === 'tl' || key === 'tr'
    const cx = left ? near : far
    const cy = top ? near : far
    const vertical = box(cx, cy + (top ? halfArm : -halfArm), thickness, arm)
    const horizontal = box(cx + (left ? halfArm : -halfArm), cy, arm, thickness)
    tracks.push(
      {
        id: `fx-corner-${key}-v`, type: 'shape', shape: 'rect', color, box: vertical,
        startFrame: range.startFrame, durationInFrames: range.durationInFrames, fadeFrames: 0,
      },
      {
        id: `fx-corner-${key}-h`, type: 'shape', shape: 'rect', color, box: horizontal,
        startFrame: range.startFrame, durationInFrames: range.durationInFrames, fadeFrames: 0,
      },
    )
  }
  return tracks
}

/**
 * **底部进度条**：N 条刻度（静态）+ 1 个游标（`animate.x` 走全程）。
 *
 * 游标能同时「box 定 y」+「animate 动 x」，靠的是 **`shape` 轨豁免 box/animate 的
 * 位置互斥**（契约文档明写；`textCard` 不行）。
 */
function progressBar(spec: FurnitureSpec, range: { startFrame: number; durationInFrames: number }): FurnitureTrackDraft[] {
  const p = (spec.params ?? {}) as Record<string, unknown>
  const d = FURNITURE_DEFAULTS.progressBar
  const bottomInset = num(p, 'bottomInset', d.bottomInset)
  const left = num(p, 'left', d.left)
  const right = num(p, 'right', d.right)
  const ticks = Math.max(1, Math.round(num(p, 'ticks', d.ticks)))
  const tickWidth = num(p, 'tickWidth', d.tickWidth)
  const tickHeight = num(p, 'tickHeight', d.tickHeight)
  const tickColor = str(p, 'tickColor', d.tickColor)
  const cursorWidth = num(p, 'cursorWidth', d.cursorWidth)
  const cursorHeight = num(p, 'cursorHeight', d.cursorHeight)
  const cursorColor = str(p, 'cursorColor', d.cursorColor)
  const travel = Math.max(1, Math.round(num(p, 'cursorTravelFrames', d.cursorTravelFrames) || range.durationInFrames))
  const y = 100 - bottomInset
  const span = right - left
  const tracks: FurnitureTrackDraft[] = []
  for (let i = 0; i < ticks; i += 1) {
    // 首尾都落在 left / right 上：ticks === 1 时退化为 left（不除零）。
    const ratio = ticks === 1 ? 0 : i / (ticks - 1)
    tracks.push({
      id: `fx-tick-${String(i).padStart(3, '0')}`,
      type: 'shape',
      shape: 'rect',
      color: tickColor,
      box: box(left + span * ratio, y, tickWidth, tickHeight),
      startFrame: range.startFrame,
      durationInFrames: range.durationInFrames,
      fadeFrames: 0,
    })
  }
  tracks.push({
    id: 'fx-progress-cursor',
    type: 'shape',
    shape: 'rect',
    color: cursorColor,
    box: box(left, y, cursorWidth, cursorHeight),
    startFrame: range.startFrame,
    durationInFrames: range.durationInFrames,
    fadeFrames: 0,
    // `linear` 是刻意的：进度条表达的是**时间**，任何缓动都会让游标位置与时间轴不符。
    animate: {
      from: { x: left },
      to: { x: right },
      startFrame: 0,
      durationInFrames: travel,
      easing: 'linear',
    },
  })
  return tracks
}

/** 32 位确定性 PRNG（mulberry32）：同 seed 逐位同序列，跨机器同结果。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** **星点背景**：N 个极小 `circle`，位置由固定种子 PRNG 决定（确定性）。 */
function starfield(spec: FurnitureSpec, ctx: FurnitureContext, range: { startFrame: number; durationInFrames: number }): FurnitureTrackDraft[] {
  void ctx
  const p = (spec.params ?? {}) as Record<string, unknown>
  const d = FURNITURE_DEFAULTS.starfield
  const count = Math.min(400, Math.max(0, Math.round(num(p, 'count', d.count))))
  const seed = Math.round(num(p, 'seed', d.seed))
  const maxRadius = num(p, 'maxRadius', d.maxRadius)
  const color = str(p, 'color', d.color)
  const rand = mulberry32(seed)
  const tracks: FurnitureTrackDraft[] = []
  for (let i = 0; i < count; i += 1) {
    // 先取位置再取半径：顺序固定是「同 seed 同结果」的一部分，改顺序 = 破坏兼容。
    const x = 2 + rand() * 96
    const y = 2 + rand() * 96
    const radius = maxRadius * (0.35 + rand() * 0.65)
    tracks.push({
      id: `fx-star-${String(i).padStart(3, '0')}`,
      type: 'shape',
      shape: 'circle',
      color,
      box: box(x, y, radius * 2, radius * 2),
      startFrame: range.startFrame,
      durationInFrames: range.durationInFrames,
      fadeFrames: 0,
    })
  }
  return tracks
}

/**
 * **3D 卡片墙（S3 容器化）**：1 个 `group` 容器 + 平面网格子卡。
 *
 * 为什么不再用 `projectCardWall()` 逐卡投影：容器化的整面墙共享一次 3D 投影
 * （统一灭点、1 个 WebGL 预合成层），子卡平面矩形即可 —— 角度/推近都写在容器上，
 * 校验层（S1-B 硬闸 ≤30°）在 `validateManifest` 里复核。确定性：网格位置是纯
 * 算术、配色与批次按下标取模，同参数逐字节同结果。
 */
function cardWall(spec: FurnitureSpec, _ctx: FurnitureContext, range: { startFrame: number; durationInFrames: number }): FurnitureTrackDraft[] {
  const p = (spec.params ?? {}) as Record<string, unknown>
  const d = FURNITURE_DEFAULTS.cardWall
  const cols = Math.max(1, Math.round(num(p, 'cols', d.cols)))
  const rows = Math.max(1, Math.round(num(p, 'rows', d.rows)))
  const cardW = num(p, 'cardW', d.cardW)
  const cardH = num(p, 'cardH', d.cardH)
  const gapX = num(p, 'gapX', d.gapX)
  const gapY = num(p, 'gapY', d.gapY)
  const originX = num(p, 'originX', d.originX)
  const originY = num(p, 'originY', d.originY)
  if (cardW <= 0 || cardH <= 0 || gapX < 0 || gapY < 0) {
    throw new FurnitureError('FURNITURE_BAD_PARAMS', `cardWall 的 cardW/cardH 必须 > 0、gap ≥ 0：${String(cardW)}/${String(cardH)}/${String(gapX)}/${String(gapY)}`)
  }
  const count = Math.max(1, Math.round(num(p, 'count', d.count)))
  if (count > cols * rows) {
    throw new FurnitureError('FURNITURE_BAD_PARAMS', `cardWall count ${String(count)} 超过网格容量 ${String(cols)}×${String(rows)}`)
  }
  const rotateX = num(p, 'rotateX', d.rotateX)
  const rotateY = num(p, 'rotateY', d.rotateY)
  const perspective = num(p, 'perspective', d.perspective)
  if (!(Number.isFinite(perspective) && perspective >= 200)) {
    throw new FurnitureError('FURNITURE_BAD_PARAMS', `cardWall perspective 必须 ≥ 200px：${String(perspective)}`)
  }
  const color = str(p, 'color', d.color)
  const accentColor = str(p, 'accentColor', d.accentColor)
  const lightColor = str(p, 'lightColor', d.lightColor)
  const fade = Math.max(0, Math.round(num(p, 'fadeFrames', d.fadeFrames)))
  const pushFrom = num(p, 'pushFrom', d.pushFrom)
  const pushTo = num(p, 'pushTo', d.pushTo)
  const batchStart = Math.max(0, Math.round(num(p, 'batchStart', d.batchStart)))
  const batchFrames = Math.max(1, Math.round(num(p, 'batchFrames', d.batchFrames)))
  const firstBatch = Math.max(1, Math.round(num(p, 'firstBatch', d.firstBatch)))
  const perBatch = Math.max(1, Math.round(num(p, 'perBatch', d.perBatch)))
  const stripeEvery = Math.max(0, Math.round(num(p, 'stripeEvery', d.stripeEvery)))
  const stripeColor = str(p, 'stripeColor', d.stripeColor)
  const glowFrames = Math.max(0, Math.round(num(p, 'glowFrames', d.glowFrames)))
  const glowColor = str(p, 'glowColor', d.glowColor)
  const glowDim = str(p, 'glowDim', d.glowDim)
  const glowW = num(p, 'glowW', d.glowW)
  const glowH = num(p, 'glowH', d.glowH)
  const exitFrames = Math.max(0, Math.round(num(p, 'exitFrames', d.exitFrames)))

  // 网格（画布百分比、可越出画布）：先中心对齐铺开，再按格位放卡。
  const pitchX = cardW + gapX
  const pitchY = cardH + gapY
  const x0 = originX - ((cols - 1) * pitchX) / 2
  const y0 = originY - ((rows - 1) * pitchY) / 2

  const children: FurnitureShapeDraft[] = []
  for (let index = 0; index < count; index += 1) {
    const col = index % cols
    const row = Math.floor(index / cols)
    // 条纹特征卡（数据卡观感）：强制主卡色 —— 条纹颜色按主卡色对比设计。
    // 取模落在第 4 张（0 起 3）—— stripeEvery ≤ 3 时恒不命中 = 关闭条纹。
    const isStripeCard = stripeEvery > 3 && index % stripeEvery === 3
    const isDark = !isStripeCard && (index % 9 === 2 || index % 9 === 6)
    const isLight = !isStripeCard && !isDark && index % 17 === 5
    const cardColor = isStripeCard ? color : isDark ? accentColor : isLight ? lightColor : color
    // 批次入场（组内相对帧）：首批 firstBatch 张，之后每批 perBatch 张（末批可能不满）。
    const batchIndex = index < firstBatch ? 0 : 1 + Math.floor((index - firstBatch) / perBatch)
    const start = Math.min(batchStart + batchIndex * batchFrames, Math.max(0, range.durationInFrames - 1))
    const cardX = x0 + col * pitchX
    const cardY = y0 + row * pitchY
    children.push({
      id: `fx-card-${String(index).padStart(3, '0')}`,
      type: 'shape',
      shape: 'rect',
      color: cardColor,
      box: { x: round4(cardX), y: round4(cardY), w: cardW, h: cardH },
      startFrame: start,
      durationInFrames: Math.max(1, range.durationInFrames - start),
      fadeFrames: fade,
    })
    // 卡内条纹：特征卡带 3 条横向条纹（画在卡盒内，颜色与主卡色对比）。
    if (isStripeCard) {
      for (let k = -1; k <= 1; k += 1) {
        children.push({
          id: `fx-stripe-${String(index).padStart(3, '0')}-${String(k + 1)}`,
          type: 'shape',
          shape: 'rect',
          color: stripeColor,
          box: { x: round4(cardX), y: round4(cardY + k * 3.2), w: round4(cardW * 0.62), h: 1.1 },
          startFrame: start,
          durationInFrames: Math.max(1, range.durationInFrames - start),
          fadeFrames: fade,
        })
      }
    }
  }

  // 批次辉光脉冲（S4）：每个批次时刻，墙面亮起一块蓝色辉光再缓暗（easeIn =
  // 先hold住亮、后段快速衰减）。参考片的运动尖峰来自这个节奏 —— 卡片 settle 成
  // 暗色后，5fps 采样下的帧差尖峰全靠辉光；亮起/衰减本身也是段内微动（U10）。
  // 位置按批次序号在一组固定偏移里循环取值（确定性，禁 Math.random）。
  if (glowFrames > 0) {
    const glowOffsets: ReadonlyArray<readonly [number, number]> = [
      [-7, -3], [5, 2], [-3, 5], [7, -2], [0, -5], [-5, 3], [3, -4], [-2, 4], [4, 3],
    ]
    const batchCount = 1 + Math.ceil(Math.max(0, count - firstBatch) / perBatch)
    for (let b = 0; b < batchCount; b += 1) {
      const start = Math.min(batchStart + b * batchFrames, Math.max(0, range.durationInFrames - 1))
      const off: readonly [number, number] = glowOffsets[b % glowOffsets.length] ?? [-7, -3]
      const dx = off[0]
      const dy = off[1]
      children.push({
        id: `fx-glow-${String(b).padStart(2, '0')}`,
        type: 'shape',
        shape: 'rect',
        color: glowDim,
        colorShift: { from: glowColor, to: glowDim, durationInFrames: glowFrames, easing: 'easeIn' },
        box: { x: round4(originX + dx), y: round4(originY + dy), w: glowW, h: glowH },
        startFrame: start,
        durationInFrames: Math.max(1, range.durationInFrames - start),
        fadeFrames: 0,
        exit: { to: { opacity: 0 }, durationInFrames: 2 },
      })
    }
  }

  // 容器：静态 3D 姿势 + 推近（scale 动画与静态 rotate 合并语义见 animateStateAt）。
  const group: FurnitureGroupDraft = {
    id: 'fx-card-wall',
    type: 'group',
    children,
    startFrame: range.startFrame,
    durationInFrames: range.durationInFrames,
    fadeFrames: 0,
    transform: { perspective, ...(rotateX !== 0 ? { rotateX } : {}), ...(rotateY !== 0 ? { rotateY } : {}) },
    // 推近：0→0 关闭；easing linear = 匀速推（参考片的连续帧差来源）。
    ...(pushFrom > 0 && pushTo > 0
      ? {
          animate: [
            { from: { scale: pushFrom }, to: { scale: pushTo }, durationInFrames: range.durationInFrames, easing: 'linear' },
          ],
        }
      : {}),
    // ML-02：墙在段边界硬退（1 帧渐隐 ≈ 硬切，段边界本来就是切点）。
    ...(exitFrames > 0 ? { exit: { to: { opacity: 0 }, durationInFrames: exitFrames } } : {}),
  }
  return [group]
}

/**
 * 把一个构件声明展开成普通 manifest 轨道（纯函数、零 IO、确定性）。
 *
 * @throws {FurnitureError} 未知 id / ctx 不合法 / 帧区间非法 —— **抛错不静默**：
 *   静默返回空数组会让模板「声明了构件、成片里没有」而无人发现。
 */
export function expandFurniture(spec: FurnitureSpec, ctx: FurnitureContext): FurnitureTrackDraft[] {
  assertContext(ctx)
  const id = spec?.id as FurnitureId | undefined
  if (id === undefined || !FURNITURE_IDS.includes(id)) {
    throw new FurnitureError(
      'FURNITURE_UNKNOWN_ID',
      `没有这个构件：${String(id)}。可选：${FURNITURE_IDS.join(' / ')}`,
    )
  }
  const range = resolveRange(spec, ctx)
  switch (id) {
    case 'cornerBrackets':
      return cornerBrackets(spec, ctx, range)
    case 'progressBar':
      return progressBar(spec, range)
    case 'starfield':
      return starfield(spec, ctx, range)
    case 'cardWall':
      return cardWall(spec, ctx, range)
    default:
      // 类型收口：新增 id 忘了接分支会在这里编译期红（default 分支只为穷尽性可读）。
      throw new FurnitureError('FURNITURE_UNKNOWN_ID', `构件 ${String(id)} 没有实现`)
  }
}

/**
 * 批量展开（模板编译器用）。
 *
 * 轨 id 冲突直接抛错 —— 两条构件撞 id 会让后渲染的那条覆盖前者（静默丢失），
 * 而模板作者完全看不出来。
 */
export function expandFurnitureList(specs: readonly FurnitureSpec[], ctx: FurnitureContext): FurnitureTrackDraft[] {
  const out: FurnitureTrackDraft[] = []
  const seen = new Set<string>()
  for (const spec of specs) {
    for (const track of expandFurniture(spec, ctx)) {
      if (seen.has(track.id)) {
        throw new FurnitureError('FURNITURE_ID_CONFLICT', `构件轨 id 冲突：${track.id}（同一份模板里不要声明两次同 id 构件）`)
      }
      seen.add(track.id)
      out.push(track)
    }
  }
  return out
}
