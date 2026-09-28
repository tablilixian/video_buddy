# Canvas Studio — 需求追踪（资料库镜像 + 落地映射）

> **用途**：本文件是 WorkBuddy 资料库「videobuddy」> 项目管理面板 > **需求表** 的本地镜像与落地映射层。
> 资料库是需求的**唯一事实源（SSOT）**；本文件把它和本仓库（canvas-studio 插件）当前的代码/文档状态做对齐，
> 让任何接手的 AI 都能无歧义地继续开发。
>
> **来源链接**：https://www.workbuddy.cn/space/s/ktBQ9YyiEjOPsBwa2d7IsL
> - 空间 `videobuddy`（spaceId: `ktBQ9YyiEjOPsBwa2d7IsL`）→ 项目管理面板（`Ki8efaAlxb6bTjTSj8KEJL`）→ **需求表**（database `dKDCSVOxZA6bjjmyZgF8DL`）
> **本地镜像生成时间**：2026-09-27
> **资料库当前状态**：14 条需求（P0×9、P1×3、P2×2），状态含「待评审 / 已排期」

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
| **DSH 宿主层** | 需求 7（agent 任务更新/上下文长度）由 deepseek-harness-desktop（DSH）宿主提供，源码不在本插件仓；本仓仅有契约声明（`src/client/contracts.ts:99`），无法独立修复。 | REQ-007 |
| **720p 已演进为 768p** | 需求 2 写「480p→720p」，但产品已拍板改为 480p/768p(默认)/2k 三档（CV-187）。 | REQ-002 |

> **行动建议**：REQ-012/013/014 与 REQ-007 在动手前需先与产品/上游确认路线（是否回切 qwen、是否在 DSH 仓处理），不要凭需求字面直接改代码。

---

## 索引表

| 编号 | 标题 | 优先级 | 状态(资料库) | 当前落地状态 | 归属模块 | 关联 CV |
|---|---|---|---|---|---|---|
| REQ-001 | 全局资产库页面（角色/场景/物件/群像 + @引用） | P0 | 已排期 | 部分实现(Step 1 Host + Step 3 引用已落地，Step 2 UI 待做) | Host 资产服务 / Client 资产库页 / reference-token | @ref=CV-114, **CV-255** |
| REQ-002 | 画布 480p→720p 丝滑过渡 | P1 | 已排期 | 已实现(实际 480p/768p/2k) | 分辨率档位 | CV-187, CV-188 |
| REQ-003 | 抄 libtv 提示词修改框体验 | P0 | 待评审 | 部分实现 | Client 提示词编辑器 | CV-194 |
| REQ-004 | 画布鼠标操作习惯（滚轮缩放/多选/批量引用） | P2 | 已排期 | 部分实现(缩放方向相反) | Client 画布交互 | CV-008, CV-089, CV-090 |
| REQ-005 | Canvas Studio 返回首页 + 项目按改动时间排序 | P2 | 已排期 | 部分实现(排序未做) | Client Lobby/首页 | CV-064, CV-088 |
| REQ-006 | 安装包太大，评估 tauri / 官方 desktop 版 | P1 | 已排期 | 已拍板(维持 Electron universal) | 打包 / Electron | CV-201, B1 |
| REQ-007 | agent 任务更新 bug + 模型上下文长度显示，升级 dsh | P0 | 待评审 | 未开始(DSH 宿主层，本仓无法独立修) | DSH 宿主(非本仓) | — |
| REQ-008 | agent 对话流改造（少废话/中文 tool 显示） | P0 | 待评审 | 部分实现(CV-175 进行中) | Client 对话流 / workflow-stage | CV-175, DD-09 |
| REQ-009 | 支持拖拽文本作为剧本 | P0 | 已排期 | 已实现(CV-241 待验收) | Host/Client 上传 | CV-241 |
| REQ-010 | 支持拖拽音频作背景/说话参考音 | P0 | 已排期 | 部分实现 | Host/Client 音频参考 | CV-043, CV-040, CV-006 |
| REQ-011 | 支持 camera motion 和 wuxia action lora | P1 | 已排期 | 未开始 | 生成 skill/prompt 层 或 后端 workflow | — |
| REQ-012 | 支持 qwen_image_2_1 prompt (t2i & i2i) | P0 | 已排期 | 未开始(现用 Krea2) | 生成链路 | — |
| REQ-013 | image edit 换 qwen image2_1，评估 vs krea2 | P0 | 已排期 | 未开始(现用 Krea2 Edit) | 生成链路 | — |
| REQ-014 | 新接口 txt2image_withtxt 使用 | P0 | 已排期 | 未开始(现用 image2fix) | 生成链路 | — |

---

