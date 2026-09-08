---
name: canvas-studio-creation
description: Canvas Studio 画布视频创作规范（最高优先级，先行加载）：凡涉及生成图片/视频、分镜规划、AI 短片或漫剧创作的任务，第一个动作必须是调用 skill(name=canvas-studio-creation) 加载本规范——严格先于一切提问（ask_user_choice）与任何工具调用，禁止凭直觉先行澄清或先行动手。内容含点选式需求澄清五要素、风格预设两级追问（决定加载哪个风格 skill）、分镜表与关键帧审批门禁、镜头参数词汇、H3 视频提示词规范与完整画布工具链。
---

# Canvas Studio 创作规范

在 DSH 画布工作台（canvas-studio）中创作 AI 短视频 / 漫剧时遵循本规范。产物会实时落到画布，用户可随时打断、重试单个节点。

> **加载时机铁律**：本规范必须在任务第一步被加载。若你已在提问或调用工具之后才读到本段，立即停止当前即兴流程，向用户说明「已加载创作规范，按规范重走需求澄清」，并从下方「需求澄清」第 ① 步重新开始。

## 执行模式与审批门禁（必须遵守）

- 项目有两种执行模式，工作流条上可见：**逐步确认** / **放手跑**。
- **逐步确认模式（默认）**：
  1. 需求不明确时先对话澄清，不要急着生成；
  2. 输出分镜表后必须调 `submit_storyboard_for_approval(storyboard=…)` 提交，然后结束回合等待用户；
  3. 用户在画布上方点击「批准」后（会自动恢复流程），才能调用 storyboard_generate / video_generate / video_composite；
  4. 未获批准时这些工具会直接报错——收到报错不要重试，等用户批准即可（image_generate 出概念图不受限）；
  5. 逐镜出图（image_generate 生成关键帧）完成后，必须调 `submit_keyframes_for_approval(summary=…)` 提交，然后结束回合等待用户点击「确认关键帧」；未确认前不要调用 video_generate / video_composite / compose_video。
- **分镜被驳回后（逐步确认模式）**：必须**逐镜**用 `ask_user_choice` 与用户确认——每个镜头一个问题，options 给「同意使用当前（推荐）/ 需要修改」两项（卡片自带自由输入框，用户可直接输入修改意见或点选同意）；全部镜头确认完毕后再调 `submit_storyboard_for_approval` 重新提交。
- **关键帧确认阶段（逐步确认模式）**：用户在画布上对关键帧做二次编辑（右键重试 / 修改提示词）后，仍需再次点击「确认关键帧」才继续——收到确认前的视频生成报错不要重试，等待即可。
- **放手跑模式**：用户已明确授权一路跑完；submit_storyboard_for_approval 与 submit_keyframes_for_approval 都会直接放行，无需等待。

## 需求澄清（先问产物形态，再问风格；逐步确认模式下必须点选式提问）

开始策划前用 **ask_user_choice 工具**确认「形态 + 风格」，规则：

1. **一次只调一次 ask_user_choice，只问一个要素**；收到工具结果（用户的选择自动回流）后再问下一个。**禁止**一次性输出完整方案让用户整体确认，也**禁止用纯文本列表提问**——用户要点按钮，不是打字。
2. options 给 2–4 个短标签候选项，推荐项末尾加「（推荐）」；例如：
   question: 「想走哪种风格大类？」options: ["商业推广", "动画叙事（推荐）", "讲解科普", "艺术创意"]
   列举类问题（如「需要调整哪些视觉细节？」「要保留哪些元素？」）传 multiSelect=true 让用户勾选多项，不要拆成多次单选提问。
3. 提问顺序：① 产物形态 → ② 风格（**两级追问：先大类 → 再具体风格**）。开放要素（品牌名等）靠卡片自带的自由输入框收集，无需传参。
   - **项目预置跳过规则**：画幅与目标总时长若已由项目预置（系统提示「Canvas Studio 项目预置」小节里有列），视为用户已确认的事实——**不要**就画幅、总时长或镜头节奏提问，直接采用；用户在对话中明确给出不同值时以用户最新指示为准。
   - **节奏/镜头数不问**：镜头数按「目标总时长 ÷ 单镜 8–10s」推导（单段视频上限 15s）；无预置时按 30s 惯例推导并在需求摘要里标注「默认」。
   - **受众与用途不问**：由你从创意自行推断，并在需求摘要里标注「默认」。
   - **无预置时补问**（当前会话没有「Canvas Studio 项目预置」小节才做，一次问完画幅、一次问完时长）：画幅 options: ["16:9 横屏（推荐）", "9:16 竖屏"]；时长 options: ["15s 快节奏", "30s 标准短片（推荐）", "45s+ 完整叙事"]。
   - **第 ① 步形态题**：question「成片想要什么形态？」options: ["多镜头叙事短片", "单镜精品短片"]（推荐项按用户需求加「（推荐）」；**单镜精品短片** = 一镜 ≤15s 直出，适合社媒传播，走下方「单镜简化流程」；**多镜头叙事** = 标准工作流全流程）。
   - **第 ② 步风格题必须问两次**（避免一次摆 8 个选项）：
     - 2a **大类**：options 用 4 个大类标签 —— `商业推广` / `动画叙事` / `讲解科普` / `艺术创意`（推荐项按用户需求加「（推荐）」）。
     - 2b **具体风格**：用户选中大类后，再问该大类下的 2 个具体风格，options **逐字使用下方「风格预设」表首列的预设名**（如「极简产品广告」「3D 动画短片」），不要改写、缩写或自造风格名（否则画布匹配不到该风格的预览图与对应 skill）。
   - 分类对照：`商业推广` = 极简产品广告 + 品牌宣传；`动画叙事` = 3D 动画短片 + 合作游戏开场；`讲解科普` = 纸艺定格讲解 + 纸拼贴讲解；`艺术创意` = 手绘实景融合 + MV 字幕。
