# 已封存 · CV 已完成条目存档（ARCHIVE）

> ## 已封存 — 请勿参考、请勿编辑
>
> 本文件是**历史归档**。收录的 35 条 CV 条目状态均为 **`已完成`**
> （代码已落地 **且** 用户桌面验收通过），**全部已结项，不再有任何后续动作**。
>
> | | |
> | --- | --- |
> | 不要在这里找待办 | 待办唯一入口是 [STATUS.md](./STATUS.md) |
> | 不要在本文件改状态 / 加条目 / 记新问题 | 本文件只读，后续维护一律走 STATUS.md |
> | 唯一合法用途 | 追溯「某功能当年为什么这么做 / 实现细节是什么」 |
>
> **封存日期**：2026-09-03　**来源**：`canvas-ux-backlog.md` 条目行 + `STATUS.md` §2.2 已解决索引 + §4 主线全量表
> **封存范围**：严格按「已完成」状态（不含「已修复·待验收」「已完成·待验收」——那 32 条仍在 STATUS.md 等待桌面回归）
> **抽离效果**：活跃条目 90 → 55 条，全部留在 [STATUS.md](./STATUS.md) 继续追踪

---

## 目录

| 优先级 | 条目数 | 条目 |
| --- | --- | --- |
| P0 | 8 | CV-001, CV-002, CV-003, CV-004, CV-030, CV-033, CV-034, CV-037 |
| P1 | 10 | CV-009, CV-010, CV-022, CV-023, CV-024, CV-025, CV-026, CV-027, CV-029, CV-031 |
| P2 | 17 | CV-011, CV-012, CV-013, CV-014, CV-015, CV-016, CV-017, CV-018, CV-019, CV-020, CV-028, CV-032, CV-035, CV-038, CV-041, CV-044, CV-045 |

---

## 存档正文

> 字段说明：**问题** = 原始缺陷/需求描述（含根因）；**落地方案** = 实施细节与技术决策；
> **涉及文件** = 改动面；**一句话** = 当时 STATUS.md 的摘要。内容原样搬迁，未作删改。

### P0（8 条）

#### CV-001 · 文本类节点无法编辑正文 → 双击内联编辑 + 详情面板正文区

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：文本类节点（sticky/text/prompt）创建后**无法编辑正文**：工具栏创建的节点正文永远是默认值；详情面板只有改名等属性，没有正文编辑入口；双击打开的也是该面板
- **涉及文件**：`CanvasNode.tsx`（只读渲染 L181-188）、`LayerDetailPanel.tsx`、`project-store.ts`（缺 updateText 动作）
- **落地方案**：已实现（D1 方案 A）：双击文本类节点进入节点内联 textarea 编辑（失焦/Enter 提交、Shift+Enter 换行、Escape 取消）；详情面板新增「正文」textarea 编辑区（失焦提交、key=node.id 防跨节点草稿串位）；正文经 updateNode 写回并持久化
- **STATUS 涉及文件**：CanvasNode / LayerDetailPanel / project-store

#### CV-002 · ask_user_choice 自由输入框 UI 丢失

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：`ask_user_choice` 的 `allowFreeText` UI 丢失：Host 工具支持自由输入（品牌名等开放要素），数据带字段但点选卡片只渲染选项按钮
- **涉及文件**：`question-capture.tsx`（QuestionNodeView L83-98）
- **落地方案**：已实现：`allowFreeText=true` 时渲染自由输入框 + 提交按钮（Enter/点击提交，复用 `.csQuestionFree` 样式），答案走同一条 `onAnswer` 通道；本地 submitted 先行锁定提交态防重复提交（工具结果回流前）
- **STATUS 涉及文件**：question-capture.tsx

#### CV-003 · Minimap 跳转用 window 尺寸算居中，三栏布局偏移

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：Minimap 跳转用 `window.innerWidth/innerHeight` 计算视口居中；画布是三栏布局的中间列，居中会**系统性偏移**（把左右栏宽度算进去）
- **涉及文件**：`Minimap.tsx`（jumpTo L68-79）
- **落地方案**：已实现：Minimap 新增 `viewportWidth/Height` props；CanvasSurface 经 ResizeObserver 实测容器 `clientWidth/Height` 传入；跳转居中与视口框均改用实测值（首帧未就绪回退 window 尺寸）
- **STATUS 涉及文件**：Minimap.tsx

#### CV-004 · 操作/类型标签三处重复定义且漂移 → 抽共享 labels.ts

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：操作/类型标签三处重复定义且已漂移：`storyboard-split` 在 `CanvasEdges.OPERATION_LABELS` 有中文标签，但 `CanvasNode.OPERATION_LABELS` 漏掉 → 详情面板显示原始英文 key；`KIND_LABEL` 也有 3 份
- **涉及文件**：`CanvasNode.tsx`、`CanvasEdges.tsx`、`LayerPanel.tsx`、`LayerDetailPanel.tsx`、`CanvasTimeline.tsx`
- **落地方案**：已实现：抽取共享模块 `client/canvas/labels.ts`（KIND_LABEL + 全量 OPERATION_LABELS，补齐 storyboard-split），五处组件统一引用；新增类型只改 labels.ts
- **STATUS 涉及文件**：CanvasNode / CanvasEdges / LayerPanel 等 5 处

#### CV-030 · 双击开详情后单击其它节点也直开详情 → detailOpen 改 detailNodeId

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：双击图片打开详情面板后，`detailOpen` 置 true 即不再复位；渲染条件只看 `selectedNode && detailOpen` → 之后**单击**任何其它节点，详情面板直接切到该节点（单击即开详情，与双击语义冲突）。同理详情面板的标题编辑草稿（titleInput）跨节点不重置
- **涉及文件**：`StudioFrame.tsx`（detailOpen 状态 + 渲染条件）、`CanvasNode.tsx`（titleInput 初始化）
- **落地方案**：已实现：`detailOpen: boolean` 改为 `detailNodeId: string
- **STATUS 涉及文件**：StudioFrame / CanvasNode

#### CV-033 · 删项目后重建同名报 name-conflict → 摘除 + 清理孤儿 workspace

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：删除项目后重建同名项目报 `workspace rename failed: workspace-name-conflict`：删除项目只删目录，打开项目时注册的 DSH workspace（`workspaces.create` + `rename` 项目名）残留占名（2026-08-28 用户实测复现）
- **涉及文件**：`client/index.ts`（deleteProject / openProject）
- **落地方案**：已实现双修复：① deleteProject 同步摘除绑定 path 的 workspace；② openProject rename 前清理同名孤儿 workspace（同名且 path 不属任何现存项目），历史残留也被救回
- **STATUS 涉及文件**：client/index.ts

#### CV-034 · 启动后对话/画布/列表三不一致 → 映射优先用会话 cwd

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：启动后「对话有内容、画布空、项目列表无选中」三不一致：画布映射只看 `recentWorkspaceId`（按「会话最新的 workspace」推导），孤儿 workspace（删项目残留）的空会话把它带偏，与当前恢复的会话脱节（2026-08-28 用户实测复现）
- **涉及文件**：`client/index.ts`（resolveActiveProjectId / 订阅）
- **落地方案**：已实现：映射优先级改为「手动选中 > 当前会话 cwd（session summary 自带，画布真正跟随对话区）> recentWorkspaceId 兜底」；会话列表变化也接入同步订阅（原只对齐启动会话）
- **STATUS 涉及文件**：client/index.ts

#### CV-037 · 右键菜单点击全部无效 → mousedown 命中内部放行

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P0
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：节点右键菜单所有项点击无效（2026-08-28 用户反馈「目前都是不可用的」）。根因已代码验证：菜单的关闭监听是 window `mousedown`（StudioFrame menu effect），点击菜单项时 mousedown 先冒泡到 window → `setMenu(null)` 菜单卸载 → 按钮的 click 永不触发 → 动作全部丢失
- **涉及文件**：`StudioFrame.tsx`（menu 关闭监听）、`CanvasContextMenu.tsx`、`src/canvas-actions.ts`（新增）、`tests/canvas-actions.test.mjs`（新增）
- **落地方案**：已实现：① `CanvasContextMenu` 改 `forwardRef`，根 div 挂 ref；② StudioFrame 新增 `menuRef`，mousedown 命中菜单内部时放行（判定抽为纯函数 `shouldKeepMenuOpen`，可单测），菜单项 onClick 内自行「先关闭再执行」；③ 补 Escape 关闭。测试 100/100
- **STATUS 涉及文件**：StudioFrame / CanvasContextMenu

### P1（10 条）

#### CV-009 · 图层面板选中不定位 → 复用 focusNodeId

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P1 — 功能缺口（核心工作流）
- **问题**：图层面板选中不定位：时间轴点击会居中跳转（focusNodeId），LayerPanel 点击只改选中——节点在视野外时用户找不到
- **涉及文件**：`LayerPanel.tsx`、`StudioFrame.tsx`
- **落地方案**：已实现：LayerPanel onSelect 复用 focusNodeId 机制，点击行同步居中定位（同 id 重复点击不重复跳转，沿用 surface 的 lastFocused 防抖）
- **STATUS 涉及文件**：LayerPanel / StudioFrame

#### CV-010 · loading 无时间感 → 已耗时 MM:SS + 超 3 分钟打断提示

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P1 — 功能缺口（核心工作流）
- **问题**：loading 节点无时间感：视频生成 5–10 分钟只有不确定进度条，无法区分「正常」与「卡死」
- **涉及文件**：`CanvasNode.tsx`（isLoading overlay）
- **落地方案**：已实现：overlay 追加已耗时 MM:SS（以节点 createdAt 为起点，每秒跳动）；超过 3 分钟追加「可在详情面板或右键菜单打断」提示
- **STATUS 涉及文件**：CanvasNode

#### CV-022 · 血缘依赖 Agent 填 sourceUrls 不可靠 → filename 反查

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：血缘依赖 Agent 自觉填 sourceUrls，不可靠（2026-08-28 需求讨论确定）
- **涉及文件**：`generate.ts`
- **落地方案**：已实现：`resolveSourceIdsByFilename` 按 Drama filename 反查素材节点，与 URL 反查取并集（去重保序）；`generateAsset` 与 `splitStoryboard` 均接入；新增测试「血缘自动反查」
- **STATUS 涉及文件**：generate.ts

#### CV-023 · 创意未落画布 → brief-capture 捕获首条真人消息

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：用户输入的创意未落画布，画布缺少「创意从哪来」的叙事锚点（2026-08-28 需求讨论确定，捕获方案已拍板：方案 A 仅首条用户消息）
- **涉及文件**：`client/`（conversationEvents 新 definition 匹配用户消息事件）+ `project-store.ts`
- **落地方案**：已实现：`brief-capture.ts` 匹配 `user/message` 且 `source.kind==='user'`（排除 skill/文件通知等合成注入）；store 新增 `addBriefNode`（幂等，每项目至多一个 `toolName=user_brief` 节点，落在画布原点）；画布未载入时暂存、重载完成后补落（历史重放竞态）；旧项目打开时经历史重放自动补落
- **STATUS 涉及文件**：client/brief-capture.ts

#### CV-024 · 生成节点全叠原点 → deriveNodePlacement 排来源右侧

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：生成节点落盘坐标硬编码 x:0,y:0，全叠在原点，靠手动「整理布局」，无法形成创意→素材→生成物的流向感（2026-08-28 需求讨论确定纳入）
- **涉及文件**：`generate.ts`（落盘坐标）、`canvas-view.ts`（computeArrangeLayout）
- **落地方案**：已实现：`deriveNodePlacement` —— 新节点排在其血缘来源节点右侧一列（y 对齐来源），重叠时右移避让（有界 50 步）；无来源回退网格空位；`generateAsset` / `splitStoryboard`（子节点行内等距展开）接入。retryOf 原地更新不受影响
- **STATUS 涉及文件**：generate.ts / canvas-view.ts

#### CV-025 · 创意到分镜/文案无连线 → 落盘自动挂 sourceIds

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：创意到分镜/文案没有连线，画布叙事链断在第一环（2026-08-28 用户提出）
- **涉及文件**：`host-tools.ts`（submit_storyboard_for_approval / write_script）、`contracts/canvas.ts`
- **落地方案**：已实现：`BRIEF_NODE_TOOL` 常量上移到共享契约；分镜表与文案节点落盘时自动查找创意节点并挂接 `sourceIds`（血缘边自动出现），同时按 CV-024 排在其右侧
- **STATUS 涉及文件**：host-tools.ts

#### CV-026 · 分镜表挤一个大文本节点 → 逐镜拆卡

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：分镜表整表挤在一个大文本节点里，无法逐镜对照生成（2026-08-28 用户提出）
- **涉及文件**：`host-tools.ts`（submit_storyboard_for_approval）
- **落地方案**：已实现：`parseStoryboardShots` 解析 markdown 逐镜表格（容错：丢弃分隔/表头行、<3 列行），每镜拆为独立「分镜 N · 景别」节点（正文【镜 N】景别 · 运动 · 时长 + 画面/声音），血缘指向创意、每行 3 个横向排列；解析失败回退整表单节点。已知限制：重复提交分镜会追加新节点（与旧行为一致，去重待做）
- **STATUS 涉及文件**：host-tools.ts

#### CV-027 · 关键帧/视频与分镜卡无连边 → shotRefs 参数

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：关键帧/视频与所属分镜卡没有连边，逐镜对照断链（2026-08-28 用户提出）
- **涉及文件**：`host-tools.ts`（image_generate/video_generate/video_composite + submit）、`generate.ts`
- **落地方案**：已实现：三个生成工具新增 `shotRefs` 参数（分镜卡标题 /「分镜 N」镜号 / 节点 id 三种写法，解析失败给可操作报错），Host 解析为节点 id 并入血缘与落位锚点——关键帧连到所属分镜卡并排在其右侧；submit 工具结果列出每张卡标题 + id 供模型引用；放手跑模式同样拆卡落画布；skill 同步教用法
- **STATUS 涉及文件**：host-tools.ts / generate.ts

#### CV-029 · 框比例不符被 object-fit:cover 静默裁切 → 长边固定 480

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P2 — 交互补全
- **问题**：框比例与媒体内容不符时被 `object-fit:cover` 静默裁切：9:16 视频在 16:9 框里只剩中间一条、非标比例上传素材被裁边（2026-08-28 用户提出）
- **涉及文件**：`CanvasNode.tsx`、`CanvasSurface.tsx`、`StudioFrame.tsx`、`project-store.ts`
- **落地方案**：已实现（用户修订规则）：**长边固定 480、短边按真实比例缩放**。两条路径：① 上传图片落卡前用 createImageBitmap 探测真实宽高，直接按长边 480 创建（避免先错后跳）；② 媒体加载后（img onLoad / video loadedMetadata）框比例偏差 >5% 时自动校正（钳制 60–960，锁定节点跳过，修正后不循环），对新旧节点与生成/抽帧路径统一兜底
- **STATUS 涉及文件**：CanvasNode / StudioFrame

#### CV-031 · 视频节点只连关键帧或只连分镜卡 → 继承 + filename 回写双修复

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P1
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：经关键帧生成视频时，视频节点应同时连关键帧与分镜卡，实际只连其一。两种实测断裂模式：① 旧项目（如 8f5e7481）模型漏传 `shotRefs` → 只连关键帧；② VideoOut 项目模型按 skill 第 7 步把关键帧重新 `upload_image` 拿新 filename → filename 反查不中关键帧 → 只连分镜卡
- **涉及文件**：`generate.ts`（血缘组装）、`host-tools.ts`（upload_image）
- **落地方案**：已实现（确定性双修复）：① `inheritShotCardIds`——来源节点挂着分镜卡时自动并入父集合（只上溯一层、只认分镜卡）；② `backfillUploadFilename`——upload_image 上传画布资产时把 Drama 新 filename 回写对应节点，filename 反查不再断链
- **STATUS 涉及文件**：generate.ts / host-tools.ts

### P2（17 条）

#### CV-011 · 看不出是否为参考图 → 参考角标 + 托盘空态引导

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 信息展示优化
- **问题**：画布上看不出节点是否为参考图（要切托盘/详情）；参考托盘空时直接不渲染，新用户不知道该能力存在
- **涉及文件**：`CanvasNode.tsx`、`StudioFrame.tsx`、`labels.ts`、`styles.ts`
- **落地方案**：已实现：① 参考节点左下角加「参考 · 角色」角标，带角色色点（构图=蓝/角色=红/风格=紫/首末帧=青，`data-role` 驱动）；② 参考托盘空态渲染引导卡片（虚线框，说明如何标记参考图及用途）
- **STATUS 涉及文件**：CanvasNode / StudioFrame

#### CV-012 · 生成参数是原始 JSON → 四段结构化展示 + steer 预填

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 信息展示优化
- **问题**：生成参数是原始 JSON：详情面板 `<pre>` 直出，prompt 恰是用户最想看/复制的字段；steer 编辑框预填为空，用户要自己从 JSON 里抠提示词
- **涉及文件**：`LayerDetailPanel.tsx`（L234-239、L264-282）
- **落地方案**：已实现：解析 generationPrompt 为「提示词（可复制）/ 参考图缩略图（filename 反查节点）/ 参数行 / 原始 JSON 折叠」四段；steer 输入框预填当前 prompt
- **STATUS 涉及文件**：LayerDetailPanel

#### CV-013 · 导入节点分辨率永远「未知」 → 落卡前探测 + 加载回填

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 信息展示优化
- **问题**：导入节点分辨率永远「未知」（落盘不探测），详情面板「分辨率」显示错误（2026-08-28 用户截图确认）
- **涉及文件**：`StudioFrame.tsx`、`project-store.ts`（addImportNode）
- **落地方案**：已实现：上传落卡前 createImageBitmap 探测真实宽高，直接写入 mediaWidth/mediaHeight；媒体加载回调（onMediaNatural）对缺失分辨率的存量节点自动回填（生成节点原本就有值不受影响）
- **STATUS 涉及文件**：StudioFrame / project-store

#### CV-014 · 边 chip 无 LOD → 缩放 <0.6 隐藏，选中保留

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 信息展示优化
- **问题**：边 chip 无 LOD：节点一多每条边中点都挂中文 chip，低缩放下噪音大
- **涉及文件**：`CanvasEdges.tsx`
- **落地方案**：已实现：scale < 0.6 时隐藏 chip 只留线；选中节点相关边 chip 始终保留。与 CV-032 一并实施（chip 反向缩放，屏幕尺寸恒定）
- **STATUS 涉及文件**：CanvasEdges

#### CV-015 · window.alert → toast 体系

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 信息展示优化
- **问题**：错误/成功提示用 `window.alert`（阻塞式原生弹窗）：上传失败、成片成功、合成失败全是 alert
- **涉及文件**：`StudioFrame.tsx`（7 处调用点）、`styles.ts`（csToasts/csToast）
- **落地方案**：已实现：轻量 toast 体系（底部居中、普通 3.5s / 错误 6s 自动消失、入场动画、`role=status`）；成片成功 toast 原型里的「定位到节点」动作未做——F1 已让成片自动居中定位，动作冗余
- **STATUS 涉及文件**：StudioFrame / styles

#### CV-016 · 右键空白无菜单 → 新增 CanvasBlankMenu + 光标处落点

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：右键空白处无菜单（不能在光标处新建便签/粘贴）；addNode 固定落点
- **涉及文件**：`CanvasSurface.tsx`、新增 `CanvasBlankMenu.tsx`、`StudioFrame.tsx`、`project-store.ts`（addNode 加可选 `at` 落点）
- **落地方案**：已实现：空白右键菜单（在此新建便签/文本/提示、粘贴、适配视野）；新建节点落在光标处（左上角对齐），工具栏新建仍走网格落点；关闭语义与节点菜单一致（mousedown 命中内部放行 + Escape，互斥打开）
- **STATUS 涉及文件**：CanvasSurface / project-store

#### CV-017 · 方向键微调

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：方向键不能微调选中节点位置（画布类产品标配：1px，Shift+方向 10px）
- **涉及文件**：`CanvasSurface.tsx`（keydown）、`src/canvas-actions.ts`（`computeNudge` 纯函数）、`tests/canvas-actions.test.mjs`
- **落地方案**：已实现：方向键微调选中节点（1px / Shift 10px），锁定节点跳过；800ms 连发算同一次编辑（只入一条 undo 快照，`onBeginEdit` 节流），每次落 `onPersist`
- **STATUS 涉及文件**：CanvasSurface / canvas-actions

#### CV-018 · 失败节点无就地重试 → 徽章兼作按钮（`canRetryNode` 与执行侧一致）

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：失败节点本体没有就地「重试」按钮——错误 badge 不可点，要开右键或详情
- **涉及文件**：`CanvasNode.tsx`、`CanvasSurface.tsx`（透传 `onRetry`）、`StudioFrame.tsx`、`src/canvas-actions.ts`（新增）
- **落地方案**：已实现：失败徽章兼作重试按钮（文案「生成失败 · 点击重试」，直接重放不加确认弹窗）；可见性判定抽为纯函数 `canRetryNode`，与 client 侧 `rerunNode` 的重放前置检查（`toolName` + `generationPrompt` 齐备、非 loading）保持一致 —— 可点的必然真能重放；无重放参数的失败（上传失败等）仍是不可点徽章
- **STATUS 涉及文件**：CanvasNode / canvas-actions

#### CV-019 · 无缩放到选中 / 双击空白 fit

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：无「缩放到选中」（zoom to selection）；双击空白 = fitToContent 的习惯也未支持
- **涉及文件**：`CanvasSurface.tsx`（Handle 加 `zoomToSelection`）
- **落地方案**：已实现：handle 增加 `zoomToSelection`（无选中退化为 fitToContent）；双击空白触发 fitToContent（节点双击已被 stopPropagation 拦下，不冲突）；fit 数学抽为内部 `fitToBounds` 共用
- **STATUS 涉及文件**：CanvasSurface

#### CV-020 · 资产无下载入口 → 右键 + 详情面板（`assetDownloadName` 防穿越）

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：资产无下载/另存入口（单图、成片导出到本地），成片目前只能画布内播放
- **涉及文件**：`CanvasContextMenu.tsx`、`LayerDetailPanel.tsx`、`StudioFrame.tsx`、`src/canvas-actions.ts`（`assetDownloadName` / `canDownloadNode` / `triggerDownload`）
- **落地方案**：已实现：① 右键菜单加「下载资产」（仅可下载节点可用，其余置灰）+ 详情面板底部加「下载资产」按钮；② 下载名 `{清洗后标题}.{ext}`（纯函数 `assetDownloadName`，清洗路径分隔符防目录穿越），URL 为 http(s)/blob(data:) 判定 `canDownloadNode`；③ DOM 操作 `triggerDownload` 留在 client（`StudioFrame.handleDownload`），浏览器直接触发，桌面端走默认下载行为。测试 113/113
- **STATUS 涉及文件**：CanvasContextMenu / LayerDetailPanel

#### CV-028 · 生成节点框用媒体分辨率，与分镜卡比例失衡 → previewSizeOf

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：生成图片/视频节点直接拿媒体分辨率当画布显示框（16:9→1280×720），与 360 宽分镜卡比例失衡（2026-08-28 尺寸盘点时发现）
- **涉及文件**：`generate.ts`
- **落地方案**：已实现：`previewSizeOf` 派生画布预览尺寸（16:9→480×270、9:16→270×480、1:1→420×420），节点框与落位用显示尺寸；媒体分辨率只进 Drama 请求体、`mediaWidth/mediaHeight` 与工具返回值；retry 重试同步用显示尺寸
- **STATUS 涉及文件**：generate.ts

#### CV-032 · 连线宽度随缩放消失 → 1/scale 反向补偿

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 信息展示优化
- **问题**：血缘连线宽度是画布空间固定值（3.5 用户单位），缩放后是 SVG transform 的一部分——小缩放（如 0.3x）下线宽不足 1px 几乎不可见（2026-08-28 用户截图反馈）
- **涉及文件**：`CanvasEdges.tsx`、`CanvasSurface.tsx`
- **落地方案**：已实现：线宽/箭头/chip 按 1/scale 反向补偿，屏幕尺寸恒定（线宽恒 3.5px、高亮 5px）；箭头 marker 默认随 strokeWidth 缩放自动跟随；普通边透明度 0.5→0.6
- **STATUS 涉及文件**：CanvasEdges / CanvasSurface

#### CV-035 · 网格颜色偏深 → 降到 45% 不透明度

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：画布背景网格颜色偏深，视觉噪音大（2026-08-28 用户反馈）
- **涉及文件**：`styles.ts`（csCanvasSurface 网格背景）
- **落地方案**：已实现：网格线改 `color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent)`，保持跟随明暗主题；格子尺寸 40px 不变（`CanvasSurface.tsx` 的 `backgroundSize`）
- **STATUS 涉及文件**：styles.ts

#### CV-038 · 起草线起点偏移 + 直线/贝塞尔不一致 → 共享几何模块

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：手动拖拽连线（节点右缘 link handle）起草线有两个问题：① 起始位置不对——起点用的是指针按下位置而非来源节点右缘中点，视觉上与正式边的锚点不一致；② 起草线是直线（`M ... L ...`），落定后却是贝塞尔曲线，前后不一致（2026-08-28 用户反馈）
- **涉及文件**：`CanvasSurface.tsx`、`src/canvas-geometry.ts`（新增，Host/Client 共享几何模块）、`CanvasEdges.tsx`、`tests/canvas-geometry.test.mjs`（新增）
- **落地方案**：已实现：① 抽出共享几何模块（`edgeAnchor` / `edgePath`），起草线起点锚定来源节点右缘中点，draft path 用与正式边相同的 C 贝塞尔（指针在来源左侧时镜像控制点，避免曲线打结）；② 正式边同步改用同一模块渲染，两边不可能再漂移；tsconfig.client.json include 补 `src/canvas-geometry.ts`。测试 113/113
- **STATUS 涉及文件**：CanvasSurface / canvas-geometry.ts

#### CV-041 · 官方 h3-prompt-writing skill 接入 —— 随 9 skill 全量注册落地；2026-09-01 起 references/ 改为目录同步 + resourceBase 按需读取（不再内联）

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P0 — 真 bug / 功能断裂
- **问题**：官方 H3 提示词技能未接入：`h3-prompt-writing` 是纯 Markdown + 本地参考文件技能，官方明示 agent-portable（Claude Code/任意 harness 可用，无外部 API 调用），`npx skills add https://github.com/MiniMax-AI/MiniMax-H3 --skill h3-prompt-writing` 即装
- **涉及文件**：DSH skill 注册链路、`skills/`
- **落地方案**：安装为画布创作的辅助 skill（与 creation-spec 并存：creation-spec 管流程编排，h3-prompt-writing 管提示词细节），Agent 生成提示词时可引用其 references/ 下两份指南原文。与 CV-039 互补：039 是内化进流程规范，041 是保留官方全文供深查
- **STATUS 涉及文件**：scripts/sync-minimax-skills.mjs / src/skills/minimax-skills.ts / skills/

#### CV-044 · 双击视频进原生全屏 → 播放浮层 + 移除 controls

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **原 backlog 分区**：P2 — 交互补全
- **问题**：双击播放视频时进入 Chromium 原生「双击=元素全屏」（铺满整个桌面，监听在 video shadow DOM，React 拦不住），观感过大（2026-08-31 用户提出）
- **涉及文件**：`CanvasNode.tsx`、`CanvasSurface.tsx`、`StudioFrame.tsx`、新增 `client/canvas/VideoPlayerModal.tsx`、`styles.ts`
- **落地方案**：已实现：① 双击视频节点改为打开**固定尺寸播放浮层**（视频真实分辨率渲染，上限 960px 宽 / 80vh 高，CSS 钳制保持宽高比，标题栏 + 原生控制条；backdrop 点击 / × / Escape 关闭，关闭即卸载自动停止播放）；② 视频元素挂原生 capture dblclick 监听拦截 shadow DOM 全屏触发，并隐藏原生全屏按钮（大屏播放统一走浮层）；图片节点双击仍为详情面板（D1 语义不变）
- **STATUS 涉及文件**：CanvasNode / VideoPlayerModal

#### CV-045 · 图片大图预览浮层 + 详情入口移入右键菜单

- **状态**：已完成（代码落地 + 用户桌面验收通过）
- **优先级**：P2
- **说明**：该条目在 `canvas-ux-backlog.md` 中无独立技术细节行（仅存在于变更记录），仅有 STATUS 摘要。
- **STATUS 涉及文件**：ImagePreviewModal / CanvasContextMenu

---

## 2026-10-13 追加批次（101 条）

> 本次由 STATUS.md §4 沉降：状态均为「已完成·桌面验收通过」，不再有后续动作。
> 字段来自 §4 表格行（问题段落 = 原「一句话」列全文，未删改）。

#### CV-281 · REQ-029 画布 image 节点交互实施（别名 R-P0-14，方案 plans/REQ-029-画布imag…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-029 画布 image 节点交互实施（别名 R-P0-14，方案 [plans/REQ-029-画布image节点交互方案.md](./plans/REQ-029-画布image节点交互方案.md)，五步全部落地）**。**Step 1 手势层**：① 双击空白 = 视图复位 100%（拍板①，替代 CV-019 双击空白适配视野；适配仍走 handle.fitToContent；CV-044 节点双击播放不受影响）；② 单击空白「清选 → 选中绑定的 UI 收起」叠加语义成文（拍板②）；③ 缩放 10%~500% 维持（拍板③）。守卫 `tests/canvas-gesture-req029.test.mjs` 4 条。**Step 2 输入框卡骨架**：新 `NodeInputCard.tsx`（演示 `canvas-imagenode-inputbox.html` 1:1——卡壳 20px 圆角/演示渐变/accent 固定 #ffb066、提示词区复用 PromptEditor + 同一份 editor-drafts 草稿表、写回同一条 withPromptField 通路〔编辑不触发红线继承〕、展开=屏幕居中、入场 16px+渐隐；inset 高光按白色字面量守卫改 `--cs-line-hi` color-mix〔偏差 §九〕）。**Step 3 参考托盘转真**：52px 缩略图（位次角标 / 悬停放大镜 → CV-044 大图预览 / × 移除）+「+ N/上限」瓦片 + 三来源菜单（画布导入 / 选择资产转真；**本地上传置灰**——解析链路只收 lib:/节点句柄〔偏差 §九〕）；数据契约与 ReferenceSlotEditor 同源（换句柄红线② / 断链不静默红线③ / 必填单槽只换不空 / 超限拦截）；候选池只收图片。**Step 4 底栏 chips 转真**：① host——`GenerateParams` +`modelOverride`/`stylePrefix`/`cameraPrefix`；`routeImageModel` 节点级覆盖（仅纯文生车道，优先级：带参考 > 节点覆盖 > 设置页 > 文字判据；`normalizeImageModelOverride` 兜底）；`composeImagePrompt` 前缀注入（image_generate/withtxt 车道；image_fix 不注入）；② client——模型高级三选（拍板④）、比例 3 种 + 档位产品化（拍板⑤⑥）、风格前缀注入（通用 4 预设〔偏差 §九〕）、摄像机面板（四列步进〔值取演示〕+ 当前配置 + 重置 + 总开关）、积分按档位估算标「预估」（拍板⑦）、发送 = 先落字段再走既有重试链路（判据唯一 `isReplayable`）；③ `RESOLUTION_DISPLAY` 上提 `src/resolution-display.ts`（lobby-spec 再导出兼容）。**Step 5 替换收口**：输入框卡 = **唯一编辑面**——单击节点 + CV-272 两入口（宿主受控 `promptEditNodeId` 并入同一打开口径）都打开本卡；退役删除 `NodePromptEditor.tsx` / `.csNodePrompt*` 样式 / `editorPlacement` 求解器 + `editor-placement.test.mjs`；随浮层退役的能力（偏差登记 §九）：E1~E5 放置/恢复视野、F2/F3/F8 Picture 一致性条、显式「仅保存」、F6 Cmd+Enter=保存并重试。守卫：`canvas-gesture-req029` 4 条 / `canvas-input-card-req029` 7 条 / `canvas-prompt-edit` 重写 8 条（改钉卡片）/ `model-route` +2 单测。**验收出口 = 方案 §十**（逐组件截图对照演示 + 一次生成成功 + 手势全项 + `yarn check` 全绿〔1332 条 0 失败〕）
- **涉及文件**：`src/client/canvas/{CanvasSurface,NodeInputCard}.tsx`(新) / `src/client/styles.ts` / `src/{model-route,generate,resolution-display,lobby-spec,canvas-view}.ts` / `tests/{canvas-gesture-req029,canvas-input-card-req029,canvas-prompt-edit,model-route}.test.mjs`
- **落地/验收**：2026-10-07 落地 Step 1~5


