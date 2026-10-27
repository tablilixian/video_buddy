# 画布工具链完整手册（按需查阅）

> 本文是**工具链与平台事实的唯一事实源**：工具参数表、占位工具降级、视频供应商差异、参数现状，以及**能力槽位绑定表**与**平台事实清单**（CV-319 从总纲下沉）。
>
> 总纲只做路由与安全协议，**不再复述**这里的规则 —— 需要细则时读本文。

## 能力槽位绑定表（CV-319，写提示词前先查这里）

6 个能力槽位对应知识型 skill。**写图像 / 视频 / 音频 / 镜头提示词前，先按本表加载对应 skill**，再读 `prompt-writing.md`。总纲**有意不点名具体 skill**——新增知识型 skill 只改本表一处，总纲永不过期。

| 槽位 | 当前 skill | 用途 | 加载后必读 |
| --- | --- | --- | --- |
| `video-prompt` | `h3-prompt-writing` | 视频提示词（Ref2VA / FL2VA / I2VA / L2VA / T2VA） | 对应模式的 IR 字段表（Ref2VA 六段式读 `references/ref-en.txt`、FL2VA 三段式读 `references/base-en.txt`） |
| `image-t2i` | `krea2-turbo-writing` | 文生图提示词 | 九段式结构、正向改写规则、打光与文字渲染词表 |
| `image-edit` | `krea2-edit-writing` | 图生图 / 改图提示词 | 指令式四段式、多参考图 4 席位分工、分步链式 |
| `audio-music` | `music-prompt-writing` | BGM / 配乐提示词 | 五维必写项 |
| `audio-voice` | `voiceover-writing` | 配音 / 旁白声音设计 | 七维声音设计 |
| `camera-language` | `cinematic-moves` | 镜头语言 / 运镜词汇 | 运镜术语表 |

**槽位纪律（CV-331 起）**：

- 本表**只登记内置 skill**。一个槽位**至多一个**知识型 skill 占用；新槽位由平台单方面增加，本表是唯一改动点。
- **用户上传的 skill 不参与本表、不占用槽位**（P3 拍板）：它靠 catalog 自动发现 + 激活集装载生效，与内置 skill 在装载上同权。所以本表 6 个槽位永远只指向内置实现 —— 用户 skill 抢不走、也不会因为本表读取失败而顶掉内置。
- 用户安装的知识型 skill **只能声明知识**（格式规范、参数含义、词表），**不得声明流程、审批门与工具契约**——越界声明不生效。
- 决策型（编排 / 导演型）skill **不开放**用户安装，平台掌控。

## 平台事实清单（CV-319 从总纲下沉）

这些是**平台契约与能力事实**，不随创作流程变化，也**不属于任何 skill 的风格知识**。总纲已不再复述，细则以本节为准。

