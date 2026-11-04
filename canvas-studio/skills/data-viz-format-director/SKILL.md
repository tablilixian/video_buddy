---
name: data-viz-format-director
description: 数据可视化体裁的 L2 编排壳（format director）。凡「数据视频 / 图表动画 / 数据报告片 / KPI 展示 / 年度总结视频 / 数据可视化」类需求，先用定向三问对齐（数据来源 / 图型选型 / 时长画幅），再把任务分派给下游 executor（code-driven-explainer 的 chart 六变体 + dataCard + import_csv 链路）。本 skill 只做定向与调度，不复述 chart 字段手册与解析口径；上游是 canvas-studio-creation 总纲，不改变其流程与审批语义。触发词：数据可视化、数据视频、图表、KPI、数据报告、年度总结、data viz。
---

# 数据可视化体裁编排（data-viz-format-director）

**定位**：L2 编排壳。上游是 `canvas-studio-creation` 总纲——需求澄清、审批语义、工具契约一律归总纲；下游一条主链路：

- `code-driven-explainer`（Remotion 精排：chart 轨六变体 bars/dual/line/pie/donut/gauge + dataCard 数位滚动 + `import_csv` 数据导入）

本 skill 只做**定向与路由**——图型选型是本壳的核心输出；字段与硬约束见 executor 的 SKILL.md 与 references/。

## 1. 定向三问（对齐 Direction 阶段）

1. **数据从哪来**：CSV / 表格截图 / 用户口述？数字必须可溯源（`import_csv` 解析原文或用户明确给出）——**编造数据 = 红线**，无出处宁可空着问。
2. **图什么**：比较 → `bars`；趋势 → `line`；占比 → `pie` / `donut`；单值进度 → `gauge`；量纲不同的双序列 → `dual`。一句话说出每张图回答什么问题。
3. **时长与节奏**（缺省 16:9 或 9:16，30–60s）：一张数据卡一件事，逐张揭示；卡预算 = 图表数 × 4–6s。

问完即在回复中复述定向结论（数据来源 / 图型清单 / 时长节奏）再开工。

## 2. 链路路由表

| 需求特征 | 链路 | 判据 |
|---|---|---|
| 有表格 / CSV 数据 | `code-driven-explainer` + `import_csv`（CSV → labels/values 建议） | 数字多、要精确 —— **必须代码渲染**（生成模型画图会编假数） |
| 口述少量数字（≤5 个） | `code-driven-explainer` 手填 chart / dataCard | 数字少，直接写进 manifest；每个数都要能在对话里对上出处 |
| 想要镜头时长等时间线真值 | `code-driven-explainer` 的 `source:'timeline'` | 从 video 轨真值推导，不自填数据 |

**降级路径**：无合格数值列（import_csv 拒荐）→ 回问用户要数据或改用文本卡呈现文字结论；不做「看起来像数据」的装饰图。

## 3. 图型选型判据（本壳核心输出）

- **比较类目** → `bars`（类目 ≤8；类目多先聚合，挤成一排 = 没人读得清）
- **时间趋势** → `line`（点 ≥3 才成趋势；两点用 bars）
- **占比构成** → `pie` / `donut`（份额数 2–6；超过 6 先并「其他」）
- **单值进度** → `gauge`（一个数对分母的进度；分母写 `gaugeMax`，缺省 100）
- **双量纲** → `dual`（左右轴单位不同才用；同量纲别双轴）

## 4. executor 指派与交付要求

选定链路后**显式声明**走 `code-driven-explainer`，再加载该 skill 开工。

- **验收清单**（4 条，交付前逐条核对）：
  1. 数字非编造（每个数有出处：import_csv 解析记录或用户原话，能在对话里对上）
  2. 图型与数据匹配（对照 §3 判据，不硬套）
  3. 数量级可读（轴不截断失真、标签不重叠、图例全露出、单位齐全）
  4. 动效服务读数（生长 / 揭示 / 数位滚动引导视线，不为动而动）

## 5. 不做清单

- **不复述 chart 字段手册**：六变体字段与硬约束唯一权威 = `code-driven-explainer/references/manifest-contract.md`（chart 段），本壳只给一句话指针。
- **不复述 CSV 解析口径**：分隔符嗅探 / 数值收口规则唯一权威 = `import_csv` 工具描述，本壳不复述。
- **不替代总纲的审批语义**：覆盖层「确认落地」等门禁原样归 `canvas-studio-creation`，本壳不设门也不放行。
