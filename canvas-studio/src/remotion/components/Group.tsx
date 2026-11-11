/**
 * ≥95% 对齐 S1-B（2026-11-11）：**`group` 轨 —— 3D 容器**。
 *
 * ## 为什么必须存在（架构判断，不是审美偏好）
 *
 * 62 张带内容的卡如果「1 卡 1 条独立 3D 轨」，就是 62 个 WebGL 预合成层 ——
 * 能力基准 #15 实测 146ms/帧，且目视是规则网格、没有统一灭点，不像原片那面斜墙。
 * #14 实证「**容器 transform 包 N 张子卡**」= 1 个 3D 层、82ms/帧、整面统一灭点
 * —— 这才是原片卡片墙的架构。本组件把它落成契约。
 *
 * ## 语义（v1 边界，写进了校验）
 * - **子轨时间相对组起点**：child 的 `startFrame: 0` = 与组同时出现（62 张卡全程
 *   在墙上的写法最短）。子轨窗口超出组窗口的部分被裁（渲染层自然裁切）。
 * - **子轨坐标是画布绝对百分比**（box/transform 与顶层轨同口径）—— 容器只做
 *   统一 3D 变换，不再引入第二套坐标体系（编译期 `groups.ts` 的「组内百分比」糖
 *   与本轨**无关**，那是宿主侧 box 展开，两个概念别混）。
 * - **容器角度 ≤30°**：#14 D 格实测 rotateY≈−38° 配 perspective(1200px) 时**整块
 *   静默消失**（不报错不留痕）⇒ 校验层直接拒收超角（`manifest-track-validate.ts`）。
 * - 子轨**不许再声明 3D 维度**（rotateX/rotateY/z/perspective）：web-renderer 的
 *   `transform-style: preserve-3d` 不被支持（#12 B/C 实证），容器内再转是未知像素
 *   行为 ⇒ 校验层给 warning。
 * - transition 不许指向子轨 id（子轨 id 不进顶层 kindById，引用自然报「不存在」）；
 *   motion-lint v1 不扫子轨（卡在墙上不动是设计意图，扫了反而误报 ML-10）。
 */
import type React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { CompositionManifest, GroupTrack } from '../manifest.js'
import { transitionOverride, trackTransitionWindows } from '../timing.js'
import { RevealShell } from './RevealShell.js'
import { TransitionShell } from './Transition.js'
import { TrackBody } from './track-body.js'

export const Group: React.FC<{ track: GroupTrack; manifest: CompositionManifest }> = ({ track, manifest }) => {
  const frame = useCurrentFrame()
  const anim = resolveAnimatedStyle(track, frame)
  return (
    <AbsoluteFill
      style={{
        opacity: anim.opacity,
        // 3D 透视必须写进元素**自身**的 transform 串（#12 硬边界）——
        // `layerTransform` 在声明了 rotateX/rotateY/z 时自带 `perspective()` 前缀。
        transform: anim.layerTransform,
        transformOrigin: 'center',
        ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
        ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
        ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
      }}
    >
      {track.children.map((child) => (
        // 子轨时间相对组起点（嵌套 Sequence 的 from 天然落在组内时间轴上）。
        <Sequence key={child.id} from={child.startFrame} durationInFrames={Math.max(1, child.durationInFrames)}>
          <RevealShell reveal={child.reveal} trackDurationInFrames={child.durationInFrames}>
            {/* transition 不许指向子轨 ⇒ override 恒空，壳是透传（与顶层同构，不特判）。 */}
            <TransitionShell override={transitionOverride(frame, trackTransitionWindows(manifest, child.id))}>
              <TrackBody track={child} manifest={manifest} />
            </TransitionShell>
          </RevealShell>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
