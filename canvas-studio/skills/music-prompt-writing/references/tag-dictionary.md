# 音乐标签字典（117 个）

> 数据来源：ACE-Step 1.5 训练标签清单整理去重。用法：从各类里各挑 1 个拼成 Caption，
> 顺序 `流派 → 乐器组合 → 音色 → 情感`。**BPM 单独走 `bpm` 参数，不写进 Caption。**

---

## ① 乐器组合 Instruments（38）

| # | 英文标签 | 中文 | # | 英文标签 | 中文 |
|---|---|---|---|---|---|
| 1 | acoustic guitar and drums | 木吉他和鼓 | 20 | piano and cello | 钢琴和大提琴 |
| 2 | acoustic guitar and fiddle | 木吉他和小提琴 | 21 | piano and double bass | 钢琴和低音提琴 |
| 3 | acoustic guitar and harmonica | 木吉他和口琴 | 22 | piano and drums | 钢琴和鼓 |
| 4 | acoustic guitar and piano | 木吉他和钢琴 | 23 | piano and guitar | 钢琴和吉他 |
| 5 | acoustic guitar and synthesizer | 木吉他和合成器 | 24 | piano and saxophone | 钢琴和萨克斯管 |
| 6 | bass and drums | 贝斯和鼓 | 25 | piano and strings | 钢琴和弦乐（组） |
| 7 | beats | 节拍（节奏采样） | 26 | piano and synthesizer | 钢琴和合成器 |
| 8 | beats and piano | 节拍和钢琴 | 27 | piano and violin | 钢琴和小提琴 |
| 9 | brass and piano | 铜管乐器和钢琴 | 28 | saxophone | 萨克斯管 |
| 10 | electric guitar and drums | 电吉他和鼓 | 29 | saxophone and piano | 萨克斯管和钢琴 |
| 11 | electric guitar and piano | 电吉他和钢琴 | 30 | saxophone and trumpet | 萨克斯管和小号 |
| 12 | guitar | 吉他 | 31 | synthesizer | 合成器 |
| 13 | guitar and banjo | 吉他和班卓琴 | 32 | synthesizer and acoustic guitar | 合成器和木吉他 |
| 14 | guitar and drums | 吉他和鼓 | 33 | synthesizer and bass | 合成器和贝斯 |
| 15 | guitar and fiddle | 吉他和小提琴 | 34 | synthesizer and drums | 合成器和鼓 |
| 16 | guitar and harmonica | 吉他和口琴 | 35 | synthesizer and electric guitar | 合成器和电吉他 |
| 17 | guitar and piano | 吉他和钢琴 | 36 | synthesizer and guitar | 合成器和吉他 |
| 18 | guitar and synthesizer | 吉他和合成器 | 37 | violin | 小提琴 |
| 19 | piano | 钢琴 | 38 | violin and piano | 小提琴和钢琴 |

---

## ② 音色 / 质感 Timbre（7）

| 标签 | 中文 | 用法提示 |
|---|---|---|
| dark | 黑暗的、隐晦的 | 悬疑 / 沉重 / 金属 |
| bright | 明亮的、欢快的 | 流行 / 广告 / 清晨 |
| warm | 温暖的、热情的 | 抒情 / 木吉他 / 复古 |
| soft | 柔软的、温柔的 | 摇篮曲 / 氛围 / 柔光画面 |
| rock | 摇滚的 | 与 electric guitar and drums 搭配 |
| varies | 不固定 | 出现时 BPM 需按实际曲目单独指定 |
| vocal | 人声的、声乐的 | 有人声时必带 |

质感词可越界使用（官方推荐）：warm / crisp / airy / punchy / lush / polished / raw，
直接影响混音与音色倾向。

---

## ③ 音乐流派 Genre & BPM 区间（25）

