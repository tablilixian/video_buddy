---
name: product-format-director
description: 产品讲解体裁的 L2 编排壳（format director）。凡「产品广告片 / 产品走查 / 电商产品视频 / 新品发布广告 / product ad / product walkthrough / 极简高级产品片」类需求，先用定向三问对齐（产品与素材现实 / 卖点与调性 / 时长画幅），再按链路路由表把任务分派给下游 executor（minimalist-product-ad-generator 极简广告链 / code-driven-explainer 的 product-walkthrough 配方）。用户点名下游 executor 时本壳仍须先加载做定向——点名只决定「用哪条链」，不替代「产品与素材现实 / 卖点与调性 / 时长画幅」三问。本 skill 只做定向与调度，不复述锚点照体系与配方字段；上游是 canvas-studio-creation 总纲，不改变其流程与审批语义。触发词：产品讲解、产品广告、产品短片、电商产品视频、产品走查、product ad、product walkthrough。
---

# 产品讲解体裁编排（product-format-director）

**定位**：L2 编排壳。上游是 `canvas-studio-creation` 总纲——需求澄清、审批语义、工具契约一律归总纲；下游两条链路：

- `minimalist-product-ad-generator`（极简高级产品广告链：锚点照体系 + 画面内排印 + 三叙事骨架，H3 视频模型）
- `code-driven-explainer`（产品走查链：`scaffold_manifest` 的 `product-walkthrough` 配方，1 张产品图起步，Remotion 精排）

本 skill 只做**定向与路由**，选定链路后加载对应 executor 执行——风格细则与配方字段见 executor 的 SKILL.md 与 references/。

## 1. 定向三问（对齐 Direction 阶段）

开工前对齐三件事（`ask_user_choice`；放手跑模式改为自列假设；项目已有时长/画幅预设则沿用预设，不重复问）。**可与 §2 的路由选择合并成一次提问**：

1. **产品与素材现实**：什么产品（形态 / 材质 / 有无清晰动作：开合、旋转、磁吸、亮屏）？手里几张产品图 / 有无界面录屏 / 有无多色变体？
2. **卖点与调性**：苹果味高级感广告（minimalist 链）还是功能走查 / 怎么用演示（walkthrough 链）？一句话核心卖点是什么？
3. **期望时长与画幅**（缺省 5s / 10s / 15s 三档 + 16:9 或 9:16）。

问完即在回复中复述定向结论（产品与素材 / 卖点调性 / 时长画幅）再开工。

## 2. 链路路由表

| 需求特征 | 链路 | 判据 |
|---|---|---|
| 高级感产品广告（电商推广 / 新品发布） | `minimalist-product-ad-generator`（H3 视频链 + 锚点照体系） | 有产品图、要苹果风质感、以真实产品动作为主 |
| 产品走查 / 功能演示（1 张产品图起步） | `code-driven-explainer`（`scaffold_manifest` recipe=`product-walkthrough`） | 要讲清功能与步骤、数据要精确、零视频素材预算 |

**降级路径**：产品图不足锚点照体系三张 → 退 walkthrough 链（单图起步）；要混合（广告片 + 功能段）→ 分段各自走链，成片阶段按总纲合成纪律拼装。

## 3. 结构与节拍（开工前对齐）

三叙事骨架（新品发布 / 特性触碰 / 色彩家族）与强弱节奏档（5s/10s/15s 的峰值与刹车点）**唯一权威 = `minimalist-product-ad-generator`**；walkthrough 段序列与素材需求唯一权威 = `scaffold_manifest` 的配方展开（见 `code-driven-explainer`）——本壳不复述骨架表与节奏档。

## 4. executor 指派与交付要求

选定链路后**显式声明**走哪个 executor（如「本片走 minimalist-product-ad-generator」），再加载该 skill 开工。

- **验收清单**（4 条，交付前逐条核对）：
  1. 产品本体色 / 材质 / 表面处理原样保留（终版强调色取自真实产品主色，不是通用银白色板）
  2. 转场由真实产品动作或视觉元素驱动（无白闪 / 抽象粒子 / 随机光效）
  3. 画内排印单行 3-5 词两段式动效（minimalist 链）；走查数字非编造、由数据卡代码渲染（walkthrough 链）
  4. 节奏档峰值与刹车点齐备，产品剪影与文案可读不被遮挡；logo 用户没给就不加

## 5. 不做清单

- **不复述锚点照体系与排印细则**：唯一权威 = `minimalist-product-ad-generator`（三张独立锚点照 / 画面内排印两色两段式），本壳只给一句话指针。
- **不复述配方字段**：`product-walkthrough` 配方展开与素材清单唯一权威 = `scaffold_manifest`（toolchain.md §scaffold_manifest），本壳只指路由。
- **不替代总纲的审批语义**：覆盖层「确认落地」等门禁原样归 `canvas-studio-creation`，本壳不设门也不放行。
