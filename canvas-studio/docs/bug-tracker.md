# Canvas Studio — Bug 追踪（资料库镜像 + 落地映射）

> **用途**：本文件是 WorkBuddy 资料库「videobuddy」> 项目管理面板 > **Bug 表** 的本地镜像与落地映射层。
> 资料库是缺陷的**唯一事实源（SSOT）**；本文件把它和本仓库（canvas-studio 插件）当前的代码/文档状态做对齐，
> 让任何接手的 AI 都能无歧义地继续修复工作。
>
> **来源链接**：https://www.workbuddy.cn/space/s/ktBQ9YyiEjOPsBwa2d7IsL
> - 空间 `videobuddy`（spaceId: `ktBQ9YyiEjOPsBwa2d7IsL`）→ 项目管理面板（`Ki8efaAlxb6bTjTSj8KEJL`）→ **Bug 表**（database `yV3vWU3Wd9THFDL1WT7Io9`）
> **本地镜像生成时间**：2026-09-27
> **资料库当前状态**：9 条缺陷，全部为「新建 / 未处理」；本文件索引共 **10 行** = 资料库 9 条（BUG-001~009）+ 本仓自立 BUG-010（见其条目内说明）

---

## 给未来 AI 的阅读与接手指引

1. **先读索引表**（见下文），按「当前落地状态」列定位未解决 / 部分解决的条目。
2. 每个条目含：编号、严重度、归属模块、现象、**复现步骤**、关联代码（file:line）、根因、修复方案、验收标准、资料库链接。
3. 严重度/状态字段以**资料库**为准；「当前落地状态」是本仓代码实测结论（由研究核对得出），会随开发推进过时——动手前请重新 `grep` 对应代码确认。
4. **编号规则**：`BUG-00X` 为本仓本地跟踪号（资料库 Bug 表未填「Bug编号」列，以标题为稳定键）。资料库新增行时，按标题去重后追加 `BUG-01X`。
5. 修完一个 bug 后，同步两处：① 资料库 Bug 表把「状态」改为对应值；② 本文件把「当前落地状态」改为「已解决」并补 `关联 CV`。

## 同步协议（长期维护）

- **拉取最新**：用 library skill 的 `space_api.py` 重新导出 Bug 表内容，与本文件 diff：
  ```bash
  python3 "<workbuddy>/skills/library/space_api.py" \
    database.get_database_content --database-id "yV3vWU3Wd9THFDL1WT7Io9"
  ```
  （路径以本机 WorkBuddy 安装目录为准；详见 `library` skill 的 `database/entry.md`）
- **变更处理**：资料库新增行 → 在本文件追加 `BUG-01X`；资料库行状态变更 → 同步「状态(资料库)」列；本仓修复完成 → 更新「当前落地状态」+「关联 CV」。
- **状态词汇表**：
  - 资料库状态：`新建` / `待复现` / `修复中` / `待验证` / `已关闭`
  - 本文件「当前落地状态」：`未开始` / `部分解决` / `已解决(待验收)` / `已解决`

---

## 索引表

| 编号 | 标题 | 严重度 | 状态(资料库) | 当前落地状态 | 归属模块 | 关联 CV |
|---|---|---|---|---|---|---|
| BUG-001 | 画布/详情图片引用对不上 | 严重 | 新建 | 已解决 | Host 工具层 / 生成链路 / 前端详情 | CV-155+CV-238+CV-242(均已验收) |
| BUG-002 | Agent 不知 ffmpeg、不会裁切音频 | 严重 | 新建 | 已解决 | Host 工具层 / skills / 音频 | CV-201+CV-245(均已验收) |
| BUG-003 | 大量素材下开「废弃素材」画布不稳 | 严重 | 新建 | 部分解决 | Client 画布渲染 / 布局 | 无专门 CV |
| BUG-004 | 关「废弃素材」后布局不回收空间 | 一般 | 新建 | 已解决 | Client 布局 | CV-244(已验收) |
| BUG-005 | 删画布元素后磁盘 asset 仍残留 | 一般 | 新建 | 已解决 | Host 资产服务 / project-store | CV-243(已验收) |
| BUG-006 | 生成/导出视频无历史可回溯 | 一般 | 新建 | 已解决 | Client 历史/版本 | CV-246+CV-246a(均已验收) |
| BUG-007 | 分镜词条重复 | 一般 | 新建 | 已解决 | Host 分镜 | CV-050+CV-222+CV-251(均已验收) |
| BUG-008 | 分镜内容修改后词条不变 | 一般 | 新建 | 已解决 | Host 分镜 / 前端卡片 | CV-050+CV-251(已验收 2026-09-27) |
| BUG-009 | 上传音乐极慢、绕服务器 | 严重 | 新建 | 已解决 | Host 路由 / 上传 | CV-241(已验收) |
| BUG-010 | 音频拖进「第一个对话页面」不显示（图片、视频都显示） | 一般 | 新建 | 已解决(待验收) | Client 上传回执 / 槽接线 | CV-247(待验收) |

