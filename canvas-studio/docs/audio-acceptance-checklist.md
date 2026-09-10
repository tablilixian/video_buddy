# 音频链路验收清单（Skill → 画布 → 与视频协作）

> 日期 2026-09-10 ｜ 代码水位 `4463d17bca`（已 push `origin/dev`）｜ 冒烟 **390/390 绿**
> 关联：[audio-generation-plan.md](./audio-generation-plan.md)（规划 + 已知问题 §12）、STATUS.md CV-125~130
> 用途：**按层逐块验收的执行剧本**。每节末尾是「怎么验」，附预期结果与失败判据。

---

## 0. 一句话结论

| 层 | 完成度 | 能不能验收 |
|---|---|---|
| **Skill 层**（`music-prompt-writing`） | 功能完整 | ✅ 现在就能验 |
| **画布展示层**（`kind='audio'` 节点） | 功能完整 | ✅ 现在就能验 |
| **与视频协作层 A 通道**（后期混音 `bgmNodeId`） | 功能完整、真可用 | ✅ 现在就能验 |
| **与视频协作层 B/C 通道**（原生音轨 / audio reference） | **代码全通、后端未开放** | ⚠️ 只能验「失败得对不对」 |
| 音乐先行工作流（CV-126 总纲第 2c 步） | **未开工**（等拍板） | ❌ 无 |

---

## 1. 三层总览

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| S1 | skill 主文（六节 + 分册索引） | ✅ | `skills-local/music-prompt-writing/SKILL.md` 7.1KB |
| S2 | 分册：117 标签字典 | ✅ | `references/tag-dictionary.md` 11.6KB |
| S3 | 分册：Caption/Lyrics 规则 | ✅ | `references/caption-lyrics-rules.md` 10.3KB |
| S4 | skill 注册（prompting / hidden）+ 同步产物 | ✅ | `src/skill-catalog.ts:124` |
| S5 | 「歌词要交出去」流程节 | ✅ | SKILL.md §三 |
| S6 | **音乐先行（总纲第 2c 步 + `audio-first.md` 分册）** | ❌ **未开工** | 总纲 SKILL.md 无「主音频」字样；references/ 无 audio-first.md |
| V1 | 音频独立节点类 `kind='audio'` 260×116 | ✅ | `src/contracts/canvas.ts:32` |
| V2 | 卡片：♪ + 标题 + 时长 + 波形 + ▶/⏸ + 可拖进度 + **歌词摘要行** | ✅ | `src/client/canvas/CanvasNode.tsx` |
| V3 | 双击 → `AudioPlayerModal`（控制条 + 歌词面板） | ✅ | `src/client/canvas/AudioPlayerModal.tsx` 11.5KB |
| V4 | 详情面板试听 + 歌词全文；图层 ♪；小地图配色；可下载 mp3 | ✅ | `LayerDetailPanel.tsx` / `LayerPanel.tsx` / `Minimap.tsx` |
| V5 | **生成后即时刷新**（白名单补 `music_generation`） | ✅ | `src/asset-capture.ts` |
| V6 | 历史节点迁移（`kind=video`+`text-to-audio` → `audio`，84→116 高） | ✅ | `src/projects.ts` `migrateAudioNode` |
| V7 | 音频不会被当一镜拼进成片 | ✅ | `compose.collectClips` 只收 `kind='video'` |
| V8 | **音频进 `@` 引用候选**（`aud-01` + 真 chip + hover 卡） | ❌ **未做** | `reference-handle.ts:56` 只认 image/video |
| V9 | **音频进时间线轨道** | ❌ **未做** | `CanvasTimeline.tsx:40` 只数 `kind==='video'` |
| V10 | 真波形缩略图（现为 id 派生假波形） | ❌ 未做（P3） | — |
| A1 | **A 通道：后期混音** `compose_video(bgmNodeId)` → ffmpeg `amix` + 1s 淡入淡出，音量 0.8 | ✅ 真可用 | `src/compose.ts:155-200` |
| A2 | BGM 放行音频扩展名（mp3/wav/m4a…） | ✅ | `compose.ts` `isVideoFile` |
| B1 | **B 通道：原生音轨** `generateAudio` → `generate_audio`（默认不发送） | ⚠️ 代码已通 | `src/providers/drama.ts:34` |
| C1 | **C 通道：audio reference** 契约 + 校验 + 双 provider + 工具参数 | ⚠️ 代码已通 | `src/audio-reference.ts` / `capability.ts:46` / `drama.ts` `audio1..audio3` / `fal.ts` `reference_audio_urls` |
| C2 | 官方规格硬校验（≤3 段 / 2–15s / 合计 ≤15s / WAV·MP3 / 不能作唯一输入） | ✅ 生成前预检 | `src/generate.ts:1167` |
| C3 | **后端音频入参字段名确认** | ❌ 未确认 | 我们拍的是 `audio1..audio3` + `generate_audio` |
| X1 | **BGM 时长守卫**（BGM ≥ 成片） | ❌ 未做（P2） | `compose_video` 不校验 |
| X2 | **合成 UI 入口** | ❌ **没有** | `composeStudioVideo()` 已定义但**无任何调用点**，合成只能对话触发 |
| X3 | 节拍落点实算（`beats.json`） | ❌ 未做（P1） | 「按拍拆镜」只能估算 |
| X4 | 歌词时间轴 LRC | ❌ 未做（P1） | 歌词只有文本无时间 |
| X5 | 多版 BGM 抽卡并列对比 | ❌ 未做（P1） | — |
| X6 | 对白 ducking / 循环接缝落拍点 / 生成剩余时间 | ❌ 未做（P3） | — |

