# Canvas Studio 任务调度与超时判定 — 功能说明与错误手册

> 适用范围：`canvas-studio/src` 下的媒体生成任务系统（宿主生成队列 + Drama 后端 + 执行器轮询 + 客户端占位结算）。
> 所有引用均为 `文件:行号`，对应 **2026-09-30** 的代码状态：全部超时常量已翻倍（2026-09-23），且**视频生成类接口已切到后端 0.5.0 异步任务**（CV-231，2026-09-24）——视频不再是单条长请求，而是 submit（60s 短档）→ 30s 间隔轮询 → executor 整体墙钟兜底。
> 后端 Drama API（`117.50.108.73:8082`）仍是**单任务串行**：同刻只处理一个任务；除视频（异步 202 + 轮询）外的接口为同步阻塞式。

---

## 0. 系统定位

项目里没有独立的"任务管理系统"模块；**调度与超时能力分散在三层协作**：

1. **宿主侧同步单任务队列**（`generate-queue.ts`）—— 把并发收敛为 1，并提供可读快照。
2. **多档超时判定** —— 传输层 / 应用层 / 执行器轮询（异步视频）/ 客户端占位，各管一段。
3. **队列快照下发与 UI 投影**（`queue-view.ts` + `routes.ts` + `client/index.ts`）。

---

## 1. 任务调度层 — 宿主生成队列（CV-220, `generate-queue.ts`）

**约束**：同刻最多 1 个 `active`，严格 FIFO，不插队。

| 项 | 实现 |
|---|---|
| 唯一拦截点 | `callDramaJson`（`generate.ts:1060`）→ `withGenerateSlot`（`generate-queue.ts:118`）—— Drama 生成类请求（含视频 submit）的唯一网络入口 |
| 入队等待 | `acquire(label, signal)`：入 `waiting[]`，调 `pump()` 尝试授权 |
| 授权推进 | `pump()`：仅当 `active===null` 时出队一个并 `grant()`。漏调会锁死整条队列 |
| 槽位释放 | `withGenerateSlot()` 在 `finally` 里 `active=null; pump()`（`generate-queue.ts:118`） |
| 等待中被取消 | `onAbort` 把条目从 `waiting` 摘除并 reject；若不清会锁死队列（有单测钉住） |
| 不排队的范围 | 上传、健康探针、文本工具、异步视频任务的**轮询与取消**（`dramaJobRequest` 短请求不占槽，`generate.ts:307`）、异步供应商 fal 三段式 |
| 快照 | `generateQueueSnapshot()` → `{ active, waiting[] }`，**只有事实，无 `busy` 字段** |

**关键不变式**：队列等待阶段不计时（拿到槽位前不走 `dramaPost`，也就不消耗 `timeoutMs`）。

---

## 2. 传输层超时 — `long-request.ts`

**问题（CV-133 P0）**：Node 内置 fetch 经 undici，默认 `headersTimeout=bodyTimeout=300s`，且**先于我们自己的 AbortSignal 触发**。视频推理 >300s 必然在 ~301s 被掐（`UND_ERR_HEADERS_TIMEOUT`），且会让应用层长档形同虚设。

**方案**：按请求注入请求级 dispatcher 把上限抬到 `LONG_REQUEST_TIMEOUT_MS = 1_800_000`(1800s)（`long-request.ts:37`）。
- 借 undici 全局 dispatcher 的 well-known symbol `Symbol.for('undici.globalDispatcher.1')` 取其 `constructor` 造同款实例，`headersTimeout/bodyTimeout=timeoutMs`。
- **防御式**：取不到符号 → 返回 `undefined` 退回 300s + 报 `CS-NET-002`（仅 developer 可见、走日志）告警一次，**绝不抛错、不阻断生成**。
- ⚠️ **已知风险**：该 symbol 在**首次请求之后**才存在（`long-request.ts:64` 注释确认）。若运行环境在"首次请求前"就发出需要长超时的请求，会**静默退回 300s** 并可能报误导性的 `UND_ERR_HEADERS_TIMEOUT`。排查"频繁超时"时，优先看宿主日志是否有 `无法抬高 fetch 传输层超时上限` 这句 dev 信息（`CS-NET-002`）。

---

## 3. 应用层超时判定 — `generate.ts`

