/**
 * RQ-22（REQ-038）· 聚合原语的**布局与入场纯函数**（零 React、零 Remotion，可单测）。
 *
 * 为什么单独一层：聚合原语的验收判据是「与手搓版关键帧像素对拍 ≥40dB」（RQ-22 验收 1/2）
 * —— 布局必须**确定性**且**可独立断言**（N 个单元的落点逐个可算），不能埋在组件里
 * 靠眼睛看。`logoWall` / `assetGrid` 共用居中网格；`chipRow` 用流式排布；
 * 入场错峰是纯帧函数（禁随机源，逐帧可复现是 REQ-038 §8 纪律）。
 *
 * 坐标口径：**容器内左上角系**（px）。容器 = 轨 `box` 折算出的像素矩形；
 * 单元坐标是 `left/top`（不是中心）—— 与 CSS absolute 定位直觉一致，组件直贴。
 */

/** 居中网格的单单元落点（容器内左上角系，px）。 */
export interface GridCell {
  /** 单元左上角 x（px）。 */
  x: number
  /** 单元左上角 y（px）。 */
  y: number
}

export interface GridLayoutOptions {
  /** 元素个数。 */
  count: number
  /** 列数；缺省按 √n 取整（方阵倾向，至少 1）。 */
  columns?: number | undefined
  /** 单元尺寸（px）。 */
  cellW: number
  cellH: number
  /** 间距（px，缺省 24）。 */
  gapX?: number | undefined
  gapY?: number | undefined
  /** 容器尺寸（px，= box 百分比 × 画布尺寸）。 */
  containerW: number
  containerH: number
}

/** 行列数（网格布局中间量，测试可断言）。 */
export function gridShape(count: number, columns?: number | undefined): { cols: number; rows: number } {
  const n = Math.max(0, Math.floor(count))
  const cols = Math.max(1, Math.floor(columns ?? Math.max(1, Math.round(Math.sqrt(n)))))
  const rows = Math.max(1, Math.ceil(n / cols))
  return { cols, rows }
}

/**
 * 居中网格布局：`gridW = cols×cellW + (cols−1)×gapX`，起点 = `(containerW − gridW)/2`。
 * 最后一行不满时**左对齐**（与手搓 playsout 的 logo 墙行为一致 —— 残行靠左）。
 * count=0 返回空数组；容器/单元非法（≤0）返回空数组（组件拿到空就画空，不抛）。
 */
export function gridLayout(options: GridLayoutOptions): GridCell[] {
  const { count, cellW, cellH, containerW, containerH } = options
  if (count <= 0 || cellW <= 0 || cellH <= 0 || containerW <= 0 || containerH <= 0) return []
  const gapX = options.gapX ?? 24
  const gapY = options.gapY ?? gapX
  const { cols, rows } = gridShape(count, options.columns)
  const gridW = cols * cellW + (cols - 1) * gapX
  const gridH = rows * cellH + (rows - 1) * gapY
  const startX = Math.max(0, (containerW - gridW) / 2)
  const startY = Math.max(0, (containerH - gridH) / 2)
  const cells: GridCell[] = []
  for (let index = 0; index < count; index += 1) {
    const col = index % cols
    const row = Math.floor(index / cols)
    cells.push({ x: startX + col * (cellW + gapX), y: startY + row * (cellH + gapY) })
  }
  return cells
}

/**
 * 芯片行（流式）布局：主轴逐个累加 `size + gap`，整体居中。
 * `sizes` = 每个芯片的主轴尺寸（px，组件按文本实测/估算）；
 * 返回每芯片的**主轴起点**（px，相对容器主轴原点）。
 * 返回 null = 总宽超出容器（调用方可换 direction 或缩字号 —— 不静默挤压）。
 */
export function flowLayout(sizes: readonly number[], gap: number, containerSize: number): number[] | null {
  const total = sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, sizes.length - 1) * gap
  if (containerSize <= 0 || total > containerSize) return null
  const start = (containerSize - total) / 2
  const offsets: number[] = []
  let cursor = start
  for (const size of sizes) {
    offsets.push(cursor)
    cursor += size + gap
  }
  return offsets
}

/** 单元入场的缓出位移（easeOutCubic）：`t ∈ [0,1]` → 剩余位移比例。 */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - x, 3)
}

export interface UnitEnterState {
  /** 单元不透明度（0–1；入场完成后恒 1）。 */
  opacity: number
  /** 单元上移剩余量（px，入场完成后恒 0；从 +14 落下）。 */
  offsetY: number
}

export const UNIT_ENTER_OFFSET_PX = 14

/**
 * 单元入场状态（纯帧函数）：`localFrame − index × stagger` 为该单元的本地帧，
 * 前 `fadeFrames`（缺省 6）线性淡入、位移按 easeOutCubic 落定。
 * 负本地帧（还没轮到）= 完全不可见。`fadeFrames=0` = 直接出现（硬切）。
 */
export function unitEnterAt(
  localFrame: number,
  index: number,
  options: { stagger?: number | undefined; fadeFrames?: number | undefined } = {},
): UnitEnterState {
  const stagger = options.stagger ?? 2
  const fadeFrames = options.fadeFrames ?? 6
  const local = localFrame - index * Math.max(0, stagger)
  if (fadeFrames <= 0 || local >= fadeFrames) return { opacity: 1, offsetY: 0 }
  if (local <= 0) return { opacity: 0, offsetY: UNIT_ENTER_OFFSET_PX }
  const t = local / fadeFrames
  return { opacity: t, offsetY: UNIT_ENTER_OFFSET_PX * (1 - easeOutCubic(t)) }
}

/**
 * 跑马灯文本宽度估算（px）：CJK/全角按 1.0 em、其余按 0.62 em —— 与
 * `timing.ts` 的 `charWidthRatio` 同思想但**不 import**（零依赖边界）。
 * 只用于 ticker 的循环平移（匀速滚动，宽度误差只影响循环接缝，不影响确定性）。
 */
export function estimateTextWidthPx(text: string, fontPx: number): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const cjk = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60) || (code >= 0x3000 && code <= 0x303f)
    width += (cjk ? 1 : 0.62) * fontPx
  }
  return width
}