#### CV-282 · REQ-031 画布 video 节点交互实施（方案 plans/REQ-031-画布video节点交互方案.md…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-031 画布 video 节点交互实施（方案 [plans/REQ-031-画布video节点交互方案.md](./plans/REQ-031-画布video节点交互方案.md)，五步实施全落；功能点对照总表 F1~F30+H1~H7）**。**Step 1 托盘形态化 + 模式 Tab 已落码（2026-10-07）**：① `NodeInputCard` 增 `form: 'image'
- **涉及文件**：'video'`（CanvasSurface 按 `kind === 'video'` 判定；**image 路径零改动**——withReferenceNames/slot.max 通路原样）；② 模式 Tab「首尾帧/全能参考」→ 写 `channel`（fl2va/ref2va），两模式参数键不互删；fl = `filename`(首帧)/`filenameTail`(尾帧) 双单值槽，omni = `filenames`(9)/`videoRefs`(3)/`audioRefs`(3) 三分类（分类标签+计数+添加瓦片，演示主态布局）；③ 头部「音频」chip = **原生音频开关**（`generateAudio` 布尔，开写 true/关删键——与音频参考槽两回事，机制项注记已修正）；④ 托盘上沿**紧贴节点下沿**（用户验收前修正要求，演示注释原文；image/video 两形态同效）；⑤ 发送前校验：音频不能唯一（官方硬规则同文案）+ 合计 12（`VIDEO_CAPS` 与 `video-reference.ts` 同源）；分类超限/合计超限在添加时即拦截；⑥ host 助手 `withGenerationParam`（原始参数写回，undefined=删键）/`generationParamOf`（node-params.ts）；⑦ 候选池按模态过滤（画布 kind/资产库 media.kind）。守卫 `tests/canvas-video-tray-req031.test.mjs` 7 条。**Step 2 底栏 chips video 化（同日）**：① 模型弹层（312px）三行逐字取演示——H3 可选（**不写 model 路由参数**：H3 唯一真模型，model 为 Host 占坑参数；id 沿用 CV-280 先例 `h3`，`minimax-h3` 小写连字符形撞「上游 submodule 名禁用」守卫已修正），SeedDance 2.0/2.5 置灰标「即将上线」（cap 行逐字）；② spec chip = 「画幅 · 时长 · 清晰度」三段——画幅 2 选（演示 ARS 逐字：16:9 横屏/9:16 竖屏，与 Host CV-136 枚举一致，无 1:1）/ **时长六档 4/6/8/10/12/15s 写 `duration` 数字参数**（拍板④，clampDuration 消费，缺省读数 5s）/ 清晰度 3 档内部键；③ 积分明细弹层（290px）= 演示 costRows 公式逐行（模型基准 20 / 时长加长 (dur−5)×2 / 清晰度 RES_COST 0/6/14 / 图×2 视频×6 音频×3 首帧2 尾帧3 / 原生音频 8）+「本次消耗」合计 + 脚注逐字 + 标「预估」（拍板⑦）；④ 摄像机标记 chip（cam-chip）：开启后挂输入框上方、悬停出 × 移除（清 cameraPrefix）；面板抽取 `cameraPopNode` 两形态共用（video 副文案逐字「为整条视频设置机型、镜头、焦段与光圈」）；⑤ 运镜 chip 占位禁用（Step 3 影片设置面板接入）；底栏按形态双分支（image 分支零改动，摄像机面板抽取为纯 JSX 等价重构）。守卫 `tests/canvas-video-chips-req031.test.mjs` 6 条。**Step 3 影片设置面板（同日，`75e17ff576`）**：新 `src/camera-moves.ts` = 一比一转录演示 Higgsfield 官方 33 条运镜（id/中文名/官方英文名逐字）+ 节奏 5 档（name/en/segs/tip 逐字）+ `pacingPrefixOf`（拍板①前缀注入，自动档=undefined 删键）+ `parseCameraMoves`（按文本出现序去重保序）；新 `FilmSetupPanel.tsx` 双 Tab 固定高度（演示 pop-film 688px 居中）——运镜网格 4 列 + 荧光绿浮标「添加到提示词」+ 已选 accent 边与序号角标，节奏轮播（‹› 环切 + 中央大卡 + 相邻暗卡 + segs 指示条 + 档名 pill + tip）；运镜 chip 转真 = 点卡把**官方英文名追加进提示词草稿**（PromptEditor 句柄扩 `appendText`，只动草稿不写回、B4 守卫同步扩展；可重复退格可删），已选回显从提示词反向解析（F26）；选节奏 = `commitRaw('pacingPrefix')` 即时生效无确定钮。偏差登记：演示 CSS 示意动画不迁移（DD-03 动效三语义白名单）、官方演示视频置灰（拍板②）、`.csPcCard.on` 边线走 `--cs-line-hi` color-mix（禁白色字面量守卫）。守卫 `tests/canvas-video-filmsetup-req031.test.mjs` 6 条。**Step 4 host 注入泛化（同日，`1fed17b386`）**：`GenerateParams` +`pacingPrefix`；`composeImagePrompt` 泛化图像/视频通用——前缀顺序 = **节奏→摄像机→风格**（导演层→摄影层→美术层，「，」连接；图像节点不写 pacing 逐字节零影响，守卫单测钉住旧序）；video 车道 `videoRequestOf` 收注入后 prompt（错误路径/台账保持原 params）；`model-route.ts` H5 注记 video 车道不消费 modelOverride；三校验调用点（音频同行/视频时长/合计 12）守卫钉住。守卫 `tests/video-prompt-injection-req031.test.mjs` 4 条。**Step 5 节点卡 video 态+收口（同日，`25632d8322`）**：F1 空态 = 橙色摄像机图标（#ffb066 偏差登记）+「点击节点选中，输入你的创作需求」逐字；F2 参数角标 `csNodeVideoBadge`「{画幅} · {时长}s · {清晰度}」读生成参数（缺省 16:9/5s/480p、清晰度走 resolutionDisplay 产品化名；无参数不显示、生成中让位）；F3 进度环 = `csAdvanceSpin` 旋转（DD-03 行进语义）+「生成中…」+ 副文案「MiniMax H3 · {模式} · {时长}s」（channel 反解，**拍板③无假百分比**），非 video 保持显影光带零改动、reduced-motion 降级成对；F4 工具栏 = video 三项「引用到对话/预览/下载」（重试/改提示词退出 video 工具栏——单击节点开输入框卡为唯一编辑面；`NodeActionBar` 新 onOpenPlayback/onDownload、`CanvasSurface` 新 `onNodeDownload` 出口、StudioFrame 复用 handleDownload）；H7 实测时长读数走既有 video metadata 通路零改动。守卫 `tests/canvas-video-node-req031.test.mjs` 5 条。**验收出口 = 方案 §九**（§四总表 F1~F30+H1~H7 逐项对照演示 + 全能参考/首尾帧各一次生成成功 + 运镜注入链路 + 三校验拦截 + 手势零回归）；`yarn check` 全绿（1360 条 0 失败）
- **落地/验收**：`src/camera-moves.ts`(新) / `src/client/canvas/{CanvasSurface,NodeInputCard,FilmSetupPanel(新),PromptEditor,CanvasNode,NodeActionBar}.tsx` / `src/{node-params,generate,model-route}.ts` / `src/client/{styles,StudioFrame}.ts` / `tests/{canvas-video-tray-req031,canvas-video-chips-req031,canvas-video-filmsetup-req031,video-prompt-injection-req031,canvas-video-node-req031,canvas-prompt-edit}.test.mjs` | 2026-10-07 落地 Step 1~5（五步全落）


#### CV-283 · REQ-029/031 验收前交互修正批（对照演示 `canvas-imagenode-inputbox.html`…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-029/031 验收前交互修正批（对照演示 `canvas-imagenode-inputbox.html` / `canvas-videonode-inputbox.html` 六项）**：① **砍放大态** —— `NodeInputCard` 删 expanded/Zoomed/展开钮/脏角标（draft 机制与 reportField 保留，styles 删 `.csNodeInputCardZoomed` 一族，入场动画改独立 `scale`/`translate` 属性不再占 transform 槽位）；② **提示词直编** —— `PromptEditor` 新 `bare` 模式（初值 inline、外部值 `bare && !nodeSwitched` 合并同步、**裸 Enter = 发送**〔按 image 演示 L2603 口径，video 演示的 Cmd+Enter 不采纳〕、Esc 冒泡收卡、header/读数让位、卡内 5 行封顶 `calc(1.68em*5+12px)`）；③ **工具条同框共存** —— `CanvasSurface` 同框条件放开（删 `cardNodeId === null` 与 bottomInset）、按钮 = 引用到对话 / 添加到资产库〔**仅 image**，接 `onNodeAddToLibrary`→`setLibImportNodeId`〕/ 预览 / 下载（`isMedia` 判据，video 三项；重试/改提示词对媒体退场），开卡时工具条不再退场；④ **卡与工具条随画布缩放** —— root `scale: ${view.scale}`（独立属性，与 `csYieldPop` 的 transform 槽位乘性共存）+ `translate` 锚定（卡 `-50% 0` 顶锚、条 `-50% 0` 底锚）；锚定块重写：`top = nodeBottom + CHROME_GAP×z`、横向按**视觉**半宽夹取、纵向只留详情抽屉顶夹；**`CHROME_GAP = 12`（canvas-view.ts 唯一源，推翻两演示「紧贴」loose 文案与 CV-282 Step1 ⑤ 无间隙口径，image/video 同效）**；⑤ **双击语义收敛** —— `CanvasNode.handleDoubleClick` 对 image/video **放行冒泡**到画布根 = `resetZoom()` 视图复位（**推翻拍板「双击节点=播放/详情」**；audio 保留播放、预览/详情走工具条；`onOpenPreview` prop 退役）；⑥ **守卫** —— 新 `tests/canvas-chrome-align-req029.test.mjs` 4 条（CHROME_GAP 唯一源 / 独立 scale+translate / 纵向不夹取 / 同框共存）+ 改写 5 条（input-card 反转回潮断言 / prompt-edit 同框+bare 3 条 / video-node F4 重写 / video-tray 间隙同源 / gesture ① 重写）。**门禁全绿**（typecheck/build/verify:loader/test:smoke 基线 0 / 新增 0）
- **涉及文件**：`src/client/canvas/{NodeInputCard,PromptEditor,NodeActionBar,CanvasSurface,CanvasNode}.tsx` / `src/client/{styles,StudioFrame}.ts` / `src/canvas-view.ts` / `tests/{canvas-chrome-align-req029,canvas-input-card-req029,canvas-prompt-edit,canvas-video-node-req031,canvas-video-tray-req031,canvas-gesture-req029}.test.mjs`
- **落地/验收**：2026-10-08 落地六项


#### CV-284 · 画布媒体节点自然像素尺寸（100% 视图 1 CSS px = 1 像素，替代「长边 480」压图规则）：① `ca…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**画布媒体节点自然像素尺寸（100% 视图 1 CSS px = 1 像素，替代「长边 480」压图规则）**：① **`canvas-aspect.ts`** —— `previewSizeOf` 改自然像素（保 `MIN_SHORT_SIDE=60` **等比**地板、删 `MEDIA_LONG_SIDE`/`SQUARE_SIDE`、非法回退 `DEFAULT_MEDIA_BOX`）；`DEFAULT_NODE_SIZE = frameSizeOf(DEFAULT_MEDIA_BOX)` 恒等式；`client/index.ts` 上传落卡误用 previewSizeOf 顺手改 `frameSizeOf`（少算 48px chrome 的既有 bug）；`frameSizeOf`/`mediaBoxOf`/调用点（generate/compose/video-frames/StudioFrame/project-store）零代码改动换规则；② **自愈 + 懒迁移** —— `StudioFrame handleMediaNatural`：回填判据不变（不一致就纠正），重设分支改 `neverMeasured
- **落地/验收**：ratioOff`（缺 `mediaWidth/Height` 的老节点**首次加载即按自然像素重设**；用户手调过的比例对不触发 ⇒ 不踩用户尺寸；目标值相等不写盘）；③ **resize 锁比** —— `CanvasSurface` 媒体节点 resize 锁**画面**比例（真实像素优先、缺省回退 gesture origin 画面区；一个轴驱动另一轴派生、锚对侧、`minWidth = max(MIN, (MIN−chrome)×比例)` 双约束），非媒体节点保持自由（自由拖会与比例自愈打架）；④ **`FIT_MIN_SCALE` 0.3 → 0.1**（1080p 卡 1968×1128 比视口大，fit 要能收到全貌；`MIN_VIEW_SCALE` 同值 0.1）；⑤ **文档 v5 迁移** —— `CANVAS_DOCUMENT_VERSION` 4→5 + `projects.ts migrateNaturalMediaSize`（挂 `normalizeCanvasDocument`、音频归位之后）：判据 = 旧规则指纹「媒体区长边恰 480」，命中且未锁定、有分辨率 ⇒ 重设为 `frameSizeOf(自然)`；用户手调框（长边≠480）/ 锁定 / 缺分辨率一律不碰（后者留给②）；⑥ **arrived 装不下走适配** —— 新纯函数 `fitsViewport`（reveal 同款 padding 48）+ `CanvasSurface revealNodesOrFit`（装得下 = 旧 reveal 平移，装不下 = `fitToBounds`→computeFitView）+ StudioFrame arrived 分支接线；⑦ **守卫** —— 新 `tests/canvas-natural-size-cv284.test.mjs` 12 条（迁移六态 + 源码闸 + FIT 0.1 + OrFit 接线 + 落点/整理尺寸感知行为断言）+ 改写 8 文件（canvas-aspect 全量 / node-presentation / canvas-arrange fit 用例 / resolution-tier K 组懒迁移 2 断言 / generate 落点 / video-frames 抽帧 / character-sheet 拼图 / asset v5 文案）。**门禁全绿：test:smoke 1377/1377、失败 0、基线 0** | `src/canvas-aspect.ts` / `src/contracts/canvas.ts` / `src/projects.ts` / `src/canvas-view.ts` / `src/client/{StudioFrame.tsx,project-store.ts,index.ts}` / `src/client/canvas/{CanvasSurface,NodeActionBar}.tsx` / `tests/canvas-natural-size-cv284.test.mjs`(新) + 8 个改写 | 2026-10-08 落地七项


#### CV-286 · 画布交互验收反馈三项修正（单击才清选 / 双击口径重定 / 滚轮灵敏度）

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**画布交互验收反馈三项修正（单击才清选 / 双击口径重定 / 滚轮灵敏度）**。用户桌面验收 CV-283~285 批后反馈两问题 + 一项调优，根因与修法：① **拖画布时节点菜单/输入框卡按下即消失** —— `onSurfacePointerDown` 原「按下即清选」在拖拽第一帧就触发清选联动轴（工具条 `actionBarNode` 单选才在、输入卡绑 `selectedNodeId`）；改为**单击才清**：pointerdown 只起手 pan 并逐帧累计 `movedDist`，pointerup 时 `≤ CLICK_CLEAR_SLOP(5px)` 且左键无修饰键才 `onSelectNode(null) + setSelectedEdge(null)`（拍板②「单击」字面兑现；2026-09-13「阈值太紧清不掉」教训由 5px 宽容档兜住），**拖拽全程保留选区** ⇒ 工具条/卡跟节点走，移出视野由既有 visible/E7 判据退场；minimap 同款（prop 改名 `onSurfaceClick`：按下记位、mouseup 未拖过阈值才代清选）。② **双击复位 100% 后画布总跳同一处** —— 旧 `resetZoom = {x:0,y:0,scale:1}` 把世界原点钉到视口左上角、与点击位置完全无关；**双击空白改无操作**（推翻 REQ-029 拍板①，容器 `onDoubleClick` 移除）、**image/video 双击 = 该节点移到视口正中 + 100%**（推翻 CV-283 修订二：不再放行冒泡，`stopPropagation + onCenterNode` → 新纯函数 `canvas-view.centerViewOf`）、**工具栏「1:1」改保持视口中心世界点回 100%**（`cx − world.x`，同根因顺手修）；audio 播放 / 文本编辑 / 详情语义不动。③ **滚轮太灵敏** —— 原每事件固定 `×1.2`（触控板高频小增量连乘，20 事件 ≈ ×38）；改**按滚动量指数化** `exp(−deltaPixels/800)`（`WHEEL_ZOOM_DIVISOR`，含 deltaMode 行/页换算），鼠标每格 ≈×1.13 略降、触控板随滚动量线性。**守卫**：`canvas-gesture-req029` 重写 6 用例（双击空白无操作 + 1:1 中心保持 / image/video 居中接线 + `centerViewOf` lib 实测 / pointerup 单击清选 + pointerdown 不清负断言 + minimap 同款 / 缩放范围 / 滚轮指数化）+ `manual-wiring`「拖画布起手清边选」断言随语义改。**门禁 typecheck/build/verify:loader/test:smoke 1381·1381 全绿、基线 0**
- **涉及文件**：`src/canvas-view.ts` / `src/client/canvas/{CanvasSurface,CanvasNode,Minimap,NodeActionBar,NodeInputCard}.tsx` / `tests/{canvas-gesture-req029,manual-wiring}.test.mjs`
- **落地/验收**：2026-10-08


#### CV-287 · REQ-032 画布 audio 节点交互实施（方案 plans/REQ-032-画布audio节点交互方案.md…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-032 画布 audio 节点交互实施（方案 [plans/REQ-032-画布audio节点交互方案.md](./plans/REQ-032-画布audio节点交互方案.md)，五步全落；功能点 F1~F6 + C1~C3 + H1~H4；与 REQ-029 image / REQ-031 video 同构）**。audio 三类：**音色设计（design）/ 语音生成（voice）/ 音乐生成（music）**，词库 18 维逐字转录自演示存档 `canvas-audionode-inputbox.html`（不许改）。**Step 1**：新 `src/voice-dims.ts`（`DIMS/FNS/LAYERS/LAYER_ORDER` 纯函数 + `estSeconds/creditCost/composeSpeechInstruct/composeItems`，探针 139 净字 → 27.55s 真值对拍 <1%）；`CHROME_CARD_WIDTH_AUDIO=792`；`NodeInputCard` 三形态（design/voice/music 参数差异）+ audio 状态块；`onToast` 链路；`csAudio` 样式块；测试 `voice-dims-req032` 7 项 + `canvas-input-card-req029` 扩 4 项。**Step 2**：新 `src/client/canvas/VoiceLayerPop.tsx`（173 行，四层共用组件按 brand 分派 seg/grid/slide；`LAYER_DOT` 四色 + `STAR_ICON` 最常漏写维度；slide 默认中档「未设定」、满额禁用 + title；many 计数）；`NodeInputCard` 扩 `ChipPop
- **涉及文件**：layer:AudioLayer`、`chooseAudioWord`（再点取消/many 满额 toast/one 替换/`excl:'tongue'` 互斥清同组）、`setAudioSlide`、`clearAudioLayer`；`.csAudioLayerPop` + `.csAudioPanel*` 样式；req029 +4 项。**Step 3**：`voice-dims.ts` 新 `LOCAL_REF_PREFIX/toLocalRef/isLocalRef/stripLocalRef/assetFileFromUrl`（`local:` 约定，客户端 ↔ host 剥前缀换句柄）；`NodeInputCard` 新 prop `onUploadMedia`、`refSlotVisible = isAudio && fn==='voice'`、`audioRefCandidates`（画布 kind==='audio' + 资产库音频媒体）、`pickAudioRef`（单选 0/1）/`clearAudioRef`/`uploadAudioRef`、`audioRefMenu` 三来源内联菜单、发送 fn 三路重写（voice 带 `refaudio=local:…` / music 带 `duration=audioEst` 且 `ref:null` / design `ref:null`）；`StudioFrame` 新 `handleUploadMediaForRef`（落盘秒回**不建节点**）→ `onUploadMedia`；`CanvasSurface` 透传；`.csAudioRefSlot*/.csAudioRefPop*` 样式；voice-dims +3 项、req029 修 2 处。**Step 4**：`src/generate.ts` 新 `isLocalRefaudio`（白名单字符集防路径穿越）/`stripLocalRefaudio`/`normalizeRefaudioError`（陈旧句柄 500 归一「参考音色失效，请重新选择」）；`generateSpeech` 遇 `local:` 前缀 → `promoteAssetFile` 现换句柄；`CanvasNode.tsx` `TOOL_TITLES` 补 `music_generation`、新 `audioProgSub` 三格式副文案（music=`{描述}·{纯音乐
- **落地/验收**：含人声歌词}·{est}s` / voice/design=`{功能}·{参考音色|无参考音色}·{词条}·{est}s`，读 `generationParamsOf`）；`voice-dims` +2 项。**Step 5**：F1 空态（麦克风 SVG +「设计音色，语音生成，音乐生成」，演示 1:1，无产物未生成时渲染）；F3 字幕条（描述+正文合成一行，voice/design=`(描述)+正文` / music=`(描述)+♪ 含人声歌词`，仅产物后显示，两行 clamp）；F5 工具栏四项（引用/入库/预览/下载，audio 进媒体组退出重试/改提示词，预览走 `onOpenPlayback`→AudioPlayerModal）；C1 资产库第五分类「音色」（`contracts/asset-library.ts` `LibCategory`+`'voice'`、`LIB_CATEGORIES`、`LIB_CATEGORY_LABELS`；`AssetLibrary.tsx` `CATEGORY_COLORS.voice='#7DD3FC'`；`collectNodeMediaSources` 本就放行 audio 仅拒 video）。**回归修正**（全量门禁抓出 2 红，已修并 amend 进 Step 5）：`handleUploadMediaForRef` 无项目改返 `null` 不再裸抛（改 `Promise<…|null>` 签名，`uploadAudioRef` 判 null）；REQ-031 工具栏测试断言随 audio 扩媒体组更新（预览三路分流 + 入库 image/audio）。**守卫**：`voice-dims-req032` 12 项 + Step 5 四项（空态/字幕条/工具栏/第五分类）。**门禁 typecheck/build/verify:loader/test:smoke 1394·1394 全绿、基线 0** | `src/voice-dims.ts`(新) / `src/client/canvas/{CanvasNode,NodeInputCard,VoiceLayerPop(新),NodeActionBar,CanvasSurface}.tsx` / `src/client/{StudioFrame,AssetLibrary}.tsx` / `src/contracts/asset-library.ts` / `src/generate.ts` / `src/client/styles.ts` / `tests/{voice-dims-req032,canvas-input-card-req029,canvas-video-node-req031}.test.mjs` | 2026-10-09 落地 Step 1~5（五步全落）


#### CV-288 · REQ-029 §九 偏差项「通用 4 预设」回填 = 画布视觉风格库（方案 REQ-029 §十一）

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-029 §九 偏差项「通用 4 预设」回填 = 画布视觉风格库**（方案 [REQ-029 §十一](./plans/REQ-029-画布image节点交互方案.md)）。**非新需求** —— CV-281 实施时按演示落了 4 条通用前缀并登记为已知偏差，本条回填；交互位置不动（`NodeInputCard.tsx` 底栏「风格」pill）。**落地五件**：**① 数据层** 新 `src/visual-styles.ts`（12 条，唯一事实源：`VISUAL_STYLES`/`STYLE_CATEGORIES`/`visualStyleOf`/`stylePrefixOf`/`styleIdOfPrefix`/`stylesInCategory`；组件私有 `STYLE_OPTIONS` 退役）。**② 存储 D2 双写** `styleId`（身份·显示·高亮）+ `stylePrefix`（文本快照·注入），**`generate.ts` 一字未改**；选「无风格」走 `commitRaw` **删两键**（`withPromptField` 只能写串、删不掉，空串会被「已定义」判据当真值透传）。**③ N1 兼容** `styleIdOfPrefix(stylePrefix)` 反查兜底：老节点无 `styleId` 时认得出就标出来、认不出回落「风格」，**注入照旧不清理**。**④ UI D10+D3+D4** 新 `src/client/canvas/StylePicker.tsx` 消掉 image(`:1081`)/video(`:1226`) 两处重复 JSX；分类 tab（真溢出才加 `.csStyleTabsMask` 渐隐，ResizeObserver 同步）+ 色板卡片网格（`csStyleSwatch`+`csStyleCheck` 勾选角标）+「无风格」卡常驻首位 + 底部脚注（含**构图提示**与 **Look 分工**两条边界文案）；520px 宽 / 4 列 / `csStyle*` 样式块入 `styles.ts`。**⑤ 守卫** 新 `tests/visual-styles.test.mjs` **9 条**（D8 长度 50–70 / 禁负向词 / 不碰摄像机词 / 不暗示画幅 / **必含具体媒介技术名词** / id 唯一 + 分类枚举 / 与成片预设零重名 / 取用函数 / N1 反查）；`canvas-input-card-req029` 风格断言重写为双写契约。**测试抓出两处内容缺陷并当场修**（写实摄影、都市日常只有通用形容词无技术名词 → 补「织物纤维与皮肤毛孔的微对比」「木纹与棉麻织物纹理 / 玻璃反光与陶瓷釉面」）。**门禁 typecheck/build/verify:loader/test:smoke 1415·1415 全绿、基线 0**（此前 1394，新增 21）**N2/N3 已补验**（Qwen 文字渲染 3/3：文字「长安月明」三组**逐字正确**且风格生效，否定「风格挤占文字渲染」假设；图生图 Krea2 Edit 2/2：发型/发髻/刺绣披肩纹样**完全保留**，否定「长前缀干扰参考图」假设；N3 首轮全 500 的根因是 bootstrap 拿**产物名**当 image1，违反 CV-155「只收上传句柄」，补 `POST /generate/upload` 换句柄后通）。**验收出口 = 方案 §11.5**（风格弹层分类 tab / 色板卡片 / 勾选高亮 / 无风格卡 / 边界文案，逐项对照；生成一次验证 12 条前缀生效；老节点回落显示；`yarn check` 全绿）
- **涉及文件**：`src/visual-styles.ts`(新) / `src/client/canvas/StylePicker.tsx`(新) / `src/client/canvas/NodeInputCard.tsx` / `src/client/styles.ts` / `tests/{visual-styles,canvas-input-card-req029}.test.mjs` / `scripts/probe-style-prefix.mjs`(V1+N2+N3 探针) / `docs/api-probe/style-prefix{,-qwen,-i2i}-20261009/`
- **落地/验收**：2026-10-09 落地五件 |（方案 [REQ-029 §十一](./plans/REQ-029-画布image节点交互方案.md)）。**非新需求** —— CV-281 实施时按演示落了 4 条通用前缀并登记为已知偏差，本条回填；交互位置不动（`NodeInputCard.tsx` 底栏「风格」pill，image `:1081` / video `:1226` 两渲染点）。**V1 前置实测已过**（`docs/api-probe/style-prefix-20261009/`，7 组 × 2 轮 = 14/14 全 200；脚本 `scripts/probe-style-prefix.mjs` 可复跑）：同「电影感」新旧对照 —— 旧 11 字「电影感构图，宽银幕质感」两轮一致地只出普通写实图（**实测无效**），新 59 字两轮稳定复现冷蓝背景+暖橙侧逆轮廓光+暗部厚重+背景强虚化。**实测修正方案期两处误判**：①「不固定段位」原理由（某些风格写废话）被证伪，真实理由是**模型吃具体名词而非结构**；②「风格乱改构图」非随机噪声，构图变化是风格的稳定后果，残留风险收窄为「覆盖用户显式构图期待」→ UI 需提示。**十项拍板**（2026-10-09 六轮讨论）：D0 = **C-乙纯前缀注入，不引入 LLM 编排**（所见即所得，`generate.ts` 一字未改；仓库确定性原则 + 现状零改动）；D1 = 与 `style-presets.md` 11 条成片预设**两层并存**（那份绑 skill 走整片流水线、本批纯前缀走单图；两表互不引用，合并会踩「给古装电影套纸艺定格 STEP」的灾难；衔接走 `canvas-studio-creation/SKILL.md:30` 既有 role=style 参考图归纳机制）；D2 = 存 `styleId` 身份 + `stylePrefix` 文本快照（清单改文案不炸历史节点）；D3 = 纯色板、**不预留真图字段**（半吊子空字段即 CV-116 漂移形状）；D4 = 分类轴照搬扁平口径（通用媒介/摄影调性/题材/绘画），混维度登记已知债；D5 = 12 条；D6 = 视觉风格**不进** look_card（风格管本次出图 / Look 管项目级一致性，UI 提示分工）；D7 = 维持 `[节奏][摄像机][风格]` 顺序，防冲突落在「不写焦段/光圈/景深」；D8 = 写作规格经实测校准（**50–70 字** / 不固定段位 / **必含具体媒介技术名词**〔「干净的黑色描边搭配平涂色块」≫「动漫插画风格」〕/ 禁负向表述〔cfg=1.0 负向结构性失效〕/ 不碰摄像机参数 / 不暗示画幅）；D9 = 根级 `src/visual-styles.ts` 单一导出（先例 `style-grid.ts`），禁第二张映射表；D10 = 抽 `StylePicker` 两形态共用。**N1 = 历史节点不迁移不清洗**（老节点只有 `stylePrefix`，注入照旧继续用弱风格，标签回落「风格」）。**N7 摄像机欠债单独排期**（机身/镜头各 2→4 项、缺描述与适用场景，本轮不做）。**Krea2 500 字为软限制，不做客户端拦截**（风格 60 字是固定小头，用户提示词才是长度主体；限制随模型升级解除）。**待补验（上线前必做，不阻塞主线）**：Qwen 文字渲染链路（V1 全跑 Krea2，风格描述是否挤占文字注意力属推测）/ 图生图 Krea2 Edit 链路（`krea2-edit-writing` 讲「传多图时说清分工」，长前缀可能干扰参考图语义）。**已产出**：`src/visual-styles.ts` 12 条草稿（机械校验 12/12 过：长度区间/负向词/摄像机词/内部重名/与成片预设重名五项）；2 条因负向词「无摆拍感」「无环境」已改写为正向表述。 | `src/visual-styles.ts`(新) / `src/client/canvas/NodeInputCard.tsx`(D2/D10 待改) / `scripts/probe-style-prefix.mjs`(新·V1 探针) / `docs/api-probe/style-prefix-20261009/` / `docs/plans/REQ-029-画布image节点交互方案.md` §十一 | 2026-10-09 完成 V1 实测 + 12 条草稿 + 方案落笔，待开工


#### CV-310 · 「引用在、图取不到」出显式提示，不再静默塌回空态 —— §02 明明挂着 `lookRef`，但解析不出 URL（节…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P2
- **问题**：**「引用在、图取不到」出显式提示，不再静默塌回空态** —— §02 明明挂着 `lookRef`，但解析不出 URL（节点被删 / 产物未落盘）时原先**静默退化成「还没有视觉规范」空态** ⇒ 用户既不知道样张生成过、也不知道该找谁 —— 与「挂上了却看不到」是同一类伤害：**展示面必须说出事实，不能替用户把状态抹平**。修法：新 `renderLookDangling` 输出提示条（含画布节点 id，`.look-dangling` 样式）。判据严格限定在「**解析器在场、却解析不出**」；`media` 解析器缺失（含路由那条「画布读不出来」的整体降级）一律视为**无法判定** ⇒ 保持静默，不制造假警报。为此 `renderLookFigure` 改收**已解析好的 URL**，图的显示与悬空判定复用**同一次**解析（各调一次必然漂移）。
- **涉及文件**：`src/storyboard-render.ts`、`tests/storyboard-render.test.mjs`


#### CV-309 · agent 重写故事板某一节时冲掉 Host 挂的图引用（「样张先出现、后消失」的根因） —— `mergeStor…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**agent 重写故事板某一节时冲掉 Host 挂的图引用（「样张先出现、后消失」的根因）** —— `mergeStoryboardWrite` 是**节级**合并（传了 = 替换该节），而 `§02.lookRef` / `§04.shots[].refImage` 的值 **agent 手里没有**（唯一写入方是 `attachStoryboardImage`）⇒ agent 重传 `visual` 时只带 5 条 tokens，同一节里的 `lookRef` 被整节替换**一并冲掉**。**事故实证（三方取证）**：18:02:50 `image_generate` 未传 `storyboardRef` → 回执明写「已自动挂到 §02（lookRef → 43a7613b-…）」⇒ 兜底真落盘、用户已看到样张；18:04:05 `write_storyboard` 传了 `visual`（回执的「保留现值」清单**不含 02**）⇒ 就在那一刻冲掉；其后三笔只传别的节，丢了不会回来。**影响面**：扫 9 个项目 **8 个**中招（唯一没中的恰好是分镜还没写的）；`§04` 重传同理会抹掉逐镜 `refImage`。修法（`keepHostRefs`，只作用于这两个字段）：**键缺失 = 保留现值 / 显式 `null` = 清空 / 给引用对象 = 覆盖**（纠错通道）；逐镜 `refImage` 按 shot id 继承、镜被删不复活。工具描述与 `visual` 入参口径补「图片引用不归本工具管」。**存量 8 个项目按开发阶段铁律不回填**（用户确认不救）。
- **涉及文件**：`src/contracts/storyboard.ts`、`src/host-tools.ts`、`tests/storyboard-merge.test.mjs`


