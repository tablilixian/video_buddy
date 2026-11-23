# DramaServer 生成面业务 API 迁移方案（2026-11-22）

> 状态：**拍板已收口（§8 五点全定，2026-11-22），待开工**。本文档 = 完整分析 + 实施计划。
> 输入材料：后台《DramaServer 业务 API》api(12).md、参考项目 `参考/reelsbuddy-desktop`、后台补充说明两条
> （① 资源上传流程改版、以 asset_id 标识资源；② 全部异步 poll，客户端需同步等待就在本地 poll，
> 未来转向纯异步，须限制客户端同时任务数；视频支持 1:1）。
> ⚠️ 后续换代：2026-11-23 后端把产物下载从本文的 `/content/{ordinal}` 换成
> `/download/{ordinal}` 票据 + 签名 Blob/CDN，并新增 `result_status`；现行契约见
> [../api.md](../api.md) v1.1.0 与 [换代报告](../api-probe/generation-download-20261123/report.md)。

---

## 1. 结论摘要（TL;DR）

- 新生成 API（`/v1/generations`、`/v1/assets/*`、`/v1/generations/quote`、`/poll`、`/content`）**已部署在现有
  `businessApiBase`（http://117.50.108.73，80 端口）上**，与管理面同源——不需要新增服务地址，改造收敛在
  canvas-studio 插件的 Host 侧。
- 旧生成后端（`dramaApiBase` = http://117.50.108.73:8082，`/api/v1/generate/*`）**仍在线**，给了我们迁移缓冲；
  旧 API 不在 80 端口（404 route not found）。
- 架构**不搬**参考项目的 `/business/v1/*` 代理层：参考项目这么做是因为它的渲染层是不可改的官方 Studio 前端；
  我们的渲染层是自有代码，且 2026-10-15 已拍板「client 是 Supabase 会话唯一持有者、Host 直连上游」。本次只把
  **Host 侧调用面**从 `/api/v1/generate/*` 换成 `/v1/*`，会话推送机制原样复用。
- 改动主战场：`generate.ts`（调用链重写）、`providers/drama.ts`（换成业务 API 轮询）、`video-jobs.ts`（台账 v2）、
  `generate-queue.ts`（并发宽度）、`model-route.ts`（端点→模型 code）、新增契约层与上传三段式。
- 两个**能力缺口**需要拍板：`image2fix`（Boogu 改字）在新 API 无对应 operation；`generate_audio`（H3 原生音轨开关）
  在新 API 属未知字段会被拒收。
- 1:1 画幅新 API 官方支持，摘除现有「可能被静默降级」警告即可（枚举早已放行）。

---

## 2. 改动前的测试（已完成）

本机无可用登录 token（`~/.dsh/.credentials.yaml` 与两个桌面端 Local Storage 均无缓存 JWT），带鉴权的端到端
探针只能等真机登录后做。已完成的**无鉴权**探针：

| 探针 | 结果 | 结论 |
| --- | --- | --- |
| `GET http://117.50.108.73:8082/api/v1/health` | `200 {"status":"ok","queue_task_count":0}` | 旧生成后端仍在线、当前空闲 |
| `GET http://117.50.108.73/v1/models`（无 token） | `401 {"error":{"code":"unauthenticated",...}}` | 新错误信封、路由在 |
| `GET http://117.50.108.73/v1/generations?limit=1`（无 token） | `401 unauthenticated` | **生成列表路由已部署** |
| `POST http://117.50.108.73/v1/generations/quote`（无 token） | `401 unauthenticated` | **报价路由已部署** |
| `POST http://117.50.108.73/v1/assets/presign`（无 token） | `401 unauthenticated` | **素材上传路由已部署** |
| `GET http://117.50.108.73/api/v1/health` | `404 route not found` | 旧生成 API 不在 80 端口（两代 API 不共存于同一端口） |
| `GET https://api.reels.playout.com/v1/models` | DNS 解析失败 | 生产域名本机不可达；继续用 `businessApiBase` |

**真机首验清单**（登录后要补的探针，见 §10）时再跑。

---

## 3. 现状 vs 新 API 差距总表

### 3.1 调用拓扑（现状，均已对照代码验证）

