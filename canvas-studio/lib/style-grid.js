/**
 * CV-151：风格 GIF 网格的判定逻辑（纯函数，无 JSX / 无 IO）。
 *
 * 从 `client/question-capture.tsx` 抽出到根级：① Host 侧 node --test 可直接
 * 单测（client 打包产物是单文件 bundle，测试够不着）；② 客户端按既有先例
 * （`skill-catalog.ts`）引用根级模块 —— 两要件：`tsconfig.client.json` include
 * 追加 + import 带 `.js` 后缀。
 *
 * 数据职责分工（防 CV-116 式四处漂移）：
 * - 本表只管「选项文案 → skill 名」；
 * - GIF 是否真实存在由 `skill-catalog.ts` 的 `demo` 字段单点决定（渲染层查它）；
 * - 预设名与 Look tokens 的权威在 `style-presets.md` 预设表（测试对账两侧）。
 */
/** 风格预设名 → 上游 skill 名（与 style-presets.md 预设表首列逐字对应）。 */
export const STYLE_DEMO_MAP = {
    '极简产品广告': 'minimalist-product-ad-generator',
    '3D 动画短片': '3d-animation-short-generator',
    '纸艺定格讲解': 'papercraft-stop-motion-explainer',
    '品牌宣传': 'brand-promo-video-generator',
    'MV 字幕': 'music-video-subtitle-generator',
    '合作游戏开场': 'co-op-game-intro-generator',
    '纸拼贴讲解': 'paper-collage-explainer-generator',
    '手绘实景融合': 'handdrawn-live-video-generator',
    '东方神话视觉导演': 'oriental-mythic-visual-director',
    '街采跟拍': 'direct-street-interview-video',
    '惊吓遭遇战': 'stage-startle-to-truce-encounter',
};
/** 选项命中风格预设时返回对应 skill 名（用于 GIF 预览），否则 null：精确优先，再走宽松匹配。 */
export function styleDemoSkill(option) {
    const clean = option.replace(/（推荐）/g, '').trim();
    return STYLE_DEMO_MAP[clean] ?? styleDemoSkillLoose(clean);
}
/**
 * 宽松变体：模型给的选项文字可能有空格/后缀差异（如「3D动画短片」「极简产品广告风格」），
 * 精确匹配之外再退两级——去空格比较、双向包含比较。
 */
function styleDemoSkillLoose(option) {
    const squashed = option.replace(/\s+/g, '');
    for (const [label, skill] of Object.entries(STYLE_DEMO_MAP)) {
        if (label.replace(/\s+/g, '') === squashed)
            return skill;
    }
    for (const [label, skill] of Object.entries(STYLE_DEMO_MAP)) {
        if (squashed.includes(label.replace(/\s+/g, '')))
            return skill;
    }
    return null;
}
/**
 * 是否按「风格 GIF 网格」渲染（CV-151 前的旧规则：任一选项命中即入网格）。
 *
 * 旧规则在 Look 采集类问题上会误触发：样张确认（②-2）的选项里只要顺带提到
 * 一个预设名，宽松匹配就命中 → 网格渲染，而网格分支对未命中选项 `return null`
 * **整个吞掉**（用户选不到「我来说说」这类按钮）。改为「几乎全部选项都是预设」
 * 才进网格：
 * - 命中数 ≥ 2（单个预设名撑不起网格，走文字按钮足够）；
 * - 未命中 ≤ 1（预设出口 ②-3 常附一个「我自己描述」类兜底选项——它照常渲染
 *   成文字按钮，不再丢，见 `question-capture.tsx` 的 unmatched 分支）。
 */
export function shouldRenderStyleGrid(options) {
    const matched = options.filter(option => styleDemoSkill(option) !== null).length;
    return matched >= 2 && matched >= options.length - 1;
}
