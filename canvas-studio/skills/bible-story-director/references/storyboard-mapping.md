# 九节字段填法（S4 / S6 / S7 / S8 必读）

> 本文件是 `storyboard.json` 的**逐节填写说明**，判据以 `src/contracts/storyboard.ts` 的 `validateForSeed` 为准（唯一完成度判据，全入口共用一份）。写之前先扫一遍第 12 节的 blocker 清单——它是「能不能落地」的硬线。

## 1. 顶层与分笔顺序

顶层字段（不在九节里）：

| 字段 | 填法 |
| --- | --- |
| `title` | 故事名 + 切口，如「大卫与歌利亚 · 两军之间的空地」 |
| `meta.genre` | 固定 `圣经叙事`（不填只是 warning，但别留空） |
| `meta.targetDuration` | 总时长秒数，与 Σ shot 时长之差 ≤10%（超出只 warning） |
| `meta.aspect` | `16:9`（**blocker，不能空**） |
| `meta.audience` | 可选，如 `成人写实` / `儿童主日学` |

分四笔写（`write_storyboard` 是分节合并语义：传了的节替换，没传的保留）：

1. `meta` + `00_creative` + `02_visual` → 覆盖层显示「已填充 3/9」
2. `04_storyboard`（体量最大）→ 4/9，分镜卡成排出现
3. `05_characters` + `03_narration` + `06_sound` → 6/9
4. `01_facts` + `07_assets` + `08_constraints` → 9/9

每笔之间不要问用户。九节齐了才停下来请用户审阅、点「确认落地」。

## 2. 语义 ID 命名约定

契约 §4.2 的书写约定：`C\d+` / `S\d+` / `S\d+-Sh\d+` / `V\d+`。

| 类型 | 形态 | 例 |
| --- | --- | --- |
| 角色 | `C1`、`C2`… | `C1`（大卫）、`C2`（歌利亚） |
| 分镜（scene） | `S1`、`S2`… | `S2`（第二场：叫阵） |
| shot | `S{场号}-Sh{镜号}` | `S2-Sh1` |
| 旁白句 | `V1`、`V2`… | `V3` |

**ID 一次铸造、永不复用**——重复 ID 是 blocker。不符合约定的写法只 warning，但照约定写，否则渲染层与 seed 对照会错位。

## 3. `§00_creative.brief`

一段话，200–400 字，中文。必须含五要素：

1. 出处（书卷 + 章:节）
2. 切口（选了哪个场景 / 哪种压缩策略）
3. 主题（一句话，不要写成道德训诫）
4. 情感走向（起 → 转 → 落的情绪曲线）
5. 目标时长与画幅

示例：

> 本片取材于《撒母耳记上》17:1–58，采用单场景切口，只拍以拉谷两军对峙的这一天，不交代大卫此前的受膏与杀狮熊。主题是「外表的尺寸不是力量的尺寸」——画面刻意让歌利亚始终占据更大的画幅比例，直到投石索松开那一刻才把重心交还给大卫。情感走向：压迫（全景仰视巨人）→ 迟疑（大卫系带子试甲）→ 决定（跑向战场）→ 静默（巨人倒下后的长镜）。60 秒，16:9。

## 4. `§01_facts.facts[]`

`{ claim, source, status }`。三条纪律：

- **`claim`**：一条可对质的事实陈述，不写形容词。
- **`source`**：书卷 + 章:节（出处与场景细节），或可对质的近东考古/历史常识。
- **`status`**：只写 `verified`。**`pending` 的条目在 seed 时会被显式丢弃**——写它等于白写，还会多一条 warning。

一个圣经故事片建议 4–8 条，覆盖出处、时代、地理、人物关系、制度背景：

| claim | source |
| --- | --- |
| 故事出自大卫击杀非利士巨人歌利亚的记载 | 撒母耳记上 17:1–58 |
| 交战地点在以拉谷，非利士与以色列两军隔谷列阵 | 撒母耳记上 17:1–3 |
| 大卫当时是牧羊的少年，尚未入伍 | 撒母耳记上 17:14–15 |
| 大卫拒绝扫罗的盔甲，只带杖、投石索与五块石子 | 撒母耳记上 17:38–40 |
| 该时期以色列已立王（扫罗），但仍属铁器初兴的部落联合体 | 近东考古常识：士师—王国之交冶铁尚未普及 |

⚠️ **写不出来的别硬塞**。视觉判断（「这里适合侧逆光」）不是事实，放 `§02`。

## 5. `§02_visual.tokens[]`

`{ k, v }`，**至少 1 个**（blocker），本 skill 固定给 5 个（与总纲 Look 采集的 5 项对齐）：

