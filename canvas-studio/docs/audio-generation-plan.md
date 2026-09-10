# 音频生成规划（ACE-Step 1.5 / Drama `txt2audio`）

> 日期 2026-09-10（末次更新 2026-09-10 下午） ｜ 状态：**规划已出；A / B / B+ / C(部分) / F 已落地；D 已降级（音乐先行，后台无时间支持）；E 待推进**
> 依据：用户提供的 `music-tag-cheatsheet.html`（117 标签 + 实战规则）、官方 `ACE-Step-1.5` 仓库与中文教程、以及**对后端 `txt2audio` 的实测**（本文件 §1 为实测数据，非纸面推测）
> 关联：CV-125（music_generation 转正）、CV-126（音乐先行工作流方案，**已降级**）、CV-127/127b/128/129/130（实现批次）、CV-131（音视频统一时间轴）
> **本文件是音频方向的唯一规划与状态入口**；逐条状态以 [STATUS.md](./STATUS.md) 为准；
> **逐层验收剧本（Skill → 画布 → 与视频协作）见 [audio-acceptance-checklist.md](./audio-acceptance-checklist.md)**；
> **音轨与视频合并路线（统一时间轴 / BGM 时长对齐）见 [av-timeline-plan.md](./av-timeline-plan.md)**。

---

## 1. 实测结论（硬数据，最重要）

对 `POST http://117.50.108.73:8082/api/v1/generate/txt2audio` 的真实调用结果：

| 请求 `duration` | 音频真实时长 | 生成耗时 | 耗时/时长 | 文件体积 |
|---|---|---|---|---|
| 15 | — | 5.2s | 0.35× | — |
| 30 | **30.024s** | 8.56s | 0.29× | 0.90 MB |
| 60 | **60.024s** | 16.53s | 0.28× | 1.85 MB |
| 300 | **300.024s** | 81.5s | 0.27× | 9.70 MB |

### 1.1 四条关键结论

1. **`duration` 精确可控**（误差 ±0.03s）。→ 「生成与成片等长的 BGM」这条主路径**完全可行**，不需要循环兜底，也不需要分段拼接。
2. **5 分钟可用**，耗时 81.5s；**远低于**我们 `DRAMA_TIMEOUT_MS.image = 360s` 的超时，不会超时中断。
3. **响应里的 `duration` 字段是「生成耗时」，不是音频时长**（30s 音频返回 8.56、60s 返回 16.53、300s 返回 81.5）。⚠️ 任何"用返回值判断音频长度"的写法都会错。
4. **`lyrics_prompt` 是必填字段**，缺失直接 422；传空串 `""` 能过校验但语义不明（官方要求纯器乐必须写 `[Instrumental]`）。

体积与耗时可用于预估：约 **32 KB/秒**（258 kbps mp3），生成耗时约 **0.27–0.35 × 目标时长**。

---

## 2. 能力矩阵：模型能做什么 vs 我们现在能用多少

后端只暴露了 ACE-Step 的 `text2music` 最小子集（7 个参数）。完整能力对照：

| ACE-Step 1.5 能力 | 作用 | 后端是否暴露 |
|---|---|---|
| **text2music**（文生音乐） | 当前唯一可用 | ✅ 已接（7 参数） |
| **seed（固定随机种子）** | 可复现 + 抽卡对比 | ❌ |
| **cover**（参考音频约束旋律/和弦/结构，Remix / Retake 抽卡） | 同一主题生成多个变奏、品牌音乐统一 | ❌ |
| **repaint**（局部重绘 / 续写，3–90s 区间） | 局部改词改结构、**多次续写实现无限时长**、音色克隆 | ❌ |
| **reference_audio**（全局声学特征：音色/混音/演奏风格） | 跨片风格统一 | ❌ |
| **extract / lego / complete** | 分轨、加轨、清唱配伴奏（Base 模型独占） | ❌ |

参数映射（我们的参数名 → ACE-Step）：

| 我们 | ACE-Step | 说明 |
|---|---|---|
| `prompt` → `caption_prompt` | `caption` | 风格/情绪/乐器/音色，**不写 BPM 与调性** |
| `lyrics` → `lyrics_prompt` | `lyrics` | 纯器乐填 `[Instrumental]`；**必填** |
| `duration` | `duration` | 秒，精确生效 |
| `bpm` | `bpm` | 30–300，**常见 60–180 最稳** |
| `keyscale` | `keyscale` | 常见调稳定，冷门调可能被忽略 |
| `language` | `vocal_language` | `unknown` = 纯器乐无人声 |
| `timesignature` | `timesignature` | `4` 最可靠；`3`/`6` 通常 OK |

