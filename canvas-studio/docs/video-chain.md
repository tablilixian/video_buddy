# 视频生成链路契约（video-chain）

> **本文是视频链路的对照基线**：从编排意图到产物落盘，每一环「谁负责 / 契约是什么 / 异常怎么兜」。
> 后端契约变更（如 0.5.0 的 500→502、同步→异步）时，先对本文改口径，再动代码。
> 依据：CV-231（异步任务接入）、CV-238（句柄校验 + 自愈结构化），探针证据
> [api-probe/video-jobs-20260924](./api-probe/video-jobs-20260924/report.md)，
> 事故复盘见 §10（2026-09-24「测试多任务」会话 21 连败）。

```
┌─编排层─┐   ┌─工具层─────┐   ┌─请求层──────────┐   ┌─任务层────────┐   ┌─结算层────┐
│ skill  │──▶│ 工具选择    │──▶│ 句柄解析→IR预检  │──▶│ 202+job_id    │──▶│ 下载产物   │
│ 审批门禁│   │ 参数准备    │   │ 素材规格校验     │   │ jobs.json台账  │   │ ffmpeg实测 │
│ todo驱动│   │ 提示词格式  │   │ 供应商路由→POST  │   │ 30s独立轮询    │   │ 画布落盘   │
└────────┘   └────────────┘   └────────────────┘   └──────────────┘   └──────────┘
         ↑                                                          │
         └────────────── 异常/恢复：自愈·取消·超时·断线续查 ◀──────────┘
```

---

## 1. 编排层（谁决定生成视频）

- **skill 工作流**（brand-promo-video-generator 等）：剧本 → 提交审批 → 分镜 → 提交审批 → 逐镜视频 → 质检 → 合成。视频生成在分镜批准**之后**。
- **审批门禁**（`approval-gate.ts`）：`video_generate` / `video_composite` 是仅有的受控工具——`drafting` 放行、审阅态拦截、auto（放手跑）放行。
- **并发纪律**（后端 0.5.0 异步化起）：视频可**连续提交多镜头**（后端 ComfyUI 自行排队串行执行），不必等上一个出片；**不要重复提交同一镜头**。模型可见文案唯一源 = `DRAMA_VIDEO_ASYNC_HINT`（config.ts）；图片 / 上传 / video2vl 仍是同步串行（`DRAMA_SERIAL_HINT`）。

## 2. 工具选择（capabilityOf，唯一路由权威）

| 你手里有什么 | 该用 | 能力 → Drama 端点 |
| --- | --- | --- |
| 只有提示词 | `video_generate`（不传 filename） | text-to-video → `image2videofl2va` |
| 1 张首帧图 | `video_generate`（传 filename） | first-last-frame → `fl2va`（image1） |
| 2 张图（首帧+尾帧） | `video_composite` | first-last-frame → `fl2va`（image1+image2） |
| 1 张或 ≥3 张图 | `video_composite` | multi-reference → `image2videoref2va`（image1..N） |
| 带 audioRefs / videoRefs | 任一工具 | 一律 multi-reference → `ref2va` |

- 帧模式与参考模式**互斥**；带音频/视频参考一律 r2v，语义变更经 `referenceModeNotice` 回 warning，不静默改写。
- `provider`：`drama`（默认）/ `fal`；fal 未接入参考视频（带 videoRefs 直接报错）。

## 3. 参数准备——句柄纪律（**最容易错的一环**）

### 3.1 文件名三形态与可消费性（CV-155）

| 形态 | 长相 | 能否作入参 |
| --- | --- | --- |
| **上传句柄** | `ref-<8位hex>.<ext>`（`upload_image` 返回） | ✅ 唯一合法裸值 |
| **产物名** | `krea2_00307_.png` 等（生成结果的服务器文件名） | ❌ 直接传会被后端拒 |
| **画布节点 id** | `3fec15c4-1324-…`（= 资产 URL basename） | ❌ 后端没有这个文件 |

### 3.2 Host 解析契约（`resolveRefValue` / `resolveRefValues`）

