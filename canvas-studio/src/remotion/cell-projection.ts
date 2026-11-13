/**
 * REQ-038 R7（RQ-25）· **格位投影**（纯函数，零依赖）。
 *
 * ## 解决什么
 *
 * 56 张卡的生成器内部全部按 `100% × 100%` 全屏坐标系写死 `box`（如
 * `{ x: 50, y: 50, w: 100, h: 100 }`）。要让「一屏并置 3 个单元」成立，有两条路：
 *
 * ① 改 56 张卡 —— 每张都接 `ctx.cell` 自己算位置。改动面 56 处，且每张都要重跑像素对拍；
 * ② **外层仿射重投影** —— 卡照旧吐全屏坐标，本模块把它们映射进格位。改动面 1 处。
 *
 * 选 ②（R7 §5 非目标 2）。
 *
 * ## 字号为什么不在这里管（2026-11-13 实测修正）
 *
 * 原设计打算让 `cell.fontScale` 乘字号，落地时撞到事实：**`textCard` 的白名单里没有
 * `fontSize`**（`manifest.ts:1202` 的字段集不含它），字号由 `planTextFit` 按
 * 「变体基准字号（title 84 / bullets 48 / timecode 36）+ box 宽度」实时推算，
 * 下限 `base × 0.55`。所以：
 *
 * - 投影把 box 缩窄 ⇒ `maxWidthPx` 变小 ⇒ `planTextFit` **自动降号**，不需要外挂缩放；
 * - 硬塞一个 `fontSize` 字段不会缩字，只会被 `validateManifest` 判成未知字段而**拒收**。
 *
 * 结论：格位只负责几何；字号是 textCard 渲染期的产物。残余风险（窄格位把字压到 46px
 * 下限仍可能溢出）记在 R7 §6，用格位宽度约束兜，不在这里加隐形补偿。
 *
 * ## 口径
 *
 * `CellRect` 与 manifest 的 `box` **同为百分比 + 中心点**（`{x:50,y:50}` = 居中），
 * 所以投影公式是「先平移到格位中心、再按格位宽高比缩放」。
 */

/** 格位（百分比、中心点，与 `TrackBox` 同口径）。 */
export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/** 任一元素框（百分比、中心点）。 */
export interface PercentBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 把一个全屏坐标系的 box 投影进格位。
 *
 * `x' = cell.x + (x − 50) · cell.w / 100`（`y`/`w`/`h` 同理）——
 * 卡内部相对布局（谁在左上、间距多大）全部按比例保留。
 */
export function projectBoxToCell(box: PercentBox, cell: CellRect): PercentBox {
  const round = (value: number): number => Math.round(value * 1000) / 1000
  return {
    x: round(cell.x + ((box.x - 50) * cell.w) / 100),
    y: round(cell.y + ((box.y - 50) * cell.h) / 100),
    w: round((box.w * cell.w) / 100),
    h: round((box.h * cell.h) / 100),
  }
}

/**
 * 格位的**可用性下限**（供 spec 校验与 doc 用，不参与渲染）。
 *
 * textCard 缩号下限是 `base × 0.55`：title 84 → 46px。一个 46px 的字在 1080 高画布上
 * 大约需要 12% 画布宽；格位比这更窄时字必然溢出。这里给一条保守提示线。
 */
export const CELL_MIN_WIDTH_PERCENT = 12
