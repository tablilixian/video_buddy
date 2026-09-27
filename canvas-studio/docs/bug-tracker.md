# Canvas Studio — Bug 追踪（资料库镜像 + 落地映射）

> **用途**：本文件是 WorkBuddy 资料库「videobuddy」> 项目管理面板 > **Bug 表** 的本地镜像与落地映射层。
> 资料库是缺陷的**唯一事实源（SSOT）**；本文件把它和本仓库（canvas-studio 插件）当前的代码/文档状态做对齐，
> 让任何接手的 AI 都能无歧义地继续修复工作。
>
> **来源链接**：https://www.workbuddy.cn/space/s/ktBQ9YyiEjOPsBwa2d7IsL
> - 空间 `videobuddy`（spaceId: `ktBQ9YyiEjOPsBwa2d7IsL`）→ 项目管理面板（`Ki8efaAlxb6bTjTSj8KEJL`）→ **Bug 表**（database `yV3vWU3Wd9THFDL1WT7Io9`）
> **本地镜像生成时间**：2026-09-27
> **资料库当前状态**：9 条缺陷，全部为「新建 / 未处理」

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
| BUG-001 | 画布/详情图片引用对不上 | 严重 | 新建 | 部分解决 | Host 工具层 / 生成链路 / 前端详情 | CV-155(已完成)+CV-238(待验收) |
| BUG-002 | Agent 不知 ffmpeg、不会裁切音频 | 严重 | 新建 | 部分解决 | Host 工具层 / skills / 音频 | CV-201(待验收) 缺 agent 侧工具 |
| BUG-003 | 大量素材下开「废弃素材」画布不稳 | 严重 | 新建 | 部分解决 | Client 画布渲染 / 布局 | 无专门 CV |
| BUG-004 | 关「废弃素材」后布局不回收空间 | 一般 | 新建 | 部分解决 | Client 布局 | 无专门 CV |
| BUG-005 | 删画布元素后磁盘 asset 仍残留 | 一般 | 新建 | 未开始 | Host 资产服务 / project-store | 无 |
| BUG-006 | 生成/导出视频无历史可回溯 | 一般 | 新建 | 未开始 | Client 历史/版本 | CV-054(仅设计) |
| BUG-007 | 分镜词条重复 | 一般 | 新建 | 部分解决 | Host 分镜 | CV-050(待验收)+CV-222(已完成) |
| BUG-008 | 分镜内容修改后词条不变 | 一般 | 新建 | 部分解决 | Host 分镜 / 前端卡片 | CV-050(换文案) |
| BUG-009 | 上传音乐极慢、绕服务器 | 严重 | 新建 | 部分解决 | Host 路由 / 上传 | CV-241(待验收) |

---

## BUG-001 — 画布/详细信息里的图片引用和实际提交的图片引用对不上

- **编号**：BUG-001
- **严重度**：严重
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（CV-155 已完成 + CV-238 已修复·待验收）
- **归属模块**：Host 工具层（`src/host-tools.ts` 的引用解析）/ 生成链路（`src/generate.ts` 的引用修复）/ 前端详情面板（`NodeDetailDrawer`）
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
- **根因**：引用解析时模型把「画布节点 id / 资产文件名」当 Drama `filename` 透传，导致详情面板与提交值不一致。
- **修复方案/计划**：CV-155 已反查并回写正确 filename；CV-238 增加裸值校验，模型误用节点 id 时直接报错引导。待桌面真机验收。
- **验收标准**：详情面板与连线引用均指向真实提交的资产；模型误用节点 id 时返回明确错误而非静默错引。
- **关联文档**：`docs/STATUS.md:291`(CV-155)、`:239-245`(CV-238)；`docs/acceptance-test-cases.md:279,441`；测试 `tests/filename-consumability.test.mjs`、`tests/reference.test.mjs`、`tests/generate.test.mjs`、`tests/canvas-arrange.test.mjs`。
- **资料库来源**：Bug 表 行 1。

---

## BUG-002 — Agent 不知道 ffmpeg 的存在，不会裁切音频

- **编号**：BUG-002
- **严重度**：严重
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（CV-201 已把 ffmpeg 打进包·待验收，但无 agent 侧裁剪工具/指引）
- **归属模块**：Host 工具层 / skills / 音频处理
- **现象**：对 Agent 提出「裁切我上传的 mp3」，他不知道有 ffmpeg 的存在；用户指出 ffmpeg 位置后，他才懂去调用。
- **复现步骤**：
  1. 上传一段 mp3 到画布；
  2. 让 Agent 把该 mp3 裁切为某时间段的片段；
  3. Agent 不知道 ffmpeg 存在、不会调用，需用户明确告知 ffmpeg 路径后才懂。
