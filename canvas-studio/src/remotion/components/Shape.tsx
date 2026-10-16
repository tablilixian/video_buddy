/** REQ-034 · B2：`shape` 轨 → rect / circle / line / gradient（百分比坐标 + CV-334 帧级动画）。 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { ShapeTrack } from '../manifest.js'

export const Shape: React.FC<{ track: ShapeTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  // CV-334：不透明度 / 位置 / 缩放 / 旋转全部来自唯一接线点（此前只有淡入淡出是动态的，
  // 位置写死在 `box`、连 `transform` 都读不到 —— 所以"行星绕太阳转"做不出来）。
  const anim = resolveAnimatedStyle(track, frame)
  const box = track.box ?? { x: 50, y: 50, w: 30, h: 20 }
  // `transform` / `animate` 显式给出 x/y 时以它们为准；否则 `box` 仍是落点来源（老写法不变）。
  const left = anim.positionDeclared ? anim.x : box.x
  const top = anim.positionDeclared ? anim.y : box.y
  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${left}%`,
    top: `${top}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    transform: `translate(-50%, -50%) ${anim.shapeTransform}`,
  }
  let visual: React.CSSProperties
  switch (track.shape) {
    case 'circle':
      visual = { ...base, borderRadius: '50%', background: track.color, height: '0%', paddingBottom: `${box.w}%` }
      break
    case 'line':
      visual = { ...base, height: 4, background: track.color, transform: `translate(0, -50%) ${anim.shapeTransform}` }
      break
    case 'gradient':
      visual = { ...base, background: `linear-gradient(135deg, ${track.color}, rgba(0,0,0,0.15))` }
      break
    case 'rect':
    default:
      visual = { ...base, background: track.color }
      break
  }
  return (
    <AbsoluteFill style={{ opacity: anim.opacity }}>
      <div style={visual} />
    </AbsoluteFill>
  )
}
