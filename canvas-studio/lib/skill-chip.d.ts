/** 技能引用最小结构（skill-catalog 条目的子集，便于测试与解耦）。 */
export interface SkillRefEntry {
    /** skill 注册名（与 skills/<name>/ 目录名逐字一致），occurrence.ref 用它。 */
    readonly name: string;
    /** 卡片中文标题。 */
    readonly title: string;
    /** 一句话说明（菜单 description / hover 卡片正文）。 */
    readonly summary?: string;
}
/** chip 字形前缀：占上游 chip 渲染的「图标位」。 */
export declare const SKILL_CHIP_GLYPH = "\u26A1";
/** chip 显示文案：`⚡手绘发光动画`（超长按码点截断，空标题落兜底）。 */
export declare function skillChipLabel(title: string): string;
/** 提交给模型的文本（与「使用」按钮历史注入的纯文本逐字一致，勿改格式）。 */
export declare function formatSkillToken(name: string, title: string): string;
/**
 * 按 chip 文本反查技能（hover 命中）：注册名精确 → 标题精确 → 截断标题前缀。
 * 截断尾是 `…` 时先剥掉再做前缀匹配；前缀至少 2 字防误命中。
 */
export declare function findSkillByChipLabel(skills: readonly SkillRefEntry[], text: string): SkillRefEntry | undefined;
/** `/` 菜单候选过滤（name / title / summary 包含匹配；空 query 返回全量）。 */
export declare function filterSkillEntries(skills: readonly SkillRefEntry[], query: string): SkillRefEntry[];
