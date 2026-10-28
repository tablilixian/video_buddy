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
| **[STATUS.md](./STATUS.md)** | ★ 需求 / 缺陷 / 优化点的**唯一事实来源**。含 CV 主线索引（§4.1，只管状态）、历史 ID 映射、待拍板决策点 | **权威**（状态） |
| [cv-details.md](./cv-details.md) | STATUS.md §4.1 索引表的**详情层**：每条一个 `#### CV-xxx` 小节（详情 / 涉及文件 / 落地·验收，含「缺陷追踪（§2.1）」块）。**按号 grep 取用，勿整读** | 详情（**不承载状态**，状态以 STATUS.md §4.1 为准） |
| [changelog.md](./changelog.md) | 2026-10 起的**逐条变更流水**（原 STATUS.md §8，2026-10-13 整体迁出）。只追加；**按日期 / CV 号 grep** | 历史流水；状态以 STATUS.md 为准 |
| [canvas-ux-backlog.md](./canvas-ux-backlog.md) | CV 条目的**技术细节**：根因、方案、涉及文件、逐次变更记录 | 权威（技术方案）；状态以 STATUS.md 为准 |
| [tracking.md](./tracking.md) | WorkBuddy 资料库 Bug 表（BUG-001~055，含 A-x/B-x/C-x/D-x/E-x 别名映射）与需求表（REQ-001~032，含 R-Px 别名映射）**唯一账本**：落地映射 + 对账结论 + 派单待办。**索引表手工维护**（原 `scripts/generate-tracking-html.mjs` 生成器与 `tracking.html` 视图已于 2026-10-13 移除）；状态只改条目正文（2026-10-06 五账合一：原 bug-tracker / requirement-tracker 与根仓 docs/tracking/ 三文档） | 权威（需求/缺陷映射与派单）；状态终态以 STATUS.md 为准 |
| [tracking-closed.md](./tracking-closed.md) | 🗄️ tracking.md 的已终结条目沉降档（验收通过/已拍板/已销项/已解决），只进不出；索引仍由脚本生成全量行 | 只读沉降档；查旧条目按编号 grep |
| [canvas-studio-optimization-backlog.md](./canvas-studio-optimization-backlog.md) | O1~O5 早期优化项 | 🗄️ 历史归档（O 系列映射见 STATUS §6） |
| [canvas-studio-acceptance-feedback.md](./canvas-studio-acceptance-feedback.md) | F1~F8 验收反馈 | 🗄️ 历史归档（F 系列映射见 STATUS §6） |
| [archive-cv-completed.md](./archive-cv-completed.md) | 已结项 CV 条目的只读归档（status-summary.mjs 读取） | 归档 |
| [redo-flow-analysis.md](./redo-flow-analysis.md) | 重做流程分析：三条重做路径 + R1~R4 | 权威（分析结论）；状态见 STATUS §6 |
| [code-review/](./code-review/README.md) | ★ 代码审查台账（CR-001~104）：只记到「已修复·待验收」，验收事实以 STATUS 为准 | 权威（审查项状态） |
| **[canvas-studio-architecture-review.md](./canvas-studio-architecture-review.md)** | ★ **全仓架构 + 代码审查报告**（2026-10-11）：设计原理 7 条 / 结构地图 / 功能完成度矩阵 / 技能与测试评估 / **AR-01~AR-14 发现**（含 §6.4「已核实无问题」清单）/ 三批优化方案。**AR-xx 是独立命名空间，不占 CV/CR/BUG 序列**；只作优化立项凭据，**不作验收凭据**（静态取证，未跑构建/真机，见其 §0.5） | 权威（架构与审查结论）；状态仍以 STATUS 为准 |
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
| **[plans/REQ-034-代码驱动合成与低成本科普视频需求方案.md](./plans/REQ-034-代码驱动合成与低成本科普视频需求方案.md)** | ★ REQ-034 代码驱动合成（Remotion，路线 B / CSR）：需求正本 + FR/NFR/AC + Z 组验收用例；技术事实源是 [`plans/remotion/remotion-integration-devdoc-2026-10-14.md`](./plans/remotion/remotion-integration-devdoc-2026-10-14.md)（v1.6） | B1/B2 契约层+组件库已入库；**B3 工具链（CV-327）与 B4 skill `code-driven-explainer`、R1 随包中文字体（CV-328）已落码待验收** |
| **[plans/2026-10-25-交接-新会话继续.md](./plans/2026-10-25-交接-新会话继续.md)** | ★★ **新会话入口**：30 秒上手 / 状态看板 / 未完成任务（故事板强约束 L1–L5、shotcraft D19–D22、B3–B5）/ 铁律与坑 / 验证套路 | 每次交接先读这份 |
| **[plans/2026-10-25-故事板强约束-彻底方案.md](./plans/2026-10-25-故事板强约束-彻底方案.md)** | ★★ **待落码的最大一块**：故事板强约束 L1–L5（声明式 gate / 单一事实源 + 自愈 / auto 自动落地 / 老项目迁移工具 / G6 契约补齐）+ 逐文件改动清单 + 测试矩阵 | 已拍板，**零落码**；顺序铁律 L3→L1→L2，L4 必须与 L1 同批 |
| **[plans/2026-10-25-会话5诊断-shotcraft能解决什么.md](./plans/2026-10-25-会话5诊断-shotcraft能解决什么.md)** | ★ 会话 #5 诊断（187.6min / 219 步 / 211 次 bash / 88 次 python3 / `render_composition` **0 次**）：故事板被跳过的实证 + "布局坐标表比卡片库值钱" | **优先级调整依据**（D19–D22 来源） |
| **[plans/2026-10-25-方案验证报告-镜头卡与主题预设.md](./plans/2026-10-25-方案验证报告-镜头卡与主题预设.md)** | 真渲 14 张镜头卡 + 2 套主题：**14/14 通过**，抓出 3 个真问题（`kenBurns` 死字段 / `animate` 无 `scaleX·Y` / ink-press 太暗）；热态 1.4s/张 | 卡片库的实测底稿 |
| **[plans/2026-10-25-shotcraft吸收方案.md](./plans/2026-10-25-shotcraft吸收方案.md)** | shotcraft 吸收的落地形态（卡片 / 主题 / 布局表 / 音效四类的取舍与成本） | 待 P1/P2 排期 |
| **[plans/2026-10-25-video-shotcraft调研与适配评估.md](./plans/2026-10-25-video-shotcraft调研与适配评估.md)** | video-shotcraft 调研：**整包不引入**、只吸四样；逐条回答"模板能不能复用"（设计语言 100% / 资产大部分 / TSX 不能） | 结论已定：不 vendor、不移植 TSX |
| **[plans/2026-10-25-会话诊断与故事板强约束分析.md](./plans/2026-10-25-会话诊断与故事板强约束分析.md)** | 会话诊断与故事板强约束的推导过程（S1–S3 缺口 + I1–I5 不变量的来源） | 方案的前置论证 |
| **[plans/2026-10-25-Remotion-skill与工具可理解性审计.md](./plans/2026-10-25-Remotion-skill与工具可理解性审计.md)** | skill/工具可理解性审计 G1–G4：缺口清单 + 修法 + 结果（描述 41.6K→36.2K 字符） | ✅ CV-366 已修 |
| **[plans/2026-10-24-首屏延迟与每步固定开销分析.md](./plans/2026-10-24-首屏延迟与每步固定开销分析.md)** | 首屏 13s / 16min 到第一次提问的拆解（每步 ≈6s 固定 TTFT 在 provider 侧） | 参考事实，不改码 |
| **[plans/2026-10-25-B3异步派发设计稿.md](./plans/2026-10-25-B3异步派发设计稿.md)** | **B3-1 F-19 异步派发设计稿**（待评审，未动码）：现状数字 / 已有地基（工单·认领·看门狗可直接复用）/ **真正的难点是"结果怎么回到同一轮对话"**（三方案 + 必须先 spike 的接口前提）/ 接口草案 / 分期 / D23–D25 | 评审通过才动码 |
| **[plans/2026-10-24-收口与后续路线图.md](./plans/2026-10-24-收口与后续路线图.md)** | ★ **排期事实源（v3）**：已交付（CV-363~366）/ 待真机 Z-1~Z-7 / **§3.0 故事板强约束 L1–L5 为下一步** / §3.0b shotcraft P0 / B3~B5 后移 / 待拍板 D9~D22 | **批次顺序只认这份 §3**；交接文档管上下文与坑，两处冲突以本表为准 |
| **[plans/REQ-035-Phase0-取证报告-20261024.md](./plans/REQ-035-Phase0-取证报告-20261024.md)** | ★ REQ-035 Phase 0 真机取证：39 次超时到底卡在哪（应用日志 + 源码双证，B+C 级结论） | 根因定死：工单基本没走隐藏窗口；三条硬证据 + 五个结构性缺陷 |
| **[plans/REQ-035-渲染可靠性修复计划-20261024.md](./plans/REQ-035-渲染可靠性修复计划-20261024.md)** | ★ REQ-035 修复计划：F-01~F-20 明细 + D1~D8 决策 + 验收矩阵 + 不做清单 | P0/P1 已落地（CV-363~365）；F-10/F-11/F-14~F-20 待做 |
| **[plans/REQ-035-真机验收清单-20261024.md](./plans/REQ-035-真机验收清单-20261024.md)** | REQ-035 真机验收：Z-1~Z-7 用例 + 判定器 `scripts/render-forensics/verify-live.mjs`（L-1~L-5） | 待桌面执行 |
| **[plans/REQ-034-剩余工作-20261016.md](./plans/REQ-034-剩余工作-20261016.md)** | ★ REQ-034 **剩余工作清单 + 四个设计问题定论**（字体怎么落地 / 是否已接入现有流程 / 何时触发 Remotion 线路 / 是否体现在故事板） | 取代 `REQ-034-会话交接-20261016.md`；**R1 字体已落（CV-328）**，剩 R2 成片质检 / R3 真素材端到端 / R4 Z 组边界 / R5 打包 / R6 路由接线 |
| **[plans/REQ-034-纯代码短片推演-20261016.md](./plans/REQ-034-纯代码短片推演-20261016.md)** | REQ-034 **端到端推演**（30s 太阳系科普 · 纯 Remotion 代码生成）：前提条件 / agent 与 skill 分工 / 四方案实测评测 / D1~D11 问题清单 / P0~P2 建议。探针 `scripts/probe-solar-manifest.mjs` | 推演 + 优化建议（未改产品代码，不占号） |
| **[plans/REQ-034-Remotion能力补齐计划-20261016.md](./plans/REQ-034-Remotion能力补齐计划-20261016.md)** | REQ-034 **能力补齐与启用计划**：路线判断（四层缺口，最薄的是表达层与反馈层）+ 还差多少（8 簇空 6）+ 分档 B1~B5（animate DSL / 语义 primitive / 未知字段告警 / 效果包 / 组件白名单）+ 验收方式 + 明确不做 | 计划（未改产品代码，不占号）；开工时按批次取号 |
| **[plans/REQ-034-完整集成路线图.md](./plans/REQ-034-完整集成路线图.md)** | REQ-034 **完整能力集成路线图（2026-10-17 重开）**：一期 MVP（CV-327/328/329/330/334/336/337）已完成 → 从最小可用转向尽可能完整集成；重开 B2 语义 primitive / 效果栈 / 形状·转场库 / 音频可视化 / 长片队列 / 渲染重试，保持 player 只读现状，KTV 列条件项；A~D 四档 + 硬约束清单 + 批次排序 | 路线图（未改产品代码，不占号）；取代旧计划 §一①/§五 与剩余工作延后项 |
| **[plans/REQ-034-二期开发文档-20261017.md](./plans/REQ-034-二期开发文档-20261017.md)** | ★ REQ-034 **二期执行手册（决策定稿版）**：现状事实表（水位/锚点/门禁/两份 checkout）+ **§二 决策记录 D-01~D-11 全部已拍板**（许可 Free+可注入 key / 合成顺序互斥 / A3 补装·A4 手写 / 队列参数 / 进度通道 / 兼容策略 / R2 / A6 / 验收节奏 / 前置修复 / `fx` 命名）+ **§2.12 文档定不了的 3 类外部依赖 + 2 处能力缺口** + 批次 1a(A1 orbit·draw) / 1b(D1 队列) / 2 / 3 / 4 的文件级落点与验收 + 依赖安装 Runbook + 反向变异要求 + 开工 checklist | ✅ **已全量落码 CV-338~CV-348（待桌面验收）**；三级 tsc + tsdown + 定向 171 断言通过，**全量 test:smoke 与 GUI 真渲未跑** |
| [plans/REQ-034-能力补齐交接-20261016.md](./plans/REQ-034-能力补齐交接-20261016.md) | REQ-034 **能力补齐线会话交接**：开工第一件事 / 路线判断 / 四层缺口实测 / B1~B5 分档 + 待拍板 7 项 / 验收边界 / 纪律与陷阱 / 命令速查 | 交接工件（一次性，开工后即失效） |
| **[plans/四类文件统一上传改造方案.md](./plans/四类文件统一上传改造方案.md)** | ★ 四类文件统一上传：单按钮自动分类 + 本地落盘 + 惰性 promote | ✅ CV-241 桌面验收通过 |
| [plans/REQ-003-交接提示词.md](./plans/REQ-003-交接提示词.md) | REQ-003 会话交接（一次性） | 交接工件 |
| [plans/draft-to-final-resolution.md](./plans/draft-to-final-resolution.md) | 草稿 → 正式版分辨率工作流 | CV-190 仅设计（CV-190a 已落地） |
| [plans/harness-upgrade-feasibility.md](./plans/harness-upgrade-feasibility.md) | 上游 harness 升级可行性（pin 在 dsh-v0.1.1-rc.2） | 🗄️ **已过时（被取代）**：项目已于 2026-10-21 升到 0.2.1-rc.2，"暂缓升级"结论已推翻 |
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
| **[plans/2026-10-27-文档与散落资产归位方案.md](./plans/2026-10-27-文档与散落资产归位方案.md)** | ★ 仓库级**位置治理**：根目录 12 项 + 根 `docs/` 5 项 + 本目录 6 项 + `api-playground/` 的搬迁清单，含逐文件引用核查（file:line）与「调查后判定不动」的理由。只挪位置、不改内容、不改体积 | 🚧 执行中：Batch 1、2 已落地（2026-10-28） |
| **[plans/2026-10-27-超大文件清单与拆分方案.md](./plans/2026-10-27-超大文件清单与拆分方案.md)** | ★ 代码侧**可维护性清单**：6 个 P0 超大文件（`styles.ts` / `host-tools.ts` / `generate.ts` / `routes.ts` / `StudioFrame.tsx` / `client/index.ts`）+ 15 个 P1，含结构实测、拆分方案、**读源码测试的阻力矩阵**与落地节奏 | 📋 参考清单（未动代码） |
| **[plans/2026-10-28-超大文件拆分执行计划.md](./plans/2026-10-28-超大文件拆分执行计划.md)** | ★ 上一行的**施工单（用例先行）**：7 阶段 / ~11 PR / ~30 条新测试；每域先落画像测试（快照、路由枚举、byte-equal、锚点盘点）再搬动，含 desktop / market 补漏（修正了清单未覆盖的两处类跨度误报）与登记式修改三处例外（T2.4 / T4.4 / T6.2） | 🚧 执行中：PR-0 大小闸已落地（2026-10-28） |
| **[plans/remotion/](./plans/remotion/)** | ★ **REQ-034 Remotion 专题（4 份）**：`remotion-integration-devdoc-2026-10-14.md`（**唯一实现事实源**，v1.7 / 1,517 行）· `remotion-integration-roadmap-2026-10-13.md`（早期路线图，已被取代）· `remotion-research-2026-10-13.md`（范式与生态调研）· `openmontage-adoption-analysis-2026-10-13.md`（对标分析）。后三份均带顶部勘误声明，**勿照抄其中 API** | 事实源在役；其余三份为背景（2026-10-28 由仓根迁入） |

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
| [canvas-studio-tools.md](./canvas-studio-tools.md) | **28 个工具**（27 真实 + 1 占位）的参数与返回说明（**数字由 `tests/tool-registry.test.mjs` 钉死**，增删改名即红；2026-10-12 AR-06 勘误：此前写 26；2026-10-16 REQ-034 加 `render_composition`；2026-10-23 加 `inspect_image`；2026-10-24 REQ-035 加 `scaffold_manifest`；2026-10-25 故事板强约束 L4 加 `adopt_canvas_as_storyboard`） |

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
| [canvas-studio-handoff.md](./canvas-studio-handoff.md) | 🗄️ 历史归档（2026-08-21 交接快照）：已验证机制、命令备忘仍有参考价值；**现状与待办以 tracking.md / STATUS.md 为准**，勿按其「当前权威」行动 |
| `archive/` 内四份带日期 handoff | 🗄️ 历史交接快照（handoff-2026-09-04 / HANDOFF-2026-09-07 / handoff-node-state / handoff-product-consultant） |

