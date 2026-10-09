/**
 * CV-288 视觉风格库（REQ-029 §九 偏差项「通用 4 预设」回填）—— **本模块是风格数据的唯一事实源**。
 *
 * 由来：CV-281 实施时按演示口径落了 4 条通用预设，并在 REQ-029 §九 登记为已知偏差
 * （「演示风格库为内容资产级功能，待扩充」）。本模块是该偏差的回填。
 *
 * 数据职责分工（防 CV-116 式四处漂移）：
 * - **本表**只管「风格身份 + 注入文本 + 展示元数据」；
 * - 注入通路唯一（`generate.ts` 的 `composeImagePrompt`），本模块不改通路；
 * - 与 `skills/canvas-studio-creation/references/style-presets.md` 的 11 条**成片风格预设**
 *   是**两层并行体系**（CV-288 拍板 A）：那份是整条短片的制作流水线（绑 skill），本表是
 *   单张图的画法（纯提示词前缀）。两者互不引用，名称不重名。
 *
 * 写作规格（CV-288 拍板 D8，经 docs/api-probe/style-prefix-20261009/ 实测校准）：
 * 1. **长度 50–70 字**。V1 实测 59/61/60 字三档全部生效；原 4 条的 10–11 字短句实测**基本无效**
 *    （同提示词下只出普通写实图，见 api-probe 的 01-old-cinematic 两轮对照）。
 * 2. **不固定段位**，由风格自定重心。理由（实测修正）：模型吃的是**具体名词**而非结构——
 *    国风水墨若硬套「色彩/光线/材质」三段，前两段只能写正确但无信息量的填充句。
 * 3. **必含具体媒介技术名词**：渗化、浓淡干湿、赛璐璐平涂、描边、颗粒、色块边界……
 *    风格名本身（「动漫插画风格」）信息量远低于媒介技术词（「干净的黑色描边搭配平涂色块」）。
 * 4. **禁止负向表述**：`krea2-turbo-writing/SKILL.md:14` —— cfg=1.0 时负向条件结构性失效，
 *    「不做/避免/无」一律无效，所有约束写成正向表述。
 * 5. **不与摄像机参数打架**：不写焦段（35mm）、光圈（f/1.4）、景深数值——那是摄像机弹层
 *    （`NodeInputCard.tsx` 的 `CAMERA_*`）的领域，两边都写会互相覆盖（拍板 D7）。
 * 6. **不暗示画幅**：「宽银幕」类词不进描述（`aspectRatio` 是 API 真参数，见 `OUTPUT_SIZE`）。
 *
 * 长度上限：Krea2 约 500 字为**软限制**（CV-288 拍板），不做客户端拦截——风格描述 60 字
 * 是固定小头，用户自己的提示词才是长度主体；且该限制随模型升级会解除。
 */

/** 风格分类。轴刻意保持扁平：CV-288 拍板 D4 = 照搬演示口径，混维度登记为已知债
 *  （现行 12 条每类 1–3 条，混维度不突出；扩到 30+ 条时按实测效果重切）。 */
export type StyleCategory =
  | '通用媒介'
  | '摄影调性'
  | '题材'
  | '绘画'

/** 单条视觉风格。字段口径见文件头规格。 */
export interface VisualStyle {
  /** 稳定主键。**落进 `generationPrompt` 的 `styleId` 字段**——存 id 不存前缀文本，
   *  这样清单改文案不会让历史节点的选中态漂移（CV-288 拍板 D2）。 */
  readonly id: string
  /** UI 显示名。**不得与 `style-presets.md` 的 11 条成片预设同名**（拍板：逐条规避）。 */
  readonly name: string
  readonly category: StyleCategory
  /** 注入文本（前缀）。50–70 字，见文件头规格 1–6。 */
  readonly prefix: string
  /** 卡片色板（CSS 渐变）。CV-288 拍板 D3 = 纯色板，**不预留真图字段**——
   *  半吊子的空字段正是 CV-116 那类漂移的形状；真图版另起一轮再议。 */
  readonly swatch: string
}