---

## 3. Caption（prompt）写法规范

**核心定位**：Caption = 整体画像（风格/氛围/音色），Lyrics = 分镜脚本（随时间展开），两者必须讲同一个故事。

### 3.1 五条硬规则

1. **具体优于模糊**：`sad piano ballad with female breathy vocal` ≫ `a sad song`
2. **多维度组合锚定**：流派 → 乐器组合 → 音色 → 情感（→ BPM 交给参数不写进 caption）
3. **禁止在 caption 写 BPM / 调性 / 拍号**——这些走专门参数，写了会与元数据冲突
4. **避免冲突词**：古典弦乐 + 硬核金属这类互斥描述会劣化；解法是「重复强化想要的那个」或「转译成时间轴演变」（开头弦乐 → 中段金属 → 结尾 hip-hop）
5. **质感词很有用**：warm / crisp / airy / dark / bright / soft

### 3.2 标签体系（来自速查表，共 117 个）

| 类别 | 数量 | 用法 |
|---|---|---|
| 乐器组合 | 38 | `piano and strings`、`acoustic guitar and harmonica`、`synthesizer and drums`… |
| 音色质感 | 7 | dark / bright / warm / soft / rock / varies / vocal |
| 音乐流派 + BPM 区间 | 25 | 每流派带推荐 BPM 区间（如 hip hop 80–100、house 110–130、hard rock 130–160） |
| 情感标签 | 8 | sad / melancholic / romantic / uplifting / happy / intense / angry… |
| 调性色彩 | 27 | major=明亮开阔、minor=内敛忧伤；吉他友好 Em/G/Am/D，铜管友好 B♭/E♭/F |
| 综合风格体系 | 12 | 中文创作层的完整配方：BPM + 调式 + 拍号 + 编曲技术特征，可直接当生成参数 |

**组合公式**：`流派 → 乐器组合 → 音色 → 情感 → BPM`
例：`jazz, piano and double bass, warm, melancholic, 96 BPM`

速成配方：
- 慢速抒情：blues / soul · 80–110 BPM + `piano and strings` + sad/melancholic
- 中速叙事：folk / country · 80–120 BPM + `acoustic guitar and harmonica` + warm/soft
- 高速驱动：hard rock / pop punk · 130–160 BPM + `electric guitar and drums` + intense
- 电子律动：house / deephouse · 110–130 BPM + `synthesizer and drums` + uplifting

---

## 4. Lyrics 写法规范

**纯器乐（BGM 默认）**：整个 `lyrics_prompt` 填 `[Instrumental]`
或用结构标记描述器乐展开：

```
[Intro - ambient]
[Main Theme - piano]
[Climax - powerful]
[Outro - fade out]
```

**有人声/歌曲时**：
- 结构标记要**克制**：`[Chorus - anthemic]` 可以，但不要堆叠成 `[Chorus - anthemic - stacked - high energy - powerful - epic]`——模型可能把标记当歌词唱出来
- **每行 6–10 音节**，同一位置的行保持 ±1–2 音节（模型按拍对齐音节）
- 大写 = 更强力度（`THIS IS OUR MOMENT!`）；括号 = 背景和声（`We rise together (together)`）
- **段落之间空行分隔**，模型才分得清边界
- 一致性检查：Caption 乐器 ↔ Lyrics 器乐段标记、Caption 情绪 ↔ Lyrics 能量标记、Caption 人声 ↔ Lyrics 人声标记

---

## 5. 元数据边界（别指望精确执行）

> 官方原话：**模型是「参考」而非「执行」**。设 `bpm=120`，结果是 118 或 122 这样的分布采样——像告诉乐手「大概 120」，他会自然演奏而非死跟节拍器。

| 参数 | 稳定区间 | 风险 |
|---|---|---|
| bpm | 60–180 | 30 或 280 这类极端值训练数据少，不稳定 |
| keyscale | C / G / D / Am / Em | 冷门调可能被忽略或偏移 |
| timesignature | `4` 最可靠，`3`/`6` 通常 OK | `5`/`7` 属高级玩法 |
| duration | 30–60s 与 2–4min 最稳 | 超长（>4min）可能重复或结构问题；实测 5min 时长准确但结构需验收 |
| 随机性 | — | 同参数不同 seed 结果不同；**后端未暴露 seed ⇒ 无法复现、只能重跑抽卡** |