#### CV-308 · 覆盖层重载判据从「入参有没有 `storyboardRef`」改为「Host 是否真写了盘」 —— 覆盖层是 ifr…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**覆盖层重载判据从「入参有没有 `storyboardRef`」改为「Host 是否真写了盘」** —— 覆盖层是 iframe、不会自己重载，只能由「Host 确实回写了故事板」这个事实 bump（`bumpStoryboardRev` → `?v=` 换 key 重载）。此前客户端是拿 **`tool/call` 入参里有没有 `storyboardRef`** 来猜的；CV-306 加了自动兜底回写之后这条猜测**立刻失效** —— 兜底路径按定义就没有那个参数 ⇒ **数据写对了、覆盖层却永不重载**（2026-10-12「挖红薯」项目实测：图在盘上、覆盖层停在空骨架）。改为 Host 附注带稳定标记、客户端读标记：写法 `storyboardTouchedNote()` 与读法 `touchedStoryboard()` **同处一个模块（`tool-result-text.ts`，唯一实现）**，往返有单测钉住；只有**真写成了盘**的两处附注带 `STORYBOARD_TOUCH_MARKER`，没写成的（目标语义 id 不存在 / 故事板不可读）不带，不会骗客户端去重载。删除入参嗅探 `hasStoryboardRef` 与 `AssetCaptureState.storyboardTouched` 字段；`firstText` 与 `touchedStoryboard` 共用同一个深度遍历 `textBlocks`。
- **涉及文件**：`src/tool-result-text.ts`、`src/asset-capture.ts`、`src/host-tools.ts`、`src/question-result.ts`、`src/client/{storyboard-signal.ts,index.ts}`、`tests/{tool-result-text,asset-capture}.test.mjs`


#### CV-307 · §02 视觉规范改图文混排 + 点图放大 —— 用户诉求「视觉规范改成图片和文字混排，图片最好能点开放大」

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P1
- **问题**：**§02 视觉规范改图文混排 + 点图放大** —— 用户诉求「视觉规范改成图片和文字混排，图片最好能点开放大」。`renderLookFigure` 输出 `.look-row`：宽栏左右并置、≤620px（真实中栏宽度）降为上下单列；图外包 `<a class="zoom" href target="_blank" rel="noreferrer">` + `cursor:zoom-in` + hover 角标「点开看原图」，实现新窗口看原图、可自由缩放。**保持故事板产物的零 JS 契约**（该文件头注 + 版本管理方案 §7.1；与该文档 §01 来源链接同款，代价是单击而非双击，已随用户说明）。无图时**逐字节回到旧行为**：无 `.look-row`、无占位、无 `<img>`。守卫 `tests/storyboard-render.test.mjs` 新增图文混排（含 `<a target>` / `cursor:zoom-in` / **零 `<script`**）与「无图不占位」两条；反向变异「抹掉 `target="_blank"`」真变红。
- **涉及文件**：`src/storyboard-render.ts`、`tests/storyboard-render.test.mjs`


#### CV-306 · 基调样张自动兜底回写（「用户看不到样张就无法拍板」的产生路径修洞） —— 症状：agent 出基调样张时常漏传 `s…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**基调样张自动兜底回写（「用户看不到样张就无法拍板」的产生路径修洞）** —— 症状：agent 出基调样张时常**漏传 `storyboardRef`** ⇒ 图落了画布节点、却没进故事板 §02「视觉规范」⇒ 用户在中栏覆盖层里看不到，无法就视觉方向拍板。修法：判据抽成纯函数 `shouldAutoAttachLook(sections, shotBound)`（`contracts/storyboard.ts` 内唯一实现）＝「本图未绑镜 ∧ §02.`lookRef` 为空 ∧ §04 尚无分镜」；Host 侧新 `autoAttachLookSample` 先读一次做闸门（**逐镜出图这条高频路径零写入**）、读改写内再复查一次防插队、整体 try/catch **绝不抛错**（兜底通道不能连累一次已完成的生成）。**已有样张永不自动覆盖** —— 要「换一批」必须显式传 `storyboardRef='look'`。同步更新工具描述、`lookRef` 字段注释与 `SKILL.md`。守卫 `tests/storyboard-contract.test.mjs` 1 正 4 反。
- **涉及文件**：`src/contracts/storyboard.ts`、`src/host-tools.ts`、`skills/canvas-studio-creation/SKILL.md`、`tests/storyboard-contract.test.mjs`


#### CV-305 · 落地执行体重构：以「`landed` 即预写日志（WAL）」为骨架重写落地事务（REQ-022 评审批 A，评审 S…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**落地执行体重构：以「`landed` 即预写日志（WAL）」为骨架重写落地事务（REQ-022 评审批 A，评审 SB-01 + SB-06 同批）** —— ① **SB-01 落地顺序缺陷**：原实现先写画布、后写 `landed`，「画布已成、标记未写」的窗口**无法自愈**（重试判不出已落过 ⇒ 整套节点重复 append），而写画布失败时用户被 `assertNotLanded` 永久锁在「已落地但什么都没发生」；改为 WAL 顺序：**① 只写 `landed`（+「落地前固化」checkpoint）② 投影 + 写画布 ③ `bindings` 由画布实况重建 ④ 推 `executing`**。② **SB-06 TOCTOU**：复核点从「入口读」挪进 WAL 的 `mutate` 内（那时才是盘上最新值）。③ **抽成唯一实现点**：`landStoryboard` 从 `routes.ts` 的模块私有函数搬进新 `storyboard-land.ts`（窄接口 `StoryboardFileRegistry` + 可注入假 registry ⇒ 可做**行为级**测试，不再靠字符串断言兜）；`loadStoryboardOrFail` / `updateStoryboardOrFail` 迁入 `storyboard-store.ts`（消息原文照搬，两处各写一份必然漂移）。④ **入口三分支**：未落地 → 首落 / 已落地 ∧ 有锚点 ∧ `executing` → 拒 / 其余 → **续做**（沿用 `landed.sections` 的料，只补缺失那一步，不重复 append）。⑤ 幂等判据 = `hasSeedAnchor(nodes)`（`toolName === SEED_ANCHOR_TOOL`，**不判 title**：锚点标题含 `document.title`，规划期 agent 改名 ⇒ 重试时假阴性 ⇒ `writeCanvas` 整体覆盖写会灌第二整套节点）。⑥ **UI**：新 `sbLandedHalfway`（`landed != null ∧ state !== executing`），该态下「确认落地」**保持可点**、文案改「接着完成落地」（否则是死局：按钮被 `sbLanded` 禁用、覆盖层又因 state 仍是 `storyboarding` 不肯让位，画布永远空着）；「关闭」条件收敛为**只看 `state`**。**验证**：typecheck / build / verify:loader / 全量 `run-smoke` **1586 pass / 0 fail**、基线名单外 0；13 条行为级用例（真 `lib/storyboard-land.js` + 假 registry + 临时目录真 `storyboard.json`）+ **4 轮反向变异**（顺序反转 / 去幂等探测 / 入口退化「一律拒」/ 去 TOCTOU 复核 + UI 回写旧 disabled）均真变红。**注**：`bindings` 真源是画布这一决定是被反向变异逼出来的 —— 第一版按投影计划算时，「去掉幂等探测」这条变异**没变红**，正暴露了探测命中跳过写画布时 bindings 指向未落盘随机 id 的真 bug。
- **涉及文件**：`src/storyboard-land.ts`(新)、`src/storyboard-store.ts`、`src/routes.ts`、`src/contracts/canvas.ts`、`src/client/{StudioFrame.tsx,api.ts,index.ts}`、`tests/storyboard-land-resume.test.mjs`(新)、`tests/storyboard-land-wiring.test.mjs`


#### CV-304 · 阶段守卫收紧 + 撤回指向不存在工具的文案（REQ-022 评审批 A 之二，评审 SB-03 + SB-04 同批…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P1
- **问题**：**阶段守卫收紧 + 撤回指向不存在工具的文案（REQ-022 评审批 A 之二，评审 SB-03 + SB-04 同批）** —— ① `write_storyboard` 的阶段守卫原只拦 `executing`，而三态早已上线 ⇒ `keyframe_review` 期 agent 仍可**整体重写**故事板（此时关键帧已是制作产物，重写让画布产物与规划失配，正是该守卫要防的事）。改为白名单「**仅 `storyboarding` 放行；`keyframe_review` / `executing` 拒；`workflow` 缺失的 legacy 项目放行**」——契约 §3.3「工具互斥」本来就该是这样，守卫没跟上三态迁移；② 报错文案**不再指路不存在的工具** `revise_storyboard`（全库无实现，契约排在 P2），改为只说事实（「该入口仅限规划期」）+ 把改动意愿交回用户，连带撤回 `contracts/storyboard.ts` 注释、`approval-gate.ts` 头注（原称「审阅态必须允许 write_storyboard 改写」已与实现矛盾）、`docs/canvas-studio-tools.md` 阶段纪律行。守卫 `tests/storyboard-stage-gate.test.mjs` 是**行为级**（直接驱动 `lib/host-tools.js` + 假 registry）：三态放行 / 拒绝、拒绝发生在落盘**之前**（零副作用）、legacy 放行、文案不提名不存在的工具。
- **涉及文件**：`src/host-tools.ts`、`src/contracts/storyboard.ts`、`src/approval-gate.ts`、`docs/canvas-studio-tools.md`、`tests/storyboard-stage-gate.test.mjs`


#### CV-303 · 落地版本接线（REQ-022 评审批 A 之一，评审 SB-02）：选中「落地 vN」实际落的是活副本 —— 按钮文…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**落地版本接线（REQ-022 评审批 A 之一，评审 SB-02）：选中「落地 vN」实际落的是活副本** —— 按钮文案与 title 承诺「把历史版本 `${sbVersion}` 落成画布节点」，`handleLand` 却调 `landStoryboard(projectId)`，**漏传版本号**；而链路（`client/index.ts` 封装 → `api.ts` body → 路由选版 + 找不到报错 + 落历史版本不补 checkpoint）本就完整，纯 UI 漏接。后果：用户在「对比 → 选版 → 落地」这条**最谨慎**的路径上拿到活副本内容，而落地后 `assertNotLanded` 冻结、**不可撤销**（静默投错料）；按钮从 `sbVersion` 与「落活副本」的分支看本就有意如此，只有这一处漏了传参。修：`landStoryboard(projectId, sbVersion)`。守卫 `tests/storyboard-land-wiring.test.mjs` 把四段链路（UI → client 封装 → api body → 路由选版）串起来断言，断哪一段都红。
- **涉及文件**：`src/client/StudioFrame.tsx`、`tests/storyboard-land-wiring.test.mjs`


#### CV-302 · 首屏「故事板与画布同帧出现」—— 新建项目点「开始创作」不再先落空画布、十几秒后才弹「拍摄定稿」（用户 2026-1…

- **状态**：已完成（桌面验收通过）
- **优先级**：P0
- **问题**：**首屏「故事板与画布同帧出现」—— 新建项目点「开始创作」不再先落空画布、十几秒后才弹「拍摄定稿」**（用户 2026-10-12 桌面验收通过）。**根因两层叠加**：① 认领 / 打开项目时 Host **随项目记录**返回的 `StudioProject.workflow` 只落进 projects 列表、没进 `store.workflows`，而覆盖层自动可见性读的正是它 ⇒ 只能干等 agent 首笔工具结算触发的 `refreshWorkflow`（那「十几秒」）；② 可见性是 `useEffect` 而非**派生**，effect 在 commit 之后跑 ⇒ 必漏一帧裸画布。**修法**：① 新增 `adoptWorkflow(project)`（`setWorkflow(id, project.workflow ?? WORKFLOW_DEFAULT)`，零请求零猜想），`claimAndSend` 与 `openProject` 在 `select()` **同拍**调用（中间禁插 await），`refreshWorkflow` 降级为对账；② 覆盖层可见性改派生 `storyboardAuto = 已选项目 ∧ workflow.state === 'storyboarding' ∧ 未被用户关过`，`storyboardVisible = 手动开 ∪ 自动`，删掉原自动打开 effect，`storyboardDismissedRef`(useRef) → `storyboardDismissed`(**useState**)（ref 写入不触发重渲染，派生式会静默失效）；③ **顺带白拿需求二**：落地把 state 推成 `executing` 后派生式自动转假 ⇒ 覆盖层自己让位给画布，不需要额外关闭逻辑（手动落地那条路仍走 `handleLand`）。
- **涉及文件**：`src/client/index.ts`、`src/client/StudioFrame.tsx`、`tests/storyboard-first-screen.test.mjs`


#### CV-301 · 打开 / 切换项目时 workflow 状态提前并行拉取（首屏「覆盖层随画布即弹」的前半程）（提交 `10e395a…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P1
- **问题**：**打开 / 切换项目时 workflow 状态提前并行拉取（首屏「覆盖层随画布即弹」的前半程）**（提交 `10e395af94`；**原标 CV-297 → 与「孤儿会话防护」撞号，2026-10-12 改号登记**）—— 症状：从首页进项目**先看到空画布、过一会才弹「拍摄定稿」**。根因：覆盖层自动弹只看 `workflow.state`，而 `refreshWorkflow` 原先排在 `openProject` 串行链尾（workspace 绑定 / 认领改名 / 会话恢复 / 画布载入 / skill 清单之后），只能等整条链跑完才发起。修法：`select()` 后立刻 **fire-and-forget 开拉**（与后续步骤零依赖，失败静默自吞）；`switchProject` 同步摘出 `.then()` 链（原为「等画布载完再拉」）。**边界说明**：本条只把等待从「串行尾」提到「并行头」，仍要一次网络往返 ⇒ 真正的**同帧出现**由紧随其后的一次「同拍写入」收口（见 §8 2026-10-12 行）。验证：typecheck 双绿 / tsdown / 全量 smoke 1545·1545。
- **涉及文件**：`src/client/index.ts`（`openProject` / `switchProject`）


#### CV-300 · write_storyboard 分节合并 + 故事板 §00「你的原始创意」块 + 阶段一隐藏「关闭」（提交 `6…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**write_storyboard 分节合并 + 故事板 §00「你的原始创意」块 + 阶段一隐藏「关闭」**（提交 `6948ec0cf3`；**原标 CV-296 → 与「REQ-022 版本管理」撞号，2026-10-12 改号登记**）—— **① 分节合并**：`write_storyboard` 由整体替换改**未传的节保留现值**（修复「分次写互相冲掉、创意理解中途消失」；显式传空才清空；回执列出未传保留的节）—— 合并语义落在 `contracts/storyboard.ts` 纯函数。**② §00 原话块**：`routes.ts` 读画布 BRIEF 节点全文渲染「你的原始创意」（**不计入 9 节完成度、不进 `storyboard.json`**；原话必须 `escapeHtml`）。**③ 阶段一隐藏「关闭」**：`storyboarding` 且未落地时覆盖层不出关闭钮（该阶段画布无独有内容，关掉只会停掉自动弹），落地后恢复。**④ 口径同步**：工具描述 / `SKILL.md` / `toolchain.md` / `screenplay.md` / `canvas-studio-tools.md`，消除「必填 vs 全可选」「不丢内容」的矛盾措辞。**验证**：新增 `storyboard-merge` 5 条（反向变异已验证变红→还原）+ `sourceIdea` 渲染守卫；全量 smoke 1545·1545。
- **涉及文件**：`src/host-tools.ts`、`src/contracts/storyboard.ts`、`src/routes.ts`、`src/storyboard-render.ts`、`src/client/StudioFrame.tsx`、`skills/canvas-studio-creation/*`、`tests/storyboard-{merge,render}.test.mjs`


#### CV-299 · REQ-022 拍摄定稿 UX 两问收口：创意先行（骨架预建）+ 效果图回写故事板（`storyboardRef` …

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-022 拍摄定稿 UX 两问收口：创意先行（骨架预建）+ 效果图回写故事板（`storyboardRef` 通道）**（别名 R-P0-01；用户验收 CV-293/295/296 批后反馈）—— **问题①「创意没先上故事板」**（首屏空壳、内容随对话才补齐）：`storyboard-store.ts` 新增 `ensureStoryboardSkeleton(registry, projectId, title, plan?)` —— 项目**创建/认领瞬间**预建骨架（幂等：已有 storyboard 不动；meta 取 plan 的 `aspect`/`targetDuration`，回落 16:9 / 0，genre 留空待创意），`routes.ts` 两条创建路由 fire-and-forget `.catch(() => undefined)` 不阻断建项目；`storyboard-render.ts` 0/9 分镜时渲染 **「等待创意填充」引导横幅**（`.waitbanner`，讲清「先聊创意、确认后由 agent 首写填满」）；skill 步骤 1（基调样张必传 `storyboardRef:"look"`）/ 2b（创意确认后第一动作即首写骨架）/ 6（逐镜出图必传 `storyboardRef=<shot id>`）三处纪律强化。**问题②「效果图落在被覆盖层挡住的画布上」**：`host-tools.ts` `image_generate` 新增可选参数 **`storyboardRef`**（shot 语义 id `S1-Sh1` → 挂该 shot 的 `refImage`；`look` → 挂 §02 的 `lookRef`；`param-guard.ts` 参数分类表同步归类，漏改即参数分类测试红）；结算时（**含 image_fix auto-fix 换节点后**）调 `attachImageToStoryboard()` → `contracts/storyboard.ts` 纯函数 **`attachStoryboardImage(sections, ref, image) → {sections, hit}`**（`hit: 'shot'
- **涉及文件**：'look'
- **落地/验收**：'miss'`；**绝不抛错** —— miss/异常降级为 warnings 附注「图只落在画布节点上」，生成结果不受牵连）；渲染 `storyboard-render.ts` 出 `mediaUrl?: (ref) => string | undefined` 回调，shot 卡 `.shot-fig`、基调 `.look-fig`、素材 `.asset-thumb` 三处出 `<img>` 缩略图（URL 经 `escapeHtml`）；`routes.ts` 新 `storyboardMediaResolver(registry, projectId)`（`canvasNode` → 节点 `node.url`、`file` → `/canvas-studio/assets/<projectId>/<id>`；读画布失败降级 undefined 不断渲染）；回写后经 `asset-capture.ts` 新 hook **`onStoryboardTouched`**（**仅**入参带 `storyboardRef` 的结算置 `storyboardTouched`）→ `client/index.ts` `bumpStoryboardRev(projectId)` 刷新覆盖层（无谓刷新会覆盖用户手改，故收窄触发面）。**连带**：`write_storyboard` 首笔写在预建骨架上**就地填进 v1 快照**（判据 `isPristineSkeleton`：`history.length===1 && history[0].version===baseline && filledSectionCount(document.sections)===0`，versionNote「首稿已存为 **v1**（骨架壳就地填满）」，不制造空壳版本）；`tests/skill-catalog.test.mjs` 体积上限 20KB→21KB（用户拍板：超限无需压缩，后续自优化 skill）。**验证**：typecheck ✓ / build ✓ / verify:loader ✓ / `test:smoke` 全绿（失败 0、基线内 0、名外新增 0）；storyboard 三套定向 **41/41**（新增 contract 3 组 + render 4 组 + store 2 组） | `src/contracts/storyboard.ts`、`src/storyboard-{store,render}.ts`、`src/host-tools.ts`、`src/routes.ts`、`src/{asset-capture,param-guard}.ts`、`src/client/index.ts`、`skills/canvas-studio-creation/SKILL.md`、`tests/{storyboard-contract,storyboard-render,storyboard-store,skill-catalog}.test.mjs`


#### CV-298 · 首页 LLM 模型座椅恢复（REQ-028 工具行二次反转） —— 用户反馈首页右组红框区应有模型选择

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P1
- **问题**：**首页 LLM 模型座椅恢复（REQ-028 工具行二次反转）** —— 用户反馈首页右组红框区应有模型选择；定位为 REQ-028（2026-10-06）按槽锚整槽隐藏 `conversation.input.model`（当时顾虑座椅挤得工具行折两行）。真机截图量测推翻顾虑：卡内宽约 790px、左组三 chips 约 330px + 右组（模式 + 座椅 + 发送）约 360px，**一行装得下**（座椅触发器 120–155px，模型长名有 max-width + ellipsis 兜底；宿主 `.tools` 本就 flex-wrap + margin-left:auto，窄窗优雅折行不重叠）→ 拍板恢复。**styles.ts**：删整槽隐藏规则，恢复 CV-259 白名单 `.csChat [data-phase="hero"] [data-slot="conversation.input.model"] button[aria-haspopup="menu"] { display:flex !important }`（特异度 (0,4,1) > 通配条 (0,3,1) 且写在通配条之后；display 值 = 上游 .trigger 的 flex）；「+」命令菜单 / 权限选择两枚维持隐藏；work 态零变化。**守卫二次反转**（tests/visual-tokens.test.mjs）：白名单在位 + 特异度更高 + 顺序在后 + 整槽隐藏不得诈尸 + 上游锚核验（InputBar 槽键 / ModelSelect 触发器形态 / 命令钮 listbox / 权限 aria 模板）；**Y-7 验收用例同步**（右组改「模式 chip + 座椅 + 开始创作」）。**验证**：visual-tokens 41/41 绿 / tsc 双套 + tsdown 重建。
- **涉及文件**：`src/client/styles.ts`、`tests/visual-tokens.test.mjs`、`docs/{STATUS,tracking,acceptance-test-cases}.md`


#### CV-297 · 孤儿会话防护：删项目清会话 + 发送前「会话↔项目」错位重建 + 启动不恢复孤儿会话（用户实测「点开始创作后没切页…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**孤儿会话防护：删项目清会话 + 发送前「会话↔项目」错位重建 + 启动不恢复孤儿会话**（用户实测「点开始创作后没切页、仍在首页对话；重试即好」）——**取证**（会话转录 + 应用日志 + 磁盘/登记表三方对照）：失败会话 `bcf500c9` 的 `cwd = …/projects/.draft-202610-11082433`，该目录**磁盘上不存在、projects.json 里也没有**；另一会话 `988673fd` 的 `cwd = …/projects/测试起名字` 对应**用户手动删除的项目**。⇒ cwd 解析不到项目 ⇒ Host 侧 `resolveProjectId` 抛 `CS-USER-ERR 当前会话工作区未绑定任何 Canvas Studio 项目`（日志 10:31:11 两条，与截图同时）＋ 客户端无选中项目 ⇒ 布局判定回落 **lobby**（`projectId === null ? 'lobby'`，左栏变 hero 文案、中间居中对话卡）。**三处修**：① `deleteProject` 删项目时把该 workspace 名下的 **sessionIds 逐个 archiveSession**（此前只摘 workspace，会话残留成孤儿）；② `sendSession` 增加**会话↔项目错位防护**：`resolveActiveProjectId` 非空但 `sessions.current.cwd ≠ 选中项目 dir` 时，走 **rebindAndSend**（按选中项目目录重建绑定，CV-294 rebind 同款）再发，消息不丢；③ `alignStartupSession` **不恢复孤儿会话**（cwd 不属于任何项目目录时跳过，只跳过不归档——首页落点会话的 cwd 同样不在项目目录集合里，误归档会把首页会话摘掉）。**顺带澄清**：截图里那条 `[system] The user's message may not have been fully delivered…` **不是系统消息，是模型输出**（`assistant/message`，40 tok，provider wl-llm/qwen3.8-27b-mtp，与截图模型一致；同会话 turn 1 被用户 aborted，疑为「中断后补发指令」被模型原样复读；该文案不在 `deepseek-harness/packages` 源码里）。**验证**：typecheck 双绿 / tsdown / 全量 smoke 基线 0。
- **涉及文件**：`src/client/index.ts`（deleteProject / sendSession / alignStartupSession / rebindAndSend）


