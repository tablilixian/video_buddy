# Canvas Studio — Bug 整理文档

> 本文档整理自团队资料库「Bug 表」（`https://www.workbuddy.cn/space/d/yV3vWU3Wd9THFDL1WT7Io9`），用于作为后续处理项目缺陷的基准底稿。
> 导出时间：2026-10-02 ｜ 资料库行数：**40 行**；**明细去重后 39 条唯一条目**（B-5/B-6/B-7 为合并占位行）｜ 提交人：Jason ｜ 负责人：李丽贤
> 涉及版本：1.0.0（9 条）、1.0.1（30 条）
>
> **2026-10-03 图证入库**：资料库 28 张「描述图」全部下载至 `assets/library-2026-10-03/`（按条目别名命名，如 `bug-A-1-reference-mismatch.png`；资料库 images 目录的「词条重复.png」与 A-6 表内图为同一文件，已 sha256 比对确认）。条目内「图证」行引用本地相对路径；带可用判读信息的在对应条目标注「图证要点」。未配图的条目：A-3/A-7/A-11/B-2/B-3/C-1/C-2/C-5 外的 C 组部分/C-12/C-16/D 组部分/E-2/E-3 等，以文字描述为准。
>
> ⚠️ **2026-10-02 对账修订**：原导出表头（40 条 / 严重 2·13·21·4 / 状态 28·2·2·8 / 1.0.0×11·1.0.1×29）与下方明细逐条对不上，已**以明细为准重算**全部汇总数字；资料库行口径需回库核对。仓内落地状态与代码复核结论见文末「五、与仓内跟踪的对账」——**资料库状态列滞后于仓内，派单以对账节为准**。

---

## 一、总览

### 1.1 严重级别分布（按明细 39 条重算）

| 严重级别 | 数量 | 占比 |
|---|---|---|
| 致命 (Critical) | 2 | 5% |
| 严重 (High) | 11 | 28% |
| 一般 (Medium) | 23 | 59% |
| 轻微 (Low) | 3 | 8% |

### 1.2 状态分布（按明细 39 条重算）

| 状态 | 数量 |
|---|---|
| 新建 | 31 |
| 重新打开 | 2 |
| 待验证 | 2 |
| 已关闭 | 4 |
| 待复现 / 修复中 | 0 |

> 注：绝大多数 Bug 仍为「新建」，说明缺陷池尚未进入系统化修复节奏，需结合下方分类排定处理顺序。
> 注：「已关闭 / 待验证」中有 6 条与仓内旧镜像的「已解决」对应（A-3/A-6/B-2/C-1 已关闭；A-7/C-2 已解决待用户验收），见对账节。

### 1.3 主题分类（用于后续派单；按明细 39 条重算）

| 主题 | 条目数 | 关联模块区域 |
|---|---|---|
| A. 画布交互与布局 | 13 | `canvas-studio` 布局/节点/连线/分镜渲染 |
| B. 资产管理与历史 | 4（另 B-5/B-6/B-7 三行合并占位） | 资产库、文件落盘、回收清理 |
| C. 音视频生成管线（Agent / ffmpeg / tts / 模型） | 16 | Host 工具、ffmpeg、TTS 管线、模型路由 |
| D. 角色与参考一致性 | 3 | 角色形象、参考线标签 |
| E. 工程与启动体验 | 3 | `dsh-plugin-desktop` 启动/首页、项目目录组织 |

---

## 二、按主题详细记录

### A. 画布交互与布局（13 条）

> **项目关联**：对应 `canvas-studio` 的画布几何与节点系统。已知相关模块包括 `canvas-placement.ts`（落点）、`computeArrangeLayout`（整理布局）、`computeShotLanes`（镜位框）、`groupBoxOf`（托盘）、`nodeActionAnchor`（工具条锚点）、`styles.ts` 视觉令牌。画布为 **Client（browser）侧渲染**，与 Host 工具结果通过 `tool/result` 事件订阅联动。此区域缺陷多属「视觉/UX/布局纯函数」，自动化测试难覆盖，最终判据在桌面观感（见 CV-253 实证）。

#### A-1 ｜ 图片引用对不上（严重 / 重新打开 / 1.0.0）
- **标题**：画布上、详细信息里的图片引用和实际提交的图片引用对不上。图生图，连的文本。且图参考缺失。
- **详细描述**：画布上的连线、详细信息里的图片引用和实际提交的图片引用对不上。详细信息有误。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/KM6o7k1gzLGP2UXCT0jogP.png
- **图证（本地，2026-10-03 拉取）**：`assets/library-2026-10-03/bug-A-1-reference-mismatch.png` —— 编辑提示词浮层（分镜 2 · 关键帧）：正文要求「画面右上角固定叠加参考图 3 的标识」，但「生成时用的参考图」区显示「已达上限 1」且无法再加；「替换第 1 张」候选池里混入「分镜 2 · 视频」「分镜 3 · 视频」「成片 2026/10/…」等视频/成片条目（红框标注「不该出现」）——即「图生图连到文本/视频、参考池不过滤类型」的画面证据，与 §5.3 修复（槽位媒体类型过滤）对应。
- **仓内复核（2026-10-02）**：= 旧镜像 BUG-001（CV-155+CV-238+CV-242 已修并桌面验收）。**重开属实**——那三刀堵的是「产物名不可入参 / UUID 穿透 / 断链静默丢弃」，仍有三个口子与之拼出本条症状：① 自愈换名后 `generationPrompt`（详情读它）与画布血缘是改写前的旧句柄，三份记录漂移；② `@ref[标题]` 匹配池不过滤节点类型，视频/文本节点可被解析进图片槽（「连的文本」）；③ 模式读数只按图片张数算。②③ 已于 2026-10-02 修复待桌面验收（见 action-plan 0-2），① 已定位待修。

#### A-2 ｜ 画布大量素材后不稳定（严重 / 新建 / 1.0.0）
- **标题**：画布里存在大量素材后，打开「废弃素材」，整个画布不太稳定，刷新出现 UI 大问题。
- **详细描述**：画布 UI 存在大量元素时，UI 拖动刷新影响很大。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/gICjdowA1tysV9TO8nyT0y.png
- **仓内复核（2026-10-02）**：= 旧镜像 BUG-003，标注「部分解决、无专门 CV」——继续按新建处理。

