# 画布客户端 UX 待办清单（Canvas UX Backlog）

> 来源：2026-08-28 对 `src/client/` 全部画布组件的代码级审查（含 StudioFrame / project-store / question-capture）。
> 用途：作为画布逐步优化的追踪清单。每处理完一项，更新对应「状态」列并在文末「变更记录」追加一行。
>
> 状态取值：`待处理` / `进行中` / `已完成` / `已否决`（附原因）。
> 优先级：`P0`（bug / 功能断裂）> `P1`（核心工作流缺口）> `P2`（体验优化）。

## P0 — 真 bug / 功能断裂

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-001 | 已完成 | P0 | 文本类节点（sticky/text/prompt）创建后**无法编辑正文**：工具栏创建的节点正文永远是默认值；详情面板只有改名等属性，没有正文编辑入口；双击打开的也是该面板 | `CanvasNode.tsx`（只读渲染 L181-188）、`LayerDetailPanel.tsx`、`project-store.ts`（缺 updateText 动作） | 已实现（D1 方案 A）：双击文本类节点进入节点内联 textarea 编辑（失焦/Enter 提交、Shift+Enter 换行、Escape 取消）；详情面板新增「正文」textarea 编辑区（失焦提交、key=node.id 防跨节点草稿串位）；正文经 updateNode 写回并持久化 |
| CV-002 | 已完成 | P0 | `ask_user_choice` 的 `allowFreeText` UI 丢失：Host 工具支持自由输入（品牌名等开放要素），数据带字段但点选卡片只渲染选项按钮 | `question-capture.tsx`（QuestionNodeView L83-98） | 已实现：`allowFreeText=true` 时渲染自由输入框 + 提交按钮（Enter/点击提交，复用 `.csQuestionFree` 样式），答案走同一条 `onAnswer` 通道；本地 submitted 先行锁定提交态防重复提交（工具结果回流前） |
| CV-003 | 已完成 | P0 | Minimap 跳转用 `window.innerWidth/innerHeight` 计算视口居中；画布是三栏布局的中间列，居中会**系统性偏移**（把左右栏宽度算进去） | `Minimap.tsx`（jumpTo L68-79） | 已实现：Minimap 新增 `viewportWidth/Height` props；CanvasSurface 经 ResizeObserver 实测容器 `clientWidth/Height` 传入；跳转居中与视口框均改用实测值（首帧未就绪回退 window 尺寸） |
| CV-004 | 已完成 | P0 | 操作/类型标签三处重复定义且已漂移：`storyboard-split` 在 `CanvasEdges.OPERATION_LABELS` 有中文标签，但 `CanvasNode.OPERATION_LABELS` 漏掉 → 详情面板显示原始英文 key；`KIND_LABEL` 也有 3 份 | `CanvasNode.tsx`、`CanvasEdges.tsx`、`LayerPanel.tsx`、`LayerDetailPanel.tsx`、`CanvasTimeline.tsx` | 已实现：抽取共享模块 `client/canvas/labels.ts`（KIND_LABEL + 全量 OPERATION_LABELS，补齐 storyboard-split），五处组件统一引用；新增类型只改 labels.ts |
| CV-030 | 已完成 | P0 | 双击图片打开详情面板后，`detailOpen` 置 true 即不再复位；渲染条件只看 `selectedNode && detailOpen` → 之后**单击**任何其它节点，详情面板直接切到该节点（单击即开详情，与双击语义冲突）。同理详情面板的标题编辑草稿（titleInput）跨节点不重置 | `StudioFrame.tsx`（detailOpen 状态 + 渲染条件）、`CanvasNode.tsx`（titleInput 初始化） | 已实现：`detailOpen: boolean` 改为 `detailNodeId: string | null`，渲染条件改为 `selectedNode.id === detailNodeId`——单击其它节点面板不再跟随（面板卸载，标题草稿串位一并消除）；关闭/删除/时间轴跳转清空，右键菜单改名/改提示词按 id 打开。2026-08-28 用户验收发现 |
| CV-031 | 已完成 | P1 | 经关键帧生成视频时，视频节点应同时连关键帧与分镜卡，实际只连其一。两种实测断裂模式：① 旧项目（如 8f5e7481）模型漏传 `shotRefs` → 只连关键帧；② VideoOut 项目模型按 skill 第 7 步把关键帧重新 `upload_image` 拿新 filename → filename 反查不中关键帧 → 只连分镜卡 | `generate.ts`（血缘组装）、`host-tools.ts`（upload_image） | 已实现（确定性双修复）：① `inheritShotCardIds`——来源节点挂着分镜卡时自动并入父集合（只上溯一层、只认分镜卡）；② `backfillUploadFilename`——upload_image 上传画布资产时把 Drama 新 filename 回写对应节点，filename 反查不再断链 |
| CV-033 | 已完成 | P0 | 删除项目后重建同名项目报 `workspace rename failed: workspace-name-conflict`：删除项目只删目录，打开项目时注册的 DSH workspace（`workspaces.create` + `rename` 项目名）残留占名（2026-08-28 用户实测复现） | `client/index.ts`（deleteProject / openProject） | 已实现双修复：① deleteProject 同步摘除绑定 path 的 workspace；② openProject rename 前清理同名孤儿 workspace（同名且 path 不属任何现存项目），历史残留也被救回 |
| CV-034 | 已完成 | P0 | 启动后「对话有内容、画布空、项目列表无选中」三不一致：画布映射只看 `recentWorkspaceId`（按「会话最新的 workspace」推导），孤儿 workspace（删项目残留）的空会话把它带偏，与当前恢复的会话脱节（2026-08-28 用户实测复现） | `client/index.ts`（resolveActiveProjectId / 订阅） | 已实现：映射优先级改为「手动选中 > 当前会话 cwd（session summary 自带，画布真正跟随对话区）> recentWorkspaceId 兜底」；会话列表变化也接入同步订阅（原只对齐启动会话） |
| CV-035 | 已完成 | P2 | 画布背景网格颜色偏深，视觉噪音大（2026-08-28 用户反馈） | `styles.ts`（csCanvasSurface 网格背景） | 已实现：网格线改 `color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent)`，保持跟随明暗主题；格子尺寸 40px 不变（`CanvasSurface.tsx` 的 `backgroundSize`） |
| CV-036 | 待讨论 | P1 | 项目没有「已完成」标记：用户无法区分进行中与已完成的项目（2026-08-28 用户提出，设计方案待拍板，见下方讨论记录） | `projects.ts`（project entry）、`ProjectList.tsx`、`StudioFrame.tsx` | 建议方案 A（手动标记 + 成片信号辅助）：① project entry 增 `completedAt?: number`；② 项目列表行 + 画布工具条均可切换「标记完成」，列表行显示 ✅ 徽章、可选沉底排序；③ 画布出现成功的成片节点（compose/video-composite 产物）时 toast 提示「标记为已完成？」——成片是信号不是自动状态，手动确认才落标记；可随时取消。备选方案 B（全自动：有成片即已完成）——不推荐，迭代返工的项目会被误标 |
| CV-037 | 已完成 | P0 | 节点右键菜单所有项点击无效（2026-08-28 用户反馈「目前都是不可用的」）。根因已代码验证：菜单的关闭监听是 window `mousedown`（StudioFrame menu effect），点击菜单项时 mousedown 先冒泡到 window → `setMenu(null)` 菜单卸载 → 按钮的 click 永不触发 → 动作全部丢失 | `StudioFrame.tsx`（menu 关闭监听）、`CanvasContextMenu.tsx`、`src/canvas-actions.ts`（新增）、`tests/canvas-actions.test.mjs`（新增） | 已实现：① `CanvasContextMenu` 改 `forwardRef`，根 div 挂 ref；② StudioFrame 新增 `menuRef`，mousedown 命中菜单内部时放行（判定抽为纯函数 `shouldKeepMenuOpen`，可单测），菜单项 onClick 内自行「先关闭再执行」；③ 补 Escape 关闭。测试 100/100 |
| CV-038 | 已完成 | P2 | 手动拖拽连线（节点右缘 link handle）起草线有两个问题：① 起始位置不对——起点用的是指针按下位置而非来源节点右缘中点，视觉上与正式边的锚点不一致；② 起草线是直线（`M ... L ...`），落定后却是贝塞尔曲线，前后不一致（2026-08-28 用户反馈） | `CanvasSurface.tsx`、`src/canvas-geometry.ts`（新增，Host/Client 共享几何模块）、`CanvasEdges.tsx`、`tests/canvas-geometry.test.mjs`（新增） | 已实现：① 抽出共享几何模块（`edgeAnchor` / `edgePath`），起草线起点锚定来源节点右缘中点，draft path 用与正式边相同的 C 贝塞尔（指针在来源左侧时镜像控制点，避免曲线打结）；② 正式边同步改用同一模块渲染，两边不可能再漂移；tsconfig.client.json include 补 `src/canvas-geometry.ts`。测试 113/113 |
| CV-039 | 待处理 | P1 | skill 的 H3 提示词规范是官方版的粗糙子集，声音设计能力完全没启用：H3 原生联合生成音视频（32kHz 立体声），对白（`(S1)` 说话人 ID + `<d>[语言]台词</d>`）、BGM（`non_diegetic_music` 字段）、环境音效（`overall_soundscape` 字段）、画面内文字（引号标注）都由提示词驱动，但 creation-spec 只教了画面描述。官方规范来源：MiniMax-H3 开源仓库 `skills/h3-prompt-writing/references/`（base-en.txt / ref-en.txt） | `skills/creation-spec.ts`（H3 提示词规范 + 镜头词汇）、必要时 `generate.ts`（提示词组装） | 升级为官方三字段结构：`integrated_multimodal_description`（画面+对白+画内声，含 `[Shot N] At MM:SS.mmm` 切镜时间戳）+ `overall_soundscape`（1–4 句环境音总结）+ `non_diegetic_music`（1–3 句画外配乐，禁抽象情绪词）；运镜三维表达（类型+幅度+速度，自然英语句式）；对白说话人 ID 与口型同步规则；画面文字引号规范；Ref2VA 模式补六段结构（`<Subject N>`/`<Picture N>`/`<Video N>`/`<Audio N>` 标签体系 + retention_analysis）。write_script 的对白/BGM/音效说明直接映射进三字段——文案节点成为声音设计的叙事锚点 |
| CV-040 | 待处理 | P1 | 多段拼接的成片音轨断裂：每段视频独立生成时音轨互不相干，拼起来 BGM/节奏对不上。官方解法（H3 开源仓库 MV skill）：锁一条全局 Master Audio（完整 BGM/歌曲）为唯一基准 → 分镜各自生成（提示词的 BGM 字段保持全局一致）→ 剪辑装配时全部对齐 Master Audio 时间线。注意：仍需一步「对齐+拼接」音频装配，但不是「生成」——ffmpeg amix/concat 可做（`compose.ts` 的 `buildAmixArgs` 已有半成品与测试） | `compose.ts`、`host-tools.ts`（compose_video）、可选音频节点 UI（用户上传/指定 BGM 文件） | 分三步：① compose_video 支持传入 Master Audio（音频节点或文件），装配时以 Master Audio 音轨为准、视频段静音拼接或 ducking；② skill 教 Agent 在分镜前先锁定全局 BGM 描述并落成节点；③ 音频节点 kind=audio 最小闭环（上传/列表/选择），替代 bgmNodeId 传文件名的临时态 |
| CV-041 | 待处理 | P2 | 官方 H3 提示词技能未接入：`h3-prompt-writing` 是纯 Markdown + 本地参考文件技能，官方明示 agent-portable（Claude Code/任意 harness 可用，无外部 API 调用），`npx skills add https://github.com/MiniMax-AI/MiniMax-H3 --skill h3-prompt-writing` 即装 | DSH skill 注册链路、`skills/` | 安装为画布创作的辅助 skill（与 creation-spec 并存：creation-spec 管流程编排，h3-prompt-writing 管提示词细节），Agent 生成提示词时可引用其 references/ 下两份指南原文。与 CV-039 互补：039 是内化进流程规范，041 是保留官方全文供深查 |
| CV-042 | 待处理 | P2 | 风格化画面文字能力未规划：H3 可把文字直接生成进画面（标题、霓虹灯牌、歌词字卡，MV skill 的 Typography 体系专门教这个——文字是空间化设计元素而非字幕条），我们的分镜表/文案结构里没有「文字层」概念 | `skills/creation-spec.ts`（分镜表增加文字列或文案节点结构） | 分镜表格式增加可选「画面文字」字段；借鉴 MV skill 的 Typography 三卡隔离原则（字体卡只管文字包装风格，不污染人物/场景卡；文字不遮眼部和口型）；对白精准字幕（SRT 转写+烧录）明确排除在 H3 能力外，等真需求再立项 |
| CV-043 | 待处理 | P2 | Ref2VA 的音频参考与音频复用能力未利用：音频参考（≤3 段，仅风格/音色/节奏参考，不能独立输入）、音频复用（视频编辑/续接场景保留原声）。对应场景：用户上传参考视频时抽其音轨做 BGM 风格参考；续接生成保留原片声音 | `generate.ts`（Drama 请求体）、`video-style.ts`（抽帧已有，抽音轨同理 ffmpeg 可做）、skill | 远期记录。前置依赖：CV-039（提示词规范）与 CV-040（Master Audio）落地后再评估 |

