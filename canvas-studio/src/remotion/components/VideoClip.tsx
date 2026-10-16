/** REQ-034 · B2：`video` 轨 → `@remotion/media` 的 `<Video>`（v4 官方推荐，§7.3）。 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Video } from '@remotion/media'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { VideoClipTrack } from '../manifest.js'

export const VideoClip: React.FC<{ track: VideoClipTrack }> = ({ track }) => {
  // 组件被 <Sequence> 包裹 ⇒ useCurrentFrame() 已是轨内相对帧。
  const frame = useCurrentFrame()
  const duration = Math.max(1, track.durationInFrames)
  const kenBurns = track.kenBurns === true ? 1 + 0.06 * (frame / duration) : 1
  // CV-334：`transform` 从本组件上提到 BaseTrack（5 轨通用），取值改走唯一接线点 ——
  // 本组件此前是全仓唯一的 `track.transform` 消费点，现在四个组件口径一致。
  const anim = resolveAnimatedStyle(track, frame, { extraScale: kenBurns })
  return (
    <AbsoluteFill style={{ opacity: anim.opacity, backgroundColor: '#000' }}>
      <AbsoluteFill style={{ transform: anim.layerTransform, transformOrigin: 'center' }}>
        <Video src={track.src} objectFit="cover" style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
