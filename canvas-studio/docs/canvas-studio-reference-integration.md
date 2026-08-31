# Canvas Studio 参考代码集成计划（reference/ 评估与分阶段安排）

> 本文档是对 `reference/`（WL-AI-Director Canvas 模块，95 个文件）的评估结论与集成安排。
> 目标：把适合当前项目（Canvas Studio 插件，P4+ 完整版画布）的机制分阶段落地。
> **执行状态（2026-08-20）：S1–S7 全部落地完成并提交推送（`9a314b6e88`）。** 每阶段完成情况见各阶段标题标注；`check` 全绿、`test:smoke` 16/16 通过。本插件改动与根级 `yarn check` 的 dsh-community-* 缺失阻塞无关。

## 1. 输入盘点

| 输入 | 位置 | 规模 | 说明 |
| --- | --- | --- | --- |
| 设计文档 | `reference/canvas-module-design.md` | 766 行 | 模块设计权威文档：数据模型 / store / 组件 / 服务 / 持久化 / 注意事项 |
| 类型 | `reference/canvas/types/{canvas,flow,video}.ts` | 541 行 | LayerData / PromptLayer / FlowState / VideoNodeConfig / 全景 / 导出 |
| 工具 | `reference/canvas/utils/{autoLayout,layerUtils,canvasMath,panoramaUtils}.ts` | 771 行 | 自动布局树算法、图层工具、数学工具 |
| Hooks | `reference/canvas/hooks/{useCanvasState,useCanvasControls,useSnapAlignment,usePanoramaEngine}.ts` | 1418 行 | Zustand store（898 行）、平移缩放、吸附对齐 |
| 组件 | `reference/canvas/components/**`（50 个） | ~1.5 万行 | InfiniteCanvas / CanvasLayer / ConnectionLines / Minimap / LayerPanel / LayerDetailPanel / 各种 AI 生成面板 |
| 服务 | `reference/canvas/services/**` | 8 个 | 模型服务 / 集成服务 / 完整性校验 / 缩略图 / 提示词优化 / 全景 |
| 数据 | `reference/canvas/data/styleTemplates.ts` | 1 个 | 风格模板库 |

## 2. 评估结论（对照现有 plan §7.2/§7.4/§7.5）

参考代码的**数据模型与交互机制**与此前 plan 的既定决策完全一致（血缘即边、operationType 颜色映射、LayerData 字段集、store action 清单），说明 plan 的方向被参考实现证实。具体差异在**架构约束**：参考代码基于 Zustand + Tailwind + IndexedDB 的 React 19 项目，DSH 侧必须按插件纪律改写（§4）。

### 2.1 高复用（概念/算法/结构级借鉴）

| 参考文件 | 借鉴内容 | 复用级别 |
| --- | --- | --- |
| `types/canvas.ts` | LayerData 字段全集（对照 plan §7.2 决策） | 概念（字段映射已定） |
| `utils/canvasMath.ts` | clamp/lerp/pointInRect/rectsOverlap/getCenter/screenToWorld/worldToScreen/calculateBounds | 概念 → 可近逐字（纯函数） |
| `utils/layerUtils.ts` | createLayer/duplicateLayer/sortLayersByZIndex/group/parent 系列 | 结构（改类型后近逐字） |
| `utils/autoLayout.ts` | 基于 sourceLayerId/parentId 建树 + 簇/行/父子间距的自动布局 | 算法（独立函数，可移植） |
| `hooks/useCanvasControls.ts` | 中键/Shift 平移、Ctrl+滚轮缩放（0.1–5x）、zoomIn/Out/resetZoom/fitToContent | 结构（改 store 接入） |
| `hooks/useSnapAlignment.ts` | 5px 阈值六类对齐线（左/右/中心 × 垂直水平）+ 网格吸附 | 结构（纯计算，近逐字） |
| `components/ConnectionLines.tsx` | 贝塞尔曲线 + operationType→颜色/中文标签映射 + 箭头 marker + 多源角色标签 + 选中高亮 | 结构（渲染无状态，高复用） |
| `components/Minimap.tsx` | 内容边界拟合 + 视口框拖拽导航 + 按类型着色 | 结构 |
| `components/CanvasLayer.tsx` | 拖拽（含 group 子图层联动）、resize 把手、双击重命名、ctrl/cmd 多选、locked 拦截、交互元素抑制、上下文菜单语义 | 结构（核心交互细节） |
| `components/LayerPanel.tsx` | 图层列表（搜索/分组展开/缩略图/类型图标/层级操作） | 结构 |
| `components/LayerDetailPanel.tsx` | 属性面板（改名/来源/操作类型展示/删除） | 结构 |
| `hooks/useCanvasState.ts` | 快照式 undo/redo（MAX_HISTORY=20）、clipboard copy/paste、z-order 四操作、align/distribute、group/ungroup、searchLayers | 概念（action 语义清单，plan §7.4 已列） |

