# Canvas Studio — 需求与缺陷总账 · 已终结条目沉降档（tracking-closed）

> **本文件是什么**：tracking.md 中已终结条目（桌面验收通过 / 已拍板 / 已销项 / 已解决）的全文本沉降档，**只进不出**——条目终态即从 tracking.md 挪入本文件；tracking.md §一/§二 的索引表仍由脚本生成全量行（含本文件条目），别名对照见 tracking.md §三，同步协议见 tracking.md 头部。
> 首次沉降：2026-10-06（BUG 17 条：BUG-002、BUG-004、BUG-006、BUG-008、BUG-009、BUG-011、BUG-012、BUG-013、BUG-014、BUG-015、BUG-016、BUG-017、BUG-018、BUG-019、BUG-020、BUG-021、BUG-022；REQ 8 条：REQ-001、REQ-005、REQ-006、REQ-007、REQ-008、REQ-009、REQ-015、REQ-021）。

---

## §一、已终结缺陷（Bug）

### BUG-002 — Agent 不知道 ffmpeg 的存在，不会裁切音频

- **资料库别名**：C-1
- **关联 CV**：CV-201+CV-245
- **编号**：BUG-002
- **严重度**：严重
- **状态(资料库)**：新建（待同步资料库为「已关闭」）
- **当前落地状态**：**已解决**（CV-201 随包 ffmpeg + CV-245 `cut_audio` 工具与指引，2026-09-27 真机验收通过）
- **归属模块**：Host 工具层 / skills / 音频处理
- **现象**：对 Agent 提出「裁切我上传的 mp3」，他不知道有 ffmpeg 的存在；用户指出 ffmpeg 位置后，他才懂去调用。
- **复现步骤**：
  1. 上传一段 mp3 到画布；
  2. 让 Agent 把该 mp3 裁切为某时间段的片段；
  3. Agent 不知道 ffmpeg 存在、不会调用，需用户明确告知 ffmpeg 路径后才懂。
- **关联代码**：
  - `src/ffmpeg-run.ts`（Host 侧 concat/mix 用）：`resolveFfmpegPath` / `runFfmpeg` / `probeMediaDuration`
  - `src/compose.ts:83` `ffmpegPath`
  - `src/audio-cut.ts`（**CV-245 新增**）：`cutAudioSegment` 能力模块 —— 重编码 `libmp3lame` 输出 mp3、越界/截尾语义、半成品清理
  - `src/host-tools.ts` `cut_audio` 工具（插在 `music_generation` 之后）：`resolveCutAudioSource` 解析三种形态入参 → 落新音频节点（`toolName`/`sourceIds`/实测 `duration`），**不接审批门**
  - `src/param-guard.ts`：`audio` 登记为 handle 参数、`start`/`end` 豁免并写理由（`tests/param-guard.test.mjs` 双向对账）
  - `src/asset-capture.ts`：`cut_audio: 'audio'`（漏登记 = 裁完画布不刷新，同 CV-130）
  - 历史现场：`src/host-tools.ts` compose 工具说明写「Host 侧 ffmpeg concat」；修复前 `skills/` 与工具 description 对「裁切音频」**零命中**（无告知 agent 的入口）
- **根因**：ffmpeg 依赖 `ffmpeg-static@5.3.0` 在 `dependencies` 但二进制从未进包（postinstall 被 `.yarnrc.yml` 的 `enableScripts:false` 阻断）；且 skills / 工具描述里没有任何告知 agent「可用 ffmpeg 裁切音频」的说明或专用工具 —— **即使 ffmpeg 已随包（CV-201），agent 侧仍然没有任何音频加工入口**（`music_generation` 只能整段生成、`compose_video.bgmNodeId` 只能整段混入）。
- **修复方案/计划（已落地）**：CV-201 把 ffmpeg 打进 app 包；**CV-245 补齐 agent 侧入口**——① 新能力模块 `src/audio-cut.ts`；② 新 Host 工具 `cut_audio(audio, start, end)`（本地执行、秒回、不占后端单任务、不接审批门），产物落**新音频节点**并保留源节点与血缘；③ 指引层互提：`toolchain.md` 工具表 + 「不受约束」清单、`music_generation` 描述指向裁切、`video_generate`/`video_composite` 的 `audioRefs`（合计 ≤15s）与 `docs/canvas-studio-tools.md` §B3。见 CV-245。
- **验收标准**：Agent 收到裁切音频请求时能自主调用 ffmpeg 完成，无需用户告知路径 → 验收用例 `docs/acceptance-test-cases.md` **K-8 / K-9 / K-10**（不告知任何路径、end 超长自动截尾 + warnings、起点越界给可用区间、超 15s 参考音频先裁再引用）。
- **关联文档**：`docs/STATUS.md` §4(CV-245)、`:255`(CV-201)；`docs/canvas-ux-backlog.md:65`；`docs/acceptance-test-cases.md` K-8~K-10；`docs/canvas-studio-tools.md` §B3；测试 `tests/audio-cut.test.mjs`（11 例，含真实 argv 断言与落卡断言）、`tests/ffmpeg-bundled.test.mjs`。
- **资料库来源**：Bug 表 行 2。
---

### BUG-004 — 关闭「废弃素材」后，画布 UI 布局调整不明显，仍留有大量空间

- **资料库别名**：A-3
- **关联 CV**：CV-244
- **编号**：BUG-004
- **严重度**：一般
- **状态(资料库)**：新建（待同步资料库为「已关闭」）
- **当前落地状态**：**已解决**（**CV-244 布局回收**，2026-09-27 真机验收通过）
- **归属模块**：Client 布局（`StudioFrame` / `project-store` / `canvas-view`）
- **现象**：关闭「废弃素材」后，画布 UI 上布局调整不明显，仍旧为废弃素材留有大量空间。
- **复现步骤**：
  1. 画布有若干 retired 节点；
  2. 关闭工具栏「废弃素材」开关；
  3. 画布上原 retired 节点位置仍留空白，未自动回收排版（需手动点「整理布局」才回收）。
- **关联代码**：
  - `src/canvas-view.ts` `computeArrangeLayout(nodes, options?: { only? })`（**CV-244**：只对可见子集计算排布）
  - `src/client/project-store.ts` `autoArrange` 第 5 参 `options.layoutOverVisible`（**CV-244**：排布输入收敛为可见子集，托盘成员表同步过滤）
  - `src/client/StudioFrame.tsx`（**CV-244** 三处：放手跑自动整理 / 整理按钮 / 开关双向——隐藏传 `layoutOverVisible:true`，显示对称全量重排 + fit）
- **根因**：两个精确缺口——缺陷 A：`autoArrange` 全量算坐标只对可见应用，retired 照常占槽位、superseded 钉扎照常加高 → 隐藏后满屏洞；缺陷 B：关闭隐藏（重新显示）零处理，retired 带旧坐标回来与重排后的可见节点叠压。
- **修复方案/计划（已落地并验收）**：CV-244 隐藏方向只对可见子集计算排布（不占槽位、不撑行高、不参与钉扎加高）；显示方向对称触发全量重排（retired 按既有钉扎规则归位）。方案见 `docs/archive/plans/废弃素材开关布局回收方案.md`。
- **验收标准**：关闭废弃素材后画布自动紧凑不留空洞；重新显示后 retired 归位不叠压。**已真机验收通过。**
- **关联文档**：`docs/archive/plans/废弃素材开关布局回收方案.md`(CV-244)；测试 `tests/canvas-arrange.test.mjs`（CV-244 新增 3 用例）、`tests/canvas-placement.test.mjs`。
- **资料库来源**：Bug 表 行 4。
---

### BUG-006 — 每次生成/合成 export 视频都会产生历史视频，但无任何地方可被发现

- **资料库别名**：B-2
- **关联 CV**：CV-246+CV-246a+CV-277-c
- **编号**：BUG-006
- **严重度**：一般
- **状态(资料库)**：新建（待同步资料库为「已关闭」）
- **当前落地状态**：**已解决**（**CV-246 生成历史面板** + **CV-246a 真机反馈三连修复**，2026-09-27 真机验收通过）
- **归属模块**：Host 产物登记（`src/asset-history.ts`）/ Client 历史面板（`src/client/canvas/HistoryDrawer.tsx`）/ GC 联动（`asset-gc.ts`）
- **现象**：每次生成、合成 export 视频都会产生一个历史视频，但没有任何地方可被发现。建议左上角保留历史上所有生成的图和片，方便回溯；用户删除则从磁盘彻底删除。
- **复现步骤**：
  1. 多次生成 / 合成 / export 视频；
  2. 想回溯某次历史视频；
  3. 界面上没有任何入口能看到历史生成物；磁盘有文件但用户无从发现。
- **关联代码**：
  - `src/asset-history.ts`（**CV-246 新增**）：`<项目>/assets/history.json` 产物登记表（串行队列防撕档）——`recordAssetHistory`（幂等记账）/ `markHistoryDeleted`（面板删除标记）/ `pruneHistory`（GC 后剪枝）/ `collectProtectedBasenames`（GC 保护名单）；kind/label 唯一派生点
  - 记账埋点 6 处：`generate.ts` `saveLocalAssetBytes`（上传）/ `persistGeneratedAsset`（生成统一落盘）/ 角色四视图 / 音乐、`compose.ts` 成片（concat 与 amix 两路径汇聚点）、`audio-cut.ts` 裁切——全部 try/catch 不阻断主流程
  - `src/asset-gc.ts`：**未删历史条目 = GC 保护名单**（画布不引用也不清；.trash 里不物理清也不回活）；`history.json` 跳过清理；第 ⑤ 步剪枝（判据 = 物理清/回活后同步剔除的 trash 名单快照）
  - `src/routes.ts`：`GET /canvas-studio/asset-history` + `POST .../delete`（防穿越校验；仍被画布引用 → **409 拒绝**防断链；否则 rename 进 `.trash` + 标 deletedAt）
  - `src/client/canvas/HistoryDrawer.tsx`（**CV-246 新增**）：右侧滑出抽屉——全/图/视频 tab + 真缩略（img/video 首帧）+ 三色状态徽章（已挂画布/已被取代/未挂画布，客户端对照 nodes 派生）+ 删除确认
  - **CV-246a（真机反馈三连）**：① 预览不再 `window.open`（资产路由 loopback authority 403 且跳出 app）——已挂画布 →「定位」（`selectNode` + `setDetailNodeId` + `setFocusNodeId`，与双击素材同一条详情链路 + 画布居中）；未挂画布 → app 内 lightbox 弹层（挂 `.csCanvasBody` 与抽屉同级）；② 卡片主体点击 = 定位/预览分流（多节点引用同一文件取最新活跃节点）；③ 自动刷新：url 集合签名依赖——生成/上传/删节点改变 url 集合 → 重拉，拖动不改 url → 不重拉
  - `src/client/canvas/CanvasToolbar.tsx` + `StudioFrame.tsx`：最右图标组时钟入口（图层与小地图之间；左上角与「参考图」浮动卡弹出区冲突，真机截图否决）
