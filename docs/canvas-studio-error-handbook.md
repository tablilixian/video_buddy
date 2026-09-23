# Canvas Studio 错误处理手册（完整收敛版）

> 适用范围：`canvas-studio/src` 下所有"会把信息显示给用户或 agent"的错误。
> 全部条目均引用 `文件:行号`（2026-09-23 已将全部超时常量翻倍后的代码状态）。
> 后端 Drama API（`117.50.108.73:8082`）为**同步阻塞式单任务**：同刻只处理一个请求，并发只排队。

---

## 0. 维度说明

每条错误按 5 个维度收敛：

| 维度 | 取值 | 含义 |
|---|---|---|
| **展示方式** | D1 / D2 / D3 / D4 / D5 | 错误如何到达用户眼前（见 §1） |
| **严重等级** | S1 / S2 / S3 | 对主流程的阻断程度（见 §2） |
| **可自行纠错** | 自动 / 引导重试 / 需人工 | 无需人介入即可恢复的程度（见 §3） |
| **产生原因** | — | 触发该错误的代码条件 |
| **文案格式** | — | 用户/agent 实际看到的字符串（含变量） |

---

## 1. 展示方式字典（D1–D5）

- **D1 对话回显**：Host 工具抛错 → 错误 `message` 作为工具调用结果回传给 agent → agent 在对话流中展示，并据此决定重试 / 改参 / 告知用户。**本项目绝大多数错误走此通道**（生成、上传、参考图解析、工具校验、合成、provider 等）。
- **D2 节点错误态**：媒体 / 合成类失败会把画布节点置为失败态并附错误文案，节点卡显示红色错误标记与「重试」入口（用户可在画布上直接看到并右键重试）。
- **D3 面板 / 状态投影**：仅客户端侧状态——效果测试失败进 `effectTest.failures` 面板；队列占用进全局「生成队列」提示（`queue-view.ts:121`）。
- **D4 Toast 轻提示**：仅极少量客户端轻量通知（如剪贴板结果，`clipboard-copy.ts`），**非错误主通道**。
- **D5 仅日志**：`ctx.logger.warn/info` 写宿主日志，用户不可见（如 deferred promote 失败 `client/index.ts:274`、附件分流失败 `:506`）。

> 全仓无 `console.error`、无 `alert()`、无错误 Modal 弹窗；错误**不**走浏览器原生弹窗。

---

## 2. 严重等级字典（S1–S3）

- **S1 阻塞**：任务失败，需人工或显式重试才能继续。
- **S2 可恢复**：自动重试已覆盖，或用户/agent 按提示立即可修正后继续。
- **S3 提示**：不影响主流程，仅信息性 / 兜底（如波形缺失、效果测试单条失败但整体仍出报告）。

---

## 3. 可自行纠错字典

- **自动**：agent 或系统自动重试 / 自愈（网络瞬时错自动重试、参考图失效自愈、时长 / 分辨率钳制）。
- **引导重试**：agent 读到文案后改参重调（绝大多数参数校验类）。
- **需人工**：后端宕机、Key 缺失、ffmpeg 缺失、注册表损坏、磁盘 / 权限等环境或配置问题。

---

## 4. 错误清单（按模块）