### 2.2 需适配（结构保留、接入改写）

| 参考实现 | 适配方式 |
| --- | --- |
| Zustand `create()` | → `defineStore` store 工厂（`project-store.ts` 既有模式），actions 语义照搬 |
| Tailwind class | → `styles.ts` 的 `--dsw-alias-*` 主题 token（纪律：不得写死色值/currentColor） |
| 组件直接 `useCanvasStore()` | → props 四份额（PropsRuntime/PropsStore/PropsRenderSlots/InjectFace），组件不见 ctx |
| `src` base64/blob/`local:`/`video:` 协议 | → webServer 相对 URL `/canvas-studio/assets/...`（既有 §19 决策，不引入 IndexedDB 资产库） |
| IndexedDB 持久化 | → Host 侧 `canvas.json` 原子写 + 合并写（既有 §17/§18 决策，不引入 IndexedDB） |
| `InfiniteCanvas` 巨型容器（1489 行，全状态内聚） | → 保持现有拆分（CanvasSurface/CanvasNode/CanvasTimeline），交互逻辑按机制抽取 |
| `unifiedImageService` | → `ResolvedImage` 的 LOD 概念可借鉴（thumbnail 缩略图 + blob revoke），接入点为节点 URL 渲染 |

### 2.3 不移植（明确排除）

| 参考文件 | 排除理由 |
| --- | --- |
| 全部 AI 生成面板（StyleTemplatePanel / GenerateVideoPanel / ImageEditPanel / InpaintPanel / PromptBar / VideoNodePanel / H3VideoLab / StoryDeductionFlowPanel 等 ~30 个） | DSH 增值是 agent 自主编排（plan §7.5：AI 面板由 agent 工具承担），对话区即操作入口 |
| PromptLayer / PromptLinkPanel / PromptBar 提示词链路 | 依赖 chatCompletion/提示词优化服务，agent 侧已有完整链路；节点语义可由 `prompt` kind 覆盖 |
| 全景/Three.js（PanoramaViewer / usePanoramaEngine / panoramaUtils / panoramaGenerationService） | plan §7.2 已裁 `panorama` 类型 |
| `drawing` 图层 + DrawingToolbar + annotations 标注 | plan §7.2 暂缓（annotations ⏸）；后续如需绘图再评估 |
| flow.ts FlowState / StoryDeduction 面板 | 结构化编排替代方案（plan §8 记录为可选），agent 编排已覆盖 |
| 数据完整性服务（canvasIntegrity / CanvasIntegrityBanner） | 价值低、接入面大；DSH 持久化走 Host 单写者 + 合并写 |
| thumbnailService / 缩略图生成 | 首版以 `thumbnail` 字段 + 直接渲染保底；性能问题出现后再加 |

## 3. 现状差距（当前实现 vs 目标形态）

> 下表为集成前差距快照（历史记录）。集成完成后各差距项均已闭合：节点模型 v2（operationType/generationPrompt/locked/visible/opacity/zIndex/parentId/flipX/flipY/loading/progress/error/duration）、连线着色+箭头+标签+角色+高亮、吸附/多选/resize/重命名/锁定/右键菜单、中键平移/Ctrl 滚轮/fit/快捷键、快照 undo/redo(cap 20)、工具栏/图层面板/属性面板、minimap、手动连线、group/ungroup/align/distribute/autoArrange。