#### CV-296 · REQ-022 版本管理（存档 / 列表 / 切换 / 回退 / 对比）（方案 plans/REQ-022-版本管理…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-022 版本管理（存档 / 列表 / 切换 / 回退 / 对比）**（方案 [plans/REQ-022-版本管理方案.md](./plans/REQ-022-版本管理方案.md)，REQ-022 P2-a~c 合并为一次做完）—— **schema v2**：`versions.current` → `baseline`（「活副本派生自哪版」，与「正在看哪版」这个**视图状态**分清）、新增单调计数器 `seq`、`history[]` 加 `kind`(auto/manual) 与 `note`、`final`+`sourceVersion` 搬出 `versions` 成顶层 `landed { at, sourceVersion, sections }`；旧 `schemaVersion` **显式报错不静默迁移**（新增落盘第四态 `stale`：留证？不 —— 文件是好的，只报错并提示让 agent 重写）。**打点收窄到四个时刻**：首稿 / 用户手动存档 / 回退前 / 落地固化；**撤销上轮「每次整体重写都打点」**——它与「分次写」直接冲突（4 笔刷出 4 条机械版本，实测用户项目里已有 `重写前存档 v1/v2`）。**新增纯函数层**：`storyboard-history.ts`（`nextVersionId`/`archive`（深拷贝快照）/`restoreTo`（**先打点当前活副本再覆盖**，方案 §3.3 选项 A）/`relabel`）、`storyboard-diff.ts`（**按语义路径逐字段** diff，带人读中文 label；带 ID 的集合按 ID 配对、无键数组按下标）。**路由**（全收在一条 prefix 内分派）：`GET /<id>.json`（版本摘要）、`GET /<id>.html?rev=&version=&from=`（`from` 存在即**对比模式**，差异就地高亮 —— 放 Host 侧算是因为文档**零 JS**、无注入通道）、`GET /<id>/diff`、`POST /archive
- **涉及文件**：/restore
- **落地/验收**：/rename|/land`（`land` 支持 `version`：契约 §5「任意历史版本可落」）；**不提供删除版本**（历史只增不减）。**渲染**：差异三色就地高亮 + 顶部差异摘要 + 分节 tab 角标；**关闭对比时输出与改动前逐字节一致**（同构测试仍绿）。**客户端**：覆盖层头部版本入口 + 面板（活副本 / 版本列表 / 存档表单 / 回退 / 对比 / 改名），落地后写操作**不渲染**。**`?rev=` 与 `?version=` 拆开**（原先 `?v=` 兼作缓存破除号会与版本号撞车）。**验证**：typecheck 双绿 / tsdown / storyboard 六套测试 **59 断言** / 全量 smoke 基线 0。 | `src/contracts/storyboard.ts`、`src/storyboard-{history,diff,render,store,seed}.ts`、`src/routes.ts`、`src/host-tools.ts`、`src/client/{api,StudioFrame,index,contracts}.ts`、`tests/storyboard-*.test.mjs`、`skills/canvas-studio-creation/SKILL.md`、`docs/plans/REQ-022-版本管理方案.md`


#### CV-295 · REQ-022 原子批：3 态迁移 + 三工具下线 + seed + 落地按钮（详细开发计划 §二.1 的「原子切换…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-022 原子批：3 态迁移 + 三工具下线 + seed + 落地按钮**（[详细开发计划 §二.1](./plans/REQ-022-详细开发计划.md) 的「原子切换」；含前置的 295a：`isShotCard` + seed + 落地路由）——**① 状态机 5→3 态**：`storyboarding` / `keyframe_review` / `executing`；`normalizeWorkflow` 一次性把 `drafting`/`script_review`/`awaiting_approval` 并入 `storyboarding`；`resolveSetModePatch` **落地后不回退**（单向终点）；`STATE_FLOOR`/`APPROVAL_STATES`/`REVIEW_STATES` 各收敛到 3 值。**② 三工具下线**：`write_screenplay` / `submit_screenplay_for_approval` / `submit_storyboard_for_approval` 全删（含 `WORKFLOW_TOOLS`、`param-guard` 的分类项、`tool-presentation` 条目**保留**给历史记录用；`STORYBOARD_NODE_TOOL` 常量**保留**作存量卡兼容）；`routes.ts` 四个审批动作（approve/reject/approve_script/reject_script）删除；客户端两条审批条 + 四个处理器删除。**③ `isShotCard` 双值谓词**：新增 `SEED_SHOT_TOOL='seedStoryboardShot'` / `SEED_ANCHOR_TOOL='seedCanvasFromStoryboard'`；**21 处** `=== STORYBOARD_NODE_TOOL` 全改 `isShotCard(...)`（阶段判定 / 标题解析 / shotRefs / 素材组血缘 / 自动测试断言 / canvas-view 泳道 / compose / generate）；`StudioCanvasNode.sbRef` + `StudioAsset.sbRef` 新增，**`writeCanvas` 的 client-author 保护扩展为 filename + sbRef**（否则用户一拖画布就丢回指针）。**④ seed**：新增 `src/storyboard-seed.ts`（契约 §7.5 十行映射；镜号一次铸造 1..N；§01 待核实项与 §08 不落节点；占位节点不塞 `generationPrompt`）。**⑤ 落地通道**：`POST /canvas-studio/storyboard/land`（exact 路由，与 overlay 的 prefix 共存）——三层校验 + 单向终点（`versions.final` 已置即拒）+ 固化 vN + seed 写画布 + 回填 `bindings` + 状态推 `executing`；覆盖层「确认落地」按钮接线。**⑥ 纪律小节**：新增 `src/storyboard-discipline-prompt.ts`（order **153**，§00 前提 + §02 tokens + §08 约束；未落地不注入）。**⑦ skill 改造**：SKILL.md 六处 + screenplay/clarification/toolchain 分册 + oriental 风格 skill。**验证**：typecheck 双绿 / tsdown / 新增 storyboard 四套测试 **40 断言** / 全量 smoke **基线 0**（旧工具相关用例随能力迁移删除或改写到新路径）。
- **涉及文件**：`src/contracts/{project,canvas,storyboard}.ts`、`src/workflow-stage.ts`、`src/approval-gate.ts`、`src/approval-notice.ts`、`src/host-tools.ts`、`src/routes.ts`、`src/projects.ts`、`src/storyboard-{store,render,seed,discipline-prompt}.ts`、`src/{asset-capture,param-guard,tool-presentation,canvas-view,compose,generate,shot-versions,auto-test-*}.ts`、`src/index.ts`、`src/client/*`、`skills/**`、`tests/**`


#### CV-293 · REQ-022 阶段一「拍摄定稿」增量批（原 P1 拆分后的前半：纯增量、零破坏

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-022 阶段一「拍摄定稿」增量批**（原 P1 拆分后的**前半：纯增量、零破坏**；后半「原子批」= 3 态迁移 + 三工具下线 + seed + 落地按钮，见 [plans/REQ-022-详细开发计划.md](./plans/REQ-022-详细开发计划.md) §二.1）——① `src/contracts/storyboard.ts`：wire 契约 + `createStoryboard` / `normalizeStoryboard`（顶层非对象 → `undefined`，走损坏分支）+ **`validateForSeed`**（唯一完成度判据：blocker 只答「能不能落地」、warning 只进确认清单）；② `src/storyboard-store.ts`：**三态 `StoryboardLoad`**（ok/missing/corrupt）、损坏 → **改名留证 `<file>.corrupt` 绝不静默重置**、**模块级串行队列（读也排队）** + `updateStoryboard` 读改写原子入口；③ `src/storyboard-render.ts`：`renderStoryboard(doc,{version,landedVersion})` 纯函数 + 占位/损坏页（**全字段 escapeHtml**）；④ `src/projects.ts` 公开 `storyboardFile()`（与 `canvas.json` 同级）；⑤ `src/routes.ts` 新增 **prefix** 路由 `/canvas-studio/storyboard`——**WebServer 只支持 exact/prefix、无 `:id` 参数位**，故前缀 + 手动解析单段 `{projectId}.html`（字符集天然防穿越）；missing/corrupt **都不回 404**（给占位页 / 留证页）；⑥ 画布顶条「拍摄定稿」按钮 + 全屏只读覆盖层 iframe（内联样式对象，**不碰 `styles.ts`**）；⑦ `write_storyboard` 工具（九段 **JSON 字符串**入参，解析不出显式报错**不落盘**；首稿 v1、重复调用 = 整体重写且旧活副本自动存版；`executing` 期拒绝整体重写）+ `WORKFLOW_TOOLS` 登记。**验证**：`typecheck` 双绿 / `tsdown` / 新增 3 测试文件 **29 断言全绿** / 全量 smoke **1458·1458、基线 0**。**未提交，等桌面验收**
- **涉及文件**：`src/contracts/storyboard.ts`、`src/storyboard-store.ts`、`src/storyboard-render.ts`、`src/projects.ts`、`src/routes.ts`、`src/host-tools.ts`、`src/asset-capture.ts`、`src/client/StudioFrame.tsx`、`tests/storyboard-{contract,store,render}.test.mjs`、`docs/canvas-studio-tools.md`、`skills/canvas-studio-creation/references/toolchain.md`


#### CV-285 · 画布 chrome 比例补偿（方案 A

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**画布 chrome 比例补偿（方案 A；验收前对拍效果图比例，用户反馈「100% 下菜单与输入卡偏小」）**。根因：演示节点恒 `min(620px,74vw)`（角标 1678×937 是装饰文字），工具条/卡的绝对 CSS px 按 620 基准调观感；CV-284 自然像素节点（1280/1920 随图变）下 chrome/节点比值 = 620/图宽 → 1280 的图掉到 0.48 倍。① **`canvas-view.chromeScaleOf(w) = clamp(w/620, 0.75, 4)`**（465~2480px 宽**精确补偿**、512~2048 常见生成全在线性带；下限保字号可读、上限防怪物字号；非法回退 1）；② **工具条**：`nodeActionAnchor` 返回 `visualScale = z×k`，另按 `(视口宽−2×8)/条宽` **封顶**（k×z 相乘后中等缩放就可能比视口宽——整条留屏内优先于比值，产品偏差登记）；y（`nodeTop − 12×visualScale − barH`，barH 不乘=原点在底边）、横向半宽夹取、JSX `scale` 三处同源；③ **卡**：`effScale = z×k` 同乘 scale/间隙/横向夹取/抽屉顶夹；**布局宽反推** `min(CHROME_CARD_WIDTH, 92%可视区/effScale)`（k>1 不反推会整卡甩出视口；**字号不缩、只收行宽** = 演示窄窗 min() 同语义）；④ `CHROME_CARD_WIDTH = 760` 落 **canvas-aspect**（preview-tokens/visual-tokens 规定 styles `${…}` 只准插值 aspect 数值导出）+ styles 改插值；⑤ **守卫**：`canvas-chrome-align-req029` 扩 2 条新 test（k 数学与上下限 / visualScale 合成与视口封顶 / 布局宽反推，lib 实测）+ 断言跟改，`canvas-video-tray-req031`/`canvas-input-card-req029`/`visual-tokens` 跟改。**门禁 typecheck/build/verify:loader/test:smoke 1379·1379 全绿、基线 0**
- **涉及文件**：`src/canvas-view.ts` / `src/canvas-aspect.ts` / `src/client/{styles.ts,canvas/NodeInputCard.tsx,canvas/NodeActionBar.tsx}` / `tests/{canvas-chrome-align-req029,canvas-video-tray-req031,canvas-input-card-req029,visual-tokens}.test.mjs`
- **落地/验收**：2026-10-08


#### CV-280 · REQ-028 首页 Agent 项目创建框改版 v2（别名 R-P0-13）—— 统一「chip 触发器+悬浮气泡…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P0
- **问题**：**REQ-028 首页 Agent 项目创建框改版 v2（别名 R-P0-13）—— 统一「chip 触发器+悬浮气泡弹出框」+ 参考内容方框（1:1 复刻演示）**。**① `LobbyPopover.tsx`（新）**：统一弹出框外壳 + 跨组件单开互斥（模块级登记表）+ 34px 菜单行（选中态读 `aria-pressed`）+ hover 气泡；规格逐条对齐演示（上方 11px / 45° 尖角 / 226–268px / 圆角 12 / 150ms）；触发器不写 `aria-haspopup`（CV-259 hero 通配隐藏会误杀）。**② 规格选择器迁槽**（v1.3 dock 行 + ProjectSpecChips 退役）：左组三 chip（模型三选 `h3`/`seeddance-2.0`/`seeddance-2.5`〔推荐 meta〕· 画幅+分辨率合并「16:9 · 720P」两段两份独立状态 · 时长三态 10/15/30/60+自定义+不锁定）进 `conversation.input.left`，模式 chip（绿=自动执行/琥珀=询问执行，菜单只写模式名+脚注+hover 气泡）进 `conversation.input.right`；work 态返回 null。**③ 草稿域 `src/lobby-spec.ts`（新，纯模块）**：`LobbySpecDraft` + `RESOLUTION_DISPLAY` 唯一映射（480P/720P/1080P ↔ **480p/736p/2k**，拍板②，不新增 1080P 实体档位）+ `buildLobbyPlan`（画幅恒写、时长夹 300）+ chip 读数 helpers；`tests/lobby-spec.test.mjs` 6 条从 lib/ 真 import。**④ 参考内容方框（LobbyStashBar v2）**：58×58 虚线方框常驻 lobby + 缩略图左侧排队 + 双来源弹出框（本地文件…/资产库 N 项）+ 脚注保留 CV-261 语义出口；**暂存机制原样沿用**（登记/限额/toast 单一实现，组件发 `cs-lobby-stash-files`/`cs-lobby-open-library` 两条 window 事件接回 StudioFrame；lobby paste capture 接管；LobbyHero 📎 退役=入口唯一；资产库详情抽屉 lobby 态「暂存为参考内容」fetch 库媒体→File→既有链路）。**⑤ 「开始创作」药丸**：`tagSendButton` lobby 态打 `data-cs-send` 锚（卡内最后 button + aria-label 双语核验，不中静默退回）→ styles 重塑 accent 渐变+固定文案（不随模式改写，拍板④）。**⑥ 令牌**：`--cs-ok`/`--cs-warn`（模式点固定功能色）+ `--cs-accent-contrast`（accent 实底文字色，随预设）入 brand.ts；演示色值零照抄（四预设×双轨）。**偏差登记**：模式脚注不照抄演示句「先出分镜表，确认后才渲染」（REQ-022 仅设计）；自定义时长上限 300 非演示 600；模型/分辨率暂不落 plan（路由消费后续 CV）。**验收截图反馈同日修正**：hero 态藏宿主「+」命令钮（`aria-haspopup=listbox` 锚）/ 权限选择（aria-label 模板前缀双语锚）/ **LLM 模型座椅**（槽锚整槽隐藏，**CV-259 白名单按 REQ-028 新拍板反转删除**，work 态不受影响，visual-tokens 守卫改写为反转守卫）→ 工具行回演示单行；「开始创作」禁用态改灰实底（accent 打折的糊紫→node 弱化字，opacity 回 1）。**登记不可修**：方框在卡外（宿主无卡内上插槽位；attachments 单槽已被宿主附件包占用）/ placeholder（宿主 i18n）/ Enter 脚注行（hero 不渲染 composer.dock）/ 药丸紫橙（--cs-accent 跟随预设）。**卡内接管追加（讨论拍板后闭环「方框在卡外」）**：动态桥 `slots.inject('conversation.input.attachments')` + store 订阅——首页以 priority -1 遮蔽宿主 ui-attachment 条（**SlotCore 单占槽语义原生支持**：不同优先级=合法遮蔽、低者渲染），卡内画「暂存缩略图 + 宿主遗留草稿图（槽 runtime props 转显，previewUrl/onRemoveImage 走宿主数据流）+ 参考内容方框」；进项目 dispose 退位、宿主条自动回为 winner——work 态零变化、零上游 import。几何改卡内 16px 对齐 textarea。守卫：host-boundary 补行 + 红线④放宽为祖先链判定 + lobby-stash 改锚。**续二（通道统一 + 悬停预览）**：资产库出口按态二选一（首页只给「暂存为参考内容」→缩略图通道；「引用到对话」退回项目态——此前首页走它会把资源插成正文蓝色链接 chip）；图片/视频缩略图悬停出 240×160 放大预览（外盒锚/内层 clip 管裁切/浮层 pointer-events none；视频悬停静音循环播放）。**续三（预览方位 + 快捷键脚注）**：悬停预览翻到缩略图上方（下方压正文）；「Enter 提交 · Shift+Enter 换行」脚注行闭环——换行是宿主既有行为（Shift+Enter 无条件原生换行），提示用槽锚 + ::after 伪元素补画（hero 下方 32px 留白正好放下，不占布局）。不可修清单收敛：仅余 placeholder（上游 i18n）与药丸紫橙（预设差异）。**验收**：**功能验收通过（2026-10-06，用户确认）**——五轮验收反馈全部闭环（截图对照修正 / 卡内接管〔讨论拍板 1+2+3〕/ 资产库通道统一 + 悬停预览 / 预览上翻 + Enter·Shift+Enter 快捷键脚注）；QA 验收用例 = acceptance-test-cases §二十八 Y 组（Y-1~Y-13 + 已知限制勿提单清单）。**验证**：`yarn check` 全量 ✓（typecheck+build+verify:loader+test:smoke 0 失败；dev 提交 `93e0032b51`→`5a44262875` 五连）
- **涉及文件**：`src/lobby-spec.ts`(新) / `src/client/{LobbyPopover,LobbySpecRow,LobbyStashBar,LobbyHero,StudioFrame,AssetLibrary,contracts,project-store,index,styles,ModeSwitch}` / `src/brand.ts` / `tests/{lobby-spec,lobby-claim,lobby-stash,visual-tokens,host-boundary,studio-defaults}.test.mjs` / `docs/{STATUS,canvas-ux-backlog,tracking}.md`
- **落地/验收**：2026-10-06 落地


#### CV-279 · REQ-021 应用内一键测试模式（「代驾」回归）落地 + 三轮真机跑批修复总账 + 验收收口

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-021 应用内一键测试模式（「代驾」回归）落地 + 三轮真机跑批修复总账 + 验收收口**。**交付**（2026-10-05 D1/D2/D3 落地，铁律期间 STATUS 不登记，本行为收口补登）：场景执行器（`runAutoTestScenario`：放手跑直建项目 → 逐条发送 → `waitAgentTurn` 唯一回合空闲判据 → 持久化快照机器断言 → `test-report.md` 覆盖写）+ 12 条检查点断言库（反向变异可红）+ 浮窗（AutoTestPanel + testMode 开关，拍板④）+ 测试项目清理出口 + `test-driver` 抽离（src/ 根，node:test 直连）。**三轮真机跑批（用户执行，存储根 newOut1）**：R001（10-05）假超时取证 → R002（10-06 晨）断言库/数据前提四红取证 → R003（10-06 午）21/23。**修复总账（BUG-014~022 共 9 条，见 bug-tracker）**：014 执行器假超时（S1：deadline 让位空闲判定）/ 015 Qwen 正则小写 i / 016 videos-active 认 composite / 017 取代后 active 口径 / 018 supersede-chain 源句柄豁免 / 019 `routeModel` 结构化路由字段（跨后端 filename 形态不一的根因）/ 020 画布废弃节点默认隐藏（用户拍板方案 a：隐藏不删除）/ 021 compose 音轨文案对齐 / 022 refaudio 派生一致（首段 instruct 定调 + 后续克隆首段产物）。**配套**：浮窗执行日志落盘（排障不再依赖会话转录）/ 存储目录可见化（storage-info 只读路由 + 诊断区信息块）/ draft 清扫窗收窄 7 天 + activeDraft 恒豁免。**验证**：R003 真实 canvas 离线回放 **23/23 全绿**；验收七条 ③④⑦ 机器证据（全链报告落盘 / 改写链断言通过且 10 条取代全正确 / projects.json 仅新增测试项目）+ ①②⑤⑥ 用户确认（2026-10-06）；R004 终验跑批进行中
- **涉及文件**：`src/client/{index,AutoTestPanel,SettingsModal,api,project-store}.ts` / `src/{test-driver,auto-test-checkpoints,auto-test-scenarios,auto-test-report,storage-info,shot-versions,projects,generate,routes,host-tools}.ts` / `src/contracts/canvas.ts` / `tsconfig.client.json` / `tests/{test-driver,auto-test-checkpoints,auto-test-report,storage-info-route,projects-dir,lobby-claim}.test.mjs` / `docs/{bug-tracker,requirement-tracker}.md`
- **落地/验收**：2026-10-05 落地 / 2026-10-06 验收收口


#### CV-272 · 右键「修改提示词」与工具条「改提示词」统一开就地浮层（用户截图反馈：两个红框入口应打开同样的页面，以工具条的「改提示…

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P2
- **问题**：**右键「修改提示词」与工具条「改提示词」统一开就地浮层**（用户截图反馈：两个红框入口应打开同样的页面，以工具条的「改提示词」为准）。此前右键走 `onEditPrompt → selectNode + setDetailNodeId`（**详情抽屉**），工具条走 CanvasSurface 内部 `setPromptEditNodeId`（**CV-266 就地浮层**）—— 同名不同页。**修法**：浮层 id 提升为宿主受控状态 —— StudioFrame 新增 `promptEditNodeId` state，经 `promptEditNodeId` / `onPromptEditNodeIdChange` 传给 CanvasSurface（受控 / 非受控两用：宿主未接时回落内部 state，既有测试与预览台直接挂画布的用法不变）；右键菜单改 `setPromptEditNodeId(id)`（不再 setDetailNodeId），与工具条同一面板。既有接线守卫（canvas-prompt-edit 的源码字符串断言：互斥表达式 / 按 id 查活节点 / 选中移走关闭 / 工具条内联接线）全部原样保留，+1 条新守卫钉住「菜单 onEditPrompt 必须 setPromptEditNodeId + 宿主必须接受控 props + 非受控回落存在」。顺带：工具条按钮 title「打开详情并编辑提示词」→「打开就地提示词编辑面板」（行为早已不是开详情）；detailOpen 注释的三入口改两入口
- **涉及文件**：src/client/canvas/CanvasSurface.tsx（props 受控化）/ src/client/StudioFrame.tsx（state + 菜单接线 + 注释）/ src/client/canvas/CanvasContextMenu.tsx（注释）/ src/client/canvas/NodeActionBar.tsx（title）/ tests/canvas-prompt-edit.test.mjs（+1）


#### CV-271 · `tts_voiceover` 占位升真——语音合成（后端 0.8.0 `txt2speech` / VoxCPM2…

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P1
- **问题**：**`tts_voiceover` 占位升真——语音合成（后端 0.8.0 `txt2speech` / VoxCPM2 / `tts_cpm.json`）**。用户看 0.8.0 文档拍板接入：占位工具存在的意义就是「能力开放后转真」，上游 skill 无需改动即从「降级指引」升级为真实配音。**独立生产函数 `generateSpeech`**（与 generateMusic 同型的旁路音频路径：同步端点、音频节点落盘、ffprobe 实测时长、recordAssetHistory、retryOf 原地重写）；**探针先行**（[api-probe/txt2speech-20260930](./api-probe/txt2speech-20260930/report.md)：声音设计直打 200 / 14.4s，**产物实测 mp3（文档写 flac，以实测为准）**，响应 duration=14.34 vs ffprobe 真值 5.16 —— 服务端耗时口径再证；422 字段级快失败）；**无时长参数** —— 时长由文本长度决定（约 4 字/秒），探测失败不伪造（duration 0 / 节点无角标）；**不引入重试自愈**（txt2audio 偶发 500 在 txt2speech 无同型证据，不造没有依据的机制）；`instructPrompt` 声音设计七维（30 语种 + 9 中文方言，自然语言）+ `refaudio` 克隆（上传句柄纪律；**未实测**，描述标明）；**登记全表**：param-guard（`refaudio` 句柄 / `instructPrompt` prose）/ FORMAL_TOOLS（与 music_generation 同为产出音频的正式动作）/ REPLAYABLE_TOOLS + PROMPT_FIELDS（txt_prompt + instruct_prompt 蛇形双框）/ STUDIO_TOOL_KINDS('audio') / tool-presentation（B 占位位 → A 展示位「生成配音」+ ASSET_HISTORY + SUMMARIZER）/ CanvasNode 加载文案 / skill-catalog；**新建独立技能 `voiceover-writing`**（SKILL.md + references/voice-design.md：七维写法 / 30+9 清单 / 示例库 / 常见坑）；占位工具 2→1（placeholder-tools 只剩 subtitle_burn）；⚠️ **配音节点不能当 bgmNodeId**（compose 只挂 BGM），进成片走 audioRefs（先 cut_audio 裁 ≤15s）；工具计数：真实 24→25、占位 2→1、总数 26 不变
- **涉及文件**：src/generate.ts（SpeechParams/SpeechResult/generateSpeech/replayDetachedAsset 分支/委派入口）/ src/host-tools.ts（真实工具定义 + speechResultSchema + SpeechSchemaCoverage 守卫 + renderSpeechResult）/ src/skills/placeholder-tools.ts（删 tts_voiceover）/ src/{config,approval-gate,node-params,asset-capture,tool-presentation,param-guard,skill-catalog}.ts / src/client/canvas/CanvasNode.tsx / skills/voiceover-writing/（新）/ skills/canvas-studio-creation/references/{toolchain,style-presets}.md / tests/tool-presentation.test.mjs / docs/{api,canvas-studio-tools}.md


#### CV-270 · `txt2image_withtxt` 文字渲染新工具 + api.md 对拍 0.8.0（批 C 收口）

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P1
- **问题**：**`txt2image_withtxt` 文字渲染新工具 + api.md 对拍 0.8.0（批 C 收口）**。后端 0.8.0 新增 `POST /api/v1/generate/txt2image_withtxt`（Qwen Image 2.1，steps=25）：**中文海报 / 文字渲染特化**。**独立工具 `image_generate_withtxt`**（不做成 image_generate 的参数，与 0.7.0 拆分同口径「选工具 = 选模式」）：描述写清判据——「画面里有**要读的文字**（片名/海报字/标语）→ 本工具；普通无字图 → image_generate（Krea2 steps=8 更快）；要参考图 → image_generate（本工具**纯文生**无参考槽位）；已出图文错了 → image_fix」；**不接 CV-212 自动修复**（Krea2 写错引号字的前提对 Qwen 不成立）。**探针先行**（[api-probe/txt2image-withtxt-20260930](./api-probe/txt2image-withtxt-20260930/report.md)：中文海报直打 200 / 20.7s，《剑归江湖》四字**无错字**、竖排右侧/白衣剑客/水墨风全符合；422 字段级快失败 0.018s；实测耗时≈文档示例 2.4 倍仍远低于 image 档 180s；产物 `Qwen_image_2.1_*` 前缀、尾缀不定式）。**api.md 0.3.1 → 0.4.0 对拍后端 0.8.0**：收录 withtxt 端点节 / `txt2imageanime`·`image2promptenhance` 标「已下线」保留历史节（与 uploadimage 先例一致）/ txt2audio 节从 ACE Step 口径改写 Yue2（四软参数=兼容字段不消费，修复 CV-268 把引用块塞进参数表的格式破损）/ 错误码补 404·409·422·504 / **新增「端点 ↔ 工具占用映射表」**（全部 18 个后端端点的占用关系一表收口，含 txt2speech 未接入标注）。**登记全表**：config 端点 / generate.ts 分支（纯文生）+ generationLabelOf（「文字生图」）+ operationTypeOf（shotBound ? text-to-image : look）/ node-params（REPLAYABLE + PROMPT_FIELDS；REFERENCE_SLOTS 刻意不进——无参考图）/ approval-gate PRODUCING_TOOLS + shotBound 草稿拦截 / asset-capture('image') / tool-presentation 三表（A 档「生成文字图」）/ CanvasNode 加载文案 / param-guard（新参数名全已归类，零改动）；工具计数 23→24 真实（总数 26 = 24+2 恢复为真）。**顺带清淤**：toolchain 的 negativePrompt 滞留 / music「ACE Step」口径残留 / style-presets「当前无音乐生成工具」上古残留
- **涉及文件**：src/config.ts / src/generate.ts / src/host-tools.ts / src/{node-params,approval-gate,asset-capture,tool-presentation}.ts / src/client/canvas/CanvasNode.tsx / docs/api.md（0.4.0）/ docs/canvas-studio-tools.md（A1b 节）/ docs/api-probe/txt2image-withtxt-20260930/（新）/ skills/canvas-studio-creation/references/toolchain.md / tests/tool-presentation.test.mjs


#### CV-269 · 后端 0.7.0 对拍 · 生视频工具拆分

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P0
- **问题**：**后端 0.7.0 对拍 · 生视频工具拆分**。保持两个工具名、**重定义参数面**——拆分轴 = 后端通道：① **`video_generate` = 首尾帧通道**（恒 `image2videofl2va`）：无图 T2VA / 仅 `filename` I2VA / **`filename`+`filenameTail`（新参数）FL2VA 首尾帧书挡**（fl2va 端点原生 image1+image2 两图片位，尾帧位从 composite 的「2 张图」语义里拆出来归位）；**删 `audioRefs`/`videoRefs` 参数**（音视频参考不是这个通道的职责）；IR 预检模式**由工具身份固定**（无图 T2VA / 单首帧 I2VA / 两帧 FL2VA），`irMode` args 兼容移除；② **`video_composite` = 多参考通道**（恒 `image2videoref2va`）：`filenames` 1~9 张恒为 `<Picture N>` 参考位，保留 `audioRefs`/`videoRefs`；IR 预检恒 Ref2VA（数量推断退役）；③ **重放零迁移**：`GenerateParams.channel` 为**内部字段**（工具 execute 显式带；节点重放不带 ⇒ 仍走 `capabilityOf` 参数推断 —— 2 图旧 composite 重放依旧走首尾帧插值，`contracts/canvas.ts` 一行不动）；`effectiveCapabilityOf` 显式通道优先，显式通道下不再广播「带参考改写帧模式」提示（契约本就如此）；④ 教学口径全量切换「**选工具 = 选模式**」：h3-prompt-writing / toolchain / shot-format（bridge 书挡改走 video_generate）/ video-chain.md 决策表 / canvas-studio-tools.md §A8/§A9 / node-params 槽位表注释；接线守卫改新契约（canvas-arrange 的 videoRefs 声明数 2→1、h3-ir-precheck 的 CV-156 断言改为「工具描述不许再引用 COUNT_MODE_HINT」）；param-guard `filenameTail` 入句柄类
- **涉及文件**：src/generate.ts / src/host-tools.ts / src/providers/capability.ts（未动，注释对齐）/ src/param-guard.ts / src/node-params.ts / skills/{h3-prompt-writing,canvas-studio-creation}/（toolchain / shot-format）/ tests/{canvas-arrange,h3-ir-precheck}.test.mjs / docs/{video-chain,canvas-studio-tools}.md


#### CV-268 · 后端 0.7.0 对拍 · 退役与去伪

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P1
- **问题**：**后端 0.7.0 对拍 · 退役与去伪**。对照后台最新 API 0.7.0（2026-09-30）删掉三处过时面：① **`prompt_enhance` 工具退役** —— `image2promptenhance` 不在 0.7.0 端点总览，工具定义 / `enhancePrompt` / `promptEnhance` 端点 / 展示表项 / 技能分册引用全部移除；REQ-003 Step 4（AI 改写）改走本地会话模型（DSH 本身是 LLM，不需要后端端点）；② **`txt2imageanime` 端点 + `style` 参数退役** —— 0.7.0 端点总览无此端点；`image_generate` 删 `style`（anime 分支 / `Z-Anime_*` 路由全清），动漫画风**写进 prompt**（同一 Krea2 Turbo 模型，表达力不变；技能 5 处同步：krea2-turbo-writing / z-image-prompt-writing / style-presets / look / toolchain / prompt-writing / oriental-mythic）；③ **music_generation 四个软参数退役** —— 0.7.0 明文 Yue2 工作流**不消费** `bpm`/`keyscale`/`language`/`timesignature`（请求模型里的兼容字段）：工具 schema 删参、请求体只发 `caption_prompt`/`lyrics_prompt`/`duration` 三个真实生效参数，`planMusicRetry` 的「快失败摘字段」降级机制与 `degradedFields` 回显随之退役（偶发 500 保留**同参数**有界重试 ≤3），输出 schema 与规格行去 `bpm`；`music-prompt-writing` skill 与两分册改写（音乐特征写进 Caption）。**顺带收口**：`tests/param-guard.test.mjs` 的基线红（CV-264 删 `irMode` 时分类表忘同步）随本轮分类表对账**转绿** —— 全量红从 6 → 5
- **涉及文件**：src/config.ts / src/generate.ts / src/host-tools.ts / src/tool-presentation.ts / src/param-guard.ts / src/client/canvas/NodeDetailDrawer.tsx / skills/{krea2-turbo-writing,z-image-prompt-writing,music-prompt-writing,canvas-studio-creation,oriental-mythic-visual-director} / tests/{music-generation,music-prompt-writing,node-replay,generate-queue,skill,tool-presentation}.test.mjs / docs/canvas-studio-tools.md


#### CV-267 · REQ-003 Step 3：长内容分档 + 贴边放置 + 精确调整与一致性（D/E/F 组）

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P1
- **问题**：**REQ-003 Step 3：长内容分档 + 贴边放置 + 精确调整与一致性（D/E/F 组）**。① **D 组**：新 `src/prompt-shape.ts` —— 形态**由内容算**（≤8 行且 ≤240 字 = short；命中 IR 段名行 `/^[a-z_]+:\s*$/m` 或含 `<Picture N>` = ir；否则 long），PromptEditor 只读档按形态分流：long ⇒ 读数「N 行 / M 字」+ 前 3 行预览 + 「展开编辑」（就地档不硬撑全文）、ir ⇒ **段名常显、段体折叠**，点段名只展开要改的那段（按行号 splice 回原文，未触碰段**逐字节**原样）；展开档高度夹进 `min(56vh, 520px)` + 上下渐隐（mask），就地档自增高上限 40vh→260px，展开页脚补「聚焦编辑」入口（D4 整篇重写仍走既有 1040×640 双栏，不新造第四档）；② **E 组**：`canvas-view.ts` 新增 `editorPlacement()` 求解器（与 `nodeActionAnchor` 同族：同坐标系 / 边距常量 / 换算式）—— 四侧择优 `right→left→below→above`（左右纵向夹进安全区后**恒不遮挡节点**）、8px 边距 + `bottomInset` 让位、四侧都放不下 ⇒ 按节点左右半算**最小平移**（只迭代一次、有界不把节点推出视口、`<4px` 归零、**不改缩放**）、窄窗 `<720px` ⇒ `mode='sheet'` 底部抽屉（只垂直抬节点且不抬出视口顶）；浮层按序列化 pan 上报，CanvasSurface 经手势状态机守卫施加（`gesture.mode !== 'none'` 立即放弃，E4）；打开时快照 view、头部「恢复视野」手动回位、**关闭不回弹**（E5）；节点滚出视野不渲染（E7）；③ **F 组**：新 `src/prompt-refs.ts`（`pictureNumbersIn` / `pictureIssues` / `rewritePictureNumbers`：按出现顺序致密化 1..k、越界夹 k 并返回被夹**处数**）⇒ 参考位改动与 `<Picture N>` 失配时浮层出 **amber 条**（同步编号 / 撤销这次改动，不阻断生成），动作执行后转**中性回执**（撤销入口不随警告消失，F8）；`ReferenceSlotEditor` 加 **F1** 选中参考出参数行（role / 强度读写节点既有 `referenceRole` / `referenceStrength`，断链或资产库句柄说明不可调）+ **F4** 超 6 张单行横滚 + 「共 N 张」；新 `src/editor-drafts.ts` 内存草稿表（F5：Esc / × 关闭保留 + 重开回填 + 「未保存 · 已改 N 处」徽标，显式「取消」才丢弃，保存成功清除，切项目整体清空）；**F6** 键盘：`Esc` 关闭（保草稿）、`Cmd/Ctrl+Enter` = 保存并重试（正文内触发经 `onCmdEnter` 交浮层并拦冒泡，焦点不在正文由面板根接管）。**测试**：新增 `tests/prompt-shape.test.mjs`（5）/ `tests/picture-refs.test.mjs`（5）/ `tests/editor-placement.test.mjs`（6，含 位置×缩放×窄窗 全组合「面板 ⊆ 安全区 且 ∩ 节点 = ∅」矩阵）/ `tests/editor-draft.test.mjs`（3）/ 接线守卫扩 6（canvas-prompt-edit +4、reference-slot-wiring +2）
- **涉及文件**：src/prompt-shape.ts(新) / src/prompt-refs.ts(新) / src/editor-drafts.ts(新) / src/canvas-view.ts / src/client/canvas/{NodePromptEditor,PromptEditor,ReferenceSlotEditor,CanvasSurface}.tsx / src/client/StudioFrame.tsx / src/client/styles.ts / tests/{prompt-shape,picture-refs,editor-placement,editor-draft,canvas-prompt-edit,reference-slot-wiring}.test.mjs


#### CV-266 · REQ-003 Step 2：就地编辑 + 改完即重试（B/C 组）

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P1
- **问题**：**REQ-003 Step 2：就地编辑 + 改完即重试（B/C 组）**。①「改提示词」从"开详情抽屉"升级为**画布就地浮层**（B1）：新 `src/client/canvas/NodePromptEditor.tsx` 渲染在 `.csCanvasLayer` 之外的屏幕层（textarea 画在层内会跟着 scale 变形，没法打字），贴节点右侧 + 视口安全区夹取（8px 边距 + 抽屉让位；**四侧择优与最小平移是 Step 3 的 editorPlacement，不预支** —— 节点贴右缘时浮层会压住节点，是已知已登记的 Step 3 待办），节点滚出视野即退场、选中移走 / 节点被删即关闭；② 提示词与参考图**同屏**（B3）：浮层内复用既有三档 `PromptEditor`（`autoEdit` 挂载即进就地档并聚焦正文，可立刻打字；三档语义与 `onCommit` 契约不变，外层经 forwardRef 句柄驱动**同一条** commit，不另开写回口径）+ Step 1 的 `ReferenceSlotEditor`（增删换重排 + 位次读数；候选池用宿主透传的**全量**节点 `allNodes`，与详情抽屉同一份）；③ **保存并重试**（C1/C4）：显式按钮 —— 先 `commitAll()` 落字段（多字段节点连续提交用 `rawRef` 链式跟上，防第二笔用旧 JSON 覆盖第一笔）再 `onRetry`（`retryNode` 从 store 现读参数，同一次事件先写后读安全），判据唯一走 `isReplayable`（与 NodeActionBar 同款表达式，不可重放的节点不出现该按钮），**不是**失焦自动重跑；「仅保存」= 落字段 + 关浮层，不出图（B2 红线：编辑只写字段、不发生成请求，onCommit 路径上无重试）；④ 同一时刻只留一个操作面：浮层打开时 `NodeActionBar` 退场（方案 §7 风险表）。浮层手势守卫与 NodeActionBar 三件套同款（pointerdown / 双击 / 右键 stopPropagation）。**测试**：新增 `tests/canvas-prompt-edit.test.mjs` 5 例接线守卫（浮层挂载与工具条互斥 / onCommit 路径无 onRetry / 先写后重试且判据唯一 / 参考区复用与依赖透传且宿主不再传 onEditPrompt / PromptEditor 三档不 fork）；`--cs-shadow-3` 被浮层接上引用，按 DD-01 棘轮移出 DEAD_TOKEN_BASELINE（余 3 项）
- **涉及文件**：src/client/canvas/NodePromptEditor.tsx(新) / src/client/canvas/PromptEditor.tsx / src/client/canvas/CanvasSurface.tsx / src/client/canvas/NodeActionBar.tsx / src/client/StudioFrame.tsx / src/client/styles.ts / tests/canvas-prompt-edit.test.mjs(新) / tests/visual-tokens.test.mjs


#### CV-265 · REQ-003 Step 1：参考图可编辑（A 组）

- **状态**：已完成（桌面验收通过 2026-10-01）
- **优先级**：P0
- **问题**：**REQ-003 Step 1：参考图可编辑（A 组）**。① **槽位表** `src/node-params.ts` 的 `REFERENCE_SLOTS` = 唯一事实源（image_generate 的 `filename`/`filenames` **二选一** ≤4；video_composite 的 `filenames` ≤9 且**顺序即位次**；video_generate 可选单槽可清空；image_fix / character_generate / character_sheet 必填单槽**只换不空**）+ 三个纯函数：`referenceSlotOf`（不在表里的工具不出编辑区）、`referenceNamesOf`（读路径对历史键 `styleFilename` 宽容、坏数据返回空）、`withReferenceNames`（归一化写回：1 张写 `filename`、多张写 `filenames`、必填槽拒绝清空、超限与不可解析**一律 null 拒绝写入**、历史键一律删掉、其余重放键原样保留）+ 位次读数 `referenceModeLabel`；② **把 `resolveRefFilenames` 抽到新 `src/reference-resolve.ts`**（纯搬家）—— `routes.ts` 不 import `host-tools.ts`（会把整个工具层连 DSH 依赖拖进路由模块），抽出后工具侧与路由侧共用**同一份**实现；③ **新端点 `POST /canvas-studio/resolve-refs`**（契约 `src/contracts/reference.ts`）：画布节点 id / `lib:<id>` → **可下发的** Drama 句柄，**逐项 try/catch**（一次选 5 张坏 1 张只坏那一张），解析链顺带回写源节点 filename（于是缩略图反查随后能命中）；④ **UI**：新 `src/client/canvas/ReferenceSlotEditor.tsx` 挂进详情抽屉 —— 增 / 删 / 换 / 重排 + `Picture N` 位次徽标 + 模式读数 + 断链占位保留（CV-242 语义不回退）+ 必填单槽禁用删除并说明原因 + 选择器来源 = 画布节点 ∪ 全局资产库 + 解析失败逐项展示；不在槽位表里的工具（分析类等）保留原只读展示；⑤ client `resolveStudioRefs()` + StudioFrame 接线。**测试**：新增 `tests/reference-slot.test.mjs`（10 例：槽位表覆盖与语义 / 读路径历史键与坏数据 / 写路径归一化与三类拒绝 / 读写往返闭环）、`tests/resolve-refs-route.test.mjs`（5 例：成功项 / 逐项失败 / 文案不含路径等开发者细节 / 入参守卫 / 405·403）
- **涉及文件**：src/node-params.ts / src/reference-resolve.ts(新) / src/contracts/reference.ts(新) / src/routes.ts / src/host-tools.ts / src/client/api.ts / src/client/canvas/ReferenceSlotEditor.tsx(新) / src/client/canvas/NodeDetailDrawer.tsx / src/client/StudioFrame.tsx / src/client/styles.ts / tests/{reference-slot,resolve-refs-route}.test.mjs(新)


#### CV-264 · CV-263 验收反馈两连修：① `CS-H3IR-005` 失败类根治 —— 删 `video_generate`…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**CV-263 验收反馈两连修**：① `CS-H3IR-005` 失败类根治 —— 删 `video_generate`/`video_composite` parameters 里的 `irMode` 显式声明参数（「写 IR 时建议声明」的引导会让模型对多参考图直觉申报 Ref2VA，与按素材数量的端点路由必然相撞）；模式推断是唯一事实源，位次写错仍被 `CS-H3IR-001` 硬拦，args 兼容保留 `irMode→declaredMode` 透传（旧调用方仍触发 005 对账）；`docs/{canvas-studio-tools,video-chain}.md` 同步。② 对话流工具行展开能力泛化 —— A/B 档 error/stopped 态整行可点开读**完整错误**（键盘可达 role=button；验收反馈：H3-IR 报错首行截成 `(mod…` 读不到全文）。③ 项目列表口径定稿（2026-09-30 二轮拍板：先试 createdAt 后改走「最后修改」）：排序/行内时间**保持 `updatedAt`**，但删掉 REQ-005/T4 的「打开即 touch」整条链路（Host touch 路由 + registry.touchProject 方法 + client api/store/openProject 三段接线）—— 纯浏览不再把项目顶到第一；`writeCanvas`（画布保存 / 生成结算唯一落盘口）新增尽力而为的 `touchUpdatedAt`（draft 无记录静默跳过）——「改画布 / 生成产物」才算最后修改；`projects-touch.test.mjs` 重写为新语义守卫（bump 生效 + draft 静默 + touch 三段接线不许复活）
- **涉及文件**：src/host-tools.ts（irMode 参数删除×2）/ src/client/{ToolCallRow,styles,api,project-store,index}.ts / src/{project-sections,project-row,projects,routes}.ts / tests/{projects-touch(重写),project-sections,project-row}.test.mjs / docs/{canvas-studio-tools,video-chain}.md


#### CV-263 · REQ-008 对话流中文 tool 显示与降噪（三档行 keyed 接管）

- **状态**：已完成（桌面验收通过）
- **优先级**：P0
- **问题**：**REQ-008 对话流中文 tool 显示与降噪（三档行 keyed 接管）**。新 `src/tool-presentation.ts` 唯一口径（A 展示级 13 / B 流程级 13 含 2 占位与 5 历史别名 / C 内部级 16；`cordis_define`·`todo_write` 排除）；新 `src/client/ToolCallRow.tsx` 三档行（running 扫光 / ok 勾+耗时 / error 红字错误首行永不降级 / stopped 中性「已取消」；C 档手写受控展开参数+结果+`openFile`）；`client/index.ts` 对 `tool.call.toolview`（keyed）逐 key **priority -1** 注册全表（上游 12 键全在默认 0，升序最小者胜出 ⇒ 安全接管且不触发同键同优先级抛错；源码实证 ui-slots:805-811/862-868）；`asset-history.ts` 的 `labelOfTool` 薄转出（消灭双口径）；`host-boundary` 槽必需项表登记 `tool.call.toolview`。方案 [plans/REQ-008-对话流中文tool显示与降噪方案.md](./plans/REQ-008-对话流中文tool显示与降噪方案.md)（v1.1，评审修订：上游 keyed 全量实证 / 档位重排 A13B13 / 历史别名参与注册 / 四态）
- **涉及文件**：src/tool-presentation.ts(新) / src/client/ToolCallRow.tsx(新) / src/client/{index,styles}.ts / src/asset-history.ts / package.json(devDep ui-tool) / tsconfig.client.json / tests/{tool-presentation(新),host-boundary}.test.mjs / docs/plans/REQ-008-*（v1.1 + mockup）


#### CV-262 · REQ-005 v1.4 第二轮收尾：对话卡右缘「幽灵滚动条」+ 规格条真机折行宽度账重算

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-005 v1.4 第二轮收尾：对话卡右缘「幽灵滚动条」+ 规格条真机折行宽度账重算**。① 右缘那条竖线有**两条来路**——`scrollbar-gutter: stable` 的预留油槽，与 hero 态**真溢出**（内容超出盒高、有滑块能拖）；上一版只收了前者，真机截图证明线还在（那条是后者）⇒ 这次两条一起收，覆盖点用稳定钩子 `data-conversation-scroll`，**只收 hero / settling 两态的滚动条 chrome，不动 `overflow`、不碰 active 态**。② 规格条三组被真机折到第二行：芯片 `min-width` 52→30（52 量的是**内容盒** ⇒ 每枚实占 52+16+2=70px）、去掉组自带的 12px 右内边距（分隔线改画在组间距正中）、组间距 13→12、托底条内边距 11→10 ⇒ 需 **669** / 可用 **726**（余 57px），`flex-wrap: nowrap` 钉住「三组永远一行」。已知副作用（有意为之，勿当 bug 修）：同 dock 族的 `.csUploadBar` 仍按 `clearance + 16` 缩进，两者宽度差 32px，对齐优先给首页常驻的规格行
- **涉及文件**：src/client/styles.ts / tests/visual-tokens.test.mjs


#### CV-261 · REQ-005 v1.4：首页四类素材「暂存」链路（拖入 / 选择 → 发送前只展示不上传 → 认领为项目后落画布）

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-005 v1.4：首页四类素材「暂存」链路**（拖入 / 选择 → 发送前只展示不上传 → 认领为项目后落画布）。新 `src/client/lobby-stash.ts`（文件侧：登记 + 四类 `MEDIA_UPLOAD_LIMITS` **在拖入那一刻就判掉**（落盘失败时首页暂存条已卸载、失败提示没有出口）+ `File` 句柄留在模块级表、store 只存展示事实）+ 新 `src/client/LobbyStashBar.tsx`（挂 `conversation.input.dock`、排在规格行**之后**、空条目不占位）+ `LobbyHero` 增「添加素材」入口（宿主 composer 附件按钮只认图片）+ `StudioFrame` 把拖放与文件选择器汇到**同一份**登记 + 落地链路「先等画布落到本地真相 → 再落素材 → 再放行」并把 `@ref` 追加进正文。**为什么要有「暂存」这一态**：首页 `selectedProjectId === null`，而 `/canvas-studio/upload*` 三兄弟全要求 projectId ⇒ 首页的文件没有落盘目标，只能先停在内存
- **涉及文件**：src/client/lobby-stash.ts(新) / src/client/LobbyStashBar.tsx(新) / src/client/{LobbyHero,StudioFrame,index,project-store,contracts,styles}.ts(x) / tests/lobby-stash.test.mjs(新) / tests/media-drop.test.mjs


#### CV-260 · REQ-005 v1.4：draft 落点「清扫豁免当月」+ 首个落点强制重绑

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-005 v1.4：draft 落点「清扫豁免当月」+ 首个落点强制重绑**。① 启动清扫把**当月**首页落点当垃圾删掉 ⇒ 首页掉回 inert 冷启动态；`sweepUnclaimedDraftDirs` 现对当月 `projects/.draft-<yyyyMM>`（含 `-2/-3` 顺延名）一律不回收，跨月空残留与「已认领 / 非空」两条原判据不动。② 宿主把会话踢出 workspace membership 后 cwd 只剩空串、首页卡在「选择一个工作区开始」，此时重建目录也救不回来 ⇒ 新增 `landedThisRun`：本次运行**首个**落点不看幂等短路，一定重跑 `workspace.create + startSession`（两者本身幂等，代价≈0；会话因此回到 membership），此后订阅重复触发仍走原短路
- **涉及文件**：src/projects.ts / src/client/index.ts / tests/{projects-dir,lobby-claim}.test.mjs


#### CV-259 · REQ-005 v1.3 真机确认项③应验：hero 态第三枚下拉（模型座椅）被通用隐藏吃掉 ⇒ 按槽锚点白名单放回

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-005 v1.3 真机确认项③应验：hero 态第三枚下拉（模型座椅）被通用隐藏吃掉 ⇒ 按槽锚点白名单放回**。隐藏宿主两下拉的选择器 `[data-phase="hero"] button[aria-haspopup="menu"]` 同时命中了**产品要保留**的 `conversation.input.model` 模型座椅（`InputBar` 的 renderSlot / `ModelSelect` 的 trigger），现象是「首页 hero 态没有模型选择」；修法 = 按稳定槽锚 `[data-slot="conversation.input.model"]` 白名单放回，`display` 显式写成上游 `.trigger` 的值（`flex !important`，特异度 (0,4,1) > 通用条 (0,3,1)；用 `revert`/`unset` 会退回 UA 的 inline-block，把 chip 的 gap 与垂直居中打散）
- **涉及文件**：src/client/styles.ts / tests/visual-tokens.test.mjs


#### CV-257 · REQ-005 v1.3 首页形态修复（变体 A：draft 落点 + 发送拦截认领） —— CV-256 真机验收…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-005 v1.3 首页形态修复（变体 A：draft 落点 + 发送拦截认领）** —— CV-256 真机验收 A1 不达标 + 遮罩卡死。首页回宿主对话卡（撤 `.csChat` CSS 隐藏、删 LobbyComposer）；`ensureDraftLanding` 幂等绑 draft 目录（`projects/.draft-<yyyyMM>`，`ensureDraftDir` 顺延已认领）+ blank 会话；发送拦截认领（DivertConversation lobby 分支：`createClaimingDir` 认领 draft 目录为项目 → select → divertSend 放行，失败 `{kind:'error'}` 保草稿，双窗口撞认领强制重建落点）；规格行 `LobbySpecRow` 挂 `conversation.input.dock`（分组砍掉、`lobbySpec` 进 store）；隐藏宿主 hero 态两下拉（`[data-phase="hero"] button[aria-haspopup="menu"]`）；画布 drop 补合成 `dragend` 修遮罩卡死 + 首页放行冒泡。方案 v1.3 §13
- **涉及文件**：src/{projects,routes}.ts / src/client/{index,api,LobbySpecRow(新),project-store,StudioFrame,ProjectSpecChips,contracts,styles}.ts(x) / tests/{lobby-claim(新),library-route,projects-touch,studio-defaults,visual-tokens,media-upload-wiring}.test.mjs / 删 src/client/LobbyComposer.tsx


#### CV-256 · REQ-005+ 首页对话式创建（合并新建项目弹窗）与项目排序

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**REQ-005+ 首页对话式创建（合并新建项目弹窗）与项目排序**。首页 = 唯一新建入口：输入创意回车 → 摘要自动命名 → 建项目 → 切入 → 就绪等待后自动发首条消息（失败二分降级：toast + 文本注入对话输入框，项目不回滚）；规格（画幅/时长/模式/分组）常驻 chips；旧弹窗彻底删除（D4）；左栏/分组头「+」改跳首页并预选分组；品牌区回首页 `goHome` + `homePinned` 短路 `syncActiveProject`（否则被 workspace→项目映射踢回）；列表按 `updatedAt` 倒序（`resolveVisibleSections` 唯一收口）+ 打开项目 `touch` 写回 + `moveProjectToGroup` 补写。**v1.3（CV-257）已按真机验收反馈重构首页形态**。方案 [plans/REQ-005-首页对话式创建与项目排序方案.md](./plans/REQ-005-首页对话式创建与项目排序方案.md)（v1.1）；执行提示词 [archive/plans/REQ-005-开发执行提示词.md](archive/plans/REQ-005-开发执行提示词.md)
- **涉及文件**：src/client/{LobbyComposer,ProjectSpecChips}.tsx(新) / src/project-naming.ts(新) / src/client/{StudioFrame,ProjectList,LobbyHero,index,project-store,styles,contracts,api}.ts(x) / src/{project-sections,projects,routes,brand-copy}.ts / tests/{project-naming,project-sections,projects-touch}.test.mjs


#### CV-255 · REQ-001 全局资产库（角色/场景/物件/群像 + `@ref[lib:…]` 引用）：三步全部落地，2026-…

- **状态**：已完成
- **优先级**：P0
- **问题**：**REQ-001 全局资产库（角色/场景/物件/群像 + `@ref[lib:…]` 引用）：三步全部落地，2026-09-29 桌面验收通过**（Step 2「Client 资产库页」以 28b058605e「Client UI + 上传媒体通道 + 库 GC」+ 539f1218de「图片显示适配」落地：`AssetLibrary.tsx` 四分类 overlay + 排序/搜索/上传 + 画布右键「加入资产库」入口接线 `StudioFrame`；Step 1「Host 资产服务」+ Step 3「引用链路」此前已全量验证）。方案 [plans/REQ-001-全局资产库需求方案.md](./plans/REQ-001-全局资产库需求方案.md)（v1.1），执行序 Step 1 → 3 → 2。**Step 1**：新 `AssetLibrary`（registryRoot 下 `assets-library.json` + `library/`；写入 = `commit()` 磁盘∪内存合流 + 200 条删除墓碑，`readDocument` 保留 `deleted`）+ `materializeLibraryMedia`（确定性名 `lib-<assetId>-<file>`）+ `/canvas-studio/library` 全端点（列表过滤 / CRUD / 锚点入库 201 / 媒体 / 403 守卫 / 路径穿越拒绝 / 405）+ 错误码 **CS-LIB-001 不存在 / 002 重名（大小写不敏感）/ 003 源或媒体缺失** + client 侧 `libraryAssets` store 字段与 6 个 API。**Step 3**：`lib:` 分支插在 `findNodeByRef` **之前**（`resolveRefFilenames` 主 / `resolveRefValue` 裸值 / `resolveCutAudioSource` / `resolveAnchorNodeId` 找不到回 null），解析走三段式 `library.require → materializeLibraryMedia → promoteAssetFile` + fire-and-forget `recordUsage`；`list_references` 新增 `library` 数组与 render 段（`- [分类] 名 … id=lib:<id>`）；system prompt 小节 `canvas-studio:asset-library`（order **152**、上限 200 条、`{{`→`｛｛` 防注入、refresh 失败保留旧缓存）；`SKILL.md` 补 lib 引用纪律；`@` 菜单「资产库」候选区 + `insertLibChip` + hover 预览（**chip 形态 = 普通 `AssetHandle`，`nodeId='lib:<id>'`，`findAssetByChipText` 零改动**）。**测试**：新增 4 文件 31 例（`lib-ref-resolve` 7 / `library-route` 10 / `prompt-section` 8）+ `reference.test.mjs` 扩 6 → 26，全量 **1094 · 1089 过**（5 条基线红同名）。**待做 Step 2**：`AssetLibrary.tsx` overlay + `csLib*` 令牌 + 四分类导航/搜索/卡片网格/右侧详情抽屉 + `StudioFrame`/`LobbyHero`/`CanvasContextMenu` 三入口 + F1「加入资产库」流程；**联调验收**：§6.1 五条 + `gcLibraryAssets` 补齐
- **涉及文件**：src/contracts/asset-library.ts(新) / src/asset-library.ts(新) / src/asset-library-prompt.ts(新) / src/routes.ts / src/host-tools.ts / src/errors/catalog.ts / src/reference-handle.ts / src/index.ts / src/client/{reference-source,index,StudioFrame,project-store,api,contracts}.ts / skills/canvas-studio-creation/SKILL.md / tests/{asset-library-store,lib-ref-resolve,library-route,prompt-section,reference}.test.mjs


#### CV-254 · 镜位框「镜 N」chip 视觉升级：抽 `.csShotChip` 琥珀语义胶囊（借渲染台 `.csStageChi…

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**镜位框「镜 N」chip 视觉升级：抽 `.csShotChip` 琥珀语义胶囊（借渲染台 `.csStageChip` 圆角/border-box 视觉语言），替代原 inline amber 描边；不遮挡与信息完整维持跟随缩放（chip 画布高 22px ≤ 框头 28）+ 节点头部「分镜 N」/底部时间轴兜底。纯类名替换 inline style，无布局纯函数改动、无测试 pin。**验证**：T1 = clean+tsdown+tsc×2 = 6.5s + 定向 5 文件 68 条 1.4s 全过（非全量）；你桌面验收通过（中/低缩放均不压字、美观达标）。**验收**：`acceptance-test-cases.md` 二十六、W-5
- **涉及文件**：src/client/styles.ts(.csShotChip) / src/client/canvas/CanvasSurface.tsx(chip 改 className + top +3 居中框头带)


#### CV-253 · 镜位框「镜 N」chip 与分镜文案间距平衡（CV-252 chip 由屏幕恒定改为跟随画布缩放）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**镜位框「镜 N」chip 与分镜文案间距平衡（CV-252 chip 由屏幕恒定改为跟随画布缩放）**。**起因**（2026-09-28 用户报障）：「镜 N」圆角 chip 与分镜卡里的「分镜 N·大远景」文案贴太近，小缩放下 chip 压进文案标题行（图 2 情形）。诊断（读码 + 实测，非看图猜测）：chip 在 CV-252 里搬出框体、画在节点之上、`transform: scale(1/view.scale)` **屏幕恒定尺寸**；其画布占位高 = `chipHeight/scale`，而框头 `SHOT_BOX_HEAD` 按 100% 写死 ⇒ **缩放越小、chip 在画布坐标里占位越膨胀、越往框内压**。实测溢出量：100%→2.4px / 80%→8.5px / ~70%→~13px（盖住「分镜 1」标题）/ 50%→18.7px。**初版方案 A（框头加高）只折中**：`SHOT_BOX_HEAD` 22→28 + chip 顶部偏移 3→2；100% 分离、70% 压 5.4px、≤50% 仍压。**桌面验收迭代**：低缩放下仍压字（截图确认）⇒ 改**根因修法**：删 chip 反缩放（`scale(1/view.scale)`+`transformOrigin`）、偏移去 `/view.scale`、`fontSize 11→14` 补偿。chip 变为画布内容**跟随画布缩放**，画布高度恒 ~25px ≤ 框头 28 ⇒ **任意缩放都不压字**（缩越小字越小，镜号由节点头部「分镜 N」兜底）。`SHOT_BOX_HEAD` 维持 28（静态常量，行距账 `ARRANGE_GAP_Y=48`，上下框 8+28=36 留 12px，不破栈式排布、CV-252 铁律保住）。**grep 确认**全仓无测试 pin 22/3/11/14 魔数 ⇒ 改动零回归风险。**验证**：clean + tsdown + tsc×2 + verify:loader ✓；定向 canvas-arrange/canvas-view/canvas-placement/shot-cards/visual-tokens 99/99 过；全量 **1052·1047 过**（5 条基线红同名：渐进披露×1 + studio-defaults×4，零回归）；verify-previews **23/10**（= 基线 23/33，零回归）。**验收**：`acceptance-test-cases.md` 二十六、W 组
- **涉及文件**：`src/client/canvas/CanvasSurface.tsx`（去 chip 反缩放 + fontSize 11→14 + 注释 CV-253 账）/ `src/canvas-view.ts`（computeShotLanes 读者，确认框头为静态常量不呼吸）/ `docs/acceptance-test-cases.md`(W 组)


#### CV-252 · 镜位框「镜 N」chip 缩放显示两连修（BUG-008 真机验收附带产出，此前仅 git 流通未登记）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**镜位框「镜 N」chip 缩放显示两连修**（BUG-008 真机验收附带产出，此前仅 git 流通未登记）。chip 搬出框体独立顶层渲染（`transform: scale(1/view.scale)` 屏幕恒定尺寸）+ 画布占位高 `chipHeight/scale` 与框头 `SHOT_BOX_HEAD` 静态常量配套——铁律「框体几何不随缩放呼吸」，任何缩放/排布下 chip 不切半、不压镜卡文案。2026-09-27 真机验收通过（100%/70%/50% 三档缩放判据）
- **涉及文件**：`src/client/canvas/CanvasSurface.tsx`（chip 渲染）/ `src/client/styles.ts` / `tests/shot-cards.test.mjs`；终版 `50f9ee08b8`


#### CV-251 · 分镜修改纪律与防堆卡（BUG-007/008 收口，此前仅 git 流通未登记）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**分镜修改纪律与防堆卡**（BUG-007/008 收口，此前仅 git 流通未登记）。① `submit_storyboard_for_approval` 描述补「修改分镜 = 重提完整分镜表，按镜号原地更新」硬指引 + skill 总纲两处同步（行 65 carve-out / 第 3 步重提纪律）；② confirm 模式解析失败 → 抛可操作报错（`CS-USER-ERR` 附 6 列格式引导；`STORYBOARD_PARSE_HINT` 与 auto/confirm 降级提示共用），不再无条件追加整表卡。2026-09-27 真机验收通过（《深夜面馆》：打回改第 2 镜 → 重提整表，3 卡 id/位置不变、文案原地更新、无新增卡）
- **涉及文件**：`src/host-tools.ts`（描述 / 防堆卡闸门 / STORYBOARD_PARSE_HINT）/ `skills/canvas-studio-creation/SKILL.md` / `tests/shot-cards.test.mjs`（11 例）；方案 `docs/archive/plans/分镜修改纪律与防堆卡方案.md`


#### CV-246 · 生成历史面板（BUG-006 收口

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**生成历史面板**（BUG-006 收口；CV-246a 真机反馈三连，此前仅方案文档流通未登记）。产物落盘点全量记账 `<项目>/assets/history.json`（生成/上传/四视图/音乐/成片/裁切 6 处埋点，try/catch 不阻断）→ `HistoryDrawer` 抽屉回溯（全/图/视频 tab + 真缩略 + 三色状态徽章 + 删除确认）→ 面板删除两段式（仍被画布引用 409 拒绝防断链；否则 rename `.trash` + deletedAt，GC 物理清闭环）；未删历史条目 = GC 保护名单；CV-246a：预览弃 `window.open` 改 app 内定位/lightbox、卡片点击分流、url 集合签名自动刷新。2026-09-27 真机验收通过
- **涉及文件**：`src/asset-history.ts`（新）/ `src/client/canvas/HistoryDrawer.tsx`（新）/ `src/asset-gc.ts`（保护名单）/ `src/routes.ts`（asset-history 两路由）/ `src/client/CanvasToolbar.tsx`（时钟入口）/ `tests/asset-history.test.mjs`（9 例）；方案 `docs/archive/plans/生成历史面板方案.md`


#### CV-244 · 「废弃素材」开关布局回收（BUG-004 收口，此前仅方案文档流通未登记）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**「废弃素材」开关布局回收**（BUG-004 收口，此前仅方案文档流通未登记）。隐藏方向：`autoArrange` 排布输入收敛为可见子集（`computeArrangeLayout` 第 5 参 `options.layoutOverVisible`——retired 不占槽位 / 不撑行高 / 不参与钉扎加高）；显示方向对称触发全量重排 + fit。2026-09-27 真机验收通过
- **涉及文件**：`src/canvas-view.ts` / `src/client/project-store.ts` / `src/client/StudioFrame.tsx`（开关/整理/放手三处）/ `tests/canvas-arrange.test.mjs`（+3 例）；方案 `docs/archive/plans/废弃素材开关布局回收方案.md`


#### CV-243 · 资产废料两段式回收（BUG-005 收口，此前仅方案文档流通未登记）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**资产废料两段式回收**（BUG-005 收口，此前仅方案文档流通未登记）。删除节点 → 无引用文件 rename 进 `assets/.trash/`（不物理删，undo / 共享 / 生成中竞态免疫）→ 打开项目自动 GC + `POST /canvas-studio/asset-gc` 手动兜底（误删回活 / 孤儿物理清 / manifest 剪枝；引用计数按 url basename 而非节点 id）；与 CV-246 分工——243 管「没人要的怎么清」、246 管「有人想要的怎么找回」。2026-09-27 真机验收通过
- **涉及文件**：`src/asset-gc.ts`（新）/ `src/projects.ts`（`ASSET_TRASH_DIR`）/ `src/routes.ts` / `tests/asset-gc.test.mjs`（8 例）；方案 `docs/archive/plans/资产废料回收方案.md`


#### CV-242 · 参考句柄断链根治（BUG-001 收口最后一块，此前仅方案文档流通未登记）

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**参考句柄断链根治**（BUG-001 收口最后一块，此前仅方案文档流通未登记）。① `writeCanvas` 加 `options.author` 写者语义（filename 字段保护仅对 client 保存生效）+ `removedIds` 显式删除协议——canvas.json 双写者竞态（Host 字段级回写 vs 客户端整档覆盖）根治；② `<项目>/assets/reference-manifest.json` 句柄落盘映射（惰性 promote / heal 兜底记账）；③ 详情面板断链显式渲染「参考已断链」占位卡（不再静默丢弃）。2026-09-27 真机验收通过（《雨夜茶馆》四幕）
- **涉及文件**：`src/projects.ts`（writeCanvas）/ `src/node-params.ts`（resolveReferenceSummaries）/ `src/client/project-store.ts`（pendingRemovedIds）/ `src/client/canvas/NodeDetailDrawer.tsx` / `tests/canvas-save-merge.test.mjs`（+6 例）；方案 `docs/archive/plans/参考句柄断链根治方案.md`


#### CV-241 · 〔2026-09-29 桌面验收通过〕四类文件（图片/视频/音频/文字）统一上传：单按钮 + 拖放自动分类，本地落盘…

- **状态**：已完成
- **优先级**：P1
- **问题**：**〔2026-09-29 桌面验收通过〕四类文件（图片/视频/音频/文字）统一上传：单按钮 + 拖放自动分类，本地落盘秒回、后端提升全惰性**。**根因**（方案 [plans/四类文件统一上传改造方案.md](./plans/四类文件统一上传改造方案.md) §2，已核实）：① 拖放 `handleDroppedFiles` 只认 video/image——音频静默丢、文字不被接管落宿主 composer 撞「仅支持 PNG」白名单；② 图/音走 `POST /canvas-studio/upload`（JSON+base64）且 `saveLocalImage` 后**同步 promoteAssetFile**（HTTP 往返串行 = 上传慢），`MAX_BODY_BYTES 16MB` 再经 base64 ×4/3 天花板。**五步落地**：**S1** 新纯模块 `src/media-extension.ts`（`extensionOf`/`MediaKind`/`MEDIA_EXTENSIONS`/`MEDIA_UPLOAD_LIMITS`（image16/audio32/text5MB 原始字节，Q2）/`classifyFile`/`mediaAcceptAttribute`）+ `saveLocalAssetBytes`（白名单+落盘、零 promote）+ `tsconfig.client.json` include；**S2** 新端点 `POST /canvas-studio/upload-media`（octet-stream 原始字节、query projectId、classifyFile 400、分类型 413、**响应期零 promote**）+ 客户端 `uploadStudioMedia`；**S3** `StudioFrame`：`handleDroppedFiles` 四类分发（priority video>image>audio>text、未知 `不支持的文件类型：…` reject toast、失败 toast 前缀 `MEDIA_KIND_LABEL[kind]`）+ capture 判据改「非 image MIME / classifyFile!=='image'」（**纯图片不截断，宿主原 UX 保留**）+ `handleUploadText`（`file.text()` 截 4000、`uniqueTitle`）→ `project-store.addTextAssetNode`（kind text / origin manual / operationType import / NODE_SIZE.text / 无 toolName·referenceRole）+ 图/音切 `uploadStudioMedia` 去 base64 + `probeImageDisplay(Blob)` + Q3：text 且有 `url` 双击开详情、详情 `value`+`readOnly`；**S4** `CanvasToolbar` 三旧按钮（上传图片/音频/视频）删除，换单入口 `onUploadFile` + accept=`mediaAcceptAttribute()`，StudioFrame 接 `handleDroppedFiles([file])`（**分发只准一份实现**）；**S5** 旧 `/upload`（JSON+base64）标 `DEPRECATED（CV-241 §6.5）` 保留一版（热更新兼容），`uploadLocalStudioImage` 零调用方仅留定义；对话附件 `uploadLocalStudioImageDeferred`（`/upload-local`）**不迁移**；惰性提升走既有 `resolveRefFilenames`→`promoteAssetFile`（视频仍 `/upload-video` 128MB）。**测试**：新 `tests/media-extension.test.mjs`（7）/ `tests/upload-media.test.mjs` / `tests/media-drop.test.mjs`（分发+capture+文字落卡+Q3+Step5 零调用方+D3 单按钮共 7 组）；改 `media-upload-wiring` capture、`canvas-arrange` 工具栏、`generate.test` saveLocalAsset 契约。**验证**：typecheck ✓ / build ✓ / test:smoke **1004 条 999 过**（5 条基线红同名：渐进披露×1 + studio-defaults×4）/ verify:loader ✓。**不做**（拍板）：D4 不动 H3 音频 mp3/wav·15MB 校验（`audio-reference.ts`）；图片惰性 promote 用 Q1；限额按 Q2
- **涉及文件**：`src/media-extension.ts`(新) / `src/generate.ts`(saveLocalAssetBytes) / `src/routes.ts`(/upload-media + /upload DEPRECATED) / `src/client/api.ts`(uploadStudioMedia) / `src/client/StudioFrame.tsx`(分发/capture/handleUploadText) / `src/client/project-store.ts`(addTextAssetNode) / `src/client/canvas/{CanvasNode,NodeDetailDrawer,CanvasToolbar}.tsx` / `tsconfig.client.json` / `tests/{media-extension,upload-media,media-drop}.test.mjs`(新) + 4 份改


#### CV-221 · BGM 空血缘兜底链放宽：文案 → 剧本 → 分镜卡（取最新）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**BGM 空血缘兜底链放宽：文案 → 剧本 → 分镜卡（取最新）**。**取证**：罗大佑风格测试首条 BGM（12:01）`sourceIds` 为空 —— 它落盘时场上还没有 `write_script` 节点，CV-206 兜底 `find(write_script)` 找不到目标。**拍板时的关键视角（用户提出）**：BGM 有两大类用法 —— ① 配乐类（剧本/文案先行，BGM 是派生物）与 ② 音乐先行类（罗大佑：先定 BGM 再按音乐做 MV，BGM 是**创作源头**）。**兜底的时序自限性让方案 A 对两类都成立**：配乐类落盘时内容祖先在场 → 兜底挂上（agent 忘传来源时保住血缘）；音乐先行类落盘时场上只有创意 → 兜底全扑空 → **保持空血缘，那正是「源 BGM」的正确形态**（罗大佑首条 BGM 空血缘在模式 ② 下不是缺陷），不硬造血缘、不禁止合法的 BGM 先行工作流。**落地**：兜底链逐级找场上最新候选（max createdAt —— 配乐类项目多版文案〔放手跑2 的 6 条〕时挂最新策略而非最旧）；skill 纪律方案 B 否决（实测模型遵守率不可靠 + 会禁止模式 ②）。**测试**：`tests/lineage-completion.test.mjs` +2（无文案逐级落剧本/分镜卡；多文案挂最新）
- **涉及文件**：`src/generate.ts`（generateMusic 兜底链） / `tests/lineage-completion.test.mjs`
- **落地/验收**：2026-09-21 拍板 + 落地


#### CV-222 · 同镜位自动取代：`video_composite`/`video_generate` 落盘时血缘含同一张分镜卡的活动…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**同镜位自动取代：`video_composite`/`video_generate` 落盘时血缘含同一张分镜卡的活动视频一律 supersede，不再依赖 agent 自觉传 `replaces`**。**取证**：罗大佑画布分镜 11 重跑换了参考组合 ⇒ 指纹不同 ⇒ CV-108 的指纹级自动取代漏判 ⇒ 新旧两条「分镜 11 · 视频」并列且都算活动片段（同画布分镜 7/8 指纹未变走了显式 replaces —— 同机制一半生效一半失效，证明概率性失忆）。**代价**：两条活动视频一起进 `defaultComposeClips`（成片重复拼镜）+ 布局同镜位各占一格。**落地**（`planSupersede` 新增镜位级通道，与指纹级并列）：① 锚点 = 新视频血缘中的分镜卡 id（`anchorShotCardIds`，从 resolved sourceIds 派生，**含 CV-031 关键帧继承的间接锚点** —— agent 漏传 shotRefs 时仍能锚定）∪ `shotNodeIds` 现场验证（须真实命中场上分镜卡，防传错 id 误伤）；② 锚点与旧视频 `sourceIds` 有交集即取代；③ 无锚点不触发（延续「无锚点拒绝判重」保守口径，纯文生视频不互相误伤）；④ 与显式 `replaces` 取并集，版本沿最大链递增。**语义反转（随拍板生效）**：旧决策「同卡不同参考图 = 不同子镜可并存」被推翻 —— 并行变体的合法消费改走「旧版灰显恢复」（右键）与显式 `clipIds`（被取代节点仍可显式指定），零数据损失；存量画布（罗大佑分镜 11 旧版）手动右键作废即可，不做迁移。**工具描述同步 2 处**（video_generate / video_composite 的 replaces 说明改为「同镜位重复生成〔含换参考组合〕也会自动取代」）。**测试**：`tests/shot-versions.test.mjs` +4 并反转 1（同镜位换参考自动取代 / 不同镜位+成片+已失效排除 / 无锚点与错 id 不触发 / 与 replaces 并集递增版本）
- **涉及文件**：`src/shot-versions.ts`（planSupersede 镜位级通道 + anchorShotCardIds） / `src/generate.ts`（锚点派生接线） / `src/host-tools.ts`（描述×2） / `tests/shot-versions.test.mjs`（+4 反转 1）
- **落地/验收**：2026-09-21 拍板 + 落地


#### CV-194 · 节点详情重构 · 批次 1：就近工具条（不随缩放）+ 底部可拖高抽屉 + 三档提示词编辑器，取代右缘固定浮层

- **状态**：已完成（桌面验收通过 2026-09-17）
- **优先级**：P1
- **问题**：**节点详情重构 · 批次 1：就近工具条（不随缩放）+ 底部可拖高抽屉 + 三档提示词编辑器，取代右缘固定浮层**。起点是用户三条吐槽，读码后确认**同源**：`LayerDetailPanel` 的 `.csDetailPanel` = `position: fixed; top: 64px; right: 12px; width: 320px` 是**屏幕坐标浮窗** —— 与节点坐标无关（「离节点远」）、盖住宿主右栏（「挡对话」）、15 行平铺同权 + 11px `word-break: break-all` 挤在 label 后约 180px、提示词只有**单行 `<input>`**（「改提示词难」）。**先调研后动手**（React Flow `NodeToolbar`：不随缩放、仅单选可见 / n8n NDV：侧边就地编辑，聚焦按钮**只对多行文本**出现 / NodeTool：右栏只做 Inspector、日志下沉底部 / Grida：section 化 + 失焦提交），用户拍板 **B 方案**（否 A 锚定浮动卡、否 C 右缘停靠）。**两个几何决策做成「不需要浮点账」的形式**：① 工具条渲染在 `.csCanvasLayer` **之外**的兄弟层 ⇒ 尺寸**天然不随缩放变形**（写进层内 = 缩到 0.4× 时按钮糊成一团），位置由纯函数 `nodeActionAnchor` 现算（屏幕坐标 = 世界 × scale + view 偏移；`NODE_ACTION_GAP=8` / `NODE_ACTION_MARGIN=8`；上方装不下翻下方；两端夹取；整块出视口不渲染）；② 抽屉挂 `.csCanvasBody` 内绝对定位 ⇒ **底边即时间轴顶边、宽度即画布宽**，「离节点远」「压宿主右栏」从几何上不成立。**文件**：`src/node-params.ts`（**新**，生成参数解析唯一源 —— `parseGenerationParams` / `isReplayable` / `promptFieldsOf` / `valueOf` / `withPromptField`；四类 `generationPrompt` 形状各自映射真字段：image/video 工具 → `prompt`，music → `caption_prompt` + `lyrics_prompt`，character_sheet / extract_last_frame → 无可编辑自由文本）/ `canvas/NodeActionBar.tsx`（**新**；重试 + 改提示词 + 引用到对话，`hasActions` 为假时**整条退场**；`pointerdown` / `dblclick` / `contextmenu` 全 `stopPropagation` —— 不拦的话按按钮的**按下瞬间**选区就被清掉）/ `canvas/PromptEditor.tsx`（**新**；三档 read → inline 自增高 → expand 右栏整栏 + 聚焦大窗左「已保存基准」右「编辑」并排；失焦提交、Esc 取消、Cmd/Ctrl+Enter 提交）/ `canvas/NodeDetailDrawer.tsx`（**新**；左「身份/变换」只读 + 右「内容」可编辑 + 底栏操作；`MIN_DRAWER_HEIGHT=148` / `MIN_CANVAS_VISIBLE=180`；高度记忆走 `localStorage['canvas-studio.detail-height']`、默认 320）/ **删除 `canvas/LayerDetailPanel.tsx`（431 行）**；`CanvasSurface`（工具条挂在画布层之后的兄弟层、`actionBarNode` 仅「单选 + 非手势中」存在）、`StudioFrame`（抽屉挂 `.csCanvasBody` + `detailInset` 透传 ⇒ 工具条被夹在抽屉之上）、`CanvasContextMenu` / `api.ts` / `client/index.ts` / `contracts.ts`（**`steerNode` 与「重试带 overrides」全链路删除**，重试只用节点自带参数；「能不能重试」统一走 `isReplayable`）、`styles.ts`（`.csDetailDrawer*` / `.csNodeActionBar*` / `.csPrompt*`；层叠收口 nodes < ActionBar 8 < LayerPanel 10 < ReferenceTray 20 < **Drawer 30** < ContextMenu 50 < Modal 70）。**不可重放的 8 个节点**（music_generation ×5 / character_sheet ×2 / extract_last_frame ×1）**不再显示重试**（它们打不通后端），改「改完再点重生成」语义；链路真补齐另立 **CV-195**。**新验收台 `scripts/preview-detail.mjs`**：9 个场景**单变量差分**（A/B/C 只差工具条挂在哪儿、D↔A 只差 z-index 与 DOM 次序、E↔F 只差画布层 z-index、H↔I 只差 `bottomInset`），对照场景**必须红**；27 条断言 × 明暗两轨。实测真值：工具条 **187×31** 且 1× 与 0.4× **逐像素相同**（写进层内则是 74.8 = 0.4×）、抽屉底边与容器差 **0.0px**、左右 20.0~740.0 与容器一致、两栏 280 / 400px、提示词宽 396px。**反向探针逼出真缺陷**：`工具条压在节点之上` 原本**恒真**（工具条 DOM 次序本就在画布层之后，`z-index: auto` 也压得住）⇒ 补「显式抬层 = z-index 必须是数字」断言；三个变异复跑全红（z-index 改 auto / 抽屉退回固定 320px 宽 / 提示词 12→11px）。测试 **681/681 fail 0**，预览 **27 组全过**。
- **涉及文件**：`src/node-params.ts`（新） / `src/canvas-view.ts`（+`nodeActionAnchor`） / `src/client/canvas/{NodeActionBar,PromptEditor,NodeDetailDrawer}.tsx`（新） / `src/client/canvas/{CanvasSurface,CanvasContextMenu}.tsx` / `src/client/canvas/labels.ts` / `src/client/canvas/LayerDetailPanel.tsx`（删除） / `src/client/{StudioFrame,styles,api,index,contracts}.ts` / `scripts/{preview-detail,preview-visual,verify-previews}.mjs` / `tests/visual-tokens.test.mjs` / `docs/STATUS.md`


#### CV-179 · 视觉升维 DD-09 右栏修正：阶段胶囊撤出会话头（会话标题不再被挤没）+ 读数带升为场记板横条（CV-178 的收…

- **状态**：已完成
- **优先级**：P2
- **问题**：**视觉升维 DD-09 右栏修正：阶段胶囊撤出会话头（会话标题不再被挤没）+ 读数带升为场记板横条**（CV-178 的收尾修正；方向见 [visual-direction-plan.md](./visual-direction-plan.md) §DD-09、工程清单 [visual-direction-execution-plan.md](./visual-direction-execution-plan.md)）。**两个问题都是用户拿着截图问出来的，两个都不该在表面改文案**：① 「上面那行字是什么意思、永远显示不全」—— 它既不是项目名（项目名在输入卡下方那條读数带上），也不是我们写的任何元素，而是**宿主自动生成的会话标题**（`titleProvider: session-title-first-prompt-llm`，从首条用户消息提炼；截图里是 14 字「创作演唱会MV及简单女声歌曲」）。**根因可复算**：宿主 `.headerUtilities` 是 `flex: none`、标题簇 `.titleCluster` 是 `flex: 1; min-width: 0`、`.crumb` 还有 `max-width: 220px` + `ellipsis` —— 标题只能被压，压它的正是我们注册在 `conversation.session.header.utilities` 的那枚阶段胶囊（实测 133px）：胶囊在场时标题只剩约 93px（实测只显示三字），撤走后可用宽度回到约 234px ≥ 所需约 202px。**能改的从来不是宿主的标题，而是我们放进去的东西** → 删掉该槽注册（撤销的正是 CV-175 c 批的挂点），把胶囊搬进输入区读数带；判定与组件**原样复用、零新判定**（统一由 `deriveProjectContextView(project, workflow, nodes)` 一处给出，`StageChip` 退化为纯展示组件、不再 `useStudio`）。② **读数带升为场记板横条**：`.csContextBar` 由「居中一行文本 + ellipsis」改 flex，新增 `::before` accent 立柱（2×12px），名称 13px/600 + 字距，规格 `tabular-nums`（三个数同宽不跳动），与中栏那条 gold 审批条同一套语言。**验证手法是本批的正式产出**：标题能否显示全由宿主 CSS 决定，我们无从断言宿主 DOM —— 渲染台改为**同一帧渲染两个只差一件事的会话头**（`pvHeaderBefore` 挂胶囊 / `pvHeaderFixed` 不挂），差分断言「现状不截 **且** 对照仍被截」；**对照组必须真的红**，否则说明模型里压根没挤，主断言就是空绿（差分比绝对值断言硬得多）。守卫：`tests/visual-tokens.test.mjs` 新增「插件不得再往会话头注册元素」「阶段胶囊是纯展示组件」两条 + d 批补 ⑥⑦（胶囊必须真搬进来、三个入参一个都不能漏传）；`tests/host-boundary.test.mjs` 从「宿主槽必需项」表摘掉该槽（并写明再加回时必须补回该行）。验证 619 → **623/623 fail 0**（+4），预览台 **17 组全过**（右栏 46 条断言明暗双轨），反向验证 **3** 探针各自能红
- **涉及文件**：`canvas-studio/src/client/index.ts` / `canvas-studio/src/client/StageChip.tsx` / `canvas-studio/src/client/ProjectContextBar.tsx` / `canvas-studio/src/project-context.ts` / `canvas-studio/src/client/styles.ts` / `canvas-studio/tests/visual-tokens.test.mjs` / `canvas-studio/tests/host-boundary.test.mjs`


#### CV-178 · 视觉升维 DD-09 右栏 / d：输入卡片下方的项目上下文条（「工具面板 → 制作现场」第六批 d，方向见 vis…

- **状态**：已完成
- **优先级**：P2
- **问题**：**视觉升维 DD-09 右栏 / d：输入卡片下方的项目上下文条**（「工具面板 → 制作现场」第六批 d，方向见 [visual-direction-plan.md](./visual-direction-plan.md) §DD-09、工程清单 [visual-direction-execution-plan.md](./visual-direction-execution-plan.md)）。一行环境读数「项目名 · 画幅 · 目标时长 · 建议镜头数」。**实施时纠正了立项文档的槽选型**：宿主把两个位置分了工 —— `conversation.input.dock` 是「卡片上方的整行，给会换行/带正文的内容」（goal / queue 在那），`conversation.composer.dock` 才是「卡片下方的环境读数位」（宿主自带 stats 行就住那）；读数属后者。**槽选错不报错**，只是落在错位置（类型系统与渲染台都看不出来）。几何 1:1 镜像 stats 行（同 `--dsh-chat-content-width` 宽列 / 同 `--dsh-composer-side-clearance` 内边距 / 同 12px·20px），故两条读数等宽同轴。规格摘要收口为唯一实现 `planSummaryOf`（左栏项目卡副行与这条读数同源），非有限时长（0 / 负 / NaN / Infinity）挡在摘要外（`0s` / `NaNs` 长得像真值，比缺一段更糟）。未锁画幅/时长的项目只显示项目名，不显示占位文案
- **涉及文件**：`src/project-context.ts`（新，纯函数）、`src/client/ProjectContextBar.tsx`（新）、`src/project-row.ts`（抽出 `planSummaryOf`）、`src/client/contracts.ts`、`src/client/index.ts`（注册 `composer.dock` / id `canvas-studio-project` / order -10）、`src/client/styles.ts`（`csContextBar*`）、`scripts/preview-tokens.mjs`、`scripts/preview-chat.mjs`
- **落地/验收**：✅ 2026-09-14 落地：测试 **609 → 619 fail 0**，预览台 17 组全过（右栏 39 条断言）。四层守卫：`host-boundary.test.mjs` 槽必需项表补 `composer.dock` → `id`；`tests/project-context.test.mjs` 6 用例；`tests/visual-tokens.test.mjs` 接线断言（必须进 `composer.dock`、不得出现 `input.dock`）+ 类名双向配对；渲染台 computed style 断等宽同轴（明暗双轨）。**反向验证两探针各自能红**：删注册 `id` → host-boundary 红；把槽改成 `input.dock` → visual-tokens 红。已知代价：宿主对 `composer.dock` 的渲染条件是 `!hero` —— hero 态（尚无对话内容）不显示这一带，此时中栏与左栏已在表明项目身份


#### CV-177 · 托盘（素材组）交互相三连：单张时拖成员 = 拖托盘、右键「整理托盘」、托盘常驻 24px 抓取带

- **状态**：已完成
- **优先级**：P2
- **问题**：**托盘（素材组）交互相三连：单张时拖成员 = 拖托盘、右键「整理托盘」、托盘常驻 24px 抓取带**。用户原话「这个编组很好，需要保留，我想要改一下实现」+ 三条需求 + 一句「你觉得这样改动可以吗」→ **先核事实再动手**，三条全部成立，其中第 3 条**是被现实现欠着的**：托盘 = `kind='group'` 节点，靠 `zIndex:-1` 排在成员**之后**渲染（`CanvasSurface.tsx:672` 按 `compareNodes` 升序），成员把中间盖住 → **可抓区只剩 12px 边环**（缩放 50% 时 6px，实测抓不住）；而组框**不可 resize**（`showResize = !node.locked && isMedia`，托盘不是媒体节点）→「从哪儿按住托盘」只能由代码保证；拖动的跟随规则全仓只有一条 `candidate.parentId === id`（`project-store.ts` 的 `moveNode`）→ 拖成员只动成员自己，于是「图片被拖出托盘、托盘原地不动」；另外组几何**此前算了两遍**（Host `generate.ts` 的 `GROUP_PADDING = 12` 与 client `groupSelected` 里硬编码的 `-12`/`+24`）。**四条改动**：① **几何收口** → `src/canvas-view.ts` 新增 `groupBoxOf`（= 成员包围盒 + 12px 内边距 + **24px 抓取带**）、`normalizeGroupBoxes`、`tidyGroupLayout`、`singleMemberGroupOf` 四个纯函数，`attachShotGroup`（Host 自动编组）与 `groupSelected`/`tidyGroup`（client）全部改调它（`boundsOf` 随之退休，已无调用方）；② **需求 3 抓取带** → `.csNodeGroup` 改「头部带 + 主体」，带高 24px（CSS 与 `GROUP_HEAD_HEIGHT` 是**跨层契约**，有测试比对两个数）、带内显示组名 + **成员数**，成员的几何完全不变；③ **需求 1 拖动等价** → `Gesture.moveProxyId`：单成员托盘里拖成员时实际移动的是托盘本体（成员随 `parentId` 跟随，位移完全等价），**只对单节点拖动生效**（多选整队走原 `origins` 通道）；多成员托盘**保留**「成员可单独拖走」（用户确认的语义）；④ **需求 2 整理托盘** → 右键新命令，以**托盘左上角为锚**按阅读顺序（先上后下、同行判定用**垂直区间重叠**而不是「y 相等」—— 手工摆过的成员几乎不可能对齐）重排成网格（≤3 张一行、更多取 `ceil(sqrt(n))` 列、间距 12px、格内居中），走 `snapshotHistory` **可撤销**；锚在托盘上所以能**收回**被拖出去的成员、单张时即「复位」，且它是画布上**唯一能让托盘收缩**的路径（其余路径只扩张）。**载入清洗只扩张**：`setNodes` → `normalizeGroupBoxes`（老托盘补抓取带空间 + 重新包住被拖出去的成员，绝不收缩 —— 收缩只由用户的「整理」命令触发）。**验证**：新增 `tests/group-tray.test.mjs`（7 用例，专查**接线**（判定写好了但没接上等于没做）与那条跨层契约）、`tests/canvas-view.test.mjs` +8（几何 / 幂等 / 整理后不重叠 / 收回 / 阅读顺序 / 悬空 `parentId` 不当代理）、`tests/generate.test.mjs` 补抓取带断言；**609/609 fail 0**（+14），预览台 17 组全过
- **涉及文件**：`src/canvas-view.ts` / `src/generate.ts` / `src/client/project-store.ts` / `src/client/StudioFrame.tsx` / `src/client/canvas/{CanvasSurface,CanvasNode,CanvasContextMenu}.tsx` / `src/client/styles.ts` / `tests/{group-tray,canvas-view,generate}.test.mjs`


#### CV-176 · 审批门三连失效：提交审批后 agent 根本没停（分镜待批准的 3 分 58 秒里跑完第 4~5 步），且六段轨道与…

- **状态**：已完成
- **优先级**：P0
- **问题**：**审批门三连失效：提交审批后 agent 根本没停（分镜待批准的 3 分 58 秒里跑完第 4~5 步），且六段轨道与审批条互相矛盾**。桌面验收当场抓到两个矛盾：① 审批条写「剧本已提交到画布，请确认故事方向后批准」，同一屏的六段轨道已显示「剧本✓ 分镜✓ 定妆✓ ⬤关键帧」；② 分镜提交后**没等用户点批准就继续跑**。**取证**（真实会话转录，胜过看截图）：`~/.videobuddy/sessions/<cwd 转义>/session-*/session.jsonl.zstd`（**多帧 zstd** —— `zlib.zstdDecompressSync` 只解首帧 216B，实际 172KB，要用 `/opt/miniconda3/bin/zstd -dc`）显示 `submit_storyboard_for_approval` **14:25:46** 提交、用户 **14:29:44** 才批准，窗口内依次执行 `h3-prompt-writing` 加载 → 读 `format-ref2va.md` → 2× `image_generate`（定妆照）→ `character_sheet`（建资产卡）→ 逐镜出图。**三层根因**：**① 停止指令的位置** —— 剧本工具结果 152 字符、停止指令落在第 74 字符（49%）→ 模型**停住了**；分镜结果 **1080 字符**、指令被 16 张分镜卡的「标题 + UUID + 逐镜出图时把 shotRefs 设为…」压到第 1023 字符（**95%**）→ **没停**。差别不在"写没写"，而在**位置**（对本地 27B 模型，前 1000 字符的卡清单就是一份"下一步清单"）。**② 硬门禁表只列了两个工具** —— 旧 `GATED_TOOLS = {video_generate, video_composite}`，而最贵的「逐镜出图」走 `image_generate`、`character_sheet` 更是连门禁都没进。**③ 六段轨道 4 个死键** —— `OPERATION_STAGE` 里的 `storyboard`/`storyboard-split` 生产者写的是 **text 节点**（被 `kind !== 'image'` 闸门拦下）、`character-sheet`/`scene-concept` **全仓没有生产者** → 「分镜」「定妆」两段永远是空的、格子永远点不动；同时 Look 产物（基调样张 / 定妆照 / 场景概念图）全带 `text-to-image` → 挤进「关键帧」（实测样张 14:20 出、剧本 14:22 才写 —— **剧本还没落盘，轨道已经说自己拍到关键帧了**），而 `csStageDone` 只看位次（`i < stage`），空段也染绿。**修（用户拍板 A+B+D 全做）**：**A 提示词层** 新建 `src/approval-notice.ts` —— 停手写**第一行**、「获批后才需要的信息」统一走 `deferred` 并隔到 `DEFERRED_FENCE` 之后且明说"现在不要据此行动"，总纲 `SKILL.md` 补「提交即停手」硬条并纠掉旧说法「image_generate 出概念图不受限」（已不成立）；**B 硬门禁** 新建 `src/approval-gate.ts` 纯函数判定（`mode × state × tool × shotBound`，**两级**：审阅态拦全部产出类；`drafting` 只拦正式产线动作，Look 样张仍放行），删掉单表 `GATED_TOOLS`，`runGeneration` 与 5 个**直接 execute** 的工具（`character_sheet` / `extract_last_frame` / `qc_shot` / `music_generation` / `compose_video` —— 它们绕过 `runGeneration`，是审批期最大的后门）逐个接线，三个 `submit_*` 工具改用 dsh 官方 **`exec.concludeTurn()`**（`ToolRunContext` 的必需成员）在提交那一刻结束回合；**D 六段轨道** 删 4 个死键、分镜卡改按 `toolName` 判（`STORYBOARD_NODE_TOOL`）、新增 `operationType='look'` 把 Look 图片归「定妆」、`deriveWorkflowStage` 加**审阅态例外**（审阅是阻塞点，阶段以「正在审的那一项」为准，证据仍照常体现在 `idsByStage`，功能不丢）、`csStageDone` 加 `ids.length > 0`（**「完成」= 位次在前 且 真有产物**，连线也要求前一段真有产物，中间缺段如实留断口）。**守卫**：新增 `tests/approval-gate.test.mjs`（11 用例，含**源码守卫**「5 个直接 execute 的工具必须真的接了门禁」—— 判定对了但忘了接，行为与「没做」完全一样）与 `tests/approval-notice.test.mjs`（9 用例，**钉结构不钉字面**：停手必须在首行、围栏前正文 ≤320 字符、`auto` 不得出现停手、`concludeTurn` 必须在 `auto` 分支之后否则放手跑会一步一停）；六段轨道加「**每段都可达**」防死键 + 审阅态例外 + Look 分类用例。测试 **595/595 fail 0**（+26），预览台 17 组全过。**顺带确证**：原计划的「阻塞式审批」不必做了 —— `concludeTurn()` 已经提供了硬停，不需要架构改动
- **涉及文件**：`src/approval-gate.ts`（新）/ `src/approval-notice.ts`（新）/ `src/host-tools.ts` / `src/workflow-stage.ts` / `src/generate.ts` / `src/contracts/canvas.ts` / `src/client/StudioFrame.tsx` / `src/client/canvas/labels.ts` + `CanvasEdges.tsx` / `skills-local/canvas-studio-creation/SKILL.md` / `tests/approval-{gate,notice}.test.mjs`（新）/ `tests/{workflow-stage,workflow-gate,generate}.test.mjs`


#### CV-174 · 画布原生选区污染：拖动节点时把「路过」的其它节点文字/图片框选高亮，点空白清不掉、点节点才消失（桌面验收用户报「其他…

- **状态**：已完成
- **优先级**：P1
- **问题**：**画布原生选区污染：拖动节点时把「路过」的其它节点文字/图片框选高亮，点空白清不掉、点节点才消失**（桌面验收用户报「其他画布节点表现不正常，像被鼠标拉取框选选中，但不是所有节点都被选中」）。根因是**浏览器原生选区**而非画布选中态：① 画布从未禁 `user-select`，节点 pointerdown 也不 `preventDefault` → 按住节点拖动 = 浏览器原生文字/图片框选，光标扫过谁谁高亮（所以只是「路过」的那些节点）；② 空白 pointerdown 为平移手势 `preventDefault()`，连浏览器「按下即清选区」一起拦掉 → 残留高亮点空白清不掉；节点上没拦所以点节点反而能清 —— 与用户观察完全吻合。**修法**：`.csCanvasSurface` 整面 `user-select: none`（`input`/`textarea`/`[contenteditable]` 豁免 —— 重命名输入框与正文编辑 textarea 必须能选字）+ 空白按下 `window.getSelection()?.removeAllRanges()` 主动清残留。**零手势/焦点语义改动**：节点双击浮层、内联编辑、平移缩放、多选全部不受影响。typecheck ✓，测试 **552/552 fail 0**（无新增）。**同批入库两处上轮验收遗留的未提交修复**（同属选区残留症状族，用户验收构建已包含）：多选成员松手即塌缩单选（`collapseOnClick` 不再被 3px 拖拽阈值挡住）+ minimap 区域纳入「点空白清选」语义（新增 `onSurfacePointerDown` 回调）
- **涉及文件**：`src/client/styles.ts`（`.csCanvasSurface` 禁选 + 豁免覆盖）/ `src/client/canvas/CanvasSurface.tsx`（空白按下清原生选区）/ `src/client/canvas/Minimap.tsx`（清选回调）


#### CV-162 · 视觉升维 DD-03 节点卡片（「工具面板 → 制作现场」第三批）+ 两处「写了但从没生效」的视觉修复：① 单张节点…

- **状态**：已完成
- **优先级**：P2
- **问题**：**视觉升维 DD-03 节点卡片（「工具面板 → 制作现场」第三批）+ 两处「写了但从没生效」的视觉修复**：① 单张节点卡读成**镜头条** —— 媒体区上下 2px **片门暗带**（新令牌 `--cs-gate`，明暗两轨各一值）+ 媒体窗底改 `--cs-canvas-bg`、悬停抬高档（`--cs-node-hi`）、状态过渡接 `--cs-duration-*`/`--cs-ease`、角标底色与节点面同源、数字统一 `tabular-nums`；② 选中光晕收敛到 `--cs-glow-accent`，**并补上浅色轨缺失的那条**（此前只在暗色块定义 → 浅色主题选中态只剩 1px 线，而 DD-02 刚拆掉「处处描边」，于是浅色下几乎读不出选中）；③ **血缘聚光**：新建纯函数 `src/canvas-lineage.ts`（`lit` = 选中项 + **一跳**上下游；**选中项无血缘则不压暗** —— 压暗是揭示关系的手段，孤立节点没有关系可揭示，否则「点一下全屏变灰」），`CanvasSurface` 传 `dimmed`、`--cs-dim` 压暗非血缘节点；④ 生成中由「横向进度条」改**显影扫描光带**（`csProgressSlide` → `csDevelop`，**DOM 不变**，带 reduced-motion 降级）；⑤ 成片节点（复用 `isComposeProduct` 唯一口径）用 `--cs-teal` 描边，素材与产物一眼可分；⑥ **修死代码链**：`CanvasNode` 把 `node.opacity` 写成 inline `opacity`，inline 永远赢 → `.csNodeLocked{opacity:.75}` / `.csNodeRetired{opacity:.45}` **从未生效**（CV-108 号称「失效版本灰显」，实际只有 `grayscale(1)` 在跑），改成三层乘数（`--cs-node-opacity` × `-state` × `-dim`）由 `.csNode` 一条 `calc()` 统一算；⑦ 顺删 `.csNodeLinkHandle` 的重复规则块。守卫 **478/478 · fail 0**（+12：血缘 8 + 主题双轨 1 + 动效白名单/乘法链/单实现 3）；真实产物渲染台双主题 22 项断言全绿
- **涉及文件**：`src/brand.ts`、`src/canvas-lineage.ts`（新）、`src/client/styles.ts`、`src/client/canvas/CanvasNode.tsx`、`src/client/canvas/CanvasSurface.tsx`、`tests/visual-tokens.test.mjs`、`tests/canvas-lineage.test.mjs`（新）、`tests/brand.test.mjs`、`docs/visual-direction-execution-plan.md`


#### CV-161 · 视觉升维 DD-01 地基 + DD-02 空间（「工具面板 → 制作现场」第一批）：方向见 visual-dire…

- **状态**：已完成
- **优先级**：P2
- **问题**：**视觉升维 DD-01 地基 + DD-02 空间（「工具面板 → 制作现场」第一批）**：方向见 [visual-direction-plan.md](./visual-direction-plan.md)、工程清单见 [visual-direction-execution-plan.md](./visual-direction-execution-plan.md)、交互设计稿见 [visual-direction-preview.html](./visual-direction-preview.html)。**改前实测**（复跑命令见执行计划 §9）：`brand.ts` 定义 29 个 `--cs-*` 令牌而**20 个在 `styles.ts` 引用 0 次**（space / duration / ease / shadow-3 / radius-pill / glow-accent / gold / teal / canvas-grid 全域空转）；`.csFrame` / `.csCanvas` / `.csCanvasSurface` / `.csNode` **四层同色**全为 `--dsw-alias-bg-base`，整界面只靠 1px `border-l2` 切分；画布网格是两条 `linear-gradient` 直角线，且与节点描边**同源一个 `border-l2`**（CV-035 只能靠 `color-mix` 降到 45% 不透明度绕过）。**① DD-01 令牌地基**：`brand.ts` 新增**界面骨架表面令牌** `--cs-shell / -2 / -3`、`--cs-node / -hi`、`--cs-float`、`--cs-line / -hi`（明暗双轨，**不随预设切换** —— 守住「切换只动 accent 族」），`NON_COLOR_TOKENS` 补 `--cs-dim`（景深 0.42）与 `--cs-fs-xs~2xl`（六级字阶，收口原有 11 种离散 font-size）；**清掉 4 个幽灵令牌**（`--cs-text` / `--cs-text-muted` / `--cs-border` / `--cs-surface-raised`，共 7 处引用，`brand.ts` 从未定义、一直靠硬编码 fallback 撑着 —— 其中 `#e8eaed` 近白文字在**浅色主题下不可见**）→ 改指 `--dsw-alias-label-primary/-tertiary` 与 `--cs-line / -hi` / `--cs-float`；**退休 CV-035 的 color-mix workaround**（网格自此有独立令牌，不再与节点描边争同一个 `border-l2`）。**② DD-02 空间三档**：`.csFrame` / `.csProjects` / `.csChat` / `.csToolbar` / `.csTimeline` → `--cs-shell`（壳）；`.csWorkflowBar` → `--cs-shell-2`（壳二档）；`.csCanvas` / `.csCanvasSurface` → `--cs-canvas-bg`（画布**最暗**）；`.csNode` → `--cs-node`（节点**最亮**）；`.csDetailPanel` / `.csCanvasLayers` → `--cs-float`（浮层，压节点）；全部切分线由 `border-l2` 改 `--cs-line`（浮层用 `--cs-line-hi`）；**网格由直角线改点阵双层**（24px 细格 `--cs-canvas-grid` + 120px 主格 `--cs-canvas-grid-major`，取 `radial-gradient`），取值对齐效果图 0.06 / 0.11。**局部 repoint，未做任何全局替换**（`--dsw-alias-bg-base` 全表另有约 50 处其他用途，一律未动）。**③ 新增守卫 `tests/visual-tokens.test.mjs`（4 用例）**：反引号守卫（`styles.ts` 是模板字面量，注释里一个反引号即撕裂文件 —— 落地当天实测炸过一次 tsdown `PARSE_ERROR`）/ **幽灵令牌守卫**（引用了但未定义 → 正是拦下上面那 4 个的检查）/ **空转令牌棘轮**（空转集必须 ⊆ 冻结基线，新增令牌必须同批接上引用）/ 基线一致性（已接上的须从基线移除，防清单腐化）。**验证链全绿：sync skills / tsdown / tsc Host emit / tsc client dts / verify:loader ✓，466/466（+4）**；另用**真实产物渲染台**复核（CSS 直接取自 `styles.ts` 模板字面量、令牌直接取自 `lib/brand.js` 的 `brandCssText()`，非仿制）—— 暗色 computed 亮度实测 **画布 17 ＜ 壳 23 ＜ 节点 34 ＜ 浮层 39**，浅色 **画布 239 ＜ 壳/节点 255**，网格 `radial-gradient` 且无 `linear-gradient` 残留，双主题 `window.onerror` 均为「无」。**待用户桌面验收**（重启桌面加载新 build）：① 节点应明显「浮」在画布上（改前四层同色）；② 画布为点阵网格、放大后 120px 主格可见；③ 浅色主题下节点与画布有可辨落差、且不再出现近白文字；④ 工作流条的「逐步确认 / 放手跑」按钮**不再折成两行**（顺带修的既有缺陷：本批未动任何 `csWorkflow*` 规则，根因是 `.csWorkflowApproval{margin-left:auto}` 在中栏变窄时把可收缩的模式组一起挤扁；详见 §8 2026-09-12 那条）。DD-03（节点内部 / 选中光晕 / 景深）及其后批次**仍未开工**
- **涉及文件**：src/brand.ts / src/client/styles.ts / tests/visual-tokens.test.mjs（新）/ docs/{visual-direction-plan,visual-direction-execution-plan}.md