### A. 任务调度与超时

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| A1 | `Drama Backend {N}s 内未返回结果（已放弃重试）：{队列备注}，本次可能是时长超出该档上限——可稍后重试或缩短时长。` | `dramaPost` 本地超时（传输/应用层上限内无响应）；同步阻塞后端重试无益故放弃 | D1(+D2) | 引导重试 | S1 | `generate.ts:515` |
| A2 | `文件上传 {N}s 内未完成：{底层错误}` | `UPLOAD_TIMEOUT_MS`(600s) 触发 | D1 | 引导重试 | S1 | `generate.ts:651` |
| A3 | `{provider.label} 生成超时（超过 {seconds} 秒），已尝试取消任务` | 执行器 `runVideo` 轮询 `deadline` 触发（异步供应商）；先 cancel 远端再抛 | D1(+D2) | 引导重试 | S1 | `executor.ts:109` |
| A4 | `生成超时：等待产物超过上限。请在画布右键该节点选择「重试」，或在对话中让 agent 重新生成。` | 客户端 `PENDING_TIMEOUT_MS`(1320s) 兜底（仅"事件丢失、卡在生成中"） | D2 | 引导重试 | S1 | `client/index.ts:626` |
| A5 | `波形解码超时（{N}s）` | `waveform-host` ffmpeg 超时（N=120） | D3(+D1) | 引导重试 | S3 | `waveform-host.ts:156` |
| A6 | `Drama Backend 连接失败（已重试一次）：{cause}，请检查服务是否可达。` | 网络错误且 2 次均失败 | D1 | 需人工 | S1 | `generate.ts:522` |
| A7 | `Drama Backend 暂时不可用（HTTP {status}），已自动重试一次` | 502/503/504 网关错误，记录并自动重试一次（非最终抛出） | D1 | 自动 | S2 | `generate.ts:500` |
| A8 | `测试指令发出后回合未启动` | 效果测试：超过 `EFFECT_TEST_START_TIMEOUT_MS`(240s) 会话仍未 running | D3 | 自动 | S2 | `client/index.ts:1245` |
| A9 | `会话绑定项目超时` | 效果测试：等待会话 cwd 切到目标项目超时 | D3 | 自动 | S2 | `client/index.ts:1231` |
| A10 | `等待 agent 回合结束超时` | 效果测试：单条用例等待 agent 回合结束超时 | D3 | 自动 | S2 | `client/index.ts:1249` |
| A11 | `会话 conversation 服务未就绪` | 效果测试：会话未暴露 conversation 服务 | D3 | 需人工 | S1 | `client/index.ts:1271` |
| A12 | `已取消` | 队列等待期间被 abort（用户在等待中取消） | D1 | 引导重试 | S2 | `generate-queue.ts:72` |

> 不变量：传输层 `LONG_REQUEST_TIMEOUT_MS`(1800s) > 所有 `DRAMA/MEDIA/UPLOAD` 档(最大 1200s)；`PENDING`(1320s) 与 `DRAMA.video`(1200s) 留 120s 余量。

### B. 生成后端通信（`generate.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| B1 | `Drama Backend 不可达，请检查服务是否已启动后再试（{cause}）` | `ensureDramaReachable` 探活前置失败，不进长超时 | D1 | 需人工 | S1 | `generate.ts:413` |
| B2 | `生成失败: {describeError(response)}` | `dramaPost` 返回非 2xx；`describeError` 优先取结构化 `error.message` 否则带响应体片段 | D1(+D2) | 引导重试 | S1 | `generate.ts:900,1215` |
| B3 | `生成响应中未找到产物 URL` | 200 但响应无 `url` 字段 | D1(+D2) | 需人工 | S1 | `generate.ts:904` |
| B4 | `{label}失败: {status}`（label=媒体/图片） | 下载 HTTP 非 2xx | D1(+D2) | 引导重试 | S1 | `generate.ts:305` |
| B5 | `三视图拼图下载失败: {status}` | 三视图拼图下载非 2xx | D1 | 引导重试 | S1 | `generate.ts:2113` |
| B6 | `音频下载失败: {status}` | 音频下载非 2xx | D1 | 引导重试 | S1 | `generate.ts:2510` |
| B7 | `{label}超过大小上限（{bytes} 字节）` | 下载超过 `MEDIA/IMAGE_DOWNLOAD_MAX_BYTES`(512MB/32MB) | D1 | 引导重试 | S1 | `generate.ts:310,323` |
| B8 | `非法下载地址: {url}` | 下载地址校验不通过 | D1 | 引导重试 | S1 | `generate.ts:346` |
| B9 | `仅支持 http/https 下载地址，收到: {protocol}` | 协议不符 | D1 | 引导重试 | S1 | `generate.ts:349` |
| B10 | `下载地址指向受限网络: {hostname}` | 内网/保留地址被拒 | D1 | 引导重试 | S1 | `generate.ts:354,357` |
| B11 | `文件上传失败: 404 —— 后端未注册 /api/v1/generate/upload，请确认 Drama Backend 版本` | 上传接口 404 | D1 | 需人工 | S1 | `generate.ts:661` |
| B12 | `文件上传失败: {status}` | 上传 HTTP 非 2xx | D1 | 引导重试 | S1 | `generate.ts:663` |
| B13 | `文件上传成功但未返回 filename（响应: {json}）` | 上传 200 但响应缺 `filename` | D1 | 需人工 | S1 | `generate.ts:671` |
| B14 | `本地文件引用需要 registry 上下文` | 引用本地绝对路径但缺 registry | D1 | 引导重试 | S1 | `generate.ts:577` |
| B15 | `本地文件引用超出资产库范围，已拒绝: {localPath}` | 本地路径越出 registry 根（防路径穿越） | D1 | 引导重试 | S1 | `generate.ts:581` |
| B16 | `非法资产文件名: {assetFile}` | 资产文件名含非法字符或 `..` | D1 | 引导重试 | S1 | `generate.ts:706` |
| B17 | `项目不存在: {projectId}` | promote / save 资产时项目记录缺失 | D1 | 引导重试 | S1 | `generate.ts:713,798,1460` |
| B18 | `dataBase64 不能为空` | 落盘 base64 资产时入参空 | D1 | 引导重试 | S1 | `generate.ts:800` |
| B19 | `not strict base64` / `base64 round-trip mismatch` / `dataBase64 不是有效的 base64` | base64 字符集/填充/round-trip 校验失败 | D1 | 引导重试 | S1 | `generate.ts:807,811,814` |