4. 用户回答「你定 / 随便 / 按你的建议」时，该项采用推荐项并在最终摘要里标注「默认」。
5. 全部确认后，输出一段简短需求摘要（含：形态、风格、画幅、目标总时长、建议镜头数——预置来源标「项目预置」，推断或推荐项标「默认」），然后进入分镜规划；分镜表仍须经 submit_storyboard_for_approval 审批。
6. **放手跑模式**跳过提问：自行假设未预置要素并在回复开头列出假设清单。
7. ask_user_choice 会阻塞到用户点击或超时；收到超时提示时按推荐项继续并说明是默认假设。

## 核心规则（必须遵守）

- 所有需要图片输入的工具只接受 `filename`（已上传到 Drama Backend 的服务器文件名），**不能直接传图片 URL**。
- 图片作为下游输入前，必须先调 `upload_image(imageUrl=产物URL)` 得到 `filename`。
- 生成是同步 API：调用会阻塞到产物返回；「打断」只是本地中断 fetch，服务端任务不回收。
- 本项目产物图片节点落盘时已自带 filename（list_references 或 @ref[显示名] 可直达），不要对每次生成产物重复调 upload_image；只有外部 URL 图片才需要先上传拿 filename。**对话附件（用户贴图）同样豁免**：filename 由画布后台自动回填（或工具解析时按需自动上传），`@ref` 解析会自动拿到 filename——不需要、也不要对附件再调 upload_image。
- 同一项目保持同一 aspectRatio，不要混用。注意视频类工具（video_generate / video_composite）只支持 16:9 / 9:16，传 1:1 会静默落到 16:9；1:1 仅限图片类工具使用。
- 调用 image_generate / video_generate / video_composite 时，把本次用到的参考图产物 URL（此前工具结果里的 url 字段）填进 `sourceUrls` 参数——画布会据此画出流程箭头（血缘边），用户靠它理解制作链路。
- 逐镜生成关键帧/视频时，把 `shotRefs` 参数设为该镜分镜卡（提交分镜后工具结果会列出每张卡的标题，如「分镜 1 · 特写」）——画布会把产物连到对应分镜卡并排在其右侧，形成逐镜对照。
- **你没有视觉能力——任何「直接看图」的尝试都必然失败**（报错 `model does not declare image input` / `switch to an image-capable model to read images`）。禁止一切变体：用文件读取类工具读本地图片路径（`file_path`、`/canvas-studio/assets/...`）、把图片 URL/路径塞进任何工具参数当图用、在回复里内嵌图片引用让模型分析。不要在生成后宣称「我看一下效果」然后尝试读图。
- **用户在对话里贴的图片附件会被画布自动转存**（2026-09-05 起）：附件落地为画布参考素材节点（**自动标记为参考**，进参考托盘与 list_references），消息正文会自动追加 `@ref[文件名]` 引用标记。**逐字使用消息里的 `@ref[...]` token** 当 filename/filenames 参数——标题就是文件名（剪贴板粘贴常为 UUID 形态），不要改写或「美化」。不要试图直接「看」附件内容；需要判断画面用 `image2vl(filename="@ref[文件名]")`（支持 token，附件无需先 upload_image）。
- **产物 URL（image_generate / video_generate 等返回的 `url`）只用于展示给用户、画布血缘与 `upload_image` 取 filename，不是给你做视觉输入的**。需要确认画面内容时，唯一合规手段是图像分析工具 `image2vl`：先 `upload_image(imageUrl=url)` 拿到 `filename`，再 `image2vl(filename=…, prompt=「描述/检查…」)` 拿文字结果；不需要内容判断就直接文字汇报产物（尺寸/数量/URL）进入下一步。
- 剧情推演工具（deduction）已移除（后端不支持 404）；下一帧推演改用 image2vl 分析代替。

## 一致性资产卡与注入纪律（多镜头片子的硬规矩）

同一角色在不同镜头「长不一样」是本工作流最典型的失败。防漂移靠三条硬规矩：

1. **先建卡**（第 4 步）：含角色的片子在分镜规划前，为每个角色调 `character_sheet` 建资产卡 —— filename 传定妆照/角色设计图，name 用稳定角色名（如「女主」，不加序号），lockedPrompt 写该角色的 SAME 块（外貌 / 发型 / 服装 / 配色 / 光感，写成可跨镜复用的固定描述）。
   - lockedPrompt **必须先在对话里列出并让用户确认**（ask_user_choice：「确认冻结 / 要修改」）再传入工具；冻结后它就是全片的权威描述。
   - 写错或要换造型 → 重调 `character_sheet` 传**同名**整体覆盖（锚点分图与冻结描述一起换），不要新建第二张卡。
2. **每镜逐字节复用**：镜头里出现该角色时，`image_generate` 的 prompt **必须以资产卡 lockedPrompt 原样开头** —— 一字不改、不翻译、不润色、不换标点；后面才接本镜的 NEW ACTION / CAMERA 段（本镜动作、景别、运镜、光线）。
   - 参考图 `filenames` 优先取该卡锚点分图（常取「正面特写 + 全身」两张）；多角色同镜按卡拼，仍守 image_generate ≤3 张上限。
   - 视频侧（H3 六段式）：`subject_definitions:` 中该角色的定义句**逐字复用 lockedPrompt**，`retention_analysis:` 标 `fully_preserved`；不要另写一套外貌描述，也不要在片段里换服装/发型。
3. **取锚点先查卡**：每个新回合（以及跨会话继续）先调 `list_references` 读 `assets`（id / name / lockedPrompt / 锚点分图 filename）—— **这是锚点的唯一权威来源**；禁止凭记忆或上下文复述外貌，也不要临时换成别的参考图。

**没有资产卡时**（用户没给定妆照，或 character_sheet 不可用）：退回第 5 步 image_generate 出定妆照，并把该照 prompt 里描述角色外貌的整段当作**临时 lockedPrompt** 逐字复用 —— 规矩不变，只是锚点是单张定妆照而非四视图分图。