```
渲染层（supabase-js 唯一持有者，PKCE + autoRefreshToken）
   │  POST /canvas-studio/auth/session 推送会话（boot/SIGNED_IN/TOKEN_REFRESHED/visibilitychange）
   ▼
Host（canvas-studio 插件，内存缓存 auth-session.ts:23-38）
   ├─ 生成面：generate.ts 经 dramaPost(:677) / dramaJobRequest(:444) / uploadBytesToDrama(:848)
   │          直连 dramaApiBase(8082) 的 /api/v1/generate/* 与 /api/v1/jobs/*
   ├─ 管理面：drama-management.ts DramaClient 直连 businessApiBase(80) 的 /v1/auth/sync、
   │          /v1/models?modality=text、/v1/credits/balance、/v1/billing/*
   └─ LLM 网关：gateway.js 写 llm-pi-ai 行（baseURL = businessApiBase/v1/llm），
               凭据经 CANVAS_STUDIO_GATEWAY_TOKEN 每请求解析
```

### 3.2 逐项差距

| 维度 | 现状（生成面） | 新业务 API | 改动 |
| --- | --- | --- | --- |
| 服务地址 | `dramaApiBase` 8082 专用生成后端 | 与管理面同源（`businessApiBase` 80） | 生成请求改指向 `businessApiBase` |
| 鉴权 | `dramaAuthHeaders()` 单点 Bearer（auth-session.ts:69） | 同左（`/v1/*` 全要 Supabase JWT）；**PUT 直传不带 Bearer** | 复用单点；上传 PUT 显式不带 |
| 上传 | multipart `POST /api/v1/generate/upload` → `{name}` 文件名句柄（generate.ts:848-901） | 三段式 presign(201) → PUT upload_url → complete(SHA-256) → `asset_id`（30 次/分钟限流） | 上传引擎重写，句柄语义 filename→asset_id |
| 图片生成 | 同步阻塞 `POST /api/v1/generate/txt2image|txt2image_withtxt|image2image`（返回 `full_url`） | `POST /v1/generations` 202（model+operation+input+inputs[]）→ `/poll` → `/content/{ordinal}` 下载 | 全部改异步创建+轮询+受保护下载 |
| 图片路由 | `MODEL_ROUTE_TABLE` 端点即模型（model-route.ts:31-42，Krea2/Qwen/Boogu） | `/v1/models` 目录 `capabilities.operations` 过滤，模型 `code` 提交（如 `image.qwen-image-2.1`） | routeImageModel 返回模型 code；目录校验 |
| 视频 | 202+`job_id`（ComfyUI prompt_id）+ 30s 固定轮询 `/api/v1/jobs/{id}`（providers/drama.ts + executor.ts） | 202+generation UUID + `/poll` **version 游标长轮询**（wait≤25s）+ `/cancel` | provider 重写，executor 骨架复用 |
| 产物下载 | 裸 fetch `full_url`（CR-010 限流 + SSRF 护栏，generate.ts:488） | 受保护 `GET /v1/generations/{id}/content/{ordinal}`（Bearer；410 gone=过期） | 下载入口换成鉴权 content 端点 |
| 计费 | G1 余额见底即停（generate.ts:424，单价接口 404 无 quote） | **quote 端点上线**（预估积分，4 位小数）+ 余额/冻结 + `concurrent_generations` 套餐特性 | G2-lite：提交前 quote 预检+展示 |
| 幂等 | 无（旧后端同步阻塞不需要） | `Idempotency-Key` 必填；同 key 同 body 重放返回原任务；同 key 异 body 409 | 创建意图持久化（台账内） |
| 任务台账 | jobs.json v1（jobId=prompt_id + 旧状态机）+ 30s 恢复轮询（video-jobs.ts） | generation UUID + version 游标 + 11 态状态机 + terminal 标志 | 台账 v2（版本化共存） |
| 并发 | 宿主单槽 FIFO（generate-queue.ts），`maxParallel` 刻意不接线（CV-215） | 服务端异步并发 + 套餐 `features.concurrent_generations` | 队列宽度可配，`maxParallel` 接线并与套餐取 min |
| 宽高比 | 枚举已有 1:1（providers/types.ts:40-53），Drama 提交带「可能静默降级」警告（drama.ts:177-183） | `aspect ∈ {16:9, 9:16, 1:1}` 官方支持 | 摘警告；megapixels 三档映射不变 |
| 参考素材预算 | 图≤9/视≤3/音≤3、**总数≤12**（h3-ir 校验） | 图≤9/视≤3/音≤3、**总数≤15** | 校验上限 12→15 |
| 字段命名 | 扁平槽位 `image1..9/video1..3/audio1..3`、`txt_prompt`/`instruct_prompt` | `inputs[]{asset_id,role,ordinal}` + 标准字段 `prompt`/`system_prompt`；**未知字段一律拒收** | 请求体组装层全换 |

### 3.3 工具 → operation 映射总表（改造后的唯一对照）