---

## BUG-001 — 画布/详细信息里的图片引用和实际提交的图片引用对不上

- **编号**：BUG-001
- **严重度**：严重
- **状态(资料库)**：新建（待同步资料库为「已关闭」）
- **当前落地状态**：**已解决**（CV-155 引用自愈 + CV-238 裸值校验 + **CV-242 写者语义与句柄断链根治**，2026-09-27 真机验收通过）
- **归属模块**：Host 工具层（`src/host-tools.ts` 的引用解析）/ 生成链路（`src/generate.ts` 的引用修复）/ 前端详情面板（`NodeDetailDrawer`）/ 画布保存（`projects.ts` `writeCanvas`）
- **现象**：画布上的连线、节点「详细信息」里显示的图片引用，与实际提交给后端的图片引用不一致；详细信息有误。
- **复现步骤**：
  1. 在画布生成一张图，并把它连线到下游节点；
  2. 打开该节点「详细信息」面板；
  3. 对比详情里显示的图片 URL/引用 与 节点实际提交的 `filename`；
  4. 发现两者不一致（详情显示旧值/错误引用，连线也指向错误资产）。
- **关联代码**：
  - `src/host-tools.ts:539` `resolveRefValue`（CV-238 新增裸值形态校验，节点 id 当句柄直接抛 `CS-USER-002` 教模型正确取法）
  - `src/generate.ts:793` `healReferenceFilename`（CV-155 反查节点→本地资产重传→回写 `filename`，兼认本地资产名）
  - `src/host-tools.ts:565` `resolveAnchorNodeId`（Look 锚点引用解析）
- **根因**：引用解析时模型把「画布节点 id / 资产文件名」当 Drama `filename` 透传，导致详情面板与提交值不一致；深层为 **canvas.json 双写者竞态**（Host 字段级回写 vs 客户端整档覆盖，视频异步窗口内拖画布即冲掉 filename）与展示层静默丢弃（CV-242 方案文档 §1）。
- **修复方案/计划（已全部落地并验收）**：CV-155 反查回写；CV-238 裸值校验；**CV-242**：① `writeCanvas` 加 `options.author` 写者语义（filename 字段保护仅对 client 保存生效）+ `removedIds` 显式删除协议；② `<项目>/assets/reference-manifest.json` 句柄落盘映射（惰性 promote / heal 兜底记账）；③ 详情面板断链显式渲染「参考已断链」占位卡。方案见 `docs/plans/参考句柄断链根治方案.md`。
- **验收标准**：详情面板与连线引用均指向真实提交的资产；模型误用节点 id 时返回明确错误而非静默错引。**已按《雨夜茶馆》四幕创意真机验收通过。**
- **关联文档**：`docs/STATUS.md:291`(CV-155)、`:239-245`(CV-238)；`docs/plans/参考句柄断链根治方案.md`(CV-242)；`docs/acceptance-test-cases.md:279,441`；测试 `tests/filename-consumability.test.mjs`、`tests/canvas-save-merge.test.mjs`(CV-242, 6 例)、`tests/reference-summaries.test.mjs`、`tests/reference.test.mjs`、`tests/generate.test.mjs`。
- **资料库来源**：Bug 表 行 1。

---

## BUG-002 — Agent 不知道 ffmpeg 的存在，不会裁切音频

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

## BUG-003 — 画布里存在大量素材后，打开「废弃素材」整个画布不稳定

- **编号**：BUG-003
- **严重度**：严重
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（开关已具备，但「规模下不稳定」这一具体缺陷无专门修复）
- **归属模块**：Client 画布渲染（`CanvasToolbar` / `StudioFrame`）/ 布局系统
- **现象**：画布 UI 存在大量元素时，UI 拖动刷新影响很大；打开「废弃素材」视图后整个画布不稳定，刷新出现 UI 大问题。
- **复现步骤**：
  1. 画布放入大量素材（数十~上百节点）；
  2. 点击工具栏「废弃素材」开关，打开 retired 视图；
  3. 拖动 / 刷新画布，出现卡顿、错位、刷新后大范围布局错乱。
