/** REQ-034 · B2：`image` 轨 → `<Img>`，支持 cover / contain / kenburns 与可选 caption。 */
import type React from 'react'
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion'
import type { ImageClipTrack } from '../manifest.js'
import { fadeOpacity } from '../timing.js'

export const ImageClip: React.FC<{ track: ImageClipTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const duration = Math.max(1, track.durationInFrames)
  const opacity = fadeOpacity(frame, duration)
  const fit = track.fit ?? 'cover'
  const kenBurns = fit === 'kenburns' ? 1 + 0.08 * (frame / duration) : 1
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#05080f' }}>
      <AbsoluteFill style={{ transform: `scale(${kenBurns})`, transformOrigin: 'center' }}>
        <Img
          src={track.src}
          style={{ width: '100%', height: '100%', objectFit: fit === 'contain' ? 'contain' : 'cover' }}
        />
      </AbsoluteFill>
      {track.caption !== undefined && track.caption.length > 0 ? (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            padding: 64,
            background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.72))',
          }}
        >
          <div style={{ fontSize: 46, fontWeight: 700, color: '#f0f3f7', fontFamily: 'sans-serif' }}>
            {track.caption}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  )
}
