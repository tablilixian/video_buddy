# 画布片段拼接「割裂」问题：业界方案调研与借鉴建议

> 2026-09-07 · 针对 Canvas Studio 画布插件从创意到成片链路中「多片段拼接割裂」问题的讨论稿。
> 配套现状分析：Explore 结论（contracts/canvas.ts、compose.ts、creation-spec.ts、generate.ts 等，行号见 §3）。

---

## 1. 问题拆解：四类割裂

| 类型 | 症状 | 根因层 |
|---|---|---|
| ① 主体漂移 | 同一角色/道具在不同镜头里长得不一样 | 生成端：每次生成是独立的「掷骰子」 |
| ② 镜头散乱 | 镜头之间接不上，空间/时间逻辑断裂 | 生成端 + 序列层：片段各自独立生成，无衔接机制 |
| ③ BGM 不连续 | 音乐在拼接点跳变、情绪断裂 | 合成端：音频后置，作为「贴上去的」轨道 |
| ④ 风格不统一 | 色调、质感、镜头语言像不同人拍的 | 生成端软约束 + 合成端无统一后期 |

---

## 2. 业界方案盘点

### 2.1 主体漂移 —— 「一个锚点喂 everywhere」

**Runway Gen-4 References**（runwayml.com/research/introducing-runway-gen-4）：
- 单张参考图即可在任意光照/场景/动作下保持角色一致，无需 fine-tuning，条件化发生在推理时。
- 多参考图时每张打标签（image_1/2/3），prompt 里描述各参考负责什么（脸来自 A、背景来自 B）。
- 实操纪律（escapism.ai 总结）：**每个镜头都挂同一张参考图**；关键元素（红围巾、服装）在 prompt 里反复重申。

**Vidu Q3 Reference-to-Video**（nemovideo.ai 横评）：多角度参考图组（正面/3/4 侧/全身）做视觉锚点，六个场景变换中五个保持一致，是横评中跨场景一致性最好的。

**Kling 3.0 O3 变体**：不吃静态图，吃 **3-8 秒参考视频片段**，从中提取面部+身体特征（含运动上下文）跨代次保持。架构上与静态图锚定不同——给了模型 motion context。物理动作戏一致性最好。

**前置锁身份（domer.io / astorie.ai 工作流）**：
- 先用图像模型生成「角色圣经 character bible」：正面/侧面/特写/全身 4 图、中性光、风格统一。
- **链式前馈**：Shot 1 通过验证后，其输出作为 Shot 2 的参考；链条越滚越稳。「成功输出变成下一代的锚」。
- 用 Nano Banana 类图像模型先锁分镜帧，再把帧喂给视频节点（astorie 推荐栈）。

**Astorie 多镜头画布的经验法则**（与我们画布形态最接近的产品）：
- 「一张强参考，喂进每一个镜头；多参考反而加剧漂移」。
- 节点顺序 = 剪辑顺序，先排序列再生成，不要生成完再重排。
- 按镜头意图混模型：定场 wide、特写 close-up 各用最擅长的模型。
- 同场景连续动作 → 链前帧；跨时空剪辑 → 只用角色/风格参考。
- **只重跑失败的镜头**：canvas 记住全部上游连接，换模型/改 prompt 不动其他节点——「画布是剪辑间，不是片段文件夹」。

### 2.2 镜头衔接 —— 「尾帧链 + 书挡插值」

**Veo 3.1 Scene Extension**（atlascloud.ai / veo3ai.io / deepwiki 案例）：
- **尾帧链**：提取上一段真实最后一帧 → 重新注入为主参考 → 只写新动作的 prompt → 迭代可到 148s。
- 关键细节（deepwiki rokuroku 案例的工程实现）：**必须提取生成视频的实际末帧**，而不是用分镜图——生成有随机性，实际末帧才是 ground truth，这样拼接点像素级连续、零跳变。
- **首尾帧书挡（bookend）**：帧 A 设首帧、帧 B 设末帧，模型自动插值中间 8 秒——消除随机运镜漂移，是「确定性场景桥接」。
- 桥接失败预防：两张边界帧的**地平线、灭点、主体比例要对齐**，否则产生空间扭曲。
- prompt 纪律：`[SAME CHARACTER]...[SAME SETTING]...[SAME LIGHT]` 块**逐字节一致**，每段只改 NEW ACTION / CAMERA 两行。

