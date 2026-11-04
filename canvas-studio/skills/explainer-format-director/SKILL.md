---
name: explainer-format-director
description: 科普讲解体裁的 L2 编排壳（format director）。凡「科普 / 讲解 / 知识视频 / 原理 / 科普短片 / explainer / science video」类需求，先用定向三问对齐（受众 / 记住哪一件事 / 时长画幅），再按链路路由表把任务分派给下游 executor（code-driven-explainer / papercraft-stop-motion-explainer / paper-collage-explainer-generator）。用户点名下游 executor 时本壳仍须先加载做定向——点名只决定「用哪条链」，不替代「受众 / 记住哪一件事 / 时长画幅」三问。本 skill 只做定向与调度，不复述任何 executor 的手法与 manifest 细节；上游是 canvas-studio-creation 总纲，不改变其流程与审批语义。触发词：科普、讲解、知识视频、原理、科普短片、explainer、science video。
---

# 科普讲解体裁编排（explainer-format-director）

**定位**：L2 编排壳。上游是 `canvas-studio-creation` 总纲——需求澄清、审批语义、工具契约一律归总纲；下游挂三个 executor：

- `code-driven-explainer`（Remotion 精排，`render_composition`）
- `papercraft-stop-motion-explainer`（H3 图生视频逐镜）
- `paper-collage-explainer-generator`（H3 拼贴）

本 skill 只做**定向与路由**，选定链路后加载对应 executor 执行——具体手法与 manifest 字段见其 SKILL.md 与 references/。

## 1. 定向三问（对齐 Direction 阶段）

开工前对齐三件事（`ask_user_choice`；放手跑模式改为自列假设）。**可与 §2 的路由选择合并成一次提问**——先问呈现方式，受众/记忆点再补问或交由 executor 的澄清流接手；项目已有时长/画幅预设则沿用预设，不重复问：

1. **受众是谁**（给谁看，决定语速与信息密度）
2. **看完记住哪一件事**（一句话核心记忆点）
3. **期望时长与画幅**（项目无预设时才问；缺省 9:16 或 16:9 二选一，60–90s）

问完即在回复中复述定向结论（受众 / 记忆点 / 时长画幅）再开工。

## 2. 链路路由表

| 需求特征 | 链路 | 判据 |
|---|---|---|
| 概念 / 数据 / 流程讲解（零素材或图表为主） | `code-driven-explainer`（Remotion 精排，`render_composition`） | 文字量大、字幕要可读；**数据必须精确 → 必须 code-driven**（生成模型画图表会编假数，数字只能由代码渲染） |
| 手工质感 / 童趣 / 纸艺定格 | `papercraft-stop-motion-explainer`（H3 图生视频逐镜） | 素材预算充足、要写实质感 |
| 编辑感拼贴 / 快节奏视觉梗 | `paper-collage-explainer-generator`（H3，默认无字幕无 BGM） | 素材预算充足、可读文字要求低 |

**降级路径**：Remotion 链素材拿不到 → 退 explainer-cards 零素材配方（见 code-driven-explainer 的 recipe）。

## 3. 结构预算（开工前对齐）

段结构与时长占比（钩子/主体/收尾权重、单卡时长、一屏一点，含对比型/时间线型/原理拆解型模板）**唯一权威 = `code-driven-explainer/references/explainer-patterns.md`**——开工前按它对齐，本壳不复述比例表。

## 4. executor 指派与交付要求

选定链路后**显式声明**走哪个 executor（如「本片走 code-driven-explainer」），再加载该 skill 开工。

- **旁白**：统一走 `tts_voiceover` / `tts_narration`；音色锚纪律见 voiceover-writing skill，本壳不复述。
- **验收清单**（4 条，交付前逐条核对）：
  1. 钩子前三秒有信息量（不是空镜或标题卡干等）
  2. 要点 ≤5
  3. 数字非编造（有出处，或由 dataCard / chart 代码渲染）
  4. 至少一处动效（成片不像 PPT）

## 5. 不做清单

- **不替代总纲的审批语义**：覆盖层「确认落地」等门禁原样归 `canvas-studio-creation`，本壳不设门也不放行。
- **不复述 manifest 字段手册**：字段与硬约束指到 `code-driven-explainer/references/`（manifest-contract 等），本壳只给一句话指针。
- **不为科普强行引入视频模型**：H3 只留给写实质感的英雄镜头（或上述两条 H3 链整体接管时），不要为「消静态」逐镜生成视频。
