/** REQ-034 · B2：`image` 轨 → `<Img>`，支持 cover / contain / kenburns 与可选 caption。
 *
 * 会话效率优化（2026-10-26）：`track.box` 在场时整轨约束到该子区域（语义与
 * VideoClip 相同：盒子定位层 + overflow hidden + cover 裁剪）；背景色进盒子。
 * `caption` 仍铺满画布贴底（区域化字幕请改用 textCard 轨 + box）。
 * CV-392（REQ-036 R-2）：`sourceRect` 圈出源图子区域按 fit 语义铺层 —— cover/contain
 * 的等比缩放需要自然尺寸，onLoad 里测（Remotion delayRender 官方模式，帧截图必等
 * 测量完成；AudioViz decodeAudioData 同款先例）；坏图退回纯百分比拉伸兜底，不卡渲染。
 * 无 sourceRect 的路径与 2026-10-31 之前逐字节同构（老 manifest 逐帧不变）。
 */
import { useState } from 'react'
import type React from 'react'
import { AbsoluteFill, Img, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import { cameraStateAt, cameraTransformStyle } from '../camera-motion.js'
import { boxStyle } from '../shape-geometry.js'
import type { ImageClipTrack } from '../manifest.js'
import { spriteRegionStyle } from '../sprite.js'
import { trackLocalFrame } from '../timing.js'
import { scaleDesignPx } from '../type-scale.js'
import { useFontFamilyStack } from './font-context.js'

export const ImageClip: React.FC<{ track: ImageClipTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const fontFamily = useFontFamilyStack()
  const { width: canvasW, height: canvasH } = useVideoConfig()
  const duration = Math.max(1, track.durationInFrames)
  const fit = track.fit ?? 'cover'
  const kenBurns = fit === 'kenburns' ? 1 + 0.08 * (frame / duration) : 1
  // RQ-23（REQ-038）：多关键帧相机 —— 声明即接管媒体层的位移/缩放/旋转。
  // 插值纯函数（camera-motion.ts）；x/y 是设计 px，按画布高换算成渲染 px。
  // 缺省不写 = 无相机层（DOM 不多一层，老 manifest 逐像素不变）。
  const camState = track.camera === undefined ? null : cameraStateAt(track.camera, trackLocalFrame(track, frame))
  const cameraStyle: React.CSSProperties = camState === null ? {} : (() => {
    const state = { ...camState, x: scaleDesignPx(camState.x, canvasH), y: scaleDesignPx(camState.y, canvasH) }
    return { transform: cameraTransformStyle(state), transformOrigin: 'center' }
  })()
  // CV-334：KenBurns 作为 `extraScale` 与动画 scale **相乘** —— "缓推 + 入场缩放"能叠加。
  // 缺省参数下 `layerTransform` 是恒等串，与 CV-334 之前的 `scale(kenBurns)` 等价。
  const anim = resolveAnimatedStyle(track, frame, { extraScale: kenBurns })
  const box = track.box
  const sourceRect = track.sourceRect
  // CV-392：测量态只服务 sourceRect 路径；无 sourceRect 时零 delayRender（老 manifest 零影响）。
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [measureHandle] = useState(() =>
    sourceRect === undefined ? null : delayRender('image sourceRect: 等图片加载测自然尺寸'),
  )
  const settleWith = (img: { naturalWidth: number; naturalHeight: number } | null) => {
    if (measureHandle === null) return
    setNatural(img === null ? { w: 0, h: 0 } : { w: img.naturalWidth, h: img.naturalHeight })
    continueRender(measureHandle)
  }
  const layerW = box === undefined ? canvasW : (canvasW * box.w) / 100
  const layerH = box === undefined ? canvasH : (canvasH * box.h) / 100
  // OPT-8（2026-10-26）：兜底底色只跟**媒体层**走（与 VideoClip 同修）——
  // 挂铺满容器会让 z 序更高的图片轨把整幅画布涂成深底、盖掉下方内容轨。
  // 透明素材（宿主探测 alpha 通道后写入 `hasAlpha`）不垫底 —— 垫底会让透明
  // 产品图带一块深色方底（甜品复刻会话实测的「白底方图逼出来」根因）；
  // 无该字段的老 manifest 行为逐帧不变。
  const backingColor = track.hasAlpha === true ? undefined : '#05080f'
  const layerStyle: React.CSSProperties = box === undefined
    ? { transform: anim.layerTransform, transformOrigin: 'center', ...(backingColor !== undefined ? { backgroundColor: backingColor } : {}) }
    : {
        position: 'absolute',
        overflow: 'hidden',
        ...(backingColor !== undefined ? { backgroundColor: backingColor } : {}),
        ...boxStyle({ x: box.x, y: box.y, w: box.w, h: box.h }, anim.shapeTransform),
      }
  // S1-B（≥95% 对齐）：`clip:'circle'` —— 圆形 PIP。#16 C 格实证 `clip-path: circle()`
  // 真出画；挂**媒体层**（而不是外层容器）⇒ caption 渐变不受裁切。缺省不写 ⇒ 无此样式，
  // 老 manifest 逐帧不变。
  if (track.clip === 'circle') layerStyle.clipPath = 'circle(50% at 50% 50%)'
  const media = sourceRect === undefined ? (
    <Img
      src={track.src}
      style={{ width: '100%', height: '100%', objectFit: fit === 'contain' ? 'contain' : 'cover' }}
    />
  ) : (
    <Img
      src={track.src}
      onLoad={(e) => settleWith(e.currentTarget)}
      onError={() => settleWith(null)}
      style={
        natural === null
          ? { position: 'absolute', visibility: 'hidden', width: '100%', height: '100%' }
          : {
              position: 'absolute',
              objectFit: 'fill',
              ...spriteRegionStyle(sourceRect, natural, {
                mode: fit === 'contain' ? 'contain' : 'cover',
                layerW,
                layerH,
              }),
            }
      }
    />
  )
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
        {/* RQ-23：相机层仅在声明 `camera` 时存在（老 manifest 的 DOM 少一层）。
            作用在媒体 wrapper 上 ⇒ 与整轨 animate（layerStyle 层）和 kenburns
            （extraScale 进 anim）正交叠加。 */}
        {camState === null ? media : <AbsoluteFill style={cameraStyle}>{media}</AbsoluteFill>}
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