## P1 — 功能缺口（核心工作流）

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-005 | 待处理 | P1 | 血缘连线**只能加不能删**：手动 link 后无 UI 移除单条边（sourceIds 无编辑入口）；Agent 画错血缘同样无法修正 | `CanvasEdges.tsx`、`CanvasContextMenu.tsx`、`project-store.ts` | 点击边高亮 + Delete 删除；或详情面板加「来源列表」逐项 ×。见决策点 D3 |
| CV-006 | 待处理 | P1 | compose **无法排除片段**：导出固定取时间轴上全部 kind=video（StudioFrame handleComposeExport）；废弃片段必须删除才能排除；工具支持 `bgmNodeId` 但 UI 无 BGM 选择器（代码注释自认「第一版从简」） | `StudioFrame.tsx`、`CanvasTimeline.tsx` | 时间轴 chip 加**勾选态**（默认勾选），compose 只取勾选项；工具条加 BGM 节点选择器 |
| CV-007 | 待处理 | P1 | 时间轴语义混乱：便签/文本/分镜表 chip 与媒体混排、可拖排序，与成片无关；只有「视频片段 N」计数，**无总时长**显示 | `CanvasTimeline.tsx` | 非媒体节点折叠/置灰不可拖；chip 显示各自 duration；工具条显示总时长 Σ。与 CV-006 一并做。见决策点 D2 |
| CV-008 | 待处理 | P1 | 多选是半成品：只能 ctrl 点选；**拖拽只移动被按下的单个节点**（gesture 仅带单 nodeId）；group 节点拖动不带动 children；无框选（marquee） | `CanvasSurface.tsx`（Gesture / onNodePointerDown / onPointerMove）、`project-store.ts`（moveNode） | gesture 支持多 id 集合整体移动；group 拖动带动 parentId 成员；补 marquee 框选 |
| CV-009 | 已完成 | P1 | 图层面板选中不定位：时间轴点击会居中跳转（focusNodeId），LayerPanel 点击只改选中——节点在视野外时用户找不到 | `LayerPanel.tsx`、`StudioFrame.tsx` | 已实现：LayerPanel onSelect 复用 focusNodeId 机制，点击行同步居中定位（同 id 重复点击不重复跳转，沿用 surface 的 lastFocused 防抖） |
| CV-010 | 已完成 | P1 | loading 节点无时间感：视频生成 5–10 分钟只有不确定进度条，无法区分「正常」与「卡死」 | `CanvasNode.tsx`（isLoading overlay） | 已实现：overlay 追加已耗时 MM:SS（以节点 createdAt 为起点，每秒跳动）；超过 3 分钟追加「可在详情面板或右键菜单打断」提示 |