| 工具（agent 面，参数不变） | operation | input 字段 | inputs[] |
| --- | --- | --- | --- |
| `image_generate`（纯文生） | `txt2image` | prompt、width、height（档位换算） | 无 |
| `image_generate`（带参考 1-4） | `image2image` | prompt、width、height | image ×1-4（ordinal 1..4） |
| `image_generate_withtxt` | `txt2image` | 同上 | 无（模型 code=Qwen，路由层选） |
| `image_fix` | **无对应**（拍板点 §8.1） | — | — |
| `character_generate` | `image2character` | 不传 prompt | image ×1 |
| `image2vl` | `image2vl` | prompt（+可选 system_prompt） | image ×1 |
| `video2vl` | `video2vl` | prompt（+可选 system_prompt） | video ×1 |
| `asr2txt` | `asr2txt` | **不传 input** | audio 或 video ×1（role=素材 MIME 类型） |
| `music_generation` | `txt2audio` | prompt、lyrics、duration、bpm、key_scale、language、time_signature | 无 |
| `tts_voiceover` | `txt2speech` | prompt（=txt_prompt）、system_prompt（=instruct_prompt） | 可选 audio ×1（参考音色） |
| `video_generate` / `video_composite` | `image2videofl2va` / `image2videoref2va` | prompt、aspect、megapixels、duration | fl2va：image×0-2（ordinal 1=首帧 2=尾帧）；ref2va：image≤9+video≤3+audio≤3（总≤15） |

---

## 4. 总体方案与不做的事

### 4.1 采用的架构（与参考项目的差异，刻意说明）

参考项目（reelsbuddy-desktop）的链路是「渲染层零凭据 → 外壳 webRequest 注入 renderer-token/cookie → Host 的
`/business/v1/*` 代理 → DramaServer `/v1/*`」。它需要这一层是因为其渲染页面是**不可修改的官方 Studio 前端**。

我们不同：渲染层是自有 React 代码，2026-10-15 已拍板「**client 是 Supabase 会话唯一持有者**（PKCE/刷新归它，
supabase-js 的 refresh token 轮换不容两个持有者），Host 被动缓存、直连上游」（auth-session.ts 头注）。新 API 文档
第 6.1 节「渲染层不得直接访问 DramaServer」约束的是参考项目的**那条合法路径**；我们走的是文档同节的另一合法形态
——「非 Electron-代理的直连客户端」等价物：**所有 `/v1/*` 请求仍从 Host 进程发起**，渲染层照样不直连后台，
token 只进 Host 的请求头。因此：

- **不引入** `/business/v1/*` 代理层、不引入 renderer-token/cookie 注入三件套；
- **复用** 会话推送、`dramaAuthHeaders()` 单点、ApiError 结构化解析（drama-management.ts 已平移过参考项目的协议层）；
- 从参考项目**借鉴实现细节**（见 §4.2），不搬架构。

### 4.2 从参考项目搬的具体做法（清单）

1. **长轮询引擎**：`after_version` 游标 + `wait=25s` + 500ms→12s 指数退避 + `Retry-After` 优先 + 0-250ms 抖动 +
   代际令牌防串台（studio-panel client.js:1083-1140 的 Host 侧移植）。
2. **上传三段式**：presign → PUT（原样 `headers`，**不带 Bearer/session**）→ complete（SHA-256 小写 hex）；
   `upload_url` 安全校验（https 或回环 http、无 userinfo，违规 502）双侧各一道（参考 routes.ts:785 + client.js:516）。
3. **幂等意图**：提交前持久化 `{key, clientRunId, fingerprint, body}`；响应丢失复用原 key 重试；参数变更生成新 key；
   终态清理（参考 client.js:372-405）。落点是我们已有的 jobs.json 台账（Host 侧，比 localStorage 更稳）。
4. **报价防抖语义**：参数变化后重报价；报价失败不阻断提交（最终以创建响应为准）。我们无输入框防抖问题
   （agent 一次性给全参数），报价在创建前同步调一次即可。
5. **终态处理**：`terminal===true` 才结算；`finalizing`/`cancel_requested` 不算终态；文本/JSON 输出不调 content 端点。
6. **catalog 聚合降级**：模型/积分两路独立结算，部分失败装进 `error` 不整体 500（generation.ts:30-48 形态）。

### 4.3 明确不做 / 顺带做

- **不做**：渲染层 `/business/v1` 代理；Host 独占 Supabase 会话（不动 P1/P2 拍板）；模型选择 UI（catalog 驱动的
  模型切换 UI 另立项，本期只做「目录校验 + 常量默认 code」）。
