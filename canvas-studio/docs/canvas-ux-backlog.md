# 画布客户端 UX 待办清单（Canvas UX Backlog）

> 来源：2026-08-28 对 `src/client/` 全部画布组件的代码级审查（含 StudioFrame / project-store / question-capture）。
> 用途：作为画布逐步优化的追踪清单。每处理完一项，更新对应「状态」列并在文末「变更记录」追加一行。
>
> 状态取值：`待处理` / `进行中` / `已完成` / `已否决`（附原因）。
> 优先级：`P0`（bug / 功能断裂）> `P1`（核心工作流缺口）> `P2`（体验优化）。

## P0 — 真 bug / 功能断裂

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-001 | 待处理 | P0 | 文本类节点（sticky/text/prompt）创建后**无法编辑正文**：工具栏创建的节点正文永远是默认值；详情面板只有改名等属性，没有正文编辑入口；双击打开的也是该面板 | `CanvasNode.tsx`（只读渲染 L181-188）、`LayerDetailPanel.tsx`、`project-store.ts`（缺 updateText 动作） | 双击文本类节点进入**节点内联 textarea 编辑**（失焦/Enter 提交）；详情面板同步加正文编辑区。见决策点 D1 |
| CV-002 | 待处理 | P0 | `ask_user_choice` 的 `allowFreeText` UI 丢失：Host 工具支持自由输入（品牌名等开放要素），数据带字段但点选卡片只渲染选项按钮 | `question-capture.tsx`（QuestionNodeView L83-98） | `allowFreeText=true` 时渲染输入框 + 提交按钮，答案走同一条 `onAnswer` 通道 |
| CV-003 | 待处理 | P0 | Minimap 跳转用 `window.innerWidth/innerHeight` 计算视口居中；画布是三栏布局的中间列，居中会**系统性偏移**（把左右栏宽度算进去） | `Minimap.tsx`（jumpTo L68-79） | 传入 surface 容器实际尺寸（containerRef 实测），替换 window 尺寸 |
| CV-004 | 待处理 | P0 | 操作/类型标签三处重复定义且已漂移：`storyboard-split` 在 `CanvasEdges.OPERATION_LABELS` 有中文标签，但 `CanvasNode.OPERATION_LABELS` 漏掉 → 详情面板显示原始英文 key；`KIND_LABEL` 也有 3 份 | `CanvasNode.tsx`、`CanvasEdges.tsx`、`LayerPanel.tsx`、`LayerDetailPanel.tsx`、`CanvasTimeline.tsx` | 抽取到共享模块（如 `client/canvas/labels.ts` 或 contracts），五处共用 |

## P1 — 功能缺口（核心工作流）

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-005 | 待处理 | P1 | 血缘连线**只能加不能删**：手动 link 后无 UI 移除单条边（sourceIds 无编辑入口）；Agent 画错血缘同样无法修正 | `CanvasEdges.tsx`、`CanvasContextMenu.tsx`、`project-store.ts` | 点击边高亮 + Delete 删除；或详情面板加「来源列表」逐项 ×。见决策点 D3 |
| CV-006 | 待处理 | P1 | compose **无法排除片段**：导出固定取时间轴上全部 kind=video（StudioFrame handleComposeExport）；废弃片段必须删除才能排除；工具支持 `bgmNodeId` 但 UI 无 BGM 选择器（代码注释自认「第一版从简」） | `StudioFrame.tsx`、`CanvasTimeline.tsx` | 时间轴 chip 加**勾选态**（默认勾选），compose 只取勾选项；工具条加 BGM 节点选择器 |
| CV-007 | 待处理 | P1 | 时间轴语义混乱：便签/文本/分镜表 chip 与媒体混排、可拖排序，与成片无关；只有「视频片段 N」计数，**无总时长**显示 | `CanvasTimeline.tsx` | 非媒体节点折叠/置灰不可拖；chip 显示各自 duration；工具条显示总时长 Σ。与 CV-006 一并做。见决策点 D2 |
| CV-008 | 待处理 | P1 | 多选是半成品：只能 ctrl 点选；**拖拽只移动被按下的单个节点**（gesture 仅带单 nodeId）；group 节点拖动不带动 children；无框选（marquee） | `CanvasSurface.tsx`（Gesture / onNodePointerDown / onPointerMove）、`project-store.ts`（moveNode） | gesture 支持多 id 集合整体移动；group 拖动带动 parentId 成员；补 marquee 框选 |
| CV-009 | 待处理 | P1 | 图层面板选中不定位：时间轴点击会居中跳转（focusNodeId），LayerPanel 点击只改选中——节点在视野外时用户找不到 | `LayerPanel.tsx`、`StudioFrame.tsx` | 复用 focusNodeId 机制，LayerPanel 点击同样触发居中 |
| CV-010 | 待处理 | P1 | loading 节点无时间感：视频生成 5–10 分钟只有不确定进度条，无法区分「正常」与「卡死」 | `CanvasNode.tsx`（isLoading overlay） | overlay 加已耗时计时（MM:SS）；超阈值（如 3 分钟）提示可打断 |