- **根因**：产物全部落 `assets/`（`UUID.ext` 无语义文件名），canvas.json 只登记画布上的节点——节点删除/被取代后线索即断，产物沦为无主文件（会被 CV-243 的 GC 当孤儿清掉）；且从未有过任何历史 UI。
- **修复方案/计划（已落地）**：每个产物落盘点记账 → 历史抽屉回溯（含已从画布移除的）→ 面板删除走两段式（409 防断链 + `.trash` + deletedAt → GC 物理清闭环）；与 CV-243 的分工：CV-243 管「没人要的怎么清」，CV-246 管「有人想要的怎么找回」。方案见 `docs/archive/plans/生成历史面板方案.md`。
- **验收标准**：① 生成/上传/裁切产物即时入账、重启应用仍在；② 删画布节点后条目变「未挂画布」但保留可回溯；③ 删「已挂画布」产物被拒绝；④ 删「未挂画布」产物进回收站、重开项目 GC 后彻底清除；⑤ 未删除的产物不被自动 GC 清掉。
- **关联文档**：`docs/archive/plans/生成历史面板方案.md`(CV-246，含 UI 拍板记录与实施状态)；测试 `tests/asset-history.test.mjs`(9 例：记账幂等/GC 保护/两段式闭环/死条目剪枝/上传链路)。
- **资料库来源**：Bug 表 行 6。
---

### BUG-008 — 对分镜内容后期大量修改，画布上分镜词条没有变化

- **资料库别名**：A-7
- **关联 CV**：CV-050+CV-251
- **编号**：BUG-008
- **严重度**：一般
- **状态(资料库)**：新建
- **当前落地状态**：**已解决**（CV-050 重提换文案 + CV-251 修改重提纪律/防堆卡，2026-09-27 真机验收通过）
- **归属模块**：Host 分镜（`submit_storyboard_for_approval` / `mergeShotCards`）
- **现象**：对分镜内容后期大量修改，画布上分镜词条没有变化。期待见到内容变化，或者减少词条出现。
- **复现步骤**：
  1. 提交分镜；
  2. 后期大量修改分镜正文；
  3. 画布上分镜词条标题/内容未变化。
- **关联代码**：
  - `src/host-tools.ts` `mergeShotCards`（CV-050：同镜号复用 id/位置、只换文案）
  - `src/host-tools.ts` `submit_storyboard_for_approval` description（CV-251：补「修改分镜 = 重提完整分镜表，按镜号原地更新」硬指引）
  - `src/host-tools.ts` execute 防堆卡闸门（CV-251：解析失败 + 画布已有分镜节点 → 抛 `CS-USER-ERR` 附 6 列格式引导，不再追加整表卡）
  - `src/host-tools.ts` `STORYBOARD_PARSE_HINT`（防堆卡报错与 auto/confirm 两处降级提示共用）
- **根因**：两个缺口——① 工具描述与 skill 总纲均无「修改分镜须重提整表」指引，模型把修改说在对话里或改剧本节点（画布不动）；② confirm 模式解析失败走「整表单节点」无条件追加（已有分镜卡时堆卡）。
- **修复方案/计划**：方案 A（用户拍板「先做 A」）——工具描述硬指引 + skill 总纲两处同步（行 65 例外 carve-out、第 3 步重提纪律）+ 解析失败防堆卡闸门（抛可操作报错让模型同回合按格式重试，回合不终止）。不做单镜编辑工具（方案 B）。详见 `docs/archive/plans/分镜修改纪律与防堆卡方案.md`。
- **验收标准**：打回后改一镜 → 模型重提完整表，画布卡 id/位置不变、文案原地更新、不新增卡；诱导解析失败 → 收到格式引导而非多出整表卡。
- **验收结论**：✅ 2026-09-27 真机验收通过（《深夜面馆》测试剧本）。附带产出：镜位框「镜 N」chip 缩放显示两连修（CV-252，`c7ed172ff7`→`50f9ee08b8` 终版：chip 独立顶层渲染，任何缩放/排布下不切半、不压别的镜卡）。
- **关联文档**：`docs/STATUS.md:200`(CV-050)；`docs/archive/plans/分镜修改纪律与防堆卡方案.md`(CV-251)；`skills/canvas-studio-creation/SKILL.md` 行 65/70；测试 `tests/shot-cards.test.mjs`（11 用例：merge 语义 + 端到端重提 + 防堆卡/回归/描述断言）。
- **资料库来源**：Bug 表 行 8。
---

### BUG-009 — 上传的音乐速度极慢，去服务器绕了一圈

- **资料库别名**：C-2
- **关联 CV**：CV-241
- **编号**：BUG-009
- **严重度**：严重
- **状态(资料库)**：新建（待同步资料库为「已关闭」）
- **当前落地状态**：**已解决**（CV-241 已修复，2026-09-27 真机验收通过）
- **归属模块**：Host 路由 / 上传（`routes.ts` / `generate.ts`）
- **现象**：上传的音乐速度极慢，去服务器绕了一圈。
- **复现步骤**：
  1. 上传一段音乐；
  2. 进度极慢，观察请求绕服务器一圈才返回。
- **关联代码**：
  - `src/routes.ts:44` `ROUTE_UPLOAD_MEDIA=/canvas-studio/upload-media`（octet-stream）
  - `src/routes.ts:1013-1018` `saveLocalAssetBytes`（**只本地落盘、禁止同步 promote**）
  - `src/generate.ts:822` `saveLocalAsset`、`:813` `healReferenceFilename`（注释「上传永不阻塞公网往返」）
  - 旧 `/upload` 标 DEPRECATED（`src/routes.ts:1036-1038`）
- **根因**：旧 `/upload`（JSON+base64）落盘后**同步 promote** Drama（HTTP 往返串行=慢），且拖放只认 video/image、音频静默丢弃。
- **修复方案/计划**：CV-241 四类文件统一入口 + 本地落盘秒回 + 惰性 promote（永不阻塞公网往返）；音频拖入已支持。待验收。与 BUG-002（裁切音频）联动。
- **验收标准**：上传音乐本地秒回，不绕服务器；四类文件（图/视频/音频/文字）均可拖入。
- **关联文档**：`docs/STATUS.md:236,6`(CV-241)；`docs/canvas-ux-backlog.md:63`；`docs/acceptance-test-cases.md:121,172`；测试 `tests/upload-media.test.mjs`、`tests/generate.test.mjs`、`tests/media-drop.test.mjs`、`tests/media-upload-wiring.test.mjs`、`tests/upload-endpoint.test.mjs`。
- **资料库来源**：Bug 表 行 9。｜ **图证**：`assets/library-2026-10-03/bug-C-3-export-media-info-source.png`、`bug-C-3-export-media-info-output.png`（本条为 C-3 用图，同为 Windows 属性面板取证，一并入库备查）
---

### BUG-011 — 一次误判产生大量废弃视频，且默认合成只出单镜残片

- **关联 CV**：CV-277-a + CV-277-b
- **编号**：BUG-011（**本仓自立**：2026-10-05 揽月湾真机取证，资料库尚无对应行 —— 下次 `space_api.py` 拉取后按同步协议补登）
- **严重度**：严重
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**（CV-277-a + CV-277-b，2026-10-05）
- **归属模块**：Host 镜位版本链（`shot-versions.ts`）/ 生成落盘（`generate.ts`）/ 合成选片（`host-tools.ts`）
- **现象**（揽月湾项目 `.draft-202610-04221026`，3 镜 15s 宣传片）：
  1. 6 个视频节点里 **5 个带「已失效」灰显角标**，其中 **2 个实际已在成片里**（角标与事实脱钩）；
  2. agent 在 step 23 察觉 `list_shots` 只剩 1 段，误判为「并行提交引发镜位竞争」，改串行重出 3 条 ⇒ 每条新视频又顶掉上一条，最终 3 条全废，**白烧 8.5 分钟 GPU + 4.25 MB**（整个项目视频墙钟 21.8 分钟，近 40% 无效）；
  3. `defaultComposeClips` 只收得到 1 段（5.17s）⇒ **用户在 UI 点「导出成片」拿到的是单镜残片**，且无任何警告（agent 是靠显式传 `clipIds` 绕过的，UI 路径没有这个口）。
- **复现步骤**：
  1. 建一个 ≥2 镜的分镜表并提交（生成 N 张分镜卡）；
  2. 逐镜出关键帧，**每镜的参考图组合里引用别镜的关键帧**（`shot-format.md` 第 9 步只要求「≥3 张」，没禁止补位引用别镜）；
  3. 逐镜 `video_composite`（带 `shotRefs`）；
  4. 观察：镜 1/镜 2/镜 3 的视频互相被标 supersededBy，版本号串成 v1→v2→v3。
- **关联代码**：
  - `src/shot-versions.ts:199-205`（**病根**：`.some()` 交集判定）→ 已改为「旧节点锚点集 ⊆ 新节点锚点集」，两侧锚点同口径（新增导出 `shotAnchorCardsOf` + 内部 `newNodeAnchorCards` / `anchorCoveredBy` / `realShotCardsOf`）
  - `src/generate.ts:2571-2574`（锚点派生：`anchorShotCardIds` 降级为**兜底**，显式 `shotNodeIds` 非空时只用显式）
  - `src/host-tools.ts:499-505`（`defaultComposeClips`，判定本身**不改** —— `isShotClip` 是全仓唯一口径）
  - `src/host-tools.ts`（`compose_video` execute：CV-277-b 软提示）
- **根因**：CV-222 镜位级取代的设计前提是「一条视频只挂一张分镜卡」，判据写成「血缘里有任一张分镜卡相同即取代」。但 CV-031 关键帧继承（`generate.ts:1505-1519`）会把**每张参考图各自挂着的分镜卡全部继承**进视频节点；`shot-format.md` 第 9 步又要求逐镜参考组合 ≥3 张，agent 补位时引用别镜关键帧 ⇒ 每条视频 `sourceIds` 含 2 张卡 ⇒ 任意两条共享一张 ⇒ 退化成全局串链。
  **为什么此前没被发现**：守卫测试 `shot-versions.test.mjs:130`「不同镜位互不误伤」用的是**每镜各自只挂一张卡**的干净形态，永远测不到多卡交叉 —— 该缺陷带着「已验收」标签通过了评审。
- **修复方案/计划（已落地）**：
  1. **CV-277-a** 判据从「有交集」改为「**旧节点锚点集 ⊆ 新节点锚点集**」；锚点解析两侧同口径：**显式 `shotRefs` 声明优先，血缘继承仅在恰好一张时回退，多张或空一律拒绝自动取代**（延续「无锚点拒绝判重」的保守口径）。同镜位换参考组合重跑（CV-222 原始场景）仍自动取代。
  2. **CV-277-b** `compose_video` 在「非显式 `clipIds` + 只收 1 段 + 画布逐镜总数 >1」时追加 warning，明说其余为失效版本并给出两条出口。**不改判定** —— CV-141 允许「一镜整出」，只在明显不是用户意图时提示。
