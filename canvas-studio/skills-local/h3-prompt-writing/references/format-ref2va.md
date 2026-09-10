# 六段式完整规格（Ref2VA）

六段，顺序不可变，段名单独成行，正文从下一行开始，段间必须空行：

| 段 | 作用 |
|---|---|
| `subject_definitions` | 定义被引用的内容及其引用标签 |
| `summary` | 概括任务类型、目标视频、主要引用关系 |
| `retention_analysis` | 说明被引用内容如何被保留、转移或复用 |
| `detailed_description` | 按播放顺序描述画面、动作、镜头、声音、台词 |
| `overall_soundscape` | 概括环境音与物理音 |
| `non_diegetic_music` | 只有观众听得到的背景音乐 |

**全部用英文写。** 只有 `<d>` 内的台词/歌词、以及画面里真实可见的文字保留原语言。

Ref2VA **没有对齐行**。

---

## 1. `subject_definitions`

四类标签：

| 标签 | 含义 |
|---|---|
| `<Subject N>` | 从参考素材中抽象出来、可在目标视频中复用或修改的**可见内容** |
| `<Picture N>` | 作为**具体目标帧**或分镜锚点的参考图 |
| `<Video N>` | 提供编辑源、续写起点或**整片时序结构**的参考视频 |
| `<Audio N>` | 被复制或引用的音频信号 |

**标签一旦分配，在全部六段中含义不变。** 每个需要后续单独追踪的引用内容各占一行。

### `<Subject N>`

用于可复用的可见内容：人/动物/物体、场景/背景/环境、服装/道具/界面/特效、
风格/动作/表情/姿态。

它代表**将被实际使用的内容单元**，不是源文件本身。
一个主体可以由多个素材定义，一个素材也可以提供多个主体。

```
<Subject 1> is the young woman in <Picture 1>, with long dark hair, a blue cardigan, and a thin silver necklace.
<Subject 1> is the woman whose appearance comes from <Picture 1> and whose walking motion comes from <Video 1>.
```

### `<Picture N>`

**只有**当参考图本身充当某镜头的首帧、关键帧、尾帧、被编辑的关键帧或构图锚点时，
才单独立条目：

```
<Picture 2> is the first frame of [Shot 1], showing a woman seated beside a café window.
<Picture 3> is a storyboard reference for [Shot 1] and [Shot 2], defining their viewpoint, subject placement, and shot order.
```

⚠️ **图片只用来定义角色、场景、服装或风格时，不要单独立 `<Picture N>` 条目**，
改为在对应的 `<Subject N>` 定义里注明出处。

### `<Video N>`

只用于整片级关系：编辑原视频、从原视频结尾续写、引用原视频的运镜/剪辑/节奏/时序结构。

```
<Video 1> is the source video for the target video edit.
```

参考视频里被复用的人、物、场景、动作、特效**仍归 `<Subject N>`**。
`<Video N>` 标识素材或结构来源，不替代主体标签。

### `<Audio N>`

独立音频素材，或参考视频里被启用的同步音轨。常见用途：
复制全部或部分音频信号、引用背景音乐风格、引用说话人音色与表达方式、
使用原音频里的台词/歌词/音效、引用节拍/节奏/音频连续性。

绑定到目标说话人时，**复用该说话人的全局 ID，不独立编号**：

```
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).
```

### 音频参考的官方硬规格

音频参考**只能走 Ref2VA**（音频不能与首尾帧模式同用）。传素材前逐条对齐下表——
不合规的请求会在生成前被本地拦下，不会打到后端：

| 项 | 官方规格 |
|---|---|
| 数量 | ≤ 3 段 |
| 单段时长 | 2–15s |
| **合计时长** | **≤ 15s** |
| 格式 | WAV / MP3 |
| 单段大小 | ≤ 15MB |
| 组合 | **不能是唯一输入**——必须同时提供至少一张图或一段视频 |

**参考视频自带的音轨也计入那 15s 音频预算**（用带声视频做参考时，音频额度会被它吃掉）。

