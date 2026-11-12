/**
 * RQ-22（REQ-038）· **聚合型原语**的契约 —— 把 N 个同构元素压成 1 条轨。
 *
 * 为什么单独一个文件：`manifest.ts` 在 file-size-guard 的行数棘轮上，5 个新轨道类型
 * 的字段与注释体量 ≈ 200 行。沿 `manifest-transform.ts` 外提先例：本模块零依赖
 *（校验辅助本地实现，与 `manifest.ts` 内部同名判定同口径），`manifest.ts` 反向
 * re-export 类型并接线 `CompositionTrack` union / `TRACK_TYPES` / `KNOWN_TRACK_KEYS` /
 * `validateManifest` 的五个 case。单向无环。
 *
 * ## 五种原语与承担（需求正本 §3 RQ-22 表）
 *
 * | 原语 | 承担 | playsout 对应 |
 * | --- | --- | --- |
 * | `logoWall` | 合作方 logo 墙 | 21 partner logo（手搓 21 条 image 轨 → 1 条） |
 * | `assetGrid` | 截图墙 / 海报墙 / 目录墙 | 16 张 `textures-live-*`（16 条 → 1 条） |
 * | `chipRow` | 芯片条 / 标签行 | hero 底部芯片条（若干 shape+textCard → 1 条） |
 * | `codePanel` | 代码面板 | Sdk 镜头的代码窗（底板+文字多轨 → 1 条） |
 * | `ticker` | 无限滚动墙 / 跑马灯 | Audience 镜头的滚动人群墙 |
 *
 * ## 单位与布局口径
 *
 * - 所有 px 参数 = **1080 高设计 px**，渲染时经 `type-scale.ts` 的 `scaleDesignPx`
 *   按画布高缩放（与 title/bullets 同一套「按设计画布设计」的既有口径）。
 * - `box` 沿用 BaseTrack 中心语义（0–100）；网格在盒内**居中**排布
 *   （`aggregate-layout.ts` 纯函数，可单测）。
 * - 单元入场 = 每单元 `fadeFrames`（缺省 6）线性淡入 + easeOut 上移 14px，
 *   按 `stagger` 帧错峰；纯帧函数（`unitEnterAt`），零随机源。
 */
import type { BaseTrack } from './manifest.js'

/** 与 `manifest.ts` 内部同名判定同口径（校验辅助，本模块不 import 运行时代码）。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 单元内图片适配：logo 墙缺省 contain（不裁标），截图墙缺省 cover（填满裁切）。 */
export type AggregateFit = 'contain' | 'cover'

/** RQ-22 · `logoWall` —— 合作方 logo 墙（灰阶 + 错峰入场）。 */
export interface LogoWallTrack extends BaseTrack {
  type: 'logoWall'
  /** logo 图片 URL（同源资产，逐个 `validateAssetRefField`）。 */
  logos: string[]
  /** 列数（1–20；缺省按 √n 取方阵列数）。行数 = ceil(n / columns)。 */
  columns?: number
  /** 单元格宽 / 高（设计 px；logo 墙建议同值方格）。 */
  cellW?: number
  cellH?: number
  /** 单元间距（设计 px，缺省 24）。 */
  gapX?: number
  gapY?: number
  /** 单元圆角（设计 px，缺省 12；0 = 直角）。 */
  radius?: number
  /** 灰度显示（true = 21 张灰阶 logo 不再依赖预生成 PNG）。缺省 false。 */
  grayscale?: boolean
  /** 单元内适配，缺省 `contain`（logo 不裁切）。 */
  fit?: AggregateFit
  /** 入场错峰（帧/单元，缺省 2；0 = 同步入场）。⚠️ 刻意不叫 `stagger`/`fadeFrames` —— 那两个名字在 `BaseTrack` 已占用（整轨级），单元级加 `unit` 前缀防模型混写。 */
  unitStagger?: number
  /** 单元淡入时长（帧，缺省 6）。语义见 `unitStagger` 的改名注。 */
  unitFadeFrames?: number
  /** 单元底色（缺省透明；logo 卡片感可给 rgba 白/黑）。 */
  cellBackground?: string
}

