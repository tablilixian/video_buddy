---
name: canvas-studio-creation
description: Canvas Studio 画布视频创作规范（最高优先级，先行加载）：凡涉及生成图片/视频、分镜规划、AI 短片或漫剧创作的任务，第一个动作必须是调用 skill(name=canvas-studio-creation) 加载本规范——严格先于一切提问（ask_user_choice）与任何工具调用，禁止凭直觉先行澄清或先行动手。内容含点选式需求澄清与 Look 采集（5 项风格 tokens + 基调样张确认）、风格预设出口、分镜表与关键帧审批门禁、H3 视频提示词规范与完整画布工具链（详单分册于 references/，按步必读）。
---

# Canvas Studio 创作规范

在 DSH 画布工作台（canvas-studio）中创作 AI 短视频 / 漫剧时遵循本规范。产物会实时落到画布，用户可随时打断、重试单个节点。

> **加载时机铁律**：本规范必须在任务第一步被加载。若你已在提问或调用工具之后才读到本段，立即停止当前即兴流程，向用户说明「已加载创作规范，按规范重走需求澄清」，并从下方「需求澄清」第 ① 步重新开始。

> **分册结构**：本规范只保留路由级骨架；到具体步骤时**必须按指针先读对应分册**再执行。分册一览：需求澄清细则 `references/clarification.md`、工具链 `references/toolchain.md`、提示词写法 `references/prompt-writing.md`、风格预设与画风 `references/style-presets.md`、剧本创作 `references/screenplay.md`、分镜与逐镜执行 `references/shot-format.md`、一致性与返工 `references/consistency.md`。

## 执行模式与审批门禁（必须遵守）

- 项目有两种执行模式，工作流条上可见：**逐步确认** / **放手跑**。
- **逐步确认模式（默认）**：
  1. 需求不明确时先对话澄清，不要急着生成；
  2. 输出分镜表后必须调 `submit_storyboard_for_approval(storyboard=…)` 提交，然后结束回合等待用户；
  3. 用户在画布上方点击「批准」后（会自动恢复流程），才能调用 video_generate / video_composite；
  4. 未获批准时这些工具会直接报错——收到报错不要重试，等用户批准即可（image_generate 出概念图不受限）；
  5. 逐镜出图（image_generate 生成关键帧）完成后，必须调 `submit_keyframes_for_approval(summary=…)` 提交，然后结束回合等待用户点击「确认关键帧」；未确认前不要调用 video_generate / video_composite / compose_video。
- **分镜被驳回后（逐步确认模式）**：必须**逐镜**用 `ask_user_choice` 与用户确认——每个镜头一个问题，options 给「同意使用当前（推荐）/ 需要修改」两项（卡片自带自由输入框，用户可直接输入修改意见或点选同意）；全部镜头确认完毕后再调 `submit_storyboard_for_approval` 重新提交。
- **关键帧确认阶段（逐步确认模式）**：用户在画布上对关键帧做二次编辑（右键重试 / 修改提示词）后，仍需再次点击「确认关键帧」才继续——收到确认前的视频生成报错不要重试，等待即可。
- **放手跑模式**：用户已明确授权一路跑完；submit_storyboard_for_approval 与 submit_keyframes_for_approval 都会直接放行，无需等待。

## 需求澄清（骨架；完整细则见 references/clarification.md，**澄清开始前必读**）

开始策划前用 **ask_user_choice 工具**点选式确认「形态 + 风格」。骨架规则：

1. **一次只调一次 ask_user_choice，只问一个要素**，等结果回流再问下一个；**禁止**一次性输出完整方案整体确认，**禁止用纯文本列表提问**。
2. 提问顺序：① 产物形态（多镜头叙事短片 / 单镜精品短片）→ ② Look 采集（2a 提取 → 2b 样张确认 → 2c 预设出口，细则见 `references/look.md`）→ ③ 画幅/总时长。
3. **跳过规则**：画幅/总时长已项目预置 → 视为已确认不要问；用户已点名具体技能或风格 → **Look 采集整体跳过**（点名技能的 `skill(name=…)` 加载照常执行）；画布已有 role=style 参考或参考视频便签 → 2a 直接归纳、不再问风格；镜头数按「总时长 ÷ 单镜 8–10s」推导、受众自行推断，均不问。
4. options 2–4 个短标签，**只有用户已说出的内容能命中时才标「（推荐）」**并附一句理由，拿不准就不标；**仅出口路径（2c）**逐字使用风格预设表首列的预设名（表在 `references/style-presets.md`）。
5. 全部确认后输出简短需求摘要（形态/**Look 来源与 tokens**/画幅/总时长/建议镜头数，预置标「项目预置」、推断标「默认」，未命中预设如实写「未匹配专属风格」），再进入分镜规划；放手跑模式跳过提问，自行假设并列出假设清单。

推荐判定关键词表、逐字选项模板、预置细则与超时处理见 `references/clarification.md`。

## 核心规则（必须遵守）