```
@ref[显示名] ──▶ findNodeByRef（id 精确 → 标题兜底）──▶ 节点 filename
                 ├─ 产物名（krea2_* 等）──▶ 主动重传换 ref-* 句柄并回写节点 ✅
                 └─ filename 缺失 ──▶ 现场提升（promoteAssetFile）✅
裸字符串（非 @ref）──▶ 形态校验（CV-238）：
                 ├─ 节点 id 形态（UUID）──▶ 拒绝 CS-USER-002（可行动报错，零后端调用）✅
                 └─ 其余（ref-* 句柄、产物名等）──▶ 原样放行（产物名由自愈兜底）
```

- `looksLikeCanvasNodeId`（generate.ts）：basename 去扩展名后为标准 UUID 即命中；句柄（`ref-*`）、产物名（计数器段）、局部 hex 本地名都不误伤。
- **教训（CV-238）**：模型会把 `nodeId` / 资产 URL basename 当 filename 传——必须在发后端之前拦，且报错要教正确取法。

### 3.3 其他参数规格

| 参数 | 规格 | 校验位置 |
| --- | --- | --- |
| `duration` | [1,15]，默认 5/10 | clampDuration |
| `aspectRatio` | 只发 16:9 / 9:16（历史 1:1 就地归一） | dramaAspect |
| `resolution` | 480p / 736p / 2k → megapixels 0.4/0.9/2.0 | 档位表 |
| `audioRefs` | ≤3 段、单段 2–15s、合计 ≤15s、不能作唯一输入 | audio-reference.ts（发出前拦） |
| `videoRefs` | ≤3 段、MP4/MOV ≤50MB、合计 ≤15s、可作唯一输入；仅 drama | video-reference.ts |
| 图+视频+音频 | 合计 ≤12 | validateH3ReferenceBudget |
| `sourceUrls` / `shotRefs` / `shotTransition` / `replaces` | 只影响画布血缘/落位/取代，**不发后端** | — |

## 4. 提示词格式（IR 简报 vs 纯文本）

- 长得像 H3-Context-IR 简报才预检；纯文本直接透传。
- 模式按**素材数量**推（T2VA / I2VA / FL2VA / Ref2VA；带音频视频一律 Ref2VA）；`irMode` 显式声明可对账，不符立即报「模式声明不一致」。
- **先修后拦**（CV-196）：围栏/空行/段序/对齐行时长就地修复并进 warnings；结构 ERROR 才拦（`CS-H3IR-001`，不发后端）；软 WARN 并进 result.warnings（CV-236）。
- 模式判定有两套口径（预检按数量 / h3-prompt-writing 按角色），报错文案已带对账提醒。

## 5. 请求层（Drama 适配器）

| 项 | 契约 |
| --- | --- |
| 请求体 | fl2va：`{prompt, aspect, megapixels, duration, image1, image2}`；ref2va：`image1..9 + video1..3 + audio1..3`；`generate_audio` 仅显式指定才发，被拒由自愈摘字段并回 warning |
| 提交通道 | `callDramaJson` → `withGenerateSlot`（宿主串行队列，只占槽 ~100ms）；参考图自愈壳 `withReferenceHeal` 包在外 |
| 提交超时 | `DRAMA_TIMEOUT_MS.videoSubmit` = 60s（202 秒级返回） |
| 传输层 | `dramaPost`：长请求 dispatcher；**502/503/504 内部自动重试一次**（注意：这意味着参考文件无效的 502 实际会打后端两遍才轮到自愈）；本地超时附带探后端队列深度 |
| 错误结构 | 非 2xx → `CS-GEN-206`，**`params.httpStatus` 携带 HTTP 状态码**（CV-238，供自愈结构化判定） |

## 6. 任务层（异步任务：提交 → 轮询 → 取结果）