### C. 重试类（`generate.ts` + `client/api.ts` + `client/index.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| C1 | `该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）` | `isReplayable` 不通过 | D2 | 引导重试 | S1 | `client/index.ts:994` |
| C2 | `重试失败`（或 `cause.message`） | 重试 catch 兜底（无 Error 信息时回退字面量） | D2 | 引导重试 | S1 | `client/index.ts:1008` |
| C3 | `重试目标节点不存在: {retryOf}` | 重试目标节点已从画布移除 | D1(+D2) | 需人工 | S1 | `generate.ts:1287,1361` |
| C4 | `{tool} 只支持原地重试（缺少 retryOf）；首次生成请走对应的工具调用` | 缺少 `retryOf`（非原地重试调用） | D1 | 引导重试 | S1 | `generate.ts:1358` |
| C5 | `音乐节点缺少音乐描述（caption_prompt），无法重试` | 音乐节点重放参数缺失 | D1 | 引导重试 | S1 | `generate.ts:1367` |
| C6 | `四视图节点缺少参考图（image），无法重试` | 四视图节点重放参数缺失 | D1 | 引导重试 | S1 | `generate.ts:1400` |
| C7 | `四视图节点的资产卡已不存在（可能已被删除或换了锚点），无法重试` | 资产卡锚点失效 | D1 | 需人工 | S1 | `generate.ts:1405` |
| C8 | `抽帧节点缺少源视频 URL（videoUrl），无法重试` | 抽帧节点重放参数缺失 | D1 | 引导重试 | S1 | `generate.ts:1420` |
| C9 | `节点缺少工具名，无法重试` | 节点 `toolName` 缺失 | D1 | 引导重试 | S1 | `client/api.ts:425` |
| C10 | `节点缺少可重放的生成参数` | 节点无可重放参数 | D1 | 引导重试 | S1 | `client/api.ts:427` |

