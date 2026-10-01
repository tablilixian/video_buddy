# 文档归档区（archive）

> **本目录收录「使命已完成」的文档**（2026-09-30 文档整理批移入）。归档 ≠ 删除：内容仍是决策留痕与取证材料，git 历史完好。
> **一切「做了没 / 现状如何」的问题一律以 [../STATUS.md](../STATUS.md) 为准**；本目录任何文档都不得再当现状依据。
>
> | 原位置 | 现位置 |
> | --- | --- |
> | `docs/<file>.md`（canvas-studio 顶层） | `docs/archive/<file>.md` |
> | `docs/plans/<file>.md` | `docs/archive/plans/<file>.md` |
> | `docs/api-probe/<item>`（09-10~09-11 复验链） | `docs/api-probe/archive/<item>`（另见 [../api-probe/INDEX.md](../api-probe/INDEX.md)） |

## 一、方案稿（plans/，13 份）

| 文档 | 归档原因（均已验证） |
| --- | --- |
| `plans/bundled-ffmpeg.md` | CV-201 已落地·待验收（`ffmpeg-run.ts` resolveFfmpegPath + 随包管线） |
| `plans/canvas-studio-consistency-solution.md` | C1~C5 全部落地（CV-103~107） |
| `plans/canvas-studio-continuity-research.md` | 上游调研稿，结论已并入 consistency-solution |
| `plans/conversation-attachment-divert.md` | 被 [plans/attachment-divert-no-fork.md](../plans/attachment-divert-no-fork.md) 取代（头部有 supersede 标注）；§2 发送链路设计仍被引用 |
| `plans/skill-system-upgrade.md` | 被 [skill-system-optimization.md](../skill-system-optimization.md) 接替（CV-097/098 已验收） |
| `plans/resolution-tier.md` | 决策留痕（CV-187 落地）；施工口径归 dev 稿；头部有 736p 勘误 |
| `plans/resolution-tier-dev.md` | CV-187/188 已落地；头部有 736p 勘误 |
| `plans/REQ-005-开发执行提示词.md` | 一次性粘贴用执行文档，v1.1 规格已被 v1.4 取代，内嵌旧机器路径 |
| `plans/分镜修改纪律与防堆卡方案.md` | CV-251 已完成·桌面验收通过（2026-09-27） |
| `plans/生成历史面板方案.md` | CV-246(+246a) 已完成·桌面验收通过（2026-09-27） |
| `plans/参考句柄断链根治方案.md` | CV-242 已完成·桌面验收通过（2026-09-27） |
| `plans/资产废料回收方案.md` | CV-243 已完成·桌面验收通过（2026-09-27） |
| `plans/废弃素材开关布局回收方案.md` | CV-244 已完成·桌面验收通过（2026-09-27） |

## 二、专题与设计（顶层，19 份）

| 文档 | 归档原因 |
| --- | --- |
| `canvas-studio-phase2.md` | P7 门控 / P8 素材入口 / P9 合成全部落地 |
| `canvas-studio-reference-integration.md` | S1~S7 于 2026-08-20 全部落地（`9a314b6e88`） |
| `av-sync-test-readiness.md` | 就绪度评估已兑现为 av-sync-implementation-plan 并桌面验收通过 |
| `music-first-workflow-plan.md` | 已降级存档（2026-09-10 拍板，等后端支持再启） |
| `h3-context-ir-integration-plan.md` | CV-119 已落地（`h3-ir-validate.ts` + 预检接入） |
| `long-video-music-research.md` | 调研已兑现完毕，下游 music-first 已降级 |
| `brand-identity-proposal.md` / `brand-identity-audit.md` | 已定案落地（`f56f80673a` / `f16d33d351`） |
| `resolution-tier-guide.md` | 头部自标「已被取代」，施工口径见 resolution-tier-dev（已随档）；保留三档取值表 |
| `harness-fork-maintenance.md` | 主体已退役：附件旁路改无 fork runtime wrapper |
| `optimization-plan.md` | 2026-09-03 已自标归档（代码零落地，不排期） |
| `canvas-studio-e2e-testing.md` | Playwright 方案从未立项，30 天无人跟进；演进方向见 regression-matrix |
| `handoff-2026-09-04.md` / `HANDOFF-2026-09-07.md` / `handoff-node-state.md` / `handoff-product-consultant.md` | 带日期交接快照，悬项全部被后续批次接手（部分描述已与现状相反，仅作历史） |
| `skill-system-analysis.md` | 被 skill-system-optimization §0 定性为「输入源」并逐条吸收 |
| `t8-skill-repo-analysis.md` | 三阶段集成建议全部落地；引用的 submodule 路径已不存在 |
| `image-skill-research.md` | §六拍板结论已全部沉淀（CV-095 等） |

## 三、根目录归档（`docs/archive/`，仓库根）

| 文档 | 归档原因 |
| --- | --- |
| `HANDOFF-ERROR-SYSTEM.md` | 错误系统交接快照，两个「遗留设计点」均已处置（E1 已拍板、手册已恢复） |
| `plan-web-search-tinyfish.md` | 纯调研稿；`dsh-web-search-tinyfish/` 包已实现并进构建链 |
| `image-resource-analysis.md` | 2026-09-04 一次性盘点（107 张图清单） |
