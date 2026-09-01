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

- **主线编号 `CV-xxx`** — 画布侧全部条目（缺陷 + 优化 + 小需求）共用一条序列，已编到 CV-056。新条目从 **CV-057** 起。
- **历史编号 `O1-O5` / `F1-F8` / `R1-R4`** — 早期文档遗留，不复用。映射关系见 [§6 历史 ID 映射](#6-历史-id-映射)，避免查旧文档时对不上。
- 详细技术方案仍写在 [canvas-ux-backlog.md](./canvas-ux-backlog.md)（CV 条目）与各分析文档中，本表只管状态。

---

## 1. 速览（30 秒看全局）

| 状态 | 数量 | 条目 |
| --- | --- | --- |
| 已完成 | 35 | CV-001~004, 009~020, 022~035, 037, 038, 041, 044, 045 |
| 已修复·待验收 | 2 | CV-052, CV-056 |
| 待处理 | 22 | CV-005~008, 021, 039, 040, 042, 043, 046~051, 053~060 |
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
| **CV-057** | 待处理 | **P1** | 视频播放没有进度条也没有任何控制按钮：双击视频打开的播放浮层只有「点击画面切播放/暂停」，无进度条、无时间显示、无音量、无法拖动进度 | `VideoPlayerModal.tsx`、`styles.ts` | 约束：Chromium 原生 controls 因「双击=元素全屏」shadow DOM 路径不可用（CV-044 三次修复的最终结论），浮层也不能挂。修法：浮层内**自绘迷你控制条**（进度可拖 + 当前/总时长 + 播放暂停 + 音量），仍不使用原生 controls（2026-09-01 用户提出） |
| **CV-060** | 待处理 | **P1** | 应用名迁移半途、两处不一致：标题栏硬编码「DSH Desktop」（`ExtendedTitlebar.tsx:181`）、Electron `productName: 'DSH Desktop'`（`dsh-plugin-desktop/src/index.ts:394`），而托盘与更新模块已改叫 VideoBuddy（`tray-locale.ts`、`updates.ts`）→ 同一应用两个名字。用户要求标题栏显示自己的应用名 | `dsh-plugin-desktop/src/index.ts:394`、`client/ExtendedTitlebar.tsx:181`、`recovery-copy.ts`（大量 DSH Desktop 字样） | 统一为 **VideoBuddy**：改 productName + 标题栏 span，并全量排查 recovery-copy / 日志路径文案等残留；userData 目录迁移影响需核对（2026-09-01 用户提出，附截图） |
| **CV-058** | 待处理 | P2 | 上传图片没有任何选项：点「上传图片」→ 系统文件选择器 → 直接落节点；`StudioFrame.tsx:535` 引导文案写着「上传图片时勾选『设为参考图』」——**实际交互里不存在这个勾选框，文案在撒谎**。**拍板（2026-09-01）：只改文案（方案②），不加选项浮层**——上传功能后续在 LLM 编排里已有，无需单独做。另核实上传链路为**双写**：本地落盘（`generate.ts:330` assets 目录）+ 同步上传 Drama 拿 filename（`generate.ts:333-334`）落节点，生成时无需再传；副作用是 Drama 不可用时整次上传失败、节点也不落（all-or-nothing，暂不动） | `StudioFrame.tsx:225-251`（handleUploadImage）、`StudioFrame.tsx:535`（撒谎文案） | 把 535 行文案改成真实路径（「上传后在详情面板点『标记为参考』」）。零风险小改 |
| **CV-046** | 待处理 | P1 | 项目注册表落 `$DSH_HOME/canvas-studio/`（home 级、跨 profile 共享）+ 常驻内存原子写 → 两个 DSH 实例共享 home 时后写方整表覆盖，先写方的项目从注册表消失（目录还在，表现为「项目丢了」） | `projects.ts`（registry root） | ① 迁到 profile 级目录 + 首启自动迁移；② 或 `projects.json` 加文件锁 + 写前重读合并 |
| **CV-047** | 待处理 | P2 | 端口被占时从 43120 起向后重试 32 个，**静默换端口无任何提示**，用户不知道自己开了两个 DSH | `dsh-plugin-desktop/src/desktop-port.ts` | 退避命中后托盘/通知提示「已改用端口 N」 |
| **CV-008** | 待处理 | P1 | 多选是半成品：只能 ctrl 点选，**拖拽只移动被按下的单个节点**；group 拖动不带动 children；无框选 | `CanvasSurface.tsx`（Gesture）、`project-store.ts`（moveNode） | gesture 支持多 id 集合；group 带动 parentId 成员；补 marquee |
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
| **CV-057** | 待处理 | **P1** | 视频播放浮层无进度条无控制按钮（只有点击切播放/暂停） | VideoPlayerModal / styles |
| **CV-058** | 待处理 | P2 | 上传图片无任何选项（无「设为参考图」勾选）；引导文案与实际交互不符 | StudioFrame handleUploadImage / CanvasToolbar |
| **CV-059** | 待处理 | P2 | 工具栏改版：去掉设置按钮，整理布局 / 显示图层 / 显示小地图移到最右（原设置位），三个按钮全部图标化不用文字。**拍板（2026-09-01）：设置入口已有 app 左下角全局入口，画布区域设置按钮直接删除**（注意：先确认画布设置弹窗与 app 左下角设置是否同一实例/同一持久化路径，删除时保留弹窗组件供全局入口复用） | CanvasToolbar / styles | 删设置按钮 + 三按钮移最右 + 全图标化（内联 SVG，`strokeWidth=2`、16px，title/aria-label 保留） |
| **CV-060** | 待处理 | **P1** | 应用名迁移半途：标题栏 + productName 仍是「DSH Desktop」，托盘/更新已叫 VideoBuddy，两处不一致 | dsh-plugin-desktop index.ts / ExtendedTitlebar |
| **CV-061** | 已完成·待验收 | P1 | skill 体系目录化重构：删除 186KB 内联生成物（src/skills/generated/），sync 脚本改为逐字节复制 h3 目录（SKILL.md 入口 + references/），注册设 resourceBase 渐进披露；顺带修复 co-op 视频回填模板（h3-video-prompt-template.md）缺失 | scripts/sync-minimax-skills.mjs / src/skills/minimax-skills.ts / skills/ |
| **CV-062** | 已完成·待验收 | **P1** | **ask_user_choice 多选 + 交互改版**：新增 multiSelect 参数（答案以「、」拼接回流，下游契约不变）；交互统一两段式「点选 → 确认」（单选点新项自动替换，防误触）；视觉强化——问题头部徽标 + 提示、实底 chip + hover 上浮、选中实心反色 + ✓ 前缀、确认主按钮、结算 ✓ | host-tools.ts / contracts/project.ts / question-capture.tsx / styles.ts / creation-spec.ts |

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
