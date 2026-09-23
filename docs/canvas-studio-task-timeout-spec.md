# Canvas Studio 任务调度与超时判定 — 功能说明与错误手册

> 适用范围：`canvas-studio/src` 下的媒体生成任务系统（宿主生成队列 + Drama 后端 + 执行器轮询 + 客户端占位结算）。
> 所有引用均为 `文件:行号`，对应 2026-09-23 已将全部超时常量翻倍后的代码状态。
> 后端 Drama API（`117.50.108.73:8082`）为**同步阻塞式单任务**：同刻只处理一个请求，并发只排队。

---

## 0. 系统定位

项目里没有独立的"任务管理系统"模块；**调度与超时能力分散在三层协作**：

1. **宿主侧同步单任务队列**（`generate-queue.ts`）—— 把并发收敛为 1，并提供可读快照。
2. **多档超时判定** —— 传输层 / 应用层 / 执行器轮询 / 客户端占位，各管一段。
3. **队列快照下发与 UI 投影**（`queue-view.ts` + `routes.ts` + `client/index.ts`）。

---

## 1. 任务调度层 — 宿主生成队列（CV-220, `generate-queue.ts`）

**约束**：同刻最多 1 个 `active`，严格 FIFO，不插队。

| 项 | 实现 |
|---|---|
| 唯一拦截点 | `callDrama`（`generate.ts:888`）—— 媒体生成的唯一网络入口 |
| 入队等待 | `acquire(label, signal)`：入 `waiting[]`，调 `pump()` 尝试授权 |
| 授权推进 | `pump()`：仅当 `active===null` 时出队一个并 `grant()`。漏调会锁死整条队列 |
| 槽位释放 | `withGenerateSlot()` 在 `finally` 里 `active=null; pump()`（`generate-queue.ts:123`） |
| 等待中被取消 | `onAbort` 把条目从 `waiting` 摘除并 reject；若不清会锁死队列（有单测钉住） |
| 不排队的范围 | 上传、健康探针、文本工具、异步供应商 fal（三段式不走 `callDrama`） |
| 快照 | `generateQueueSnapshot()` → `{ active, waiting[] }`，**只有事实，无 `busy` 字段** |

**关键不变式**：队列等待阶段不计时（拿到槽位前不走 `dramaPost`，也就不消耗 `timeoutMs`）。

---

## 2. 传输层超时 — `long-request.ts`

**问题（CV-133 P0）**：Node 内置 fetch 经 undici，默认 `headersTimeout=bodyTimeout=300s`，且**先于我们自己的 AbortSignal 触发**。视频推理 >300s 必然在 ~301s 被掐（`UND_ERR_HEADERS_TIMEOUT`），且会让 `DRAMA_TIMEOUT_MS.video=1200s` 形同虚设。

**方案**：按请求注入请求级 dispatcher 把上限抬到 `LONG_REQUEST_TIMEOUT_MS = 1_800_000`(1800s)（`long-request.ts:34`）。
- 借 undici 全局 dispatcher 的 well-known symbol `Symbol.for('undici.globalDispatcher.1')` 取其 `constructor` 造同款实例，`headersTimeout/bodyTimeout=timeoutMs`。
- **防御式**：取不到符号 → 返回 `undefined` 退回 300s + 告警一次，**绝不抛错、不阻断生成**。
- ⚠️ **已知风险**：该 symbol 在**首次请求之后**才存在（`long-request.ts:64` 注释确认）。若运行环境在"首次请求前"就发出需要长超时的请求，会**静默退回 300s** 并可能报误导性的 `UND_ERR_HEADERS_TIMEOUT`。排查"频繁超时"时，优先看宿主日志是否有 `无法抬高 fetch 传输层超时上限` 这句告警。

---

## 3. 应用层超时判定 — `generate.ts`

超时常量表（均已翻倍，`generate.ts`）：

| 常量 | 位置 | 当前值 | 用途 |
|---|---|---|---|
| `DRAMA_TIMEOUT_MS.image` | `generate.ts:282` | 720_000 (720s) | 图片生成 |
| `DRAMA_TIMEOUT_MS.video` | `generate.ts:282` | 1_200_000 (1200s) | 视频生成 |
| `DRAMA_TIMEOUT_MS.text` | `generate.ts:282` | 360_000 (360s) | 文本类 |
| `MEDIA_DOWNLOAD_TIMEOUT_MS` | `generate.ts:288` | 1_200_000 (1200s) | 视频下载（512MB 上限） |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | `generate.ts:290` | 240_000 (240s) | 图片下载（32MB 上限） |
| `HEALTH_TIMEOUT_MS` | `generate.ts:393` | 20_000 (20s) | 健康探针 |
| `UPLOAD_TIMEOUT_MS` | `generate.ts:629` | 600_000 (600s) | 文件上传 |

