---
name: h3-prompt-writing
description: Write MiniMax H3 video generation prompts as H3-Context-IR structured briefs for T2VA, I2VA, FL2VA, L2VA, and Ref2VA. Use when rewriting multimodal requests into H3 prompt structures, composing integrated_multimodal_description, overall_soundscape, and non_diegetic_music, aligning keyframes, or defining reference labels for images, videos, and audio.
compatibility: Portable to any agent that can read local files — no external API calls, MiniMax Hub tools, or proprietary runtime required.
---

# H3 Prompt Writing（H3-Context-IR 增强版）

把原始意图编译成 H3-Base 训练时见过的结构化长文本。直接把大白话喂给 H3-Base
是分布外输入，效果明显变差。本 skill 在上游三段式/六段式规则之上，融合
H3-Context-IR 完整编写规范（模式判定、对齐行、分镜时间戳、运镜词表、中文输入专项）。

**输出是裸结构化文本**：没有 markdown 围栏，没有前言，没有解释。第一个字符
就是对齐行或第一个段名。

## Workflow

1. **判定模式**（只看素材的角色，不看"有没有素材"）：

   | 输入构成 | 模式 | 输出 |
   |---|---|---|
   | 只有文本 | T2VA | 三段式，无对齐行 |
   | 文本 + 1 张图作**首帧** | I2VA | 对齐行 + 三段式 |
   | 文本 + 1 张图作**尾帧** | L2VA | 对齐行 + 三段式 |
   | 文本 + 2 张图作**首尾帧** | FL2VA | 对齐行 + 三段式 |
   | 文本 + 任何**通用参考**素材 | Ref2VA | 六段式，无对齐行 |

   ⚠️ 最常见的错误是把"带了一张图"一律当成 Ref2VA 写成六段式。
   一张图当首帧是 I2VA（三段式 + 对齐行）。

   **硬约束**：FL2VA/I2VA/L2VA 与 Ref2VA 互斥（锁首帧与参考风格只能两步走）；
   音频不能单独作参考；必须有一段非空文本意图。

2. **按模式套模板**：
   - 三段式（段名与正文同行）：`integrated_multimodal_description` →
     `overall_soundscape` → `non_diegetic_music`
   - 六段式（段名单独成行、段间空行、顺序不可变）：`subject_definitions` →
     `summary` → `retention_analysis` → `detailed_description` →
     `overall_soundscape` → `non_diegetic_music`
   - 完整规格见 `references/format-base.md`（三段式 + 三种对齐行句式）与
     `references/format-ref2va.md`（六段式）

3. **写主描述**：沿时间线展开。`[Shot 1]` 不带时间戳；后续
   `[Shot N] At MM:SS.mmm, the camera cuts to ...`（毫秒三位、严格递增、全部小于时长；
   切镜动词只用 5 个合法值，见 `references/context-ir-workflow.md`）。
   运镜词只能用 20 词封闭词表（`references/camera-vocabulary.md`），写到就要带指向对象。
   每个镜头只承担一个主要状态变化；台词用 `(S1)` + `<d>[Language] 原话</d>` 逐字保留。
   中文输入专项（发声事件落成台词、引号剥离）见 `references/chinese-input.md`。

4. **写两段声音**：`overall_soundscape` 1–4 句环境音（不含台词）；
   `non_diegetic_music` 1–3 句只写乐器/速度/节奏/力度，不写抽象情绪词。
   角色能听到的音乐是 diegetic，写进主描述。

5. **验证格式**：交稿前跑校验器
   ```bash
   node scripts/validate-h3-ir.mjs brief.txt --mode T2VA --duration 10
   node scripts/validate-h3-ir.mjs --self-test   # 4 组官方 IR 输出应 100% PASS
   ```
   ERROR 必须修复，WARN 是经验区间提示不阻塞。

## Output Rules

- Write rewrite sections in English; preserve dialogue, lyrics, and visible scene
  text in their original language.
- Keep reference labels consistent (`<Picture 1>`, `<Video 1>`, `<Audio 1>`) across
  every section; material numbering is 1-based and per-category.
- Match the total duration of the description to the requested video length (4–15s).
- H3-Base 没有 negative prompt 字段："不要有人"写成 `The doorway remains empty.`。

## 参考文件（按需读，不要一次全读）

- `references/format-base.md` — 三段式完整规格 + 三种对齐行句式（I2VA/FL2VA/L2VA）
- `references/format-ref2va.md` — 六段式完整规格、引用标签、任务类型、retention 档位
- `references/camera-vocabulary.md` — 20 个运镜词 + 幅度速度写法
- `references/examples.md` — **四组官方 IR 完整输入输出对照**（拿不准就照着写）
- `references/chinese-input.md` — 中文（及其他非英文）输入专项
- `references/creative-mechanisms.md` — **创意机制精选库**（悬疑/情绪/双人/结构 30 个可复用机制，先选机制再套 Context-IR）
- `references/context-ir-workflow.md` — H3-Context-IR 完整编写规范（五步细节 + 自检清单）
- `references/base-en.txt` / `references/ref-en.txt` — 上游原始三段式/六段式示例

## 自检清单（出稿前逐条过）

- [ ] 第一个字符是对齐行或段名，无围栏、无前言
- [ ] 段名齐全、顺序正确；三段式同行，六段式换行且段间空行
- [ ] `[Shot 1]` 无时间戳；后续时间戳 `MM:SS.mmm` 严格递增且全部 < 时长
- [ ] 运镜词全部在表内且带指向对象；切镜动词只用 5 个合法值
- [ ] `<d>` 标签闭合、台词逐字未改；所有"有人出声"暗示都落成了 `<d>`
- [ ] `overall_soundscape` 1–4 句不含台词；`non_diegetic_music` 1–3 句无情绪词
- [ ] Ref2VA：六段齐全、summary 前缀合法、retention 档位取值合法且无 `(Sx)`