超时常量表（`generate.ts:331` 一带）：

| 常量 | 位置 | 当前值 | 用途 |
|---|---|---|---|
| `DRAMA_TIMEOUT_MS.image` | `generate.ts:331` | 720_000 (720s) | 图片生成（同步单请求） |
| `DRAMA_TIMEOUT_MS.video` | `generate.ts:331` | 2_400_000 (**2400s**) | 视频生成**整体墙钟**（submit + 30s 间隔轮询，CV-231 异步化后不再是单次 fetch 超时）；另被 video2vl 用作单请求档（见下方"已知边界"） |
| `DRAMA_TIMEOUT_MS.videoSubmit` | `generate.ts:331` | 60_000 (**60s**) | 视频提交 POST 的独立短档——202 秒级返回（实测 48ms），长超时只会在后端宕机时把快失败拖成一分钟 |
| `DRAMA_TIMEOUT_MS.text` | `generate.ts:331` | 360_000 (360s) | 文本类 |
| `DRAMA_JOB_POLL_INTERVAL_MS` | `generate.ts:334` | 30_000 (30s) | 异步任务轮询间隔（用户拍板 2026-09-24），任务独立计时 |
| `DRAMA_JOB_REQUEST_TIMEOUT_MS` | `generate.ts:336` | 15_000 (15s) | 异步任务端点（状态/结果/取消）单次轻请求超时 |
| `MEDIA_DOWNLOAD_TIMEOUT_MS` | `generate.ts:374` | 1_200_000 (1200s) | 视频下载（512MB 上限） |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | `generate.ts:376` | 240_000 (240s) | 图片下载（32MB 上限） |
| `HEALTH_TIMEOUT_MS` | `generate.ts:479` | 20_000 (20s) | 健康探针 |
| `UPLOAD_TIMEOUT_MS` | `generate.ts:713` | 600_000 (600s) | 文件上传 |
| `LONG_REQUEST_TIMEOUT_MS` | `long-request.ts:37` | 1_800_000 (1800s) | 传输层上限（§2） |

**不变量（有单测钉住，`tests/long-request.test.mjs:26`）**：所有**单次 fetch** 超时档（image / text / videoSubmit / UPLOAD / 下载档）严格小于 `LONG_REQUEST_TIMEOUT_MS`(1800s)；`video`(2400s) 是 executor 轮询的整体墙钟，**豁免**于该不变量。`PENDING(2520s)` 与 `DRAMA.video(2400s)` 保持 120s 余量（见 §5）。
⚠️ **已知边界**：video2vl（`analyzeVideo`，`generate.ts:1504`）把视频档 2400s 用在**单次** `dramaPost` 上，超过传输层 1800s —— 若响应迟迟不回，会在 1800s 被传输层先掐（报 `UND_ERR_HEADERS_TIMEOUT` 而非 §8 T1 文案）。视频生成主链路（submit + 轮询）不受影响。

`dramaPost`（`generate.ts:567`）判定逻辑：
1. 探活前置（`ensureDramaReachable`），宕机先抛中文错，不进长超时。
2. 组合信号：`composed = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])` + 注入 dispatcher。
3. **重试**：仅 `502/503/504` 重试一次（`generate.ts:585`）；**本地超时不再重试**（同步阻塞式，重试=再等一整档）。
4. **超时现场化（CV-219）**：超时抛错前调 `probeQueueDepthNow()`（`generate.ts:549`）探后端队列深度，错误信息带"后端当前有 N 个任务在执行/空闲"（备注串在 `generate.ts:601-603`）。
5. **用户打断归一（CV-239）**：`signal.aborted` 时抛 `CS-GEN-207`（`generate.ts:594`）——客户端按码把占位节点**移除**而不是标红"生成失败"，取消不是故障。

### 3.1 异步视频链路（CV-231/238，后端 0.5.0）

`video_generate` / `video_composite` 的 Drama 通道是 submit → poll → cancel 三段式（`providers/drama.ts`，与 fal 同构）：

