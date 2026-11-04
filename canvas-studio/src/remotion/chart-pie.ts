/**
 * 阶段 4.1（2026-11-04）：chart 扩型 **pie / donut / gauge** 的纯几何与校验
 * （零 Remotion 依赖、零 DOM —— `node --test` 直连，组件只消费字符串与数字）。
 *
 * ## 非等比护栏（路线 4.1 点名）
 *
 * 扇形 / 圆环的圆度不能靠 `preserveAspectRatio="none"` 的拉伸 viewBox（会把圆拉成
 * 椭圆，CSR mask/path 非等比陷阱）。本模块输出的所有路径都定义在 **0–100 正方形
 * viewBox** 里，组件侧 SVG 用**缺省等比 meet** 缩放并正方形容器承载 —— 圆永远是圆。
 *
 * ## 扇形数学（纯帧、确定性）
 *
 * - 份额 = v / sum(values)；起始角固定 12 点钟（−90°）顺时针；
 * - `wedgePath` = 实心扇（pie）；`donutSlicePath` = 外弧 + 内弧回扫（donut）；
 * - gauge 不走扇形：整圆 stroke-dasharray 扫描（`gaugeDashArray`），中心数字复用
 *   `count-up.ts` 的 `countUpTextAt`（45 帧缓出，与 dataCard 同语言）。
 */

/** 扇形缺省调色板（8 色，低饱和、与 themes.ts 强调色系同族；color 字段覆盖第 0 片）。 */
export const PIE_PALETTE: readonly string[] = [
  '#4f9cf9', '#ffb454', '#35c2a6', '#f472b6', '#a3e635', '#9c6cff', '#f87171', '#7dd3fc',
]

/** donut 内孔半径比例（占外半径；固定常量不进契约，避免契约面膨胀）。 */
export const DONUT_INNER_RATIO = 0.55

/** 圆心 / 半径（0–100 viewBox：圆心 50,50，最大半径 46 留标签余量）。 */
const CX = 50
const CY = 50
const R = 46

/** 份额数组：v / sum（sum ≤ 0 时全 0 —— 调用前校验已保证至少一个 > 0）。 */
export function sliceFractions(values: readonly number[]): number[] {
  const sum = values.reduce((acc, v) => acc + Math.max(0, v), 0)
  if (sum <= 0) return values.map(() => 0)
  return values.map((v) => Math.max(0, v) / sum)
}

/** 极角 → viewBox 坐标（startAngle 从 12 点钟顺时针，弧度制内部换算）。 */
function polar(angleFrac: number, radius: number): { x: number; y: number } {
  const rad = (angleFrac * 2 * Math.PI) - Math.PI / 2
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) }
}

const fmt = (n: number): string => n.toFixed(3)

/**
 * 实心扇路径（pie）：M 圆心 → L 弧起点 → A 弧 → Z。
 * `startFrac` 为该片起点占整圆比例；frac > 0.999 时退化整圆（两段半圆弧拼接）。
 */
export function wedgePath(frac: number, startFrac: number, radius: number = R): string {
  if (frac <= 0) return ''
  if (frac >= 0.999) {
    const a = polar(0, radius)
    const mid = polar(0.5, radius)
    return `M ${fmt(CX)} ${fmt(CY)} L ${fmt(a.x)} ${fmt(a.y)} A ${radius} ${radius} 0 0 1 ${fmt(mid.x)} ${fmt(mid.y)} A ${radius} ${radius} 0 0 1 ${fmt(a.x)} ${fmt(a.y)} Z`
  }
  const a0 = polar(startFrac, radius)
  const a1 = polar(startFrac + frac, radius)
  const largeArc = frac > 0.5 ? 1 : 0
  return `M ${fmt(CX)} ${fmt(CY)} L ${fmt(a0.x)} ${fmt(a0.y)} A ${radius} ${radius} 0 ${largeArc} 1 ${fmt(a1.x)} ${fmt(a1.y)} Z`
}

