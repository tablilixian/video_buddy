/**
 * REQ-034 · B2：`video` 轨 → `@remotion/media` 的 `<Video>`（v4 官方推荐，§7.3）。
 *
 * 三期 W3-1：接上官方早已支持、我们此前一个没用的五个 props ——
 * `trimBefore` / `playbackRate` / `muted` / `volume` / `loop`。
 * 语义：一条 8s 素材终于可以只用其中 2.5s，0.5× 慢动作是最便宜的「电影感」，
 * 片段原声也终于关得掉。
 *
 * 会话效率优化（2026-10-26）：`track.box` 在场时，本轨被约束到该子区域 ——
 * 铺满层改为**盒子尺寸的定位层**（`boxStyle` 中心对齐 + `overflow: hidden`），
 * 素材 `objectFit: cover` 铺满盒子、溢出裁掉；背景色跟着进盒子（不再整幅涂黑，
 * 否则会盖住盒子外的其它轨）。`animate` 的 scale/rotation 走 `shapeTransform`
 * 绕盒子中心生效；位置维度（x/y）已被校验层与 box 互斥，这里不再处理。
 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Video } from '@remotion/media'
import { resolveAnimatedStyle } from '../animated-style.js'
import { boxStyle } from '../shape-geometry.js'
import type { VideoClipTrack } from '../manifest.js'

export const VideoClip: React.FC<{ track: VideoClipTrack }> = ({ track }) => {
  // 组件被 <Sequence> 包裹 ⇒ useCurrentFrame() 已是轨内相对帧。
  const frame = useCurrentFrame()
  const duration = Math.max(1, track.durationInFrames)
  const kenBurns = track.kenBurns === true ? 1 + 0.06 * (frame / duration) : 1
  // CV-334：`transform` 从本组件上提到 BaseTrack（5 轨通用），取值改走唯一接线点 ——
  // 本组件此前是全仓唯一的 `track.transform` 消费点，现在四个组件口径一致。
  const anim = resolveAnimatedStyle(track, frame, { extraScale: kenBurns })
  const box = track.box
  // OPT-8（2026-10-26）：兜底底色只跟**媒体层**走，不再挂在铺满容器上 ——
  // 挂容器会让 z 序更高的视频轨把整幅画布涂黑、盖掉下方文字卡（真机实证）。
  // 无 box 时媒体层即全屏，视觉与老渲染一致；带 transform 位移时底色随素材移动，
  // 不再「素材移走了、黑底还铺满全画布」。
  const layerStyle: React.CSSProperties = box === undefined
    ? { transform: anim.layerTransform, transformOrigin: 'center', backgroundColor: '#000' }
    : {
        position: 'absolute',
        overflow: 'hidden',
        backgroundColor: '#000',
        ...boxStyle({ x: box.x, y: box.y, w: box.w, h: box.h }, anim.shapeTransform),
      }
  return (
    <AbsoluteFill
      style={{
        opacity: anim.opacity,
        ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
        // 二期 A2：效果由唯一接线点折算，组件只展开。
        ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
        ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
      }}
    >
      <AbsoluteFill style={layerStyle}>
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