⚠️ **对「按拍拆镜」的影响**：由于 bpm 只是锚点、且后端不回显实际 bpm，`music-video-subtitle-generator` 要求的「切点对齐 1/4–1/8 拍格」在自动化流程里**无法精确计算**——只能靠 agent 听感估算，或退化为「按镜头时长均分 + 大致踩点」。这是 CV-126 方案的一个已知折损，需在验收时确认可接受。

---

## 6. 长音频策略

| 目标 | 做法 | 依据 |
|---|---|---|
| ≤ 5 分钟 | **单次生成，`duration` = 目标成片时长** | 实测精确生效 |
| > 5 分钟 | 暂不直接支持 | 需后台确认上限；理论退路是 repaint 续写（**后端未暴露**） |
| 音乐短于成片 | **不拉伸**，循环仅兜底 | 官方 L76；我们是循环不是变速拉伸 |
| 抽卡选优 | 重跑（无 seed 不可复现） | 单次成本：30s≈9s、60s≈17s、5min≈82s |

---

## 7. 代码侧待改项（本次实测暴露）

> **CV-127（2026-09-10）：1–4 项已全部落地**（`generate.ts` / `host-tools.ts`），
> 单测覆盖在 `tests/music-generation.test.mjs`。下表保留作变更依据。
>
> **CV-127b 追加（同日）**：实测发现后端 `txt2audio` 存在**偶发 500**（同参数一次
> 200 一次 500，快失败 ~0.07s / 慢失败 ~8.6s 两形态，均不给原因）→ 再补第 5 项。
> **CV-130 追加（同日晚）**：`music_generation` 漏登记在画布工具白名单里，导致
> 产物落盘后画布不刷新 → 补第 6 项（详见 §12.1）。

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| 5 | 后端偶发 500 一律不给原因，「教 agent 写对参数」救不了 | `generate.ts` `generateMusic` | 工程兜底：`planMusicRetry` 重试 + 降级 + `degradedFields` 诚实回显（✅ CV-127b） |
| 6 | `music_generation` 不在 `STUDIO_TOOL_KINDS`，工具结算不触发 `reloadCanvas` | `asset-capture.ts:26` | 白名单补 `music_generation: 'audio'`（✅ CV-130） |

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| 1 | 纯器乐时 `lyrics_prompt` 传空串，语义不明 | `generate.ts:1605` `params.lyricsPrompt ?? ''` | 默认改为 `[Instrumental]` |
| 2 | 响应 `duration` 是耗时，若将来消费会误判 | `generate.ts` `callDrama` 解构 | 注释标明；勿用作音频时长 |
| 3 | 工具结果未回显时长/bpm，分镜按拍拆缺依据 | `host-tools.ts` music_generation | 结果增加 `duration`（请求值）与 `bpm` 回显 |
| 4 | 工具描述未引导 caption 写法 | `host-tools.ts` description | 加「写法见 skill music-prompt-writing」指针 + 纯器乐要点 |

---

## 8. 集成方案（三层）

### 8.1 新建 skill `music-prompt-writing`（与 `h3-prompt-writing` 对称）

```
skills-local/music-prompt-writing/
├── SKILL.md                          # 薄主文 ~3KB：何时用、五步写法、纪律、参数表
└── references/
    ├── tag-dictionary.md             # 117 标签字典（乐器38/流派25+BPM/调性27/情感8/风格12）
    └── caption-lyrics-rules.md       # 写法规则、示例、冲突处理、一致性检查清单
```

用渐进披露（需要时才读分册），避免撑大上下文。走既有 `skills-local → sync-minimax-skills → skills/` 同步链路，并补 catalog 条目（CV-117 双向断言会校验）。

### 8.2 `music_generation` 工具增强

- description 增加：「caption 写法见 `music-prompt-writing` 技能；纯器乐 `lyrics` 留空会自动填 `[Instrumental]`」
- 结果 schema 增加 `duration` / `bpm` 回显

### 8.3 总纲接入（CV-126 音乐先行）

- 第 2c 步「主音频锁定」引用该 skill：`music_generation(duration = 成片总时长)`
- 第 3 步分镜按拍拆（注意 §5 的折损：bpm 不精确，踩点为估算）
- 第 10 步：`bgmNodeId` 传主音频节点，不拉伸

---

## 9. 向后台争取的能力（按优先级）

