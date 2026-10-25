---
name: code-driven-explainer
description: 代码驱动科普成片规范（canvas-studio 的 render_composition，Remotion 客户端渲染）。凡要把知识 / 数据 / 观点做成带字幕卡、数据卡、转场的解说短片时加载：时间轴由 CompositionManifest（JSON）显式声明，客户端的 Remotion 渲染器按它出 H.264 成片，宿主只做校验、落盘、探测与混音。触发词：科普、教育、讲解、知识短片、数据可视化、带字幕卡 / 数据卡的视频、代码合成。流程：确认拍摄定稿已落地 → list_shots / list_references 取素材真值 → 组装 manifest → ask_user_choice 给轨道时序预览（可调时长档位 / 字幕粒度 / 卡片取舍）→ render_composition。边界：不改写总纲的流程与审批语义；不做词级字幕对齐（后端 TTS 无时间戳数据源）；纯片段顺序拼接仍走 compose_video，不用本工具。
---

# 代码驱动科普成片（code-driven-explainer）

把知识 / 数据 / 观点做成**带字幕卡与转场的解说短片**时走本路径：时间轴由 `CompositionManifest`（一段 JSON）显式声明，客户端的 Remotion 渲染器按它出片，宿主只做校验、落盘、探测与混音。适合需要**代码级精确控制**（句级字幕对齐、卡片逐一入场、转场窗口）的成片。

本 skill 是 `canvas-studio-creation` 总纲的**下游分支**：总纲负责需求澄清、拍摄定稿与审批语义，本 skill 只负责「已定稿之后，怎么把素材组装成 manifest 并交给 `render_composition`」。启用它**不改变**总纲的流程与审批门禁。

## 何时用（trigger）

- 用户要「科普 / 教育 / 讲解 / 知识短片 / 数据可视化」，或明确要**带字幕卡 / 数据卡 / 图文幻灯片**的成片。
- 需要把既有视频 / 图片素材与**逐句字幕**编排进同一条时间轴。

**不适用**：只把已有视频片段按顺序拼接 → 用总纲的 `compose_video`；只要风格化 B-roll 而非卡片叙事 → 走对应风格 skill。

## 前置（缺一不可）

1. `write_storyboard` 的拍摄定稿已落地（脚本 / 分镜已在画布）。
2. 需要的视频 / 图片素材已在画布（`video_generate` / `video_composite` / `image_generate` 的产物，或用户上传与参考资产）。
3. 片中有旁白时，`tts_voiceover` 已产出并落成音频节点。

## 工作流

0. **先问三件事（confirm 模式）**：开工前用 `ask_user_choice`（一次一个问题，≤3 问）确认**只有用户能答**的项——
   **音轨**（纯 BGM / 要旁白 / 不要声音）、**时长与画幅**（用户没明说时）、**素材来源**（用哪张图 / 要不要先生成）。
   为什么必须前置：实测有会话把音轨问题拖到第 33 步才问，答案一变全返工。
   **auto 模式不问**（`autoAnswerFor` 直接给默认，见工具描述）；这是需求澄清，**不是审批门**。
   问完就往下走，不要在第 3 步重复问同一件事。