## 工具链（全部工具见下表；write_screenplay / submit_screenplay_for_approval 见工作流第 2b 步，write_script / compose_video 见第 8 / 10 步）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| write_screenplay | 剧本落画布（标题「剧本」，重复调用原地更新；= 上游风格 skill 的故事大纲/story-outline/叙事主轴，禁止另建大纲节点） | screenplay（完整剧本 markdown）、summary? |
| submit_screenplay_for_approval | 剧本提交审批（逐步确认模式下分镜规划前必经） | summary? |
| prompt_enhance | 增强提示词 | prompt |
| ask_user_choice | 点选式提问（澄清阶段必用） | question、options[]（推荐项加「（推荐）」）、allowFreeText?（缺省开启自由输入框，false 隐藏）、multiSelect?（true 为多选，答案以「、」拼接） |
| submit_storyboard_for_approval | 分镜表提交审批（逐步确认模式必经） | storyboard（分镜表 markdown）、summary? |
| submit_keyframes_for_approval | 关键帧提交确认（逐步确认模式逐镜出图后必经） | summary? |
| storyboard_generate | 文本 → 格子分镜图 | prompt（每行一个场景）、gridnum、filename? |
| storyboard_split | 格子分镜图 → 单镜（每个镜头一张独立图） | filename（storyboard_generate 返回的 Drama 文件名）、gridnum（4/6/9）、sourceUrls? |
| image_generate | 文生图 / 图生图（单或多参考）；style=realistic 写实（默认）/ anime 卡通（仅纯文生图，传参考图则回退写实图生图） | prompt、aspectRatio、style?（realistic/anime）、filename?（单参考图）、filenames?（最多 3 张多参考图）、negativePrompt?、shotRefs?（关联分镜卡） |
| character_generate | 角色设计图 → 角色立绘 / 三视图（**只要一张立绘图、不建资产卡**；一致性锚点走 character_sheet） | filename（角色设计图，来自 upload_image）、aspectRatio?、shotRefs?（关联分镜卡） |
| character_sheet | 定妆照 / 角色设计图 → **一致性资产卡**：四视图立绘 + 切分分图（进参考托盘）+ 冻结 SAME 块；**同名卡整体覆盖**（纠正冻结描述的路径） | filename（定妆照/设计图，来自 upload_image 或 `@ref[...]`）、name（稳定角色名，如「女主」）、lockedPrompt（与用户确认后的 SAME 块）、negativePrompt?、sourceUrls? |
| inpaint | 【暂不可用】图像修复 / 编辑（Inpainting）：功能保留未开放，调用会报错，请勿调用 | — |
| style_transfer | 【暂不可用】风格迁移：功能保留未开放，调用会报错；风格统一改用 image_generate 传参考图 | — |
| image2vl | 画面分析（VLM） | filename、prompt |
| video_generate | 图生视频（FL2VA：文生 / 首帧图生视频） | prompt、filename?（首帧图）、duration（默认 5s）、shotRefs?（关联分镜卡） |
| video_composite | 多图合成视频（FL2VA 首尾帧 / REF2VA 多参考） | prompt、filenames[]（2 张 = 首尾帧 FL2VA，按时间顺序；≥3 张 = 多参考 Ref2VA，按用途组合：定妆照/场景概念图/姿态关键帧，最多 6 张）、duration（默认 10s）、shotRefs?（关联分镜卡） |
| qc_shot | **逐镜一致性质检**：视觉模型对照资产卡 lockedPrompt 核对画面（外貌/服装/道具/配色光感）→ PASS / FAIL / WARN + 漂移项，结论写回该节点 | filename（被检镜头图）、expect?（缺省取资产卡 lockedPrompt）、shotRefs?（**必传**，重跑预算按镜累计）、budget?（默认 2） |
| upload_image | 上传本地/产物图片到 Drama Backend 拿 filename（任何图片作为下游输入的必经前置） | imageUrl（产物 URL 或本地路径） |
| write_script | 产出结构化文案（对白/字幕/BGM/SFX 说明）落到「文案」节点 | script（markdown） |
| list_shots | **镜头清单**：列画布上所有视频片段（节点 id / 分镜卡 / 版本号 / 状态 / 时长）。**返工或精确合成前必调** | includeRetired?（默认只列有效片段） |
| compose_video | 拼接时间轴已有视频片段成成片（可混 BGM / 挂文案）。**缺省只取有效片段**（失效版本自动排除） | clipIds?、bgmNodeId?、scriptId?、colorGrade?（默认开，统一调色；false 关闭） |
| list_references | 列出当前项目参考图（角色/风格）与**一致性资产卡**供 `@ref[显示名]` 引用；返回 `references` / `assets` / `notes` 三段 | — |

**占位工具（无后端，仅返回替代路径）**：`music_generation`（BGM 生成）、`tts_voiceover`（旁白配音）、`subtitle_burn`（硬字幕烧录）——canvas-studio 当前不具备这三项能力。上游 skill 流程要求调用它们时照常调用，工具会返回可操作降级路径（BGM→用户上传节点 + compose_video bgmNodeId；配音/字幕→write_script 文案节点 + H3 提示词处理），不要报错或跳过流程。上游 skill（如 minimalist-product-ad-generator）中出现的 `music-2.6` 即 `music_generation` 占位工具，不是独立工具。

**视频供应商（不要主动向用户提问选哪家）**：视频由「供应商」产出，可在设置页切换（默认 Drama），也可用 `provider` 参数对单次生成临时指定（取值 `drama` / `fal`）。**不要主动询问用户用哪个供应商，也不要提供切换选项**——除非用户明确要求，否则一律用默认值出片。重试画布节点时会自动沿用该片原来的供应商，无需你干预。

**视频生成参数现状（`model` / `resolution` / `generateAudio`）**：

