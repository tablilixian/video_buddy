---
name: canvas-studio-creation
description: Canvas Studio 画布视频创作规范（最高优先级，先行加载）：凡涉及生成图片/视频、分镜规划、AI 短片或漫剧创作的任务，第一个动作必须是调用 skill(name=canvas-studio-creation) 加载本规范——严格先于一切提问（ask_user_choice）与任何工具调用，禁止凭直觉先行澄清或先行动手。内容含点选式需求澄清与 Look 采集（5 项风格 tokens + 基调样张确认）、风格预设出口、分镜表与关键帧审批门禁、H3 视频提示词规范与完整画布工具链（详单分册于 references/，按步必读）。
---

# Canvas Studio 创作规范

在 DSH 画布工作台（canvas-studio）中创作 AI 短视频 / 漫剧时遵循本规范。产物会实时落到画布，用户可随时打断、重试单个节点。

> **加载时机铁律**：本规范必须在任务第一步被加载。若你已在提问或调用工具之后才读到本段，立即停止，向用户说明「已加载创作规范，按规范重走需求澄清」，并从下方「需求澄清」第 ① 步重开始。

> **分册结构**：本规范只保留路由级骨架；具体步骤按指针先读对应分册。分册一览：澄清 `clarification.md`、工具链 `toolchain.md`、提示词 `prompt-writing.md`、风格 `style-presets.md`、Look 采集 `look.md`、剧本 `screenplay.md`、分镜 `shot-format.md`、一致性 `consistency.md`；**圣经故事题材**（用户给故事名/人物名）另加载题材导演 `bible-story-director`。

## 执行模式与审批门禁（必须遵守）

- 项目有两种执行模式，工作流条上可见：**逐步确认**（默认）/ **放手跑**。
- **逐步确认 = 阶段一「拍摄定稿」+ 关键帧条件门**（REQ-022 起）：阶段一的终点是 `write_storyboard` 产出故事板，**由用户在画布顶条「拍摄定稿」覆盖层里点「确认落地」**推进（落地 = 用户按钮 → Host 路由，**不是** agent 工具）；剧本门与分镜门已下线。**唯一保留的对话流审批门是关键帧确认** `submit_keyframes_for_approval` —— 第 6 步按需出图（默认不出），一张关键帧都没出就跳过 6a 直接进第 9 步；出过则必经。
- **提交即停手（最重要的一条）**：三个 submit 工具**一被调用就终止本回合**（平台机制，不是建议）。获批前一切**产出**动作都会被门禁直接报错：视频、逐镜出图、资产卡、定妆照/场景概念图、质检、BGM、成片、抽帧；「先加载 skill / 先读分册 / 先出样张」同样算越权——那是获批后的下一步，不是可以并行做的准备。收到门禁报错**不要重试**，批准后会自动恢复（用户会发「继续」）。
- **故事板被打回 / 用户要改（逐步确认）**：先**逐镜**用 `ask_user_choice` 确认（每镜一问，options 给「同意使用当前（推荐）/ 需要修改」两项，卡片自带自由输入框可直接输入修改意见），全部确认完毕后再调 `write_storyboard` 重写受影响的节（**分节合并**：传哪节替换哪节，没传的节保留不动；要整体重写就九节全传——当前活副本会自动存成一版，不丢内容），然后请用户重新点「确认落地」。
- **关键帧确认阶段（逐步确认）**：用户在画布上对关键帧做二次编辑（右键重试 / 修改提示词）后，仍需再次点击「确认关键帧」才继续——未确认前的视频生成报错不要重试，等待即可。
- **放手跑模式**：用户已明确授权一路跑完；三个 submit 工具都直接放行、不停回合，无需等待。
- **放手跑补完（不弹问铁律，CV-208）**：本模式 `ask_user_choice` 一律不调用——详细规则与覆盖范围见 `references/clarification.md` §"放手跑补完（CV-208 不弹问铁律）"。

## 需求澄清（骨架；完整细则见 references/clarification.md，**澄清开始前必读**）

开始策划前用 **ask_user_choice 工具**点选式确认「形态 + 风格」。骨架规则：

