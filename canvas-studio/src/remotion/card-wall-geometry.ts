/**
 * `cardWall` 构件的**投影几何纯函数**（新模板批 · 第 2 步）。
 *
 * ## 为什么要单独一个文件
 *
 * 能力基准 #13 要用同一套投影公式去真渲验证，`furniture.ts` 落地时也要用它 ——
 * 公式两份必漂移（#11 的教训：`spriteRegionStyle` 直接 import 产品纯函数，
 * 「公式零拷贝，漂移即本条失真」）。本模块**零依赖、零 IO、零 Remotion**，
 * 探针与产品侧共用唯一一份实现。
 *
 * ## 模型：平面墙 + 每卡自带透视
 *
 * 渲染器不认识「构件」，展开产物是一条条独立的 `shape` 轨 ⇒ **没有容器层**可挂
 * `perspective`（D-38 边界 1：父层 CSS `perspective` 属性会被整个丢掉）。所以每张卡
 * 必须自己写 `perspective()`，代价是每张卡各自进一次 WebGL 预合成，且灭点落在
 * **各卡自身中心** ⇒ 得到对称梯形而非统一灭点。装饰层、卡片小、角度温和，#13 实测
 * 观感可接受；用 `pivot` 追统一灭点会与手工投影落点重复计算，不做。
 *
 * ## 完整变换串（与产品渲染路径逐字符一致）
 *
 * `shape-geometry.ts:133-135` 的 `boxStyle` 把 `extraTransform` 拼在
 * `translate(-50%, -50%)` 之后，`animated-style.ts:170` 的 `shapeTransform` 把
 * `perspective()/translateZ()/scale()/rotate()/rotateY()` 拼在前面 ⇒
 *
 * ```
 * translate(-50%, -50%) perspective(Ppx) [translateZ(zpx) ]scale(s) rotate(rdeg) rotateY(θdeg)
 * ```
 *
 * 因此 `translate` 是**最外层**（右→左应用时最后生效），`perspective` 只作用于卡片
 * 自身的局部坐标系，不会把整块卡片按画布百分比平移量拽进投影 —— 这一点由 #13 的
 * A/B 两格（有/无 `translate`）目视对照片钉死。
 *
 * ## 投影公式
 *
 * ```
 * u = (c − (cols−1)/2) · (cardW + gapX)          // 墙平面坐标（画布 %）
 * v = (r − (rows−1)/2) · (cardH + gapY)
 * θ = angleY + curve · (c − (cols−1)/2) + jitterAngle
 * X = u/100 · W ; Y = v/100 · H                  // 转 px
 * Z = −X·sinθ + depth + depthJitter              // 绕 Y 轴后的深度
 * s = d / (d − Z)                                // 透视缩放
 * X' = X·cosθ·s ; Y' = Y·s
 * box.x = originX + X'/W·100 ; box.y = originY + Y'/H·100
 * transform = { scale: s·jitterScale, rotateY: θ, perspective: d }
 * ```
 *
 * 位置与尺寸都用同一个 `s`，所以「远处的卡更小且更靠中」自洽；卡片的局部梯形由
 * CSS `rotateY` 提供，手算投影只负责把它放到墙上的正确位置。
 */

/** 卡片数上限：#13 实测过的最大规模（36 张），再大没有像素证据且每帧成本线性上涨。 */
export const MAX_CARD_WALL_CARDS = 36

/** 与 `manifest-track-validate.ts` 的 `MIN_PERSPECTIVE` 同值（透视距离下限）。 */
export const MIN_CARD_WALL_PERSPECTIVE = 200