- **`model`（h3 / seedance2）：仍是占坑**——两个供应商都不支持模型切换，传 `seedance2` 会收到「暂未接入」提示并按 h3 出片。上游 skill 若要求「视频模型选项卡（H3/Seedance）」，一律按默认执行，**不要向用户提问「用 H3 还是 Seedance」**——选项未生效，问完也无法按选择执行。
- **`resolution`（768p / 1080p / 720p / 2k）：仅 fal 生效**——768p/2k 直通；720p 升档为 768P、1080p 升档为 2K（升档费用更高，会返回提示）。Drama 侧依旧忽略并回「暂未接入」提示。**不要为分辨率向用户提问**（除非用户明确要求指定）。
- **`generateAudio`：仍是占坑**——当前两家都不出原生音频轨，传 `true` 会收到提示且成片无音频。

供应商差异（你只需知道，不需要向用户解释）：Drama 多参考最多 6 张、fal 9 张；Drama 不支持 1:1（自动降级 16:9）、fal 原生支持；fal 的时长下限是 5 秒（更短会被钳到 5 并提示）。改用 fal 需用户先在设置页配置 fal API Key，未配置时工具会直接报「未配置 fal API Key」——此时按默认供应商（Drama）重跑即可，不要追问用户要 Key。

## 图像提示词写法（先加载 skill 再写，必须遵守）

生成图片（`image_generate` / `character_generate`）前**必须先用 `skill` 工具加载对应规范**，不要凭记忆写 prompt：

- **纯文生图**（`image_generate` 不传参考图，含 `style=anime`）：加载 `z-image-prompt-writing`。核心 —— 九段式完整场景描述（主体/环境/打光/风格媒介/技术细节/约束）、**禁止传 `negativePrompt`**（Z-Image-Turbo 忽略负向提示词，约束一律改写成正向表述）、画面要出现文字时用引号给出确切文本并锁定字体排版。
- **图生图 / 改图**（`image_generate` 传参考图、`character_generate`）：加载 `qwen-image-edit-writing`。核心 —— 指令式四段式（操作 + 目标 + 规格 + **保留子句**），保留子句必写；复杂改动拆成链式多步，每步重申约束。

两条硬约束（不依赖 skill 也要遵守）：

1. 文生图路径**禁止传 `negativePrompt`** —— 不生效且浪费，约束写进正向提示词。
2. `inpaint` / `style_transfer` **暂不可用，禁止调用**；局部改写需求走 `image_generate` 传参考图 + 保留子句实现。

skill 加载失败时：文生图按九段式骨架自行写（务必禁用 negativePrompt），图生图按四段式写，并在回复开头说明「未按完整规范执行（skill 加载失败）」，不要卡流程。

## 视频提示词写法（MiniMax H3 规范：先加载 skill 再写，必须遵守）

生成视频（video_generate / video_composite）前**必须先用 `skill` 工具加载 `h3-prompt-writing`**，并按模式读该 skill 资源目录下的对应 references 文件——不要凭记忆或一句话摘要写 prompt：

- **Ref2VA 多参考（video_composite ≥3 张）**：读 h3-prompt-writing 的 `ref-en.txt`，按六段式写。
- **FL2VA（video_generate 单图 / video_composite 两图首尾帧）**：读 h3-prompt-writing 的 `base-en.txt`。

对白标签、说话人 ID、运镜词汇、镜头切分等基础语法两种模式共用，以上游 references 为准。

**Ref2VA 六段式最小骨架**（保证下限；完整规则与示例读 h3-prompt-writing 的 `ref-en.txt`）——六段按序、正文英文（对白与画面内文字保留原语言）：

1. `subject_definitions:` 每个要锁定的内容一行定义：`<Subject 1> is the <角色> in <Picture 1>, with <外貌/服装特征>.`、`<Subject 2> is the <场景环境> in <Picture 2>, featuring <地标/光位>.`——`<Subject N>` 定义角色/场景等可复用内容；仅作来源的图不设独立 `<Picture N>` 条目，直接在 Subject 定义里引用。
2. `summary:` 以 `[reference generation]` 开头的一句话任务总结，引用已定义的标签。
3. `retention_analysis:` 每个标签一行：`<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - <保留哪些特征>.`（标记四选一：fully_preserved / partially_preserved / attribute_transfer / weak_reference）。
4. `detailed_description:` 主体（英文 350–500 词）：先 1–2 句风格定调，再 `[Shot 1]`、`[Shot 2] At 00:03.000, ...` 沿时间轴写构图/动作/运镜/台词；`<Subject N>` 在首次出现处引用、后续沿用不重定义；对白 `<d>[语言]原话</d>` 逐字保留，说话人用稳定 ID (S1) / (S2)。
5. `overall_soundscape:` 1–4 句环境音与动作音总结。
6. `non_diegetic_music:` 1–3 句 BGM（乐器/速度/强弱变化，不写情绪词；无则 N/A）。

**FL2VA 降级骨架（h3-prompt-writing 加载失败时用，勿卡流程）**：首行对齐指令——video_generate 单首帧固定 `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`；video_composite 两图首尾帧固定 `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`（S.SS = 时长两位小数）。随后空行 + 三字段：`integrated_multimodal_description:`（沿时间轴的画面/动作/运镜/台词）、`overall_soundscape:`（环境音 1–4 句）、`non_diegetic_music:`（BGM 1–3 句，无则 N/A）；总长控制在 200 词内，对白用 `<d>[语言]原话</d>` 逐字保留不翻译。降级骨架只覆盖 FL2VA；要走 Ref2VA 而加载失败时，按上方六段式骨架写，并在回复开头说明「未按完整规范执行（skill 加载失败）」。

## 风格预设（8 类垂直方向，需求澄清第 ④ 步从这里点选）

选中风格后，除遵守上方通用 H3 规范外，额外套用该类的「风格约束」；涉及字幕/旁白/音乐时一律按末尾「能力边界」映射，不要承诺画布内烧录或自动作曲。

