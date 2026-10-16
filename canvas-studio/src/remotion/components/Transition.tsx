/**
 * REQ-034 · B2 转场壳：把 `transitionOverride`（纯函数，`../timing.js`）算出的
 * 可见性覆盖套到被转场作用的轨道上。组件本身不做时序判断。
 *
 * 路线 B（CSR）约束：**不使用 `z-index`**，层叠一律靠 DOM 顺序（§7.6）。
 */
import type React from 'react'
import { AbsoluteFill } from 'remotion'
import type { TrackTransitionOverride } from '../timing.js'

export const TransitionShell: React.FC<{ override: TrackTransitionOverride; children: React.ReactNode }> = ({
  override,
  children,
}) => {
  const { opacity, translateXPercent, scale } = override
  const identity = opacity === 1 && translateXPercent === 0 && scale === 1
  if (identity) return <AbsoluteFill>{children}</AbsoluteFill>
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${translateXPercent}%) scale(${scale})`,
        transformOrigin: 'center',
      }}
    >
      {children}
    </AbsoluteFill>
  )
}
