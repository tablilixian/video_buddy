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
    canvasGrid: 'rgba(255, 255, 255, 0.06)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.11)',
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
    canvasGrid: 'rgba(255, 255, 255, 0.06)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.11)',
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
    canvasGrid: 'rgba(255, 255, 255, 0.06)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.11)',
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
    canvasGrid: 'rgba(255, 255, 255, 0.06)',
    canvasGridMajor: 'rgba(255, 255, 255, 0.11)',
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

/** 非配色令牌（间距 / 圆角 / 阴影 / 动效 / 景深 / 字阶），不随预设切换。 */
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
  // 景深（DD-02：选中时非血缘节点降到该不透明度）
  ['--cs-dim', '0.42'],
  // 节点不透明度乘法链（DD-03）：三层各写**一个乘数**，由 `.csNode` 的
  // calc(var(--cs-node-opacity) * var(--cs-node-state) * var(--cs-node-dim))
  // 统一算。放在这里而不是散在组件里，理由有二：
  // (a) 三者与 --cs-dim 同属「节点视觉契约」的旋钮，该有名字有默认值；
  // (b) tests/visual-tokens.test.mjs 的幽灵令牌守卫要求：styles.ts 引用到的
  //     每个 --cs-* 都必须在本文件有定义 —— 内部变量不能借 --cs- 命名空间蒙混。
  ['--cs-node-opacity', '1'],
  ['--cs-node-state', '1'],
  ['--cs-node-dim', '1'],
  // C10：--cs-chip-bg / --cs-chip-line / --cs-chip-fg 已删除。
  // C2 造这三个是**被迫**的：角标压在画面上，底和字必须自带，否则亮画面上的
  // 深字会消失。C10 把角标收进卡片的头/脚两行之后，底下就是节点面 ——
  // 材料交回宿主的交互面令牌（--dsw-alias-interactive-bg-hover / accent-soft），
  // 明暗两轨的对比度由宿主保证，插件不必再自造一层墨底。
  // 按棘轮纪律：空转的令牌**删掉**，不是把基线重新冻结一遍。
  // 字阶六级（DD-01：收口 styles.ts 原有 11 种离散 font-size）
  ['--cs-fs-xs', '11px'],
  ['--cs-fs-sm', '12px'],
  ['--cs-fs-md', '13px'],
  ['--cs-fs-lg', '14px'],
  ['--cs-fs-xl', '18px'],
  ['--cs-fs-2xl', '24px'],
]

/**
 * 界面骨架表面令牌（DD-02 空间三档）：壳 → 画布 → 节点 → 浮层。
 *
 * 不随预设切换（预设只动 accent 族，见 §3 设计约束），但**分明明暗两轨** ——
 * 深色下画布最暗、壳居中、节点最亮；浅色下反向压出对比。宿主已有的
 * `--dsw-alias-bg-layer-*` 表达的是宿主意图（弹层 / 卡片），与「制作现场」
 * 的空间语义不同名，故单列一族，不抢宿主令牌。
 */
const SURFACE_LIGHT: readonly (readonly [string, string])[] = [
  ['--cs-shell', '#FFFFFF'],
  ['--cs-shell-2', '#FAFAFC'],
  ['--cs-node', '#FFFFFF'],
  ['--cs-node-hi', '#F4F5FA'],
  ['--cs-float', '#FFFFFF'],
  ['--cs-line', 'rgba(15, 17, 23, 0.08)'],
  ['--cs-line-hi', 'rgba(15, 17, 23, 0.16)'],
  // DD-03：片门暗带 —— 媒体窗口上下那两道极窄的「胶片闸门」。浅色下用
  // 高不透明度的墨色（读成 #3A3C44 附近），而不是纯黑：纯黑在满屏白卡里
  // 读成「描边」而不是「闸门」，且与 #000 的角标底撞色。
  ['--cs-gate', 'rgba(15, 17, 23, 0.82)'],
  // DD-03：生成中遮罩。浅色下必须是**亮**遮罩 —— 沿用暗色那层墨底会让
  // 正在生成的卡片变成一块黑板，与整屏浅色直接打架。
  ['--cs-scrim', 'rgba(252, 252, 254, 0.9)'],
]

const SURFACE_DARK: readonly (readonly [string, string])[] = [
  ['--cs-shell', '#15171E'],
  ['--cs-shell-2', '#1A1D26'],
  ['--cs-node', '#1E2230'],
  ['--cs-node-hi', '#252A3B'],
  ['--cs-float', '#22273A'],
  ['--cs-line', 'rgba(255, 255, 255, 0.075)'],
  ['--cs-line-hi', 'rgba(255, 255, 255, 0.14)'],
  // 暗色片门比画布（#0F1117 / 预设 canvasBg）再深一档 —— 「闸门」的语义就是
  // 比工作台更暗的那道缝。
  ['--cs-gate', '#0B0D12'],
  ['--cs-scrim', 'rgba(11, 13, 18, 0.86)'],
]

