---
name: direct-street-interview-video
description: 自然街拍/边走边聊视频提示词机制：第一人称手持跟随、可复用的参考人物、短对白、移动日光与街道视差，4-15 秒纪录片能量。用于街采、偶遇互动、vlog 式跟拍类镜头的 H3 提示词编译。
---

# 街拍互动 · Canvas Studio 适配版

本 skill 只做两件事：① 声明与 Canvas Studio 工具链的映射；② **覆盖原文中在本项目失效的部分**。
完整的机制大脑（intake 清单、build the scene 七步、feasibility gate、anti-copy 审计）在
`references/upstream-skill.md`（原文未改动）；风格、适用与限制见 `references/summary.md`，
不变量与消融见 `references/template.md`。

**首次使用必须先读 `references/summary.md`，编译前必须读 `references/h3-template.md`。**

---

## 1. 原文中失效的部分（以本节为准，覆盖原文）

| 原文 | 本项目 | 处理 |
| --- | --- | --- |
| 「Compile for Seedance 2.0」整节：`{...}`、`<...>`、`（...）`、`【...】`、`镜头N`、`角色A@图片1` | video gen 只走 MiniMax H3（fl2va / ref2va） | **一律不输出 Seedance 语法**，只走 H3 编译层 |
| Deliver 第 5 项「the Seedance 2.0 prompt」 | 同上 | 删除；交付物只含 H3 IR |
| 「Select T2VA / I2VA / ... from the actual generation-time inputs」 | 模式判定需守硬约束 | 按 `h3-prompt-writing` 的 M 系列：素材**角色**决定模式；I2VA/FL2VA/L2VA 与 Ref2VA 互斥；一张图当首帧是 I2VA 三段式，不是 Ref2VA 六段式 |
| 「Validation」自验清单 | 项目有格式校验器 | 保留原文清单，**并追加**跑 `node scripts/validate-h3-ir.mjs brief.txt --mode <MODE> --duration <S>`，ERROR 必须修复 |

## 2. H3 编译执行层

1. **Intake**：按原文 intake 清单收集（目标时长 4-15s、画幅 16:9/9:16、互动目标、地点、
   人物角色、关系、结尾状态、逐字对白与说话顺序、生成期素材及其窄角色）。
2. **套骨架**：`references/h3-template.md` 提供 Ref2VA 与 T2VA 两个 skeleton；
   对齐行句式、时间戳规则、运镜词表、`<d>` 台词规则全部按 `h3-prompt-writing` 技能执行。
3. **可行性闸门**（照原文）：10s 片 prefer 2-3 个短对白轮次 + 一条连续事件链；
   不得在片尾起点新 setup；不得宣称 4K/HDR/胶片。
4. **校验**：跑校验器，ERROR 清零后交付。
5. **流程衔接**：prompt draft 属于 HITL 确认点 —— 编译结果先给用户过目，
   确认后才进入生成（`canvas-studio-creation` 总纲的分镜/关键帧审批节奏）。

## 3. 机制衔接

- 纪录片能量不足时，可叠用 h3-prompt-writing 技能的创意机制汇编（creative-mechanisms）
  中的 `observer-imperfection-route-discovery-closure`（观察者存在感）与
  `selfie-route-local-find-taste-resume`（自拍路线+本地发现）。

## 4. 交付

1. 一句话概念；2. 任务与素材角色映射；3. 可行性注记；4. **H3 IR**（经校验器）；5. 连续性与 anti-copy 审计。
