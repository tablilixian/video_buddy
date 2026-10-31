/**
 * REQ-034 · B2 转场壳：把 `transitionOverride`（纯函数，`../timing.js`）算出的
 * 可见性覆盖套到被转场作用的轨道上。组件本身不做时序判断。
 *
 * 路线 B（CSR）约束：**不使用 `z-index`**，层叠一律靠 DOM 顺序（§7.6）。
 *
 * 二期 A4：除 opacity / translateX / scale 外，新增三种原语 ——
 * `clipPath`（wipeLeft / wipeRight / clock）、`maskImage`（软边 wipe，只认 linear-gradient）、
 * `scaleXPercent`（flipX 的 2D 压扁翻面）+ `filter`（zoomBlur / linearBlur / crossWarp 的
 * 运动模糊，能力基准 #09 收口）。
 * 三者都是**按帧求值**的静态样式，绝不用 CSS `transition`/`@keyframes`
 * （逐帧截图走真实时钟 ⇒ 同一份 manifest 渲两次会不一样）。
 */
import type React from 'react'
import { AbsoluteFill } from 'remotion'
import type { TrackTransitionOverride } from '../timing.js'

export const TransitionShell: React.FC<{ override: TrackTransitionOverride; children: React.ReactNode }> = ({
  override,
  children,
}) => {
  const { opacity, translateXPercent, translateYPercent, scale, clipPath, maskImage, scaleXPercent, filter } = override
  const identity =
    opacity === 1 && translateXPercent === 0 && translateYPercent === 0 && scale === 1 &&
    clipPath === '' && maskImage === '' && scaleXPercent === 1 && filter === ''
  if (identity) return <AbsoluteFill>{children}</AbsoluteFill>
  // flipX 走 2D 压扁翻面：web-renderer 4.0.535 不读 transform 串里的 `perspective()`，
  // rotateY 会退化成"压扁穿越黑帧"（能力基准 #09 T09 实测）⇒ 不再发 rotateY，
  // 改由 timing.ts 直接给 scaleXPercent（有意压到 0 换面，渲染器白名单内）。身份判据已在上面短路。
  const translate = translateYPercent === 0
    ? `translateX(${translateXPercent}%)`
    : `translate(${translateXPercent}%, ${translateYPercent}%)`
  const transform = `${translate} scale(${scale})${scaleXPercent === 1 ? '' : ` scaleX(${scaleXPercent})`}`
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform,
        transformOrigin: 'center',
        ...(clipPath === '' ? {} : { clipPath }),
        ...(maskImage === '' ? {} : { maskImage, WebkitMaskImage: maskImage }),
        ...(filter === '' ? {} : { filter }),
      }}
    >
      {children}
    </AbsoluteFill>
  )
}