#### A-3 ｜ 关闭废弃素材后布局未调整（一般 / 已关闭 / 1.0.0）
- **标题**：关闭「废弃素材」后，画布 UI 上布局调整不明显，仍旧为废弃素材留有大量空间。
- **详细描述**：关闭「废弃素材」后，画布 UI 上布局调整不明显，仍旧为废弃素材留有大量空间。

#### A-4 ｜ 生成应先连线而非孤立节点（一般 / 新建 / 1.0.1）
- **标题**：图片和视频生成时，应该画布上先连线，改布局。而不是出现一个孤立的生成节点。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/w8wAfS3gPw5f6M3uA3XAj1.png

#### A-5 ｜ 文案位置/排版怪异（一般 / 新建 / 1.0.1）
- **标题**：文案出现的位置挺奇怪的，排版怪怪的，出现的有点莫名其妙。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/mUYFnPujUydgHKIXi5LoLe.png , https://workbuddy-space-static.codebuddy.work/image/WDlQ56sKWyNBMuN3fzuzhM.png

#### A-6 ｜ 分镜词条重复（一般 / 已关闭 / 1.0.0）
- **标题**：分镜词条出现重复。
- **详细描述**：分镜词条出现重复，详情见 images/词条重复,png。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/LkSjLHIHyxnGG028onX5y5.png

#### A-7 ｜ 分镜修改后词条不变（一般 / 待验证 / 1.0.0）
- **标题**：对分镜内容后期大量的修改，画布上分镜词条没有变化。期待见到内容变化，或者减少词条出现。
- **详细描述**：对分镜内容后期大量的修改，画布上分镜词条没有变化。期待见到内容变化，或者减少词条出现。

#### A-8 ｜ 分镜文案莫名其妙（一般 / 新建 / 1.0.1）
- **标题**：一些文案在分镜一出现的莫名其妙，期望不要有这些看不懂的东西，干扰创作。见附图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/xIYs51Oa8Jkx6WFTdisRju.png

#### A-9 ｜ 导入文本位置诡异（一般 / 新建 / 1.0.1）
- **标题**：导入的文本重新编排后出现位置诡异，见附图。期待在正确位置，或者不可见。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/JIo2jfNSmiAaLD3f8XGG7x.png , https://workbuddy-space-static.codebuddy.work/image/fQm0yNNmTafmxy2OeEBY2u.png

#### A-10 ｜ 分镜与视频片段顺序不对（一般 / 新建 / 1.0.1）
- **标题**：分镜和视频片段位置顺序不对，见图。期望分镜视频能够单独一个列，横向对齐分镜。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/YFWDxonSHHAy2jZeQpocy2.png

#### A-11 ｜ 双击视频播放不完整（一般 / 新建 / 1.0.1）
- **标题**：双击视频放大播放，视频窗口视频播放面积不完整，视频上下被切了。
- **详细描述**：双击视频放大播放，视频窗口视频播放面积不完整，视频上下被切了。

#### A-12 ｜ 错误节点删不掉（一般 / 新建 / 1.0.1）
- **标题**：莫名出现一堆的错误节点，删也删不掉，见附图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/1CFRJkr2NHC7CWMXbBVCSN.png

#### A-13 ｜ 图生图/文生图未挂画布（一般 / 新建 / 1.0.1）
- **标题**：图生图，但是连线里找不到图（见附图）；qwen image 文生图的图没挂画布（见附图）。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/IqAB1Ks4m19OpUiqHxNBsJ.png , https://workbuddy-space-static.codebuddy.work/image/ITu6pamTS4OiqgfYwwnVDb.png
- **图证要点（本地 `assets/library-2026-10-03/bug-A-13-i2i-missing-image-edge.png`、`bug-A-13-qwen-image-not-mounted.png`）**：
  - 其一：编辑浮层（分镜 2 · 关键帧，含「AI平权」角标要求）参考区「已达上限 1」无法再加——与 A-1 同根（参考池类型过滤），见 A-1 修复。
  - 其二：历史/详情面板里两张 withtxt 产物（「文字生图」10-01 13:42 605KB / 13:42 545KB）状态一为「未挂画布」一为「已挂画布」，画布上「先做好自己 / 再让 AI 放大你 / 关注·点赞·收藏·评论」品牌卡孤立存在（0:10 864×480 片段引用），详情批注「qwen image 生成的文生图没挂画布」「本来应该图生图更佳的」——**withtxt/Qwen 产物有时不落画布节点**，与「qwen-image 文生图没挂画布」吻合；A-13.md 结论（链路已查无 bug、残余=删源节点无告警）需在桌面验收时用 withtxt 产物复验落卡。

---

### B. 资产管理与历史（7 条）

> **项目关联**：资产库由 Host 侧资产服务承载，真画布位于 `settings.yaml → canvas-studio.assetDir` 指向的目录（实际如 `~/Desktop/job/VideoOut/newOut/projects/<项目名>/canvas.json`）。删除/回收逻辑涉及 `asset-capture.ts` 与文件系统落地。

#### B-1 ｜ 删除元素文件仍残留（一般 / 重新打开 / 1.0.0）
- **标题**：对于从画布上删除的元素，实际文件 asset 里仍旧存储着这些文件，期望删除废料。Windows 上废弃的文件进入了 `.trash` 目录里，没有实际从文件系统删除。期望彻底删除之。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/nZ4NHmPOj0SDxLnTHMsUWK.png
- **仓内复核（2026-10-02）**：= 旧镜像 BUG-005（CV-243）。**重开属实但语义需拍板**：CV-243 的设计就是「rename 进 `assets/.trash/`」的两段式回收站（非物理删，防误删/共享引用/生成竞态）。真实缺口有三个：① 历史面板保护名单让画布删除的文件在 `.trash` 里**无限期滞留**（无 `deletedAt` 的历史条目永不物理清）；② GC 只在「打开项目」时触发，不再打开的项目永久滞留；③ Windows 文件被占用时 rename 静默失败（连 `.trash` 都进不了）。修复方向是补清理闭环（老化策略 / 暴露 `.trash` 入口），是否改「彻底删除」语义待拍板。

