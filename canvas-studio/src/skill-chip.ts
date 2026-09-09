/**
 * CV-124：技能接入聊天输入框引用管线的纯函数层（Host/Client 共用，无副作用）。
 *
 * 技能 chip 的三个面在这里统一定义：
 * - **输入框 chip 显示** `⚡手绘发光动画`——上游 chip 渲染时把 `label[0]` 当
 *   触发字形（appearance 省略走 `{text[0]} + {text.slice(1)}` 分支），而
 *   ReferenceIcon 只有 session/file/folder 三种、没有技能语义图标，于是
 *   用 ⚡ 字形顶图标位，得到 WorkBuddy 同款「图标 + 短名」胶囊；
 * - **提交给模型的文本** 维持 `使用技能「标题」（name）：`——与 CV-065
 *   「使用」按钮历史注入的纯文本逐字一致，agent 侧软激活零改动；
 * - **`/` 菜单候选** 按 name / title / summary 匹配（大小写不敏感）。
 */
import { truncateLabel } from './reference-handle.js'

/** 技能引用最小结构（skill-catalog 条目的子集，便于测试与解耦）。 */
export interface SkillRefEntry {
  /** skill 注册名（与 skills/<name>/ 目录名逐字一致），occurrence.ref 用它。 */
  readonly name: string
  /** 卡片中文标题。 */
  readonly title: string
  /** 一句话说明（菜单 description / hover 卡片正文）。 */
  readonly summary?: string
}

/** chip 字形前缀：占上游 chip 渲染的「图标位」。 */
export const SKILL_CHIP_GLYPH = '⚡'

/** chip 显示文案：`⚡手绘发光动画`（超长按码点截断，空标题落兜底）。 */
export function skillChipLabel(title: string): string {
  const trimmed = title.trim()
  return `${SKILL_CHIP_GLYPH}${trimmed === '' ? '技能' : truncateLabel(trimmed, 12)}`
}

/** 提交给模型的文本（与「使用」按钮历史注入的纯文本逐字一致，勿改格式）。 */
export function formatSkillToken(name: string, title: string): string {
  return `使用技能「${title}」（${name}）：`
}

/**
 * 按 chip 文本反查技能（hover 命中）：注册名精确 → 标题精确 → 截断标题前缀。
 * 截断尾是 `…` 时先剥掉再做前缀匹配；前缀至少 2 字防误命中。
 */
export function findSkillByChipLabel(
  skills: readonly SkillRefEntry[],
  text: string,
): SkillRefEntry | undefined {
  const raw = text.trim()
  // 可选的 @ 前缀 + ⚡ 字形都剥掉再匹配（容气泡 title 等带前缀形态）。
  const body = raw.replace(/^@?/u, '').replace(SKILL_CHIP_GLYPH, '').trim()
  if (body === '') return undefined
  const key = body.toLowerCase()
  const stem = body.endsWith('…') ? [...body].slice(0, -1).join('').trim() : body
  const stemKey = stem.toLowerCase()
  return skills.find((skill) => skill.name.toLowerCase() === key)
    ?? skills.find((skill) => skill.title.trim() === body)
    ?? (stemKey.length >= 2
      ? skills.find((skill) => skill.title.trim().toLowerCase().startsWith(stemKey))
      : undefined)
}

/** `/` 菜单候选过滤（name / title / summary 包含匹配；空 query 返回全量）。 */
export function filterSkillEntries(
  skills: readonly SkillRefEntry[],
  query: string,
): SkillRefEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...skills]
  return skills.filter((skill) =>
    skill.name.toLowerCase().includes(q)
    || skill.title.toLowerCase().includes(q)
    || (skill.summary?.toLowerCase().includes(q) ?? false),
  )
}