## 七、跨模块专题（文件在根 `docs/`）

> 这几篇同时关涉画布插件与桌面产品（跨进程边界），按根 `docs/` 收纳规则放在仓库根。

| 文档 | 用途 |
| --- | --- |
| **[../../docs/canvas-studio-error-system.md](../../docs/canvas-studio-error-system.md)** | ★ 统一错误处理系统设计：双轴受众/可恢复性、`routeError()` 路由矩阵、§10 全码附录（**63 条**，2026-10-12；数字以运行面 `listErrorSpecs()` 为准，勿用正则数源码） |
| [../../docs/canvas-studio-error-handbook.md](../../docs/canvas-studio-error-handbook.md) | 错误处理手册：§4 历史字符串清单 + §6 错误码索引（`code → 抛出位置`，2026-09-30 全量重建） |
| [../../docs/canvas-studio-task-timeout-spec.md](../../docs/canvas-studio-task-timeout-spec.md) | 任务调度与超时规格（异步视频链路 / 队列 / 全部超时档与错误码） |

## 八、归档

| 位置 | 内容 |
| --- | --- |
| [archive/](./archive/README.md) | 🗄️ **使命完成的方案与专题**（19 份顶层 + 13 份 plans，逐份归档原因见表） |
| [api-probe/archive/](./api-probe/INDEX.md) | 09-10~09-11「CV-145 误判→撤回」复验链 |