#### CV-155 · 产物文件名不可作带文件端点入参 + `analyzeImage` 无自愈 —— 已修复（2026-09-11）·桌面…

- **状态**：已完成
- **优先级**：P0
- **问题**：**产物文件名不可作带文件端点入参 + `analyzeImage` 无自愈** —— **已修复（2026-09-11）·桌面验收通过**：① 抽出共用自愈 `healReferenceFilename`（反查节点 → 本地资产重传 → 回写 filename；**兼认本地资产名**，实测 Agent 会把画布资产名当 filename 传）并接线到 `analyzeImage` —— image2vl 与 qc_shot 共用这**一处**，缺的正是这处；② `resolveRefFilenames` 新增产物名判据 `isDramaProductName`（`_<4 位以上数字>_` 形态，ComfyUI 计数器约定；漏判由 ① 兜底、误判只多一次上传，两向安全）**主动换句柄、不再等失败**；③ 措辞纠偏（`renderResult` 标签 / `resultSchema` / image2vl·qc_shot·video_* 参数描述 / SKILL.md 新增「两类 filename」/ toolchain.md 新增章节）。验证 **421/421**（+5，`tests/filename-consumability.test.mjs`；顺带修掉 `skill-guardrail` 用 `indexOf('image2vl')` 当锚点的脆性）。定案文档见 [api-probe/archive/2026-09-11-filename-consumability.md](api-probe/archive/2026-09-11-filename-consumability.md)）：后端两类文件名可消费性不同 —— `ref-<uuid8>.<ext>`（上传句柄，`temp/`）可用；`img_NNNNN_.png`/`z-image_*.png`（**后端产物名**）**约 0.1s 内 500**。证据：同一分钟交错对照（`ref-40bf8914.png` 28.0s ✅ / 466 与 26.9s ✅ / 554 各夹在 `img_*` 0.09–0.16s ❌ 之间）+ 09-10 会话复现（`image_generate\
- **涉及文件**：filename=img-*` 11%、`video_generate` 0%）+ 仓库探测记录本就写着「重传拿句柄（生产同款）」。**影响**：`qc_shot` **0/5 结构性失效**（其输入恒为刚生成的产物名 → 当前实现下不可能成功，C4 质检闭环实际从未运行、Look Phase 4 风格质检基准亦无从生效）；`image2vl` 本次 5/19。**根因**：`resolveRefFilenames` 返回 `node.filename`（生成节点=产物名，只有 filename 为空时才现场上传）；且自愈只覆盖 `runGeneration`(callWithFallback) 与 `generateCharacterSheet`，**`analyzeImage`（image2vl + qc_shot 共用）直连 `callDramaRaw` 无自愈**（`isBadReferenceError` 已认识该 500，缺的是接线）。修法：① `analyzeImage` 补同款自愈（抽共用 helper，一处救回两个工具）；② 产物名一律先重传、不靠失败后重试；③ 措辞纠偏（`image_generate` 结果把产物名标成「Drama 文件名」、`image2vl` 参数描述）。**同时更正旧结论**：STATUS 时间线曾把 qc_shot 的 500 归因为「Drama 后端 down」——**不成立**（同一分钟 `ref-*` 调用全部成功）
- **落地/验收**：src/generate.ts（`analyzeImage:913` / `isBadReferenceError:688` / `callWithFallback:1079` / `generateCharacterSheet:1478`）/ src/host-tools.ts（`resolveRefFilenames:346`、`image2vl:1090`、`qc_shot`）/ skills-local/canvas-studio-creation/references/toolchain.md


