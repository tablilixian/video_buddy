---
name: cinematic-moves
description: 电影级运镜技能：50套场景化运镜prompt + 万能公式组合 + 反向prompt。用于分镜规划时选择运镜方案，或为现有分镜补充电影感镜头运动。
compatibility: Portable to any agent that can read local files — no external API calls required.
---

# Cinematic Moves（电影级运镜技能）

把"图片切换感"变成"电影叙事感"的关键在于运镜。本 skill 提供 50 套场景化运镜 prompt、万能公式组合、反向 prompt，用于分镜规划或为现有分镜补充电影感镜头运动。

**与 h3-prompt-writing 的关系**：本 skill 专注于运镜方案选择与组合，h3-prompt-writing 负责将选定的运镜写成 H3-Context-IR 格式。两者协同：先用本 skill 选运镜，再用 h3-prompt-writing 写 IR。

## Workflow

1. **确定场景类型**：根据剧情选择最接近的运镜类别（人物出场/移动跟拍/对话视角/大片开场/转场慢镜/打斗节奏/打斗高潮/心理放大/细节叙事/奇幻特效/史诗收束）

2. **应用万能公式**：任何运镜 prompt 必须包含 6 要素
   - 镜头运动 + 摄影机角度 + 人物动作 + 环境变化 + 光影氛围 + 画面质感

3. **遵守四大原则**：
   - ① 人物情绪越强，镜头越近（愤怒/流泪/震惊 → 特写 + 推镜）
   - ② 场面越大，镜头越拉远（战场/宫殿/云海/城市 → 全景 + 升降 + 俯冲）
   - ③ 动作越快，镜头越要有方向（冲刺/挥剑/闪避 → 镜头跟着人物动作走）
   - ④ 转场不乱用（同场景直接切；换场景用穿越/甩镜/叠化）

4. **选择运镜方案**：从 `references/cinematic-vocabulary.md` 中选择 1-2 个运镜组合

5. **可选：公式化组合**：如需自定义，使用 `references/formula-composition.md` 填空组合

6. **可选：添加反向 prompt**：如需对比，参考 `references/cinematic-vocabulary.md` 中的反向描述

## Output Rules

- 运镜描述用自然语言，写进分镜表的「镜头运动」列
- 每个镜头只承担一个主要运镜（不要堆叠多个运镜）
- 画风、光影、质感锁死不动，只轮换镜头运动、角度、节奏、环境这四样（视觉同源不撞款）
- 通用质感词：电影级质感，细节丰富，自然运动，浅景深，cinematic lighting，4K，稳定流畅

## 参考文件（按需读，不要一次全读）

- `references/cinematic-vocabulary.md` — 50套场景化运镜prompt（中文+英文+反向）
- `references/formula-composition.md` — 万能公式填空组合（运动词库 × 角度词库 × 环境词库）
- `references/quality-keywords.md` — 通用画质与质感关键词

## 与现有运镜词表的关系

本 skill 的 50 套运镜是**场景化组合**，而 `h3-prompt-writing/references/camera-vocabulary.md` 的 20 个词是**基础原子词**。两者关系：
- 分镜规划时：用本 skill 的场景化组合快速选方案
- 写 H3 IR 时：用 camera-vocabulary.md 的 20 个原子词（H3 模型训练时见过的词）
- 转换：本 skill 的运镜描述可拆解为 camera-vocabulary.md 的原子词组合

## 示例

**输入**：打斗高潮 / 强

**输出**：
- 运镜方案：摄影机 360 度环绕双方战斗，动作连续衔接
- 英文转换：Arc Shot (360° orbit around both fighters, continuous action)
- 分镜表「镜头运动」列：360度环绕战斗