| # | 流派（英文） | 中文 | BPM 区间 | 说明 |
|---|---|---|---|---|
| 1 | electronic | 电子音乐 | 120–150 | 氛围电子 90–110，硬派舞曲可达 150–180 |
| 2 | hip hop | 嘻哈 | 80–100 | 快节奏可达 100–120 |
| 3 | rock | 摇滚 | 110–140 | 硬摇滚更快 |
| 4 | jazz | 爵士 | 90–120 | 即兴演奏，节奏复杂多变 |
| 5 | blues | 蓝调 | 80–110 | 旋律忧伤，常用 12 小节结构 |
| 6 | classical | 古典 | 60–160 | 体裁差异极大；浪漫慢板 <60、快板 120–160 |
| 7 | rap | 说唱 | 80–100 | 快速说唱可达 100–120 |
| 8 | country | 乡村 | 80–110 | 叙事性强，节奏平稳 |
| 9 | classic rock | 经典摇滚 | 110–140 | 60–80 年代代表摇滚 |
| 10 | hard rock | 硬摇滚 | 130–160 | 比一般摇滚更强烈 |
| 11 | folk | 民谣 | 80–120 | 质朴、节奏简单 |
| 12 | soul | 灵歌 | 90–120 | 福音 + 节奏蓝调，情感强烈 |
| 13 | dance, electronic | 电子舞曲 | 120–150 | 欢快曲目可达 150–180 |
| 14 | rockabilly | 山区乡村摇滚 | 100–120 | 乡村与摇滚节奏融合 |
| 15 | dance, dancepop, house, pop | 舞曲 / 流行 / 浩室 | 100–130 | house 约 120–130 |
| 16 | reggae | 雷鬼 | 80–100 | 律动感强 |
| 17 | experimental | 实验音乐 | 60–180 | 无固定速度 |
| 18 | dance, pop | 舞曲流行 | 100–130 | 流行旋律 + 舞曲节奏 |
| 19 | dance, deephouse, electronic | 深浩室电子舞曲 | 110–130 | 节奏舒缓、氛围深邃 |
| 20 | k-pop | 韩国流行 | 100–130 | 随编曲与编舞调整 |
| 21 | experimental pop | 实验流行 | 90–130 | 节奏多变 |
| 22 | pop punk | 流行朋克 | 120–140 | 旋律易记、节奏明快 |
| 23 | rock and roll | 早期摇滚 | 100–120 | 强烈摇摆感 |
| 24 | R&B | 节奏布鲁斯 | 90–110 | 爵士 + 福音，韵律感强 |
| 25 | pop rock | 流行摇滚 | 100–130 | 节奏适中 |

---

## ④ 情感标签 Mood（8）

| 标签 | 中文 | 常搭 |
|---|---|---|
| sad | 伤心 | piano and strings / piano and saxophone |
| emotional | 情绪激动 | strings / vocal |
| angry | 生气 | electric guitar and drums / dark |
| happy | 开心 | dance, pop / bright |
| uplifting | 令人振奋 | synthesizer and drums / 广告片尾 |
| intense | 紧张的 | hard rock / 追逐与悬念 |
| romantic | 浪漫的 | piano and strings / warm |
| melancholic | 忧郁的 | jazz / piano and double bass |

---

## ⑤ 调性色彩 Key & Tonality（27）

**先定大小调**：major 大调 = 明亮开阔（庆典、田园、温暖抒情）；
minor 小调 = 内敛忧伤（悲伤、悬疑、戏剧性）。

| 调性 | Key | 大小调 | 情感色彩 | 适合场景 |
|---|---|---|---|---|
| C大调 | C major | major | 单纯、明亮、质朴 | 简单钢琴曲、民谣、儿歌 |
| C#大调 | C# major | major | 极明亮、尖锐、充满张力 | 技巧性独奏（较少用） |
| C#小调 | C# minor | minor | 尖锐、不安、极具张力 | 《月光奏鸣曲》、科幻 / 惊悚配乐 |
| C小调 | C minor | minor | 庄重、深沉、斗争性 | 《悲怆》奏鸣曲、抗争性音乐 |
| C♭大调 | C-flat major | major | 理论调性，实际同 B 大调 | 纯理论，实战几乎不用 |
| G大调 | G major | major | 明亮、田园、温暖 | 乡村、吉他弹唱 |
| G#小调 | G# minor | minor | 极端紧张、近乎病态的忧郁 | 现代古典、恐怖片配乐 |
| G小调 | G minor | minor | 忧愤、激情、急切感 | 巴洛克赋格、苦情歌 |
| G♭大调 | G-flat major | major | 极柔美、朦胧、精致 | 印象派、氛围音乐 |
| D大调 | D major | major | 辉煌、胜利、庆典感 | 凯旋进行曲、小提琴炫技 |
| D小调 | D minor | minor | 悲壮、热烈、戏剧性 | 《合唱》交响曲、史诗配乐 |
| D♭大调 | D-flat major | major | 厚重、奢华、丝绒质感 | 浪漫派钢协、好莱坞配乐 |
| A大调 | A major | major | 温暖、柔和、歌唱性 | 浪漫派钢琴、深情情歌 |
| A小调 | A minor | minor | 最基础小调，纯净忧伤 | 民谣、流行情歌 |
| A♭大调 | A-flat major | major | 温柔、梦幻、月光般 | 夜曲、管弦乐慢板 |
| E大调 | E major | major | 明亮、刺眼、光辉感 | 重金属、摇滚、恢弘配乐 |
| E♭小调 | E-flat minor | minor | 极致阴暗、恐怖、末日感 | 恐怖电影配乐 |
| E♭大调 | E-flat major | major | 庄严、宏大、英雄气概 | 《英雄》交响曲、宏伟管弦 |
| E小调 | E minor | minor | 沉重、悲壮、有动力感 | 摇滚、金属、吉他曲 |
| B大调 | B major | major | 深沉、醇厚、略孤高 | 复杂古典、爵士钢琴 |
| B小调 | B minor | minor | 阴郁、孤寂、压抑 | 炫技小提琴、巴洛克复调 |
| B♭小调 | B-flat minor | minor | 黑暗、压迫、壮烈 | 拉赫玛尼诺夫前奏曲 |
| B♭大调 | B-flat major | major | 温暖、沉稳、平易近人 | 爵士大乐队、军乐、铜管 |
| F#大调 | F# major | major | 锐利、冷峻、现代感 | 新古典、超现实场景 |
| F大调 | F major | major | 温暖、田园、略柔和 | 巴洛克协奏曲、牧歌 |
| F小调 | F minor | minor | 暗涌、悲伤、压抑深情 | 《幻想即兴曲》、失落场景 |
| F#小调 | F# minor | minor | 冷峻、紧张、戏剧性强 | 悬疑配乐 |

