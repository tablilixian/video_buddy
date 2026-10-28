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

### BUG-046 ｜ 未按分镜编排、视频条数过多（别名 C-16 · 严重 · 资料：新建/1.0.1）

- **严重度**：严重
- **状态(资料库)**：新建
- **资料库别名**：C-16
- **当前落地状态**：**已修复·桌面验收通过（2026-10-13 收口，与 REQ-024 同批）**（2026-10-02 批 2 编排纪律）
- **归属模块**：shot-format / SKILL / R-P0-11
- **关联 CV**：批 2 `936bba50dc`
- **现象**：文档明确要求按 6 分镜 11 shot 编排（平均 1 分镜 2 shot），agent 仍按 11 shot 走 11 条视频，期望按设计实现拍摄、降低条数。
- **修复（已落码·桌面验收通过）**：批 2——编排纪律「**一个分镜 = 一条视频，shot 是节拍**」：shot-format/screenplay/SKILL.md 三处 + R-P0-11 密度口径（文戏 2.5s / 武戏 1.3s / shot 进节拍不加条数；「单镜 8–10s」口径退役）（`936bba50dc`）。
- **验收要点**：多分镜片按分镜数出片；shot 只作节拍不增条数。
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
- **遗留体验项（2026-10-05 登记，REQ-021 R001 复盘挂入）**：首页认领项目目录名沿用 `.draft-` 铸名（认领**不改名**保宿主 workspace/会话，`createClaimingDir` 的设计产物）——正式项目目录隐藏（点前缀在 macOS Finder 默认不可见）、目录名无语义、备份工具可能跳过点目录。改进方向：认领后安全改名 + 宿主 workspace/会话 rebind（前置：调研宿主 rebind 能力；CV-260 事故面，需契约测试兜底）。**零风险替代已落地（2026-10-05）**：设置页诊断区「存储目录」信息块（`GET /canvas-studio/storage-info` 只读路由 + 项目名称→目录名对照 + 复制路径 + `.draft-*` 备份指引文案）。**改进方向已收口 = CV-294（2026-10-10，方案 A，待桌面验收）**：认领时 `rename` 就地改名为项目名（`claimedDirTarget` 占用集去重，改名失败回退、登记失败回滚）+ 宿主 workspace/会话 rebind（先 `select` 关两道闸再重建，`args[0]` 换新会话放行首句），详见 STATUS.md §4 CV-294。
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

### REQ-004 — 修改画布鼠标操作习惯

- **资料库别名**：R-P2-01
- **关联 CV**：CV-008, CV-089, CV-090 + 批 C
- **编号**：REQ-004
- **优先级**：P2
- **状态(资料库)**：已排期
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（验收走查：滚轮绕光标缩放 / Ctrl 多选 / 批量「引用到对话（N 个）」/ CV-286 指数化灵敏度全过；**2026-10-05 回填**：本条正文原写「部分实现（缩放方向恰与需求相反）」，与代码不符已更正 —— `CanvasSurface.tsx:463` 现为「滚轮 = 绕光标缩放（绕光标、Ctrl/Cmd 同义），平移走空白处按住拖动」，需求字面的「方向相反」问题已不存在）；**CV-286（2026-10-08）滚轮灵敏度降档**：因子从每事件固定 ×1.2 改按滚动量指数化 `exp(−deltaPixels/800)`（`WHEEL_ZOOM_DIVISOR`，含 deltaMode 行/页换算）—— 触控板高频小增量连乘爆炸（20 事件 ≈ ×38）的根因，鼠标每格 ≈×1.13 略降。
- **归属模块**：Client 画布交互（`CanvasSurface`）
- **需求描述**：改 `Ctrl+滚轮=缩放` 为 `滚轮=缩放`（单手习惯）；选中效果不明显；`Ctrl+选中` 多个目标后，无法一起进入「引用到对话」等一起操作。
- **复现/验证路径**：
  1. 滚轮滚动画布，当前是平移，期望是缩放；
  2. `Ctrl/Cmd+点击` 累加多个节点，期望选中态明显；
  3. 选中多个后右键「引用到对话」，当前只对单节点生效。
- **关联代码**（**2026-10-05 校正行号与事实**）：
  - `src/client/canvas/CanvasSurface.tsx:453-465`（`onWheel`：**滚轮 = 绕光标缩放**，Ctrl/Cmd+滚轮保留同义；平移走空白按住拖动。CV-081 对可滚动正文/textarea 不劫持）
  - `src/client/canvas/CanvasSurface.tsx:637`（Ctrl/Cmd 累加选中）
  - `src/client/canvas/CanvasContextMenu.tsx:113-120`（右键目标 ∈ 多选集合且选中 >1 → 「引用到对话（N 个）」）
  - `src/client/canvas/LayerPanel.tsx:48`（按类型批量选中）
- **实现方案/计划**：改 wheel handler 使滚轮直接缩放；增强选中视觉；实现多选后批量「引用到对话」。
- **验收标准**：滚轮缩放；多选自如；批量引用可用。
- **关联文档**：`docs/STATUS.md`(CV-008 多选、CV-089 选中/拖动视觉修正——均随本条 2026-10-13 桌面验收通过；CV-090 框选改进·待处理)；`docs/canvas-ux-backlog.md:43`；测试 `tests/group-tray.test.mjs`、`tests/canvas-actions.test.mjs`（间接）。
- **资料库来源**：需求表 行 4。
---

### REQ-016 — 门禁机制文档收口（GATED_TOOLS 死符号）

- **关联 CV**：批 A
- **编号**：REQ-016
- **优先级**：P2
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过** —— 两份文档门禁段改写为 `assertApprovalAllowed` + approval-gate 两表真实口径（含 `tts_voiceover` 等 8+4 成员），并给历史决策记录里的死符号加注。**2026-10-05 复核**：`grep -c GATED_TOOLS docs/canvas-studio-tools.md docs/api.md` 均为 **0**（验收标准满足）；源码仅剩 3 处**演进史注释**（`approval-gate.ts:10` 讲原门禁只含两个视频工具、`routes.ts:1682` / `client/index.ts:1217` 讲「executing 会让门禁放行」的因果），按原计划保留 —— 它们记的是「为什么曾经有问题」，不是「现在门禁在哪实现」。
- **归属模块**：文档注释（`docs/canvas-studio-tools.md` / `docs/api.md` / `src/routes.ts` / `src/client/index.ts`）
- **需求描述**：canvas-studio-tools.md 与 api.md 均写「审批门禁的实际拦截由 `host-tools.ts` 的 `GATED_TOOLS` 实现，当前成员为 video_generate / video_composite 两个」——**代码里 `GATED_TOOLS` 已不存在**。真实机制：各工具 execute 调 `assertApprovalAllowed`（host-tools.ts:689），查 `approval-gate.ts` 的 `FORMAL_TOOLS`（8 个产出工具，drafting 态拦）/ `PRODUCING_TOOLS`（+4 图片工具，审阅态拦）/ shotBound 条件。文档描述的门禁范围比实际窄，接手人按文档找 `GATED_TOOLS` 会扑空。
- **复现/验证路径**：
  1. `grep -rn GATED_TOOLS src/` → 只剩注释（routes.ts:1553 / approval-gate.ts:10 / client/index.ts:1189），无实体；
  2. 对照 canvas-studio-tools.md「审批门禁的实际拦截由 GATED_TOOLS 实现」段。
- **关联代码**：`src/approval-gate.ts`（FORMAL_TOOLS / PRODUCING_TOOLS / approvalGateMessage 唯一实现）；`src/host-tools.ts:689`（assertApprovalAllowed，7 处调用点）；文档三处死引用。
- **实现方案/计划**：① 两份文档把「GATED_TOOLS」段改写为「`assertApprovalAllowed` + approval-gate 两张表（FORMAL / PRODUCING + shotBound 条件）」，列真实成员；② 三处源码注释里的 GATED_TOOLS 措辞改为「工作流状态门」或指向 approval-gate.ts（routes.ts:1553、client/index.ts:1189 是历史注释可保留加注，approval-gate.ts:10 本身就是讲演进的注释可不动）。
- **验收标准**：grep `GATED_TOOLS` 在两份文档零命中；文档列出的门禁名单与 `approval-gate.ts` 两表一致。
- **关联文档**：`docs/canvas-studio-tools.md` §C 注、`docs/api.md` 工具清单节注；approval-gate.ts:10 注释（演进史）。无测试（纯文档）。
- **来源**：2026-09-30 工具调用条件审计。
---

### REQ-017 — tts_voiceover 补「角色对白走 `<d>`」反判据

- **关联 CV**：CV-271 + 批 A
- **编号**：REQ-017
- **优先级**：P1
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过** —— 工具描述 + voiceover-writing 第 0 条 + toolchain 工具表行三处反判据（角色对白 → `<d>`，本工具只做旁白/画外音/配音资产）。**2026-10-05 逐处复核通过**：`host-tools.ts:2291`（反判据 + `<d>` 路由）、`skills/voiceover-writing/SKILL.md` §一 第 0 条、`toolchain.md:52` 表格行「⚠️ 角色对白不用它」。
- **归属模块**：工具描述（`host-tools.ts` tts_voiceover）/ 技能（`skills/voiceover-writing/`）/ toolchain
- **需求描述**：tts_voiceover 的描述与技能讲了「怎么配好音」，但**没讲什么情况不该用它**：用户说「让女主说『欢迎回家』」时，正路是视频提示词 `<d>[语言]原话</d>`（角色原生说出口、有口型），tts 产物是独立音频节点、**进不了口型**（唯一进成片路径是 audioRefs ≤15s 烧录，且非口型驱动）。这条边界目前只存在于 subtitle_burn 的降级文案与 toolchain CV-213 段，tts 工具描述（模型每回合都读）缺反判据 ⇒ 高概率误路由。
- **复现/验证路径**：
  1. 对话说「生成一个视频，女主说『欢迎回家』」→ 观察 agent 是否错误先调 tts_voiceover；
  2. 正确行为：视频提示词写 `<d>[中文]欢迎回家</d>`，不调 tts。
- **关联代码**：`src/host-tools.ts` tts_voiceover description（CV-271）；`src/skills/voiceover-writing/SKILL.md`；`skills/canvas-studio-creation/references/toolchain.md`（CV-213 段有 `<d>` 口径但与 tts 无互提）。
- **实现方案/计划**：tts_voiceover 描述开头补一句反判据：「**要画面里的角色开口说这句话（要口型）→ 不要用本工具**，把 `<d>[语言]原话</d>` 写进视频提示词（h3-prompt-writing）；本工具产的是独立配音音频（旁白/画外音/配音资产）」。voiceover-writing SKILL.md「一、先定两件事」加同款第 0 条；toolchain 行补短句。
- **验收标准**：工具描述含「角色开口 → `<d>`」反判据；对话「让角色说 X」不再误调 tts（真机抽查）。
- **关联文档**：STATUS CV-271（边界纪律段）；`docs/canvas-studio-tools.md` §A13。守卫：可在 `tests/skill.test.mjs` 或新守卫断言描述含 `<d>` 关键词。
- **来源**：2026-09-30 工具调用条件审计。
---

### REQ-022 ｜ 重大调整：制作过程分两阶段产出（别名 R-P0-01 · P0 · 资料：已排期/2026-10-07）