1. **提交**：`POST /generate/image2videofl2va|ref2va` → `202` + `{job_id, status, status_url, cancel_url, result_url}`（实测 48ms；job_id = ComfyUI prompt_id）。
2. **台账**：`onSubmitted` → 立即写项目 `<项目目录>/jobs.json`（jobId / toolName / 完整参数快照 / status=pending）；状态流转经 `onJobUpdate` 增量回写（promise 链串行）。**这是断线续查的唯一凭据。**
3. **轮询**：`GET /api/v1/jobs/{job_id}`，**每任务独立 30s**；executor 整体墙钟 40min（`DRAMA_TIMEOUT_MS.video`，客户端占位截止 42min 成对）。
4. **状态机**：

| 后端 status | 行为 | UI |
| --- | --- | --- |
| `pending` | 继续轮询 | 排队中 |
| `in_progress` | 继续轮询 | 生成中 |
| `completed` | → `GET .../result` | — |
| `failed` | `CS-PROV-015`（带 execution_error） | 节点错误 |
| `cancelled` | `CS-PROV-015` | 节点错误 |
| `404` | `CS-PROV-016`（任务消失=后端重启清队列，不当瞬时错误） | 节点错误 |

5. **result 三态**：`200` → `{prompt_id, filename, full_url, duration}`（与旧同步响应同构）；`202` → 下一轮；`409` → 失败。**`duration` 是服务端耗时不是片长**（实测 129.11s vs 状态机 132s），片长以本地 ffprobe 为准（CV-140）。
6. **瞬时容忍**：网络异常 / 5xx / 响应形状不对 → 当「本轮未完成」；用户 abort 不吞（signal 中止直接抛给 executor 统一 cancel）。
7. **取消**：executor 在整体超时 / 用户打断时调 `POST /jobs/{id}/cancel`（实测 ~5s 内翻 cancelled）；取消不再留孤儿任务。
8. **断线续查**（`src/video-jobs.ts`）：Host 启动（`createStudioTools`）时扫描所有项目非终态任务，逐个起独立 30s 恢复循环；completed → 取 result → 共享结算落盘；failed/cancelled/404 落终态；单任务最长跟踪 45min。

## 7. 结算层

`result.full_url` → `downloadBytes`（512MB / 10min 上限）→ **persistGeneratedAsset**（共享结算，generate.ts）：写资产 → ffmpeg 实测真实时长+分辨率 → 画布节点（新节点带血缘/分镜编组/版本取代，retryOf 原地更新）→ 台账置 `settled`（终态保护：终态不可被迟到状态打回）。本轮未结算（超时/打断）按台账现状收尾：completed 保持（重启后再结算）、其余落 cancelled。客户端：占位截止 42min；`resumedJobs` 计数下降 → 自动重载画布。

## 8. 异常处理矩阵

| 情形 | 兜底机制 | 判定方式 |
| --- | --- | --- |
| 裸节点 id 当句柄 | **CV-238 前置校验**：`CS-USER-002` 拒绝，零后端调用 | 形态（UUID） |
| 参考文件失效（老形态：500 / HTTP 400/404 字样） | 自愈：反查节点 → 重传换句柄 → 重试一次 | 消息正则（兜底） |
| 参考文件失效（**0.5.0 形态**：502 + body「400 Client Error…」） | 同上——**CV-238 起按 `params.httpStatus` 结构化判定**（400/404/5xx；422 除外） | 结构化状态码（优先） |
| 自愈反查不中（无节点 / 无 sourceUrls / 本地资产缺失） | 保留原始错误，不重试 | — |
| 带音频/参考视频被拒 | 外层 catch 附加「带了 H3 参考素材」定向提示 | — |
| IR 结构错误 | 预检拦截（不发后端）；WARN 并进 warnings | — |
| 整体超时 40min | provider.cancel + `CS-PROV-014` | executor deadline |
| **用户打断 / 取消** | 统一取消码 **`CS-GEN-207`**（executor signal 分支 / 排队等待被取消 / dramaPost abort 归一）；generateAsset 的视频 catch 对 abort **原样透传**（不套「音频参数」指导）；客户端按码**移除占位节点**（不标红「生成失败」——取消不是故障）；台账落 `cancelled` | 码 |
| 框架派发前中止（`ABORTED_BEFORE_DISPATCH`，回合打断时同批排队的调用） | 客户端**移除占位**（不标红） | 码（框架） |
| 后端任务失败 | execution_error 透传 `CS-PROV-015` | 状态机 |
| 任务消失（404） | `CS-PROV-016` | 状态机 |
| 进程硬死（提交后无人轮询） | 台账遗留 → **重启**时恢复轮询（已知缺口：turn 中止到重启之间无人认领，见 §10） | jobs.json |