- **顺带做**：`maxParallel` 接线（CV-215 的「等后端提供并发队列后再评估」条件成立）；1:1 降级警告摘除；
  参考素材总预算 12→15；`DRAMA_SERIAL_HINT` 同步单任务文案退役。

---

## 5. 改动范围（文件级清单）

### 5.1 新增

| 文件 | 内容 | 规模 |
| --- | --- | --- |
| `src/contracts/generation.ts` | 新 API 协议类型 + 纯函数解析（快照/输出/quote/presign/complete/状态机/operation 枚举/输入引用），全部可单测 | ~300 行 |
| `src/generation-client.ts` | 生成任务引擎：`createGenerationTask`（上传 refs → quote → 幂等创建）+ `followGeneration`（version 游标长轮询 + 退避 + 代际令牌）+ `downloadGenerationContent`（流式限长）+ 状态→台账 phase 映射 | ~400 行 |
| `src/providers/business.ts` | VideoProvider 实现（submit=create；poll=/poll 游标；cancel=/cancel），复用 executor.ts | ~150 行 |
| `src/asset-upload.ts` | 三段式上传：presign→PUT→complete + SHA-256 + upload_url 安全校验 + 资产缓存（manifest 值 asset_id 化） | ~200 行 |
| `tests/generation-contract.test.mjs`、`tests/generation-client.test.mjs`、`tests/asset-upload.test.mjs`、`tests/video-provider-business.test.mjs`、`tests/generation-jobs.test.mjs` | 单测（含假 DramaServer 桩） | ~1200 行 |

### 5.2 修改

| 文件 | 改什么 |
| --- | --- |
| `src/generate.ts`（主战场） | ① 图像/角色/理解/ASR/音乐/TTS 六条同步链路改走 `generation-client`（创建+同步 poll 等待）；② `uploadBytesToDrama`→`asset-upload`（句柄 filename→asset_id）；③ `callDrama/callDramaJson/callDramaRaw/dramaPost` **直接删除**（拍板 §8.1：老端口彻底废弃）；④ 产物解析 `full_url`→`outputs[]`+content 下载；⑤ `ensureDramaReachable` 探针改指向 `businessApiBase`（`GET /v1/models` 无 token 401=活）；⑥ 参考自愈 `withReferenceHeal` 适配 asset 失效（404/409/410 → 重传换 asset_id → 换新幂等 key 重试）；⑦ warnings 里的产物名纪律文案更新 |
| `src/providers/drama.ts` | 整体退役，由 `providers/business.ts` 接替（executor/registry/类型不动；`jobStatusOf/jobResultOf` 等纯函数随 v1 台账迁移保留或删除，见 §6-B3） |
| `src/providers/types.ts` | `ProviderContext` 注入面换成 generation-client 句柄（`dramaPostWithFallback`/`dramaJobRequest` 两个注入点换新）；`VideoRequest` 不变 |
| `src/video-jobs.ts` | 台账 v2：记录 `{generationId, version, intent{key,body}, api:'business'|'legacy'}`；状态映射（§6-B3 表）；恢复轮询改 `/poll` 游标（只跟 `api:'business'`）；**v1 旧记录原样保留不处置**（拍板 §8.3：扫描跳过、不落终态）；结算改 content 下载 |
| `src/generate-queue.ts` | 单槽→宽度 N 信号量（`setGenerateQueueWidth`）；语义改为「在途未终态任务数 ≤ N」（acquire 于创建前、release 于终态/放弃）；快照结构不变 |
| `src/model-route.ts` | `MODEL_ROUTE_TABLE` 端点→模型 code 常量（`image.krea2-*`/`image.qwen-image-2.1` 以目录实测为准）；`routeImageModel` 返回 `{model, operation}`；`ROUTE_SUMMARY` 文案同步 |
| `src/drama-management.ts` | DramaClient 增补：`listMediaModels`（无 modality 过滤）、`quoteGeneration`、`createGeneration`（Idempotency-Key + X-Client-Run-ID）、`pollGeneration`、`listGenerations`、`cancelGeneration`、`openGenerationContent`（流式）、`presignAsset`、`completeAsset`；`CatalogModel.capabilities` 增加 `operations?: string[]` |
| `src/host-config.ts` | `dramaApiBase`/`dramaApiKey` 字段删除（拍板 §8.1 老端口彻底废弃；先验证 DSH 设置文档对已删字段的容忍行为——strict 校验会整页读不出，那就保留字段标注 deprecated 且代码不消费）；`maxParallel` 说明更新（接线生效）；默认生图模型设置值迁移（端点路径→模型 code，§6-B4） |
| `src/index.ts` | 装配：runtime 暴露 `businessApiBase()` 给生成面；队列宽度接线（`min(maxParallel, entitlement.concurrent_generations ?? 2)`）；catalog 缓存喂给 model-route |
| `src/host-tools.ts` | 工具 description 同步（异步并发文案、1:1 摘警告、上传纪律 asset_id 化、budget 15）；`h3-ir-validate` 总预算 12→15；`DRAMA_SERIAL_HINT` 引用点替换为 `DRAMA_ASYNC_HINT` |
| `src/config.ts` | `DRAMA_ENDPOINTS` 收缩为 legacy 子集（health/upload 保留至清理批）；新增模型 code 常量；`DRAMA_SERIAL_HINT`→`DRAMA_ASYNC_HINT` |
| `src/client/`（轻） | 队列视图文案（operation 标签）、错误提示映射新错误码、（可选）预估积分展示 |
| `docs/api.md` → v0.5.0 | 生成后端契约全面改写为新业务 API（端点表、三段式上传、轮询契约、错误码、限流） |
| `docs/canvas-studio-api-usage.md`、`SKILL.md` | 上传纪律、同步单任务横幅、产物名纪律同步改写 |
| `docs/STATUS.md` | 台账登记（各批 CV 行） |