### D. Provider 层（`providers/*`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| D1 | `未配置 fal API Key，请在设置 → Canvas Studio 中填写` | fal key 未注入或解析为空 | D1 | 需人工 | S1 | `fal.ts:117,121` |
| D2 | `fal 视频适配器需要 readReferenceBytes 注入（generate.ts 未注入即调用）` | provider 注入缺失（内部接线 bug） | D1 | 需人工 | S1 | `fal.ts:129` |
| D3 | `fal 视频适配器需要 dramaPostWithFallback 注入（generate.ts 未注入即调用）` | provider 注入缺失（内部接线 bug） | D1 | 需人工 | S1 | `drama.ts:68` |
| D4 | `{label}失败: {status} {detail}` / `{label}失败: 响应不是合法 JSON（{status}）` | fal HTTP 非 2xx / 非 JSON 响应 | D1 | 引导重试 | S1 | `fal.ts:155,160` |
| D5 | `fal submit 响应缺少 request_id / response_url，无法查询任务` | fal submit 响应结构异常 | D1 | 需人工 | S1 | `fal.ts:175` |
| D6 | `fal 供应商尚未接入参考视频（本次收到 N 段）。Drama 后端已支持 video1–video3：请改用 drama 供应商…` | fal 不支持参考视频入参 | D1 | 引导重试 | S1 | `fal.ts:192` |
| D7 | `fal 结果获取失败: 响应中没有 video.url` | fal 结果无 `video.url` | D1 | 需人工 | S1 | `fal.ts:322` |
| D8 | `未注册的视频供应商: {preferred}。{describeProviders()}` | `parseProviderParam` 命中未注册 provider | D1 | 引导重试 | S1 | `registry.ts:54` |
| D9 | `视频供应商 {label}（{id}）不支持 {capability}。{describeProviders()}` | provider 不支持该能力 | D1 | 引导重试 | S1 | `registry.ts:57` |
| D10 | `没有可用的视频供应商支持 {capability}。{describeProviders()}` | 无任何 provider 支持该能力 | D1 | 需人工 | S1 | `registry.ts:66` |
| D11 | `非法的视频供应商: {value}（仅支持 drama / fal）` | `provider` 参数非法枚举 | D1 | 引导重试 | S1 | `selection.ts:21` |
| D12 | `不是视频生成工具，无法解析能力: {tool}` | 非视频生成工具调用能力解析 | D1 | 引导重试 | S1 | `capability.ts:46` |
| D13 | `参考图 {n} 编码后 {mb}MB，超过 fal 单张上限 {limit}MB…` | fal 单张参考图超限 | D1 | 引导重试 | S1 | `reference.ts:149` |
| D14 | `参考图合计 {mb}MB，超过 fal 单次请求上限 {limit}MB…` | fal 参考图合计超限 | D1 | 引导重试 | S1 | `reference.ts:158` |

### E. 工具入参校验（`host-tools.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| E1 | `当前会话未绑定工作区，请先在左侧打开或创建一个 Canvas Studio 项目` | 调用工具时 cwd 为空 | D1 | 需人工 | S1 | `host-tools.ts:440` |
| E2 | `当前会话工作区未绑定任何 Canvas Studio 项目，请先在左侧打开或创建一个项目` | cwd 未匹配到项目 | D1 | 需人工 | S1 | `host-tools.ts:455` |
| E3 | `参考图 @ref[{token}] 在当前项目画布中未找到（或该素材尚未取得 Drama 文件名）…` | `@ref` 句柄在画布无匹配 | D1 | 引导重试 | S1 | `host-tools.ts:500` |
| E4 | `参考图 @ref[{token}] 尚未上传到 Drama Backend（缺少 filename）…` | `@ref` 节点未上传取得 filename | D1 | 引导重试 | S1 | `host-tools.ts:506` |
| E5 | `参数 "{value}" 包含多个 @ref 引用（{tokens}）；单个 filename 参数只能引用一个参考…` | 单 filename 含多个 @ref | D1 | 引导重试 | S1 | `host-tools.ts:541` |
| E6 | （审批门拦截文案，由 `approvalGateMessage` 生成） | confirm 模式下未获执行授权即提交 | D1 | 需人工 | S1 | `host-tools.ts:589` / `approval-gate.ts:109` |
| E7 | `分镜卡「{raw}」未找到：请用提交分镜后工具结果里列出的卡片标题…` | `shotRefs` 解析不到分镜卡 | D1 | 引导重试 | S1 | `host-tools.ts:925` |
| E8 | `缺少质检判定基准：请传 expect…，或先用 character_sheet 建立一致性资产卡` | 质检工具缺 `expect` 且无资产卡 | D1 | 引导重试 | S1 | `host-tools.ts:1280` |
| E9 | `mode=free 必须提供 prompt；若要做分镜拆解，请改用默认模式…` | `video2vl` free 模式缺 prompt | D1 | 引导重试 | S1 | `host-tools.ts:1657` |
| E10 | `question 不能为空` / `options 至少需要两个候选项` | 投票工具入参校验 | D1 | 引导重试 | S2 | `host-tools.ts:1813,1814` |
| E11 | `{label}未落盘：{reason}…本次请一次写全：{required}…` | 剧本/文案等 stub 载荷被拒（防空壳落地） | D1 | 引导重试 | S1 | `host-tools.ts:1896,1995` / `text-guard.ts:147` |
| E12 | `画布上还没有「剧本」节点：请先调用 write_screenplay 落盘剧本，再提交审批。` | 审批提交前缺剧本节点 | D1 | 引导重试 | S1 | `host-tools.ts:1956` |
| E13 | `没有可合成的视频片段；请先用 video_generate / video_composite 生成逐镜视频片段…` | 成片合成前无视频片段 | D1 | 引导重试 | S1 | `host-tools.ts:2091` |