- 所有需要图片输入的工具只接受 `filename`（Drama Backend 服务器文件名），**不能直接传图片 URL**。
- **两类 filename，可消费性不同**：`upload_image` 返回的 `ref-xxxxxxxx.png` 是**上传句柄**，可直接入参；生成类工具结果里的 `filename` 字段（`img_01287_.png` 一类）是**后端产物名**，**不能直接入参**（约 0.1s 内 500）。
- 生成是同步 API：调用会阻塞到产物返回；「打断」只是本地中断 fetch，服务端任务不回收。
- 把**产物**用作下游输入有两条路：① 引用画布节点 `@ref[节点标题]`——Host 会自动把产物名换成可用句柄；② 显式 `upload_image(imageUrl=产物url)`。只有外部 URL 图片必须先上传。**对话附件（用户贴图）豁免**：filename 由画布后台自动回填（或 `@ref` 解析时按需上传），不要对附件再调 upload_image。
- 同一项目保持同一 aspectRatio，不要混用。注意视频类工具（video_generate / video_composite）只支持 16:9 / 9:16，传 1:1 会静默落到 16:9；1:1 仅限图片类工具使用。
- 调用 image_generate / video_generate / video_composite 时，把本次用到的参考图产物 URL（此前工具结果里的 url 字段）填进 `sourceUrls` 参数——画布会据此画出流程箭头（血缘边），用户靠它理解制作链路。
- 逐镜生成关键帧/视频时，把 `shotRefs` 参数设为该镜分镜卡（提交分镜后工具结果会列出每张卡的标题，如「分镜 1 · 特写」）——画布会把产物连到对应分镜卡并排在其右侧，形成逐镜对照。
- **你没有视觉能力——任何「直接看图」的尝试都必然失败**（报错 `model does not declare image input` / `switch to an image-capable model to read images`）。禁止一切变体：用文件读取类工具读本地图片路径（`file_path`、`/canvas-studio/assets/...`）、把图片 URL/路径塞进任何工具参数当图用、在回复里内嵌图片引用让模型分析。不要在生成后宣称「我看一下效果」然后尝试读图。
- **用户在对话里贴的图片附件会被画布自动转存**（2026-09-05 起）：附件落地为画布参考素材节点（**自动标记为参考**，进参考托盘与 list_references），消息正文会自动追加 `@ref[文件名]` 引用标记。**逐字使用消息里的 `@ref[...]` token** 当 filename/filenames 参数——标题就是文件名（剪贴板粘贴常为 UUID 形态），不要改写或「美化」。不要试图直接「看」附件内容；需要判断画面用 `image2vl(filename="@ref[文件名]")`（支持 token，附件无需先 upload_image）。
- **产物 URL（image_generate / video_generate 等返回的 `url`）只用于展示给用户、画布血缘与 `upload_image` 取 filename，不是给你做视觉输入的**。需要确认画面内容时，唯一合规手段是图像分析工具 `image2vl`：先 `upload_image(imageUrl=url)` 拿到 `filename`，再 `image2vl(filename=…, prompt=「描述/检查…」)` 拿文字结果；不需要内容判断就直接文字汇报产物（尺寸/数量/URL）进入下一步。
- **风格 skill 优先原则**：激活某个风格 skill 后，其流程步骤、选项卡与风格规则与本规范冲突时，**以风格 skill 为准**——风格 skill 是该垂直方向的特化，本规范是通用底座。但以下安全底线**不参与此原则**，任何 skill 不得绕过：① 执行模式与审批门禁（submit_screenplay / submit_keyframes 等待与放行语义）；② 一致性硬约束（资产卡 lockedPrompt 逐字节复用、qc_shot 质检闭环、镜位版本 replaces）；③ 工具参数硬限制（filename 约定、参考图数量上限、16:9/9:16）。

## 提示词写法（骨架；分册 references/prompt-writing.md **写前必读**）

- **图像**（image_generate / character_generate）写 prompt 前**必须先加载对应 skill**：纯文生图 → `z-image-prompt-writing`；图生图/改图 → `qwen-image-edit-writing`；再读 `references/prompt-writing.md`。
- **视频**（video_generate / video_composite）写 prompt 前**必须先加载 `h3-prompt-writing`** 并读 `references/prompt-writing.md`（Ref2VA 读 ref-en.txt 六段式 / FL2VA 读 base-en.txt 三段式）。
- **硬约束**（不依赖 skill 也要遵守）：文生图路径**禁止传 `negativePrompt`**（不生效且浪费，约束写进正向提示词）。
- skill 加载失败时不卡流程：按分册里的降级骨架写，并在回复开头说明「未按完整规范执行（skill 加载失败）」。

## 标准工作流