**8 类风格的完整流程都来自 MiniMax-H3 上游 skill：确定风格后立刻用 `skill` 工具加载对应 skill，再按其原版 STEP 流程与选项卡门逐项推进。**

**调用语法（必须严格遵守，否则工具报错）**：`skill(name="英文原名")`，例如 `skill(name="minimalist-product-ad-generator")`。

- ① `name` 必须是会话 skill catalog 里列出的**英文 kebab-case 原名**（见下表每行末列）。
- ② **禁止**传中文风格名（如「极简产品广告」）、**禁止**带引号 / 反引号 / 空格、**禁止**缩写或改后缀（如把 `minimalist-product-ad-generator` 写成 `minimalist-product-ad` 会报 unknown）。
- ③ 一次只加载一个 skill。
- ④ 内容已出现在本对话里的 skill **不要重复调用**（重复调用会失败）。
- ⑤ 加载失败时先核对 name 是否与 catalog 完全一致（一字不差），改对后**只重试一次**，不要连续换名试错。
- ⑥ **两次仍失败就不要卡住**：直接按下方「标准工作流」+ 该风格行的「流程差异 / 关键约束」继续推进，并在回复开头说明「未按原版 skill 细节执行（加载失败）」。原版 skill 只是补充 STEP 细节，缺它也能用本规范的工具链完成成片。

各 skill 的 BGM/配音/字幕步骤用占位工具 music_generation / tts_voiceover / subtitle_burn 获取降级指引。详细 H3 提示词规范可另加载 `h3-prompt-writing`。

| 预设 | 适用 | 流程差异 / 关键约束 / 对应 skill |
| --- | --- | --- |
| 极简产品广告 | 电商 / 新品发布极简风广告短片 | 先确认产品与变体→提炼卖点→写简洁英文广告文案→分镜与音乐节拍同步；禁用 KOC 口播、普通剪辑、屏幕演示。H3 提示词走电影感极简构图、少元素、干净背景。完整流程加载 `minimalist-product-ad-generator`。 |
| 3D 动画短片 | 完整风格化 3D 动画 | 走标准动画流程：简报→大纲→角色/环境设定卡→镜头规划→故事板→逐镜→合成配乐；强调角色一致、场景连续、节奏精准。定妆锚点用 3D 角色设定图。完整流程加载 `3d-animation-short-generator`（原版 STEP 0–9：简报/大纲/角色卡/场景卡/六列镜头表/自检门/分镜/逐镜（H3 固定，无模型选择）/拼接+BGM）。 |
| 纸艺定格讲解 | 科学/教育/通识的手工纸艺讲解 | 纸艺角色 + 分层立体布景 + 道具；转场用纸张翻折/位移；H3 提示词强调 papercraft、手工质感、定格停顿。完整流程加载 `papercraft-stop-motion-explainer`。 |
| 品牌宣传 | Logo/产品图/官网截图→品牌短片 | 选叙事方向→精确节奏点→生成素材(图/视频/旁白/音乐)→剪辑→明确 CTA；突出功能与使用场景。完整流程加载 `brand-promo-video-generator`。 |
| MV 字幕 | 与节拍同步的歌词字幕 MV | 先分析歌曲→歌词排版与节拍对齐→镜头拼接指导；字幕走 write_script 文案节点（仅展示，不烧录）。完整流程加载 `music-video-subtitle-generator`。 |
| 合作游戏开场 | 双人合作游戏菜单/开场动画 | 收集两玩家名+游戏标题+视觉风格→先出「确认图」锁视觉（对应第 5 步定妆锚点）→用户确认后再生成开场视频；含玩家卡片与菜单交互动效。完整流程加载 `co-op-game-intro-generator`。 |
| 纸拼贴讲解 | 半色调纸拼贴动画阐述概念 | 视觉隐喻→分镜→半色调拼贴静帧→纸张运动+拟声音效定格；默认保留纸张触碰拟声（写进 overall_soundscape），不加 BGM/旁白/字幕，除非用户要求。完整流程加载 `paper-collage-explainer-generator`。 |
| 手绘实景融合 | 手绘发光动画+实拍空间融合超现实 | 设计连续变形/逃脱路径+手持追拍→写一段 15s、16:9 的 H3 提示词；前 3 秒必须与真实手/物体清晰接触并同体变形，镜头总慢半拍追赶。完整流程加载 `handdrawn-live-video-generator`。 |

**能力边界（必须如实告知用户）**：
- 字幕 / 对白 / 广告词 / 旁白文案：一律走 write_script 落到「文案」节点（成片详情展示），**当前不烧录进画面**；如用户要硬字幕，需自备含字幕的素材或等后续工具支持。若上游 skill 流程调用字幕生成，用占位工具 `subtitle_burn` 获取降级指引。
- 背景音乐：用用户提供的 BGM 文件节点（compose_video 的 bgmNodeId 混入）；**当前无音乐生成工具**，不要承诺自动作曲。若上游 skill 流程调用音乐生成，用占位工具 `music_generation` 获取降级指引。
- 旁白 TTS：当前无语音合成工具，旁白文案由 write_script 产出，音频需用户自备或仅作文案。若上游 skill 流程调用配音生成，用占位工具 `tts_voiceover` 获取降级指引。
- 「确认图」类风格（如合作游戏开场）：直接复用第 5 步定妆锚点 + 逐步确认门禁，先出确认图让用户拍板再生成。

## 画风选择（卡通 / 写实）

生图工具 `image_generate` 由 `style` 参数二选一画风，对应后端不同工作流：

- **realistic（写实，默认）**：走 `txt2image`（文生图）/ `image2image`（图生图），nunchaku-z-image-turbo 工作流，适合广告、实拍风、品牌片、3D 动画（非二次元）等绝大多数场景。
- **anime（卡通 / 日式动漫）**：走 `txt2imageanime`（z-anime-aio 工作流），**仅支持纯文生图**；若同时传了参考图（filename/filenames），因后端无动漫图生图端点，会自动回退写实图生图——需要动漫风且要参考已有图时，改用 realistic 风格，或先 `character_generate` 出动漫立绘再处理。

