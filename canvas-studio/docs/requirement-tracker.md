# Canvas Studio — 需求追踪（资料库镜像 + 落地映射）

> **用途**：本文件是 WorkBuddy 资料库「videobuddy」> 项目管理面板 > **需求表** 的本地镜像与落地映射层。
> 资料库是需求的**唯一事实源（SSOT）**；本文件把它和本仓库（canvas-studio 插件）当前的代码/文档状态做对齐，
> 让任何接手的 AI 都能无歧义地继续开发。
>
> **来源链接**：https://www.workbuddy.cn/space/s/ktBQ9YyiEjOPsBwa2d7IsL
> - 空间 `videobuddy`（spaceId: `ktBQ9YyiEjOPsBwa2d7IsL`）→ 项目管理面板（`Ki8efaAlxb6bTjTSj8KEJL`）→ **需求表**（database `dKDCSVOxZA6bjjmyZgF8DL`）
> **本地镜像生成时间**：2026-09-27
> **2026-10-02 增注**：资料库已扩充到 20 行（10-07 迭代 6 条新增），全量快照与派单底稿见根仓 `docs/tracking/requirements.md`（R-xx 别名 ↔ 本文件 REQ-00X 映射见其对账节）；「当前落地状态」仍以本文件为准。
> **资料库当前状态**：14 条需求（P0×9、P1×3、P2×2），状态含「待评审 / 已排期」
> **最近一次本地核对（2026-09-30）**：REQ-001 / REQ-005 / REQ-008 / REQ-009 桌面验收通过；REQ-005 的 v1.4（CV-259~262）补登进 STATUS §4。本文件的「当前落地状态」列以代码为准逐条复核过，与代码不符处以代码为准（已知未收口项见文末「待收口的记账偏差」）。
> **2026-09-30 追加（本仓自发现，未入资料库）**：工具调用条件全面审计后新增 **REQ-015~019**（状态(资料库) 列标「—」；均为主流程外围的判据 / 文档收口项，其中 REQ-018 待拍板）；REQ-014 同日已由 **CV-270** 实现并更新状态。

---

## 给未来 AI 的阅读与接手指引

1. **先读索引表**，按「当前落地状态」列定位未实现 / 部分实现的条目。
2. 每个条目含：编号、优先级、归属模块、需求描述、**复现/验证路径**、关联代码（file:line）、实现方案、验收标准、资料库链接。
3. **注意三个跨条目前提冲突**（见下方「⚠️ 关键前提冲突」）：REQ-012/013/014 假设 `qwen_image_2_1`，但本仓 0.3.0 起已全面切到 **Krea2**，需先与产品确认是否回切；REQ-007 属 DSH 宿主层，本插件仓无法独立修复。
4. **编号规则**：`REQ-00X` 为本仓本地跟踪号（资料库需求表未填「需求编号」列，以标题为稳定键）。资料库新增行时按标题去重后追加 `REQ-01X`。
5. 开发完一个需求后，同步两处：① 资料库需求表把「状态」改为对应值；② 本文件把「当前落地状态」改为「已实现」并补 `关联 CV`。

## 同步协议（长期维护）

- **拉取最新**：用 library skill 的 `space_api.py` 重新导出需求表内容，与本文件 diff：
  ```bash
  python3 "<workbuddy>/skills/library/space_api.py" \
    database.get_database_content --database-id "dKDCSVOxZA6bjjmyZgF8DL"
  ```
- **变更处理**：资料库新增行 → 在本文件追加 `REQ-01X`；资料库行状态变更 → 同步「状态(资料库)」列；本仓完成 → 更新「当前落地状态」+「关联 CV」。
- **状态词汇表**：
  - 资料库状态：`待评审` / `已排期` / `开发中` / `待验收` / `已上线`
  - 本文件「当前落地状态」：`未开始` / `部分实现` / `已实现` / `已拍板(维持现状)`

---

## ⚠️ 关键前提冲突（动手前必读）

| 冲突点 | 说明 | 影响需求 |
|---|---|---|
| **qwen_image_2_1 vs Krea2** | 需求 12/13/14 假设后端支持 `qwen_image_2_1` / `txt2image_withtxt`，但本仓 `src/generate.ts:1792-1881` 与 `docs/api.md:44-45` 显示 0.3.0 起图像侧已全面切到 **Krea2 Turbo / Krea2 Edit / Boogu Edit**；全仓无 `qwen_image_2_1` / `txt2image_withtxt` 任何引用。 | REQ-012、REQ-013、REQ-014 |
| **image2fix 现状** | 需求 14 称「image2fix 也用 qwen image 2_1」，但 `src/config.ts:29` 显示 image2fix 是独立 **Boogu Edit** 端点，非 qwen。 | REQ-014 |
| **DSH 宿主层** | 需求 7（agent 任务更新/上下文长度）由 deepseek-harness-desktop（DSH）宿主提供，源码不在本插件仓；本仓仅有契约声明（`src/client/contracts.ts:99`），无法独立修复。**已拍板（2026-09-29）暂缓升级，等 DSH stable；详见 REQ-007 条目评估结论。** | REQ-007 |
| **720p 已演进为 768p** | 需求 2 写「480p→720p」，但产品已拍板改为 480p/768p(默认)/2k 三档（CV-187）。 | REQ-002 |

> **行动建议**：REQ-012/013/014 与 REQ-007 在动手前需先与产品/上游确认路线（是否回切 qwen、是否在 DSH 仓处理），不要凭需求字面直接改代码。

---

## 索引表