| 能力 | 当前（P4+） | 参考目标 | 差距 |
| --- | --- | --- | --- |
| 节点模型 | 13 字段（无视觉状态） | 29 字段 | 缺 operationType/generationPrompt/thumbnail/duration/locked/visible/opacity/zIndex/parentId/flipX/flipY/isLoading/progress/error |
| 连线 | 纯贝塞尔灰线 | 颜色/箭头/标签/多源角色/选中高亮 | 大 |
| 节点交互 | 拖拽 + 单选 | 吸附/多选/resize/重命名/锁定/右键菜单 | 大 |
| 画布交互 | 左键平移 + 滚轮缩放 | 中键/Shift 平移 + Ctrl 滚轮 + fitToContent + 快捷键 | 中 |
| undo/redo | 无 | 快照 20 步 | 大 |
| 工具栏/面板 | 无 | 工具栏 + 图层列表 + 属性面板 | 大 |
| minimap | 无 | 有 | 大 |
| 手动连线 | 无（血缘即边） | 连接手柄拖拽建边 | 中 |
| 分组/对齐 | 无 | group/ungroup/align/distribute/autoLayout | 大 |

## 4. 集成纪律（每条落地必须满足）

1. 组件不得见 ctx；state/actions 一律经 store 工厂 + props 四份额注入（沿用 `StudioFrame.tsx`/`project-store.ts` 既有模式）
2. 颜色一律 `--dsw-alias-*` 主题 token；Tailwind class 全部改写为 `styles.ts` 内 CSS 类
3. 新字段进 `contracts/canvas.ts`（纯类型，双半共享）；`canvas.json` 加版本迁移（version 1 → 2）
4. Host 侧为节点单一真相源；写画布必须走合并写（防拖拽保存误删 Host 节点）
5. 产物 URL 保持相对路径；不引入 blob:/local:/video: 协议与 IndexedDB 资产库
6. 源码级标注借鉴来源文件（`reference/canvas/...`），便于许可证边界审计（见 §5）
7. 中文文案保留参考语义；每阶段完成 `check`（build + verify:loader + typecheck）+ `test:smoke` + 必要的 CDP/桌面可视化验收
8. 每阶段单独提交：还原子模块 → 只 stage `canvas-studio` + `docs` → commit → push；同步更新 plan 与 handoff 文档

## 5. 许可证边界（既有 §8 记录的延续）

WL-AI-Director 为 CC BY-NC-SA 4.0（非商业），DSH Desktop 为 MIT：**逐字代码移植有许可冲突风险**。本集成全部按「概念/算法/结构借鉴 + 按 DSH 纪律重写」，不逐字复制实现；每个借鉴点保留来源文件标注。若未来需要逐字移植（如 ConnectionLines 渲染细节），需先获得作者授权（联系 antskpro@qq.com）。

## 6. 分阶段集成安排

阶段顺序按「数据层 → 渲染 → 交互 → 面板 → 高级编排」推进，每阶段可独立验收、独立提交。

### S1 节点模型补齐 + 文档迁移（基础层）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：`contracts/canvas.ts` 扩为 v2（`CANVAS_DOCUMENT_VERSION = 2` + `NODE_DEFAULTS`）；`projects.ts` `normalizeCanvasDocument` 做 v1→v2 迁移；`generate.ts` `operationTypeOf`/`generationPromptOf`。验证：旧 `canvas.json` 迁移不丢节点；typecheck 全绿；`test:smoke` 覆盖。

| 项 | 内容 |
| --- | --- |
| 来源 | `types/canvas.ts` LayerData；plan §7.2 映射表 |
| 目标 | `contracts/canvas.ts` `StudioCanvasNode` + `StudioCanvasDocument.version` 1→2 |
| 改动 | 新增字段：`operationType`（DSH 语义值 + 保留 WL 通用值）、`generationPrompt`、`thumbnail`、`duration`、`locked`、`visible`、`opacity`、`zIndex`、`flipX`、`flipY`、`isLoading`、`progress`、`error`、`parentId`；`origin` 扩展 `'agent'\|'manual'` 语义不变 |
| 适配 | Host `writeCanvas` 做 version 迁移（旧节点补默认值：visible=true、opacity=1、zIndex=按 createdAt 递增、locked=false）；`addAsset` 落盘时填 operationType/generationPrompt（从工具参数取） |
| 验证 | 旧 `canvas.json` 打开不丢节点；新字段在 `lib/` 产物可见；`test:smoke` 加迁移用例 |