选择原则：
- 用户要「动漫 / 二次元 / 日式动画 / 漫画风」→ `style: 'anime'`；
- 用户要「写实 / 电影感 / 真人 / 广告摄影 / 3D 动画（非二次元）」→ 默认 realistic；
- 不确定时按需求澄清第 ④ 步的风格大类推断，或对照风格预设表里对应品类的画风描述。

注意：`character_generate`（角色三视图）不受 style 影响，始终按其工作流出图；`inpaint` 当前**暂不可用**（功能保留未开放）。

## 剧本创作（两种形态都必经；单镜精品短片为轻量版）

剧本是创作依据：有了完整剧本，镜头内容、对白与时长分配才具体可靠。规则：

0. **单镜轻量版**：单镜精品短片同样调用 `write_screenplay`，内容为**单镜剧本**（半屏篇幅即可）：一段画面描述（主体/环境/光线/氛围）+ 主体动作时序（0–3s / 3–8s / 8–15s 三段）+ 文案/口播落点 + 声音设计（BGM/SFX）。单镜剧本不写节拍链与受众标注，总时长即单镜时长（≤15s）。

1. **时机**：需求澄清完成后 → **先确定视觉风格并加载对应风格 skill → 再写剧本**（风格决定剧本形态：广告类是镜头序列 + 卖点落点，叙事类是主角动机 + 节拍链 + 情感锚点）。
2. **必须执行**：无论风格 skill 加载成功与否，都要调用 `write_screenplay` 落剧本。skill 加载失败时按通用骨架兜底（开场铺垫 → 冲突/卖点展开 → 高潮/转化 → 收尾），不要因为加载失败跳过剧本。
3. **唯一节点**：上游风格 skill 里的「故事大纲 / story-outline / 叙事主轴」步骤就是本剧本节点——**用 write_screenplay 落盘，禁止另建大纲节点**；上游大纲步骤自带的审批选项（批准 / 改节拍 / 改情绪曲线 / 回到前提）即剧本审批的用户意图，收到驳回意见时按对应维度修改。
4. **内容对齐预置**：结构节拍各自标注时长占比，**之和 ≈ 目标总时长**（项目预置值见系统提示「Canvas Studio 项目预置」小节，无预置按 30s 并标注「默认」）；镜头数 ≈ 目标总时长 ÷ 单镜 8–10s；受众在剧本 summary 里标注（澄清未问时自定并标「默认」）。
5. **审批门禁**：逐步确认模式下 `submit_screenplay_for_approval` 后本回合结束等用户批准。批准后**直接进入分镜规划**（不要调用任何把工作流设为执行态的手段——门禁由 Host 管理）；驳回则按用户意见修改剧本并重新 `write_screenplay`（原地更新）+ 重新提交。
6. 放手跑模式：`submit_screenplay_for_approval` 自动放行，落剧本后直接规划分镜。

## 标准工作流

**入口分流（动手前先判断手里有什么素材）**：
- 用户在澄清第 ① 步选了**单镜精品短片** → 走**单镜简化流程**：澄清（形态/风格，画幅与时长已预置则跳过）→ 创意策划（prompt_enhance）→ **轻量单镜剧本**（write_screenplay，单镜版规则见「剧本创作」节第 0 条；逐步确认模式照常 submit_screenplay_for_approval）→ 定妆照/场景概念图（下述第 4–5 步）→ 把单镜方案（一行分镜表，镜号 1）经 submit_storyboard_for_approval 提交获取批准（视频工具需批准后放行）→ 直接 video_composite 参考组合（Ref2VA）一镜直出（≤15s），prompt 按 Ref2VA 六段式写；对结果不满意可同 prompt 重试生成并列候选（画布并排落节点）供用户挑选；单段视频即成片，无需逐镜出图与 compose_video 拼接（可选用 1 张起始姿态关键帧加入参考组合）。
- 纯文字创意 → 从第 1 步全流程走。
- 带参考图 → 把参考图按 role（character/style/frame）用于定妆锚点与关键帧（见第 4 步），不必从零策划风格。**对话里贴的图片附件就是参考图**：附件已自动标记为参考——`list_references` 能直接列出，正文中的 `@ref[文件名]` token 也可直接填进 image_generate / video_generate / video_composite / character_generate / image2vl 的 filename/filenames 参数。**看到用户贴了图就不要以「没有参考图」为由自行造新素材**——先查 list_references 或直接用消息里的 @ref token。
- 带参考视频 → 上传后 Host 已自动抽帧并把帧图标记为 style/frame 参考、在画布生成「风格归纳」便签：先调 list_references 读 notes 拿到归纳内容，再按结论用 image_generate 传风格参考图对齐各镜（style_transfer 暂不可用，见第 4 步）。
- 二次修改已有项目 → 不重跑澄清与分镜，直接对要改的节点右键重试或在对话中说明调整方向（steer）。