| 编号 | 标题 | 优先级 | 状态(资料库) | 当前落地状态 | 归属模块 | 关联 CV |
|---|---|---|---|---|---|---|
| REQ-001 | 全局资产库页面（角色/场景/物件/群像 + @引用） | P0 | 已排期 | 已实现(三步全部落地 · CV-255，2026-09-29 验收通过) | Host 资产服务 / Client 资产库页 / reference-token | @ref=CV-114, **CV-255** |
| REQ-002 | 画布 480p→720p 丝滑过渡 | P1 | 已排期 | 已实现(实际 480p/768p/2k) | 分辨率档位 | CV-187, CV-188 |
| REQ-003 | 抄 libtv 提示词修改框体验 | P0 | 待评审 | 大部分实现（**Step 1~3 = CV-265/266/267 已于 2026-10-01 桌面验收通过**；Step 4 AI 改写另行立项） | Client 提示词编辑器 | CV-194, CV-265, CV-266, CV-267, **方案+效果参考** |
| REQ-004 | 画布鼠标操作习惯（滚轮缩放/多选/批量引用） | P2 | 已排期 | **已落地·待桌面验收（2026-10-03）**；**2026-10-05 正文回填**（正文原写「部分实现·方向相反」与代码不符，已更正 + 关联行号校正） | Client 画布交互 | CV-008, CV-089, CV-090 + 2026-10-03 批 C |
| REQ-005 | Canvas Studio 返回首页 + 项目按改动时间排序 | P2 | 已排期 | 已实现（**2026-09-30 桌面验收通过**）：CV-256 首页对话式创建 + CV-257 v1.3 变体 A 形态修复 + **CV-259~262 v1.4 首页收尾** | Client Lobby/首页 | CV-064, CV-088, **CV-256**, **CV-257**, **CV-259~262** |
| REQ-006 | 安装包太大，评估 tauri / 官方 desktop 版 | P1 | 已排期 | 已拍板(维持 Electron universal) | 打包 / Electron | CV-201, B1 |
| REQ-007 | agent 任务更新 bug + 模型上下文长度显示，升级 dsh | P0 | 待评审 | 已拍板(暂缓升级·等 DSH stable；升级评估已完成) | DSH 宿主(非本仓) | — |
| REQ-008 | agent 对话流改造（少废话/中文 tool 显示） | P0 | 待评审 | 已实现（**2026-09-30 桌面验收通过**）：CV-263 三档中文 tool 行 + CV-264 验收反馈三连修 | Client 对话流（`tool.call.toolview` keyed 槽接管，不动 DSH）/ `tool-presentation.ts` 唯一口径 | CV-175, DD-09, **CV-263**, **CV-264** |
| REQ-009 | 支持拖拽文本作为剧本 | P0 | 已排期 | 已实现(CV-241 · 2026-09-29 验收通过) | Host/Client 上传 | CV-241 |
| REQ-010 | 支持拖拽音频作背景/说话参考音 | P0 | 已排期 | 部分实现 | Host/Client 音频参考 | CV-043, CV-040, CV-006 |
| REQ-011 | 支持 camera motion 和 wuxia action lora | P1 | 已排期 | 未开始 | 生成 skill/prompt 层 或 后端 workflow | — |
| REQ-012 | 支持 qwen_image_2_1 prompt (t2i & i2i) | P0 | 已排期 | 未开始(现用 Krea2) | 生成链路 | — |
| REQ-013 | image edit 换 qwen image2_1，评估 vs krea2 | P0 | 已排期 | 未开始(现用 Krea2 Edit) | 生成链路 | — |
| REQ-014 | 新接口 txt2image_withtxt 使用 | P0 | 已排期 | **已实现（CV-270，2026-09-30）**：端点接入 + `image_generate_withtxt` 工具（判据：画面里有要读的文字） | 生成链路 | **CV-270** |
| REQ-015 | 技能文档分辨率口径失真修正（drama 档位） | P2 | —（本仓自发现） | **已销项（2026-10-03）**：toolchain.md 已随 C-8 批重写（drama 按档 megapixels），本批补修 canvas-studio-tools.md:266 残留行（「仅 fal 生效/736p 默认」双过期）；api.md 口径本就正确（保留删除线历史） | 技能文档（toolchain / canvas-studio-tools） | C-8 批 + 2026-10-03 批 A |
| REQ-016 | 门禁机制文档收口（GATED_TOOLS 死符号） | P2 | —（本仓自发现） | **已落地·待验收（2026-10-03）**；2026-10-05 复核：两份文档 `GATED_TOOLS` 零命中，源码仅存 3 处演进史注释（按原计划保留） | 技能文档 / 文档注释 | 2026-10-03 批 A |
| REQ-017 | tts_voiceover 补「角色对白走 `<d>`」反判据 | P1 | —（本仓自发现） | **已落地·待验收（2026-10-03）**；2026-10-05 三处逐条复核通过 | 工具描述 / 技能文档 | CV-271 + 2026-10-03 批 A |
| REQ-018 | withtxt 产物错字修复路线（重跑优先于 image_fix） | P2 | —（本仓自发现） | **待拍板** | 工具描述 / 技能文档 | CV-270 |
| REQ-019 | withtxt 判据细化（装饰性背景文字不算「要读的文字」） | P2 | —（本仓自发现） | **未开始**（2026-10-05 复核推翻索引表的「已落地」：三处 grep 零命中，索引表系 2026-10-03 批乐观登记；与 REQ-018 同属待拍板描述串） | 工具描述 / 技能文档 | CV-270 |
| REQ-020 | 画布节点可手动操作连线（连/断/拖线建点）（资料库 10-07 迭代「画布手动连线」） | P0 | 已排期 | **第一增量已落地·待桌面验收（2026-10-03）**：① 断开——边命中层点选（透明宽笔画吃事件，选中高亮）+ Delete/Backspace 断开（可撤销）、Escape 取消、拖画布清选；② 连接——沿用 CV-038 拖线手势（落目标节点即连，linkLayers 合并 sourceIds）；③ 拖线落空白 → 弹「新建节点并连线」菜单（文本/提示/便签，store addNode 收 sourceIds 自动连起点）。守卫测试 tests/manual-wiring.test.mjs。**后续增量**：拖线中高亮可落目标、断开确认、连线类型语义提示 | Client 画布交互（CanvasEdges/CanvasSurface/StudioFrame/project-store） | 2026-10-03 批 B |
| REQ-021 | 应用内一键测试模式（「代驾」回归） | P1 | —（用户讨论立项，2026-10-05） | **已实现·桌面验收收口中（2026-10-06）**：R003（第三轮真机，用户执行）机器断言 21/23 PASS，唯一红为断言口径问题 **BUG-022（已修，R003 画布离线回放 23/23 全绿）**；BUG-014~021 修复全部真机实证；**验收七条机器可判项 ③④⑦ 满足，①②⑤⑥（浮窗显隐×2/清理按钮）待用户人工确认后收口登记 STATUS** | Client 编排（test-driver / AutoTestPanel）/ 检查点库（auto-test-checkpoints）/ Host 路由（test-report / storage-info）/ 画布渲染 | 设计文档 `docs/plans/应用内一键测试模式设计.md` v1.0 |

