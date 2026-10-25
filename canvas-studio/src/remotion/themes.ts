/**
 * 主题预设（theme preset）：**一套视觉基线**，一次展开成底色 / 背景层 / 强调色 / 动效基线。
 *
 * ## 为什么是"脚手架参数"而不是 manifest 字段
 *
 * 加 `meta.themeId` 会让 manifest 多一个**不影响渲染**的字段（渲染器只认展开后的颜色），
 * 这正好是「两套事实」的温床：theme 说强调色是 A，轨道里写的是 B，谁也不报错。
 * 所以本仓的做法是：**theme 只活在 `scaffold_manifest` 的参数里**，展开后写进 manifest
 * 的就是最终颜色值 —— manifest 里没有 themeId，也就没有漂移。
 *
 * 与 `layout_table` 同一套哲学：工作台可以有抽象，产物只存真值。
 *
 * ## 为什么只有深色主题
 *
 * `textCard` 的正文色由 variant 固定为浅色系（`#e6edf3`），浅底主题会直接看不清。
 * 在「文字色可配置」落地之前，提供浅色主题等于提供一个必然难看的选项 —— 所以不做。
 */
export interface ThemePreset {
  /** 主题 id（`scaffold_manifest` 的 `theme` 参数取值）。 */
  readonly id: string
  /** 人读名字（给用户看的，不是字段值）。 */
  readonly title: string
  /** 画布底色（`meta.backgroundColor`）。 */
  readonly backgroundColor: string
  /** 全片背景层（第一轨 gradient 的 color）。 */
  readonly backgroundLayer: string
  /** 强调色：数据卡的数值、关键形状、进度条。 */
  readonly accent: string
  /** 正文色（当前由 variant 固定，这里只作说明与将来接线用）。 */
  readonly textColor: string
  /** 动效基线：不是运行时注入，而是给写轨时的一个统一起点。 */
  readonly motion: {
    readonly unitDurationInFrames: number
    readonly wordDelayFrames: number
    readonly easing: string
  }
  /** 这套主题的适用片型与注意点。 */
  readonly note: string
}

/** 缺省主题 —— 与既有骨架同色，保证「不传 theme」时像素不变。 */
export const DEFAULT_THEME_ID = 'cold-tech'

export const THEMES: Readonly<Record<string, ThemePreset>> = {
  'cold-tech': {
    id: 'cold-tech',
    title: '冷调科技',
    backgroundColor: '#0B1220',
    backgroundLayer: '#111827',
    accent: '#22D3EE',
    textColor: '#E6EDF3',
    motion: { unitDurationInFrames: 12, wordDelayFrames: 2, easing: 'easeOutCubic' },
    note: '科普 / 数据 / 产品解说。青蓝强调色在深底上对比足够，适合大量图表与代码 UI。',
  },
  'ink-press': {
    id: 'ink-press',
    title: '墨印（提亮版）',
    backgroundColor: '#14110F',
    backgroundLayer: '#1F1A17',
    accent: '#E8503A',
    textColor: '#F5EFE6',
    motion: { unitDurationInFrames: 14, wordDelayFrames: 3, easing: 'easeOutCubic' },
    note: '人文 / 纪录 / 品牌片。**注意**：原始 ink-press 底色过暗（实测灰卡 MAE 不足），这里整体提亮了约 8%，朱红强调色保持不变。',
  },
  'warm-ember': {
    id: 'warm-ember',
    title: '暖烬',
    backgroundColor: '#170F0C',
    backgroundLayer: '#241612',
    accent: '#F0A03C',
    textColor: '#F7EDE2',
    motion: { unitDurationInFrames: 13, wordDelayFrames: 3, easing: 'easeOutCubic' },
    note: '人物故事 / 情感线 / 怀旧。暖橙强调色适合人脸与材质特写，不适合大面积冷色素材。',
  },
  'neon-data': {
    id: 'neon-data',
    title: '霓虹数据',
    backgroundColor: '#05070A',
    backgroundLayer: '#0B1016',
    accent: '#7CFFB2',
    textColor: '#D6F5E3',
    motion: { unitDurationInFrames: 10, wordDelayFrames: 1, easing: 'easeOutCubic' },
    note: '高对比数据演示 / 赛博题材。底色近纯黑，荧光绿强调 —— 节奏可以比其它主题快一档。',
  },
}

/**
 * 解析 theme id；未知值回缺省。
 *
 * ⚠️ **生产路径走不到 `fellBack`**：`scaffold_manifest` 的 `theme` 参数是 `enum`，
 * 传错值在 schema 层就被拒（`"theme" must be one of [...]`）—— 这是好事（硬拦比静默换色好），
 * 所以这里的分支只在 `execute` 被**绕过 schema 直接调用**时生效（测试、内部复用）。
 * 保留而不删的理由：直接调用是真实存在的路径（本仓测试大量这么干），删掉会得到
 * 一套"静默换色"的行为。写在这里是为了让下一个人知道它是兜底，不是主路。
 */
export function resolveTheme(id: unknown): { theme: ThemePreset; fellBack: boolean } {
  if (typeof id === 'string') {
    const found = THEMES[id.trim()]
    if (found !== undefined) return { theme: found, fellBack: false }
    if (id.trim() !== '') return { theme: THEMES[DEFAULT_THEME_ID] as ThemePreset, fellBack: true }
  }
  return { theme: THEMES[DEFAULT_THEME_ID] as ThemePreset, fellBack: false }
}

/** 给 agent 的"这套主题怎么用"说明（写进 scaffold_manifest 的返回文本）。 */
export function themeGuidance(theme: ThemePreset): string {
  return `主题 **${theme.id}**（${theme.title}）：强调色 \`${theme.accent}\`、正文 \`${theme.textColor}\`；`
    + `动效基线：单元素入场 ${String(theme.motion.unitDurationInFrames)} 帧、错峰 ${String(theme.motion.wordDelayFrames)} 帧/单元、${theme.motion.easing}。`
    + `\n适用：${theme.note}`
    + '\n用法：数据卡的数值 / 关键形状 / 进度条用强调色；其余保持背景层，**不要再引入第三种主色**。'
}
