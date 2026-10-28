---
name: mv-production
description: MV 制作流程（Canvas Studio）。用户给一首歌（或一段音乐）+ 一组素材/风格要求，要做音乐视频 / 卡点片 / 跟唱字幕片时加载：歌词分句 → 时间轴对齐 → 逐句画面 → 卡点切换 → 字幕跟唱的完整编排。只复用 canvas-studio 既有工具（music_generation / tts_voiceover / video_composite / compose_video / render_composition / cut_audio），不引入新工具；节拍数据来自 beats.json（低置信禁用卡点）。
---

# MV 制作流程（音乐短视频）

适用：用户给了一首歌（上传 / `music_generation` 生成）+ 素材或风格，要出 MV / 卡点片 /
跟唱字幕片。**只做流程编排，全部工具用法见 canvas-studio-creation 总纲与各分册**；
本文不重复它们的参数细节。

## 0. 前置自检（三个都答上来再动手）

1. **歌从哪来**：用户上传 → 先 `upload_image` 落音频节点？——不，音频走画布上传或
   `music_generation` 生成；确认拿到**音频节点 id** 与真实时长（节点 duration）。
2. **有没有歌词**：有歌词文本 → 走「跟唱路线」（§2 全量做）；纯器乐 → 走「卡点路线」
   （§2 只做第 1、4 步，切点吸附节拍）。
3. **画幅与素材**：与总纲澄清一致（16:9 / 9:16 不混用）；素材图 ≥3 张/镜才够 Ref2VA。

## 1. 声音规划（canvas-studio-creation 第 2d 步的 MV 特化）

- BGM = 这首歌本身；**成片总时长目标 = 歌曲时长**（不是反过来——MV 以歌为轴）。
- 需要人声覆盖（旁白解说）→ `tts_voiceover` 单独出，`compose_video` 时放
  `voiceOverNodeIds`（起点 = 对应镜头起始秒 + 0.2s 留白），**不要**把解说混进歌里。
- 需要裁歌（只要副歌 30s）→ `cut_audio` 先裁出「成片轨」，后续全部以裁后时长为轴。

## 2. 时间轴三步（跟唱路线）

1. **歌词分句**：把歌词拆成可唱行（每行 3–8 秒为宜；长句按逗号拆）。产出一张
   「行 → 起止秒」对照表（落便签节点，供用户核对）。
2. **行首对时**：有人声轨时用 `tts_voiceover` 的逐句产物帧号口径；用原歌时按
   `lyrics.json`（人工/agent 指定为精确）或节拍分析（estimated，UI 弱化显示）对行首。
3. **每句一组画面**：一行 = 一个镜头（跟唱铁律：镜头切换对齐行首，误差 ≤0.1s）。
   分镜按行写 `write_storyboard`；每镜 `video_composite` 出片（`generateAudio=true`
   视素材而定，MV 原生声通常关闭，以歌为唯一声轨）。

## 3. 卡点切换（节拍吸附）

- 有节拍数据（`beats.json`，confidence 达标）→ 按
  `music-prompt-writing/references/beat-editing.md` 吸附：切点 = 最近拍点，容差
  ±0.5 拍，超出不吸附；**吸附后重算每镜 durationInFrames 并对总时长重新对账**。
- 无节拍数据 / 低置信 → 按歌曲段落估切点（前奏稀、副歌密），并明确告知用户
  「未做精确卡点」。

## 4. 字幕跟唱

走 `render_composition`（要逐帧精确 + 字幕卡）：
- `manifest.audio.bgmUrl` = 歌（或裁后轨）；多句旁白才用 `audio.voiceOver[]`；
- 字幕轨按「行 → 起止帧」写（startFrame = startSec × 30）；样式用 subtitle 变体；
- 分屏 / 画中画布局先抄 `canvas-studio-creation/references/layout-recipes.md`。

## 5. 合成与验收

1. 素材全是视频片段、无字幕卡 → `compose_video`（歌 = bgmNodeId）；要字幕/转场 →
   `render_composition`。
2. **验收自查**（结果文本必读）：音轨装配摘要中「歌」应从 0s 覆盖到片尾（短了会
   自动补静音并告知——MV 里这通常是失误，考虑重裁/重生成）；多版歌候选用
   时间轴「音频」抽屉并排试听后选定，其余作废。
3. 交付语明说：卡点精度（吸附/估算）、跟唱对齐方式（人工指定/estimated）。

## 遇错处理

- 节拍置信度低 → 自动降级为估算切点（见 §3），不要反复重跑分析；
- 歌比成片长/短 > 30% → 回 §1 重定轴（重裁歌或增减镜头），不要硬凑淡入淡出；
- 工具链问题一律按 canvas-studio-creation「遇错处理」。