### 2.3 BGM 连续性 —— 「音乐先行，画面就拍」

（zsky.ai、creativeainews、剪映/万兴喵影实践）
- **BGM-first 工作流**：先定音乐，再剪画面。切点吸附节拍（CapCut 自动节拍检测），「cut on the beat 而不是 cut on the action」是业余与专业的分水岭。
- **单条连续音轨贯穿全片**，从根本消掉拼接点的音乐跳变；情绪段落对齐音乐段落（build-up 配动戏，verse 配静场）。
- AI 配乐：剪映「根据视频智能生成」、万兴喵影「视频驱动型配乐」（识别关键帧动作节点毫秒级同步）、ElevenLabs Video-to-Music（先画面后配乐）。
- 混音纪律：BGM 0.8 音量、有人声压到 15-20%（ducking）、片尾 0.5-1s 淡出。
- **音效层**是隐藏加分项：whoosh、room tone、impact 等 micro-detail 显著提升专业感。
- Veo 3.1 原生音轨（48kHz）自带 ambient/SFX/musical underscore，prompt 里用 JSON 分离 audio attribution。

### 2.4 风格统一 —— 「一个色调 + 一个复现元素」

- **风格参考图**：Gen-4 支持拿一帧电影画面/画作做 style reference，全序列继承其色板、光感、质感。
- **后期统一调色**：所有片段过同一 LUT/调整层（CapCut adjustment layer）——「让 AI 片段像一台摄影机拍的」。
- **复现元素法则**：全片至少有一个元素贯穿（同一角色/场景/色板），否则必然像散片合集。
- prompt 层：全镜头复用同一套光线/胶片描述词。

---

## 3. 我们当前的能力与差距

（证据来自 Explore 分析，均为只读结论）

| 能力项 | 现状 | 证据 | 业界对标 |
|---|---|---|---|
| 片段模型 | 节点即片段（kind=video），无轨道 | `canvas-studio/src/contracts/canvas.ts:44` | Astorie：节点即序列 ✅ 形态一致 |
| 片段排序 | view.timeline 拖拽持久化 | `canvas.ts:158`、`CanvasTimeline.tsx:49` | ✅ |
| 片段关联 | 仅 sourceIds 血缘，无 continuity 字段 | `canvas.ts:70` | 缺衔接类型语义（连续/跳切） |
| 角色/场景资产 | isReference + referenceRole 节点，无结构化库 | `canvas.ts:122-127` | 缺 character bible 实体 |
| 参考图注入 | filenames≤3 / ref2va≤6 | `generate.ts:432-514` | ✅ 已对齐 Vidu/Runway 机制 |
| 一致性锁定 | prompt 软约束（定妆锚点+style_transfer） | `creation-spec.ts:125-126` | 业界靠「同一参考喂 every shot」纪律 |
| 首尾帧 | FL2VA 双图书挡已支持 | `generate.ts`（FL2VA 分支） | ✅ 对标 Veo 3.1 bookend |
| 尾帧链 | ❌ 无自动末帧提取→下一镜首帧 | 全仓无 extract last frame | Veo 3.1 Scene Extension 核心机制 |
| 拼接成片 | ffmpeg 统一转码 + concat demuxer | `compose.ts:107,126` | ✅ 基础在 |
| 统一调色 | ❌ 无 | compose.ts 无 eq/LUT | CapCut 统一 grade |
| BGM | 单段 amix，音量 0.8 | `compose.ts:134,262-291` | 缺贯穿轨/卡点/ducking/淡出 |
| 转场 | ❌ 无 | 全仓无 transition | Veo 插值 或 ffmpeg xfade |
| 字幕/TTS | ❌ 仅 node.script 展示 | `phase2.md:182`（P11 待办） | — |
| 一致性质检 | ❌ 仅文档建议 | `canvas-studio.md:190` | Astorie：shot 级 review + surgical re-run |