### 5.3 测试影响面（blast radius）

`grep -l "api/v1/generate|api/v1/jobs|dramaApiBase|DRAMA_ENDPOINTS|uploadBytesToDrama" tests/` 命中 **20 个**测试文件：
`generate.test.mjs`、`model-route.test.mjs`、`upload-endpoint.test.mjs`、`video-provider-drama.test.mjs`、
`generate-queue.test.mjs`、`asset-promote.test.mjs`、`auth-bearer.test.mjs`、`lib-ref-resolve.test.mjs`、
`resolution-tier.test.mjs`、`shot-cards.test.mjs`、`storyboard-*-gate.test.mjs`、`workflow-gate.test.mjs`、
`landing-gate.test.mjs`、`lineage-completion.test.mjs`、`auto-test-checkpoints.test.mjs`、`ui-hardening.test.mjs`、
`video-provider-select.test.mjs`、`video-provider-fal-refs.test.mjs`、`asset-path.test.mjs`。
处置原则：桩从「假 8082 端点」换成「假 /v1/ 端点」（按 api(12).md 契约造桩），断言逻辑尽量不动；
`video-provider-drama.test.mjs` 改名/改写为 business 版。

---

## 6. 实施计划（五个批次，批尾全量闸 + 即时 commit）

### B1 契约层 + DramaClient 扩展（纯增量，零行为变化）

1. `src/contracts/generation.ts`：类型 + 解析纯函数（不猜：形状不对返回 null，沿用本仓纪律）。
   - 状态机：`created/credit_held/queued/submitted/running/finalizing/succeeded/failed/cancel_requested/canceled/timeout`
     + `terminal` 标志（终态判定只认 `terminal`，`finalizing`/`cancel_requested` 必须继续轮询）。
   - 输出：`outputs[]{ordinal,type,mime_type,content_url?,text?,txt?,txt_word?,txt_segment?,width?,height?}`。
   - 操作枚举 10 个 + 每操作输入白名单（build 函数按 operation 裁剪字段，拒收未知字段对齐服务端）。
2. `drama-management.ts` 扩展 9 个方法（§5.2）+ `assertSafeAssetUploadUrl`（https/回环 http/无 userinfo）。
3. 单测：契约解析、操作白名单、URL 安全校验、幂等键校验（复用 `isValidIdempotencyKey`）。
4. **此批不改任何调用方**，闸绿即提交。

### B2 上传三段式 + 参考句柄 asset_id 化

1. `src/asset-upload.ts`：`uploadAssetBytes(bytes, {kind, contentType, filename})` →
   presign(`type/filename/content_type/size_bytes`) → PUT（**只带 presign.headers**）→ SHA-256 →
   complete → `asset_id`；`status==='ready'` 才返回；409 checksum 冲突、410 过期按错误码抛。
2. `generate.ts`：`uploadBytesToDrama` 内部实现替换（出口签名改 `Promise<{assetId, filename?}>`），
   `promoteAssetFile` / reference-manifest 值从 filename 换 `{assetId}`（manifest version 2，v1 旧值视为未上传重传）；
   `@ref` 解析链（resolveRefValue 等）出口语义同步。
3. 并发合并缓存（promoteInflight）保留，键不变（projectId/assetFile）。
4. 限流：presign+complete 30 次/分钟共享——沿用单点上传入口天然串行，另加 429 退避。
5. 单测：三段式全流程（假服务桩）、checksum 一致性、PUT 不带 Bearer 断言、manifest v2 迁移。