/** 空前缀 = 无风格。这是 demo 的 `NONESTY` 口径（`无风格` 排在「全部」分类首位）。 */
export const NO_STYLE_ID = 'none'

/**
 * 视觉风格清单（12 条）。
 *
 * 分类分布：通用媒介 4（每类头条位置）/ 摄影调性 3 / 题材 3 / 绘画 2。
 * 前 3 条沿用 CV-281 原 4 条的显示名（保持用户既有肌肉记忆），但**注入文本全部重写**。
 */
export const VISUAL_STYLES: readonly VisualStyle[] = [
  {
    id: 'cinematic',
    name: '电影感',
    category: '通用媒介',
    prefix: '电影质感，低饱和青橙色调，暗部厚重保留细节；高对比侧逆主光配柔和补光，背景自然虚化；细腻胶片颗粒与轻微暗角，克制而高级',
    swatch: 'linear-gradient(140deg,#3b4a5c,#b58455)',
  },
  {
    id: 'anime-cel',
    name: '动漫插画',
    category: '通用媒介',
    prefix: '日式动漫赛璐璐画风，干净的黑色描边搭配平涂色块；均匀柔和的环境光加轻微轮廓光，色块边界分明；高饱和配色，明快通透，背景简洁',
    swatch: 'linear-gradient(140deg,#a8d8ff,#ffb7d5 55%,#ffe9a8)',
  },
  {
    id: 'realistic',
    name: '写实摄影',
    category: '通用媒介',
    prefix: '纪实照片质感，自然环境光为主光、柔和阴影过渡；肤色还原准确，织物纤维与皮肤毛孔的微对比清晰；高光柔化滚降，色彩中性偏暖，画面锐利干净',
    swatch: 'linear-gradient(140deg,#a3a894,#5d6350 56%,#22251d)',
  },
  {
    id: 'ink-wash',
    name: '国风水墨',
    category: '通用媒介',
    prefix: '水墨写意，宣纸渗化的柔和边缘与浓淡干湿的墨色层次；大面积留白，淡青灰墨色，极简概括的线条；绢本设色的细腻颗粒感，安静克制',
    swatch: 'linear-gradient(140deg,#e8ebe6,#5b6b6a 60%,#2c3742)',
  },
  {
    id: 'cyber-neon',
    name: '赛博霓虹',
    category: '摄影调性',
    prefix: '高饱和霓虹色调，青蓝与品红交叠，湿滑反光面密集反射招牌光；暗部深邃，霓虹自发光勾勒主体轮廓；紧凑高反差构图，电子未来都市氛围',
    swatch: 'linear-gradient(140deg,#1b1e4b,#ff4fa3 55%,#25e0e0)',
  },
  {
    id: 'film-grain',
    name: '胶片颗粒',
    category: '摄影调性',
    prefix: '模拟胶片质感，明显颗粒与轻微网点，边缘轻微漏光；偏暖的褪色色彩，高光柔化溢出，暗部偏青；宽容度高、层次丰富，怀旧年代气息',
    swatch: 'linear-gradient(140deg,#6b5f52,#c8a97e 60%,#3a3229)',
  },
  {
    id: 'dark-fantasy',
    name: '暗黑奇幻',
    category: '摄影调性',
    prefix: '幽暗低照度氛围，深黑阴影占据大面积画面；冷灰蓝主调配极少量暗红点缀，实体轮廓在微光中若隐若现；厚重的体积雾与微粒悬浮，压迫而肃杀',
    swatch: 'linear-gradient(140deg,#1d1a22,#6b3f2a 60%,#0e0c10)',
  },
  {
    id: 'ancient-costume',
    name: '古装',
    category: '题材',
    prefix: '古装写实，衣料为丝绸与织锦，纹样与刺绣细节清晰；朱红与黛青为主的克制配色，金属饰件泛哑光；柔和侧光勾勒衣褶，自然古建与云雾远景',
    swatch: 'linear-gradient(140deg,#f3e2d2,#d9b48f 46%,#8c6247)',
  },
  {
    id: 'retro-era',
    name: '年代',
    category: '题材',
    prefix: '旧时代纪实质感，低饱和的暖褐与暗青配色；钨丝灯与窗棂投下的硬光，墙面与木料有明显做旧痕迹；正侧光构图，人物与器物带明显年代印记',
    swatch: 'linear-gradient(140deg,#cbb58d,#8a7048 55%,#33291c)',
  },
  {
    id: 'urban-daily',
    name: '都市日常',
    category: '题材',
    prefix: '现代都市生活感，米白与浅木色的温暖家居配色；窗边自然光漫射，木纹与棉麻织物纹理清晰；玻璃反光与陶瓷釉面质感真实，视角贴近日常观察',
    swatch: 'linear-gradient(140deg,#e0b478,#a06a38 55%,#33220f)',
  },
  {
    id: 'oil-painting',
    name: '油画质感',
    category: '绘画',
    prefix: '古典油画笔触，厚涂刀痕与颜料堆积的立体肌理清晰可见；浓郁的赭石与翠绿，用明暗交界处的厚涂塑造体积；画布纹理透出，光泽随角度变化',
    swatch: 'linear-gradient(140deg,#54745f,#c2a05a 55%,#231c13)',
  },
  {
    id: 'pencil-sketch',
    name: '铅笔素描',
    category: '绘画',
    prefix: '铅笔手绘素描，排线塑造明暗过渡，笔触方向随形体转折；黑白灰阶层次丰富，细密排线与留白并置；纸面轻微粗糙，纯净浅色底，中近景取景',
    swatch: 'linear-gradient(140deg,#eaeae6,#9b9b93 55%,#3a3a36)',
  },
]