## 9. 已知缺口（未修，按优先级）

1. ~~P1 孤儿任务即时转交~~（**CV-239 已修取消路径**：打断 → 台账 cancelled + 后端 cancel；进程**硬死**仍要等重启，watcher 只启动时扫一次——剩余缺口收窄为「硬死且未重启」窗口）。
2. ~~P2 打断 UX~~（**CV-239 已修**：取消类调用占位直接移除——`ABORTED_BEFORE_DISPATCH` / `TOOL_ABORTED` / `CS-GEN-207` 三形态；未提供新钩子的消费方退化为 onToolError）。
3. ~~P2 编排引导~~（**CV-240 已修**：总纲第 9 步 + toolchain.md 写明「非 chain 镜批量提交、chain 镜按链序」；批量行为已在实测中自然出现，条文固定为流程）。
4. ~~P2 skill 纪律~~（**CV-240 已修**：总纲第 9 步 + toolchain.md 写明句柄纪律「只认 @ref / upload_image 句柄」；CS-USER-002 报错兜底教学）。
5. **P2（新增，CV-240 决策）**：质检退出生成过程后，`qc_shot` 仅用于成片交付后的《质检报告》——需观察实际会话中模型是否守约（不再过程中调用）；若守不住，考虑把 qc_shot 从公开工具表移除、由 Host 在 compose 完成后自动生成报告。

## 10. 事故复盘（2026-09-24「测试多任务」会话）

**现象**：画布 7 个视频占位全部「生成失败」；对话区 15+ 条「生成失败（后端返回错误）：请求失败: 400 Client Error…」；job3 卡 in_progress。

**因果链**：

1. 模型把节点 UUID（资产 URL basename）当 filename 传 → 21 次带参考图的调用全发给了后端（`resolveRefValue` 当时对裸值不校验）。
2. 后端 0.5.0：ComfyUI 拒绝引用不存在输入文件的工作流（400）→ Drama 包成 **502 + detail**。实测复现：
   ```
   POST /generate/image2videofl2va  {"image1":"3fec15c4-1324-…"}
   → HTTP 502  {"detail":"请求失败: 400 Client Error: Bad Request for url: http://…:8188/prompt"}   (55ms)
   ```
3. `describeError` 用 body detail 替换默认文案 → 消息里没有「HTTP 5xx」字样 → `isBadReferenceError` 正则失配 → **自愈未触发**（sourceUrls 本可救回）。
4. 错误对模型不可行动 → 盲试 15+ 轮（去音频 / 去 IR / 改图数，从不换句柄）；每次失败因 dramaPost 的 502 重试打了后端两遍。
5. 模型最终放弃全部参考图改纯文生视频才成功（2 条落画布）——**一致性锚点静默弃用**，属质量降级。
6. job3 提交后进程硬死 → 台账 in_progress 无人认领（watcher 只启动时扫一次）。

**修复（CV-238）**：§3.2 的形态校验（CS-USER-002）+ §8 的结构化自愈判定；守卫测试：`tests/filename-consumability.test.mjs`（判据 + 工具级拦截零后端调用）、`tests/generate.test.mjs`（502 新形态 → 自愈 → 重传句柄 → 202 → 落盘，全链路）。

**探针基线**（[api-probe/video-jobs-20260924](./api-probe/video-jobs-20260924/report.md)）：提交 48ms/202；状态机 `in_progress@0s → completed@+132s`（0.4MP/5s，队列空）；result 三态；取消 ~5s 翻转。