1. **只有 `filename` 这一种文件入参**——不能直接传图片 URL。需要图片输入的工具一律吃 Drama Backend 的服务器文件名。
2. **两类 filename，可消费性不同**：见下文「两类 filename」节。产物名直接入参会在约 0.1s 内 500，且后端把「文件不存在」与「服务端错误」统一报成 `Internal Server Error`，**看不出真因**。
3. **图片类同步阻塞 / 视频类异步**（后端 0.5.0 起）：见上文「调用节奏」节。图片类「打断」只是本地中断 fetch，服务端任务不回收。
4. **画幅**：`aspectRatio` 同一项目保持一致、不要混用。视频类工具（`video_generate` / `video_composite`）**只支持 16:9 / 9:16**，传 1:1 会被参数校验拒绝；1:1 仅限图片类工具。
5. **`sourceUrls` 必填**：调 `image_generate` / `video_generate` / `video_composite` 时，把本次用到的参考图产物 URL（此前工具结果里的 `url` 字段）填进 `sourceUrls`——画布据此画流程箭头（血缘边），用户靠它理解制作链路。
6. **`shotRefs` 逐镜对位**：逐镜生成关键帧 / 视频时把 `shotRefs` 设为该镜分镜卡（提交分镜后工具结果会列出每张卡标题，如「分镜 1 · 特写」），画布会把产物连到对应分镜卡并排在其右侧，形成逐镜对照。
7. **你没有视觉能力**：任何「直接看图」的尝试都必然失败（报错 `model does not declare image input` / `switch to an image-capable model to read images`）。禁止一切变体：用文件读取类工具读本地图片路径（`file_path`、`/canvas-studio/assets/...`）、把图片 URL/路径塞进任何工具参数当图用、在回复里内嵌图片引用让模型分析。**不要在生成后宣称「我看一下效果」然后尝试读图。**
8. **对话附件自动转存**：用户在对话里贴的图片附件会被画布自动落为参考素材节点（自动标记为参考，进参考托盘与 `list_references`），消息正文自动追加 `@ref[文件名]` 引用标记。**逐字使用该 token** 当 `filename`/`filenames`——标题就是文件名（常为 UUID 形态），不要改写或「美化」。需要判断画面用 `image2vl(filename="@ref[文件名]")`。**附件 filename 由画布后台回填，不要对附件再调 `upload_image`。**
9. **全局资产库引用**：用户提到既定角色 / 场景 / 物件 / 群像（按名称或别名，如「女主」「雨夜巷弄」）时，system prompt 的「全局资产库」小节或 `list_references` 的 `library` 字段里有 `id=lib:<uuid>`——要作参考图 / 文件引用时**逐字使用** `@ref[lib:<id>]`（裸 `lib:<id>` 同样可解析），Host 自动把该资产的媒体物化到当前项目并换出可用 filename；**不得改写、翻译或截断 id**。库条目没有媒体文件时会明确报错，此时只按名称 / 别名用它的文字信息，**不要把 id 硬塞进 filename**。
10. **产物 URL 只用于展示**：`image_generate` / `video_generate` 等返回的 `url` 用途只有三个——展示给用户、画布血缘、`upload_image` 取 filename。**不是视觉输入**。需要确认画面内容的唯一合规手段是 `image2vl`（视频用 `video2vl`）：先 `upload_image(imageUrl=url)` 拿 `filename`，再 `image2vl(filename=…, prompt=「描述/检查…」)` 拿文字结果；无需内容判断就直接文字汇报产物（尺寸 / 数量 / URL）。
11. **`image_fix` 与 `image-edit` 槽位的分工**：去水印 / 去瑕疵 / 局部小修 / 图内文字修复走 `image_fix`；结构性改图（换构图、改风格、重绘）走 `image-edit` 槽位的 skill。**不要对大改用 `image_fix` 硬撑** —— 它是改图接口，prompt 里带场景/角色/风格描述会伤及画面。
12. **像素真值只有 `inspect_image` 一个来源**：定位素材上的物理区域（表盘屏幕暗区、白底边缘）用 `mode:"bbox-dark"` / `"bbox-bright"`，返回的画布百分比中心与宽高与 `render_composition` 的 box 同口径、直接填轨道；主色用 `mode:"colors"`。**禁止手写 PNG 解码脚本（node:zlib 手解）、禁止找 PIL / ffprobe 探像素**——环境里没有，写了就是白烧 25 分钟（真机实证）。
13. **临时脚本写进项目内目录**（如项目根 `build/`）：`/tmp` 会被沙箱清空，写进去 = 返工一遍（真机实证）。
14. **探查宿主实现只查 `canvas-studio/` 子目录**：grep / find 一律限定 `canvas-studio/src` 等明确子目录，**不做仓库根全仓扫描**（全仓 grep 单次 8s+ 且混入上游 submodule 与构建产物噪声）。项目元信息（清单 / 工作流模式）以 system prompt「执行模式」小节给出的 `projects.json` 路径为事实源，不要在 `~/.videobuddy` 下猜路径。
15. **多行脚本禁止内联 `node -e "…"`，一律 heredoc 落盘再跑**（2026-10-26 真机实证）：宿主 shell 对带引号/中文路径的多行内联脚本会吃掉引号，node 落进 REPL 等 stdin → 挂满 300s 熔断，且持久 shell 里后续命令排队连环挂（一次烧 10 分钟）。正确写法：`cat > build/val.mjs <<'EOF' … EOF` 然后 `node build/val.mjs`（同会话实测秒回）。
16. **QC 铁律：动画轨先看窗口末帧再定论**（2026-10-26 真机实证）：抽帧号落在某轨的动画窗口内（`render_composition` 报告的 `animationWindows`）＝ 该帧在动画飞行中，位移/透明度异常是**过程快照不是 bug** —— 曾把 maskReveal 中段的标题判成「偏移 ~100px」，烧 4 轮排查。先对窗口、再看末帧；两帧对比一致才允许报布局问题。
17. **禁止把大 JSON 全量 dump 进上下文**（2026-10-26 会话取证）：反复把整份 storyboard.json / manifest cat 进回复是**上下文死亡螺旋**的头号推手——10MB 会话、4 次 compaction，每步 prefill 从 27s 恶化到 41s。读大文件一律**定向提取**（jq / python 片段 / grep 字段），回复里只带结论与关键行；连续探查类操作**合并成一次脚本**跑，不要「想一下、探一根针」逐次调用。

## 调用节奏：图片类逐个来，视频类批量提交（先读这一节）

Drama Backend 的**图片 / 音频 / 分析类**端点是**同步阻塞 + 单任务**——同刻只处理一个请求，一次 POST 等到出片才返回。**并发提交只会排队，不会加速**（实测 A 9.4s / B 18.7s，两个一起发墙钟仍是 18.7s）。

- **串行受约束**（同步单任务，**必须逐个调用：等上一个返回结果，再发下一个**）：`upload_image`、`image_generate`、`image_generate_withtxt`、`image_fix`、`character_generate`、`character_sheet`、`image2vl` / `video2vl` / `qc_shot`、`music_generation`、`tts_voiceover`、`tts_narration`（内部已串行，一次调用里不要并发）
- **不受约束**（本地 ffmpeg，不占后端）：`compose_video`、`extract_last_frame`、`cut_audio`
- 逐镜出图 / 上传时，**一个镜头跑完再起下一个**；`upload_image` 也一样逐个来（SKILL.md 第 7 步）。