- **验收标准**：
  1. 单元：多卡交叉不互取代 / 同镜重跑仍自动取代 / 漏传 `shotRefs` 时唯一卡可判、多卡拒绝 / 无锚点不触发，四类守卫齐全；
  2. 现场回放：用 `canvas.json` 真实数据重放 6 次提交 → 3 条视频互不取代、同镜重跑正确取代、`defaultComposeClips` 选出 3 段 15.00s；
  3. 真机：新建 ≥2 镜多参考图项目 → 各视频节点无 `supersededBy`；UI 导出得到完整多镜成片。
- **验收结论**：单元 + 现场回放**已通过**（`shot-versions.test.mjs` 21/21，新增 5 条；新判据下现场数据回放 3 段 15.00s）；真机待用户验收。
- **关联文档**：effect-tests/lanyue-bay-retro-20261005.md（完整复盘）、effect-tests/fix-list-20261005.md（待改清单）；本文件「CV-277」节；测试 `tests/shot-versions.test.mjs`、`tests/retired-assets-cleanup.test.mjs`。
- **来源**：2026-10-05 揽月湾真机取证（会话 `session.jsonl 5` + `canvas.json` + `jobs.json` 三方对账）。
---

### BUG-012 — 废弃产物永不自动清理（GC 保护名单没有出口）

- **关联 CV**：CV-277-c
- **编号**：BUG-012（**本仓自立**）
- **严重度**：一般
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**（CV-277-c，2026-10-05）
- **归属模块**：Host 资产服务（`routes.ts`）/ 资产 GC（`asset-gc.ts`）/ Client 历史面板（`HistoryDrawer.tsx`）
- **现象**：CV-246 的设计是「未删除的历史条目 = GC 保护名单」——本意是让用户能回溯被顶掉的版本。代价是**没有「不想要了」的出口**：一次误判产生 5 条废弃视频（4.25 MB）后，只能逐条点删除；实际上没人会做，磁盘只增不减。
- **复现步骤**：生成若干视频 → 让它们被新版取代 → 打开历史面板 → 失效条目都在，且无批量清理入口。
- **关联代码**：
  - `src/asset-gc.ts:143-144`（`collectProtectedBasenames` 并入保护名单 —— CV-246 的刻意设计，**不改**）
  - `src/routes.ts`（**新增** `POST /canvas-studio/asset-history/prune-retired`）
  - `src/client/api.ts`（**新增** `pruneRetiredStudioAssets`）
  - `src/client/canvas/HistoryDrawer.tsx`（**新增**「清理失效产物（N）」按钮 + 确认条）
  - `src/client/contracts.ts` / `index.ts` / `StudioFrame.tsx`（**新增** `reloadCanvas` 接线，走既有 `reloadCanvasQueued` 串行链，不新开写盘通道）
  - `src/client/styles.ts`（**新增** `csHistPrune` / `csHistConfirmBar` / `csHistConfirmText` / `.csHistDelete:disabled`）
- **修复方案/计划（已落地）**：批量清理路由 + 面板入口。判据 = `!isActiveShot(node)` **且**不是成片节点（`isComposeProduct`）；`isLoading` 节点跳过并在响应的 `busyNodes` 里回报（不静默放过）。复用单条 force 删除的两段式语义（删引用节点 + 解引用下游 `generationPrompt` + 物理删 + 标 `deletedAt`），但 N 个文件**合并成一次** `writeCanvas`。GC 保护语义不变 —— 仍是用户主动触发，不自动清。
- **验收标准**：① 失效图/视频被清掉且文件物理删；② 成片、有效片段、音频、文本、`isLoading` 节点全部保留；③ 下游节点 `generationPrompt` 被解引用（数组位删元素、标量位标 `[已删除:…]`，不静默降级）；④ 无失效产物时返回空清单且**不写盘**；⑤ 权威守卫与单条删除路由同口径；⑥ 面板按钮只在有可清理项时出现，确认条说清项数与体积。
- **验收结论**：契约测试 **5 条全通过**（`tests/retired-assets-cleanup.test.mjs`）；真机待用户验收。
- **来源**：2026-10-05 揽月湾真机取证（NEW-3）。
---

### BUG-013 — 分镜卡标题被截断致 `@ref[标题]` 失配

- **关联 CV**：CV-277-d
- **编号**：BUG-013（**本仓自立**）
- **严重度**：一般
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**（CV-277-d，2026-10-05）
- **归属模块**：Host 参考解析（`host-tools.ts` 的 `list_references` 回执）
- **现象**：图片节点标题取自 `promptSummary(prompt, 12)` —— 前 12 字 + 省略号。现场 Look 样张标题是 `广角空镜风光摄影，正面平…`，而 `@ref[标题]` 走 `findNodeByRef`（`reference-token.ts:75-83`）的**标题精确匹配** ⇒ agent 不敢用 `@ref`，改走 `upload_image` 取句柄绕开，**多跑一次上传往返**（现场实证：会话 step 20 主动说明「@ref 解析有风险」）。
- **复现步骤**：出图（提示词首句较长）→ 调 `list_references` → 标题带省略号 → 用该标题写 `@ref[...]` → 解析失败或需绕道。
- **关联代码**：
  - `src/generate.ts:1384-1388`（`promptSummary`，`max = 12` —— **不改**，短标题在图层面板更清爽）
  - `src/host-tools.ts`（**新增**：`references` 每项带 `id`；资产卡 `anchors` 每项带 `id`；渲染行 `（id=xxx）`；工具描述写明「优先 `@ref[<节点 id>]`」）
  - `src/reference-token.ts:75-83`（`findNodeByRef`，**不改** —— id 优先、标题兜底本就是它的设计）
- **修复方案/计划（已落地）**：给参考图条目与资产卡锚点分图都补节点 id，作 `@ref` 的第二抓手（id 稳定、精确匹配）。写法对齐既有的 `describeShotCards`（提交分镜后的回执同款格式）。
- **验收标准**：① `list_references` 每项 `id` 为非空串；② 渲染文本含 `（id=xxx）`；③ 工具描述含 `@ref[<节点 id>]` 引导；④ 资产卡锚点行同样带 id。
- **验收结论**：契约测试通过（`tests/retired-assets-cleanup.test.mjs` 第 6 条 + `tests/reference.test.mjs` 回归更新）；真机待用户验收。
- **来源**：2026-10-05 揽月湾真机取证（NEW-2）。
---

### BUG-014 — 自动测试场景执行器假超时（自然完成的回合被判 CS-EFFECT-003）

- **关联 CV**：（R001 取证）
- **编号**：BUG-014（**本仓自立**）
- **严重度**：严重（S1：场景贴近 50 分钟时**必然**失去全部测试产出，且 REQ-021 验收标准②③④全被它阻塞）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**——`waitAgentTurn` deadline 让位空闲判定：预算到点时只要见过 running，允许再轮询至多 2 次凑满「连续 2 次空闲」（超时语义 = 回合墙钟 + 空闲尾巴余量）；从未见过 running 仍走 CS-EFFECT-002 / 真未结束才抛 CS-EFFECT-003。轮询间隔、错误码、函数签名不变，`runEffectTests` 编排零改动。`test-driver.ts` 挪至 `src/` 根（node:test 直连，同 auto-test-checkpoints 先例；参数类型收窄为本地最小会话快照面，摆脱 Host 编译对 client-runtime 类型链的依赖）；新增 `tests/test-driver.test.mjs` 4 例（mock timers 定格 50 分钟时间线）：deadline 前 1s 自然完成不抛 / grace 窗口内仍 running 照抛 003 / 从未 running 抛 002 / 快速完成快速返回。
- **归属模块**：Client 执行器 / test-driver（`src/test-driver.ts` 的 `waitAgentTurn` 与 `EFFECT_TEST_CASE_TIMEOUT_MS` 交互；2026-10-05 起落 src/ 根）
- **现象**：R001 跑批中 turn 0 于 20:04:44 发出、20:54:44.167 **自然完成**（`turn/end reason=completed`，耗时 49:59.88s），但执行器在 20:54:44.4 抛 `CS-EFFECT-003`（等待 agent 回合结束超时）→ 11 条机器断言没跑、test-report.md 没写、追加指令回合没发，浮窗报「场景中断」。
- **根因**：`waitAgentTurn`（test-driver.ts:52-68）的返回条件是「见过 running 后**连续 2 次空闲轮询**」（3s 轮询间隔 ≈ 需 6s 空闲尾巴），而 50 分钟 deadline 在 `while` 条件处先到并直接退出循环抛超时——**回合实际耗时只要超过 49:54（标称上限 − 空闲尾巴），即使回合在 deadline 前自然完成也必判超时**；超时与自然完成在边界处没有仲裁。实测证据与时间线数学见 `docs/effect-tests/2026-10-05-R001-山谷晨光-分析报告.md` §一。
- **复现步骤**：浮窗启动《山谷晨光》15s 场景 → 让 turn 0 自然跑到 >49:54 完成必现（本次 49:59.88 实证）。保守复现可临时把 `EFFECT_TEST_CASE_TIMEOUT_MS` 调小（如 10 分钟）跑同场景。
- **修复方案/计划（建议）**：deadline 判定让位于空闲判定——「已见 running」且当次轮询已 idle 时，再给一轮（或两轮）轮询窗口凑满 idleStreak，而不是退出循环抛超时；等价地，把超时语义定义为「回合墙钟 + 空闲尾巴余量（≥10s）」。修后 `tests/` 补边界用例：回合 49:59 自然完成不抛 CS-EFFECT-003。
- **验收标准**：① 自然完成（`turn/end reason=completed`）的回合即使发生在 deadline 前 1s，断言/报告/下一条发送照常执行；② 只有回合真未在预算内结束时才报 CS-EFFECT-003；③ 既有 effect-test-runner 编排行为不变（test-driver 头注的「逐字节不变」约束对 `runEffectTests` 仍然成立，修复只放宽 deadline 边缘的误判）。
- **来源**：2026-10-05 REQ-021 首轮真机跑批（R001·山谷晨光）分析。
---

### BUG-015 — poster-route-qwen 检查点正则大小写与后端产物名不符

- **关联 CV**：（R001 取证）
- **编号**：BUG-015（**本仓自立**）
- **严重度**：一般（断言假红：海报明明走了 Qwen 链路，断言永远 FAIL）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**——`QWEN_TEXT_RENDER_PREFIX` 改 `/^qwen_image_2\.1_/i`（头注写明以后端实际产物名为准，R001 实证小写）；`auto-test-report.ts` 产物索引的 inline 大写正则同源收编为该常量（两份正则迟早漂移）；`tests/auto-test-checkpoints.test.mjs` 补小写产物名命中用例（R001 实测形态 `qwen_image_2.1_00060.png`，`/i` 语义下大写输入同样命中）。
- **归属模块**：Client 检查点库（`src/auto-test-checkpoints.ts` 的 `QWEN_TEXT_RENDER_PREFIX`）
- **现象**：R001 海报终稿（image_fix 产物）filename 为 `qwen_image_2.1_00060.png`（**小写 q**，canvas.json 节点 15811f5b 实证），而 `QWEN_TEXT_RENDER_PREFIX = /^Qwen_image_2\.1_/`（**大写 Q**）永不命中 → `poster-route-qwen` 必然 FAIL，证据还误导为「画布节点中无 Qwen 产物名」。
- **根因**：断言常量按交接文档/设计期的产物名记忆写成大写，未以后端实际产物名对齐；离线重放（`runAutoTestCheckpoints` + 真实 canvas.json）复现。
- **修复方案/计划（建议）**：改为 `/^qwen_image_2\.1_/i`（或按后端实测固定小写），头注写明「以后端实际产物名为准」；`tests/auto-test-checkpoints.test.mjs` 同步补一条小写命中的用例。一行修。
- **验收标准**：以 R001 canvas.json 为重放输入时 `poster-route-qwen` PASS（证据列出 `qwen_image_2.1_00060.png`）；大小写变体（Qwen/qwen）都能命中。
- **来源**：2026-10-05 REQ-021 首轮真机跑批（R001·山谷晨光）分析。
---