## REQ-001 — 为 App 增加全局资产库页面（角色/场景/物件/群像 + agent @引用）

- **编号**：REQ-001
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：**部分实现** —— Step 1「Host 资产服务」+ Step 3「引用链路」已落地并机器验证（**CV-255**，2026-09-28）；**Step 2「Client 资产库页」待开工**，验收①②③全部卡在这一步
- **归属模块**：Host 资产服务（`asset-library.ts` / `routes.ts`）/ Client 资产库页面（`AssetLibrary.tsx`，待建）/ `reference-token` + `reference-source`
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
  - ⬜ **Step 2 Client 资产库页**（待开工）：`AssetLibrary.tsx` overlay + `csLib*` 令牌 + 四分类导航/搜索/卡片网格/右侧详情抽屉 + `StudioFrame`/`LobbyHero`/`CanvasContextMenu` 三入口 + F1「加入资产库」流程；
  - ⬜ **联调 + 验收**：§6.1 五条逐条过 + 回归 + `gcLibraryAssets` 补齐。
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
- **关联文档**：`docs/STATUS.md`(CV-187, CV-188)；`docs/plans/resolution-tier-dev.md`（取代旧 `resolution-tier-guide.md`）；测试 `tests/resolution-tier.test.mjs`、`tests/generate.test.mjs:721-722`、`tests/video-provider-fal.test.mjs`。
- **资料库来源**：需求表 行 2。

---

## REQ-003 — 抄 libtv 等的提示词修改框体验

- **编号**：REQ-003
- **优先级**：P0
- **状态(资料库)**：待评审
- **当前落地状态**：部分实现
- **归属模块**：Client 提示词编辑器（`PromptEditor` / `NodeDetailDrawer`）
- **需求描述**：抄 libtv 等的提示词修改框体验（这个 UI 需要抄）。优化提示词、图引用的快速修改和重试。
- **复现/验证路径**：
  1. 选中一个生成节点，打开提示词编辑器；
  2. 应能快速改提示词并「重试」；
  3. 图引用应能快速增删并触发重试；
  4. 交互手感对标 libtv。
- **关联代码**：
  - `src/client/canvas/PromptEditor.tsx:21-36`（就地/展开/聚焦 三档编辑器，编辑只写 `generationPrompt` 不触发生成）
  - `src/client/canvas/PromptEditor.tsx:109-110,155,162,195`（重试按钮）
  - `src/client/canvas/NodeDetailDrawer.tsx`（节点详情抽屉，CV-194 验收通过）
  - `src/client/CanvasContextMenu.tsx:103`、`src/client/ReferenceTray.tsx:66`（引用到对话）
- **实现方案/计划**：功能骨架齐全；需竞品级对齐 libtv 修改框交互（悬浮内联编辑、图引用快速增删与重试流）。无专门 CV。
- **验收标准**：提示词/图引用可快速改并重试，交互对标 libtv。
- **关联文档**：`docs/STATUS.md`(CV-194 节点详情抽屉含提示词三档)、`CV-013`；测试 `tests/node-replay.test.mjs`、`tests/param-guard.test.mjs`（间接）。
- **资料库来源**：需求表 行 3。

---

## REQ-004 — 修改画布鼠标操作习惯

- **编号**：REQ-004
- **优先级**：P2
- **状态(资料库)**：已排期
- **当前落地状态**：部分实现（缩放方向恰与需求相反；多选半成品）
- **归属模块**：Client 画布交互（`CanvasSurface`）
- **需求描述**：改 `Ctrl+滚轮=缩放` 为 `滚轮=缩放`（单手习惯）；选中效果不明显；`Ctrl+选中` 多个目标后，无法一起进入「引用到对话」等一起操作。
- **复现/验证路径**：
  1. 滚轮滚动画布，当前是平移，期望是缩放；
  2. `Ctrl/Cmd+点击` 累加多个节点，期望选中态明显；
  3. 选中多个后右键「引用到对话」，当前只对单节点生效。
- **关联代码**：
  - `src/client/canvas/CanvasSurface.tsx:197-198,367-388`（普通滚轮=平移、Ctrl/Cmd+滚轮=缩放，**方向相反**）
  - `src/client/canvas/CanvasSurface.tsx:524,543`（Ctrl/Cmd 累加选中）
  - `src/client/CanvasContextMenu.tsx:103`、`src/client/ReferenceTray.tsx:66`（单节点引用）
  - `src/client/LayerPanel.tsx:48`（按类型批量选中，无批量引用）