**例外：视频已改异步（后端 0.5.0，CV-237）**——`video_generate` / `video_composite` 提交即返回（202 + job_id），ComfyUI 自行排队串行执行。**非 chain 镜的视频调用在同一个回合内一次性全部发出**（SKILL.md 第 9 步批量提交），不要等上一镜出片；chain 镜依赖上一镜末帧，按链序自然串行。每个任务由系统独立跟踪（30s 轮询），**不要重复提交同一镜**。

## 两类 filename：可消费性完全不同（CV-155，最常踩的坑）

| 类别 | 形态 | 来源 | 能否作入参 |
| --- | --- | --- | --- |
| **上传句柄** | `ref-xxxxxxxx.png` | `upload_image` 返回，或画布后台回填 | ✅ 所有带文件端点通用 |
| **后端产物名** | `img_01287_.png`、`z-image_00852_.png` | 生成类工具结果里的 `filename` 字段 | ❌ 约 0.1s 内笼统 500 |

后端把「文件不存在」与「服务端错误」统一报成 `Internal Server Error`，所以把产物名当入参**看不出真因**（2026-09-11 实测定案，证据见 `docs/api-probe/archive/2026-09-11-filename-consumability.md`）。

把**产物**喂给下游的合规路径（二选一）：

1. `@ref[节点标题]` —— Host 会把节点上的产物名自动换成句柄（`resolveRefFilenames`），**这是首选**；
2. `upload_image(imageUrl=产物url)` —— 显式取句柄。

> 画布节点 `filename` 字段的不变式 = **恒为后端当前可用的名字**：产物节点被引用时会被就地换成句柄。你手里留着的旧产物名不要原样传，用 `@ref` 重新取。


| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| ask_user_choice | 点选式提问（澄清阶段必用） | question、options[]（推荐项加「（推荐）」）、allowFreeText?（缺省开启自由输入框，false 隐藏）、multiSelect?（true 为多选，答案以「、」拼接） |
| submit_keyframes_for_approval | 关键帧提交确认（**REQ-022 后唯一的对话流审批门**）（**条件门**：仅当本镜逐镜出图（按需、默认不出）实际产出过关键帧时才提交；一张都没出则跳过直接进第 9 步） | summary? |
| image_generate | 文生图 / 图生图（单或多参考）；画风写进 prompt（0.7.0 对拍：style 参数随 txt2imageanime 端点退役）；**模型路由 R-P1-03：Host 逐次现算端点——prompt 含要显示到画面的文字（引号框住）自动走 Qwen 文字渲染，无字自动走 Krea2，你不必为选端点纠结**；**重出样张 / 参考图必传 `replaces`**（旧图自动失效退出参考池，CV-159） | prompt（画风描述写在这里）、aspectRatio、resolution?、filename?（单参考图）、filenames?（最多 4 张多参考图，CV-189）、replaces?（被取代图片节点的 id）、shotRefs?（关联分镜卡）、autoFixText?（默认 true） |
| image_generate_withtxt | **文字渲染特化**（CV-270，Qwen Image 2.1）：prompt 含**要显示到画面上的文字**（片名字幕卡/海报标题/标语招牌/封面）时用，中文可逐字正确（探针实测）；与 image_generate 在纯文生图上**等价**（路由按提示词改道，无字图会自动降级 Krea2）；**纯文生无参考图入参**（要参考已有图 → image_generate；已出图文错了 → image_fix）。**要渲染的文字逐字写清**（内容+位置/字体/排版，如「片名《剑归江湖》用大字竖排在画面右侧」） | prompt（含要渲染的文字规格）、aspectRatio、resolution?、replaces?（被取代图片节点 id）、sourceUrls?、shotRefs?（带字幕/招牌等文字的关键帧应传） |
| image_fix | **图内文字修复**（Boogu Edit，CV-202）：Krea2 出图后画面文字出错（错字/乱码/缺笔画）时走本工具，**不要换提示词整图重出**（重出会丢掉已正确的画面）。**prompt 只写文字部分**（要修的文字 + 字体/排版/位置锁定），不要带场景/角色/风格描述 —— 这是改图接口，多余描述会伤及画面。产物 `boogu_*` 前缀（属产物名，不可直接作下游入参，引用走 `@ref[节点标题]`） | prompt（**只写文字部分**）、filename（要修复的图，upload_image 句柄或 `@ref[...]`）、replaces?（被取代图片节点 id）、shotRefs?（修复逐镜关键帧上的文字时传） |
| character_generate | 角色设计图 → 角色立绘 / 三视图（**只要一张立绘图、不建资产卡**；一致性锚点走 character_sheet） | filename（角色设计图，来自 upload_image）、aspectRatio?、shotRefs?（关联分镜卡） |
| character_sheet | 定妆照 / 角色设计图 → **一致性资产卡**：四视图立绘拼图整图作唯一锚点（进参考托盘）+ 冻结 SAME 块；**同名卡整体覆盖**（纠正冻结描述的路径） | filename（定妆照/设计图，来自 upload_image 或 `@ref[...]`）、name（稳定角色名，如「女主」）、lockedPrompt（与用户确认后的 SAME 块）、negativePrompt?、sourceUrls? |
| look_card | **Look 卡**（CV-157）：5 项 tokens 冻结成 `role=style` 资产卡，逐镜逐字节注入；**不调后端**（样张由 image_generate 出）；`Look · ` 前缀自动补、**同名整体覆盖** | name（短名，如「雨夜霓虹」）、lockedPrompt（5 行 `色彩：`…`节奏：`）、referenceFilename?（锚点：`@ref[节点标题]` / 节点 id / 文件名；缺省=纯文字注入，不占参考位）、negativePrompt? |
| image2vl | 画面分析（VLM） | filename（**句柄**：`upload_image` 返回或 `@ref[显示名]`；产物名不可直接用，详见上文两类 filename）、prompt |
| video2vl | **视频理解**（Qwen3-VL，CV-230）：按时间轴 / 逐镜头描述景别、机位运动、节奏、主体动作。用于拆解**参考片**、把已生成的镜头复述成文字以便写下一镜、核对成片运镜。⚠️ **要做分镜拆解就什么都别传 `prompt`** —— 缺省 `mode:'shot-breakdown'` 会用**后端同事调优过的官方模板**（角色设定 + 九项字段 + 「直接输出、不要注释」收口），**自己重写模板必然漏项改味**；只有问**别的**问题时才传 `mode:'free'` + `prompt`（原样发出） | video（**句柄**：同 image2vl 的 filename 纪律，产物名必 500；画布视频节点用 `@ref[显示名]` 最省事）、mode?（缺省 `shot-breakdown`）、prompt?（shot-breakdown 下是**可选的一句额外关注点**；free 下**必填**）、systemPrompt?。⚠️ 与「右键拆分视频」的帧图**不是二选一**：要参考**画面**用帧图，要参考**运镜/节奏/时长分配**用它；耗时按片长增长（实测 1.65MB 片 16.7s），且占用后端单任务槽位 |
| video_generate | **首尾帧通道**（CV-269 拆分：恒走 `image2videofl2va`）——纯文生视频 / 单首帧图生视频 / 首尾帧插值；多参考请用 video_composite | prompt、filename?（首帧图）、filenameTail?（尾帧图，与 filename 联用 = 首尾帧书挡）、duration（默认 5s）、generateAudio?（原生音轨开关）、shotRefs?（关联分镜卡） |
| video_composite | **多参考通道**（CV-269 拆分：恒走 `image2videoref2va`，2 张图不再解释为首尾帧）——参考图锁定角色/场景/风格，可再带参考视频/音频 | prompt、filenames[]（1~9 张，第 N 张即 `<Picture N>`；按用途组合：定妆照/场景概念图/姿态关键帧）、duration（默认 10s）、audioRefs?（参考音频 ≤3 段 / 合计 ≤15s）、videoRefs?（参考视频 ≤3 段，仅 Drama）、shotRefs?（关联分镜卡） |
| qc_shot | **镜头一致性质检（CV-240 起仅用于项目完成时的《质检报告》）**：视觉模型对照资产卡 lockedPrompt 核对画面（外貌/服装/道具；基准含 Look 卡时逐项核对风格维度 色彩/光线/材质/镜头语汇，「节奏」单帧不可判不参与）→ PASS / FAIL / WARN + 漂移项，结论写回该节点。缺省基准**按角色分组**：角色/场景卡逐项一致、Look 卡整体调性（允许轻微波动、不允许调性反转）。⚠️ **过程中不要调用**——质检不参与生成流程、不触发返工（CV-214 起 FAIL/WARN 一律不自动重跑，CV-240 起连过程中调用也取消）；仅在成片交付后逐镜运行并把结果汇总进《质检报告》供用户参考。**放手跑模式自动跳过**（返回 skipped，不烧预算） | filename（被检镜头图，**句柄**：`upload_image` 返回或 `@ref[显示名]`——刚生成的镜头图用 `@ref` 最省事）、expect?（缺省取资产卡 lockedPrompt）、shotRefs?（**必传**，报告按镜标注）、budget?（默认 2） |
| upload_image | 上传本地/产物图片到 Drama Backend（后端**唯一**上传端点 `POST /api/v1/generate/upload`，图片/视频/音频通用；旧 `uploadimage` 已于 2026-09-10 下线返回 404）。**标准流程：所有以文件名为入参的接口（image / image1..9 / video1..3 / audio1..3）都必须先上传拿名字，再填参数** | imageUrl（产物 URL 或本地路径） |
| music_generation | **BGM 生成**（Drama `txt2audio` / Yue2，可用非占位）：产物音频节点自动落画布，合成时传 `compose_video` 的 `bgmNodeId` 混音（CV-209 自适应淡入淡出），**不要把音频节点传给 clipIds**。上游 skill 里的 `music-2.6` 即本工具 | prompt（整体 tags：情绪/风格/乐器/节奏，英文更稳；节奏/调性等音乐特征一律写进 prompt —— Yue2 不消费 bpm/keyscale/language 元数据参数）、duration（**不传 = 等于成片真实时长 T**，传则按余量梯度 —— 见下文「BGM 时长铁律」）、lyrics?（纯器乐留空，自动填 [Instrumental]） |
| tts_voiceover | **配音生成**（CV-271 占位升真，Drama `txt2speech` / VoxCPM2）：把文本合成语音，音频节点自动落画布。⚠️ **角色对白不用它**——对白走视频提示词 `<d>[语言]原话</d>`（原生口型）；本工具只做旁白/画外音/独立配音资产。**instruct_prompt 声音设计**自然语言写（语言/性别/年龄/语气/情感/语速/方言，30 语种 + 9 中文方言，写法先加载技能 `voiceover-writing`）；**时长由文本长度决定（约 4 字/秒），无时长参数**（要精确改速用 `speed`，实测 ÷目标 即得）；**多段旁白音色一致只能靠 refaudio**——先合成第一段作「音色锚」，后段全部传同一个 `refaudio`（实测：同一串 instruct 连发 3 次，基频极差 45%，只靠复用 instruct 不保证一致）。配音节点**可以**作 `compose_video` 的 `bgmNodeId`（会按旁白轨满音量从 0 秒铺开），但**多句旁白必须走 `render_composition` 的 `audio.voiceOver[]`**（帧级落位）；作 `video_generate`/`video_composite` 的 `audioRefs` 时先 `cut_audio` 裁到 ≤15s | text（成品口语稿，逐字念出——不要写舞台指令/填充词）、instructPrompt?（声音设计七维）、refaudio?（音色克隆源：上传句柄 / `@ref[节点标题]` / `lib:<音色id>` / 节点 id）、replaces?（原地重写旧音频节点）、speed?（0.5–2，宿主 ffmpeg 确定性变速）、pitchSemitones?（±12，变调不变速）、sourceUrls?、sourceNodeIds? |
| tts_narration | **多段旁白批量合成 + 帧级排期**（P1-1，2026-10-26）：一次调用合成 N 段旁白，**帧号由代码算好并直接给出 `audio.voiceOver[]` 数组**。≥2 句旁白一律用它，别手调 N 次 `tts_voiceover` 再自己累加帧号（手算帧号错了要整片重渲才发现）。**音色锚由参数形状强制成立**：不传 `voice.refaudio` 就自动拿第一段当锚，后段全部克隆它（零额外合成）；首段若是哭喊/耳语这类极端语气，就另造一条中性锚存进资产库（`add_to_library` category=`voice`），再传 `voice.refaudio="lib:<id>"`。⚠️ **不是事务**：第 k 段失败时前 k-1 段已落卡且额度已花，报错里会列出已完成节点——**不要整批重跑**，用剩余文本续跑 | lines[]（每段 `text` / `gapSeconds?` / `instructPrompt?`）、voice?{instructPrompt?（七维，全片一份）、refaudio?（音色锚）}、fps（**必须与 manifest meta.fps 相同**，24/25/30/60）、startFrame?（首段起点，缺省 0）、gapSeconds?（全局段间隔秒，缺省 0.4；负数 = 重叠）、speed?、pitchSemitones?。返回 `voiceOver[]` 直接抄进 manifest，再核对 `totalFrames ≤ durationInFrames` |
| write_script | 产出结构化文案（对白/字幕/BGM/SFX 说明）落到「文案」节点 | script（markdown） |
| list_library_assets | **列资产库**（P1-2，2026-10-26，只读）：拿 `lib:<id>` 句柄。要复用角色的定妆照、场景概念图、或**音色锚**时先调它——`refaudio: "lib:<id>"` 是目前跨会话复用同一音色的唯一可靠手段（资产库有人能改名/试听/删除，比自建音色槽稳） | category?（character / scene / prop / group / voice；`voice` = 音色）、q?（关键词：名称/描述/标签）、limit?（缺省 50，截断时 `truncated=true`——看到 true 说明还有更多，别当成全部） |
| add_to_library | **画布节点入库**（P1-2，2026-10-26）：把画布上已有的音频/图片节点存成资产条目（媒体**真拷贝**进库目录，不是只记一行元数据）。典型用法：造好一条中性音色锚 → `add_to_library(nodeId, category="voice", name="音色锚 · 女主")` → 之后每段都 `refaudio: "lib:<id>"`。⚠️ **视频不能入库**（正路是画布引用 + 抽帧） | nodeId（画布节点 id，**真实存在**）、category（character / scene / prop / group / voice）、name（条目名，同名会冲突并指路）、description?（人读的描述：外形/音色特征）、tags?、aliases? |
| write_storyboard | **拍摄定稿**（REQ-022）：产出 `storyboard.json` 全片规划（SSOT，九节）。**只写 JSON、不落画布**；重复调用属**分节合并**——传哪节替换哪节，没传的保留现值（要清空须显式传空内容；整体重写 = 九节全传，旧内容自动存为一版）。落画布由用户在「拍摄定稿」覆盖层点「确认落地」（原子批上线后可用） |
| layout_table | **项目级布局坐标表**（shotcraft 本地化 P0-a，2026-10-25）：`layout.json` 存命名矩形（画布百分比、x/y 中心语义），把「表盘区 / 左栏 / 字幕带 / 安全边」一次量清、全片复用。**工作台不是渲染输入**：返回可粘的 `box` 片段，必须展开进 manifest（`render_composition` 不读 layout.json） | action（read / write / clear）、name?、rect?{x,y,w,h}、note? |
| adopt_canvas_as_storyboard | **老项目迁移**（故事板强约束 L4，2026-10-25）：从画布上已有的分镜卡反推 §04 骨架（scene·shot 号 / 时长 / 运镜 / 视觉 / 声音 / 英文 prompt），用项目预置补 `meta`，落 `storyboard.json` 并返回**剩余阻断项**。只还原卡上真有的事实；**不落画布**、不覆盖已落地项目。用于「故事板强制之前就落了画布、缺 storyboard.json」的老项目 | （无参数） | title?、meta?、creative?、visual?、storyboard?、narration?、characters?、sound?、facts?、assets?、constraints?（各为 **JSON 字符串**；首稿建议至少 title+meta+creative+visual）、**awaitingLanding?**（收尾笔必传 `true`：落地阻断项清零后 Host 结束回合、交权给覆盖层；中间笔不传） |
| cut_audio | **裁切音频片段**（Host 侧本地 ffmpeg，不调后端、秒回）：把一段音频裁成需要的区间，产物落为**新音频节点**（血缘指向源节点），可作 `bgmNodeId` / `audioRefs`。用户说「裁一下 / 只要 12–20 秒 / BGM 太长 / 只留副歌 15 秒」就用它 —— **不要自己拼 ffmpeg 命令，也不用去找 ffmpeg 在哪** | audio（画布音频节点 id / `@ref[显示名]` / 本地资产文件名；视频节点 = 抽它的音轨）、start（秒，含）、end（秒，不含；超源长自动截到末尾并给 warnings） |
| list_shots | **镜头清单**：列画布上所有视频片段（节点 id / 分镜卡 / 版本号 / 状态 / 时长）。**返工或精确合成前必调** | includeRetired?（默认只列有效片段） |
| extract_last_frame | 抽视频**真实末帧**（本地 ffmpeg，不占后端），供 `shotTransition=chain` 链帧用 | videoUrl（视频片段的同源 URL，即 `video_generate` / `video_composite` 返回的 `url`）。**只在衔接语义为 `chain` 时调用**；返回的 `filename` 直接作下一镜的 `filename`/`filenames[0]` |
| inspect_image | **像素级图像检测**（本地零依赖，只支持 PNG，CV-362）：bbox 定位（暗/亮阈值 → 画布百分比中心与宽高，与 render_composition 的 box 同口径）/ 主色 top-N / 基础信息。**把代码 UI 落进素材物理区域（如表盘屏幕暗区）用 bbox-dark 拿百分比直接填轨道**；**这是唯一像素真值来源，禁止手写 PNG 解码脚本 / 找 PIL** | filePath（PNG 绝对路径）、mode（`profile`/`bbox-dark`/`bbox-bright`/`colors`）、threshold?（dark 缺省 40，bright 缺省 215）、topN?（colors，缺省 8） |
| scaffold_manifest | **结构骨架生成**（REQ-035）：`title` + `durationSeconds` → 合法 manifest（底色 + 片头 + 片尾），返回前已过 validateManifest。**时长自洽一次算对**（meta.durationInFrames = 最大结束帧、exit ≤ 轨道时长）；改末尾轨时长后必须同步 meta，否则会被尾部完整性校验拒收 | title（片名）、durationSeconds（秒，>0）、fps?（24/25/30/60，缺省 30）、aspect?（16:9/9:16/1:1，缺省 16:9）、theme?（cold-tech / ink-press / warm-ember / neon-data；展开成底色 + 强调色 + 动效基线，manifest 不存 themeId）、recipe?（explainer-cards 零素材 / product-walkthrough 需 1 张产品图 / story-arc 需 2 张场景图；**接管 tracks 骨架** + 给时间轴 + 给 §07 素材清单） |
| compose_video | 拼接时间轴已有视频片段成成片（可混 BGM / 挂文案）。**缺省只取有效片段**（失效版本自动排除） | clipIds?、bgmNodeId?、scriptId?、colorGrade?（默认开，统一调色；false 关闭） |
| render_composition | **代码驱动合成**（Remotion，REQ-034）：按 manifest 渲染字幕卡 / 数据卡 / 转场 / 图文幻灯片成成片。返回结构与 `compose_video` **完全相同**（另加 `frames` 抽帧 + `report` 渲染报告）。客户端渲染、不占后端；素材先 `list_references` 对账。**节奏/排版没定前用 `quality:"draft"` 迭代**（半分辨率、跳过渲染前预览闸门、快 2.5×+），定稿再 `standard`/`high` 重渲 | manifest / manifestPath（**二选一**：JSON 字符串，或先把 manifest 写入项目内文件再传绝对路径——长片推荐后者，入参过大被截断会在渲染前被尾部完整性校验拦下）、projectId?、quality?（`draft`/`standard`/`high`，缺省 standard） |
| list_references | 列出当前项目参考图（角色/风格）与**一致性资产卡**供 `@ref[显示名]` 引用；返回 `references` / `assets` / `notes` 三段；**失效参考默认不列**（`includeRetired=true` 连同失效一并读出，带 `status`） | includeRetired? |