- **优先级**：P0
- **状态(资料库)**：已排期
- **资料库别名**：R-P0-01
- **归属模块**：产品形态 / Agent 编排
- **关联 CV**：CV-293 / CV-295 / CV-296 / CV-297 / CV-299 / CV-300 / CV-301 / CV-302 / CV-303 / CV-304 / CV-305 / CV-306 / CV-307 / CV-308 / CV-309 / CV-310（**全部 16 个 CV 已落地 · 2026-10-13 桌面验收通过**；其中 CV-302 首屏同帧于 2026-10-12 先行通过）
- **需求描述**：第一阶段产出故事板（Storyboard）——Agent 搜索后产出详细拍摄故事面板（创意理解 / 视觉效果 / 分镜设计 / shot 安排 / 人物设定 / 音乐设计 / 旁白对话设计），用排版良好的 HTML 呈现，用户调整出确认稿后进入第二阶段画布产出。
- **图证**：`assets/library-2026-10-03/req-R-P0-01-storyboard-stage-1.png` ~ `-4.png`（资料库 4 张配图）。
- **参考样张拆解（附件 zip 已解读，原件不入项目目录）**：顶部参数条（30.00s / 分镜 6 / shot 12 / 16:9 / 旁白 6 句 17.5s / 留白 12.5s / 一家三口）；分节 tab（季节前提 / 景点亮点 / 视觉规范·旁白 / 分镜脚本 / 角色设定 / 声音 / 素材 / 硬约束）；**分镜两级结构**（分镜=叙事单元，shot=一次连续画面；每分镜 2 条 shot 互为备份可单条重出；段内可拆 3~4 shot 压到 2.0s/拍，全片上限 15 条；每 shot 四要素 + 英文 prompt 段）；**角色卡先行锁死**（标准形象图冻结，含微色偏/明度阶梯防糊脸）；三条硬约束（每 shot prompt 只留一个 camera motion 动词 / 暖来自光不来自后期 / 全片禁雪）；声音设计（旁白 17.5s 其余给音效配乐、-16 LUFS、配乐侧链避让人声 1.5-3kHz）。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（两阶段产出全链 16 批：CV-293 增量批 / CV-295 原子批 / CV-296 版本管理 / CV-297 孤儿会话防护 / CV-299 UX 两问 / CV-300 分节合并+§00 / CV-301 并行拉取 / CV-302 首屏同帧〔10-12 先行〕/ CV-303 落地版本接线 / CV-304 阶段守卫 / CV-305 WAL 重构 / CV-306 样张兜底 / CV-307 图文混排 / CV-308 重载标记 / CV-309 引用保留 / CV-310 悬空提示）——**过程记录**：设计稿 v2.0 已定稿（2026-10-10）——数据契约 `plans/REQ-022-storyboard数据契约.md` v2.0：v1 讨论稿经 **8 议题分项复审全部收口**并回写正文（① 状态机 5→3 态定案 `storyboarding`；② 落地 = 用户按钮 → Host 路由 + 三层校验 + 单向终点，auto 由 Host 编排自动落地；③ 版本模型 C 细化（3 checkpoint / final 冻结 / 活副本=sections）；④ seed 字段级映射 10 行 + 锚点节点 + 三层校验 blocker/warning 表；⑤ 旧工具方案甲三工具全下线，`approval-gate` 收敛单值；⑥ 镜号一次铸造不重排 + 卡标题 `分镜 N · shotId · 景别` + shotRefs 增 sbRef 写法；⑦ 约束注入四层通道（§00/§08 进 system prompt 小节，Host 不做隐式合并）；⑧ 回写 P/L/A 全字段表（声明面回写、实例面不回写）+ L 类 diff 触发机制 + actuals 只由 Host 自动写）。**原设计**：`plans/R-P0-01-两阶段Storyboard形态设计.md` v1.0 + **拍板体验稿 v2** `plans/R-P0-01-storyboard-stage-demo.html`（2026-10-07 升级；被数据契约覆盖的章节已在其头注标注）。
- **数据契约交互演示稿（2026-10-10）**：`plans/REQ-022-storyboard数据契约-交互演示.html`（自包含单文件，浏览器直接打开；暗色 editorial 承拍板体验稿风格，**非实现事实源**）——把 v2.0 契约的 8 议题做成可点全流程：顶栏三态状态机条 + confirm/auto 模式 seg，画布（PRE 节点 / seed 十行映射产物 / 血缘 SVG / 通道日志 / 缺项角标），故事版全屏覆盖层（§00–§08 九 tab、字段 contenteditable 直编、版本 chips、落地按钮），右侧契约面板（演示导览 / 一键补齐 / 三层校验实时 / 三态门禁面 / seed 产物表 / **P·L·A 回写三分类表** / 工具处置表 / 开发锚点表），**每个交互旁标契约条款号**。链路：blocker modal（缺什么+在哪分节+跳转；只读落地源改「回活副本」）→ 确认清单（warning + 数据摘要 + 显式丢弃清单 + 落地源）→ 三 checkpoint seed → executing 只读 + 单向终点拦截 → revise 增镜 max+1 / 删镜空号留孤儿卡 → L 回写（解析失败跳过、不升版本）+ A 类 actuals。jsdom 两套冒烟 48 断言全绿、零运行时错误（开发期验证脚本临时产出，未入库）。**用途**：后续 CV-293 开发时的 UI/交互参考材料。开工机械清单见数据契约 §14（工具登记 / skill 更新 / 测试面），**CV 号开工取 CV-293**。
- **会话交接文档（2026-10-10）**：`plans/REQ-022-会话交接-20261010.md`（承 REQ-032 交接模板）——新会话续接「详细开发计划」阶段的唯一入口：一句话现状 / 已提交勿重做清单（`826bc0522e` v2.0 定稿、`efad4b16e5` 交互演示 HTML、`603887fe38` 流水线全景 `canvas_studio_flow.html`（2026-10-27 由仓根迁入 `canvas-studio/docs/demos/`））/ 8 议题拍板口径速查 / 实现落点事实表（状态机 `contracts/project.ts:12,41`、`REVIEW_STATES` `approval-gate.ts:50`、三 submit 工具行号、`STORYBOARD_NODE_TOOL` 六处引用、skill 五处改造点、近邻测试六文件）/ 纪律红线 / 验证与收尾四步。**遗留三项**：① `48e4327316` 重建的 `plans/R-P0-02-storyboard数据契约.md`（250 行旧版）与正本 `REQ-022-storyboard数据契约.md`（486 行）构成双事实源，待拍板收口；② 契约两处笔误以代码为准（`PUT /library` 实为 PATCH、纪律小节 order 实为 153）；③ `validateForSeed` / `storyboard.html` 路由 / 版本落盘位置尚无实现，P1 计划必答。
- **详细开发计划（2026-10-10）**：`plans/REQ-022-详细开发计划.md`——把契约 §14 的 P1/P2/P3 拆成 5 个可独立验收的批次（**批次 0** 纯文档欠账清理 / **CV-293** 状态机 3 态迁移 / **CV-295** storyboard 数据层 + `write_storyboard` + 读写路由 / **CV-296** seed + `isShotCard` 双值谓词 + 三工具下线 + skill 改造 / **CV-297** overlay 呈现 + 落地路由 + 顶条入口），逐批钉死落点文件行号、依赖顺序、验收口径与回退点。**附 2026-10-10 实测探针 8/8 PASS**：① WebServer 仅支持 `exact`/`prefix`、**无 `:id` 路径参数位**（`webserver/src/index.ts:38-43`）⇒ 契约 §11 的 `/canvas-studio/projects/:id/storyboard.html` 不可注册，改为 `prefix /canvas-studio/storyboard/{projectId}.html`（照 `routes.ts:1458` `ROUTE_STYLE_DEMOS` 先例）；② **iframe 同源成立**——主窗口 `loadURL('http://127.0.0.1:{port}/')`（`dsh-plugin-desktop/src/index.ts:172`）、`webSecurity:true`/`sandbox:true`（`window-options.ts:34-41`），harness `client`/`host` 包内零命中 CSP / `X-Frame-Options`；③ **`storyboard.json` 与 `canvas.json` 同级成立**——`dirOf()` 公开（`projects.ts:279`）、`canvasPath`（`:304`）、磁盘实测工程目录同层已有 `canvas.json`+`jobs.json`；④ seed 十行映射与真实 `canvas.json` 载荷吻合（`operationType:'storyboard'` + `declaredDuration`/`declaredFrames`/`sourceIds`、`assets[] role:'style'` + `anchorNodeIds`/`lockedPrompt`）。**清理**：删除 `plans/R-P0-02-storyboard数据契约.md`（250 行旧版，与 486 行正本重复）收口双事实源；列出 **5 处待回写契约笔误**（`order` 152→153 / `PUT /library` 实为 PATCH / §11 路由形态 / §4.4 版本落盘位置 / seed 卡 toolName snake↔camel 自相矛盾）。纯文档，未改代码/测试，**无 CV 号**（开工仍取 CV-293；294 已占，295+ 空闲）。批 3/4 并行与 seed 命名两项待拍板。
- **阶段一增量批 CV-293 已落地（2026-10-10，待桌面验收）**：**批次边界实施中修正为「先增量后原子」**——原计划把「3 态迁移」（批 1）与「三 submit 工具下线」（批 3）分开，但状态翻转点全在待删工具里（`host-tools.ts:1930`→`awaiting_approval`、`:2174`→`script_review`）、审批 UI 按旧态 keying（`client/StudioFrame.tsx:2064/2083`），拆批会留下「confirm 模式提交后无审批条可点」的死锁缺口；故先把纯增量部分做完。**新增** `src/contracts/storyboard.ts`（wire 契约；`normalizeStoryboard` 顶层非对象 → `undefined` 走损坏分支；`validateForSeed` 唯一完成度判据：blocker 只答「能不能落地」/ warning 只进确认清单）、`src/storyboard-store.ts`（三态 `StoryboardLoad`；损坏 → 改名留证 `<file>.corrupt`，**绝不静默重置**；模块级串行队列读也排队 + `updateStoryboard` 读改写原子入口）、`src/storyboard-render.ts`（`renderStoryboard(doc,{version,landedVersion})` 纯函数 + 占位/损坏页，**全字段 escapeHtml**）、`tests/storyboard-{contract,store,render}.test.mjs`（29 断言）。**改动** `src/projects.ts` 公开 `storyboardFile()`（与 canvas.json 同级）、`src/routes.ts` 新增 prefix 路由 `/canvas-studio/storyboard`（**WebServer 无 `:id` 参数位** → 前缀 + 手动解析单段 `{projectId}.html`；missing/corrupt **不回 404**）、`src/host-tools.ts` 新增 `write_storyboard`（九段 JSON 字符串入参、解析不出不落盘、首稿 v1、重写前自动存档、`executing` 期拒绝整体重写）、`src/asset-capture.ts` `WORKFLOW_TOOLS` + `src/param-guard.ts` 参数分类 + `src/tool-presentation.ts` 展示表三项登记（各有一条守卫盯着，漏一处即红）、`src/client/StudioFrame.tsx` 顶条按钮 + 全屏只读覆盖层。**验证**：typecheck 双绿 / tsdown / 新测试 29 断言全绿 / 全量 smoke **1458·1458、基线 0**。**剩余**：`revise_storyboard` 与 3 态迁移、seed、`isShotCard`、落地按钮归「原子批 CV-295」。
- **原子批 CV-295 已落地（2026-10-10，待桌面验收）**：把契约 §3/§6/§7/§12 的原子切换一次做完 —— **① 状态机 5→3 态**（`storyboarding`/`keyframe_review`/`executing`；`normalizeWorkflow` 一次性迁移；`resolveSetModePatch` 遵循**单向终点**：已落地不回退，避免重新打开落地入口）；**② 三个旧工具全下线**（`write_screenplay` / `submit_screenplay_for_approval` / `submit_storyboard_for_approval`），连带 `WORKFLOW_TOOLS` 项、`param-guard` 的 `screenplay` 分类项、`routes.ts` 四个审批动作、客户端两条审批条与四个处理器；**刻意保留** `tool-presentation` 条目（历史 tool/call 记录仍要渲染）与 `STORYBOARD_NODE_TOOL` 常量（存量卡兼容）；**③ `isShotCard` 双值谓词**替换 21 处散写比较（阶段判定 / 标题解析 / shotRefs / 素材组血缘 / `canvas-view` 泳道 / `compose` / `generate` / `auto-test-*`），新增 `SEED_SHOT_TOOL`/`SEED_ANCHOR_TOOL`；**④ `sbRef` 双向关联**：节点与资产新增该字段，并把 `writeCanvas` 的 client-author 保护从 `filename` 扩到 `sbRef`（Host 专属，不捞就被拖画布冲掉 ⇒ 回写断链）；**⑤ seed + 落地通道**：`src/storyboard-seed.ts`（§7.5 十行映射、镜号一次铸造 1..N、待核实项与硬约束不落节点、占位节点不塞 `generationPrompt`）+ `POST /canvas-studio/storyboard/land`（三层校验 / 单向终点 / 固化 final / 回填 `bindings` / 推 `executing`）+ 覆盖层「确认落地」按钮；**⑥ 纪律注入**：`src/storyboard-discipline-prompt.ts`（order 153，未落地不注入）；**⑦ skill 对拍**：总纲六处 + screenplay/clarification/toolchain 分册 + oriental 风格 skill。**验证**：typecheck 双绿 / tsdown / storyboard 四套测试 **40 断言** / 全量 smoke **基线 0**（旧工具相关用例随能力迁移删除或改写到新路径，删除处的 helper 已回补）。
- **UX 两问收口 CV-299 已落地（2026-10-11，待桌面验收）**：用户验收反馈两问题 —— ① 创意没先上故事板（首屏空壳、内容随对话才补齐）；② 效果图只落在画布、被「拍摄定稿」只读覆盖层挡住看不到。**拍板修法：agent 显式传参 `storyboardRef` + 项目创建时预建骨架。** **① 创意先行**：`storyboard-store.ts` 新增 `ensureStoryboardSkeleton`（创建/认领路由成功后 fire-and-forget 预建、`.catch(() => undefined)` 不阻断建项目；幂等；meta 取 plan `aspect`/`targetDuration`，回落 16:9 / 0，genre 留空）+ `storyboard-render.ts` 0/9 分镜出「等待创意填充」横幅 + skill 三处纪律（步骤 1 基调样张传 `storyboardRef:"look"` / 2b 创意确认后第一动作首写骨架 / 6 逐镜出图传 `storyboardRef=<shot id>`）。**② 效果图进故事板**：`image_generate` 可选参数 `storyboardRef`（`host-tools.ts`；`param-guard.ts` 分类表归类）→ 结算（含 image_fix auto-fix 换节点后）回写 `attachImageToStoryboard` → `contracts/storyboard.ts` 纯函数 `attachStoryboardImage(sections, ref, image) → {sections, hit}`（shot `refImage` / §02 `lookRef`，`hit: 'shot'|'look'|'miss'`，miss 降级 warnings **绝不抛错**）→ 渲染 `mediaUrl` 缩略图（`.shot-fig`/`.look-fig`/`.asset-thumb`；`routes.ts` 新 `storyboardMediaResolver()`：canvasNode→node.url、file→`/canvas-studio/assets/<projectId>/<id>`，读画布失败降级）→ `asset-capture.ts` 新 hook `onStoryboardTouched`（仅带参结算置位）→ `client/index.ts` `bumpStoryboardRev` 刷新覆盖层。连带 `write_storyboard` 首笔落在预建骨架上就地填进 v1（`isPristineSkeleton` 判据）；skill-catalog 体积上限 20KB→21KB。**验证**：typecheck / build / verify:loader / `test:smoke` 全绿（失败 0、基线 0、名外新增 0）；storyboard 三套定向 41/41。
- **编号勘误 + 补登记 CV-300 / CV-301（2026-10-12，纯文档）**：对账发现 `origin/dev..dev` 上两个本地提交**已提交但零登记、且各自撞号**（`bb8f685674` 自称 CV-296＝本 REQ 的「版本管理」、`7b7b2654af` 自称 CV-297＝「孤儿会话防护」）。两提交 `rebase --reword` 改号并追加「编号更正」尾注 → 新 SHA `6948ec0cf3`＝CV-300 / `10e395af94`＝CV-301；两提交**均未推送**（`origin/dev`＝`6c8a86bf` 仍是它们的父提交 ⇒ 推送仍为**快进、无需 force**），工作树未提交改动指纹 `d1b363dc…` 在改号前后一致。**撞号根因**＝`plans/REQ-022-详细开发计划.md` 的**计划号**（CV-293/295/296/297 分批）随「先增量后原子」的顺序调整被实际交付吃掉后**未回写计划稿**，实施会话沿用计划号 ⇒ 撞。登记落点：STATUS §4 / §8 / §0 水位 + 本文件 §七 + `canvas-ux-backlog` 变更记录。
- **CV-300 已落地（write_storyboard 分节合并 + 故事板 §00「你的原始创意」块 + 阶段一隐藏「关闭」，2026-10-12，待桌面验收）**：① `write_storyboard` 由**整体替换改分节合并** —— 没传的节保留现值（修「分次写互相冲掉、创意理解中途消失」），显式传空才清空，回执列出未传保留的节；② `routes.ts` 读画布 BRIEF 节点全文渲染 §00「你的原始创意」（**不计入 9 节完成度、不进 `storyboard.json`**，原话必须转义）；③ `storyboarding` 且未落地时覆盖层**不出「关闭」钮**（该阶段画布无独有内容、关掉只会停掉自动弹），落地后恢复；④ 口径同步工具描述 + `SKILL.md` / `toolchain.md` / `screenplay.md` / `canvas-studio-tools.md`，消除「必填 vs 全可选」「不丢内容」的矛盾措辞。验证：新增 `storyboard-merge` 5 条（反向变异已验证变红→还原）+ `sourceIdea` 渲染守卫；全量 1545·1545。
- **CV-301 已落地（打开 / 切换项目时 workflow 提前并行拉取，2026-10-12，待桌面验收）**：症状「从首页进项目**先看到空画布、过一会才弹「拍摄定稿」**」；根因 = 覆盖层自动弹只看 `workflow.state`，而 `refreshWorkflow` 原先排在 `openProject` **串行链尾**（workspace 绑定 / 认领改名 / 会话恢复 / 画布载入 / skill 清单之后）。修法 = `select()` 后立刻 fire-and-forget 开拉（与后续步骤零依赖，失败静默自吞）+ `switchProject` 摘出 `.then()` 链。**边界**：仍要一次网络往返 ⇒ 真正的**同帧出现**由紧随其后的「同拍写入」收口（在途 **CV-302**，待桌面验收后登记）。验证：typecheck 双绿 / tsdown / 全量 1545·1545。
- **CV-302 已落地并当日桌面验收通过（首屏「故事板与画布同帧出现」，2026-10-12）**：用户报「新建项目点开始制作 → 直接落画布页，过十几秒才显示故事板；正确流程应是新建后直接显示故事板（哪怕空的），等故事板彻底完成后才进画布」。**根因两层叠加**：① 认领 / 打开项目时 Host **随项目记录**返回的 `StudioProject.workflow` 只落进 projects 列表、没进 `store.workflows`，而覆盖层自动可见性读的正是它 ⇒ 只能干等 agent 首笔工具结算触发的 `refreshWorkflow`（那「十几秒」）；② 可见性是 `useEffect` 而非**派生**，effect 在 commit 之后跑 ⇒ 必漏一帧裸画布。**修法**：① 新增 `adoptWorkflow(project)`（零请求零猜想，`claimAndSend` / `openProject` 在 `select()` **同拍**调用，中间禁插 await），`refreshWorkflow` 降级为对账；② 可见性改派生 `storyboardAuto`，`storyboardDismissedRef`(useRef) → `storyboardDismissed`(**useState**)；③ 顺带白拿需求二 —— 落地推 `executing` 后派生式自动转假，覆盖层自己让位。守卫 `tests/storyboard-first-screen.test.mjs` 4 例。
- **CV-303 / CV-304 同批落地（REQ-022 评审批 A，评审 SB-02 + SB-03 + SB-04，2026-10-12，待验收）**：**CV-303 落地版本接线** —— `StudioFrame.handleLand` 漏传 `sbVersion` ⇒ 选「落地 vN」实得**活副本**且落地后 `assertNotLanded` 冻结、不可撤销（在用户最谨慎的路径上静默投错料）；链路其余各段本就完整，纯 UI 漏接，守卫 `tests/storyboard-land-wiring.test.mjs` 把四段（UI → client 封装 → api body → 路由选版）串起来断言。**CV-304 阶段守卫收紧 + 撤回文案**（必须同批：只收紧守卫不改文案，会把新拦到的用户指向**不存在**的工具 `revise_storyboard`）—— 守卫由「只拦 `executing`」改**白名单**「仅 `storyboarding`（含 `workflow` 缺失的 legacy）放行」，报错只说事实、把改动意愿交回用户；**行为级**守卫 `tests/storyboard-stage-gate.test.mjs`（三态放行/拒绝 + 拒绝发生在落盘**之前**零副作用 + legacy 放行 + 文案不提名不存在的工具）。
- **CV-305 已落地（落地执行体重构：`landed` 即 WAL + 续做路径，REQ-022 评审批 A〔SB-01 + SB-06〕，2026-10-12，待验收；提交 `1126752600`）**：把 `landStoryboard` 从 `routes.ts` 模块私有函数抽成可测模块 `src/storyboard-land.ts`（窄接口 `StoryboardFileRegistry` + 可注入假 registry ⇒ 行为级可测，不再靠字符串断言兜），并以「`landed` 即预写日志」为骨架重写落地事务。**① SB-01**：原「先写画布、后写 `landed`」留下**无法自愈**的「画布已成、标记未写」窗口（重试判不出已落过 ⇒ 重复 append），且写画布失败时用户被永久锁在「已落地但什么都没发生」；改四步 WAL：只写 `landed`+「落地前固化」checkpoint → 投影 + 写画布 → `bindings` **由画布实况重建** → 推 `executing`。**② SB-06**：TOCTOU 复核点从入口读挪进 WAL 的 `mutate` 内。**③ 幂等判据** `hasSeedAnchor`（`toolName === SEED_ANCHOR_TOOL`；**不判 title**，规划期改名会假阴性 ⇒ 整体覆盖写灌第二整套）。**④ 入口三分支**：未落地→首落 / 已落地 ∧ 有锚点 ∧ `executing`→拒 / 其余→**续做**。**⑤ UI**：`sbLandedHalfway` 态按钮保持可点 + 文案「接着完成落地」（否则死局），「关闭」收敛为只看 `state`。**⑥ 反向变异逼出的真 bug**：第一版 `bindings` 按投影计划算时，「去掉幂等探测」这条变异**没变红** ⇒ 探测命中跳过写画布时 bindings 指向未落盘随机 id；改「真源是画布」后三条路径共用一条规则且续做时**自愈**历史断链。**验证**：全量 `test:smoke` **1586·1586、失败 0、基线 0**；13 条行为级用例 + 4 轮反向变异全真红。
- **CV-306 / CV-307 已落地（基调样张自动兜底回写 + §02 视觉规范图文混排与点图放大，2026-10-12，待验收；提交 `b1965b255c`）**：**用户原话**「现在生成了样张图，但是在故事板上看不到，用户看不到，就没办法拍板，必须要在故事板上看到才行」。**CV-306（产生路径修洞）**：agent 常漏传 `storyboardRef` ⇒ 样张落了画布节点却没进 §02「视觉规范」；判据抽成纯函数 `shouldAutoAttachLook`（`contracts/storyboard.ts` 唯一实现）＝「本图未绑镜 ∧ §02.`lookRef` 为空 ∧ §04 尚无分镜」；Host 侧 `autoAttachLookSample` 先读一次做闸门（**逐镜出图高频路径零写入**）、读改写内复查防插队、整体 try/catch **绝不抛错**；**已有样张永不自动覆盖**（「换一批」须显式传 `storyboardRef='look'`）。**CV-307（展示层）**：§02 改**图文混排**（`.look-row`：宽栏左右、≤620px 上下单列）+ 图包 `<a class="zoom" target="_blank" rel="noreferrer">` + `cursor:zoom-in` 实现「点开看原图」；**保持故事板产物的零 JS 契约**（与该文档 §01 来源链接同款，代价是单击而非双击）；无图时逐字节回到旧行为。**验证**：全量 1575·1575；反向变异两条真红（判据 `===`→`!==`；抹掉 `target="_blank"`）。
- **CV-308 / CV-309 / CV-310 同批落地（故事板挂图引用被重写冲掉 + 覆盖层重载判据改看 Host 标记 + 引用悬空提示，2026-10-12，待验收；提交 `2a9a4d07d0`）**：**用户原话**「中间确实先出现了样张，但是后来又没有了，这个问题需要解决一下。细致点，考虑全面一些」。**CV-309（产生路径修洞，主线）**：`mergeStoryboardWrite` 的**节级**语义（传了=替换该节）套在了 Host 独占的引用字段上 —— `§02.lookRef` / `§04.shots[].refImage` 的值 agent 手里没有（唯一写入方 `attachStoryboardImage`），agent 重传 `visual` 时只带 5 条 tokens ⇒ `lookRef` 被整节替换**一并冲掉**。**三方取证**（会话转录 + 工具回执原文 + 盘上数据）：18:02:50 `image_generate` 未传 `storyboardRef`，回执明写「已自动挂到 §02（lookRef → 43a7613b-…）」⇒ 兜底真落盘、用户已看到样张；18:04:05 `write_storyboard` 传了 `visual`（回执「保留现值」清单**不含 02**）⇒ 就在那一刻冲掉。**影响面：扫 9 个项目 8 个中招**（唯一没中的恰好是分镜还没写的）；`§04` 重传同理会抹掉逐镜 `refImage`。修法 `keepHostRefs`（只作用于这两个字段）：**键缺失 = 保留现值 / 显式 `null` = 清空 / 给引用对象 = 覆盖**；逐镜按 shot id 继承、镜被删不复活。**CV-308（展示层）**：「覆盖层要不要重载」的判据从**入参嗅探**（有没有 `storyboardRef` —— CV-306 引入兜底后按定义失效，导致「数据写对了、覆盖层永不重载」）改成**结果文本标记**：Host 附注里的 `STORYBOARD_TOUCH_MARKER`，写法 `storyboardTouchedNote()` 与读法 `touchedStoryboard()` **同处一个模块（唯一实现）**、往返有单测；只有**真写盘**的两处附注带标记，没写成的不带。删除 `hasStoryboardRef` 与 `AssetCaptureState.storyboardTouched`；`firstText` 与 `touchedStoryboard` 共用同一个深度遍历 `textBlocks`。**CV-310（展示层）**：§02 有 `lookRef` 却取不到图时原先**静默塌回**「还没有视觉规范」空态 ⇒ 改出显式提示条（含节点 id）；判据严格限定「解析器在场、却解析不出」，`media` 解析器缺失（含路由那条画布整体降级的路径）视为**无法判定**保持静默。**验证**：全量 **1586·1586、失败 0、基线 0**；反向变异三条真红。**存量 8 个项目按开发阶段铁律不回填**（用户确认不救）。
- **关联**：样张分镜两级结构与 REQ-024/BUG-046 的 shot 密度口径（文戏 2.5s / 武戏 1.3s）同源，立项时一并落进方案；R-P0-13 脚注「自动执行先出分镜表，确认后渲染」正对应本条两阶段语义。
---