### BUG-016 — videos-active 检查点只认 video_generate，与 skill 默认工具策略矛盾

- **关联 CV**：（R001 取证）
- **编号**：BUG-016（**本仓自立**）
- **严重度**：一般（断言口径缺陷：合规行为必红）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**——① 条数统计改 `toolName ∈ {video_generate, video_composite}`，label 同步「全部 active、零 supersededBy、零 retired」；② 加严子项（拍板默认纳入）：composite 镜校验 `generationPrompt.sourceUrls` 中图片扩展名条数 ≥3（R001 的 sourceUrls 混有 audioRefs 并入的 mp3，**按扩展名过滤只数图片**）；③ 理想快照改用 composite 镜（每镜 3 图 + 1 mp3，对齐 skill 默认策略并钉住过滤口径）；变异仍红：2 条镜 / 1 条 supersededBy / composite 图片参考 <3（总 URL 数仍 3，必须按扩展名数出 2）。注：composite 镜暂不进 resolution-tier 档位断言（尺寸语义待 R002 实证，避免误红），视频档位由 compose 成片继续承担。
- **归属模块**：Client 检查点库（`src/auto-test-checkpoints.ts` 的 `videos-active`）
- **现象**：R001 三个镜位全部走 `video_composite`（skill 明文默认：`SKILL.md` 第 9 步「默认 video_composite 多参考 Ref2VA……都不适用才退 video_generate」），且参考组合 ≥3 张、逐镜 5s、六段式 prompt、audioRefs 复用全部合规；但 `videos-active` 的条数统计只认 `toolName === 'video_generate'` → 计 0 条必 FAIL。
- **根因**：断言把「工具名 = video_generate」当成了「镜位视频存在」的判据，与 skill 的工具选择规则（video_composite 优先）口径漂移。注意 BUG-011 回归意图（废弃视频串链、单镜残片）不由工具名承担，改口径后仍由「零 supersededBy」+ `compose-final` 覆盖。
- **修复方案/计划（建议）**：条数统计改为 `toolName ∈ {video_generate, video_composite}`，断言文案同步（「镜位视频 = 3 且全部 active、零 supersededBy、零 retired」）；可选加严：video_composite 镜校验 sourceUrls 图片数 ≥3（Ref2VA 纪律机器化）。`tests/auto-test-checkpoints.test.mjs` 钉住用例同步更新。
- **验收标准**：① R001 canvas.json 重放时 `videos-active` PASS（3 条 video_composite 全计入，零 supersededBy）；② 构造「2 条镜位」或「1 条 supersededBy」的变异输入仍 FAIL（BUG-011 回归意图保留）。
- **来源**：2026-10-05 REQ-021 首轮真机跑批（R001·山谷晨光）分析。
---

### BUG-017 — videos-active「零 supersededBy」与追加指令轮的合法取代链矛盾

- **关联 CV**：（R002 取证）
- **编号**：BUG-017（**本仓自立**）
- **严重度**：一般（断言假红：合规返工必红）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**
- **归属模块**：Client 检查点库（`src/auto-test-checkpoints.ts` 的 `videos-active`）
- **现象**：R002 turn 1 断言 FAIL「视频 5 条，supersededBy 2 条」——追加指令「改孙女形象」后，镜 2/3 视频按 skill 纪律显式 `replaces` 重出，旧版本被取代是取代链的**正确产物**（agent 自报告与盘面逐条核实），「零 supersededBy」在含返工轮的场景里必然误红。
- **根因**：检查点把「无取代发生」当成了不变式。取代链的回归意图本就由「active 计数」+ `compose-final`（来源 ≥3）+ `supersede-chain` 承担，「零 supersededBy」只在纯 turn-0 场景成立。
- **修复方案/落地**：口径改为「**生效（active）镜位视频 = 3、零 retired**」，supersededBy 计数降级为证据展示；composite 图片 ≥3 加严子项只看 active 版本（被取代的旧版不背现行纪律）。单测：取代后 active 仍 3 → 绿；retired → 红；2 条镜 → 红（BUG-011 回归意图保留）。
- **验收标准**：R002 形态回放（3 active + 2 superseded）PASS；R003 全链无此类误红。
- **来源**：2026-10-06 REQ-021 R002 真机复盘。
---

### BUG-018 — supersede-chain「改写残留」误伤取代对新节点的图生图源句柄

- **关联 CV**：（R002 取证）
- **编号**：BUG-018（**本仓自立**）
- **严重度**：一般（断言假红）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**
- **归属模块**：Client 检查点库（`src/auto-test-checkpoints.ts` 的 `supersede-chain`）
- **现象**：R002 turn 1 supersede-chain FAIL，唯一残留证据 = `ref-eb11de7a.png 仍被 430c7594 引用`——430c7594 是取代对（旧孙女定妆图 → 新定妆图）的**新节点**，它以旧图为生成输入（image_generate `filename=旧图` 图生图改妆），generationPrompt 里的旧句柄是生成事实 + 重试保真的依据，不是改写遗漏。
- **根因**：残留扫描把取代对的**新节点自身**也算进 holders。改写链的语义是清洗**下游消费方**的引用，产物自己的生成输入不在其列。
- **修复方案/落地**：holders 扫描排除 `pair.newId`，其余下游照查（R002 其余 3 条链全部干净改写，机制本身不受影响）。单测：新节点保留源句柄 → 绿；下游残留 → 仍红。
- **验收标准**：R002 形态回放 PASS；R003 改写链断言正常判红绿。
- **来源**：2026-10-06 REQ-021 R002 真机复盘。
---

### BUG-019 — 节点 filename 不保证是后端产物名，路由断言/产物索引在句柄型后端上永久假红

- **关联 CV**：routeModel（R002 取证）
- **编号**：BUG-019（**本仓自立**）
- **严重度**：**严重**（验收断言在用户当前后端上不可用，REQ-021 验收被阻塞）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**
- **归属模块**：Client 检查点库 / Host 生成管线（`src/generate.ts`）/ 节点契约（`src/contracts/canvas.ts`）
- **现象**：R002 全部图片节点的 `filename` 是 `ref-*` 上传句柄（视频仍回 `minmax_h3_ref2va_*` 真产物名）→ `poster-route-qwen` / `concept-route-krea2` 假红（证据还误导为「无 Qwen 产物名」），产物索引漏海报行。对照 R001：同一字段当时是产物名（`qwen_image_2.1_00060.png`）。**路由本身没错**——agent 自报告互证海报 Qwen 一步直出、纯文生 Krea2、关键帧带参考走 image2image（R-P1-03 设计内）。
- **根因**：`generate.ts` 节点 filename 直接取**生成响应的 `filename` 字段**，而不同后端对图片端点回的形态不同（产物名 vs 上传句柄）——「从 filename 猜路由」的数据前提跨环境不成立（交接文档挂账的结构化改造项被 R002 证实为必要）。
- **修复方案/落地**：① 节点契约新增 `routeModel`（生成时 routeImageModel 现算的 Drama 端点；图像四分支落盘、重试同步刷新；视频暂不落，路由可从 toolName 读）；② 两路由断言以 `routeModel` 为第一证据、filename 产物名前缀兜底旧画布回放（R001 形态）；③ `concept-route-krea2` 口径随 R-P1-03 收窄为「**纯文生图**走 Krea2」（关键帧带参考走 image2image 是设计内行为）；④ 产物索引海报行同口径。
- **验收标准**：R003 起新画布图像节点带 `routeModel`；R002 形态回放（ref-* filename + routeModel）两断言 PASS；R001 canvas 回放（无 routeModel、filename 产物名）仍 PASS。
- **来源**：2026-10-06 REQ-021 R002 真机复盘。
---

### BUG-020 — 放手跑终态画布平铺废弃节点（历史版本与生效版本混排）

- **关联 CV**：（R002 取证）
- **编号**：BUG-020（**本仓自立**）
- **严重度**：一般（体验缺陷；数据无损）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**（用户拍板方案 a：默认隐藏不删除）
- **归属模块**：Client 画布渲染（`src/client/canvas/CanvasSurface.tsx`）/ 纯函数判定（`src/shot-versions.ts`）
- **现象**：R002 追加指令轮后画布留 7 条灰显废弃节点（全部是显式 `replaces` 的正确取代产物）——取代机制本身是承重墙（合成不串版本 / 参考池不串形象 / 可恢复可审计），但「灰显保留」让终态画布历史版本与生效版本平铺，用户期望「放手跑终态画布只留生效版本」。
- **修复方案/落地**：**纯渲染层隐藏，数据零改动**。`shot-versions.ts` 新增纯函数 `isDeprecatedNode`（supersededBy 或 retired，UI 可见性判定共用同一份实现）；CanvasSurface 渲染 / 连线 / minimap / 镜道 / fit-to-content 统一过滤；画布右下浮层开关「显示废弃节点（N）」（仅确有废弃节点时出现）；图层面板「带进视野」（revealNodes）对废弃节点自动开开关；拖线落点恒不接受废弃节点。恢复旧版 / 血缘 / 审计 / 重试语义全保留。
- **验收标准**：R003 跑完追加指令后画布默认只见生效版本；开关可回显历史版本；图层面板点废弃行能带进视野。
- **来源**：2026-10-06 REQ-021 R002 真机复盘（用户明确拍板）。
---

### BUG-021 — compose_video 工具文案写「多镜拼接环境声一律丢弃」，与实际行为冲突

- **关联 CV**：（R002 取证）
- **编号**：BUG-021（**本仓自立**）
- **严重度**：轻微（文案误导 agent 与用户对听感的解释）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**
- **归属模块**：`src/host-tools.ts`（compose_video description / clipIds 参数文案）
- **现象**：R002 agent 取证：compose 实测回显「音轨 环境声 + BGM」——多镜 concat **保留**各镜原生音轨串接（`compose.ts` 主声轨注释同口径），而工具 description 仍写「多镜拼接一律丢弃」，agent 在自报告里明确建议更新文案。
- **修复方案/落地**：description 与 clipIds 文案改为「各镜原生环境声串接保留；给 BGM 时叠混为环境声 + BGM（BGM 铺底）」。
- **验收标准**：R003 agent 对音轨的解释与实测一致。
- **来源**：2026-10-06 REQ-021 R002 真机复盘（agent 自报告建议）。
---