**BGM 生成 `music_generation`（可用，Drama txt2audio / Yue2）**：prompt 传音频整体描述 tags（情绪/风格/乐器/节奏，英文效果更稳）；纯器乐 BGM lyrics 留空（自动填 [Instrumental]）。产物音频节点自动落画布，成片合成时传 `compose_video` 的 `bgmNodeId=<节点 id>` 混音（**CV-209 自适应淡入淡出**），不要把音频节点传给 clipIds。上游 skill（如 minimalist-product-ad-generator）中出现的 `music-2.6` 即本工具。

**音频裁剪 `cut_audio`（本地 ffmpeg，不调后端）**：手上有**现成的整首曲子**（用户上传的 mp3、`music_generation` 出的 BGM），只要其中一段时用它裁，不要重新生成：`cut_audio(audio=@ref[节点标题], start=12, end=20)` → 新音频节点落画布（源节点保留），拿它的 `nodeId` 作 `compose_video` 的 `bgmNodeId`。给 `video_generate` / `video_composite` 的 `audioRefs` 时更硬性 —— 官方规格**合计 ≤15s**，超长的音乐先裁出最想要的 15s 内片段。区间左闭右开；`start` 越界报错并给出可用区间，`end` 超长自动截到末尾（结果里的 warnings 要转告用户）。