## P2 — 信息展示优化

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-011 | 待处理 | P2 | 画布上看不出节点是否为参考图（要切托盘/详情）；参考托盘空时直接不渲染，新用户不知道该能力存在 | `CanvasNode.tsx`、`StudioFrame.tsx`（referenceNodes.length > 0 才渲染托盘） | 参考节点加角色色点角标；托盘空态显示引导文案 |
| CV-012 | 已完成 | P2 | 生成参数是原始 JSON：详情面板 `<pre>` 直出，prompt 恰是用户最想看/复制的字段；steer 编辑框预填为空，用户要自己从 JSON 里抠提示词 | `LayerDetailPanel.tsx`（L234-239、L264-282） | 已实现：解析 generationPrompt 为「提示词（可复制）/ 参考图缩略图（filename 反查节点）/ 参数行 / 原始 JSON 折叠」四段；steer 输入框预填当前 prompt |
| CV-013 | 已完成 | P2 | 导入节点分辨率永远「未知」（落盘不探测），详情面板「分辨率」显示错误（2026-08-28 用户截图确认） | `StudioFrame.tsx`、`project-store.ts`（addImportNode） | 已实现：上传落卡前 createImageBitmap 探测真实宽高，直接写入 mediaWidth/mediaHeight；媒体加载回调（onMediaNatural）对缺失分辨率的存量节点自动回填（生成节点原本就有值不受影响） |
| CV-014 | 已完成 | P2 | 边 chip 无 LOD：节点一多每条边中点都挂中文 chip，低缩放下噪音大 | `CanvasEdges.tsx` | 已实现：scale < 0.6 时隐藏 chip 只留线；选中节点相关边 chip 始终保留。与 CV-032 一并实施（chip 反向缩放，屏幕尺寸恒定） |
| CV-032 | 已完成 | P2 | 血缘连线宽度是画布空间固定值（3.5 用户单位），缩放后是 SVG transform 的一部分——小缩放（如 0.3x）下线宽不足 1px 几乎不可见（2026-08-28 用户截图反馈） | `CanvasEdges.tsx`、`CanvasSurface.tsx` | 已实现：线宽/箭头/chip 按 1/scale 反向补偿，屏幕尺寸恒定（线宽恒 3.5px、高亮 5px）；箭头 marker 默认随 strokeWidth 缩放自动跟随；普通边透明度 0.5→0.6 |
| CV-015 | 待处理 | P2 | 错误/成功提示用 `window.alert`（阻塞式原生弹窗）：上传失败、成片成功、合成失败全是 alert | `StudioFrame.tsx`（多处） | 引入轻量 toast（3s 自动消失）；成片成功 toast 配「定位到节点」动作 |