---

## REQ-001 — 为 App 增加全局资产库页面（角色/场景/物件/群像 + agent @引用）

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

## REQ-002 — 画布上实现从 480p 到 720p 生成的丝滑过渡

- **编号**：REQ-002
- **优先级**：P1
- **状态(资料库)**：已排期
- **当前落地状态**：已实现（口径已演进为 480p / 768p(默认) / 2k，非 720p）
- **归属模块**：分辨率档位（`config.ts` / `providers` / `generate.ts`）
- **需求描述**：画布上实现从 480p 到 720p 生成的丝滑过渡，让用户前期在 480 下快速试片，在 720 定下成片。
- **复现/验证路径**：
  1. 设置默认分辨率 480p，生成一张图应快速出图；
  2. 切换到 768p/2k，生成应生效；
  3. （需求字面「丝滑过渡」若指动画）画布内实时重渲染过渡——当前未做，属新增。
- **关联代码**：
  - `src/providers/types.ts:42-45`（枚举收窄为三档）
  - `src/config.ts`（`OUTPUT_SIZE`/`DEFAULT_RESOLUTION`/`sizeForAspectRatio` 带档位）
  - `src/providers/fal.ts:76-81`（`RESOLUTION_MAP` 三键直通 + `normalizeResolution`）
  - `src/generate.ts:1047`（`resolutionOf` 决策）
  - `src/host-tools.ts:1101/1162`（工具 schema 枚举）
  - `src/host-config.ts:89`（`defaultResolution`）
- **实现方案/计划**：三档 480p(864×480)/768p(1376×768,默认)/2k(1920×1088) 已由 **CV-187** 落地；图片侧逐字节按档出图（CV-188 视频像素实测纠正，768p/2k 视频需切 fal 才生效）。「过渡动画」如产品需要，属额外新需求。
- **验收标准**：480p 试片 + 768p/2k 定成片可切换；视频侧 768p/2k 经 fal 生效。
- **关联文档**：`docs/STATUS.md`(CV-187, CV-188)；`docs/archive/plans/resolution-tier-dev.md`（取代旧 `archive/resolution-tier-guide.md`）；测试 `tests/resolution-tier.test.mjs`、`tests/generate.test.mjs:721-722`、`tests/video-provider-fal.test.mjs`。
- **资料库来源**：需求表 行 2。

---

## REQ-003 — 抄 libtv 等的提示词修改框体验

- **编号**：REQ-003
- **优先级**：P0
- **状态(资料库)**：待评审
- **当前落地状态**：大部分实现（**Step 1~3 = CV-265/266/267 已于 2026-10-01 桌面验收通过**）—— A 组 = CV-265、B/C 组 = CV-266、D/E/F 组 = CV-267：A 组 = 槽位表 + 读/写纯函数 + `POST /canvas-studio/resolve-refs` 端点 + `ReferenceSlotEditor`（增 / 删 / 换 / 重排 + 位次 + 模式读数 + 断链占位 + 必填单槽只换不空）；B/C 组 = `NodePromptEditor` 画布就地浮层（一步进编辑、焦点落正文；提示词与参考图同屏；「仅保存 / 保存并重试」先落字段再重试，判据唯一走 `isReplayable`）；D/E/F 组 = 长文本分档（`promptShapeOf` 由内容算：short / long 读数+预览+展开 / ir 分段折叠）+ `editorPlacement` 贴边求解器（四侧择优 + 夹取 + 最小平移 + 窄窗 sheet + 手势守卫 + 恢复视野）+ `<Picture N>` 一致性（amber 条 + 同步编号 + 中性回执与撤销）+ F1 参考参数行 + F4 横滚 + F5 内存草稿表 + F6 键盘。**未做**：Step 4（AI 辅助改写，另行立项；0.7.0 对拍后改走本地会话模型——prompt_enhance 工具已随 image2promptenhance 端点退役，CV-268）—— 见方案 §5
- **归属模块**：Client 提示词编辑器（`PromptEditor` / `NodeDetailDrawer` / `NodeActionBar`）
- **需求描述**：抄 libtv 等的提示词修改框体验（这个 UI 需要抄）。优化提示词、图引用的快速修改和重试。
- **本批设计目标（2026-09-30 追加，来自用户原话）**：**顺畅 / 舒服 / 可精确调整** —— 长提示词分档 + 分段折叠（不在画布上硬撑全文）；节点贴边时四侧择优 + 必要时最小平移画布（面板不压住正在编辑的节点）；参考位顺序与提示词 `<Picture N>` 的一致性提示。
- **本批验收依据**：方案 §3 的 **A~F 六组交互条目清单**（2026-09-30 拍板：不强求对标 libtv，改为我方条目自验收）
- **复现/验证路径**：
  1. 选中一个生成节点，打开提示词编辑器；
  2. 应能快速改提示词并「重试」；
  3. 图引用应能快速增删并触发重试；
  4. 交互手感对标 libtv。
- **关联代码**：
  - `src/client/canvas/PromptEditor.tsx`（就地/展开/聚焦 三档编辑器，编辑只写 `generationPrompt` 不触发生成；CV-266 起 forwardRef 暴露 `commit()` 句柄 + `autoEdit`；CV-267 起只读档按 `promptShapeOf` 分流：长文本读数+预览、IR 分段折叠、展开夹高+渐隐、`onCmdEnter`）
  - `src/prompt-shape.ts`（**CV-267 新增**：形态判定阈值 + IR 无损分段 `irSegmentize` / `irReplaceSegment`）、`src/prompt-refs.ts`（**CV-267 新增**：`<Picture N>` 抽取 / 失配 / 致密化+夹取）、`src/editor-drafts.ts`（**CV-267 新增**：内存草稿表）、`src/canvas-view.ts` 的 `editorPlacement()`（**CV-267 新增**：贴边放置求解器）
  - `src/client/canvas/NodePromptEditor.tsx`（**CV-266 新增**：画布就地编辑浮层 —— 提示词与参考图同屏 + 「仅保存 / 保存并重试」页脚）
  - `src/client/canvas/CanvasSurface.tsx`（CV-266：浮层挂载与工具条互斥、选中移走即关；参考候选池/资产库/解析端点透传）
  - `src/client/canvas/ReferenceSlotEditor.tsx`（**CV-265 新增**：参考图编辑区，抽屉与浮层两处挂载同一组件）
  - `src/client/canvas/NodeDetailDrawer.tsx`（节点详情抽屉，CV-194 验收通过；CV-265 参考编辑区挂载点）
  - `src/node-params.ts`（**CV-265**：`REFERENCE_SLOTS` 槽位表 + `referenceSlotOf` / `referenceNamesOf` / `withReferenceNames` / `referenceModeLabel`）、`src/reference-resolve.ts`（**CV-265**：`resolveRefFilenames` 抽取共用）、`src/contracts/reference.ts`（**CV-265**：resolve-refs 契约）
  - `src/client/CanvasContextMenu.tsx:103`、`src/client/ReferenceTray.tsx:66`（引用到对话）
