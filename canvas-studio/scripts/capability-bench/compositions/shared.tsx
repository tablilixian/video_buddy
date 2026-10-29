/**
 * 能力基准 · 公共件（确定性铁律：只用 frame 驱动的纯函数，禁 transition / keyframes / 随机数）。
 */

import React from 'react'
import { AbsoluteFill } from 'remotion'

/** 规格统一（D2）：1080p30。改这一处，所有 composition 跟着变。 */
export const SPEC = { width: 1920, height: 1080, fps: 30 } as const

/** 字体：bench 自己注入的 Noto Sans SC 子集（见 entry.tsx 的 loadFonts）。 */
export const FONT_FAMILY = 'BenchSansSC, "PingFang SC", sans-serif'

/** 素材走 `/pool/<key>`（同源、不复制，key 由 driver 映射到 VideoOut 池里的绝对路径）。 */
export const POOL = {
  clip: '/pool/clip',
  bgm: '/pool/bgm',
  image: '/pool/image',
  tts: '/pool/tts',
} as const

export const COLORS = {
  bg: '#0b1220',
  ink: '#e8eefc',
  dim: '#8aa0c6',
  accent: '#5ad2ff',
  warn: '#ffb454',
} as const

/** 左上角角标：证明"这一段是什么"，也让硬切一眼可见。 */
export const Badge: React.FC<{ title: string; sub?: string; color?: string }> = ({ title, sub, color = COLORS.accent }) => (
  <div
    style={{
      display: 'inline-flex',
      flexDirection: 'column',
      gap: 6,
      padding: '14px 22px',
      borderRadius: 14,
      background: 'rgba(6,12,24,0.72)',
      border: `2px solid ${color}`,
      fontFamily: FONT_FAMILY,
      color: COLORS.ink,
    }}
  >
    <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 1, lineHeight: 1.1 }}>{title}</div>
    {sub ? <div style={{ fontSize: 24, color: COLORS.dim, lineHeight: 1.2 }}>{sub}</div> : null}
  </div>
)

/** 统一画布：底色 + 安全区外框（便于目视判断"有没有出画"）。 */
export const BenchFrame: React.FC<{ children: React.ReactNode; title?: string; footer?: string }> = ({
  children,
  title,
  footer,
}) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
    {children}
    <AbsoluteFill
      style={{
        border: '2px dashed rgba(90,210,255,0.22)',
        margin: 48,
        borderRadius: 12,
        pointerEvents: 'none',
      }}
    />
    {title ? (
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 96,
          fontFamily: FONT_FAMILY,
          fontSize: 28,
          color: COLORS.dim,
          letterSpacing: 2,
        }}
      >
        {title}
      </div>
    ) : null}
    {footer ? (
      <div
        style={{
          position: 'absolute',
          left: 96,
          bottom: 96,
          fontFamily: FONT_FAMILY,
          fontSize: 26,
          color: COLORS.dim,
          letterSpacing: 1,
        }}
      >
        {footer}
      </div>
    ) : null}
  </AbsoluteFill>
)