1. **一次只调一次 ask_user_choice，只问一个要素**，等结果回流再问下一个；**禁止**一次性输出完整方案整体确认，**禁止用纯文本列表提问**。
2. 提问顺序：① 产物形态（多镜头叙事短片 / 单镜精品短片）→ ② Look 采集（②-1 提取 → ②-2 样张确认 → ②-3 预设出口，细则见 `references/look.md`）→ ③ 画幅/总时长。
3. **跳过规则**：画幅/总时长已项目预置 → 视为已确认不要问；用户已点名具体技能或风格 → **Look 采集整体跳过**（点名技能的 `skill(name=…)` 加载照常执行）；画布已有 role=style 参考或参考视频便签 → ②-1 直接归纳、不再问风格；镜头数按「总时长 ÷ 单镜 8–10s」推导、受众自行推断，均不问。
4. options 2–4 个短标签，**只有用户已说出的内容能命中时才标「（推荐）」**并附一句理由，拿不准就不标；**仅出口路径（②-3）**逐字使用风格预设表首列的预设名（表在 `references/style-presets.md`）。
5. 全部确认后输出简短需求摘要（形态/**Look 来源与 tokens**/画幅/总时长/建议镜头数，预置标「项目预置」、推断标「默认」，未命中预设如实写「未匹配专属风格」），再进入分镜规划；放手跑模式跳过提问，自行假设并列出假设清单。

推荐判定关键词表、逐字选项模板、预置细则与超时处理见 `references/clarification.md`。

## 核心规则（必须遵守）

- 所有需要图片输入的工具只接受 `filename`（Drama Backend 服务器文件名），**不能直接传图片 URL**。
- **两类 filename，可消费性不同**：`upload_image` 返回的 `ref-xxxxxxxx.png` 是**上传句柄**，可直接入参；生成类工具结果里的 `filename` 字段（`img_01287_.png` 一类）是**后端产物名**，**不能直接入参**（约 0.1s 内 500）。
- 生成 API 分两类：**图片类**（`image_generate` / `character_generate` / `upload_image` / `image2vl` / `video2vl`）仍是**同步阻塞**——调用会阻塞到产物返回，「打断」只是本地中断 fetch，服务端任务不回收；**视频类**（`video_generate` / `video_composite`）后端 0.5.0 起改**异步**——提交即 202 + job_id，由宿主轮询，调用本身不阻塞等待（批量提交见第 9 步），任务可取消（排队等待被取消见 CS-GEN-207）。
- **快速修图走 `image_fix`**：去水印 / 去瑕疵 / 局部小修用 `image_fix`；结构性改图（换构图、改风格、重绘）仍走 `krea2-edit-writing` 技能，不要对大改用 `image_fix` 硬撑。
- 把**产物**用作下游输入有两条路：① 引用画布节点 `@ref[节点标题]`——Host 会自动把产物名换成可用句柄；② 显式 `upload_image(imageUrl=产物url)`。只有外部 URL 图片必须先上传。**对话附件（用户贴图）豁免**：filename 由画布后台自动回填，不要对附件再调 upload_image。
- 同一项目保持同一 aspectRatio，不要混用。注意视频类工具（video_generate / video_composite）只支持 16:9 / 9:16，传 1:1 会静默落到 16:9；1:1 仅限图片类工具使用。
- 调用 image_generate / video_generate / video_composite 时，把本次用到的参考图产物 URL（此前工具结果里的 url 字段）填进 `sourceUrls` 参数——画布会据此画出流程箭头（血缘边），用户靠它理解制作链路。
- 逐镜生成关键帧/视频时，把 `shotRefs` 参数设为该镜分镜卡（提交分镜后工具结果会列出每张卡的标题，如「分镜 1 · 特写」）——画布会把产物连到对应分镜卡并排在其右侧，形成逐镜对照。
- **你没有视觉能力——任何「直接看图」的尝试都必然失败**（报错 `model does not declare image input` / `switch to an image-capable model to read images`）。禁止一切变体：用文件读取类工具读本地图片路径（`file_path`、`/canvas-studio/assets/...`）、把图片 URL/路径塞进任何工具参数当图用、在回复里内嵌图片引用让模型分析。不要在生成后宣称「我看一下效果」然后尝试读图。
- **用户在对话里贴的图片附件会被画布自动转存**：附件落地为画布参考素材节点（自动标记为参考，进参考托盘与 `list_references`），消息正文自动追加 `@ref[文件名]` 引用标记。**逐字使用消息里的 `@ref[...]` token** 当 filename/filenames 参数——标题就是文件名（常为 UUID 形态），不要改写或「美化」。需要判断画面用 `image2vl(filename="@ref[文件名]")`。
- **全局资产库引用**：用户提到既定角色/场景/物件/群像（按名称或别名，如「女主」「雨夜巷弄」）时，system prompt 的「全局资产库」小节或 `list_references` 的 `library` 字段里有 `id=lib:<uuid>`——要作参考图/文件引用时**逐字使用** `@ref[lib:<id>]`（裸 `lib:<id>` 同样可解析），Host 自动把该资产的媒体物化到当前项目并换出可用 filename；**不得改写、翻译或截断 id**。库条目没有媒体文件时会明确报错，此时只按名称/别名用它的文字信息，不要把 id 硬塞进 filename。
- **产物 URL（image_generate / video_generate 等返回的 `url`）只用于展示给用户、画布血缘与 `upload_image` 取 filename，不是给你做视觉输入的**。需要确认画面内容时，唯一合规手段是图像分析工具 `image2vl`（视频用 `video2vl`）：先 `upload_image(imageUrl=url)` 拿 `filename`，再 `image2vl(filename=…, prompt=「描述/检查…」)` 拿文字结果；无需内容判断就直接文字汇报产物（尺寸/数量/URL）。
- **风格 skill 优先原则**：激活某个风格 skill 后，其流程步骤、选项卡与风格规则与本规范冲突时，**以风格 skill 为准**——风格 skill 是该垂直方向的特化，本规范是通用底座。但以下安全底线**不参与此原则**，任何 skill 不得绕过：① 执行模式与审批门禁（submit_screenplay / submit_keyframes 等待与放行语义）；② 一致性硬约束（资产卡 lockedPrompt 逐字节复用、镜位版本 replaces）；③ 工具参数硬限制（filename 约定、参考图数量上限、16:9/9:16）；④ **质检不参与过程**（qc_shot 仅项目完成时出报告，详见第 11 步）。

