/**
 * 技能广场客户端元数据（CV-065 Phase B）。
 *
 * 诚实边界：这份清单是**展示层**数据，与 `skills/` 目录里的真实 skill 是
 * 两份东西。之所以不走 SKILL.md frontmatter 扩展，是因为上游 skill 严禁改编
 * （skill-expansion-spec.md 第 1 条）—— 不能往 H3 原版 SKILL.md 里塞
 * category / icon / 中文标题。
 *
 * 一致性靠测试兜底：`tests/skill-catalog.test.mjs` 断言 `skills/` 下每个已注册
 * skill 都能在本表取到条目，新增 skill 忘记补表会直接红。
 *
 * 放 src/ 根目录而非 src/client/ —— Host tsconfig 排除了 src/client/**，
 * 单测要直连编译产物 lib/skill-catalog.js。
 */
/** 广场侧栏分类（顺序即展示顺序）。 */
export declare const SKILL_CATEGORY_IDS: readonly ["spec", "prompting", "marketing", "style", "audio", "other"];
export type SkillCategoryId = (typeof SKILL_CATEGORY_IDS)[number];
/** 分类中文名。 */
export declare const SKILL_CATEGORY_LABELS: Record<SkillCategoryId, string>;
/** 卡片图标 id（由 client 侧 SkillIcon 组件映射为 inline SVG）。 */
export declare const SKILL_ICON_IDS: readonly ["compass", "quill", "megaphone", "film", "music", "puzzle"];
export type SkillIconId = (typeof SKILL_ICON_IDS)[number];
export interface SkillCatalogEntry {
    /** skill 注册名（与 skills/<name>/ 目录名逐字一致）。 */
    name: string;
    /** 卡片中文标题。 */
    title: string;
    /** 卡片一句话说明（≤ 60 字，UI 按 2 行截断）。 */
    summary: string;
    category: SkillCategoryId;
    icon: SkillIconId;
    /** 缩略图与强调色色相（0-360）；UI 用 hsl() 现算，明暗主题自适应。 */
    hue: number;
    /** 是否进 lobby「推荐技能」横滚。 */
    featured: boolean;
}
/** 展示元数据清单（featured 排前，其余按分类顺序）。 */
export declare const SKILL_CATALOG: readonly SkillCatalogEntry[];
/** 按注册名取展示元数据；未收录（新增 skill 忘了补表）返回 null，不抛错。 */
export declare function getSkillEntry(name: string): SkillCatalogEntry | null;
/** 某分类下的全部技能。 */
export declare function skillsByCategory(category: SkillCategoryId): SkillCatalogEntry[];
/** 每个分类下的技能数（侧栏角标用，含 0 的分类）。 */
export declare function skillCountByCategory(): Record<SkillCategoryId, number>;
/**
 * lobby 横滚的推荐技能：featured 优先，不足则用其余条目补齐。
 * @param limit - 返回条数上限（默认 8）。
 */
export declare function recommendedSkills(limit?: number): SkillCatalogEntry[];
