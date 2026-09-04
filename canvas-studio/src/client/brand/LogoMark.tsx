/**
 * 品牌 mark（inline SVG，颜色走 --cs-* 令牌，随品牌预设与明暗主题联动）。
 *
 * 定稿方向 = V2「Aperture Squircle」（brand-identity-proposal.md §5 已拍板）：
 * 一整块 squircle 板体，用负空间切出左侧铰链缝与画布窗，窗内 3×2 点阵；
 * 顶区两道深紫斜条纹是场记板的识别锚点。几何与 assets/brand/logo.svg（由
 * scripts/build-brand-assets.mjs 生成）同源 —— 64 网格，此处用令牌以便明暗/预设联动。
 */
import type { ReactElement } from 'react'

export interface LogoMarkProps {
  /** 渲染尺寸（px）；mark 为 1:1 方形。 */
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
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Canvas Studio"
    >
      {/* 主体 squircle：铰链缝 + 画布窗为负空间（evenodd 镂空）。 */}
      <path
        fillRule="evenodd"
        fill="var(--cs-accent, #7C6CFF)"
        d="M20 4 H44 A16 16 0 0 1 60 20 V44 A16 16 0 0 1 44 60 H20 A16 16 0 0 1 4 44 V20 A16 16 0 0 1 20 4 Z M12 26 H60 V31 H12 Z M22 38 H42 A6 6 0 0 1 48 44 V48 A6 6 0 0 1 42 54 H22 A6 6 0 0 1 16 48 V44 A6 6 0 0 1 22 38 Z"
      />
      {/* 顶区两道斜条纹（场记板识别锚点，deep）。 */}
      <g fill="var(--cs-accent-deep, #5B4BD6)">
        <path d="M10 24 L20 24 L30 8 L20 8 Z" />
        <path d="M26 24 L36 24 L46 8 L36 8 Z" />
      </g>
      {/* 画布点阵（3 列 × 2 行，accent）。 */}
      <g fill="var(--cs-accent, #7C6CFF)">
        <circle cx="23" cy="43" r="2.6" />
        <circle cx="32" cy="43" r="2.6" />
        <circle cx="41" cy="43" r="2.6" />
        <circle cx="23" cy="49" r="2.6" />
        <circle cx="32" cy="49" r="2.6" />
        <circle cx="41" cy="49" r="2.6" />
      </g>
    </svg>
  )
}
