# Canvas Studio 文档索引

> 画布相关的文档都在这里。根目录 `docs/` 只放桌面产品级文档，画布插件文档一律收在本目录。

## 先看这三篇

| 场景 | 去哪 |
| --- | --- |
| 「这个功能做了没？」「还有哪些 bug？」 | 👉 **[STATUS.md](./STATUS.md)** — 唯一事实来源 |
| 「画布重做/打回怎么用？下一步要改什么？」 | 👉 **[redo-redesign-plan.md](./redo-redesign-plan.md)** |
| 「改完代码要更新哪些文档？」 | 👉 **[DEV-WORKFLOW.md](./DEV-WORKFLOW.md)** |

---

## 一、状态追踪

| 文档 | 用途 | 权威性 |
| --- | --- | --- |
| **[STATUS.md](./STATUS.md)** | ★ 需求 / 缺陷 / 优化点的**唯一事实来源**。含 CV 主线全量表、历史 ID 映射、待拍板决策 | **权威**（状态） |
| [canvas-ux-backlog.md](./canvas-ux-backlog.md) | CV-001~066 的**技术细节**：根因、方案、涉及文件、逐次变更记录 | 权威（技术方案）；状态以 STATUS.md 为准 |
| [canvas-studio-optimization-backlog.md](./canvas-studio-optimization-backlog.md) | O1~O5 早期优化项 + 已落地清单 | 历史归档；状态见 STATUS.md §6 |
| [canvas-studio-acceptance-feedback.md](./canvas-studio-acceptance-feedback.md) | F1~F8 验收反馈的现象 / 根因 / 修复方案 | 历史归档 |
| [redo-flow-analysis.md](./redo-flow-analysis.md) | 重做流程分析：三条重做路径（分镜打回 / 节点重试 / 对话重做）+ R1~R4 | 权威（分析结论）；状态见 STATUS.md §6 |
| [next-steps-review.md](./next-steps-review.md) | 2026-08-29 待办盘点与批次规划 | ⚠️ **部分滞后**：O4 关键帧确认闸已落地，文中仍标「需拍板」。状态一律以 STATUS.md 为准 |
| [hitl-workflow-analysis.md](./hitl-workflow-analysis.md) | HITL 工作流设计与闸门机制 | ⚠️ **部分滞后**：文中断言「关键帧确认当前不实现」，实际已落地（O4）。历史分析保留 |

## 二、设计方案

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| **[redo-redesign-plan.md](./redo-redesign-plan.md)** | ★ 画布重做能力整改方案：A 批次（分镜卡复用 / 关键帧打回 / 模式切换 bug / 审批条醒目化）+ B 批次（版本回退 / 过时标记） | 进行中，待开工 |
| **[lobby-skill-marketplace-plan.md](./lobby-skill-marketplace-plan.md)** | ★ Lobby 布局（CV-064）+ 技能广场（CV-065）+ skill 激活链路（CV-066）四阶段方案：Phase A 布局 / B 数据层 / C UI / D 激活链路，含改动清单与验收法 | 进行中：Phase A 已落地待验收；B/C/D 待开工 |
| [video-effect-upgrade-plan.md](./video-effect-upgrade-plan.md) | 视频效果提升方案（决策稿）：Ref2VA 参考组合模式 / 六段式规范 / 抽卡 / 镜头节奏等 8 项「现状 vs 建议」逐项对比，待拍板 | 待拍板 |
| [canvas-studio.md](./canvas-studio.md) | 插件主设计文档（架构、数据模型、工具集） | 参考 |
| [canvas-studio-phase2.md](./canvas-studio-phase2.md) | 二期设计，§11 残留项已并入 next-steps-review | 参考 |
| [optimization-plan.md](./optimization-plan.md) | 下一阶段大方案（五步工作流 / 双层版本控制 / 多模型适配 / 素材库 / 实时反馈 + Phase 1-4） | ⚠️ **纯设计稿，代码零落地**（2026-09-01 核实）。保留远期参考，不进当前排期 |
| [brand-identity-proposal.md](./brand-identity-proposal.md) / [brand-identity-audit.md](./brand-identity-audit.md) | 品牌识别度方案与审计 | 已定案落地（`f56f80673a` / `f16d33d351`） |

## 三、开发流程

| 文档 | 用途 |
| --- | --- |
| **[DEV-WORKFLOW.md](./DEV-WORKFLOW.md)** | ★ 改动画布代码的标准流程：验证链 → 提交 → **收尾必更文档** |
| `node scripts/preview-lobby.mjs` | **布局静态预览生成器**：从 `src/client/styles.ts` 抽 `STUDIO_STYLES` + 最小令牌表 + 骨架 DOM 生成单文件 HTML（lobby/work 切换 + 亮暗切换），改布局样式后不开桌面即可肉眼验收。输出到 `canvas-studio/.workbuddy/preview/lobby-layout-preview.html` |
| [skill-expansion-spec.md](./skill-expansion-spec.md) | 技能扩充规范：新增上游/自研 skill 的目录格式、两条路径、质量门与 PR 自查清单 |
| [../plan.md](../plan.md) | 设置页实现记录、设置页 Roadmap、MiniMax-H3 skill 接入试点 |

## 四、接口参考

| 文档 | 用途 |
| --- | --- |
| [api.md](./api.md) | Drama Backend 接口权威清单（v0.2.x） |
| [canvas-studio-api-usage.md](./canvas-studio-api-usage.md) | 画布侧对接口的实际调用方式 |
| [canvas-studio-tools.md](./canvas-studio-tools.md) | 16 个 Host 工具的参数与返回说明 |
| [api-integration-audit.md](./api-integration-audit.md) | 接口集成审计 |
| [api-upload-test-report.md](./api-upload-test-report.md) | 上传接口实测报告（含 >1MB 溢写、连续请求打挂等问题） |

## 五、测试

| 文档 | 用途 |
| --- | --- |
| [acceptance-test-cases.md](./acceptance-test-cases.md) | 全功能验收测试用例集 |
| [canvas-studio-e2e-testing.md](./canvas-studio-e2e-testing.md) | E2E 测试方法与结论 |
| [canvas-studio-skill-regression-matrix.md](./canvas-studio-skill-regression-matrix.md) | skill 回归矩阵 |
| [minimax-skills-acceptance.md](./minimax-skills-acceptance.md) | MiniMax skill 验收记录 |

## 六、交接

| 文档 | 用途 |
| --- | --- |
| [canvas-studio-handoff.md](./canvas-studio-handoff.md) | 主交接文档：当前状态、已验证机制（勿推翻）、命令备忘、Git 工作流 |
| [handoff-product-consultant.md](./handoff-product-consultant.md) | 产品顾问视角的交接补充 |

---

## 文档纪律（一句话版）

**状态写 STATUS.md，技术细节写对应专题文档，改完代码回来更新两边。** 详细规则见 [DEV-WORKFLOW.md](./DEV-WORKFLOW.md)。
