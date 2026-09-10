# 长视频（>15s）与音乐生成：h3 侧资料调研

> 调研日期：2026-09-09　状态：**仅调研，未动工**
> 触发：后台提供 `POST /api/v1/generate/txt2audio`（ACE Step）后，讨论长视频如何善用该接口
> 相关：CV-125（music_generation 转正）、C3（尾帧链）、C5（合成调色+BGM 淡入淡出）

## 0. 结论摘要（先看这里）

**官方规范是"音乐先行"，而我们是"视频先行、最后贴 BGM"——方向是反的。**

| 维度 | 官方 h3 资料的做法 | 项目现状 | 差距 |
|---|---|---|---|
| 顺序 | 先锁一条 Master Audio，再按音乐拆镜 | 先出视频，最后 `compose_video` 贴 BGM | **流程倒置** |
| 镜头时长 | 30s 拆 4–8 个 **2–5s** 短镜（不是顶格 10s） | 逐镜 7–10s（贴近上限） | 节奏粒度粗 |
| 音乐短于成片 | **不拉伸**，用完整音频（除非用户明确要求） | `amix` 静音留白，无循环兜底 | 需决策 |
| 跨镜音乐连续 | 整片绑一条主音频，各镜不用独立音轨 | 各镜无音轨（`generateAudio` 未接入），全靠后期一条 BGM | 现状反而是安全的 |
| 切点 | 落在 1/4 或 1/8 拍格、歌词停顿/呼吸/军鼓/drop | 无节拍概念 | 缺 |
| 转场 | **严格硬切，不要淡入淡出** | concat `-c copy` 硬切（一致 ✓），但 C5 给 BGM 做了淡入淡出 | 基本一致 |
| 配乐提示词 | 结构化三段式（元数据/人声/编曲） | 一句英文 tags | 质量差距大 |

## 1. 项目内已有资料（无需外求）

### 1.1 `skills/music-video-subtitle-generator/SKILL.md` —— 最重磅，自带完整长视频音乐方案

这是**已接入**的风格 skill，但它的音乐工作流目前没有被总纲引用执行。

| 位置 | 原文要点 | 译 |
|---|---|---|
| L63 | "First generate or lock one continuous song / BGM, split 30 seconds into 4–8 dynamic **2–5 second** shots, then stitch via beat sync and head/tail frame continuity" | 先生成/锁定一条连续 BGM，30s 拆 4–8 个 2–5 秒短镜，按节拍同步 + 首尾帧连续拼接 |
| L76 | "If music is shorter than the target duration, **use the full audio unless the user explicitly asks to stretch or extend it**" | 音乐短于目标时长就用完整音频，**不要拉伸** |
| L93–96 | STEP: ① Lock complete Master Audio ② Build a Shotlist Timeline（映射到歌词时间戳与节拍）③ 生成 ④ 编辑时把所有 clip 对齐全局时间轴 | 主音频 → 镜头时间轴 → 逐镜生成 → 按时间戳对齐 |
| L164–166 | "The entire MV must bind to one Master Audio track. During segmented video generation, **do not use independent disconnected clip audio**" | 整片绑一条主音频，分段生成不要各自独立音轨 |
| L174 | "Cut points must hit the **1/4 or 1/8 beat grid**"；"Cut points must land on lyric pauses, breaths, snare, or drop" | 切点对齐拍格 / 歌词停顿、呼吸、军鼓、drop |
| L186 | "For long-shot continuation, use the previous tail frame as the next head frame"；硬切场景切换用同向运动 / 遮挡 match cut | 与我们的 `chain` 尾帧链一致 ✓ |
| L189 | Checklist："Is one global Master Audio locked, and are cut points beat-aligned?" | 交付前自检项 |
| L191 | "Is the edit style **strictly hard-cut, with no fades or soft transitions**?" | 严格硬切，无溶解/软转场 |

**关键含义**：官方对"音乐不够长"的答案不是把音乐拉长，而是**以音乐长度为准倒推成片**（或换一段足够长的音乐）。这直接推翻了"循环兜底"作为首选方案的位置——它只能是兜底，不能是默认。

### 1.2 `skills/h3-prompt-writing/references/` —— H3 官方音频字段