- **实现方案/计划**：改 wheel handler 使滚轮直接缩放；增强选中视觉；实现多选后批量「引用到对话」。
- **验收标准**：滚轮缩放；多选自如；批量引用可用。
- **关联文档**：`docs/STATUS.md`(CV-008 多选半成品·待验收、CV-089 选中/拖动视觉修正·待验收、CV-090 框选改进·待处理)；`docs/canvas-ux-backlog.md:43`；测试 `tests/group-tray.test.mjs`、`tests/canvas-actions.test.mjs`（间接）。
- **资料库来源**：需求表 行 4。

---

## REQ-005 — 点击左上角「Canvas Studio」返回首页；项目按改动时间排序

- **编号**：REQ-005
- **优先级**：P2
- **状态(资料库)**：已排期
- **当前落地状态**：部分实现（首页存在；按修改时间排序未做）
- **归属模块**：Client Lobby/首页（`index.ts` / `LobbyHero` / `ProjectList`）
- **需求描述**：点击左上角「Canvas Studio」区域需返回首页，每次进入 app 需停留在首页；项目需按改动时间排序，最近的在前。
- **复现/验证路径**：
  1. 进入任意项目后，点击左上角品牌区，应回首页；
  2. 首页项目列表应按最近改动时间倒序。
- **关联代码**：
  - `src/client/index.ts`（lobby 态切换）
  - `src/client/LobbyHero.tsx`、`src/client/styles.ts:5568,5981`（`.csLobbyBrand`）
  - `src/projects.ts:430,607,626,650,783`（`updatedAt` 字段已有写入）
  - `src/client/ProjectList.tsx:143`（仅 `groups.sort((a,b)=>a.order-b.order)` 按分组 order）、`:126`（仅展示 `createdAt`）
- **实现方案/计划**：见 [`docs/plans/REQ-005-首页对话式创建与项目排序方案.md`](./plans/REQ-005-首页对话式创建与项目排序方案.md)（2026-09-28，评审中）。范围已扩展为「首页对话式创建」：新建项目弹窗与首页合并（输入创意回车即自动建项目+自动发首条消息，弹窗删除），排序（`updatedAt` 倒序 + touch 写回）与品牌区回首页（homePinned 抑制 syncActiveProject 跳回）一并收口。
- **验收标准**：点击 Canvas Studio 回首页；项目按最近改动排序。
- **关联文档**：`docs/STATUS.md`(CV-064, CV-088 首页)；测试 `tests/projects-dir.test.mjs`、`tests/projects-registry-merge.test.mjs`。
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
  - `docs/plans/bundled-ffmpeg.md`（含双架构 DMG 方案 B 评估，标注「量大，暂不动」）
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
- **当前落地状态**：未开始（属 DSH 宿主层，本插件仓无法独立修复）
- **归属模块**：DSH 宿主（deepseek-harness-desktop，非本插件仓）
- **需求描述**：agent 任务更新有 bug，模型上下文长度显示有问题。升级 dsh。
- **复现/验证路径**：
  1. 在 DSH 桌面端观察 agent 任务更新是否异常；
  2. 检查模型上下文长度显示是否正确。
- **关联代码**：
  - `src/client/contracts.ts:99`（「披露的最大上下文窗口」字段定义，仅契约声明）
  - `src/client/index.ts`（conversation 服务调用）
  - 本仓**无** task-update bug 修复或上下文长度显示逻辑
- **实现方案/计划**：需回到 **deepseek-harness-desktop（DSH）仓库**处理；本插件仅配合升级宿主版本（更新 dependency 指向新 DSH）。**不要在本仓改 agent 对话/task 更新逻辑。**
- **验收标准**：升级 DSH 后任务更新无 bug、上下文长度显示正确。
- **关联文档**：无本仓 CV；属 DSH 仓条目。
- **资料库来源**：需求表 行 7。

---

## REQ-008 — agent 对话流改造（少废话 / tools 调用中文显示）

- **编号**：REQ-008
- **优先级**：P0
- **状态(资料库)**：待评审
- **当前落地状态**：部分实现（右栏对话区 CV-175 进行中，中文 tool 标签未实现）
- **归属模块**：Client 对话流（`ChatStrip`）/ `workflow-stage`
- **需求描述**：agent 对话流需要改造。目前废话显示太多，tools 调用应该更直观，比如中文显示「生成xxx图」「生成xxx分镜视频」。一些其他 tools 调用都可省略不显示。用户需要看到跟项目最相关的生成信息，且默认用户不懂 agent harness。
- **复现/验证路径**：
  1. 观察对话流，应仅展示与项目相关的生成进展；
  2. tool 调用应渲染为中文（如「生成xxx图」），次要 tools 省略。