1. **`seed`** —— 可复现 + 抽卡对比的刚需，改动极小
2. **`task_type` + `src_audio` / `repaint`** —— 解锁长音频续写（>5min）与变奏生成
3. **`reference_audio`** —— 跨片/跨项目音乐风格统一
4. **回显实际 bpm 与真实音频时长** —— 「按拍拆镜」精确化的前提

---

## 10. 落地计划（待拍板）

| 阶段 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| A | 建 `music-prompt-writing` skill（主文 + 2 分册）+ catalog + 同步 + 测试 | 无 | ✅ 已完成（CV-127，6df50890f5） |
| B | `music_generation` 工具增强（lyrics 默认 `[Instrumental]`、结果回显 duration/bpm、描述加指针） | 无 | ✅ 已完成（CV-127） |
| **B+** | **后端偶发 500 自愈**（重试 + 参数降级 + `degradedFields` 诚实回显） | 无 | ✅ 已完成（CV-127b，7cff5eed2c） |
| **C1** | **画布音频节点**：`kind='audio'` 独立成类 + 就地播放 + 图层/详情/下载/小地图 | 无 | ✅ 已完成（CV-128，afe2db04b0） |
| **C2** | **H3 官方音频通道传输层**（audio reference / audio reuse / 原生音轨） | ~~后端开放入参才算真通~~ | ✅ 代码已落地（CV-129，222c89a028）+ **后端已开放**（2026-09-10：`audio1`–`audio3` 字段名与我们一致）→ **可端到端验收**；`generate_audio` 仍未见于后端文档 |
| **F** | **画布音频体验**：歌词上画布 + 可拖进度条 + 双击播放器窗口 + 生成后即时刷新 | 无 | ✅ 已完成（CV-130） |
| C3 | 桌面 E2E：生成 30s BGM → 成片混音 | 端点已上线，可立即做 | ⏳ 待验收 |
| D | 总纲第 2c 步 + 按拍拆镜（CV-126 P0） | 需先拍板 CV-126 方案 | ⏸ **已降级**（2026-09-10 用户拍板：后台无时间支持，暂不推音乐先行；改走 [音轨与视频合并路线](./av-timeline-plan.md)） |
| E | 后台能力争取（seed / repaint / reference） | 外部 | ⏳ 待推进 |
| **T** | **音视频统一时间轴 + BGM 时长对齐**（新主线，取代 D 的位置） | 无（不需要后端新能力） | 🚩 **待启动**，见 [av-timeline-plan.md](./av-timeline-plan.md)；P0（真实时长探测）与 P1（H3 守时实测）可立即做 |

---

## 11. 画布音频体验（CV-128 / CV-130）

音频不再只是「一条能混音的 mp3」，而是画布上的一等节点：

| 能力 | 实现 | 说明 |
|---|---|---|
| 独立节点类 | `kind='audio'`（260×116） | 与 `kind='video'` 分开，`collectClips` 天然排除，mp3 不会被当一镜 |
| 就地播放 | 卡片上的 ▶/⏸ + 波形条 + 进度条 | 全局单实例（`activeAudioEl`），不 hover 自动播放（避免声音突响） |
| **拖动进度条** | 卡片进度条 pointer capture seek | 与播放器同款手势语义（拖出条外仍跟踪） |
| **双击播放器窗口** | `AudioPlayerModal`（仿 `VideoPlayerModal`） | 自绘控制条：播放/暂停 + 可拖进度 + 当前/总时长 + 音量/静音 + 歌词面板 |
| **歌词上画布** | 节点 `lyrics` 字段 | 卡片显示歌词首行；详情面板与播放器窗口显示全文；`[Instrumental]` 渲染为「纯器乐」 |
| 图层 / 详情 / 下载 / 小地图 | ♪ 缩略图、`<audio controls>` 试听、可下载 .mp3 | — |
| **生成后即时刷新** | `STUDIO_TOOL_KINDS` 补 `music_generation` | 见 §12 第一项，属**漏步**修复 |

### 11.1 歌词的链路（skill → 参数 → 节点 → 画布）

```
music-prompt-writing skill（有歌词时按结构写）
      ↓ lyrics 参数
music_generation（lyrics 留空 → 自动 [Instrumental]）
      ↓ generateMusic 把「生效歌词」写进节点 lyrics
画布音频节点（卡片首行 / 详情全文 / 播放器歌词面板）
```

⚠️ 写的是**生效歌词**（降级后与请求一致，因为 lyrics 不在可降级字段里），不是原始参数拼串。

---

## 12. 已知问题与后续优化方向