### REQ-024 ｜ 30 秒视频分镜太空，提升 shot 密度（别名 R-P0-11 · P0 · 资料：已排期/2026-10-07）

- **优先级**：P0
- **状态(资料库)**：已排期
- **资料库别名**：R-P0-11
- **归属模块**：shot-format / SKILL 编排纪律
- **关联 CV**：批 2 `936bba50dc`
- **需求描述**：30s 视频里 10s 分镜内容很空、一条分镜一个运镜就结束。期望文戏 2.5s 左右一个 shot、武戏 1.3s 左右一个 shot。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（2026-10-02 批 2，与 BUG-046 编排纪律同批）——密度口径并入 shot-format/screenplay/SKILL.md 三处（文戏 2.5s / 武戏 1.3s / shot 进节拍不加条数）。
- **关联**：与 REQ-022 样张的两级分镜结构同源。
---

### REQ-028 ｜ 首页 Agent 项目创建框改版 v2（别名 R-P0-13 · P0 · 资料：已排期/2026-10-07，10-06 增量）

- **优先级**：P0
- **状态(资料库)**：已排期（2026-10-06 增量）
- **资料库别名**：R-P0-13
- **归属模块**：Client 首页输入区
- **关联 CV**：CV-280
- **需求描述**：输入框重设计 v2——所有选择项统一为「chip 触发器 + 悬浮气泡弹出框」组件（带小尖角指向触发器）；附件从一次性文件对话框改为弹出框，先选素材来源再落盘。
- **图证/附件**：`assets/library-2026-10-06/Agent输入框设计.png`、`video-agent-inputbox.html`（交互演示）。
- **交互方案拆解（HTML 演示解读）**：
  - **统一弹出框规格**：触发器上方（`bottom: calc(100% + 11px)`）向上展开；10×10 方块旋转 45° 做小尖角；面板宽 238–268px、圆角 12px、内边距 6px；菜单项固定行高 34px（左打勾 + 主文案 + 右侧 meta，选中态=勾亮 + meta 琥珀色）；动效 opacity 0→1 + translateY(6px→0) 150ms；点外部 / Esc / 再点触发器关闭，同时只允许一个面板展开；单选面板选中即关，多字段面板（画幅+分辨率、时长）保持展开。
  - **参考内容（附件通道）**：不占工具栏，改为输入框左上 58×58 虚线方框（＋ 居中、「参考内容」在下）；点开向下弹两个来源项——本地文件（多选）/ 资产库；缩略图 58px 从方框右侧排队；拖拽与 Ctrl+V 快捷路径并存。
  - **四个硬需求落点（全部首屏可改，无二级页面）**：① 画幅+分辨率合并「16:9 · 720P ▾」单入口（上段 16:9/9:16 大卡 + 下段 480P 0.4× / 720P 推荐 / 1080P 2.0×；合并入口不合并状态）；② 时长「15s ▾ / 自定义 ▾ / 不锁定 ▾」三项互不锁定（预设 10/15/30/60；自定义 1–600 秒键入；不锁定=AI 确定；面板内不出现耗时预估）；③ 执行模式「● 自动执行 ▾」绿点/琥珀点读模式（两项菜单只写模式名，差异写脚注与 hover 气泡「先出分镜表，确认后才渲染」）；④ 提交按钮固定文案「开始创作」。
  - **模型选择**：MiniMax H3（推荐）/ SeedDance 2.0 / SeedDance 2.5。
