# OpenChatCut 技术路线对标（2026-11-13）

> **调研对象**：`/Users/wl/Desktop/job/learn/OpenChatCut`（开源 ChatCut 替代品，AGPL，
> agent-native + local-first 的 AI 视频**编辑器**）。
> **调研问题**：它与我们的路线"非常相似的部分"到底是什么，哪些值得借鉴，哪些明确不追。
> **对照基准**：canvas-studio 的生成路线（manifest DSL → CSR，REQ-034 已拍 B）与
> REQ-038 的配方/验收工具链现状。

---

## 1. 项目速览

- **定位**：`开源 ChatCut 替代品 = 本地视频工程 + 多轨时间线 + AI agent + MCP + 生产级导出`。
  核心主张："不只生成一个不能再改的视频——每次编辑都写进真实轨道/剪辑/转场/字幕/特效"。
- **栈**：TypeScript + React 19 + **Remotion 4.0.537**（web-renderer/renderer/player/media 全家）+
  Electron 43 + MCP SDK + ai-sdk 全家桶 + mediapipe/onnx（视觉几何）+ ffmpeg。
- **规模**：`server/` 86 文件（编辑会话/MCP/agent-runs）+ `src/` 1360 文件（编辑器 30 个域）+
  `remotion/` 渲染管线 + 32 个内置 agent 工作流技能（`src/agent/skills/`）。
- **工具面**：MCP 对外（Codex/Claude Code/Copilot 共享同一套编辑工具）+ 内置 agent 同工具面；
  `server/agent-runs/tool-catalog-generation.ts` 生成工具目录、`tool-policy.ts` 管准入。

**与我们最相似的部分**：同为 Remotion 生态、同为 agent-native、同样有"技能/参考文档分层 +
verify 文化 + 验收取证"这三件我们独立长出来的东西。**根本分叉**：它是**编辑器**（时间线工程，
agent 参与编辑工作流），我们是**生成器**（manifest 数据 → CSR 出片）——路线不冲突，是互补生态位。

---

## 2. 值得借鉴（按价值排序，六项）

### 2.1 渲染并发/解码器的平台化调优 ★ 最高优先（直接打我们最高 ROI 痛点）

**它做了什么**：
- `remotion/performance.mjs`：`resolveRenderConcurrency` 按 **CPU 核数 × 物理内存双预算**算
  worker 数（CPU 80% 目标、内存按"每渲染 tab ≈1.25GiB、留一半给 Electron/OS"折算，上限 24），
  支持 `OPENCHATCUT_RENDER_CONCURRENCY` 覆盖（数字或百分比）。
- `MACOS-RENDER-TUNING.md`：**实测文档的范式**——M4 Max 上 13 worker 比 4 worker 慢
  26–28%（120 帧样片 14.03s → 8.39s）；表格逐 worker 数列墙钟时间；明确写"这是计时/一致性
  检查，不是无损质量声明"；"Further testing needed" 一节列出全部未覆盖变量。
- `remotion/video-decoder.mjs`：Windows 下 WebCodecs 解码器会**静默挂死**（D3D11 解码器
  picture-buffer 池被 Mediabunny 占干 → delayRender 永不 clear → 导出卡 10% 直到超时），
  解法是按平台切 `offthread` 解码器，注释里引用 Remotion issue #10701/#11020/#11393。
- 配套 `aac-encoder-delay.mjs`（编码器延迟校准）、`direct-hardware.mjs`（硬编探针）——每个
  `.mjs` 都配一个 `.verify.mjs`（裸 node 可跑，零测试框架）。

**对我们的意义**：我们真机渲染的两大血泪——**渲染超时浪费 16.9 分钟**（canvas-phase 复盘
的增量最高 ROI 项）和"431 类静默故障排查半天"——正是它这套东西管的。我们的 render-host
并发是固定值，从未做过 worker 数实测调优。

**落点建议**：① 给 render-host 移植 `resolveRenderConcurrency` 双预算算法（纯函数，可 verify）；
② 真机做一轮 worker 数实测，产出我们自己的 `RENDER-TUNING.md`（照它的文档范式）；
③ 把"平台分支 + env 覆盖 + verify 文件"三件套作为渲染管线模块的标准形态。