#### CV-149 · Look 采集接线（Phase 1 / L1）：把「参考图 → tokens」这条断掉的路接上，让四种输入共用同一份…

- **状态**：已完成
- **优先级**：P1
- **问题**：**Look 采集接线（Phase 1 / L1）**：把「参考图 → tokens」这条断掉的路接上，让四种输入共用**同一份 5 项 tokens**。① 新建 [style-tokens.ts](./../src/style-tokens.ts)（**5 项 tokens 的单一权威**，纯常量 + 纯函数，无 IO）：`LOOK_TOKEN_KEYS` / `LOOK_TOKENS_PROMPT`（逐行带字段名的归纳提示词）/ `LOOK_ANALYST_SYSTEM_PROMPT` / `parseLookTokens`（容错：序号·加粗·半角冒号·同字段多行合并）/ `mergeLookTokens`（跨帧归并：**字段 → 子句**两级去重）。② `video-style.ts` 逐帧归纳改用 `LOOK_TOKENS_PROMPT`（VLM 输出**5 行带标签**，替代原「不超过 6 条」自由要点）、**新增归并步**（原实现只是 `join('\n\n')` 拼接 —— 那不是归纳，是把 N 帧观察堆一起）→ `VideoStyleResult.tokens`；`summary` **末尾内嵌**「【5 项风格 tokens】」段（**Agent 读的是便签正文，另开字段它取不到**）；归并失败如实写「未能按 5 项格式归纳」并按分册降级。③ `references/look.md` 写死参考图归纳的 `image2vl` 调用规范（prompt / systemPrompt **逐字节照抄**，**由测试守护与 `style-tokens.ts` 一致** —— 防 CV-116 式「多处同改漏一处」）、样张「每轮只改 tokens 不改内容」、补两条降级路径。④ `routes.ts` video-style 响应透出 `tokens`。验证：tsdown ✓ / 双端 tsc ✓ / verify:loader ✓ / test:smoke **416/416** ✓（新增 `tests/style-tokens.test.mjs` 10 用例，含防漂移断言）
- **涉及文件**：src/{style-tokens,video-style,generate,routes}.ts（style-tokens 新）/ skills-local/canvas-studio-creation/references/look.md（+ skills/ 同步）/ tests/{style-tokens（新）,video-style}.test.mjs