### S2 连线渲染升级（血缘可视化）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：`CanvasEdges.tsx` 重写 —— 按操作类型着色 + 水平控制偏移贝塞尔 + 箭头 marker + 边中点中文胶囊 + 多源角色标签 + 选中高亮；props 改 `selectedNodeIds`。验证：typecheck 全绿；dev-seed 下可见带色/箭头/标签的血缘边。

| 项 | 内容 |
| --- | --- |
| 来源 | `components/ConnectionLines.tsx`（378 行，渲染无状态） |
| 目标 | `canvas/CanvasEdges.tsx` |
| 改动 | operationType→颜色映射表 + 中文标签映射表（含多源角色标签：direct-style-transfer 目标图/风格参考 等，按 DSH operationType 裁剪）；贝塞尔曲线改为水平控制偏移（`|dx|*0.5`）；箭头 marker（按操作类型着色）；边中点标签胶囊；选中节点时边加粗高亮；多源按序排列 |
| 适配 | 无状态组件，props 只增（nodes + selectedNodeId + 可选 onEdgeSelect）；SVG overflow-visible 保持 |
| 验证 | `?cs-dev-seed=1` 下血缘边带颜色/箭头/标签；typecheck 全绿 |

### S3 画布交互补强（节点级 + 视口级）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：`project-store.ts` 全量重写（多选、快照历史 cap 20、剪贴板、z 序、编组/解组、对齐/分布、autoArrange、linkLayers、pending 三件套 + selectors）；`canvas-math.ts`（clamp/calculateSnap 六类对齐线 + 网格吸附/contentBounds/screen↔world）；`CanvasNode.tsx`（8 向缩放把手、内联重命名、连线手柄、锁定/加载/错误角标）；`CanvasSurface.tsx`（中键/Shift 平移、Ctrl+滚轮绕光标缩放 0.1–5、fitToContent、窗口快捷键、拖拽吸附 + 引导线、resize/link 手势、缩放簇）。吸附计算为纯函数、快照历史在 store 工厂内，符合 §4 纪律。

| 项 | 内容 |
| --- | --- |
| 来源 | `components/CanvasLayer.tsx`（拖拽/多选/锁定/重命名/交互元素抑制）、`hooks/useCanvasControls.ts`、`hooks/useSnapAlignment.ts`、`utils/canvasMath.ts` |
| 目标 | `canvas/CanvasNode.tsx`、`canvas/CanvasSurface.tsx`、`project-store.ts` actions |
| 改动 | ① 节点拖拽接入吸附（6 类对齐线 + 可选网格 50px，5px 阈值；拖拽时显示对齐引导线）；② ctrl/cmd 多选（`selectedNodeIds` 数组态，store 加 `selectNode(id, multi?)`）；③ locked 节点拦截拖拽/缩放；④ resize 把手（8 向，最小 50px）；⑤ 双击重命名（inline input）；⑥ 交互元素（textarea/input/button）按下不启动拖拽；⑦ 中键/Shift+左键平移、Ctrl+滚轮缩放（范围 0.1–5）、zoomIn/Out/resetZoom/fitToContent；⑧ 快捷键：Delete 删除、Ctrl+C/V 复制粘贴、Ctrl+Z/Y undo/redo（store 快照历史，MAX_HISTORY=20） |
| 适配 | 吸附计算为纯函数（不依赖 store），组件内 useRef 持有；历史快照进 store 工厂（layers 数组浅拷贝 + 时间戳，快照 push 时机=动作 commit 前） |
| 验证 | CDP/桌面：多选拖拽、对齐线出现、缩放平移与 fit 均正常；`test:smoke` 加 store 历史/吸附用例 |

### S4 节点状态视觉（生成态/视觉属性渲染）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：`asset-capture.ts` 新增可选 `onToolCall`（kind/runId/arguments → 放置 loading 占位节点 + 不定进度条）与 `onToolError`（`tool/result` 的 `data.error` 字符串/`{message}` → 红边错误角标 + 兜底文案）；成功结果触发现有 reloadCanvas 重载（Host 单一真相源）。前置事实：**上游无 `tool/error` 事件**，错误以 `tool/result` 的 `data.error` 呈现（`session-checkpoint-policy/tests/crash-recovery.e2e.ts` 佐证）。