- **关联代码**：
  - `src/ffmpeg-run.ts`（Host 侧 concat/mix 用）
  - `src/compose.ts:83` `ffmpegPath`
  - `src/host-tools.ts:2105`（compose 工具说明里写「Host 侧 ffmpeg concat」）
  - 全仓 grep `ffmpeg` 在 `skills/` 与工具 description **零命中**（无告知 agent 的入口）
- **根因**：ffmpeg 依赖 `ffmpeg-static@5.3.0` 在 `dependencies` 但二进制从未进包（postinstall 被 `.yarnrc.yml` 的 `enableScripts:false` 阻断）；且 skills / 工具描述里没有任何告知 agent「可用 ffmpeg 裁切音频」的说明或专用工具。
- **修复方案/计划**：CV-201 已把 ffmpeg 打进 app 包；下一步需在 audio 相关 skill 或工具 description 中显式告知 agent「可用 Host 侧 ffmpeg 裁切音频」，并提供裁剪工具/参数（如 `cut_audio(input, start, end)`）。与 BUG-009（上传音频）联动。
- **验收标准**：Agent 收到裁切音频请求时能自主调用 ffmpeg 完成，无需用户告知路径。
- **关联文档**：`docs/STATUS.md:255`(CV-201)；`docs/canvas-ux-backlog.md:89`；`docs/acceptance-test-cases.md:175`；测试 `tests/ffmpeg-bundled.test.mjs`。
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
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（过滤是视图层，关闭后不触发重新布局）
- **归属模块**：Client 布局（`StudioFrame` / `canvas-view`）
- **现象**：关闭「废弃素材」后，画布 UI 上布局调整不明显，仍旧为废弃素材留有大量空间。
- **复现步骤**：
  1. 画布有若干 retired 节点；
  2. 关闭工具栏「废弃素材」开关；
  3. 画布上原 retired 节点位置仍留空白，未自动回收排版（需手动点「整理布局」才回收）。
- **关联代码**：
  - `src/client/StudioFrame.tsx:202,495,1545,1571`（过滤点）
  - `src/canvas-view.ts` `computeArrangeLayout`（显式坐标驱动布局，与 `hideRetired` 解耦）
- **根因**：`hideRetired` 只是 `useMemo` 过滤，节点坐标仍保留在画布；隐藏 retired 后原位置留空，需手动整理。
- **修复方案/计划**：关闭 retired 视图或 retired 状态变化时，自动触发 `computeArrangeLayout` 重排（或视图层把隐藏节点移出布局流）。
- **验收标准**：关闭废弃素材后画布自动紧凑，不留空洞。
- **关联文档**：同 BUG-003 的布局类文档；测试 `tests/canvas-arrange.test.mjs`、`tests/group-tray.test.mjs`。
- **资料库来源**：Bug 表 行 4。

---

## BUG-005 — 从画布删除的元素，实际文件 asset 里仍旧存储着这些文件

- **编号**：BUG-005
- **严重度**：一般
- **状态(资料库)**：新建
- **当前落地状态**：未开始
- **归属模块**：Host 资产服务（`projects.ts` / `routes.ts`）/ Client `project-store`
- **现象**：对于从画布上删除的元素，实际文件 asset 里仍旧存储着这些文件，期望删除废料。
- **复现步骤**：
  1. 画布上某素材节点引用一个磁盘 asset 文件；
  2. 删除该节点；
  3. 到 asset 目录查看，文件仍存在（孤儿文件）。
- **关联代码**：
  - `src/client/project-store.ts:643` `removeNodes`（仅 `filter` 掉节点、清理 `sourceIds`/父子关系/撤销栈，**不删任何文件**）
  - `src/routes.ts`、`src/projects.ts` 删除路径均无 asset 文件移除
  - 全仓 grep `fs.unlink|fs.rm|deleteAssetFile|purgeUnused` **零命中**
- **根因**：删除只改内存态，未接磁盘清理。
- **修复方案/计划**：删除节点时，若该资产无其他节点引用，调用 Host 资产服务物理删除（或移入回收站待用户彻底删除）；与 BUG-006 历史面板/彻底删除联动，统一「删除废料」体验。
- **验收标准**：删除无引用的画布元素后，磁盘 asset 同步清除（或进入回收站可彻底删除）。
- **关联文档**：`docs/STATUS.md:140`(CV-033/034 仅清理 workspace，非素材文件)；`docs/canvas-node-state-map.md:106,402`(`removeNodes` 仅剔除节点)；测试 `tests/canvas-view.test.mjs`、`tests/node-replay.test.mjs`（覆盖删节点，但无「删除后清磁盘」测试）。
- **资料库来源**：Bug 表 行 5。

---

## BUG-006 — 每次生成/合成 export 视频都会产生历史视频，但无任何地方可被发现