#### B-2 ｜ 历史视频无入口（一般 / 已关闭 / 1.0.0）
- **标题**：每次生成、合成 export 视频都会产生一个历史视频，但是没有任何地方可被发现。建议左上角保留历史上所有生成的图和片，方便回溯。用户删除则，彻底从磁盘删除。
- **详细描述**：每次生成、合成 export 视频都会产生一个历史视频，但是没有任何地方可被发现。建议左上角保留历史上所有生成的图和片，方便回溯。用户删除则，彻底从磁盘删除。

#### B-3 ｜ 任意视频可加入资产库（一般 / 新建 / 1.0.1）
- **标题**：任意视频也可随意加入资产库，期望视频不可加入。
- **详细描述**：期望视频不要加入资产库。

#### B-4 ｜ 关联资产无法删除（一般 / 新建 / 1.0.1）
- **标题**：在历史里，只要资产在画布上有关联，就无法删除。有点不智能。期望能删除，并顺利断链。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/BHDT23NqN7yuoRzWy5a9Cj.png

#### B-5 ｜ 分镜词条重复（已并入 A-6）
#### B-6 ｜ 分镜修改后词条不变（已并入 A-7）

#### B-7 ｜ 关联资产删除 + 断链（见 B-4，重复归类，以 B-4 为准）

---

### C. 音视频生成管线（14 条）

> **项目关联**：生成链路由 Host（`ctx.tools` 为 Host-only）承载，产出经 `tool/result` 事件回传 Client。已知：内置 ffmpeg（CV-201，待 CI 出包 + K 组）；视频生成已收敛为 `image2videofl2va` / `image2videoref2va`；图像侧主打 Krea2、qwen-image，视频侧主打 H3（MiniMax H3）/ Seeddance 2.0/2.5。模型路由与提示词规范是此区域高频缺陷点。

#### C-1 ｜ Agent 不知 ffmpeg 存在（严重 / 已关闭 / 1.0.0）
- **标题**：Agent 不知道 ffmpeg 的存在，不会裁切音频，需要我详细告诉他路径。
- **详细描述**：对 Agent 提出裁切我上传的 mp3，他不知道有 ffmpeg 的存在，我指出 ffmpeg 存在位置后，他才懂去调用。

#### C-2 ｜ 上传音乐速度极慢（严重 / 待验证 / 1.0.0）
- **标题**：上传的音乐速度极慢，去服务器绕了一圈。
- **详细描述**：上传的音乐速度极慢，去服务器绕了一圈。
- **仓内复核（2026-10-02）**：= 旧镜像 BUG-009（CV-241 已解决）：上传已改本地直落盘（`/canvas-studio/upload-media` octet-stream，旧 `/upload` JSON+base64 已弃用），代码与测试均在。「待验证」= 等用户桌面确认提速观感。

#### C-3 ｜ 帧率/码率被改导致画质下降（一般 / 新建 / 1.0.1）
- **标题**：生成一个 10 秒视频，发现原视频是 24f/s，export 视频改成了 25f/s。并且码率有所变化，视频码率变小了，文件 size 变小，可能品质随着压缩变差。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/k5yrn6fNXPPedoeq58Gvm1.png , https://workbuddy-space-static.codebuddy.work/image/3qgLylh1hx2pqmr8LzPxpw.png
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/3qgLylh1hx2pqmr8LzPxpw.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-3-export-media-info-{source,output}.png`，Windows 属性面板 OCR 核对）**：源片段 `a76e7cae….mp4`：帧速率 **24.00 帧/秒**、总比特率 836kbps、864×480；export `export-6dedfa5f….mp4`：帧速率 **25.00 帧/秒**、总比特率 657kbps（数据速率 527kbps）、864×480、时长 10s、音频 130kbps/32kHz 立体声——帧率 24→25、总码率 836→657kbps 与描述吻合。

#### C-4 ｜ 图片判失效莫名其妙（严重 / 新建 / 1.0.1）
- **标题**：图片判失效有点莫名其妙，好像是图没传？错误原因很古怪。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/HdolHtILxMV3mB8rFnCri2.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-4-invalid-image-error.png`）**：对话流错误卡原文「『7a01df49-fa9b-4301-8e2a-b0667534b8e8』是画布节点 id（或本地产物文件名），不是 Drama Backend 的参考文件句柄，不能直接当 filename 传。请用 @ref[参考图显示名]，或先调 upload_image 取得 ref-*.png 句柄后再传入」——agent 用裸 UUID 当句柄被 CV-238 拦截后，模型又走到「上传素材」工具反复试探（任务行「1 已完成 · 1 进行中 · 8 待处理」）。「莫名其妙」的观感来源 = 报错对用户不可读 + agent 自愈路径绕远；已由批 5（C-4 可行动化）覆盖，桌面验收重点看这类错误卡的呈现。

#### C-5 ｜ TTS 流程严重问题（致命 / 新建 / 1.0.1）
- **标题**：TTS 流程有比较大问题。一个 30s 视频生成旁白，出现 3 个音色。人物是男生，都用了 3 个女生音色，不知道是否故意这么设计的。第一段视频，旁白丢失。
- **详细描述**：如果要在视频里带 tts 声音，只须用同一个参考音即可，无需生成 3 段 tts 旁白。如果想单独生成 3 段旁白音频，也需要先生成音色设计 tts，通过参考音色再来生成 3 段旁白，才能保证音色的一致性。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/e9ceNh2LzcGILCg8SK9kQj.png