- **实现方案/计划**：功能骨架齐全；需竞品级对齐 libtv 修改框交互（悬浮内联编辑、图引用快速增删与重试流）。无专门 CV。
- **验收标准**：提示词/图引用可快速改并重试，交互对标 libtv。
- **关联文档**：[`plans/REQ-003-提示词修改框交互方案.md`](./plans/REQ-003-提示词修改框交互方案.md)（**v1.0**：A 图引用增删 / B 就地编辑 / C 改完即重试 / D 长内容 / E 贴边与视野 / F 精确调整，含槽位表、`resolve-refs` 端点、`editorPlacement` 求解器、测试与验收映射）+ 可交互效果参考 [`plans/REQ-003-提示词修改框效果参考.html`](./plans/REQ-003-提示词修改框效果参考.html)（headless 行为冒烟 59/59）+ [`plans/REQ-003-交接提示词.md`](./plans/REQ-003-交接提示词.md)（Step 2/3 执行序与测试基线）；`docs/STATUS.md` §4 CV-265 / CV-266 / CV-267、`CV-194`（节点详情抽屉含提示词三档）、`CV-013`；测试 `tests/reference-slot.test.mjs`、`tests/resolve-refs-route.test.mjs`、`tests/reference-slot-wiring.test.mjs`、`tests/canvas-prompt-edit.test.mjs`、`tests/prompt-shape.test.mjs`、`tests/picture-refs.test.mjs`、`tests/editor-placement.test.mjs`、`tests/editor-draft.test.mjs`、`tests/node-replay.test.mjs`（间接）。
- **资料库来源**：需求表 行 3。

---

## REQ-004 — 修改画布鼠标操作习惯

- **编号**：REQ-004
- **优先级**：P2
- **状态(资料库)**：已排期
- **当前落地状态**：**已落地·待桌面验收（2026-10-03）**（**2026-10-05 回填**：本条正文原写「部分实现（缩放方向恰与需求相反）」，与代码不符已更正 —— `CanvasSurface.tsx:463` 现为「滚轮 = 绕光标缩放（绕光标、Ctrl/Cmd 同义），平移走空白处按住拖动」，需求字面的「方向相反」问题已不存在）
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
- **关联文档**：`docs/STATUS.md`(CV-008 多选半成品·待验收、CV-089 选中/拖动视觉修正·待验收、CV-090 框选改进·待处理)；`docs/canvas-ux-backlog.md:43`；测试 `tests/group-tray.test.mjs`、`tests/canvas-actions.test.mjs`（间接）。
- **资料库来源**：需求表 行 4。

---

## REQ-005 — 点击左上角「Canvas Studio」返回首页；项目按改动时间排序

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

## REQ-006 — 安装包太大，建议评估 tauri 模式与官方 desktop 版

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

## REQ-007 — agent 任务更新有 bug，模型上下文长度显示有问题，升级 dsh

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

## REQ-008 — agent 对话流改造（少废话 / tools 调用中文显示）

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

## REQ-009 — 支持拖拽文本作为剧本

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

## REQ-010 — 支持拖拽音频文件作为背景参考音或说话参考音模式

- **编号**：REQ-010
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：部分实现
- **归属模块**：Host/Client 音频参考（`audio-reference.ts` / `providers/drama.ts`）
- **需求描述**：支持拖拽音频文件作为背景参考音或者说话参考音模式。
- **复现/验证路径**：
  1. 拖拽音频文件到画布（CV-241 已支持）；
  2. 选中音频节点，应可标记为「背景参考音」或「说话参考音」模式；
  3. 该模式应正确用于生成（Ref2VA 音频参考）。
- **关联代码**：
  - CV-241 四类上传含音频（`classifyFile→uploadStudioMedia`）
  - `src/audio-reference.ts`（H3 规格 audio1/audio2/audio3，2–15s、≤15s 合计、WAV/MP3）
  - `src/providers/drama.ts`（发送端已对齐 audio1/audio2/audio3）
- **实现方案/计划**：文件拖入+格式校验已通；「参考音模式」语义化选择（BGM vs 说话参考）与成片复用尚未完成（CV-043 待处理、CV-040 多段音轨待处理、CV-006 时间轴 BGM 待处理）。
- **验收标准**：拖入音频可选模式并正确用于生成。
- **关联文档**：`docs/STATUS.md`(CV-043, CV-040, CV-006)；`docs/canvas-ux-backlog.md:49`；测试 `tests/audio-reference.test.mjs`、`tests/media-drop.test.mjs`。
- **资料库来源**：需求表 行 10。

---

## REQ-011 — 支持 camera motion 和 wuxia action lora

- **编号**：REQ-011
- **优先级**：P1
- **状态(资料库)**：已排期
- **当前落地状态**：未开始
- **归属模块**：生成 skill/prompt 层 或 后端 workflow
- **需求描述**：支持 camera motion 和 wuxia action lora。`camera_motion`、`wushu_action` 为开始的 prompt 来触发相关 lora 的效果体现。附件是 prompt 写法和相关技能参考材料。
- **复现/验证路径**：
  1. 以 `camera_motion` / `wushu_action` 开头的 prompt 提交生成；
  2. 应触发对应 lora 效果。
- **关联代码**：全仓 grep `camera_motion`/`wushu`/`wuxia`/`lora` **仅在上游技能参考文案出现英文短语**（如 `skills/direct-street-interview-video/references/upstream-skill.md:37,76`），无任何触发代码/skill/配置。
- **实现方案/计划**：在 skill/prompt 层或后端 workflow 接入 `camera_motion` / `wushu_action` 作为 lora 触发前缀；需先确认后端/模型侧是否支持对应 lora。附件参考材料在资料库需求表行 11 的附件字段（prompt-sample.txt、skills.zip）。
- **验收标准**：以 `camera_motion` / `wushu_action` 开头的 prompt 能触发对应 lora 效果。
- **关联文档**：无本仓 CV、无规划文档、无测试。
- **资料库来源**：需求表 行 11（含附件 prompt-sample.txt、skills.zip）。

