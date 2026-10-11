# Canvas Studio 架构 · 功能 · 代码审查报告

> **审查日期**：2026-10-11
> **基线**：`canvas-studio` @ `c3ce22c1e5`（dev）
> **范围**：`src/**`（188+ 文件 / 6.8 万行）+ `skills/**`（22 个）+ `tests/**`（142 文件）+ `scripts/**`（50 个）+ `docs/**`（状态与方案对账）
> **发现编号**：本报告用 **`AR-xx`**（Architecture Review）**新建独立命名空间**，不占用 CV / CR / BUG / REQ 任何既有序列。
>
> ⚠️ **本文件曾被外部覆盖过一次（2026-10-11 21:56）——§6 整章与后续回写丢失，此处为完整重建版。**
> 若你的编辑器里还开着旧缓冲，请先关闭/丢弃再打开，否则会把这次重建再覆盖掉。

---

## 0. 摘要

### 0.1 一句话定位

Canvas Studio 是 DSH（DeepSeek Harness）的**画布插件**，把一个「对话驱动的 AI 视频生产线」做成宿主里的一个可装载单元：**Host 半**承担项目注册表、HTTP 面、24 个生成/编排工具、后端（Drama）通信与媒体落盘；**Client 半**向宿主槽位注入画布 UI、对话卡、设置页与资产库。它自己不做模型，是**编排器 + 事实源 + 交互壳**。

### 0.2 规模基线

| 维度 | 数量 |
| --- | --- |
| `src/**` 总代码 | 188 文件 / **68,175 行**（Host 侧 `src/*.ts` 29,152；Client 侧 `src/client/**` 34,846） |
| 测试 | 142 个 `*.test.mjs` / 30,897 行 / **~1,500 用例** |
| 技能（skills） | **22**（21 在役 + 1 弃用存档 `z-image-prompt-writing`） |
| 脚本 | 50 个（`probe-*` 探针 18 个） |
| 文档 | 55 项（`plans/` 24、`code-review/` 6） |
| Host 工具 | **24**（`host-tools.ts` 23 + `placeholder-tools.ts` 1） |
| HTTP 路由前缀 | 22 条常量 + 前缀内二级分发 |
| 错误码 | **56**（`errors/catalog.ts` 55 + `CS-UNC-000` 在 `error-system.ts` 注册） |
| 六条巨文件 | `styles.ts` 9,675 · `generate.ts` 3,442 · `StudioFrame.tsx` 2,861 · `routes.ts` 2,726 · `host-tools.ts` 2,463 · `client/index.ts` 2,453 |

### 0.3 五条核心结论

1. **工程纪律显著高于同体量项目的平均水平**。纯函数抽取层 + 守卫测试 + 统一错误系统 + 文档收尾四步构成可自我约束的循环；`TODO/FIXME` 全仓仅 2 处（且都是「防占位词」的正向文案）。**这套纪律是这个项目最值钱的资产。**
2. **完成度是真高的，但「完成」的口径偏软**。CV 主线 267 条里 `已修复·待验收` 131 条（49%），而 `已完成`（= 过桌面验收）108 条（40%）。**验收积压是当前最大的项目风险，不是代码风险。**
3. **真正需要修的技术债集中在「写盘并发」与「静默降级」两族**。两族的**主要成因都已修**：并发 → `keyed-queue`（AR-01/AR-04，已复现并回归 4/4 满额）；损坏静默降级 → 留证 + 写入守卫（AR-02 Step 1、AR-03、AR-11）。**AR-02 Step 2（用户可见错误码）待拍板。**
4. **口径漂移已经出现且无守卫拦截**：工具计数三处文档三种数字、守卫测试用 `>=` 而非 `==`、已下线工具名仍在四处活分支。
5. **架构上唯一的「大问题」是文件体量与状态耦合**：前端 28% 代码在 `styles.ts`，改样式靠**特异度打补丁**（`(0,4,1) > (0,3,1)`）；Host 三条主干各 2,500–3,500 行。

### 0.4 Top 风险清单

| ID | 严重度 | 位置 | 一句话 |
| --- | --- | --- | --- |
| AR-01 | **高**（已复现 → **已修·待验收**） | `projects.ts:395-410` | `canvas.json` 读-改-写**无串行化**（同仓 `storyboard.json` 有 `enqueue`）→ 并发写者丢节点，**实测并发 20 次只剩 1 条**；已由 `keyed-queue.ts` 按文件路径串行化修复（回归后 20/20） |
| AR-02 | **高**（**Step 1 已修·待验收**） | `projects.ts`（`loadCanvas`） | `canvas.json` 损坏**静默降级为空文档**且无留证/告警，下一次保存把空档写回 → 原内容永久丢失。已改为「留证成 `<canvas>.corrupt` 后按空画布继续；**留证失败则拒绝写入**」 |
| AR-03 | 轻微（原判中，已复核降级） | `asset-history.ts:112,132,166` · `generate.ts:854,906` | JSON 台账**非原子写**（`writeFile` 直写），中断留半写文件；**但已有串行队列，不是并发问题** —— 已修（A1） |
| AR-04 | 中（**已修·待验收**） | `video-jobs.ts:109-158` | `jobs.json` 读-改-写同样无串行 → 并行任务台账**丢记录**（丢一条 = 那条产物永远取不回）；已随 AR-01 同一队列修复 |
| AR-05 | 中（**已修·待验收**） | `video-jobs.ts:282-304` | 恢复轮询的 `stop()` **停不掉在跑的循环**（`sleep` 的 timer 不在集合里）；已接 `AbortSignal` |
| AR-06 | 中 | `STATUS.md §3.4` · `docs/README.md` · `tests/tool-presentation.test.mjs:30` | 工具计数**三处三种口径**，且守卫用 `>= 23` 无法发现增删 |
| AR-07 | 中 | `canvas-view.ts:412` 等 4 处 | 已下线工具名（`write_screenplay` 等）残留在**活分支**里，无守卫锁住「只能作 legacy 标记」 |
| AR-08 | 中 | `client/index.ts:84` · `styles.ts:197` | 客户端依赖 7 个宿主服务 + 宿主 DOM 锚点，**无宿主契约自检/降级告警** |
| AR-09 | 轻微（**已修**） | `plan-prompt.ts:90` | 原注释「不设淘汰」是刻意设计（我初判过度）；**真缺陷**是「cwd 不对应任何项目时仍写缓存条目」→ 已改 `delete` |
| AR-10 | 轻微 | `project-store.ts:1294-1296` | `addImportNode` 节点表未建时**静默 return**，导入无声丢失 |
| AR-11 | 轻微（**已修**） | `projects.ts:1245+` | `normalizeCanvasDocument` 用 `isCanvasNode` **静默丢弃** malformed 节点，无计数/告警；已加纯函数统计 + 有界告警 |
| AR-12 | 轻微 | `STATUS.md` §7-G1 | 该决策点的取证快照（「根 check 不含 canvas-studio」）**已被 CV-276 推翻**，文档未更新 |

### 0.5 本报告的凭据效力（必读）

**可以作为凭据的**：

- **优化立项的依据**。每条发现都有 `文件:行号` 与代码事实，可逐条复核；§6.4 另列「已核实无问题」，避免后来者重复排查（这一节的价值与发现同等重要）。
- **技术方案的输入**。§7 每项都写了改动点、风险面与**验收方式**。
- **排查假设的来源**。例如 AR-01 给出了「素材莫名消失」的完整机制链，且**已被复现脚本坐实**。

**不可以作为凭据的**：

- **不能当验收凭据**。本报告主体是静态取证；虽已补上 AR-01 的复现与修复自检，但**未起真机**。按 STATUS §0.1 词汇，AR-01/03/04/05/09/11 最多到 **`已修复·待验收`**，**不是** `已完成`。
- **AR-02 的「会永久丢失」是推演机制（未做故障注入复现）**，但**已按机制修复并加了 6 条守卫**（`tests/canvas-corrupt-quarantine.test.mjs`），其中「留证失败 ⇒ 拒绝写入」那条是直接构造出来的真实故障态（备份路径被占成非空目录）。
- **未经二次复核的条目不要直接引用严重度**。本报告已发生两次过度声明，均已更正：

| 条目 | 初判 | 复核后 | 原因 |
| --- | --- | --- | --- |
| AR-03 | 中危·并发损坏 | **轻微·仅半写风险** | 5 个写点**全部已有进程内串行队列**（`historyQueue` / `manifestQueue`），初判漏看调用点外层的队列 |
| AR-05 | 产品缺陷 | **测试卫生缺陷**（产品影响为零） | `startDramaJobResumeWatcher` 生产路径虽调用，但**返回值被丢弃**，生产永不调 `stop()` |
| AR-09 | 缺淘汰 | **原注释即刻意设计**，另有真缺陷 | 把兄弟模块的形态当成了标准；真问题是「cwd 不对应项目仍写条目」 |
| AR-01 | 推演机制 | **已复现，且远比推演严重** | 10 轮 10 次丢失（非窄窗口）；修复后 4/4 场景满额 |