---

## 2. Skill 层验收

### 已做

- **主文 7.1KB**，六节：先定两件事（时长 / 人声）→ Caption 五步 + 硬规则 → Lyrics 规则 →
  **歌词要「交出去」** → 参数取值边界（含「软提示铁律」）→ 抽卡与迭代 → 分册索引。
- **两条核心纪律**：① `duration` 必须等于成片总时长（实测精确生效）；
  ② `keyscale`/`timesignature`/`bpm` 是软提示，**看到 `degradedFields` 非空就不许声称「已按该调性生成」**。
- **歌词流程（CV-130 新增）**：有词必须通过 `lyrics` 参数交出去 → 会原样存进节点、显示在画布；
  改词**必须重新调工具**；纯器乐走默认路径显示「纯器乐 · 无歌词」。
- **注册方式**：`hidden: true`（不在技能广场展示，但**可被项目激活、在「我的 Skill」里管理、
  通过 name 使用**），靠 description 描述匹配自动加载。

### 未做

1. **音乐先行（CV-126）整体未开工** —— 总纲没有「第 2c 步：主音频锁定」，
   `references/audio-first.md` 分册也不存在。方案已写（`music-first-workflow-plan.md`）**等你拍板**。
   这是当前音频方向**最大的一块缺口**：现在仍是「视频先行、最后贴 BGM」，与官方规范相反。
2. skill 里没有节拍信息可写（因为后端不回真实 bpm），「按拍拆镜」章节只能靠估算。

### 怎么验

1. App 里对 agent 说：**「给这条片子配一段 30 秒的 BGM，要悬疑感」**。
2. 看 agent 调 `music_generation` **之前**是否加载了 `music-prompt-writing`（对话里应能看到 skill 被使用/提及）。
3. 看它传的参数是否符合 skill：`duration` = 成片时长、`lyrics` 留空、`language="unknown"`、Caption 里**没有**写 BPM。
4. 再验一次「有人声」路径：**「写一首 30 秒的中文歌，主题是深夜走廊」** →
   看 `lyrics` 是否带了 `[Verse]`/`[Chorus]` 结构标记、`language` 是否 `zh`。

**失败判据**：Caption 里出现 `128 bpm`（应走 `bpm` 参数）；没加载 skill 就开始瞎写 `"好听的音乐"`。

---

## 3. 画布展示层验收

### 已做

- 音频是**一等节点**（`kind='audio'`，260×116）：不会再被 `collectClips` 当一镜拼进成片。
- **卡片**：♪ 图标 + 标题 + 时长 + 波形条 + ▶/⏸ + **可拖进度条**（命中区 14px，
  拖出条外仍跟踪）+ **歌词摘要行**（首行非结构标记；`[Instrumental]` → 「纯器乐 · 无歌词」，
  有词/无词都占位 → 卡片高度不跳）。
- **双击 → 播放器窗口**：自绘控制条（播放/暂停 + 可拖进度 + 当前/总时长 + 音量/静音 + Esc 关闭），
  舞台区让给**歌词**（逐行铺开可滚动，结构标记弱化；纯器乐走波形动画）。
- **详情面板**：`<audio controls>` 试听 + 歌词全文（限高滚动）。图层列表 ♪ 缩略图。小地图配色。
  可下载 `.mp3`。全局单实例播放（切换节点自动暂停上一个），卸载清理。
- **生成后即时刷新**：白名单补 `music_generation`，`tool/result` 触发 `reloadCanvas`——
  不再需要切窗口才看见。
- **向后兼容**：老项目里 260×84 的音频节点在加载时自动迁移成 `audio` 且抬到 116 高。

### 未做

1. **音频不在 `@` 引用候选里** —— `buildAssetHandles` 只认 image/video，所以对话输入框打 `@`
   **看不到音频**；右键「引用到对话」会降级成纯文本 `@ref[标题]`（**仍能解析到节点**，
   只是没有真 chip、没有 hover 缩略图卡）。