#### CV-153 · 参考图静默截断加固：后端 `image2image` 只有 `image1`/`image2`/`image3` 三…

- **状态**：已完成
- **优先级**：P2
- **问题**：**参考图静默截断加固**：后端 `image2image` 只有 `image1`/`image2`/`image3` 三个具名槽位（权威来源 `docs/api-probe/archive/contract-20260910/contract.md`），第 4 张起被 `slice(0, 3)` **静默丢弃 —— 不报错、不警告**，用户看到的现象只是「风格没生效」而**毫无线索**（与 CV-145 的 1×1 占位图同属**证据缺失导致的错误归因**）。改为经既有 `warnings` 通道**显式告警**：「参考图最多 3 张生效（后端 image2image 仅 image1~image3），本次已忽略后 N 张：<文件名>」，由 `renderResult` 渲染成「注意: …」。**独立于 Look 功能，可单独验收**
- **涉及文件**：src/generate.ts（image_generate 分支 `:1104`）


#### CV-148 · Look 采集改造（Phase 0 / L0，纯文档零代码）：澄清第 ② 步由「风格大类 → 具体风格」两级追问改为…

- **状态**：已完成
- **优先级**：P1
- **问题**：**Look 采集改造（Phase 0 / L0，纯文档零代码）**：澄清第 ② 步由「风格大类 → 具体风格」两级追问改为 **Look 采集** —— 2a 提取（`list_references` 判四种来源：已建卡 / 参考视频便签 / 参考图归纳 / 原话反推 → 汇入同一份 **5 项 tokens**：色彩·光线·材质·镜头语汇·节奏）；2b 出 **1 张基调样张**确认（文案须注明「不是最终画质」，≤3 轮）；2c **仅当样张未通过时**才摆出预设表。新增分册 [look.md](../skills/canvas-studio-creation/references/look.md)（tokens 规格与 4 条判定标准 / 反推做法与示例 / 样张规则 / steer 只改 tokens 不改镜头 / 参考席位规则）；`SKILL.md` 骨架提问顺序 + 工作流第 1 步 + 入口分流 + 逐镜出图同步改写；`style-presets.md` 预设降级为「**出口**」并写死**加载风格 skill 的三种情况**、修掉残留的「第 ④ 步」编号漂移（CV-116 同类）；`consistency.md` 由「用第一张成图做风格参考」改为 **Look tokens 逐镜注入**。**硬约束**：Look 路径（参考图 / 参考视频 / 反推）**一律不加载风格 skill**（否则给古装电影套「纸艺定格」STEP）。`SKILL.md` 靠删旧内容腾空间，最终 **15073B**（闸上限 15360B）。验证：tsdown ✓ / 双端 tsc ✓ / verify:loader ✓ / test:smoke **406/406** ✓（新分册已纳入 catalog 闸门的 booklets 清单）
- **涉及文件**：skills-local/canvas-studio-creation/{SKILL.md, references/{clarification,look,style-presets,consistency}.md} / tests/skill-catalog.test.mjs / docs/acceptance-test-cases.md


#### CV-144 · 后端接口探测工具链（会话画像 + 在线契约探测）

- **状态**：已完成
- **优先级**：P2
- **问题**：后端接口探测工具链（会话画像 + 在线契约探测）
- **涉及文件**：scripts/{analyze-session,probe-api-contract}.mjs（新）


#### CV-146 · output schema 漏字段 → music_generation / compose_video 产物被丢弃…

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P0
- **问题**：output schema 漏字段 → music_generation / compose_video 产物被丢弃（已修 + 加编译期覆盖守卫）
- **涉及文件**：src/host-tools.ts


#### CV-008 · 多选半成品（拖拽只动单节点、无框选）

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P1
- **问题**：多选半成品（拖拽只动单节点、无框选）
- **涉及文件**：CanvasSurface / project-store


#### CV-061 · skill 体系目录化重构：删除 186KB 内联生成物（src/skills/generated/），sync 脚…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：skill 体系目录化重构：删除 186KB 内联生成物（src/skills/generated/），sync 脚本改为逐字节复制 h3 目录（SKILL.md 入口 + references/），注册设 resourceBase 渐进披露；顺带修复 co-op 视频回填模板（h3-video-prompt-template.md）缺失
- **涉及文件**：scripts/sync-minimax-skills.mjs / src/skills/minimax-skills.ts / skills/


#### CV-063 · creation-spec 总纲迁移为 skills-local 目录 bundle（`skills-local/c…

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：creation-spec 总纲迁移为 skills-local 目录 bundle（`skills-local/canvas-studio-creation/SKILL.md`）：消灭 TS 模板字符串与反引号转义风险，注册统一走目录扫描；测试改读文件 + 新增 skills/ 同步一致性校验
- **涉及文件**：skills-local/ / src/index.ts / tests/skill.test.mjs


#### CV-068 · 主模型无视觉，agent 直读本地图片 → DSH 抛 model does not declare image i…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：主模型无视觉，agent 直读本地图片 → DSH 抛 model does not declare image input → SKILL.md 视觉禁令护栏 + image2vl 唯一通道
- **涉及文件**：skills/canvas-studio-creation/SKILL.md / host-tools.ts


#### CV-070 · 技能卡动态预览（竞品 DA-1）→ catalog demo 字段 + 动图默认渲染 + hover 叠加操作菜单

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：技能卡动态预览（竞品 DA-1）→ catalog demo 字段 + 动图默认渲染 + hover 叠加操作菜单
- **涉及文件**：src/skill-catalog.ts / SkillCard.tsx / styles.ts


#### CV-072 · 技能广场搜索（竞品 DA-3）→ header 搜索框，title/summary/name 子串过滤

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：技能广场搜索（竞品 DA-3）→ header 搜索框，title/summary/name 子串过滤
- **涉及文件**：SkillMarket.tsx


#### CV-074 · 官方精选分区（竞品 DA-5）→ featured 两级分区（全部 + 无搜索 + 未过滤时生效）

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：官方精选分区（竞品 DA-5）→ featured 两级分区（全部 + 无搜索 + 未过滤时生效）
- **涉及文件**：SkillMarket.tsx / SkillCarousel.tsx


#### CV-076 · H3 能力角标（竞品 DA-7）→ 卡片左上角 badge + 详情弹窗同步

- **状态**：已完成（桌面验收通过）
- **优先级**：P3
- **问题**：H3 能力角标（竞品 DA-7）→ 卡片左上角 badge + 详情弹窗同步
- **涉及文件**：src/skill-catalog.ts / SkillCard.tsx


#### CV-077 · 未激活过滤 + 排序（竞品 DA-8）→ 「仅显示未装载」过滤已做，排序未做

- **状态**：已完成（桌面验收通过）
- **优先级**：P3
- **问题**：未激活过滤 + 排序（竞品 DA-8）→ 「仅显示未装载」过滤已做，排序未做
- **涉及文件**：SkillMarket.tsx


#### CV-078 · 创作者社区 CTA 收尾卡（竞品 DA-9）→ 网格末尾虚线框 CTA + 待接入角标

- **状态**：已完成（桌面验收通过）
- **优先级**：P3
- **问题**：创作者社区 CTA 收尾卡（竞品 DA-9）→ 网格末尾虚线框 CTA + 待接入角标
- **涉及文件**：SkillMarket.tsx / styles.ts


#### CV-089 · 画布选中/拖动视觉修正 → dim 语义接反修复 + 双击失效（pointer capture）+ 元信息条 + 分…

- **状态**：已完成（桌面验收通过 2026-10-13）
- **优先级**：P1
- **问题**：画布选中/拖动视觉修正 → dim 语义接反修复 + 双击失效（pointer capture）+ 元信息条 + 分辨率角标
- **涉及文件**：styles.ts / CanvasSurface.tsx / CanvasNode.tsx / VideoPlayerModal.tsx / ImagePreviewModal.tsx


#### CV-094 · 创作任务 skill 调度顺序错乱：会话复盘发现模型先即兴提问 3 轮才加载创作总纲，且风格 skill 全程未加载

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**创作任务 skill 调度顺序错乱**：会话复盘发现模型先即兴提问 3 轮才加载创作总纲，且风格 skill 全程未加载。修法=把总纲 `description` 从软约束改为硬指令（「第一个动作必须加载本规范，先于一切提问与工具调用」）+ 正文加「加载时机铁律」自救条款。自研 skill 可改，上游 9 个不动
- **涉及文件**：skills-local/canvas-studio-creation/SKILL.md / skills/ 同步副本


#### CV-097 · skill description 被静默截断 7/13（SK-04）+ 路由不可观测（SK-08）：`src/sk…

- **状态**：已完成（桌面验收通过）
- **优先级**：P0
- **问题**：**skill description 被静默截断 7/13（SK-04）+ 路由不可观测（SK-08）**：`src/skills/minimax-skills.ts:86` 对 description 硬截 `slice(0, 500)` 且全链路无日志。实测 13 个 skill 中 **7 个**正被砍（papercraft −414 最多，另有 brand-promo −300、paper-collage −273、co-op −233、music-video −203、handdrawn −185、3d-animation −94），砍掉的恰是排在最末的负向路由语（如 "Not for KOC talking-head ads…" 能力边界限定），直接削弱模型选 skill 的准确性；且初稿方案误判为「未来风险」并点错了对象（minimalist 实测仅 428 字符未被截断）。修复：上限提为具名常量 `DESCRIPTION_LIMIT = 1024`（实测 max 914 + 100 buffer；800 仍会砍 papercraft）；截断抽为纯函数 `truncateDescription(raw, limit)`，发生时 `console.warn` 报丢弃字符数；新增 `collectSkillStats()` 供注册流程与单测共用（避免测试侧重复实现 frontmatter 解析而漂移）。SK-08 同批落地：注册完成输出一行汇总 `skills registered: N total, M description truncated`。验证：截断 **7/13 → 0/13**；test:smoke **198/198**；typecheck(Host+Client) / tsdown / verify:loader 全绿
- **涉及文件**：src/skills/minimax-skills.ts / tests/minimax-skill.test.mjs


#### CV-098 · 创作任务路由硬指令常驻 system prompt（SK-01）：CV-094 把「先加载总纲再澄清」写进总纲 fr…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**创作任务路由硬指令常驻 system prompt（SK-01）**：CV-094 把「先加载总纲再澄清」写进总纲 frontmatter description，实测有效但依赖模型主动读 catalog 摘要，且硬指令挤占 description 里本该用于负向路由的字符配额。本轮改为注册常驻 system prompt 小节：新增 `src/skills/routing-prompt.ts`（导出 `SKILL_ROUTING_SECTION_NAME = 'canvas-studio:skill-routing'`、`ORDER = 150`（工具指引带 100–199）、`SKILL_ROUTING_SECTION_TEXT` 与 `registerSkillRoutingPrompt(ctx)`），`src/index.ts` inject 增加 `'systemPrompt'` 并经 `ctx.effect` 注册。指令为**条件触发式**（仅创作类请求生效 + 非创作请求豁免 + 「不改变身份」声明）——因 canvas-studio 经 bundle patch 顶层插入属全局插件，小节会注入所有会话，条件式措辞保证非创作会话不受影响（原方案验收标准 3 按此改写）。文本不含 `{{variable}}`（renderPrompt 严格解析）。测试新增 `tests/skill-routing-prompt.test.mjs` 6 用例（三要素在位 / 条件式三断言 / 无变量引用 / 总纲 skill 名存在哨兵 / 注册行为 + disposer 透传 / lib 产物防漏 build）。验证链全绿：tsdown ✓ / typecheck(Host+Client) ✓ / test:smoke **204/204**（198+6）✓ / verify:loader ✓
- **涉及文件**：src/skills/routing-prompt.ts / src/index.ts / tests/skill-routing-prompt.test.mjs


#### CV-099 · 创建项目预置画幅 + 目标时长（三处同改，砍澄清 6 问 → 3 问）：① 数据层 `StudioProject` …

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**创建项目预置画幅 + 目标时长（三处同改，砍澄清 6 问 → 3 问）**：① 数据层 `StudioProject` 增可选 `plan?: { aspectRatio?, targetDuration? }`（`contracts/project.ts`，零迁移；`PLAN_ASPECT_RATIOS` 白名单，创建 API 逐项校验，不碰 canvas.json）；② 生成侧兜底 `generateAsset` 单一入口：优先级 **显式工具参数 > 项目 plan > 全局设置**（画幅 params 补默认；时长 `perShotFallback` 把单镜 5/10s 钳到 ≤ 目标总时长，>15s 的目标不在此拆镜、由 systemPrompt 引导）；③ agent 感知：新增 `src/plan-prompt.ts`——动态 system prompt 小节 `canvas-studio:project-plan`（order 151，text 为同步 provider，per-cwd 缓存桥接异步 registry；`agent/created` 事件预热 + provider 兜底自愈刷新），注入预置值与「跳过已锁定要素 / 镜头数 ≈ 总时长÷8–10s」规则；④ 总纲澄清节重写：删第②时长/③画幅/⑤节奏/⑥受众四问，无预置（老项目）才补问；⑤ 创建弹窗（ProjectList.tsx）加画幅三段选择 + 目标时长下拉（15/30/60/自定义，可留空=不锁定）。方案：[project-preset-and-screenplay-plan.md](./project-preset-and-screenplay-plan.md)
- **涉及文件**：src/contracts/project.ts / src/projects.ts / src/routes.ts / src/generate.ts / src/plan-prompt.ts（新）/ src/index.ts / src/client/{api,contracts,index}.ts / ProjectList.tsx / styles.ts / skills-local/canvas-studio-creation/SKILL.md


#### CV-100 · 剧本创作前置（风格 skill 加载后）+ 独立审批门禁 script_review：新工作流状态 `script_…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**剧本创作前置（风格 skill 加载后）+ 独立审批门禁 script_review**：新工作流状态 `script_review`（drafting 需求澄清/规划；script_review 剧本待批准；awaiting_approval 分镜待批准；keyframe_review 关键帧待确认；executing 唯一放行态）。Host 新增工具 `write_screenplay`（「剧本」text 节点，重复调用原地更新不堆积；= 上游风格 skill 的故事大纲/story-outline/叙事主轴，总纲明令禁止另建大纲节点）与 `submit_screenplay_for_approval`（confirm → `script_review` 结束回合等批准；auto → 直接 `executing` 放行；未落剧本先提交会报错引导）。门禁：GATED_TOOLS 在 `script_review` 态报「剧本待批准」专属文案。**批准后必须回 `drafting`**（`approve_script` 路由动作）——设 executing 会让 GATED_TOOLS 放行、分镜审批被整体跳过（`reject_script` 同回 drafting，驳回意见随唤醒消息定向转述）。client：api action 扩 `approve_script/reject_script`、`approveScreenplay/rejectScreenplay`（自动唤醒 agent）、`wasWaiting` 纳入 script_review、确认条复用 `.csWorkflowApproval`（批准/驳回+意见框）、状态标签「剧本待批准」。总纲：新增「剧本创作」节（时机=风格确定并加载 skill 后；必须执行无论 skill 加载成败；唯一节点；时长对齐预置）+ 工作流 2b 步 + 工具链表 + skill-catalog 摘要更新。方案：[project-preset-and-screenplay-plan.md](./project-preset-and-screenplay-plan.md)
- **涉及文件**：src/contracts/project.ts / src/host-tools.ts / src/routes.ts / src/client/{api,contracts,index}.ts / StudioFrame.tsx / skill-catalog.ts / skills-local/canvas-studio-creation/SKILL.md


