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
export const SKILL_CATEGORY_IDS = ['spec', 'prompting', 'marketing', 'style', 'audio', 'other'];
/** 分类中文名。 */
export const SKILL_CATEGORY_LABELS = {
    spec: '创作规范',
    prompting: '提示词技术',
    marketing: '营销广告',
    style: '视频风格',
    audio: '字幕配乐',
    other: '未分类',
};
/** 卡片图标 id（由 client 侧 SkillIcon 组件映射为 inline SVG）。 */
export const SKILL_ICON_IDS = ['compass', 'quill', 'megaphone', 'film', 'music', 'puzzle'];
/** 展示元数据清单（featured 排前，其余按分类顺序）。 */
export const SKILL_CATALOG = [
    // ---- 创作规范 ----
    {
        name: 'canvas-studio-creation',
        title: '画布创作总纲',
        summary: '需求澄清 → 分镜审批 → 关键帧 → 成片的标准串联流程，所有创作的默认规范。',
        category: 'spec',
        icon: 'compass',
        hue: 262,
        featured: true,
        hidden: true,
    },
    // ---- 提示词技术 ----
    {
        name: 'h3-prompt-writing',
        title: 'H3 视频提示词',
        summary: 'MiniMax H3 结构化写法：T2VA / I2VA / FL2VA / L2VA / Ref2VA 五种生成模式。',
        category: 'prompting',
        icon: 'quill',
        hue: 205,
        featured: true,
        h3: true,
        hidden: true,
    },
    {
        name: 'z-image-prompt-writing',
        title: 'Z-Image 生图提示词',
        summary: '文生图九段式结构、无负向提示词的正向改写规则、打光与文字渲染词表。',
        category: 'prompting',
        icon: 'quill',
        hue: 190,
        featured: true,
        hidden: true,
    },
    {
        name: 'qwen-image-edit-writing',
        title: '图生图与改图提示词',
        summary: '指令式四段式（操作+目标+规格+保留子句）、多参考图分工、分步链式改写。',
        category: 'prompting',
        icon: 'quill',
        hue: 220,
        featured: true,
        hidden: true,
    },
    // ---- 营销广告 ----
    {
        name: 'brand-promo-video-generator',
        title: '品牌宣传片',
        summary: '给 logo、产品图或官网链接，确认时长后自动产出品牌宣传成片。',
        category: 'marketing',
        icon: 'megaphone',
        hue: 12,
        featured: true,
        demo: 'brand-promo-video-generator.gif',
        h3: true,
    },
    {
        name: 'minimalist-product-ad-generator',
        title: '极简产品广告',
        summary: '从产品图提炼卖点，极简高质感分镜，适合电商主图视频与新品发布。',
        category: 'marketing',
        icon: 'megaphone',
        hue: 30,
        featured: false,
        demo: 'minimalist-product-ad-generator.gif',
        h3: true,
    },
    // ---- 视频风格 ----
    {
        name: '3d-animation-short-generator',
        title: '3D 动画短片',
        summary: '风格化 3D 短片：故事创意 → 角色/场景卡 → 标准化分镜的完整链路。',
        category: 'style',
        icon: 'film',
        hue: 275,
        featured: false,
        demo: '3d-animation-short-generator.gif',
        h3: true,
    },
    {
        name: 'co-op-game-intro-generator',
        title: '双人游戏开场',
        summary: '双人合作游戏菜单与开场动画：锁定双人身份线索，先出确认图再扩成片。',
        category: 'style',
        icon: 'film',
        hue: 148,
        featured: false,
        demo: 'co-op-game-intro-generator.gif',
        h3: true,
    },
    {
        name: 'handdrawn-live-video-generator',
        title: '手绘发光动画',
        summary: '手绘发光动画与实拍空间融合，蜡笔粉笔质感的超现实短视频。',
        category: 'style',
        icon: 'film',
        hue: 44,
        featured: false,
        demo: 'handdrawn-live-video-generator.gif',
        h3: true,
    },
    {
        name: 'paper-collage-explainer-generator',
        title: '纸拼贴科普',
        summary: '半调网点纸拼贴动画，讲知识点、观点与抽象话题的解说短片。',
        category: 'style',
        icon: 'film',
        hue: 20,
        featured: false,
        demo: 'paper-collage-explainer-generator.gif',
        h3: true,
    },
    {
        name: 'papercraft-stop-motion-explainer',
        title: '纸艺定格科普',
        summary: '手工纸艺定格动画，用 tactile 质感讲解科学、教育与通识内容。',
        category: 'style',
        icon: 'film',
        hue: 330,
        featured: false,
        demo: 'papercraft-stop-motion-explainer.gif',
        h3: true,
    },
    // ---- 字幕配乐 ----
    {
        name: 'music-video-subtitle-generator',
        title: 'MV 歌词字幕',
        summary: 'AI MV 与情绪短片的歌词字体排版：音乐 + 歌词 + 方向 → 卡点字幕成片。',
        category: 'audio',
        icon: 'music',
        hue: 300,
        featured: false,
        demo: 'music-video-subtitle-generator.gif',
        h3: true,
    },
    // ---- 未分类（内部工具）----
    {
        name: 'effect-test-runner',
        title: '效果测试执行器',
        summary: '放手跑模式下按固定用例自动跑创作全流程，采集参数与产物并出一致性测试报告。',
        category: 'other',
        icon: 'puzzle',
        hue: 150,
        featured: false,
    },
];
/** 对广场 / lobby 推荐可见的子集：hidden 技能仍可在项目中使用，但不做展示。 */
export const VISIBLE_CATALOG = SKILL_CATALOG.filter(entry => entry.hidden !== true);
/** 按注册名取展示元数据；未收录（新增 skill 忘了补表）返回 null，不抛错。 */
export function getSkillEntry(name) {
    const target = SKILL_CATALOG.find(entry => entry.name === name);
    return target ?? null;
}
/** 某分类下的广场可见技能。 */
export function skillsByCategory(category) {
    return VISIBLE_CATALOG.filter(entry => entry.category === category);
}
/** 每个分类下的广场可见技能数（侧栏角标用，含 0 的分类）。 */
export function skillCountByCategory() {
    const counts = {};
    for (const id of SKILL_CATEGORY_IDS)
        counts[id] = 0;
    for (const entry of VISIBLE_CATALOG)
        counts[entry.category] += 1;
    return counts;
}
/**
 * lobby 横滚的推荐技能：在广场可见条目中 featured 优先，不足则用其余条目补齐。
 * @param limit - 返回条数上限（默认 8）。
 */
export function recommendedSkills(limit = 8) {
    const featured = VISIBLE_CATALOG.filter(entry => entry.featured);
    const rest = VISIBLE_CATALOG.filter(entry => !entry.featured);
    return [...featured, ...rest].slice(0, Math.max(0, limit));
}