---

## REQ-012 — 支持 qwen_image_2_1 prompt（t2i & i2i）

- **编号**：REQ-012
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：**部分落地（2026-10-04 拍板第一版）**——qwen_image_2_1 能力已由后端 `txt2image_withtxt` 端点承载（Qwen Image 2.1，CV-270）；模型路由收编进 `src/model-route.ts`（R-P1-03）：提示词含可显示文字 → Qwen 文字渲染，其余文生图 → Krea2；qwen 独立接入（skill/参数面）仍待评估。
- **归属模块**：生成链路（`config.ts` / `generate.ts` / `host-tools.ts` / `model-route.ts`）
- **需求描述**：支持 qwen_image_2_1 prompt for t2i & i2i，skill 参考附件。
- **复现/验证路径**：
  1. 以 qwen_image_2_1 为模型发起文生图 / 图生图；
  2. 应正确生成。
- **关联代码**：`src/model-route.ts`（R-P1-03 路由表，拍板第一版：文字→Qwen / 其余→Krea2 / 图生图→Qwen）；`src/generate.ts` 图像分支消费路由；`txt2image_withtxt`（CV-270）。
- **实现方案/计划**：⚠️ 与现状冲突——本仓已全面切 Krea2。若产品确认要支持 qwen_image_2_1，需新增端点/skill 并在 `src/config.ts` / `src/generate.ts` / `src/host-tools.ts` 接入。附件参考材料在资料库需求表行 12（qwen-image-2-1-prompt.zip）。
- **验收标准**：t2i & i2i 可用 qwen_image_2_1（如产品决定切换）。
- **关联文档**：`docs/api.md:44-45`(Z-Image→Krea2 Turbo)；`src/skill-catalog.ts:103`(CV-192 落 Krea2 Turbo)；现有 `skills/qwen-image-edit-writing` 不涉及该模型。无测试。
- **资料库来源**：需求表 行 12（含附件 qwen-image-2-1-prompt.zip）。

---

## REQ-013 — image edit 已换 qwen image2_1，评估与 krea2 差异

- **编号**：REQ-013
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：**路由收编（2026-10-04 拍板）+ 对比评估待排期**——图生图链路（image2image）承载 Qwen 参考修改能力（后端现状）；R-P1-03 路由表把「图生图 → Qwen」固化为 `i2i-references` 一行；qwen vs Krea2 Edit 的体验对比评估待排期。
- **归属模块**：生成链路（`generate.ts` image2image）
- **需求描述**：image edit 已经换成 qwen image2_1，评估体验效果和 krea2 参考修改的差异，是否能用参考 image，来弥补 qwen image 修改死板的问题。
- **复现/验证路径**：
  1. 对比 qwen_image_2_1 与 Krea2 Edit 的图生图效果；
  2. 评估参考图能否弥补 qwen 修改死板。
- **关联代码**：
  - `src/generate.ts:1797`（krea2_edit 工作流，steps=9/cfg=1.0）
  - `docs/api.md:45,451`（0.3.0 起 `qwen_image_edit_3_image_ref` → Krea2 Edit）
  - `skills/qwen-image-edit-writing/SKILL.md:68`（仍写旧 `qwen_4view_char_2step`，已过时）
- **实现方案/计划**：⚠️ 与现状冲突——当前 image2image 已切 **Krea2 Edit**，非 qwen。「改用 qwen2.1 评估」命题在已选 Krea2 语境下不成立；评估结论应基于现状（image edit = Krea2 Edit）。若产品要改走 qwen_image_2_1，属新需求（与 REQ-012 统一决策）。
- **验收标准**：评估结论落地（维持 Krea2 或切换 qwen）。
- **关联文档**：`docs/api.md:45,451`；`src/generate.ts:1860`（image2character 也已转 krea2_quadview）；无 qwen2.1 相关测试。
- **资料库来源**：需求表 行 13。

---

## REQ-014 — 新接口 txt2image_withtxt 使用

- **编号**：REQ-014
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：**已实现（CV-270，2026-09-30）** —— 后端 0.8.0 新增 `txt2image_withtxt`（Qwen Image 2.1，steps=25）已接入：独立工具 **`image_generate_withtxt`**（纯文生、无参考图槽位、不接 CV-212 自动修复），选工具判据 = **画面里有要读的文字**（片名/海报字/标语），普通无字图仍走 image_generate（Krea2）。探针实测 200 / 20.7s、《剑归江湖》四字无错字（[api-probe/txt2image-withtxt-20260930](./api-probe/txt2image-withtxt-20260930/report.md)）。**残留细化项**：错字修复路线与判据边界见 REQ-018 / REQ-019
- **归属模块**：生成链路（`config.ts` / `generate.ts` / `host-tools.ts`）
- **需求描述**：新接口 txt2image_withtxt 使用，在文字多、需要排版的海报制作等时，主动避开 krea2，使用该接口；另外，尽量用 krea2 生成人物和环境，后用 image2image 或 image2fix 接口来添加文字等。目前 image2fix 接口也使用 qwen image 2_1 了，注意评估。
- **复现/验证路径**：
  1. 多文字海报场景应走 `txt2image_withtxt`；
  2. 人物/环境走 krea2，文字叠加走 image2image/image2fix。
- **实现/落地记录（2026-09-30，CV-270）**：`src/config.ts`（`txt2imageWithtxt` 端点）/ `src/generate.ts`（纯文生分支 + generationLabelOf「文字生图」+ operationTypeOf）/ `src/host-tools.ts`（工具定义）/ `docs/api.md` 0.4.0（端点节 + 映射表）/ `docs/canvas-studio-tools.md` §A1b / `docs/api-probe/txt2image-withtxt-20260930/`。⚠️ 需求原句两处已按实测修正：① image2fix 是独立 **Boogu Edit** 端点（非 qwen image 2_1）；② 「krea2 出人物环境 + image2image 叠字」与「withtxt 直出」二选一的判据写在工具描述里（选工具=选模式），不由代码强制路由。
- **验收标准**：多文字海报走 txt2image_withtxt 且中文逐字正确 ✅；普通无字图仍走 image_generate ✅；带参考图的带字场景走 image_generate ✅。（待桌面验收）
- **关联文档**：`docs/api.md`（0.4.0 修订说明）；`docs/canvas-studio-tools.md` §A1b；STATUS **CV-270**；`docs/api-probe/txt2image-withtxt-20260930/report.md`。
- **资料库来源**：需求表 行 14。