`dramaPost`（`generate.ts:481` 附近）判定逻辑：
1. 探活前置（`ensureDramaReachable`），宕机先抛中文错，不进长超时。
2. 组合信号：`composed = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])` + 注入 dispatcher。
3. **重试**：仅 `502/503/504` 重试一次；**本地超时不再重试**（同步阻塞式，重试=再等一整档，最坏 40 分钟）。
4. **超时现场化（CV-219）**：超时抛错前调 `probeQueueDepthNow()`（`generate.ts:463`）探后端队列深度，错误信息带"后端当前有 N 个任务在执行/空闲"，避免含糊说"可能繁忙"。

**不变量**：`LONG_REQUEST_TIMEOUT_MS(1800s)` 严格大于所有 `DRAMA/MEDIA/UPLOAD` 档（最大 1200s）；`PENDING(1320s)` 与 `DRAMA.video(1200s)` 保持 120s 余量（见 §5）。

---

## 4. 执行器轮询超时 — `providers/executor.ts`

`runVideo()`（异步轮询型供应商走这条）：
- `deadline = Date.now() + (ctx.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS)`（`executor.ts:96`），`DEFAULT_VIDEO_TIMEOUT_MS = 1_200_000`（`executor.ts:15`）。
- 每轮 `poll` 前先判 `signal.aborted`（先 `provider.cancel()` 再抛，行 100-102），再判 `Date.now() > deadline`（先 cancel 远端再抛中文超时错，行 104-109）。
- `sleep(ms, signal)`（行 27）可被 abort **打断但 resolve 不 reject** —— 把"已取消"交给循环顶部统一处理（否则绕过 cancel，远端留孤儿任务）。
- 轮询间隔默认 `DEFAULT_POLL_INTERVAL_MS = 1500`（行 97）。

---

## 5. 客户端占位结算上限 — `client/index.ts`

- `PENDING_TIMEOUT_MS = 1_320_000`(1320s)（`client/index.ts:606`），从占位节点落地起算。
- **原 bug（CV-220 前）**：与 `DRAMA_TIMEOUT_MS.video=1200s` 仅差 60s，一旦请求排队，后面的占位"还没轮到"就被判"生成超时"。
- **修正**：计时器可重起；`pollGenerationQueue()` 每 2s 一次（`QUEUE_POLL_MS`），在**队列非空期间顺延全部占位计时器** —— 把"我们自己造成的排队等待"从超时里摘出去。
- 轮询只在有生成在飞时跑（`pendingTimers.size>0 || clientGenerations>0`），空闲即停 → 零后台流量。
- 遮罩文案 `generationQueueNote()`（`queue-view.ts:121`）→ `生成队列：{active} · 等待 {waiting} 个`（只讲"谁占着唯一通道"，不做假精度的"我排第几"）。

---

## 6. 快照下发与 UI 投影 — `routes.ts` + `queue-view.ts`

- `GET /canvas-studio/generate/queue` → `generateQueueSnapshot()`（`routes.ts:560`）。
- `client/api.ts:159 fetchStudioGenerateQueue()` 拉取，`normalizeGenerateQueueSnapshot()` 归一化（形状不对 → `null`，保持上一拍状态，不降级成空队列）。
- `generationQueueStateOf()`：**只有 `waiting.length>0 且 active!==null` 才返回非 null** → 单请求在跑时不进 UI，也避免每 2s 造对象触发订阅者重渲染。

---

## 7. 项目切换与多项目并发安全性

**结论：安全，不会丢失或错乱。**

- 宿主生成队列 `generate-queue.ts` 是**全局单槽 FIFO，不承载 projectId**；每次生成的"归属"靠调用闭包里的 `projectId` 一路携带到写回节点（`retryStudioNode(projectId, node)`），结果只落回发起它的那个节点，不会串项目。
- 项目切换（`openProject`，`client/index.ts:1093`）**不会** abort 在途任务，也不清 `pendingTimers`（计时器以 `runId` 为键全局存活，队列轮询每 2s 顺延）。切换后原项目的生成继续跑，完成后 `reloadCanvasQueued(projectId)` 只重载那个项目。
- **多项目同时跑支持**：共用唯一槽位、被后端单任务串行化，数据互不污染。
- **唯一外观瑕疵**（非数据问题）：队列提示 `生成队列：…·等待 N 个` 是 store 里的**全局投影**，可能显示在你当前打开的、并非正在生成的那张项目画布上 —— 纯显示，不影响任何数据。