1. **submit**：`POST image2videofl2va / image2videoref2va`，202 立即返回 `{job_id, status_url, result_url, cancel_url}`；超时取 60s 的 `videoSubmit` 短档（`drama.ts:239`），仍占生成队列槽位（经注入的 `dramaPostWithFallback` → `callDramaJson`）。参考图失效自愈（500 → 重传 → 重试）在此闭包内照常生效。
2. **轮询**：executor 以 `ctx.timeoutMs = DRAMA_TIMEOUT_MS.video`(2400s，`generate.ts:2126`) 为整体墙钟，每 30s 调一次 `GET /api/v1/jobs/{id}`（单请求 15s 超时、**不占生成队列槽位**）。瞬时错误（网络抖动/5xx/形状异常）**容忍**：当轮当未完成，下轮重试；只有 404（任务消失 → `CS-PROV-016`）与 `status=failed`（→ `CS-PROV-015`）/cancelled 才立即失败。
3. **job_id 台账**：拿到 `job_id` 后经 `ctx.onSubmitted` 落地项目 `jobs.json`（`src/video-jobs.ts`）——客户端/宿主重启后 Host 据此恢复轮询并结算节点。
4. **超时/取消**：整体墙钟耗尽 → 先 cancel 远端再抛 `CS-PROV-014`（§8 T3）；用户打断 → executor 顶部统一 cancel 后抛 `CS-GEN-207`。

---

## 4. 执行器轮询超时 — `providers/executor.ts`

`runVideo()`（异步轮询型供应商 drama / fal 都走这条）：
- `deadline = Date.now() + (ctx.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS)`（`executor.ts:99`），`DEFAULT_VIDEO_TIMEOUT_MS = 1_200_000`（`executor.ts:17`）。**Drama 视频显式传 `DRAMA_TIMEOUT_MS.video`(2400s)**（`generate.ts:2126`）；不传 `ctx.timeoutMs` 的调用方才落到 1200s 缺省。
- 每轮 `poll` 前先判 `signal.aborted`（先 `provider.cancel()` 再抛，行 103-105），再判 `Date.now() > deadline`（先 cancel 远端再抛 `CS-PROV-014`，抛出点 `executor.ts:112`）。
- `sleep(ms, signal)`（行 29）可被 abort **打断但 resolve 不 reject** —— 把"已取消"交给循环顶部统一处理（否则绕过 cancel，远端留孤儿任务）。
- 轮询间隔默认 `DEFAULT_POLL_INTERVAL_MS = 1500`（`executor.ts:20`）；Drama 通道注入 30s（§3.1）。

---

## 5. 客户端占位结算上限 — `client/index.ts`

- `PENDING_TIMEOUT_MS = 2_520_000`(2520s)（`client/index.ts:1029`），从占位节点落地起算。
- **原 bug（CV-220 前）**：与 `DRAMA_TIMEOUT_MS.video` 仅差 60s，一旦请求排队，后面的占位"还没轮到"就被判"生成超时"。
- **修正**：计时器可重起；`pollGenerationQueue()` 每 2s 一次（`QUEUE_POLL_MS`，`client/index.ts:1058`），在**队列非空期间顺延全部占位计时器** —— 把"我们自己造成的排队等待"从超时里摘出去。
- 轮询只在有生成在飞时跑（`pendingTimers.size>0 || clientGenerations>0`），空闲即停 → 零后台流量。
- 遮罩文案 `generationQueueNote()`（`queue-view.ts:131`）→ `生成队列：{active} · 等待 {waiting} 个`（只讲"谁占着唯一通道"，不做假精度的"我排第几"）。

---

## 6. 快照下发与 UI 投影 — `routes.ts` + `queue-view.ts`

- `GET /canvas-studio/generate/queue` → `generateQueueSnapshot()`（`routes.ts:735`）。
- `client/api.ts:300 fetchStudioGenerateQueue()` 拉取，`normalizeGenerateQueueSnapshot()` 归一化（形状不对 → `null`，保持上一拍状态，不降级成空队列）。
- `generationQueueStateOf()`：**只有 `waiting.length>0 且 active!==null` 才返回非 null** → 单请求在跑时不进 UI，也避免每 2s 造对象触发订阅者重渲染。

---

## 7. 项目切换与多项目并发安全性

**结论：安全，不会丢失或错乱。**