---

## REQ-015 — 技能文档分辨率口径失真修正（drama 档位）

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

## REQ-016 — 门禁机制文档收口（GATED_TOOLS 死符号）

- **编号**：REQ-016
- **优先级**：P2
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**已落地·待验收（2026-10-03）** —— 两份文档门禁段改写为 `assertApprovalAllowed` + approval-gate 两表真实口径（含 `tts_voiceover` 等 8+4 成员），并给历史决策记录里的死符号加注。**2026-10-05 复核**：`grep -c GATED_TOOLS docs/canvas-studio-tools.md docs/api.md` 均为 **0**（验收标准满足）；源码仅剩 3 处**演进史注释**（`approval-gate.ts:10` 讲原门禁只含两个视频工具、`routes.ts:1682` / `client/index.ts:1217` 讲「executing 会让门禁放行」的因果），按原计划保留 —— 它们记的是「为什么曾经有问题」，不是「现在门禁在哪实现」。
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

## REQ-017 — tts_voiceover 补「角色对白走 `<d>`」反判据

- **编号**：REQ-017
- **优先级**：P1
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**已落地·待验收（2026-10-03）** —— 工具描述 + voiceover-writing 第 0 条 + toolchain 工具表行三处反判据（角色对白 → `<d>`，本工具只做旁白/画外音/配音资产）。**2026-10-05 逐处复核通过**：`host-tools.ts:2291`（反判据 + `<d>` 路由）、`skills/voiceover-writing/SKILL.md` §一 第 0 条、`toolchain.md:52` 表格行「⚠️ 角色对白不用它」。
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

## REQ-018 — withtxt 产物错字修复路线（重跑优先于 image_fix）——**待拍板**

- **编号**：REQ-018
- **优先级**：P2
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**待拍板**（两个候选路线，见下）
- **归属模块**：工具描述（`image_generate_withtxt` / `image_fix`）/ `docs/canvas-studio-tools.md` §A1b / 技能文档
- **需求描述**：现口径（CV-270 落的）：「已出图的文字错了 → image_fix（不要整图重出）」——该理由对 Krea2 成立（Krea2 重出 9s 但丢已正确画面、Boogu 只动文字）。但对 **withtxt 产物**账不一样：withtxt 重跑 ≈ 20s 且本就是文字特化（换随机种子常一次修对），image_fix（Boogu）实测 68.5s 且是另一条改图链路 ⇒ 现口径可能引导模型走更贵更慢的路。
- **候选路线**：
  - **A（建议）**：withtxt 产物错字 → 先**重跑 withtxt**（`replaces` 原地重写）一次 → 仍错再 image_fix；image_generate（Krea2）产物错字 → 维持现口径直接 image_fix。
  - **B（维持现状）**：一律 image_fix——理由是行为统一、少一条例外；代价是 withtxt 场景平均修复耗时 ×3。
- **复现/验证路径**：
  1. withtxt 出海报，片名错一个字；
  2. 观察 agent 下一步：走 image_fix（现口径）还是重跑 withtxt（候选 A）。
- **关联代码**：`src/host-tools.ts`（image_generate_withtxt / image_fix 描述互提）；`docs/canvas-studio-tools.md` §A1b「选工具判据」；`skills/voiceover-writing` 不涉及。
- **实现方案/计划**：拍板后改两处描述 + §A1b 判据行 + api.md withtxt 节「文字仍出错」句；若选 A，`image_fix` 描述补「Krea2/withtxt 重跑一次更划算时不要用本工具」的边界。
- **验收标准**：两工具描述与 §A1b/api.md 同口径；真机抽查 withtxt 错字场景路由符合拍板结论。
- **关联文档**：`docs/api-probe/txt2image-withtxt-20260930/report.md`（20.7s）、`docs/api-probe/image2fix-20260918/report.md`（68.5s）——耗时账的取证。
- **来源**：2026-09-30 工具调用条件审计（需用户拍板，故单列）。

---

## REQ-019 — withtxt 判据细化（装饰性背景文字不算「要读的文字」）

- **编号**：REQ-019
- **优先级**：P2
- **状态(资料库)**：—（本仓自发现，未入资料库）
- **当前落地状态**：**未开始（2026-10-05 复核：索引表原写「已落地·待验收」不成立）** —— 逐处 grep「装饰性 / 虚化招牌 / 霓虹」在 `host-tools.ts`、`toolchain.md`、`canvas-studio-tools.md` **零命中**。索引表该行是 2026-10-03 批的乐观登记，实际未落。本轮**不实施**（与 REQ-018 同属「待拍板」的描述串，改动要一起走），只把状态改回与代码一致。
- **归属模块**：工具描述（`image_generate_withtxt`）/ `docs/canvas-studio-tools.md` §A1b / `skills/canvas-studio-creation/references/toolchain.md`
- **需求描述**：withtxt 的选工具判据「画面里有**要读的**文字」依赖模型对「要读」的理解。真实场景里大量画面含**装饰性/不可读**文字：虚化的店铺招牌、背景霓虹灯牌、衣物上的字母印花、远处的标语文本——这些不需要逐字正确，走 Krea2（9s）即可；判据不含糊的话，模型可能把所有带字的图都路由到 withtxt（20s，慢 2 倍+），白烧队列时间。
- **复现/验证路径**：
  1. 对话说「画一张雨夜街道，背景有霓虹招牌」→ 期望 image_generate（背景招牌是氛围，不要求可读）；
  2. 对话说「画一张海报，标题『暑期特惠』」→ 期望 image_generate_withtxt。