const renderPairs = (pairs: readonly (readonly [string, string])[]): string =>
  pairs.map(([name, value]) => `  ${name}: ${value};`).join('\n')

/**
 * 生成某预设的完整 `--cs-*` 令牌 CSS 文本。
 *
 * 结构：`body[data-cs-brand="<id>"]`（浅色默认：accent 取 deep、画布底浅色）
 * + `body[data-ds-dark-theme][data-cs-brand="<id>"]`（深色：accent 取主色）。
 * 属性锚在 `document.body` 上（CSS 自定义属性沿 DOM 树向下继承，body 下的
 * 全部 UI 才能拿到令牌；此前锚在 <style> 元素自身导致令牌永不生效）。
 * 固定功能色与非配色令牌在两块都注入。切换 = 更新元素 textContent 与
 * body 上的 `data-cs-brand` 属性（见 src/client/brand-inject.ts）。
 */
export function brandCssText(presetId: string | null | undefined): string {
  const preset = resolveBrandPreset(presetId)
  const light: readonly (readonly [string, string])[] = [
    ['--cs-accent', preset.accentDeep],
    ['--cs-accent-strong', preset.accentDeep],
    ['--cs-accent-deep', preset.accentDeep],
    ['--cs-accent-soft', preset.accentSoftLight],
    ['--cs-canvas-bg', '#EFEFF4'],
    ['--cs-canvas-bg-l1', '#F7F7FA'],
    ['--cs-canvas-grid', 'rgba(15, 17, 23, 0.06)'],
    ['--cs-canvas-grid-major', 'rgba(15, 17, 23, 0.11)'],
    // DD-03：选中光晕。**浅色轨此前完全没有这个令牌** —— 它只在暗色块里定义，
    // 于是浅色主题下 var(--cs-glow-accent) 一路退回空值，选中态只剩 border-color
    // 一根 1px 线（DD-02 把同色描边拆掉后，选中几乎看不出来）。浅色的光晕要
    // 更收敛、更贴地（2px 偏移 / 14px 扩散），暗色可以更亮更散。
    ['--cs-glow-accent', '0 0 0 1px var(--cs-accent-soft), 0 2px 14px color-mix(in srgb, var(--cs-accent) 26%, transparent)'],
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
    // 光晕色由 `--cs-accent` 现场混出（不再把 preset.accent 直接拼进字符串）：
    // 一条公式同吃四个预设、两条明暗轨，改预设时不必再动这里。
    ['--cs-glow-accent', '0 0 0 1px var(--cs-accent-soft), 0 0 18px color-mix(in srgb, var(--cs-accent) 32%, transparent)'],
  ]
  const fixed: readonly (readonly [string, string])[] = [
    ['--cs-gold', BRAND_FIXED.gold],
    ['--cs-teal', BRAND_FIXED.teal],
  ]
  const fixedText = renderPairs(fixed)
  const nonColorText = renderPairs(NON_COLOR_TOKENS)
  return [
    `body[data-cs-brand="${preset.id}"] {`,
    fixedText,
    nonColorText,
    renderPairs(SURFACE_LIGHT),
    renderPairs(light),
    '}',
    `body[data-ds-dark-theme][data-cs-brand="${preset.id}"] {`,
    renderPairs(SURFACE_DARK),
    renderPairs(dark),
    '}',
  ].join('\n')
}

/**
 * 品牌 favicon（V2 Aperture Squircle 简化形，data: URL，零外部请求）。
 * 几何与 scripts/build-brand-assets.mjs 的 favicon.svg 同源（32 网格）：方形
 * squircle + 左侧铰链缝（负空间）+ 两道正片 deep 斜条纹。favicon 无法吃主题令牌，
 * 故硬编码默认预设 cinema-violet 的两色（#7C6CFF 主体 / #5B4BD6 条纹）。
 */
export const FAVICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">'
  + '<path fill-rule="evenodd" d="M10 2 H22 A8 8 0 0 1 30 10 V22 A8 8 0 0 1 22 30 H10 A8 8 0 0 1 2 22 V10 A8 8 0 0 1 10 2 Z M8 13 H30 V17 H8 Z" fill="#7C6CFF"/>'
  + '<g fill="#5B4BD6"><path d="M9 11 L13 11 L16 4 L12 4 Z"/><path d="M18 11 L22 11 L25 4 L21 4 Z"/></g>'
  + '</svg>',
)}`
