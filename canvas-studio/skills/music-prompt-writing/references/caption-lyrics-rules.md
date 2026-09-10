# Caption 与 Lyrics 编写规则（ACE-Step 1.5）

> 与 `tag-dictionary.md` 配套：那边是「有哪些词可挑」，这边是「怎么组织、有哪些红线」。

---

## 1. 输入控制总表（我们能用哪几个）

| 类别 | 参数 | 作用 | 我们的工具 |
|---|---|---|---|
| 文本输入 | `caption_prompt` | 风格、情绪、乐器、音色等整体描述 | `prompt` |
| 文本输入 | `lyrics_prompt` | 时序要素：歌词、结构演进、演唱方式、起止方式；纯音乐填 `[Instrumental]` | `lyrics` |
| 音乐元数据 | `bpm` | 速度（30–300） | `bpm` |
| 音乐元数据 | `keyscale` | 调性（C Major、Am…） | `keyscale` |
| 音乐元数据 | `timesignature` | 拍号（4/4、3/4、6/8） | `timesignature` |
| 音乐元数据 | `vocal_language` | 人声语言 | `language` |
| 音乐元数据 | `duration` | 目标时长（秒） | `duration` |
| 音频参考 | `reference_audio` | 全局声学特征参考 | ❌ 后端未暴露 |
| 音频参考 | `src_audio` | 源音频（cover / repaint 任务用） | ❌ 后端未暴露 |
| 音频参考 | `audio_codes` | cover 模式的语义 codes（复用 / 拼接 / 衍生） | ❌ 后端未暴露 |
| 区间控制 | `repainting_start/end` | repaint / lego 的时间区间 | ❌ 后端未暴露 |

**用音频控制音频的四种方式**（Reference / Source-Cover / Repaint / Lego·Complete）
官方都支持，但我们后端只开了 text2music 一条路 —— 需要变奏、续写、音色统一时，
只有「改 Caption 重跑」这一招。

---

## 2. Caption 的九个写作维度

| 维度 | 示例 |
|---|---|
| 风格 / 流派 | pop, rock, jazz, electronic, hip-hop, R&B, folk, classical, lo-fi, synthwave |
| 情绪 / 氛围 | melancholic, uplifting, energetic, dreamy, dark, nostalgic, euphoric, intimate |
| 乐器 | acoustic guitar, piano, synth pads, 808 drums, strings, brass, electric bass |
| 音色质感 | warm, bright, crisp, muddy, airy, punchy, lush, raw, polished |
| 时代参考 | 80s synth-pop, 90s grunge, 2010s EDM, vintage soul, modern trap |
| 制作风格 | lo-fi, high-fidelity, live recording, studio-polished, bedroom pop |
| 人声特点 | female vocal, male vocal, breathy, powerful, falsetto, raspy, choir |
| 速度 / 节奏 | slow tempo, mid-tempo, fast-paced, groovy, driving, laid-back |
| 结构提示 | building intro, catchy chorus, dramatic bridge, fade-out ending |

形式不敏感：简单风格词、逗号分隔 tags、复杂自然语言描述都行，训练时已兼容。

### 七条实用原则

1. **具体优于模糊** —— `sad piano ballad with female breathy vocal` 远好于 `a sad song`
2. **组合多维度** —— 单一维度给模型太多发挥空间
3. **善用参考** —— `in the style of 80s synthwave`、`reminiscent of Bon Iver`
4. **质感词很有用** —— warm / crisp / airy / punchy 直接影响混音与音色
5. **不必追求完美** —— Caption 是起点不是终点，先写方向再迭代
6. **描述粒度决定自由度** —— 写少惊喜多，写细更可控
7. **避免冲突词汇** —— 互斥组合容易劣化

### 冲突怎么解

```
// 方法一：重复强化更想要的那个
cinematic strings, cinematic strings, heavy metal, cinematic strings

// 方法二：转译成时间轴上的"演变"
开头是柔和的弦乐，中段变成噪杂动态的金属摇滚，结尾转为 hip-hop
```