### BUG-022 — voiceover-consistent 把「首段 instruct 定调 + 后续段 refaudio 克隆」的派生一致判为策略不一致

- **关联 CV**：（R003 取证）
- **编号**：BUG-022（**本仓自立**）
- **严重度**：一般（断言假红；且误判的是一条**更稳**的音色保障策略）
- **状态(资料库)**：—（未入资料库）
- **当前落地状态**：**已修复·桌面验收通过（CV-279 收口）**
- **归属模块**：Client 检查点库（`src/auto-test-checkpoints.ts` 的 `voiceover-consistent`）
- **现象**：R003 两轮断言 FAIL「refaudio 传法不一致：2/3 段传了」。盘面实证：段 1 无 refaudio（instruct_prompt 定音色，产物 `ref-3cb5600f.mp3`），段 2/3 的 refaudio **恰指向段 1 的产物**——音色由构造保证同源，是合法且更稳的「首段定调 + 后续克隆」策略（agent 自报告明确记录该通道首测可用）。
- **根因**：C-5 断言的「同批必须同一策略」（全 refaudio 或全 instruct）没有覆盖**派生一致**形态——refaudio 的值若可追溯为本批某条无 refaudio 段的产物，则一致性是**可证明**的。
- **修复方案/落地**：混合策略分支改为可证明一致判据：① 所有 refaudio 同源（唯一值）；② 该值恰等于某条无 refaudio 段的产物 `filename`（克隆源必须在本批旁白里，外部文件不可证明 → 仍红）；③ 多条无 refaudio 根段时 instruct_prompt 逐字一致。全 refaudio / 全 instruct 两条既有路径不变。单测：R003 形态回放绿 / refaudio 指向外部文件红 / 多根段 instruct 互异红。
- **验收标准**：R003 canvas 离线回放 23/23 全绿（已达成）；R004 真机无此类误红。
- **来源**：2026-10-06 REQ-021 R003 真机复盘。
---

## §二、已终结需求（REQ）

### REQ-001 — 为 App 增加全局资产库页面（角色/场景/物件/群像 + agent @引用）

- **关联 CV**：@ref=CV-114, **CV-255**
- **编号**：REQ-001
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：**已实现** —— 三步全部落地，**2026-09-29 桌面验收通过**（验收①②③逐条过）。Step 1「Host 资产服务」+ Step 3「引用链路」已机器验证；Step 2「Client 资产库页」以 `28b058605e`（Client UI + 上传媒体通道 + 库 GC）+ `539f1218de`（图片显示适配）落地
- **归属模块**：Host 资产服务（`asset-library.ts` / `routes.ts`）/ Client 资产库页面（`AssetLibrary.tsx`）/ `reference-token` + `reference-source`
- **需求描述**：为 App 增加全局资产库页面，下设角色、场景、物件、群像 资产库；在 agent 中通过自然语言或 `@` 符引用该资源，prompt 中修改也要能使用。
- **复现/验证路径**：
  1. 打开 App 资产库页面，应见角色/场景/物件/群像 四分类；
  2. 在对话中 `@` 引用某资产，应插入正确引用；
  3. 修改 prompt 后该引用不丢失，仍可解析。
- **关联代码**：
  - `src/projects.ts:84`、`src/host-config.ts:84`、`src/client/SettingsModal.tsx:633`（「资产库位置」仅指存储路径，无四分类页面）
  - `src/reference-token.ts` + `src/client/reference-source.ts`（CV-114，`@ref[nodeId]` 指向**画布节点**，非独立资产库）
  - `src/asset-capture.ts`（节点资产捕获）
  - **新增（CV-255）**：`src/contracts/asset-library.ts` / `src/asset-library.ts` / `src/asset-library-prompt.ts`（均新）/ `src/routes.ts`（`/canvas-studio/library` 全端点）/ `src/host-tools.ts`（`lib:` 解析 + `list_references.library`）/ `src/errors/catalog.ts`（CS-LIB-001/002/003）/ `src/reference-handle.ts` / `src/client/{reference-source,index,StudioFrame,project-store,api,contracts}.ts`
- **实现方案/计划**：见 [`docs/plans/REQ-001-全局资产库需求方案.md`](./plans/REQ-001-全局资产库需求方案.md)（v1.1，评审通过）。原计划「新增全局资产库页面（四分类），把节点资产注册进资产库；扩展 `@ref` 可引用资产库条目；agent skill 支持自然语言引用资产」拆为三步，执行序 **Step 1 → Step 3 → Step 2**：
  - ✅ **Step 1 Host 资产服务**（已完成）：schema + `AssetLibrary` + `/library` 路由 + 错误码 + client store/API；
  - ✅ **Step 3 引用链路**（已完成）：`lib:` 解析分支（插在 `findNodeByRef` 之前）+ 库媒体三段式物化与 promote + system prompt 库清单小节 + `SKILL.md` lib 纪律 + `@` 菜单「资产库」候选区与 chip 插入 + hover 预览；
  - ✅ **Step 2 Client 资产库页**（已完成，`28b058605e` + `539f1218de`）：`AssetLibrary.tsx` overlay + `csLib*` 令牌 + 四分类导航/搜索/排序/卡片网格/右侧详情抽屉 + 上传图片通道 + `StudioFrame`/`LobbyHero`/`CanvasContextMenu` 入口 + 画布右键「加入资产库」流程；
  - ✅ **联调 + 验收**（2026-09-29 桌面验收通过）：§6.1 逐条过 + 回归（`test:smoke` 1114 · 1109 过，5 条基线红同名）+ `gcLibraryAssets` 已落地。
- **验收标准**：资产库页面四分类可见；`@` 与自然语言均可引用资产；prompt 修改后引用不丢失。（详见方案 §6.1 验收映射；demo 效果图不作验收依据）
- **关联文档**：[`plans/REQ-001-全局资产库需求方案.md`](./plans/REQ-001-全局资产库需求方案.md)（v1.1 蓝图 + §8 实现期硬约束）、`docs/STATUS.md` §4 **CV-255**、`docs/canvas-ux-backlog.md` CV-255 行；`CV-114`(@ref)。**测试**：`tests/{asset-library-store,lib-ref-resolve,library-route,prompt-section,reference}.test.mjs`（4 新 31 例 + reference 扩 6，全量 1094·1089 过、5 条基线红同名）。
- **资料库来源**：需求表 行 1。
---

### REQ-005 — 点击左上角「Canvas Studio」返回首页；项目按改动时间排序

- **资料库别名**：R-P2-02
- **关联 CV**：CV-256, CV-257, CV-259~262
- **编号**：REQ-005
- **优先级**：P2
- **状态(资料库)**：已排期
- **当前落地状态**：**已实现 · 2026-09-30 桌面验收通过**（三段接力：CV-256 首页对话式创建与排序 → CV-257 v1.3 变体 A 形态修复「draft 落点 + 发送拦截认领」→ **CV-259~262 v1.4 首页收尾**：模型座椅槽锚点放回 / draft 落点当月起清扫豁免 + 首个落点强制重绑 / 四类素材暂存条 / 幽灵滚动条 + 规格条单行）。**记账说明**：CV-259~262 此前只在源码注释与测试名里流通，STATUS §4 / backlog 均无条目（「编号在源码流通但 STATUS 无条目」形态），2026-09-30 随本次验收一并补登
- **归属模块**：Client Lobby/首页（`index.ts` / `LobbySpecRow` / `LobbyHero` / `ProjectList`）
- **需求描述**：点击左上角「Canvas Studio」区域需返回首页，每次进入 app 需停留在首页；项目需按改动时间排序，最近的在前。
- **复现/验证路径**：
  1. 进入任意项目后，点击左上角品牌区，应回首页；
  2. 首页项目列表应按最近改动时间倒序。
- **关联代码**（行号为 CV-257 落地后状态，CV-256 段的旧行号部分失效）：
  - **回首页**：`src/client/index.ts`（`syncActiveProject` 顶部 `homePinned` 短路 + `goHome` 内触发 `ensureDraftLanding`）、`src/client/StudioFrame.tsx`（品牌区 `.csBrandHome` 按钮）；品牌区类 `src/client/styles.ts`（`.csLobbyBrand`）
  - **首页对话式创建（v1.3 变体 A）**：落点 = `ensureDraftLanding`/`maybeDraftLanding`（`src/client/index.ts`）+ Host 端 `ensureDraftDir`/`createClaimingDir`/`sweepUnclaimedDraftDirs`（`src/projects.ts`）+ `POST /canvas-studio/draft-landing` 与认领分支（`src/routes.ts`）；发送拦截 = DivertConversation wrapper 的 lobby 分支（`claimAndSend`，认领 → select → divertSend 放行，失败 error 保草稿）；规格行 = `src/client/LobbySpecRow.tsx`（挂 `conversation.input.dock`，草稿 `store.lobbySpec`）；自动命名 `src/project-naming.ts`；`LobbyComposer.tsx` 已删除
  - **v1.4 新增（CV-259~262）**：`src/client/lobby-stash.ts`（新，暂存的文件侧：登记 + 四类限额 + `File` 句柄表）、`LobbyStashBar.tsx`（新，暂存条，挂 `conversation.input.dock` 且在规格行之后）、`LobbyHero.tsx`（「添加素材」入口）；`src/client/styles.ts`（CV-259 槽锚点白名单 + CV-262 幽灵滚动条与规格条宽度账）；`src/projects.ts`（CV-260 `sweepUnclaimedDraftDirs` 当月豁免）；`src/client/index.ts`（CV-260 `landedThisRun` 首个落点强制重绑、CV-261 暂存落地 → `@ref` 进正文）
  - **排序**：`src/project-sections.ts`（`byUpdatedAtDesc` + `resolveVisibleSections` 桶内倒序，唯一收口）；行副行时间读 `src/project-row.ts`（`updatedAt` 相对时间）
  - **`updatedAt` 写入**：`src/projects.ts`（create / createClaimingDir / `moveProjectToGroup` / `touchProject` / 工作流 / 待答问题）；链路 `src/routes.ts`（`POST /canvas-studio/projects/touch`）→ `src/client/api.ts` → `openProject` 成功路径 fire-and-forget + `src/client/project-store.ts`（本地顶一格）
