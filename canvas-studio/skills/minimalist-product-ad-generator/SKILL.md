---
name: minimalist-product-ad-generator
description: |
  Style knowledge for minimalist, premium, Apple-style product ad films: three-independent-anchor-photo control system, product body-color fidelity, single-line two-part in-frame typography, three product narrative spines, motion language, Apple-style tech BGM direction, and the visual traps to avoid. Use when an e-commerce seller, small brand owner, or indie creator wants an Apple-flavoured product film, premium ecommerce product video, or new-product launch ad. Not for KOC talking-head ads, general editing, documentary explainers, or complex screen demos.
compatibility: Requires the MiniMax Hub agent (canvas workspace and MiniMax H3 generation); not portable to generic agent harnesses.
metadata:
  trigger-words: [minimalist product ad, premium product ad, minimalist product film, 极简产品广告, 高质感产品广告, 产品广告片, 电商产品视频, 新品发布广告]
---

# Minimalist Product Ad Generator

极简高级产品广告片的**风格知识库**：视觉语言、锚点照控制体系、画面内排印、叙事骨架、运动语言、配乐基调。

## 立场声明

**本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。**

## 何时用 / 何时不用

**用**：用户给了至少一张产品图或素材，想要电商推广、新品发布风格的短片（"帮我的产品做一个苹果味儿广告片"、"Make an Apple-style product ad from this product photo"）。
**不用**：通用剪辑、纪录片式讲解、KOC 口播广告、复杂 UI/录屏演示。

## 风格知识

### 视觉基调

- 苹果风 = 干净构图 + 高级光 + 克制运动 + 留白。**不等于**把产品本身做成白/银/耳机状。
- 四种调性模板：白科技 / 暗轮廓光 / 品牌色场 / 明亮生活场景。
- 只移背景、光环境与构图；**产品本体色、强调色、材质色调、表面处理必须原样保留**（除非用户明确要求）。终版强调色取自真实产品主色，不是通用银/白苹果色板。
- 白科技风不是镜面白台、不是死平白光：产品不放在反光地板、玻璃桌、廉价镜面棚拍台上；不留空场死时间，开场要迅速露出好看的产品动作或角度。

### 锚点照体系（本风格的视觉控制核心）

- 默认**三张独立锚点照**，不要一张四宫格拼版——视频模型会把拼版布局复制进成片。三张覆盖：① 主体/冲击力主视图；② 材质或功能细节；③ 终版文案构图。结构/动作线索与主视图重叠时并入细节锚点。
- 每张必须是完整独立的产品照片：禁止网格、四分屏、拼贴板、画框分栏、产品墙、分镜表。
- 决定镜头顺序、动作与文字行为的是**节拍分镜表**，不是锚点照；锚点照不可当作镜头替代。

### 画面内排印

- 一律英文（用户给中文就本地化成简洁英文）；可见文案 3-5 个英文词（含空格最好 ≤32 字符）、单行，禁止 1-2 词功能标签。字体参考 SF Pro Display / SF Pro Text，提示词里优先写 `SF Pro Display Semibold`。
- 只用两种颜色：白科技风前半必须黑/深灰（白底白字禁止），暗轮廓光风前半可白；**后半永远是具体产品色**。文字不落字幕位，优先视觉中区左/右对齐并作为构图一部分。
- 两段式动效默认可见：前半先轻微淡入/滑入，后半稍后淡入/滑入，前半在**同一行内**轻微让位（约 10-15px 或字宽 8-12%）；禁止为了避免两行而让文字完全静止。默认让视频模型直接生成画内排印及其时序，**不要**暗中降级成后期字幕。

### 叙事骨架（三选一）

| 骨架 | 节拍 | 适用 |
| --- | --- | --- |
| 新品发布（默认推荐） | 留白开场 → 主视图 → 材质/结构细节 → 自然动作 → 变体或色彩关系 → 全文案收尾 | 耳机、手表、数码配件、小家电、香氛设备 |
| 特性触碰 | 静止 → 交互触发 → 特性动作 → 细节放大 → 结果/感受 → 收尾帧 | 有开合/旋转/磁吸/亮屏/折叠/喷雾等清晰动作 |
| 色彩家族 | 主变体独现 → 辅助变体轻滑入 → 色彩秩序成形 → 材质统一 → 全系列收尾 → 文案落定 | 多色、多变体、多型号产品 |

禁止套用固定耳机模板或"产品状态变化"这类空话；叙事必须基于品类、形态、材质、结构与可见动作（"盖子打开 30 度出现内壁反光"这种颗粒度）。

### 运动语言

1. **转场由真实产品或视觉元素驱动**：产品边缘、材质高光、开合/旋转/吸附/滑移动作、变体排列的几何变化、色彩进出、匹配机位方向、匹配产品剪影。禁止无意义白闪、抽象粒子、随机光效、随机硬切。
2. **一拍一个主动作**：次要元素稍晚出现，不与主动作争注意力。
3. **强弱节奏**：5s = 1 小峰 + 1 稳定收尾；10s = 1-2 峰 + 1-2 刹车点；15s = 2-3 峰 + 2 安静刹车点。峰值可以是产品动作完成、变体入场、文案后半显现、全产品收尾。
4. **留安全区**：产品剪影清晰、单行文案可读、主变体不被遮挡。Logo 只在用户提供时加，禁止编造假 Logo。
5. **禁假科技装饰**：假界面、无意义玻璃卡、装饰文字墙、未证实数据、随机粒子与堆叠光效、全片同一种缓动、产品墙。

### 配乐基调

默认走视频模型原生音频、配乐方向写进视频提示词；原生音乐不理想或用户要换音乐时用 `music-2.6` 生成长版器乐并替换音轨。基调：约 100 BPM 的快速科技感，块状和弦 + 清脆前冲的 pluck + 高质气噪 bed，kick 与 sub-bass 只服务剪辑点，木质打击提供触感，结尾 0.5s 内骤然收停只留 pluck 尾音。科技感强但不廉价 EDM；**禁人声、禁 synthwave、禁复古、禁游戏感、禁廉价企业 stock 音乐**。提示词原文见 `references/video-and-audio.md`。

### 成片底线

产品本体色与主变体全片一致；文案单行可读不拥挤，同一时刻不出现两行文字或多个文字块；终帧是稳定的产品 + 全文案收尾，**绝不**以四宫格、分屏、分镜板、锚点拼版或产品墙收尾。逐条核对见 `references/checklist.md`。

## 分册（按需读，不要一次全读）

| 分册 | 何时读 |
| --- | --- |
| `references/assets-and-brief.md` | 素材清点与产品事实摘要、生产简报字段、多变体策略、四种调性模板与画幅时长选项 |
| `references/typography.md` | 写文案、终版锚点照排印、节拍表文字列与文字动效细则 |
| `references/narrative-and-motion.md` | 选叙事骨架、给整片定运动语言与强弱节奏（含成品语句示例） |
| `references/storyboard-table.md` | 节拍分镜表：列定义、各时长建议节拍数、逐拍规则、九条原则、节奏词汇表 |
| `references/video-and-audio.md` | 出片提示词组装与完整性自检、原生音频与 BGM 提示词原文、音乐分析、卡点剪辑与音轨替换 |
| `references/checklist.md` | 交付前逐条核对、失败处理、交付内容清单 |

## 边界

生成、落地、审批与交付动作一律走 `canvas-studio-creation`；本 skill 不提供工具参数、不设审批门。