- 宿主生成队列 `generate-queue.ts` 是**全局单槽 FIFO，不承载 projectId**；每次生成的"归属"靠调用闭包里的 `projectId` 一路携带到写回节点（`retryStudioNode(projectId, node)`），结果只落回发起它的那个节点，不会串项目。
- 项目切换（`openProject`，`client/index.ts:1588`）**不会** abort 在途任务，也不清 `pendingTimers`（计时器以 `runId` 为键全局存活，队列轮询每 2s 顺延）。切换后原项目的生成继续跑，完成后 `reloadCanvasQueued(projectId)` 只重载那个项目。
- **多项目同时跑支持**：共用唯一槽位、被后端单任务串行化，数据互不污染。
- **唯一外观瑕疵**（非数据问题）：队列提示 `生成队列：…·等待 N 个` 是 store 里的**全局投影**，可能显示在你当前打开的、并非正在生成的那张项目画布上 —— 纯显示，不影响任何数据。

---

## 8. 错误手册（重点 / 详细）

> 按"用户能看到的报错"归类。每条含：错误码、文案（catalog 模板原文）、触发原因、抛出位置、处置建议。
> 文案模板集中在 `src/errors/catalog.ts`（唯一事实来源），下表只抄用户文案；`{n}` 等为运行时插值。
> 严重度：🔴 阻塞性（任务失败需重试）｜🟡 信息/可恢复｜⚪ 兜底提示。

### 8.1 超时类（Timeout）

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| T1 | `CS-GEN-204` | `Drama 后端在 {n} 秒内未返回结果（已放弃重试）：{note}\n本次可能是时长超出该档上限——可稍后重试或缩短时长。`（{note}∈ `后端当前有 {N} 个任务在执行` / `后端当前空闲` / `后端队列深度未知`） | `dramaPost` 本地超时（同步档：image / text / video2vl）。同步阻塞式后端重试无益故放弃 | `generate.ts:604` | 看 {note}：若"有 N 个任务"→后端被占/慢；若"空闲"仍超时→查传输层（§2 风险） |
| T2 | `CS-GEN-205` | `文件上传在 {n} 秒内未完成：后端可能繁忙或文件过大——可稍后重试，或压缩素材后再上传。` | `UPLOAD_TIMEOUT_MS`(600s) 触发（连接失败另走 CS-NET-003） | `generate.ts:735` | 网络/后端慢，重试上传 |
| T3 | `CS-PROV-014` | `视频生成超时（{seconds} 秒），已尝试取消任务。请稍后重试或缩短时长。` | 执行器 `runVideo` 轮询 `deadline` 触发（异步供应商）；先 cancel 远端再抛 | `executor.ts:112` | 重试该节点；若反复超时缩短时长/分辨率 |
| T4 | —（内联文案） | `生成超时：等待产物超过上限。请在画布右键该节点选择「重试」，或在对话中让 agent 重新生成。` | 客户端 `PENDING_TIMEOUT_MS`(2520s) 兜底（仅"事件丢失、卡在生成中"场景） | `client/index.ts:1049` | 右键节点「重试」或让 agent 重生成 |
| T5 | —（内联文案） | `波形解码超时（{N}s）`（N=120） | `waveform-host` ffmpeg 超时（`FFMPEG_TIMEOUT_MS`，`ffmpeg-run.ts:26`） | `waveform-host.ts:158` | 非阻塞；重试或忽略波形 |

### 8.2 异步任务类（CV-231 新增域）

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| J1 | `CS-PROV-015` | `视频生成任务在后台执行失败，请重试或调整提示词后重试。{detail}` | Drama 异步任务在 ComfyUI 侧执行失败（status=failed） | `providers/drama.ts`（poll 终态分支） | 重试；持续失败查提示词内容或后端日志 |
| J2 | `CS-PROV-016` | `视频生成任务已丢失（后端不存在该任务，可能因后端重启被清空），请重新生成。` | 状态查询 404：后端重启清队列 / 排队中任务被取消后消散 | `providers/drama.ts`（poll 404 分支） | 重新发起生成；频繁出现确认后端是否重启 |

