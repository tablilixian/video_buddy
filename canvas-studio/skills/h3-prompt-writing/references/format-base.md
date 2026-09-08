# 三段式完整规格（T2VA / I2VA / L2VA / FL2VA）

## 结构

段名与正文**同一行**。段间用换行分隔（单换行或空行都可以，官方两种都出过）。

```
integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: ...
```

I2VA / L2VA / FL2VA 在最前面加一行对齐行，**后跟一个空行**再进 `integrated_multimodal_description`。
T2VA 没有对齐行。

---

## 对齐行三种句式 —— 逐字照抄

### I2VA（1 张图作首帧）

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

### FL2VA（2 张图作首尾帧）

```
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

### L2VA（1 张图作尾帧）

```
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

**`N`** = 实际最后一个 shot 的序号。**`S.SS`** = 有效时长，恰好两位小数（8 秒写 `8.00`）。

> ⚠️ **FL2VA 那一行不带尖括号和方括号**，写的是 `Picture 1 (from Shot 1)`；
> I2VA 和 L2VA 带，写的是 `<Picture 1> (from [Shot 1])`。
> 官方指南两处原文如此，不是笔误，**不要统一它们**。
>
> 破折号是 em dash `—`，不是 `-` 也不是 `--`。

---

## 各模式的写法差异

### T2VA
没有参考图，直接从文本构建完整时间线。可以补充与用户意图一致的场景、角色、动作、声音细节。

### I2VA：从图出发向前发展
`<Picture 1>` 是 0.00 秒的实际首帧，属于 `[Shot 1]`。
先确立图中的风格、主体、构图、场景锚点，再描述接下来发生什么。
角色身份、服装、颜色、关键物件、空间关系必须保持一致。

**推荐结构**：首帧锚定 → 动作起始 → 连续发展 → 结果或反应

### FL2VA：写连接首尾帧的路径
Picture 1 是开头，Picture 2 是结尾。重点写主体怎么移动、姿态怎么变、
物件怎么被操作、构图怎么演变、场景或光线怎么过渡。

**不要写成两段静态图片描述**，要写运动路径。

FL2VA **默认单镜头**，让模型从首帧连续插值到尾帧。只有用户明确要求才用多镜头。
尾帧必须由最后的 `[Shot N]` 在视频结尾抵达。

**推荐结构**：首帧状态 → 可观察的中间变化 → 差异逐步收窄 → 尾帧状态

### L2VA：推断开头，落到尾帧
`<Picture 1>` 是视频的最后一帧，属于最后的 `[Shot N]`，**不天然属于 Shot 1**。
从用户意图和尾帧反推一个合理的先前状态，再描述角色、物件、镜头、场景如何逐步逼近参考图。

**推荐结构**：合理的先前状态 → 明确的动作与转变路径 → 末镜头逐步收敛 → 尾帧落地

---

## `integrated_multimodal_description`

主体部分。沿时间线展开，每个细节都要对应画面上看得见或听得见的东西：
视觉风格、初始构图、主体外观与位置、场景与关键道具、动作与反应、镜头切换、
说的话、同步的叙事内声音。

`[Shot 1]` 开头声明整体风格与初始构图：

```
[Shot 1] Live-action, cinematic, a medium-wide shot frames...
```

常见风格词：`Cinematic`、`live-action`、`2D-animated`、`3D CG`、`claymation`、
`watercolor`、`vintage film`。关键帧任务从参考图推导风格，T2VA 从用户文本里选。

### 分镜与切镜

`[Shot 1]` 不带时间戳。后续镜头用递增序号，每个以严格递增、小于时长的切镜时间开头：

```
[Shot 2] At 00:03.500, the camera cuts to...
```

切镜动词封闭集：
`the camera cuts to` / `the shot cuts to` / `the shot transitions to` /
`the shot changes to` / `the shot switches to`

`cross-dissolve` / `fade` / `wipe` 只在用户明确要求时用。

切镜必须引入关于主体、空间、状态、视角或时间的新信息。
只需要改变距离或轻微角度 → **用运镜，不要切镜头**。

### 说话人与台词

见 `../SKILL.md` 第 3 步，规则相同。核心：

```
The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
The two children (S1,S2) shout together, <d>[English] Wait for us!</d>
The man (S1) says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.
```

跨剪辑点用 `<scenetrans>`，被结尾截断用 `<cutoff>`。
延续措辞：`continues seamlessly across the cut` / `continues uninterrupted into the next shot` /
`carries over from the previous shot` / `remains audible across the transition`。

### 画面内文字

```
A red neon sign reading "营业中" glows above the doorway.
```

---

## `overall_soundscape`

1–4 句英文，一段连续文字。概括全片的环境音、动作物理音、非语言人声：
风、雨、车流、脚步、衣料摩擦、撞击、呼吸、笑声、喘息。

**台词、歌唱、叙事内音乐已经在主描述里了，这里不重复。**

只有用户明确要求全片完全静音才写 `N/A`。

```
overall_soundscape: Steady rain taps against the café windows while low room ambience continues underneath. The entrance bell rings once, followed by wet footsteps and the soft scrape of a chair.
```

---

## `non_diegetic_music`

1–3 句英文。只有观众听得到、角色听不到的背景音乐。
写**乐器、速度、节奏、力度变化**。**不用抽象情绪词**，不解释音乐的情绪功能。

角色能听到的歌唱、乐器、收音机、电视、手机音乐是 **diegetic 事件**，属于主描述。

没有非叙事音乐就写 `N/A`。

```
non_diegetic_music: Sparse piano notes at a slow tempo, joined by sustained low strings that gradually increase in volume before fading out.
```