### B3 生成引擎 + 全工具改线（最大批）

1. `src/generation-client.ts`（§5.1）：
   - `createGenerationTask(deps, {operation, model, input, refs})`：refs→上传→`inputs[]`（role/ordinal 规则：
     同 role 从 1 连续唯一、同 asset 不重复；fl2va ordinal 1=首帧 2=尾帧）→ quote（可选，失败不阻断）→
     写台账 intent（**先于 POST**）→ `POST /v1/generations`（Idempotency-Key + X-Client-Run-ID）→ 202 快照；
     网络失败/响应丢失按原 key+原 body 重试；409 conflict 不自动换 key（必须人工/上层决策）。
   - `followGeneration(deps, snapshot, signal)`：`/poll?after_version=<version>&wait=25s` 循环；只以 `version`
     推游标；退避 {0,429,5xx} 500ms→12s 封顶 + Retry-After 优先 + 抖动；4xx 业务错误即停；代际令牌防旧循环覆盖。
   - 状态映射 → 台账 phase：`created|credit_held|queued→pending`、`submitted|running|finalizing|cancel_requested→in_progress`、
     `succeeded→completed`、`failed|timeout→failed`、`canceled→cancelled`。
   - `downloadGenerationContent(id, ordinal)`：Bearer 流式下载，沿用 CR-010 限长/超时；410 gone 专码。
2. `generate.ts` 六条链路改线（§3.3 映射表）：
   - 图片：`sizeForAspectRatio` 产 width/height（1..8192 内，档位表不变）；模型 code 由 `routeImageModel` 给。
   - 理解/ASR：文本与 JSON 输出**不调** content 端点，直接读 `outputs[0].text / txt / txt_word / txt_segment`
     （asr-transcript.ts 的行式串适配不变——字段名恰好一致）。
   - 音乐/TTS：audio 输出 content 下载，落盘与节点逻辑复用 `persistGeneratedAsset`。
   - 工具出口（url/nodeId/warnings）形状不变——agent 面零改动。
3. `providers/business.ts` + executor 接线：video_generate/video_composite 走新 provider；
   `generate_audio` 字段不再发送（拍板 §8.2）；1:1 降级警告摘除；ref2va 总预算 12→15（h3-ir-validate）。
4. `video-jobs.ts` 台账 v2（§5.2）；恢复轮询改 `/poll`；`activeResumeJobCount` 语义不变。
5. `generate-queue.ts` 宽度 N + 「在途任务数」语义；`maxParallel` 接线（B4 与 entitlement 联动）。
6. 提示文案：`DRAMA_SERIAL_HINT` 退役 → `DRAMA_ASYNC_HINT`（后台异步、客户端限流 N、勿重复提交同一镜头）；
   `generationLabelOf` 由端点派生改 operation 派生。
7. 单测：假 DramaServer 桩覆盖 全工具×(成功/失败/取消/超时/幂等重放/限流退避/恢复)。

### B4 计费接线 + 设置迁移 + 错误码治理

1. quote（G2-lite）：创建前报价；`estimated_credits > available_balance` 时抛 `CS-BILL-002`（余额不足，含预估数）；
   报价失败仅 warning 不阻断；结果文本附「预计消耗 X 积分」。
2. `concurrent_generations`（entitlement.features）→ 队列宽度 `min(maxParallel, N)`；**出厂默认 1**
   （拍板 §8.4：`maxParallel` schema 默认 2→1），设置页说明更新（「本项不会生效」标注删除，改为「同时任务数上限」）。
3. 默认生图模型设置值迁移：旧值（端点路径）→ 模型 code 映射表；目录里找不到 code 时的降级（报错并列出可用 code）。
4. 错误码治理（按 E1-E4 纪律，不挤通用码）：`CS-ASSET-0xx`（presign/PUT/complete/checksum/过期）、
   `CS-GEN-2xx`（幂等冲突/创建限流/结果过期），ApiError.code → CS 码映射表 + catalog 登记 + 客户端文案。
5. `billing-status`（held/committed/released）进结算钩子：终态后 `markCreditsStale` 已有，补 frozen 变化感知（轻）。

### B5 文档 + legacy 清理 + 全量验收

1. `docs/api.md` v0.5.0 全面改写（§5.2）；api-usage / SKILL.md / STATUS 同步。
2. legacy 清理（**验收通过后**）：`callDrama*`、`dramaPost`、旧 `providers/drama.ts`、`DRAMA_ENDPOINTS` 生成端点、
   `dramaApiBase`（是否保留视 §8.1/8.4 拍板）。