**`base-en.txt`（T2VA/FL2VA 格式）**
- `4.6 overall_soundscape`（L154）：1–4 句，环境音与物理音；台词/歌声/剧情内音乐**不写这里**
- `4.7 non_diegetic_music`（L160–163）：1–3 句，**只写乐器/速度/节奏/力度变化，禁止抽象情绪词与"配乐作用"说明**；无人声配乐时写 `N/A`

→ 注意这是 **H3 模型原生生成音轨**时的描述规范。我们的 Drama 后端 `generateAudio` 未接入（host-tools.ts:876 标注占坑），所以目前这段写了也不出声，但**文本仍然会进入 prompt 影响画面节奏**，值得保留。

**`format-ref2va.md`（Ref2VA 格式）** —— 支持音频作参考输入

| 位置 | 内容 |
|---|---|
| L70–79 | `<Audio N>` = 独立音频素材或参考视频中被启用的同步音轨；用途含"引用背景音乐风格、引用节拍/节奏/音频连续性" |
| L110 | 任务类型 `audio reuse` = 同一音频信号被全部或部分复用 |
| L111 | 任务类型 `audio reference` = 不复制音频信号，**只引用其音乐风格、音色、台词或歌词内容、音效质感、节拍或连续性** |
| L118–119 | 组合示例 `[video editing + audio reuse]`、`[video editing + audio reference + audio reuse]` |
| L87 | 硬规则：参考视频**不会因为文件里有声音就自动产生 `<Audio N>`**，必须显式声明 |

→ **这是跨镜音乐连续性的官方解法**：把主音频作为 `<Audio 1>` 传给每一镜，标 `audio reference`，模型会让各镜音轨跟随同一节拍与音乐风格。前提是后端支持上传音频作参考（**待确认**，见第 4 节）。

### 1.3 上游仓库 `minimax-h3-prompt-skill-T8`

**`skills/direct-seedance-music-typography/`**（MV skill 的 T8 官方 companion）
- Workflow 2："If the work exceeds 15 seconds, **split it into independently generated clips while preserving one master audio timeline for later assembly**" —— 与 1.1 交叉印证
- "Bind a supplied track as `音频1` and state that it provides music/voice timing. **Do not declare audio that will not be supplied at generation time**"
- "Use `镜头N` in event order, not exact per-shot timestamps. Beat words such as 'on the snare' or 'after the bass hit' are allowed" —— **用事件顺序 + 节拍词，不要写精确时间戳**（与我们 CV-119 预检器的时间戳规则不冲突，因为那是画面时间轴）
- Workflow 6：跨镜保持 identity / palette / grain / light / motion direction / **audio continuity**

**`apps/prompt-library-desktop/music3-official/`**（MiniMax Music 3 提示词库）
- `music-caption-rewriter` skill：把一句话音乐描述 + 可选歌词 → **结构化 Caption**（三段）
  1. **Global Metadata**：bpm / key+scale / 曲风 / 全局情绪进程 / 应用场景与意象 / 声音与制作特征
  2. **Vocal Details**：性别音色 / 唱法与情绪推进 / 和声 / 人声 FX
  3. **Arrangement**：主次乐器生命周期（何时进何时退）/ 律动与低音进程 / 装饰、织体与空间效果
- `references/genre-router.md`：**18 个曲风家族**路由表（east-asian-modern / cinematic-orchestral-epic / club-edm-house-trance / contemporary-folk-acoustic …），渐进披露：路由到家族 → 读索引卡片 → 只读选中的完整模板
- `templates/`：**1000 个**官方完整模板

→ 这是写 `txt2audio` 的 `caption_prompt` 的现成规范。**注意格式差异**：Music 3 是段落式长描述，ACE Step 官方更偏逗号分隔 tags；结构要素（情绪进程 / 乐器生命周期 / 编曲层次）通用，但需要一层转写。

## 2. 可直接借用的三件事

