# Canvas Studio 文档索引

> 画布相关的文档都在这里。根目录 `docs/` 只放桌面产品级文档，画布插件文档一律收在本目录。
> **状态问题（做了没 / 还有哪些 bug）一律看 [STATUS.md](./STATUS.md)；本索引只回答「去哪找」。**

## 先看这三篇

| 场景 | 去哪 |
| --- | --- |
| 「这个功能做了没？」「还有哪些 bug？」 | 👉 **[STATUS.md](./STATUS.md)** — 唯一事实来源（§1 速览由 `scripts/status-summary.mjs` 自动生成） |
| 「画布重做/打回怎么用？下一步要改什么？」 | 👉 **[redo-redesign-plan.md](./redo-redesign-plan.md)** |
| 「改完代码要更新哪些文档？」 | 👉 **[DEV-WORKFLOW.md](./DEV-WORKFLOW.md)** |

## 一、状态追踪

| 文档 | 用途 | 权威性 |
| --- | --- | --- |
| **[STATUS.md](./STATUS.md)** | ★ 需求 / 缺陷 / 优化点的**唯一事实来源**。含 CV 主线全量表、历史 ID 映射、待拍板决策点 | **权威**（状态） |
| [canvas-ux-backlog.md](./canvas-ux-backlog.md) | CV 条目的**技术细节**：根因、方案、涉及文件、逐次变更记录 | 权威（技术方案）；状态以 STATUS.md 为准 |
| [tracking.md](./tracking.md) | WorkBuddy 资料库 Bug 表（BUG-001~052，含 A-x/B-x/C-x/D-x/E-x 别名映射）与需求表（REQ-001~030，含 R-Px 别名映射）**唯一账本**：镜像 + 落地映射 + 对账结论 + 派单待办（原 bug-tracker / requirement-tracker 与根仓 docs/tracking/ 三文档于 2026-10-06 合并） | 权威（需求/缺陷映射与派单）；状态终态以 STATUS.md 为准 |
| [canvas-studio-optimization-backlog.md](./canvas-studio-optimization-backlog.md) | O1~O5 早期优化项 | 🗄️ 历史归档（O 系列映射见 STATUS §6） |
| [canvas-studio-acceptance-feedback.md](./canvas-studio-acceptance-feedback.md) | F1~F8 验收反馈 | 🗄️ 历史归档（F 系列映射见 STATUS §6） |
| [archive-cv-completed.md](./archive-cv-completed.md) | 已结项 CV 条目的只读归档（status-summary.mjs 读取） | 归档 |
| [redo-flow-analysis.md](./redo-flow-analysis.md) | 重做流程分析：三条重做路径 + R1~R4 | 权威（分析结论）；状态见 STATUS §6 |
| [code-review/](./code-review/README.md) | ★ 代码审查台账（CR-001~104）：只记到「已修复·待验收」，验收事实以 STATUS 为准 | 权威（审查项状态） |
| [ai-assisted-dev-structure-review.md](./ai-assisted-dev-structure-review.md) | AI 辅助开发适配性评审（根验证链不含 canvas-studio 等 9 弊端） | 待拍板（STATUS §7 G1） |