/**
 * 圆环片路径（donut）：外弧顺时针 + L 内弧起点 + 内弧逆时针回扫 + Z。
 * frac ≥ 0.999 时退化为完整圆环（两个整圆环拼不出单 path，改用双 180° 弧）。
 */
export function donutSlicePath(frac: number, startFrac: number, radius: number = R, innerRatio: number = DONUT_INNER_RATIO): string {
  if (frac <= 0) return ''
  const rIn = radius * innerRatio
  const half = Math.min(frac, 0.999) / 2
  const o0 = polar(startFrac, radius)
  const o1 = polar(startFrac + half, radius)
  const o2 = polar(startFrac + half * 2, radius)
  const i2 = polar(startFrac + half * 2, rIn)
  const i1 = polar(startFrac + half, rIn)
  const i0 = polar(startFrac, rIn)
  const large = half > 0.25 ? 1 : 0
  return [
    `M ${fmt(o0.x)} ${fmt(o0.y)}`,
    `A ${radius} ${radius} 0 ${large} 1 ${fmt(o1.x)} ${fmt(o1.y)}`,
    `A ${radius} ${radius} 0 ${large} 1 ${fmt(o2.x)} ${fmt(o2.y)}`,
    `L ${fmt(i2.x)} ${fmt(i2.y)}`,
    `A ${fmt(rIn)} ${fmt(rIn)} 0 ${large} 0 ${fmt(i1.x)} ${fmt(i1.y)}`,
    `A ${fmt(rIn)} ${fmt(rIn)} 0 ${large} 0 ${fmt(i0.x)} ${fmt(i0.y)}`,
    'Z',
  ].join(' ')
}

/** 圆周长（gauge 扫描的 dasharray 基准，与组件侧 r 必须同值）。 */
export const GAUGE_CIRCUMFERENCE = 2 * Math.PI * R

/**
 * gauge 扫描的 stroke-dasharray（进度 frac 0–1）。
 * `dash >= C` 时收整圆（dasharray 全 C 防端点毛刺）。
 */
export function gaugeDashArray(frac: number): string {
  const clamped = Math.min(1, Math.max(0, frac))
  const dash = clamped >= 1 ? GAUGE_CIRCUMFERENCE : GAUGE_CIRCUMFERENCE * clamped
  return `${dash.toFixed(3)} ${GAUGE_CIRCUMFERENCE.toFixed(3)}`
}

/**
 * pie / donut / gauge 专属校验（通用 labels / values 规则由 validateChartTrack 承担，
 * 本函数只查三变体新增语义）。`errors` 追加后由调用方统一汇总。
 */
export function validatePieFamilyTrack(
  track: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  const variant = track.variant
  const values = track.values
  if (variant === 'gauge') {
    if (!Array.isArray(values) || values.length !== 1) {
      errors.push(`${at}.values 在 variant:'gauge' 下必须恰好 1 个数（进度值）；多序列比较请用 pie`)
    } else {
      const max = track.gaugeMax
      if (max !== undefined && (!typeofNumber(max) || (max as number) <= 0)) {
        errors.push(`${at}.gaugeMax 必须是正数（进度分母，缺省 100）`)
      } else if (typeofNumber(max) && typeofNumber(values[0]) && (values[0] as number) > (max as number)) {
        errors.push(`${at}.values[0]（${String(values[0])}）超过 gaugeMax（${String(max)}）—— 进度值不得大于分母`)
      }
    }
  }
  if (track.palette !== undefined) {
    const palette = track.palette
    const ok = Array.isArray(palette) && palette.length > 0
      && (palette as unknown[]).every((c) => isNonEmpty(c))
    if (!ok) {
      errors.push(`${at}.palette 必须是非空字符串数组（扇形配色，逐片取用）`)
    }
  }
}

const typeofNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0