/** 几何参数的缺省值 —— **唯一**参数文档，改这里等于改契约。 */
export const CARD_WALL_DEFAULTS = {
  /**
   * 默认 4×3 = 12 张（D-40）：落在需求收敛的「12–15 张就够」区间，且 #13 实测
   * 3D 层约 3.7ms/层/帧 ⇒ 12 层约 58ms/帧。上一会话设想的 36 张实测 243ms/帧，
   * 24s@60fps 会渲近 3.5 分钟，**不能当缺省**。要更密的墙请用 `angleY: 0` 的 2D 网格。
   */
  cols: 4,
  rows: 3,
  /** 单卡宽 / 高（画布百分比）。1920×1080 下约 288×194px，配 1200px 透视 ≈ 4 倍余量。 */
  cardW: 15,
  cardH: 18,
  gapX: 3.5,
  gapY: 4.5,
  /** 墙中心（画布百分比）。 */
  originX: 50,
  originY: 50,
  /** 整墙绕 Y 轴偏转（度）；负 = 右侧靠近观察者。 */
  angleY: -24,
  /** 每列递进角度（度/列）⇒ 弧面墙；0 = 平面墙。 */
  curve: 0,
  perspective: 1200,
  /** 墙中心沿视线位移（px，正 = 靠近）。 */
  depth: 0,
  seed: 7,
  jitterScale: 0,
  depthJitter: 0,
  jitterAngle: 0,
} as const

export interface CardWallGeometryParams {
  cols?: number
  rows?: number
  cardW?: number
  cardH?: number
  gapX?: number
  gapY?: number
  originX?: number
  originY?: number
  angleY?: number
  curve?: number
  perspective?: number
  depth?: number
  seed?: number
  jitterScale?: number
  depthJitter?: number
  jitterAngle?: number
}

export interface CardWallCell {
  row: number
  col: number
  /** 行优先序号（0 起）—— 构件层用它派生轨道 id 与错峰。 */
  index: number
  /** 中心语义、4 位小数收口（与 `ShapeTrack.box` 同域）。 */
  box: { x: number; y: number; w: number; h: number }
  transform: {
    scale: number
    rotateY: number
    perspective: number
  }
}

export class CardWallError extends Error {
  readonly code: 'CARD_WALL_BAD_PARAMS' | 'CARD_WALL_BEHIND_CAMERA'

  constructor(code: CardWallError['code'], message: string) {
    super(message)
    this.name = 'CardWallError'
    this.code = code
  }
}

/** 32 位确定性 PRNG（mulberry32）—— 与 `furniture.ts` 的星点同族，同 seed 同序列。 */
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