- **实现方案/计划**：见 [`docs/plans/REQ-005-首页对话式创建与项目排序方案.md`](./plans/REQ-005-首页对话式创建与项目排序方案.md)（**v1.3 已按其 §13.5 定稿全量落地，编号 CV-257**；CV-256 为 v1.1–v1.2 首轮落地）。首页形态：宿主对话卡为基底（draft 落点 + 发送拦截认领，变体 A），规格行内嵌宿主槽（分组砍掉），宿主两下拉 CSS 隐藏，素材走宿主附件链路（画布 drop 补合成 dragend 修遮罩卡死）。偏差与真机确认清单见方案 **§13.6**。**v1.4 首页收尾（CV-259~262，2026-09-29 落代码 / 2026-09-30 补登并验收通过）**：① **CV-259** 真机确认项③应验 —— hero 态确有**第三枚** `button[aria-haspopup="menu"]`（宿主输入栏尾部的模型座椅 `conversation.input.model`），被「隐藏两个下拉」的通用规则一并吃掉（现象：首页没有模型选择）⇒ 按稳定槽锚 `[data-slot="conversation.input.model"]` 白名单放回；② **CV-260** 启动清扫豁免**当月** draft 目录（含 `-2/-3` 顺延名）+ 首个落点强制重绑（会话被踢出 workspace membership 后幂等短路救不回来）；③ **CV-261** 首页四类素材**暂存**（发送前只展示不上传、四类限额在拖入那一刻就判、认领为项目后落卡并把 `@ref` 追加进正文）；④ **CV-262** 对话卡右缘「幽灵滚动条」两条来路一起收 + 规格条真机折行宽度账重算（需 669 / 可用 726）。
- **验收标准**：点击 Canvas Studio 回首页；项目按最近改动倒序（坏时间戳垫底）；首页描述创意 → 宿主发送 → draft 目录认领为项目（规格入 plan、摘要命名）→ 首条消息进会话 → 自动进 work，认领失败宿主保草稿；左栏两个「+」均跳首页。**v1.3 追加 A8–A10**（首页 = 品牌条 + 宿主对话卡无两下拉 + 卡上方规格行无分组；发送即建项目落规格；首页与画布的素材拖放遮罩松手即消失）—— 见方案 §13.4。
- **关联文档**：`docs/STATUS.md` §4 CV-256 / CV-257 / **CV-259~262**、§8 变更记录 2026-09-30（补登 + 验收行）、`docs/canvas-ux-backlog.md` CV-256；测试 `tests/lobby-claim.test.mjs`（新增）、`tests/project-naming.test.mjs`、`tests/project-sections.test.mjs`、`tests/projects-touch.test.mjs`（另 `tests/projects-dir.test.mjs`、`tests/projects-registry-merge.test.mjs` 覆盖注册表本身）；**v1.4 追加**：`tests/lobby-stash.test.mjs`（新增 8 例）、`tests/visual-tokens.test.mjs`（CV-259 / CV-262 守卫）、`tests/projects-dir.test.mjs` + `tests/lobby-claim.test.mjs`（CV-260 豁免与强制重绑）、`tests/media-drop.test.mjs`（首页全接管）。
- **遗留体验项（2026-10-05 登记，REQ-021 R001 复盘挂入）**：首页认领项目目录名沿用 `.draft-` 铸名（认领**不改名**保宿主 workspace/会话，`createClaimingDir` 的设计产物）——正式项目目录隐藏（点前缀在 macOS Finder 默认不可见）、目录名无语义、备份工具可能跳过点目录。改进方向：认领后安全改名 + 宿主 workspace/会话 rebind（前置：调研宿主 rebind 能力；CV-260 事故面，需契约测试兜底）。**零风险替代已落地（2026-10-05）**：设置页诊断区「存储目录」信息块（`GET /canvas-studio/storage-info` 只读路由 + 项目名称→目录名对照 + 复制路径 + `.draft-*` 备份指引文案）。
- **资料库来源**：需求表 行 5。
---

### REQ-006 — 安装包太大，建议评估 tauri 模式与官方 desktop 版

- **资料库别名**：R-P1-04
- **关联 CV**：CV-201, B1
- **编号**：REQ-006
- **优先级**：P1
- **状态(资料库)**：已排期
- **当前落地状态**：已拍板（维持 Electron universal 单包，CV-201 落地；tauri 未采纳）
- **归属模块**：打包 / Electron（`CV-201` / `bundled-ffmpeg` 方案）
- **需求描述**：安装包太大，建议评估 tauri 的模式和官方 desktop 版。
- **复现/验证路径**：
  1. 打包后查看体积；
  2. 评估是否可转 tauri / 官方 desktop 版。
- **关联代码**：
  - `docs/archive/plans/bundled-ffmpeg.md`（含双架构 DMG 方案 B 评估，标注「量大，暂不动」）
  - `docs/STATUS.md:486` 决策点 **B1**
- **实现方案/计划**：2026-09-17 拍板 **A 维持 universal 单包**，由 **CV-201** 落地；实测未压缩合计 118 MiB（arm64 43 + x64 75）。tauri 未采纳；远期走 ffmpeg 精简（方案 C）。
- **验收标准**：包体在可接受范围，有明确优化路径（ffmpeg 精简）。
- **关联文档**：`docs/STATUS.md`(CV-201, B1)；测试 `tests/ffmpeg-bundled.test.mjs`。
- **资料库来源**：需求表 行 6。
---

### REQ-007 — agent 任务更新有 bug，模型上下文长度显示有问题，升级 dsh

- **资料库别名**：R-P0-04
- **关联 CV**：—
- **编号**：REQ-007
- **优先级**：P0
- **状态(资料库)**：待评审
- **当前落地状态**：**已拍板（2026-09-29）——暂缓升级，等 DSH stable 发布后再升级；升级可行性评估已完成**（见下）
- **归属模块**：DSH 宿主（deepseek-harness-desktop，非本插件仓）
- **需求描述**：agent 任务更新有 bug，模型上下文长度显示有问题。升级 dsh。
- **复现/验证路径**：
  1. 在 DSH 桌面端观察 agent 任务更新是否异常；
  2. 检查模型上下文长度显示是否正确。
- **关联代码**：
  - `src/client/contracts.ts:99`（「披露的最大上下文窗口」字段定义，仅契约声明）
  - `src/client/index.ts`（conversation 服务调用）
  - 本仓**无** task-update bug 修复或上下文长度显示逻辑