**BGM 时长铁律（CV-138 + CV-209，余量梯度）**：
1. 先 `list_shots` 读每段**真实时长**（ffprobe 实测，请求 5s 实测常为 5.167s）→ 求和得到成片真实时长 `T`。
2. `music_generation.duration` **不传等于等于 `T`，传则按余量梯度（推荐）**：

   | 成片真实时长 `T` | 推荐 BGM 时长 | 公式 |
   |---|---|---|
   | `< 15s` | `T + 3s` | 短片预留 3s 衰减 |
   | `15s ≤ T < 30s` | `T × 1.3`（向上取整） | 中片 30% 余量 |
   | `30s ≤ T < 60s` | `T + 8s` | 中长片 8s 余量 |
   | `≥ 60s` | `T × 1.2`（向上取整） | 长片 20% 余量，最长预留用于收尾 |

   **核心铁律：宁可比视频长也不要短**（你提的需求点 3）。短了 BGM 在成片终点前用完会被裁；长了 BGM 自带的尾部衰减正好做结尾渐隐，`compose_video` 的自适应淡入淡出（详见下一节）会检测头尾留白自动决定是否再叠 afade。
3. BGM 短于成片真实时长（即使加了余量仍不够）时 `compose_video` **直接报错不落成片**，报错会给出建议值（不再是"建议 ≥真值 +0.5s"而是"建议按上表余量梯度重生成"），按建议重生成即可。
4. 多镜成片**无须**强求 BGM（CV-209 重写后，多镜原生音轨已被保留为主声轨，无 BGM 仅少一层配乐，不会有无声成片）。