2. **音频没进时间线** —— `CanvasTimeline` 只画视频片段，看不出「音乐比成片长/短几秒」。
3. 波形条是 id 派生的**假波形**（不同曲子看着差不多）。
4. 没有音频抽屉（音频节点多了只能在画布上分别找）。

### 怎么验

1. 让 agent 生成一段 BGM → **音频节点应当立刻出现在画布上**（这是 CV-130 修的重点）。
2. 卡片上点 ▶ 听声音 → 拖进度条 → 位置跟着走、松手继续播（不是跳回去）。
3. **双击卡片** → 播放器窗口弹出 → 拖进度、调音量、按 Esc 关闭。
4. 右侧详情面板试听；图层列表看 ♪；小地图看音频配色；右键下载 `.mp3`。
5. 生成一首**带歌词**的歌 → 卡片摘要行显示歌词首行；播放器窗口显示全文。
6. 打开一个 **CV-128 之前建的**老项目 → 原 BGM 节点应变成音频卡片且高度正常（迁移生效）。

**失败判据**：生成完要切窗口/重开项目才看到节点（=刷新链又断了）；
卡片摘要在有词时仍显示「纯器乐 · 无歌词」（= lyrics 没写进节点）。

---

## 4. 与视频协作层验收

三条通道的现行状态：

| 通道 | 机制 | 现在能不能真用 |
|---|---|---|
| **A 后期混音** | `compose_video(bgmNodeId=音频节点id)` → `amix=duration=first` + 1s 淡入淡出，BGM 音量 0.8 | ✅ **能**，后端不需要改 |
| **B 原生音轨** | `generateAudio: true` → `generate_audio`（同一次推理出 32kHz 立体声） | ⚠️ 代码已透传，**默认不发送**；后端未开放 |
| **C audio reference** | `audioRefs` → `audio1..audio3`（≤3 段 / 单段 2–15s / **合计 ≤15s** / 不能作唯一输入） | ⚠️ 代码已通 + 生成前硬校验，**后端未开放** |

### 已做（A 通道，可验收）

- 混音链路完整：`bgmNodeId` → 探测 BGM 时长 → `volume` + `afade` 淡入淡出 →
  concat 产物有音轨时 `amix`、无音轨时 BGM 直接当音轨。
- 音频扩展名放行（mp3/wav/m4a/aac/ogg/flac）。
- **音频节点不会被当成视频片段**（`collectClips` 只收 `kind='video'`）。

### 代码已通但后端未开（B/C 通道）

- C 通道全链：契约 `audios` + `capabilityOf` 带音频**强制走 multi-reference**
  （压过首尾帧语义，避免「1 关键帧 + 1 音频」被误判成 FLF）→ drama `audio1..audio3`
  / fal `reference_audio_urls` → 工具 `audioRefs` → **生成前预检**（不合规直接报错，不浪费一次生成）。
- fal 侧单开 `toFalAudioDataUri`（**刻意不复用图片编码**——那条路含 ffmpeg 压 JPEG，套音频会出坏载荷）。
- ⚠️ **字段名 `audio1..audio3` + `generate_audio` 是我们拍的名字，后端未确认**。真实调用预期失败。

### 未做

1. **后端音频入参字段名待确认**（`audio1..audio3` / `generate_audio`）。
2. **合成没有 UI 入口** —— `composeStudioVideo()` 定义了但**无调用点**，合成只能通过对话让
   agent 调 `compose_video`。想手动选片段 + 选 BGM 点按钮导出，**目前做不到**。
3. **BGM 时长守卫缺失** —— BGM 短于成片时不会报错，`amix=duration=first` 让 BGM 播完即静音，
   全靠 skill 纪律（「duration 必须等于成片时长」）约束，没有工程兜底。
4. 原生音轨打通后需要补「各镜独立音轨 vs 全片一条主轨」的**互斥检查**（官方要求互斥）。
5. audio reference 的 **15s 窗口要 agent 手切**（整片主音频 60s+ 时没法自动预切）。
6. 对白 ducking（自动压低 BGM）、循环接缝落拍点、生成剩余时间预估 —— 全部未做。

### 怎么验

**A 通道（能真跑通）**
1. 生成一条 30s BGM（`duration=30`）+ 若干视频片段。
2. 对 agent 说：**「把时间轴上的片段合成成片，BGM 用刚才那条」**。
3. 看它调 `compose_video` 时 `bgmNodeId` 是否指向**音频节点**、`clipIds` 里**没有**音频节点。
4. 播成片 → 应有 BGM 且**首尾各 1 秒淡入淡出**（前 1s 音量渐起、末 1s 渐落）。

**B/C 通道（验「失败得对不对」）**
1. 对某镜传参考音频（`audioRefs`）→ 预期**生成前**就可能被我们的预检拦下（超 15s / 格式不对 / 没配图或视频）；
   预检放过时，后端应**明确报不出音频入参**，而不是笼统失败。