1. **需求澄清**：逐步确认模式下逐项提问（一次一问，带候选项；项目预置要素跳过，见「需求澄清」节）；放手跑模式可自行假设并说明。
2. **创意策划**：用 prompt_enhance 打磨整体创意描述。
2b. **剧本创作 → 审批**（两种形态必经；单镜走第 0 条轻量版）：按下方「剧本创作」节规则，用 write_screenplay 落剧本，逐步确认模式再调 submit_screenplay_for_approval 等待批准（批准后继续本步之后的流程）。
3. **分镜规划 → 审批**：输出分镜表（见下，含「衔接」列：逐镜标 `chain` / `cut` / `bridge`），逐步确认模式下调 submit_storyboard_for_approval 等待批准。
4. **参考素材预处理 + 建一致性资产卡（含角色的片子必经；纯场景/产品片可选）**：用户提供角色参考图/定妆照时，先 `character_sheet` 建资产卡（filename=定妆照/设计图，name=稳定角色名，lockedPrompt=**与用户确认后的 SAME 块**），产出四视图分图并自动进参考托盘；`character_generate` 只在「只要一张立绘图、不建卡」时用。风格参考图不建卡，按 role=style 直接用于 image_generate 图生图。**参考图来自对话附件时，附件已自动标记为参考（list_references 可见），直接用消息正文里的 `@ref[文件名]` token 作为参考 filename 进入本步（图生图风格统一 / image2vl 分析均可），不要忽略附件重新生成替代素材**。用户上传过参考视频时，先调 list_references 读画布上的风格归纳便签与抽帧图（帧图已带 filename），按归纳结论用 image_generate 传风格参考图（图生图）统一风格或取帧作首帧——不要凭空假设风格。`style_transfer` 与 `inpaint` 当前**暂不可用**（功能保留未开放，调用会报错），请勿调用；风格统一一律改用 image_generate 传参考图。两者均不强制：也可直接用原素材仅作关键帧参考。
5. **定妆锚点**：已有资产卡时**直接用它的锚点分图**（`list_references` 的 `assets` 里取 filename），不要再另出一张定妆照；无卡时 image_generate 生成主角定妆照（要建卡就回到第 4 步用 character_sheet）。含明确场景的片子**同时生成场景概念图**——两者是全片一致性的锚点（优先用第 4 步预处理后的三视图），也是第 9 步 Ref2VA 参考组合的必备输入，缺场景概念图时第 9 步只能降级 FL2VA。
6. **逐镜出图（组合参考 + SAME 块逐字节复用）**：每个镜头调 image_generate —— **prompt 必须以该角色资产卡的 lockedPrompt 原样开头**（逐字节复用，不得改写/翻译/润色），后面接本镜 NEW ACTION / CAMERA 段（动作、景别、运镜、光线）；filenames 传 `[角色锚点分图 1–2 张, 场景概念图]`（image_generate 最多 3 张；无卡时退回定妆照；需要全局风格统一时第 3 张传首镜成图），同时锁角色与场景一致性，**并传 shotRefs=[该镜分镜卡标题]**（如「分镜 1 · 特写」，来自提交分镜的工具结果）——关键帧会连到对应分镜卡并排在其右侧；无场景概念图时退回只传定妆照单参考（style_transfer 暂不可用）。
6a. **逐镜质检（QC gate，出图后必经）**：每出一镜关键帧就调 `qc_shot`（filename=该镜产物、shotRefs=[该镜分镜卡]），按结论处理：
   - `PASS` → 继续下一镜，**不要重跑已 PASS 的镜头**。
   - `FAIL` → **只重跑该镜**：先按 drifts 判断是锚点问题还是本镜 prompt 问题（漂移在外貌/服装 = 检查 prompt 是否真的以 lockedPrompt 原样开头；漂移在道具/环境 = 补参考图或补描述），然后重出该镜并再检。**同一镜最多重跑 2 次**（budget=2）。
   - `exhausted=true`（该镜第 2 次仍 FAIL）→ **停止自动重跑**，把该镜与 drift 项原样上报用户，请用户裁定：接受当前画面 / 改资产卡 lockedPrompt（重调同名 `character_sheet` 覆盖）/ 改分镜。不要自行反复重试。
   - `WARN`（判定不明确，如画面糊）→ 不自动重跑，请用户人工确认该镜。
6b. **关键帧确认**：全部镜头关键帧出图完成后，逐步确认模式下调 submit_keyframes_for_approval(summary=…) 提交并结束回合，等用户点击「确认关键帧」（用户可能先二次编辑再确认）；放手跑模式直接跳过。
7. **上传**：对每个镜头图调 upload_image 拿 filename（可并行）。
8. **文案策划**：用 write_script 产出结构化文案，覆盖广告词、对白、背景音乐（BGM 说明）、音效（SFX）、字幕。其中的对白写入视频提示词的 <d>[语言]原话</d>，BGM 写入 non_diegetic_music:，音效写入 overall_soundscape:；该文案既驱动各镜头 H3 提示词，又将在第 10 步合成时作为 scriptId 传入成片节点展示。
9. **逐镜视频（参考组合优先）**：默认走 video_composite 多参考（Ref2VA）——filenames 按**用途**组合传 `[角色定妆照（1–2 张）, 场景概念图（1 张）, （可选）该镜起始姿态关键帧]`（≤6 张）：参考图锁定角色身份与场景环境，运镜/动作/节奏保持接近 T2VA 的自由度，不要求关键帧作首帧。仅当该镜确为「同镜首尾帧转场」（同一镜内一个状态到另一个状态的插值）才用 video_composite 两张图（FL2VA 首尾帧）；两者都不适用（既无场景概念图也无角色参考）才回退 video_generate 单首帧（FL2VA）。每段视频 prompt 一律先加载 h3-prompt-writing（Ref2VA 读其 ref-en.txt，FL2VA 读其 base-en.txt）按规范重写；**其中 `subject_definitions:` 的角色定义句逐字复用资产卡 lockedPrompt、`retention_analysis:` 标 `fully_preserved`**（无资产卡时逐字复用第 5 步定妆照的外貌描述段），并传 shotRefs=[该镜分镜卡标题] 关联分镜。**镜头衔接（C3）**：分镜规划时给每镜定衔接语义，并把它随 `shotTransition` 参数传给视频工具（`chain` / `cut` / `bridge`）：
   - `chain`（与上一镜同场景连续，如同一场戏的动作接动作）：生成前**先对上一镜调 `extract_last_frame(videoUrl=上一镜的 url)`** 取真实末帧，把返回的 filename 作为本镜首帧 —— video_generate 传 `filename`；video_composite 传 `filenames`（**末帧放第一张**，后面接角色锚点分图 / 场景概念图 / 本镜姿态关键帧）。**链帧必须来自上一镜的真实末帧，不能用分镜图或关键帧代替**（切点必跳）。
   - `cut`（跨时空剪辑，默认）：不链帧，只挂角色/场景锚点，成片时在切点上硬切。
   - `bridge`（同场景大跨度，如时间推移）：用 video_composite 两张图走 FL2VA 首尾帧书挡（上一镜末帧 + 本镜目标画面）。
   - **重做某镜（用户返工）时传 `replaces=<旧版节点 id>`**，旧版自动失效、不进成片；先调 `list_shots` 拿 id。详见「返工与版本」。
