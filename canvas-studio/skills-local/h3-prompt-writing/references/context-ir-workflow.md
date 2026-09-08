---
name: h3-context-ir
description: Convert a raw creative intent (text, and optionally images / video / audio) into the structured MiniMax H3 production brief that H3-Base was trained on. Use whenever the user wants to generate a video with MiniMax H3 / Hailuo-03 and has given a plain-language idea rather than a structured brief, or asks to "expand", "enhance", or "structure" a prompt for H3.
---

# H3-Context-IR — 结构化提示词生成

把用户的原始意图转成 H3-Base 训练时见过的结构化长文本。
直接把大白话喂给 H3-Base 是分布外输入，效果明显变差。

**输出是裸结构化文本。** 没有 markdown 围栏，没有前言，没有"好的，这是……"，
没有解释，没有 JSON 包装。第一个字符就是对齐行或第一个段名。

---

## 第 1 步：判定模式（只看素材的角色，不看"有没有素材"）

| 输入构成 | 模式 | 输出 |
|---|---|---|
| 只有文本 | **T2VA** | 三段式，无对齐行 |
| 文本 + 1 张图作**首帧** | **I2VA** | 对齐行 + 三段式 |
| 文本 + 1 张图作**尾帧** | **L2VA** | 对齐行 + 三段式 |
| 文本 + 2 张图作**首尾帧** | **FL2VA** | 对齐行 + 三段式 |
| 文本 + 任何**通用参考**素材（图/视频/音频） | **Ref2VA** | 六段式，无对齐行 |

⚠️ **最常见的错误是把"带了一张图"一律当成 Ref2VA 写成六段式。**
一张图当首帧是 **I2VA，三段式 + 对齐行**。官方样本 A2 就是铁证。
只有当素材是"通用参考"（提供角色长相、风格、运镜、要编辑的源视频、音色）
而不是"具体的某一帧"时，才是 Ref2VA。

**硬约束**（违反就是废输出）：

- **FL2VA / I2VA / L2VA 与 Ref2VA 互斥。** 首尾帧角色与参考角色不能同时出现。
  用户既要锁首帧又要参考风格 → 只能两步走：先 Ref2VA 出带风格的视频，
  再拿它的首帧做 FL2VA。这时告诉用户这个限制，别硬凑。
- **音频不能单独作参考**，必须有图或视频伴随。
- 必须有一段非空文本意图。

素材上限（Ref2VA）：≤9 图、≤3 段视频（各 2–15 秒、总 ≤15 秒）、≤3 段音频，
混合总文件数 ≤12。

---

## 第 2 步：按模式套模板

### 三段式（T2VA / I2VA / L2VA / FL2VA）

段名与正文**同一行**：

```
integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: ...
```

I2VA / L2VA / FL2VA 在最前面加**对齐行**，后跟一个空行。三种句式见
`references/format-base.md`——**逐字照抄，尤其注意 FL2VA 那行不带尖括号**。

### 六段式（Ref2VA），顺序不可变

段名**单独成行**，正文从下一行开始，段间**必须空行**：

```
subject_definitions:
<Subject 1> ...

summary:
[任务类型] ...

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - ...

detailed_description:
The target video is in ... style.
[Shot 1] ...

overall_soundscape:
...

non_diegetic_music:
...
```

完整规格见 `references/format-ref2va.md`。

---

## 第 3 步：写主描述

沿时间线展开，每个细节都要对应画面上看得见或听得见的东西。

**分镜**
- `[Shot 1]` **不带时间戳**，开头声明整体风格与初始构图
  （六段式的风格句写在 `[Shot 1]` **之前**，这是两种模板的关键差异）。
- 后续：`[Shot N] At MM:SS.mmm, the camera cuts to ...`，毫秒三位，严格递增，全部小于时长。
- 切镜动词只用这五个：`the camera cuts to` / `the shot cuts to` /
  `the shot transitions to` / `the shot changes to` / `the shot switches to`。
