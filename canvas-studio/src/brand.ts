/**
 * Canvas Studio 品牌令牌（可切换配色预设）。
 *
 * 纯数据 + 纯函数，无 DOM 依赖：Host/Client 双半均可编译，`node --test` 可直连
 * （tests/brand.test.mjs 直连 lib/brand.js）。DOM 注入逻辑在
 * `src/client/brand-inject.ts`，UI 组件在 `src/client/brand/`。
 *
 * 设计约束（brand-identity-proposal.md §3）：
 * - 令牌命名空间 `--cs-*`，叠加在 dsh `--dsw-alias-*` 语义令牌之上，不推翻宿主；
 * - 配色做成多预设可切换（Q3 拍板 2026-08-31）：切换只动 accent 族，gold/teal
 *   固定功能色与宿主语义色不变；
 * - 明暗双轨：浅色默认取 accentDeep，深色经 `body[data-ds-dark-theme]` 覆盖取 accent。
 */
export const BRAND_PRESET_IDS = ['cinema-violet', 'ocean-blue', 'ember-violet', 'amber-creative'] as const
export type BrandPresetId = (typeof BRAND_PRESET_IDS)[number]

/** 一套品牌配色的 accent 族 + 画布底色。 */
export interface BrandPreset {
  readonly id: BrandPresetId
  /** 设置页展示名。 */
  readonly label: string
  /** 一句话方向说明。 */
  readonly description: string
  /** 主品牌色（暗色）。 */
  readonly accent: string
  /** hover / 高亮。 */
  readonly accentStrong: string
  /** pressed / 明色主色。 */
  readonly accentDeep: string
  /** 选中背景（暗色 alpha）。 */
  readonly accentSoft: string
  /** 选中背景（明色 alpha）。 */
  readonly accentSoftLight: string
  /** 画布区底色（比宿主深一档）。 */
  readonly canvasBg: string
  /** 画布区一级底色。 */
  readonly canvasBgL1: string
  /** 画布网格线。 */
  readonly canvasGrid: string
  /** 画布主网格线。 */
  readonly canvasGridMajor: string
}

export const DEFAULT_BRAND_PRESET: BrandPresetId = 'cinema-violet'

/** 四套品牌配色预设（默认 + 3 备选，用户可在设置页「外观」区切换）。 */
export const BRAND_PRESETS: Record<BrandPresetId, BrandPreset> = {
  'cinema-violet': {
    id: 'cinema-violet',
    label: '电影紫',
    description: 'AI 创作行业色 · 默认',
    accent: '#7C6CFF',
    accentStrong: '#9D8DFF',
    accentDeep: '#5B4BD6',
    accentSoft: 'rgba(124, 108, 255, 0.14)',
    accentSoftLight: 'rgba(91, 75, 214, 0.12)',
    canvasBg: '#0F1117',
    canvasBgL1: '#1A1D29',
    canvasGrid: 'rgba(255, 255, 255, 0.045)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.07)',
  },
  'ocean-blue': {
    id: 'ocean-blue',
    label: '海洋蓝',
    description: '偏蓝 · 贴近宿主',
    accent: '#5B7CFF',
    accentStrong: '#7E9BFF',
    accentDeep: '#3E5CD6',
    accentSoft: 'rgba(91, 124, 255, 0.14)',
    accentSoftLight: 'rgba(62, 92, 214, 0.12)',
    canvasBg: '#0E1118',
    canvasBgL1: '#182031',
    canvasGrid: 'rgba(255, 255, 255, 0.045)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.07)',
  },
  'ember-violet': {
    id: 'ember-violet',
    label: '炽焰紫',
    description: '更紫 · 高饱和戏剧感',
    accent: '#8B5CF6',
    accentStrong: '#A78BFA',
    accentDeep: '#6D28D9',
    accentSoft: 'rgba(139, 92, 246, 0.14)',
    accentSoftLight: 'rgba(109, 40, 217, 0.12)',
    canvasBg: '#120F18',
    canvasBgL1: '#1F1930',
    canvasGrid: 'rgba(255, 255, 255, 0.045)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.07)',
  },
  'amber-creative': {
    id: 'amber-creative',
    label: '琥珀金',
    description: '暖金 · 创作激情 / 胶片方向',
    accent: '#F0A94B',
    accentStrong: '#F5C273',
    accentDeep: '#C97F2E',
    accentSoft: 'rgba(240, 169, 75, 0.16)',
    accentSoftLight: 'rgba(201, 127, 46, 0.14)',
    canvasBg: '#14110E',
    canvasBgL1: '#241E15',
    canvasGrid: 'rgba(255, 255, 255, 0.045)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.07)',
  },
}

/** 固定功能色（不随预设切换）：gold = HITL 审批，teal = 播放 / 预览。 */
export const BRAND_FIXED = {
  gold: '#E8B45A',
  teal: '#35C2A6',
} as const

/** 未知 / 空 id 一律回退默认预设（设置文档损坏或旧版本无该字段时兜底）。 */
export function resolveBrandPreset(id: string | null | undefined): BrandPreset {
  if (id !== null && id !== undefined && id in BRAND_PRESETS) return BRAND_PRESETS[id as BrandPresetId]
  return BRAND_PRESETS[DEFAULT_BRAND_PRESET]
}