## 提示词写法（骨架；分册 references/prompt-writing.md **写前必读**）

- **图像**（image_generate / character_generate）写 prompt 前**必须先加载对应 skill**：纯文生图 → `krea2-turbo-writing`；图生图/改图 → `krea2-edit-writing`；再读 `references/prompt-writing.md`。
- **视频**（video_generate / video_composite）写 prompt 前**必须先加载 `h3-prompt-writing`** 并读 `references/prompt-writing.md`（Ref2VA 读 ref-en.txt 六段式 / FL2VA 读 base-en.txt 三段式）。
- **硬约束**（不依赖 skill 也要遵守）：文生图路径**禁止传 `negativePrompt`**（不生效且浪费，约束写进正向提示词）。
- skill 加载失败时不卡流程：按分册里的降级骨架写，并在回复开头说明「未按完整规范执行（skill 加载失败）」。

## 标准工作流

**入口分流（动手前先判断手里有什么素材）**：
- 用户在澄清第 ① 步选了**单镜精品短片** → 走**单镜简化流程**：澄清 → 轻量单镜故事板（只有一条 shot，单镜版规则见 `references/screenplay.md` 第 0 条）→ 用户在覆盖层「确认落地」→ 定妆照/场景概念图（第 4–5 步）→ `video_composite` 参考组合（Ref2VA）一镜直出（≤15s，prompt 按六段式写）；不满意可同 prompt 重试并列候选；单段视频即成片，无需逐镜出图与拼接。
- 纯文字创意 → 从第 1 步全流程走。
- 带参考图 → 参考图按 role（character/style/frame）用于定妆锚点与关键帧（见第 4 步）；**风格向的图在澄清第 ② 步先归纳成 tokens**（见 `references/look.md`）。**对话贴图就是参考图**：附件已自动标记为参考（list_references 可见），正文 `@ref[文件名]` token 可直接作 filename——看到用户贴图不要以「没有参考图」为由另造素材。
- 带参考视频 → 上传只落**视频节点**；**帧图与「风格归纳」便签需用户右键「拆分视频」**。有便签 → 澄清第 ② 步 list_references 直接用结论；只有视频节点 = 未拆分，提示用户右键，别自造结论。
- 二次修改已有项目 → 不重跑澄清与分镜，直接对要改的节点右键重试或在对话中说明调整方向（steer）。**分镜内容要改**（改镜词/增删镜头）：**落地前** → 调 `write_storyboard` 改对应分节（分节合并：只传要改的节，没传的保留；活副本更新、旧内容自动存版），用户重新落地；**落地后** → 走结构修订通道（只增删/改具体分镜，画布按镜号原地更新、不产生重复卡；该通道随 REQ-022 后续批次上线）。只在对话里说、或改文本节点，都不会更新分镜卡。