3. 真机验收清单（§10）+ `corepack yarn check` 全量闸。

---

## 7. 关键设计细节（实现时必须钉住的点）

1. **PUT 直传不带任何鉴权头**：presign 的 `upload_url` 是对象存储签名 URL；带 Bearer/session 反而可能破坏签名。
   断言测试钉住。
2. **幂等 key 生命周期**：`randomUUID()`；台账 intent 在 POST **前**落盘（enqueueLedger 同款串行队列）；
   网络失败复用原 key+原 body；**参数或 asset 变了必须换新 key**（409 conflict 不能自动换 key 重试）。
3. **轮询游标只认 `version`**：不把 `progress`/时间戳当游标；`wait≤25s`；超时响应仍是 200（不当错误）。
4. **终态只认 `terminal`**：`finalizing`/`cancel_requested` 继续轮询；取消后继续轮到 `canceled|failed|succeeded`。
5. **素材失效自愈**：创建返回 404/409（asset 未 ready/不存在）/410（过期）→ 重传本地文件换新 asset_id →
   **换新幂等 key** 重试一次（沿用 withReferenceHeal 结构，次数上限不变）。
6. **队列语义**：acquire 于「上传 refs 之前」，release 于「终态/放弃」——图片自然全程占槽，视频占槽到出片，
   N 由 `min(maxParallel, concurrent_generations)` 决定、**出厂默认 1**（拍板 §8.4：maxParallel schema 默认 2→1）；
   重启恢复的在途任务不计入信号量（尽力而为，注明）。
7. **模型 code 兜底**：常量默认 code（Qwen/Krea2/H3）启动后从 catalog 校验；catalog 无此 code 时工具错误里列出
   可用 code——不许静默换模型。
8. **文本输出不下载**：image2vl/video2vl/txt（outputs[].text）与 ASR（txt/txt_word/txt_segment）不走 content 端点。
9. **速率**：创建 10 次/分钟/用户（429 带 Retry-After，进退避）；presign+complete 30 次/分钟。
10. **json 输出大小**：ASR `txt_segment` 可能很长——沿用现有落盘转写 JSON 路径（transcriptPath），不改形状。

---

## 8. 拍板点（开工前需要用户确认）

### 8.1 `image_fix`（Boogu 改字）怎么办 —— 新 API 无 `image2fix`

**✅ 已拍板（2026-11-22）**：登录后探模型目录（`GET /v1/models`）——若目录里有可承载改字语义的模型
（boogu/fix 类，或 `image2image` + 对应模型）则映射过去；**不能承载则直接下线 image_fix**（工具、
CV-212 自动修复链、路由表项一并删除，工具层提示改走 `image_generate_withtxt` 重出）。
**老端口 8082 本次彻底废弃，不留任何 legacy 专链**——`dramaApiBase` / 旧 `DRAMA_ENDPOINTS` / 旧调用链
全部删除（见 §5.2 / §9 回滚修订）。
- 影响：CV-212 自动兜底链、`ROUTE_SUMMARY` 文案、`generationLabelOf`。

### 8.2 `generate_audio`（H3 原生音轨开关）—— 新 API 未知字段会被 400

**✅ 已拍板（2026-11-22）：先测试、记录结论，用户把情况反馈给后台。** 测试方法（零成本、不扣积分）：
用 `POST /v1/generations/quote` 携带 `input.generate_audio` 试探——quote 不建任务不冻结积分，若字段被拒
会 `400 invalid_argument`（未知字段），返回 200 则说明至少协议层接受（provider 行为再另行验证）。
代码侧处置：**本期新链路默认不发送该字段**（若 quote 实测被接受则保留发送并在文档记录）；测试结论
（请求样例、响应码、错误文案）落 `docs/api-probe/` 一份探针报告，供反馈后台。

### 8.3 legacy 兼容窗口（老端口废弃已拍板 §8.1，本条只剩 v1 台账记录的处置）

**✅ 已拍板（2026-11-22）：原样保留、不处置。** 代码侧无任何 legacy 分支；`video-jobs.ts` v2 读取器对
**v1 记录**（`api` 字段缺失/`'legacy'`）只读不跟：`pendingDramaJobs` 扫描与恢复轮询一律跳过，台账记录
不落终态、不删除。已知后果（用户知情接受）：升级瞬间挂在旧 8082 的未完任务不再被跟踪，对应画布节点
不会落盘；台账里留有一条非终态记录。v2 记录（`api:'business'`）走新 `/poll` 恢复链路，不受影响。

