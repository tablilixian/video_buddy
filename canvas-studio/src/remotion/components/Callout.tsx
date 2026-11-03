/**
 * P3（2026-11-03）：**callout 引线标注**轨 —— 「指着一个东西讲」的原语。
 *
 * 长期缺口（shot-cards 缺口清单）：锚点标注此前只能拿 shape 轨手拼坐标（线 / 点 /
 * 文字三轨对齐，锚点一改全盘手算）。一条轨收齐「锚点 + 引线 + 标签」：锚点与标签盒
 * 都是画布百分比，引线自动从标签盒朝锚点一侧的边缘中点出线（elbow 先直后折 /
 * straight 直线）。
 *
 * 动画（纯帧函数，确定性）：引线 0→20 帧描边生长（pathLength 归一 + strokeDashoffset）、
 * 锚点圆点 18→26 帧弹出、标签 14→26 帧淡入 + 向锚点方向微移落位。BaseTrack 的
 * transform / animate / exit / fadeFrames 经 resolveAnimatedStyle 作用在整层上
 * （与 Shape / TextCard 同机制）。线画在 SVG（viewBox 非等比拉伸 + non-scaling-stroke
 * 保线宽），锚点圆点与标签走 HTML 层（固定像素尺寸，不被拉伸压成椭圆）。
 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { CalloutTrack } from '../manifest.js'

const LINE_DRAW_FRAMES = 20
const LABEL_IN_FRAMES = 14
const LABEL_SETTLE_FRAMES = 26
const DOT_POP_FRAMES = 18
const DOT_POP_DURATION_FRAMES = 8
const DOT_DIAMETER_PX = 10
const LABEL_SHIFT_PX = 6
const DEFAULT_COLOR = '#ffb454'
const DEFAULT_LABEL_BACKGROUND = 'rgba(10, 16, 28, 0.78)'

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, p))
}

interface BoxRect {
  x: number
  y: number
  w: number
  h: number
}

/** 标签盒边缘朝锚点一侧的出线点（画布百分比坐标）。锚点在盒内时贴最近边。 */
function exitPointOf(box: BoxRect, anchor: { x: number; y: number }): { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' } {
  const left = box.x - box.w / 2
  const right = box.x + box.w / 2
  const top = box.y - box.h / 2
  const bottom = box.y + box.h / 2
  if (anchor.x <= left) return { x: left, y: box.y, side: 'left' }
  if (anchor.x >= right) return { x: right, y: box.y, side: 'right' }
  if (anchor.y <= top) return { x: box.x, y: top, side: 'top' }
  if (anchor.y >= bottom) return { x: box.x, y: bottom, side: 'bottom' }
  const dl = anchor.x - left
  const dr = right - anchor.x
  const dt = anchor.y - top
  const db = bottom - anchor.y
  const min = Math.min(dl, dr, dt, db)
  if (min === dl) return { x: left, y: anchor.y, side: 'left' }
  if (min === dr) return { x: right, y: anchor.y, side: 'right' }
  if (min === dt) return { x: anchor.x, y: top, side: 'top' }
  return { x: anchor.x, y: bottom, side: 'bottom' }
}

/** 引线路径（0–100 双轴百分比坐标空间，SVG d 串）。 */
function linePathOf(track: CalloutTrack, exit: { x: number; y: number; side: string }, anchor: { x: number; y: number }): string {
  if (track.line === 'straight') {
    return `M ${exit.x} ${exit.y} L ${anchor.x} ${anchor.y}`
  }
  // elbow：左右出线先水平再竖直；上下出线先竖直再水平（折点 = 锚点在出线法线上的投影）。
  return exit.side === 'left' || exit.side === 'right'
    ? `M ${exit.x} ${exit.y} L ${anchor.x} ${exit.y} L ${anchor.x} ${anchor.y}`
    : `M ${exit.x} ${exit.y} L ${exit.x} ${anchor.y} L ${anchor.x} ${anchor.y}`
}

export const Callout: React.FC<{ track: CalloutTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const anim = resolveAnimatedStyle(track, frame)
  const color = track.color ?? DEFAULT_COLOR
  const box: BoxRect = track.box ?? { x: 30, y: 30, w: 22, h: 9 }
  const anchor = track.anchor ?? { x: 60, y: 60 }
  const exit = exitPointOf(box, anchor)
  const d = linePathOf(track, exit, anchor)

  const lineP = easeOutCubic(clamp01(frame / LINE_DRAW_FRAMES))
  const labelP = easeOutCubic(clamp01((frame - LABEL_IN_FRAMES) / (LABEL_SETTLE_FRAMES - LABEL_IN_FRAMES)))
  const dotP = easeOutCubic(clamp01((frame - DOT_POP_FRAMES) / DOT_POP_DURATION_FRAMES))
  // 标签微移方向：朝锚点一侧落位（揭示时刻意「欠一点」，落位有方向感）。
  const shiftX = Math.sign(anchor.x - box.x) * LABEL_SHIFT_PX * (1 - labelP)
  const shiftY = Math.sign(anchor.y - box.y) * LABEL_SHIFT_PX * (1 - labelP)
  // 字号：画布宽 2.4% 与盒高的 42% 取小（盒矮时以盒为准，杜绝溢出）。
  const fontSize = Math.max(11, Math.min(width * 0.024, (box.h / 100) * height * 0.42))

  return (
    <AbsoluteFill
      style={{
        opacity: anim.opacity,
        ...(anim.positionDeclared || anim.animated ? { transform: anim.layerTransform } : {}),
      }}
    >
      <AbsoluteFill>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - lineP}
            opacity={lineP > 0 ? 1 : 0}
          />
        </svg>
        {/* 锚点圆点：HTML 层固定像素直径，避免 viewBox 非等比拉伸压成椭圆。 */}
        <div
          style={{
            position: 'absolute',
            left: `${anchor.x}%`,
            top: `${anchor.y}%`,
            width: DOT_DIAMETER_PX,
            height: DOT_DIAMETER_PX,
            marginLeft: -DOT_DIAMETER_PX / 2,
            marginTop: -DOT_DIAMETER_PX / 2,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 8px ${color}`,
            transform: `scale(${dotP})`,
            opacity: dotP > 0 ? 1 : 0,
          }}
        />
        {/* 标签：中心语义与 boxStyle 同口径（translate(-50%,-50%)）。 */}
        <div
          style={{
            position: 'absolute',
            left: `${box.x}%`,
            top: `${box.y}%`,
            width: `${box.w}%`,
            height: `${box.h}%`,
            transform: `translate(-50%, -50%) translate(${shiftX}px, ${shiftY}px)`,
            opacity: labelP,
            background: track.labelBackground ?? DEFAULT_LABEL_BACKGROUND,
            border: `1px solid ${color}66`,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 2%',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              color,
              fontSize,
              fontWeight: 600,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {track.text}
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