---

## 4. 借鉴建议（按优先级，对齐现有架构的最小改动）

### P0-A 角色锚点资产化（治漂移的根本）
把散落的 isReference 节点升级为**项目级角色卡/场景卡实体**：聚合多角度参考图组（正面/侧面/特写/全身）+ 锁定的 prompt 片段（外貌/服装/光感的 SAME 块）。生成 shot 时自动注入同一组参考——把「agent 记得挂参考」的软纪律变成数据结构保证。
- 借鉴：Runway one-reference-everywhere + domer character bible。
- 改动面：新增 asset 实体 + generate.ts 注入逻辑；画布节点可通过 sourceIds 指向资产卡。

### P0-B 尾帧链自动衔接（治「接不上」的杀手锏）
复用已有 FL2VA 能力：shot N 完成后**自动 ffmpeg 提取真实末帧**，注册为资产，作为 shot N+1 的首帧候选。区分两种衔接语义：
- 同场景连续动作 → 尾帧链（像素级无缝）；
- 跨时空剪辑 → 只挂角色/风格锚点 + 硬切（叠一个音效 whoosh 遮切点）。
- 借鉴：Veo 3.1 Scene Extension + deepwiki 案例的 extract-last-frame 工程实践。
- 改动面：compose/ffmpeg 工具已有，新增「提取末帧→落库→自动连线」的 host 工具或 agent 技能步骤；衔接类型可作为节点字段。

### P0-C SAME 块模板字节级复用（零成本 prompt 纪律）
把角色/场景/光线描述做成常量模板，跨镜头**逐字节一致**，每镜只改 action/camera 两行。当前 H3 结构化 prompt 已有雏形（creation-spec.ts:72-96），缺的是「模板常量化 + agent 生成时强制引用」。

### P1-D compose.ts 统一调色 pass
concat 前对每段统一应用 eq/curves（或 LUT），成本几乎为零，直接治「像不同人拍的」。
- 借鉴：CapCut 统一 grade / 复现元素法则。

### P1-E BGM 贯穿 + 卡点
现有 amix 升级为 audio-first 工作流：BGM 先行 → 节拍检测（librosa/ffmpeg 均可估）→ 给出建议切点/按拍对齐片段时长 → 淡入淡出 + 人声 ducking。单条连续音轨贯穿，从根上消掉音乐跳变。

### P1-F 转场：生成时插值优先，xfade 兜底
首尾帧书挡（已有）是「有意义的转场」；纯节奏性转场用 ffmpeg xfade（叠化/黑场）低成本低风险。不建议先做复杂后期转场库。

### P2-G Shot 级一致性质检 gate（agent 自检）
agent 对每镜做视觉 review（脸/服装/色调 vs 角色卡），不合格只重跑该镜头——画布的 sourceIds 血缘天然支持「surgical re-run 不动上游」。可先做成 skill 步骤而非产品功能。

### P2-H 多候选
每镜生成 2-3 候选再挑，给后期留选择空间（业界标配，成本换稳定）。

---

## 5. 开放讨论点

1. **一致性的实现层次**：prompt 软约束（现状）→ 参考图纪律（P0-A）→ 数据级锁定（资产实体）——要走多远？资产实体化会动数据模型，值得先讨论。
2. **衔接类型建模**：在节点上加 `transition: 'chain' | 'cut' | 'bridge'` 字段，还是完全交给 agent 按剧本语义决定？
3. **BGM 来源**：继续用户上传（现状），还是接音乐生成服务（Suno 类 API）？后者才能真正做到「按情绪段落生成完整曲」。
4. **质检标准**：agent 自检的 drift 判定标准（脸/服装/色板偏差多少算 fail）与重跑预算（每镜最多 N 次）需要定。
5. **优先级取舍**：P0-A 需要动数据模型，P0-B/P1-D/E 只在工具与 compose 层——可以先做后者快速见效，A 放进 Phase 3 规划？