#### C-6 ｜ BGM 提示词有多余部分（轻微 / 新建 / 1.0.1）
- **标题**：背景音乐生成提示词有多余部分，看附图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/00BAER6rcrl3jJHOqqUqVK.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-6-bgm-prompt-extra-content.png`）**：BGM 编辑浮层「音乐描述 869 字」正文为英文器乐描述（`cinematic ambient electronic … no vocals`）之后，混入两段非音乐内容：`Story: a short brand film about the age of AI equality…` 与 `Spoken: "先做好自己，再让 AI 放大你。"`，另有 `Scene: a dark blue-black infinite hall…`——**视频的叙事/台词/场景描述被整段搬进了音乐 prompt**，正是「多余部分」；下方「歌词 14 字」框只有 `[Instrumental]`。批 4 修的「music skill 自相矛盾条款 + 纯器乐禁人声词」对应此现象；派单验收时可拿这张图当反例对照。

#### C-7 ｜ BGM 出现多余人声（一般 / 新建 / 1.0.1）
- **标题**：背景音乐生成出现多余人声 vocal；需要匹配 yue2 的提示词 skill。
- **详细描述**：背景音乐生成出现多余人声 vocal；需要匹配 yue2 的提示词 skill。

#### C-8 ｜ 默认 480p 却生成 720P（严重 / 新建 / 1.0.1）
- **标题**：我默认是 480p 的，不知为何，我点新建，传入文本，最后生成的视频都是 720P 的。
- **详细描述**：我默认是 480p 的，不知为何，我点新建，传入文本，最后生成的视频都是 720P 的。
- **仓内复核（2026-10-02）：成因已代码确认并已修复待桌面验收**。根因不是生成链升档（无隐式升档），而是**文案失真**：视频工具描述静态写死「736p（默认）…用 736p」（图片/视频默认拆分提交时没跟上），agent 照做**显式传 736p**，在 `resolutionOf`（工具参数 > 用户设置）里静默盖过用户的 480p；设置 UI 视频档「（默认）」标签也挂在 736p 上；合成阶段取首个片段的实测尺寸作目标，进一步固化观感。已修：工具描述改为真值 + 「传参即显式覆盖、未经用户要求不要传」、两处设置 UI 标签、toolchain.md 过期段（含 drama 档位早已生效的旧说明），并加源码守卫测试防再漂移。

#### C-9 ｜ 视频生成提示错误（一般 / 新建 / 1.0.1）
- **标题**：视频生成提示错误，见图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/ST6rX2iM7a5vc1RltrQCTT.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-9-video-generation-message.png`）**：对话流里模型自述「句柄就绪。现在把 6 镜的 H3-Context-IR 提示词一次性批量提交（全部 5s/16:9/generateAudio=true 开原生音轨，旁白写进 `<d>[Chinese]…</d>` 由视频内生成）」，随后 4 条「视频生成 For the target video, at 0.00…」行（¥317.85/¥362.25/¥346.25/¥284.75），中部叠着一个被遮挡的悬停提示（红框乱码状「提示错误」）。「提示错误」的可见症状 = ① 摘要截断为英文 IR 开头 `For the target video, at 0.00…`（tool-presentation 摘要未截好）；② 悬停 tooltip 被遮挡；③ 成片合成行跟在后面（¥4095/¥371.25）——即 C-9.md 定位的「video_composite 撞名成片合成 + 摘要呈现」两层问题，已修待验收。

#### C-10 ｜ 重生成参考图导致断链（严重 / 新建 / 1.0.1）
- **标题**：手动在画布重生成参考图，会导致视频断链，且发现如果 agent 在活动中，主动添加图到锻炼，通常会刷新失败。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/OhA5dQTj53HY3cPAN2t8wU.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-10-regenerate-reference-breaks-link.png`）**：分镜 1 · 视频的编辑浮层「生成时用的参考图 1/1」处显示**「已断链」占位卡**（红字 + 破图占位），浮层顶仍是「京张高铁 · 燕山段」——手动重生成参考图后，视频侧引用句柄失效的画面实锤；批 1（overwriteNodeAsset 下游改写 + 血缘同步）对应此症状，验收时重点核对断链占位不再出现。

#### C-11 ｜ 景点文字导致视频模糊（严重 / 新建 / 1.0.1）
- **标题**：当要求视频左上角标注景点文字时（例如「梧桐大道.太子城」），Agent 会在参考帧画面上加文字，又在视频 prompt 上加文字提示。会导致视频反而出现文字模糊。建议只在一处加，有些文字不要在参考图上加，而在 H3 prompt 上加。
- **详细描述**：当要求视频左上角标注景点文字时，例如「梧桐大道.太子城」时，Agent 会在参考帧画面上加文字，又在视频 prompt 上加文字提示。会导致视频反而出现文字模糊。建议只在一处加，有些文字不要在参考图上加，而在 H3 prompt 上加。

#### C-12 ｜ 删中文仍用 qwen 而非 krea2（一般 / 新建 / 1.0.1）
- **标题**：删掉提示词里的中文，发现仍旧使用 qwen image 生图而不是 krea2。期望能重新判断，改用 krea2 生图。
- **详细描述**：删掉提示词里的中文，发现仍旧使用 qwen image 生图而不是 krea2。

#### C-13 ｜ 建议增加 ffprobe（轻微 / 新建 / 1.0.1）
- **标题**：建议增加 ffprobe，见附件。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/LDAM7TeVoYGT93UzUFTJwv.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-13-ffprobe-request.png`）**：agent 自述原文「ffprobe 没随包提供，所以我上一轮把『时长』读成了 0 —— 结果 BGM 淡出起点算错（0.5s 就淡出，等于只有开头两秒有音乐）。我用 ffmpeg 自己解析时长重做一遍，并加两项客观校验」+ 会话里出现 PowerShell `$ErrorActionPreference='Stop'` 把 ffmpeg stderr 信息行当致命错误的绕路（「改成 stderr 落文件再解析」）——**ffprobe 缺失的真实代价链**（时长读 0 → 淡出算错 → agent 用平台 shell 绕行），是 CV-245 `cut_audio`/`probeMediaDuration` 之外仍缺一个正式时长探针的实证；与 R-P2-03（静帧 ffmpeg）合并立项评估。