- **关联代码**：`src/host-tools.ts` image_generate_withtxt description（CV-270）；`docs/canvas-studio-tools.md` §A1b；toolchain.md 工具表行。
- **实现方案/计划**：三处描述补一句：「**不要求逐字可读的背景 / 装饰性文字（虚化招牌、霓虹灯牌、衣物印花）不算「要读的文字」，仍走 image_generate**——只有观众需要读清内容的文字（标题 / 台词字幕卡 / 价格标签）才用本工具」。与 REQ-018 同批改（同一组描述串）。
- **验收标准**：三处口径一致含装饰性文字排除句；真机抽查两类场景路由各归其位。
- **关联文档**：`docs/api.md` withtxt 节「选工具判据」；STATUS CV-270。
- **来源**：2026-09-30 工具调用条件审计。

---

## 待收口的记账偏差（2026-09-30 逐条核对发现，**尚未修正**）

> 这些是「文档与代码不符」但不影响上表状态判定的项，按「不动产品代码、不与验收批次混提」的原则留在这里，由下一轮开发顺手收口。

| # | 偏差 | 现状（以代码为准） | 状态 |
|---|---|---|---|
| 1 | **REQ-002 口径过期** | 代码是 **736p**（1280×736 / 0.9MP）：`src/config.ts:125`（`SIZE_BY_RESOLUTION`）、`:136`（`MEGAPIXELS_BY_RESOLUTION`）、`:141`（`DEFAULT_RESOLUTION`）；768p→736p 的改名提交为 `cc66dc0ed0`（2026-09-20）。本文件 REQ-002 段、`docs/archive/plans/resolution-tier-dev.md` 与 `docs/STATUS.md`（8 处）仍写 768p / 1376×768 / 1.0MP | **待产品确认口径**。`docs/canvas-studio-tools.md` 的 `resolution` 行已按 736p 写对（C-8 批），只剩本文件与 STATUS / archive 未改；`STATUS.md` 属**历史变更记录**的行按「history 就是 history」不改 |
| 2 | **REQ-010 依据过期** | 该段称「CV-006 时间轴 BGM 待处理」，实际 STATUS §4 已登记 CV-006 **已修复·待验收**（时间轴 chip 勾选排除、BGM 下拉均已落地）；拖入音频 + 格式校验 + 生成侧 `audioRefs` 也已通 | **待回填**（下一轮动 REQ-010 时一并更正） |
| 3 | **文件路径漂移** | REQ-003 段写 `src/client/CanvasContextMenu.tsx`、`src/client/LayerPanel.tsx`，实际在 `src/client/canvas/` 下 | **REQ-004 段已于 2026-10-05 校正**（见该段关联代码）；REQ-003 段仍待改 |
| 4 | **资料库（SSOT）未复核** | 本次环境没有 library skill 的 `space_api.py`，无法按「同步协议」重新导出需求表 ⇒「状态(资料库)」列可能落后于真实库 | **仍未复核**。在带 library skill 的环境重跑 `database.get_database_content` 并 diff |
| 5 | ~~质量闸门缺口~~ **已收口（2026-10-05 复核）** | 原写「`yarn check` 不含 `test:smoke`」不成立：`package.json` 的 `check` = `typecheck && build && verify:loader && test:smoke`，`test:smoke` 已在闸内 | ✅ **已解决**。仍有 5 条基线红靠 `tests/baseline-red.json` 名单对「净增 0」（`run-smoke` 门禁自动判定并打印名单外新增） |

---

## REQ-020 — 画布节点可手动操作连线（R-P0-12，资料库 10-07 迭代）

- **编号**：REQ-020（资料库「画布手动连线」行，2026-10-02 对账认作净增需求）
- **优先级**：P0 ｜ **状态(资料库)**：已排期（10-07 迭代）
- **当前落地状态**：**第一增量已落地·待桌面验收（2026-10-03）**（见索引表行）
- **需求描述**：画布节点可手动操作连线，各连线能手工连接和断开；能拖动连线放开后弹出菜单手动创建节点。
- **实现要点**：边 = target.sourceIds 派生（无独立边表，plan §7.3）——断开 = unlinkNodes（与 linkLayers 对偶、进撤销栈）；连接 = CV-038 拖线手势落目标节点；拖线建点 = 落空白回调 CanvasEdgeCreateMenu（文本/提示/便签，addNode 带 sourceIds）。
- **验收标准**：① 点一条边 → 高亮 → Delete 断开（Ctrl+Z 可恢复）；② 从节点右缘拖到另一节点 → 出线；③ 拖到空白 → 菜单选类型 → 新节点落在放点并连到起点；④ 既有生成血缘边不受影响（反向变异：断开生成边后节点重放仍按 generationPrompt，血缘仅显示层）。
- **关联代码**：`src/client/project-store.ts`（unlinkNodes/addNode sourceIds）；`src/client/canvas/CanvasEdges.tsx`（命中层/选中态）；`src/client/canvas/CanvasSurface.tsx`（selectedEdge/键盘/落空回调）；`src/client/StudioFrame.tsx`（回调接线 + CanvasEdgeCreateMenu）。
- **来源**：资料库需求表 2026-10-02 导出；2026-10-03 批 B 落地。

---

## CV-277 — 废弃视频事件修复批（2026-10-05，揽月湾真机取证发现）

> 本批不是需求，是**缺陷修复**（对应 BUG-011~013 与本文件的三条自发现项），记在这里是因为它同时改了 `requirement-tracker` 涉及的判据层（镜位锚点解析）。完整复盘见根仓 `docs/tracking/lanyue-bay-retro-20261005.md`，待改清单见 `docs/tracking/fix-list-20261005.md`。

### 缺陷本体

- **CV-277-a（严重）** 镜位级取代判据误伤 → 多参考图跨镜时退化为**全局版本串链**。`shot-versions.ts:199-205` 原判据是「血缘里有任一张分镜卡相同即取代」，而 `shot-format.md` 第 9 步要求逐镜参考组合 ≥3 张、agent 补位会引用别镜关键帧，CV-031 继承把**多张**分镜卡写进同一条视频的 `sourceIds` ⇒ 任意两条视频共享一张卡 ⇒ 6 条串成 v1→v6、5 条误标废弃（**其中 2 条实际已在成片里**），`defaultComposeClips` 只剩 1 段 ⇒ UI 点导出得 5.17s 单镜残片，白烧 3 条视频（8.5 min GPU + 4.25 MB）。
  - **修法**：判据从「有交集」改为「**旧节点锚点集 ⊆ 新节点锚点集**」，且锚点两侧同口径（`shotAnchorCardsOf` / `newNodeAnchorCards`：**显式 `shotRefs` 声明优先，血缘继承仅在恰好一张时回退，多张一律拒绝自动取代**）。同镜位换参考组合重跑（CV-222 原始场景）仍自动取代。
  - **代码**：`src/shot-versions.ts`（新增 `shotAnchorCardsOf` 导出 + 两个内部 helper，判据改写）；`src/generate.ts:2571-2574`（锚点派生注释）。
  - **测试**：`tests/shot-versions.test.mjs` 新增 5 条（串链回归 / 同镜重跑不回归 / 漏传 shotRefs 的唯一与多卡分流 / 无锚点不触发 / `shotAnchorCardsOf` 契约）。**原 16 条守卫全部零回归** —— 其中「不同镜位互不误伤」原用每镜只挂一卡的干净形态，测不到多卡交叉，这是该缺陷此前能标「已验收」的原因。
  - **现场回放验证**：用 `canvas.json` 真实数据（每镜血缘确实含 2 张卡）重放 6 次提交，新判据下 3 条视频互不取代、同镜重跑正确取代，`defaultComposeClips` 选出 3 段 15.00s。

