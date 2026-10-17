/**
 * REQ-034 · B2 转场壳：把 `transitionOverride`（纯函数，`../timing.js`）算出的
 * 可见性覆盖套到被转场作用的轨道上。组件本身不做时序判断。
 *
 * 路线 B（CSR）约束：**不使用 `z-index`**，层叠一律靠 DOM 顺序（§7.6）。
 *
 * 二期 A4：除 opacity / translateX / scale 外，新增三种原语 ——
 * `clipPath`（wipeLeft / wipeRight）、`maskImage`（clock）、`rotateY`（flipX）。
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
  const { opacity, translateXPercent, scale, clipPath, maskImage, rotateY } = override
  const identity =
    opacity === 1 && translateXPercent === 0 && scale === 1 &&
    clipPath === '' && maskImage === '' && rotateY === 0
  if (identity) return <AbsoluteFill>{children}</AbsoluteFill>
  // ⚠️ `perspective()` 必须写进 transform 串**且在 rotateY 之前** —— 写成元素的
  // `perspective` 属性只对**子元素**生效，自己身上的 rotateY 会退化成"水平压扁"，
  // 看起来像没有 3D。身份判据已在上面短路，老 manifest 不会走到这里。
  const transform = `translateX(${translateXPercent}%) scale(${scale})${rotateY === 0 ? '' : ' perspective(1200px)'} rotateY(${rotateY}deg)`
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform,
        transformOrigin: 'center',
        ...(rotateY === 0 ? {} : { transformStyle: 'preserve-3d' }),
        ...(clipPath === '' ? {} : { clipPath }),
        ...(maskImage === '' ? {} : { maskImage, WebkitMaskImage: maskImage }),
      }}
    >
      {children}
    </AbsoluteFill>
  )
}