| k | v 的写法 |
| --- | --- |
| `主体` | 人物 + 年龄 + 族群相貌特征（用 `period-guide.md` 的正向表述，如 Middle Eastern features, olive skin, dark wavy hair） |
| `环境` | 地点 + 建筑质感（如 sun-baked mudbrick, flat roofs, dry wadi） |
| `材质` | 布料与器物（如 unbleached linen, coarse wool, unglazed terracotta） |
| `色彩` | 主色 + 点缀（如 sun-bleached earth tones + deep indigo accent） |
| `光线` | 光位与氛围（如 harsh midday sun, hard black shadows, dust haze） |

`lookRef`（基调样张引用）**不要自己写**——它由总纲第 ② 步的 Look 采集经 `image_generate storyboardRef='look'` 挂上，或由 Host 在故事板已建、尚无分镜时自动兜底挂。本 skill 不动这个字段。

## 6. `§03_narration.lines[]`

`{ id, text, duration, shotRef? }`。

- `id`：`V1`、`V2`…
- `text`：中文旁白，**按 4 字/秒配额**（详见 `narrative-framework.md` §5）；不要铺满全片
- `duration`：这句旁白占的秒数，与它所属 shot 的时长对齐
- `shotRef`：可选，指向 shot id。填了但 shot 不存在只 warning

旁白是**只写一次**的：shot 通过 `narrationRef` 反向引用，不要在多个地方重复文本。

## 7. `§04_storyboard.scenes[]`

```
scenes: [ { id: 'S1', title: '两军对峙', shots: [ ... ] } ]
```

**术语对照（最容易搞混的一处）**：契约的 **`shot` = 一条视频** = 总纲 `shot-format.md` 分镜表里的一行；契约的 **`scene`** 是若干 shot 的分组（一场戏），本身不带时长。所以「60s / 8 镜」= 8 个 `shot`，按叙事分成 2–3 个 `scene`。总纲 C-16 说的「一个分镜 = 一条视频」，在本契约里就是「一个 `shot` = 一条视频」；而 H3 prompt 内部的 `[Shot N]` 节拍是第三个概念，只写进 prompt、不增加 shot 数。

`shot` 字段：

| 字段 | 必填 | 填法 |
| --- | --- | --- |
| `id` | ✅ blocker | `S{场}-Sh{镜}`，如 `S2-Sh1` |
| `duration` | ✅ blocker（>0） | 单镜 5–15s；Σ 各镜 ≈ `targetDuration` |
| `visual` | ✅ blocker | 画面描述：主体 / 动作时序 / 环境 / 光线 / 氛围。**这是给分镜卡看的规划文字，不是 H3 prompt** |
| `camera` | 建议填 | 景别 + 运镜，如「中景，缓慢推进」；词汇表见总纲 `shot-format.md` |
| `audio` | 建议填 | 本镜的声音设计：环境声 / 动作音 / 对白落点 |
| `frames` | 填 | 时间码展示用，`round(duration × 24)`（渲染成 `8s · 192f`），不参与落地校验 |
| `narrationRef` | 可选 | 指向 `§03` 的 `V{n}`。**填了不存在的是 blocker**，比 shotRef 严格 |
| `promptEn` | **本 skill 有意留空** | 英文视频提示词在第 9 步按 `h3-prompt-writing` 现写，提前写会与参考图组合脱节 |
| `refImage` | 不填 | 落地前不产生（`storyboardRef=<shot id>` 已被门禁拦截，逐镜出图要等落地）；落地后逐镜关联走 `image_generate shotRefs=[该镜分镜卡]` |
| `backup` | ✅ 填 `false` | 备份拍标记，只有真出备份镜才 `true` |

⚠️ **`promptEn` 留空会触发一条 warning**「N 个 shot 缺英文 prompt（promptEn）」。这是本 skill 的**预期行为**，不是缺陷——落地校验只把它列为 warning，不拦落地。看到这条告警不要惊慌，也不要去补写。

## 8. `§05_characters[]`

数组直接挂在 `'05_characters'` 下（不是对象包一层）。每项：

| 字段 | 填法 |
| --- | --- |
| `id` | `C1`、`C2`… |
| `label` | 卡片上的短标签，如「大卫（牧童）」 |
| `name` | 正式名，如「大卫」 |
| `tags` | 3–5 个关键词，如 `['少年','牧羊','希伯来']` |
| `profile.temperament` | 气质（人读） |
| `profile.face` | 面容（人读） |
| `profile.costume` | 服装（人读，**必须与 `§02` token 的服饰口径一致**） |
| `palette.base` / `palette.accent` | 主色 / 点缀色 |
| `appearsIn` | **分镜（scene）的 id 列表**，如 `['S1','S2','S4']`。⚠️ 不是 shot id——填 shot id 会出一条 warning |
| `gen.lockedPrompt` | ✅ **blocker**，机读的锁定提示词。要具体到能锁住面容与服装（族群相貌 + 年龄 + 发型/胡须 + 服装层数 + 材质 + 配色） |
| `gen.negativePrompt` | 填预期回避项（如 modern clothing, plate armor, blonde） |