#### C-14 ｜ 生成 4 视图失败（严重 / 新建 / 1.0.1）
- **标题**：多次在遇到生成 4 视图是失败，像是文件引用错误。见附件图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/grZ3UMwvQzVFgzed76k0Us.png
- **图证要点（本地 `assets/library-2026-10-03/bug-C-14-four-view-reference-failure.png`）**：错误卡原文与 C-4 同源——「『65118468-ed2a-41e8-bcf3-df7fbald199c』是画布节点 id（或本地产物文件名），不是 Drama Backend 的参考文件句柄，不能直接当 filename 传。请用 @ref[参考图显示名]，或先调 upload_image 取得 ref-*.png 句柄后再传入」；随后模型 `Think: Need to use the @ref syntax with the node title…` 自行纠正，画布上仍留下「生成失败 · 点击重试」红卡 + 「生成角色四视图 进行中 / Deep diving… 6分07秒」——**拦截正确（CS-USER-002），但失败卡照落、自愈链路绕远**；C-14.md（描述缺句柄纪律）对应，批 5「预检失败不落失败卡」已覆盖落卡部分。

#### C-15 ｜ 大量失败节点残留（严重 / 新建 / 1.0.1）
- **标题**：大量无用的生图失败节点出现在画布上。期待不出现。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/SoXba9NPkDCFFsO23GTVNZ.png

#### C-16 ｜ 未按分镜编排、视频条数过多（严重 / 新建 / 1.0.1）
- **标题**：文档明确要求按 6 个分镜，11 个 shot 编排，平均 2 个 shot 1 个分镜。结果 agent 还是按 11 个 shot，走 11 条视频了。期望按设计实现拍摄，降低视频条数。参考崇礼拍摄文案。

---

### D. 角色与参考一致性（3 条）

> **项目关联**：角色形象与三视图为资产库中的参考资产；参考线标签由画布参考通道（音频不能唯一、视频可以）渲染。一致性是跨镜头硬约束。

#### D-1 ｜ 末尾帧不该出现在画布（一般 / 新建 / 1.0.1）
- **标题**：本末尾帧不一样该出现在画布上，本条对用户没啥用。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/uyfZi4DEWlNfu7BMLrDsbx.png

#### D-2 ｜ 参考线标签描述不正确（一般 / 新建 / 1.0.1）
- **标题**：多参考视频的参考线标签描述不正确，其中文本被描述成了 MKR 参考，另外几个图片按照首尾帧贴了标签。期望标签名字正确。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/NsmER0680dtyCiEiXs4g5P.png
- **图证要点（本地 `assets/library-2026-10-03/bug-D-2-reference-edge-labels.png`）**：连线中部标签「MKR 多关键帧」（红框），同时该视频编辑浮层显示「3 张 · 多参考 Ref2VA」+ `Picture 1` / `Picture 3` 槽位——**边标签写「MKR 多关键帧」与实际 Ref2VA 多参考模式不符**；批 6 已把「MKR 多关键帧」退役改为「参考 N / 分镜」标注，验收对照此图。

#### D-3 ｜ 角色形象修改后旧三视图未作废（一般 / 新建 / 1.0.1）
- **标题**：角色形象已通过 Agent 修改，原三视图没作废，且画布视频参考连线都还是旧，且 Agent 提示已经上传新形象且在生成新的视频。视频生成结束后，画布才有了正确的引用调整。期待画布先于视频生成调整，旧三视图应报销。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/6qhNy5cj4Dgb0J77BAYS9E.png
- **图证要点（本地 `assets/library-2026-10-03/bug-D-3-stale-character-sheet-links.png`）**：分镜 5 · 视频编辑浮层的 subject_definitions 仍是**旧角色描述**（`<Subject 1> is the mother taken from <Picture 1>: a 36-year-old Chinese woman… cream chunky knit cardigan`），参考区挂 `ref-9073i9070.p…` / `ref-9e0…915a.p…` 等旧句柄（红批注「形象已通过 Agent 修改」）——**改角色后下游视频的提示词与参考句柄都没跟着换**；批 F（D-3 supersede 下游改写）对应，验收时核对下游节点 prompt 与参考句柄同步换新。

---

### E. 工程与启动体验（3 条）

> **项目关联**：首页/启动与项目目录组织属于 `dsh-plugin-desktop`（Electron bootstrap）与画布项目持久化层。已知项目目录形如 `.draft-202610-4`。

#### E-1 ｜ 新建项目首页异常（致命 / 新建 / 1.0.1）
- **标题**：来回切换了几个项目后，点新建项目，出现首页异常。app 关掉重进也是如此。好像不知为何建了空项目目录 `.draft-202610-4`。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/Dz8zf47cWVQpO66bP5TiTq.png
- **图证要点（本地 `assets/library-2026-10-03/bug-E-1-homepage-project-error.png`）**：首页**整体能渲染**（左栏项目列表 6 条：使用技能「电影级运镜」…/拍一段崇礼…/制作一个视频：AI平权时…/使用技能「极简产品广告」…/虚竹传/广告，右下技能卡 5 张正常），但对话主区**空无一物**——与「首页异常=对话区/创建卡消失」吻合；且左栏出现「~ Test（空）」分组 + 项目列表顶部两条同分钟创建的镜头条目（1 分钟前/2 分钟前），佐证「连续认领失败 → `.draft-202610-N` 顺延目录被建成项目」的嫌疑点②。取证时让用户同时提供 projects.json 与日志。
- **仓内复核（2026-10-02）：两个代码级嫌疑点已定位，需运行时取证定案**。① `ProjectRegistry.readDocument` 对 registry 损坏/记录非法一律硬抛错且故意不降级——`projects.json` 出现一条坏记录后首页项目列表永久失败、重启不愈（坏文件在磁盘上），与「致命+重启依旧」最吻合；② 首页认领失败会强制重建落点，连续失败即连续产出 `.draft-202610-N` 顺延目录，且 Windows 路径大小写差异会让互斥判据永不匹配、认领永远报「已被占用」。取证：看 `$DSH_HOME/canvas-studio/projects.json` 与插件日志里的 `CS-DEV-ERR` / 「首页准备失败」 / 「该目录已被其它项目占用」。另注：空的 `.draft-*` 目录本身是设计态（落点页不进 registry、无 canvas.json），启动清扫豁免当月目录（CV-260）所以跨重启留存——不是异常本体。