1. **取真值**：`list_shots` 读每个视频片段的**真实时长**（素材轨时长的唯一合法来源）；`list_references` 取角色 / 风格资产卡与图片。有旁白时以 `tts_voiceover` 结果里的真值时长为准。
2. **组装 `CompositionManifest`**：**先 `scaffold_manifest({ title, durationSeconds })` 拿骨架**（已含顶层 `id`、`meta`、片头片尾与时长自洽），再往 `tracks` 里加你的轨。**先挑卡再动手，不要从空 tracks 发明镜头**：整片结构用 `scaffold_manifest` 的
`recipe` 套片型配方（explainer-cards / product-walkthrough / story-arc，自带段序列、时间轴与素材需求）；
单镜头动效从 `references/shot-cards.md` 挑卡填参（每卡实测可渲，带素材需求与每帧成本档）。
手写整份也行，但务必照 `references/manifest-contract.md` 的硬约束来（顶层 `id` 必填是最常见的首轮失败）。`meta`（画幅 / 帧率 / 总帧数）+ `tracks`（video / image / textCard / shape / transition / audioViz）+ 可选 `audio`。字段与约束见 `references/manifest-contract.md`。
3. **方案预览（可选，非审批门；与第 0 步分工：第 0 步问"事实"，这里给"方案"）**：用 `ask_user_choice` 给出成片结构预览——**轨道时序表**（video 轨须同时显示「声明时长 / 真值」两列）与可调项（时长档位 / 字幕粒度 / 卡片取舍）供用户挑；措辞按「可选方案」写，**不要写成流程门**。用户不挑就按推荐方案默认。放手跑模式跳过本步。
4. **调 `render_composition({ manifest })`**：放行由该工具自身承担（与 `compose_video` 同口径），本 skill **不设门**。**不要传 `projectId`**。
5. **展示**：成片节点自动落画布；把结果里的 `warnings`（时长校正 / 缺素材 / 幻灯片风险）转告用户。

## 组装要点（细则已下沉分册）

- **工具地图**：每个工具干什么、参数与返回见 `../canvas-studio-creation/references/toolchain.md`——本 skill 只讲做法，别靠工具名猜用途。
- **素材轨时长硬口径**：video 轨 `durationInFrames` 必须来自 `list_shots` 真值，禁止目测或估算 → `references/source-duration.md`。
- **句级字幕时序**：按旁白真值总长 + 字数占比分配，末句吸收舍入误差 → `references/subtitle-timing.md`。
- **字体声明**：中文先声明 `global.fontFamily`；随包子集未命中再走 `global.fonts[]` → `references/fonts.md`。
- **科普结构**：钩子 → 主体（3±2 个要点）→ 收尾；卡片形态与节奏 → `references/explainer-patterns.md`。
- **动感范式（默认开）**：任何内容都要按 `references/motion-patterns.md` 的范式与决策表给画面加运动，避免成片像 PPT。

## 动感基线（默认开，避免成片像 PPT）

成片「像幻灯片」的根因几乎从不是 Remotion 能力不够，而是 manifest **没写动画**。`animate` / `kenBurns` /
`transition` 都是逐帧确定的合法手段（CV-336 后多段关键帧已正确插值）。**组装时默认就加动感基线**，不要等宿主回
「静态图文」提示才补——那是补救，不是目标。范式怎么选、怎么让运动「被看懂」：全部下沉在
`references/motion-patterns.md`（可复制范式 + 决策表），按决策表为画面选运动，而不是只放静态卡片。

默认基线（每条都应在组装时落地，除非有明确理由静态）：

- **图片轨道**：默认 `fit: "kenburns"`（缓慢推近，零额外成本）；或加一条 `animate` 滑入。
- **标题 / 数据卡 / 要点卡**（`title` / `dataCard` / `bullets`）：默认滑入 `animate`（`x:115→50` + `opacity:0→1`，`durationInFrames:18`，`easing:"easeOut"`），并显式写 `fadeFrames:0`。
- **段落之间**：相邻内容轨**人为重叠** 10–20 帧，并放一条 `transition`（fade / slide）落在重叠区内——转场窗口必须同时压住 from / to 两轨，否则会被拒收（"完全不相交"）。
- **过程 / 关系 / 数量对比 / 中心绕转**：优先用 `shape` + `animate` **程序化**表达（几何程序化，**不引视频模型**）；绕点转圈、路径描边生长这类**关系型运动**用 `orbit` / `shape:"path"`+`draw`（一行声明，别手算关键帧）；范式的选择见 `motion-patterns.md` §2。
- **发光 / 描边 / 投影 / 虚化样式**：用 `fx`（`glow` / `stroke` / `shadow` / `blur` / `maskFade`），不要试图用多层 shape + 透明度硬模拟。
- **音画同步的波形**：有 BGM / 旁白且需要「声音看得出来」时加一条 `audioViz` 轨（柱高由真实振幅驱动）；科普片的数据揭晓、播客式讲解尤其吃这条。