- **项目关联**：脚注对应 REQ-022 两阶段语义；480P/720P 分档与 REQ-002 同口径；chip+气泡组件规范应与 REQ-003 提示词编辑框统一为一套；模型三选与现有视频模型路由对齐。
- **拍板记录（2026-10-06，用户确认）**：**1:1 复刻演示的效果与交互**；分辨率展示口径跟演示（480P / 720P / 1080P，倍数 0.4× / 推荐 / 2.0×），**内部映射真值档位 480p / 736p / 2k**（720P→736p、1080P→2k），不新增 1080P 实体档位。参考内容方框为**入口形态改造**：暂存机制沿用已验收的 CV-261 链路（四类限额、发送前只展示不上传、认领后落卡 + `@ref` 进正文），缩略图排队即既有暂存条目的新形态。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（CV-280 + CV-298 模型座椅恢复；QA 用例 = acceptance-test-cases §二十八 Y 组 Y-1~Y-13 全过。本地 dev 提交 `93e0032b51`→`5a44262875` 五连）。
- **落地记录（CV-280，2026-10-06）**：
  - **统一弹出框组件** `src/client/LobbyPopover.tsx`（新）：`LobbySel` 外壳（chip 触发器 + `.csLobbyPop` 面板）+ `LobbyMenuItem`（34px 行高：勾 13px + 文案 12.5px + meta 10.5px，选中态读 `aria-pressed`）+ 比例大卡 / 自定义时长行 / 分隔线 / 小节标题 / 脚注 / hover 气泡。规格逐条对齐演示：触发器上方 `calc(100% + 11px)` 向上展开、10×10 方块 45° 尖角距左 20px、面板 226–268px（逐面板定宽跟演示：模型 226 / 附件 238 / 画幅 252 / 模式 250 / 时长 268）、圆角 12px 内边距 6px、opacity+translateY(6px) 150ms、点外/Esc/再点触发器关闭、**单开互斥**（模块级登记表跨组件互斥——三枚规格 chip 在宿主卡工具行、参考内容方框在 dock 行，四者共用）、单选面板选中即关（render-prop `close`）、多字段面板（画幅+分辨率 / 时长）保持展开。触发器**刻意不写** `aria-haspopup="menu"`（CV-259 的 hero 态通配隐藏规则会误杀卡片内所有 menu 触发器，只写 `aria-expanded` + `aria-controls`）。
  - **规格选择器迁入宿主卡工具行**（v1.3 dock 行退役）：左组三 chip 挂 `conversation.input.left`（模型三选「MiniMax H3（推荐）/ SeedDance 2.0 / SeedDance 2.5」；画幅+分辨率合并入口「16:9 · 720P ▾」——同一面板两段两份独立状态，改比例不动档位；时长三态互不锁定：预设 10/15/30/60 + 自定义（点行激活输入框，未选中 disabled 静默态）+ 不锁定=AI 确定，面板内零耗时预估），执行模式 chip 挂 `conversation.input.right`（绿点=自动执行 / 琥珀点=询问执行，菜单只写模式名，差异写脚注与 hover 气泡「当前：…」）。草稿类型 `LobbySpecDraft` + 映射真值收进**纯模块 `src/lobby-spec.ts`**（两侧共用，`tests/lobby-spec.test.mjs` 从 lib/ **真 import** 钉住）。
  - **分辨率映射真值（拍板②）**：展示 480P/720P/1080P（meta 0.4×/推荐/2.0×）↔ 真值 480p/736p/2k，`RESOLUTION_DISPLAY` 唯一表；不新增 1080P 实体档位。画幅收窄为 16:9/9:16 两卡（1:1 与「不锁定画幅」随合并入口退出首页）。
  - **参考内容方框**（LobbyStashBar v2 形态）：58×58 虚线方框（＋ 居中 + 「参考内容」在 ＋ 下）**常驻** lobby（v1.4 空则不渲染的空态死角随之消除），缩略图 58×58 从方框左侧排队、hover 浮出移除、大小/时长读数收进 hover title；点开向下弹两个来源项「本地文件…（多选）/ 资产库（N 项）」+ 脚注（拖入 / Ctrl+V / 发送第一句话后自动落进画布——CV-261 语义出口保留）。**CV-261 暂存机制原样沿用**：分类把关 + 四类限额 + 拒收 toast 仍只有 StudioFrame `handleStashedFiles` 一份实现，组件只发 window 事件（`cs-lobby-stash-files` / `cs-lobby-open-library`，dock 组件与 StudioFrame 分属两棵树）；lobby 态新增 document paste 接管（文件进暂存，纯文本不受影响）。LobbyHero 的「📎 添加素材」随迁退役（入口唯一，D4）。资产库来源的闭环：资产库详情抽屉 lobby 态新增「暂存为参考内容」（fetch 库媒体 → File → 既有暂存链路，成功即关浮层回输入框）。
  - **「开始创作」提交钮**：宿主发送钮（图标圆钮，CSS Modules 哈希类选不中）在 lobby 态由 `tagSendButton` 打 `data-cs-send` 锚（结构定位「卡内最后一个 button」+ aria-label 双语核验，核验不中静默不打、退回原状）→ styles.ts 重塑为 accent 渐变药丸 + 固定文案「开始创作」（aria-label 同步改写，还原时恢复），不随模式改写（拍板④）。
  - **令牌**：`--cs-ok` / `--cs-warn`（执行模式绿/琥珀点，固定功能色入 BRAND_FIXED）+ `--cs-accent-contrast`（accent 实底上的文字色，随预设走——紫/蓝白字、琥珀金墨色）；演示色值一律不照抄（四预设 × 明暗双轨，写死即 DD-01 同款事故）。
  - **拍板外的两处偏差（登记）**：① 执行模式脚注/hover 不照抄演示句「先出分镜表，确认后才渲染」——那是 REQ-022 两阶段语义（仅设计未立项），今天的 auto = 不再询问直接跑到成片，照抄等于虚假承诺；改用今天真实语义，REQ-022 立项后对齐。② 自定义时长上限 300（`MAX_TARGET_DURATION` 既有 5 分钟分镜预算约束）而非演示的 600。**另**：模型三选与分辨率**暂不落 plan**（`StudioProjectPlan` 无字段；选中值活在 lobbySpec 草稿，路由消费属后续 CV—— SeedDance 端点未接）。
  - **验证**：`yarn check` 全量门禁 ✓（typecheck + build + verify:loader + test:smoke **1326 条 0 失败**）；新 `tests/lobby-spec.test.mjs` 6 条直连断言（映射真值/模型表/buildLobbyPlan 夹取/chip 读数/诚实脚注）；守卫改挂 `lobby-claim` / `lobby-stash` / `visual-tokens`（类名双向配对清单换 v2 全表）/ `host-boundary`（新槽补进 HOST_SLOT_REQUIRED_OPTION）。**桌面验收对照单**：统一 chip+气泡规格逐像素 vs 演示 HTML / 参考内容方框双来源+缩略图排队 / 四硬需求（合并入口、时长互不锁定、模式点+脚注、开始创作）/ 模型三选。
- **验收截图对照与同日修正（2026-10-06，效果图 vs 现场图）**：
  - **验收截图反馈修正（2026-10-06 同日，对照效果图逐项）**：① hero 态藏宿主工具行三枚通用控件——「+」命令菜单（卡内唯一 `button[aria-haspopup="listbox"]`）、权限选择「Workspace Write」（aria-label 模板前缀锚，中英双语；英文锚取逗号前段，host-boundary 红线①的选择器解析按 ASCII 逗号分段）、**LLM 模型座椅**（`[data-slot=conversation.input.model]` 整槽隐藏；**CV-259 白名单被有意反转删除**——REQ-028 拍板 1:1 复刻演示覆盖前拍板，work 态座椅不受影响，守卫改写为「反转守卫」防诈尸）——三枚藏掉后工具行回到演示的单行形态；② 「开始创作」禁用态从「accent 打四折的糊紫」改为演示的灰实底弱化字（opacity 拉回 1，材料全走令牌）。**登记不可修项**：参考内容方框/缩略图条在卡片上方而非卡内（宿主无卡内上插槽位；唯一卡内上方的 attachments 单槽已被宿主附件包占用，抢占会弄坏 work 态图片附件）、placeholder 文案（宿主 i18n 下发，改=动 pinned submodule）、卡片正下方「Enter 提交」脚注行（hero 态宿主不渲染卡片下方唯一的 composer.dock 槽，且属演示页说明性脚注非交互规格）、药丸颜色紫/橙差异（--cs-accent 跟随外观预设，演示橙 = 琥珀金预设，不写死色值）、默认「询问执行」（跟设置页默认模式 CV-196，非缺陷）。
- **模型座椅恢复（CV-298，2026-10-11，二次反转）**：上一条「验收截图反馈修正」里对 LLM 模型座椅的整槽隐藏（当时拍板：演示工具行没有座椅，且顾虑挤得工具行折两行）被 2026-10-11 用户反馈推翻——首页右组缺模型选择被拍板为缺陷。真机截图量测：卡内宽约 790px、左组 chips 约 330px + 右组含座椅约 360px，一行装得下（座椅触发器 120–155px，长名 max-width + ellipsis 兜底；宿主 `.tools` 本就 flex-wrap + margin-left:auto）。落地：styles.ts 删整槽隐藏、恢复 CV-259 白名单（`display:flex !important` 槽锚，特异度 (0,4,1) > 通配条且写在其后）；「+」命令菜单 / 权限选择维持隐藏；守卫二次反转 + Y-7 用例同步。详见 STATUS §4 CV-298。
- **卡内接管追加（2026-10-06，讨论拍板 1+2+3 后落地）**：上一轮列为「不可修」的「参考内容方框在卡外」**闭环**——机制探查实证 SlotCore 单占槽语义原生支持接管：不同优先级 = 合法遮蔽（低者渲染，同优先级才抛错，报错文案亲自指路）。**动态桥**（index.ts）：`slots.inject('conversation.input.attachments', ...)` 内以 store 订阅驱动——首页以 `priority: -1` 注册本插件条目遮蔽宿主 ui-attachment 条（卡内画「暂存缩略图 + 宿主遗留草稿图 + 参考内容方框」，演示位置），进项目 dispose 退位、宿主条目自动回为 winner——**work 态零变化、零上游 import**（不打包宿主组件，版本不耦合）。**遗留草稿图转显**（讨论点 2，验收截图「田祝融」场景）：宿主草稿跟会话走、回首页不清空、发送时会被一起带出去——接管后由本组件用槽 runtime props（`attachments` 自带 previewUrl + `onRemoveImage` 宿主回调）接着画，消除「首页看不见、发送却带上」的显示-语义背离。几何改卡内（16px 对齐 textarea 文字缘，竖向交给卡片 flex gap）。守卫：host-boundary 补 attachments 行 + 红线④放宽为「沿祖先链找到 slots.inject 即算受守」（惰性注册词法上在 inject 回体里但非直接箭儿子，纪律本意不变）+ lobby-stash 接线/样式组改锚（退位语义/转显三断言/卡内几何）。**验证**：`yarn check` 全量 ✓（1326+ 条 0 失败）。真机验收关注：首页↔项目切换的条目交接（理论上最多一帧空隙，切换瞬间条内容为空）
- **验收反馈续二（2026-10-06，通道统一 + 悬停预览）**：① **资产库出口按态二选一**——首页从资产库引入的资源此前走详情抽屉「引用到对话」插进正文（读作蓝色名字链接 chip，与本地文件的缩略图通道不一致）；改为首页（onStashAsset 在场）只给「暂存为参考内容」（fetch 媒体→File→既有暂存链路→缩略图），「引用到对话」退回项目态专属（真引用 chip 的正路）。② **悬停预览**：图片/视频缩略图悬停时在缩略图**下方**弹出 240×160 放大预览（条在卡片顶部，往上弹会越出卡片）——结构三层：外盒只做锚、`.csLobbyThumbClip` 内层管 58px 圆角裁切（外盒不再 overflow hidden，否则浮层被吞）、`.csLobbyThumbPeek` 浮层 pointer-events:none 不挡交互；**视频悬停期间静音循环播放**（进 play/出暂停归零，muted 自动播放是浏览器允许路径，reject 静默吞掉）；音频/文本无预览（靠 title 读数）。宿主遗留草稿图同一份预览（previewUrl 转显）。守卫：配对清单 +3 类、接线组 +悬停预览三断言。**验证**：`yarn check` 全量 ✓（0 失败）
- **验收反馈续三（2026-10-06，预览方位 + 快捷键脚注）**：① 悬停预览翻到缩略图**上方**（bottom: calc(100%+8px)）——往下会压住正在输入的正文；已核实宿主卡自身无 overflow（裁切只在卡内 .scroll/.backdrop），浮层向上越出卡片合法，盖住的是 hero 引导区且鼠标离开即消失。② **「Enter 提交 · Shift + Enter 换行」脚注行闭环**（此前误判不可修）：换行能力是宿主既有行为（InputBar 对 Shift+Enter 无条件放行为原生换行，Enter 进提交流程），缺的只是提示；落点用**槽锚 + ::after 伪元素**（`[data-composer-card]::after`，与 data-cs-send 药丸同族手法）——hero 态卡片下方没有槽位，但 composerHero 的 32px 底部留白正好放下这行（absolute 不占布局、卡片高度不变、pointer-events none）。文案只留前半句（演示原句后半是演示文档自述）。守卫固化：脚注行存在性 + 文案 + 预览方位（写回 top 即回归）。**不可修清单收敛**：仅余 placeholder 文案（上游 i18n，三条插件侧路径已排死，记 upstream 反馈项）与药丸紫橙（预设差异）。**验证**：`yarn check` 全量 ✓（0 失败）
---