- **关联代码**：
  - `src/client/ChatStrip.tsx`（对话流承载）
  - `src/workflow-stage.ts:61`（`WORKFLOW_STAGE_LABELS = ['剧本','分镜','定妆','关键帧','镜头','成片']`）
  - grep `生成/toolCall/tool_name` 在 ChatStrip **无命中**（中文 tool 映射未实现）
- **实现方案/计划**：在对话渲染层新增 tool→中文标签映射（生成图/分镜视频等），默认隐藏次要 tools，仅展示项目相关生成信息。右栏对话区视觉升维 DD-09/CV-175 进行中（a 守卫 b 可收起 c 阶段 chip d 读数带已落地，e~g 待做）。
- **验收标准**：用户看到中文、与项目相关的生成进展；废话/次要 tool 调用被省略。
- **关联文档**：`docs/STATUS.md:408`(CV-175 进行中)、DD-09；本仓测试无对话流 tool 渲染断言。
- **资料库来源**：需求表 行 8。

---

## REQ-009 — 支持拖拽文本作为剧本

- **编号**：REQ-009
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：已实现（CV-241，待桌面验收）
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
- **当前落地状态**：未开始（现用 Krea2 Turbo，无 `qwen_image_2_1` 引用）
- **归属模块**：生成链路（`config.ts` / `generate.ts` / `host-tools.ts`）
- **需求描述**：支持 qwen_image_2_1 prompt for t2i & i2i，skill 参考附件。
- **复现/验证路径**：
  1. 以 qwen_image_2_1 为模型发起文生图 / 图生图；
  2. 应正确生成。
- **关联代码**：全仓**无 `qwen_image_2_1` / `qwen-image-2` 任何引用**；当前 `txt2image`/`txt2imageanime`/`image2image` 走 **Krea2 Turbo**（`src/generate.ts:1792-1847`，CV-192 落 Krea2）。
- **实现方案/计划**：⚠️ 与现状冲突——本仓已全面切 Krea2。若产品确认要支持 qwen_image_2_1，需新增端点/skill 并在 `src/config.ts` / `src/generate.ts` / `src/host-tools.ts` 接入。附件参考材料在资料库需求表行 12（qwen-image-2-1-prompt.zip）。
- **验收标准**：t2i & i2i 可用 qwen_image_2_1（如产品决定切换）。
- **关联文档**：`docs/api.md:44-45`(Z-Image→Krea2 Turbo)；`src/skill-catalog.ts:103`(CV-192 落 Krea2 Turbo)；现有 `skills/qwen-image-edit-writing` 不涉及该模型。无测试。
- **资料库来源**：需求表 行 12（含附件 qwen-image-2-1-prompt.zip）。

---

## REQ-013 — image edit 已换 qwen image2_1，评估与 krea2 差异

- **编号**：REQ-013
- **优先级**：P0
- **状态(资料库)**：已排期
- **当前落地状态**：未开始（现 image edit 已用 Krea2 Edit，非 qwen）
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
- **当前落地状态**：未开始（现用 image2fix 处理图内文字，无 `txt2image_withtxt`）
- **归属模块**：生成链路（`config.ts` / `generate.ts` / `text-detection.ts`）
- **需求描述**：新接口 txt2image_withtxt 使用，在文字多、需要排版的海报制作等时，主动避开 krea2，使用该接口；另外，尽量用 krea2 生成人物和环境，后用 image2image 或 image2fix 接口来添加文字等。目前 image2fix 接口也使用 qwen image 2_1 了，注意评估。
- **复现/验证路径**：
  1. 多文字海报场景应走 `txt2image_withtxt`；
  2. 人物/环境走 krea2，文字叠加走 image2image/image2fix。
- **关联代码**：全仓**无 `txt2image_withtxt` 端点或调用**；现有端点 `txt2image`/`txt2imageanime`/`image2image`/`image2character`/`image2fix`（`src/config.ts:18-29`）；图内文字当前走 **`image2fix`**（Boogu Edit，`src/generate.ts:1872-1881`、`src/text-detection.ts:189-272` 抽两段文字约束 CV-218/D6）。
- **实现方案/计划**：⚠️ 与现状冲突——`image2fix` 是独立 **Boogu Edit** 端点，非 qwen（需求称其「用 qwen image 2_1」不实）。需新增 `txt2image_withtxt` 端点接入（`src/config.ts`/`src/generate.ts`）+ 文字密度判定逻辑（多文字海报主动切换），并据 image2fix 现状评估互补关系。
- **验收标准**：多文字海报走 txt2image_withtxt；人物/环境走 krea2；文字叠加走 image2fix。
- **关联文档**：`docs/api-probe/image2fix-20260918/`（探针）；`src/text-detection.ts`（CV-218/D6）；无 txt2image_withtxt 测试。
- **资料库来源**：需求表 行 14。
