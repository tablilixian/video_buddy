---
name: brand-format-director
description: 品牌宣传体裁的 L2 编排壳（format director）。凡「品牌宣传片 / brand promo / 新品发布 / 官网展示 / 应用与店铺宣传 / 社媒品牌推广 / logo 短片」类需求，先用定向三问对齐（素材现实 / 投放场景 / 时长画幅语言），再按链路路由表把任务分派给下游 executor（brand-promo-video-generator 风格链 / code-driven-explainer 动效图形链）。用户点名下游 executor 时本壳仍须先加载做定向——点名只决定「用哪条链」，不替代「素材现实 / 投放场景 / 时长画幅语言」三问。本 skill 只做定向与调度，不复述素材纪律与节拍细则；上游是 canvas-studio-creation 总纲，不改变其流程与审批语义。触发词：品牌宣传、品牌片、brand promo、新品发布、宣传片、logo 短片。不适用：已有真实产品、以功能/卖点/结构展示为主 ⇒ product-format-director。
---

# 品牌宣传体裁编排（brand-format-director）

**定位**：L2 编排壳。上游是 `canvas-studio-creation` 总纲——需求澄清、审批语义、工具契约一律归总纲；下游两条链路：

- `brand-promo-video-generator`（品牌风格知识链：素材真实性纪律 + 叙事骨架 + 节拍规划 + 运动语言）
- `code-driven-explainer`（Remotion 动效图形链：动态排版 / 色彩状态 / 数据卡，零实拍素材）

本 skill 只做**定向与路由**，选定链路后加载对应 executor 执行——素材纪律、叙事骨架与节拍细则见 executor 的 SKILL.md 与 references/。

## 1. 定向三问（对齐 Direction 阶段）

开工前对齐三件事（`ask_user_choice`；放手跑模式改为自列假设；项目已有时长/画幅预设则沿用预设，不重复问）。**可与 §2 的路由选择合并成一次提问**：

1. **素材现实**：手里有什么授权素材（logo / 产品图 / 界面截图 / 包装 / 实拍）？身份承载资产不齐 → **停下索要授权原件，绝不生成貌似合理的替代品**（brand-promo 第一底线）。
2. **投放场景与受众**：新品发布 / 官网 / 社媒 / 应用商店？决定语言口径（品牌资产语言优先，不机械跟对话语言）与语气。
3. **期望时长与画幅**（缺省 15s / 30s / 60s 三档 + 16:9 或 9:16）。

问完即在回复中复述定向结论（素材现实 / 场景 / 时长画幅语言）再开工。

**体裁归属（先判壳再开工）**：**虚构 / 概念品牌且身份资产由用户授权生成**（logo / 瓶身 / 字标 / 广告词都要你造）、片子以**品牌气质与叙事**为主 ⇒ 走本壳品牌链；**已有真实产品与官方素材**、以**功能 / 卖点 / 结构展示**为主 ⇒ 属 `product-format-director`。两壳同时命中（「新品发布」两边都列触发词）时按 `references` 之外的唯一裁决表 `canvas-studio-creation/references/clarification.md` §"体裁壳互斥判据" 判，**不靠模型自选**。

> **答案已给全的形态（2026-11-09 真机回归补）**：任务书 / brief 已把三问答案写死、写了「不要反问」、或已点名下游 executor 时，**本壳仍须先加载**：用给定答案复述定向结论即可，不必再 `ask_user_choice`，但**不得跳过本壳直接开工**。点名只决定链路，不替代定向。

## 2. 链路路由表

| 需求特征 | 链路 | 判据 |
|---|---|---|
| 真实素材为主（logo / 产品 / 界面 / 实拍感） | `brand-promo-video-generator`（总纲标准视频链 + 品牌风格纪律） | 要写实质感、授权素材在手 |
| 抽象动效图形 / 动态排版 / 色彩状态（零实拍素材） | `code-driven-explainer`（Remotion 精排，`render_composition`） | 无素材预算或纯 motion graphics，文案与色板驱动 |

**降级路径**：实拍素材不齐 → 概念化叙事（明确不冒充官方产品证据）或退 Remotion 动效图形链。

## 3. 结构与节拍（开工前对齐）

叙事骨架按品类选（AI/SaaS / 实体产品 / 服务公司 / 图像主导）与帧级节拍规划**唯一权威 = `brand-promo-video-generator`**（§叙事骨架 + `brand-promo-video-generator/references/beats-and-motion.md`）——本壳不复述骨架表与节拍字段。

## 4. executor 指派与交付要求

选定链路后**显式声明**走哪个 executor（如「本片走 brand-promo-video-generator」），再加载该 skill 开工。

- **音频**：默认视频模型原生音频（器乐/界面音写进视频提示词），单独旁白 / BGM 才另生成——口径细则见 brand-promo §默认音频口径，本壳不复述。
- **验收清单**（4 条，交付前逐条核对）：
  1. 身份承载资产全部来自授权/官方来源（终版 logo 未拉伸裁切重建）
  2. 卖点 / 数据 / 口号 / CTA 与官方来源一致，或已标为概念文案
  3. 时长 / 画幅 / 语言与简报一致，文案可读不拥挤
  4. 运动有清晰视觉归属不遮挡产品，logo 安全空间保住

## 5. 不做清单

- **不复述素材真实性纪律**：来源优先级 / 授权口径 / 品牌事实表字段唯一权威 = `brand-promo-video-generator/references/intake-and-provenance.md`，本壳只给一句话指针。
- **不替代总纲的审批语义**：覆盖层「确认落地」等门禁原样归 `canvas-studio-creation`，本壳不设门也不放行。
- **没有授权素材不开工生成**：停下索要原件——这是 L3 底线，壳只负责把它带进定向第一问。

## 工程纪律（六体裁统一，2026-11-05）

- **画面判据取证层级**：本地图片（抽帧 / 素材）首选 `read_image(file_path=…)` **看图本身**；精确坐标 / 颜色 / alpha 用 `inspect_image`；`image2vl` / `video2vl` 是后端 VLM 文字转述，仅三种情况保底（只有远端句柄 / `read_image` 能力声明失效 / 要第二意见）且**不可当事实**，降级必须明写「未做画面自检」。全契约见 `canvas-studio-creation/references/toolchain.md` §7。
- **交付前复述未决项**：渲染回执的体检告警逐条状态（回执「体检 N 条」段 + `build/lint-*.md` 落盘清单，修哪条读哪条）/ 未核源事实 / 模型能力边界 —— 没做的明说，不冒充结论。
- **数据判据**（用到 chart / dataCard 时）：内联数值带 `dataSource`（数据集 + 可复核入口；自测写 `'observed'`，占位写 `'inline'`）与 `baseline`（口径 / 基线，**单一基准**）；storyboard `pending` 事实不得进成片。数字非编造是验收第一条。