| 项 | 内容 |
| --- | --- |
| 来源 | LayerData 字段语义（isLoading/progress/error/locked/visible/opacity/zIndex/flipX/flipY） |
| 目标 | `canvas/CanvasNode.tsx` + `styles.ts` |
| 改动 | generating 态（isLoading）：骨架/进度条覆盖（同步 API 下进度为不定条）；error：红边 + 错误角标（plan §7.6 tool/error 链路）；locked：锁角标；visible=false：隐藏（不入拖拽/边渲染）；opacity 应用；flipX/flipY CSS transform；zIndex 排序渲染 + 选中节点提升至 100（参考 §9.7：置顶 maxZ+1 / 置底 minZ-1）；multi-select 选中框 |
| 适配 | Host `addAsset` 已写 isLoading 生命周期（tool/call → result），S1 字段落地后此处接渲染；删除节点时边自动消失（血缘即边无需清理） |
| 验证 | dev-seed 注入 locked/hidden/opacity/flip 示例节点验证渲染；真实生成走 tool/error 链路看红标 |

### S5 工具栏 + 图层面板 + 属性面板 + Minimap（面板层）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：新增 `CanvasToolbar.tsx`（undo/redo、删除、编组/解组、6 对齐、2 分布、整理布局、+便签/文本/提示）、`LayerPanel.tsx`（搜索、缩略图、锁定/可见/置顶/置底/删除、ctrl 多选、组缩进）、`LayerDetailPanel.tsx`（标题、元信息、透明度/镜像/锁定/可见/层级、重试/修改提示词/打断/删除、steer 输入）、`Minimap.tsx`（内容边界拟合 + 视口框拖拽导航 + 按 kind 着色）；全部并入 `StudioFrame` 布局（280px | 1fr | 380px），样式在 `styles.ts` 走 `--dsw-alias-*` token。

| 项 | 内容 |
| --- | --- |
| 来源 | `components/LayerPanel.tsx`、`components/LayerDetailPanel.tsx`、`components/Minimap.tsx`、设计文档 §5.2 CanvasToolbar |
| 目标 | `client/canvas/` 新增 `CanvasToolbar.tsx` / `LayerPanel.tsx` / `LayerDetailPanel.tsx` / `Minimap.tsx`；`StudioFrame.tsx` 布局接入 |
| 改动 | ① 精简工具栏：选择 / 手型 / 添加素材（sticky/text/import 入口）/ 新建连线 / fitToContent / 缩放显示；② 图层列表：缩略图 + 类型图标 + 搜索 + 分组展开 + 右键层级操作（置顶/置底/上移/下移/锁定/隐藏/删除/重命名）+ 多选联动；③ 属性面板：选中单节点时显示 改名 / 锁定 / 可见 / 透明度 / 翻转 / 操作类型标签 / 生成提示词只读 / 删除；④ Minimap：内容边界拟合 + 视口拖拽导航 + 按类型着色 |
| 适配 | 全部走 store actions（S3 已扩）；面板挂 `StudioFrame` 左/中栏（不占对话区）；Tailwind → CSS 类；props 四份额 |
| 验证 | 桌面人工：面板操作与画布实时联动；minimap 拖拽导航；暗/亮主题下 token 正确 |

### S6 手动连线 + 分组 + 对齐 + 自动布局（高级编排）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：store `linkLayers(sourceIds, targetId)` + `CanvasSurface` 连线手柄（拖出临时边落到目标节点建血缘）；`group/ungroup`（parentId + `'group'` kind 节点，`StudioCanvasNodeKind` 已含）；`alignLayers`/`distributeLayers`；`autoArrange`（按血缘深度排序布局）；删除节点时边自动消失（血缘即边）。autoLayout 为 store action 内纯计算，结果合并写持久化。