---

## 6. 追加评估（2026-09-07 下午）：三视图接口能否满足 P0-A

### 现状确认
- drama-api 已有专用接口：`POST /api/v1/generate/image2character`（`docs/plans/api.md:214-247`），输入一张角色设计图 filename，走 ComfyUI `qwen_4view_char_2step` 工作流，输出**单张白底四视图立绘**（正面特写/侧面全身/背面全身）。
- canvas-studio **完全未接线**：`src/config.ts:21-33` 端点表无 image2character；`src/host-tools.ts` 只注册了 image_generate / video_generate / video_composite / image2vl / style_transfer / compose_video 六个工具；skill 流程里「三视图」目前是 **image_generate 的 prompt hack 模拟**（`creation-spec.ts:124`「可先 image_generate 生成三视图」），phase2 里 `character_sheet` 本来就是 ⬜ P11 待办（`phase2.md:177,296`）。

### 评估结论：核心可满足，需两个配套
| P0-A 需求 | image2character 覆盖度 |
|---|---|
| 多角度参考组（正/侧/全身） | ✅ 正面特写+侧面全身+背面全身，白底中性光，恰好对标 character bible 推荐组合 |
| 生成链路稳定 | ✅ 确定性 ComfyUI 工作流，优于现有 prompt hack |
| 可注入 shot 生成 | ✅ 输出单图，直接作 filename 参考传 image_generate / ref2va |
| 独立分图 | ⚠️ 输出是**单张拼图**，理想是每角度独立喂——但项目已有 `image2splitegrid` 切图接口（`config.ts:29`），可拼成「四视图→切分→3-4 张独立参考图」组合拳 |
| 锁定 prompt 片段（SAME 块） | ❌ 接口只管视觉锚；外貌/服装/光线文字描述仍需资产卡字段维护（P0-A 的另一半） |

### 建议接入方式（即 P11 `character_sheet` 工具的落地形态）
1. `config.ts` 增加 `image2character` 端点；
2. host-tools 注册 `character_sheet` 工具：入参定妆照/设计图节点 → 输出四视图节点 → 自动调 splitegrid 切分为独立参考图节点（referenceRole='character'，sourceIds 指回原图）；
3. 切分后的独立分图进入 P0-A 角色卡实体，作为「一个锚点喂 every shot」的数据基础。

参考：`docs/plans/canvas-studio-api-usage.md:43`（image2character 🆕→P11）、`:81`（四视图立绘白底作全片锚点，角色一致性要求高时用）。

---

## 参考来源

- Runway Gen-4：runwayml.com/research/introducing-runway-gen-4 · aiwiki.ai/wiki/runway_gen_4 · escapism.ai/p/runway-gen-4-how-to-build-consistent-characters
- 模型横评：dev.nemovideo.ai/blog/vidu-q3-vs-runway-vs-kling-character-consistency-showdown
- 多图融合工作流：domer.io/blog/multi-image-character-consistency · domer.io/blog/ai-video-character-consistency-multi-image-fusion-e98b3464
- 多镜头画布：astorie.ai/zh-CN/features/multi-shot-ai-video
- Veo 3.1 衔接：atlascloud.ai/zh-TW/blog/guides/how-to-use-veo-3.1 · veo3ai.io/blog/veo-3-extend-video-beyond-8-seconds-2026 · deepwiki.com/rokuroku-066/gen_video/6.1-frame-interpolation-and-chaining
- 音频：zsky.ai/blog/ai-video-music-sync · creativeainews.com/articles/how-to-make-ai-music-video-2026