- **关联代码**：
  - `src/client/CanvasToolbar.tsx:40-42,156-160`（废弃素材按钮）
  - `src/client/StudioFrame.tsx:200-203`（`nodes.filter(n => n.retired !== true && n.supersededBy === undefined)` 仅视图层过滤，无虚拟化/性能治理）
- **根因**：`hideRetired` 仅做视图层 filter，无节点虚拟化/分片渲染/节流；大量节点下重渲染开销大。
- **修复方案/计划**：在 retired 显隐路径引入性能治理（节点虚拟化 / 分片渲染 / 重渲染节流）；或限制 retired 视图只渲染缩略。需立项新 CV。
- **验收标准**：大量素材下开关 retired 视图不再出现卡顿 / 刷新错乱。
- **关联文档**：`docs/STATUS.md`（布局类 CV-185 按视口整形、CV-223 镜位泳道已落地，但未覆盖此缺陷）；测试 `tests/canvas-arrange.test.mjs`、`tests/group-tray.test.mjs`、`tests/shot-versions.test.mjs`（仅覆盖 retired 语义，未覆盖稳定性）。
- **资料库来源**：Bug 表 行 3。

---

## BUG-004 — 关闭「废弃素材」后，画布 UI 布局调整不明显，仍留有大量空间

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
- **修复方案/计划（已落地并验收）**：CV-244 隐藏方向只对可见子集计算排布（不占槽位、不撑行高、不参与钉扎加高）；显示方向对称触发全量重排（retired 按既有钉扎规则归位）。方案见 `docs/plans/废弃素材开关布局回收方案.md`。
- **验收标准**：关闭废弃素材后画布自动紧凑不留空洞；重新显示后 retired 归位不叠压。**已真机验收通过。**
- **关联文档**：`docs/plans/废弃素材开关布局回收方案.md`(CV-244)；测试 `tests/canvas-arrange.test.mjs`（CV-244 新增 3 用例）、`tests/canvas-placement.test.mjs`。
- **资料库来源**：Bug 表 行 4。

---

## BUG-005 — 从画布删除的元素，实际文件 asset 里仍旧存储着这些文件

- **编号**：BUG-005
- **严重度**：一般
- **状态(资料库)**：新建（待同步资料库为「已关闭」）
- **当前落地状态**：**已解决**（**CV-243 两段式资产回收**，2026-09-27 真机验收通过）
- **归属模块**：Host 资产服务（`projects.ts` / `routes.ts` / `asset-gc.ts`）/ Client `project-store`
- **现象**：对于从画布上删除的元素，实际文件 asset 里仍旧存储着这些文件，期望删除废料。
- **复现步骤**：
  1. 画布上某素材节点引用一个磁盘 asset 文件；
  2. 删除该节点；
  3. 到 asset 目录查看，文件仍存在（孤儿文件）。
- **关联代码**：
  - `src/asset-gc.ts`（**CV-243 新增**）：`collectReferencedBasenames`（按 url basename 引用计数）/ `trashAssetsForRemovedNodes`（删除即回收入 `.trash/`）/ `gcProjectAssets`（回活 + 物理清 + 孤儿清 + manifest 剪枝）
  - `src/routes.ts`：画布保存路由挂 `trashAssetsForRemovedNodes`（保存前抓 beforeDoc，try/catch 不阻塞保存）；新增 `POST /canvas-studio/asset-gc` 手动兜底；资产读取 ENOENT → `.trash` fallback
  - `src/client/project-store.ts` `removeNodes`（**CV-242** 起记 `pendingRemovedIds`，保存时随 `removedIds` 显式协议上送）
  - `src/client/index.ts`：打开项目时自动 `gcStudioAssets`（静默）
- **根因**：删除只改内存态，未接磁盘清理；且 export 成片挂节点等不构成独立引用（引用计数必须按 url basename 而非节点 id）。
- **修复方案/计划（已落地并验收）**：CV-243 两段式回收——删除 → 无引用文件 rename 进 `assets/.trash/`（不物理删，undo/共享/生成中竞态免疫）；打开项目 GC + `POST /assets/gc` 手动兜底。方案见 `docs/plans/资产废料回收方案.md`。
- **验收标准**：删除无引用的画布元素后，磁盘 asset 进 `.trash/`；打开项目自动 GC（误删回活、孤儿清理）。**已真机验收通过。**
- **关联文档**：`docs/plans/资产废料回收方案.md`(CV-243)；测试 `tests/asset-gc.test.mjs`(8 例)、`tests/canvas-save-merge.test.mjs`。
- **资料库来源**：Bug 表 行 5。

