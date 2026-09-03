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
