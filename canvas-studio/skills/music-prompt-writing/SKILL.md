---
name: music-prompt-writing
description: 音乐生成提示词规范（canvas-studio 的 music_generation 工具 / Drama txt2audio，ACE Step 1.5）。凡调用 music_generation 生成 BGM 或歌曲前加载：Caption 与 Lyrics 写法、duration/bpm/keyscale/language/timesignature 取值边界、纯器乐与有人声两条路径、长音频与抽卡策略；完整标签字典与实战细则见 references/ 分册。
---

# 音乐生成提示词规范（ACE Step / txt2audio）

适用：`music_generation` 的每一次调用。

**能力边界（先记住）**：后端只暴露 text2music 最小子集（7 参数），**没有** seed /
reference_audio / cover / repaint。→ 无法复现、无法续写、无法用参考音频统一音色；
「抽卡」只能重跑。想做跨片风格统一，只能在 Caption 里把风格标签写死复用。

## 一、先定两件事

1. **时长**：BGM 的 `duration` **必须等于成片总时长**（实测精确生效，误差 ±0.03s；
   ≤5 分钟单次生成即可，5min 约耗时 82s）。音乐短于成片时循环兜底，**禁止变速拉伸**。
2. **人声**：默认纯器乐 → `lyrics` 留空（工具自动填 `[Instrumental]`）+ `language="unknown"`；
   要歌曲才写 lyrics 并给语言代码（zh / en / ja…）。

## 二、Caption（prompt 参数）五步

拼装顺序 `流派 → 乐器组合 → 音色 → 情感`（**BPM 不写进 caption**，交给 `bpm` 参数）：

1. 定流派 —— 见分册 ③，每流派带推荐 BPM 区间
2. 挑乐器组合 —— 见分册 ①（38 条）
3. 加音色质感词 —— dark / warm / bright / soft / vocal（分册 ②）
4. 加情感 —— sad / melancholic / uplifting / intense…（分册 ④）
5. 需要时补维度：时代参考 / 制作风格 / 人声特点 / 结构提示（分册「Caption 九个写作维度」）

例：`jazz, piano and double bass, warm, melancholic`

### 硬规则

- **具体优于模糊**：`sad piano ballad with female breathy vocal` ≫ `a sad song`
- **禁止在 Caption 写 BPM / 调性 / 拍号**——走专门参数，写了会与元数据冲突
- **避免互斥描述**（古典弦乐 + 硬核金属会劣化）；要冲突就转译成时间轴演变
  （开头弦乐 → 中段金属 → 结尾 hip-hop）
- 善用参考式表达：`in the style of 80s synthwave` 能一句话传达复杂美学
- 中英文均可，中文提示词同样有效
- 描述粒度 = 自由度：写少 → 惊喜多；写细 → 更可控

## 三、Lyrics（仅有人声时写）

- **结构标记要克制**：`[Chorus - anthemic]` 可以；❌ 不要堆成
  `[Chorus - anthemic - stacked harmonies - high energy - powerful - epic]`
  （模型可能把标记当歌词唱出来）
- 每行 **6–10 音节**，同一位置的行保持 ±1–2 音节；段落之间空行分隔
- 大写 = 更强力度（`THIS IS OUR MOMENT!`）；括号 = 背景和声（`We rise together (together)`）
- **一致性三条**：Caption 乐器 ↔ Lyrics 器乐段落标记；Caption 情绪 ↔ Lyrics 能量标记；
  Caption 人声 ↔ Lyrics 人声控制标记。模型不擅长解决冲突，矛盾描述直接拉低质量。

完整的标记表、纯器乐写法与示例见 `references/caption-lyrics-rules.md`。

## 四、参数取值边界

| 参数 | 建议 | 边界与坑 |
|---|---|---|
| `duration` | **= 成片总时长（秒）** | ≤300 实测稳定；30–60s 与 2–4min 结构最好，超 4min 可能重复 |
| `bpm` | 60–180 | 可调 30–300，极端值训练数据少不稳；**模型只当锚点**，实际 ±2 |
| `keyscale` | C / G / D / Am / Em | **软提示**：后端可能不接受某些取值，被拒时自动忽略（见下方铁律） |
| `timesignature` | `4`；`3` / `6` 通常 OK | 5/7 属高级玩法；同样是软提示 |
| `language` | `unknown` = 纯器乐无人声 | 有人声才填 zh / en / ja… |

⚠️ **软提示铁律（不要产生错觉）**：`keyscale` / `timesignature` / `bpm` 是**尽力而为**
的提示，不是硬约束。后端可能不接受某些取值（且一律报无原因的 500），此时
`music_generation` 会自动忽略该参数重新生成，并在结果里返回
`degradedFields: ['keyscale']` 之类的字段。

- **看到 `degradedFields` 非空 = 该参数没生效**。禁止向用户声称「已按 E minor 生成」
  「已用 4/4 拍」——正确说法是「已生成（未指定调性）」。
- 调性对成片影响没那么大，被忽略时**默认接受结果**，不要反复重试；只有用户明确
  要求特定调性时才考虑改用 C major / A minor 这类最稳的取值重跑。
- 后端另有**偶发 500**（同参数一次成功一次失败，实测存在）。工具会自动重试，
  重试成功是正常现象，不要当成故障报告给用户。

⚠️ 响应里的 `duration` 字段是**生成耗时**（30s 音频返回 8.56、5min 返回 81.5），
**不是音频时长**，不要拿它当音频长度用。

## 五、抽卡与迭代

- 无 seed ⇒ 不可复现。结果不满意优先**改 Caption**（加维度 / 换乐器组合），
  其次调 bpm / keyscale；不要靠堆形容词。
- 单次成本参考：30s≈9s、60s≈17s、5min≈82s —— 值得多跑几次选优。
- **跨镜头 BGM 只生成一条主音频**覆盖全片，不要每段镜头各生成一条（会断裂）。

## 分册（按需读，别一次性全读）

- `references/tag-dictionary.md` —— 117 标签字典：乐器 38 / 音色 7 / 流派 25+BPM /
  情感 8 / 调性 27 / 综合风格 12，外加万能模板与组合速记
- `references/caption-lyrics-rules.md` —— Caption 九个写作维度、Lyrics 结构/人声/能量
  标记表、纯器乐写法、AI 味五个红旗、元数据边界、输入控制总表（含后端未暴露项）