---

## BUG-006 — 每次生成/合成 export 视频都会产生历史视频，但无任何地方可被发现

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
- **修复方案/计划（已落地）**：每个产物落盘点记账 → 历史抽屉回溯（含已从画布移除的）→ 面板删除走两段式（409 防断链 + `.trash` + deletedAt → GC 物理清闭环）；与 CV-243 的分工：CV-243 管「没人要的怎么清」，CV-246 管「有人想要的怎么找回」。方案见 `docs/plans/生成历史面板方案.md`。
- **验收标准**：① 生成/上传/裁切产物即时入账、重启应用仍在；② 删画布节点后条目变「未挂画布」但保留可回溯；③ 删「已挂画布」产物被拒绝；④ 删「未挂画布」产物进回收站、重开项目 GC 后彻底清除；⑤ 未删除的产物不被自动 GC 清掉。
- **关联文档**：`docs/plans/生成历史面板方案.md`(CV-246，含 UI 拍板记录与实施状态)；测试 `tests/asset-history.test.mjs`(9 例：记账幂等/GC 保护/两段式闭环/死条目剪枝/上传链路)。
- **资料库来源**：Bug 表 行 6。

---

## BUG-007 — 分镜词条出现重复

- **编号**：BUG-007
- **严重度**：一般
- **状态(资料库)**：新建
- **当前落地状态**：**已解决**（CV-050+CV-222+CV-251，2026-09-27 真机验收通过——《深夜面馆》剧本「打回→重提」场景覆盖本条验收标准：3 张卡原地更新、不新增重复卡）
- **归属模块**：Host 分镜（`src/host-tools.ts` 的 `mergeShotCards`）
- **现象**：分镜词条出现重复（详情见资料库 images/词条重复.png）。
- **复现步骤**：
  1. 提交分镜；
  2. 打回重提分镜；
  3. 画布出现多套「分镜 1 · 特写」重复词条。
- **关联代码**：
  - `src/host-tools.ts:833` `mergeShotCards`（按镜号复用旧卡 id+位置、只新建新镜号卡，CV-050）
  - `src/host-tools.ts:771` `shotCardNumberOf`、`src/host-tools.ts:729` `formatStoryboardShot`
  - 同镜自动取代（CV-222，已完成·桌面验收）
- **根因**：旧 `buildShotCards` 无脑 `[...existing, ...新整套]` 追加 → 打回重提出现多套重复卡。
- **修复方案/计划**：`mergeShotCards` 按镜号复用旧卡 id+位置、只新建新镜号卡（CV-050）；同镜自动取代（CV-222）。
- **验收标准**：重提分镜不出现重复词条，仅原地更新。
- **验收结论**：✅ 2026-09-27 真机验收通过（CV-251《深夜面馆》测试剧本第 1-2 步：打回改第 2 镜 → 重提整表 → 3 卡 id/位置不变、文案原地更新、无新增卡）。
- **关联文档**：`docs/STATUS.md:80,200,314`(CV-050)、`:248`(CV-222)；`docs/canvas-ux-backlog.md:213`；`docs/acceptance-test-cases.md:213`；测试 `tests/shot-cards.test.mjs`、`tests/shot-versions.test.mjs`。
- **资料库来源**：Bug 表 行 7。

---

## BUG-008 — 对分镜内容后期大量修改，画布上分镜词条没有变化

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
- **修复方案/计划**：方案 A（用户拍板「先做 A」）——工具描述硬指引 + skill 总纲两处同步（行 65 例外 carve-out、第 3 步重提纪律）+ 解析失败防堆卡闸门（抛可操作报错让模型同回合按格式重试，回合不终止）。不做单镜编辑工具（方案 B）。详见 `docs/plans/分镜修改纪律与防堆卡方案.md`。
- **验收标准**：打回后改一镜 → 模型重提完整表，画布卡 id/位置不变、文案原地更新、不新增卡；诱导解析失败 → 收到格式引导而非多出整表卡。
- **验收结论**：✅ 2026-09-27 真机验收通过（《深夜面馆》测试剧本）。附带产出：镜位框「镜 N」chip 缩放显示两连修（CV-252，`c7ed172ff7`→`50f9ee08b8` 终版：chip 独立顶层渲染，任何缩放/排布下不切半、不压别的镜卡）。
- **关联文档**：`docs/STATUS.md:200`(CV-050)；`docs/plans/分镜修改纪律与防堆卡方案.md`(CV-251)；`skills/canvas-studio-creation/SKILL.md` 行 65/70；测试 `tests/shot-cards.test.mjs`（11 用例：merge 语义 + 端到端重提 + 防堆卡/回归/描述断言）。
- **资料库来源**：Bug 表 行 8。