#### E-2 ｜ 打开 App 自动加载多个画布（一般 / 新建 / 1.0.1）
- **标题**：每次打开 App，都会加载好几个画布，然后进入最后的画布。期望不加载画布，停留在首页。
- **详细描述**：每次打开 App，都会加载好几个画布，然后进入最后的画布。期望不加载画布，停留在首页。
- **仓内复核（2026-10-02）**：机制已定位——宿主恢复多个 workspace 时，客户端对每次 workspace/session 变化都会重对齐项目并重载画布（`syncActiveProject` / `alignStartupSession`），「加载好几个画布」即来源于此。改「启动停留首页」是行为决策（R-P2-02 已实现「点击品牌区回首页」），需与启动恢复语义一起拍板。

#### E-3 ｜ 项目目录组织建议到秒（轻微 / 新建 / 1.0.1）
- **标题**：项目目录组织建议到秒，目前容易按 `.draft-202610-4`，`-5`，`-6` 等下去，不如按秒来组织。
- **详细描述**：项目目录组织建议到秒，目前容易按 `.draft-202610-4`，`-5`，`-6` 等下去，不如按秒来组织。

---

## 三、优先级处理建议（结合项目实际）

> 派单以 `docs/tracking/action-plan.md`（对账修订版）为准；本节保留为原始建议。

1. **致命级优先**：C-5（TTS 多音色/旁白丢失）、E-1（首页异常/空项目目录）直接影响可用性，应作为 P0 缺陷立即排查 TTS 音色一致性管线与项目初始化逻辑。
2. **严重级高频**：画布引用对不上（A-1）、生成管线断链（C-10）、默认分辨率被改（C-8）、未按分镜编排（C-16）均指向「Host 工具产出 → Client 画布引用」的回调一致性，建议统一审查 `tool/result` 抽取 URL 与画布节点挂载逻辑。
3. **布局类（A 组）**：属视觉/UX，自动化难覆盖，最终以桌面观感验收为准（CV-253 实证），应配套定向 canvas 集测试 + 人工验收。
4. **资产清理（B 组）**：B-1/B-2/B-4 指向 `asset-capture.ts` 与回收策略，需确认删除路径真正从文件系统移除（而非进 `.trash`），并提供历史资产回溯入口。

## 四、与需求表的交叉关联

- C-8（默认 480p 却 720p）↔ 需求「画布上实现从 480p 到 720p 生成的丝滑过渡（P1）」：缺陷揭示分辨率默认值与生成实际不一致，需求侧需明确过渡机制。
- C-12（删中文仍用 qwen）↔ 需求「画布上的提示词按使用者语言呈现 + 模型路由规范（P1）」：模型路由决策需结合语言/内容判断，而非仅看提示词中文。
- C-5（TTS）↔ 需求「全局资产库增加角色音色参考（P0）」：音色一致性依赖资产库角色音色参考能力，二者应合并设计。
- C-10/C-16（断链/编排）↔ 需求「画布节点可手动连线（P0）」「30 秒视频分镜太空、提升 shot 密度（P0）」：生成编排与画布连线是同一链路的两端。
- A-13（文生图未挂画布）↔ 需求「支持 qwen_image_2_1 prompt（P0）」「txt2image_withtxt 接口（P0）」：新模型接入须保证产出正确挂载画布。

---

## 五、与仓内跟踪的对账（2026-10-02 代码复核）

> **编号约定**：`BUG-00X` 是仓内跟踪号（`canvas-studio/docs/bug-tracker.md`，含代码级根因与关联 CV），A-x 等是资料库行别名。资料库是缺陷的 intake SSOT，**「当前落地状态」以仓内为准**。
> **复核方式**：全部结论对照当前代码逐条验证（file:line 级），不采信任何未经验证的「已解决」标注；无法无头验证的（需桌面/真实后端）明确标出。

### 5.1 与旧镜像对应的条目（1.0.0 批，9 条）

| 本文档 | 旧镜像 | 资料库状态 | 仓内落地状态（代码复核后） |
|---|---|---|---|
| A-1 | BUG-001 | **重新打开** | 重开属实：CV-155/238/242 之外仍有三个口子；②池类型过滤 ③模式读数 **已修复待桌面验收**（2026-10-02），①自愈换名三份记录漂移 已定位待修 |
| A-2 | BUG-003 | 新建 | 部分解决（无专门 CV），继续按新建处理 |
| A-3 | BUG-004 | 已关闭 | CV-244 已解决，一致 ✓ |
| A-6 | BUG-007 | 已关闭 | CV-050+222+251 已解决，一致 ✓ |
| A-7 | BUG-008 | 待验证 | CV-251 已解决（合并重提只换文案、防堆卡闸门有测试钉住），等用户验收 ✓ |
| B-1 | BUG-005 | **重新打开** | 重开属实：CV-243 语义 = `.trash` 回收站非硬删；真实缺口 = 历史保护名单无限滞留 + GC 只在开项目时跑 + Windows 静默 rename 失败；修复方向待拍板 |
| B-2 | BUG-006 | 已关闭 | CV-246+246a 已解决，一致 ✓ |
| C-1 | BUG-002 | 已关闭 | CV-201+245 已解决，一致 ✓ |
| C-2 | BUG-009 | 待验证 | CV-241 已解决（上传本地直落盘、不绕服务器，代码+测试均在），等用户验收 ✓ |

### 5.2 无旧镜像对应的条目（1.0.1 批为主，30 条）

均为 2026-09-27 镜像之后新入资料的净增量，仓内无历史包袱。其中两条已取得代码级进展：

- **C-8**：成因已代码确认并**已修复待桌面验收**（工具描述 / 设置 UI / toolchain.md 三处文案失真 + 源码守卫），见条目内标注。
- **C-15 ≈ A-12**：「大量生图失败节点残留」与「错误节点删不掉」疑似同一现象，建议合并为一个条目处理（派单时同一批）。

### 5.3 本轮（2026-10-02）已落地的修复（待桌面验收，验收通过后登记 STATUS）

