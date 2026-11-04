# 上游体裁壳回指（format directors）

**给谁看**：本 skill 的执行者。**用户点名本 skill 时，仍须先加载对应体裁壳做定向** ——
点名只决定「用哪条链」，不替代「受众 / 记住哪一件事 / 时长画幅」这类定向三问。

## 事故（2026-11-04 · 科普 0.1 验收 A1）

用户点名 `code-driven-explainer` 时，agent **主动跳过**了 `explainer-format-director`
编排壳。第 2 步 reasoning 原文：

> The 科普讲解体裁 format director exists but user named code-driven-explainer directly.
> … User named the executor directly. I'll load code-driven-explainer and its references.

结果：定向三问（受众 / 记住哪一件 / 时长画幅）**一项未问**，实际只问了音色与数据口径。
中文版与英文重制版**两批都 FAIL**。

根因不是 agent 忘了，而是**两条规则冲突**：插件通用规则「用户点名 skill → 直接调用」
压过了体裁壳的「点名下游也要先过壳定向」。光靠会话行为约定无效 ——
**必须在 skill 描述层把冲突消解掉**（壳侧 description + executor 侧回指，双向）。

## 映射表（按需求类型选壳）

| 需求类型 | 上游体裁壳 | 定向三问 |
|---|---|---|
| 科普 / 讲解 / 知识视频 / 原理 | `explainer-format-director` | 受众 / 记住哪一件事 / 时长画幅 |
| 数据视频 / 图表动画 / KPI / 年度总结 | `data-viz-format-director` | 数据来源 / 图型选型 / 时长画幅 |
| 产品广告 / 走查 / 电商 / 新品发布 | `product-format-director` | 产品与素材现实 / 卖点与调性 / 时长画幅 |
| 抖音 / 信息流 / 带货 / 种草 | `social-ad-format-director` | 平台场景 / 前 3 秒钩子 / 时长画幅多版本 |

## 怎么做

1. **先加载对应壳**，按壳的「定向三问」逐项问（`ask_user_choice`，一次一个要素）。
2. 再按壳的链路路由表选中本 skill 与其它 executor。
3. 本 skill 只负责「已定稿之后，怎么把素材组装成 manifest 并交给 `render_composition`」。

## 为什么受众必须问

科普片的**受众**（小学生 vs 航天爱好者）直接决定叙述密度与举例深度 ——
不问受众等于让 agent 猜，这是 45s 科普片最不该猜的变量。
