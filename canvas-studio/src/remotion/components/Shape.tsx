/**
 * REQ-034 · B2 + 二期 A1/A2/A3：`shape` 轨。
 *
 * 覆盖面：
 * - 老 4 种（`rect` / `circle` / `line` / `gradient`）：**实现保持原样**（div + background）。
 *   换 div→svg 会让历史 manifest 的像素变化，违反「旧 manifest 逐帧不变」铁律。
 * - `path`（A1）：SVG `<path>` + `pathLength` 归一化 + `stroke-dashoffset` 做**生长**；
 *   坐标空间 0–100 双轴百分比（`preserveAspectRatio="none"`），因此 16:9 下正圆会变椭圆
 *   —— 这是契约里写明的口径，skill 会给换算公式。
 * - `arrow` / `triangle` / `star` / `polygon`（A3）：顶点由 `shape-geometry.ts` 纯函数算出
 *   （可单测），这里只贴 `<polygon>`。
 * - 位置 / 缩放 / 旋转 / 不透明度 / 视觉效果全部来自唯一接线点 `resolveAnimatedStyle`。
 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { ShapeTrack } from '../manifest.js'
import { boxStyle, pivotOriginStyle, polygonPointsForShape } from '../shape-geometry.js'
import { colorShiftAt, colorWithAlpha, colorWithAlphaZero, drawProgressAt } from '../timing.js'

/** `fx` 里与容器相关的三项（文字类效果由各文本组件自己贴）。 */
function containerFx(anim: ReturnType<typeof resolveAnimatedStyle>): React.CSSProperties {
  return {
    ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
    ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
    ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
    ...(anim.fx.boxShadow !== undefined ? { boxShadow: anim.fx.boxShadow } : {}),
  }
}

/**
 * S1-B：把任意轨 id 折算成安全的 SVG `id` 片段（`<pattern>` 引用必须全局唯一且
 * 语法安全）。逐字符转义（非法字符 → `_<charCode>`），确定性且零碰撞 ——
 * **禁**用随机数或索引：同一 manifest 渲两次 id 必须相同。
 */