| 项 | 内容 |
| --- | --- |
| 来源 | `hooks/useCanvasState.ts`（linkLayers/group/align/distribute/autoArrange）、`utils/autoLayout.ts`（441 行树布局）、`utils/layerUtils.ts` |
| 目标 | `project-store.ts` actions + `CanvasSurface` 连接手柄 + 工具栏按钮 |
| 改动 | ① `linkLayers(sourceIds, targetId)` action + 节点侧连接手柄（拖出临时线，落到目标节点建血缘）；② group/ungroup（parentId + group 节点）、组拖拽联动子图层；③ alignLayers/distributeLayers（左/中/右/上/中/下 + 水平/垂直分布）；④ autoLayout（按 sourceLayerId/parentId 建树 → 簇 200px/行 200px/父子 240px 间距一键整理） |
| 适配 | autoLayout 为纯函数（输入 nodes 输出新坐标），store action 调用后合并写持久化；手柄拖线为 CanvasSurface 本地 state |
| 验证 | dev-seed 乱序节点 → 一键整理；手动连线 → 边即时出现且持久化后恢复 |

### S7 P5 交互联动（cancel/steer/retry 与节点状态）—— ✅ 已完成（commit `9a314b6e88`）

> 落地：`generate.ts` 支持 `params.retryOf` —— 同节点原地更新（保留 id/位置/血缘/编组、清 error、不产生新边），`generationPrompt` 存可重放参数（`generationPromptOf` 剥离 `retryOf` 锚点）；`api.ts` `retryStudioNode` 解析重放 + overrides；客户端注入面加 `'sessions'`，`cancelCurrentTurn` 走 `ctx.sessions.binding(current).session.cancel()`（`SessionFace.cancel()`，源码核实：`sessions` 为合法 client inject）；「修改提示词」= steer + 同节点重执行；重试/修改提示词/打断入口在右键菜单与属性面板。

| 项 | 内容 |
| --- | --- |
| 来源 | plan §7.6 事件流映射；现有 `runId`/`toolName` 锚点 |
| 目标 | `client/index.ts` + `host-tools.ts` |
| 改动 | ① 节点右键「重试」→ 复用 `generationPrompt`/血缘重发工具调用（同一 runId 更新节点，不产生新边，plan §7.8 标准 2）；② 「打断」→ `AgentHandle.cancel` + 节点标 `error:'已中断'`（既有 §6 语义）；③ 「修改提示词」→ steer 后同节点重执行 |
| 前置 | S1/S4 字段与视觉就绪 |
| 验证 | 对话中途打断 → 节点中断态；单节点重试 → 同节点更新、边数不变 |

## 7. 决策清单（已确认）

| 决策点 | 结论 |
| --- | --- |
| 执行范围 | **A. 全部 S1–S7 依次落地**（用户确认「全做」）|
| 阶段粒度 | 每阶段独立提交 + 最后统一提交本次集成（`9a314b6e88` 含 S2–S7 与新增测试；S1 并入）|
| S5 面板布局 | 工具栏/面板并入 `StudioFrame` 帧布局（左 280px 图层面板 / 中画布 / 右 380px 属性面板）|
| S6 手动连线优先级 | 与 S3 store actions 一并落地（连接手柄在 CanvasSurface）|
| handoff 同步 | `canvas-studio-handoff.md` 已按 2026-08-20 现状重写（见该文档 §2 集成摘要）|
| 剩余事项 | 桌面可视化验收（建议）、主计划 `canvas-studio.md` P4+ 章节修订、store 单测补强（可选）|

## 8. 参考文件地图（来源标注用）

| 借鉴点 | 来源文件 |
| --- | --- |
| 节点字段/状态语义 | `reference/canvas/types/canvas.ts` |
| 对齐吸附 | `reference/canvas/hooks/useSnapAlignment.ts` |
| 平移缩放/fit | `reference/canvas/hooks/useCanvasControls.ts` + `utils/canvasMath.ts` |
| 连线渲染 | `reference/canvas/components/ConnectionLines.tsx` |
| 节点交互细节 | `reference/canvas/components/CanvasLayer.tsx` |
| 小地图 | `reference/canvas/components/Minimap.tsx` |
| 图层列表/属性面板 | `reference/canvas/components/LayerPanel.tsx` / `LayerDetailPanel.tsx` |
| 自动布局 | `reference/canvas/utils/autoLayout.ts` |
| store action 语义/历史 | `reference/canvas/hooks/useCanvasState.ts` |
| 图层工具 | `reference/canvas/utils/layerUtils.ts` |