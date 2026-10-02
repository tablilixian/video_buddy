# Canvas Studio — Bug 整理文档

> 本文档整理自团队资料库「Bug 表」（`https://www.workbuddy.cn/space/d/yV3vWU3Wd9THFDL1WT7Io9`），用于作为后续处理项目缺陷的基准底稿。
> 导出时间：2026-10-02 ｜ 记录总数：**40 条** ｜ 提交人：Jason ｜ 负责人：李丽贤
> 涉及版本：1.0.0（11 条）、1.0.1（29 条）

---

## 一、总览

### 1.1 严重级别分布

| 严重级别 | 数量 | 占比 |
|---|---|---|
| 致命 (Critical) | 2 | 5% |
| 严重 (High) | 13 | 33% |
| 一般 (Medium) | 21 | 53% |
| 轻微 (Low) | 4 | 10% |

### 1.2 状态分布

| 状态 | 数量 |
|---|---|
| 新建 | 28 |
| 重新打开 | 2 |
| 待验证 | 2 |
| 已关闭 | 8 |
| 待复现 / 修复中 | 0 |

> 注：绝大多数 Bug 仍为「新建」，说明缺陷池尚未进入系统化修复节奏，需结合下方分类排定处理顺序。

### 1.3 主题分类（用于后续派单）

| 主题 | 条目数 | 关联模块区域 |
|---|---|---|
| A. 画布交互与布局 | 13 | `canvas-studio` 布局/节点/连线/分镜渲染 |
| B. 资产管理与历史 | 7 | 资产库、文件落盘、回收清理 |
| C. 音视频生成管线（Agent / ffmpeg / tts / 模型） | 14 | Host 工具、ffmpeg、TTS 管线、模型路由 |
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

#### A-2 ｜ 画布大量素材后不稳定（严重 / 新建 / 1.0.0）
- **标题**：画布里存在大量素材后，打开「废弃素材」，整个画布不太稳定，刷新出现 UI 大问题。
- **详细描述**：画布 UI 存在大量元素时，UI 拖动刷新影响很大。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/gICjdowA1tysV9TO8nyT0y.png

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

---

### B. 资产管理与历史（7 条）

> **项目关联**：资产库由 Host 侧资产服务承载，真画布位于 `settings.yaml → canvas-studio.assetDir` 指向的目录（实际如 `~/Desktop/job/VideoOut/newOut/projects/<项目名>/canvas.json`）。删除/回收逻辑涉及 `asset-capture.ts` 与文件系统落地。

#### B-1 ｜ 删除元素文件仍残留（一般 / 重新打开 / 1.0.0）
- **标题**：对于从画布上删除的元素，实际文件 asset 里仍旧存储着这些文件，期望删除废料。Windows 上废弃的文件进入了 `.trash` 目录里，没有实际从文件系统删除。期望彻底删除之。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/nZ4NHmPOj0SDxLnTHMsUWK.png

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

#### C-3 ｜ 帧率/码率被改导致画质下降（一般 / 新建 / 1.0.1）
- **标题**：生成一个 10 秒视频，发现原视频是 24f/s，export 视频改成了 25f/s。并且码率有所变化，视频码率变小了，文件 size 变小，可能品质随着压缩变差。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/k5yrn6fNXPPedoeq58Gvm1.png , https://workbuddy-space-static.codebuddy.work/image/3qgLylh1hx2pqmr8LzPxpw.png

#### C-4 ｜ 图片判失效莫名其妙（严重 / 新建 / 1.0.1）
- **标题**：图片判失效有点莫名其妙，好像是图没传？错误原因很古怪。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/HdolHtILxMV3mB8rFnCri2.png

#### C-5 ｜ TTS 流程严重问题（致命 / 新建 / 1.0.1）
- **标题**：TTS 流程有比较大问题。一个 30s 视频生成旁白，出现 3 个音色。人物是男生，都用了 3 个女生音色，不知道是否故意这么设计的。第一段视频，旁白丢失。
- **详细描述**：如果要在视频里带 tts 声音，只须用同一个参考音即可，无需生成 3 段 tts 旁白。如果想单独生成 3 段旁白音频，也需要先生成音色设计 tts，通过参考音色再来生成 3 段旁白，才能保证音色的一致性。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/e9ceNh2LzcGILCg8SK9kQj.png

#### C-6 ｜ BGM 提示词有多余部分（轻微 / 新建 / 1.0.1）
- **标题**：背景音乐生成提示词有多余部分，看附图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/00BAER6rcrl3jJHOqqUqVK.png