#### CV-112 · 详情弹窗 GIF 修复（CV-071 打回根因）：广场卡片 `SkillCard` 已走 `entry.demo` …

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**详情弹窗 GIF 修复（CV-071 打回根因）**：广场卡片 `SkillCard` 已走 `entry.demo` 默认显示动图，但详情弹窗 `SkillMarket.tsx:253` 缩略图仍是纯渐变 + icon（与卡片两条独立路径），导致点了「查看详情」看不到 GIF。修复：① 弹窗缩略图补 `entry.demo` 判断，有 demo 渲染 `<img>`，无 demo 仍走 icon（保持 cv-116 降级语义一致）；② 缩略图从 84×84 扩到 132×96（16:9 适配，与卡片同比例）；③ `prefers-reduced-motion` 降级（不动画敏感用户不出 GIF，与卡片对称）；④ styles 新增 `.csSkillDetailThumbGif` 套同款覆盖布局。CV-116 补的两个新 GIF 在弹窗同步生效（街采/惊吓出图，东方神话走降级 icon）。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **344/344** ✓
- **涉及文件**：src/client/SkillMarket.tsx / src/client/styles.ts


#### CV-114 · 聊天框素材引用 chip 化（右键引用 = 打 @ 选中同一产物 + hover 缩略图）：起因 = 用户报「聊天框…

- **状态**：已完成（桌面验收通过 2026-09-09）
- **优先级**：P1
- **问题**：**聊天框素材引用 chip 化（右键引用 = 打 @ 选中同一产物 + hover 缩略图）**：起因 = 用户报「聊天框打 @ 引用素材是整体 chip，画布右键引用只是一段 `@ref[标题]` 灰字，且两种都看不到缩略图」。根因：chip 是输入框草稿里的**占位字符（occurrence）**，DOM 注入纯文本物理上变不出 chip；缩略图上游也只给 `title` tooltip，无 hover API。方案（全走上游公开服务名 + runtime facade，零新依赖）：① **句柄语义升级**——`@ref[...]` 由「显示名」改为 **node id**，标题降级兜底（`findNodeByRef`，id 精确优先），彻底消除重名/改名导致引用指错或失效（旧教材与手输仍可用）；② **短句柄**——新增 `src/reference-handle.ts` 纯函数层，`img-01`/`vid-02` 按类型分别编号（不落盘、零迁移），chip 只显示短句柄，完整标题与缩略图交给 hover；③ **注册 `@` 画布素材源**——`src/client/reference-source.ts` 经 `ctx.get('inputTriggers').registerSource` 注册候选源（打 @ 能搜到画布素材，codec 序列化成 `@ref[nodeId]` 给模型，**显示文本与模型文本解耦**）；④ **右键/托盘/详情面板三入口改插真 chip**——`ctx.get('conversation').input.shell(id).insertReference`（span CAS：caret 取 textarea.selectionStart、draftRev 取 `shell.state` 快照），拿不到服务 / CAS 失败自动降级回纯文本注入；⑤ **hover 缩略图**——新增 `AssetChipPreview.tsx`：chip 在 `pointer-events: none` 的镜像层里收不到事件，故按指针坐标做**几何命中**，出卡（图片 `<img>` / 视频 `#t=0.1` 首帧封面 + 时长徽标），点卡片复用已有大图/播放器浮层。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **342/342**（+7）✓ / verify:loader ✓。**第二轮修复（同日晚，@ 分组不出现）**：根因是**注册时机**——`ctx.get(name)` 要求提供方 fiber 已 ACTIVE，而 canvas-studio 提供 `layout`（被 ui-conversation 依赖）必然先于 ui-input-trigger 起来，那一刻 `get('inputTriggers')` 恒为 undefined，注册被静默跳过（上游 ui-reference 靠静态 `inject: ['inputTriggers']` 规避）。改为 `ctx.inject(['inputTriggers'], …)` 等待式注册 + 800ms×8 轮询兜底 + 控制台留痕 `[canvas-studio] @ 画布素材源`；同时 `showGroupTitle: false` + 候选 `section: '画布素材'`（避免把内部 source id `canvas-asset` 原文当组标题显示）、`order: -1` 排在工作区文件源之前。**hover 匹配扩到四路兜底**（`findAssetByChipText`）：短句柄 → nodeId → 节点标题 → url 文件 basename（含去扩展名/去查询串/去路径），于是上游 `@` 文件源插入的 chip（label 是文件名）只要在画布上有同名素材也能出缩略图。**待验收**：桌面在输入框打 `@` 应出现「画布素材」分组；右键节点「引用到对话」应插入带文件图标的 chip（非灰字）；hover chip 出缩略图卡；发送后 agent 侧 `@ref[nodeId]` 能解析到对应 Drama 文件名。**已知限制（2026-09-09 用户确认输入框侧 OK）**：发送后消息气泡里显示序列化原文 `@ref[<uuid>]`（chip 只活在输入框草稿，历史消息渲染原始文本，上游文件引用同样显示文件名原文，行为一致非退化）；气泡美化需 hook 上游消息渲染层，暂不做
- **涉及文件**：src/reference-token.ts / src/reference-handle.ts（新）/ src/host-tools.ts / src/client/reference-source.ts（新）/ src/client/AssetChipPreview.tsx（新）/ src/client/{index,contracts,StudioFrame,styles}.ts / tests/reference.test.mjs


#### CV-115 · 已发送消息里的素材引用不可读 + 无 hover 缩略图：CV-114 验收通过但暴露遗留体验问题——chip 只活…

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**已发送消息里的素材引用不可读 + 无 hover 缩略图**：CV-114 验收通过但暴露遗留体验问题——chip 只活在输入框草稿，发送后消息气泡渲染的是序列化原文 `@ref[<uuid>]`（上游 `@` 文件引用同样显示文件名原文），**鼠标移上去也不出缩略图**，用户事后无法确认自己发的是哪张图/哪个视频。**方案 2 探明可行且成本极低（2026-09-09 已落地缩略图部分）**：查上游 `ui-conversation/src/client/chat/MessageItem.tsx:155-211` `projectUserText` 发现——用户气泡文本会被正则扫描，`@xxx` token **已经**渲染成 `<span class=refChip data-ref-chip="file" title="@ref[uuid]">`（带文件图标，显示名剥掉前导 `@`），所以气泡里那个 `ref[<uuid>]` 本来就是 chip，无需 hook 渲染层 / 覆盖 keyed 渲染器 / MutationObserver。落地：① `AssetChipPreview` 命中选择器扩到 `[data-decoration="chip"], [data-ref-chip]`，并优先读 `title`（完整原文）再回退 textContent；② `findAssetByChipText` 增加 `ref[...]`（`@` 可选）抽取后按 nodeId 精确匹配。于是已发送气泡、历史重放消息里的引用 hover 即出缩略图，点卡片开大图。**剩余 backlog**：显示名仍是裸 uuid（`img-01` 化需改序列化文本或 Host 侧投影，会动到模型侧契约，暂不做，hover 缩略图已兜住「看不出是什么」的痛点）
- **涉及文件**：src/client/AssetChipPreview.tsx / src/reference-handle.ts / tests/reference.test.mjs


#### CV-119 · H3 校验器接入工具预检：`validateH3Ir` 此前是「孤儿」（仅 CLI 可用），`video_gener…

- **状态**：已完成
- **优先级**：P1
- **问题**：**H3 校验器接入工具预检**：`validateH3Ir` 此前是「孤儿」（仅 CLI 可用），`video_generate` / `video_composite` 的 IR 格式错误要打到后端才发现、浪费一次调用。新增 `looksLikeH3Ir`（命中 ≥2 个 IR 标记才认定为 IR，纯文本 prompt 原样透传不误拦）与 `assertH3IrPrompt`（ERROR 级违规抛错取消生成，WARN 不阻断），接入两个视频工具 execute 前置；模式映射：video_generate 无图=T2VA / 单首帧=I2VA，video_composite 1 图=I2VA / 2 图=FL2VA（首尾帧）/ ≥3 图=Ref2VA；时长传与 videoRequestOf 同一套 clampDuration 的有效值（防「预检通过但后端静默钳制导致时间戳错位」）；两工具 description 同步说明预检行为。测试 `tests/h3-ir-precheck.test.mjs` 8 用例（官方 4 组 IR 放行 / 纯文本与单标记透传 / 漏段 S1、模板混用 M1、模式用错 K5、时间戳超时长 T4 拦下 / 报错含 h3-prompt-writing 修正指引）；另用实跑会话提取的 4 段真实 IR 回归全放行


#### CV-124 · 技能「使用」chip 化 + `/` 技能快捷入口：技能广场「使用」按钮此前是 DOM 注入纯文本 `使用技能「标题…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**技能「使用」chip 化 + `/` 技能快捷入口**：技能广场「使用」按钮此前是 DOM 注入纯文本 `使用技能「标题」（name）：`（无边界，删除要逐字退格）。接进 CV-114 的引用管线：① 注册 `/` 触发源 `canvas-skill`（上游 `TriggerChar='/'
- **涉及文件**：'@'`，多源可共存）——输入框**行首打 `/`** 弹技能候选（name/title/summary 匹配，section「技能」，取前 30）；②「使用」按钮改走 `insertSkillChip` 插真 chip（与菜单选中同一产物，整体可删），管线不可用降级纯文本注入（行为不退化）；③ **显示**`⚡短标题`——上游 chip 渲染把 `label[0]` 当触发字形而 ReferenceIcon 只有 session/file/folder，用 ⚡ 顶图标位得到 WorkBuddy 同款「图标+短名」胶囊；④ **提交序列化**维持 `使用技能「标题」（name）：` 逐字不变（agent 侧软激活零改动），`activateSkill` 装载逻辑保持；⑤ hover chip 出技能说明卡（SkillIcon+标题+summary，复用几何命中）；⑥ whenReady 注册骨架抽公共 `registerSourceWhenReady`（@源 //源共用）。纯函数层 `src/skill-chip.ts` + `tests/skill-chip.test.mjs`。**待桌面验收**：行首 `/` 出「技能」分组；「使用」插入 ⚡chip 整体删除；hover 出说明卡；发送后 agent 收到原文格式技能提示词
- **落地/验收**：src/skill-chip.ts / src/client/{reference-source,AssetChipPreview,StudioFrame,index,contracts,styles}.ts(.tsx) / tests/skill-chip.test.mjs


#### CV-125 · music_generation 转正：接入 Drama txt2audio（ACE Step）补 BGM 生成缺口…

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P1
- **问题**：**music_generation 转正：接入 Drama txt2audio（ACE Step）补 BGM 生成缺口**：后台提供 `POST /api/v1/generate/txt2audio`（caption_prompt/lyrics_prompt/duration/bpm/keyscale/language/timesignature，`language=unknown` 纯器乐，产物 mp3）。**注意：实测端点尚未部署**（117.50.108.73:8082 实测 404，openapi 无此路由；文档先行，代码按文档契约实现，后端上线后需 E2E 验证）。改动：① config 端点表加 txt2audio；② generate.ts 新增 `generateMusic`——参数映射（prompt→caption_prompt，lyrics 缺省空串，整数钳制）、产物下载落盘 mp3、画布节点 kind=video 复用 BGM 既有消费路径（HTML video 元素可直接播 mp3），operationType 新增 `text-to-audio`，返回 nodeId/url/filename；③ host-tools `music_generation` 从占位转正（原占位仅返回降级文案）：参数 prompt/lyrics/duration/bpm/keyscale/language/timesignature/sourceUrls，render 带 compose_video bgmNodeId 指引；`music-2.6` 即本工具的说明保留；④ compose.ts `isVideoFile` 放行音频扩展名（mp3/wav/m4a/aac/ogg/flac——原实现只认视频扩展名，与「BGM 仅支持视频/音频文件」报错文案不符，mp3 会被误拒）；⑤ placeholder-tools 只剩 tts_voiceover / subtitle_burn；⑥ skill 文档：toolchain.md 占位节改写（music_generation 可用 + 用法）、shot-format.md 第 10 步 BGM 来源指引。测试 `tests/music-generation.test.mjs` 2 用例（参数映射+落盘节点 / API 500 透传不建节点）
- **涉及文件**：src/{config,generate,compose,host-tools,index}.ts / src/contracts/canvas.ts / src/skills/placeholder-tools.ts / tests/music-generation.test.mjs / skills-local/canvas-studio-creation/references/{toolchain,shot-format}.md / skills/（同步产物）


#### CV-138 · 合成链路缺 BGM 时长对齐（三处已实测缺陷，共用同一个数）：起因＝评估「距离测音画同步还差什么」时逐行核对 `co…

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P0
- **问题**：**合成链路缺 BGM 时长对齐（三处已实测缺陷，共用同一个数）**：起因＝评估「距离测音画同步还差什么」时逐行核对 `compose.ts`。**① 成片真实时长（混音前）只差一行**：`compose.ts:331` **已经**对 concat 产物跑过一次 `ffmpeg -i`，却**只解析了 `hasAudio`、没解析 `duration`** —— 补一句 `parseFfmpegDuration(concatProbe.stderr)` 即可拿到，这正是路线 B（真实值驱动）的地基，**不需要额外一次合成、不需要新依赖**。**② 短 BGM 静默截断画面**（已实测）：`buildAmixArgs` 两分支都带 `-shortest`，无 concat 音轨分支为 `-map 0:v -map [bgm] -shortest` → 输出 = `min(画面, BGM)`。实测 6s 画面 + 2s BGM → **输出 2.000s、画面丢 4 秒、`exit=0` 无任何报错**（有音轨分支走 `amix=duration=first`，实测 6.000s 安全）。当前 fl2va 产出自带 AAC 音轨故走安全分支，但改走 fal / 静音产物即踩。**③ 长 BGM 结尾没有淡出**（已实测）：`buildBgmFade`（`:157`）把淡出点算在 `bgmDuration − 1s`，而成片会被截到画面长度 → BGM 长于成片时淡出区间**落在成片之外**。隔离 BGM 轨实测包络（BGM 20s / 成片 6s）：现状末 1s **恒定 −23.5 dB 硬切**，按成片长度算则 −24.6 → −27.5 → −31.8 → −40.3 dB 平滑衰减。触发条件是「BGM 比成片长」——**现实中为保险通常会把 BGM 生成得偏长，属最可能的默认路径**，与 `audio-acceptance-checklist.md` §4「首尾各 1 秒淡入淡出」的预期不符。**修法（②③ 共用同一个数）**：`parseFfmpegDuration(concatProbe.stderr)` 取成片时长 → `buildBgmFade(min(BGM, 成片))` 修淡出点 → 无音轨分支用 `-t <成片时长>`（或 `apad` 补齐）替代 `-shortest`。**策略已拍板（2026-09-10，用户）**：**BGM 短于成片 → 报错终止**（不循环铺满、不拉伸——两者都是「听得出错」的降级，报错让人做对）。**另两处同批定稿**：淡出锚点改 `min(BGM, 成片真值)`；无音轨分支 `-shortest` 改 `-t <成片真值>`。落地清单与示例见 [av-sync-implementation-plan.md](./av-sync-implementation-plan.md) §1 / §3.2。详见 [archive/av-sync-test-readiness.md](archive/av-sync-test-readiness.md) §1.1~§1.3
- **涉及文件**：src/compose.ts（`:157` `:194-205` `:331` `:335`）/ tests/compose.test.mjs / docs/archive/av-sync-test-readiness.md  —— **2026-09-10 已落地**：`compose.ts` 原有的 concat 探测补一行 `parseFfmpegDuration` 即得成片真值（零额外进程、零依赖），一个数同时解掉三件事——① 守卫 `bgmShortfallMessage`（容差 0.05s + 浮点容差；短于成片抛中文错、**不落半成品**）；② 淡出锚点改 `fadeAnchorOf` = min(BGM, 成片)；③ 输出时长改 `-t <成片真值>`（真值不可得才回退 `-shortest` 并留 warning）。


#### CV-139 · 音画同步测试就绪度评估：新建 archive/av-sync-test-readiness.md，回答「距离能测音画…

- **状态**：已完成
- **优先级**：P1
- **问题**：**音画同步测试就绪度评估**：新建 [archive/av-sync-test-readiness.md](archive/av-sync-test-readiness.md)，回答「距离能测音画同步还差哪些工作」。**核心结论**：现在能跑一次合成、**不能做同步测试** —— 缺的是**可信时间基准**而非播放按钮（画布 / `list_shots` / 时间线上的时长数字**全是请求值**，`generate.ts:193/1352`）。**判据分层**：L1 时长对齐（`\
- **涉及文件**：音轨−视频\
- **落地/验收**：≤ 1 帧`）/ L2 起播对齐 / L3 节奏对齐（需 beat grid，未做）；**L1/L2 的共同前提是必须能关闭各镜原生音轨** —— 否则 H3 原生音轨（后端默认产出）与 BGM 经 `amix` 叠在一条轨上，既听不出 BGM 是否被截断、也量不出落点。**清单按阻塞关系分三档**：P0 做完才能测（真值探测 / 结构化时间轴 `declaredDuration`+`declaredFrames` / BGM 守卫，= CV-131 的 P0 与 P2/P3）、P1 做完才测得准（音轨开关 / 时长可见化 / 节拍实算）、P2 做完才好验收（时间线刻度+音轨轨道 = CV-007、合成 UI 的 BGM 选择器 = CV-006）。**连带纠正一处过期文档结论**：`audio-acceptance-checklist` 原写「合成 UI 入口没有、`composeStudioVideo()` 无调用点」——实测**入口已存在**（时间线导出按钮 → `StudioFrame.tsx:563`），真正缺的是**第三参 `bgmNodeId` 没传**（服务端 `routes.ts:1123` 与客户端 SDK 均已支持），属接线缺口而非能力缺口。**最小可测路径**：C 通道（audio reference 引导画面）现在就能端到端跑；A 通道需先做 CV-138 | docs/archive/av-sync-test-readiness.md（新）/ docs/audio-acceptance-checklist.md / docs/av-timeline-plan.md


#### CV-140 · 生成路径接入真实时长探测（节点 `duration` 存真值，请求值另存 `declaredDuration`）：全…

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P0
- **问题**：**生成路径接入真实时长探测（节点 `duration` 存真值，请求值另存 `declaredDuration`）**：全线「时长不可信」的根因 —— `generate.ts:1352` 直接写 `clampDuration(params.duration, …)`（**请求值**），生成主路径**从不** ffprobe（`parseFfmpegDuration` 只被 `compose.ts:330/351`、`video-frames.ts:102`、`video-style.ts:147` 调用）。后果：画布角标 / `list_shots` / 时间线显示的时长可能一直是错的，而「音画同步」正是拿它当基准。**可行性已核实**：产物**本就在生成时下载落本地**（`:1291 downloadBytes` → `:1302 writeFile(join(directory, filename))` → `:1306` 拼同源 url），所以探测**不需要新下载、不需要新依赖**——在 `:1302` 之后对本地文件跑一次 `runFfmpeg -i` 即可。**改法**：`duration` 存真值、新增契约字段 `declaredDuration` 存请求值；探测失败（0）回退请求值并写 `warnings`，不阻断生成；音频节点同办（`music_generation` 的 mp3 也是本地文件，现注释写「≈请求值 ±0.03s」可换成真值）。**为何必须第一步**：BGM 要在合成前生成，agent 只有先拿到「成片 = 15.500s」这个真值才可能生成足够长的 BGM（否则每次都先报错再重试）。依赖方：CV-138（守卫的成片真值）、CV-141（时长可见化）、CV-142（和校验）
- **涉及文件**：src/generate.ts（`:1291` `:1302` `:1306` `:1352`）/ src/contracts/canvas.ts / src/host-tools.ts（`list_shots` 渲染）/ tests/{generate,music-generation}.test.mjs  —— **2026-09-10 已落地**：新增 `probeMediaDuration`（`src/ffmpeg-run.ts`，**探测失败恒返回 0、绝不抛错**，ffmpeg 缺失也不阻断生成）；视频与音频产物落盘后探真值 → 节点 `duration` 存真值、新增 `declaredDuration` 存请求值；CV-108 判重指纹仍用请求值（同输入必同请求时长，指纹稳定）。


#### CV-141 · H3 原生音轨自动策略（单镜保留 / 多镜全丢）+ 单镜合成解禁 + amix 配平：用户拍板 —— 「成片是一镜整…

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P0
- **问题**：**H3 原生音轨自动策略（单镜保留 / 多镜全丢）+ 单镜合成解禁 + amix 配平**：用户拍板 —— 「**成片是一镜整出的就保留（最和谐），是多分镜拼接的就都丢弃**」。判据取**本次合成纳入的片段数**（`resolvedClips.length`）：1 = 同一次生成的画面连续、环境声前后一致；≥2 = 各镜环境声互不连续、硬拼会「跳」。**可行性已实测**：单条 concat 清单可用（`ffmpeg -f concat` 单入口 → 6.023s、aac 音轨保留 ✓）。**改动三处**：① `keepNativeAudio = resolvedClips.length === 1` → 转码阶段 `buildTranscodeArgs(..., hasAudio && keepNativeAudio)`，多镜每段加 `-an`（丢在转码而非事后 mute，这样 concat 天然无音轨、下游自动走「BGM 单轨」分支，链路自洽）；② **解开 ≥2 硬闸** —— `host-tools.ts:1460`（`至少需要 2 个视频片段才能合成成片`）与 `StudioFrame.tsx:558`（时间线导出按钮 toast）都改 `>= 1`，工具描述同步（单片段 = 一镜成片，合法）；**旧版单镜根本走不到合成**，这是该策略的前置；③ **混音配平** —— 实测 `amix` 默认 `normalize=1` 把**每一路各乘 0.5（−6dB）**（单路 −33.12dB → 输出 −36.99dB；`normalize=0` 为线性求和 −30.97dB），单镜混音改 `amix=inputs=2:duration=first:normalize=0` + BGM 混音音量单取（建议 0.35，环境声留前景）；多镜「BGM 单轨」分支不走 amix，沿用 `BGM_VOLUME = 0.8` 不变。**取代**原 P1-4「合成时加音轨开关」——策略自动化后无需用户手选，少一个 UI 面。**待确认 ①**：多镜 + 不给 BGM = 全片无声，倾向「允许 + 结果里明确警告」而非硬拦
- **涉及文件**：src/compose.ts（`buildTranscodeArgs:125` `buildAmixArgs:171` `composeStudioVideo:224`）/ src/host-tools.ts（`:1444` `:1460`）/ src/client/StudioFrame.tsx（`:556`）/ skills-local/canvas-studio-creation/references/toolchain.md / tests/compose.test.mjs  —— **2026-09-10 已落地**：`keepNativeAudio = resolvedClips.length === 1`，转码传 `clip.hasAudio && keepNativeAudio`；**解开 ≥2 硬闸的其实是三处**（工具 `compose_video`、时间线按钮 `CanvasTimeline.tsx`、导出按钮 `StudioFrame.tsx`——第三处是实施时才发现的，只改计划里那两处仍会把单镜挡在门外）；混音分支改 `amix=inputs=2:duration=first:normalize=0` + `BGM_MIX_VOLUME = 0.35`（BGM 单轨分支不走 amix，仍 `BGM_VOLUME = 0.8`）。**待确认 ① 已拍板**：多镜无 BGM = 允许 + 结果里明确警告（不硬拦）。


#### CV-142 · 结构化时间轴校验（分镜表声明时长/帧数 vs 目标总时长 vs 成片真值）：CV-131 列的「四个断点」中的第 ①…

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P0
- **问题**：**结构化时间轴校验（分镜表声明时长/帧数 vs 目标总时长 vs 成片真值）**：CV-131 列的「四个断点」中的第 ① ② —— 分镜表「时长」列目前是**纯文本**写在分镜卡正文（`host-tools.ts:404` 一带），与 `targetDuration`（`contracts/project.ts:102`）之间**只有 skill 自检条款、无工程校验**；请求时长与真实产出也从不比对。**改法**：`submit_storyboard_for_approval` 解析出每镜 `declaredDuration` + `declaredFrames`，与 `targetDuration` 做和校验，偏差超阈值 → 在成片结果里 `warnings` 显式报出（如「分镜合计 15s / 360 帧，成片真值 15.500s，差 0.5s」）。**价值**：让「时长漂移」在合成时就显形，而不是等用户听见不同步。可与其他步骤并行，优先级最低（不挡同步测试，只提高可解释性）
- **涉及文件**：src/generate.ts（`videoRequestOf`）/ src/host-tools.ts（分镜卡解析）/ skills-local/canvas-studio-creation/references/shot-format.md / tests/storyboard*.test.mjs  —— **2026-09-10 已落地**：分镜卡解析出 `declaredDuration`/`declaredFrames`（`parseShotDurationSeconds` 容错 `5s` / `5 秒` / `约 5 秒` / `00:05`，帧率 24fps）；合成时 `auditTimeline` 做**三组对照**——请求↔成片真值（阈值 0.25s，单镜 0.167s 量化偏差不打扰、多镜累计 0.5s 必报）/ 分镜声明↔实际请求（agent 没照分镜表传 duration）/ 成片真值↔项目 `targetDuration`，逐条进 `warnings` 回流给 agent 与用户。


#### CV-143 · 时长与音轨构成可见化（成片/片段节点角标）：同步是「看得见」才可验收

- **状态**：已完成（桌面验收通过 2026-09-11）
- **优先级**：P1
- **问题**：**时长与音轨构成可见化（成片/片段节点角标）**：同步是「看得见」才可验收。节点角标显示**真实时长**（沿用 CV-140 的真值，如 `15.50s`）+ **音轨构成**标签（`环境声+BGM` / `纯 BGM` / `无声` / `环境声`），由合成结果带回并落节点字段。**理由**：验收时可一眼确认「成片 15.50s、纯 BGM、头尾有淡化」，不必回溯日志；也是 CV-141 策略是否生效的最直接证据
- **涉及文件**：src/client/canvas/CanvasNode.tsx / src/contracts/canvas.ts / src/compose.ts（结果回传）  —— **2026-09-10 已落地**：`ComposeResult.audioComposition` ∈ `native` / `native+bgm` / `bgm` / `none`，随成片节点落盘（`StudioCanvasNode.audioComposition`）；节点右下角标显示中文标签（`环境声` / `环境声 + BGM` / `纯 BGM` / `无声`，无声标红）+ 悬停解释；工具结果文案、toast、`warnings` 三处同步展示——**「成片无声」这种结论不能只挂在角标上**。


#### CV-109 · 需求澄清推荐偏置修复 + 风格预设表扩容（8→11）：用户报「风格大类推荐不准，且从技能广场点名技能后澄清仍重复问风…

- **状态**：已完成（桌面验收通过）
- **优先级**：P2
- **问题**：**需求澄清推荐偏置修复 + 风格预设表扩容（8→11）**：用户报「风格大类推荐不准，且从技能广场点名技能后澄清仍重复问风格」。根因：①总纲示例硬编码「动画叙事（推荐）」致模型照抄；②推荐无判定规则（纯模型自由裁量）；③项目预置只锁画幅/时长（CV-099），无「已点名风格跳过」豁免。修复（全在 canvas-studio-creation/SKILL.md 文案层）：①示例去偏置（四项均不带推荐）+ **推荐决策表**（关键词→大类映射，命中才标推荐且须附一句理由，拿不准不标）；②**已点名风格跳过规则**（软激活点名技能或明确说出风格时跳过风格两题，skill 照常加载）；③风格预设表新增 东方神话视觉导演 / 街采跟拍 / 惊吓遭遇战 三行，分类对照同步（艺术创意扩为 4 项）。同日立项 CV-110（确认式澄清）进 backlog 作长期方案。验证链：sync ✓ / test:smoke 332/332 ✓
- **涉及文件**：skills-local+skills/canvas-studio-creation/SKILL.md / docs/canvas-studio-optimization-backlog.md


#### CV-204 · 成片血缘并入 BGM/文案：`compose_video` 落盘与客户端时间轴导出两条路径的成片 `sourceId…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**成片血缘并入 BGM/文案**：`compose_video` 落盘与客户端时间轴导出两条路径的成片 `sourceIds` 此前只含 clipIds，`bgmNodeId`/`scriptId` 只被消费（混音 / 内嵌 script 快照）不进血缘 ⇒ 图上读不出「成片 ↔ BGM ↔ 文案」这组关系；合并逻辑收口为共享纯函数 `composedSourceIds`（两处各自手写的 `new Set` 展开按「同一规则只准一份实现」归一）。**真实画布取证**：罗大佑风格测试（2026-09-21）成片 v1 血缘 5 条（3 分镜视频 + BGM + 文案）✓。**测试**：`tests/lineage-completion.test.mjs`（纯函数 4 断言 + 两条路径源码接线守卫，防内联展开复活）
- **涉及文件**：`src/compose-selection.ts`（+composedSourceIds） / `src/host-tools.ts` / `src/client/StudioFrame.tsx` / `tests/lineage-completion.test.mjs`（新）
- **落地/验收**：2026-09-21 落地 + 补测


#### CV-205 · 分镜卡血缘优先剧本：`submit_storyboard_for_approval` 的卡片 `sourceIds`…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**分镜卡血缘优先剧本**：`submit_storyboard_for_approval` 的卡片 `sourceIds` 硬编码 `[创意]`（CV-025 时代约定，星形直连稀释「谁直接推导出谁」）改为**优先 `write_screenplay`**、无剧本回退创意、两者皆无保持空。**真实画布取证**：罗大佑风格测试 18 张分镜卡全部挂剧本 ✓
- **涉及文件**：`src/host-tools.ts`（execute 选父逻辑） / `tests/lineage-completion.test.mjs`（端到端三态：剧本优先 / 回退创意 / 双无空血缘）
- **落地/验收**：2026-09-21 落地 + 补测


#### CV-206 · 产出类血缘显式参数：`music_generation` 增 `sourceNodeIds`（与 `sourceUr…

- **状态**：已完成（桌面验收通过）
- **优先级**：P1
- **问题**：**产出类血缘显式参数**：`music_generation` 增 `sourceNodeIds`（与 `sourceUrls` URL 反查取并集、过滤画布不存在的幽灵 id）+ 空血缘兜底挂场上 `write_script` 节点（BGM 的策略出处）。**真实画布取证**：罗大佑风格测试后 2 条 BGM 挂文案 ✓；**首条 BGM 早于文案落盘时兜底扑空**（时序边界）→ 另立 CV-221
- **涉及文件**：`src/generate.ts`（generateMusic 血缘归并 + 兜底） / `src/host-tools.ts`（sourceNodeIds 参数） / `tests/lineage-completion.test.mjs`（并集过滤幽灵 + 兜底两态）
- **落地/验收**：2026-09-21 落地 + 补测