/** 非配色令牌（间距 / 圆角 / 阴影 / 动效），不随预设切换。 */
const NON_COLOR_TOKENS: readonly (readonly [string, string])[] = [
  // 间距（4px 基数）
  ['--cs-space-1', '4px'],
  ['--cs-space-2', '8px'],
  ['--cs-space-3', '12px'],
  ['--cs-space-4', '16px'],
  ['--cs-space-5', '24px'],
  ['--cs-space-6', '32px'],
  ['--cs-space-7', '48px'],
  // 圆角
  ['--cs-radius-sm', '6px'],
  ['--cs-radius-md', '8px'],
  ['--cs-radius-lg', '12px'],
  ['--cs-radius-pill', '999px'],
  // 阴影（暗色多层）
  ['--cs-shadow-1', '0 1px 2px rgba(0, 0, 0, 0.4)'],
  ['--cs-shadow-2', '0 4px 12px rgba(0, 0, 0, 0.45)'],
  ['--cs-shadow-3', '0 12px 32px rgba(0, 0, 0, 0.55)'],
  // 动效
  ['--cs-duration-fast', '120ms'],
  ['--cs-duration-base', '200ms'],
  ['--cs-duration-slow', '320ms'],
  ['--cs-ease', 'cubic-bezier(0.2, 0, 0, 1)'],
]

const renderPairs = (pairs: readonly (readonly [string, string])[]): string =>
  pairs.map(([name, value]) => `  ${name}: ${value};`).join('\n')

/**
 * 生成某预设的完整 `--cs-*` 令牌 CSS 文本。
 *
 * 结构：`[data-cs-brand="<id>"]`（浅色默认：accent 取 deep、画布底浅色）
 * + `body[data-ds-dark-theme] [data-cs-brand="<id>"]`（深色：accent 取主色）。
 * 固定功能色与非配色令牌在两块都注入。切换 = 更新元素 textContent 与
 * `data-cs-brand` 属性（见 src/client/brand-inject.ts）。
 */
export function brandCssText(presetId: string | null | undefined): string {
  const preset = resolveBrandPreset(presetId)
  const light: readonly (readonly [string, string])[] = [
    ['--cs-accent', preset.accentDeep],
    ['--cs-accent-strong', preset.accentDeep],
    ['--cs-accent-deep', preset.accentDeep],
    ['--cs-accent-soft', preset.accentSoftLight],
    ['--cs-canvas-bg', '#F7F7FA'],
    ['--cs-canvas-bg-l1', '#EFEFF4'],
    ['--cs-canvas-grid', 'rgba(15, 17, 23, 0.05)'],
    ['--cs-canvas-grid-major', 'rgba(15, 17, 23, 0.09)'],
  ]
  const dark: readonly (readonly [string, string])[] = [
    ['--cs-accent', preset.accent],
    ['--cs-accent-strong', preset.accentStrong],
    ['--cs-accent-deep', preset.accentDeep],
    ['--cs-accent-soft', preset.accentSoft],
    ['--cs-canvas-bg', preset.canvasBg],
    ['--cs-canvas-bg-l1', preset.canvasBgL1],
    ['--cs-canvas-grid', preset.canvasGrid],
    ['--cs-canvas-grid-major', preset.canvasGridMajor],
    ['--cs-glow-accent', `0 0 0 1px var(--cs-accent-soft), 0 0 16px ${preset.accent}40`],
  ]
  const fixed: readonly (readonly [string, string])[] = [
    ['--cs-gold', BRAND_FIXED.gold],
    ['--cs-teal', BRAND_FIXED.teal],
  ]
  const fixedText = renderPairs(fixed)
  const nonColorText = renderPairs(NON_COLOR_TOKENS)
  return [
    `[data-cs-brand="${preset.id}"] {`,
    fixedText,
    nonColorText,
    renderPairs(light),
    '}',
    `body[data-ds-dark-theme] [data-cs-brand="${preset.id}"] {`,
    renderPairs(dark),
    '}',
  ].join('\n')
}

/** 品牌 favicon（单色场记板简化形，data: URL，零外部请求）。 */
export const FAVICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<rect x="2" y="2" width="28" height="6" rx="2" fill="#E8E8E8"/>'
  + '<rect x="2" y="8" width="11" height="22" fill="#F4F4F6"/>'
  + '<circle cx="6.5" cy="13.5" r="1.8" fill="#7C6CFF"/>'
  + '<circle cx="10.5" cy="13.5" r="1.8" fill="#7C6CFF" opacity="0.45"/>'
  + '<circle cx="6.5" cy="19" r="1.8" fill="#7C6CFF" opacity="0.45"/>'
  + '<circle cx="10.5" cy="19" r="1.8" fill="#7C6CFF"/>'
  + '<circle cx="6.5" cy="24.5" r="1.8" fill="#7C6CFF"/>'
  + '<circle cx="10.5" cy="24.5" r="1.8" fill="#7C6CFF" opacity="0.45"/>'
  + '<rect x="13" y="8" width="17" height="22" fill="#7C6CFF"/>'
  + '<path d="M13 30l7-7 4-4 5-5v7l-4 4-4 4z" fill="#5B4BD6" opacity="0.55"/>'
  + '<path d="M20 23l4-4 5-5" stroke="#5B4BD6" stroke-width="3" fill="none" opacity="0.55"/>'
  + '</svg>',
)}`