---

## 8. 错误手册（重点 / 详细）

> 按"用户能看到的报错"归类。每条含：文案格式（含变量）、触发原因、抛出位置、处置建议。
> 严重度：🔴 阻塞性（任务失败需重试）｜🟡 信息/可恢复｜⚪ 兜底提示。

### 8.1 超时类（Timeout）

| # | 报错文案（格式） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|
| T1 | `Drama Backend {N}s 内未返回结果（已放弃重试）：{队列备注}，本次可能是时长超出该档上限——可稍后重试或缩短时长。`<br>注：{队列备注}∈ `后端当前有 {N} 个任务在执行` / `后端当前空闲` / `后端队列深度未知` | `dramaPost` 本地超时（传输层/应用层上限内无响应）。同步阻塞式后端重试无益故放弃 | `generate.ts:514-516` | 看 {队列备注}：若"有 N 个任务"→后端被占/慢；若"空闲"仍超时→查传输层（§2 风险） |
| T2 | `文件上传 {N}s 内未完成：{底层错误}` | `UPLOAD_TIMEOUT_MS`(600s) 触发 | `generate.ts:652` | 网络/后端慢，重试上传 |
| T3 | `{provider.label} 生成超时（超过 {seconds} 秒），已尝试取消任务` | 执行器 `runVideo` 轮询 `deadline` 触发（异步供应商）；先 cancel 远端再抛 | `executor.ts:109` | 重试该节点；若反复超时缩短时长/分辨率 |
| T4 | `生成超时：等待产物超过上限。请在画布右键该节点选择「重试」，或在对话中让 agent 重新生成。` | 客户端 `PENDING_TIMEOUT_MS`(1320s) 兜底（仅"事件丢失、卡在生成中"场景） | `client/index.ts:626` | 右键节点「重试」或让 agent 重生成 |
| T5 | `波形解码超时（{N}s）` | `waveform-host` ffmpeg 超时（N=120） | `waveform-host.ts:156` | 非阻塞；重试或忽略波形 |

### 8.2 网络 / 连接类（Network）

| # | 报错文案 | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|
| N1 | `Drama Backend 连接失败（已重试一次）：{cause}，请检查服务是否可达。` | 网络错误且 2 次均失败 | `generate.ts:523` | 确认后端 `117.50.108.73:8082` 可达 |
| N2 | `Drama Backend 暂时不可用（HTTP {status}），已自动重试一次` | 502/503/504 网关错误，记录并自动重试一次（非最终抛出，重试仍失败则转 N1/T1） | `generate.ts:500` | 多为后端瞬时过载，自动重试已覆盖；持续出现查后端状态 |

### 8.3 生成失败类（Generation Failure）

| # | 报错文案 | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|
| G1 | `生成失败: {describeError(response)}` | `dramaPost` 返回非 2xx | `generate.ts:900`、`generate.ts:1215` | 看 `describeError` 详情；后端业务错误 |
| G2 | `生成响应中未找到产物 URL` | 200 但响应无 `url` 字段 | `generate.ts:904` | 后端返回结构异常，升级/联系后端 |

### 8.4 下载 / 上传类（Download / Upload）

| # | 报错文案（格式） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|
| D1 | `{label}失败: {status}`（label=媒体/图片） | 下载 HTTP 非 2xx | `generate.ts:305` | 看状态码；源地址失效/权限 |
| D2 | `三视图拼图下载失败: {status}` | 三视图拼图下载非 2xx | `generate.ts:2113` | 同上 |
| D3 | `音频下载失败: {status}` | 音频下载非 2xx | `generate.ts:2510` | 同上 |
| D4 | `{label}超过大小上限（{bytes} 字节）` | 下载超过 `MEDIA/IMAGE_DOWNLOAD_MAX_BYTES`(512MB/32MB) | `generate.ts:310`、`generate.ts:323` | 源文件过大，压缩或换源 |
| D5 | `非法下载地址: {url}` | 下载地址校验不通过 | `generate.ts:346` | 提供合法 http(s) URL |
| D6 | `仅支持 http/https 下载地址，收到: {protocol}` | 协议不符 | `generate.ts:349` | 改为 http/https |
| D7 | `下载地址指向受限网络: {hostname}` | 内网/保留地址被拒 | `generate.ts:354`、`generate.ts:357` | 用公网可达地址 |
| U1 | `文件上传失败: 404 —— 后端未注册 /api/v1/generate/upload，请确认 Drama Backend 版本` | 上传接口 404 | `generate.ts:661` | 升级 Drama Backend |
| U2 | `文件上传失败: {status}` | 上传 HTTP 非 2xx | `generate.ts:663` | 看状态码 |
| U3 | `文件上传成功但未返回 filename（响应: {json}）` | 上传 200 但响应缺 `filename` | `generate.ts:671` | 后端返回结构异常 |