## 二、设计方案（在役）

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| **[redo-redesign-plan.md](./redo-redesign-plan.md)** | ★ 画布重做能力整改：A 批次 + B 批次 | A 批次 3/4 已落地；A3=CV-053、B 批 CV-054/055 待处理 |
| **[plans/attachment-divert-no-fork.md](./plans/attachment-divert-no-fork.md)** | ★ 附件对话分流（无 fork runtime wrapper）：DivertConversation 机制正本，CV-257 在其上扩展 | 在役核心机制 |
| **[plans/REQ-003-提示词修改框交互方案.md](./plans/REQ-003-提示词修改框交互方案.md)** | 提示词修改框（参考图可编辑 / 就地编辑 / 长内容分档） | CV-265~268 已落地，待桌面验收 |
| **[plans/REQ-005-首页对话式创建与项目排序方案.md](./plans/REQ-005-首页对话式创建与项目排序方案.md)** | 首页宿主对话卡 + 项目按改动时间倒序（v1.4） | ✅ CV-256~262 桌面验收通过 |
| **[plans/REQ-008-对话流中文tool显示与降噪方案.md](./plans/REQ-008-对话流中文tool显示与降噪方案.md)** | 对话流三档中文 tool 行（`tool-presentation.ts` 唯一口径） | ✅ CV-263/264 桌面验收通过 |
| **[plans/REQ-001-全局资产库需求方案.md](./plans/REQ-001-全局资产库需求方案.md)** | ★ 全局资产库（角色/场景/物件/群像 + `@ref[lib:…]`） | ✅ 三步全部落地，2026-09-29 桌面验收通过（CV-255） |
| **[plans/四类文件统一上传改造方案.md](./plans/四类文件统一上传改造方案.md)** | ★ 四类文件统一上传：单按钮自动分类 + 本地落盘 + 惰性 promote | ✅ CV-241 桌面验收通过 |
| [plans/REQ-003-交接提示词.md](./plans/REQ-003-交接提示词.md) | REQ-003 会话交接（一次性） | 交接工件 |
| [plans/draft-to-final-resolution.md](./plans/draft-to-final-resolution.md) | 草稿 → 正式版分辨率工作流 | CV-190 仅设计（CV-190a 已落地） |
| [plans/harness-upgrade-feasibility.md](./plans/harness-upgrade-feasibility.md) | 上游 harness 升级可行性（pin 在 dsh-v0.1.1-rc.2） | 待拍板 |
| [plans/video-provider-abstraction.md](./plans/video-provider-abstraction.md) | 视频供应商抽象层（registry/selection/capability） | 已落地（§0.1 状态行滞后于 §0.3 执行日志） |
| [lobby-skill-marketplace-plan.md](./lobby-skill-marketplace-plan.md) | Lobby 布局 + 技能广场 + skill 激活链路 | Phase A-D 已落地；首页形态已被 REQ-005（CV-257）取代，见头部说明 |
| [video-effect-upgrade-plan.md](./video-effect-upgrade-plan.md) | 视频效果提升 8 项决策对比 | ✅ 已拍板并基本全部落地（决策稿存档） |
| [project-preset-and-screenplay-plan.md](./project-preset-and-screenplay-plan.md) | 项目预置参数 + 剧本阶段 | ✅ CV-099 桌面验收通过 + 剧本工具已上线 |
| [video-mode-selection-plan.md](./video-mode-selection-plan.md) | 语义驱动的视频模式选择 | 🚩 方案定稿·待实施（CV-132） |
| [av-timeline-plan.md](./av-timeline-plan.md) | 音视频统一时间轴规划 | CV-131 立项未启动 / CV-132 定稿待实施（CV-133/135 已落地） |
| [av-sync-implementation-plan.md](./av-sync-implementation-plan.md) | 音画同步实施计划 | ✅ CV-138/140~143 桌面验收通过 |
| [av-ui-acceptance-plan.md](./av-ui-acceptance-plan.md) | 音视频 UI 验收步骤（§6 待对照新 UI 复跑） | 已落地 |
| [av-sync-acceptance-cases.md](./av-sync-acceptance-cases.md) | 音画同步验收剧本（结果就地回填） | 验收工件 |
| [audio-generation-plan.md](./audio-generation-plan.md) | 音频方向唯一规划入口（生成 / 引用 / 原生音轨） | 在役 |
| [audio-acceptance-checklist.md](./audio-acceptance-checklist.md) | 音频链路验收清单（头部有 CV-209 勘误） | 验收工件 |
| [look-asset-plan.md](./look-asset-plan.md) | Look 采集改造与风格质检基准 | ✅ CV-148~152 落地 |
| [canvas-lineage-completion-plan.md](./canvas-lineage-completion-plan.md) | 血缘补全（成片血缘 / 分镜卡血缘 / sourceNodeIds） | CV-204~206 已落地；CV-207/208 待拍板 |
| [video-chain.md](./video-chain.md) | ★ 能力路由与视频链路权威（capability 分派 / 异步任务基线） | 在役 |
| [canvas-node-state-map.md](./canvas-node-state-map.md) | 节点状态地图（状态类名 ↔ 组件 ↔ 语义三档） | 在役 |
| [canvas-studio.md](./canvas-studio.md) | 插件一期开发契约 | 🗄️ 已降级为历史开发档案（现状见 tools/video-chain/STATUS） |
| [visual-direction-plan.md](./visual-direction-plan.md) | 视觉升维 DD 铁律与方向（DD-01~09） | 在役（已推进至 DD-09 / CV-186） |
| [visual-direction-execution-plan.md](./visual-direction-execution-plan.md) | DD 工程清单（STATUS 活跃引用） | 在役 |
| [visual-direction-ui-closeout.md](./visual-direction-ui-closeout.md) | 对照 preview 的 UI 差距清单（含 F 补验分区） | 在役 |
| [competitor-analysis.md](./competitor-analysis.md) | 竞品分析工作区（DA 草案 → 合并 CV/STATUS） | 在役 |