- **编号**：BUG-006
- **严重度**：一般
- **状态(资料库)**：新建
- **当前落地状态**：未开始
- **归属模块**：Client 历史/版本
- **现象**：每次生成、合成 export 视频都会产生一个历史视频，但没有任何地方可被发现。建议左上角保留历史上所有生成的图和片，方便回溯；用户删除则从磁盘彻底删除。
- **复现步骤**：
  1. 多次生成 / 合成 / export 视频；
  2. 想回溯某次历史视频；
  3. 界面上没有任何入口能看到历史生成物；磁盘有文件但用户无从发现。
- **关联代码**：全仓 grep `HistoryPanel|历史面板|mediaHistory|历史上所有|historyTray` **零命中**（无历史面板组件）
- **根因**：`docs/STATUS.md:429` 的「双层版本控制 / 历史回溯」对应 **CV-054**，标注「未启动 / 仅设计」；`:484` D5 仅做到单版本 `previous` 字段回退（详情面板「撤销上次重做」），无媒体历史列表。
- **修复方案/计划**：在左上角新增历史面板，列出所有生成的图/视频（含时间、缩略、来源节点），支持预览与彻底删除（彻底删除→调用 BUG-005 的磁盘清理）。
- **验收标准**：每次生成/导出都有可发现的历史条目；用户删除后从磁盘彻底清除。
- **关联文档**：`docs/STATUS.md:429`(CV-054 仅设计)、`:484`(D5 单版本回退)；无测试。
- **资料库来源**：Bug 表 行 6。

---

## BUG-007 — 分镜词条出现重复

- **编号**：BUG-007
- **严重度**：一般
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（CV-050 已修复·待验收 / CV-222 已完成·桌面验收）
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
- **修复方案/计划**：`mergeShotCards` 按镜号复用旧卡 id+位置、只新建新镜号卡（CV-050）；同镜自动取代（CV-222）。待验收。
- **验收标准**：重提分镜不出现重复词条，仅原地更新。
- **关联文档**：`docs/STATUS.md:80,200,314`(CV-050)、`:248`(CV-222)；`docs/canvas-ux-backlog.md:213`；`docs/acceptance-test-cases.md:213`；测试 `tests/shot-cards.test.mjs`、`tests/shot-versions.test.mjs`。
- **资料库来源**：Bug 表 行 7。

---

## BUG-008 — 对分镜内容后期大量修改，画布上分镜词条没有变化

- **编号**：BUG-008
- **严重度**：一般
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（重提时文案已更新，但标题标签不随正文变）
- **归属模块**：Host 分镜（`mergeShotCards`）/ 前端卡片标题
- **现象**：对分镜内容后期大量修改，画布上分镜词条没有变化。期待见到内容变化，或者减少词条出现。
- **复现步骤**：
  1. 提交分镜；
  2. 后期大量修改分镜正文；
  3. 画布上分镜词条标题/内容未变化。
- **关联代码**：
  - `src/host-tools.ts:809-810`（注释明确「复用 id 与位置，**只换文案**」）
  - `src/host-tools.ts:735`（标题 `分镜 N · 景别` 只在镜号/景别变化时才变）
- **根因**：设计上「只更新文案」，标题层（分镜 N·景别）仅镜号/景别变化才变；且若绕过 `submit_storyboard` 走其它编辑路径，可能不刷新。
- **修复方案/计划**：明确分镜词条刷新契约——正文修改应反映到卡片可见文本；评估标题是否需随关键正文变化；确保非 `submit_storyboard` 路径也能触发刷新。该设计同时覆盖「减少词条出现」（去重，见 BUG-007）与「内容更新」两面。
- **验收标准**：分镜内容修改后画布词条可见变化，或（按需求）冗余词条减少。
- **关联文档**：`docs/STATUS.md:200`(CV-050 按镜号复用「只更新文案」)；测试 `tests/shot-cards.test.mjs`（验证 merge 更新文案）。
- **资料库来源**：Bug 表 行 8。

---

## BUG-009 — 上传的音乐速度极慢，去服务器绕了一圈

- **编号**：BUG-009
- **严重度**：严重
- **状态(资料库)**：新建
- **当前落地状态**：部分解决（CV-241 已修复·待验收）
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
- **关联文档**：`docs/STATUS.md:236,6`(CV-241)；`docs/canvas-ux-backlog.md:63`；`docs/acceptance-test-cases.md:121,172`；测试 `tests/upload-media.test.mjs`、`tests/generate.test.mjs`、`tests/media-drop.test.mjs`、`tests/video-upload-wiring.test.mjs`、`tests/upload-endpoint.test.mjs`。
- **资料库来源**：Bug 表 行 9。