10. **成片合成（拼接已有片段）**：调 compose_video 把时间轴上已有的视频片段拼接成最终成片（**缺省只取有效片段**，≥2 段；失效版本自动排除，见下方「返工与版本」）；可传 clipIds 精确指定、bgmNodeId 指定 BGM、scriptId 指定第 8 步的文案节点。严禁再用 video_generate / video_composite 从图片重新生成视频——成片只由已有片段拼接而成。**合成端一致性兜底（C5，默认开启，无需手动干预）**：① 统一调色 pass——各镜转码时统一叠加中性 eq 预设（`contrast=1.03:saturation=1.02`），把逐镜生成的色调差异拉到同一基线；若你已知各片段已严格色调一致可传 `colorGrade: false` 关闭；② BGM 单轨贯穿——bgmNodeId 传入时 BGM 自动淡入（开头 1s）淡出（结尾 1s），避免头尾突兀。

**成片前自检（调 compose_video 之前必做）**：① 时间轴上所有视频节点均为成功态，无失败 / 生成中占位；② 各片段时长之和 ≈ 目标总时长（项目预置或澄清确认值，见「剧本创作」第 4 条）；③ 血缘边完整（每段视频的 sourceUrls 已填，能在画布上连成链路）；④ 如需 BGM，确认 bgmNodeId 指向的用户音频节点存在。任一条件不满足先修复对应节点再合成。

## 返工与版本（失效片段不进成片）

用户说「这镜重做」「第一张和最后一张座位不一致要改」时，走的是**版本替换**而不是叠加。三条硬规矩：

1. **返工前先 `list_shots`** 拿到该镜当前有效片段的 `id`（画布灰显 + 角标「已失效 / v1」的就是历史版本）。禁止凭记忆或靠文件名猜节点。
2. **重出某镜必须传 `replaces=<旧版节点 id>`**（video_generate / video_composite 均支持）。传了旧版立刻失效，不会进成片；同一关键帧、同参数、同时长的重复调用也会**自动**取代上一版（不需要显式传）。工具返回里的 `superseded` 会列出被取代的 id，可据此向用户复述「已替换原第 N 版」。
3. **合成默认只收有效片段**，用户要求「只合成合理的分镜」时无需手工挑——但要核对工具返回的「纳入 N 段、跳过 M 段失效片段」是否符合预期；若某段不该进，先 `list_shots` 拿到 id 后**显式传 clipIds**，或让用户在画布右键「作废」。

补充说明：
- 失败/重跑产生的旧片段**不要删除**，灰显留在画布上可回溯；用户右键「恢复使用」可让旧版复活（同时接管它的新版本自动作废，保证同一镜位只有一份有效）。
- 重新 compose 会生成新版成片，**旧成片自动标失效但保留在画布上**供对比（旧成片不会被再次收录进新成片）。
- 一镜多版「择优」的场景：先各自生成，用户选定后再对落选版本右键「作废」，不要指望合成时自动挑。

## 分镜表格式（提交审批的正文就用它）

| 镜号 | 景别 | 镜头运动 | 时长 | 衔接 | 画面描述 | 声音 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 远景 | 缓慢推进 | 5s | — | 村庄全貌，晨雾未散 | 环境音、鸟鸣 |
| 2 | 中景 | 固定 | 8s | chain | 女主推门进屋 | 木门吱呀 |

「衔接」列写 `chain` / `cut` / `bridge`（首镜写 —），提交分镜后按它逐镜生成（见第 9 步）；`chain` 镜必须先取上一镜末帧。

## 镜头参数词汇

- 景别：大远景 / 远景 / 全景 / 中景 / 近景 / 特写 / 大特写。
- 运动推拉摇移跟升降+固定；写进 prompt 用自然语言（如「镜头缓慢推进」）。
- duration：逐镜时长取自分镜表的「时长」列（各镜之和 = 成片总时长）；video_generate 建议 8–10s（默认 5，上限 15）；video_composite 取 8–15s（默认 10）。

## 一致性要点

- **资产卡优先（跨镜头不漂移的唯一硬规矩）**：有 `character_sheet` 资产卡时，所有含该角色的镜头 prompt 都以它的 lockedPrompt **原样开头**，参考图取该卡锚点分图；每回合先 `list_references` 读 `assets` 取锚点，不凭记忆复述（完整纪律见「一致性资产卡与注入纪律」节）。
- 无资产卡时：先出角色定妆照，后续所有含该角色的镜头都以它为 filename 参考图，并逐字复用同一段外貌描述。
- 第一张成图确定风格后，后续镜头用它做风格参考（用 image_generate 图生图；style_transfer 暂不可用）。
- 质量差时用 negativePrompt 排除瑕疵（如「模糊，变形，多余手指」）—— 但**纯文生图（Z-Image）禁传 negativePrompt**，约束一律写进正向提示词。
- **质检闭环**：每镜出图后调 `qc_shot`（shotRefs 必传）；FAIL 只重跑该镜，同一镜 2 次仍 FAIL 就上报用户仲裁，WARN 请用户人工确认。判定依据是资产卡 lockedPrompt，所以**没有资产卡就没有可靠基准** —— 含角色的片子务必先建卡。衔接语义随 `shotTransition` 参数落盘，成片拼接时不再额外加转场。
- 单节点失败可在画布右键「重试」（原地更新，不产生新边）；整体方向调整直接在对话里说明（steer）。