2. 显式请求原生音轨（`generateAudio: true`）→ 看请求体里是否有 `generate_audio`；
   后端不支持时错误信息应把**音频参数显式点出**（这是 CV-129 特意做的，避免笼统 500 被误读成参考图失效）。
3. 构造不合规输入应**在生成前就报错**：4 段音频 / 合计 16s / 一段 20s / 传 `.m4a` / 只给音频没给图或视频。

**失败判据**：不合规输入跑到了后端才失败（=预检没生效）；错误信息里看不出是音频的问题。

---

## 5. 缺口总表（按优先级）

| 优先级 | 缺口 | 影响 | 成本 |
|---|---|---|---|
| **P1** | 音乐先行工作流未开工（CV-126，总纲第 2c 步） | 仍是「视频先行」，配乐天生贴合度上限低 | 低（纯 skill 文档，不依赖后端） |
| **P1** | 音频不在 `@` 候选 / 没有真 chip | 引用音频体验降级为纯文本 | 低（约 4 处 + 单测） |
| **P1** | 节拍落点实算（`beats.json`） | 「按拍拆镜」只能估算 —— 音乐先行方案最大折损 | 中（本地 FFmpeg 估拍） |
| **P1** | 合成无 UI 入口 | 手动走完整流程做不到，必须经过对话 | 中 |
| **P1** | 歌词无 LRC 时间轴 | 做不了跟唱高亮 / 自动字幕轨 | 中 |
| **P2** | BGM 时长守卫 | 短 BGM 静默变静音，只靠纪律约束 | 低 |
| **P2** | 后端字段名确认（B/C 通道） | 两条通道都卡在这 | 外部 |
| **P2** | 15s 窗口自动预切 | 长主音频要手切 | 低 |
| **P2** | 原生音轨 vs 各镜音轨互斥检查 | 打开 B 通道后才会踩 | 低 |
| **P3** | 音频进时间线 / 真波形 / 音频抽屉 / ducking / 接缝落拍 / 剩余时间 | 体验与专业度 | 中 |

完整 13 项描述见 [audio-generation-plan.md §12.2](./audio-generation-plan.md)。

---

## 6. 一次性跑通的最小验收路径

约定：`cd canvas-studio` 后 `corepack yarn workspace canvas-studio build && corepack yarn dev` 启动桌面
（需能访问 `117.50.108.73:8082`）。**按顺序做，前面失败就先停下修**。

| 步 | 操作 | 预期 | 对应编号 |
|---|---|---|---|
| 1 | 对话：「给这条片子配 30 秒的悬疑 BGM」 | agent 加载 `music-prompt-writing`；参数合规（无 BPM in caption） | S1–S4 |
| 2 | — | **音频节点立刻出现在画布上**（不用切窗口） | V5 |
| 3 | 卡片点 ▶ / 拖进度 / 双击开播放器 | 声音正常；拖动跟手；播放器可拖进度、Esc 关闭 | V2 / V3 |
| 4 | 详情面板 / 图层 / 小地图 / 右键下载 | 全部正常，扩展到 `.mp3` | V4 |
| 5 | 对话：「写一首 30 秒中文歌，主题深夜走廊」 | 有词路径；卡片摘要行 = 歌词首行；播放器显示全文 | S5 / V2 |
| 6 | 构造超规格音频引用（如 4 段） | **生成前**就报错，明确指出音频不合规 | C2 |
| 7 | 显式请求原生音轨 | 请求体带 `generate_audio`；后端不支持时错误**点出音频参数** | B1 |
| 8 | 对话：「把片段合成成片，BGM 用刚才那条」 | 成片有 BGM，首尾 1s 淡入淡出 | A1 / A2 |
| 9 | 打开 CV-128 前的老项目 | 旧 BGM 节点已迁移成音频卡片，高度正常 | V6 |

---

## 7. 失败判据速查

| 症状 | 大概率根因 |
|---|---|
| 生成完要切窗口才看到音频节点 | `STUDIO_TOOL_KINDS` 又漏登记（CV-130 修过一次） |
| 有词却显示「纯器乐 · 无歌词」 | 歌词没经 `lyrics` 参数交出去，或节点 `lyrics` 没写入 |
| agent 声称「已按 E minor 生成」 | `degradedFields` 非空但它没说 —— 违反 skill 软提示铁律 |
| 把音频节点传给了 `clipIds` | 音频会被当一镜；应传 `bgmNodeId` |
| 成片后半段没声音 | BGM 比成片短 + **无时长守卫**（已知缺口 X1） |
| 音频参考报笼统 500 | 后端未开放音频入参（预期行为），看错误里有没有点出音频参数 |
