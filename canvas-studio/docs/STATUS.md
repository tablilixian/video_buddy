# Canvas Studio 状态总表（STATUS）

> **这是唯一事实来源。** 需求 / 缺陷 / 优化点的当前状态一律以本文件为准。
> 其它文档（backlog、分析报告、设计稿）只保留**技术细节与决策过程**，状态一律引用本文件。
>
> 最近更新：2026-09-01 · 维护纪律见 [DEV-WORKFLOW.md](./DEV-WORKFLOW.md#四收尾必更文档强制步骤)

---

## 0. 怎么用这份表

### 状态词汇（所有条目统一）

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `已完成` | 代码落地 + 用户桌面验收通过 | 无 |
| `已修复·待验收` | 代码已改、测试过，**用户还没在桌面回归** | 重启桌面验证，通过改 `已完成` |
| `进行中` | 正在改 | 继续 |
| `待处理` | 方案已明确，可直接动手 | 排期 |
| `待拍板` | 方向未定，需用户决策 | 找用户确认 |
| `待复现` | 缺复现信息，无法定位 | 等用户提供 |
| `仅设计` | 有完整设计文档，**零代码落地** | 决策要不要做 |
| `已否决` | 明确不做，附原因 | 无 |

### 编号规则

- **主线编号 `CV-xxx`** — 画布侧全部条目（缺陷 + 优化 + 小需求）共用一条序列，已编到 CV-088。新条目从 **CV-089** 起。
- **历史编号 `O1-O5` / `F1-F8` / `R1-R4`** — 早期文档遗留，不复用。映射关系见 [§6 历史 ID 映射](#6-历史-id-映射)，避免查旧文档时对不上。
- 详细技术方案仍写在 [canvas-ux-backlog.md](./canvas-ux-backlog.md)（CV 条目）与各分析文档中，本表只管状态。

---

## 1. 速览（30 秒看全局）

| 状态 | 数量 | 条目 |
| --- | --- | --- |
| 已完成 | 35 | CV-001~004, 009~020, 022~035, 037, 038, 041, 044, 045 |
| 已修复·待验收 | 30 | CV-008, 049, 052, 056~060, 062~074, 076~083, 088 |
| 已完成·待验收 | 1 | CV-061 |
| 待处理 | 19 | CV-005~007, 021, 039, 040, 042, 043, 046~048, 050, 051, 053~055, 084, 086, 087 |
| 待拍板 | 1 | CV-036 |
| 仅设计（零落地） | 5 大模块 | 见 [§5](#5-已设计但零落地的模块) |

**当前最该动的三件事**（详见 [重做方案](./redo-redesign-plan.md)）：

1. ~~**CV-052**（P0 bug）模式切换会把工作流状态误翻回 `drafting`~~ ✅ 已修复·待验收（2026-09-01）——纯函数化 + 按钮 disabled + 7 用例测试，[详情](./redo-redesign-plan.md#a2-1--修复模式切换误翻状态--cv-052p0必修10-分钟)。
2. **CV-050**（P1 bug）打回后重新提交分镜，旧卡不删只追加，画布堆多套同名分镜卡 —— 打回重做功能的实际杀手。**D4 已拍板：按镜号复用覆盖，多余旧卡保留**。下一个动它。
3. **CV-051**（P1）关键帧阶段只有「确认」没有「打回」，不满意只能逐张右键或去对话里说。
4. ~~**CV-056**（P1）切模式解除等待后不唤醒 agent~~ ✅ 已修复·待验收（2026-09-01，与 CV-052 同批）。

---

## 2. 缺陷追踪（Bug）

### 2.1 未解决

| ID | 状态 | P | 问题 | 位置 | 修法要点 |
| --- | --- | --- | --- | --- | --- |
| **CV-052** | 已修复·待验收 | **P0** | 在 `keyframe_review` 或 `executing` 状态下再点一次顶部模式按钮（按钮仍可点），`state` 被强制翻成 `drafting` → 审批条消失、AI 后续调视频工具收到「请先提交分镜表」，流程语义错乱 | ~~`routes.ts:646-648`（setMode）~~ | ✅ 2026-09-01：状态决策抽为纯函数 `resolveSetModePatch`（`contracts/project.ts`，mode 未变化短路只写 mode）；模式按钮加 `disabled` + 样式；新增 `tests/workflow-mode.test.mjs` 7 用例（全量 153/153 绿）。UI 验收法见 redo-redesign-plan §A2-1 |
| **CV-056** | 已修复·待验收 | **P1** | 模式切换把 `awaiting_approval` / `keyframe_review` 解除等待后置 `executing`，但 `setWorkflowMode` 不含 wakeAgent → AI 已结束回合在睡，状态条显示「制作中」而流程实际停摆。用户以为切放手跑就自动续跑，其实要手动打字叫醒 | ~~`client/index.ts:361-364`（setWorkflowMode）~~ | ✅ 2026-09-01：`setWorkflowMode` 切换前快照 `before.state`，等待类 → `executing` 时复用 wakeAgent 发「继续」（对齐 `confirmKeyframes` 写法） |
| **CV-050** | 待处理 | **P1** | 打回后 AI 重新提交分镜，`buildShotCards` 无脑追加整套新卡，旧卡原地不动 → 打回两次画布上三套「分镜 1 · 特写」；下游关键帧的 `shotRefs` 可能连到旧卡 | `host-tools.ts:262`（buildShotCards）、`:763-764`（提交落卡） | 按镜号匹配已有卡，复用 id 与位置只更新文案（CV-026 的已知遗留项，正式立条） |
| **CV-057** | 已修复·待验收 | **P1** | 视频播放没有进度条也没有任何控制按钮：双击视频打开的播放浮层只有「点击画面切播放/暂停」，无进度条、无时间显示、无音量、无法拖动进度 | ~~`VideoPlayerModal.tsx`~~ | ✅ 2026-09-01：浮层自绘控制条落地（可拖进度 pointer-capture + 当前/总时长 + 播放暂停按钮 + 音量 slider + 静音切换），仍不挂原生 controls（CV-044 硬约束约束住双击全屏路径） |
| **CV-060** | 已修复·待验收 | **P1** | 应用名迁移半途、两处不一致：标题栏硬编码「DSH Desktop」、Electron productName 同，而托盘与更新模块已叫 VideoBuddy → 同一应用两个名字 | ~~`index.ts:394`、`ExtendedTitlebar.tsx:181`、四文案文件~~ | ✅ 2026-09-01：标题栏 span + productName/windowTitle + tray-locale / native-dialog-copy / recovery-copy / desktop-dialog-window 共 53 处统一为 VideoBuddy。**main.ts PRODUCT_NAME 保持 'DSH Desktop' 不动**（app.setName 决定 userData 目录，改名会让日志/安装 ID/profile 状态搬家；如需迁移另立专项） |
| **CV-058** | 已修复·待验收 | P2 | 上传图片没有任何选项；`StudioFrame.tsx:535` 引导文案与实际交互不符（文案撒谎）。**拍板：只改文案**（上传功能后续在 LLM 编排里已有）。上传链路核实为**双写**：本地落盘 + 同步传 Drama 拿 filename 落节点；副作用 Drama 不可用时整次上传失败（all-or-nothing，暂不动） | ~~`StudioFrame.tsx:535`（撒谎文案）~~ | ✅ 2026-09-01：空态引导改为真实路径「上传后在节点详情面板点『标记为参考』」 |
| **CV-059** | 已修复·待验收 | P2 | 工具栏改版：删设置按钮（**拍板：设置入口 = app 左下角全局入口**）；整理布局/图层/小地图移最右并图标化 | ~~`CanvasToolbar.tsx`~~ | ✅ 2026-09-01：设置按钮移除（TOOLBAR_VISIBILITY.settings=false，prop 保留接线）；三按钮移至最右图标组（内联 SVG 16px stroke 2，title/aria-label 保留，图层/小地图开关态高亮 csToolbarIconActive） |
| **CV-067** | 已修复·待验收 | **P1** | 竖屏成片（9:16，480×864）在画布上横屏显示被 `object-fit: cover` 裁切（2026-09-02 用户实测截图反馈）——`compose_video` 成片节点落盘硬编码 `COMPOSED_SIZE 260×180` 横屏占位，真实分辨率只进 mediaWidth/mediaHeight；`onMediaNatural` 异步校正依赖 `<video onLoadedMetadata>` 时序，落盘初期窗口期兜底未生效 | ~~`compose.ts:343-344`（COMPOSED_SIZE 硬编码）~~ | ✅ 2026-09-02：抽 `src/canvas-aspect.ts` 统一「分辨率→显示框」换算（generate 的 previewSizeOf + StudioFrame 的 longSide480/onMediaNatural 三处合一，消 1:1 漂移）；compose 落盘按真实分辨率换算（9:16→267×480），缺分辨率才回退占位；+7 契约测试（172/172 绿） |
| **CV-068** | 已修复·待验收 | **P1** | 主模型无视觉（qwen3.8-27b-mtp 等文本模型），agent 在生成「视觉预览」等中间产物后试图**直接读本地图片路径自查效果** → DSH 运行时把 png admit 成 image block 提交给模型，能力校验抛 `model does not declare image input`（2026-09-02 用户实测截图反馈，3 连错）。项目架构上视觉理解走专用工具（`upload_image` 拿 Drama 服务器 filename → `image2vl` 分析），该报错 = agent 绕过专用通道直接读图，SKILL.md 旧护栏（「不要用文件读取工具打开图片」）太轻未拦住 | ~~`skills/canvas-studio-creation/SKILL.md:51`（弱护栏）~~、`host-tools.ts`（image2vl 描述） | ✅ 2026-09-02：SKILL.md 核心规则升级显式禁令（无视觉能力声明 + 禁止 file_path / 图片 URL / 内嵌引用 / 附件全部读图变体 + 产物 url 用途澄清「只给展示与 upload_image，非视觉输入」+ image2vl 唯一合规通道与前置步骤）；`image2vl` 工具 description 补同款护栏（工具级兜底）；+3 护栏守卫测试（175/175 绿） |
| CV-069 | 已修复·待验收 | P2 | **用户信息区缺失（竞品对标 MiniMax Design，2026-09-02 用户截图）**：竞品左栏底部有用户卡（头像/昵称/UID）+ 点击弹个人信息面板（账号身份/积分余额/订阅/设置组/帮助组），本项目左栏底部为空；且 CV-059 拍板「设置入口 = app 左下角全局入口」后画布侧缺插件内设置落点。拍板四项：① 主题/设置接真实功能；② 未规划条目（记忆管理/教程/更新日志/接入飞书微信）保留入口挂待接入，尽量完整复刻；③ 用户卡三态常驻（lobby / lobby-pending / work）；④ 假数据中文创作人设 | `client/UserCard.tsx`（新）、`StudioFrame.tsx`（左栏底部挂载）、`styles.ts`（csUser* 系列）、假数据常量（brand-copy.ts 追加或独立 user-mock.ts） | ✅ 2026-09-02 落地：`UserCard.tsx`（字母渐变 SVG 头像 + popover；主题三态 = 真实 ctx.theme，设置 = 打开 SettingsModal；积分/订阅/帮助组 reserved 入口 + 待接入角标，「接入飞书/微信」未接入 badge）；`USER_MOCK` 假数据收敛 brand-copy.ts。方案见 backlog CV-069 |
| CV-070 | 已修复·待验收 | P1 | 技能卡**动态预览**（竞品 DA-1）：竞品卡头图是 GIF 演示，我们静态渐变；`assets/style-demos/` 8 个 GIF 与 skill 同名**已就绪** | `skill-catalog.ts`（`demo?`）、`SkillCard.tsx`、`styles.ts` | ✅ 2026-09-02 落地：catalog 加 `demo` 字段（8 技能）；SkillCard hover 懒注入 `<img>`（不 hover 不下载）；无 demo 回退静态渐变；测试守卫 demo GIF 文件真实存在 |
| CV-071 | 已修复·待验收 | P2 | 技能卡悬停浮层 + 查看详情（竞品 DA-2） | `SkillCard.tsx`、`SkillMarket.tsx` | ✅ 2026-09-02 落地：hover 浮层「查看详情」+ 二级详情弹窗（标题/说明/分类/注册名/使用按钮；Escape 先关弹窗再关广场） |
| CV-072 | 已修复·待验收 | P1 | 技能广场搜索（竞品 DA-3） | `SkillMarket.tsx` | ✅ 2026-09-02 落地：header 搜索框，title/summary/name 子串过滤（大小写不敏感），与分类/过滤叠加 |
| CV-073 | 已修复·待验收 | P2 | 「我的 Skill」视角（竞品 DA-4）：已激活技能广场内不可见 | `SkillMarket.tsx`（activeSkills 链路已有） | ✅ 2026-09-02 落地：侧栏「我的 Skill」视图（activeSkills 清单 + × 卸载复用 CV-066 链路；lobby 态无项目隐藏入口；空态引导） |
| CV-074 | 已修复·待验收 | P2 | 官方精选分区（竞品 DA-5）：`featured` 字段已有未消费 | `SkillMarket.tsx`、`SkillCarousel.tsx` | ✅ 2026-09-02 落地：「官方精选 / 其他技能 · N」两级分区（全部 + 无搜索 + 未勾过滤时生效，其余场景平铺） |
| CV-075 | **暂缓** | P3 | 作者署名/下载量（竞品 DA-6）：假下载量与「不伪造已生效」原则有张力 | `skill-catalog.ts` | 2026-09-02 用户拍板先不处理；做前需再拍板诚实性方案 |
| CV-076 | 已修复·待验收 | P3 | H3 能力角标（竞品 DA-7）：真实信息（8/10 skill 基于 H3） | `skill-catalog.ts`（`h3?`）、`SkillCard.tsx` | ✅ 2026-09-02 落地：卡片左上角 H3 badge + 详情弹窗同步展示 |
| CV-077 | 已修复·待验收（过滤；排序未做） | P3 | 未激活过滤 + 排序（竞品 DA-8） | `SkillMarket.tsx` | ✅ 2026-09-02 落地：「仅显示未装载」checkbox 过滤；**排序未实现**（skill 少价值低，如需后续补） |
| CV-078 | 已修复·待验收 | P3 | 创作者社区 CTA 收尾卡（竞品 DA-9） | `SkillMarket.tsx` | ✅ 2026-09-02 落地：网格末尾虚线框「加入创作者社区」卡 + 待接入角标 |
| CV-079 | 已修复·待验收 | P1 | **生成产物自动编组**（竞品 DA-10，用户点 1）：生成物全平铺；~~前置 CV-008~~ 已随本批一并完成 | `generate.ts`（`attachShotGroup`）、`CanvasSurface.tsx`（CV-008 多选/框选）、`project-store.ts` | ✅ 2026-09-02 落地：`attachShotGroup` 纯函数——有分镜卡血缘时并入「分镜 N · 素材」组（sourceIds 记分镜卡 id 去重复用，组框随成员包围盒扩展），无分镜卡保持旧行为；存量节点不追溯拉组。+2 单测 |
| CV-080 | 已修复·待验收 | P1 | **生成节点命名精准化**（竞品 DA-11，用户点 2）：媒体节点大多无 title，图层名「图片/视频」泛化 | `generate.ts`（`mediaNodeTitle`/`promptSummary`）、storyboard_split（`单镜 N`） | ✅ 2026-09-02 落地：命名 helper 纯函数——分镜卡镜号优先（`分镜 N · 关键帧/视频`）、无镜号取 prompt 前 12 字摘要、皆缺回退泛化标签；单镜拆分节点命名 `单镜 N`。+1 单测 |
| CV-081 | 已修复·待验收 | P2 | **文本节点选中可滚动**（竞品 DA-12，用户点 3）：`.csNodeBody` overflow:hidden 截断长文 | `CanvasNode.tsx`、`styles.ts`、`CanvasSurface.tsx` | ✅ 2026-09-02 落地：选中态 `.csNodeSelected .csNodeBody` overflow-y:auto + overscroll-behavior:contain；Surface wheel handler 对「可滚动的选中正文 / textarea」放行（不劫持平移缩放），不可滚时画布行为不变 |
| CV-082 | 已修复·待验收 | P2 | **视频 hover 自动播放**（竞品 DA-13，用户点 4）：缩略视频全静态 | `CanvasNode.tsx` | ✅ 2026-09-02 落地：hover 150ms 延迟 muted+loop 播放（模块级单实例登记防多视频同时播），离开 pause+归零；loading/失败/错误不播、prefers-reduced-motion 降级、卸载清理；双击仍开浮层 |
| CV-083 | 已修复·待验收 | P2 | 视频时长角标（竞品 DA-14）：内联完整控件明确不做（CV-044 结论） | `CanvasNode.tsx`、`canvas-aspect.ts`（`formatMediaDuration`） | ✅ 2026-09-02 落地：loadedmetadata 现算「m:ss」角标（**实现决策：不落盘**——重载后 metadata 自然恢复，省契约字段）；+1 单测（8 例）。与 CV-082 同批 |
| CV-084 | 待处理（**单独排期**） | P2 | 制作计划阶段清单（竞品 DA-15）：执行进度黑盒 | workflow steps 契约、`StudioFrame.tsx`、skill | skill 产出 steps + host 推导翻转 + 清单定位；optimization-plan「实时状态反馈」轻量替代。本批未动 |
| CV-085 | **远期记录** | P3 | 视频 hover 快捷工具条（竞品 DA-16）：依赖成片编辑/素材库未落地 | — | 待 CV-006/040/043 前置落地再评估。本批未动 |
| CV-086 | 待处理 | P3 | 项目分组管理（竞品 DA-17）：注册表扁平；项目个位数时价值低，建议缓做 | `projects.ts`（`group?`）、`ProjectList.tsx` | 分组渲染 + 折叠头，右键归组。本批未动（缓做拍板） |
| CV-087 | 待处理 | P2 | 项目封面缩略图（竞品 DA-18）：纯文字行识别效率低 | `projects.ts`（`coverUrl?`）、`ProjectList.tsx` | 落产物增量写 + 打开补写；**红线：列表禁全量加载 canvas.json**。本批未动 |
| CV-088 | 已修复·待验收 | P3 | Lobby 个性化问候（竞品 DA-19） | `LobbyHero.tsx`、`brand-copy.ts` | ✅ 2026-09-02 落地：LobbyHero 增「你好，{USER_MOCK.name}」问候行，persona 与 CV-069 用户卡同源 |
| **CV-046** | 待处理 | P1 | 项目注册表落 `$DSH_HOME/canvas-studio/`（home 级、跨 profile 共享）+ 常驻内存原子写 → 两个 DSH 实例共享 home 时后写方整表覆盖，先写方的项目从注册表消失（目录还在，表现为「项目丢了」） | `projects.ts`（registry root） | ① 迁到 profile 级目录 + 首启自动迁移；② 或 `projects.json` 加文件锁 + 写前重读合并 |
| **CV-047** | 待处理 | P2 | 端口被占时从 43120 起向后重试 32 个，**静默换端口无任何提示**，用户不知道自己开了两个 DSH | `dsh-plugin-desktop/src/desktop-port.ts` | 退避命中后托盘/通知提示「已改用端口 N」 |
| **CV-008** | 已修复·待验收 | P1 | 多选是半成品：只能 ctrl 点选，**拖拽只移动被按下的单个节点**；无框选（组带动 children 经代码核实 moveNode 已实现，STATUS 原记载过时） | `CanvasSurface.tsx`（Gesture） | ✅ 2026-09-02：① 多选整体拖拽——gesture 捕获全员起始位置（过滤组内成员防双重位移），snap 校正量均摊到全体；② 空白左键拖拽 = marquee 框选（Ctrl/Cmd 叠加，单击=清选；平移改由 Shift+左键/中键/滚轮承担），拖出容器取消而非误选；③ store moveNode 的组带动经核实已存在 |
| **CV-021** | 待处理 | P2 | 删除被血缘引用的节点无提示，下游 `sourceIds` 静默悬空 | `StudioFrame.tsx`（handleDelete） | 删除前检测下游引用并提示，或级联清理 sourceIds |
| **CV-005** | 待处理 | P1 | 血缘连线只能加不能删：手动 link 后无 UI 移除单条边，Agent 画错血缘无法修正 | `CanvasEdges.tsx`、`CanvasContextMenu.tsx` | 见决策点 D3（已拍板延后，并入「多版素材择优」工作流） |

### 2.2 已解决（索引）

| ID | 问题 | 状态 |
| --- | --- | --- |
| CV-037 | 右键菜单所有项点击无效（window mousedown 抢在 click 前卸载菜单） | 已完成 |
| CV-044 | 双击视频进 Chromium 原生全屏（三次修复，最终靠移除 `controls` 属性） | 已完成 |
| CV-033 | 删项目后重建同名报 `workspace-name-conflict`（孤儿 workspace 占名） | 已完成 |
| CV-034 | 启动后「对话有内容、画布空、列表无选中」三不一致 | 已完成 |
| CV-031 | 视频节点只连关键帧或只连分镜卡（两种断裂模式：漏传 shotRefs / 重上传拿新 filename） | 已完成 |
| CV-030 | 双击开详情后，单击其它节点也直开详情（detailOpen 布尔不复位） | 已完成 |
| CV-038 | 手动连线起草线起点偏移 + 直线与贝塞尔不一致 | 已完成 |
| CV-013 | 导入节点分辨率永远「未知」、详情面板显示错误 | 已完成 |
| CV-003 | Minimap 跳转用 window 尺寸算居中，三栏布局下系统性偏移 | 已完成 |
| CV-002 | `ask_user_choice` 的 `allowFreeText` 自由输入框 UI 丢失 | 已完成 |

---

## 3. 需求实现状态（按功能域）

图例：✅ 已完成 · ⚠️ 部分完成 / 有缺口 · ❌ 未做

### 3.1 项目与工作区

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 项目创建 / 打开 / 删除 / 重命名 | ✅ | 含孤儿 workspace 清理（CV-033/034） |
| 项目目录名可读 | ✅ | 提交 `f56f80673a` |
| 项目「已完成」标记 | ⏸ 待拍板 | CV-036，方案 A（手动标记 + 成片信号辅助）已提出 |
| 注册表跨实例隔离 | ❌ | CV-046，数据完整性风险 |

### 3.2 画布基础

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 无限画布 / 缩放 / 平移 / Minimap | ✅ | |
| 节点创建 / 移动 / 删除 / 层级 / 锁定 / 隐藏 | ✅ | |
| 右键菜单（节点 + 空白） | ✅ | CV-037 / CV-016 |
| 方向键微调（1px / Shift 10px） | ✅ | CV-017 |
| 缩放到选中、双击空白适配视野 | ✅ | CV-019 |
| 整理布局（按血缘左源右目标分列） | ✅ | F4 |
| 撤销 / 重做 | ✅ | 入口已按组隐藏（`e53aa0a7f2`），功能保留 |
| 多选拖拽 / 框选 | ❌ | CV-008 |
| 血缘连线删除 | ❌ | CV-005，D3 拍板延后 |

### 3.3 节点与内容

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 6 种节点 kind（image/video/sticky/text/prompt/group） | ✅ | 分镜卡 / 文案 / 创意均为 text + toolName 区分 |
| 文本内联编辑（双击 + 详情面板） | ✅ | CV-001，D1 方案 A |
| 媒体框比例自适应（长边 480） | ✅ | CV-029 |
| 图片大图预览浮层 | ✅ | CV-045 |
| 视频固定尺寸播放浮层 | ✅ | CV-044 |
| 详情面板 + 生成参数结构化展示 | ✅ | CV-012（提示词可复制 / 参考图反查 / 参数行 / 原始 JSON 折叠） |
| 参考角标 + 参考托盘空态引导 | ✅ | CV-011 |
| 资产下载（右键 + 详情面板） | ✅ | CV-020 |
| loading 已耗时 + 超 3 分钟打断提示 | ✅ | CV-010 |
| toast 替代 window.alert | ✅ | CV-015 |
| 节点版本历史 / 回退 | ❌ | CV-054（单版本回退）、optimization-plan §3.2（双层版本控制，仅设计） |
| 下游过时标记（上游重做后提示） | ❌ | CV-055 |

### 3.4 生成与工具

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 16 个 Host 工具 | ⚠️ | `image_generate` / `character_generate` / `inpaint` / `upload_image` / `list_references` / `video_generate` / `video_composite` / `prompt_enhance` / `image2vl` / `style_transfer` / `storyboard_generate` / `storyboard_split` / `submit_storyboard_for_approval` / `submit_keyframes_for_approval` / `ask_user_choice` / `write_script` / `compose_video`；其中 `style_transfer`、`inpaint` 暂不可用（`DISABLED_TOOLS` 守卫） |
| 节点重试 / 修改提示词重放 | ✅ | 原地覆盖，保留 id / 位置 / 血缘 |
| 生成落点策略（来源右侧 + 防重叠） | ✅ | CV-024 |
| 血缘自动反查（按 Drama filename） | ✅ | CV-022 |
| 创意节点自动捕获 | ✅ | CV-023（首条真人消息落「创意」节点） |
| 分镜表逐镜拆卡 + 自动连创意 | ✅ | CV-026 / CV-025 |
| 关键帧 / 视频连所属分镜卡（shotRefs） | ✅ | CV-027 + CV-031 兜底 |
| 多模型切换 | ❌ | 后端统一 FL2VA（H3），model / resolution / generateAudio 是占坑参数，显式传参会返回 warnings |
| 声音能力（BGM / 配音 / 字幕烧录） | ❌ | 工具为占坑降级态，返回降级指引；CV-040/042/043 未启动，CV-039 部分落地（六段规划法在，三字段声音规范没内化），CV-041（上游 skill 全文）已完成 |

### 3.5 工作流与 HITL

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 分镜审批闸（`awaiting_approval`） | ✅ | 硬闸，拦在触达 Drama 之前 |
| 关键帧确认闸（`keyframe_review`） | ✅ | O4 方案 A，`host-tools.ts:191-194` 硬拦截 video_*；`image_generate` 不拦（设计如此） |
| **关键帧打回** | ❌ | **CV-051** —— 只有「确认」，没有「打回」 |
| 审批 / 确认后自动代发「继续」 | ✅ | O1，`client/index.ts` wakeAgent |
| 分镜打回 + 意见输入框 | ✅ | R1，意见随驳回消息转述 Agent |
| **分镜重新提交去重复用** | ❌ | **CV-050** —— 当前为无脑追加 |
| 模式切换（逐步确认 / 放手跑） | ⚠️→✅ | CV-052 状态误翻（P0）与 CV-056 不唤醒 agent（P1）均已修复（2026-09-01），待桌面验收 |
| 设置页「默认执行模式」生效 | ✅ | R1，`ProjectRegistry` 接收 live provider |
| `ask_user_choice` 选项卡片 | ⚠️ | 可选可答，但无高亮选中态（O2）、自由输入为 opt-in（CV-049） |
| 审批条醒目化（高亮 + 角标） | ❌ | CV-053 |
| 打断生成中节点 | ✅ | |

### 3.6 成片

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 片段拼接（compose_video） | ✅ | 禁重新生成，只拼已有片段 |
| 成片自动定位 | ✅ | F1 |
| 成片导出 / 下载 | ✅ | CV-020 |
| 时间轴排除片段 | ❌ | CV-006（chip 勾选态未做） |
| BGM 节点选择 | ❌ | CV-006 |
| 多段音轨统一（Master Audio） | ❌ | CV-040，`compose.ts` 有 amix 半成品 |
| 时间轴语义（只显示媒体 + 总时长） | ❌ | CV-007，D2 拍板延后 |

### 3.7 品牌与设置

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 品牌识别度落地 + 主题即时切换 | ✅ | `f56f80673a` / `f16d33d351` |
| 设置页扩展（输出 / 工作流 / 存储） | ✅ | `plan.md §1.7` |
| reserved 字段统一「待接入」角标 | ✅ | 不伪造已生效 |

---

## 4. CV 主线全量表

状态列是权威，技术方案见 [canvas-ux-backlog.md](./canvas-ux-backlog.md)。

| ID | 状态 | P | 一句话 | 涉及文件 |
| --- | --- | --- | --- | --- |
| CV-001 | 已完成 | P0 | 文本类节点无法编辑正文 → 双击内联编辑 + 详情面板正文区 | CanvasNode / LayerDetailPanel / project-store |
| CV-002 | 已完成 | P0 | ask_user_choice 自由输入框 UI 丢失 | question-capture.tsx |
| CV-003 | 已完成 | P0 | Minimap 跳转用 window 尺寸算居中，三栏布局偏移 | Minimap.tsx |
| CV-004 | 已完成 | P0 | 操作/类型标签三处重复定义且漂移 → 抽共享 labels.ts | CanvasNode / CanvasEdges / LayerPanel 等 5 处 |
| CV-005 | 待处理 | P1 | 血缘连线只能加不能删 | CanvasEdges / CanvasContextMenu |
| CV-006 | 待处理 | P1 | compose 无法排除片段、无 BGM 选择器 | StudioFrame / CanvasTimeline |
| CV-007 | 待处理 | P1 | 时间轴语义混乱（非媒体混排、无总时长） | CanvasTimeline |
| CV-008 | 待处理 | P1 | 多选半成品（拖拽只动单节点、无框选） | CanvasSurface / project-store |
| CV-009 | 已完成 | P1 | 图层面板选中不定位 → 复用 focusNodeId | LayerPanel / StudioFrame |
| CV-010 | 已完成 | P1 | loading 无时间感 → 已耗时 MM:SS + 超 3 分钟打断提示 | CanvasNode |
| CV-011 | 已完成 | P2 | 看不出是否为参考图 → 参考角标 + 托盘空态引导 | CanvasNode / StudioFrame |
| CV-012 | 已完成 | P2 | 生成参数是原始 JSON → 四段结构化展示 + steer 预填 | LayerDetailPanel |
| CV-013 | 已完成 | P2 | 导入节点分辨率永远「未知」 → 落卡前探测 + 加载回填 | StudioFrame / project-store |
| CV-014 | 已完成 | P2 | 边 chip 无 LOD → 缩放 <0.6 隐藏，选中保留 | CanvasEdges |
| CV-015 | 已完成 | P2 | window.alert → toast 体系 | StudioFrame / styles |
| CV-016 | 已完成 | P2 | 右键空白无菜单 → 新增 CanvasBlankMenu + 光标处落点 | CanvasSurface / project-store |
| CV-017 | 已完成 | P2 | 方向键微调 | CanvasSurface / canvas-actions |
| CV-018 | 已完成 | P2 | 失败节点无就地重试 → 徽章兼作按钮（`canRetryNode` 与执行侧一致） | CanvasNode / canvas-actions |
| CV-019 | 已完成 | P2 | 无缩放到选中 / 双击空白 fit | CanvasSurface |
| CV-020 | 已完成 | P2 | 资产无下载入口 → 右键 + 详情面板（`assetDownloadName` 防穿越） | CanvasContextMenu / LayerDetailPanel |
| CV-021 | 待处理 | P2 | 删除被引用节点无提示，sourceIds 悬空 | StudioFrame / project-store |
| CV-022 | 已完成 | P1 | 血缘依赖 Agent 填 sourceUrls 不可靠 → filename 反查 | generate.ts |
| CV-023 | 已完成 | P1 | 创意未落画布 → brief-capture 捕获首条真人消息 | client/brief-capture.ts |
| CV-024 | 已完成 | P1 | 生成节点全叠原点 → deriveNodePlacement 排来源右侧 | generate.ts / canvas-view.ts |
| CV-025 | 已完成 | P1 | 创意到分镜/文案无连线 → 落盘自动挂 sourceIds | host-tools.ts |
| CV-026 | 已完成 | P1 | 分镜表挤一个大文本节点 → 逐镜拆卡 | host-tools.ts |
| CV-027 | 已完成 | P1 | 关键帧/视频与分镜卡无连边 → shotRefs 参数 | host-tools.ts / generate.ts |
| CV-028 | 已完成 | P2 | 生成节点框用媒体分辨率，与分镜卡比例失衡 → previewSizeOf | generate.ts |
| CV-029 | 已完成 | P1 | 框比例不符被 object-fit:cover 静默裁切 → 长边固定 480 | CanvasNode / StudioFrame |
| CV-030 | 已完成 | P0 | 双击开详情后单击其它节点也直开详情 → detailOpen 改 detailNodeId | StudioFrame / CanvasNode |
| CV-031 | 已完成 | P1 | 视频节点只连关键帧或只连分镜卡 → 继承 + filename 回写双修复 | generate.ts / host-tools.ts |
| CV-032 | 已完成 | P2 | 连线宽度随缩放消失 → 1/scale 反向补偿 | CanvasEdges / CanvasSurface |
| CV-033 | 已完成 | P0 | 删项目后重建同名报 name-conflict → 摘除 + 清理孤儿 workspace | client/index.ts |
| CV-034 | 已完成 | P0 | 启动后对话/画布/列表三不一致 → 映射优先用会话 cwd | client/index.ts |
| CV-035 | 已完成 | P2 | 网格颜色偏深 → 降到 45% 不透明度 | styles.ts |
| CV-036 | **待拍板** | P1 | 项目无「已完成」标记 | projects.ts / ProjectList |
| CV-037 | 已完成 | P0 | 右键菜单点击全部无效 → mousedown 命中内部放行 | StudioFrame / CanvasContextMenu |
| CV-038 | 已完成 | P2 | 起草线起点偏移 + 直线/贝塞尔不一致 → 共享几何模块 | CanvasSurface / canvas-geometry.ts |
| CV-039 | 待处理（部分） | P1 | skill 的 H3 提示词规范是官方粗糙子集，声音设计能力未启用。**已落地部分**：六段规划法、8 类风格预设；**未落地**：三字段声音规范（`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`）未内化进 `creation-spec.ts` —— 2026-09-01 核实该文件中零匹配，三字段只出现在上游 skill（英文正文与 references/）里 | skills/creation-spec.ts |
| CV-040 | 待处理 | P1 | 多段成片音轨断裂 → Master Audio 全局基准装配 | compose.ts / host-tools.ts |
| CV-041 | 已完成 | P2 | 官方 h3-prompt-writing skill 接入 —— 随 9 skill 全量注册落地；2026-09-01 起 references/ 改为目录同步 + resourceBase 按需读取（不再内联） | scripts/sync-minimax-skills.mjs / src/skills/minimax-skills.ts / skills/ |
| CV-042 | 待处理 | P2 | 风格化画面文字能力未规划 | skills/creation-spec.ts |
| CV-043 | 待处理 | P2 | Ref2VA 音频参考与复用未利用（远期，依赖 039/040） | generate.ts / video-style.ts |
| CV-044 | 已完成 | P2 | 双击视频进原生全屏 → 播放浮层 + 移除 controls | CanvasNode / VideoPlayerModal |
| CV-045 | 已完成 | P2 | 图片大图预览浮层 + 详情入口移入右键菜单 | ImagePreviewModal / CanvasContextMenu |
| CV-046 | 待处理 | P1 | 注册表跨实例互踩（数据完整性） | projects.ts |
| CV-047 | 待处理 | P2 | 端口静默漂移无提示 | dsh-plugin-desktop |
| CV-048 | 待处理 | P2 | 缺「本机已有 DSH」官方指引（文档项） | docs/faq.md / user-guide.md |
| CV-049 | 已完成·待验收 | P1 | ask_user_choice 自由输入是 opt-in，没传就没出口 → **反转缺省为 true**（显式传 false 才隐藏；模型未传参的存量问题卡片也获得输入框） | host-tools.ts / contracts/project.ts / question-capture.tsx |
| **CV-050** | 待处理 | **P1** | **分镜重复提交堆积**（打回重做的实际杀手），CV-026 遗留项 | host-tools.ts buildShotCards |
| **CV-051** | 待处理 | **P1** | **关键帧阶段无打回**（只有确认） | StudioFrame / routes.ts |
| **CV-052** | 已修复·待验收 | **P0** | **模式切换把状态误翻回 drafting** | routes.ts setMode |
| **CV-053** | 待处理 | P2 | 审批条不醒目（无高亮 / 角标） | StudioFrame |
| **CV-054** | 待处理 | P1 | 无单版本回退（节点加 previous 字段存上一版） | contracts/canvas.ts / LayerDetailPanel |
| **CV-055** | 待处理 | P2 | 下游无过时标记（沿 sourceIds 反向 BFS 打 staleAt） | project-store / CanvasNode |
| **CV-056** | 已修复·待验收 | **P1** | **切模式解除等待后不唤醒 agent**（状态显示「制作中」，AI 实际在睡） | client/index.ts setWorkflowMode |
| **CV-057** | 已修复·待验收 | **P1** | 视频播放浮层无进度条无控制按钮（只有点击切播放/暂停）。修复：自绘控制条（可拖进度 + 时间 + 播放暂停 + 音量/静音），仍不挂原生 controls（CV-044 硬约束） | VideoPlayerModal / styles |
| **CV-058** | 已修复·待验收 | P2 | 上传图片无任何选项；引导文案与实际交互不符。**拍板：只改文案**（上传功能后续在 LLM 编排里已有）。修复：`StudioFrame.tsx` 空态引导改为真实路径「上传后在节点详情面板点『标记为参考』」 | StudioFrame 参考图空态文案 |
| **CV-059** | 已修复·待验收 | P2 | 工具栏改版：删设置按钮（**拍板：设置入口 = app 左下角全局入口**）；整理布局/图层/小地图三按钮移到最右（原设置位）并全部图标化（内联 SVG 16px stroke 2，title/aria-label 保留，开关态高亮）。`onOpenSettings` prop 保留接线预留 | CanvasToolbar / styles |
| **CV-060** | 已修复·待验收 | **P1** | 应用名迁移半途：标题栏 + productName 仍是「DSH Desktop」，托盘/更新已叫 VideoBuddy，两处不一致。修复：标题栏 span、`index.ts` productName/windowTitle、tray-locale / native-dialog-copy / recovery-copy / desktop-dialog-window 四文案文件共 53 处统一为 VideoBuddy；**main.ts PRODUCT_NAME 保持不动**（app.setName 决定 userData 目录，改名会使日志/安装 ID/profile 状态搬家，如需迁移另立专项） | dsh-plugin-desktop index.ts / ExtendedTitlebar / 四文案文件 |
| **CV-061** | 已完成·待验收 | P1 | skill 体系目录化重构：删除 186KB 内联生成物（src/skills/generated/），sync 脚本改为逐字节复制 h3 目录（SKILL.md 入口 + references/），注册设 resourceBase 渐进披露；顺带修复 co-op 视频回填模板（h3-video-prompt-template.md）缺失 | scripts/sync-minimax-skills.mjs / src/skills/minimax-skills.ts / skills/ |
| **CV-062** | 已完成·待验收 | **P1** | **ask_user_choice 多选 + 交互改版**：新增 multiSelect 参数（答案以「、」拼接回流，下游契约不变）；交互统一两段式「点选 → 确认」（单选点新项自动替换，防误触）；视觉强化——问题头部徽标 + 提示、实底 chip + hover 上浮、选中实心反色 + ✓ 前缀、确认主按钮、结算 ✓ | host-tools.ts / contracts/project.ts / question-capture.tsx / styles.ts / creation-spec.ts |
| **CV-063** | 已完成·待验收 | P2 | creation-spec 总纲迁移为 skills-local 目录 bundle（`skills-local/canvas-studio-creation/SKILL.md`）：消灭 TS 模板字符串与反引号转义风险，注册统一走目录扫描；测试改读文件 + 新增 skills/ 同步一致性校验 | skills-local/ / src/index.ts / tests/skill.test.mjs |
| **CV-064** | **已修复·待验收** | **P1** | **lobby 三态布局**（一期 lobby + 二期三态）：① 无项目（`lobby`）——chat 居中、480px 右栏压到 0px、右上角新建 CTA（LobbyHero）；② 有项目无对话（`lobby-pending`）——chat 仍居中 + 推荐技能横滚，**无新建 CTA**；③ 有对话（`work`）——切回三栏现状。**判据**：`sessionSvc.list` 当前会话 `blank` 字段（首条 prompt ACCEPTED 自动翻转 false，`list.subscribe` 触发 → 发消息即切 work，不等 agent）。**实现与原方案 C 的差异（重要）**：对话槽**不做 JSX 条件渲染搬家**——换容器会让上游 conversation 组件卸载重建（草稿/滚动/会话绑定全丢），改为 `.csChat` 常驻挂载 + CSS grid 重排（`data-mode="lobby" / "lobby-pending"`：第三列 0px、中栏切 `auto / 1fr` 两行、`.csChat` 显式落 2 行 2 列居中卡片）；工具栏/工作流条在 lobby 态用 `display:none` 让位（保持挂载，work 态 DOM 零变化）；`LobbyHero.tsx`（横向紧凑品牌条 + 双 CTA）+ `LOBBY_COPY` 文案；`grid-template-columns` 300ms 过渡（`prefers-reduced-motion` 关闭）。静态预览：`node scripts/preview-lobby.mjs` 生成单文件 HTML（三态循环 + 亮暗切换） | StudioFrame.tsx / styles.ts / LobbyHero.tsx（新）/ brand-copy.ts / scripts/preview-lobby.mjs（新）/ project-store.ts / client/index.ts |
| **CV-065** | **已修复·待验收** | **P1** | **技能广场 UI**：lobby 横滚 6-8 张推荐卡片 + "更多"进全屏广场（参照图 #2 MiniMaxHub，左栏分类侧栏 + 右栏卡片网格）。新建按钮禁用 + "待接入"角标（reserved 原则）。「使用」= 提示词插进对话输入框（复用 insertReferenceToken 通路，不自动发送）。方案：[§3](./lobby-skill-marketplace-plan.md#3-phase-c--技能广场-uicv-065-续) | SkillCard/Carousel/Market.tsx（新）/ SkillCatalog（新）/ CanvasToolbar / styles |
| **CV-066** | **已修复·待验收** | **P1** | **skill 激活链路**：「使用」= 提示词插进对话输入框（复用 insertReferenceToken 通路）+ work 态装载 `activeSkills`（store 即时更新，chip 行展示 + × 卸载）。**持久化与方案差异（重要）**：`activeSkills` 独立存 `skills.json`（`ProjectRegistry.readActiveSkills/writeActiveSkills`，原子写 + 去重 + 类型过滤，缺失/损坏降级空数组），**不碰 canvas.json 的 merge-protect 复杂逻辑**；整表替换 API 幂等（activate/deactivate 都走 saveActiveSkills）。**不做 send_system_message host 路由**——客户端已有 `insertReferenceToken` + 对话发送自然唤醒 agent 两条现成通路，无需新增 host 工具。方案：[§4](./lobby-skill-marketplace-plan.md#4-phase-d--激活链路cv-066) | projects.ts / routes.ts / api.ts / project-store.ts / ActiveSkillChips.tsx（新）/ contracts.ts / StudioFrame.tsx |
| **CV-067** | **已修复·待验收** | **P1** | **竖屏成片在画布被横屏框裁切**：`compose_video` 成片节点落盘硬编码 `260×180` 横屏占位（`compose.ts` `COMPOSED_SIZE`），9:16 竖屏视频（480×864）在横框内被 `object-fit: cover` 裁切；`onMediaNatural` 异步校正兜底不稳定（依赖 `<video onLoadedMetadata>` 时序）。**修复 + 逻辑收敛**：新增 `src/canvas-aspect.ts` 作为「真实分辨率 → 画布显示框」唯一事实来源（长边 480、1:1→420×420、短边 60 地板，对齐验收用例 I-2）；`compose.ts` 按真实分辨率换算节点框（缺分辨率回退 260×180）；`generate.ts` 删本地 `previewSizeOf` 改 import 共享；`StudioFrame.tsx` 删 `longSide480`、上传探测与媒体加载校正均走共享函数（消除三处规则漂移：1:1 曾 420/480 不一致）；`tsconfig.client.json` include 追加。验证链全绿：build ✓ / test:smoke **172/172** ✓（+7 例 canvas-aspect 契约测试）/ typecheck（Host+Client）✓ / verify:loader ✓ | compose.ts / generate.ts / canvas-aspect.ts（新）/ StudioFrame.tsx / tsconfig.client.json / tests/canvas-aspect.test.mjs（新） |

---

## 5. 已设计但零落地的模块

来源：[optimization-plan.md](./optimization-plan.md)（1122 行完整方案）。**代码核实（2026-09-01）：`WorkflowController` / `VersionManager` / `ModelAdapter` / `AssetLibrary` / `WorkflowProgress` / `resumePoint` 在 `src/` 中零匹配，全部仅停留在设计稿。**

| 模块 | 设计内容 | 与现有 CV 条目的关系 | 状态 |
| --- | --- | --- | --- |
| 五步串行工作流 | 创意→剧情→角色→分镜→视频→导出，支持暂停/恢复/单步重试 | **大部分已被更轻的实现覆盖**：审批闸、关键帧确认、重试（CV-018）、落点策略（CV-024）已落地；「暂停/恢复/中断点续跑」仍零落地 | 仅设计 |
| 双层版本控制 | 节点级 + 项目级版本，历史回溯 | 对应 **CV-054**（轻量单版本回退），未启动 | 仅设计 |
| 多模型适配层 | 12+ 模型配置、参数自动适配 | 当前后端统一 FL2VA，无切换。与产品定位冲突（我们不拼模型丰富度） | 仅设计 |
| 素材库管理 | 独立素材库、生命周期管理 | 现有「参考图托盘」是最小替代（CV-011）；独立素材库未启动 | 仅设计 |
| 实时状态反馈 | 进度条、实时状态、失败重试 | 部分落地：loading 耗时（CV-010）、toast（CV-015）、重试（CV-018）；百分比进度条未做 | 仅设计 |
| Phase 1-4 里程碑（8 周） | 基础框架 2 周 + 核心功能 3 周 + UI 2 周 + 测试 1 周 | 未启动，未排期 | 仅设计 |

**处理建议**：这份方案体量远大于当前节奏，且多处已被 CV 条目以更低成本覆盖。保留作远期参考，不进当前排期；其中「节点版本回退」抽出来并入 CV-054。

---

## 6. 历史 ID 映射

早期文档用了四套编号，查旧文档时用这张表对齐。

### O 系列（optimization-backlog）

| ID | 内容 | 现在的状态 |
| --- | --- | --- |
| O1 | 批准后自动代发「继续」 | ✅ 已完成（`client/index.ts` wakeAgent） |
| O2 | ask_user_choice 选项无高亮选中态 | 待处理（未进 CV 编号，方案见 optimization-backlog §一） |
| O3 | 右键菜单功能「似乎不可用」 | ✅ 已被 CV-037 覆盖并解决（根因：window mousedown 抢先卸载菜单） |
| O4 | 关键帧确认闸 | ✅ 已完成（方案 A，`keyframe_review` + `confirm_keyframes`） |
| O5 | DSH / 桌面包版本升级 | 独立排期（跨 ~90 依赖 + 多 patch rebase，建议单独 PR） |

### F 系列（acceptance-feedback）

| ID | 内容 | 状态 |
| --- | --- | --- |
| F1 | 导出成片未显示在画布 → 自动定位 | ✅ 已完成 |
| F2 | 详情面板增加分辨率信息 | ✅ 已完成（CV-013 补齐探测与回填） |
| F3 | 提示词按 H3 规范优化（BGM/对白/多语言） | ⚠️ 部分：基础规范在，声音/对白能力见 CV-039（待处理） |
| F4 | 整理布局按血缘分列 | ✅ 已完成 |
| F5 | 参考图交互重构（托盘 + 右键引用 + 光标插入） | ✅ 已完成 |
| F6 | 图层连线加粗 | ✅ 已完成（CV-032 补反向缩放补偿） |
| F7 / F8 | 2026-08-27 追加项 | ✅ 已完成 |

### R 系列（redo-flow-analysis，重做流程）

| ID | 内容 | 状态 |
| --- | --- | --- |
| R1 | 分镜打回意见输入框 | ✅ 已完成（2026-09-01，提交 `92a752d4b6`） |
| R2 | 节点版本化 / 版本历史 | ❌ 待排期 → 并入 **CV-054** |
| R3 | 下游 stale 级联标记 | ❌ 待排期 → 并入 **CV-055** |
| R4 | 替代标记（多版本择优） | ❌ 待排期，与决策点 D3（连线删除）合并设计 |

---

## 7. 待拍板决策点

| ID | 问题 | 候选方案 | 状态 |
| --- | --- | --- | --- |
| D1 | 文本编辑放哪 | 方案 A：双击文本=内联编辑，媒体=详情 | 已拍板（2026-08-28） |
| D2 | 时间轴定位 | 延后，CV-006/007 不进当前批次 | 已拍板·延后 |
| D3 | 连线删除语义 | 并入「多版素材择优」工作流后实施 | 已拍板·延后 |
| **D4** | **分镜重新提交时旧卡怎么处理** | A. 按镜号复用覆盖 / B. 整套替换多余删掉 / C. 整套替换 + 存档到历史分组 | ✅ **已拍板 2026-09-01 → A**：按镜号匹配旧卡，复用 id 与位置只更新文案；多出来的旧卡**保留不动**（不静默删，避免下游 `shotRefs` 断链）。解锁 CV-050 |
| **D5** | **节点版本回退做到什么程度** | A. 单版本回退（`previous` 字段，轻） / B. revisions 数组 cap 5（重，契约升级） | ✅ **已拍板 2026-09-01 → A**：节点加单个 `previous?: {url, filename, generationPrompt}`，重做前压栈，详情面板给「撤销上次重做」。不做 revisions 数组。解锁 CV-054 |
| CV-036 | 项目「已完成」标记 | 方案 A 手动标记 + 成片信号辅助 / B 全自动（不推荐） | 待拍板 |

---

## 8. 变更记录

| 日期 | 变更 | 备注 |
| --- | --- | --- |
| 2026-09-01 | 建表。合并四套历史编号（CV / O / F / R）为单一事实来源；补 CV-045 条目（此前只在 backlog 变更记录里、未进表）；新增 CV-050~055（重做方案 A/B 批次）；核实 optimization-plan.md 五大模块零落地 | 代码核实：`WorkflowController` 等 6 个关键符号在 `src/` 零匹配 |
| 2026-09-01 | O4 关键帧确认闸标记为已完成（此前 next-steps-review.md 与 hitl-workflow-analysis.md 仍标「待拍板 / 不实现」，属文档漂移） | 见 [§6](#6-历史-id-映射) |
| 2026-09-01 | **D4 / D5 拍板**：D4 → 方案 A（分镜重新提交按镜号复用覆盖，多出旧卡保留不动）；D5 → 方案 A（单版本回退 `previous` 字段，不做 revisions 数组）。CV-050 / CV-054 解锁 | 见 [§7](#7-待拍板决策点) |
| 2026-09-01 | **CV-052 深挖并补完整行为矩阵**：确认根因是 `routes.ts:644-648` 三条判据不比对 `current.mode`；最严重格为 `confirm` + `keyframe_review` 点当前模式 → 死锁（确认条消失 + AI 在睡 + setMode 无唤醒）；核实 `tests/` 对 setMode 零覆盖。**新增 CV-056**（切模式解除等待后不唤醒 agent），与 CV-052 同源正交 | 待处理 19→20。详见 [redo-redesign-plan.md §A2-1](./redo-redesign-plan.md#a2-1--修复模式切换误翻状态--cv-052p0必修10-分钟) |
| 2026-09-01 | **修正 next-steps-review.md 的漂移判断**：该文称 CV-039 已在 `creation-spec.ts:78-106` 完整落地 —— 2026-09-01 核实该文件中三字段零匹配，实际只有六段规划法与 8 类风格预设落地，三字段仅存在于上游 skill 内联文本，故 CV-039 维持「待处理（部分）」。同时核实 **CV-041 已完成**（h3-prompt-writing 随 9 skill 全量注册，内容内联在 `src/skills/generated/minimax-skills.ts`），从待办转出 | 已完成数 34→35，待处理 20→19 |
| 2026-09-01 | **CV-052 + CV-056 修复（代码落地）**：① setMode 状态决策抽为纯函数 `resolveSetModePatch`（`contracts/project.ts`），mode 未变化短路只写 mode；② `StudioFrame.tsx` 模式按钮加 `disabled` + `:disabled` 样式（防御层）；③ `client/index.ts` `setWorkflowMode` 在等待类 → `executing` 时补 wakeAgent（CV-056）；④ 新增 `tests/workflow-mode.test.mjs` 7 用例。验证链全绿：build ✓ / test:smoke 153/153 ✓ / typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（2 条）。验收法见 redo-redesign-plan §A2-1 |
| 2026-09-01 | **用户新报 4 项，立条 CV-057~060**：① CV-057 视频播放浮层无进度条/无控制（原生 controls 因 CV-044 全屏问题不可用，需自绘）；② CV-058 上传图片无选项 + 引导文案撒谎（已代码核实属实）；③ CV-059 工具栏图标化改版（去设置按钮、三按钮移最右，设置入口去向待拍板）；④ CV-060 应用名迁移半途（标题栏/productName 仍 DSH Desktop，托盘/更新已叫 VideoBuddy）。均待处理 | 待处理 18→22 |
| 2026-09-01 | **CV-057~060 修复（代码落地，待验收）**：① CV-057 浮层自绘控制条（可拖进度 pointer-capture + 当前/总时长 + 播放暂停 + 音量 slider + 静音，仍不挂原生 controls）；② CV-058 空态引导文案改真（去掉「上传时勾选设为参考图」谎言，指向详情面板标记）；③ CV-059 设置按钮移除（TOOLBAR_VISIBILITY.settings=false，prop 保留接线）+ 整理布局/图层/小地图移最右图标组（内联 SVG 16px stroke 2，title/aria-label 保留，图层/小地图开关态高亮）；④ CV-060 标题栏 span + Electron productName/windowTitle 统一为 VideoBuddy，并全量替换 tray-locale / native-dialog-copy / recovery-copy / desktop-dialog-window 共 53 处用户可见文案（main.ts PRODUCT_NAME 保持不动，避免 userData 目录迁移）。验证链全绿：build ✓ / test:smoke 154/154 ✓ / typecheck（canvas-studio Host+Client + dsh-plugin-desktop Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-057~060 四条，待处理 22→18）。**残留待确认**：setup-wizard-copy.ts / desktop-settings-locales.ts / update-lifecycle.ts / native-ui/*.html / desktop-terminal.ts 仍有用户可见「DSH Desktop」（原 CV-060 范围未含，见下条 CV-063 决策） |
| 2026-09-02 | **CV-061~063 修复（代码落地，待验收）**：CV-061 skill 目录化重构（删 186KB 内联生成物，sync 改目录复制 + resourceBase）；CV-062 ask_user_choice 多选 + 交互改版（multiSelect、点选确认、视觉强化）；CV-063 creation-spec 总纲迁 skills-local 目录 bundle。验证链全绿：build ✓ / test:smoke 154/154+ ✓ / typecheck ✓ | 状态 → **已修复·待验收**（CV-061~063） |
| 2026-09-02 | **用户新报 2 项 + 立条 CV-064~066**：需求 1 lobby 布局（无项目 chat 居中、有项目切回三栏）—— 拍板方案 C（混合：CSS class 切换 + JSX 条件渲染，work 态零回归）；需求 2 技能广场 —— 拍板方案 F（lobby 横滚卡片 + "更多"进全屏广场，参照图 #2 MiniMaxHub）。完整方案：[lobby-skill-marketplace-plan.md](./lobby-skill-marketplace-plan.md)（含 Phase A 布局 / B 数据层 / C UI / D 激活链路四阶段） | 待处理 18→21 |
| 2026-09-02 | **CV-064 Phase A 落地（待验收）**：lobby 布局改造。关键实现决策——**对话槽不搬家**：`.csChat` 常驻挂载，只靠 CSS grid 重排到中栏居中（`data-mode="lobby"` → 第三列 0px + 中栏两行 + `.csChat` 显式 grid-area），规避上游 conversation 组件卸载重建导致草稿/滚动/会话绑定丢失（原方案 C 的「JSX 条件渲染」在这里是错的，已修正）；lobby 态 `.csToolbar`/`.csWorkflowBar` 用 `display:none` 让位（保持挂载，work 态 DOM 与交互零变化）；新增 `LobbyHero.tsx` 横向紧凑品牌条 + 双 CTA（原整屏 `StudioEmptyState` 会把聊天挤出视口，组件保留不渲染）；`brand-copy.ts` 加 `LOBBY_COPY`；新增 `scripts/preview-lobby.mjs` 生成静态预览 HTML（lobby/work + 亮暗切换，不开桌面即可肉眼验收）。验证链全绿：build ✓ / test:smoke 155/155 ✓ / typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-064，待处理 21→20） |
| 2026-09-02 | **CV-065 Phase B+C 落地（待验收）**：技能广场。Phase B 数据层 —— `src/skill-catalog.ts`（`SKILL_CATALOG` 10 条 + 分类/图标/色相元数据 + `recommendedSkills()` 等查询函数；放 src/ 根目录供单测直连，单测 `tests/skill-catalog.test.mjs` 断言 skills/ 目录与目录表一致性，缺表即红）。Phase C UI —— `SkillIcon.tsx`（6 种 inline SVG，currentColor 自适应主题，未收录 id 兜底方块不空白）/ `SkillCard.tsx`（缩略图 hue 渐变现算 + 标题 + 2 行截断说明 + 分类 chip + 使用按钮）/ `SkillCarousel.tsx`（lobby 横滚，scrollBy 分页，无自动轮播）/ `SkillMarket.tsx`（全屏覆盖层，左分类侧栏 + 右卡片网格，Escape 关闭，新建按钮禁用 + 待接入角标）；接线：StudioFrame 挂 `csLobbyTail` 第三行（lobby grid 加第三行 auto）+ `skillMarketOpen` 条件渲染全屏层；CanvasToolbar 最右图标组加「技能广场」入口（work 态可用）；「使用」= 提示词插进对话输入框（复用 `insertReferenceToken` 通路，不自动发送、不注入 system prompt）；styles.ts 补全 csSkill*/csLobbyTail* 整块样式；preview-lobby.mjs 接入真实 catalog 元数据。验证链全绿：build ✓ / test:smoke **160/160** ✓ / typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-065，待处理 20→19） |
| 2026-09-02 | **CV-066 Phase D 落地（待验收）**：skill 激活链路。**与方案的差异**：① 持久化独立 `skills.json`（`ProjectRegistry.readActiveSkills/writeActiveSkills`，原子写 + 去重 + 类型过滤，缺失/损坏降级空数组），不碰 canvas.json merge-protect；整表替换 API 幂等（activate/deactivate 均走 saveActiveSkills）；② **不做 send_system_message host 路由**——insertReferenceToken + 对话发送自然唤醒 agent 两条现成通路已够。落地清单：`projects.ts` 增 `activeSkillsFile` 读写真（`tests/active-skills.test.mjs` 5 例覆盖往返/去重/降级/落盘格式）；`routes.ts` 增 `ROUTE_ACTIVE_SKILLS = '/canvas-studio/active-skills'`（GET/POST，authority + same-origin 校验，`MAX_ACTIVE_SKILLS = 12`）；`api.ts` 增 `loadActiveSkills/saveActiveSkills`；`project-store.ts` state 增 `activeSkills: Record<projectId, string[]>` + `setActiveSkills/activateSkill/deactivateSkill` actions + `activeSkillsOf` selector（`clearProject` 同步清空）；`ActiveSkillChips.tsx` 新组件（work 态工作流条下方，标题取 catalog、未收录显示注册名，× 卸载）；`contracts.ts` `StudioProjectListInjected` 补 `activateSkill/deactivateSkill` 声明（StudioFrame props 类型源头，漏了就 TS2339）；`client/index.ts` 接线（store 即时更新 + skills.json 持久化，失败回滚 store；openProject 载入）；`StudioFrame.tsx` work 态渲染 chip 行 + 升级 `handleActivateSkill`。验证链全绿：build ✓ / test:smoke **165/165** ✓（+5 例）/ typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-066，待处理 19→18） |
| 2026-09-02 | **CV-064 二期三态布局（待验收）**：lobby / lobby-pending / work。用户修改意见拍板：「有项目但未开始对话」= lobby 视觉（chat 居中）但**右上角新建 CTA 不显示**（CTA 仅无项目时出现）；「用户输入创意并确认后」才切 work。**判据链路**（先侦察后落地）：`sessionSvc.list` 当前会话 `blank` 字段 —— `blank=true` 无对话，首条 prompt ACCEPTED 后上游 manager 自动镜像 `blank→false` 进 list row 且 **`list.subscribe` 会触发**（index.ts 已有），故「点发送后立即切 work、不等 agent 响应」成立。落地：`project-store.ts` state 增 `hasConversation: Record<projectId, boolean>`（**内存态不持久化**，恢复时 openProject 从会话现算）+ `setHasConversation` action + `hasConversationOf` selector（`clearProject` 清空）；`client/index.ts` 新增 `syncHasConversation()`（现算判据，幂等）挂到 effect 主体 + workspaces/sessions 两个 subscribe + openProject 会话绑定后；`StudioFrame.tsx` `mode` 三态（`projectId===null→lobby / hasConversation→work / 其余→lobby-pending`），`canvasBody` 三分支（A→LobbyHero / B→null 不渲染中栏 / C→画布），`csLobbyTail` 条件 `mode!=='work'`（A+B 显示横滚），chips 条件 `mode==='work'`（B 态隐藏，语义：图 1 效果只在有对话后出现）；`styles.ts` 全部 `[data-mode="lobby"]` 选择器扩成 `[data-mode="lobby"], [data-mode="lobby-pending"]` 双写（B 态复用 lobby 布局）。**踩坑**：同一消息多个 Edit 并发改同一文件 → 各基于旧快照、写盘互相覆盖只留最后一个（project-store 6 连发只剩 1 个生效），必须一次一个串行；macOS BSD grep 不认 `\|` 交替（返回空误报「未生效」），用 `grep -e A -e B`。预览脚本升级三态循环演示（含对话空态块 + 项目行容器）。验证链全绿：build ✓ / test:smoke **165/165** ✓ / typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-064 二期并入 CV-064 条目，待处理 18） |
| 2026-09-02 | **CV-067 修复（代码落地，待验收）**：竖屏成片在画布被横屏框 cover 裁切（用户截图反馈）。根因 = `compose_video` 成片节点落盘硬编码 `COMPOSED_SIZE 260×180`，忽略已探明的真实分辨率（480×864 只进 mediaWidth/mediaHeight）；客户端 `onMediaNatural` 异步校正依赖 `<video onLoadedMetadata>` 时序，截图窗口期不稳。修复 = 抽 `src/canvas-aspect.ts` 共享「分辨率→显示框」换算（generate 的 `previewSizeOf` + StudioFrame 的 `longSide480`/校正三处合一，消除 1:1 曾 420/480 规则漂移），compose 落盘按真实分辨率换算（1:1→420、9:16→267×480、16:9→480×270），缺分辨率才回退占位。验证链全绿：build ✓ / test:smoke **172/172** ✓（+7 canvas-aspect 契约用例）/ typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-067，速览表顺带对齐 §4：CV-061 单列已完成·待验收、待处理补回 CV-048） |
| 2026-09-02 | **CV-068 视觉禁令护栏（代码落地，待验收）**：主模型无视觉（qwen3.8-27b-mtp），agent 生成「视觉预览」等中间产物后试图直接读本地 file_path 自查 → DSH 运行时把 png admit 成 image block 提交给模型，能力校验抛 `model does not declare image input`（用户截图反馈 3 连错）。排查结论 = 报错在 DSH 运行时（错误串不在本项目源码）；canvas-studio 工具链只收 Drama 服务器 filename（image2vl 唯一看图通道），SKILL.md 旧护栏「不要用文件读取工具打开图片」太轻未拦住 agent 走捷径。修复（方案 A 提示词护栏）：SKILL.md 核心规则升级显式禁令（无视觉能力声明 + 禁止 file_path / 图片 URL / 内嵌引用 / 附件全部读图变体 + 产物 url 用途澄清「只给展示与 upload_image，非视觉输入」+ image2vl 唯一合规通道与 upload_image 前置步骤），skills-local 源与 skills/ 产物双写一致；`host-tools.ts` image2vl description 补同款护栏（工具级兜底）。验证链全绿：build ✓ / test:smoke **175/175** ✓（+3 skill-guardrail 护栏守卫测试）/ typecheck（Host+Client）✓ / verify:loader ✓ | 状态 → **已修复·待验收**（CV-068，速览表 13→14） |
| 2026-09-02 | **CV-069 立项（竞品对标：用户信息界面，仅文档）**：用户上传 MiniMax Design 截图（项目库 + 左栏底部用户信息面板），提出补用户信息功能（假数据 mock）。可行性确认：纯前端改动，不碰 Host 路由 / canvas.json 契约，零数据风险；有 CV-065（技能广场 reserved 入口）先例。拍板四项：① 主题/设置接真实功能（ctx.theme 三态切换 / 现有 SettingsModal——用户卡恰是 CV-059「设置入口 = 左下角全局入口」的插件内落点，互补不冲突）；② 未规划条目（记忆管理 / 接入飞书·微信「未接入」badge / 教程 / 更新日志）保留入口挂「待接入」，尽量完整复刻竞品结构；③ 用户卡三态常驻（lobby / lobby-pending / work，左栏底部）；④ 假数据用中文创作人设（首字母 + 品牌色渐变 SVG 头像，不用图片资源）。技术要点：popover 关闭语义复用 CV-037 教训（mousedown 内部放行 + Escape）、浮层 position:fixed 避开 lobby grid auto-placement（CV-064 踩坑）；假数据收敛单一常量模块。方案详情进 backlog CV-069 | 待处理 17→18；编号规则更新为「已编到 CV-069，新条目从 CV-070 起」 |
| 2026-09-02 | **CV-070~088 批量合并（竞品对标 19 条，仅文档）**：新建 [competitor-analysis.md](./competitor-analysis.md)（竞品拆解草稿工作区，DA 编号 → 正式 CV 编号的暂存流程），三章分析合并——**第一章 Skill 广场**（DA-1~9 → CV-070~078）：P1 = 动态预览（素材已就绪：style-demos 8 GIF 与 skill 同名对应）/ 搜索，P2 = 悬停详情 / 我的 Skill / 精选分区，P3 = 作者下载量（**暂缓**）/ H3 角标 / 过滤排序 / 社区 CTA；**第二章 画布**（DA-10~16 → CV-079~085，含用户口述四点：编组/命名/文本滚动/hover 播放全部核实属实）：P1 = 自动编组（**前置 CV-008**）/ 命名精准化，P2 = 文本滚动 / hover 播放 / 时长角标 / 阶段清单（单独排期），远期 = hover 工具条；**第三章 项目列表与 Lobby**（DA-17~19 → CV-086~088）：分组（建议缓做）/ 封面缩略图（性能红线：列表禁全量加载 canvas.json）/ 个性化问候（与 CV-069 同批）。多处元素判定为已有覆盖不立条（LobbyHero、SkillCarousel、F1 成片定位、CV-040 音频节点等）。backlog 新增「P3 — 低优先级 / 远期记录」分区 | 待处理 18→35；编号规则更新为「已编到 CV-088，新条目从 CV-089 起」 |
| 2026-09-02 | **竞品对标批次落地（代码落地，待验收）——16 条**：**批次 1**：CV-080 命名（`generate.ts` 新增 `mediaNodeTitle`/`promptSummary` 纯函数——分镜卡镜号优先「分镜 N · 关键帧/视频」、无镜号 prompt 前 12 字摘要、皆缺回退泛化标签；storyboard_split 节点命名「单镜 N」）+ CV-081 文本滚动（选中态 overflow-y:auto + Surface wheel 对可滚正文/textarea 放行）；**批次 2**：CV-082 hover 自动播放（150ms 延迟、模块级单实例、离开归零、prefers-reduced-motion 降级、卸载清理、双击浮层不变）+ CV-083 时长角标（`canvas-aspect.ts` `formatMediaDuration` 现算 m:ss，实现决策不落盘）；**批次 3 技能广场**：CV-070 动态预览（catalog `demo` 字段 + hover 懒注入 GIF）+ CV-072 搜索 + CV-074 精选分区 + CV-071 悬停详情弹窗 + CV-073 我的 Skill（复用 CV-066 卸载链路，lobby 隐藏入口）+ CV-076 H3 角标 + CV-077 仅显示未装载过滤（排序未做）+ CV-078 社区 CTA 卡；**批次 4 画布编排**：CV-008 多选整体拖拽（gesture origins 全员起始位置，snap 校正量均摊；组内成员过滤防双重位移；store moveNode 组带动经核实已存在）+ marquee 框选（空白左键拖拽，Ctrl/Cmd 叠加，先清空再逐个加入防翻转语义 bug；拖出容器取消）+ CV-079 自动编组（`attachShotGroup` 纯函数：分镜卡 sourceIds 记组、组框随成员包围盒扩展、存量节点不追溯）+ CV-080/079 接线 generateAsset（writeCanvas 整表替代 append）；**批次 5**：CV-069 用户卡（`client/UserCard.tsx` 新组件：字母渐变 SVG 头像 + popover，主题三态/设置接真实，积分/订阅/帮助组 reserved 待接入角标，「接入飞书/微信」未接入 badge，USER_MOCK 假数据收敛 brand-copy.ts）+ CV-088 Lobby 问候（LobbyHero「你好，{USER_MOCK.name}」）。**未动**：CV-075（暂缓）、CV-084（单独排期）、CV-085（远期）、CV-086（缓做）、CV-087（待排期） | 验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / tsdown ✓（client.js 462KB）/ test:smoke **179/179** ✓（+4：mediaNodeTitle、attachShotGroup、formatMediaDuration、demo GIF 守卫；CV-031/shotRefs 测试适配整表写盘）/ verify:loader ✓。待处理 35→19，已修复·待验收 14→30 |
| 2026-09-02 | **CV-069 审查回填（修复三处）**：审查未提交批次时对 `UserCard.tsx` 逐行复核，发现并修复——① **面板打不开**：`toggle` 在 `setOpen` 的 updater 里嵌套 `setPanelPos`，React 18 会丢弃 updater 内副作用，`panelPos` 永不写入，而面板受 `open && panelPos` 双重门槛制约 → 永远打不开。改为打开前先按用户条 `getBoundingClientRect` 写 `panelPos`，再翻 `open`；② **回退设计**：原实现做成「用户条 + 外部齿轮」一行双按钮，与拍板不符，回退为**单个用户条按钮**，设置入口保持在面板内部 `.csUserSettings`（删 `.csUserBarRow` / `.csUserBarGear`）；③ **样式令牌**：`.csUserPanel` 原 `background` 用了主题包不存在的 `--dsw-alias-bg-l1` 缩写令牌（面板背景透明），已改 `--dsw-alias-bg-base`，并全仓 grep 确认无 `bg-l1/l2/l3` 等无效缩写令牌残留。`scripts/preview-user.mjs` 同步去掉齿轮、保留单按钮。验证链全绿：typecheck（Host+Client）✓ / test:smoke **179/179** ✓ / tsdown（client.js 463KB）✓ / tsc client emitDeclarationOnly ✓ / verify:loader ✓ | CV-069 保持「已修复·待验收」，计数不变 |
| 2026-09-02 | **CV-069 交互复核（二次回填，一次定位实验）**：用户桌面实测「点林小满没反应」+「林小满上方还有一个设置图标」。**设置图标** = `ProjectList` 遗漏的 `csProjectListFooter` / `csProjectSettingsIcon`（⚙），与用户卡面板内 `.csUserSettings` 设置入口重复，已删除（组件/样式一并清理；`onOpenSettings` prop 保留——error 态卡片仍在用）。**点没反应**：先做了 React 18 最小复现实验（`.workbuddy/` 临时页 + UMD react + python http server，browser 点击 `#userbar`）——复刻相同 toggle（`open` 为真先关；否则 `getBoundingClientRect` 写 `panelPos` 再 `setOpen(true)`）+ `open && panelPos !== null` 门控，**点击后面板正常出现、点外部正常关闭**，证明源码逻辑正确。结合 `scripts/dev-install.mjs` 用 `link:` 直连仓库 `lib/`、桌面 app 启动后缓存模块 —— **结论：面板打不开是桌面加载了修复前的旧 lib**（上一处嵌套 updater bug 的版本），重新构建产物后需**重启桌面 app** 才生效。二次冒烟：typecheck ✓ / tsdown（client.js 461KB，较上轮少 1.5KB=⚙ 样式/节点）✓ / test:smoke **179/179** ✓ / verify:loader ✓ | CV-069 保持「已修复·待验收」，计数不变 |
| 2026-09-02 | **CV-069 交互复核（三次回填·定论）**：用户反馈「重启后点林小满仍完全无变化（连 hover 高亮都没有）」。排查已排除：grid 兄弟 `csLobbyTail`（`3/2/4/3`）不覆盖左栏 `.csProjects`（`1/1/4/2`）；`.csFrame`/`.csProjects` 无 `transform` 祖先（fixed 面板定位不受破坏）；`.csOverlay`(z40) 为 `shell.overlay` 槽、空态 `pointer-events:none` 穿透。**健壮化重构**：面板渲染条件从 `open && panelPos !== null`（依赖 JS 量的位置 state，存在时序失败面）改为**仅 `open`**，位置改 `useLayoutEffect`（open 后 paint 前量 `barRef.getBoundingClientRect`）写入 `panelPos`，面板 style 用 `panelPos?.left ?? 12 / panelPos?.bottom ?? 24` fallback——只要 `onClick` 触发面板必渲染。**最终结论**：`AskUserQuestion` 确认「其他入口正常、仅林小满不行」后，用户**桌面完整重启，点击已正常显示**——定盘为**桌面进程缓存旧 lib**（`link:` 直连仓库 `lib/`，进程启动后不再热读），完整重启即生效；本轮重构作为消除时序类问题的保底保留。冒烟：typecheck ✓ / tsdown（client.js 461KB）✓ / test 179/179 ✓ | CV-069 保持「已修复·待验收」，计数不变 |
| 2026-09-02 | **CV-070/071 行为调整（技能卡动图默认显示 + hover 菜单）**：用户反馈「技能页面动画应默认显示，鼠标放上去只是增加一些菜单」。原 CV-070 为「hover 才懒注入动图、不 hover 静态渐变」，改为——① `SkillCard.tsx`：`showDemo = entry.demo !== undefined`（**默认渲染**动图，`loading="lazy"` 控带宽），删除仅驱动 showDemo 的 `hovered` state 与 pointer 事件（悬浮层本由 CSS `:hover` 控制）；② hover 悬浮层 `csSkillHover` 由「仅查看详情」扩为「**使用 + 查看详情**」双按钮（ghost 变体区分主次），默认动图之上叠加操作菜单而非切换动图；③ `styles.ts`：`.csSkillHover` 加 `gap` 与 `pointer-events:none`（平时不挡缩略图点击）/`:hover` 时 `auto`，新增 `.csSkillHoverGhost`，`.csSkillThumbGif` 增 `@media(prefers-reduced-motion)` 降级静态渐变。**缩略图高度 64→110px 放大动效展示**。验证链全绿：typecheck ✓ / tsdown（client.js 461KB）✓ / test:smoke **179/179** ✓ | CV-070/071 保持「已修复·待验收」，计数不变 |