### REQ-029 ｜ 画布 image 节点设计与交互（别名 R-P0-14 · P0 · 资料：已排期/2026-10-07，10-06 增量）
- **优先级**：P0
- **状态(资料库)**：已排期（2026-10-06 增量）
- **资料库别名**：R-P0-14
- **归属模块**：Client 画布节点 UI
- **关联 CV**：CV-281（五步落码）、CV-283（验收前修正批）、CV-284（自然像素，与 REQ-031 共用）、CV-285（chrome 比例补偿，与 REQ-031 共用）、CV-286（交互三项修正，与 REQ-031/REQ-004 共用）
- **需求描述**：画布 image 节点的设计和交互，附图与附件 HTML 有详细交互演示和 UI 组件。
- **图证/附件**：`assets/library-2026-10-06/image-node.png`、`image-node2.png`、`canvas-imagenode-inputbox.html`。
- **交互方案拆解（HTML 演示解读）**：
  - **节点工具栏**（悬停出现）：引用到对话 / 添加到资产库 / 预览 / 下载。
  - **节点输入框**（文生图/图生图）：参考图托盘三来源（本地上传 / 选择资产 / 画布导入），**上限 4 张超出拦截**（1/4 计数），悬停放大镜预览、× 移除；底栏 chips：生图模型（Lib Image 推荐·20 / GPT Image 2·40 / Hy Image 3.5·10 / Krea 2·30，数字为单张基础积分，按画幅与参考数结算）、图比例（8 种 + 1K/2K +12 积分）、风格（提示词前缀注入，可与摄像机叠加不计费）、摄像机；提示词超 5 行框内滚动；积分实时合计（余额展示，失败自动退回）。
  - **摄像机控制**：相机（潘那维申 DXL2 / ARRI Alexa LF）/ 镜头（阿莱大师定焦）/ 焦距（35mm）/ 光圈（f/4）四列；参数作标记挂输入框与预设风格叠加；支持重置与总开关。
  - **画布手势**：左键拖动平移、滚轮光标中心缩放 25%~400%、单击开输入框与工具栏、双击复位 100%、点空白收起全部 UI；选中图片时输入框卡淡出。
- **项目关联**：与 REQ-003、REQ-020、REQ-004 同属画布交互层（滚轮缩放语义需与已拍板方案对齐）；参考图 ≤4 上限须与「参考素材通道跨模态 ≤12」守卫核对口径；生图模型四选与 REQ-012/013/014 路由决策联动；**积分消耗展示为新增商业化能力**（与 REQ-030 Credits 同源）。
- **前置分析（2026-10-06，未开工）**：资料完备度高（两图 + 交互演示 HTML，模型四选/积分结算/摄像机四列/画布手势全在演示内）。**开工闸门（4 项）**：
  - ① **手势层重构 vs 已验收画布手势**：演示重定义核心手势（滚轮光标中心缩放 25%~400%、双击复位 100%、点空白收起全部 UI、单击开输入框与工具栏），而现有画布已有一套被守卫钉住的语义——滚轮缩放已存在（光标中心）、单击空白=清选（框选退役拍板）、双击节点=详情/播放/大图预览（CV-044）、血缘生命周期绑手势（CV-186）、整理布局（CV-185/223）。需先出**手势语义对照表**拍板合并口径，否则与守卫打架。
  - ② **生图模型四选 + 后端对拍**：演示模型名（Lib Image / GPT Image 2 / Hy Image 3.5 / Krea 2）与后端 0.8.0 实际端点对不上（image 族现为 qwen-image withtxt / krea2 / image2image / image2fix）；且 REQ-025 / CV-278 已拍板**自动路由**（含文字→Qwen 一步直出）——「手动四选」与「自动路由」谁赢需拍板；图比例演示 8 种 vs 后端 enum 仅 16:9/9:16/1:1 三种；「1K/2K +12 积分」vs 现有分辨率三档 480p/736p/2k。照 CV-268/269 惯例先做后端对拍。
  - ③ **积分/计费**：单张基础分、按画幅与参考数结算、余额展示、失败自动退回——无商业化后端（与 REQ-030 Credits 同源闸门；占位可做 UI，退回语义做不了真）。
  - ④ **同表面拍板合并**：CV-273「参考位 UI 三段式」（待拍板）与本需求的参考图托盘（三来源+≤4 拦截）是**同一块表面**，须合并成一次拍板；另需定义与已验收就地浮层（REQ-003 CV-265~267 `.csNodePromptPanel`）的关系（替换 or 扩展）。
  - **对齐项（无需闸门）**：参考图 ≤4 与 CV-189（image2image 四槽）对齐 ✓；跨模态 ≤12 守卫（`H3_MAX_TOTAL_FILES`）口径可核 ✓；节点工具栏四项能力基本已存在（引用到对话 CV-114 / 加入资产库 CV-255 F1 / 预览 CV-044 / 下载 `canDownloadNode`）✓；风格/摄像机 = 提示词前缀注入（本地可实现，落 prompt-writing 纪律）✓。
  - **可先行小步（不依赖闸门）**：节点工具栏四项、悬停放大镜预览、提示词超 5 行框内滚动。
- **拍板（2026-10-07，与 REQ-031 合并一次拍，用户逐项选定）**：
  - **① 手势**：双击节点 = 播放/详情保留（CV-044/BUG-028 不动）；**双击空白 = 复位 100%（新增，补守卫用例）**；单击空白 = 清选 + 收起打开中的 UI（叠加）；缩放范围维持 10%~500%（演示 25%~400% 让步，演示文档按现状口径修正）。
  - **② 模型/档位**：生图模型**默认自动路由 + 高级展开手动指定**（REQ-025/CV-278 自动路由为主；高级面板用后端真实能力名「自动 / 文字渲染 Qwen / Krea 2 / 图生图 / 文字修复」，演示四模型名不落地）；图比例**先上 3 种**（16:9/9:16/1:1；清单数据驱动，后端扩 enum 时加配置，届时先对拍）；清晰度可见名**产品化**（480P/720P/1080P，720P↔736p、1080P↔2k 就近映射，内部键 480p/736p/2k 不动；BUG-053 修复方向 = agent 可见口径同步）。
  - **③ 积分**：纯展示占位——消耗合计前端按基准分估算（标「预估」）、余额静态占位、升级套餐 disabled/跳设置、失败自动退回不上（REQ-030 Credits 卡同方案）。
  - **④ 同表面**：就地浮层**替换 + 迁移分批**（节点输入框卡成唯一编辑面；CV-272「改提示词」两入口改开输入框卡；CV-265~267 三段式参考区能力分批迁入，迁完 `.csNodePromptPanel` 退役）；**CV-273 并入本需求**随验收收口。
  - **还原纪律（用户要求）**：实现须对 `canvas-imagenode-inputbox.html` + 两图 **1:1 精准还原（布局/颜色/交互）**；拍板口径优先于演示冲突点。
- **验收前修正批三（2026-10-08，**CV-286 画布交互三项修正**，已落码·待桌面验收；用户桌面验收反馈两问题 + 一项调优，**两项拍板口径随之修订**）**：
  - **修订四 · 单击空白才清选（拍板② 字面兑现 + 实现重定）**：推翻「按下即清选」实现 —— 拖拽第一帧就触发清选联动轴（工具条/输入卡当帧卸掉），用户反馈「拖画布时节点菜单和编辑框消失」。现：pointerdown 只起手 pan 并逐帧累计 `movedDist`，pointerup 时 `≤ CLICK_CLEAR_SLOP(5px)` 且左键无修饰键才清选 + 清边选（2026-09-13「阈值太紧清不掉」教训由 5px 宽容档兜住，累计制防拆步拖动骗过阈值）；**拖拽全程保留选区** ⇒ 工具条/卡跟节点走，移出视野由既有 visible/E7 判据退场。minimap 同款：prop 改名 `onSurfaceClick`，按下只记位、mouseup 未拖过阈值才代清选。
  - **修订五 · 双击口径重定（拍板① 推翻 + CV-283 修订二 再修订）**：**双击空白 = 无操作**（旧 `resetZoom` 钉世界原点 {0,0,1}、与点击位置无关 —— 用户反馈「不管点哪里都到同一个位置」的根因；容器 `onDoubleClick` 移除）；**image/video 双击 = 该节点移到视口正中 + 100%**（不再放行冒泡：`stopPropagation + onCenterNode` → 新纯函数 `canvas-view.centerViewOf`，lib 实测）；**工具栏「1:1」= 保持视口中心世界点回 100%**（`cx − world.x`，同根因顺手修，现存 resetZoom 唯一调用方）。audio 播放 / 文本编辑 / 详情语义不动，预览仍走工具条。
  - **连带 · 滚轮灵敏度（REQ-004/R-P2-01，用户调优项）**：因子从「每事件固定 ×1.2」改**按滚动量指数化** `exp(−deltaPixels/800)`（`WHEEL_ZOOM_DIVISOR`，含 deltaMode 行/页换算）—— 触控板高频小增量连乘爆炸（20 事件 ≈ ×38）的根因消除；鼠标每格 ≈×1.13 略降（「稍微降低」）。
  - 守卫：`canvas-gesture-req029` 重写 **6 用例**（双击空白无操作 + 1:1 中心保持 / image/video 居中接线 + `centerViewOf` lib 实测 / pointerup 单击清选 + pointerdown 不清负断言 + minimap 同款 / 缩放范围 / 滚轮指数化）+ `manual-wiring`「拖画布起手清边选」断言随语义改；`test:smoke` **1381/1381、基线 0**。
- **验收前修正批二（2026-10-08，**CV-285 chrome 比例补偿 · 方案 A**，已落码·待桌面验收；验收反馈「效果图 100% 下菜单/卡偏小」的比例根因修正）**：
  - **根因**：演示节点恒 620px（角标尺寸是装饰文字），chrome 绝对 px 按 620 基准调；CV-284 自然像素节点下比值 = 620/图宽（1280 → 0.48）。
  - **方案 A 落地**：`chromeScaleOf = clamp(节点宽/620, 0.75, 4)`；卡/条视觉比例 = z×k、间隙同乘 k、工具条按视口封顶、卡布局宽反推 ≤92% 可视区（不缩字号）；`CHROME_CARD_WIDTH` 落 canvas-aspect（preview-tokens 插值纪律）。**否决方案 B**（节点封顶会破坏 100%=真实像素并回退 v5 迁移）。
  - 守卫 +2（lib 实测）三处跟改；`test:smoke` **1379/1379、基线 0**。
- **验收前修正批（2026-10-08，CV-283 + CV-284，均已落码·待桌面验收；对照 `canvas-imagenode-inputbox.html` 对拍 CV-281 五步的落地偏差，**三项拍板口径随之修订**）**：
  - **修订一 · 卡/工具条间隙 = `12×z`**：`CHROME_GAP = 12`（`canvas-view.ts` 唯一源，卡 `top = nodeBottom + gap×z`、工具条同源）——推翻「顶边紧贴节点下沿」的 0 间隙 loose 文案（演示注释写紧贴、实际留白 ~12px），image/video 同效。
  - **修订二 · image/video 双击 = 视图复位 100%**：推翻拍板①「双击节点 = 播放/详情保留」——`CanvasNode.handleDoubleClick` 对 image/video 在 stopPropagation **之前**放行冒泡 → 画布根 `resetZoom()`（与双击空白同语义）；audio 仍播放（CV-044 保留），预览/详情统一走工具条（`onOpenPreview` prop 退役）。拍板①其余两项（双击空白复位、单击空白清选+收起）不变。
  - **修订三 · 工具条与输入框卡同框共存**：推翻拍板④/CV-281 Step2 的「同一时刻一个编辑面 → 开卡退场」互斥口径——`CanvasSurface` 同框条件放开（删 `cardNodeId === null`、`bottomInset` 退役）；按钮 = image 四项「引用到对话 / 添加到资产库〔新增，`onNodeAddToLibrary`→`setLibImportNodeId`〕/ 预览 / 下载」、video 三项（`isMedia` 判据），重试/改提示词对媒体退场。
  - **连带 · CV-284 画布自然像素**：image/video 节点 100% 视图 1 CSS px = 1 真实像素（退役「长边 480」压图规则）——`previewSizeOf` 改自然像素（保 60 等比地板）+ 文档 v5 `migrateNaturalMediaSize`（480 指纹迁移，用户框/锁定/缺分辨率不碰）+ 媒体 resize 锁画面比例 + `FIT_MIN_SCALE` 0.1 + arrived 装不下走 `revealNodesOrFit`；`client/index.ts` 上传落卡 previewSizeOf 误用顺手改 `frameSizeOf`。
  - **其余 CV-283 项（非拍板修订，对拍演示收口）**：砍放大态（展开钮/脏角标/居中形态退役，draft 机制保留）+ 提示词 `bare` 直编（**裸 Enter = 发送** = image 演示 L2603 口径，Cmd/Ctrl+Enter 保留，Esc 冒泡收卡，5 行封顶）+ 卡/条随画布缩放（root 独立 `scale: ${view.scale}` + `translate` 锚定，纵向只留详情抽屉顶夹）。守卫 1 新 6 改；门禁全绿（`test:smoke` **1377/1377、失败 0、基线 0**）。
  - **验收语义更新**：方案 §十 验收出口不变，但以上三项口径**以本批为准**（与演示冲突点仍按拍板优先的还原纪律）。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（CV-281 五步 + 验收前修正批 CV-283/284/285/286 + CV-288 风格库回填 + CV-273 参考位三段式并入收口；桌面逐项走查全过，`test:smoke` 1415/1415）——**过程记录**：手势层（双击空白复位/清选收起叠加/缩放维持）+ 演示 1:1 输入框卡（提示词复用 PromptEditor 同草稿表）+ 参考托盘转真（画布/资产来源、超限拦截、放大镜接 CV-044；本地上传置灰〔偏差〕）+ 底栏 chips 转真（模型高级三选〔host 路由消费〕、比例 3 种+档位产品化、风格/摄像机前缀注入、积分预估占位、发送接既有重试链路）+ **Step 5 替换收口**（CV-272 两入口与单击节点都打开输入框卡；`NodePromptEditor`/`.csNodePrompt*`/`editorPlacement` 退役删除，退役能力清单见方案 §九）。验收出口 = 方案 §十（逐组件截图对照演示 + 一次生成成功 + 手势全项 + `yarn check` 全绿）；**验收前修正批 CV-283/CV-284/CV-285/CV-286（2026-10-08）已落码待验收**（三项拍板修订：12×z 间隙 / image+video 双击=视图复位 / 工具条同框共存；连带画布自然像素，详见上方「验收前修正批」段；CV-286 批追加（单击才清选 / 双击空白无操作 + image/video 居中 100% / 1:1 中心保持 / 滚轮指数化，详见上方「验收前修正批三」段）；`test:smoke` **1381/1381**（此前 1377/1377）。
