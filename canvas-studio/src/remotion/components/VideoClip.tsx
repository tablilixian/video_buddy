/** REQ-034 · B2：`video` 轨 → `@remotion/media` 的 `<Video>`（v4 官方推荐，§7.3）。 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Video } from '@remotion/media'
import type { VideoClipTrack } from '../manifest.js'
import { fadeOpacity } from '../timing.js'

export const VideoClip: React.FC<{ track: VideoClipTrack }> = ({ track }) => {
  // 组件被 <Sequence> 包裹 ⇒ useCurrentFrame() 已是轨内相对帧。
  const frame = useCurrentFrame()
  const duration = Math.max(1, track.durationInFrames)
  const opacity = fadeOpacity(frame, duration)
  const progress = frame / duration
  const kenBurns = track.kenBurns === true ? 1 + 0.06 * progress : 1
  const transform = track.transform
  const scale = (transform?.scale ?? 1) * kenBurns
  const rotation = transform?.rotation ?? 0
  const left = `${transform?.x ?? 50}%`
  const top = `${transform?.y ?? 50}%`
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#000' }}>
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: '100%',
          height: '100%',
          transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,
          transformOrigin: 'center',
        }}
      >
        <Video src={track.src} objectFit="cover" style={{ width: '100%', height: '100%' }} />
      </div>
    </AbsoluteFill>
  )
}