- `cross-dissolve` / `fade` / `wipe` **只在用户明确要求时**用。
- 只是距离或轻微角度变化 → **用运镜，不要切镜头**。切镜必须引入新信息。

**镜头数由意图决定，不由时长决定。** 用户说"一镜到底"就真的只写 `[Shot 1]`；
官方 8 秒拉焦样本也是单镜头零切镜。

但反过来也要注意：**意图里有几个不同的叙事节拍，就给几个镜头，不要挤在一个镜头里。**
判断标准：**每个镜头只承担一个主要状态变化。**
用户写了三个连续发生的事件，就先按三个镜头考虑，再看时长够不够；
硬塞进一个镜头会让动作显得仓促。
如果你发现自己在一个镜头里写了"先……接着……然后……最后……"，那就该拆。

切镜点没有固定比例。按各节拍实际需要的时间分配，别套公式。

⚠️ **用户给的时间戳不等于切镜指令。** 「第 6 秒她停下回头」只说明这一拍**何时**发生，
没说要**怎么拍**。仍然按上面那条判断：这一拍有没有引入新的主体、空间、状态或视角？

- 只是景别或距离变化（跟拍 → 推近同一个人）→ **同一镜头内用运镜完成**，
  写成 `The camera ceases its backward motion and slowly pushes in on her face.`
- 换了人、换了地点、换了时间 → 才切镜，并把用户给的时间戳用作切镜点

官方对「第 6 秒停下回头」这类意图的实测处理是**单镜头 + 运镜转换**，不是切镜。

**运镜**：词表见 `references/camera-vocabulary.md`，只能用表内的词。

用不用运镜看内容需要——不必给每个镜头都配。但**一旦要写，就写具体**：
运动类型 + 幅度 + 速度 + **指向的具体对象**。

```
✅ The camera pushes in with small amplitude at slow speed toward her clenched hands.
❌ The camera moves in.            ← 太笼统
❌ The camera slowly pushes in.    ← 缺指向对象
```

镜头确实不动时，明确写 `The camera holds a static shot as ...`，
比完全不提镜头更清楚。

**说话人与台词**
- 稳定 ID `(S1)` `(S2)`，同时说话 `(S1,S2)`，不发声的角色不给 ID。
- 身份特征（类型/年龄/性别/是否在画内/音高/音色/语速/口音）写在 `<d>` **外**。
- `<d>[Language] 原话</d>`——逐字保留，不翻译不改写，标签必须闭合。
- 画外音固定用 `says in an off-screen voiceover`，之后紧接声明该角色嘴唇完全闭合。
- 台词跨剪辑点：两侧都写 `<scenetrans>`，并明说音频跨切延续。
- 台词被结尾截断：`<cutoff>`。
- 听不清的片段写 `[unclear]`，不猜。

**画面内文字**：英文双引号原样包裹，不翻译。
`A red neon sign reading "营业中" glows above the doorway.`

⚠️ **非英文意图：「有人在说话」常常不带引号。**
中文尤其如此——它会把一整段发声压缩成一个名词（卖花声、吆喝、叫卖声、读书声、
议论声）或一个不带引号的动词（聊天、交谈、说笑、招呼、争执）。
**这些是台词，不是环境音**，要落成真实的 `<d>[Chinese] …</d>` 并配说话人 ID；
用户没给具体词句时，由你写符合那个场景的地道短句。

```
意图：远处传来卖花声
❌ overall_soundscape 里写一句「远处有叫卖声」
✅ An off-screen elderly female street vendor (S1) calls out in the distance,
   <d>[Chinese] 卖花咯——</d>
```

判断口诀：意图里只要暗示有人出声，就问*这句话具体会怎么说出口*——
能想出来，就该进 `<d>`。详见 `references/chinese-input.md`。

**排除项**：H3-Base 没有 negative prompt 字段。
"不要有人"要写成 `The doorway remains empty.`，不能写 `no people`。

---

## 第 4 步：写两段声音