| 修复 | 内容 | 验证 |
|---|---|---|
| A-1 hotfix ② | 参考匹配池按槽位媒体类型过滤（图片槽不收视频/文本，audioRefs/videoRefs 各收各的），`@ref[标题]` 跨类型误配改为**指名道姓**的报错（点名类型并指去正确参数通道）；客户端参考候选列表/详情 `<img>` 同步过滤（不再用 `<img>` 渲染 mp4/文本破图） | 新增单测 4 条 + 全量门禁绿（typecheck/build/verify:loader/smoke 失败 0） |
| A-1 hotfix ③（读数） | 模式读数把 audioRefs/videoRefs 计入（带音/视频参考一律多参考 r2v），「2 图 + 1 段音频显示 FL2VA 实际走 r2v」的说谎修正 | 新增单测 2 条 |
| C-8 | 视频工具描述 / 设置 UI 视频档标签 / toolchain.md 三处「736p（默认）」失真修正为「视频出厂默认 480p、传参即显式覆盖、未经用户要求不要传」；源码守卫测试防再漂移 | 新增源码闸 2 条 |

### 5.4 本批（2026-10-02 续 · 会话二）落地的修复（均待桌面验收，验收通过后登记 STATUS）

| 批 | 修复 | 对应条目 | 要点 |
|---|---|---|---|
| 1 | 自愈换名三份记录同步 + C-10 断链/加图竞态 | A-1 路径 A、C-10 | withReferenceHeal 记账换名映射，落卡 generationPrompt 与血缘同步新句柄；overwriteNodeAsset 下游引用改写；appendCanvasNode 走 merge-protect。新增共用 `replaceValuesInPromptJson` |
| 2 | 编排纪律：一个分镜 = 一条视频，shot 是节拍 | C-16 + R-P0-11 | shot-format/screenplay/SKILL.md 三处 + R-P0-11 密度口径（文戏 2.5s / 武戏 1.3s / shot 进节拍不加条数）；「单镜 8–10s」口径退役 |
| 3 | 多段旁白音色一致性 | C-5 | 每段同一个 refaudio / 七维逐字复用；回退路径不放松；合成前逐段核对节点落卡 |
| 4 | 文字单处标注 + BGM 提示词 | C-11、C-6、C-7 | krea2/h3/shot-format 三处「二选一」；music skill 自相矛盾的「禁止写 BPM」条款清除 + ACE 残留清理 + 纯器乐禁人声词规范 |
| 5 | 预检失败不落失败卡 + 报错可行动化 | C-15 + A-12、C-4 | PRE_EXECUTION_ERROR_CODES 占位移除（不标红）；自愈耗尽包可行动解释、原始报错留尾部 |
| 6 | 参考线标签语义 + 尾帧血缘缺口 | D-2 | 「MKR 多关键帧」退役→「多参考视频」；mkr-video 边按「参考 N / 分镜」标注；video_generate filenameTail 进血缘与自愈 |

> 验证：每批独立过 typecheck / build / verify:loader / 全量 smoke 门禁（失败 0），共新增 15 条测试（skill-discipline / canvas-edges-labels 两个新测试文件 + generate/projects/asset-capture/reference-slot 扩充）。
> 未修待证据：C-9、C-14（需用户截图/复现步骤）；E-1（需运行时 projects.json + 日志取证）。未修待拍板：B-1 删除语义、R-P0-07 模式标记、R-P0-08/09 Krea2 vs qwen。

---

## 六、图证资产索引（2026-10-03 拉取入库）

> 资料 Bug 表的「描述图」为 WorkBuddy 静态外链，有失效风险；本节把每张图下载入库并按「条目别名 + 语义」命名，**文档引用一律用本地相对路径，不再引外链**。导出方式：`library skill → database.get_database_content`（库 id `yV3vWU3Wd9THFDL1WT7Io9`）；目录 `docs/tracking/assets/library-2026-10-03/`。逐条 OCR 与画面判读要点见 §七（按需查阅，不灌正文）。