**自适应淡入淡出（CV-209）**：compose_video 检测 BGM 头/尾静默区 ≥ 2s 时**跳过**强制 `afade` 滤镜，信任音频自带的起止；不足 2s 时按 1s 淡入 / 1s 淡出兜底，避免在已静音的尾音上再叠一层"双重淡出"听感发闷。BGM prompt 也应在结尾明确"自然衰减 X 秒"以让模型直接产出正确的尾留白（music-prompt-writing §"五维必写"。

**占位工具（无后端，仅返回替代路径）**：`subtitle_burn`（硬字幕烧录）——canvas-studio 当前不具备烧录能力，上游 skill 流程要求调用时照常调用，工具会返回可操作降级路径（字幕→write_script 文案节点 + H3 提示词处理），不要报错或跳过流程。~~`tts_voiceover`~~ **已随 CV-271 转正为真实配音工具**（见上表）。

**CV-213 不自动字幕**：上述 `subtitle_burn` 占位工具**默认不调用**。视频生成路径（video_generate / video_composite / compose_video）默认**不**叠加任何字幕 / 字幕条 / 时间轴文字；H3 视频提示词默认**不**包含 "subtitle / caption / with subtitles" 类指令。只在用户**显式**开口要求字幕时才调 `subtitle_burn` 拿替代路径。`<d>[语言]原话</d>` 是角色对白（角色原生说出口），不是字幕——这条允许。

