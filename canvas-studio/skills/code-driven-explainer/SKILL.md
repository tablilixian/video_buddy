---
name: code-driven-explainer
description: 代码驱动科普成片规范（canvas-studio 的 render_composition，Remotion 客户端渲染）。凡要把知识 / 数据 / 观点做成带字幕卡、数据卡、转场的解说短片时加载：时间轴由 CompositionManifest（JSON）显式声明，客户端的 Remotion 渲染器按它出 H.264 成片，宿主只做校验、落盘、探测与混音。触发词：科普、教育、讲解、知识短片、数据可视化、带字幕卡 / 数据卡的视频、代码合成。流程：确认拍摄定稿已落地 → **先 scaffold_manifest 出骨架并立刻 draft 出片（M1：落地后 20 分钟内必须有成片）** → 再按 R1–R6 一轮加一层丰富 → 定稿。边界：不改写总纲的流程与审批语义；词级卡拉OK走 `caption` 轨（句级硬切仍走 textCard）；纯片段顺序拼接仍走 compose_video，不用本工具。
---

# 代码驱动科普成片（code-driven-explainer）

把知识 / 数据 / 观点做成**带字幕卡与转场的解说短片**时走本路径：时间轴由 `CompositionManifest`（一段 JSON）显式声明，客户端的 Remotion 渲染器按它出片，宿主只做校验、落盘、探测与混音。适合**代码级精确控制**的成片。

本 skill 是 `canvas-studio-creation` 总纲的**下游分支**：总纲负责需求澄清、拍摄定稿与审批语义，本 skill 只负责「已定稿之后，怎么把素材组装成 manifest 并交给 `render_composition`」。

## 何时用（trigger）

- 用户要「科普 / 教育 / 讲解 / 知识短片 / 数据可视化」，或明确要**带字幕卡 / 数据卡 / 图文幻灯片**的成片。
- 需要把既有视频 / 图片素材与**逐句字幕**编排进同一条时间轴。

**不适用**：只把已有视频片段按顺序拼接 → 用总纲的 `compose_video`；只要风格化 B-roll 而非卡片叙事 → 走对应风格 skill。

## 阶段一：事实一旦定死（本 skill 的上游）

故事板阶段**不联网反复核数**。数值口径走 `references/facts.md`：一次 `facts-builder.mjs`
生成 `<projectDir>/build/fact-snapshot.json` → 一次写入 `write_storyboard` 的 `facts` 节；
裁决序 `用户原话 > 项目预置 > 快照 > 联网值`，落选值记脚注，`pending` 交 CV-440 事实桥点名。
阶段一轮次预算（≤5 步、第 3 轮一次性出全片计划）见
`canvas-studio-creation/references/intent-card.md`。

## 前置（缺一不可）

1. `write_storyboard` 的拍摄定稿已落地（脚本 / 分镜已在画布）。
2. 需要的视频 / 图片素材已在画布（`video_generate` / `video_composite` / `image_generate` 的产物，或用户上传与参考资产）。
3. 片中有旁白时，`tts_voiceover` 已产出并落成音频节点。

## 工作流

0. **先问清（confirm 模式）**：**只打断用户一次**——把「只有用户能答」的项合并进总纲的
   一次性意图卡（`canvas-studio-creation/references/intent-card.md`）。**音色人格**是科普片最常见的一项
   （未指定**不得**自行从资产库挑，审美归用户，缺省用 tts 缺省锚并交付时说明）。
   逐项 `ask_user_choice` 仅为降级路径（≤3 问）。实测有会话拖到第 33 步才问，答案一变全返工。
   **auto 模式不问也不弹卡**（按默认值继续、假设写进 `write_note`）；这是需求澄清，**不是审批门**。