> 未逐行核对的部分已在 §8「未在本次范围内」明确列出。**引用前请先看该节。**

---

## 1. 设计原理

### 1.1 运行形态与边界

```
┌──────────────── DeepSeek Harness 宿主（dsh-plugin-desktop / Electron）────────────────┐
│  ┌──── Host 进程（Node 22）──────────────┐   ┌──── Client 半（渲染进程）────────────┐ │
│  │ canvas-studio/src/index.ts  apply(ctx)│   │ canvas-studio/src/client/index.ts    │ │
│  │  ├─ ProjectRegistry  ← projects.json  │   │  ├─ slots.inject(...)  注入 8+ 槽位   │ │
│  │  ├─ AssetLibrary     ← 全局资产库      │   │  ├─ StudioFrame.tsx    画布壳/左栏    │ │
│  │  ├─ registerStudioRoutes(webServer)   │◀HTTP─┤  ├─ project-store.ts  单一状态树     │ │
│  │  │   22 条路由 + loopback/同源双守卫   │ 同源 │  ├─ canvas/*           画布渲染       │ │
│  │  ├─ createStudioTools → 23 工具 + 1 占位│校验 │  └─ SettingsModal / AssetLibrary     │ │
│  │  ├─ registerMinimaxSkills（扫 skills/）│   └──────────────────────────────────────┘ │
│  │  └─ 4 个 system prompt 小节            │                                            │
│  └───────────────────────────────────────┘                                            │
│  ┌──── 磁盘事实源（$DSH_HOME/canvas-studio/，跨 profile 共享）───────────────────────┐ │
│  │ projects.json（含 groupId / workflow / deleted 墓碑）· groups.json                 │ │
│  │ └─ <项目目录>/ canvas.json（画布唯一真相源）· storyboard.json（拍摄定稿）           │ │
│  │              jobs.json（异步视频台账）· skills.json · assets/ · history.json       │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│  Drama 后端（117.50.108.73:8082，同步 + 异步 jobs） · fal（付费备选） · 随包 ffmpeg      │
│  宿主 LLM（智谱 / 桌面 settings-llm 等，经多 provider 抽象层）                            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**关键边界（代码事实）**：

- 工具只能注册在 **Host**（`index.ts:171-183`）；Client 通过 HTTP 路由读写 Host 状态。
- 所有路由必须先过 `studioAuthority()`（`routes.ts:395-421`）：**loopback IP + Host 头端口一致 + hostname 必须 `127.0.0.1` + `Sec-Fetch-Site` 不得 `cross-site`**；写类再加同源校验（`mutationAllowed`）。共 65 处守卫引用点，**无裸放行路由**。
- 未配置密钥**不 fail-fast**：`resolveDramaApiKey` 返回空串（`index.ts:85-97`，CR-033 定案，因后端当前无鉴权）；fal 相反（空串由 adapter 在 submit 前抛中文错误，因 fal 强制鉴权）。

### 1.2 七条设计原则（从代码里反推出来的）

#### 原则一：单一事实源 + 事件驱动落盘（不是定时器）

每个项目一个 `canvas.json`，Host 与 Client **都**通过同一个 `registry.writeCanvas()` 落盘（`AGENTS.md`：「画布持久化是事件驱动：每类手势一个落盘点，别加全局定时器」）。

落盘入口收口在同一处（`projects.ts:395-442`），内置 **merge-protect**：客户端整档保存时，把「磁盘有、客户端快照没有、且客户端也没显式删除」的节点保留，防止「生成刚完成 → 用户拖一下画布 → 新素材被旧快照冲掉」（`projects.ts:389-442`，CV-242）。

> AR-01 修复补充：merge-protect 只能兜「磁盘有、内存没有」，**兜不住两个写者各读同一旧快照** —— 所以又加了一层 `keyed-queue` 串行化。

#### 原则二：可测的纯函数必须抽到 `src/*.ts`，不留在 `src/client/**`

`AGENTS.md` 编码约束第一条，原因很具体：Host 的 `tsconfig.json` **排除 `client`**，放进去就测不到。因此所有判定逻辑都被抽成纯函数：

| 纯函数 | 唯一口径 | 消费方 |
| --- | --- | --- |
| `isShotClip`（`shot-versions.ts:117`） | 「逐镜片段」 | `defaultComposeClips` / 时间轴 / 右键菜单 |
| `isDeprecatedNode`（`:93`） | 「废弃节点」 | 画布渲染过滤 / fit / 拖线落点 |
| `planSupersede`（`:262`） | 版本链取代规划 | `generate.ts` |
| `resolveSetModePatch`（`contracts/project.ts`） | 模式切换状态决策 | `routes.ts` |
| `studioAuthority`（`routes.ts:395`） | 请求准入 | 全部路由 |
| `canvasDropStats`（`projects.ts`，本轮新增） | 画布丢弃统计 | `readCanvas` 告警 |
| `createKeyedQueue`（`keyed-queue.ts`，本轮新增） | 同键串行 | 全部写口 |

**这是这个仓库最强的设计约束**：它把「UI 可见性判定与执行侧前置检查共用同一纯函数 ⇒ 可点的必然真能执行」写成规则。

#### 原则三：单点收口，禁止第二份实现

代码里有大量「全仓唯一权威口径」注释，且都有**反向守卫**（测试列举消费方，新增第二处即红）。例如 `isShotClip` 头注明确写：*「此前该规则在三处各写一份，CV-006/007 新增的选择层漏了『非成片』一条，直接导致成片被重复计入时长并递归叠加」*。

#### 原则四：契约优先 + 读取端容错

- 契约集中在 `src/contracts/`（canvas / project / storyboard / asset-library / reference）。
- 所有磁盘读取都过 `normalize*`：缺失字段补默认、未知字段丢弃、非法记录整条拒收。
- **注册表损坏时不覆盖**：`readDocument` 遇版本不匹配/记录非法直接 `throwError`，**原文件一字节不改**（`projects.ts:1119-1145`）——「宁可拒绝写入，也不把用户还能手工修复的坏文件改写成空表」。
- **迁移-on-read**：`workflow` 字段缺失的旧记录读时补默认，不需要迁移脚本。

#### 原则五：统一错误系统（受众 × 可恢复性双轴）

`errors/catalog.ts` 55 条 + `CS-UNC-000` 兜底，每条声明 `module` / `severity` / `audience` / `recoverability` / `channel` / `uiKind`。

链路：`wrapStudioToolDefinition` 把裸异常收敛为 `CanvasStudioError` 并暂存码 → `registerStudioToolErrorBoundary` 的 `tools/execute` 中间件把码写进结果 → 穿过 `tool/result` 抵达客户端 → `routeError()` 按双轴路由。**入口只需 `import './errors/catalog.js'` 一次**（self-registering）。

实测对账：**catalog 与全仓使用集合完全一致，无未登记码、无死码**（唯一差集 `CS-UNC-000` 为设计内兜底，在 `error-system.ts:275` 注册且有回归守卫）。

#### 原则六：技能即知识层（渐进披露）

22 个 skill 是「agent 的领域知识」，不是 UI 功能：

- `registerMinimaxSkills` 扫描包内 `skills/`，**每个含 `SKILL.md` 的目录注册成一个运行时 skill**。
- **总纲硬路由**：`canvas-studio-creation` 的 description 改成硬指令，并额外注册 **system prompt 小节**（`registerSkillRoutingPrompt`），让「先加载再澄清」每轮可见且不占 description 长度配额（CV-094 + SK-01）。
- **四个 system prompt 小节分工**：路由（总纲）→ plan 预置（画幅/时长）→ 资产库清单（`@ref[lib:…]`）→ 故事板纪律（§00/§02/§08 注入）。
- 细节分册放 `references/`（`h3-prompt-writing` 11 文件、`canvas-studio-creation` 9 文件），**按步必读**，主文件有 21KB 体积守卫。

#### 原则七：危险动作前置于工具层（param-guard）

`src/param-guard.ts` + `text-guard.ts` 在**工具入口**拦占位词、非法参数组合、带字图路由，而不是在 UI 层逐处防抖。工具 description 与错误文案共用同一份字面量（`PLACEHOLDER_PARAM_RULE`，catalog → param-guard 单向引用）。

### 1.3 数据流（一次「生成一个镜头视频」）

```
用户输入 → 宿主 LLM(agent) 决策
   │  ① skill(canvas-studio-creation) 加载总纲（硬路由保证）
   │  ② 点选式澄清（ask_user_choice）→ 落「创意」节点
   │  ③ write_storyboard → storyboard.json 分节
   │  ④ 审批闸 awaiting_approval（硬闸，拦在触达后端之前）
   ▼
Host 工具 execute（参数过 param-guard）
   │  image_generate / character_sheet / look_card → Drama 同步端点 → 落 assets/ → appendCanvasNode
   │  video_generate / video_composite → Drama 异步：
   │       POST 202 + {job_id} → jobs.json 落台账（onSubmitted）
   │       30s 轮询 GET /jobs/{id} → completed → GET /jobs/{id}/result
   │       下载（512MB / 20min 上限，流式）→ ffmpeg 实测时长 → 落盘
   ▼
结算 settle：clipIds / provider / 版本链
   │  planSupersede(nodes, input, replaces) → 版本号 + 待作废集合
   │  applySupersede → writeCanvas / appendCanvasNode（**经 keyed-queue 串行**）
   ▼
Client 回流：tool/result 事件 → store 增量更新 → CanvasSurface 重渲染
   ▼
compose_video：只拼「有效片段」（isShotClip 唯一口径）→ ffmpeg concat + BGM
```

**异步任务的恢复设计**值得单列：客户端/Host 进程死了，ComfyUI 侧任务还在跑。所以提交成功**立即**写 `jobs.json`，Host 启动时 `startDramaJobResumeWatcher` 扫描所有项目的非终态任务，每任务起**独立 30s 轮询循环**，最长跟踪 45 分钟（`video-jobs.ts:1-29`）。这是很成熟的容错设计——停止语义与台账写入的缺陷已由 AR-04/AR-05 修掉。

**生成队列的边界（重要）**：`withGenerateSlot`（`generate-queue.ts`）**只包住 HTTP 调用**（`generate.ts:1139`）——下载 / 结算 / 落盘都在**槽位之外**。所以「后端串行」不代表「写盘串行」，这正是 AR-01 的触发面。

### 1.4 超时纪律（实测无问题，值得作为范例）

`generate.ts:358-374` 有一条显式不变量：**`DRAMA_TIMEOUT_MS` 全部取值必须严格小于 `LONG_REQUEST_TIMEOUT_MS`**，且有单测断言。

| 档位 | 值 | 说明 |
| --- | --- | --- |
| `LONG_REQUEST_TIMEOUT_MS` | 1800s | 传输层上限 |
| `DRAMA_TIMEOUT_MS.image` | 720s | |
| `DRAMA_TIMEOUT_MS.video` | 2400s | **墙钟档**，非单次 fetch 超时，**显式豁免**于该不变量 |
| `DRAMA_TIMEOUT_MS.videoSubmit` | 60s | |
| `DRAMA_TIMEOUT_MS.text` | 360s | |
| `DRAMA_JOB_POLL_INTERVAL_MS` | 30s | 与恢复轮询同节奏 |
| `DRAMA_JOB_REQUEST_TIMEOUT_MS` | 15s | 单次轮询请求 |
| `UPLOAD_TIMEOUT_MS` | 600s | |
| 下载 | 媒体 512MB/20min；图片 32MB/4min | 流式 + 字节上限 |

> **注（已核实，非缺陷）**：`video = 2_400_000` 大于传输层 1800s，但**不是漏网**。`tests/long-request.test.mjs:28-47` 对它做了**显式豁免**并写明理由：视频在后端 0.5.0 异步化后，该档是 **executor 轮询的整体墙钟**，不再是单次 fetch 超时（提交走 `videoSubmit` 60s、轮询走 15s），故不受 undici 传输层约束。断言对**其余所有档**逐个校验，并把 `UPLOAD_TIMEOUT_MS` 纳入。**这是「不变量 + 显式豁免 + 写明理由」的教科书写法。**

`long-request.ts` 是支撑件：Node 内置 fetch 的 undici `headersTimeout/bodyTimeout` 默认 300s **先于**自己的 `AbortSignal` 触发，所以它从 `Symbol.for('undici.globalDispatcher.1')` 借 `constructor` 造**请求级** dispatcher 抬到 1800s——不引依赖、不动全局、**仍是 `globalThis.fetch`**（10 个打桩测试零改动）。全程防御式：取不到就返回 `undefined` 并只告警一次。

---

## 2. 代码结构地图

| 目录 | 职责 | 体量 | 关键文件 |
| --- | --- | --- | --- |
| `src/*.ts`（Host 核心） | 注册表 / 路由 / 工具 / 生成编排 / 合成 / 资产 | 29,152 行 | `generate.ts`(3,442) `routes.ts`(2,726) `host-tools.ts`(2,463) `projects.ts`(1,388) `canvas-view.ts`(1,099) |
| `src/contracts/` | 数据契约 + normalize + 纯决策函数 | 5 文件 | `storyboard.ts`(749) `canvas.ts`(543) `project.ts` |
| `src/providers/` | 视频供应商抽象层 | 10 文件 | `registry.ts` `selection.ts` `capability.ts` `executor.ts` `drama.ts` `fal.ts` |
| `src/errors/` | 错误码注册表 | 1 文件 774 行 | `catalog.ts`（55 条） |
| `src/skills/` | 技能注册与占位工具 | 3 文件 | `minimax-skills.ts` `placeholder-tools.ts` `routing-prompt.ts` |
| `src/client/` | 客户端 | 34,846 行 | `styles.ts`(9,675) `StudioFrame.tsx`(2,861) `index.ts`(2,453) `project-store.ts`(1,611) |
| `src/client/canvas/` | 画布渲染 | — | `NodeInputCard.tsx`(1,969) `CanvasSurface.tsx`(1,458) `CanvasNode.tsx`(975) `NodeDetailDrawer.tsx`(557) |
| `skills/` | 22 个技能知识包 | 10MB（含 demo GIF） | `canvas-studio-creation`(144K) `h3-prompt-writing`(128K) `effect-test-runner`(9MB) |
| `tests/` | 守卫测试 | 30,897 行 | 对 `lib/` 产物黑盒断言 + 少量源码文本断言 |
| `scripts/` | 门禁 + 探针 + 布局预览 | 50 个 | `run-smoke.mjs` `verify-client-loader.mjs` `status-summary.mjs` `preview-*.mjs`(19) `probe-*.mjs`(18) |
| `docs/` | 状态 + 方案 + 审查台账 | 55 项 | `STATUS.md` `tracking.md` `code-review/` `canvas-ux-backlog.md` |

**验证链**（`AGENTS.md` 铁律，顺序不可变）：

```sh
corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke
```

`test:smoke` 是**门禁包装**：失败集合 ⊆ `tests/baseline-red.json` 才算过；基线红已清零（2026-10-01），**任何红都是真回归**。注意「`test:smoke` 跑 `lib/` 产物，绝不能当编译闸门」。沙箱内 build 首步会撞 clean.mjs 的批量删除阈值，需拆成 `tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly`。

---

## 3. 功能清单与完成度

### 3.1 Host 工具面（实际注册 24）

**真实工具 23**（`host-tools.ts`，`defineTool` 实测 23 处）：

| 分组 | 工具 |
| --- | --- |
| 图像生成 | `image_generate` `image_generate_withtxt` `image_fix` `character_generate` `character_sheet` `look_card` |
| 分镜编排 | `list_shots` `write_storyboard` `submit_keyframes_for_approval` `ask_user_choice` |
| 视频 | `video_generate` `video_composite` `extract_last_frame` `qc_shot` |
| 音频 | `music_generation` `tts_voiceover` `cut_audio` |
| 参考与理解 | `upload_image` `list_references` `image2vl` `video2vl` |
| 文案 | `write_script` |
| 成片 | `compose_video` |

**占位工具 1**：`subtitle_burn`（返回可操作降级路径而非报错）。

**❌ 口径漂移（AR-06）**：实际 24，但 `STATUS.md §3.4` 写「26（24 真实 + 2 占位）」且清单含 4 个**已下线**名字（`prompt_enhance` 明确退役、`write_screenplay` / `submit_screenplay_for_approval` / `submit_storyboard_for_approval` 随 REQ-022 下线，仅作存量节点的 `toolName` 标记）；`docs/README.md` 又写「26（25 真实 + 1 占位）」。

### 3.2 按功能域的完成度矩阵

图例：✅ 完成（过桌面验收）· 🟡 部分 · ❌ 未做 · ⏸ 待拍板

| 域 | 能力 | 状态 | 备注 |
| --- | --- | --- | --- |
| **项目与工作区** | 创建/打开/删除/重命名 | ✅ | 含孤儿 workspace 清理 |
| | 目录名可读 / 分组 / 折叠持久化 | ✅ | |
| | 注册表跨实例隔离 | ✅ | 写前重读 + 内存合并 + 删除墓碑（CV-046） |
| | 项目「已完成」标记 | ⏸ | CV-036 待拍板 |
| | 封面缩略图 | ❌ | CV-087（红线：列表禁全量加载 canvas.json） |
| **画布基础** | 无限画布 / 缩放 / 平移 / Minimap | ✅ | |
| | 节点增删改 / 层级 / 锁定 / 隐藏 | ✅ | |
| | 右键菜单 / 方向键微调 / 缩放到选中 | ✅ | |
| | 整理布局（按血缘分列） | ✅ | |
| | 多选拖拽 / 框选 | 🟡 | 已实现，交互待改（CV-090 命中预览 + pointer capture） |
| | **血缘连线删除** | ❌ | **CV-005 待处理**（D3 拍板延后） |
| **节点与内容** | 6 种 kind + 内联编辑 + 预览浮层 | ✅ | |
| | 详情抽屉（就近工具条 + 可拖高度） | ✅ | CV-194 |
| | 资产下载 / loading 耗时 / toast | ✅ | |
| | **节点版本历史 / 回退** | ❌ | **CV-054 待处理**（D5 已拍板方案 A：单 `previous` 字段） |
| | **下游过时标记** | ❌ | CV-055 待处理 |
| **生成与工具** | 24 工具 / 重试 / 落点防重叠 / 血缘反查 | ✅ | |
| | 多模型切换 | ❌ | 后端统一 FL2VA（H3），`model`/`resolution`/`generateAudio` 是占坑参数 |
| | 声音能力 | 🟡 | BGM ✅（Yue2）；音画同步全链 ✅；**字幕烧录 ❌**（占位）；**Master Audio 全局对齐 ❌**（CV-040，`compose.ts` 有 amix 半成品） |
| **工作流 / HITL** | 分镜审批硬闸 + 关键帧确认闸 | ✅ | `PRODUCING_TOOLS` 在三个审阅态一律拦死 |
| | 关键帧打回 / 分镜打回带意见 | ✅ | |
| | 审批后自动代发「继续」（wakeAgent） | ✅ | |
| | 模式切换（逐步确认 / 放手跑） | ✅ | CV-052/056 |
| | `ask_user_choice` 选项高亮选中态 | 🟡 | O2 未进 CV，自由输入 opt-in（CV-049） |
| | 审批条醒目化 | ❌ | CV-053 |
| **成片** | 拼接 / 定位 / 导出 / 排除片段 / BGM 选择 | ✅ | |
| | 时间轴语义（只显示媒体 + 总时长） | ✅ | CV-007 最小满足 |
| | 成片不计入片段与时长 | ✅ | CV-160（`isComposeProduct`） |
| **品牌与设置** | 品牌识别 + 主题即时切换 | ✅ | |
| | 设置页（输出/工作流/存储） | ✅ | **reserved 项如实挂「待接入」角标**，未伪造已生效 |
| **故事板（REQ-022）** | 拍摄定稿只读覆盖层 / 版本链 / 落地单向终点 | 🟡 | CV-293~299 已落地，**待桌面验收** |

### 3.3 完成度总览（STATUS §1 速览，脚本自动生成）

| 状态 | 条数 | 占比 | 含义 |
| --- | --- | --- | --- |
| `已完成`（过桌面验收） | 108 | 40% | 终态 |
| `已修复·待验收` | **131** | **49%** | ⚠️ 代码已改、测试过，**用户未回归** |
| `已完成·待验收` | 3 | 1% | |
| `进行中` | 1 | 0% | CV-175 |
| `待处理` | 16 | 6% | 方案已明确 |
| `待拍板` | 7 | 3% | |
| `已撤回（误判）` | 1 | 0% | CV-145 |
| `仅设计（零落地）` | 6 大模块 | — | 见 STATUS §5 |

**六个「已设计但零落地」的模块**：五步串行工作流的暂停/恢复/断点续跑、双层版本控制、多模型适配层、实时百分比进度、Phase 1-4 八周里程碑（「素材库管理」已被 REQ-001 超越落地）。

> **这是本报告最想让你注意的非技术结论**：`已修复·待验收` 占比 49%，意味着**近一半功能处于「代码说做了、但没人在真机确认」的状态**。两个真实后果：① 回归责任悬空；② `STATUS` 作为「唯一事实来源」的权威性被稀释（它记录的是代码状态，不是产品状态）。**建议把「批量验收」当成独立工作流排期。**

---

## 4. 技能体系（22 个）

| 类别 | 技能 |
| --- | --- |
| **总纲（必先加载）** | `canvas-studio-creation`（含 `references/` 9 分册） |
| 提示词规范（按工具路由） | `h3-prompt-writing`（H3 视频 IR，11 文件）· `krea2-turbo-writing`（文生图）· `krea2-edit-writing` / `qwen-image-edit-writing`（图生图）· `music-prompt-writing`（Yue2/BGM）· `voiceover-writing`（VoxCPM2/TTS） |
| 风格导演 | `action-scene-director` · `cinematic-moves`（50 套运镜）· `oriental-mythic-visual-director` · `direct-street-interview-video` · `stage-startle-to-truce-encounter` |
| 成片形态生成器 | `3d-animation-short-generator` · `brand-promo-video-generator` · `co-op-game-intro-generator` · `minimalist-product-ad-generator` · `music-video-subtitle-generator` · `paper-collage-explainer-generator` · `papercraft-stop-motion-explainer` · `handdrawn-live-video-generator` |
| 工具型 | `effect-test-runner`（T1–T6 自动驱动 + image2vl 比对出报告） |
| 🗄️ 弃用存档 | `z-image-prompt-writing`（description 已标「已弃用·历史存档」，指向 `krea2-turbo-writing`） |

**评估**：

- **结构健康**：总纲 + 分册的渐进披露成立，且总纲有**双重保障**（硬 description + 常驻 system prompt 小节），这两条是针对 CV-094 实测故障（模型连问 3 轮才想起加载总纲、风格 skill 全程没加载）的正面修复。
- **触发词有重叠风险**：多个「生成器」类 skill 的英文 description 写了规范的 not-for 边界；但风格导演类（`action-scene-director` / `oriental-mythic-visual-director`）是中文触发词，与总纲「凡涉及生成图片/视频」存在**抢触发**可能。当前靠「总纲必须第一个加载」消解，**无守卫断言「风格 skill 不早于总纲」**。
- **缺口**：无独立「字幕文案」技能（与 `subtitle_burn` 占位一致）；无「成片节奏/剪辑」技能（与 CV-040 缺口一致）。这两个缺口与功能缺口**是同一件事的两面**。

---

## 5. 测试与工程门禁

### 5.1 覆盖情况（粗测）

以「模块 basename 是否在 `tests/` 被引用」为口径：**94 个宿主模块有引用，4 个零引用**：

- `prompt-injection.ts`（system prompt 注入）
- `storyboard-discipline-prompt.ts`（故事板纪律小节）
- `style-conflicts.ts`（风格冲突判定）
- `tool-result-text.ts`（工具结果文案）

> 其中**两个是 prompt 注入模块**：注入内容错/丢会让 agent 行为静默跑偏，且**没有任何测试会红**。属「值得补守卫」的对象。

### 5.2 测试的性质（关键判断）

测试**跑在 `lib/` 产物上**（黑盒），少量测试（如 `tool-presentation.test.mjs`）**直接读源码文本做正则断言**。后者必要（要断言「所有工具都登记了展示表」），但带来脆弱性：

```js
// tests/tool-presentation.test.mjs:30
const names = [...src.matchAll(/name: '([a-z0-9_]+)'/g)].map((m) => m[1])
assert.ok(names.length >= 23, `host-tools.ts 只解析出 ${names.length} 个工具名，正则可能失配`)
```

`>=` 而不是 `==`，意味着**工具被删/改名不会被发现**；正则在**整份源码文本**上匹配，任何位置的 `name: 'xxx'`（含 schema 属性名）都会被计入 → 计数本身不可信。**本轮新增的 `atomic-json-write.test.mjs` 刻意做了反面对照**（②扫描器自检 ④检测器自测），可作为修 AR-06 时的范式。

### 5.3 门禁现状

| 环节 | 状态 |
| --- | --- |
| 根 `yarn check` 是否含 canvas-studio | ✅ **CV-276 起已含**（`AGENTS.md:14`） |
| `test:smoke` 是否在 `check` 内 | ✅（`package.json:49`） |
| 基线红 | **已清零**（2026-10-01），任何红即真回归 ✅ |
| `verify:loader`（客户端产物装载） | ✅ |
| 布局静态预览（不开桌面肉眼验收） | ✅ 19 个 `preview-*.mjs` |
| **文档-代码漂移机读** | ❌ 无（§7-G1 方案 B 提出 `check-docs.mjs`，待拍板） |

**结论**：门禁的**执行层**扎实（编译 + 产物装载 + 1,500 用例 + 基线红比对）。薄弱处全在**记账层**：计数口径、文档状态、验收状态没有机读一致性检查，所以漂移会积累（AR-06/07/12 都是这一族的实例）。

---

## 6. 代码审查发现

> 每条都回到代码取证。**严重度定义**：高 = 会导致数据丢失/错乱或功能静默失效；中 = 特定条件下会出问题或有明确维护陷阱；轻微 = 一致性问题/潜在陷阱。

### 6.1 高危

#### AR-01 `canvas.json` 读-改-写无串行化（丢节点）—— **已复现，已修·待验收**

**位置**：`projects.ts:395-442`（`writeCanvas`）· `:488-498`（`appendCanvasNode`）· `:506-520`（`upsertAsset`）
**对比**：`storyboard-store.ts:59-77` 有 `storyboardQueue`（`enqueue` 串行）；`asset-history.ts:99` 有 `historyQueue`；`generate.ts:840` 有 `manifestQueue`。**恰好漏了最大的事实源 `canvas.json`（以及 `jobs.json`）。**

**现象**：三个方法都是 `readCanvas()` → 内存 merge → `writeFileAtomic()`，**没有互斥**。原子写只保证「文件不损坏」，**不保证「读-改-写」语义的原子性**：

```
A: read v1 ────────────────► write v1 + nodeA
B:      read v1 ────────────────────► write v1 + nodeB      ← nodeA 丢失
```

merge-protect（`:404-408`）的 `preserved` 基于自己读到的 `existing` 算，**B 的 `existing` 里没有 nodeA，所以 nodeA 不在 preserved 里**，物理消失。

**✅ 已复现（2026-10-11，`scripts/canvas-write-race-repro.mjs`，每场景 10 轮）**：

| 场景 | 期望 | 修复前实测 | 修复后实测 |
| --- | --- | --- | --- |
| 冷启动并发 `appendCanvasNode` ×20 | 20 | **1** | **20** ✅ |
| 热画布（先有 1 条）并发 append ×20 | 21 | **2** | **21** ✅ |
| 并发 `upsertAsset` ×10 | 10 | **1** | **10** ✅ |
| 并发 `recordDramaJobSubmitted` ×5（AR-04） | 5 | **1** | **5** ✅ |

**不是「窄窗口」而是「几乎必然丢」** —— 每个写者都从同一份快照起步，最后一个写者把其余全部覆盖。10 轮无一例外。

**触发路径可达（非合成场景）**：生成队列 `withGenerateSlot` 只包住 **HTTP 调用**（`generate.ts:1139`），下载 / 结算 / 落盘都在**槽位之外**；恢复轮询的 `settle` 更是完全独立的定时器。所以至少三条真实重叠路径：① 客户端拖拽保存 ‖ Host 生成结算；② 恢复轮询 settle ‖ 普通结算；③ 故事板落地 `writeCanvas` ‖ 结算。**未量化的是这些重叠在生产里的发生频率**（脚本用的是最坏形态）。

**✅ 修复（2026-10-11）**：新增 `src/keyed-queue.ts`（按**文件路径**串行的进程内队列），把 canvas 写口 / groups 写口 / jobs 写口统一入队；公开写口与「未入队实现」分层（`writeCanvas` / `writeCanvasLocked`），**只入队写口、读走原路**（`writeCanvas` 内部会调 `readCanvas`，读入同 key 会自锁）。详见 §7 落地记录。回归：4/4 场景满额，`tests/canvas-write-serialization.test.mjs` + `tests/keyed-queue.test.mjs` 共 15 条守卫进 `test:smoke`。

#### AR-02 `canvas.json` 损坏静默降级为空，且降级后会被写回（数据丢失）—— **Step 1 已修·待验收**

**位置**：`projects.ts`（读取路径 `loadCanvas` / 写入路径 `writeCanvasLocked`）

**修复前的代码**：

```ts
  try {
    const document = JSON.parse(text) as unknown
    const normalized = normalizeCanvasDocument(document)
    warnOnDroppedCanvasContent(projectId, canvasDropStats(document, normalized))
    return normalized
  } catch {
    return { version: CANVAS_DOCUMENT_VERSION, nodes: [] }   // ← 解析失败 → 静默空档
  }
```

**对比**：`storyboard-store.ts:79` 早有 `quarantine(file)` —— 故事板损坏时**留证**（备份文件名会回给用户，见 `routes.ts:87-91`）。**画布没有这个待遇。**

**影响链**：解析失败 → 返回空文档 → 上层（Host 结算或客户端保存）拿到空 `existing` → `writeCanvas` 把「空 + 新节点」原子写回 → **磁盘原始内容永久消失**。

注释说「canvas 是 disposable UI state, never fatal」——**这个假设在 REQ-022 之后不再成立**：故事板落地会 `planSeedFromStoryboard` 把整份分镜投影成画布节点（`routes.ts:180-215`），画布此时承载的是**用户确认过的生产内容**。

**✅ Step 1 已修（2026-10-11）**：

1. 新增共享件 `src/file-quarantine.ts`（`quarantineFile`）—— 把 storyboard 原有的私有 `quarantine` 逐字节抽出，`storyboard-store.ts` 改为复用它（**单点收口，禁止第二份实现**；行为不变，`storyboard-store.test.mjs` 全绿）。
2. `ProjectRegistry` 的读取改为**四态** `loadCanvas()`：`missing` / `ok` / `corrupt-purged` / `corrupt-blocked`。
3. 解析失败 → `quarantineFile()` 改名为 `<canvas>.corrupt`，**原路径清空** → 日志告知备份路径 → **按空画布继续**（画布重建可用）。
4. **唯一真正危险的路径**：留证**失败**（权限/占用）时原文件仍在原地 → 标记 `corrupt-blocked`，`writeCanvasLocked` **拒绝写入**（`CS-DEV-ERR`，`devMessage` 含「拒绝写入」）。这样「读不懂 + 迁不走 + 被覆盖」三者不可能同时发生。
5. 竞态处理：并发的另一次读已把文件迁走时（`quarantineFile` 抛 ENOENT 且路径已空），按「已留证」放行，不误判为失败。

**刻意与故事板不同的选择（写在 `file-quarantine.ts` 头注里）**：

| | 留证后 | 理由 |
| --- | --- | --- |
| `storyboard.json` | **显式报错、拒绝一切操作** | 用户创作资产的 SSOT，且 agent 可用 `write_storyboard` 重写一份 ⇒ 阻塞有出路 |
| `canvas.json` | **按空画布继续**，仅留证失败时拒绝写入 | 画布每次手势都自动保存，一律拒绝会让画布**永久不可用**（客户端每次保存都失败）；且画布**没有**等价的「重写一份」工具，阻塞等于把用户堵死。原内容此时已安全躺在 `.corrupt` 里 |

**Step 2（未做，待拍板）**：把「留证失败被拒写」从 `CS-DEV-ERR`（developer 档，用户不可见）升级为一条正式用户可见码，需要先定**受众**（用户该看到什么？）与**可恢复性**（`guided`？让用户「移走该文件后重试」）。

**守卫**：`tests/canvas-corrupt-quarantine.test.mjs`（6 条）—— 留证内容逐字节相等 / 原路径清空 / 留证后可重建 / 直接 `writeCanvas` 也先留证 / 二次损坏只留最近一次 / **留证失败必拒写且原文件不动**（用「占住备份路径为非空目录」构造真实故障态）/ 缺失与正常画布不得留证。

### 6.2 中危

#### AR-03 JSON 台账非原子写（**已复核：非并发问题，降级为轻微；已修**）

**位置**：`asset-history.ts:112`、`:132`、`:166` · `generate.ts:854`、`:906`

> **复核更正（2026-10-11 二次核对）**：本项初判为「中危·并发」是**过度声明**。实测这 5 个写点**全部包在进程内串行队列里**——`asset-history.ts:99,114,127,134,162,172` 用 `historyQueue`，`generate.ts:840,856,885,908` 用 `manifestQueue`。所以**不存在并发写同一档的问题**。剩余问题只有**原子性**：进程被杀/磁盘满时可能留下半写文件。

| 写点 | 损坏后果 | 严重度 |
| --- | --- | --- |
| `asset-history.ts` ×3 | `loadAssetHistory` 降级为空表（`:70-78`）→ **产物历史整档清零** | 轻微 |
| `generate.ts` ×2（manifest / handles） | 注释自陈「自愈加速器，不是事实源，丢了可重新积累」 | 可忽略 |

**✅ 已修**：5 处改 `writeFileAtomic`（新增 `writeHistoryFile` 收敛 3 个写点）；新增 `tests/atomic-json-write.test.mjs` **4 条棘轮守卫**（禁裸 `writeFile` 序列化 JSON / 扫描器自检 / 状态档模块须持 `writeFileAtomic` / **检测器自测**）。白名单**显式**列 `asset-library.ts:408,529,652` 的**二进制媒体写**——那三处写 `bytes`，改原子写会引入大文件双拷贝，**不该改**。

**教训（方法论）**：本次初判把「非原子写」直接等同于「会并发损坏」，漏了一步「先看调用点外面有没有队列」。这正是 CV-145 的同款错误模式——**用局部代码特征推断系统行为，而不看完整调用链**。

#### AR-04 `jobs.json` 读-改-写无串行（丢任务记录）—— **已修·待验收**

**位置**：`video-jobs.ts:109-128`（`recordDramaJobSubmitted`）· `:134-158`（`updateDramaJobStatus`）

两个函数都是 `readDramaJobs()` → 改数组 → `writeDramaJobs()`。两个并发提交流程交错即丢一条记录；一次提交与一次状态回写交错即丢掉状态更新。

**影响**：台账是**重启恢复的唯一凭据**（`video-jobs.ts:4-8` 明确说「没有台账 = 任务完成也没人取，孤儿任务白占队列」）。丢记录 = 那条视频的产物**永远不会被取回**，用户只看到「生成中」最后无声失败，且烧掉一次后端算力。实测并发 5 次只剩 1 条。

**✅ 已修**：与 AR-01 共用 `sharedWriteQueue`，key = 台账文件路径。

#### AR-05 恢复轮询的 `stop()` 停不掉正在跑的循环 —— **已修·待验收**

**位置**：`video-jobs.ts:282-304`（`startDramaJobResumeWatcher`）· `:197-199`（`sleep`）· `:213-275`（`watchDramaJob`）

原实现只 clear `timers` 集合里那批「初始 `setTimeout(…,0)`」句柄；`watchDramaJob` 内部 `sleep()` 创建的 timer **从未被登记**，`for(;;)` 循环也**没有中断标志** ⇒ `stop()` 后循环继续跑到终态或 45 分钟超龄。

**风险面（二次复核后收窄）**：`startDramaJobResumeWatcher` 在**生产路径也被调用**（`host-tools.ts:1226`），但**返回值被丢弃**——生产永不调用 `stop()`，所以**产品面影响为零**；`stop()` 的实际用户是测试（`tests/video-jobs.test.mjs` 6 处）。本条**不是产品缺陷，是测试卫生缺陷**：测试若靠 `stop()` 收尾，会留下跨用例的野外定时器与网络轮询，造成用例互相污染或进程不退出——这类问题表现为**偶发红**，最难查。

**✅ 已修**：`sleep(ms, signal)` 支持 abort 并在 abort 时立即唤醒；`watchDramaJob` 接 `AbortSignal` 并在循环头与等待后检查；`stop()` 用 `AbortController` 先 abort 再清未启动定时器。

#### AR-06 工具计数三处三种口径，且守卫无法拦截

见 §3.1。**证据**：`STATUS.md §3.4`（26 = 24+2）· `docs/README.md`（26 = 25+1）· 实测 24（23+1）· `tests/tool-presentation.test.mjs:30` 用 `>= 23`。

**建议**：① 计数**只从一处生成**（让 `createStudioTools()` 暴露注册名集合，文档由脚本注入）；② 守卫改 `assert.equal(count, N)` 且**从 `lib/` 读真实注册数**而非正则扫源码 —— 这样「文档与实现不一致」会直接红。

#### AR-07 已下线工具名残留在活分支，无守卫锁边界

**位置**：`canvas-view.ts:412`（泳道映射）· `tool-presentation.ts:69`（三档展示表）· `text-guard.ts:270`（判定 agent 写的评论文本）· `generate.ts:3221`（fallback 节点白名单）

`write_screenplay` / `submit_screenplay_for_approval` / `submit_storyboard_for_approval` 已随 REQ-022 下线（`skills/canvas-studio-creation/references/screenplay.md:5` 明确写「`write_screenplay` 已下线」），但四处**活代码**仍在处理这些名字。

**这本身是合理设计**（兼容存量节点），但**没有守卫锁住「它们只能作为 legacy 标记存在」**。

**建议**：在 `contracts/canvas.ts` 收敛显式 `LEGACY_NODE_TOOLS` 常量 + 注释；加守卫断言「`LEGACY_NODE_TOOLS` 与 `createStudioTools()` 注册名集合**交集为空**」。

#### AR-08 客户端对宿主的隐式契约面偏大，无自检与降级

**位置**：`client/index.ts:84`（`inject = ['slots','workspaces','conversationEvents','sessions','connection','settingsScope','theme']`）· `styles.ts:197`（`.csChat [data-phase="hero"] [data-slot="conversation.input.model"] button[aria-haspopup="menu"]`）

**事实**：

- 依赖宿主 7 个服务 + 8 个以上槽位。
- 样式层**按宿主渲染的 DOM 锚点**做选择器。仓库自己已记录过两次惨案——`styles.ts` 注释提到 hero 态属性通配隐藏「曾误伤模型座椅」（CV-259），CV-298 为恢复座椅要算特异度 `(0,4,1) > (0,3,1)` 并保证书写顺序。
- **无任何运行期自检**：宿主升级（pin 在 `dsh-v0.1.1-rc.2`）后槽位改名 / DOM 结构变化会导致画布**静默错位或整块消失**，错误不会以任何 `CS-*` 码浮出。

**建议**：① 启动时**宿主契约自检**（槽位注册失败即 `reportError` 一个 `CS-CLIENT-*`）；② `[data-slot=...]` 依赖集中成常量表 + 注释说明「宿主内部锚点，非公开契约」；③ 扩展已存在的 `host-boundary.test.mjs` 的 `HOST_SLOT_REQUIRED_OPTION`。

### 6.3 轻微

| ID | 位置 | 问题 | 状态 |
| --- | --- | --- | --- |
| AR-09 | `plan-prompt.ts:90` | **复核更正**：原注释「不设淘汰」是刻意设计（我初判过度）。真缺陷 = `refreshPlanPromptCache` 在「cwd 根本不对应任何项目」时也照写缓存条目；而目录名可复用（删掉后同名可再建）→ 新项目有机会读到旧项目的预置 | **已修**：按兄弟模块 `storyboard-discipline-prompt.ts:95` 口径改为 `delete`；「项目存在但无预置仍写空串」按原意保留 |
| AR-10 | `project-store.ts:1294-1296` | `addImportNode` 在 `draft.nodes[projectId] === undefined` 时**静默 return**，导入无声丢失（CV-261 已在调用侧靠「先 reload 再落」缓解，陷阱仍在） | 未修。建议让调用方拿到成败，或 store 自建空表 |
| AR-11 | `projects.ts`（`normalizeCanvasDocument`） | `.filter(isCanvasNode)` **静默丢弃** malformed 节点（历史 CV-172 的 `group` 白名单缺失就是被这条吞掉的：写进去了永远读不回） | **已修**：新增纯函数 `canvasDropStats` + **有界去重**告警（上限 64 签名，避免只进不出）。刻意**不挂错误码**（诊断事实≠操作失败） |
| AR-12 | `STATUS.md §7-G1` | 取证快照写「根 `typecheck`/`test`/`check` 全不含 canvas-studio」，但 `AGENTS.md:14` 已记 CV-276 起已含 | 未修（属口径批，用户决定本批不动） |
| AR-13 | `long-request.ts:64-67` | 自述边界：若「进程第一条请求就需要长超时」，dispatcher 取不到会**静默退回 300s** | 文件内已给方案（先发一次廉价探活）。建议在生成入口显式预热，而不是依赖「现有调用点都排在进行过探活/上传之后」这个**时序假设** |
| AR-14 | `develop` 分支 | 大量条目停在「已修复·待验收」 | 见 §0.3 第 2 条：把批量验收排成独立工作流 |

### 6.4 已核实「无问题」的点（勿重复排查）

- **路径穿越 / SSRF 防护到位**：`dirOf`（`projects.ts:279-290`）与 `readDocument`（`:1128-1135`）**双层**校验 `dir` 落在 projects 目录内；资产库 `:166,182` 校验 `startsWith(base + sep)` 且文件名过 `LIB_FILE_RE`；`removeProject` `:896` 有前缀守卫。CR-003/008 均已落地。
- **请求准入无缺口**：所有路由经 `studioAuthority`（loopback + 端口一致 + hostname 精确 `127.0.0.1` + `Sec-Fetch-Site`），写类再加同源。共 65 处守卫引用点，**无裸放行路由**。
- **错误码集合双向一致**：catalog 55 条 vs 全仓使用集合，**无未登记码、无死码**（`CS-UNC-000` 为设计内兜底，在 `error-system.ts:275` 注册 + 有回归守卫）。
- **超时不变量有逐档断言**：`video=2400s` 是写明理由的**显式豁免**（异步化后为墙钟档），`UPLOAD_TIMEOUT_MS` 也纳入同一条不变量。
- **注册表并发有解**：`commitRegistry`（`projects.ts:1192-1211`）做「写前重读 + 内存优先合并 + 删除墓碑」，跨实例覆盖已修（CV-046）。**注意：该修复只覆盖 `projects.json`** —— AR-01/AR-04 是同一类问题的**未覆盖面**，不是重复报告。
- **注册表损坏零改写**：`readDocument` 抛错而非回退，且损坏时不覆盖。**与 AR-02 修复后的画布行为并不矛盾**——注册表是纯元数据，损坏时拒绝写入不会让用户「做不了事」；画布每次手势都要落盘，一律拒绝会让它永久不可用，所以画布选择「留证 + 继续」，但把「留证失败」这一支硬拦（详见 §6.1 AR-02 的对照表）。
- **设置项诚实标注**：`SettingsModal.tsx` 的 `maxParallel` / `autoSave` / `autoSaveInterval` / `videoQuality` / `exportFormat` / `exportDir` / `hitlStoryboard` / `hitlKeyframe` / `autoRetry` **全部挂「待接入」角标**（`:491,501,511,564,572,576,579,667,670`），且实测这些字段确实**无消费者**——与「reserved 字段不伪造已生效」自规**完全一致**。`defaultVideoProvider` 挂真消费者（`generate.ts:2357`）。**这是加分项，不是问题。**
- **无技术债标记堆积**：全仓 `TODO/FIXME/HACK/XXX` 仅 2 处，且都是「必须一次写完整、不接受 TODO」这类**正向纪律文案**（`text-guard.ts:24,191`）。`console.*` 仅 10 处（本轮 A2 新增 1 处），集中在错误系统与 toast。

---

## 7. 优化方案

按「收益 / 改动量」排序，分三批。**每批都给了验收方式。**

### 批次一：正确性与数据安全（**已落地，见下方记录**）

| 项 | 动作 | 验收方式 |
| --- | --- | --- |
| AR-01 · AR-04 | 新增 `src/keyed-queue.ts`（按文件路径串行，key = 文件绝对路径）；`writeCanvas` / `appendCanvasNode` / `upsertAsset` / `releaseAssetNodes` / `createGroup` / `renameGroup` / `deleteGroup` 与 `video-jobs` 两个写函数全部入队；公开写口与未入队实现分层（`writeCanvas` / `writeCanvasLocked`） | `tests/canvas-write-serialization.test.mjs`（7 条）+ `tests/keyed-queue.test.mjs`（8 条）；`scripts/canvas-write-race-repro.mjs` 4/4 满额 |
| AR-02 | **Step 1 已做**：`loadCanvas` 四态 + `quarantineFile` 留证 + 「留证失败 ⇒ 拒绝写入」守卫；`storyboard-store` 改为复用同一留证件 | `tests/canvas-corrupt-quarantine.test.mjs`（6 条，含构造出的留证失败态） |
| AR-02 Step 2 | 把「留证失败被拒写」升级为正式**用户可见**错误码（需先定受众 / 可恢复性） | 待你拍板 |
| AR-03 | `asset-history.ts` / `generate.ts` 的 JSON 写入改 `writeFileAtomic` + lint 守卫 | `tests/atomic-json-write.test.mjs`（4 条） |
| AR-05 | `watchDramaJob` 接 `AbortSignal`；`stop()` 同时 abort 在跑循环 | `tests/video-jobs.test.mjs` 既有 6 处用例 + 队列单测 |
| AR-11 · AR-09 | malformed 节点丢弃计数 + 有界 warn；`plan-prompt` 缓存按兄弟模块口径修正 | 定向测试 |

> **为什么先做这批**：都是「局部改动 + 可单测 + 直接消除一类静默数据丢失」。AR-01/AR-04 用同一个新模块解决（实测并发 20 次从「只剩 1 条」到「20/20」）。

### 批次二：口径与守卫（防止漂移复现）

| 项 | 动作 | 验收方式 |
| --- | --- | --- |
| AR-06 | 工具计数单一来源：`createStudioTools()` 暴露注册名集合；脚本把计数注入文档；守卫改 `assert.equal(count, N)` 且从 `lib/` 读 | 守卫测试 + 手动删一个工具即红 |
| AR-07 | `contracts/canvas.ts` 收敛 `LEGACY_NODE_TOOLS`；加守卫「与注册名集合交集为空」 | 守卫测试 |
| AR-08 | 启动期宿主契约自检（槽位注册失败 → `CS-CLIENT-*`）；`[data-slot=...]` 依赖集中成常量表 | 守卫测试 + 手动改一个槽位名观察是否报码 |
| AR-12 | 更新 `STATUS §7-G1` 的取证快照 | 文档审查 |

### 批次三：结构性（需拍板，收益长期）

| 项 | 问题 | 候选方案 |
| --- | --- | --- |
| **拆巨文件** | 6 个文件 2,400–9,700 行；`styles.ts` 占前端 28% | A. 按域拆模块（canvas / conversation / settings / market）+ `styles.ts` 按组件拆 + token 分层规范，禁止新增特异度补丁；B. 只做「不新增特异度补丁」软约束；C. 不动 |
| **STATUS 机读化** | 768 行 / 138KB，单行最长 3 万字符，`已修复·待验收` 131 条无法机械筛选 | A. 拆「状态表（机读 yaml/json）」+「变更流水（md）」，状态表由脚本渲染；B. 行内加 `status:` 标签供 grep |
| **验收吞吐** | 49% 条目停在待验收 | A. 排独立**批量验收批次**（按功能域分组、每批 10–15 条、产出验收记录）；B. 把「待验收」在文档里显著化，强制每迭代消化一批 |
| **prompt 注入守卫** | `prompt-injection.ts` / `storyboard-discipline-prompt.ts` 零测试 | 断言「注入文本的必需小节都在」「未落地时不注入」 |

### 落地记录（2026-10-11，**未提交，等桌面验收**）

**第一批（A 组）** — 用户决策：`A1 + A2 + A4（含顺手 A3）` 立即做；`AR-01/AR-04` 先只写复现测试；`AR-06/07/12` 只记录不动。

| 项 | 落地内容 | 文件 |
| --- | --- | --- |
| **A1**（AR-03） | 5 处 JSON 台账写入改 `writeFileAtomic`（新增 `writeHistoryFile` 收敛 3 个写点） | `src/asset-history.ts`、`src/generate.ts` |
| **A1 守卫** | 4 条棘轮：禁裸 `writeFile` 序列化 JSON / 扫描器自检 / 状态档模块须持原子写 / **检测器自测** | `tests/atomic-json-write.test.mjs`（新，4 条） |
| **A2**（AR-11） | `canvasDropStats` 纯函数 + 有界去重告警（上限 64 签名）；刻意不挂错误码 | `src/projects.ts` |
| **A4**（AR-05） | `sleep(ms, signal)` 支持 abort、`watchDramaJob` 接 `AbortSignal`、`stop()` 先 abort 再清定时器 | `src/video-jobs.ts` |
| **A3**（AR-09） | 按兄弟模块口径把「cwd 不对应项目」改为 `delete`；保留「无预置写空串」的刻意行为 | `src/plan-prompt.ts` |
| **B1** | 复现脚本（仿 `undici-timeout-repro.mjs`，不进 CI） | `scripts/canvas-write-race-repro.mjs`（新） |

**第二批（AR-01 / AR-04 串行化）** — 用户决策「开工」。

| 项 | 落地内容 | 文件 |
| --- | --- | --- |
| **队列本体** | `createKeyedQueue()`：同 key 严格 FIFO；失败不阻断后续；链尾自清理（防只进不出）；`AsyncLocalStorage` **重入检测**（把静默死锁换成点名 key 的异常） | `src/keyed-queue.ts`（新） |
| **canvas 写口** | 公开 `writeCanvas` 入队 + 未入队的 `writeCanvasLocked`；`appendCanvasNode` / `upsertAsset` / `releaseAssetNodes` 的**读-改-写整体**入队 | `src/projects.ts` |
| **groups 写口** | `createGroup` / `renameGroup` / `deleteGroup` 入队（同一类，顺手收干净） | `src/projects.ts` |
| **jobs 写口** | `recordDramaJobSubmitted` / `updateDramaJobStatus` 入队 | `src/video-jobs.ts` |
| **刻意不排队** | `commitRegistry` / 注册表写入 —— 它自带 CV-046 的「写前重读 + 内存优先合并 + 删除墓碑」，属**收敛型**写；不排队也彻底消除「canvas → 注册表」跨 key 互等的死锁面 | — |
| **守卫** | 7 条串行化集成断言（含 2 条**反向**：不同项目必须并行、同 id 幂等不得被挤掉）+ 8 条队列不变量（含**重入必须抛错**） | `tests/canvas-write-serialization.test.mjs`、`tests/keyed-queue.test.mjs`（新） |
| **复现脚本** | 退出码语义翻转为**回归守卫**（0 = 零丢失 / 1 = 回归）；文件头固化修复前后基线 | `scripts/canvas-write-race-repro.mjs` |

**开发中被咬出的一个真问题（已修）**：既有测试 `C-10`（`tests/projects-touch.test.mjs`）用「钩住 `readCanvas`、在其中**内联**触发一次客户端保存」模拟并发。入队后这变成**同 key 重入** → 死锁。而**死锁极难发现**：挂起的 promise 链不是事件循环句柄，Node 会**正常退出**，表现为「测试被 cancelled / 业务没生效」而非报错。两条处置：
1. **队列加 `AsyncLocalStorage` 重入检测** —— 把静默死锁换成能读出 key 的异常。
2. **重写 C-10** 为忠实的生产形态（两个写者各自独立并发发起，断言两种先后顺序下结果都是 `a+b+c`）——**该场景在新实现下已结构性不可能**（同文件必然串行）。

**第三批（AR-02 Step 1：画布损坏留证）** — 用户指令「接 2，开始」。

| 项 | 落地内容 | 文件 |
| --- | --- | --- |
| **留证共享件** | `quarantineFile(file, suffix = '.corrupt')`：把 storyboard 原有的私有 `quarantine` 逐字节抽出；`storyboard-store.ts` 改为复用（单点收口，行为不变） | `src/file-quarantine.ts`（新）、`src/storyboard-store.ts` |
| **四态读取** | `loadCanvas()` → `missing` / `ok` / `corrupt-purged` / `corrupt-blocked`；`readCanvas` 保持原签名（返回 `document`），向后兼容 | `src/projects.ts` |
| **留证 + 继续** | 解析失败 → 改名成 `<canvas>.corrupt`（原路径清空）→ 日志给出备份路径 → 按空画布继续 | 同上 |
| **写入守卫** | 仅当**留证失败**（原文件仍在原地）时 `writeCanvasLocked` 抛 `CS-DEV-ERR` 拒绝写入；竞态（已被别人迁走）按已留证放行 | 同上 |
| **守卫测试** | 6 条：留证内容逐字节相等 / 原路径清空 / 留证后可重建 / 直接写也先留证 / 二次损坏只留最近一次 / **留证失败必拒写且原文件不动** / 缺失与正常画布不留证 | `tests/canvas-corrupt-quarantine.test.mjs`（新） |

**这一批被咬出的两点（都已修正）**：
1. 测试里 `registry.canvasFile(id)` 的**父目录不会自动存在** —— 必须先 `registry.create()`（`writeFileAtomic` 会自建父目录，裸 `writeFile` 不会），第一版 6 条全红就是这个原因。
2. **空文件该不该留证**：我最初写「空文件没有可保全的内容，不该留证」，但实现是按「解析失败」统一处理的（空串确实不是合法 JSON）。最后选**不留特例分支**——行为统一比省一个 0 字节备份更值，且空文件本身就是「被截断」的证据。**改的是测试断言，不是给实现加分支**（让实现去迁就一条我拍脑袋写的断言是更差的解法）。

**自检与门禁**：`tsc -p tsconfig.json` ✓ / `tsc -p tsconfig.client.json` ✓ / `tsdown` ✓（client 1.60MB）/ `verify:loader` ✓ / **项目自带全量门禁 `node scripts/run-smoke.mjs` → 1511/1511 通过，0 红**（`run-smoke 门禁 ✅ 失败集合 ⊆ 基线名单`；用例数从我改动前的 ~1486 增至 1511 = 我新增 25 条守卫）。

> **一次值得记下的排查（避免误判成回归）**：中途用「手工并发跑 42 个文件」的宽面回归时，出现过 3 处间歇红（`projects-dir.test.mjs` CV-294、`storyboard-store.test.mjs` 并发不丢写、`video-jobs.test.mjs` 恢复轮询）。三者在隔离与 `--test-concurrency=1` 下**全绿**，且两轮并行跑出的失败**不是同一批**。为排除「是不是我引入的」，我用 `git worktree` 在 HEAD（`c3ce22c1e5`）上重建 lib 跑了同一批 —— 也是一次全绿。最后用**项目自己的门禁**（`run-smoke.mjs`，同样是默认并行）跑全量 → 1505/1505 全绿。**结论：那 3 处是我机器上多个后台任务同时跑造成的资源争抢，不是代码回归。** 教训：并发测试的偶发红不要先当成回归，先用「隔离 + 串行 + HEAD 对照 + 官方门禁」四步定位。

**副作用（正向）**：A2 的告警在 B1 复现脚本第一次运行时**当场**打出「资产 1 条被容错丢弃」——据此查出复现脚本的 fixture 不合 `isStudioAsset` 契约（少 4 个必填字段），否则场景 C 会得出「竞态导致资产全丢」的**假结论**。这条可观测性在半小时内就还回了成本。

---

## 8. 附录：审查方法与可复现命令

```sh
cd canvas-studio

# 规模
find src \( -name "*.ts" -o -name "*.tsx" \) -type f | wc -l
find src \( -name "*.ts" -o -name "*.tsx" \) -type f -exec cat {} + | wc -l

# 工具体量（实测 23 + 1 占位）
grep -c "defineTool({" src/host-tools.ts
grep -cE "^[[:space:]]+name: '" src/skills/placeholder-tools.ts

# 错误码双向对账（结果：完全一致，仅 CS-UNC-000 为设计内兜底）
grep -oE "CS-[A-Z]+-[A-Z0-9]+" src/errors/catalog.ts | sort -u > /tmp/a
grep -rhoE "CS-[A-Z]+-[A-Z0-9]+" src/ | sort -u > /tmp/b
comm -13 /tmp/a /tmp/b; comm -23 /tmp/a /tmp/b

# 非原子 JSON 写（AR-03）
grep -rnE "await writeFile\(" src/*.ts

# 模块级缓存是否有淘汰（AR-09）
grep -nE "cache\.(set|delete|clear)" src/plan-prompt.ts src/storyboard-discipline-prompt.ts

# 设置项是否有消费者（验证「待接入」角标诚实性）
for k in maxParallel autoSave autoSaveInterval videoQuality exportFormat exportDir; do
  echo "$k → $(grep -rnE "\.$k\(\)" src/ | wc -l | tr -d ' ') 处调用"
done

# AR-01 / AR-04 → 回归守卫（需先 build：tsdown + tsc -p tsconfig.json）
node scripts/canvas-write-race-repro.mjs       # 0 = 零丢失；1 = 回归

# 守卫测试
node --test tests/keyed-queue.test.mjs tests/canvas-write-serialization.test.mjs tests/atomic-json-write.test.mjs
```

**本次评审新增的产物**：

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `src/keyed-queue.ts` | 运行时（承重件） | 按文件路径串行的写队列；重入检测；链尾自清理 |
| `src/file-quarantine.ts` | 运行时（承重件） | 损坏文件留证（`<file>.corrupt`）；storyboard 与 canvas 共用 |
| `tests/keyed-queue.test.mjs` | gate 守卫（8 条） | 队列不变量：串行 / 失败隔离 / 同步抛错不断链 / key 隔离 / 自清理 / pending / **重入抛错** / 跨 key 入队合法 |
| `tests/canvas-write-serialization.test.mjs` | gate 守卫（7 条） | 并发写不丢数据 + 2 条反向断言（并行性、幂等性） |
| `tests/canvas-corrupt-quarantine.test.mjs` | gate 守卫（6 条） | AR-02：留证逐字节相等 / 原路径清空 / 留证后可重建 / 直接写也先留证 / 二次损坏只留最近一次 / **留证失败必拒写且原文件不动** |
| `tests/atomic-json-write.test.mjs` | gate 守卫（4 条） | AR-03 棘轮 + 检测器自测 |
| `scripts/canvas-write-race-repro.mjs` | 回归守卫（人工版） | 修复前/后基线固化；不进 CI；退出码 0/1 |

**未在本次范围内**（避免误判，明确列出）：

- 未逐行核对 `tests/` 的全部用例语义（只做覆盖粗测与关键守卫抽查）。
- 未核对 `dsh-plugin-desktop/` 与 `deepseek-harness/` 侧宿主实现（只在边界处引用 `AGENTS.md` 约定）。
- **未起真机**（真机验收按本项目纪律留给桌面）。全量 `test:smoke` 门禁已跑：**1511/1511 通过、0 红**（`run-smoke 门禁 ✅`）。
- 「Drama 后端 `duration` 语义 / 端点可用性」等外部契约未复测（已有 `docs/api-probe/` 证据链，直接引用）。

---

## 9. 结语（给决策者）

这个插件的**技术底子比它的状态文档更健康**：错误系统、纯函数纪律、超时纪律、路径守卫、merge-protect、异步任务台账与恢复——这些是很多同类项目完全没有的东西，而且都有守卫测试兜着。

已经动手的三批说明了同一个规律：**最有价值的修复，是把「局部一次性修补」升级成「结构 + 守卫」**。AR-01 不是「加一行锁」，而是「抽一个按文件路径串行的队列 + 8 条不变量守卫 + 1 条重入检测」；AR-02 也不是「加一段留证代码」，而是「四态读取 + 共享留证件 + 只在唯一危险分支硬拦 + 6 条守卫」——于是这两类问题在该项目里**再也无法悄悄复发**。

**「会永久丢数据」这一类目前已无已知敞口**：写盘并发（AR-01/AR-04）与损坏静默降级（AR-02 Step 1、AR-03、AR-11）都已收口。剩下的都不属于数据安全，而是**让未来更便宜**：

1. **AR-02 Step 2**：把「留证失败被拒写」从 developer 档升级为正式用户可见码 —— 需要你定**受众**与**可恢复性**（这是唯一需要产品判断的一小步）。
2. **把「验收吞吐」当成一条独立工作流。** 131 条待验收不是代码问题，但它正在把「状态唯一事实来源」的可信度一点点磨掉——而这套文档体系的价值**只建立在可信度上**。
3. **口径与守卫**（AR-06/07/08/12）：工具计数单一来源、`LEGACY_NODE_TOOLS` 收敛、宿主契约自检、STATUS 取证快照更正。其中 AR-06/07/12 需要你授权动 `STATUS` / `docs/README`。
4. **结构性**（拆巨文件、STATUS 机读化）：收益长期，可按节奏。