## P2 — 信息展示优化

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-011 | 待处理 | P2 | 画布上看不出节点是否为参考图（要切托盘/详情）；参考托盘空时直接不渲染，新用户不知道该能力存在 | `CanvasNode.tsx`、`StudioFrame.tsx`（referenceNodes.length > 0 才渲染托盘） | 参考节点加角色色点角标；托盘空态显示引导文案 |
| CV-012 | 已完成 | P2 | 生成参数是原始 JSON：详情面板 `<pre>` 直出，prompt 恰是用户最想看/复制的字段；steer 编辑框预填为空，用户要自己从 JSON 里抠提示词 | `LayerDetailPanel.tsx`（L234-239、L264-282） | 已实现：解析 generationPrompt 为「提示词（可复制）/ 参考图缩略图（filename 反查节点）/ 参数行 / 原始 JSON 折叠」四段；steer 输入框预填当前 prompt |
| CV-013 | 待处理 | P2 | 导入节点分辨率永远「未知」（落盘不探测），客户端可用 Image/video 元数据零成本回填 | `StudioFrame.tsx`（handleUploadImage）、`project-store.ts`（addImportNode） | 上传/导入成功后客户端读元数据回写 mediaWidth/mediaHeight |
| CV-014 | 待处理 | P2 | 边 chip 无 LOD：节点一多每条边中点都挂中文 chip，低缩放下噪音大 | `CanvasEdges.tsx` | scale < 0.6 时隐藏 chip 只留线；选中节点相关边保持 chip |
| CV-015 | 待处理 | P2 | 错误/成功提示用 `window.alert`（阻塞式原生弹窗）：上传失败、成片成功、合成失败全是 alert | `StudioFrame.tsx`（多处） | 引入轻量 toast（3s 自动消失）；成片成功 toast 配「定位到节点」动作 |

## P2 — 交互补全

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-016 | 待处理 | P2 | 右键空白处无菜单（不能在光标处新建便签/粘贴）；addNode 固定落点 | `CanvasSurface.tsx`、`StudioFrame.tsx` | 空白右键菜单：在此处新建便签/文本/提示、粘贴、适配视野 |
| CV-017 | 待处理 | P2 | 方向键不能微调选中节点位置（画布类产品标配：1px，Shift+方向 10px） | `CanvasSurface.tsx`（keydown 处理器） | 方向键微调 + 持久化 |
| CV-018 | 待处理 | P2 | 失败节点本体没有就地「重试」按钮——错误 badge 不可点，要开右键或详情 | `CanvasNode.tsx` | 失败态 badge 兼作重试按钮（点击弹确认或直接重试） |
| CV-019 | 待处理 | P2 | 无「缩放到选中」（zoom to selection）；双击空白 = fitToContent 的习惯也未支持 | `CanvasSurface.tsx`（CanvasSurfaceHandle） | handle 增加 zoomToSelection；双击空白触发 fit |
| CV-020 | 待处理 | P2 | 资产无下载/另存入口（单图、成片导出到本地），成片目前只能画布内播放 | `CanvasNode.tsx`、`LayerDetailPanel.tsx` | 详情面板/右键加「下载」（a[download] 指向资产 URL） |
| CV-021 | 待处理 | P2 | 删除被血缘引用的节点时无提示，下游 sourceIds 静默悬空（渲染不报错但信息链断裂） | `StudioFrame.tsx`（handleDelete）、`project-store.ts` | 删除前检测是否有下游引用并提示；或删除时级联清理子节点 sourceIds |
| CV-022 | 已完成 | P1 | 血缘依赖 Agent 自觉填 sourceUrls，不可靠（2026-08-28 需求讨论确定） | `generate.ts` | 已实现：`resolveSourceIdsByFilename` 按 Drama filename 反查素材节点，与 URL 反查取并集（去重保序）；`generateAsset` 与 `splitStoryboard` 均接入；新增测试「血缘自动反查」 |
| CV-023 | 已完成 | P1 | 用户输入的创意未落画布，画布缺少「创意从哪来」的叙事锚点（2026-08-28 需求讨论确定，捕获方案已拍板：方案 A 仅首条用户消息） | `client/`（conversationEvents 新 definition 匹配用户消息事件）+ `project-store.ts` | 已实现：`brief-capture.ts` 匹配 `user/message` 且 `source.kind==='user'`（排除 skill/文件通知等合成注入）；store 新增 `addBriefNode`（幂等，每项目至多一个 `toolName=user_brief` 节点，落在画布原点）；画布未载入时暂存、重载完成后补落（历史重放竞态）；旧项目打开时经历史重放自动补落 |
| CV-024 | 已完成 | P1 | 生成节点落盘坐标硬编码 x:0,y:0，全叠在原点，靠手动「整理布局」，无法形成创意→素材→生成物的流向感（2026-08-28 需求讨论确定纳入） | `generate.ts`（落盘坐标）、`canvas-view.ts`（computeArrangeLayout） | 已实现：`deriveNodePlacement` —— 新节点排在其血缘来源节点右侧一列（y 对齐来源），重叠时右移避让（有界 50 步）；无来源回退网格空位；`generateAsset` / `splitStoryboard`（子节点行内等距展开）接入。retryOf 原地更新不受影响 |
| CV-025 | 已完成 | P1 | 创意到分镜/文案没有连线，画布叙事链断在第一环（2026-08-28 用户提出） | `host-tools.ts`（submit_storyboard_for_approval / write_script）、`contracts/canvas.ts` | 已实现：`BRIEF_NODE_TOOL` 常量上移到共享契约；分镜表与文案节点落盘时自动查找创意节点并挂接 `sourceIds`（血缘边自动出现），同时按 CV-024 排在其右侧 |
| CV-026 | 已完成 | P1 | 分镜表整表挤在一个大文本节点里，无法逐镜对照生成（2026-08-28 用户提出） | `host-tools.ts`（submit_storyboard_for_approval） | 已实现：`parseStoryboardShots` 解析 markdown 逐镜表格（容错：丢弃分隔/表头行、<3 列行），每镜拆为独立「分镜 N · 景别」节点（正文【镜 N】景别 · 运动 · 时长 + 画面/声音），血缘指向创意、每行 3 个横向排列；解析失败回退整表单节点。已知限制：重复提交分镜会追加新节点（与旧行为一致，去重待做） |