1. **取真值**：`list_shots` 读每个视频片段的**真实时长**（素材轨时长的唯一合法来源）；`list_references` 取角色 / 风格资产卡与图片。有旁白时以 `tts_voiceover` 结果里的真值时长为准。
2. **组装 `CompositionManifest`**：**先 `scaffold_manifest({ title, durationSeconds })` 拿骨架**（已含顶层 `id`、`meta`、片头片尾与时长自洽），再往 `tracks` 里加你的轨。**先挑卡再动手，不要从空 tracks 发明镜头**：整片结构用 `scaffold_manifest` 的
`recipe` 套片型配方（explainer-cards / product-walkthrough / story-arc，自带段序列、时间轴与素材需求）；
单镜头动效从 `references/shot-cards.md` 挑卡填参。
手写整份也行，但**先读 `references/manifest-contract.md` 顶部速查表**（四类首轮高频坑）与硬约束（顶层 `id` 必填最常见）。`meta` + `tracks` + 可选 `audio`。
3. **方案预览（可选，非审批门；与第 0 步分工：第 0 步问"事实"，这里给"方案"）**：用 `ask_user_choice` 给出成片结构预览——**轨道时序表**（video 轨须同时显示「声明时长 / 真值」两列）与可调项（时长档位 / 字幕粒度 / 卡片取舍）供用户挑；措辞按「可选方案」写，**不要写成流程门**。用户不挑就按推荐方案默认。放手跑模式跳过本步。
4. **先出片，再丰富**（下节 R0–R6）：拿到骨架就渲一版 `quality:"draft"`，之后每轮只加一层、每轮都出片 → 见下一节。**不要等 manifest 写完才渲**。
5. **调 `render_composition({ manifest })`**：放行由该工具自身承担（与 `compose_video` 同口径），本 skill **不设门**。**不要传 `projectId`**。
   **首轮渲染就用 `spotFrames` 探针**（~1.5s vs 全片 ~25s）逐条判据取代表帧；全片 draft 只用于交付前定稿 → `references/verification.md`。
6. **展示**：成片节点自动落画布；把结果里的 `warnings`（时长校正 / 缺素材 / 幻灯片风险）转告用户。
   **交付前复述未决项**：体检告警逐条状态 / 未核源事实 / 模型自身能力边界 → `references/verification.md`。

## 先出片，再丰富（R0–R6；M1 硬线 = 故事板落地后 20 分钟）

把「造一条完整的片子」改成「先造一条能播的，再一轮加一层」。**每轮结束必须渲一次 `quality:"draft"`**（落画布节点，不是 probe —— probe 用户看不见 = 锚点不存在）。**>12 轨一律用 `assets/manifest-builder.mjs`**（内容表 → manifest，段边界冻结）→ `references/manifest-builder.md`。

| 轮 | 只推一个维度 | 工具序列 | 通过判据 |
|---|---|---|---|
| R0 | 结构可渲 | `scaffold_manifest(recipe)` → `write` → `render(draft)` | 有 url、时长 = 目标 |
| R1 | 真文案（**M1**） | `write(spec)` → `bash(生成+自检)` → `render(draft)` → `spotFrames` → `read_image` | 字幕是真实句子、不溢出 |
| R2/R3 | 视觉主体 | 改 spec → `bash` → `render(draft)` → `spotFrames` | 数据卡不超框、数字与源一致 |
| R4 | 运动 | spec 补 animate / kenBurns / transition → `render(draft)` | 帧间有变化、无闪背景 |
| R5 | 声音 | `tts` 真值 → spec.audio → `render(standard)` | 句起点误差 ≤1 帧 |
| R6 | 定稿 | `render(high)` → `spotFrames` ×6 → `read_image` | 未决项已复述 |

- **M1 合格线（三条全中）**：① 字幕是真文案（不是 recipe 占位「【开场提问】…」）；② 段边界来自旁白**真值**；③ `quality:"draft"` 且非 probe。
- **单轮 ≤8 次工具调用、≤3 轨**；超了就降级收尾保住当前版本，不许「再做一点」。
- **时钟行**：每次工具返回尾部会带 `⏱ M1 剩余 Nmin / 已达成`。超线就照它给的三条命令先出片，不要再美化。
- **锚点**：每版成片自动落 `build/PROGRESS.md` + `build/versions/vN.json`。压缩 / 换会话后**先读它**再动手，不要重推整片。

