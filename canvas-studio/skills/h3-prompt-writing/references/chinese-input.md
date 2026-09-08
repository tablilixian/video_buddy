# 中文输入专项

正文六段/三段**始终用英文写**。只有两处保留原文：`<d>` 内的台词与歌词，
以及画面上真实可见的文字。这一点与英文输入没有区别。

⚠️ **不要在正文里给中文词加括号注解。** 实测官方对 6 个中文输入的回复中，
中文字符**只出现在 `<d>` 和画面文字的双引号里**，正文一个中文字都没有。

```text
❌ an old-fashioned Chinese teahouse (老茶馆) at night
❌ the storyteller (说书人) raises his wooden block (醒木)
✅ an old-fashioned Chinese teahouse at night
✅ the storyteller raises a small rectangular hardwood block
```

夹带中文注解既不符合官方格式，也占掉了本该用来描述画面的字数。
遇到没有现成英文对应词的器物，**描述它长什么样**（见第 5 节），不要音译或夹注。

下面是中文意图特有、且实测中最容易漏掉的几条。

---

## 1. 中文常把「有人在说话」写成名词或不带引号的动词

这是**中文输入最大的坑**。英文意图里的台词几乎总是带引号，一眼可辨；
中文却经常把一整个发声事件压缩成一个词，而它在画面上是**实实在在有人在出声**。

**名词式**（一个词代表一段吆喝）

> 卖花声 · 吆喝 · 叫卖声 · 读书声 · 报站声 · 议论声 · 划拳声 · 叫好声 · 哭喊声

**动词式**（不带引号，但确实在说话）

> 聊天 · 交谈 · 说笑 · 议论 · 招呼 · 寒暄 · 争执 · 念叨 · 自言自语

**这些是台词，不是环境音。** 要落成真实的 `<d>[Chinese] …</d>`，配说话人 ID，
用户没给具体词句时**由你写地道的中文短句**——这正是官方 IR 的做法。

```text
❌ 只写进环境音：
overall_soundscape: ... the distant call of a flower vendor drifts through the alley ...

✅ 落成台词：
An off-screen elderly female street vendor with a melodic Jiangnan accent (S1)
begins calling out in the distance, <d>[Chinese] 卖花咯——</d>
```

写出来的中文要**符合那个场景的真实说法**，不要写翻译腔：

| 场景 | ✅ 地道 | ❌ 翻译腔 |
|---|---|---|
| 江南巷子卖花 | `白兰花，茉莉花！` | `我在卖花，请来买` |
| 面馆客人 | `老板，再来一碗` | `店主，我想要另一碗面` |
| 茶馆说书 | `话说那年腊月……` | `让我告诉你那年冬天的事` |
| 一家人吃饭 | `今天的拉面闻起来真香啊` | `这个拉面的气味非常好闻` |

**判断口诀**：意图里只要出现「有人在出声」的任何暗示，就问自己
——*这句话具体会怎么说出口？* 能想出来，就该进 `<d>`。

## 2. 台词跨切镜要用 `<scenetrans>`

叫卖、吆喝这类声音常常横跨一次切镜。两侧连接点都要写，并说明音频延续：

```text
[Shot 1] ... (S1) begins calling out in the distance,
         <d>[Chinese] 卖花咯——<scenetrans></d>
[Shot 2] At 00:04.250, the camera cuts to ... The off-screen speaker (S1)
         continues her vocal line from the previous shot,
         <d>[Chinese] <scenetrans>白兰花，茉莉花！</d>
```

## 3. 中文引号在 `<d>` 内要剥掉

用户写 `他说：「话说那年腊月，大雪封城。」`，`<d>` 里**只留内容**：

```text
✅ <d>[Chinese] 话说那年腊月，大雪封城。</d>
❌ <d>[Chinese] 「话说那年腊月，大雪封城。」</d>
```

`「」` `『』` `""` `''` 全部剥掉。句末的 `。？！` 保留。

## 4. 画面内的中文文字用英文双引号原样包裹

与英文规则一致，但中文场景里出现得频繁得多——招牌、门牌、横幅、木牌、标语。

```text
A red neon sign reading "营业中" glows above the doorway.
... a small rectangular wooden board with the black painted Chinese text "今日售罄" ...
```

**不翻译**，不加注解。注意与第 3 条区分：那是**听见**的，这是**看见**的。

## 5. 文化意象要落成可见的画面，不能直译词汇

中文意图爱用四字格和意境词。它们本身不是画面，**要拆成镜头里看得见的东西**。

| 意图里的词 | ✅ 落成画面 | ❌ 直译 |
|---|---|---|
| 雨打芭蕉 | 芭蕉阔叶特写，雨滴砸上叶面碎成水花 | rain hitting banana leaves |
| 江南烟雨 | 青石板反光、白墙黛瓦、远处雾气把巷子糊成一片灰白 | Jiangnan misty rain atmosphere |
| 灯火阑珊 | 稀疏的暖黄灯笼在风里晃，大片区域陷在暗处 | dim scattered lights |
| 人声鼎沸 | 方桌挤满茶客，手势夸张，前排两人侧身对喊 | noisy crowd |

器物同理：**醒木**要写成 *a small rectangular hardwood block struck flat against
the table*，而不是 `xingmu`；**油纸伞**写成 *an oil-paper umbrella, amber-red canopy
stretched over slender bamboo ribs*。

## 6. 长度跟着意图给的信息量走

中文意图往往很短（三五十字），但信息密度高。**不要为了凑词数注水。**

实测官方在稀疏中文意图上写得很克制：一句「深夜面馆挂售罄牌」的意图，
官方只写 179 词；而带首帧图、画面信息量大的 I2VA，官方写到 697 词。

**信息从哪来，长度就到哪：** 用户给的细节 + 素材里看得见的东西。
两者都少时，短的提示词比注水的好。