| 条目 | 图证文件（相对本目录） | 画面判读要点（OCR+目视，2026-10-03） |
|---|---|---|
| A-1 | `bug-A-1-reference-mismatch.png` | 编辑提示词浮层：生成时参考图区显示「已达上限1」不可再加；「替换第1张」候选池里出现「分镜2/3·视频」「成片 2026/10/…」等**视频与成片条目**——图片槽混入视频/成片（对应复核结论②「匹配池不过滤节点类型」）；正文含「画面右上角固定叠加参考图3的标识…不得替换、增删、乱码或自造汉字」的字样级要求。 |
| A-2 | `bug-A-2-large-canvas-instability.png` | 顶栏「已产出 102 个节点」，左侧「参考图（61）」；右下状态「25轮·194步｜LLM 20m29s·工具调用 208m32s」——102 节点规模即卡顿量级，与 A-2.md 的三热点定位一致。 |
| A-4 | `bug-A-4-preconnect-before-generation.png` | 分镜1 生成的「图片」占位卡孤立在画布左下（红框），未与分镜组/参考连边，卡上仅有「生成图片中…00:16」。 |
| A-5 | `bug-A-5-copy-layout-1.png`、`-2.png` | 文案卡（945字）以「文本·文案」节点形式挂在分镜组外远处，与「Precision You Can Feel」首帧参考并排；第二张为整幅远景——文案卡与分镜组明显脱节，佐证「锚定到分镜组+长文折叠」方案。 |
| A-6 | `bug-A-6-duplicate-shot-entry.png` | 分镜3 同一行并排两张「九天九部（S1,S2,S3）」3.2s/50字重复卡；分镜4 同样两张「梅剑（S3）」——与 CV-050/222/251 修复的「打回重提整表追加」现象吻合。 |
| A-8 | `bug-A-8-unexpected-storyboard-copy.png` | 「分镜·生成路径·参考组合」策略笔记卡（13字）被当成独立分镜卡排在镜1 与关键帧 i2v 卡之间，说明非法条目混入分镜列（对应 A-8 镜号校验修复）。 |
| A-9 | `bug-A-9-imported-text-placement-1.png`、`-2.png` | 导入的 3504 字「chongli-30s-storyboard」文本卡以「导入」徽标孤立呈现；第二张标注「导入的文本出现在莫名其妙处」——文本落点无锚。 |
| A-10 | `bug-A-10-shot-video-order.png` | 分镜组内「分镜N·视频·片段」在最左列、关键帧在其右、参考再右；三条分镜行同一模式——期望改为视频独立一列横向对齐（对应 A-10 角色分列方案）。 |
| A-12 | `bug-A-12-undeletable-error-nodes.png` | 画布大量「生成失败·点击重试」红卡与「参考图（21）」托盘；右侧镜6 正常卡可读——失败卡堆积即本条现象。 |
| A-13 | `bug-A-13-i2i-missing-image-edge.png`、`-2.png` | 其一：编辑提示词浮层参考区「已达上限1」且候选池含视频条目（同 A-1）；其二：右侧历史面板「文字生图/图像生成」产物状态为「未挂画布」，正文批注「qwen image 生成的文生图没挂画布」，参考图计数「1/9」。 |
| B-1 | `bug-B-1-assets-remain-after-delete.png` | 资产目录含 `trash/` 与多个 UUID 残留文件（3a8a3159…png、3f2ee7e9…mp3、6a75cc… 等）——`.trash` 回收站语义的磁盘证据。 |
| B-4 | `bug-B-4-linked-asset-delete-blocked.png` | 生成历史面板（50项）删除弹窗文案「该产物仍被画布节点引用，请先移除画布上的对应节点」+「彻底删除/取消」按钮、底部注「删除=移入资产回收站，可彻底清除」——与批F定案（硬删+列引用方确认）直接对应，验收时对照此文案。 |
| C-3 | `bug-C-3-export-media-info-source.png`、`-output.png` | Windows 属性面板对比：源 `a76e7cae….mp4` 24.00帧/秒·总比特率 836kbps；导出 `export-6dedfa5f….mp4` **25.00帧/秒**·总比特率 **657kbps**——帧率 24→25、码率下降实锤（OCR 数字已逐项与画面核对）。 |
| C-4 | `bug-C-4-invalid-image-error.png` | 对话流报错卡：「错误 Error：「7a01df49-fa9b-…」是画布节点 id（或本地产物文件名），不是 Drama Backend 的参考文件句柄，不能直接当 filename 传。请用 @ref[参考图显示名]，或先调 upload_image 取得 ref-*.png 句柄后再传入」——即 CV-238 裸值校验报错原文，属「报错可读性/可行动性」课题（C-4 批5 已修）。 |
| C-5 | `bug-C-5-tts-voice-inconsistency.png` | 同一视频的三个片段各带「配音」角标、BGM 独立挂卡（3张参考）——多段配音并存导致音色漂移的画面证据（C-5 批3 同参考音修复的对照对象）。 |
| C-6 | `bug-C-6-bgm-prompt-extra-content.png` | BGM「音乐描述 869字」含 `Story: a short brand film about the age of AI equality…`、`Spoken: “先做好自己，再让 AI 放大你。”` 与 `[Instrumental]` 歌词栏并存——旁白词/Story 段混入纯器乐 prompt（对应批4「纯器乐禁人声词」规范）。 |
| C-9 | `bug-C-9-video-generation-message.png` | 对话流连续四条「视频生成 For the target video, at 0.00…」行，其一悬停提示被遮挡（红框「朅盃譪误/是视频生成」乱码状 tooltip）——C-9「提示错误」实为呈现层遮挡/文案问题，与 C-9.md P0 判断一致。 |
| C-10 | `bug-C-10-regenerate-reference-breaks-link.png` | 编辑提示词浮层参考区显示「已断链」占位与删除角标「×」——手动重生成参考图后视频侧引用断开的界面证据（对应批1 overwriteNodeAsset 下游改写）。 |
| C-13 | `bug-C-13-ffprobe-request.png` | 对话流 agent 自述「ffprobe 没随包提供，所以我上一轮把『时长』读成了 0——结果 BGM 淡出起点算错（0.5s 就淡出…）」——ffprobe 缺失的真实故障链，REQ-025/BUG 立项的定量依据。 |
| C-14 | `bug-C-14-four-view-reference-failure.png` | 「生成角色四视图 Error：…是画布节点 id…不能直接当 filename 传。请用 @ref[参考图显示名]，或先调 upload_image…」+ 后续「读取素材参考 0s」「生成角色四视图 进行中」——CS-USER-002 拦截反复触发的会话证据（描述已修，行为层待证据）。 |
| C-15 | `bug-C-15-failed-image-nodes.png` | 画布多张「生成失败·点击重试」图卡（1280×736 / 1808×1024 混排）——预检失败落卡现象（批5 已修：预检失败不落卡）。 |
| D-1 | `bug-D-1-terminal-frame-card.png` | 「未挂·分镜1-尾帧」854×480 独立卡与「视频合成」并存——尾帧卡对用户无用的画面证据（D-1.md auxiliary 收起方案的对照）。 |
| D-2 | `bug-D-2-reference-edge-labels.png` | 连线标签「MKR 多关键帧」（OCR：MKR 多关时帧）仍出现在多参考视频边；详情浮层显示「3张·多参考 Ref2VA」与 Picture 1/3——标签语义与实际通道不符（批6 已改「参考 N / 分镜」）。 |
| D-3 | `bug-D-3-stale-character-sheet-links.png` | 编辑提示词浮层（分镜5·视频）参考区仍列旧 ref 句柄（ref-9e0…png / ref-073…png），旁批「形象已通过 Agent修改」——旧三视图引用未即时作废的画面证据（批F supersede 改写对象）。 |
| E-1 | `bug-E-1-homepage-project-error.png` | 首页：左栏项目列表正常（5 个项目可见），主区对话卡与底部技能卡（品牌宣传片/电影级运镜/动作场景导演/极简产品广告/3D动画短片）渲染完整——截图本身未呈现报错弹窗，取证仍需运行时 projects.json + 日志（与 E-1.md 两案并陈一致）。 |

> 注：B-5/B-6/B-7 为合并占位行无独立图；C-1/C-2/C-8/C-11/C-16/E-2/E-3 及「模型试探后端」「新项目 720p」等纯文字条目无描述图。资料库 images 文件夹（`cWcrnzciLWE9TrBvYPiMis`）中的「词条重复.png」已核验与 Bug 表行内链接为同一文件（sha256 一致），以 `bug-A-6-duplicate-shot-entry.png` 为准，未重复入库第二份。
