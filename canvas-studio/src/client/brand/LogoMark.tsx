/**
 * 场记板 logo（inline SVG，颜色走 --cs-* 令牌，随品牌预设与明暗主题联动）。
 *
 * 概念（brand-identity-proposal.md §5）：上半白板嵌画布点阵（连接品牌名与
 * 产品形态），下半斜条纹用品牌 accent —— "agent 是导演，用户喊 Action"。
 */
import type { ReactElement } from 'react'

export interface LogoMarkProps {
  /** 渲染宽度（px）；高度按 viewBox 比例 118:96 计算。 */
  size?: number
  /** 额外 className（默认取 csLogoMark）。 */
  className?: string
}

export function LogoMark(props: LogoMarkProps): ReactElement {
  const { size = 22, className = 'csLogoMark' } = props
  // 始终保留 csLogoMark（display: block / 脉冲动画 hook），传入的 className（如上游 hero
  // 槽的 css.fish）追加其后，避免宿主 css 覆盖导致布局错乱。
  const composedClassName = `csLogoMark ${className}`.trim()
  return (
    <svg
      className={composedClassName}
      width={size}
      height={Math.round(size * 96 / 118)}
      viewBox="0 0 118 96"
      role="img"
      aria-label="Canvas Studio 场记板"
    >
      {/* 顶部铰链条（CR-045：用主题令牌，明暗联动；不再硬编码灰） */}
      <rect x="0" y="0" width="118" height="11" rx="3" fill="var(--dsw-alias-border-l2, #E8E8E8)" />
      {/* 上半白板：画布点阵（accent） */}
      <rect x="0" y="11" width="46" height="85" fill="var(--dsw-alias-bg-layer-1, #F4F4F6)" />
      <circle cx="16" cy="34" r="3.2" fill="var(--cs-accent, #7C6CFF)" />
      <circle cx="31" cy="34" r="3.2" fill="var(--cs-accent, #7C6CFF)" opacity="0.5" />
      <circle cx="16" cy="52" r="3.2" fill="var(--cs-accent, #7C6CFF)" opacity="0.5" />
      <circle cx="31" cy="52" r="3.2" fill="var(--cs-accent, #7C6CFF)" />
      <circle cx="16" cy="70" r="3.2" fill="var(--cs-accent, #7C6CFF)" />
      <circle cx="31" cy="70" r="3.2" fill="var(--cs-accent, #7C6CFF)" opacity="0.5" />
      <circle cx="16" cy="88" r="3.2" fill="var(--cs-accent, #7C6CFF)" opacity="0.5" />
      <circle cx="31" cy="88" r="3.2" fill="var(--cs-accent, #7C6CFF)" />
      {/* 下半斜条纹板（accent） */}
      <rect x="46" y="11" width="72" height="85" fill="var(--cs-accent, #7C6CFF)" />
      <g stroke="var(--cs-accent-deep, #5B4BD6)" strokeWidth="13" opacity="0.55">
        <line x1="46" y1="96" x2="82" y2="60" />
        <line x1="66" y1="96" x2="102" y2="60" />
        <line x1="86" y1="96" x2="118" y2="68" />
      </g>
    </svg>
  )
}