/** RQ-22 · `assetGrid` —— 截图墙 / 海报墙 / 目录墙。 */
export interface AssetGridTrack extends BaseTrack {
  type: 'assetGrid'
  /** 图片 URL（同源资产）。 */
  assets: string[]
  /** 列数（1–20；缺省按 √n 取方阵列数）。 */
  columns?: number
  cellW?: number
  cellH?: number
  gapX?: number
  gapY?: number
  /** 单元圆角（设计 px，缺省 8）。 */
  radius?: number
  /** 单元内适配，缺省 `cover`（截图墙填满裁切）。 */
  fit?: AggregateFit
  unitStagger?: number
  unitFadeFrames?: number
  cellBackground?: string
}

/** RQ-22 · `chipRow` —— 芯片条 / 标签行（文本药丸）。 */
export interface ChipRowTrack extends BaseTrack {
  type: 'chipRow'
  /** 芯片文本（逐条非空）。 */
  chips: string[]
  /** 排列方向，缺省 `row`。 */
  direction?: 'row' | 'column'
  /** 芯片间距（设计 px，缺省 12）。 */
  gap?: number
  /** 药丸圆角（设计 px，缺省 999 = 全圆药丸；0 = 直角标签）。 */
  radius?: number
  /** 芯片字号（设计 px，缺省 22）。 */
  fontPx?: number
  /** 文本色（缺省 `#ECECF2`）。 */
  color?: string
  /** 药丸底色（缺省 `rgba(255,255,255,0.08)`；`'transparent'` = 纯文本条）。 */
  background?: string
  /** 药丸描边色（缺省不描）。 */
  border?: string
  /** 水平内边距（设计 px，缺省 16）。 */
  padX?: number
  /** 垂直内边距（设计 px，缺省 8）。 */
  padY?: number
  unitStagger?: number
  unitFadeFrames?: number
}

/** RQ-22 · `codePanel` —— 代码面板（底板 + 窗栏 + 等宽代码 + 可选滚动）。 */
export interface CodePanelTrack extends BaseTrack {
  type: 'codePanel'
  /** 代码文本（`\n` 分行；不折行，超宽被面板裁切）。 */
  code: string
  /** 窗栏标题（如 `sdk.ts`；缺省无窗栏，只有面板）。 */
  title?: string
  /** 代码字号（设计 px，缺省 18）。 */
  fontPx?: number
  /** 行高倍数（缺省 1.5）。 */
  lineHeight?: number
  /** 面板底色（缺省 `#0D1117`）。 */
  background?: string
  /** 面板圆角（设计 px，缺省 16）。 */
  radius?: number
  /** 代码文本色（缺省 `#D4D4D8`）。 */
  color?: string
  /** 窗栏三点的强调色（缺省 `#98A3FF`）。 */
  accentColor?: string
  /** 面板内边距（设计 px，缺省 24）。 */
  padding?: number
  /** 向上滚动速度（设计 px/帧，缺省 0 = 静态；内容超面板高时用它滚出）。 */
  scrollSpeed?: number
}

/** RQ-22 · `ticker` —— 无限滚动墙 / 跑马灯（文本循环平移）。 */
export interface TickerTrack extends BaseTrack {
  type: 'ticker'
  /** 循环条目（逐条非空；用 `separator` 连接成一轮）。 */
  items: string[]
  /** 方向，缺省 `left`（向左滚）。 */
  direction?: 'left' | 'right'
  /** 平移速度（设计 px/帧，缺省 2）。 */
  speed?: number
  /** 条目间距（设计 px，缺省 48）。 */
  gap?: number
  /** 字号（设计 px，缺省 28）。 */
  fontPx?: number
  /** 文本色（缺省 `#6E6E86`）。 */
  color?: string
  /** 分隔符（缺省 ` · `；空串 = 无分隔直接拼）。 */
  separator?: string
  /** 两端淡出宽（设计 px，缺省 120；0 = 不淡出）。 */
  fadeWidth?: number
}

