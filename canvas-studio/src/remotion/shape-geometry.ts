/**
 * REQ-034 · 二期 A3：形状轨的**几何纯函数**（零 Remotion 依赖、零 DOM）。
 *
 * 为什么手写而不引 `@remotion/shapes`（2026-10-17 落码时的实测取舍）：
 * 1. 该包在本机 `yarn add` 被沙箱拦在缓存重命名（`file-unlink` 策略），装不进
 *    `node_modules`；而形状是**静态几何**，不依赖浏览器能力，手写 40 行即可。
 * 2. 更要紧的是**可测**：几何点落在纯函数里，`node --test` 能直接断言「星形 10 个顶点 /
 *    半径比 / 角度对称」；换成组件就只能"眼睛看"（本仓已明确视觉不在自动覆盖内）。
 * 3. 少一个包 = 少一处版本锁风险（Remotion 混版本会直接炸渲染）。
 *
 * 坐标空间：**0–100 的局部归一化盒**，由组件用 `viewBox="0 0 100 100"` +
 * `preserveAspectRatio="none"` 映射到 `box.w% × box.h%` 的实际区域。因此这里的点与
 * 画布宽高比无关 —— 拉伸由 viewBox 负责（与 `path` 轨的 0–100 双轴百分比同一口径）。
 */

export interface ShapePoint {
  x: number
  y: number
}

/** 局部盒的中心（0–100 归一化坐标）。 */
const CENTER = 50
/** 外接半径：留 2 单位边距，避免描边被盒边裁掉。 */
const RADIUS = 48

function toPointString(points: readonly ShapePoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

/** 保留 3 位小数：避免浮点长尾进 SVG（也便于单测断言稳定）。 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 正多边形顶点（`sides >= 3`），顶点朝上（`rotationDeg = -90` 时）。
 * 非法边数返回空串（校验层已拦，这里只做兜底）。
 */
export function polygonPoints(sides: number, rotationDeg = -90): string {
  if (!Number.isFinite(sides) || sides < 3) return ''
  const n = Math.floor(sides)
  const points: ShapePoint[] = []
  for (let i = 0; i < n; i += 1) {
    const angle = ((rotationDeg + (360 * i) / n) * Math.PI) / 180
    points.push({ x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) })
  }
  return toPointString(points)
}

/** 三角形 = 正三边形（单独导出只为调用点可读）。 */
export function trianglePoints(rotationDeg = -90): string {
  return polygonPoints(3, rotationDeg)
}

/**
 * 星形顶点（`points` 个角、内外半径比 `innerRatio`）。
 *
 * 顶点交替落在外圆 / 内圆上（共 `2 × points` 个），缺省尖朝上。
 * `innerRatio` 夹在 (0, 1)；非法角数返回空串。
 */
export function starPoints(points = 5, innerRatio = 0.45, rotationDeg = -90): string {
  if (!Number.isFinite(points) || points < 3) return ''
  const n = Math.floor(points)
  const ratio = Number.isFinite(innerRatio) ? Math.min(0.95, Math.max(0.05, innerRatio)) : 0.45
  const out: ShapePoint[] = []
  for (let i = 0; i < n * 2; i += 1) {
    const radius = i % 2 === 0 ? RADIUS : RADIUS * ratio
    const angle = ((rotationDeg + (180 * i) / n) * Math.PI) / 180
    out.push({ x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) })
  }
  return toPointString(out)
}

/** 右向箭头（7 点：杆 + 箭头），在 0–100 盒内铺满。 */
export function arrowPoints(): string {
  const points: ShapePoint[] = [
    { x: 2, y: 34 },
    { x: 66, y: 34 },
    { x: 66, y: 10 },
    { x: 98, y: 50 },
    { x: 66, y: 90 },
    { x: 66, y: 66 },
    { x: 2, y: 66 },
  ]
  return toPointString(points)
}

/** 形状 kind → `<polygon points>`；不适用的 kind 返回 `null`（由调用方走别的分支）。 */
export function polygonPointsForShape(shape: string): string | null {
  switch (shape) {
    case 'triangle':
      return trianglePoints()
    case 'star':
      return starPoints()
    case 'polygon':
      return polygonPoints(6)
    case 'arrow':
      return arrowPoints()
    default:
      return null
  }
}

/** `box` 的四个画布百分比分量。**`x` / `y` 是形状中心**（不是左上角）。 */
export interface ShapeBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * `box` → 定位样式（画布百分比字符串）。组件唯一取值点。
 *
 * 语义铁律（REQ-034 O-03）：`x` / `y` 是形状**中心**，靠 `translate(-50%, -50%)` 把盒子
 * 拉回中心对齐 ⇒ **铺满全屏写 `{x:50,y:50,w:100,h:100}`**。写成 `{x:0,y:0,…}` 只会铺左上
 * 四分之一（真机片头卡大面积纯黑就是这个原因，契约文档的旧示例正是这么写的）。
 */
export function boxStyle(box: ShapeBox, extraTransform?: string): {
  left: string
  top: string
  width: string
  height: string
  transform: string
} {
  return {
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    // 与 `boxToRect` 同一处维护：中心对齐是这套坐标语义的另一半，不能拆开改。
    // `extraTransform` 拼在后面（动画层），输出与改前逐字符一致。
    transform: extraTransform === undefined || extraTransform.length === 0
      ? 'translate(-50%, -50%)'
      : `translate(-50%, -50%) ${extraTransform}`,
  }
}

/**
 * `box` 解析出的**画布百分比矩形**（左上角 + 宽高，已把 `translate(-50%,-50%)` 折进去）。
 *
 * 用于断言「这个 box 在画面上到底占了多大一块」——纯几何，不碰 DOM。
 */
export function boxToRect(box: ShapeBox): { left: number; top: number; width: number; height: number } {
  const style = boxStyle(box)
  const width = Number.parseFloat(style.width)
  const height = Number.parseFloat(style.height)
  return {
    left: Number.parseFloat(style.left) - width / 2,
    top: Number.parseFloat(style.top) - height / 2,
    width,
    height,
  }
}