---

### REQ-030 ｜ 按设计实现项目左侧菜单和布局（别名 R-P0-15 · P0 · 资料：已排期/2026-10-07，10-06 增量）
- **优先级**：P0
- **状态(资料库)**：已排期（2026-10-06 增量）
- **资料库别名**：R-P0-15
- **归属模块**：canvas-studio client 左栏（`.csProjects` / ProjectList 一族；2026-10-06 归属勘误，原误记 dsh-plugin-desktop）
- **关联 CV**：—
- **需求描述**：按设计实现项目左侧菜单和布局。
- **图证/附件**：`assets/library-2026-10-06/项目左侧栏菜单和布局.png`；拍板体验演示稿 `plans/REQ-030-左侧菜单布局交互演示.html`（2026-10-07 自建，四项口径可切换）。
- **设计稿拆解**：左侧固定窄栏——顶部品牌 logo + 折叠按钮；「+ 创作」主按钮；菜单项：灵感、技能、资产；「项目」分组（可 + 新建）按项目列出；底部 Credits 额度（0 / 1,000）+「升级套餐」按钮 + 当前用户信息。
- **项目关联**：全局应用框架布局，与 REQ-005 品牌区回首页同层衔接；「技能」入口对应 skills 系统、「资产」入口对应全局资产库（REQ-001）；Credits 为新增商业化能力（与 REQ-029 积分展示同源）。**归属勘误（2026-10-06 前置探查）**：本需求改动面在 **canvas-studio client**（左栏 = 本插件 `.csProjects` 栏，ProjectList 一族），**不是** dsh-plugin-desktop —— 实证 `dsh-plugin-desktop/src/client/advanced-shell.ts:45`：「The top-level `root` seat is owned by Canvas Studio in this product build (its StudioFrame mounts the whole studio UI)」，desktop host 只管高级 chrome 并让出 root。
- **前置分析（2026-10-06，未开工）**：设计 ↔ 现状映射——logo+折叠（已有：`.csBrandHeader` 即回首页入口 + R8 收起态 56px 轨道）；「＋ 创作」大主按钮（重做：现有两个新建入口跳首页，D4 入口唯一需重排）；菜单三项（技能/资产=搬现有入口；**灵感=全仓无对应物**）；「项目」列表 + 底部用户信息（UserCard 已有）；Credits+升级套餐（**无后端无数据源**）。
- **开工闸门（4 项拍板）**：① **分组体系去留**——CV-091 用户自定义分组（组头折叠/组菜单/项目行菜单）是已验收功能，设计图为扁平「项目」列表；砍=功能回退、留=与设计图不符（推荐解读：设计图「项目」头即分组区标题，分组保留）。② **「灵感」指向**——回首页（与 logo 重复）/ 技能广场分区 / 预留占位。③ **Credits 数据源**——纯展示占位（静态值+升级套餐 disabled 或跳设置）或等商业化后端（REQ-029 同源闸门）；占位不阻塞。④ **折叠语义确认**——设计图右上折叠钮是否即现有 R8 收起态。
- **闸门③已拍（2026-10-07，随 REQ-029/031 合并拍）**：Credits **纯展示占位**（前端估算标「预估」/余额静态/升级 disabled 或跳设置）；①②④ 仍待拍板。
- **设计资料缺口（建议补，非硬闸）**：仅一张静态 png，无设计侧像素级演示（REQ-028 有像素级 HTML）；hover/选中态、空态（无项目时）、窄窗口降级未定义——拍板体验演示稿已补（2026-10-07，见下），未定义态按「沿用现有交互惯例 + 偏差登记」默认处理。
- **可先行小步（不依赖拍板）**：logo 行/折叠（复用 R8）、「＋ 创作」主按钮替换新建入口、三项菜单（技能/资产接现有页、灵感暂指首页）、底部 UserCard 保留；Credits 卡纯展示占位。
- **拍板体验演示稿（2026-10-07）**：`plans/REQ-030-左侧菜单布局交互演示.html`（自包含单文件，浏览器直接打开）——把四项开工闸门做成右侧「拍板面板」实时切换，供拍板前体验；**非实现事实源**（1:1 还原仍以资料库设计图 + 拍板口径为准）。使用方法：① 面板逐项切换 ①分组体系 / ②灵感指向 / ③折叠语义 / ④项目行形态，左栏实时变形，顶部横幅显示当前组合；②「套用推荐」一键回 ①A ②A ③A ④B；③「预览设计图原始态（清空分组）」看设计图扁平形态；④组头折叠 / 双击重命名 / 段头「＋」新建分组 / 行 hover kebab / 技能与资产示意浮层均为真交互；⑤选择存 localStorage 刷新不丢。已定口径（Credits 占位、＋创作跳首页、技能/资产纯增量、段头刷新摘除、未定义态沿用惯例）列在面板底部。
- **拍板口径（2026-10-08，用户回复「①A ②A ③A ④C」，按演示稿面板编号）**：①A = 分组保留、未分组平铺在「项目」标题下（不渲染「未分组」小节头），平铺区与分组区以分隔线隔开；②A = 菜单「灵感」置灰占位「即将上线」不可点；③A = 折叠复用现有 R8 收起态（RailStrip 零改动）；④C = 项目行保持现状形态（folder 图标 / 封面副行改法均不做）。随拍板一并生效的已定口径：Credits 纯展示占位（0/1,000 静态 + 升级套餐 disabled「即将上线」）、「＋创作」跳首页（D4 入口唯一）、技能/资产接既有浮层（SkillMarket / AssetLibraryPage 纯增量）、段头「刷新」摘除、未定义态沿用现有惯例。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（CV-286，2026-10-08；验收出口全过：左栏视觉对照设计图 + 拍板组合 ①A②A③A④C 逐项核对 + 新建/建组/菜单/折叠/Credits 五条交互走查）——**过程记录**：StudioFrame 左栏骨架重排（＋创作按钮 / 菜单三项 / Credits 卡）；ProjectList 段头移交（「项目」+「＋」新建分组）+ 未分组平铺 + `csProjectFlatDivider`；styles.ts 新增 `csRailCreate` / `csRailMenu*` / `csCredits*` / `.csProjectFlatDivider`，清退 `.csProjectNew` / `.csProjectListActions` 死规则；preview-rail / preview-groups 骨架与断言同步。验证：build + verify:loader 绿、定向 71/71（visual-tokens 新增 REQ-030 守卫，反向变异实证变红）、preview-rail 暗/浅 + preview-groups 无头复跑 `data-pv-fail=0`。**桌面验收出口**：左栏视觉对照设计图 + 拍板组合（①A ②A ③A ④C）逐项核对 + 新建/建组/菜单/折叠/Credits 五条交互走查。STATUS/backlog 登记随本次收口（2026-10-13）。
---

### REQ-031 ｜ 画布 video 节点的设计和交互（别名 — · P0 · 资料：已排期/2026-10-07）

- **优先级**：P0
- **状态(资料库)**：已排期（2026-10-07 迭代新增；「编号」列空，无别名）
- **资料库别名**：—
- **归属模块**：Client 画布节点 UI（与 REQ-029 image 节点同源）
- **关联 CV**：CV-282（五步落码）、CV-283（验收前修正批）、CV-284（自然像素，与 REQ-029 共用）、CV-285（chrome 比例补偿，与 REQ-029 共用）、CV-286（交互三项修正，与 REQ-029/REQ-004 共用）
- **需求描述**：画布 video 节点的设计和交互，见附图和附件 html，有详细的交互演示和 UI 组件。
- **图证/附件**（2026-10-07 拉取入库）：`assets/library-2026-10-07/video-node.png`（节点卡 + 输入框主态）、`video-node2.png`（运镜面板）、`video-node3.png`（节奏面板）、`canvas-videonode-inputbox.html`（交互演示，167KB 像素级）。
- **交互方案拆解（HTML 演示解读）**：
  - **节点卡与工具栏**（悬停出现）：引用到对话 / 添加到资产库 / 预览 / 下载；空态居中播放图标 + 「点击节点选中，输入你的创作需求」；右上角「16:9 · 5s · 720P」角标；生成中显示进度环（「生成中 0%」）。
  - **节点输入框**：顶部模式 Tab **首尾帧 / 全能参考**（+ 音频开关）；参考素材三来源（＋本地上传 / 选择资产 / 画布导入），悬停缩略图放大镜预览、× 移除、音频可试听；**上限 图片 9 · 视频 3 · 音频 3**（计数 0/9、0/3、0/3）；提示词框占位「描述画面与动作，并说明参考素材该怎么参与…」。**首尾帧模式**：给首帧与尾帧、AI 补齐中间过程，仅首/尾帧也可生成。
  - **底栏**：模型 / 清晰度·比例·时长 / 风格 / 运镜 / 摄像机 + 积分（示例 ✨34）+ 发送。**生视频模型**：MiniMax H3（首尾帧/全能参考·支持音频·最长 15s·20 基准积分）/ SeedDance 2.0（稳定叙事·10s·16）/ SeedDance 2.5（旗舰画质·15s·24）；「数字为基准积分；时长、清晰度、参考素材与音频会另行结算」。**清晰度** 480P / 720P / 1080P；**时长** 4s~15s；**风格** = 提示词前缀注入，可与摄像机叠加、不额外计费。
  - **运镜**（面板 grid）：卡片点击插入提示词，悬停看演示视频、浮标「添加到提示词」，建议一 Shot 一运镜（胸前斯坦尼康 / 机械臂 / 上摇 / 焦点转移 / 下摇 / 主观视角 / 左摇 / 摇臂上升…）；运镜以 chip 形式进提示词，可拖拽调位、× 或退格删除。
  - **节奏**（面板轮播）：决定分镜 Shot 数量与切换频率，5 档（自动 + 常规快切「动感 Dynamic」…），左右箭头切换。
  - **摄像机**：开启后机型/镜头/焦段/光圈作前缀注入，悬停看说明；默认潘那维申 DXL2 · 阿莱大师定焦 · 标准 50mm · 中光圈 · 固定机位；支持重置参数与总开关。
  - **积分与选材**：本次消耗合计、余额 2,860 积分 · 生成失败自动退回；**选择素材弹窗**：图片/视频/音频分类、已选 x/x、取消 / 确认添加。
  - **画布手势**：左键拖动平移画布（按下变小手）、滚轮以光标为中心缩放 25%~400%、单击节点打开输入框与工具栏、双击节点视图复位回到 100%、点空白处收起全部 UI；点「收起」让出画布，选中节点时本卡自动淡出。
- **项目关联**：与 REQ-029（image 节点）并列，构成画布节点交互设计的两块表面；与 REQ-020（手动连线）/ REQ-004（鼠标操作）/ BUG-028（双击播放）/ BUG-047（末帧辅助态）同源层。**归属勘误**：改动面在 canvas-studio client（画布节点 UI），非 dsh-plugin-desktop。
- **前置分析（2026-10-07，未开工）**：资料完备度高（三图 + 交互演示 HTML，模式 Tab / 参考三来源 / 模型三选 / 运镜 grid / 节奏 5 档 / 摄像机四列 / 画布手势 / 积分结算全在演示内）。**开工闸门（与 REQ-029 同套 4 项）**：
  - ① **手势层重构 vs 已验收画布手势**：演示重定义核心手势（滚轮光标中心缩放 25%~400%、双击节点视图复位 100%、点空白收起全部 UI、单击节点开输入框+工具栏），而现有画布已有被守卫钉住的语义（滚轮缩放已存在、单击空白=清选、双击节点=详情/播放/大图预览 CV-044、血缘生命周期绑手势 CV-186、整理布局 CV-185/223）。需先出**手势语义对照表**拍板合并口径，否则与守卫打架。
  - ② **生视频模型三选 + 后端对拍**：演示模型名（MiniMax H3 / SeedDance 2.0 / SeedDance 2.5）与后端实际端点对不上（video 族现为 `image2videofl2va` / `image2videoref2va`，即 H3 首尾帧/全能参考）；**清晰度 480P/720P/1080P vs 现有分辨率三档 480p/736p/2k**——与 **BUG-053**（agent 试探 720p）同源，须一并定档位口径；时长 4s~15s、按参考素材/音频另计费 vs 现状需对拍。照 CV-268/269 惯例先做后端对拍。
  - ③ **积分/计费**：单次消耗合计、余额展示、失败自动退回——无商业化后端（与 REQ-029/030 Credits 同源闸门；占位可做 UI，退回语义做不了真）。
  - ④ **同表面拍板合并**：video 节点输入框的参考位/工具栏与 CV-273「参考位 UI 三段式」、已验收就地浮层（REQ-003 CV-265~267 `.csNodePromptPanel`）的关系需定义；且 **video 与 image 节点输入框实为同一组件的两种形态**，建议与 REQ-029 合并成一次拍板。
  - **对齐项（无需闸门）**：演示「首尾帧 / 全能参考」两模式 = 现有 `image2videofl2va` / `image2videoref2va` 对齐 ✓；节点工具栏四项基本已存在（引用到对话 CV-114 / 加入资产库 CV-255 F1 / 预览 CV-044 / 下载 `canDownloadNode`）✓；video 特有（双击播放 BUG-028、末帧辅助态 BUG-047）已落地 ✓；风格/摄像机/运镜 = 提示词前缀注入（本地可实现，落 prompt-writing 纪律）✓。**待核**：演示音频独立槽位 0/3 vs 参考素材通道「音频不能唯一、视频可以」守卫（`H3_MAX_TOTAL_FILES`）口径。
