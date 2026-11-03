/**
 * P3（2026-11-03）：**分区揭示壳** —— 把 `track.reveal` 折算成按帧求值的 clip-path，
 * 套在轨内容外。
 *
 * 与 TransitionShell 的分工：转场是「轨与轨之间」的可见性编排（Root 按绝对帧算
 * override），揭示是「一张卡自己的显现方式」（本组件在 Sequence 内拿轨内局部帧）。
 * 顺序：Sequence → RevealShell → TransitionShell → TrackBody —— clip 在轨内容
 * 自身坐标系求值，转场的位移/透明度作用在已揭示的画面上。
 *
 * 缺省无 reveal ⇒ 恒等直通（老 manifest 逐像素不变）；揭示走完 ⇒ `''` 不写样式。
 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import type { TrackReveal } from '../manifest.js'
import { revealClipAt } from '../reveal.js'

export const RevealShell: React.FC<{ reveal?: TrackReveal | undefined; children: React.ReactNode }> = ({
  reveal,
  children,
}) => {
  const frame = useCurrentFrame()
  const clipPath = reveal === undefined ? '' : revealClipAt(reveal, frame)
  if (clipPath === '') return <AbsoluteFill>{children}</AbsoluteFill>
  return (
    <AbsoluteFill style={{ clipPath, WebkitClipPath: clipPath }}>{children}</AbsoluteFill>
  )
}