### F. 生成工具参数校验与 H3 预检（`generate.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| F1 | `character_generate 需要提供 filename（角色设计图，来自 upload_image 工具）` | 缺 `filename` | D1 | 引导重试 | S1 | `generate.ts:1701` |
| F2 | `image_fix 需要提供 filename（要修复的图：upload_image 句柄或 @ref[节点标题] 引用）` | 缺 `filename` | D1 | 引导重试 | S1 | `generate.ts:1717` |
| F3 | `video_composite 需要提供 filenames（来自 upload_image 工具）` | 缺 `filenames` | D1 | 引导重试 | S1 | `generate.ts:1733` |
| F4 | `参考音频不符合 H3 官方规格（未发起生成）：\n- {issue}…` | H3 参考音频预检不通过 | D1 | 引导重试 | S1 | `generate.ts:1748` |
| F5 | `参考视频不符合 H3 官方规格（未发起生成）：\n- {issue}…` | H3 参考视频预检不通过 | D1 | 引导重试 | S1 | `generate.ts:1754` |
| F6 | `参考素材总数超出 H3 官方上限（未发起生成）：\n- {issue}…` | 跨模态素材总数 > 12 | D1 | 引导重试 | S1 | `generate.ts:1766` |
| F7 | `视频生成失败：{detail}（本次带了 H3 参考素材/音频参数…）：若这些素材未被后端接受…去掉对应参数后重试。` | 视频生成失败且带 H3 参考参数（显式点出音频/视频参数便于定位） | D1(+D2) | 引导重试 | S1 | `generate.ts:1815` |
| F8 | `未知的生成工具: {tool}` | `tool` 不在已知生成工具枚举 | D1 | 引导重试 | S1 | `generate.ts:1826` |

### G. 参考视频 / 末帧处理（`video-style.ts` / `video-frames.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| G1 | `项目不存在: {projectId}` | import/split 资产时项目缺失 | D1 | 引导重试 | S1 | `video-style.ts:173,201` |
| G2 | `视频内容为空` | 上传字节长度为 0 | D1 | 引导重试 | S1 | `video-style.ts:174` |
| G3 | `拆分视频：不是本项目的画布资产（{videoUrl}）` | 资产 URL 越出本项目白名单 | D1 | 引导重试 | S1 | `video-style.ts:205` |
| G4 | `拆分视频：资产文件不存在（{videoFile}）` | 资产文件在盘上缺失 | D1 | 引导重试 | S1 | `video-style.ts:210` |
| G5 | `参考视频抽帧失败（@{t}s{detail}）` / `参考视频抽帧失败（@{t}s）：ffmpeg 正常退出但未产出帧图` | ffmpeg 抽帧非零码 / 无产出 | D1(+D2) | 引导重试 | S1 | `video-style.ts:262,265` |
| G6 | `视频文件不存在（{videoUrl}）。请确认传入的是本项目画布上视频节点的 url…` | 末帧抽取输入文件缺失 | D1 | 引导重试 | S1 | `video-frames.ts:102` |
| G7 | `末帧抽取失败{detail}` / `末帧抽取失败：ffmpeg 正常退出但未产出帧图` | ffmpeg 末帧抽取失败 | D1(+D2) | 引导重试 | S1 | `video-frames.ts:127,130` |