/** 聚合轨 union（`CompositionTrack` 接线用）。 */
export type AggregateTrack = LogoWallTrack | AssetGridTrack | ChipRowTrack | CodePanelTrack | TickerTrack

/** 聚合轨型的 KNOWN_TRACK_KEYS 键集（`manifest.ts` 接线用；实现真实读取）。 */
export const AGGREGATE_KNOWN_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  logoWall: new Set(['logos', 'columns', 'cellW', 'cellH', 'gapX', 'gapY', 'radius', 'grayscale', 'fit', 'unitStagger', 'unitFadeFrames', 'cellBackground']),
  assetGrid: new Set(['assets', 'columns', 'cellW', 'cellH', 'gapX', 'gapY', 'radius', 'fit', 'unitStagger', 'unitFadeFrames', 'cellBackground']),
  chipRow: new Set(['chips', 'direction', 'gap', 'radius', 'fontPx', 'color', 'background', 'border', 'padX', 'padY', 'unitStagger', 'unitFadeFrames']),
  codePanel: new Set(['code', 'title', 'fontPx', 'lineHeight', 'background', 'radius', 'color', 'accentColor', 'padding', 'scrollSpeed']),
  ticker: new Set(['items', 'direction', 'speed', 'gap', 'fontPx', 'color', 'separator', 'fadeWidth']),
}

/** 聚合轨型名集合（`TRACK_TYPES` 扩容用）。 */
export const AGGREGATE_TYPES: ReadonlySet<string> = new Set(['logoWall', 'assetGrid', 'chipRow', 'codePanel', 'ticker'])