### 2.2 编辑会话 + 原子提案（draft → review → applied）

**它做了什么**：所有编辑走 `begin_edit_session`（拿 editSessionId）→ draft 操作暂存 →
`review_edit_session` → 用户在编辑器里审批 → `applied` 后**一次原子 undo 步**落盘；
`approvalMode: manual`（默认）/ `auto`；会话可复用（`reuseExisting`）、可恢复
（`recover_edit_session` + recoveryActions）、孤儿会话有归属判定。

**对我们的意义**：我们的 `render_composition` 是一杆子到底——agent 迭代改片时没有
"提案 → 人审 → 原子落盘"的中间态。宿主已有 approval-gate 雏形，但**没有"多操作打包成
一个提案 + 单个 undo 步"**的语义。

**落点建议**：不引入完整会话面，但把「agent 一轮的多工具操作 = 一个原子提案」这个语义
进 approval-gate 的 backlog（人审一次批准一轮，而不是逐工具打断）。中成本，收益在 agent
改片体验。

### 2.3 验收分层（L0/L1/L2）+ 双信号取证分工

**它做了什么**：`skills/verification/SKILL.md` 定义三级验收——L0 静态（tsc/测试），
L1 真 run + 结构证据 + 渲染证据，L2 打包桌面包人工审；并强制区分**两种取证**：
`view_timeline_frames`（合成时间线真值——trims/layers/captions/effects 的编辑结果证明）
vs `view_asset_frames`（源素材原始帧——选素材/选时刻/粗剪决策用），明确写
"不要把源素材帧检查当成编辑结果的证明"。

**对我们的意义**：这与 RQ-13 的"契约闸 vs 观感闸"完全同思想，但他们把**取证路径的分工
哲学**写成了 skill 正文（按"验证的是什么"选最便宜的取证路径）。我们的取证台有渲染取证
能力，但"哪个问题该用哪个取证工具"没有成文。

**落点建议**：在 `code-driven-explainer` 的 verification 分册补一节「取证路径选择表」
（结构问题 → validateManifest/报告字段；观感问题 → pixel-audit；素材问题 → ffprobe
contact-sheet），成本极低。

### 2.4 agent 工作流技能的写作质量（剪辑手艺知识）

**它做了什么**：32 个内置工作流技能（3948 行），质量突出：
- `beat-sync-montage`：**"先定密度弧（density arc）再定切点"**——verse 和 chorus 不该用
  同样密度切；先选 3–6 个必须踩重拍的锚点，中间才是填充；**"QA by watching, not by
  counting"**（100% 卡点仍可能是烂剪辑）；连续切点的运动方向/运动轴冲突检查。
- `motion-graphic-placement`：MG 密度按 hook/problem/proof/CTA 结构分配；MG 类型匹配
  台词语义；保持整片一个视觉语言。
- `create-motion-graphics` 的**风格对齐闸**："generic quality adjectives are goals, not a
  named style"——用户说"高级感/现代感"不构成视觉方向，必须给 preset 选择集让他拍板；
  批量生产 MG 只有在用户确认过代表性样张后才放行。

**对我们的意义**：这正是我们 shot-cards/P 卡的"调参直觉"同类资产，但它管的是**剪辑决策
层**（怎么切、MG 放哪、密度怎么分布）——我们目前只有"镜头怎么做"，没有"镜头怎么编排"。

**落点建议**：把「密度弧」「锚点优先」「风格对齐闸」三条手艺规则吸收进
`code-driven-explainer` 的工作流文档（explainer-patterns 或新分册），**标注来源**。
纯文档，零代码。

### 2.5 渐进式技能暴露（load_skill + tools/list_changed）

**它做了什么**：MCP 的 `SKILL.md` 是唯一外部入口（59 行，只管路由）；专业指导留在
**运行中的编辑器里**，`load_skill('create-motion-graphics')` 按需加载，且加载动作会
**动态扩展工具清单**（`tools/list_changed` → 模型刷新工具列表）。