⚠️ **`lockedPrompt` 后续会被逐字复用进每一条视频 prompt 的 `subject_definitions:`**（总纲一致性硬约束）。所以它必须**自带完整信息、不依赖上下文**：写「大卫」在别的镜头里没法锁住一致性，写「少年牧童，中东相貌，橄榄色皮肤，深色卷发，未蓄须，粗麻内袍外披无染羊毛短斗篷，皮革腰带，赤足凉鞋」才锁得住。

## 9. `§06_sound`

```
{ bgm: { bpm, lufs, sidechain }, sfx: ['…'] }
```

- `bgm.bpm`：整数（如 62，史诗叙事常用 60–72）
- `bgm.lufs`：负数（如 -18）
- `bgm.sidechain`：一句话（如「对白与旁白出现时压低 6dB」）
- `sfx[]`：本片需要的音效描述短语（如「旷野风声」「皮革投石索的甩响」）

多镜片子的视频 prompt 里 `non_diegetic_music:` 写 `N/A`（配乐权交给 BGM 音轨层），BGM 由第 10 步单独生成——`§06` 只是把参数预算先定下来。

## 10. `§07_assets[]`

`{ name, type, status, ref: { kind, id } }`。

- `type`：`text` / `image` / `video` / `audio`
- `status`：`ready` / `pending`（`pending` 只产生 warning）
- `ref.kind`：`canvasNode` / `file`；`ref.id` 必须是**已存在的画布节点 id**
- ⚠️ **只存引用不存副本**：seed 不造新节点，只校验引用。故事板阶段还没出图时，这一节给空数组 `[]` 是合法的（无 blocker）

## 11. `§08_constraints[]`

字符串数组，直接来自 SKILL.md §4 的五条默认模板 + 本片增补。每条写一句可执行的禁令：

```json
[
  "时代锁定：公元前 11 世纪近东，禁止中世纪欧洲元素（板甲、尖顶盔、城堡、哥特教堂）",
  "人群特征：闪米特/中东相貌，禁止金发白肤默认脸",
  "服饰器物：中东粗麻长袍与皮革凉鞋，全片不混用其他时代器物",
  "情节忠实：不增删人物、不改结局（大卫以投石索击杀歌利亚）、不把神迹改写成巧合",
  "跨镜一致性：大卫的相貌、内袍与斗篷、投石索，以及以拉谷的空间方位全片恒定"
]
```

## 12. §03 ↔ §04 双向引用

唯一易错的引用关系，两边的严格程度不同：

| 方向 | 字段 | 引用目标 | 引用了不存在时 |
| --- | --- | --- | --- |
| 旁白 → 分镜 | `§03.lines[].shotRef` | shot id（`S2-Sh1`） | warning |
| 分镜 → 旁白 | `§04.shots[].narrationRef` | 旁白 id（`V3`） | **blocker** |

做法：**先定旁白（V1…Vn），再定 shot，然后双向对齐**。一个 shot 至多引一句旁白；一句旁白只挂在一个 shot 上。

## 13. 落地前的 blocker 清单（逐条对齐 `validateForSeed`）

缺任何一条都会被 `storyboard.json` 的落地校验拦下，且清单会指出缺在哪节：

- `title` 非空
- `meta.aspect` 非空
- `meta.targetDuration > 0`
- `§02` 至少 1 个 token
- `§04` 至少 1 个 scene；每个 scene 至少 1 个 shot；`scene.id` 与 `shot.id` 非空；`shot.duration > 0`；`shot.visual` 非空
- `§03` 每句 `id` 与 `text` 非空；`shot.narrationRef` 若填必须存在
- `§05` 每项 `id` 非空、`gen.lockedPrompt` 非空
- 全文语义 ID 不重复

**只 warning、不拦落地**（出现属正常，不必返工）：`meta.genre` 未填、shot 数 >15、**缺 `promptEn`（本 skill 必然出现）**、`shotRef` 指向不存在的 shot、`appearsIn` 指向不存在的分镜、语义 ID 不符合书写约定、时长偏差 >10%、`§01` 有 `pending` 条（会被丢弃）、`§07` 有 `pending` 素材。

## 14. 常见被打回的原因

1. **人物表里 `appearsIn` 填了 shot id** → warning 满天飞。填 scene id。
2. **`visual` 写成 H3 prompt**（堆英文参数、`<d>` 标签）→ 分镜卡是给人审的，写中文规划描述；英文 prompt 是第 9 步的事。
3. **`lockedPrompt` 太短**（只写名字）→ 后续逐镜复用时会丢一致性。
4. **Σ 时长偏差过大** → 各镜时长先算好再写，不要写完再凑。
5. **`§01` 塞了 `pending`** → 落地即丢，等于没写。