**推荐做法**：Caption 专注风格 / 情绪 / 乐器 / 音色；速度、调性、拍号交给
`bpm` / `keyscale` / `timesignature` 参数。

---

## 3. Lyrics 编写规则（时间脚本）

Caption = 整体画像（风格 / 氛围 / 音色），Lyrics = 分镜脚本（随时间展开）。
**两者必须讲同一个故事。**

### 3.1 结构标记 Meta Tags

| 类别 | 标记 | 说明 |
|---|---|---|
| 基础结构 | `[Intro]` | 开场，建立氛围 |
| 基础结构 | `[Verse]` / `[Verse 1]` | 主歌，叙事推进 |
| 基础结构 | `[Pre-Chorus]` | 导歌，积蓄能量 |
| 基础结构 | `[Chorus]` | 副歌，情感高潮 |
| 基础结构 | `[Bridge]` | 桥段，转折或升华 |
| 基础结构 | `[Outro]` | 结尾，收束 |
| 动态段落 | `[Build]` | 能量逐渐攀升 |
| 动态段落 | `[Drop]` | 电子乐的能量释放 |
| 动态段落 | `[Breakdown]` | 配器减少，留白 |
| 器乐段落 | `[Instrumental]` | 纯器乐，无人声 |
| 器乐段落 | `[Guitar Solo]` | 吉他独奏 |
| 器乐段落 | `[Piano Interlude]` | 钢琴间奏 |
| 特殊标记 | `[Fade Out]` | 渐弱结束 |
| 特殊标记 | `[Silence]` | 静默 |

用 `-` 组合：**`[Chorus - anthemic]` 优于 `[Chorus]`**。
❌ 不要堆叠 `[Chorus - anthemic - stacked harmonies - high energy - powerful - epic]`：
模型可能把标记当歌词唱出来，指令过多也会让它困惑。结构标记保持简洁，
复杂风格描述放 Caption。

### 3.2 人声控制标记

| 标记 | 效果 |
|---|---|
| `[raspy vocal]` | 沙哑、有质感的人声 |
| `[whispered]` | 轻声细语 |
| `[falsetto]` | 假声 |
| `[powerful belting]` | 高亢有力的演唱 |
| `[spoken word]` | 说唱 / 朗诵 |
| `[harmonies]` | 和声层叠 |
| `[call and response]` | 一呼一应 |
| `[ad-lib]` | 即兴装饰音 |

### 3.3 能量与情绪标记

| 标记 | 效果 |
|---|---|
| `[high energy]` | 高能量、激昂 |
| `[low energy]` | 低能量、内敛 |
| `[building energy]` | 能量递增 |
| `[explosive]` | 爆发性能量 |
| `[melancholic]` | 忧郁 |
| `[euphoric]` | 欣快 |
| `[dreamy]` | 梦幻 |
| `[aggressive]` | 激进 |

### 3.4 歌词文本写作技巧

1. **控制音节数**：每行 6–10 个音节最佳。模型把音节对齐到节拍，一行 6 音节、
   下一行 14 音节会让节奏变怪；同位置的行保持 ±1–2 音节。
2. **用大小写控制力度**：大写 = 更强演唱力度，如 `WE ARE THE CHAMPIONS!`
3. **括号表示背景人声**：`We rise together (together)` —— 括号内被处理为和声层
4. **延长元音**：`Feeeling so aliiive`，效果不稳定，慎用
5. **段落之间用空行分隔**，模型才分得清边界

```
✗ 我站在窗前看着外面的世界一切都在改变（18 音节）
  你好（2 音节）
✓ 我站在窗前（5）
  看着外面世界（6）
  一切都在改变（6）
```

### 3.5 避免「AI 味」：五个红旗

| 红旗 | 说明 |
|---|---|
| 形容词堆砌 | 「neon skies, electric hearts, endless dreams」—— 一段里塞满模糊意象 |
| 押韵混乱 | 押韵模式不一致，或刻意凑韵导致语义断裂 |
| 段落边界模糊 | 歌词内容跨越结构标记，Verse 的内容「流」进了 Chorus |
| 没有呼吸感 | 每行太长，无法一口气唱完 |
| 隐喻混用 | 第一段水、第二段火、第三段飞翔 —— 听众无法锚定 |