- **CV-277-b（一般）** 废弃片段把缺省合成打成单镜残片**且无任何警告**（UI 路径无 `clipIds` 绕过口）。→ `compose_video` 在「非显式 clipIds + 只收 1 段 + 画布逐镜总数 >1」时追加一条 warning，明说其余为失效版本并给出两条出口（`list_shots(includeRetired=true)` 核对 / `clipIds` 显式指定）。**不改判定**（`isShotClip` 仍是全仓唯一口径）。代码 `src/host-tools.ts`。

- **CV-277-c（一般）** 废弃产物进 GC 保护名单 ⇒ **永不自动清理**（CV-246 的「未删条目 = 保护名单」是刻意设计，代价是没给「不想要了」的出口）。→ 新增 `POST /canvas-studio/asset-history/prune-retired` + 历史抽屉「清理失效产物（N）」按钮：只收**失效的图/视频**（成片/音频/文本/`isLoading` 一律不动，生成中的在 `busyNodes` 里回报），删节点 + 解引用下游 `generationPrompt`（B-4 语义：数组位删元素、标量位标 `[已删除:…]`）+ 物理删 + 标 `deletedAt`，N 个文件**合并成一次** `writeCanvas`。GC 保护语义不变（仍是用户主动触发）。
  - **代码**：`src/routes.ts`（新路由）、`src/client/api.ts`（`pruneRetiredStudioAssets`）、`src/client/canvas/HistoryDrawer.tsx`（按钮 + 确认条 + 清理后 `onCanvasReloaded`）、`src/client/contracts.ts` + `index.ts` + `StudioFrame.tsx`（`reloadCanvas` 接线，走既有 `reloadCanvasQueued`）、`src/client/styles.ts`（`csHistPrune` / `csHistConfirmBar`）。
  - **测试**：`tests/retired-assets-cleanup.test.mjs` 5 条（清理范围 / 保留清单 / 下游解引用 / 无事可做不写盘 / 权威守卫与单条删除路由同口径）。

- **CV-277-d（一般）** 分镜卡标题被 `promptSummary` 截成 12 字（`广角空镜风光摄影，正面平…`），而 `@ref[标题]` 走 `findNodeByRef` **精确匹配** ⇒ agent 不敢用 `@ref`，现场绕道 `upload_image` 多跑一趟。→ `list_references` 的参考图条目与资产卡锚点分图**都补节点 id**，工具描述写明「优先 `@ref[<节点 id>]`」。**不改** `promptSummary` 的 `max`（短标题在图层面板更清爽）。代码 `src/host-tools.ts`；回归 `tests/reference.test.mjs`（原断言 `front.png、full.png` 随分隔符变化同步更新）。

### 验证

两套 typecheck + 三段构建全绿；`test:smoke` **1280 / 1280 通过，失败 0 条，基线名单外新增 0 条**（基线 1272 → 1280，新增 8 条即本批守卫）。

---

## REQ-021 — 应用内一键测试模式（「代驾」回归）

- **编号**：REQ-021（2026-10-05 用户讨论立项，设计当日拍板，建议本号入册）
- **优先级**：P1 ｜ **状态(资料库)**：—（未入资料库需求表，用户讨论直接立项）
- **当前落地状态**：**已实现·待桌面验收（2026-10-05，D1/D2/D3 三批，铁律 STATUS 不登记）**
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
  - **验收七条判定**：③④⑦ 机器证据满足（全链报告落盘 / 改写链断言通过且 10 条取代全正确 / projects.json 仅新增测试项目）；①②⑤⑥（浮窗显隐×2、清理按钮）待用户人工确认后 REQ-021 收口、进 STATUS 登记。
  - 附加观察：agent 主动同步海报到新形象（R002 留人工，本轮纪律执行更完整）；IR 简报落盘 brief-shot1/2/3.txt 且官方校验器 3/3 PASS；时间轴审计 15.51s vs 15.00s（帧量化已知漂移）；qc_shot 按 auto 规则跳过（断言化列入 v2 候选）。
- **REQ-021 v2 规划（2026-10-05 登记，不实现，待排期）**：
  - 检查点参数化：`storyboard-cards === 3` / `videos-active` 期望 3 条 / `history-volume` 下限（2 定妆 + 3 关键帧 + 3 视频 + …）均为硬编码，需把期望值挪进场景定义，才能支撑多场景复用同一断言库。
  - 成片时长断言：`duration` ±0.6s（H3 帧量化容差，对齐 CV-140 真实时长探测口径）。
  - chain 衔接镜覆盖：`shotTransition=chain` 的末帧提取 → 下镜首参考（衔接纪律机器化）。
  - 场景变体**待用户拍板**：10s×2 镜冒烟 vs 20s×4~5 镜合并压测——后者必须先修 BUG-014（4~5 镜总时长会顶破 50min 旧上限；本批修复后已可行，选型仍未拍板）。
  - 挂改进项→**已拉前落地（2026-10-06，BUG-019）**：路由断言结构化改造（Host 生成时持久化 `routeModel` 路由字段，替代从产物名 filename 猜——R002 实证 filename 形态跨后端不一，为 BUG-015 的结构性根因）。
- **来源**：2026-10-05 用户讨论；设计文档 `docs/plans/应用内一键测试模式设计.md` v1.0（commit 5febc891fb）；2026-10-05 D1/D2/D3 落地。