1. **镜头时长策略**：长视频按 2–5s 拆镜（不是顶格 10s），镜数变多但节奏更贴合音乐——对 MV/广告类尤其明显。
2. **结构化音乐提示词**：`music_generation` 的 `prompt` 不应是一句 tags，至少拆成"元数据（曲风/bpm/调式）+ 情绪进程 + 乐器编配"三段。可先在工具 description 里给模板，重活（genre 路由 + 1000 模板）暂不引入。
3. **切点对齐节拍**：有了 BPM 就能算出拍格（60/bpm 秒），分镜表的"时长"列可以按拍取整（如 bpm=120 → 一拍 0.5s，镜头取 4s = 8 拍）。这是**低成本高收益**的一条，只需要把 bpm 从 music_generation 结果透出给分镜规划。

## 3. 与现状冲突、需要你拍板的点

1. **音乐短于成片怎么办**（与上轮讨论的方案 B 冲突）
   - 官方：不拉伸，用完整音频（L76）
   - 我上轮建议：`aloop` 循环兜底
   - 折中：**主路径按官方**——以音乐长度参与成片时长决策（生成 BGM 时传 `duration = 目标成片时长`）；循环只作"两者都已确定且不匹配"时的兜底，且给用户提示
2. **要不要把"音乐先行"写进总纲**：现在总纲是第 10 步才碰 BGM。改成"有配乐需求时先锁 Master Audio（第 2 步之后、分镜之前），分镜按音乐拆"——这是流程级改动，影响所有带音乐的片子。
3. **H3 原生音频 vs 外部 BGM 二选一**：若后端将来接入 `generateAudio`，每镜自带音轨会与外部 BGM 打架（双重音乐）。需定策略：有 Master Audio 时 `non_diegetic_music` 写 `N/A` 或描述主音频风格，成片只用一条主轨。

## 4. 待外部确认（阻塞项）

- [ ] `txt2audio` 单次 `duration` **上限**（决定"一次生成全长"是否可行）
- [ ] `txt2audio` 何时部署（当前 404）
- [ ] `video_composite` / `video_generate` 的 `filenames` **能否接受 mp3**（决定 `<Audio N>` + `audio reference` 能否落地）
- [ ] Drama 后端是否计划接入 `generateAudio`（决定第 3 节的二选一策略何时生效）

## 5. H3 音频参考规格（2026-09-10 联网核实）

来源：MiniMax 官方开源公告（minimax.io/news/minimax-h3-open-source）、Runway 模型页
（runway.com/product/models/minimax-h3）、WaveSpeed API 文档、ComfyUI ALLinONE-MinimaxH3
的 `H3AudioTrim` 节点说明。**四条硬规格**（官方原文口径，多源一致）：

| 项 | 规格 |
|---|---|
| 段数 | ≤ **3 段**参考音频 |
| 格式 / 体积 | WAV 或 MP3，单段 ≤ **15 MB** |
| 时长 | 每段 **2–15s**，且**所有音频合计 ≤ 15s** |
| 组合 | **音频不能是唯一参考**，必须至少配一张图或一段视频 |

**截断行为（这是长视频方案的关键约束）**：
- **从头截**（取前 N 秒），不是任意偏移。
- 触发条件有两个：① 音频 > 15s → 裁到 15s（硬规格）；② 音频 ≤15s 但长于目标视频 →
  裁到**目标视频时长**（ComfyUI `H3AudioTrim` 的 `trim_seconds = 目标时长`）。
- **音频短于目标视频 → 原样保留，不拉伸、不补静音**（"shorter passes through untouched；
  it's a cap, not a resampler"）。
- 集成平台（Runway / WaveSpeed）会在 UI 层**先帮你裁到 15s**；官方 API 本身是**硬校验**
  （超限直接拒，不静默裁）。我们的 Drama 后端是自建 API，行为待确认。

**补充约束**：参考**视频自带的音轨也计入音频 15s 总预算**（实测「视频 12s + 音乐 25s」直接报错）。

**对 CV-126 的直接含义**：整片主音频（常 60s+）**不可能**作为参考直接传给单镜（超 15s）。
可行桥接 = 按镜预先把主音频切成「以该镜起点开头的 ≤15s 窗口」（因为 H3 只从头截），
每镜各传自己的片段。在 C/D 打通前，**后期一条主轨（A 路径）仍是唯一能出声且保证跨镜连续的方案**。