**对我们的意义**：我们的 skill 是静态 references 全量挂在上下文；56 张卡 + 未来更多时
"每卡的工具说明/参数"会稀释上下文。「按需加载 + 工具面随之扩展」是工具数量增长后的
上下文管理答案。

**落点建议**：不急。等宿主工具面出现上下文压力再评估；记录为 backlog 方向。

### 2.6 `.verify.mjs` 文化（裸 node 校验伴随文件）

**它做了什么**：`remotion/` 下每个纯函数模块（performance/video-decoder/render-contract/
aac-encoder-delay/direct-hardware）都配一个 `*.verify.mjs`——不用测试框架、`node xxx.mjs`
直跑、自带断言。依赖倒置最干净（"Keep this module dependency-free (bare node runs its
verify)"写在源码里）。

**对我们的意义**：我们测试全走 node:test + build 后 lib（必须先 build 才能测）。对
**渲染管线这类 node 侧纯函数**（并发预算/解码器选择/超时预算），verify 文件可以
零构建验证，适合放进脚本目录的调优工具。

**落点建议**：低优先级借鉴格式；只在新增 node 侧渲染调优模块时采用。

---

## 3. 明确不追（三条，附理由）

| 不追项 | 它的做法 | 为什么不追 |
| --- | --- | --- |
| **编辑器路线** | 时间线工程：多轨剪辑、真实可编辑、undo/版本 | REQ-034 已拍生成路线（B/CSR）。编辑器是另一个产品形态，互补而非竞争——他们的用户是"要改片的人"，我们的是"要出片的人" |
| **agent 写 JSX 资产（MG 路线）** | Motion Graphic = agent 直接写 JSX 代码资产 + 可编辑属性 | REQ-038 §6 非目标 1：我们产出**数据**不产出代码（对方产出代码）。且 JSX 资产 = 打包面/安全面/版本面全套成本 |
| **WebGL 特效库 + 巨依赖面** | 102 个 frag shader 的 GL pass 图、ai-sdk 全家桶、onnx/mediapipe | 我们已拍 SVG/预生成路线顶替 web-renderer 局限（REQ-038 批 2 实证），引 GL 破坏"零打包 +0MB"；它是 Electron 桌面应用可以背依赖，我们是宿主插件不可以 |

> 一个值得记录的技术事实：他们同样在用 `@remotion/web-renderer`（4.0.537），但效果走的是
> **自建 GL runtime + 单输入 shader pass**，不是 web-renderer 的 CSS 通道——侧面印证我们的
> 判断：web-renderer 的 CSS 能力不足时，两条出路是 GL（它选的，重）或 SVG/预生成（我们选的，轻）。

---

## 4. 汇总：可执行落点

| # | 落点 | 价值 | 成本 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | render-host 移植双预算并发算法 + 真机 worker 实测 + `RENDER-TUNING.md` | 直打渲染超时最高 ROI | 小（纯函数）+ 真机半天 | **P0 候选，进 backlog** |
| 2 | verification 分册补「取证路径选择表」 | 低成本高复用 | 极小 | 随手做 |
| 3 | 吸收三条剪辑手艺规则进工作流文档（密度弧/锚点/风格闸，标注来源） | 补"编排层"知识空白 | 小 | 随手做 |
| 4 | approval-gate 的"原子提案"语义 backlog | agent 改片体验 | 中 | backlog |
| 5 | 渐进式技能暴露 | 上下文管理 | 中 | 观察项（工具面有压力再做） |
| 6 | `.verify.mjs` 格式 | node 侧纯函数零构建验证 | 极小 | 新模块时采用 |

---

## 5. 一句话结论

OpenChatCut 与我们共享 Remotion 生态和 agent-native 理念，连"技能分层 + verify 文化 +
观感/契约双闸验收"都独立长成了同构物——**这验证了我们路线的工程判断没有跑偏**。
但它是编辑器、我们是生成器，生态位互补；真正值得搬的是**渲染管线的平台调优工程**
（并发预算/解码器切换/实测文档范式，直打我们渲染超时的最高 ROI 项）和**剪辑编排层的
手艺知识**（密度弧/锚点/风格闸），其余按 backlog 节奏吸收。GL 特效库与 JSX 资产路线
明确不追。