## P2 — 交互补全

| ID | 状态 | 优先级 | 问题 | 涉及文件 | 改进意见 |
| --- | --- | --- | --- | --- | --- |
| CV-016 | 待处理 | P2 | 右键空白处无菜单（不能在光标处新建便签/粘贴）；addNode 固定落点 | `CanvasSurface.tsx`、`StudioFrame.tsx` | 空白右键菜单：在此处新建便签/文本/提示、粘贴、适配视野 |
| CV-017 | 待处理 | P2 | 方向键不能微调选中节点位置（画布类产品标配：1px，Shift+方向 10px） | `CanvasSurface.tsx`（keydown 处理器） | 方向键微调 + 持久化 |
| CV-018 | 已完成 | P2 | 失败节点本体没有就地「重试」按钮——错误 badge 不可点，要开右键或详情 | `CanvasNode.tsx`、`CanvasSurface.tsx`（透传 `onRetry`）、`StudioFrame.tsx`、`src/canvas-actions.ts`（新增） | 已实现：失败徽章兼作重试按钮（文案「生成失败 · 点击重试」，直接重放不加确认弹窗）；可见性判定抽为纯函数 `canRetryNode`，与 client 侧 `rerunNode` 的重放前置检查（`toolName` + `generationPrompt` 齐备、非 loading）保持一致 —— 可点的必然真能重放；无重放参数的失败（上传失败等）仍是不可点徽章 |
| CV-019 | 待处理 | P2 | 无「缩放到选中」（zoom to selection）；双击空白 = fitToContent 的习惯也未支持 | `CanvasSurface.tsx`（CanvasSurfaceHandle） | handle 增加 zoomToSelection；双击空白触发 fit |
| CV-020 | 已完成 | P2 | 资产无下载/另存入口（单图、成片导出到本地），成片目前只能画布内播放 | `CanvasContextMenu.tsx`、`LayerDetailPanel.tsx`、`StudioFrame.tsx`、`src/canvas-actions.ts`（`assetDownloadName` / `canDownloadNode` / `triggerDownload`） | 已实现：① 右键菜单加「下载资产」（仅可下载节点可用，其余置灰）+ 详情面板底部加「下载资产」按钮；② 下载名 `{清洗后标题}.{ext}`（纯函数 `assetDownloadName`，清洗路径分隔符防目录穿越），URL 为 http(s)/blob(data:) 判定 `canDownloadNode`；③ DOM 操作 `triggerDownload` 留在 client（`StudioFrame.handleDownload`），浏览器直接触发，桌面端走默认下载行为。测试 113/113 |
| CV-021 | 待处理 | P2 | 删除被血缘引用的节点时无提示，下游 sourceIds 静默悬空（渲染不报错但信息链断裂） | `StudioFrame.tsx`（handleDelete）、`project-store.ts` | 删除前检测是否有下游引用并提示；或删除时级联清理子节点 sourceIds |
| CV-022 | 已完成 | P1 | 血缘依赖 Agent 自觉填 sourceUrls，不可靠（2026-08-28 需求讨论确定） | `generate.ts` | 已实现：`resolveSourceIdsByFilename` 按 Drama filename 反查素材节点，与 URL 反查取并集（去重保序）；`generateAsset` 与 `splitStoryboard` 均接入；新增测试「血缘自动反查」 |
| CV-023 | 已完成 | P1 | 用户输入的创意未落画布，画布缺少「创意从哪来」的叙事锚点（2026-08-28 需求讨论确定，捕获方案已拍板：方案 A 仅首条用户消息） | `client/`（conversationEvents 新 definition 匹配用户消息事件）+ `project-store.ts` | 已实现：`brief-capture.ts` 匹配 `user/message` 且 `source.kind==='user'`（排除 skill/文件通知等合成注入）；store 新增 `addBriefNode`（幂等，每项目至多一个 `toolName=user_brief` 节点，落在画布原点）；画布未载入时暂存、重载完成后补落（历史重放竞态）；旧项目打开时经历史重放自动补落 |
| CV-024 | 已完成 | P1 | 生成节点落盘坐标硬编码 x:0,y:0，全叠在原点，靠手动「整理布局」，无法形成创意→素材→生成物的流向感（2026-08-28 需求讨论确定纳入） | `generate.ts`（落盘坐标）、`canvas-view.ts`（computeArrangeLayout） | 已实现：`deriveNodePlacement` —— 新节点排在其血缘来源节点右侧一列（y 对齐来源），重叠时右移避让（有界 50 步）；无来源回退网格空位；`generateAsset` / `splitStoryboard`（子节点行内等距展开）接入。retryOf 原地更新不受影响 |
| CV-025 | 已完成 | P1 | 创意到分镜/文案没有连线，画布叙事链断在第一环（2026-08-28 用户提出） | `host-tools.ts`（submit_storyboard_for_approval / write_script）、`contracts/canvas.ts` | 已实现：`BRIEF_NODE_TOOL` 常量上移到共享契约；分镜表与文案节点落盘时自动查找创意节点并挂接 `sourceIds`（血缘边自动出现），同时按 CV-024 排在其右侧 |
| CV-026 | 已完成 | P1 | 分镜表整表挤在一个大文本节点里，无法逐镜对照生成（2026-08-28 用户提出） | `host-tools.ts`（submit_storyboard_for_approval） | 已实现：`parseStoryboardShots` 解析 markdown 逐镜表格（容错：丢弃分隔/表头行、<3 列行），每镜拆为独立「分镜 N · 景别」节点（正文【镜 N】景别 · 运动 · 时长 + 画面/声音），血缘指向创意、每行 3 个横向排列；解析失败回退整表单节点。已知限制：重复提交分镜会追加新节点（与旧行为一致，去重待做） |
| CV-027 | 已完成 | P1 | 关键帧/视频与所属分镜卡没有连边，逐镜对照断链（2026-08-28 用户提出） | `host-tools.ts`（image_generate/video_generate/video_composite + submit）、`generate.ts` | 已实现：三个生成工具新增 `shotRefs` 参数（分镜卡标题 /「分镜 N」镜号 / 节点 id 三种写法，解析失败给可操作报错），Host 解析为节点 id 并入血缘与落位锚点——关键帧连到所属分镜卡并排在其右侧；submit 工具结果列出每张卡标题 + id 供模型引用；放手跑模式同样拆卡落画布；skill 同步教用法 |
| CV-028 | 已完成 | P2 | 生成图片/视频节点直接拿媒体分辨率当画布显示框（16:9→1280×720），与 360 宽分镜卡比例失衡（2026-08-28 尺寸盘点时发现） | `generate.ts` | 已实现：`previewSizeOf` 派生画布预览尺寸（16:9→480×270、9:16→270×480、1:1→420×420），节点框与落位用显示尺寸；媒体分辨率只进 Drama 请求体、`mediaWidth/mediaHeight` 与工具返回值；retry 重试同步用显示尺寸 |
| CV-029 | 已完成 | P1 | 框比例与媒体内容不符时被 `object-fit:cover` 静默裁切：9:16 视频在 16:9 框里只剩中间一条、非标比例上传素材被裁边（2026-08-28 用户提出） | `CanvasNode.tsx`、`CanvasSurface.tsx`、`StudioFrame.tsx`、`project-store.ts` | 已实现（用户修订规则）：**长边固定 480、短边按真实比例缩放**。两条路径：① 上传图片落卡前用 createImageBitmap 探测真实宽高，直接按长边 480 创建（避免先错后跳）；② 媒体加载后（img onLoad / video loadedMetadata）框比例偏差 >5% 时自动校正（钳制 60–960，锁定节点跳过，修正后不循环），对新旧节点与生成/抽帧路径统一兜底 |

