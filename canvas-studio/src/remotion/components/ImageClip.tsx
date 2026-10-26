/** REQ-034 · B2：`image` 轨 → `<Img>`，支持 cover / contain / kenburns 与可选 caption。
 *
 * 会话效率优化（2026-10-26）：`track.box` 在场时整轨约束到该子区域（语义与
 * VideoClip 相同：盒子定位层 + overflow hidden + cover 裁剪）；背景色进盒子。
 * `caption` 仍铺满画布贴底（区域化字幕请改用 textCard 轨 + box）。
 */
import type React from 'react'
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import { boxStyle } from '../shape-geometry.js'
import type { ImageClipTrack } from '../manifest.js'
import { useFontFamilyStack } from './font-context.js'

export const ImageClip: React.FC<{ track: ImageClipTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const fontFamily = useFontFamilyStack()
  const duration = Math.max(1, track.durationInFrames)
  const fit = track.fit ?? 'cover'
  const kenBurns = fit === 'kenburns' ? 1 + 0.08 * (frame / duration) : 1
  // CV-334：KenBurns 作为 `extraScale` 与动画 scale **相乘** —— "缓推 + 入场缩放"能叠加。
  // 缺省参数下 `layerTransform` 是恒等串，与 CV-334 之前的 `scale(kenBurns)` 等价。
  const anim = resolveAnimatedStyle(track, frame, { extraScale: kenBurns })
  const box = track.box
  // OPT-8（2026-10-26）：兜底底色只跟**媒体层**走（与 VideoClip 同修）——
  // 挂铺满容器会让 z 序更高的图片轨把整幅画布涂成深底、盖掉下方内容轨。
  const layerStyle: React.CSSProperties = box === undefined
    ? { transform: anim.layerTransform, transformOrigin: 'center', backgroundColor: '#05080f' }
    : {
        position: 'absolute',
        overflow: 'hidden',
        backgroundColor: '#05080f',
        ...boxStyle({ x: box.x, y: box.y, w: box.w, h: box.h }, anim.shapeTransform),
      }
  return (
    <AbsoluteFill
      style={{
        opacity: anim.opacity,
        ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
        // 二期 A2：视觉效果由唯一接线点折算，这里只展开（组件不解读枚举）。
        ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
        ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
      }}
    >
      <AbsoluteFill style={layerStyle}>
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
          <div style={{ fontSize: 46, fontWeight: 700, color: '#f0f3f7', fontFamily }}>
            {track.caption}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  )
}