function num(params: CardWallGeometryParams, key: keyof typeof CARD_WALL_DEFAULTS, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/**
 * 把一面卡片墙投影成 N 个格位（纯函数、确定性、零 IO）。
 *
 * @param widthPx / heightPx 画布像素尺寸 —— % 与 px 的换算基准；只影响位置，不影响串形。
 * @throws {CardWallError} 参数非法 / 卡片落到相机后方（不静默出 0 尺寸或 NaN）
 */
export function projectCardWall(
  params: CardWallGeometryParams,
  widthPx: number,
  heightPx: number,
): CardWallCell[] {
  if (!(Number.isFinite(widthPx) && widthPx > 0 && Number.isFinite(heightPx) && heightPx > 0)) {
    throw new CardWallError('CARD_WALL_BAD_PARAMS', `画布尺寸必须是正数：${String(widthPx)} × ${String(heightPx)}`)
  }
  const cols = Math.round(num(params, 'cols', CARD_WALL_DEFAULTS.cols))
  const rows = Math.round(num(params, 'rows', CARD_WALL_DEFAULTS.rows))
  if (!(cols >= 1 && rows >= 1 && cols * rows <= MAX_CARD_WALL_CARDS)) {
    throw new CardWallError(
      'CARD_WALL_BAD_PARAMS',
      `cols / rows 必须为正整数且乘积 ≤ ${String(MAX_CARD_WALL_CARDS)}：${String(cols)} × ${String(rows)}`,
    )
  }
  const d = num(params, 'perspective', CARD_WALL_DEFAULTS.perspective)
  if (!(Number.isFinite(d) && d >= MIN_CARD_WALL_PERSPECTIVE)) {
    throw new CardWallError('CARD_WALL_BAD_PARAMS', `perspective 必须 ≥ ${String(MIN_CARD_WALL_PERSPECTIVE)}px：${String(d)}`)
  }
  const cardW = num(params, 'cardW', CARD_WALL_DEFAULTS.cardW)
  const cardH = num(params, 'cardH', CARD_WALL_DEFAULTS.cardH)
  const gapX = num(params, 'gapX', CARD_WALL_DEFAULTS.gapX)
  const gapY = num(params, 'gapY', CARD_WALL_DEFAULTS.gapY)
  const originX = num(params, 'originX', CARD_WALL_DEFAULTS.originX)
  const originY = num(params, 'originY', CARD_WALL_DEFAULTS.originY)
  const angleY = num(params, 'angleY', CARD_WALL_DEFAULTS.angleY)
  const curve = num(params, 'curve', CARD_WALL_DEFAULTS.curve)
  const depth = num(params, 'depth', CARD_WALL_DEFAULTS.depth)
  const jitterScale = num(params, 'jitterScale', CARD_WALL_DEFAULTS.jitterScale)
  const depthJitter = num(params, 'depthJitter', CARD_WALL_DEFAULTS.depthJitter)
  const jitterAngle = num(params, 'jitterAngle', CARD_WALL_DEFAULTS.jitterAngle)
  if (cardW <= 0 || cardH <= 0 || gapX < 0 || gapY < 0) {
    throw new CardWallError('CARD_WALL_BAD_PARAMS', `cardW / cardH 必须 > 0、gap 必须 ≥ 0：${cardW}/${cardH}/${gapX}/${gapY}`)
  }
  const seed = Math.round(num(params, 'seed', CARD_WALL_DEFAULTS.seed))
  const rand = mulberry32(seed)
  const cells: CardWallCell[] = []
  const halfC = (cols - 1) / 2
  const halfR = (rows - 1) / 2
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      // rand() 的取用顺序是确定性契约的一部分：角度 → 缩放 → 深度，改顺序 = 破坏兼容。
      const angleJ = jitterAngle * (rand() * 2 - 1)
      const scaleJ = jitterScale * (rand() * 2 - 1)
      const depthJ = depthJitter * (rand() * 2 - 1)

      const theta = angleY + curve * (c - halfC) + angleJ
      const rad = (theta * Math.PI) / 180
      const u = (c - halfC) * (cardW + gapX)
      const v = (r - halfR) * (cardH + gapY)
      const X = (u / 100) * widthPx
      const Y = (v / 100) * heightPx
      const Z = -X * Math.sin(rad) + depth + depthJ
      const denom = d - Z
      if (!(denom > 0)) {
        throw new CardWallError(
          'CARD_WALL_BEHIND_CAMERA',
          `第 ${String(r * cols + c)} 张卡落到相机后方（d−Z = ${round4(denom)}）：把 perspective 调大或 angleY / depth 调小`,
        )
      }
      const s = d / denom
      if (!(Number.isFinite(s) && s > 0 && s <= 4)) {
        throw new CardWallError(
          'CARD_WALL_BEHIND_CAMERA',
          `第 ${String(r * cols + c)} 张卡的透视缩放失控（s = ${round4(s)}）：把 perspective 调大或 angleY / depth 调小`,
        )
      }
      const Xs = X * Math.cos(rad) * s
      const Ys = Y * s
      cells.push({
        row: r,
        col: c,
        index: r * cols + c,
        box: {
          x: round4(originX + (Xs / widthPx) * 100),
          y: round4(originY + (Ys / heightPx) * 100),
          w: round4(cardW),
          h: round4(cardH),
        },
        transform: {
          scale: round4(s * (1 + scaleJ)),
          rotateY: round4(theta),
          perspective: d,
        },
      })
    }
  }
  return cells
}
