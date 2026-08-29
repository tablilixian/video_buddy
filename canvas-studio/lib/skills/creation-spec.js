/** Registry-valid kebab-case name (/^[a-z0-9]+(?:-[a-z0-9]+)*$/). */
export const CREATION_SKILL_NAME = 'canvas-studio-creation';
/** Catalog routing description (kept under the 500-char truncation limit). */
export const CREATION_SKILL_DESCRIPTION = 'Canvas Studio 画布视频创作规范：点选式需求澄清（ask_user_choice）、分镜表审批门禁、镜头参数词汇、MiniMax H3 视频提示词规范与完整的画布视频创作工具链的标准串联流程。凡涉及生成图片/视频、分镜规划、AI 短片或漫剧创作时使用。';
/** The full markdown instruction body loaded via the `skill` tool. */
export const CREATION_SKILL_CONTENT = `# Canvas Studio 创作规范

在 DSH 画布工作台（canvas-studio）中创作 AI 短视频 / 漫剧时遵循本规范。产物会实时落到画布，用户可随时打断、重试单个节点。

## 执行模式与审批门禁（必须遵守）

- 项目有两种执行模式，工作流条上可见：**逐步确认** / **放手跑**。
- **逐步确认模式（默认）**：
  1. 需求不明确时先对话澄清，不要急着生成；
  2. 输出分镜表后必须调 \`submit_storyboard_for_approval(storyboard=…)\` 提交，然后结束回合等待用户；
  3. 用户在画布上方点击「批准」并在对话中发送「继续」后，才能调用 storyboard_generate / video_generate / video_composite；
  4. 未获批准时这些工具会直接报错——收到报错不要重试，等用户批准即可（image_generate 出概念图不受限）。
- **放手跑模式**：用户已明确授权一路跑完；submit_storyboard_for_approval 会直接放行，无需等待。

## 需求澄清五要素（逐步确认模式下必须点选式提问）

开始策划前用 **ask_user_choice 工具**逐项确认五要素，规则：

1. **一次只调一次 ask_user_choice，只问一个要素**；收到工具结果（用户的选择自动回流）后再问下一个。**禁止**一次性输出完整方案让用户整体确认，也**禁止用纯文本列表提问**——用户要点按钮，不是打字。
2. options 给 2–4 个短标签候选项，推荐项末尾加「（推荐）」；例如：
   question: 「成片时长想要多少秒？」options: ["15s 快节奏", "30s 标准品牌片（推荐）", "45s+ 完整叙事"]
3. 提问顺序：① 时长 → ② 画幅 → ③ 风格（从下方「风格预设」8 类里点选，或「通用」）→ ④ 节奏/镜头数 → ⑤ 受众与用途。开放要素（品牌名等）传 allowFreeText=true。
   - **第 ③ 步风格题的 options 必须逐字使用下方「风格预设」表首列的 8 个预设名**（如「极简产品广告」「3D 动画短片」「纸艺定格讲解」），不要改写、缩写或自造风格名（否则画布无法匹配该风格的预览图与对应 skill）。
4. 用户回答「你定 / 随便 / 按你的建议」时，该项采用推荐项并在最终摘要里标注「默认」。
5. 五项全部确认后，输出一段简短需求摘要（含已确认的五要素），然后进入分镜规划；分镜表仍须经 submit_storyboard_for_approval 审批。
6. **放手跑模式**跳过提问：自行假设五要素并在回复开头列出假设清单。
7. ask_user_choice 会阻塞到用户点击或超时；收到超时提示时按推荐项继续并说明是默认假设。

## 核心规则（必须遵守）

- 所有需要图片输入的工具只接受 \`filename\`（已上传到 Drama Backend 的服务器文件名），**不能直接传图片 URL**。
- 图片作为下游输入前，必须先调 \`upload_image(imageUrl=产物URL)\` 得到 \`filename\`。
- 生成是同步 API：调用会阻塞到产物返回；「打断」只是本地中断 fetch，服务端任务不回收。
- 本项目产物图片节点落盘时已自带 filename（list_references 或 @ref[显示名] 可直达），不要对每次生成产物重复调 upload_image；只有外部 URL 图片才需要先上传拿 filename。
- 同一项目保持同一 aspectRatio，不要混用。注意视频类工具（video_generate / video_composite）只支持 16:9 / 9:16，传 1:1 会静默落到 16:9；1:1 仅限图片类工具使用。
- 调用 image_generate / video_generate / video_composite 时，把本次用到的参考图产物 URL（此前工具结果里的 url 字段）填进 \`sourceUrls\` 参数——画布会据此画出流程箭头（血缘边），用户靠它理解制作链路。
- 逐镜生成关键帧/视频时，把 \`shotRefs\` 参数设为该镜分镜卡（提交分镜后工具结果会列出每张卡的标题，如「分镜 1 · 特写」）——画布会把产物连到对应分镜卡并排在其右侧，形成逐镜对照。
- 不要尝试用文件读取工具打开图片（当前模型不支持 image input，读 image.png 会报错）。参考图一律用 filename / @ref[显示名] 引用，不要「查看」图片内容。
- 剧情推演工具（deduction）已移除（后端不支持 404）；下一帧推演改用 image2vl 分析代替。

## 工具链（全部工具见下表；write_script / compose_video 见下方工作流第 8 / 10 步）

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| prompt_enhance | 增强提示词 | prompt |
| ask_user_choice | 点选式提问（澄清阶段必用） | question、options[]（推荐项加「（推荐）」）、allowFreeText? |
| submit_storyboard_for_approval | 分镜表提交审批（逐步确认模式必经） | storyboard（分镜表 markdown）、summary? |
| storyboard_generate | 文本 → 格子分镜图 | prompt（每行一个场景）、gridnum、filename? |
| storyboard_split | 格子分镜图 → 单镜（每个镜头一张独立图） | filename（storyboard_generate 返回的 Drama 文件名）、gridnum（4/6/9）、sourceUrls? |
| image_generate | 文生图 / 图生图（单参考或多参考） | prompt、aspectRatio、filename?（单参考图）、filenames?（最多 3 张多参考图）、negativePrompt?、shotRefs?（关联分镜卡） |
| style_transfer | 风格迁移 | filename（目标图）、styleFilename（风格图）、prompt?、enhance? |
| image2vl | 画面分析（VLM） | filename、prompt |
| video_generate | 图生视频（FL2VA：文生 / 首帧图生视频） | prompt、filename?（首帧图）、duration（默认 5s）、shotRefs?（关联分镜卡） |
| video_composite | 多图合成视频（FL2VA 首尾帧 / REF2VA 多参考） | prompt、filenames[]（按时间顺序，2 张首尾帧、≥3 张多参考最多 6 张）、duration（默认 10s）、shotRefs?（关联分镜卡） |
| upload_image | 上传本地/产物图片到 Drama Backend 拿 filename（任何图片作为下游输入的必经前置） | imageUrl（产物 URL 或本地路径） |
| write_script | 产出结构化文案（对白/字幕/BGM/SFX 说明）落到「文案」节点 | script（markdown） |
| compose_video | 拼接时间轴已有视频片段成成片（可混 BGM / 挂文案） | bgmNodeId?、scriptId? |
| list_references | 列出当前项目参考图（角色/风格）供 @ref[显示名] 引用 | — |

## 视频提示词写法（MiniMax H3 官方规范，必须遵守）

生成视频（video_generate / video_composite）的 prompt 要按 H3 结构化格式重写，不要写成一句话摘要。原文见 MiniMax-AI/MiniMax-H3 仓库 \`.agents/skills/h3-prompt-writing\`。

**通用结构**（首行对齐指令 + 空行 + 三大核心字段）：

- 图生视频（video_generate，首帧参考）首行固定：
  \`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\`
- 首尾帧合成（video_composite 两图）首行固定：
  \`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.\`（S.SS = 时长，两位小数；FL2VA 偏好单镜头连续插值）
- 三大字段按序：\`integrated_multimodal_description:\`（沿时间轴的画面/动作/镜头/台词/画内音）、\`overall_soundscape:\`（1–4 句环境音与动作音总结）、\`non_diegetic_music:\`（1–3 句背景音乐：乐器/速度/强弱变化，不写情绪词；无则 N/A）

**镜头与剪辑**：\`[Shot 1]\` 开头先给风格与构图（如 \`Live-action, cinematic, a medium-wide shot frames...\`）；后续镜头用递增切点时间 \`[Shot 2] At 00:03.500, the camera cuts to...\`；只有新信息才切镜头，距离/角度微调用运镜。

**运镜三要素**（类型+幅度+速度，写成句中自然英语）：Zoom In/Out、Push In/Pull Out、Pan Left/Right、Truck Left/Right、Tilt Up/Down、Pedestal Up/Down、Arc Shot、Tracking Shot、Static Shot、Shake Slightly/Strongly、POV、Roll Clockwise/Counterclockwise + \`with small/large amplitude\` + \`at slow/fast speed\`。例：\`The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.\`

**台词与声音**：说话者用稳定 ID \`(S1)\` / \`(S1,S2)\`，首次出现给出音色/语速等身份信息；内容放 \`<d>[English]原话</d>\`（原话逐字保留不翻译）；旁白用 \`says in an off-screen voiceover\` 并紧跟 \`while his lips remain completely closed.\`；跨切台词用 \`<scenetrans>\`，被结尾截断用 \`<cutoff>\`。画面内文字用英文双引号逐字保留（如 \`A red neon sign reading "营业中" glows above the doorway.\`）。

**一致性**：图生视频从首帧锚点出发（风格/人物/构图保持一致 → 动作启动 → 连续发展 → 结果反应）；时长描述必须匹配请求的 duration（单段 ≤15s）。

**六段规划法（写提示词前先在脑内过一遍）**：① Context（开场/参考图设定）② Timeline（按时间轴的有序动作 + 结尾状态）③ Camera（运动/幅度/速度）④ Sound（对白/画内音/环境音/配乐分层）⑤ Constraints（必须稳定的元素：角色/服装/场景）⑥ QA（成片是否达成需求）。每个镜头用 MM:SS.mmm–MM:SS.mmm [Shot 描述] 标注时间轴（单 shot 2–5s，整片 4–15s 内讲完一个故事）。

**多语言**：对白块 [Language] 即语言标记（如 [中文] / [English] / [Japanese]），提示词主体跟随用户输入语言；未指定时默认中文，绝不擅自翻译用户素材里的原文（含画面内文字）。

**背景音乐与对白**：non_diegetic_music: 字段驱动成片 BGM（写乐器/速度/强弱变化，不写情绪形容词），用户要求「配乐 / 自带 BGM」时务必填此字段；对白用 <d>[Language]原话</d> 逐字保留，多个说话人用稳定 ID (S1) / (S2) 区分音色。需要人物原声对口型时，旁白用 says in an off-screen voiceover 并紧跟 while his lips remain completely closed.

**完整示例（中文场景，按上方结构填空即可）**：
- video_generate（首帧图生视频，产品开场）首行固定：\`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\` 随后写三字段，台词用 \`<d>[中文]这台新机，轻到忘记存在。</d>\`：\`integrated_multimodal_description:\` / \`overall_soundscape:\` / \`non_diegetic_music:\`。
- video_composite（首尾帧，15s 品牌短片）首行固定：\`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark; Picture 2 (from Shot N) aligns with the 15.00-second mark.\` 三字段同上，对白同样用 \`<d>[中文]…</d>\` 逐字保留。

## 风格预设（8 类垂直方向，需求澄清第 ③ 步从这里点选）

选中风格后，除遵守上方通用 H3 规范外，额外套用该类的「风格约束」；涉及字幕/旁白/音乐时一律按末尾「能力边界」映射，不要承诺画布内烧录或自动作曲。

**8 类风格的完整流程都来自 MiniMax-H3 上游 skill：确定风格后立刻用 \`skill\` 工具加载对应 skill，再按其原版 STEP 流程与选项卡门逐项推进。**

**调用语法（必须严格遵守，否则工具报错）**：\`skill(name="英文原名")\`，例如 \`skill(name="minimalist-product-ad-generator")\`。

- ① \`name\` 必须是会话 skill catalog 里列出的**英文 kebab-case 原名**（见下表每行末列）。
- ② **禁止**传中文风格名（如「极简产品广告」）、**禁止**带引号 / 反引号 / 空格、**禁止**缩写或改后缀（如把 \`minimalist-product-ad-generator\` 写成 \`minimalist-product-ad\` 会报 unknown）。
- ③ 一次只加载一个 skill。
- ④ 内容已出现在本对话里的 skill **不要重复调用**（重复调用会失败）。
- ⑤ 加载失败时先核对 name 是否与 catalog 完全一致，改对后重试一次，**不要连续换名试错**。

各 skill 的 BGM/配音/字幕步骤用占位工具 music_generation / tts_voiceover / subtitle_burn 获取降级指引。详细 H3 提示词规范可另加载 \`h3-prompt-writing\`。

| 预设 | 适用 | 流程差异 / 关键约束 / 对应 skill |
| --- | --- | --- |
| 极简产品广告 | 电商 / 新品发布极简风广告短片 | 先确认产品与变体→提炼卖点→写简洁英文广告文案→分镜与音乐节拍同步；禁用 KOC 口播、普通剪辑、屏幕演示。H3 提示词走电影感极简构图、少元素、干净背景。完整流程加载 \`minimalist-product-ad-generator\`。 |
| 3D 动画短片 | 完整风格化 3D 动画 | 走标准动画流程：简报→大纲→角色/环境设定卡→镜头规划→故事板→逐镜→合成配乐；强调角色一致、场景连续、节奏精准。定妆锚点用 3D 角色设定图。完整流程加载 \`3d-animation-short-generator\`（原版 STEP 0–9：简报/大纲/角色卡/场景卡/六列镜头表/自检门/分镜/模型选择/逐镜/拼接+BGM）。 |
| 纸艺定格讲解 | 科学/教育/通识的手工纸艺讲解 | 纸艺角色 + 分层立体布景 + 道具；转场用纸张翻折/位移；H3 提示词强调 papercraft、手工质感、定格停顿。完整流程加载 \`papercraft-stop-motion-explainer\`。 |
| 品牌宣传 | Logo/产品图/官网截图→品牌短片 | 选叙事方向→精确节奏点→生成素材(图/视频/旁白/音乐)→剪辑→明确 CTA；突出功能与使用场景。完整流程加载 \`brand-promo-video-generator\`。 |
| MV 字幕 | 与节拍同步的歌词字幕 MV | 先分析歌曲→歌词排版与节拍对齐→镜头拼接指导；字幕走 write_script 文案节点（仅展示，不烧录）。完整流程加载 \`music-video-subtitle-generator\`。 |
| 合作游戏开场 | 双人合作游戏菜单/开场动画 | 收集两玩家名+游戏标题+视觉风格→先出「确认图」锁视觉（对应第 5 步定妆锚点）→用户确认后再生成开场视频；含玩家卡片与菜单交互动效。完整流程加载 \`co-op-game-intro-generator\`。 |
| 纸拼贴讲解 | 半色调纸拼贴动画阐述概念 | 视觉隐喻→分镜→半色调拼贴静帧→纸张运动+拟声音效定格；默认保留纸张触碰拟声（写进 overall_soundscape），不加 BGM/旁白/字幕，除非用户要求。完整流程加载 \`paper-collage-explainer-generator\`。 |
| 手绘实景融合 | 手绘发光动画+实拍空间融合超现实 | 设计连续变形/逃脱路径+手持追拍→写一段 15s、16:9 的 H3 提示词；前 3 秒必须与真实手/物体清晰接触并同体变形，镜头总慢半拍追赶。完整流程加载 \`handdrawn-live-video-generator\`。 |

**能力边界（必须如实告知用户）**：
- 字幕 / 对白 / 广告词 / 旁白文案：一律走 write_script 落到「文案」节点（成片详情展示），**当前不烧录进画面**；如用户要硬字幕，需自备含字幕的素材或等后续工具支持。若上游 skill 流程调用字幕生成，用占位工具 \`subtitle_burn\` 获取降级指引。
- 背景音乐：用用户提供的 BGM 文件节点（compose_video 的 bgmNodeId 混入）；**当前无音乐生成工具**，不要承诺自动作曲。若上游 skill 流程调用音乐生成，用占位工具 \`music_generation\` 获取降级指引。
- 旁白 TTS：当前无语音合成工具，旁白文案由 write_script 产出，音频需用户自备或仅作文案。若上游 skill 流程调用配音生成，用占位工具 \`tts_voiceover\` 获取降级指引。
- 「确认图」类风格（如合作游戏开场）：直接复用第 5 步定妆锚点 + 逐步确认门禁，先出确认图让用户拍板再生成。

## 标准工作流

**入口分流（动手前先判断手里有什么素材）**：
- 纯文字创意 → 从第 1 步全流程走。
- 带参考图 → 把参考图按 role（character/style/frame）用于定妆锚点与关键帧（见第 4 步），不必从零策划风格。
- 带参考视频 → 上传后 Host 已自动抽帧并把帧图标记为 style/frame 参考、在画布生成「风格归纳」便签：先调 list_references 读 notes 拿到归纳内容，再按结论做 style_transfer 对齐各镜（见第 4 步）。
- 二次修改已有项目 → 不重跑澄清与分镜，直接对要改的节点右键重试或在对话中说明调整方向（steer）。

1. **需求澄清**：逐步确认模式下按五要素**逐项提问**（一次一问，带候选项）；放手跑模式可自行假设并说明。
2. **创意策划**：用 prompt_enhance 打磨整体创意描述。
3. **分镜规划 → 审批**：输出分镜表（见下），逐步确认模式下调 submit_storyboard_for_approval 等待批准。
4. **参考素材预处理（可选）**：用户提供角色/风格参考图时，可先 image_generate 生成三视图（正面/侧面/背面）或 style_transfer 适配当前需求，再作为后续关键帧参考；用户上传过参考视频时，先调 list_references 读画布上的风格归纳便签与抽帧图（帧图已带 filename），按归纳结论做 style_transfer 统一风格或取帧作首帧——不要凭空假设风格。两者均不强制：也可直接用原素材仅作关键帧参考。
5. **定妆锚点**：批准后 image_generate 生成主角定妆照 / 场景概念图 —— 这是全片一致性的锚点（优先用第 4 步预处理后的三视图）。
6. **逐镜出图**：每个镜头调 image_generate，传定妆照 filename 作参考保持角色一致，**并传 shotRefs=[该镜分镜卡标题]**（如「分镜 1 · 特写」，来自提交分镜的工具结果）——关键帧会连到对应分镜卡并排在其右侧；风格不稳时用 style_transfer 统一到首图风格。
7. **上传**：对每个镜头图调 upload_image 拿 filename（可并行）。
8. **文案策划**：用 write_script 产出结构化文案，覆盖广告词、对白、背景音乐（BGM 说明）、音效（SFX）、字幕。其中的对白写入视频提示词的 <d>[语言]原话</d>，BGM 写入 non_diegetic_music:，音效写入 overall_soundscape:；该文案既驱动各镜头 H3 提示词，又将在第 10 步合成时作为 scriptId 传入成片节点展示。
9. **逐镜视频（可多关键帧）**：按镜头复杂度选生成方式——单关键帧用 video_generate（首帧图生视频 fl2va）；两段衔接用 video_composite 两张图（首尾帧插值 fl2va）；三张及以上转场用 video_composite 多参考图（ref2va，filenames 按时间顺序，最多 6 张）。不再回退到「只用单张图」，尽量用首尾帧/多关键帧锁定动作与构图。每段视频 prompt 一律按上方 H3 规范重写，并传 shotRefs=[该镜分镜卡标题] 关联分镜。
10. **成片合成（拼接已有片段）**：调 compose_video 把时间轴上已有的视频片段拼接成最终成片（缺省取全部视频，≥2 段）；可传 bgmNodeId 指定 BGM、scriptId 指定第 8 步的文案节点。严禁再用 video_generate / video_composite 从图片重新生成视频——成片只由已有片段拼接而成。

**成片前自检（调 compose_video 之前必做）**：① 时间轴上所有视频节点均为成功态，无失败 / 生成中占位；② 各片段时长之和合理（不超过需求澄清的成片时长上限）；③ 血缘边完整（每段视频的 sourceUrls 已填，能在画布上连成链路）；④ 如需 BGM，确认 bgmNodeId 指向的用户音频节点存在。任一条件不满足先修复对应节点再合成。

## 分镜表格式（提交审批的正文就用它）

| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |
| --- | --- | --- | --- | --- | --- |
| 1 | 远景 | 缓慢推进 | 5s | 村庄全貌，晨雾未散 | 环境音、鸟鸣 |

## 镜头参数词汇

- 景别：大远景 / 远景 / 全景 / 中景 / 近景 / 特写 / 大特写。
- 运动推拉摇移跟升降+固定；写进 prompt 用自然语言（如「镜头缓慢推进」）。
- duration：逐镜时长取自分镜表的「时长」列（各镜之和 = 成片总时长）；video_generate 建议 8–10s（默认 5，上限 15）；video_composite 取 8–15s（默认 10）。

## 一致性要点

- 先出角色定妆照；后续所有含该角色的镜头都以它为 filename 参考图。
- 第一张成图确定风格后，后续镜头用它做风格参考（style_transfer 或图生图）。
- 质量差时用 negativePrompt 排除瑕疵（如「模糊，变形，多余手指」）。
- 单节点失败可在画布右键「重试」（原地更新，不产生新边）；整体方向调整直接在对话里说明（steer）。
`;
/**
 * Register the creation skill into the host skill registry.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the registration disposer.
 */
export function registerCreationSkill(ctx) {
    return ctx.skills.register({
        name: CREATION_SKILL_NAME,
        description: CREATION_SKILL_DESCRIPTION,
        source: 'runtime',
        content: CREATION_SKILL_CONTENT,
    });
}