---

## BUG-009 — 上传的音乐速度极慢，去服务器绕了一圈

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
- **资料库来源**：Bug 表 行 9。

---

## BUG-010 — 音频拖进「第一个对话页面」不显示（图片、视频都能显示）

- **编号**：BUG-010
- **严重度**：一般
- **状态(资料库)**：新建（**本仓自立**：2026-09-27 用户会话反馈，资料库尚无对应行 —— 下次 `space_api.py` 拉取后按同步协议补登）
- **当前落地状态**：已解决(待验收)（CV-247）
- **归属模块**：Client 上传回执 / 槽接线（`StudioFrame.tsx` / `MediaUploadBar.tsx` / `project-store.ts`）
- **现象**：把音频拖到**第一个对话页面**（首屏 / 首条消息发出前）后，屏幕上什么都不出现 —— 图片与视频都能显示，只有音频不行；用户分不清是没拖上、还是没传成功。
- **复现步骤**：
  1. 新建项目（或已有项目但从没发过第一条消息）—— 此时中栏**不渲染画布**；
  2. 拖一个 `.mp3` 进对话区或画布区；
  3. 观察：无卡片、无缩略图、无成功 toast（只有失败才 toast）⇒ 看起来「什么都没发生」。
- **关联代码**：
  - `src/client/StudioFrame.tsx` `canvasBody` 三态 —— lobby（`projectId===null` → LobbyHero）与 lobby-pending（`hasConversation===false` → SlateBar）**不渲染 `CanvasSurface`**
  - `src/client/StudioFrame.tsx` `handleUploadAudio`（修复前：只 `actions.addAudioNode` ⇒ 唯一回执是画布节点）
  - `src/client/MediaUploadBar.tsx`（CV-247；原 `VideoUploadBar.tsx`）、`src/client/index.ts` 槽 `conversation.input.dock` / id `canvas-studio-media-upload`
  - `src/client/project-store.ts` `mediaUploads` + `begin/settle/fail/dismissMediaUpload`
- **根因**：**回执通道不对称** —— 图片的回执在对话区（宿主 `ComposerAttachments` 附件缩略图；capture 判据「非 image 才接管」故图片恒放行），视频的回执在对话区（CV-232 补的 `VideoUploadBar`，其文件头注释本就写明同型问题「画布节点在 lobby / 首屏态下根本看不见」），而**音频与文字的回执只有画布节点**；画布在首个对话页不渲染 ⇒ 节点落进 store 也无人画它，对话区又零反馈（成功无 toast）。
- **修复方案/计划**：CV-247 把回执卡泛化 —— `VideoUploadBar` → `MediaUploadBar`（图位按 `kind` 分档：video 首帧、audio/text 扩展名徽标），`videoUploads` → `mediaUploads`，audio/text 上传补齐 begin→settle/fail 三段。详见 STATUS §4 CV-247。
- **验收标准**：首屏 / 首条消息前拖入 `.mp3` 与 `.txt`，输入框上方立刻出现回执卡（文件名 + 大小 + 上传中→已就绪 + 可移除），与视频卡片同形态；图片仍走宿主附件缩略图（**不进**回执卡）；失败显示「上传失败 + 原因」；移除卡片只摘卡、不删已落画布的节点。
- **遗留（次因，未拍板）**：**无项目（lobby）** 时 capture 接管 effect 前置 `projectId===null` 直接 return ⇒ 音频落到宿主图片通道报「仅支持 PNG、JPG、WebP、GIF」，落到画布区则 `handleUploadAudio` 首行静默 return（连 toast 都没有）—— 与「绝不静默」原则冲突，待另立条目或并入本条（属方案 B，本批只做方案 A）。
- **关联文档**：`docs/STATUS.md` §0/§4/§8（CV-247）；`docs/canvas-ux-backlog.md`（CV-247 行 + 变更记录）；`docs/acceptance-test-cases.md`（二十五、V 组）；测试 `tests/media-upload-wiring.test.mjs`（原名 `video-upload-wiring.test.mjs`，随本批改名）。
- **资料库来源**：本仓自立（2026-09-27 用户会话反馈）。