### H. 成片合成（`compose.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| H1 | `请先选择至少一个分镜片段` | `clipIds` 为空 | D1 | 引导重试 | S1 | `compose.ts:407` |
| H2 | `项目不存在: {projectId}` | 合成时项目缺失 | D1 | 引导重试 | S1 | `compose.ts:409` |
| H3 | `所选片段中没有可合成的视频节点，请重新生成片段` | 片段无视频节点 | D1 | 引导重试 | S1 | `compose.ts:416` |
| H4 | `片段文件不存在，请重新生成后再导出` | 片段本地文件缺失 | D1 | 引导重试 | S1 | `compose.ts:437` |
| H5 | `无法识别片段分辨率，请重新生成片段` | ffprobe 解析不到宽高 | D1 | 引导重试 | S1 | `compose.ts:465` |
| H6 | `片段转码失败（{clip.id}{detail}）` | ffmpeg 转码非零码 | D1(+D2) | 引导重试 | S1 | `compose.ts:486` |
| H7 | `片段拼接失败{detail}` | ffmpeg concat 非零码 | D1(+D2) | 引导重试 | S1 | `compose.ts:498` |
| H8 | `BGM 片段不存在，请重新选择` | BGM 节点缺失/无 url | D1 | 引导重试 | S1 | `compose.ts:532` |
| H9 | `BGM 仅支持视频/音频文件` | BGM 非音视频文件 | D1 | 引导重试 | S1 | `compose.ts:535` |
| H10 | `BGM 文件不存在，请重新上传后再导出` | BGM 本地文件缺失 | D1 | 引导重试 | S1 | `compose.ts:541` |
| H11 | （BGM 时长不足提示，由 `bgmShortfallMessage` 生成） | BGM 短于成片 | D1 | 引导重试 | S1 | `compose.ts:551` |
| H12 | `BGM 混音失败{detail}` | ffmpeg amix 非零码 | D1(+D2) | 引导重试 | S1 | `compose.ts:564` |

### I. 波形（`waveform-host.ts`，非超时部分）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| I1 | `不是可解析的项目音频资产: {projectId}/{file}` | 音频资产路径解析失败 | D3(+D1) | 引导重试 | S3 | `waveform-host.ts:95` |
| I2 | `音频解码结果为空（文件损坏或不含可解码音轨）` | 解码无样本 | D3 | 引导重试 | S3 | `waveform-host.ts:98` |
| I3 | `音频全部静音，无法生成波形` | 峰值全 0 | D3 | 引导重试 | S3 | `waveform-host.ts:114` |

### J. 项目管理 / 路由 / 客户端 API（`projects.ts` / `routes.ts` / `client/api.ts`）

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| J1 | `项目名不能为空且不能超过 80 个字符` | 项目名空/超长 | D1 | 引导重试 | S2 | `projects.ts:90` |
| J2 | `项目名不能包含控制字符或路径分隔符` | 项目名含非法字符 | D1 | 引导重试 | S2 | `projects.ts:93` |
| J3 | `分组不存在: {group}` | 指定分组不存在 | D1 | 引导重试 | S1 | `projects.ts:411` |
| J4 | `项目名已存在: {trimmed}` | 重名冲突 | D1 | 引导重试 | S1 | `projects.ts:416,447` |
| J5 | `项目不存在: {projectId}` | 项目记录缺失 | D1 | 引导重试 | S1 | `projects.ts:470,578,600,618,637` |
| J6 | `非法项目目录，拒绝删除` | 删除路径越出项目根 | D1 | 需人工 | S1 | `projects.ts:472` |
| J7 | `分组名已存在: {trimmed}` | 分组重名冲突 | D1 | 引导重试 | S1 | `projects.ts:538` |
| J8 | `分组不存在: {groupId}` | 分组记录缺失 | D1 | 引导重试 | S1 | `projects.ts:552,563,582` |
| J9 | `当前没有待回答的问题` | 回答空问题 | D1 | 引导重试 | S1 | `projects.ts:641` |
| J10 | `回答不能为空` | 回答内容空 | D1 | 引导重试 | S1 | `projects.ts:644` |
| J11 | `canvas-studio: registry file is corrupt: {file}` | 注册表 JSON 解析失败 | D5(日志)/D1 | 需人工 | S1 | `projects.ts:670` |
| J12 | `canvas-studio: registry file is not a project registry: {file}` | 注册表结构不符 | D5/D1 | 需人工 | S1 | `projects.ts:679` |
| J13 | `canvas-studio: registry file contains an invalid project record: {file}` | 注册表记录非法 | D5/D1 | 需人工 | S1 | `projects.ts:684` |
| J14 | `canvas-studio: project record dir 越界: {entry.dir}` | 记录 dir 指向系统路径 | D5/D1 | 需人工 | S1 | `projects.ts:691` |
| J15 | `请求体必须是 JSON 对象` | 路由请求体非对象 | D1 | 引导重试 | S2 | `routes.ts:281` |
| J16 | `缺少项目名(name)` | 路由请求体缺 name | D1 | 引导重试 | S2 | `routes.ts:284` |
| J17 | `request failed: {status}` / `{error\|\|request failed}` | 客户端 API 非 2xx（抛 `StudioApiError`） | D1(调用方处理) | 引导重试 | S1 | `client/api.ts:31,35` |