#### C-7 ｜ BGM 出现多余人声（一般 / 新建 / 1.0.1）
- **标题**：背景音乐生成出现多余人声 vocal；需要匹配 yue2 的提示词 skill。
- **详细描述**：背景音乐生成出现多余人声 vocal；需要匹配 yue2 的提示词 skill。

#### C-8 ｜ 默认 480p 却生成 720P（严重 / 新建 / 1.0.1）
- **标题**：我默认是 480p 的，不知为何，我点新建，传入文本，最后生成的视频都是 720P 的。
- **详细描述**：我默认是 480p 的，不知为何，我点新建，传入文本，最后生成的视频都是 720P 的。

#### C-9 ｜ 视频生成提示错误（一般 / 新建 / 1.0.1）
- **标题**：视频生成提示错误，见图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/ST6rX2iM7a5vc1RltrQCTT.png

#### C-10 ｜ 重生成参考图导致断链（严重 / 新建 / 1.0.1）
- **标题**：手动在画布重生成参考图，会导致视频断链，且发现如果 agent 在活动中，主动添加图到锻炼，通常会刷新失败。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/OhA5dQTj53HY3cPAN2t8wU.png

#### C-11 ｜ 景点文字导致视频模糊（严重 / 新建 / 1.0.1）
- **标题**：当要求视频左上角标注景点文字时（例如「梧桐大道.太子城」），Agent 会在参考帧画面上加文字，又在视频 prompt 上加文字提示。会导致视频反而出现文字模糊。建议只在一处加，有些文字不要在参考图上加，而在 H3 prompt 上加。
- **详细描述**：当要求视频左上角标注景点文字时，例如「梧桐大道.太子城」时，Agent 会在参考帧画面上加文字，又在视频 prompt 上加文字提示。会导致视频反而出现文字模糊。建议只在一处加，有些文字不要在参考图上加，而在 H3 prompt 上加。

#### C-12 ｜ 删中文仍用 qwen 而非 krea2（一般 / 新建 / 1.0.1）
- **标题**：删掉提示词里的中文，发现仍旧使用 qwen image 生图而不是 krea2。期望能重新判断，改用 krea2 生图。
- **详细描述**：删掉提示词里的中文，发现仍旧使用 qwen image 生图而不是 krea2。

#### C-13 ｜ 建议增加 ffprobe（轻微 / 新建 / 1.0.1）
- **标题**：建议增加 ffprobe，见附件。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/LDAM7TeVoYGT93UzUFTJwv.png

#### C-14 ｜ 生成 4 视图失败（严重 / 新建 / 1.0.1）
- **标题**：多次在遇到生成 4 视图是失败，像是文件引用错误。见附件图。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/grZ3UMwvQzVFgzed76k0Us.png

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

#### D-3 ｜ 角色形象修改后旧三视图未作废（一般 / 新建 / 1.0.1）
- **标题**：角色形象已通过 Agent 修改，原三视图没作废，且画布视频参考连线都还是旧，且 Agent 提示已经上传新形象且在生成新的视频。视频生成结束后，画布才有了正确的引用调整。期待画布先于视频生成调整，旧三视图应报销。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/6qhNy5cj4Dgb0J77BAYS9E.png

---

### E. 工程与启动体验（3 条）

> **项目关联**：首页/启动与项目目录组织属于 `dsh-plugin-desktop`（Electron bootstrap）与画布项目持久化层。已知项目目录形如 `.draft-202610-4`。

#### E-1 ｜ 新建项目首页异常（致命 / 新建 / 1.0.1）
- **标题**：来回切换了几个项目后，点新建项目，出现首页异常。app 关掉重进也是如此。好像不知为何建了空项目目录 `.draft-202610-4`。
- **描述图**：https://workbuddy-space-static.codebuddy.work/image/Dz8zf47cWVQpO66bP5TiTq.png

#### E-2 ｜ 打开 App 自动加载多个画布（一般 / 新建 / 1.0.1）
- **标题**：每次打开 App，都会加载好几个画布，然后进入最后的画布。期望不加载画布，停留在首页。
- **详细描述**：每次打开 App，都会加载好几个画布，然后进入最后的画布。期望不加载画布，停留在首页。

#### E-3 ｜ 项目目录组织建议到秒（轻微 / 新建 / 1.0.1）
- **标题**：项目目录组织建议到秒，目前容易按 `.draft-202610-4`，`-5`，`-6` 等下去，不如按秒来组织。
- **详细描述**：项目目录组织建议到秒，目前容易按 `.draft-202610-4`，`-5`，`-6` 等下去，不如按秒来组织。

---

## 三、优先级处理建议（结合项目实际）

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