### 8.3 网络 / 连接类（Network）

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| N1 | `CS-NET-001` | `生成服务暂时连不上（已重试一次），请稍后重试或检查服务是否可达。`（dev 信息含 cause） | 网络错误且 2 次均失败 | `generate.ts:608` | 确认后端 `117.50.108.73:8082` 可达 |
| N2 | —（中间态） | `Drama Backend 暂时不可用（HTTP {status}），已自动重试一次` | 502/503/504 网关错误，记录并自动重试一次（非最终抛出，重试仍失败则转 N1/T1） | `generate.ts:586` | 多为后端瞬时过载，自动重试已覆盖；持续出现查后端状态 |
| N3 | `CS-NET-002` | （仅 developer 日志）`无法抬高 fetch 传输层超时上限，退回 undici 默认 300s：{detail}` | undici dispatcher 符号取不到，传输层静默退回 300s | `long-request.ts`（warnOnce） | 见 §2 已知风险的排查法 |

### 8.4 生成失败类（Generation Failure）

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| G1 | `CS-GEN-206` | `生成失败（后端返回错误）：{safe}` | Drama 响应非 2xx（`describeError` 详情进 dev 信息） | `generate.ts:1110`、`generate.ts:1472`、`generate.ts:2177`；dramaPost 重试耗尽兜底 `generate.ts:611` | 看详情；后端业务错误 |
| G2 | `CS-NET-010` | `生成响应中未找到产物地址（或异步任务标识），后端返回结构异常，请联系开发。` | 200 但响应无 `full_url / data[0].url / job_id` | `generate.ts:1116`、`generate.ts:1137`；submit 缺 `job_id` 同码 `drama.ts:247` | 后端返回结构异常，升级/联系后端 |
| G3 | `CS-GEN-207` | `生成已取消。` | 用户主动打断（executor signal 分支 / 排队等待被取消 / dramaPost abort 透传统一收敛）；客户端按码**移除占位**而非标红 | `generate.ts:594`（executor / 队列同码） | 非故障；需要时重新发起 |

### 8.5 下载 / 上传类（Download / Upload）

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| D1 | `CS-NET-007` | `下载「{label}」失败，请稍后重试或检查素材来源是否可达。`（状态码进 dev 信息） | 下载 HTTP 非 2xx（label=媒体/图片/三视图拼图/音频共用） | 通用 `generate.ts:391`；三视图 `generate.ts:2573`；音频 `generate.ts:2899` | 看状态码；源地址失效/权限 |
| D2 | `CS-NET-008` | `下载「{label}」体积超过上限，请压缩后重试。` | 下载超过 `MEDIA/IMAGE_DOWNLOAD_MAX_BYTES`(512MB/32MB) | `generate.ts:396`、`generate.ts:409` | 源文件过大，压缩或换源 |
| D3 | `CS-NET-009` | `下载地址不安全或不在允许范围内，已拒绝。`（细分原因进 dev 信息） | 非法地址 / 协议不符 / 内网保留地址被拒（SSRF 校验） | `generate.ts:432`、`generate.ts:435`、`generate.ts:440`、`generate.ts:443` | 提供 http(s) 公网可达地址 |
| D4 | `CS-NET-011` | `本地文件引用超出资产库范围，已拒绝。` | 本地路径引用不在项目资产库根内（CR-011 白名单） | `generate.ts:665` | 改用资产库内文件 |
| U1 | `CS-NET-004` | `文件上传失败（HTTP 404）：后端未注册上传端点，请确认 Drama Backend 版本。` | 上传接口 404 | `generate.ts:740` | 升级 Drama Backend |
| U2 | `CS-NET-005` | `文件上传失败（HTTP {status}），请稍后重试。` | 上传 HTTP 非 2xx | `generate.ts:742` | 看状态码 |
| U3 | `CS-NET-006` | `文件上传成功但后端未返回文件名，上传通道异常，请联系开发。` | 上传 200 但响应缺 `filename/name/data.url` | `generate.ts:750` | 后端返回结构异常 |

