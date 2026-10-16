/** REQ-034 · B2：`shape` 轨 → rect / circle / line / gradient（百分比坐标）。 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import type { ShapeTrack } from '../manifest.js'
import { fadeOpacity } from '../timing.js'

export const Shape: React.FC<{ track: ShapeTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const duration = Math.max(1, track.durationInFrames)
  const opacity = fadeOpacity(frame, duration)
  const box = track.box ?? { x: 50, y: 50, w: 30, h: 20 }
  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    transform: 'translate(-50%, -50%)',
  }
  let visual: React.CSSProperties
  switch (track.shape) {
    case 'circle':
      visual = { ...base, borderRadius: '50%', background: track.color, height: '0%', paddingBottom: `${box.w}%` }
      break
    case 'line':
      visual = { ...base, height: 4, background: track.color, transform: 'translate(0, -50%)' }
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
    <AbsoluteFill style={{ opacity }}>
      <div style={visual} />
    </AbsoluteFill>
  )
}