工具参数是 `audioRefs`（**有序数组，顺序即 `<Audio N>` 的引用序**，不得重排）。
要做 voice / music 类参考时，先按 `<Audio N>` 把编号定好，再在
`subject_definitions` 与 `retention_analysis` 里逐条声明是 `reference` 还是 `fully_copy`
（见上文「音频档位」）——**编号顺序与数组顺序不一致会让模型参考错素材**。

---

### 视频与音频编号相互独立

`<Video N>` 和 `<Audio N>` **各自独立编号**，序号不编码配对关系。
同一个参考视频可以同时是 `<Video 1>` 和 `<Audio 2>`，序号不同不代表来源不同。

**普通参考视频不因为文件里有声音就自动产生 `<Audio N>`。**

需要消除来源歧义时才点明共享来源：

```
<Video 1> is the source video for the target video edit.
<Audio 2> is the synchronized audio track of <Video 1> and is reused in the target video.
```

---

## 2. `summary`

一段简短英文，以方括号任务类型前缀开头。

### 六个合法任务类型

| 任务类型 | 什么时候用 |
|---|---|
| `keyframe completion` | 图片充当目标视频的首帧、关键帧、尾帧、被编辑的关键帧或其他具体帧锚点 |
| `reference generation` | 图/视频/音频为角色、场景、风格、动作、运镜、分镜等提供生成指导，**但不充当具体帧、也不是被编辑或被续写的源视频** |
| `video editing` | 直接修改已有源视频。编辑图片或在静态关键帧之间生成**不属于**此类 |
| `video continuation` | 新内容从已有源视频延续、扩展、接续或转场而来 |
| `audio reuse` | 同一音频信号被全部或部分复用 |
| `audio reference` | 不直接复制音频信号，只引用其音乐风格、音色、台词或歌词内容、音效质感、节拍或连续性 |

多个类型用 ` + ` 连接，**不重复**：

```
[reference generation]
[video continuation + keyframe completion]
[video editing + audio reuse]
[video editing + audio reference + audio reuse]
```

### 判定要点

- **有视频或音频不自动产生对应任务类型。** 参考视频只提供运镜、剪辑或节奏
  → 归 `reference generation`。只有被直接编辑或续写才用 `video editing` / `video continuation`。
- 编辑源视频且原音频仍可听见 → 同时加 `audio reuse`。
- 续写源视频但不直接复制音频信号，新音频只延续原轨的可听特征 → 用 `audio reference`。

### 两条硬规则

- **不得在 `summary` 里引入新的引用标签**，只能用 `subject_definitions` 已定义的。
- **video editing 任务**在前缀后固定接：
  ```
  The target video is an edited version of <Video 1>.
  ```

---

## 3. `retention_analysis`

**每个引用标签一行**，保持 `subject_definitions` 里确立的含义。

### 视觉档位（`<Subject N>` / `<Picture N>` / `<Video N>`）

| 档位 | 含义 |
|---|---|
| `fully_preserved` | 被引用内容的既定角色被完整保留 |
| `partially_preserved` | 仍在使用，但部分既定特征被改变或只保留了一部分 |
| `attribute_transfer` | 被引用的特征被转移到了**另一个可识别的目标主体**上 |
| `weak_reference` | 只保留了风格、类别、构图或氛围上的宽泛相似 |

### 音频档位（`<Audio N>`）

| 档位 | 含义 |
|---|---|
| `fully_copy` | 完整源音频作为目标视频的完整最终音轨 |
| `partially_copy` | 只复制了部分时间线或部分音频层，或复制后又增删替换了其他声音 |
| `reference` | 不直接复制信号，只引用音色、节奏、音乐风格、台词内容或声音质感 |
| `weak_reference` | 只保留类别或氛围上的宽泛相似 |

⚠️ **两套档位不通用。** `attribute_transfer` 只属于视觉，`reference` / `fully_copy` /
`partially_copy` 只属于音频。

### 行格式

```
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - 理由。
<Picture 2> ([Shot 1] first frame): fully_preserved - 理由。
<Video 1> (cut and pacing structure): weak_reference - 理由。
<Audio 1>: fully_copy - <Audio 1> is reused 1:1 as the target video's complete final audio track.
<Audio 2>: reference - the target speaker follows <Audio 2>'s voice timbre and measured delivery without copying the original signal.
```