### 12.1 已修（CV-130）

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| 1 | **生成音频后画布不刷新**（老毛病复现） | `src/asset-capture.ts` 的 `STUDIO_TOOL_KINDS` 是「工具 → 是否建 start / 触发 reloadCanvas」的**唯一白名单**，`music_generation` 从未登记 → `tool/call` 不建 start → `tool/result` 的 update 找不到挂载点 → `reloadCanvas` 永不触发 | 白名单补 `music_generation: 'audio'`；`NODE_SIZE_PENDING` 补 audio 尺寸 |
| 2 | 音频进度条只能看不能拖 | 卡片进度条是纯展示 div | 加 pointer capture seek |
| 3 | 双击音频只开详情面板 | `handleDoubleClick` 只分派 video/image | audio 双击 → `AudioPlayerModal` |
| 4 | 歌词无处可看 | 歌词只在请求体里，落盘即丢 | 节点 `lyrics` 字段 + 三处渲染 |

### 12.2 后续可优化方向（按优先级）

**P1 — 直接影响成片质量 / 用户信任**

1. **节拍落点（beat grid）落地**：后端不回显真实 bpm，但我们可以**本地分析 mp3 估拍**（FFmpeg 已在链路里）→ 生成 `beats.json` 落盘到音频节点，让「按拍拆镜」从估算变成实算。这是 CV-126「音乐先行」最大的一处折损。
2. **歌词时间轴（LRC）**：现在歌词只有文本没有时间。若能从音频对齐出人声段落的粗略时间，就能做「歌词跟唱高亮」+ 自动生成字幕轨（与 `music-video-subtitle-generator` skill 直接对接）。
3. **音频节点进时间线**：`CanvasTimeline` 目前只画视频片段；音频应作为一条独立轨道（对齐成片总时长、可看波形包络），一眼看出「音乐比成片长/短」。
4. **多版 BGM 抽卡对比**：无 seed ⇒ 抽卡只能重跑。可以让 agent 一次生成 2–3 版并在画布上并列 + 一键试听对比，选定后其余自动 `retired`（复用 CV-108 版本链语义）。
5. **音频进引用句柄表（`@aud-01`）**：`buildAssetHandles` 目前只认 `image` / `video`，音频节点**不在** `@` 候选里；右键「引用到对话」会降级为纯文本 `@ref[标题]`（仍能解析到节点，但没有真 chip、没有 hover 卡片）。补 `aud` 前缀 + `AssetHandle.kind` 联合 + `AssetChipPreview` 的 audio 分支即可（约 4 处，含单测）。

**P2 — 一致性与自动化**

5. **音乐风格锁定卡**：与角色资产卡（C1）同构——把 Caption 冻结成「音乐风格卡」，跨镜/跨片复用时逐字节复用 Caption（这是当前唯一可行的「风格统一」手段，因为后端没有 reference_audio）。
6. **BGM 时长守卫**：`compose_video` 前校验 `duration(BGM) ≥ duration(成片)`，不足时**明确提示**（现在靠 skill 纪律约束，没有工程兜底）。
7. **原生音轨（B 通道）真正打通**：等后端开放 `generate_audio`；打开后要新增「各镜独立音轨 vs 全片一条主轨」的冲突检查（官方要求互斥）。**注意**：产物自带 32kHz 立体声音轨是**后端默认行为**（实测），`compose` 已把它与 BGM `amix` —— 也就是说当前成片里一直混着 H3 环境声，这是个尚未被主动决策的现状。
8. **audio reference 的 15s 窗口自动预切**：对「整片主音频 60s+」自动按镜切出 ≤15s 窗口（音乐先行方案里已写明桥接思路），做成工具而不是靠 agent 手切。

**P3 — 体验与成本**

9. **音频波形缩略图**：现在波形条是 id 派生的**假波形**；可换真实峰值（ffmpeg `astats`/`showwavespic`）生成缩略图，让卡片一眼区分不同曲子。
10. **音量包络 / ducking**：对白段落自动压低 BGM（sidechain），比现在的固定淡入淡出更专业。
11. **音频抽屉**：把所有音频节点收进一个抽屉统一管理（试听、重命名、设为主 BGM、下载），画布上只留标记。
12. **一键续写 / 循环拼接**：音乐短于成片时，现在是循环兜底（硬接缝）。可以做「智能接缝」——在检测到的节拍点循环，消除爆音。
13. **音频生成进度回显**：5min 音频耗时 82s，现在只有占位节点计时；可显示「预计剩余时间」（由 0.27–0.35× 系数估算）。