## 组装要点（细则已下沉分册）

- **工具地图**：每个工具干什么、参数与返回见 `../canvas-studio-creation/references/toolchain.md`——别靠工具名猜用途。
- **素材轨时长硬口径**：video 轨 `durationInFrames` 必须来自 `list_shots` 真值，禁止目测或估算 → `references/source-duration.md`。
- **句级字幕时序**：按旁白真值总长 + 字数占比分配，末句吸收舍入误差 → `references/subtitle-timing.md`。
- **字体声明**：中文先声明 `global.fontFamily`；随包子集未命中再走 `global.fonts[]` → `references/fonts.md`。
- **科普结构**：钩子 → 主体（3±2 个要点）→ 收尾；四种结构模板（陈述/对比/时间线/原理拆解）与卡片形态 → `references/explainer-patterns.md`。
- **动效五要素**：动笔前按 beat / 主次 / 帧预算 / 进出场 / 禁用项过一遍 → `references/motion-brief.md`。
- **动感范式（默认开）**：按 `references/motion-patterns.md` 的范式与决策表给画面加运动。
- **上游体裁壳（必读）**：点名本 skill **仍须先加载**壳定向 → `references/format-directors.md`。
- **常见坑（必读）**：animate 相对帧 / reveal 方向口径 / exit 不支持 clip / subtitle 多行溢出 → `references/pitfalls.md`。

## 动感基线（默认开，避免成片像 PPT）

成片「像幻灯片」的根因几乎从不是能力不够，而是 manifest **没写动画**。`animate` / `kenBurns` /
`transition` 都是逐帧确定的合法手段 —— **组装时默认就加动感基线**，别等宿主回「静态图文」提示
才补（那是补救，不是目标）。范式与决策表见 `references/motion-patterns.md`。

默认基线（每条都应在组装时落地，除非有明确理由静态）：图片轨默认 `kenburns`；标题 / 数据卡 / 要点卡
默认滑入 `animate`（`x:115→50` + `opacity:0→1`，18 帧）；段落之间人为重叠 10–20 帧并放 `transition`；
过程 / 关系 / 对比用 `shape` + `animate` 程序化表达；发光 / 描边 / 投影用 `fx`；音画同步用 `audioViz`；
数据对比 ≥3 项用 `chart`（柱状/双轴/折线），2–4 个大数字用 `dataCard`（可 `countUp` 数位滚动）。
**全表见 `references/motion-patterns.md` §1.5。**

**保留纪律**：字幕卡（`subtitle`）按句首尾相接、硬切（不淡入），不加 `fadeFrames`（接缝闪背景）。

**不要**为「消静态提示」逐镜生成视频（H3）——Remotion 程序化动画已能注入生命感。H3 只用于需要**写实质感**（真实光影 / 运镜）的「英雄镜头」，按既有 `video` 轨接入（见工作流第 2 步）。

## 纪律