function svgIdSafe(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0)}`) || 'dots'
}

export const Shape: React.FC<{ track: ShapeTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  // height 只被 RQ-04/06 的 SVG 像素坐标新路径消费（box 百分比 → px）。
  const { width, height } = useVideoConfig()
  const anim = resolveAnimatedStyle(track, frame)
  // 三期 W2-3：`colorShift` 覆盖静态 `color`（缺省 `null` ⇒ 原色，老 manifest 不变）。
  const color = colorShiftAt(track, frame) ?? track.color
  const box = track.box ?? { x: 50, y: 50, w: 30, h: 20 }
  // P1（2026-11-03）：`pivot` 轴心 → `transform-origin`。未声明 = 空对象 ⇒ 样式串与
  // 旧实现逐字符一致；`path` 分支的元素是铺满画布的层，轴心按画布百分比解释。
  const originStyle = pivotOriginStyle(track.pivot)
  // `transform` / `animate` / `orbit` / `exit` 显式给出**某轴**位置时该轴以它们为准，
  // 未声明的轴仍用 `box` 落点（2026-10-26 布局压测实证：旧的单标志位会把只声明 y 的
  // animate 当成双轴都声明，`box.x` 被静默丢弃 → 多柱图表全叠画布中心）。
  const left = anim.xDeclared ? anim.x : box.x
  const top = anim.yDeclared ? anim.y : box.y

  // ── A1：`path` 轨 —— 全画布 SVG，坐标 = 0–100 双轴百分比 ──
  if (track.shape === 'path') {
    const progress = drawProgressAt(track, frame)
    // 描边宽度按「画布宽度的百分比」换算成像素；再配 `vectorEffect="non-scaling-stroke"`
    // 抵消 `preserveAspectRatio="none"` 的非等比缩放（否则竖边细、横边粗，像两支笔画的）。
    const strokePx = Math.max(1, ((track.strokeWidth ?? 0.5) / 100) * width)
    return (
      <AbsoluteFill
        style={{
          opacity: anim.opacity,
          // path 没有 `box` 落点，位置/缩放/旋转只能走整层变换；未声明位置时**不加**
          // transform（保持恒等串 ⇒ 老 manifest 的 path 轨不受影响）。
          ...(anim.positionDeclared || anim.animated ? { transform: anim.layerTransform } : {}),
          ...originStyle,
          ...containerFx(anim),
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ overflow: 'visible' }}
        >
          <path
            d={track.d ?? ''}
            fill="none"
            stroke={color}
            strokeWidth={strokePx}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            // `pathLength=1` 把路径长度归一化到 1 ⇒ 不需要任何几何库算总长，
            // 也没有"运行时量长度"这种不确定来源（同一 d 永远得到同一个值）。
            pathLength={1}
            {...(track.draw !== undefined ? { strokeDasharray: 1, strokeDashoffset: 1 - progress } : {})}
          />
        </svg>
      </AbsoluteFill>
    )
  }

  // ── S1-B：`dotGrid` 轨 —— SVG `<pattern>` 平铺点阵 ──
  // #16 首轮实证：CSS `radial-gradient` 平铺被 web-renderer 4.0.535 **整个忽略**
  //（整格只剩一个糊点），SVG `<pattern>` + `<rect fill=url(#…)>` 才真出画（13ms/帧）。
  // 缺省铺满画布（它是背景底纹，不是小块装饰）；与 shape 老缺省（30×20 小块）不同，
  // 这是有意为之并在契约里写明。动画走 `shapeTransform` 绕盒中心（与 polygon 族同构）。
  if (track.shape === 'dotGrid') {
    const gridBox = track.box ?? { x: 50, y: 50, w: 100, h: 100 }
    const spacing = track.dotSpacing ?? 24
    const radius = track.dotRadius ?? 2
    const patternId = `dots-${svgIdSafe(track.id ?? '')}`
    return (
      <AbsoluteFill style={{ opacity: anim.opacity, ...containerFx(anim) }}>
        <div
          style={{
            position: 'absolute',
            ...boxStyle({ x: left, y: top, w: gridBox.w, h: gridBox.h }, anim.shapeTransform),
            ...originStyle,
          }}
        >
          <svg width="100%" height="100%" style={{ display: 'block' }}>
            <defs>
              <pattern id={patternId} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
                <circle cx={spacing / 2} cy={spacing / 2} r={radius} fill={color} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          </svg>
        </div>
      </AbsoluteFill>
    )
  }

  // ── RQ-09（REQ-038）：`vignette` 轨级暗角（SVG radialGradient，源工程口径） ──
  // 源工程 `Vignette`（src/po/ui.tsx:48-55）= `radial-gradient(118% 88% at 50% 44%,
  // transparent 38%, rgba(0,0,0,strength) 100%)`；11 个场景逐镜头 strength 0.45–0.7。
  // 产品 `meta.look.vignette` 是全局一份（Root 层 multiply），逐镜头强度不可表达 ⇒
  // 下沉为轨：中心 50%/44%、透明环 38%、半径 118%/88%（ellipse 长轴超盒是刻意的
  // —— 暗角压不到四角就没了暗角感）。缺省铺满画布（与 dotGrid 同：背景 overlay 定位）。
  if (track.shape === 'vignette') {
    const boxW = (box.w / 100) * width
    const boxH = (box.h / 100) * height
    const strength = track.strength ?? 0.5
    const vignetteId = `vig-${svgIdSafe(track.id ?? '')}`
    return (
      <AbsoluteFill style={{ opacity: anim.opacity, ...containerFx(anim) }}>
        <div
          style={{
            position: 'absolute',
            ...boxStyle({ x: left, y: top, w: box.w, h: box.h }, anim.shapeTransform),
            ...originStyle,
          }}
        >
          <svg width={boxW} height={boxH} style={{ display: 'block' }}>
            <defs>
              <radialGradient id={vignetteId} cx={0.5} cy={0.44} r={1}
                gradientTransform="translate(0.5 0.44) scale(1.18 0.88) translate(-0.5 -0.44)">
                <stop offset="0" stopColor="transparent" />
                <stop offset="0.38" stopColor="transparent" />
                <stop offset="1" stopColor={colorWithAlpha(color, strength)} />
              </radialGradient>
            </defs>
            <rect x={0} y={0} width={boxW} height={boxH} fill={`url(#${vignetteId})`} />
          </svg>
        </div>
      </AbsoluteFill>
    )
  }

  // ── RQ-04 / RQ-06（REQ-038）：rect/circle SVG 增强路径 + gradient 径向新路径 ──
  // 触发条件（缺省即旧行为）：
  // - rect/circle 声明 radius / stroke / dash 任一 ⇒ SVG 像素坐标新路径
  //  （老 div 实现不支持描边/虚线/圆角；不动老实现 ⇒ 未声明这些字段的 manifest 逐像素不变）；
  // - gradient 声明 gradientType:'radial' ⇒ SVG radialGradient
  //  （CSS radial-gradient 被 web-renderer 4.0.535 忽略，#16 实证；dotGrid 同一结论）。
  // 坐标空间 = **真实像素**（box 百分比 × 画布尺寸），不用 0-100 viewBox：
  // radius / strokeWidthPx / dash 都是 px 口径，经 preserveAspectRatio 拉伸会变形。
  const svgEnhanced = (track.shape === 'rect' || track.shape === 'circle')
    && (track.radius !== undefined || track.stroke !== undefined || track.dash !== undefined)
  const svgRadial = track.shape === 'gradient' && track.gradientType === 'radial'
  if (svgEnhanced || svgRadial) {
    const boxW = (box.w / 100) * width
    const boxH = (box.h / 100) * height
    const sw = Math.max(1, track.strokeWidthPx ?? 2)
    const dash = track.dash
    const gradientId = `shp-${svgIdSafe(track.id ?? 'grad')}`
    let inner: React.ReactNode
    if (svgRadial) {
      // 径向光晕：radialGradient 用 objectBoundingBox 单位（0–1 相对盒），r=1 配
      // gradientTransform 的双轴 scale ⇒ x/y 半径独立可控（缺省 60%×50%，源片光晕量级）。
      const cx = (track.gradientCenter?.x ?? 50) / 100
      const cy = (track.gradientCenter?.y ?? 50) / 100
      const rx = (track.gradientRadius?.x ?? 60) / 100
      const ry = (track.gradientRadius?.y ?? 50) / 100
      const to = track.gradientTo ?? colorWithAlphaZero(color)
      inner = (
        <>
          <defs>
            <radialGradient id={gradientId} cx={cx} cy={cy} r={1}
              gradientTransform={`translate(${cx} ${cy}) scale(${rx} ${ry}) translate(${-cx} ${-cy})`}>
              <stop offset="0" stopColor={color} />
              <stop offset="1" stopColor={to} />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={boxW} height={boxH} fill={`url(#${gradientId})`} />
        </>
      )
    } else if (track.shape === 'circle') {
      // 与老 circle 视觉口径对齐：直径 = box.w%（老实现 height:0 + paddingBottom:w%）。
      const r = Math.max(0, boxW / 2 - sw / 2)
      inner = (
        <circle
          cx={boxW / 2}
          cy={boxH / 2}
          r={r}
          fill={color}
          {...(track.stroke !== undefined ? { stroke: track.stroke, strokeWidth: sw } : {})}
          {...(dash !== undefined ? { strokeDasharray: `${dash[0]} ${dash[1]}` } : {})}
        />
      )
    } else {
      // rect：描边画在盒内（x/y 内缩 sw/2），与 CSS border 占盒内空间的直觉一致；
      // rx 不内缩 —— CSS border-radius 同样按盒边算。
      inner = (
        <rect
          x={sw / 2}
          y={sw / 2}
          width={Math.max(0, boxW - sw)}
          height={Math.max(0, boxH - sw)}
          rx={track.radius ?? 0}
          fill={color}
          {...(track.stroke !== undefined ? { stroke: track.stroke, strokeWidth: sw } : {})}
          {...(dash !== undefined ? { strokeDasharray: `${dash[0]} ${dash[1]}` } : {})}
        />
      )
    }
    return (
      <AbsoluteFill style={{ opacity: anim.opacity, ...containerFx(anim) }}>
        <div
          style={{
            position: 'absolute',
            ...boxStyle({ x: left, y: top, w: box.w, h: box.h }, anim.shapeTransform),
            ...originStyle,
          }}
        >
          <svg width={boxW} height={boxH} style={{ display: 'block', overflow: 'visible' }}>
            {inner}
          </svg>
        </div>
      </AbsoluteFill>
    )
  }

  // ── A3：多边形族（顶点来自纯函数） ──
  const points = polygonPointsForShape(track.shape)
  if (points !== null) {
    return (
      <AbsoluteFill style={{ opacity: anim.opacity, ...containerFx(anim) }}>
        <div
          style={{
            position: 'absolute',
            ...boxStyle({ x: left, y: top, w: box.w, h: box.h }, anim.shapeTransform),
            ...originStyle,
          }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
            <polygon points={points} fill={color} />
          </svg>
        </div>
      </AbsoluteFill>
    )
  }

  // ── 老 4 种：实现原样保留 ──
  const base: React.CSSProperties = {
    position: 'absolute',
    ...boxStyle({ x: left, y: top, w: box.w, h: box.h }, anim.shapeTransform),
    ...originStyle,
  }
  let visual: React.CSSProperties
  switch (track.shape) {
    case 'circle':
      visual = { ...base, borderRadius: '50%', background: color, height: '0%', paddingBottom: `${box.w}%` }
      break
    case 'line':
      visual = { ...base, height: 4, background: color, transform: `translate(0, -50%) ${anim.shapeTransform}` }
      break
    case 'gradient':
      visual = { ...base, background: `linear-gradient(135deg, ${color}, rgba(0,0,0,0.15))` }
      break
    case 'rect':
    default:
      visual = { ...base, background: color }
      break
  }
  return (
    <AbsoluteFill style={{ opacity: anim.opacity, ...containerFx(anim) }}>
      <div style={visual} />
    </AbsoluteFill>
  )
}