- **实现方案/计划**（2026-09-29 升级评估结论，产品拍板暂缓升级）：
  - **原始项目现状**（[anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop)，本仓为其 2.0.4 fork）：Stable/Beta/NEXT 均在 v2.0.15，内置内核 `v0.1.7-rc.2`（其发布说明明确标注「仍为上游候选发布版本」）。**DSH 内核至今无 stable**（npm 最新 `0.2.0-rc.1`）。
  - **两个 bug 均未被原项目解决**，对应 open issue：[#417 任务清单状态不实时更新](https://github.com/anywhere-labs/dsh-desktop/issues/417)、[#704 上下文长度设置](https://github.com/anywhere-labs/dsh-desktop/issues/704)（锁死 262K）、[#1225 前台命令误报后台任务完成](https://github.com/anywhere-labs/dsh-desktop/issues/1225)（2.0.15 上仍复现）。
  - **升级评估要点**（内核 0.1.1-rc.2 → 0.2.0-rc.1，跨 7136 commits）：① 上游在 0.1.5~0.1.6 间做过包重构，5 个 npm 包消失（`dsh-client-runtime`/`dsh-agent-presets`/`dsh-code-runtime`/`dsh-host-apiproxy`/`dsh-settings-file`），0.1.7-rc.2 同样缺失，折中升级路线不成立；② 本仓 15 个 dsh 补丁在 0.2.0-rc.1 上 dry-run 存活率 6/15，9 个需重做/作废（`dsh-client-runtime`、`dsh-client-ui-trajectory`、`dsh-llm-deepseek`、`dsh-subprocess-local`、`dsh` 主包、`dsh-sandbox-windows-acl` 全失效，`dsh-client-ui-settings-models`、`dsh-token-meter` 部分失效）；③ `dsh-plugin-desktop` 受影响 import 约 15 处，多为 type-only，风险低。
  - **将来升级的降险路径**：原项目 v2.0.14 已一步跨过同一包重构（0.1.5-rc.2 → 0.1.7-rc.1），升级时优先 merge 原项目 2.0.4→2.0.15 的改动作参考，而非从零 rebase 补丁。
  - **升级前过渡选项**：若 bug 症状明确且急需，可按 `dsh-token-meter` 补丁先例对 0.1.1-rc.2 做针对性 cherry-pick（上游已合并 `fix/task-manager-detail-close-race` #5339 等）；前提是先明确两个 bug 在本产品的具体症状。
  - **不要在本仓改 agent 对话/task 更新逻辑**（deepseek-harness submodule 保持 pinned 原样）。
- **验收标准**：升级 DSH 后任务更新无 bug、上下文长度显示正确。
- **关联文档**：无本仓 CV；属 DSH 仓条目。原项目 releases：https://github.com/anywhere-labs/deepseek-harness-desktop/releases
- **资料库来源**：需求表 行 7。
---

### REQ-008 — agent 对话流改造（少废话 / tools 调用中文显示）

- **资料库别名**：R-P0-05
- **关联 CV**：CV-263, CV-264
- **编号**：REQ-008
- **优先级**：P0
- **状态(资料库)**：待评审
- **当前落地状态**：**已实现 · 2026-09-30 桌面验收通过**（CV-263 对话流中文 tool 显示与降噪 + **CV-264 验收反馈三连修**）—— 三档中文行 keyed 接管（A 展示级 13 / B 流程级 13 / C 内部级 16），`cordis_define`·`todo_write` 保留上游行；方案 v1.1（评审修订：上游 12 keyed 键全量实证、统一 priority -1、历史别名参与注册、取消态中性化）。**CV-264**：① `irMode` 显式声明参数退役 —— 「写 IR 时建议声明」的引导会让模型对多参考图直觉申报 Ref2VA，与按素材数量的端点路由必然相撞（`CS-H3IR-005` 失败类根治），模式推断回归唯一事实源，位次写错仍被 `CS-H3IR-001` 硬拦，args 兼容保留 `irMode→declaredMode` 透传；② A/B 档 error/stopped 态整行可点开读**完整错误**（键盘可达，验收反馈：报错首行被截成 `(mod…`）；③ 项目列表口径定稿 —— 排序/行内时间保持 `updatedAt`，删掉「打开即 touch」整条链路（纯浏览不再顶格），改由 `writeCanvas` 落盘时尽力而为刷 `touchUpdatedAt`
- **归属模块**：Client 对话流（`tool.call.toolview` keyed 槽接管，不动 DSH）/ `tool-presentation.ts` 唯一口径
- **需求描述**：agent 对话流需要改造。目前废话显示太多，tools 调用应该更直观，比如中文显示「生成xxx图」「生成xxx分镜视频」。一些其他 tools 调用都可省略不显示。用户需要看到跟项目最相关的生成信息，且默认用户不懂 agent harness。
- **复现/验证路径**：
  1. 生成图 → 对话流显示「生成图像 · 竹林月夜…」，不再出现 `Tool call · image_generate · {json}`；
  2. 生成分镜视频 → 「视频生成 · … · 8s」，运行中带扫光进行态；
  3. read/bash/grep/skill → 极简灰字「读取文件 · storyboard.md」，点开见参数与结果；失败红字可见；取消中性灰；
  4. 含旧工具名（compose/upload 等）的历史会话同样显示中文行。
- **关联代码**：
  - `src/tool-presentation.ts`（唯一文案口径：三档表 + 摘要 + 状态 + 耗时 + labelOfTool）
  - `src/client/ToolCallRow.tsx`（三档行组件，keyed 槽接管渲染器）
  - `src/client/index.ts`（slots facade 逐 key priority -1 注册）
  - `src/asset-history.ts`（labelOfTool 薄转出，消灭双口径）
- **实现方案/计划**：[plans/REQ-008-对话流中文tool显示与降噪方案.md](./plans/REQ-008-对话流中文tool显示与降噪方案.md)（v1.1）+ 效果图 [plans/REQ-008-tool-rows-mockup.html](./plans/REQ-008-tool-rows-mockup.html)
- **验收标准**：用户看到中文、与项目相关的生成进展；废话/次要 tool 调用省略为弱化行或极简行；失败行任何档位永不隐藏。
- **关联文档**：`docs/STATUS.md` §4 CV-263 / **CV-264**、§8 变更记录 2026-09-29 / 2026-09-30；测试 `tests/tool-presentation.test.mjs`（12 例）、`tests/host-boundary.test.mjs`（`tool.call.toolview` 槽登记）、`tests/projects-touch.test.mjs`（CV-264 重写为 6 例新语义守卫）。
- **资料库来源**：需求表 行 8。
---

### REQ-009 — 支持拖拽文本作为剧本

- **资料库别名**：R-P0-06
- **关联 CV**：CV-241
- **编号**：REQ-009
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：已实现（CV-241，**2026-09-29 桌面验收通过**）
- **归属模块**：Host/Client 上传（`routes.ts` / `project-store` / `CanvasNode`）
- **需求描述**：支持拖拽文本作为剧本。
- **复现/验证路径**：
  1. 拖拽一个 .txt 文件到画布；
  2. 应落为一个文本资产节点（kind=text）并可在对话中引用。
- **关联代码**：
  - CV-241 四类文件统一上传：`classifyFile()` 按扩展名分类，纯文本 `handleUploadText → addTextAssetNode`
  - 涉及 `StudioFrame.tsx` / `project-store.ts` / `api.ts` / `routes.ts` / `CanvasNode.tsx` / `NodeDetailDrawer.tsx`
  - 测试 `tests/media-drop.test.mjs`（CV-241 Step 3 验证拖放分发唯一、文字落卡）
- **实现方案/计划**：文本拖入落为文本资产节点已支持。若需求要的是「直接当剧本喂给 agent 走 script_review 流程」，需额外把文本节点接入 script_review 入口（当前是文本资产节点）。
- **验收标准**：拖拽文本落画布为可引用文本节点；如产品要求则能喂给剧本流程。
- **关联文档**：`docs/plans/四类文件统一上传改造方案.md`、`docs/README.md:33`(CV-241 已实施)；测试 `tests/media-drop.test.mjs`。
- **资料库来源**：需求表 行 9。
---

### REQ-015 — 技能文档分辨率口径失真修正（drama 档位）

- **关联 CV**：C-8 批 + 批 A
- **编号**：REQ-015
- **优先级**：P2
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**已销项（2026-10-03 C-8 批）** —— toolchain.md 已随 C-8 批重写（drama 按档 megapixels），本批补修 `docs/canvas-studio-tools.md` 残留行。**2026-10-05 复核**：`toolchain.md` 全文已无「仅 fal 生效 / drama 固定 0.4」类表述；`canvas-studio-tools.md` 的 `resolution` 行已是三档 480p/736p/2k + 「两家供应商都按档生效」；`api.md` 口径本就正确（保留删除线历史）。验收标准已满足。
- **归属模块**：技能文档（`skills/canvas-studio-creation/references/toolchain.md`）
- **需求描述**：toolchain.md「视频生成参数现状」的 `resolution` 行写「**生效范围仅 fal 按档生效；drama 供应商暂不消费该档位（固定 0.4 MP）**」——与代码矛盾：`src/providers/drama.ts:171` 起按档发 `megapixels`（`MEGAPIXELS_BY_RESOLUTION`，CV-190a），`docs/api.md` 视频生成参数现状表也写「CV-190a 起 drama 与 fal 均按档生效（0.4 / 0.9 / 2.0）」。失真后果：模型读 toolchain 后会认为「drama 下传 resolution 没用」，可能替用户放弃档位选择。
- **复现/验证路径**：
  1. 读 toolchain.md「视频生成参数现状」resolution 行（写 drama 不消费）；
  2. 对照 `src/providers/drama.ts:171` 与 `docs/api.md` 视频参数表（均按档生效）。
- **关联代码**：`src/providers/drama.ts:171`（`MEGAPIXELS_BY_RESOLUTION[req.resolution]`，body 携带 megapixels）；`docs/api.md`「视频生成参数现状」表（口径正确）；`skills/canvas-studio-creation/references/toolchain.md`（口径失真处）。
- **实现方案/计划**：把 toolchain.md resolution 行的「生效范围仅 fal；drama 固定 0.4MP」改写为与 api.md 同口径（drama 按档发 megapixels 0.4 / 0.9 / 2.0；「后端是否真按 0.9/2.0 MP 出高清未证实」的保留意见保留）。顺手全文 grep「暂不消费该档位 / 固定 0.4」防第二处。
- **验收标准**：toolchain 与 api.md、代码三方口径一致；grep 无「drama 固定 0.4」类残留。
- **关联文档**：`docs/api.md` 视频生成参数现状表；CV-190a（落地点）。无测试（纯文档）。
- **来源**：2026-09-30 工具调用条件审计（CV-270 清淤时遗漏）。
---

### REQ-021 — 应用内一键测试模式（「代驾」回归）

- **归属模块**：Client 编排 / 检查点库 / Host 路由
- **关联 CV**：**CV-279**
- **编号**：REQ-021（2026-10-05 用户讨论立项，设计当日拍板，建议本号入册）
- **优先级**：P1 ｜ **状态(资料库)**：—（未入资料库需求表，用户讨论直接立项）
- **当前落地状态**：**已完成（2026-10-06 桌面验收通过，CV-279 收口；验收七条全部满足，三轮真机跑批修复总账 BUG-014~022 九条全过）**
- **需求描述**：给 app 加一个「测试模式」：设置开关打开 → 界面出现「▶ 自动测试」浮窗 → 点开始后 app 自己扮演用户——创建项目、发送剧本对话、等 agent 干活、跑完对**持久化产物**做机器断言、生成自包含评估报告 `test-report.md`。固定场景可反复执行形成回归；内容质量（逐字正确 / 节奏 / 美感）由人工或外部大模型评估——自动化只负责「驱动 + 客观检查点」。
- **拍板四条（2026-10-05，勿重新讨论）**：① 测试项目命名沿用 `效果验证-R#` 前缀（吃既有启动清扫）；② 机器断言报告落在**测试项目目录内**（`test-report.md`）；③ 首个固定场景 = 《山谷晨光》15s 版（剧本原文逐字内嵌）；④ 设置开关**只控制按钮可见**，无定时/自动触发。
- **被否方案备忘**：沙箱第二实例 / 外部 Playwright / headless 编排 / 定时触发（设计文档 §一、§六）。
- **实现要点**：
  - `src/client/test-driver.ts`：`waitSessionBound` / `waitAgentTurn` / 轮询与超时常量从 client/index.ts 抽出的**唯一**回合空闲判据实现——`runEffectTests`（effect-test-runner skill 驱动器）与场景执行器共用，既有 effect-test 流程零回归（全量 smoke 原样绿）。
  - `src/auto-test-checkpoints.ts`（src/ 根，node:test 直连）：12 条纯函数检查点（项目命名 / 分镜卡=3 / 关键帧挂卡 / **视频=3 且零 supersededBy（BUG-011 回归）** / 海报走 Qwen（R-P1-03）/ 概念图走 Krea2 / 档位尺寸（C-8，对照 `output-size.ts`）/ 队列 settled / 产物登记下限 / 旁白 refaudio 同源（C-5）/ 成片来源 ≥3（M-3 侧证）/ 取代改写链（批F））。路由断言用节点 `filename`（后端产物名）——history 的 `file` 是磁盘 uuid 名，不含路由信息。
  - `src/auto-test-scenarios.ts`：场景版本化（改剧本 = 新 id），剧本逐字内嵌 + 按回合分组检查点 + `scenarioCheckpointErrors` 完整性守卫（引用漂移 fail-fast）。
  - `src/output-size.ts`：`OUTPUT_SIZE` / `MEGAPIXELS_BY_RESOLUTION` 从 config.ts 抽出（config 顶部有 `node:crypto`，客户端 bundle 与单测拖不动），config.ts 再出口保持既有 import 路径不变。
  - 场景执行器（client/index.ts `runAutoTestScenario`）：建项目（放手跑随创建落盘）→ 逐条发送 → waitAgentTurn（上限沿用 50 分钟）→ 拉**持久化快照**（loadStudioCanvas / getStudioAssetHistory / fetchStudioGenerateQueue，不碰会话流）→ 断言 → 每轮后 `buildAutoTestReport` 覆盖写报告。停止 = 取消当前回合 + 回合之间落停。
  - `POST /canvas-studio/test-report`（routes.ts）+ `api.saveTestReport`：校验项目存在后覆盖写 `<projectDir>/test-report.md`。
  - `autoTest` 独立 store 切片（不动有既有消费者的 `effectTest`）；`testMode` 设置项（默认关）+ SettingsModal 诊断分区开关；`AutoTestPanel` 浮窗挂 StudioFrame 根部（首页/项目态共用），清理按钮沿用 `deleteStudioProject` 删除语义（含有内容的也删——启动清扫只回收空项目）。
- **验证路径（无头，已过）**：typecheck / build / verify:loader / test:smoke 全绿（失败 0、基线名单外新增 0）；`tests/auto-test-checkpoints.test.mjs` 16 条——理想快照全绿 + 反向变异逐条可红（supersededBy / 路由前缀 / 越档尺寸 / 队列未清 / 音色漂移 / 单镜残片 / 旧句柄残留）+ 场景完整性 + 注册表契约。
- **验收标准（设计文档 §八，桌面，待验收方执行）**：① 开关关 → 无浮窗；② 开 → 浮窗出现；③ 跑《山谷晨光》15s → 项目创建、放手跑全链、12 条断言逐条出结果、`test-report.md` 落在测试项目目录；④ 追加指令触发改写链且断言通过；⑤ 清理按钮删净 `效果验证-` 项目；⑥ 关开关浮窗消失；⑦ 全程真实项目列表除测试项目外无新增/修改。跑完把测试项目目录与会话交给验收方做产物级复核（同揽月湾复盘方式）。
- **关联代码**：`src/client/test-driver.ts`、`src/client/AutoTestPanel.tsx`、`src/client/index.ts`（runAutoTestScenario / stopAutoTest / cleanupTestProjects）、`src/auto-test-checkpoints.ts`、`src/auto-test-scenarios.ts`、`src/auto-test-report.ts`、`src/output-size.ts`、`src/routes.ts`（test-report）、`src/client/api.ts`（saveTestReport）、`src/client/project-store.ts`（autoTest 切片）、`src/host-config.ts` + `src/client/SettingsModal.tsx`（testMode）。
- **实现偏差说明（2 处，均记录于代码注释）**：① 检查点/场景/报告三个纯函数模块落 `src/` 根而非设计文档字面的 `src/client/`——客户端打成单包，node:test 无法直连，沿用 `project-naming.ts` 先例；② 设计文档检查点 1 写「目录名带秒（E-3）」，实际 E-3 按秒铸造只作用于首页 draft 落点目录，常规项目目录 = sanitize 项目名（`projects.ts` uniqueDirName），检查点按可核对口径断言 name/dir 对应。
- **首轮真机跑批（R001·山谷晨光，2026-10-05 晚，分析报告 `docs/effect-tests/2026-10-05-R001-山谷晨光-分析报告.md`）**：
  - turn 0 全链 49:59.88s **自然完成**（30 节点、3 条 video_composite 全 settled、成片 15.51s、海报 Qwen 链 + image_fix 兜底）；但回合结束落进 `waitAgentTurn` 超时边界（50:00 上限 − ≈6s 空闲尾巴判定），**假超时 CS-EFFECT-003**（**BUG-014**，S1）把断言/报告/追加指令发送整体跳过。
  - 断言离线重放（lib 直连 + 磁盘持久化快照）**9 PASS / 2 FAIL**，两个 FAIL 均为断言库自身问题：`QWEN_TEXT_RENDER_PREFIX` 大小写与后端产物名 `qwen_image_2.1_*` 不符（**BUG-015**）；`videos-active` 只认 video_generate 与 skill「默认 video_composite」策略矛盾（**BUG-016**，P0-b 归因结论 = 改断言口径）。**被测链路真红 0，后端抖动 0**。
  - 追加指令回合（改孙女形象）**从未发送**（会话转录实证：全场 1 turn、3 条 user/message）——`supersede-chain` 状态为「未执行」而非失败；画布上唯一的取代链是海报逐字修复（image_fix + replaces）。
  - test-report.md 未落盘（BUG-014 后果）；已从磁盘状态离线补写到测试项目目录（文件头标注「离线补写，非运行时产物」，仅覆盖 turn 0、queue-settled 后验形式通过）。
  - 验收七条本轮不可判，**修复 BUG-014/015/016 后重跑 R002 再逐条判定**；STATUS 铁律不登记。
- **首轮修复与配套（2026-10-05 晚，R001 分析拍板批，STATUS 不登记）**：
  - **BUG-014（S1）**：`waitAgentTurn` deadline 让位空闲判定——预算到点时只要见过 running，允许再轮询至多 2 次凑满「连续 2 次空闲」（超时语义 = 回合墙钟 + 空闲尾巴余量）；从未 running 仍 CS-EFFECT-002、真未结束才 CS-EFFECT-003；`runEffectTests` 编排零改动。`test-driver.ts` 挪至 `src/` 根供单测直连（参数类型收窄为本地最小会话快照面，摆脱 Host 编译对 client-runtime 类型链的依赖）；`tests/test-driver.test.mjs` 4 例（mock timers 定格 50 分钟时间线）。
  - **BUG-015/016**：Qwen 正则改 `/^qwen_image_2\.1_/i`（报告产物索引 inline 正则同源收编）；`videos-active` 认 video_generate **与** video_composite，composite 镜加严 `sourceUrls` 图片扩展名 ≥3（R001 的 sourceUrls 混有 audioRefs 并入的 mp3，按扩展名过滤）；理想快照改 composite 镜（3 图 + 1 mp3）钉住过滤口径；变异（2 条镜 / supersededBy / 图片 <3）仍红。composite 镜暂不进 resolution-tier（尺寸语义待 R002 实证），视频档位由 compose 成片承担。
  - **浮窗执行日志落盘（P0-a）**：`AutoTestReportInput.logs` + `buildAutoTestReport` 输出「执行日志（浮窗留痕）」节（UTC 时钟 + fail 行标注，文本自带 [FAIL] 不重复标）；执行器把 appendLog 累积日志随报告写入——**排障不再依赖去翻会话转录**（`tests/auto-test-report.test.mjs`）。
  - **存储目录可见化（方案 B，零风险替代）**：只读路由 `GET /canvas-studio/storage-info`（`src/storage-info.ts` 快照：readdir + registry 组装，目录缺失按零堆积降级）+ 设置页诊断区「存储目录」信息块（存储根 / draft 堆积空 X 非空 Y / 项目名称→目录名对照 / 每行复制路径（复用 clipboard-copy）/ `.draft-*` 备份指引固定文案）。Finder 原生「在 Finder 中显示」**确认不存在宿主能力，不做**。
  - **draft 清扫窗口收窄（用户口径「尽量缩短到一周之内」）**：当月豁免 → **目录龄 < 7 天**（E-3 铸名 `.draft-<yyyyMM>-<ddHHmmss>` 解析创建时刻，老格式名/顺延名解析失败退 `stat.mtime`）+ **本运行 `activeDraft` 恒豁免**（CV-260 事故直接因的实例态精准覆盖）；claimed / 非空两道闸不动——已认领与非空 draft 永不清理。行为级用例 `tests/projects-dir.test.mjs`（8 天回收 / 6 天保留 / activeDraft 豁免 / 认领双闸 / mtime 回退）；`tests/lobby-claim.test.mjs` CV-260 源码守卫同步改写为新机制形态。
  - **REQ-005 遗留项挂入**：认领不改名的 `.draft-` 目录可见性缺口登记为 REQ-005 遗留体验项（见 REQ-005 条目），零风险替代即本批存储信息块。
- **第二轮真机跑批（R002·修复后重跑，2026-10-06 晨，用户真机执行，存储根 `~/Desktop/job/VideoOut/newOut1`）**：
  - **BUG-014 修复真机实证**：执行器两轮完整跑通——turn 0 41m42s + turn 1 17m00s，断言/报告/执行日志全程落盘、追加指令正常发送；后端 Drama 5 任务全 settled、产物历史 26 条 0 删除、0 提问 0 门禁拦截。**BUG-016 turn 0 实证通过**（3 条 video_composite 全计入、零取代）。app 内项目名仍为 `效果验证-R001`（轮次号按存储根内项目计数，新根无历史轮次）。
  - 机器断言 4 红全部为断言库/数据前提问题（→ BUG-017/018/019），**被测链路零真红零失败**；agent 按 skill 纪律自写《效果测试报告.md》（R001 + R001-steer1 两轮记录，与机器报告互证，并主动取证 BUG-021 文案冲突）。
  - R002 关键新事实：该后端图片端点回 `ref-*` 句柄形态的 filename（R001 后端回产物名）→ 结构化路由字段从「挂账改进项」转为必要项（BUG-019）。
- **R002 复盘修复批（2026-10-06，R003 验收前置，STATUS 铁律不登记）**：
  - **BUG-017**：`videos-active` 口径改「生效视频 = 3、零 retired」，supersededBy 降为证据（追加指令轮的合法取代不再误红）。
  - **BUG-018**：`supersede-chain` 残留扫描豁免取代对**新节点自身**的图生图源句柄（生成输入 ≠ 改写遗漏），其余下游照查。
  - **BUG-019**：节点契约新增 `routeModel`（generateAsset 图像分支落盘路由端点，重试同步刷新）；两路由断言以 routeModel 为第一证据、filename 产物名兜底旧画布；`concept-route-krea2` 口径收窄为「纯文生图走 Krea2」；产物索引海报行同口径。
  - **BUG-020（用户拍板方案 a：隐藏不删除）**：画布默认隐藏废弃节点（`isDeprecatedNode` 纯函数 + CanvasSurface 渲染/连线/fit 统一过滤 + 右下「显示废弃节点（N）」开关 + 图层面板 revealNodes 自动开开关 + 拖线落点恒拒废弃节点）——取代机制一条不动，数据零改动。
  - **BUG-021**：compose_video 文案对齐实测（各镜环境声串接保留；BGM 叠混铺底）。
- **第三轮真机跑批（R003·修复批后重跑，2026-10-06 午，用户真机执行，项目名 效果验证-R002-山谷晨光）**：
  - **机器断言 21/23 PASS**；**BUG-017/018/019/021 全部真机实证**：videos-active 新口径正确判绿（生效 3 + 历史取代 3）、supersede-chain 6 链零误报、routeModel 结构化证据全线落盘（断言证据直接列 route=端点、产物索引海报行恢复）、agent 对音轨解释与实测一致。被测链路零真红零失败（Drama 6 任务全 settled、无一次重试）。
  - **唯一红 = BUG-022（新）**：agent 首次实测走通「首段 instruct 定调 + 后续段 refaudio 克隆其产物」的派生一致策略（盘面实证段 2/3 的 refaudio = 段 1 产物 `ref-3cb5600f.mp3`），检查点「同批同一策略」规则误判——**音色由构造保证，比三段各写 instruct 更稳**。
  - **修复（BUG-022，2026-10-06）**：混合策略分支改为**可证明一致**判据（refaudio 全同源 + 恰指向本批某无 refaudio 段的产物 + 多根段 instruct 逐字一致；外部文件不可证明仍红）；**R003 canvas 离线回放 23/23 全绿**（已验证）。
  - **验收七条判定**：③④⑦ 机器证据满足（全链报告落盘 / 改写链断言通过且 10 条取代全正确 / projects.json 仅新增测试项目）；①②⑤⑥ 用户确认（2026-10-06）—— **验收七条全部满足，REQ-021 收口（CV-279）**；R004 终验跑批进行中作为回归佐证。
  - 附加观察：agent 主动同步海报到新形象（R002 留人工，本轮纪律执行更完整）；IR 简报落盘 brief-shot1/2/3.txt 且官方校验器 3/3 PASS；时间轴审计 15.51s vs 15.00s（帧量化已知漂移）；qc_shot 按 auto 规则跳过（断言化列入 v2 候选）。
- **REQ-021 v2 规划（2026-10-05 登记，不实现，待排期）**：
  - 检查点参数化：`storyboard-cards === 3` / `videos-active` 期望 3 条 / `history-volume` 下限（2 定妆 + 3 关键帧 + 3 视频 + …）均为硬编码，需把期望值挪进场景定义，才能支撑多场景复用同一断言库。
  - 成片时长断言：`duration` ±0.6s（H3 帧量化容差，对齐 CV-140 真实时长探测口径）。
  - chain 衔接镜覆盖：`shotTransition=chain` 的末帧提取 → 下镜首参考（衔接纪律机器化）。
  - 场景变体**待用户拍板**：10s×2 镜冒烟 vs 20s×4~5 镜合并压测——后者必须先修 BUG-014（4~5 镜总时长会顶破 50min 旧上限；本批修复后已可行，选型仍未拍板）。
  - 挂改进项→**已拉前落地（2026-10-06，BUG-019）**：路由断言结构化改造（Host 生成时持久化 `routeModel` 路由字段，替代从产物名 filename 猜——R002 实证 filename 形态跨后端不一，为 BUG-015 的结构性根因）。
- **来源**：2026-10-05 用户讨论；设计文档 `docs/plans/应用内一键测试模式设计.md` v1.0（commit 5febc891fb）；2026-10-05 D1/D2/D3 落地。
---

