---
name: brand-promo-video-generator
description: |
  Style knowledge for trustworthy brand promo reels: provenance-first asset discipline (never redraw or approximate logos, product UI, packaging or mascots), brand truth extraction from authorized sources only, product-category-specific story spines, frame-accurate beat planning, controlled motion language with 2-5 meaningful color states, and pre-delivery authenticity review. Use for launches, website showcases, app and shop promos, and social promotion. Not for imitating real brand marks without authorized assets, inventing product claims, or producing long-form narrative films.
compatibility: Requires the MiniMax Hub agent (canvas workspace and the hub_* tools listed below); not portable to generic agent harnesses.
allowed-tools:
- webfetch
- hub_image_search
- hub_analyse_media
- hub_canvas_get_node
- hub_canvas_group_recent_outputs
- hub_generate_image
- hub_generate_video
- hub_generate_audio
- hub_generate_music
- hub_synthesize_speech
- hub_video_edit
- hub_audio_meta
- task
---

# Brand Promo Video Generator

品牌/产品宣传短片的**风格知识库**：素材真实性纪律、叙事骨架、节拍规划、运动语言与交付前核查。

## 立场声明

**本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。**

## 何时用 / 何时不用

**用**：用户有 logo、产品图、界面截图、官网链接或一个清晰想法，要把它变成干净的品牌短片——新品发布、官网展示、社媒推广、应用与店铺宣传、个人项目推介。

**不用**：没有授权素材却要模仿真实品牌标识；编造产品卖点；长篇叙事电影。

## 素材真实性纪律（本风格的第一底线）

- **绝不重画或近似绘制** logo、字标、产品界面、包装、吉祥物、人物或品牌场景。
- 生成素材只用于抽象运动、氛围、转场几何，或明确概念化、不会冒充官方产品证据的场景。
- logo、产品界面、人物、吉祥物、包装、字体、色系等身份承载资产无法认证时，**停下**并请用户提供授权原件，不要生成貌似合理的替代品。
- 不使用 logo 聚合站、搜索缩略图、粉丝复刻、Pinterest 转存或 AI 生成替代品作为身份承载来源。
- 程序化图形只允许作为**非具象运动层**：遮罩、渐变、色场、网格、辉光、粒子、拖尾、排印、已验证数据的图表与转场几何。

### 来源优先级与品牌事实表

来源优先级：① 用户提供的原始导出件；② 官方公司网站、静态包、新闻室、品牌门户、媒体包、新闻资料或官方仓库；③ 公司自有的媒体库；④ 授权图库或授权合作方素材包。

品牌事实表提取项与溯源清单字段见 `references/intake-and-provenance.md`。

### 授权口径

用户上传的资产默认可用于前期与概念规划；首次询问时不要反复追问独立权利问题，除非出现具体风险信号（第三方水印、明显抓取的电商图、用户表述自相矛盾、法律/医疗/金融合规声明，或用户要求商业发布）。把来源记为"用户提供"，在来源摘要里给出权利提示，而不是卡住流程。溯源清单本身不授予发布权——授权不清时把成片标注为非官方概念，并告知商业发布需要许可。

### 语言口径

宣传内容的旁白与画面内文案语言，从品牌素材、目标受众与平台语境决定，**不要**机械地跟着对话语言走。品牌资产与可见源文案以英文或全球企业英文为主时，旁白与画面文案默认英文，除非用户明确要中文本地化。用户是中文但说自己以新用户视角测试时，对话仍用中文，但视频文案按品牌投放最合适的语言来规划。

## 叙事骨架（按品类选）

| 品类 | 骨架 |
| --- | --- |
| AI / SaaS | 用户意图 → 思考或规划 → 能力 → 执行 → 有用产出 → 佐证 → logo |
| 实体产品 | 主视觉揭示 → 交互 → 特性微距 → 使用场景 → 结果 → logo |
| 服务 / 公司 | 语境 → 流程 → 证据 → 成果 → 承诺 → logo |
| 图像主导品牌 | 真实影像 → 视觉母题 → 利益点 → 情绪回报 → logo |

故事要贴着产品走：展示真实的功能、交互、场景、产出与佐证，不要把故事藏在抽象特效后面。

## 节拍规划

出片前先排帧级感知的时间线（规划约定 30fps，除非输出链路另有要求）：15s 片目标 5-8 个主节拍，30s 片 8-12 个。每拍要定义起止时间/帧区间、视觉归属与真实资产 ID、主动作、展示的产品佐证、文案与可读停留、色彩状态、进出场转场、运动意图（setup/anticipation/commitment/impact/brake/settle）。逐拍细则与 15s 节拍模式见 `references/beats-and-motion.md`。

## 运动语言

- 用有控制的方式堆强度：让产品运动、光标路径、界面流程、光线、滚动内容、物体边缘或匹配的几何来驱动转场。
- 使用 2-5 个与语义挂钩的刻意色彩状态。
- 一拍一个主动作，次要层稍晚出现。
- 设定 2-3 个高能峰值与安静的刹车时刻。
- 保住可读的剪影、文案与 logo 安全空间。
- 避免假 HUD、无意义的玻璃卡、装饰文字墙、未证实数据，以及全片同一种缓动。
- AI 类产品至少给出一条可读链路，例如 prompt → 规划 → 并行能力 → 生成结果 → 佐证；实体或服务类产品展示从用户动作到具体结果的因果。

## 默认音频口径

原生品牌短片默认优先走视频模型原生音频（把品牌安全的器乐/界面音设计写进视频提示词），而不是另做一条音乐轨；只有用户明确需要可控旁白、对白、可替换独立 BGM、精确音乐时长或后期重混时才单独生成语音或音乐，且不要与原生音频重复做同一首配乐。字幕只在用户明确要求时加。

## 交付前核查

logo 与身份承载资产来自已验证或用户授权来源；产品名/功能/卖点/数据/口号/CTA 与官方来源一致或已标为概念文案；时长、画幅、语言与简报一致；文案可读不拥挤；终版 logo 未被拉伸裁切重建；运动有清晰视觉归属不遮挡产品；产物在画布上且多产物已归组。逐条清单与失败恢复见 `references/verify-and-recover.md`。真实性核查不通过时换成官方/用户授权来源或停下索要资产——**绝不把仿制品做得更精致**。

## 分册（按需读，不要一次全读）

| 分册 | 何时读 |
| --- | --- |
| `references/intake-and-provenance.md` | 素材清单与品牌事实表字段、溯源清单字段、权利口径与语言口径细则 |
| `references/beats-and-motion.md` | 叙事骨架选型、逐节拍字段、15s 节拍模式、运动语言细则 |
| `references/toolchain-and-capability.md` | 上游 Hub 工具清单与本产品能力边界、降级口径 |
| `references/verify-and-recover.md` | 交付内容、失败恢复路径 |

## 边界

生成、落地、审批与交付动作一律走 `canvas-studio-creation`；本 skill 不提供工具参数、不设审批门。