**入口分流（动手前先判断手里有什么素材）**：
- 用户在澄清第 ① 步选了**单镜精品短片** → 走**单镜简化流程**：澄清 → 创意策划（prompt_enhance）→ 轻量单镜剧本（write_screenplay，单镜版规则见 `references/screenplay.md` 第 0 条；逐步确认模式照常 submit_screenplay_for_approval）→ 定妆照/场景概念图（第 4–5 步）→ 一行分镜表经 submit_storyboard_for_approval 获批 → video_composite 参考组合（Ref2VA）一镜直出（≤15s，prompt 按六段式写）；不满意可同 prompt 重试并列候选；单段视频即成片，无需逐镜出图与拼接。
- 纯文字创意 → 从第 1 步全流程走。
- 带参考图 → 参考图按 role（character/style/frame）用于定妆锚点与关键帧（见第 4 步）；**风格向的图在澄清第 ② 步先归纳成 tokens**（见 `references/look.md`）。**对话贴图就是参考图**：附件已自动标记为参考（list_references 可见），正文 `@ref[文件名]` token 可直接作 filename——看到用户贴图不要以「没有参考图」为由另造素材。
- 带参考视频 → Host 已自动抽帧并标 style/frame 参考、生成「风格归纳」便签：澄清第 ② 步先 list_references 读便签（直接用结论、不重复归纳），再按结论用 image_generate 传风格参考图对齐各镜。
- 二次修改已有项目 → 不重跑澄清与分镜，直接对要改的节点右键重试或在对话中说明调整方向（steer）。

1. **需求澄清 + Look 采集**：逐步确认模式逐项点选提问（先读 `references/clarification.md`）；第 ② 步按 `references/look.md` 采集 5 项 tokens 并出 1 张基调样张确认（image_generate 出、落画布）；放手跑模式自行假设并说明。
2. **创意策划**：用 prompt_enhance 打磨整体创意描述。
2b. **剧本创作 → 审批**（两种形态必经）：读 `references/screenplay.md`，用 write_screenplay 落剧本（单镜走其第 0 条轻量版；上游风格 skill 的「故事大纲」步骤就是本剧本节点，**禁止另建大纲节点**），逐步确认模式再调 submit_screenplay_for_approval 等待批准。
3. **分镜规划 → 审批**：读 `references/shot-format.md`，按其表格输出分镜表（含「衔接」列 chain/cut/bridge），逐步确认模式下调 submit_storyboard_for_approval 等待批准。
4. **参考素材预处理 + 建一致性资产卡（含角色的片子必经）**：读 `references/consistency.md`「参考素材预处理」节——character_sheet 建卡（lockedPrompt 先经用户确认）、附件 @ref 直用、参考视频归纳。
5. **定妆锚点**：按 consistency.md 执行——有资产卡直接用其锚点（四视图拼图整图，list_references 的 assets 取 filename），无卡出定妆照；含明确场景的片子**同时生成场景概念图**（第 9 步 Ref2VA 的必备输入，缺了只能降级 FL2VA）。
6. **逐镜出图**：按 consistency.md「逐镜出图」执行——prompt 以 **第 ② 步 Look tokens + 该角色 lockedPrompt** 原样开头（均逐字节复用），后接本镜 NEW ACTION / CAMERA；filenames 传 `[角色锚点拼图, 场景概念图]`（≤3 张），**并传 shotRefs=[该镜分镜卡标题]**。
6a. **逐镜质检（QC gate，出图后必经）**：按 consistency.md「质检闭环」执行——每镜调 qc_shot（shotRefs 必传）；PASS 不重跑 / FAIL 只重跑该镜 ≤2 次 / exhausted 上报用户仲裁 / WARN 请用户确认。
6b. **关键帧确认**：全部镜头出图完成后，逐步确认模式下调 submit_keyframes_for_approval(summary=…) 提交并结束回合等用户确认；放手跑模式跳过。
7. **上传**：对每个镜头图调 upload_image 拿 filename（可并行）。
8. **文案策划**：用 write_script 产出结构化文案（广告词/对白/BGM/SFX/字幕）——对白写入视频提示词 `<d>[语言]原话</d>`，BGM 写入 non_diegetic_music:，音效写入 overall_soundscape:；第 10 步作 scriptId 传入成片节点。
9. **逐镜视频（参考组合优先）**：读 `references/shot-format.md`「逐镜视频参考组合与镜头衔接」——默认 video_composite 多参考 Ref2VA（角色锚点 + 场景概念图 + 可选姿态帧，≤6 张），仅同镜首尾转场用两图 FL2VA，都不适用才退 video_generate；prompt 一律先加载 h3-prompt-writing 按规范重写（subject_definitions 逐字复用 lockedPrompt、retention_analysis 标 fully_preserved）；**chain 镜生成前必须先 extract_last_frame 取上一镜真实末帧作首帧**；用户返工重做某镜传 `replaces=<旧版节点 id>`（先 list_shots 拿 id）。
10. **成片合成**：读 `references/shot-format.md`「成片合成与自检」——compose_video 拼接已有片段（缺省只收有效片段；1 个片段=一镜整出也合法；失效版本自动排除），可传 clipIds / bgmNodeId / scriptId；统一调色与 BGM 淡入淡出默认开启。**音轨策略自动**：单镜保留原生环境声、**多镜一律丢弃（故多镜必须给 BGM，否则成片无声）**。**BGM 时长必须 ≥ 成片真实时长**（先 `list_shots` 拿真实时长求和，再按该值留余量生成；短了 compose_video 直接报错）。**严禁再用 video_generate / video_composite 从图片重新生成视频——成片只由已有片段拼接而成。**