**按乐器挑调**：吉他友好 E小调 / G大调 / A小调 / D大调；铜管与爵士友好 B♭ / E♭ / F；
钢琴任何调都行，C / G / F 最直观。
**升号 vs 降号**：升号多（F# / C#）偏冷峻锐利现代；降号多（D♭ / A♭ / E♭）偏厚重柔和浪漫。

---

## ⑥ 综合音乐风格体系（12）

中文创作层的完整配方：BPM + 调式 + 拍号 + 编曲技术特征，可直接当生成参数用。

| 风格 | 英文 / 别名 | BPM | 调式 | 拍号 | 编曲技术特征 |
|---|---|---|---|---|---|
| 流行抒情 | Mandopop Ballad | 70–90 | Am / C#m / Dm / G / C | 4/4 | 钢琴 / 弦乐为骨架，副歌加贝斯与鼓推进；人声为主，混响适中 |
| 华语 90 年代经典 | 90s C-pop Classic | 72–88 | C#m / Dm / F / G | 4/4 | 电钢琴 + 弦乐铺底，鼓组强调反拍，间奏萨克斯或电吉他独奏 |
| 城市流行 | C-Pop | 85–105 | C / G / Am / Bm | 4/4 | 合成器 Pad + 电钢琴，鼓机；律动轻快，重旋律记忆点 |
| 民谣 | Folk | 65–85 | G / C / D / Am | 4/4 · 6/8 | 木吉他主导，配口琴或小提琴；留白大，突出叙事 |
| 轻摇滚 | Soft Rock | 90–110 | C / G / D / Am | 4/4 | 电吉他清音 / 轻过载扫弦 + 稳定鼓组；情绪积极不激进 |
| R&B 抒情 | R&B Ballad | 70–95 | Fm / Gm / B♭ | 4/4（三连音） | Rhodes 电钢琴为核，贝斯滑音；人声转音多 |
| 爵士 | Jazz Ballad | 60–80 | F / B♭ / Dm / Gm | 4/4 · 3/4 | 钢琴 + 低音提琴 + 刷镲；七和弦与延伸音，swing 律动 |
| 影视原声 | Orchestral OST | 65–90 | Cm / Dm / Am / C | 4/4 · 3/4 | 弦乐群为主体，配木管与定音鼓；动态起伏大 |
| Lofi / Chillhop | Lofi Hip Hop | 70–95 | Cm / Am / Dm | 4/4 | 慢速鼓组 + 爵士钢琴采样；黑胶底噪与环境音 |
| 电子氛围 | Ambient Electronic | 70–100 | 大调 / 小调均可 | 4/4 | 合成器 Pad 铺底，弱化鼓点；重空间混响与渐变 |
| House / 电子舞曲 | House / EDM | 120–128 | Cm / Gm / Am | 4/4 | 四四拍强底鼓，合成器 Bass 循环；重 drop 与能量递进 |
| 古风 / 中国风 | Guofeng | 70–90 | 五声调式 / Am / Dm / G | 4/4 | 古筝 / 二胡 / 笛 + 弦乐；五声音阶，配器空灵 |

---

## ⑦ 万能模板（未指定风格时的默认取值）

| 项 | 值 |
|---|---|
| 风格 | 虐心抒情 |
| BPM | 80 |
| 调性 | C# minor |
| 拍号 | 4/4 |
| 乐器 | 钢琴、弦乐 |
| 情绪 | 悲伤 → 爆发 → 释然 |
| 结构 | 主歌 → 预副歌 → 副歌 → 间奏 → 副歌 → 尾奏 |

## ⑧ 组合速记

拼装顺序：**流派 → 乐器组合 → 音色 → 情感 → BPM**
例：`jazz, piano and double bass, warm, melancholic, 96 BPM`

| 场景 | 配方 |
|---|---|
| 慢速抒情 | blues / soul · 80–110 BPM + `piano and strings` / `piano and saxophone` + sad / melancholic / romantic |
| 中速叙事 | folk / country · 80–120 BPM + `acoustic guitar and harmonica` / `guitar and fiddle` + warm / soft |
| 高速驱动 | hard rock / pop punk · 130–160 BPM + `electric guitar and drums` + intense / angry + dark / bright |
| 电子律动 | house / deephouse · 110–130 BPM + `synthesizer and drums` / `beats` + uplifting / happy |

异常值：流派或音色里出现 `varies` 表示不固定，BPM 必须按实际曲目单独指定。