/** 分类枚举（顺序 = 分类 tab 顺序；「全部」由 UI 侧另行置首，与 demo 的 `STY_CATS` 同口径）。 */
export const STYLE_CATEGORIES: readonly StyleCategory[] = [
  '通用媒介',
  '摄影调性',
  '题材',
  '绘画',
]

/** id → 风格。渲染层与注入层共用，禁止另建第二张映射表。 */
const BY_ID: ReadonlyMap<string, VisualStyle> = new Map(VISUAL_STYLES.map(s => [s.id, s]))

/** 按 id 取风格；未知 id（含空 id = 未选风格）返回 undefined。 */
export function visualStyleOf(id: string | undefined): VisualStyle | undefined {
  return id === undefined || id === '' ? undefined : BY_ID.get(id)
}

/** 取注入前缀；未选风格返回空串（`composeImagePrompt` 会跳过空前缀）。 */
export function stylePrefixOf(id: string | undefined): string {
  return visualStyleOf(id)?.prefix ?? ''
}

/**
 * 注入文本 → id 的**兼容反查**（仅供历史节点回落显示用）。
 *
 * CV-288 拍板 N1 = 历史节点的风格选中态**丢了可接受、不做迁移**。故这里只做「认得就标出来、
 * 认不出就显示『风格』」的降级，不做任何写回。历史节点只有 `stylePrefix` 字符串、没有
 * `styleId`，`visualStyleOf(undefined)` 返回 undefined → UI 回落「风格」，但**注入照旧**
 * （`stylePrefix` 字段原样保留，`generate.ts` 一字未改）——即拍板口径「老节点继续用弱风格
 * 出图、不清理」。
 */
export function styleIdOfPrefix(prefix: string | undefined): string | undefined {
  if (typeof prefix !== 'string' || prefix.trim() === '') return undefined
  return VISUAL_STYLES.find(s => s.prefix === prefix)?.id
}

/** 按分类过滤；空串 = 「全部」。 */
export function stylesInCategory(category: string | undefined): readonly VisualStyle[] {
  return category === undefined || category === '' || category === '全部'
    ? VISUAL_STYLES
    : VISUAL_STYLES.filter(s => s.category === category)
}