### 8.4 队列宽度默认值

**✅ 已拍板（2026-11-22）：出厂默认 1 保守起步。** 实现口径：`maxParallel` 设置项 schema 默认值
2→**1**（用户已显式设置的值不动）；生效宽度 = `min(maxParallel, entitlement.concurrent_generations ?? ∞)`；
entitlement 缺字段时不钳制（硬限制在服务端，超量提交 409 有正确退避）。验收期想对比并发行为，
设置页把 `maxParallel` 调到 2 即可，无需改码。恢复轮询跟踪的在途任务不计入信号量（尽力而为，代码注释注明）。

### 8.5 quote 展示位（可选）

**✅ 已拍板（2026-11-22）：硬闸 + 结果文本（候选 A）。** ① 创建前 quote；`estimated_credits >
available_balance` → 抛新错误码 `CS-BILL-002`（带预估数与余额数，提交前拦截）；② 工具结果文本附
「预计消耗 X 积分（提交时冻结，任务失败自动释放）」；③ 报价本身失败 fail-open 不阻断（对齐 API 文档）；
④ 画布 UI 预估卡片后置（等后台任务中心形态明确再立项）。

---

## 9. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 无 token，真实目录/字段形状未实测（capabilities.operations、模型 code、输出 ordinal 数） | B3 开工前做一次真机带鉴权探针（§10.1）；代码侧对形状「不猜」+ 目录校验兜底 |
| 幂等重放误并发（同 key 异 body 409） | intent 指纹=完整 body JSON；asset 变更换 key；409 不自动换 key |
| 长轮询在 Host 进程堆积（多任务 × 25s 挂起请求） | 宽度信号量限在途任务；轮询请求短超时 + 退避；代际令牌防泄漏 |
| 一次大批改线引入回归（20 个测试文件受影响） | 批次切分 B1→B5，每批独立闸绿；B1/B2 纯增量先行 |
| 老端口彻底废弃（已拍板）→ 无运行时旧链路可回退 | 每批独立 commit，异常按批 revert；B1/B2 纯增量不切流量，回归风险集中在 B3 |
| 429/限流抖动（创建 10/min） | 退避 + Retry-After；agent 提示「批量镜头分批提交」语义已有 |

回滚：每批独立 commit，异常按批 revert；**不保留运行时旧链路**（拍板 §8.1：老端口本次彻底废弃）。

---

## 10. 真机验收清单（登录后执行）

1. **带鉴权探针**：`/v1/models`（全 modality）落盘真实目录——确认 10 个 operation 的模型 code、
   `capabilities.operations`、`concurrent_generations` 实值；`/v1/generations/quote` 抽样三档报价。
2. 图片三链路：纯文生（Krea2 code）/ 文字渲染（Qwen code，四字无错字）/ 图生图（1-4 参考）出图 + 节点落盘 + 积分结算。
3. 角色 four-view（1 参考、无 prompt）。
4. 理解/ASR：image2vl、video2vl 文本回显；asr2txt 三段行式串落转写 JSON。
5. 音乐/TTS：出音频 + 时长 ffprobe 实测 + 参考音色链路。
6. 视频：fl2va 首帧 / 首尾帧 / ref2va 多参考（含 video/audio ref）/ **1:1 画幅实测成片**（无降级）。
7. 幂等：断网重试不重复冻结（余额 frozen 数对照）；同 key 异 body 409 文案。
8. 恢复：视频跑到一半重启客户端 → Host 恢复轮询 → 出片落节点。
9. 并发：两个任务在途时第三个排队（队列视图可见、宽度=min(maxParallel, 套餐)）。
10. 计费链路：quote 预检拦余额见底；终态后余额刷新（frozen→committed）。
11. 限流：连续创建 >10 次/分钟触发 429 退避后自愈。

---

## 附：参考项目对照索引（实现时按图索骥）

| 我方落点 | 参考实现 |
| --- | --- |
| 长轮询引擎 | reelsbuddy-desktop `packages/studio-panel/lib/client.js:1083-1140` |
| 幂等意图 | 同上 `:372-405, :1467-1504` |
| 上传三段式 | 同上 `:1366-1405`；URL 校验 `:516-529` |
| DramaClient 方法面 | 同上 `src/host/business/drama-client.ts`（sync/models/credits/generation*/assets*） |
| 请求体白名单解析 | 同上 `src/host/business/routes.ts:517-640`（assertOnlyKeys 形态） |
| catalog 聚合降级 | 同上 `src/host/business/generation.ts:30-48` |
| 错误信封/Retry-After | 我方 `src/drama-management.ts:246-259`（已平移，复用） |
