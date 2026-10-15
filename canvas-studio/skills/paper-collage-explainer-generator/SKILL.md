---
name: paper-collage-explainer-generator
description: |
  Style knowledge for premium halftone paper-collage animation: flat bold color fields, black-and-white halftone photographic cut-outs, selective colored cardstock accents, warm cream keylines, soft paper shadows, controlled paper grain, tactile stop-motion assembly (pieces pop in, bounce, press flat, lock), crisp collage sound effects, and a default audio policy that keeps collage SFX and adds no BGM, voiceover, or subtitles unless asked. Use for explainers, viewpoints, story visuals, editorial or social B-roll. Not for presenter ads, editable layers, exact logo placement, readable typography, or prompt-only tasks.
compatibility: Requires the MiniMax Hub agent (canvas workspace and Hub-native image/video/audio tools); not portable to generic agent harnesses.
trigger-words: [paper collage explainer, paper-collage animation, halftone collage, collage explainer, 纸拼贴, 拼贴科普, 定格拼贴, 拼贴动画]
exported-by: MiniMax-hub
---

# Paper Collage Explainer Generator

编辑感半调纸拼贴动画的**风格知识库**：色彩语言、纸张质感、拼贴工艺动作、音效基调与质检标准。

## 立场声明

**本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。**

## 何时用 / 何时不用

**用**：把一句旁白、故事主题、观点句或抽象概念转成有视觉隐喻的拼贴动画；用拼贴 B-roll 讲简单故事或文学题材；做社媒编辑感拼贴；半调拼贴里物体从空色场逐件组装；把一批短句或故事节拍转成独立短片；可以带纸点击、pop、滑入、按压、窸窣声但不要自动配乐或口播的知识点讲解。

**不用**：写实产品广告或真人口播视频；需要精确可编辑图层、时间线关键帧或透明抠底素材；需要精确 logo 摆位或可读排版；只要一段文字提示词而不出片。

## 默认创作目标（除非用户另有指定）

- 画幅 16:9 横屏。
- 单段片长约 4 秒。
- 视觉风格：高级编辑感半调纸拼贴。
- 运动风格：触感定格组装，**不是**慢速推镜、泛化漂移或顺滑数字图层运动。
- 文字：画面内避免可读字母、数字、UI、字幕、水印与 logo。
- 画质与纵深：优先好看、分层的 16:9 构图，前景/中景/背景纵深清晰，主体层级明确，场景丰富但可读，负空间受控。
- 视频模型固定 `MiniMax-H3`（本项目固定，无模型选择环节）。

## 音频基调

**默认交付 = 有拼贴音效，不加 BGM、不加口播、不加字幕。**

1. 在第一次交代制作方案时明确说出默认媒体策略：保留或生成触感拼贴音效；默认不加 BGM、口播、字幕。
2. 可以问用户是否需要**口播**、**BGM** 或**字幕**（讲解类尤其常见），但三项都只能作为可选项呈现，不能当默认。
3. 不要因为是"讲解"就推断用户要口播；用户不要口播时就做视觉节拍，而不是口播稿。
4. 不要因为是"社媒视频"就推断用户要 BGM 或字幕；用户不要就只留音效。
5. 生成片段时若模型支持音频，请求与画面同步的触感拼贴音效：纸片滑入、pop、按压、轻敲、轻微纸张窸窣。
6. 成片合成时保留含拼贴音效的原片段音轨，**不要默认丢音轨**。
7. 只有用户要求静音、生成的音频含不想要的语音/音乐、或用户要求独立音乐/口播混音时才移除或替换音频；字幕只在用户明确要求时才做。

## 全局风格规则（全项目每张静帧与每段视频都适用）

1. **统一整体风格**：每段都像同一套编辑感纸拼贴系列——半调剪影、平涂色场、暖奶油描边、柔和物理阴影、干净构图、触感纸材质、协同的拼贴音效。
2. **控制纸张纹理强度**：纸不能完全平，但也不能过度做旧、脏、皱或发黄（除非用户明确要求）。优先干净精致的手工质感：细微纤维、略不规则的手撕边、轻毛边纤维、层叠接缝、柔和阴影。
3. **统一色调**：当牛皮纸、棕、泛黄、做旧底纸与已确认的静帧或批量色板冲突时不要引入。每段从与已确认静帧主色方向一致的纸色场起手。
4. **运动必须读作定格拼贴**：用清晰的纸片动作——逐件出现、滑入或 pop 就位、轻微回弹、按压平整、停顿、锁定到最终构图。避免快速旋转、过度翻转、混乱物体飞行、全局淡入淡出、顺滑数字平移、缩放或泛化漂移。
5. **保持片段协同**：一旦一两段确立了已确认的批量风格与音效节奏，后续片段与返工都引用同一节奏与色调，让整组看起来连贯。
6. **默认做精致的 16:9 分层场景**：除非用户明确要别的平台画幅，就按 16:9 规划生成。用更宽的画布做漂亮的前景/中景/背景分离、更丰富的环境道具、更清晰的主体层级与电影感的横向构图，但不要把画面堆成杂乱。
7. **强调拼贴工艺**：每张静帧与每段视频都要让拼贴方法可见——可分离的纸组、半调摄影剪影、彩色卡纸点缀、触感阴影、撕裂边、层叠接缝，以及 pop-in、slide-in、轻回弹、按压、停顿、锁定这类定格动作。

## 静帧风格签名

```text
flat bold color field, black-and-white halftone photographic cut-outs, selective colored cardstock accents, warm cream keylines, soft paper shadows, fine uncoated-paper grain, premium editorial paper collage, clean refined hand-torn paper edges, subtle fibrous edges, layered paper seams
```

## 色彩语义

- 焦橙或红：劳动、时间压力、紧迫。
- 芥末黄：工具、警告、累积的错误。
- 墨绿：认知、重置、判断、超现实的平静。
- 深紫：记忆、结构、神秘、梦境逻辑。
- 青绿：协作、执行、系统流动。
- 玫瑰红：荒诞、仪式感、戏剧张力。

不要把钴蓝当自动默认色。用纸纹理、半调处理、描边、阴影、构图与受控色板保持整批视觉统一；只有故事节拍需要对比时才换色场。

## 分册（按需读，不要一次全读）

| 分册 | 何时读 |
| --- | --- |
| `references/production-plan.md` | 拆解输入、写制作方案文档、静帧视觉规格字段与色板约束 |
| `references/still-and-motion.md` | 静帧要求、审定帧的定格组装顺序与运动提示词模板 |
| `references/audio-and-clip-spec.md` | 片段生成的音频与视觉要求、批量节奏延续规则 |
| `references/checklist.md` | 画质质检标准、交付内容、失败处理 |

## 边界

生成、落地、审批与交付动作一律走 `canvas-studio-creation`；本 skill 不提供工具参数、不设审批门。