1. **需求澄清 + Look 采集**：逐步确认模式逐项点选提问（先读 `references/clarification.md`）；第 ② 步按 `references/look.md` 采集 5 项 tokens 并出 1 张基调样张确认（image_generate 出、落画布），**样张确认通过后调 `look_card` 落卡**（落卡规则见 look.md §9.1，逐镜注入见 §9.2）；放手跑模式自行假设并说明。**基调样张的 `image_generate` 首次可不传 `storyboardRef`**——故事板已建、还没分镜、§02 尚无样张时 Host 会自动兜底挂上（CV-306），用户在「拍摄定稿」覆盖层直接看到；但**重出样张（换一批）必须显式传 `storyboardRef: "look"`** 才会覆盖已确认的那张（自动通道永不覆盖）。
2b. **拍摄定稿创作**（两种形态必经）：读 `references/screenplay.md` 与 `references/shot-format.md`，用 `write_storyboard` 落**拍摄定稿**（`storyboard.json`）——剧本内容进 §00 创意前提 / §03 旁白 / §05 角色，分镜进 §04（单镜走 screenplay.md 第 0 条轻量版；上游风格 skill 的「故事大纲」步骤就是 §00+§03，**禁止另建大纲节点**）。**创意方向与用户确认后的第一动作就是首写骨架**（title + meta + creative 至少三段）——项目创建时 Host 已预建了空骨架壳，你的第一笔会就地填进 v1；不要憋到全部想清楚才写。写完后请用户在画布顶条「拍摄定稿」里审阅。**阶段一不要写文案节点**（`write_script` 会被 `storyboarding` 状态门禁拦下）。
2c. **分次写、逐步填满**（重要体验）：`write_storyboard` 是**分节合并**语义 —— 传了的节替换对应内容，**没传的节保留现值不动**（不会把之前写的冲掉；要清空某一节必须显式传空内容，如 `"[]"`）。所以不要憋大招一次写完 —— 用户会一直盯着「拍摄定稿」覆盖层（阶段一它会自动打开），分次写能让他看到一节一节填上：
   - 第一笔：`meta` + `creative` + `visual`（题材/时长/画幅 + 创意前提 + 5 项 tokens）→ 覆盖层立刻出现骨架与「已填充 3/9 节」进度；
   - 第二笔：`storyboard`（两级分镜；这一步体量最大）→ 进度跳到 4/9，分镜卡成排出现；
   - 第三笔：`characters` + `narration` + `sound` → 6/9；
   - 第四笔：`facts` + `assets` + `constraints` 收尾 → 9/9。
   **每笔之间不要问用户**（那是同一次任务内的连续动作）；写完分节就继续下一笔，直到 9 节齐了再停下来请用户审阅。
   ⚠️ **版本次数不会因分次写而增长**：整体重写只更新「活副本」，**不产生版本**。版本只在四个时刻产生 —— 首稿、用户在覆盖层点「存档为新版本」、回退前自动打点、落地固化。所以放心分笔写，版本列表不会被机械记录刷满。