### K. H3 IR 预检与基础设施

| 编号 | 文案格式 | 产生原因 | 展示 | 自纠错 | 严重 | 位置 |
|---|---|---|---|---|---|---|
| K1 | `unknown mode {mode}; expected one of T2VA/I2VA/L2VA/FL2VA/Ref2VA` | IR 模式枚举非法 | D1 | 引导重试 | S1 | `h3-ir-validate.ts:149` |
| K2 | `IR 模式声明与素材位次不一致：你声明了 irMode={x}，但本调用的素材位次按数量判是 {y}…` | IR 模式声明与素材数量不一致 | D1 | 引导重试 | S1 | `h3-ir-validate.ts:717` |
| K3 | `prompt 疑似 H3-Context-IR 简报（mode={m}…），但本地预检发现 {n} 处 ERROR，已取消本次生成：\n- …` | H3 IR 本地预检发现 ERROR | D1 | 引导重试 | S1 | `h3-ir-validate.ts:731` |
| K4 | `未找到可用的 ffmpeg：应用内置的 ffmpeg 组件缺失或被移除，请重新安装应用后重试。若你自行管理 ffmpeg，可设置环境变量 FFMPEG_PATH…` | ffmpeg 解析失败 | D1 | 需人工 | S1 | `ffmpeg-run.ts:148` |
| K5 | `引用句柄包含 [ 或 ]，无法生成 @ref 引用标记，请先重命名该节点` | 句柄含方括号无法无损表达 | D1 | 引导重试 | S1 | `reference-token.ts:62` |

---

## 5. 收敛现状与建议

你提到"要把整个项目的错误处理收敛起来"。基于上面 110+ 条全量扫描，现状与可改进点如下：

### 5.1 现状特征
- **主通道单一**：约 90% 的错误经 D1（agent 对话回显），由 agent 决定是否重试——对"agent 驱动"架构合理，但意味着**没有结构化的错误码 / 严重度字段**，下游（日志、可观测、UI 红点）只能靠字符串匹配。
- **文案风格不统一**：有英文前缀（`Drama Backend …`、`canvas-studio: registry …`、`request failed …`）、有纯中文（`项目不存在`）、有底层 `status` 透传（`{label}失败: {status}`）——不利于前端做统一渲染或国际化。
- **重试入口分散**：重试类错误 C1/C9/C10 三处同源语义（"节点不可重试"）散落在 `client/index.ts` 与 `client/api.ts`；队列等待取消（A12）与网络重试（A6/A7）逻辑也各写各的。
- **部分错误仅日志（D5）**：`deferred Drama promote failed`、`attachment divert failed` 只写 `ctx.logger.warn`，用户**完全无感知**——若这些失败会影响产物，应考虑升级为 D1/D3。
- **严重度未建模**：S1/S2/S3 只是本手册的事后归类，代码里没有 `severity` 字段，无法在 UI 上区分"阻塞红"与"提示灰"。

### 5.2 收敛建议（按性价比排序）
1. **定义统一错误类型**：`class CanvasStudioError extends Error { code: string; severity: 'block'|'recoverable'|'info'; channel?: 'chat'|'node'|'panel' }`，所有 `throw` 改为抛该类型。→ 让日志、UI 红点、重试策略都能读结构化字段，而不靠字符串。
2. **文案模板化**：抽一个 `tpl()` 工厂，统一 `{prefix}：{reason}（{hint}）` 三段式；英文前缀改为枚举常量（`Backend`/`Asset`/`Param`/`Fs`…），便于国际化与前端分类着色。
3. **收敛重试入口**：把"节点是否可重试"的判断收口到单一函数（现 C1/C9/C10 三处），避免文案/逻辑漂移。
4. **D5 升级评审**：逐条核对当前 `ctx.logger.warn` 的调用点，对"用户应知道"的失败显式升级为 D1/D3。
5. **本手册作为单一真相源**：把 §4 的编号（A1…K5）回写到代码注释或错误 `code` 字段，使"用户贴报错 → 查手册 → 定位根因"形成闭环。

> 实施 1+2 不改动任何外部行为（纯重构），风险低，可作为"错误处理收敛"第一步。需要我按此方案落地（例如先建 `CanvasStudioError` 类型 + 把 B/C/D 三组改成结构化抛出）可继续。