### 8.6 重试类（Retry）

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| R1 | —（内联文案） | `该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）` | `isReplayable` 不通过（非 agent 生成的节点） | `client/index.ts:1525` | 该节点不支持重试，需重新生成 |
| R2 | —（内联文案） | `重试失败`（或 `cause.message`） | 重试 catch 兜底（无 Error 信息时回退字面量） | `client/index.ts:1539` | 看 cause；通常根因同 G1/D 类 |
| R3 | `CS-NODE-002` | `重试目标节点不存在（{id}），无法重试。` | 重试目标节点已从画布移除 | `generate.ts:1544`、`generate.ts:1618` | 节点已丢失，无法重试 |
| R4 | `CS-NODE-003` | `{tool} 只支持原地重试（缺少 retryOf）；首次生成请走对应的工具调用。` | 缺少 `retryOf`（非原地重试调用） | `generate.ts:1615` | 使用节点右键「重试」而非新工具调用 |
| R5 | `CS-PARAM-001` | `「{tool}」缺少必需参数「{param}」，无法继续。`（music_generation / caption_prompt） | 音乐节点重放参数缺失 | `generate.ts:1624` | 补 `caption_prompt` 后重试 |
| R6 | `CS-PARAM-001` / `CS-USER-ERR` | 同 R5（character_sheet / image）；资产卡已不存在时另有 `CS-USER-ERR` 文案 | 四视图节点重放参数缺失 / 资产卡丢失 | `generate.ts:1674`、`generate.ts:1679` | 补参考图后重试 |
| R7 | `CS-PARAM-001` | 同 R5（frame_extract / videoUrl） | 抽帧节点重放参数缺失 | `generate.ts:1694` | 补源视频 URL 后重试 |

### 8.7 客户端兜底 / 效果测试

| # | 码 | 报错文案（catalog 模板） | 触发原因 | 位置 | 处置 |
|---|---|---|---|---|---|
| C1 | `CS-EFFECT-002` | `效果测试指令发出后回合未启动，请重新发起测试。` | 效果测试：发出指令后超过 `EFFECT_TEST_START_TIMEOUT_MS`(240s，`client/index.ts:1802`) 会话仍未 running | `client/index.ts:1828` | 查 agent 会话是否卡住 |

### 8.8 业务校验类错误（非任务/超时域，仅索引）

以下由工具调用层在 `execute` 前置校验抛出，不属于调度/超时系统，但用户同样可见，列名备查：

- 参考图 `@ref` 未找到 / 未上传（`CS-USER-001`）
- 画布节点 id 被当 Drama 句柄传（`CS-USER-002`，CV-238）
- 入参填占位值（`CS-PARAM-002`，CV-235）
- `分镜卡「…」未找到`
- 缺质检基准（quality baseline）
- 画布无剧本（screenplay 缺失）
- 审批门拦截（`approvalGateMessage`）

---

## 9. 关于"同事说经常超时"——根因与现状

从代码看，队列等待与后端占用**已被正确排除在超时之外**（§1、§5）。视频已改异步（§3.1），"单次请求跑满长档"的场景只剩同步档。仍可能出现真实超时的根因，按概率排序：

1. **后端任务排队 / 本身慢（外部因素）**：实测 `queue_task_count=5`，后端单任务串行。视频 submit 成功后任务在 ComfyUI 侧排队，executor 的整体墙钟 2400s 兜底；若排队 + 推理超 2400s，T3 必然触发——这是真实超时，非误报。同步档（图片 720s / video2vl 2400s）同理。
2. **传输层静默退回 300s（最该排查）**：§2 的已知风险——若运行环境在"首次请求前"就发长超时请求，dispatcher 退回 undici 默认 300s，同步长请求 >300s 被提前掐断且报 `UND_ERR_HEADERS_TIMEOUT`（误导）。**排查：看宿主日志有无 `CS-NET-002`（`无法抬高 fetch 传输层超时上限`）告警。**
3. **video2vl 的 1800s 传输层天花板**：§3 已知边界——video2vl 单请求挂 2400s 档但传输层只到 1800s，超长视频理解会先报 `UND_ERR_HEADERS_TIMEOUT`。
4. **占位 tip 与 drama 墙钟的 120s 余量**：2520s vs 2400s。若 executor 在 ~2400s 超时但节点清理/事件丢失，占位计时器可能在 2520s 报"生成超时"（T4）——属兜底文案，根因仍是 #1/#2。

**排查建议**：让同事复现时贴出**具体报错文案**（含 `UND_ERR_HEADERS_TIMEOUT` / 「未返回结果」/ 「生成超时」/ 「任务已丢失」哪种），可直接定位到 §8 的 T1/T3/T4/J2 或 §2 风险；并查日志是否有 `CS-NET-002` 告警与 `probeQueueDepthNow` 返回的队列深度备注。