### 8.5 重试类（Retry）

| # | 报错文案 | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|
| R1 | `该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）` | `isReplayable` 不通过（非 agent 生成的节点） | `client/index.ts:994` | 该节点不支持重试，需重新生成 |
| R2 | `重试失败`（或 `cause.message`） | 重试 catch 兜底（无 Error 信息时回退字面量） | `client/index.ts:1008` | 看 cause；通常根因同 G1/D 类 |
| R3 | `重试目标节点不存在: {retryOf}` | 重试目标节点已从画布移除 | `generate.ts:1287`、`generate.ts:1361` | 节点已丢失，无法重试 |
| R4 | `{tool} 只支持原地重试（缺少 retryOf）；首次生成请走对应的工具调用` | 缺少 `retryOf`（非原地重试调用） | `generate.ts:1358` | 使用节点右键「重试」而非新工具调用 |
| R5 | `音乐节点缺少音乐描述（caption_prompt），无法重试` | 音乐节点重放参数缺失 | `generate.ts:1367` | 补 `caption_prompt` 后重试 |
| R6 | `四视图节点缺少参考图（image），无法重试` | 四视图节点重放参数缺失 | `generate.ts:1400` | 补参考图后重试 |
| R7 | `抽帧节点缺少源视频 URL（videoUrl），无法重试` | 抽帧节点重放参数缺失 | `generate.ts:1420` | 补源视频 URL 后重试 |

### 8.6 客户端兜底 / 效果测试

| # | 报错文案 | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|
| C1 | `测试指令发出后回合未启动` | 效果测试：发出指令后超过 `EFFECT_TEST_START_TIMEOUT_MS`(240s) 会话仍未 running | `client/index.ts:1245` | 查 agent 会话是否卡住 |

### 8.7 业务校验类错误（非任务/超时域，仅索引）

以下由工具调用层在 `execute` 前置校验抛出，不属于调度/超时系统，但用户同样可见，列名备查：

- 参考图 `@ref` 未找到 / 未上传
- `分镜卡「…」未找到`
- 缺质检基准（quality baseline）
- 画布无剧本（screenplay 缺失）
- 审批门拦截（`approvalGateMessage`）

---

## 9. 关于"同事说经常超时"——根因与现状

从代码看，队列等待与后端占用**已被正确排除在超时之外**（§1、§5）。仍可能出现真实超时的根因，按概率排序：

1. **后端本身慢 / 被他人占用（外部因素）**：实测 `queue_task_count=5`，后端同步单任务且常被他人占着。若单次视频推理 > 1200s（含长时长/高分辨率），`dramaPost` 的 1200s 超时必然触发——这是真实超时，非误报。
2. **传输层静默退回 300s（最该排查）**：§2 的已知风险——若运行环境在"首次请求前"就发长超时请求，dispatcher 退回 undici 默认 300s，视频 >300s 被提前掐断且报 `UND_ERR_HEADERS_TIMEOUT`（误导）。**排查：看宿主日志有无 `无法抬高 fetch 传输层超时上限` 告警。**
3. **占位 tip 与 drama 上限的 120s 余量**：1320s vs 1200s。若 dramaPost 在 ~1200s 超时但节点清理/事件丢失，占位计时器可能在 1320s 报"生成超时"——属兜底文案，根因仍是 #1/#2。

**排查建议**：让同事复现时贴出**具体报错文案**（含 `UND_ERR_HEADERS_TIMEOUT` / 「未返回结果」/ 「生成超时」哪种），可直接定位到 §8 的 T1/T3/T4 或 §2 风险；并查日志是否有上述告警与 `probeQueueDepthNow` 返回的队列深度备注。

**已落地改动（本次）**：全部超时常量已翻倍（§3/§4/§5 表格中的当前值即翻倍后状态），单测不变量与对齐断言均通过。§2 的传输层风险目前以告警形式存在，未做"启动期探针"类修复（用户本期未要求）。