**保留纪律**：字幕卡（`subtitle`）仍按句首尾相接、硬切（不淡入），避免接缝闪背景——这条不变，不要给字幕卡加 `fadeFrames`。

**不要**为了「消静态提示」去逐镜生成视频（H3）——Remotion 程序化动画已能注入生命感，且成本 / 一致性更可控。H3 只用于需要**写实质感**（真实光影 / 运镜）的「英雄镜头」，且按既有 `video` 轨接入（见工作流第 2 步）。

## 纪律

- **一句一条字幕卡**：字数与展示时长匹配，不把长段落塞进一张卡。**卡的首尾必须相接**——`durationInFrames` 是屏上时长，每句延伸到下一句 `startFrame`（末句到总帧），句间不留空白帧；字幕卡由组件层硬切，别指望淡入淡出 → `references/subtitle-timing.md`。
- **血缘**：video / image 轨的 `id` 必须填该素材的**画布节点 id**（宿主据此画制作链）；纯呈现轨（textCard / shape / transition）用本地 id。
- **素材引用**：`src` 只接受 `/canvas-studio/assets/...` 同源 URL，或**本项目资产目录内**的绝对路径（宿主会自动物化成同源 URL），**禁一切外链**。
- **缺素材会被直接拒收**：宿主在渲染前核对素材，缺失或引用不可用即 `CS-USER-ERR` **硬失败**（不落节点、不出片）。收到该错误时**不要原样重试**，先去补齐素材或改用已有画布资产。
- **video 轨时长以真值为准**：宿主用 ffprobe 复核并**按真值改写** `durationInFrames`；校正后若相邻轨不再重叠、转场失效，会连同明细一起拒收（`CS-USER-ERR`）。收到就按报错里的真值重排轨道与转场窗口，**不要原样重试**。
- **不要翻历史会话 / 旧项目考古**：需要知道"以前怎么做的"就问用户，或只看本项目 `build/` 与资产目录。
  `cat projects.json`、遍历 `~/.videobuddy/sessions/` 去找上一个项目为什么失败，属于**无效考古**——
  实测三步烧掉约 5 分钟推理，还会把错误的先验带进来（旧项目失败的原因通常与本轮无关）。
- **风险提示不是错误**：全片无 video 轨时宿主会回一条「图文卡片型」提示（静态占比 / 运动密度 / 镜头数命中），**这条路线是合法的**，不要为此改成逐镜生成视频。
- **有下一步就别停轮**：一段渲成功后直接推进下一段 / 下一节，不要停下来等用户点头。只有「审美取向、总时长、素材取舍」这类**只有用户能回答**的事才值得停；其余一律自己决定并在汇报里说明。
- **内容慢 vs 环境坏，先看工单再看内容**：返回文本里有一行 `工单：<执行者> · <认领状态> · <首帧> · 进度 · 用时`。
  - 出现「未认领 / 无首帧」或最小探针（1 轨 / 10 帧）仍 **>1s/帧** ⇒ 是**执行器链路问题**，停手去查（见「遇错处理」），**不要再缩 manifest 空转**；
  - 只有在「已出首帧、进度在涨、msPerFrame 稳定」的前提下，才值得怀疑内容复杂度。

## 遇错处理

> 完整错误码对照（含"该改什么 / 别做什么"）见 `references/errors.md`；下面是最高频的三类。

- **`CS-RENDER-TIMEOUT`**：先读返回文案里的诊断（「X 从未取走这张工单」/「已取单但 Ns 内一帧都没渲染」/「已渲染 Ns，进度 X%」）。前两种是**执行器链路**问题：不要重试同一份 manifest，也不要改画面，直接把诊断原文交给用户并建议重启客户端；只有第三种才考虑缩短时长 / 降分辨率。另外确认**没有误传 `projectId`**（省略即按当前项目解析）。
- **manifest 校验失败**：报错会定位到具体 `tracks[i]` 字段，按点改，不要整段重试。
- **`CS-RENDER-002`（客户端渲染失败）**：先确认素材可读（同源 URL 存在、格式受支持），再向用户说明。
