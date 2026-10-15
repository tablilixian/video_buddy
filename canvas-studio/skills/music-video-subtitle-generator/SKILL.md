---
name: music-video-subtitle-generator
description: |
  Style knowledge for beat-reactive music videos and lyric typography: typography as a spatial graphic layer rather than a subtitle bar, one Master Audio track with beat-grid-aligned cut points, five continuity locks for natural multi-shot stitching (vocal/lip, rhythm/beat, grade, transition/motion, typography motion), hard-cut-only editing language for Dark-pop / Cyber-grunge / Trap, and lyric lock rules. Use when a musician, video creator, or social editor wants an MV concept, shot prompts, lyric typography plan, or prompt audit. Not for ordinary caption burn-in, generic editing, non-music product ads, or fully manual post-production.
compatibility: Requires the MiniMax Hub agent (canvas workspace and Hub generation/routing tools); not portable to generic agent harnesses.
trigger-words: [MV, music video, lyric typography, on-screen text, prompt audit, Trap MV, Gospel hip-hop, Dark-pop, Cyber-grunge, MV提示词, 歌词文字, 字幕MV, 贴字MV, 卡点MV, 多镜头拼接]
---

# Music Aesthetics MV

音乐美学 MV 与歌词贴字的**风格知识库**：排印作为空间图层、主音频对齐、五道拼接连续性锁、Dark-pop / Cyber-grunge / Trap 的剪辑语言。

## 立场声明

**本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。**

## 何时用 / 何时不用

**用**：用户要创作、修改、审计或生成音乐视频提示词 / 情绪短片提示词，需要音乐、歌词、排印、参考图、节奏、表演与镜头语言一起设计。

**不用**：普通字幕烧录、通用剪辑、非音乐的产品广告，或没有 MV 结构的单图/单段需求。

## 核心原则

1. 先理解作品再选结构。模板用来组织，不是必须填的固定形式。
2. 用最新确认的创意意图。
3. 无关字段直接省略，不要用占位符凑满。
4. 不要因为预设里写了表演、排印、转场、运镜或角色动作就机械地全加上。
5. **画面内文字是被设计过的视觉图层，不是普通字幕**，除非用户明确要字幕。
6. 用户上传了真实歌曲或 beat 时，它是主音乐床，除非用户要求替换。
7. **超过 15s 的视频默认自然多镜拼接**：超过模型单次生成上限时，用"多镜分镜拆解 + 尾/首帧续接 + 节拍硬切 + 全局主音频对齐"。每段都要保持同一 groove、速度感、画幅、角色逻辑、视觉预设、光线语言与排印动效规则。
8. 用户想要没有歌词的成品音乐美学 MV 时，先生成并锁定原创歌词。终版 MV 必须同时引用角色卡、排印包装卡与场景卡。排印包装卡只控制文字包装风格、字体质感、平面设计、版面比例与动效语言。

画幅选项、时长档位、音乐窗口与歌词锁定细则见 `references/preflight-and-contract.md`（写最终提示词前必读）。

## 参考图角色（每张只有一个窄职责）

- **排印参考卡**：只控制文字包装风格、字体质感、平面设计、版面比例与动效语言。**不得**贡献人物或场景。
- **角色参考卡**：控制角色身份、面部气质、发型、服装轮廓、比例、体态与存在感。
- **场景参考卡**：控制场景风格、空间氛围、影像质感、背景纵深与光线情绪。

### 特写换景与多镜采样

Trap、Dark-pop、Cyber-grunge 等快节奏 MV：在多个近景空间之间快速切换。

- 场景氛围统一，但每镜的空间必须明显不同——局部背景、隧道、墙面、灯带或反光地面。
- 换景必须由音乐冲击触发：贝斯 hit、808 drop、军鼓、人声重音或排印砸屏。
- 镜头切换是 trap 节拍上的"视觉采样"：硬切、跳切、扫描故障切、闪切或动作匹配切。

## Dark-pop / Cyber-grunge / Trap 的视觉与剪辑语言

- 写实高级时装质感与时尚杂志质感，参考 90 年代末 / 00 年代初独立杂志、复印纸、胶片扫描与 zine 拼贴。
- 重颗粒、轻微胶片抖动、半调网点、粗粝印刷边、扫描错位。
- **剪辑只能用硬切**。禁止淡入淡出、叠化与柔转场。
- 图像与排印必须强烈响应节拍：hi-hat roll 产生微抖/跳帧，军鼓触发放大/硬切/肩部下沉，808 低音 hit 产生低频压缩/拉伸/错位。

## 排印包装规则

- 排印是空间中的动态图形主体，不是字幕条。它可以位于前景、中景、背景，或被肩膀/手部遮挡。
- 文字**绝不能**遮住眼睛或主要面部表情；关键口型同步期间避开嘴部。
- 有人声时，可见文字必须与实际演唱的歌词完全一致。每个镜头只有一次主要排印事件。

## 排印纠错（canvas-studio）

MV 排印是本系统文字最密的产物，静帧上出现错字/糊字/缺笔画时**不要换种子整张重生成**——那会丢掉已经正确的画面。改用画布 `image_fix` 做图内文字修复：保留原提示词里锁定文字内容与排布（位置、字体、尺寸、颜色、版面）的句子 + "每个字形精确复现、不得替换/增删/遗漏"的约束，丢掉美术指导句；**只给一串字符不够**（实测 `武仔` 回来变成 `武传` 还多出两处凭空文字），不要带场景/角色/风格描述。完整写法与证据见 `references/prompt-template.md`。

## 分册（按需读，不要一次全读）

| 分册 | 何时读 |
| --- | --- |
| `references/preflight-and-contract.md` | 写最终提示词前的格式、时长、音乐窗口、歌词锁定与创意契约 |
| `references/prompt-template.md` | 多镜提示词脚本的模块化模板与逐字段写法 |
| `references/stitching.md` | >15s 自然拼接协议与五道连续性锁 |
| `references/checklist.md` | 交付前静默自检项、画布交付与多镜生成拼接要点 |

## 边界

生成、落地、审批与交付动作一律走 `canvas-studio-creation`；本 skill 不提供工具参数、不设审批门。不假设第三方工具、shell 脚本、浏览器插件或外部生成 API；不要硬编码输出路径，一律使用画布返回的路径。