## 九、演示与原型（demos/）

> 可双击打开的设计稿 / 演示 / 走查页。**没有运行时用途**（不进产物、不被代码引用），只作为视觉与流程依据。

| 位置 | 内容 | 来源 |
| --- | --- | --- |
| [demos/layout/canvas-layout-v2.html](./demos/layout/canvas-layout-v2.html) | 版式设计稿 v2 —— 镜号泳道方案的定稿原型（`canvas-view.ts` 的镜号解析即按它移植） | 2026-10-27 由仓根迁入 |
| [demos/layout/canvas-layout-v2-assets/](./demos/layout/canvas-layout-v2-assets/) | 上面的配套截图 16 张。⚠️ **目录名被 HTML 第 57 行硬编码**（`ASSET_BASE = './canvas-layout-v2-assets/'`），改名即全丢图 | 同上 |
| [demos/layout/canvas-layout-demo.html](./demos/layout/canvas-layout-demo.html) | 版式设计稿 v1（被 v2 取代，留作对照） | 同上 |
| [demos/layout/canvas-layout-rules.txt](./demos/layout/canvas-layout-rules.txt) | 版式规则说明（被 `canvas-layout-demo.html` 内注释引用，**必须与它同目录**） | 同上 |
| [demos/canvas_studio_flow.html](./demos/canvas_studio_flow.html) | R-P0-01 / REQ-022 创作流水线全景十段式（REQ-022 会话交接的主展示材料） | 同上 |
| [demos/canvas-specrow-design-mock.html](./demos/canvas-specrow-design-mock.html) | 规格行（specrow）设计稿 | 同上 |
| [demos/req022-acceptance-tour.html](./demos/req022-acceptance-tour.html) | REQ-022 验收走查页 | 同上 |
| [demos/remotion/remotion-integration-demo.html](./demos/remotion/remotion-integration-demo.html) | REQ-034 Remotion 集成的**流程可视化**（编码在客户端渲染进程 CSR）—— devdoc 指定为「配套可视化参考」，可离线打开 | 2026-10-28 由仓根迁入 |
| `demos/` 其余 | 既有演示与走查记录：REQ-001 资产库 demo、全链路 demo、`canvas-waterfall-demo-2026-10-26/`、`layout-demo-20261026/`、`acceptance-review-2026-10-19.md`、`phase3-in-this-film.md` 等 | 原有 |

---

## 文档纪律（一句话版）

**状态写 STATUS.md，技术细节写对应专题文档，改完代码回来更新两边；文档完成使命就移入 `archive/` 并在归档表登记一行。** 详细规则见 [DEV-WORKFLOW.md](./DEV-WORKFLOW.md)。