**隐喻纪律**：一首歌坚持一个核心隐喻，深挖它的多个切面。选了「水」，就写它如何绕过
障碍、可以是细雨也可以是洪流、能倒映对方、握不住却真实存在。

---

## 4. 纯器乐写法（BGM 默认路径）

```
[Instrumental]   // 最简单：整段纯器乐
```

或用结构标记描述器乐展开：

```
[Intro - ambient]
[Main Theme - piano]
[Climax - powerful]
[Outro - fade out]
```

配 `language="unknown"`（纯器乐无人声）。我们工具的 `lyrics` 留空时会自动填
`[Instrumental]`，所以**纯器乐 BGM 直接不传 lyrics 即可**。

---

## 5. 完整示例（Caption 与 Lyrics 一致）

```
Caption: female vocal, piano ballad, emotional, intimate atmosphere, strings, building to powerful chorus

[Intro - piano]

[Verse 1]
月光洒在窗台上
我听见你的呼吸
城市在远处沉睡
只有我们还醒着

[Pre-Chorus]
这一刻如此安静
却藏着汹涌的心

[Chorus - powerful]
让我们燃烧吧
像夜空中的烟火
短暂却绚烂
这就是我们的时刻

[Verse 2]
时间在指尖流过
我们抓不住什么
但至少此刻拥有
彼此眼中的火焰

[Bridge - whispered]
如果明天一切消散
至少我们曾经闪耀

[Final Chorus]
让我们燃烧吧
像夜空中的烟火
短暂却绚烂
THIS IS OUR MOMENT!

[Outro - fade out]
```

**一致性检查清单**：① Caption 的乐器 ↔ Lyrics 的器乐段落标记
② Caption 的情绪 ↔ Lyrics 的能量标记 ③ Caption 的人声描述 ↔ Lyrics 的人声控制标记。

---

## 6. 元数据：控制的边界

> 官方原话：**模型是「参考」而非「执行」**。设 `bpm=120`，结果是 118 或 122 这样的
> 分布采样 —— 像告诉乐手「大概 120」，他会自然演奏而非死跟节拍器。

| 参数 | 范围 | 说明 |
|---|---|---|
| bpm | 30–300 | 常见分布：慢歌 60–80，中速 90–120，快歌 130–180 |
| keyscale | 调性 | C Major、Am、F# Minor… 影响音高与情绪色彩 |
| timesignature | 拍号 | 4/4 最常见，3/4 华尔兹，6/8 摇摆感 |
| vocal_language | 语言 | LM 通常能根据歌词自动识别 |
| duration | 秒 | 目标时长，实际生成可能略有偏差 |

**什么时候手动设**：

| 场景 | 建议 |
|---|---|
| 日常生成 | 不用管，让模型自动推断 |
| 有明确速度要求 | 手动设 `bpm` |
| 特定风格（如华尔兹） | 手动设 `timesignature = 3/4` |
| 要配合其他素材（视频时长） | 手动设 `bpm` 和 `duration` |
| 追求特定调性色彩 | 手动设 `keyscale` |

**对我们的特殊影响**：`bpm` 只是锚点且后端不回显实际值，所以「按拍拆镜」无法精确
计算到 1/4–1/8 拍格，只能按镜头时长均分 + 大致踩点（CV-126 已知折损）。

**比"不精确"更要注意的：元数据可能被整条拒绝。** 后端 `txt2audio` 对
`keyscale` / `timesignature` / `bpm` 做的是硬校验——取值不接受时直接 500，
且不返回任何原因（实测 `Em`、`E minor` 会被拒，`C major`、`Am`、`Emin` 可过，
且**同参数存在偶发失败**，无稳定规律可总结）。`music_generation` 的处理是
自动摘掉该字段重试，并在结果里回 `degradedFields`。

→ 因此这三个参数是**尽力而为的软提示**：写它们可以提高命中率，但**不能假定生效**。
看到 `degradedFields` 非空就说明该参数被忽略了，结果不受它约束。
