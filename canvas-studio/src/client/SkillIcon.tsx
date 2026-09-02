/**
 * 技能广场图标（CV-065）：inline SVG，按 `SkillIconId` 映射。
 *
 * 不用 emoji —— 跨平台字形差异大，且在明暗主题下颜色不可控。全部走
 * `currentColor` + stroke，跟主题和卡片强调色自动联动。
 */
import type { ReactElement } from 'react'
import type { SkillIconId } from '../skill-catalog.js'

export interface SkillIconProps {
  /** 图标 id（来自 skill-catalog 的 icon 字段）。 */
  id: SkillIconId
  /** 边长（px），默认 20。 */
  size?: number
}

/** 按 id 渲染技能图标（id 未收录时落兜底的「方块横线」，不会渲染空白）。 */
export function SkillIcon(props: SkillIconProps): ReactElement {
  const { id, size = 20 } = props
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (id) {
    case 'compass':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <polygon points="15.5 8.5 13 13 8.5 15.5 11 11 15.5 8.5" />
        </svg>
      )
    case 'quill':
      return (
        <svg {...common}>
          <path d="M20 4 10 14l-4 4 4-4L20 4Z" />
          <path d="M14 10c0 5-4 8-9 8" />
        </svg>
      )
    case 'megaphone':
      return (
        <svg {...common}>
          <path d="M4 10v4l11 5V5L4 10Z" />
          <path d="M15 8a4 4 0 0 1 0 8" />
          <path d="M6 16v4h3v-3.2" />
        </svg>
      )
    case 'film':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="8" y1="4" x2="8" y2="20" />
          <line x1="16" y1="4" x2="16" y2="20" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="3" y1="14" x2="21" y2="14" />
        </svg>
      )
    case 'music':
      return (
        <svg {...common}>
          <circle cx="7" cy="18" r="2.5" />
          <circle cx="18" cy="16" r="2.5" />
          <path d="M9.5 18V7l11-2v11" />
        </svg>
      )
    case 'puzzle':
      return (
        <svg {...common}>
          <path d="M10 4h4v2a2 2 0 1 0 4 0V4h2v6h-2a2 2 0 1 0 0 4h2v6h-6v-2a2 2 0 1 0-4 0v2H4v-6h2a2 2 0 1 0 0-4H4V4h6Z" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <line x1="9" y1="10" x2="15" y2="10" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      )
  }
}