3. **落地（用户操作）**：用户在覆盖层点「确认落地」→ Host 跑三层校验（结构 / 完成度 / 确认清单）并 seed 落画布。**有缺项会弹出清单**（缺什么 + 在哪分节），补完再落。**落地前不要抢跑**：视频、逐镜出图、资产卡、质检、BGM、成片一切产线工具都会被 `storyboarding` 状态门禁直接报错（Look 阶段的基调样张 / 定妆照不受限）。
4. **参考素材预处理 + 建一致性资产卡（含角色的片子必经）**：读 `references/consistency.md`「参考素材预处理」节——character_sheet 建卡（lockedPrompt 先经用户确认）、附件 @ref 直用、参考视频归纳。
5. **定妆锚点**：按 consistency.md 执行——有资产卡直接用其锚点（四视图拼图整图，list_references 的 assets 取 filename），无卡出定妆照；含明确场景的片子**同时生成场景概念图**（第 9 步 Ref2VA 必备输入）。
6. **逐镜出图（按需，默认不出）**：默认全走第 9 步 Ref2VA 参考组合（锚点 + 场景图），不出关键帧；仅构图/走位需钉死的镜才出**姿态关键帧**（作参考组合最后一席）。出图规则见 consistency.md「逐镜出图」。**凡出关键帧/效果图，`image_generate` 必须传 `storyboardRef=<shot 语义 id>`**（如 `S1-Sh1`）——Host 自动把图挂到故事板对应分镜上，用户在覆盖层直接审图；不传则图只落在被覆盖层挡住的画布上。
6a. **关键帧确认（条件门）**：出过关键帧时逐步确认下调 submit_keyframes_for_approval(summary=…) 提交并等确认；一张未出（全 Ref2VA 直出）跳过本步直接进第 9 步；放手跑跳过。
7. **上传**：对每个镜头图**逐个**调 upload_image 拿 filename（后端同步单任务）。
8. **文案策划**：用 write_script 产出结构化文案（广告词/对白/BGM/SFX/字幕）——对白写入视频提示词 `<d>[语言]原话</d>`，音效 + BGM 描述写入 `overall_soundscape:`；**多镜时 `non_diegetic_music: N/A`**（把配乐权交还 BGM 音轨层）；第 10 步作 scriptId 传入成片节点。
9. **逐镜视频（参考组合优先，批量提交）**：读 `references/shot-format.md`——**条数纪律（C-16）：一个分镜 = 一条视频，按分镜表逐镜出片；shot 是分镜内节拍、写进同一条视频的 prompt，严禁按 shot 数出多条（用户明确要求除外）**。**用户计划优先（C-9）：分镜表/用户指定了某镜工具时按指定执行，不得擅自升级到 video_composite**。默认 video_composite 多参考 Ref2VA（锚点 + 场景图 + 补足席位，**必须 ≥3 张**），仅同镜首尾转场用两图 FL2VA，都不适用才退 video_generate；prompt 先加载 h3-prompt-writing 按规范重写（`subject_definitions` 逐字复用 lockedPrompt、`retention_analysis` 标 `fully_preserved`）；**逐镜调 `generateAudio=true` 打开 H3 原生音轨**（CV-209：多镜时此为主声轨，不再丢）；返工传 `replaces=<旧版节点 id>`（先 `list_shots` 拿 id）。**批量提交（CV-240）**：视频是异步任务（提交即排队）——非 chain 镜的调用在**同一个回合内一次性全部发出**，不要等上一镜出片再提交下一镜；chain 镜依赖上一镜末帧（先 `extract_last_frame`），按链序自然串行。**句柄纪律**：filename(s) 只认 `@ref[显示名]` 或 `upload_image` 返回的 ref-* 句柄——画布节点 id / 从产物 url 抠文件名会被直接拒绝（CS-USER-002），不烧后端调用。
10. **成片合成**：读 `references/shot-format.md`「成片合成与自检」——compose_video 拼接已有片段，可传 `clipIds` / `bgmNodeId` / `scriptId`；统一调色与 BGM 自适应淡入淡出默认开启。**音轨策略（CV-209）**：单镜保留原生音轨；多镜把各镜原生音轨串接为主声轨，用 `music_generation` 单独生成 BGM 后 `amix` 铺底——多镜可不给 BGM（仅少一层配乐，不是无声）。**BGM 时长按"宁可比视频长"原则生成**（详 `references/toolchain.md` §"BGM 时长铁律"与 music-prompt-writing 五维必写项）。**手上有整首曲只要其中一段（用户上传的 mp3 / 已生成的 BGM），或要给 `audioRefs` 的参考音频超 15s → 用 `cut_audio` 裁出所需区间**（Host 本地 ffmpeg、秒回、产物落新音频节点），**不要自己拼 ffmpeg 命令、也不用去问 ffmpeg 在哪**。**严禁再用 video_generate / video_composite 从图片重新生成视频——成片只由已有片段拼接而成。**
11. **质检报告（仅此一处，CV-240）**：成片交付后，对每个镜头调 `qc_shot` 出 PASS/FAIL/WARN，**汇总成一份《质检报告》随交付输出**（哪镜一致、哪镜有漂移项、建议用户看哪几镜）。⚠️ 报告**仅供参考，不触发返工**：过程中不调 qc_shot、不因 FAIL 重出任何镜头、不在画布上制造返工痕迹；用户主动要求重做某镜才走 `replaces` 重出。