/** 数组字段校验：每项非空字符串、条数 1–200。 */
function validateStringList(
  value: unknown,
  at: string,
  field: string,
  max: number,
  errors: string[],
): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${at}.${field} 必须是非空数组（聚合原语的核心就是元素列表）`)
    return false
  }
  if (value.length > max) {
    errors.push(`${at}.${field} 最多 ${max} 项（当前 ${value.length}；更多请拆多条轨）`)
    return false
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) errors.push(`${at}.${field}[${index}] 必须是非空字符串`)
  })
  return true
}

function validateNumber(
  value: unknown,
  at: string,
  field: string,
  min: number,
  max: number,
  errors: string[],
  integer = false,
): void {
  if (value === undefined) return
  const ok = isFiniteNumber(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
  if (!ok) {
    const range = integer ? `[${min}, ${max}] 的整数` : `[${min}, ${max}] 的有限数`
    errors.push(`${at}.${field} 必须是 ${range}`)
  }
}

/**
 * 聚合轨统一校验（`validateManifest` 的五个 case 共用；只报本族字段，
 * 通用字段 box/animate/fx 由 manifest.ts 的通用段照常处理）。
 */
export function validateAggregateTrack(
  track: Record<string, unknown>,
  at: string,
  errors: string[],
  warnings: string[],
): void {
  const type = track.type
  if (type === 'logoWall') {
    const logosOk = validateStringList(track.logos, at, 'logos', 200, errors)
    if (logosOk && Array.isArray(track.logos)) {
      (track.logos as unknown[]).forEach((logo: unknown, index: number) => {
        if (isNonEmptyString(logo) && !logo.startsWith('/')) {
          warnings.push(`${at}.logos[${index}] 应为同源资产 URL（/canvas-studio/assets/… 开头或 / 开头）`)
        }
      })
    }
    validateNumber(track.columns, at, 'columns', 1, 20, errors, true)
    validateNumber(track.cellW, at, 'cellW', 8, 2000, errors)
    validateNumber(track.cellH, at, 'cellH', 8, 2000, errors)
    validateNumber(track.gapX, at, 'gapX', 0, 500, errors)
    validateNumber(track.gapY, at, 'gapY', 0, 500, errors)
    validateNumber(track.radius, at, 'radius', 0, 500, errors)
    validateNumber(track.unitStagger, at, 'unitStagger', 0, 60, errors, true)
    validateNumber(track.unitFadeFrames, at, 'unitFadeFrames', 0, 90, errors, true)
    if (track.grayscale !== undefined && typeof track.grayscale !== 'boolean') {
      errors.push(`${at}.grayscale 必须是布尔值`)
    }
    if (track.fit !== undefined && track.fit !== 'contain' && track.fit !== 'cover') {
      errors.push(`${at}.fit 非法（${String(track.fit)}）—— 白名单：contain / cover`)
    }
  } else if (type === 'assetGrid') {
    validateStringList(track.assets, at, 'assets', 200, errors)
    validateNumber(track.columns, at, 'columns', 1, 20, errors, true)
    validateNumber(track.cellW, at, 'cellW', 8, 2000, errors)
    validateNumber(track.cellH, at, 'cellH', 8, 2000, errors)
    validateNumber(track.gapX, at, 'gapX', 0, 500, errors)
    validateNumber(track.gapY, at, 'gapY', 0, 500, errors)
    validateNumber(track.radius, at, 'radius', 0, 500, errors)
    validateNumber(track.unitStagger, at, 'unitStagger', 0, 60, errors, true)
    validateNumber(track.unitFadeFrames, at, 'unitFadeFrames', 0, 90, errors, true)
    if (track.fit !== undefined && track.fit !== 'contain' && track.fit !== 'cover') {
      errors.push(`${at}.fit 非法（${String(track.fit)}）—— 白名单：contain / cover`)
    }
  } else if (type === 'chipRow') {
    validateStringList(track.chips, at, 'chips', 64, errors)
    validateNumber(track.gap, at, 'gap', 0, 200, errors)
    validateNumber(track.radius, at, 'radius', 0, 999, errors)
    validateNumber(track.fontPx, at, 'fontPx', 8, 200, errors)
    validateNumber(track.padX, at, 'padX', 0, 200, errors)
    validateNumber(track.padY, at, 'padY', 0, 200, errors)
    validateNumber(track.unitStagger, at, 'unitStagger', 0, 60, errors, true)
    validateNumber(track.unitFadeFrames, at, 'unitFadeFrames', 0, 90, errors, true)
    for (const field of ['color', 'background', 'border'] as const) {
      if (track[field] !== undefined && !isNonEmptyString(track[field])) {
        errors.push(`${at}.${field} 必须是非空字符串`)
      }
    }
    if (track.direction !== undefined && track.direction !== 'row' && track.direction !== 'column') {
      errors.push(`${at}.direction 非法（${String(track.direction)}）—— 白名单：row / column`)
    }
  } else if (type === 'codePanel') {
    if (!isNonEmptyString(track.code)) {
      errors.push(`${at}.code 必须是非空字符串（\\n 分行）`)
    }
    validateNumber(track.fontPx, at, 'fontPx', 8, 100, errors)
    validateNumber(track.lineHeight, at, 'lineHeight', 0.8, 4, errors)
    validateNumber(track.radius, at, 'radius', 0, 200, errors)
    validateNumber(track.padding, at, 'padding', 0, 200, errors)
    validateNumber(track.scrollSpeed, at, 'scrollSpeed', 0, 30, errors)
    for (const field of ['title', 'background', 'color', 'accentColor'] as const) {
      if (track[field] !== undefined && !isNonEmptyString(track[field])) {
        errors.push(`${at}.${field} 必须是非空字符串`)
      }
    }
  } else if (type === 'ticker') {
    validateStringList(track.items, at, 'items', 64, errors)
    validateNumber(track.speed, at, 'speed', 0, 30, errors)
    validateNumber(track.gap, at, 'gap', 0, 500, errors)
    validateNumber(track.fontPx, at, 'fontPx', 8, 200, errors)
    validateNumber(track.fadeWidth, at, 'fadeWidth', 0, 1000, errors)
    for (const field of ['color', 'separator'] as const) {
      if (track[field] !== undefined && !isNonEmptyString(track[field])) {
        errors.push(`${at}.${field} 必须是非空字符串`)
      }
    }
    if (track.direction !== undefined && track.direction !== 'left' && track.direction !== 'right') {
      errors.push(`${at}.direction 非法（${String(track.direction)}）—— 白名单：left / right`)
    }
  }
}