**`overall_soundscape`**：1–4 句，一段连续文字。
环境音、动作物理音、非语言人声（风雨车流脚步衣料摩擦撞击呼吸笑声喘息）。
**不重复台词、歌唱、叙事内音乐**——那些属于主描述。
只有用户明确要求全片完全静音才写 `N/A`。

**`non_diegetic_music`**：1–3 句。只写**乐器 / 速度 / 节奏 / 力度变化**。
**不写抽象情绪词**，不解释音乐的情绪功能。
写 "sparse piano at slow tempo, joined by sustained low strings that swell then fade"，
不写 "melancholic and hopeful"。
没有非叙事音乐就写 `N/A`（这个条件比全片静音宽松得多）。

⚠️ 角色能听到的音乐（收音机 / 电视 / 手机 / 现场演奏 / 有人唱歌）是 **diegetic**，
写进主描述，**不**写进 `non_diegetic_music`。

---

## 第 5 步：长度

**没有硬性词数。** 官方四组实测主描述是 226 / 242 / 251 / 533 词——
跨度很大，由内容密度决定，不是凑字数凑出来的。

经验区间（超出不算错，但值得回头看一眼）：

| 模式 | 主描述词数 |
|---|---|
| T2VA 5–10 秒 | 200–300 |
| I2VA / L2VA / FL2VA 5–10 秒 | 250–550 |
| Ref2VA 生成类 | 350–500 |
| Ref2VA 编辑类 | 随源视频复杂度，不设区间 |

台词密集时**以放下完整台词时间线为准**，不要为了凑词数注水。
单镜头不自动等于短描述。

---

## 参考文件

按需读，不要一次全读：

- `references/format-base.md` — 三段式完整规格 + 三种对齐行句式
- `references/format-ref2va.md` — 六段式完整规格、引用标签、任务类型、retention 档位
- `references/camera-vocabulary.md` — 20 个运镜词 + 幅度速度写法
- `references/examples.md` — **四组官方 IR 完整输入输出对照**（最有用，拿不准就照着写）
- `references/chinese-input.md` — **中文（及其他非英文）输入专项**：
  发声事件落成台词、引号剥离、文化意象落成画面、长度克制

---

## 自检清单

出稿前逐条过一遍：

- [ ] 第一个字符是对齐行或段名，没有围栏、没有前言
- [ ] 段名齐全、顺序正确；三段式同行，六段式换行且段间空行
- [ ] `[Shot 1]` 没有时间戳；后续时间戳格式 `MM:SS.mmm`、严格递增、全部 < 时长
- [ ] 每个镜头只承担一个主要状态变化；意图里的节拍没有被硬挤进一个镜头
- [ ] 运镜词全部在表内；写到的运镜都带了指向的具体对象，不是"镜头推近"这种笼统说法
- [ ] `<d>` 标签闭合，台词逐字未改，语言标签正确
- [ ] 意图里所有「有人出声」的暗示都落成了 `<d>`，没有被降级成环境音
      （中文的名词式发声事件最容易漏：卖花声/吆喝/聊天/议论）
- [ ] 正文里没有夹带非英文字符——中文只允许出现在 `<d>` 台词和画面文字的双引号内，
      不要给器物加括号注解（❌ `teahouse (老茶馆)`）
- [ ] 画外音后声明了嘴唇闭合
- [ ] `overall_soundscape` 1–4 句且不含台词；`non_diegetic_music` 1–3 句且无情绪词
- [ ] diegetic 音乐没被误放进 `non_diegetic_music`
- [ ] Ref2VA：六段齐全；`summary` 前缀合法且不引入新标签；
      `retention_analysis` 覆盖所有已定义标签、档位取值合法、**没有 `(Sx)`**；
      视觉用 `fully_preserved/partially_preserved/attribute_transfer/weak_reference`，
      音频用 `fully_copy/partially_copy/reference/weak_reference`
- [ ] 素材编号 1-based、各类别独立编号、与输入顺序一致，没有重命名跳号重排