**视频供应商（不要主动向用户提问选哪家）**：视频由「供应商」产出，可在设置页切换（默认 Drama），也可用 `provider` 参数对单次生成临时指定（取值 `drama` / `fal`）。**不要主动询问用户用哪个供应商，也不要提供切换选项**——除非用户明确要求，否则一律用默认值出片。重试画布节点时会自动沿用该片原来的供应商，无需你干预。

**视频生成参数现状（`model` / `resolution` / `generateAudio` / `audioRefs`）**：

- **`model`（h3 / seedance2）：仍是占坑**——两个供应商都不支持模型切换，传 `seedance2` 会收到「暂未接入」提示并按 h3 出片。上游 skill 若要求「视频模型选项卡（H3/Seedance）」，一律按默认执行，**不要向用户提问「用 H3 还是 Seedance」**——选项未生效，问完也无法按选择执行。
- **`resolution`（`480p` / `736p` / `2k`，CV-187 起三档）**：档位 → 像素（16:9 基准）= `480p` 864×480 / `736p` 1280×736 / `2k` 1920×1088，竖屏反宽高、`1:1` 三档共用 1024×1024，宽高均为 32 的倍数。**图片与视频共用同一张档位表，但默认档分设**（C-8 对拍修正）：图片出厂默认 `736p`、视频出厂默认 `480p`（设置页「图片默认分辨率 / 视频默认分辨率」两个独立字段，用户改过以用户为准）。**缺省（不传）走用户默认；传参即显式覆盖用户设置**——除非用户明确要求更高档位，否则不要传 `resolution`（历史上本段曾写「736p（默认）」，agent 照传 736p 盖过用户的 480p 设置，即 Bug C-8）。两家供应商都按档生效（Drama 按档换算 megapixels，fal 直通 480P/736P/2K）。**不要为分辨率向用户提问**（除非用户明确要求指定）。⚠️ 首帧图生视频（i2v）**画幅跟随首帧图**（该端点无画幅参数），故首帧图要按目标画幅出好。
- **`generateAudio`：已按 H3 官方标准透传（缺省不发送）**——不传则不带该字段，由后端默认行为决定；传 `true` 请求「随画同步的原生音轨」（H3 的原生音频与画面**同一次推理**产出，含台词/音效/环境声，不是后期配音），传 `false` 要求静音。上游 skill（brand-promo-video-generator / minimalist-product-ad-generator）默认「原生音轨优先」，这类流程里**显式传 `generateAudio=true`**；后端尚未开放该字段时会给出明确的失败说明，不假装生效。
- **`audioRefs`（参考音频）：已按 H3 官方标准透传**——有序数组，**顺序即提示词里 `<Audio N>` 的引用序**（不得重排）；填画布音频节点的 `@ref[显示名]`。官方硬规格：≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、单段 ≤15MB，且**不能是唯一输入**（必须同时有 filename 或参考图）——不合规会在生成前直接报错，不浪费一次后端调用。带音频时按参考模式（r2v）生成，**与首尾帧语义互斥**；prompt 按 Ref2VA 六段式写，并在 `retention_analysis` 里声明每段音频是 `reference` 还是 `fully_copy`（见 `h3-prompt-writing` 的 `format-ref2va.md`）。

**IR 预检的模式按「图片数量」判，不按素材角色（CV-156）**：本地预检只看数量 —— 1 图 = 首帧 I2VA（即 `<Picture 1>`）；2 图 = 首尾帧 FL2VA（第 1 张首帧、第 2 张尾帧）；≥3 图 = 多参考 Ref2VA（第 N 张即 `<Picture N>`，位次 = `filenames` 顺序）；带 `audioRefs` 一律 Ref2VA。而 `h3-prompt-writing` 是按**素材角色**判模式，**两者必须一致**。**最典型的错位**：想「风格参考 + 首帧」于是写 Ref2VA 六段式，却只传了 2 图 → 工具解成 FL2VA → 预检报一串「段名混用 / 缺段 / 对齐行不符」（全是派生症状）。**正解是拆两步**（互斥约束使然）：先用风格参考出关键帧（`image_generate`），再把该关键帧**单图**走 I2VA。预检报错文案会直接点出这层真因，照它给的出路改即可。

供应商差异（你只需知道，不需要向用户解释）：Drama 多参考最多 6 张、fal 9 张；视频画幅只有 16:9（横屏）/ 9:16（竖屏）两档，两家都只收这两个（方形 1:1 仅图片类工具可用，视频工具传 1:1 会被参数校验拒绝）；fal 的时长下限是 5 秒（更短会被钳到 5 并提示）。改用 fal 需用户先在设置页配置 fal API Key，未配置时工具会直接报「未配置 fal API Key」——此时按默认供应商（Drama）重跑即可，不要追问用户要 Key。