- **可先行小步（不依赖闸门）**：video 节点工具栏四项、悬停预览、播放弹层手势优化。
- **拍板（2026-10-07，与 REQ-029 合并一次拍，用户逐项选定）**：
  - **① 手势**：同 REQ-029 三项口径（双击节点 = 播放/详情保留、双击空白 = 复位 100% 新增、单击空白 = 清选+收起、缩放维持 10%~500%）。
  - **② 模型/档位**：**三选保留、未上线置灰**——MiniMax H3 可选（首尾帧/全能参考两 Tab 承载 `fl2va`/`ref2va` 端点差异），SeedDance 2.0/2.5 置灰标「即将上线」；清晰度可见名产品化（同 REQ-029，BUG-053 同批修）；时长 4s~15s 沿用 `H3_VIDEO_*` 现有校验。
  - **③ 积分**：纯展示占位（同 REQ-029 ③）。
  - **④ 同表面**：video 与 image 输入框**同组件两形态**，REQ-029 image 先行立基座、video 作扩展形态迁入；浮层替换口径同 REQ-029。
  - **参考上限（对齐确认，非拍板）**：UI 显示 9/3/3 分类计数，合计超 12 提交前拦截（`validateH3ReferenceBudget` 现设计即如此）；音频不能唯一沿用官方硬规则（`audio-reference.ts` 已有校验）。
  - **还原纪律（用户要求）**：对 `canvas-videonode-inputbox.html` + 三图 **1:1 精准还原（布局/颜色/交互）**。
- **拍板第二批（2026-10-07，实施层四项，用户逐项选定；背景事实：运镜词库已有 `cinematic-moves` skill〔CV-274〕，节奏在后端无对应参数——分镜/agent 层语义）**：
  - **① 节奏**：**前缀注入**——5 档文案取演示，写参数走注入通道（与风格/摄像机同类；后端无分镜参数，不虚构能力）；
  - **② 运镜**：**skill 词库 + 文本插入**——网格数据源复用 `cinematic-moves` 的 cinematic-vocabulary 分册，点击把运镜短语插入提示词（退格可删）；悬停演示视频置灰（无素材，偏差登记）；「一 Shot 一运镜」为纪律提示；
  - **③ 进度环**：**环动画 + 「生成中…」无假百分比**（后端 202+轮询只有状态无进度回调；跟演示的「生成中 0%」偏差登记）；
  - **④ 时长**：**预设六档 4/6/8/10/12/15s**（写 `duration` 参数，Host `clampDuration` 既有消费点；对齐官方 2~15s 与 `maxVideoSeconds` 钳制）。
  - **随批确认（无需拍板的机制项）**：~~音频开关 = 音频槽位显隐~~ **实施期修正（CV-282 Step 1 盘点）**：头部「音频」chip = **原生音频开关**（`generateAudio` 布尔参数，演示计费行「原生音频 8」；Host 侧现为占坑参数），与托盘音频参考槽（`audioRefs` 0/3）是两回事；首尾帧模式 = fl2va `filename`/`filenameTail` 双单值槽（仅首/尾也可生成，`channel` 参数显式通道）；全能参考 = `filenames` ≤9 + `videoRefs` ≤3 + `audioRefs` ≤3；选择素材弹窗按图/视频/音频分类；节点卡角标读参数；空态播放图标。已拍口径全部沿用：手势三项 / 模型三选保留未上线置灰 / 档位产品化 / 积分占位 / 9-3-3+合计 12 / 同组件两形态。
- **方案（2026-10-07，待用户审核，审核前不开工）**：[plans/REQ-031-画布video节点交互方案.md](./plans/REQ-031-画布video节点交互方案.md)——**反遗漏核心 = §四功能点对照总表**（演示逐元素盘点 F1~F30 + H1~H7 全量编号，每点映射 Step 与守卫/偏差）；五步实施（1 托盘形态化+模式 Tab → 2 底栏 chips → 3 影片设置面板〔运镜 33 词条/节奏轮播〕→ 4 host 注入泛化 → 5 节点卡 video 态+收口）。**盘点关键发现**：① 演示提示词是 contenteditable token 系统（运镜 chip 可拖拽内嵌）——拍板②文本插入是最大架构偏差，已亮明；② 运镜词库修正 = 一比一转录演示 33 条 Higgsfield 官方预设（中英文名），`cinematic-moves` skill 是纪律文档非结构化词库，改作 agent 侧纪律两者不打架；③ video 工具栏实际 3 项（无「添加到资产库」，拆解文档的 4 项是说明文案复述）；④ 演示时长是滑杆（拍板④六档为偏差）。
- **方案已审核通过（2026-10-07，用户：方案可行 + 一处修正「托盘上沿紧贴节点下沿」）**。
- **验收前修正批三（2026-10-08，**CV-286 画布交互三项修正**，已落码·待桌面验收；与 REQ-029 同批，两项拍板口径同修）**：video 节点同吃三项 —— 双击 = **居中 + 100%**（`centerViewOf`，替代「视图复位」放行冒泡）、**单击空白才清选**（pointerup ≤5px 判定；拖拽保留选区，工具条/输入卡不再在按下瞬间消失）、滚轮**指数化降灵敏度**（`exp(−δ/800)`）；工具栏「1:1」保持视口中心。守卫 `canvas-gesture-req029` 重写 6 用例 + `manual-wiring` 连带 1 处；`test:smoke` **1381/1381**。
- **验收前修正批二（2026-10-08，**CV-285 chrome 比例补偿 · 方案 A**，已落码·待桌面验收；与 REQ-029 同因同修）**：video 节点同吃 `chromeScaleOf`（z×k 视觉比例 + 视口封顶 + 卡布局宽反推），F4 工具栏/输入卡在 100% 下与效果图比值对齐；守卫随改（`canvas-video-tray-req031` 托盘上沿 ×effScale）。
- **验收前修正批（2026-10-08，CV-283 + CV-284，均已落码·待桌面验收；与 REQ-029 同批，对照 `canvas-videonode-inputbox.html` 对拍，**三项拍板口径随之修订**）**：
  - **修订一 · 托盘/卡/工具条间隙 = `12×z`**：推翻 CV-282 Step1 ⑤「托盘紧贴节点下沿（0 间隙）」的 loose 口径——`CHROME_GAP = 12`（`canvas-view.ts` 唯一源）image/video 同效（两份演示注释写紧贴、实际留白 ~12px）。
  - **修订二 · video 节点双击 = 视图复位 100%**：推翻拍板①「双击节点 = 播放/详情保留」——video 与 image 同语义（`handleDoubleClick` 放行冒泡 → `resetZoom()`）；audio 保留播放；预览走工具条。
  - **修订三 · 工具条与输入框卡同框共存**：推翻「开卡退场」互斥口径——CV-282 Step5 F4「video 三项工具栏（引用到对话/预览/下载）」改为与输入框卡同框（`isMedia` 判据，重试/改提示词对媒体退场；`onNodeDownload` 出口保留；image 另加「添加到资产库」）。
  - **连带 · CV-284 画布自然像素**：video 节点同 image——100% 视图 1 CSS px = 1 真实像素，`previewSizeOf` 自然像素 + 文档 v5 迁移 + 媒体 resize 锁画面比例 + `FIT_MIN_SCALE` 0.1 + arrived `revealNodesOrFit`；F2 参数角标缺省值语义不变。
  - **其余 CV-283 项（非拍板修订）**：砍放大态 / 提示词 `bare` 直编（**裸 Enter = 发送** 采 image 演示口径，video 演示的 Cmd+Enter 不采纳）/ 卡/条随画布缩放。守卫 1 新 6 改；门禁全绿（`test:smoke` **1377/1377、失败 0、基线 0**）。
  - **验收语义更新**：方案 §九 验收出口不变，但以上三项口径**以本批为准**。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（CV-282 Step 1~5 + 验收前修正批 CV-283/284/285/286；验收出口 = 方案 §九：§四总表逐项 + 三功能各一次生成 + 运镜注入链路 + 三校验拦截 + 手势零回归，全过）——**过程记录**：**已落码待桌面验收（CV-282，2026-10-07，Step 1~5 全部落地；用户指令「三步连做」一次推进）**。**Step 1 托盘形态化+模式 Tab**（commits `24a1db3796` + 补齐源码 `213693400c`）：`form: 'image'|'video'` 配置注入（image 路径零改动）/ 模式 Tab 写 `channel` / fl 双单值槽 + omni 三分类托盘 / 原生音频开关 / 托盘紧贴节点下沿 / 发送前「音频不能唯一+合计 12」校验 / `withGenerationParam`+`generationParamOf` 助手 / 候选池按模态过滤；守卫 `canvas-video-tray-req031` 7 条。**Step 2 底栏 chips video 化**（commit `ca02be6d37`）：模型弹层 312px 三行逐字（H3 可选不写 model 参数〔占坑〕、id=`h3`——`minimax-h3` 小写连字符撞「上游 submodule 名禁用」守卫已修正；SeedDance 2.0/2.5 置灰「即将上线」）/「画幅·时长·清晰度」三段 chip（画幅 2 选=演示 ARS 与 Host CV-136 一致、**时长六档 4/6/8/10/12/15s 写 `duration` 数字参数**、清晰度内部键）/ 积分明细弹层 290px=演示 costRows 公式逐行（基准 20/时长加长 (dur−5)×2/RES_COST 0/6/14/图×2 视频×6 音频×3 首帧2 尾帧3/原生音频 8）+「本次消耗」+脚注+「预估」/ 摄像机标记 chip（cam-chip 悬停 × 移除）/ 运镜 chip 占位禁用（Step 3 接入）/ 摄像机面板抽取 `cameraPopNode` 两形态共用；守卫 `canvas-video-chips-req031` 6 条（运镜占位断言随 Step 3 转真同步改写）。**Step 3 影片设置面板**（commit `75e17ff576`）：新 `src/camera-moves.ts` = 一比一转录演示 Higgsfield 官方 **33 条运镜**（id/中文名/官方英文名逐字）+ 节奏 5 档（name/en/segs/tip 逐字）+ `pacingPrefixOf`（拍板①前缀注入，自动档 = undefined 删键）+ `parseCameraMoves`（按文本出现序去重保序）；新 `FilmSetupPanel.tsx` 双 Tab 固定高度（演示 pop-film 688px 居中）——运镜网格 4 列 + 荧光绿浮标「添加到提示词」+ 已选 accent 边与序号角标，节奏轮播（‹› 环切 + 中央大卡 + 相邻暗卡 + segs 指示条 + 档名 pill + tip）；运镜 chip 转真 = 点卡把**官方英文名追加进提示词草稿**（PromptEditor 句柄扩 `appendText`，只动草稿不写回、B4 守卫同步扩展；可重复、退格可删），已选回显从提示词反向解析（F26）；选节奏 = `commitRaw('pacingPrefix')` 即时生效无确定钮。偏差登记：演示 CSS 示意动画不迁移（DD-03 动效三语义白名单）、官方演示视频置灰（拍板②）、`.csPcCard.on` 边线走 `--cs-line-hi` color-mix（禁白色字面量守卫）；守卫 `canvas-video-filmsetup-req031` 6 条。**Step 4 host 注入泛化**（commit `1fed17b386`）：`GenerateParams` +`pacingPrefix`；`composeImagePrompt` 泛化图像/视频通用——前缀顺序 = **节奏→摄像机→风格**（导演层→摄影层→美术层，「，」连接；图像节点不写 pacing 逐字节零影响，守卫单测钉住旧序）；video 车道 `videoRequestOf` 收注入后 prompt（错误路径/台账保持原 params）；`model-route.ts` H5 注记 video 车道不消费 modelOverride；三校验调用点（音频同行/视频时长/合计 12）守卫钉住；守卫 `video-prompt-injection-req031` 4 条。**Step 5 节点卡 video 态+收口**（commit `25632d8322`）：F1 空态 = 橙色摄像机图标（#ffb066 偏差登记）+「点击节点选中，输入你的创作需求」逐字；F2 参数角标 `csNodeVideoBadge`「{画幅} · {时长}s · {清晰度}」读生成参数（缺省 16:9/5s/480p、清晰度走 resolutionDisplay 产品化名；无参数不显示、生成中让位）；F3 进度环 = `csAdvanceSpin` 旋转（DD-03 行进语义）+「生成中…」+ 副文案「MiniMax H3 · {模式} · {时长}s」（channel 反解，**拍板③无假百分比**），非 video 保持显影光带零改动、reduced-motion 降级成对；F4 工具栏 = video 三项「引用到对话/预览/下载」（重试/改提示词退出 video 工具栏——单击节点开输入框卡为唯一编辑面；`CanvasSurface` 新 `onNodeDownload` 出口，StudioFrame 复用 handleDownload）；H7 实测时长读数走既有 video metadata 通路零改动；守卫 `canvas-video-node-req031` 5 条。**两次事故留痕**：① `git stash -q` 误卷 Step 1 未提交源码 → 24a1db3796 缺 4 个 src 文件（已推 origin/dev），`213693400c` 补齐；② 本文件曾被外部覆盖为旧版本（21:30，疑似编辑器旧缓冲区保存），用户已丢弃修改、由 HEAD 恢复，账本同步无损失。`yarn check` 全绿（**1360 条 0 失败**）；**验收前修正批 CV-283/CV-284/CV-285/CV-286（2026-10-08）已落码待验收**（三项拍板修订：12×z 间隙〔推翻 Step1 ⑤ 紧贴〕/ video 双击=视图复位 / 工具条同框共存；连带画布自然像素，详见上方「验收前修正批」段；CV-286 批追加（单击才清选 / 双击空白无操作 + image/video 居中 100% / 1:1 中心保持 / 滚轮指数化，详见上方「验收前修正批三」段）；`test:smoke` **1381/1381**（此前 1377/1377）。