音频行通常省略括号里的定位说明。每条都要附一句理由。

### 三条硬规则

- 档位只能在该标签**已在 `subject_definitions` 定义的引用角色范围内**选取。
- 目标视频**新增**的动作、背景或剧情事件**不算保真度损失**。
- **`retention_analysis` 里不得出现 `(Sx)`。**

---

## 4. `detailed_description`

全参考模式的主体。按目标视频播放顺序逐镜头描述画面、动作、声音、台词，
并在引用标签适用处插入它们。

### 与三段式的四点差异

| 维度 | 三段式 | 六段式 |
|---|---|---|
| 主字段名 | `integrated_multimodal_description` | `detailed_description` |
| 风格开场 | 写在 `[Shot 1]` **之后** | 用一两句英文写在 `[Shot 1]` **之前** |
| 引用信息 | 不用引用标签 | 在首次出现与角色生效处插入 `<Subject N>` `<Picture N>` `<Video N>` `<Audio N>` |
| 音频关系 | 只描述目标视频自身的声音 | 在对应镜头或音频阶段引用 `<Audio N>`，并说明是复制还是引用 |

风格句写法：

```
The target video is in a cinematic, literary music-video style with soft lighting and a slightly desaturated color palette.
[Shot 1] The scene opens in a crowded urban street...
[Shot 2] At 00:09.000, the shot cuts to an extreme close-up...
```

分镜、运镜、说话人、台词、画面内文字的基础格式与三段式相同，见 `format-base.md`。

### 引用标签在镜头里的用法

重要 `<Subject N>` 首次清晰出现时，在**该镜头实际可见的范围内**描述它被引用的特征、
画面位置、当前动作。后续镜头继续用同一标签，**不再重复定义它代表什么**。

具体帧锚点用自然措辞：

```
the shot begins from <Picture 1>
the shot's keyframe corresponds to <Picture 2>
the shot ends on <Picture 3>
```

被引用主体真的开口说话时，**视觉标签与说话人 ID 并存**：

```
<Subject 2> (S1) turns toward the woman and says, <d>[English] Last summer, I went to my grandfather's house.</d>
```

`<Subject N>` 标识被引用的主体，`(Sx)` 标识实际发声者。同一主体画外发声时保持同样写法并标 `off-screen`。
发声者不对应任何已定义主体时，用一段稳定的嗓音描述加 `(Sx)`。

### 台词的特殊情形

- 人声**只是被直接复用的 BGM 或整轨里的一个片段**，没有具体的人、角色、旁白或独立发声源
  在物理上发出它 → 用 `<Audio N>` 作可听来源，**不另造 `(Sx)`**：
  ```
  When <Audio 1> reaches the phrase <d>[English] I'm lonely lonely lonely</d>, <Subject 1> performs the corresponding hand gesture without becoming a separate speaker source.
  ```
- 直接复用参考音频里的台词/旁白/歌词，或用户明确要求重演时 → `<d>` 内保留原词与原语言。
  听不清的片段写 `[unclear]`，**不猜不改写**。
- 只引用音色、节奏、情绪或表达方式时 → **不要**把参考音频的原台词搬进目标视频。

### 不能退化

`detailed_description` 要尽可能详细具体：每个镜头都要交代当前构图、主体外观与位置、
环境与光线、动作与状态变化、运镜、当前声音，以及被引用内容实际生效的位置。

**不要退化成剧情梗概或引用关系清单。**

---

## 5. `overall_soundscape` 与 `non_diegetic_music`

定义与三段式相同，见 `format-base.md`。Ref2VA 多一条：

用到参考音频时，**只在与可听层匹配的那一段里**说明复制或引用关系——
环境音与音效归 `overall_soundscape`，只有观众听得到的配乐归 `non_diegetic_music`。
同一音频同时提供两类内容时，在两段里各自说明：

```
overall_soundscape:
The copied ambience layer from <Audio 1> continues throughout the target video.

non_diegetic_music:
<Audio 2> is directly reused as the complete audience-only score.
```

完整台词和歌词只写在 `detailed_description` 的 `<d>` 里，这两段不重复。
