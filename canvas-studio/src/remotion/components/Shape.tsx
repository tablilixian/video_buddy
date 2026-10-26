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
import { boxStyle, polygonPointsForShape } from '../shape-geometry.js'
import { colorShiftAt, drawProgressAt } from '../timing.js'

/** `fx` 里与容器相关的三项（文字类效果由各文本组件自己贴）。 */
function containerFx(anim: ReturnType<typeof resolveAnimatedStyle>): React.CSSProperties {
  return {
    ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
    ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
    ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
    ...(anim.fx.boxShadow !== undefined ? { boxShadow: anim.fx.boxShadow } : {}),
  }
}

export const Shape: React.FC<{ track: ShapeTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  const anim = resolveAnimatedStyle(track, frame)
  // 三期 W2-3：`colorShift` 覆盖静态 `color`（缺省 `null` ⇒ 原色，老 manifest 不变）。
  const color = colorShiftAt(track, frame) ?? track.color
  const box = track.box ?? { x: 50, y: 50, w: 30, h: 20 }
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

  // ── A3：多边形族（顶点来自纯函数） ──
  const points = polygonPointsForShape(track.shape)
  if (points !== null) {
    return (
      <AbsoluteFill style={{ opacity: anim.opacity, ...containerFx(anim) }}>
        <div
          style={{
            position: 'absolute',
            ...boxStyle({ x: left, y: top, w: box.w, h: box.h }, anim.shapeTransform),
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