---

### REQ-032 ｜ 画布 audio 节点的设计和交互（别名 — · P0 · 资料：已排期/2026-10-07）

- **优先级**：P0
- **状态(资料库)**：已排期（2026-10-07 迭代新增；「编号」列空，无别名）
- **资料库别名**：—
- **归属模块**：Client 画布节点 UI（与 REQ-029 image 节点、REQ-031 video 节点同源）/ 音频管线（tts_voiceover / 音乐生成）
- **关联 CV**：**CV-287**（2026-10-09 五步落码，**2026-10-13 桌面验收通过**）
- **需求描述**：音色设计，语音生成、音乐生成组件UI，见附件 html 交互。
- **图证/附件**（2026-10-08 拉取入库）：`assets/library-2026-10-08/canvas-audionode-inputbox.html`（音频节点交互演示，110KB 像素级；无附图，仅此 HTML）。
- **交互方案拆解（HTML 演示解读）**：
  - **节点卡 = AudioNode**：标题「创意做音频 · 音色设计 画布输入框」；副标题「设计音色，语音生成，音乐生成」——图/视频/音频三类媒体节点中**音频节点**的输入框形态。空态/生成中显示进度（演示「生成中 0%」、模型 VoxCPM2 · 待生成）；工具栏悬停出现：引用到对话 / 预览 / 下载。
  - **输入框结构**：① **描述**（圆括号内自由文本，词条与手写文字混排）；② **正文**（要合成的文本；事件与方言写这里，不写进描述）。**写入方式**：只往描述里插词条、不写字段；词条可 × 删除。
  - **底栏左四按钮**：身份 / 声学 / 情境 / 语言，点开各自设置面板（面板浮在输入框上方、输入框始终可见）：
    - **身份**：性别 / 年龄 / 质感 / 气质（决定这是谁）
    - **声学**：音高 / 语速 / 音量 / 清晰度 / 腔调（怎么发声）
    - **情境**：情绪 / 语调 / 身体状态 / 场景（发生了什么）
    - **语言**：语言选择
  - **参考音色（语音生成模式）**：三种来源——本地上传 / 选择资产 / 画布导入（音频 · 单选，已选 0/1）。
  - **音乐生成模式**：开关 + **人声歌词**；未填写歌词则生成纯音乐。
  - **底栏右**：时长估算 + 生成；**试听**：生成后点节点上 ▶，波形随进度着色。
  - **工具栏 / 资产**：引用到对话 → 添加到资产库（新建资产：*资产封面 / *资产名称 / *资产分类=「音色」；或添加到已有资产）。
  - **画布手势**：左键拖动平移画布（按下变小手）、滚轮以光标为中心缩放 25%~400%、单击节点打开输入框与工具栏、双击节点视图复位回到 100%、点空白处收起全部 UI；点「收起」让出画布，选中节点时本卡自动淡出。
- **项目关联**：与 REQ-029（image 节点）、REQ-031（video 节点）并列，构成画布**三类媒体节点**（图/视频/音频）交互设计的三块表面，且三者实为「同一节点输入框组件」的三种形态（image / video / audio），建议与 REQ-031 合并拍板。与 REQ-010（拖拽音频作背景/说话参考音）、REQ-023（全局资产库增加角色音色参考）、REQ-026（微信制作方法类视频 TTS）同源层：**本节点产出的「音色」资产应与 REQ-023 资产库的「音色」分类打通**；语音/音乐生成的后端端点需与现有 `tts_voiceover` / 音乐生成管线对拍。**归属勘误**：改动面在 canvas-studio client（画布节点 UI），非 dsh-plugin-desktop。
- **前置分析（未开工）**：资料完备度高（交互演示 HTML 涵盖三模式 Tab / 四设置面板 / 参考音色三来源 / 音乐歌词开关 / 试听波形 / 工具栏 / 画布手势 / 计费全在演示内）。**开工闸门（与 REQ-029/REQ-031 同套 4 项）**：
  - ① **手势层重构 vs 已验收画布手势**：audio 节点重定义核心手势（滚轮光标中心缩放 25%~400%、双击节点视图复位 100%、点空白收起全部 UI、单击节点开输入框+工具栏），与现有被守卫钉住的语义（滚轮缩放、单击空白=清选、双击节点=详情/播放/大图预览 CV-044、血缘生命周期绑手势 CV-186、整理布局 CV-185/223）需先出**手势语义对照表**拍板合并口径。
  - ② **语音/音乐模型与后端对拍**：演示模型 VoxCPM2（待生成）与后端实际端点对不上（语音现为 `tts_voiceover`、音乐生成端点待定）；时长估算/计费 vs 现状需对拍（照 CV-268/269 惯例先做后端对拍）。
  - ③ **积分/计费**：单次消耗合计、余额展示、失败自动退回——无商业化后端（与 REQ-029/030/031 Credits 同源闸门；占位可做 UI，退回语义做不了真）。
  - ④ **同表面拍板合并**：audio 节点输入框的参考位/工具栏与 CV-273「参考位 UI 三段式」、已验收就地浮层（REQ-003 CV-265~267 `.csNodePromptPanel`）、以及 REQ-029/031 输入框基座的关系需定义；audio 与 image/video 输入框**同组件三形态**，建议与 REQ-031 合并成一次拍板。
  - **对齐项（无需闸门）**：演示「参考音色三来源（本地上传/资产/画布导入）」= 现有音频参考通道（`audio-reference.ts`）对齐 ✓；工具栏四项基本已存在（引用到对话 CV-114 / 加入资产库 CV-255 / 预览 CV-044 / 下载 `canDownloadNode`）✓；**待核**：演示「音乐生成=人声歌词开关」与现有 `tts_voiceover` 仅做旁白/画外音的边界（角色对白走 `<d>`，见 REQ-017 反判据）是否覆盖「音乐 + 人声歌词」产出形态。
- **可先行小步（不依赖闸门）**：audio 节点工具栏四项、悬停预览、试听波形着色、节点卡空态/生成中态。
- **资料库来源**：需求表 行 5（2026-10-07 迭代新增；「编号」列空，无别名）。**图证**：`assets/library-2026-10-08/canvas-audionode-inputbox.html`（资料库附件，已拉取入库；无外链失效风险）。
- **闸门收口与拍板（2026-10-08，四项闸门全关，用户逐项批复 A/B/C）**：
  - **闸门① 手势**：无需新拍板——演示手势与 CV-286 已验收口径（单击开卡/双击 image·video 居中复位、audio 保留播放/单击空白才清选/滚轮指数化/缩放 10%~500%）对照无冲突，沿现状，零守卫改动。
  - **闸门② 后端对拍**：探针 4 项全过（[api-probe/audio-node-20261008/report.md](./api-probe/audio-node-20261008/report.md)）——① `txt2speech`+`refaudio` 克隆通道**首次实测通过**（200/30.9s，产物 6.43s）；② 无效句柄 500 快失败 0.060s（CV-155 同型 ⇒ 句柄纪律 + 错误归一）；③ 139 净字 → 真值 27.55s vs 演示 `estSeconds=round(净字数/5)` 27.8s（**误差 <1%**，短文本偏乐观 ~1.5s）；④ `txt2audio`+歌词+`duration:20` → 真值 20.04s（**精确生效**）；⑤ 缺 `txt_prompt` → 422 字段级（**音色设计无独立端点**）。三功能两后端映射成立：音色设计+语音生成 → `tts_voiceover`（`txt2speech`）、音乐 → `music_generation`（`txt2audio`）。
  - **A 组（功能口径）**：**A1** 三功能两后端，音色设计差异仅正文语义（占位「音色文案，3秒以上」）；**A2** 参数→提示词 = 纯函数 `composeSpeechInstruct()`（仿 `composeImagePrompt`/`pacingPrefixOf`）为主 + 可选「交给 agent 打磨」（复用既有「引用到对话」）；**A3** 不启用音色 subagent（二期）。
  - **B 组（实施层）**：**B1** 参考音色三来源全做（上传/资产/画布，单选 0/1，**本地上传转真**）；**B2** 音色文案直接合成即样音（无独立试听钮）；**B3** 人声歌词开关 + 歌词弹层（不填=纯音乐）；**B4** 时长估算客户端 `n/5` 标「约」；**B5** 积分纯展示占位 `2 + ceil(n/20)`；**B6** 同组件第三形态 `InputCardForm` 加 `'audio'`。
  - **C 组（入口/范围）**：**C1** 资产库加「音色」第五分类（**动 REQ-023 范围**——分类底座由本需求先落，REQ-023 联动注记已挂）；**C2** 卡直发 `/generate` 绕 `FORMAL_TOOLS` 维持现状（与 image/video 同构）。
  - **D1（验收口径）**：克隆听感留验收人工 A/B——样本 `probe1-refaudio-clone.mp3`（有参考）vs `probe-tts.mp3`（无参考）已存仓。
  - 说明：拍板 A/B/C 此前仅存对话，本段为仓内唯一落档。
- **方案（2026-10-08，2026-10-09 审核通过）**：[plans/REQ-032-画布audio节点交互方案.md](./plans/REQ-032-画布audio节点交互方案.md)——**反遗漏核心 = §四功能点对照总表**（演示 2306 行逐元素盘点 F1~F24 + H1~H8 + X1~X5 全量编号，每点映射 Step 与守卫/偏差）；五步实施（1 形态骨架+三功能+文本区 → 2 四层设置面板〔18 维词库〕→ 3 参考音色+音乐参数 → 4 host 转真〔`local:` promote/蛇形规范化〕→ 5 节点卡+工具栏四项+C1 分类收口）。**盘点关键发现/新决策**：① 演示描述区是 contenteditable token 系统——产品改**结构化词条 chips + 自由文本 textarea**（`低沉` 跨维重名不可文本反解，偏差已亮明）；② 演示生成 = 1600ms 假进度（沿拍板 031③ 无假百分比）；③ 产品无画布媒体手动新建入口 ⇒ **首发走对话 agent 首创、卡做编辑+重放**（D-入口）；④ refaudio 三来源统一归一 `local:<assetFile>`、发送时 host `promoteAssetFile` 现换句柄；⑤ pending 节点 camelCase 键形错位由卡发送整体重写蛇形兜底；⑥ **D-MusicDur** 新决策：music `duration = estSeconds()`（探针 4 精确生效，估算变承诺）；⑦ 发送判据 voice/design **正文必填**（探针 5 422；演示 `desc‖body` 偏差登记）。
- **方案已审核通过（2026-10-09，用户：全部按推荐 ①~⑦，开工授权）**：第二轮拍板 7 项——**①** 方案整体通过；**②** D-MusicDur = music 发送 `duration = estSeconds()` 批准；**③** D-入口 = 不加手动新建（首发走对话 agent 创节点）批准；**④** 节奏 = 五步连做一次推进（每步 check 绿即提交，完成后统一汇报）；**⑤** 时长估算展示位 = 生成中 progSub + 底栏积分 title 附「预计约 N 秒」；**⑥** 参考音色选择器 = 沿 image/video 三来源内联菜单（非演示模态弹窗）；**⑦** 首提交 `1089445163` 推送 origin/dev。已回写方案 §头/§六/§七/§八 与本条目状态行。
- **当前落地状态**：**已实现 · 2026-10-13 桌面验收通过**（CV-287 五步；验收出口 = 方案 §九：§四总表逐项 + 三功能各一次生成 + D1 听感 A/B + 参数规范化走查 + 手势零回归，全过）——**过程记录**：Step 1 形态骨架+词库底座 `src/voice-dims.ts`（`84a4e008e2`）→ Step 2 四层设置面板 `VoiceLayerPop.tsx`（`43fb7d02c7`）→ Step 3 参考音色三来源 + music `duration=estSeconds`（`af32227474`）→ Step 4 host 转真 `local:` 剥前缀 `promoteAssetFile` + 陈旧句柄错误归一 + progSub 副文案 + `TOOL_TITLES` 补项（`391edab41c`）→ Step 5 节点卡空态/字幕条/工具栏四项/资产库第五分类「音色」（`29990bd34a`）。守卫：方案 §七 4 个新守卫文件合并落 `voice-dims-req032.test.mjs`（16 条，Step 1/3/4/5）+ `canvas-input-card-req029.test.mjs` 扩展（Step 1 卡 + Step 2 面板，13 处 REQ-032 断言）；run-smoke **1394 条 0 失败**、门禁 ✅。**验收出口 = 方案 §九**（§四总表逐项 + 三功能各一次生成 + D1 听感 A/B + 参数规范化走查 + 手势零回归）。
---