## 决策点（实施前需对齐）

| ID | 状态 | 问题 | 候选方案 |
| --- | --- | --- | --- |
| D1 | 待讨论 | CV-001 文本编辑放哪 | A. 双击文本类节点=内联编辑、媒体类双击=详情（按 kind 区分语义）<br>B. 统一双击=详情，编辑只在详情面板 |
| D2 | 待讨论 | CV-007 时间轴定位 | A. 保持「回看条」（全节点混排）<br>B. 升级为「剪辑序列」（只媒体、可勾选、显总时长）——与 CV-006/007 合并实施 |
| D3 | 待讨论 | CV-005 连线删除语义 | 手动边与 Agent 写的 sourceIds 统一可删（删除可撤销），避免「有的边能删有的不能」 |

## 变更记录

| 日期 | 条目 | 变更 | 备注 |
| --- | --- | --- | --- |
| 2026-08-28 | 全部 | 初版建单（21 项 + 3 决策点），来源：全量代码审查 | |
| 2026-08-28 | CV-012、CV-022（新增） | 完成生成参数结构化展示与血缘自动反查；新增 CV-023（创意节点，方案 A）、CV-024（落点策略）；health 负缓存测试对齐「失败不缓存」新语义 | 测试套件 74/74 全绿；顺带修复：`generate.ts` 运行时配置未注入时的编译期默认值兜底（`runtime()`）、`createStudioTools` cfg 可选化 |
| 2026-08-28 | CV-023 | 完成：`brief-capture.ts` 捕获首条真人消息 → `addBriefNode` 幂等落「创意」节点；index.ts 三处 reload 链上补落 + 暂存竞态处理 | 测试 74/74；旧项目打开时经会话历史重放自动补落 |
| 2026-08-28 | CV-024、CV-025（新增） | 完成：落点策略（血缘来源右侧 + 防重叠 + 网格回退）接入 generateAsset/splitStoryboard；创意→分镜/文案自动连边（BRIEF_NODE_TOOL 上移共享契约） | 测试 76/76（新增落点策略、创意血缘 2 个用例） |
| 2026-08-28 | CV-026（新增） | 完成：分镜表逐镜拆分为独立节点（parseStoryboardShots + formatStoryboardShot，血缘指向创意、每行 3 卡横向排列、解析失败回退单节点） | 测试 77/77 |