- **禁止用 bash 读 `src/remotion/**` 推契约**：真机两次会话复读 60–304 次（会话 19 单次 60 次）。字段认 `references/manifest-fields.generated.md`，**合法值 / 合法键 / 默认常量 / 行为语义认 `references/component-contract.generated.md`**，组合认 `references/manifest-contract.md`；均由源码机器生成。生成物没覆盖到的：**先在回复里点名缺口（引用条目名）再读源码，并把缺口写进交付未决项**——这是读源码的唯一合法前置。
- **禁止在推理里手排整片帧号**：帧窗由 builder / 脚本算，改一处只改内容表里那一条。
- **禁止未出 M1 就做美化**（出图 / 量像素 / 调色 / 读源码）：先让用户看到一条能播的。
- **一句一条字幕卡**：字数与展示时长匹配，不把长段落塞进一张卡。**卡的首尾必须相接**——`durationInFrames` 是屏上时长，每句延伸到下一句 `startFrame`（末句到总帧），句间不留空白帧；字幕卡由组件层硬切，别指望淡入淡出 → `references/subtitle-timing.md`。
- **探针帧清单前置**：第一次 spotFrames 前，先在回复里写出「判据 → 帧号」完整清单再调工具（一次采全 ≤8 帧）——浅规划会烧探针额度（3 次硬闸，第 4 次拒收转 draft）。
- **血缘**：video / image 轨的 `id` 必须填该素材的**画布节点 id**（宿主据此画制作链）；纯呈现轨（textCard / shape / transition）用本地 id。
- **素材引用**：`src` 只接受 `/canvas-studio/assets/...` 同源 URL，或**本项目资产目录内**的绝对路径（宿主会自动物化成同源 URL），**禁一切外链**。
- **缺素材会被直接拒收**：宿主在渲染前核对素材，缺失或引用不可用即 `CS-USER-ERR` **硬失败**（不落节点、不出片）。收到该错误时**不要原样重试**，先去补齐素材或改用已有画布资产。
- **video 轨时长以真值为准**：宿主用 ffprobe 复核并**按真值改写** `durationInFrames`；校正后若相邻轨不再重叠、转场失效，会连同明细一起拒收（`CS-USER-ERR`）。收到就按报错里的真值重排轨道与转场窗口，**不要原样重试**。
- **不要翻历史会话 / 旧项目考古**：要"以前怎么做的"就问用户，或只看本项目 `build/` 与资产目录；`cat projects.json`、遍历 `~/.videobuddy/sessions/` 属于**无效考古**（实测烧几分钟推理且带入无关先验）。
- **风险提示不是错误**：全片无 video 轨时宿主会回一条「图文卡片型」提示（静态占比 / 运动密度 / 镜头数命中），**这条路线是合法的**，不要为此改成逐镜生成视频。
- **草稿先行**：定稿落地 → **立即渲完整草稿落画布**给用户 → 按反馈迭代；自验只验**机器判据**（出画/重叠/数据保真/响度实测），审美归用户 → `references/verification.md`。
- **画面类判据必须看图本身**：`spotFrames` 出帧后逐张 `read_image(file_path=…)` 看成片像素；`inspect_image` 的 grid/bbox 只用于**定位疑点与精确数值**，`image2vl` 文字转述不可当事实，**禁止拿 manifest 字段自证画面效果** → `references/verification.md`。
- **预算前置**：references **按需取用**，bash 大输出落文件只回摘要；旁白先按 **4–5 字/秒** 卡预算，超了先改稿再合成。
- **有下一步就别停轮**：一段渲成功后直接推进下一段 / 下一节，不要停下来等用户点头。只有「审美取向、总时长、素材取舍」这类**只有用户能回答**的事才值得停；其余一律自己决定并在汇报里说明。
- **内容慢 vs 环境坏，先看工单再看内容**：返回文本里有一行 `工单：<执行者> · <认领状态> · <首帧> · 进度 · 用时`。
  - 出现「未认领 / 无首帧」或最小探针（1 轨 / 10 帧）仍 **>1s/帧** ⇒ **执行器链路问题**，停手去查（见「遇错处理」），**不要再缩 manifest 空转**；
  - 只有「已出首帧、进度在涨、msPerFrame 稳定」时，才值得怀疑内容复杂度。

## 遇错处理

> 完整错误码对照（含"该改什么 / 别做什么"）见 `references/errors.md`；下面是最高频的三类。

- **`CS-RENDER-TIMEOUT`**：先读返回文案里的诊断（「X 从未取走这张工单」/「已取单但 Ns 内一帧都没渲染」/「已渲染 Ns，进度 X%」）。前两种是**执行器链路**问题：不要重试同一份 manifest，也不要改画面，直接把诊断原文交给用户并建议重启客户端；只有第三种才考虑缩短时长 / 降分辨率。另外确认**没有误传 `projectId`**（省略即按当前项目解析）。
- **manifest 校验失败**：报错会定位到具体 `tracks[i]` 字段，按点改，不要整段重试。
- **`CS-RENDER-002`（客户端渲染失败）**：先确认素材可读（同源 URL 存在、格式受支持），再向用户说明。