## 决策点（实施前需对齐）

| ID | 状态 | 问题 | 候选方案 |
| --- | --- | --- | --- |
| D1 | 已拍板 | CV-001 文本编辑放哪 | **方案 A**：双击文本类节点=内联编辑、媒体类双击=详情（按 kind 区分语义）（2026-08-28 确认） |
| D2 | 已拍板（延后） | CV-007 时间轴定位 | 时间轴暂未想好，优先级后置——CV-006/007 延后，不进当前批次（2026-08-28 确认） |
| D3 | 已拍板（延后） | CV-005 连线删除语义 | 删除能力为「素材重新生成多版后择优」场景服务：用户可在多版素材中选择中意的一版（移除指向旧版的血缘）。与版本选择工作流合并设计后实施，暂缓（2026-08-28 确认） |

## 变更记录

| 日期 | 条目 | 变更 | 备注 |
| --- | --- | --- | --- |
| 2026-08-28 | 全部 | 初版建单（21 项 + 3 决策点），来源：全量代码审查 | |
| 2026-08-28 | CV-012、CV-022（新增） | 完成生成参数结构化展示与血缘自动反查；新增 CV-023（创意节点，方案 A）、CV-024（落点策略）；health 负缓存测试对齐「失败不缓存」新语义 | 测试套件 74/74 全绿；顺带修复：`generate.ts` 运行时配置未注入时的编译期默认值兜底（`runtime()`）、`createStudioTools` cfg 可选化 |
| 2026-08-28 | CV-023 | 完成：`brief-capture.ts` 捕获首条真人消息 → `addBriefNode` 幂等落「创意」节点；index.ts 三处 reload 链上补落 + 暂存竞态处理 | 测试 74/74；旧项目打开时经会话历史重放自动补落 |
| 2026-08-28 | CV-024、CV-025（新增） | 完成：落点策略（血缘来源右侧 + 防重叠 + 网格回退）接入 generateAsset/splitStoryboard；创意→分镜/文案自动连边（BRIEF_NODE_TOOL 上移共享契约） | 测试 76/76（新增落点策略、创意血缘 2 个用例） |
| 2026-08-28 | CV-026（新增） | 完成：分镜表逐镜拆分为独立节点（parseStoryboardShots + formatStoryboardShot，血缘指向创意、每行 3 卡横向排列、解析失败回退单节点） | 测试 77/77 |
| 2026-08-28 | CV-027（新增） | 完成：shotRefs 参数（三种写法解析）让关键帧/视频连到所属分镜卡并右侧落位；submit 双模式拆卡并列出卡片清单；skill 教用法 | 测试 79/79（新增 shotRefs、放手跑拆卡 2 个用例） |
| 2026-08-28 | CV-028（新增） | 完成：生成节点画布框改为预览尺寸（previewSizeOf），媒体分辨率只入 mediaWidth/Height 与工具返回值 | 测试 79/79（落点策略用例补显示尺寸/分辨率断言） |
| 2026-08-28 | CV-029（新增） | 完成：媒体框比例自适应——长边固定 480、短边按真实比例缩放（用户修订规则）。上传图片落卡前探测尺寸直接按规则创建；媒体加载校正兜底（偏差 >5%、锁定跳过、不循环） | 测试 79/79；CanvasNode onLoad/onLoadedMetadata → CanvasSurface 透传 → StudioFrame updateNode + persist |
| 2026-08-28 | CV-013 | 完成：上传图片探测的真实分辨率直接写入 mediaWidth/mediaHeight；媒体加载回调（onMediaNatural）对存量缺失节点自动回填（锁定节点也回填分辨率、只不动框） | 测试 79/79；详情面板「分辨率」不再显示「未知」 |
| 2026-08-28 | CV-004、CV-003、CV-002 | 完成：标签共享模块 `client/canvas/labels.ts`（五处共用、补齐 storyboard-split）；Minimap 视口居中改用 CanvasSurface 容器实测尺寸（ResizeObserver）；ask_user_choice 自由输入框（allowFreeText）。决策点拍板：D1=方案 A、D2/D3 延后（时间轴定位待定；连线删除并入「多版素材择优」工作流设计） | 测试 79/79 |
| 2026-08-28 | CV-030（新增）、CV-009、CV-010、CV-001 | 新增 CV-030（双击开详情后单击其它节点也直开详情，用户验收发现，待处理）。完成：图层面板点击居中定位（focusNodeId）；loading overlay 已耗时 MM:SS + 超 3 分钟打断提示；文本类节点编辑（D1 方案 A：双击内联 textarea + 详情面板正文区，经 updateNode 持久化） | 测试 79/79 |
| 2026-08-28 | CV-030 | 完成：detailOpen 布尔改为 detailNodeId（渲染条件 selectedNode.id === detailNodeId），单击不再误开详情面板；关闭/删除/时间轴跳转清空，右键菜单按 id 打开 | 测试 79/79 |
| 2026-08-28 | CV-031（新增） | 完成：视频生成自动继承分镜卡血缘（inheritShotCardIds）——关键帧挂着分镜卡时，即使模型漏传 shotRefs，视频也同时连关键帧与分镜卡；只上溯一层只认分镜卡 | 测试 80/80（新增继承用例）；**未提交，等用户验证** |
| 2026-08-28 | CV-031（补充）、CV-014、CV-032（新增） | 用户以 VideoOut 真实 canvas.json 复核：存在第二种断裂模式（模型重上传关键帧拿新 filename，视频只连分镜卡漏关键帧）。补 `backfillUploadFilename`——upload_image 上传画布资产时回写新 filename 到节点。连线可见性：线宽/箭头/chip 按 1/scale 反向补偿（屏幕尺寸恒定），chip 低缩放（<0.6）隐藏、选中边保留 | 测试 89/89；**未提交，等用户验证** |
| 2026-08-28 | CV-033（新增） | 完成：删项目同步摘除绑定 workspace + 打开项目前清理同名孤儿 workspace，修复「删项目后重建同名报 workspace-name-conflict」 | 测试 89/89；**未提交，等用户验证** |
| 2026-08-28 | CV-034（新增） | 完成：画布映射优先用当前会话 cwd（session summary 自带），recentWorkspaceId 降为兜底；会话列表变化接入同步订阅。修复启动后「对话有内容、画布空、列表无选中」三不一致（孤儿 workspace 空会话把 recent 推导带偏） | 测试 89/89；**未提交，等用户验证** |
| 2026-08-28 | CV-035~038（新增，仅记录不实施） | 用户验收反馈四项：① 画布网格偏深（CV-035，P2）；② 项目缺「已完成」标记（CV-036，P1，方案 A/B 待拍板）；③ 节点右键菜单全部点击无效（CV-037，P0，高置信根因：window mousedown 关闭监听抢在 click 之前卸载菜单）；④ 手动连线起草线起点偏移且是直线（CV-038，P2，draft 应锚定节点右缘中点 + 贝塞尔） | 仅记录，未动代码 |
| 2026-08-28 | MiniMax Design / H3 开源仓库竞品调研 + CV-039~043（新增，仅记录不实施） | 对标 design.minimaxi.com 与 MiniMax-H3 开源仓库后确认：H3 原生联合生成音视频（对白/BGM/音效/画面文字全由提示词驱动），无需自建音频字幕生成服务。新增：CV-039（P1，skill H3 提示词规范升级为官方三字段结构）；CV-040（P1，Master Audio 全局音轨装配，compose.ts 已有 amix 半成品）；CV-041（P2，接入官方 h3-prompt-writing skill，agent-portable）；CV-042（P2，风格化画面文字/排版层）；CV-043（P2 远期，Ref2VA 音频参考与复用）。远期另记但不立条目：多版本批量派生、EDL 导出、3D 预演轻量替代（结构化运镜字段） | 定位共识：MiniMax 画布=生产流水线；我们的画布=Agent 创作过程驾驶舱（透明/可控/可追溯/开放底座），不拼产能拼差异 |
| 2026-08-29 | CV-037、CV-018、CV-035（「批次 0 实测减负」） | 完成三项：① CV-037（P0）右键菜单修复 —— `CanvasContextMenu` 改 forwardRef 挂 `menuRef`，mousedown 命中菜单内部时放行（判定抽为纯函数 `shouldKeepMenuOpen`），补 Escape 关闭；② CV-018 失败徽章兼作就地重试按钮（可见性判定 `canRetryNode` 与 `rerunNode` 前置检查一致），`onRetry` 经 CanvasSurface 透传；③ CV-035 网格线降到 45% 不透明度（color-mix 跟随主题，40px 格子不变）。新增 `src/canvas-actions.ts` + `tests/canvas-actions.test.mjs`（7 例） | 测试 100/100；typecheck（Host + Client）0 错；verify:loader 通过。**已提交 `6b3091a772`（未推送，沙箱无 push 凭据）；待桌面回归** |
| 2026-08-29 | CV-038、CV-020、HITL-C（「批次 1 快赢」） | 完成三项：① CV-038 起草线修复 —— 新增共享几何模块 `src/canvas-geometry.ts`（`edgeAnchor`/`edgePath`），draft 起点锚定来源节点右缘中点、路径与正式边同为 C 贝塞尔（指针居左时镜像控制点），正式边同步切换同模块消除漂移；② CV-020 资产下载 —— 右键菜单「下载资产」（不可下载置灰）+ 详情面板下载按钮，下载名清洗防目录穿越（`assetDownloadName`），纯函数可单测，DOM 触发留 client；③ HITL-C 设置页「默认执行模式」死开关处理 —— 核实后**未删**：`plan.md` 将 `workflowMode` 等字段统一定义为 ⏳ reserved 前向配置，改为全部 reserved 字段统一挂「待接入」角标（新增 `csReserved` 样式），与「不伪造已生效」原则对齐。新增 `tests/canvas-geometry.test.mjs`（10 例）+ 下载名清洗 3 例 | 测试 113/113；typecheck（Host + Client）0 错；verify:loader 通过。**未提交，待桌面回归** |
