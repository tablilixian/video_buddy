/**
 * REQ-034 · B2：`video` 轨 → `@remotion/media` 的 `<Video>`（v4 官方推荐，§7.3）。
 *
 * 三期 W3-1：接上官方早已支持、我们此前一个没用的五个 props ——
 * `trimBefore` / `playbackRate` / `muted` / `volume` / `loop`。
 * 语义：一条 8s 素材终于可以只用其中 2.5s，0.5× 慢动作是最便宜的「电影感」，
 * 片段原声也终于关得掉。
 */
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
    <AbsoluteFill
      style={{
        opacity: anim.opacity,
        backgroundColor: '#000',
        ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
        // 二期 A2：效果由唯一接线点折算，组件只展开。
        ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
        ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
      }}
    >
      <AbsoluteFill style={{ transform: anim.layerTransform, transformOrigin: 'center' }}>
        <Video
          src={track.src}
          objectFit="cover"
          style={{ width: '100%', height: '100%' }}
          {...(track.trimBeforeFrames !== undefined && track.trimBeforeFrames > 0
            ? { trimBefore: track.trimBeforeFrames }
            : {})}
          {...(track.playbackRate !== undefined && track.playbackRate !== 1
            ? { playbackRate: track.playbackRate }
            : {})}
          {...(track.muted === true ? { muted: true } : {})}
          {...(track.volume !== undefined ? { volume: track.volume } : {})}
          {...(track.loop === true ? { loop: true } : {})}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