## 三、开发流程

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| **[DEV-WORKFLOW.md](./DEV-WORKFLOW.md)** | ★ 改动画布代码的标准流程：验证链 → 提交 → **收尾必更文档**（STATUS / backlog / 两份 tracker 镜像） | 在役 |
| `node scripts/status-summary.mjs` | **§1 速览自动生成**：读 §4 + archive-cv-completed 重算回写（勿手改速览） | 在役 |
| `node scripts/preview-*.mjs` | **布局静态预览生成器**（lobby / detail / mode / rail 等 20+ 台，输出 `canvas-studio/.workbuddy/preview/`），改布局样式后不开桌面即可肉眼验收 | 在役 |
| [skill-expansion-spec.md](./skill-expansion-spec.md) | 技能扩充规范：新增 skill 的目录格式、质量门与 PR 自查清单 | 在役 |
| [minimax-skills-acceptance.md](./minimax-skills-acceptance.md) | skill 接入验收程序（数字为 09-01 轮快照，程序仍被引用） | 在役 |
| [../plan.md](../plan.md) | 设置页实现记录、MiniMax-H3 接入试点 | 🗄️ 已归档（2026-09-09 自标停更） |

## 四、接口参考

| 文档 | 用途 |
| --- | --- |
| [api.md](./api.md) | Drama Backend 接口权威清单（**v0.4.0**，2026-09-30：异步任务 / withtxt / txt2speech / 双退役标注） |
| [canvas-studio-api-usage.md](./canvas-studio-api-usage.md) | 画布侧调用要点薄索引（调用链路 / 上传流程 / 分辨率档位 / image2fix 纪律 / health 语义） |
| [canvas-studio-tools.md](./canvas-studio-tools.md) | **26 个工具**（25 真实 + 1 占位）的参数与返回说明（有测试守卫强制对账） |

## 五、测试与探针

| 文档 | 用途 |
| --- | --- |
| [acceptance-test-cases.md](./acceptance-test-cases.md) | 全功能验收测试用例集（A~X 组；X=首页形态） |
| [canvas-studio-skill-regression-matrix.md](./canvas-studio-skill-regression-matrix.md) | skill 放手跑回归矩阵（方案在役、首轮未跑，覆盖 10/22） |
| [effect-tests/](./effect-tests/) | 视频效果验证测试用例与轮次记录 + runs/（与 `scripts/collect-effect-tests.mjs` 闭环） |
| [api-probe/INDEX.md](./api-probe/INDEX.md) | 探针报告总索引（在役证据链 + archive 复验链） |

## 六、交接

| 文档 | 用途 |
| --- | --- |
| [canvas-studio-handoff.md](./canvas-studio-handoff.md) | 主交接文档：已验证机制（勿推翻）、命令备忘、Git 工作流 |
| `archive/` 内四份带日期 handoff | 🗄️ 历史交接快照（handoff-2026-09-04 / HANDOFF-2026-09-07 / handoff-node-state / handoff-product-consultant） |

## 七、跨模块专题（文件在根 `docs/`）

> 这几篇同时关涉画布插件与桌面产品（跨进程边界），按根 `docs/` 收纳规则放在仓库根。

| 文档 | 用途 |
| --- | --- |
| **[../../docs/canvas-studio-error-system.md](../../docs/canvas-studio-error-system.md)** | ★ 统一错误处理系统设计：双轴受众/可恢复性、`routeError()` 路由矩阵、§10 全码附录（62 条，与 catalog 逐条核验） |
| [../../docs/canvas-studio-error-handbook.md](../../docs/canvas-studio-error-handbook.md) | 错误处理手册：§4 历史字符串清单 + §6 错误码索引（`code → 抛出位置`，2026-09-30 全量重建） |
| [../../docs/canvas-studio-task-timeout-spec.md](../../docs/canvas-studio-task-timeout-spec.md) | 任务调度与超时规格（异步视频链路 / 队列 / 全部超时档与错误码） |

## 八、归档

| 位置 | 内容 |
| --- | --- |
| [archive/](./archive/README.md) | 🗄️ **使命完成的方案与专题**（19 份顶层 + 13 份 plans，逐份归档原因见表） |
| [api-probe/archive/](./api-probe/INDEX.md) | 09-10~09-11「CV-145 误判→撤回」复验链 |

---

## 文档纪律（一句话版）

**状态写 STATUS.md，技术细节写对应专题文档，改完代码回来更新两边；文档完成使命就移入 `archive/` 并在归档表登记一行。** 详细规则见 [DEV-WORKFLOW.md](./DEV-WORKFLOW.md)。
