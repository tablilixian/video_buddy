---
name: stage-startle-to-truce-encounter
description: 短遭遇战机制：平静观察→不可能的贴近现身→可读的惊吓反应→克制的求和手势，4-15 秒非致命张力收尾。用于奇幻对技术反差、舷窗/舱内视线几何、追近压迫、以表演而非伤害化解的紧张场景的 H3 提示词编译。
---

# 惊变求和遭遇 · Canvas Studio 适配版

本 skill 只做两件事：① 声明与 Canvas Studio 工具链的映射；② **覆盖原文中在本项目失效的部分**。
完整的机制大脑（intake 清单、build the encounter 七步、feasibility gate、anti-copy 审计）在
`references/upstream-skill.md`（原文未改动）；风格与来源限制见 `references/summary.md`，
不变量与消融见 `references/template.md`；`references/h3-example.txt` 是 H3 语法示范（仅语法，不是强制题材）。

**首次使用必须先读 `references/summary.md`，编译前必须读 `references/h3-template.md`。**

---

## 1. 原文中失效的部分（以本节为准，覆盖原文）

| 原文 | 本项目 | 处理 |
| --- | --- | --- |
| 「Compile for Seedance 2.0」整节：`{...}`、`<...>`、`（...）`、`【...】`、`镜头N`、`角色A@图片1` | video gen 只走 MiniMax H3（fl2va / ref2va） | **一律不输出 Seedance 语法**，只走 H3 编译层 |
| Deliver 中的「the Seedance 2.0 prompt」 | 同上 | 删除；交付物只含 H3 IR |
| 「Choose Base or Ref2VA from the actual generation-time assets」 | 模式判定需守硬约束 | 按 `h3-prompt-writing` 的 M 系列：素材**角色**决定模式；I2VA/FL2VA/L2VA 与 Ref2VA 互斥 |
| 「Validation」自验清单 | 项目有格式校验器 | 保留原文清单，**并追加**跑 `node scripts/validate-h3-ir.mjs brief.txt --mode <MODE> --duration <S>`，ERROR 必须修复 |

## 2. H3 编译执行层

1. **Intake**：平静主体、技术观察者、分隔边界、遭遇空间、最终关系状态；一次有界的惊吓/
   防御动作（须可见地非致命）；生成期素材及其窄角色；身份锚点、载具/舱体连续性、视线几何、
   主摄影机职责、声音与画面文字政策。
2. **七步节奏**（照原文 build the encounter）：平静基线 → 经观察者 POV 揭示 → 单次有界升级
   → 空间反转（被观察者拉近不可能的距离）→ 共享轴线/同框证明贴近 → 惊吓外化（肩/握/头转/
   呼吸/视线）→ 以小的求和示意与可读的停留回应收尾。
3. **可行性闸门**（照原文）：12-15s 用 4-5 个因果节拍；决定性贴近必须落在最后四分之一之前；
   一个节拍只给一个主摄影机职责；威胁非致命。
4. **校验**：跑校验器，ERROR 清零后交付。
5. **流程衔接**：prompt draft 属于 HITL 确认点 —— 编译结果先给用户过目，确认后才进入生成
   （`canvas-studio-creation` 总纲的分镜/关键帧审批节奏）。

## 3. 机制衔接

- 需要更强的悬疑递进时可叠用 h3-prompt-writing 技能的创意机制汇编（creative-mechanisms）
  中的 `offscreen-cue-progressive-tightening-unrevealed-source`（画外线索逼近）与
  `continuous-emotion-escalation-conceal-residue`（情绪峰值+残余）。

## 4. 交付

1. 一句话概念；2. 任务与素材角色映射；3. 可行性注记；4. **H3 IR**（经校验器）；5. 连续性与 anti-copy 审计。
